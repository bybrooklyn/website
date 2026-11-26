//! The world: a grid of cells in one flat array, cut into chunks of 64 by 64, and the step that
//! moves them.
//!
//! A cell is four bytes, kept as one u32 so the page can draw the grid as a picture of four
//! channels straight out of memory:
//!
//! - byte 0, its material (`materials.rs`);
//! - byte 1, its shade, chosen by chance when it is made, so sand is not one flat color (for pride
//!   sand, the stripe it was poured in);
//! - byte 2, its temperature, from 0 to 255, room temperature being `ROOM`;
//! - byte 3, bits 0 to 3 the clock of the step it last moved or changed in, bits 4 to 7 its
//!   falling speed: how many cells it fell in its last step, less one, and 0 at rest.
//!
//! An empty cell is air: material 0 and shade 0, with a temperature, and the clock of the step
//! something left it, which tells a cell resting on it that its support has just gone. A new world
//! is air at room temperature (`AIR`). Around the world is a border of `BORDER` cells, wall or void
//! by the setting for the edges, so that a cell near the edge can look at its neighbors without a
//! check. The border holds no heat.
//!
//! A step moves the cells and works their reactions (`react.rs`) row by row, levels liquids through
//! their bodies (`level.rs`), then spreads heat (`heat.rs`).
//!
//! Each chunk keeps a rectangle of where something may move this step (`now`) and next step
//! (`next`). A change to a cell adds the cells it could set moving, the cell and a margin around
//! it, to both. A chunk whose rectangle is empty sleeps and costs nothing. The rectangles are read
//! as the step reaches them, so a cell set moving earlier in the same step is still reached.

use alloc::vec;
use alloc::vec::Vec;

use crate::level::Levels;
use crate::materials::{deepest, EMPTY, FIRE, FLASH, Kind, LINES, MATERIALS, Props, REACTIONS, ROLL_ALONG, ROOM, SAME, STRIPE, STRIPES, TABLE, VOID, WALL, widest};

/// The side of a chunk, in cells.
pub const CHUNK: i32 = 64;
/// How many cells of edge lie around the world on every side.
pub const BORDER: usize = 8;
/// How far sideways a change can set a cell moving: as far as any material looks.
const MARGIN_X: i32 = widest();
/// How far up or down a change can set a cell moving: as far as a powder looks under its side to
/// slide, 3 for wet dirt, or down the slope it rolls off, 3 for sand.
const MARGIN_Y: i32 = deepest();
/// The clock runs 1 to this, then every cell's clock is set back to 0.
const CLOCK_MOST: u32 = 15;
/// The side of a block of the wind's field, in cells: the wind is one for every cell of a block.
pub const GUST: i32 = 16;
/// The strongest a wind blows along either way: what the brush paints.
pub const BLOWN: i32 = 100;
/// The fastest a cell's speed can be kept: sixteen cells a step.
const SPEED_MOST: u32 = 15;
/// How hot a flame must be to leap clear as a spark, and how seldom it does: once in this many steps.
const SPARK_FROM: u8 = 150;
const SPARK_ONE_IN: u32 = 96;
/// How fast a liquid must land to splash: a cell of it bounces up, as high as it was fast, and to a side.
const SPLASH_FROM: u32 = 5;
/// How far along its row a liquid with its own kind lying on it looks for an open place, and how far
/// up for the top of what lies on it: the reach of a liquid finding its level (`levels`). What a heap
/// of water can pass on in a step goes as the square of the first: at 16 a pour from the largest
/// brush stood as a hill under it, as steep as it had to be to carry the pour away.
const PRESS: usize = 64;
const HEAD: usize = 128;
/// The most cells a grain slides down a slope in one step, however fast it came: a grain that
/// lands on a heap is slowed by it, so a heap rests at its material's own angle whatever height it
/// was poured from.
const SLIDE_MOST: u32 = 4;
/// How far a grain that slides freely (sand, not dirt) runs on down a slope in the step it lands:
/// to the foot of all but the largest heaps. A heap then takes what is poured on it as fast as it
/// comes, and stands as a cone; at four cells a step the sides could not carry a pour away, and it
/// stood as a pillar up to the brush.
const SLIDE_FAR: u32 = 48;
/// How far any sliding grain may go with nothing under it: off a sheer face it lands a little clear.
const SLIDE_CLEAR: u32 = 3;
/// A powder lighter than this is passed by a heavier falling cell, as a liquid is: ash, which floats.
/// Sand and dirt are far heavier, so powders never pass each other but through ash.
const LIGHT_POWDER: u8 = 80;
/// An empty cell of air at room temperature, as a new world is filled with.
pub const AIR: u32 = (ROOM as u32) << 16;

/// What lies past the world's edges.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum Edges {
    /// A wall: nothing leaves.
    Walled,
    /// Nothing: whatever moves past an edge is gone.
    Open,
}

/// The order in which chunks are worked through.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum Order {
    /// Every row of the world from the bottom up, across the whole width.
    Rows,
    /// A checkerboard of four phases: every other chunk across and down at once, each chunk from
    /// its bottom row up. No two chunks of one phase can reach the same cell, so a phase could be
    /// shared among workers (stage 4) and give the same world.
    Phases,
}

/// A rectangle of cells, both ends counted. Empty when `x0 > x1`.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub(crate) struct Rect {
    pub x0: i32,
    pub y0: i32,
    pub x1: i32,
    pub y1: i32,
}

impl Rect {
    pub const EMPTY: Rect = Rect { x0: i32::MAX, y0: i32::MAX, x1: i32::MIN, y1: i32::MIN };

    pub fn is_empty(&self) -> bool {
        self.x0 > self.x1
    }

    pub(crate) fn add(&mut self, x0: i32, y0: i32, x1: i32, y1: i32) {
        self.x0 = self.x0.min(x0);
        self.y0 = self.y0.min(y0);
        self.x1 = self.x1.max(x1);
        self.y1 = self.y1.max(y1);
    }

    pub(crate) fn has_row(&self, y: i32) -> bool {
        self.y0 <= y && y <= self.y1 && self.x0 <= self.x1
    }
}

/// One chunk's two rectangles, and whether anything in it has moved since the clock last went
/// round.
#[derive(Clone, Copy)]
pub(crate) struct Chunk {
    pub now: Rect,
    pub next: Rect,
    /// Where heat may spread this step and next: kept apart from where things move, since sand
    /// falling through air all at one temperature changes no temperature.
    pub warm_now: Rect,
    pub warm_next: Rect,
    /// Where something has changed since the pass that joins vessels last ran (`level.rs`): it runs
    /// one step in eight, over all of this.
    pub due: Rect,
    stirred: bool,
}

impl Chunk {
    const ASLEEP: Chunk = Chunk { now: Rect::EMPTY, next: Rect::EMPTY, warm_now: Rect::EMPTY, warm_next: Rect::EMPTY, due: Rect::EMPTY, stirred: false };
}

/// The material of a cell.
#[inline(always)]
pub fn material(cell: u32) -> u8 {
    cell as u8
}

/// The temperature of a cell.
#[inline(always)]
pub fn temperature(cell: u32) -> u8 {
    (cell >> 16) as u8
}

/// Whether a cell is still warming or cooling itself, as burning wood, a flame or hot air do: moved
/// elsewhere, it must be reached by the heat pass there, though no temperature changed.
#[inline(always)]
pub(crate) fn restless(cell: u32) -> bool {
    let w = crate::materials::WARMTH[material(cell) as usize];
    let t = temperature(cell) as i32;
    (w.warms > 0 && t < w.toward) || (w.warms < 0 && t > w.toward)
}

/// A cell with its temperature set.
#[inline(always)]
pub(crate) fn with_temperature(cell: u32, t: u8) -> u32 {
    (cell & 0xff00_ffff) | (t as u32) << 16
}

/// The clock of the step a cell last moved in.
#[inline(always)]
pub(crate) fn clock_of(cell: u32) -> u32 {
    (cell >> 24) & 15
}

#[inline(always)]
fn speed_of(cell: u32) -> u32 {
    cell >> 28
}

/// Whether a cell is falling or sliding, not at rest.
#[inline(always)]
pub(crate) fn moving(cell: u32) -> bool {
    cell >> 28 != 0
}

/// A cell with its clock and speed set.
#[inline(always)]
pub(crate) fn with_state(cell: u32, clock: u32, speed: u32) -> u32 {
    (cell & 0x00ff_ffff) | (clock << 24) | (speed << 28)
}

#[inline(always)]
pub(crate) fn props(cell: u32) -> Props {
    TABLE[material(cell) as usize]
}

/// A number from the world's seed, the step and a place: the world's counter for chance. The same
/// three always give the same number, so a world stepped twice from the same start, with the same
/// strokes, comes out the same, whatever order its cells are reached in.
#[inline(always)]
pub(crate) fn chance(seed: u64, count: u64, place: usize) -> u32 {
    let mut z = seed ^ count.wrapping_mul(0x9e37_79b9_7f4a_7c15) ^ (place as u64).wrapping_mul(0xd1b5_4a32_d192_ed03);
    z = (z ^ (z >> 30)).wrapping_mul(0xbf58_476d_1ce4_e5b9);
    z = (z ^ (z >> 27)).wrapping_mul(0x94d0_49bb_1331_11eb);
    (z ^ (z >> 31)) as u32
}

/// A world of cells.
pub struct World {
    /// Its size in cells.
    pub width: i32,
    pub height: i32,
    /// Cells from one row to the next, border included.
    pub stride: usize,
    /// Every cell, border included, row after row from the top.
    pub cells: Vec<u32>,
    pub(crate) chunks: Vec<Chunk>,
    pub(crate) across: i32,
    pub(crate) down: i32,
    pub(crate) seed: u64,
    /// Steps taken.
    pub steps: u64,
    /// Brush strokes made, a second counter for chance.
    strokes: u64,
    pub(crate) clock: u32,
    /// Whether chunks with nothing moving are left alone. Off, every cell is reached every step,
    /// which must give the same world.
    pub sleeping: bool,
    /// The order chunks are worked through in.
    pub order: Order,
    edges: Edges,
    /// The first and last rows changed since the page last drew.
    changed: (i32, i32),
    /// Which bands of `CHUNK` rows hold a row changed since the page last drew, so that the page
    /// sends only those to the graphics card: in a large world, a pour at the top and a fire at the
    /// bottom are two bands, not every row between them.
    /// Each band's first and last column changed, so that only that much of it is sent: a pour in
    /// one corner of a wide world sent whole rows across all of it. A band with nothing changed holds
    /// `(i32::MAX, i32::MIN)`.
    bands: Vec<(i32, i32)>,
    pub(crate) levels: Levels,
    /// Two rows of cells as they were before the heat pass, kept while it works down the world.
    pub(crate) rows: Vec<u32>,
    /// How many times each line of `REACTIONS` has happened, by its place in the table.
    pub fired: Vec<u64>,
    /// How many cells of liquid have gone to find their level since the world was made (`levels`).
    pub levelled: u64,
    /// Whether a liquid under its own kind finds its level (`levels`). On, but for a test that holds a
    /// sleeping world equal to one fully awake: that reaches farther than a change wakes.
    pub levelling: bool,
    /// The wind, for each block of `GUST` by `GUST` cells, row after row: how hard it blows to the
    /// right and how hard downward, each from -`BLOWN` to `BLOWN`. Nothing where none was painted.
    pub winds: Vec<[i8; 2]>,
    /// How many blocks of wind there are across.
    pub gusts: i32,
}

impl World {
    /// An empty world of `width` by `height` cells, walled, whose chance comes from `seed`.
    pub fn new(width: i32, height: i32, seed: u64) -> World {
        let (width, height) = (width.max(1), height.max(1));
        let stride = width as usize + 2 * BORDER;
        let rows = height as usize + 2 * BORDER;
        let across = (width + CHUNK - 1) / CHUNK;
        let down = (height + CHUNK - 1) / CHUNK;
        let mut world = World {
            width,
            height,
            stride,
            cells: vec![AIR; stride * rows],
            chunks: vec![Chunk::ASLEEP; (across * down) as usize],
            across,
            down,
            seed,
            steps: 0,
            strokes: 0,
            clock: 0,
            sleeping: true,
            order: Order::Rows,
            edges: Edges::Walled,
            changed: (0, height - 1),
            bands: vec![(0, width - 1); down as usize],
            levels: Levels::new(stride * rows),
            rows: vec![0; 2 * stride],
            fired: vec![0; REACTIONS.len()],
            levelled: 0,
            levelling: true,
            winds: vec![[0; 2]; (((width + GUST - 1) / GUST) * ((height + GUST - 1) / GUST)) as usize],
            gusts: (width + GUST - 1) / GUST,
        };
        world.set_edges(Edges::Walled);
        world
    }

    /// The cell at a place in `cells`, read without a bounds check. Every look the rules make is
    /// within the border of walls round the world, `BORDER` cells deep, so no place they ask for lies
    /// outside `cells`; the check was a branch on every read, in the hottest loops of the engine.
    #[inline(always)]
    pub(crate) fn cell_at(&self, at: usize) -> u32 {
        debug_assert!(at < self.cells.len());
        // SAFETY: as above: every place asked for is inside the world or its border.
        unsafe { *self.cells.get_unchecked(at) }
    }

    /// Where cell (x, y) is in `cells`. x and y may be up to `BORDER` outside the world.
    #[inline(always)]
    pub fn index(&self, x: i32, y: i32) -> usize {
        (y + BORDER as i32) as usize * self.stride + (x + BORDER as i32) as usize
    }

    /// The cell at (x, y).
    pub fn get(&self, x: i32, y: i32) -> u32 {
        self.cell_at(self.index(x, y))
    }

    /// The material at (x, y).
    pub fn at(&self, x: i32, y: i32) -> u8 {
        material(self.get(x, y))
    }

    /// What lies past the edges.
    pub fn edges(&self) -> Edges {
        self.edges
    }

    /// Makes the edges walls or nothing.
    pub fn set_edges(&mut self, edges: Edges) {
        self.edges = edges;
        let edge = if edges == Edges::Walled { WALL } else { VOID } as u32;
        let b = BORDER as i32;
        for y in -b..self.height + b {
            for x in -b..self.width + b {
                if x < 0 || y < 0 || x >= self.width || y >= self.height {
                    let at = self.index(x, y);
                    self.cells[at] = edge;
                }
            }
        }
        // what was at rest against a wall may now fall out
        self.touch(0, 0, self.width - 1, self.height - 1);
    }

    /// The temperature at (x, y).
    pub fn temperature_at(&self, x: i32, y: i32) -> u8 {
        temperature(self.get(x, y))
    }

    /// Sets the temperature at (x, y), as a change that wakes what is near it.
    pub fn set_temperature(&mut self, x: i32, y: i32, t: u8) {
        let at = self.index(x, y);
        self.cells[at] = with_temperature(self.cell_at(at), t);
        self.touch(x, y, x, y);
        self.warmed(x, y, x, y);
    }

    /// How many cells of a material there are.
    pub fn count(&self, of: u8) -> usize {
        (0..self.height).map(|y| (0..self.width).filter(|&x| self.at(x, y) == of).count()).sum()
    }

    /// All the heat in the world: every cell's temperature, and what its material stores beyond it
    /// (`latent`). Only the reactions that make heat, the materials that warm or cool themselves,
    /// the brush and an open edge change it.
    pub fn heat_total(&self) -> i64 {
        let mut total = 0i64;
        for y in 0..self.height {
            let start = self.index(0, y);
            for &cell in &self.cells[start..start + self.width as usize] {
                total += temperature(cell) as i64 + MATERIALS.get(material(cell) as usize).map_or(0, |m| m.latent as i64);
            }
        }
        total
    }

    /// FNV-1a over every byte of every cell, row after row: a fingerprint of the whole world.
    pub fn fingerprint(&self) -> u64 {
        let mut hash = 0xcbf2_9ce4_8422_2325u64;
        for y in 0..self.height {
            let start = self.index(0, y);
            for cell in &self.cells[start..start + self.width as usize] {
                for byte in cell.to_le_bytes() {
                    hash ^= byte as u64;
                    hash = hash.wrapping_mul(0x100_0000_01b3);
                }
            }
        }
        hash
    }

    /// How many chunks have work still to come: those that will be worked through next step, and
    /// those where the pass that joins vessels is still owed (it runs one step in eight). A world is
    /// at rest when there are none.
    pub fn awake(&self) -> usize {
        self.chunks.iter().filter(|chunk| !chunk.next.is_empty() || !chunk.warm_next.is_empty() || !chunk.due.is_empty()).count()
    }

    /// The first and last rows changed since `forget_changed`, or an empty range.
    pub fn changed(&self) -> (i32, i32) {
        self.changed
    }

    /// The page has drawn what changed.
    pub fn forget_changed(&mut self) {
        self.changed = (i32::MAX, i32::MIN);
        self.bands.fill((i32::MAX, i32::MIN));
    }

    /// Whether band `band` of `CHUNK` rows, counted from the top, holds a row changed since
    /// `forget_changed`.
    pub fn band_changed(&self, band: usize) -> bool {
        self.bands.get(band).is_some_and(|&(x0, x1)| x0 <= x1)
    }

    /// The first and last column changed in band `band` since `forget_changed`, or `(i32::MAX,
    /// i32::MIN)` when none has.
    pub fn band_columns(&self, band: usize) -> (i32, i32) {
        self.bands.get(band).copied().unwrap_or((i32::MAX, i32::MIN))
    }

    /// Cells from `x0` to `x1` of row `y` look different, though nothing moved (a flame or lava that
    /// cooled): they are sent to be drawn again, and nothing is woken.
    pub(crate) fn redrawn(&mut self, x0: i32, y: i32, x1: i32) {
        self.changed = (self.changed.0.min(y), self.changed.1.max(y));
        let span = &mut self.bands[(y / CHUNK) as usize];
        *span = (span.0.min(x0), span.1.max(x1));
    }

    /// Something changed in the cells from (x0, y0) to (x1, y1): what they could set moving is
    /// reached later this step and next step.
    #[inline]
    pub(crate) fn touch(&mut self, x0: i32, y0: i32, x1: i32, y1: i32) {
        self.changed.0 = self.changed.0.min(y0.max(0));
        self.changed.1 = self.changed.1.max(y1.min(self.height - 1));
        if y0 < self.height && y1 >= 0 {
            for band in y0.max(0) / CHUNK..=y1.min(self.height - 1) / CHUNK {
                let span = &mut self.bands[band as usize];
                *span = (span.0.min(x0.max(0)), span.1.max(x1.min(self.width - 1)));
            }
        }
        let ax = (x0 - MARGIN_X).max(0);
        let bx = (x1 + MARGIN_X).min(self.width - 1);
        let ay = (y0 - MARGIN_Y).max(0);
        let by = (y1 + MARGIN_Y).min(self.height - 1);
        if ax > bx || ay > by {
            return;
        }
        for cy in ay / CHUNK..=by / CHUNK {
            let (top, bottom) = (ay.max(cy * CHUNK), by.min(cy * CHUNK + CHUNK - 1));
            for cx in ax / CHUNK..=bx / CHUNK {
                let (left, right) = (ax.max(cx * CHUNK), bx.min(cx * CHUNK + CHUNK - 1));
                let chunk = &mut self.chunks[(cy * self.across + cx) as usize];
                chunk.now.add(left, top, right, bottom);
                chunk.next.add(left, top, right, bottom);
            }
        }
    }

    /// A cell could have moved and by chance did not: it is reached again next step.
    pub(crate) fn stay(&mut self, x: i32, y: i32) {
        let chunk = &mut self.chunks[((y / CHUNK) * self.across + x / CHUNK) as usize];
        chunk.next.add(x, y, x, y);
    }

    /// The cells from (x0, y0) to (x1, y1) are reached next step, by the rules and by the heat
    /// pass, with no margin: what heat has changed or could change.
    pub(crate) fn wake(&mut self, x0: i32, y0: i32, x1: i32, y1: i32) {
        self.each_chunk(x0, y0, x1, y1, |chunk, (left, top, right, bottom)| {
            chunk.next.add(left, top, right, bottom);
            chunk.warm_next.add(left, top, right, bottom);
        });
    }

    /// The temperature of the cells from (x0, y0) to (x1, y1) changed, by a move, a reaction or
    /// the brush: they and the cells beside them are reached by the heat pass this step and next.
    #[inline]
    pub(crate) fn warmed(&mut self, x0: i32, y0: i32, x1: i32, y1: i32) {
        self.each_chunk(x0 - 1, y0 - 1, x1 + 1, y1 + 1, |chunk, (left, top, right, bottom)| {
            chunk.warm_now.add(left, top, right, bottom);
            chunk.warm_next.add(left, top, right, bottom);
        });
    }

    /// Calls `with` for each chunk the cells from (x0, y0) to (x1, y1) lie in, with the part of
    /// them inside it, all cut to the world.
    #[inline]
    fn each_chunk(&mut self, x0: i32, y0: i32, x1: i32, y1: i32, mut with: impl FnMut(&mut Chunk, (i32, i32, i32, i32))) {
        let (ax, bx) = (x0.max(0), x1.min(self.width - 1));
        let (ay, by) = (y0.max(0), y1.min(self.height - 1));
        if ax > bx || ay > by {
            return;
        }
        for cy in ay / CHUNK..=by / CHUNK {
            let (top, bottom) = (ay.max(cy * CHUNK), by.min(cy * CHUNK + CHUNK - 1));
            for cx in ax / CHUNK..=bx / CHUNK {
                let (left, right) = (ax.max(cx * CHUNK), bx.min(cx * CHUNK + CHUNK - 1));
                with(&mut self.chunks[(cy * self.across + cx) as usize], (left, top, right, bottom));
            }
        }
    }

    /// Moves the world on by one step.
    pub fn step(&mut self) {
        self.steps += 1;
        self.clock += 1;
        if self.clock > CLOCK_MOST {
            // Every cell's clock back to 0, so an old one cannot be taken for this step's. Only a
            // chunk where something moved since the last time can hold a clock that is not 0.
            for id in 0..self.chunks.len() {
                if !core::mem::replace(&mut self.chunks[id].stirred, false) {
                    continue;
                }
                let (cx, cy) = (id as i32 % self.across, id as i32 / self.across);
                let (x0, x1) = (cx * CHUNK, (cx * CHUNK + CHUNK).min(self.width));
                for y in cy * CHUNK..(cy * CHUNK + CHUNK).min(self.height) {
                    let start = self.index(x0, y);
                    for cell in &mut self.cells[start..start + (x1 - x0) as usize] {
                        *cell &= 0xf0ff_ffff;
                    }
                }
            }
            self.clock = 1;
        }
        for (at, chunk) in self.chunks.iter_mut().enumerate() {
            let (cx, cy) = (at as i32 % self.across, at as i32 / self.across);
            let whole = Rect { x0: cx * CHUNK, y0: cy * CHUNK, x1: (cx * CHUNK + CHUNK - 1).min(self.width - 1), y1: (cy * CHUNK + CHUNK - 1).min(self.height - 1) };
            chunk.now = if self.sleeping { chunk.next } else { whole };
            chunk.warm_now = if self.sleeping { chunk.warm_next } else { whole };
            chunk.next = Rect::EMPTY;
            chunk.warm_next = Rect::EMPTY;
        }
        // left to right and right to left by turns, so nothing drifts to one side
        let right = self.steps.is_multiple_of(2);
        match self.order {
            Order::Rows => {
                for y in (0..self.height).rev() {
                    let cy = y / CHUNK;
                    for k in 0..self.across {
                        let cx = if right { k } else { self.across - 1 - k };
                        self.row(cx, cy, y, right);
                    }
                }
            }
            Order::Phases => {
                for phase in 0..4 {
                    let (px, py) = (phase & 1, phase >> 1);
                    let mut cy = self.down - 1;
                    while cy >= 0 {
                        if cy % 2 == py {
                            for k in 0..self.across {
                                let cx = if right { k } else { self.across - 1 - k };
                                if cx % 2 != px {
                                    continue;
                                }
                                for y in (cy * CHUNK..(cy * CHUNK + CHUNK).min(self.height)).rev() {
                                    self.row(cx, cy, y, right);
                                }
                            }
                        }
                        cy -= 1;
                    }
                }
            }
        }
        self.level();
        self.heat();
        for chunk in self.chunks.iter_mut() {
            chunk.stirred |= !chunk.now.is_empty();
        }
    }

    /// Works through row `y` of one chunk, as far as its rectangle reaches when each cell is
    /// reached.
    #[inline]
    fn row(&mut self, cx: i32, cy: i32, y: i32, right: bool) {
        let id = (cy * self.across + cx) as usize;
        let rect = self.chunks[id].now;
        if !rect.has_row(y) {
            return;
        }
        if right {
            let mut x = rect.x0;
            while x <= self.chunks[id].now.x1 {
                let at = self.index(x, y);
                if x + 3 <= self.chunks[id].now.x1 && four_empty(&self.cells, at) {
                    x += 4;
                    continue;
                }
                self.visit(at, x, y);
                x += 1;
            }
        } else {
            let mut x = rect.x1;
            while x >= self.chunks[id].now.x0 {
                let at = self.index(x, y);
                if x - 3 >= self.chunks[id].now.x0 && four_empty(&self.cells, at - 3) {
                    x -= 4;
                    continue;
                }
                self.visit(at, x, y);
                x -= 1;
            }
        }
    }

    /// Works one cell: its reactions, then, if none happened, the rule for its kind. A cell that
    /// has moved or changed this step is left alone.
    #[inline(always)]
    fn visit(&mut self, at: usize, x: i32, y: i32) {
        let cell = self.cell_at(at);
        let p = props(cell);
        if p.kind == Kind::Empty || clock_of(cell) == self.clock {
            return;
        }
        let t = temperature(cell);
        if p.acts && !(p.calm_from <= t && t <= p.calm_to) && self.react(at, x, y, cell, p) {
            return;
        }
        let cell = self.cell_at(at);
        match p.kind {
            Kind::Powder | Kind::Liquid => self.fall(at, x, y, cell, p),
            Kind::Gas => self.rise(at, x, y, p),
            Kind::Fire => self.flicker(at, x, y, cell, p),
            Kind::Bolt => self.strike(at, x, y, cell, p),
            _ => {}
        }
    }

    /// Whether a cell falling or spreading, of this density, may move into `target`: it is empty,
    /// the edge of an open world, or a lighter liquid or gas that has not moved this step. A liquid
    /// (the only falling cells of density below a powder's but ash's) also takes the place of a
    /// lighter powder, so ash floats up through water rather than holding it back like a dam. Every
    /// powder but ash is heavier than every liquid but lava, which sinks through ash too.
    #[inline(always)]
    fn sinks_into(&self, density: u8, target: u32) -> bool {
        let p = props(target);
        match p.kind {
            Kind::Empty | Kind::Void => true,
            Kind::Liquid | Kind::Gas | Kind::Fire => p.density < density && clock_of(target) != self.clock,
            Kind::Powder => p.density < LIGHT_POWDER && p.density < density && clock_of(target) != self.clock,
            _ => false,
        }
    }

    /// Whether a gas of this density may rise or spread into `target`: it is empty, the edge of an
    /// open world, or a heavier gas that has not moved this step.
    #[inline(always)]
    pub(crate) fn rises_into(&self, density: u8, target: u32) -> bool {
        let p = props(target);
        match p.kind {
            Kind::Empty | Kind::Void => true,
            Kind::Gas => p.density > density && clock_of(target) != self.clock,
            _ => false,
        }
    }

    /// Moves the cell at `from` to `to`, and what was at `to` back to `from`, both marked as moved
    /// this step, each with its heat. Into the edge of an open world, the cell is gone, and air at
    /// room temperature comes in behind it.
    #[inline(always)]
    fn swap(&mut self, from: usize, to: usize, speed: u32, (x, y): (i32, i32), (tx, ty): (i32, i32)) {
        let mover = with_state(self.cell_at(from), self.clock, speed);
        let target = self.cell_at(to);
        // an empty cell left behind keeps the clock, so a cell resting on it knows its support
        // has just gone
        if material(target) == VOID {
            self.cells[from] = AIR | self.clock << 24;
        } else {
            self.cells[from] = with_state(target, self.clock, 0);
            self.cells[to] = mover;
        }
        self.touch(x.min(tx), y.min(ty), x.max(tx), y.max(ty));
        // heat moves with what moves; only where two temperatures were swapped can it spread
        if temperature(mover) != temperature(target) || restless(mover) || restless(target) || material(target) == VOID {
            self.warmed(x.min(tx), y.min(ty), x.max(tx), y.max(ty));
        }
    }

    /// The rule for powders and liquids: fall, gathering speed; or slide off a slope; or, for a
    /// liquid, spread sideways toward somewhere lower, or anywhere when pushed from above; or, for
    /// sand, roll off a slope steeper than it holds.
    #[inline(always)]
    fn fall(&mut self, at: usize, x: i32, y: i32, cell: u32, p: Props) {
        let s = self.stride;
        let speed = speed_of(cell);
        let below = self.cell_at(at + s);
        // What can fall, falls: nothing goes to a side while the way down is open. (Before 17 Nov 2026
        // a cell whose support had only just moved stepped aside instead; in a cloud of drops nearly
        // every cell is in that state, and poured water hung in the air and slid about as sheets.)
        if self.sinks_into(p.density, below) {
            // What is in the air is carried by the wind: the lighter it is the farther, up to four
            // cells a step for the lightest in the strongest wind, and a rising wind holds up or lifts
            // what is as light as snow.
            let (right, down) = self.wind(x, y);
            if (right != 0 || down < 0) && self.blown(at, (x, y), cell, p, (right, down)) {
                return;
            }
            // a grain that drifts goes down to a side now and then as it falls, as a flake of snow does
            if p.drift != 0 && p.kind == Kind::Powder {
                let drift = chance(self.seed ^ 0xd21f7, self.steps, at);
                let side: isize = if (drift >> 8) & 1 == 0 { -1 } else { 1 };
                if drift & 255 < p.drift as u32 && self.slides(at, side, 1, p.density, false) {
                    self.swap(at, (at + s).wrapping_add_signed(side), 1, (x, y), (x + side as i32, y + 1));
                    return;
                }
            }
            // A grain at rest whose support has only just gone holds for a step, as often as not, and
            // a grain beside it may squeeze into the gap first (below): so a hollow in sand does not
            // rise through it whole, as a bubble with a plug of sand coming down over it, but spreads
            // as it rises, and the ground above sinks in a wide dip. Sand let go in a block comes
            // apart as it falls in the same way.
            if p.kind == Kind::Powder && material(below) == EMPTY && clock_of(below) == self.clock {
                // Its support went this step. Where there is open air beside it, it goes out into
                // that and not down after its support: so the face of a pillar comes away all along
                // its height at once. Following its support down, a column moved one cell a step and
                // gave up one grain a step at its foot, and a pillar stood for seconds.
                if p.slide > 0 {
                    let aired = |side: isize| {
                        let beside = self.cell_at(at.wrapping_add_signed(side));
                        material(beside) == EMPTY && clock_of(beside) != self.clock && self.slides(at, side, p.slide as usize, p.density, false)
                    };
                    let (left, right) = (aired(-1), aired(1));
                    if left || right {
                        let side = if left && right { if chance(self.seed ^ 0x51de, self.steps, at) & 1 == 0 { -1 } else { 1 } } else if left { -1 } else { 1 };
                        self.slide_down(at, (x, y), side, speed, p.slide as usize, p);
                        return;
                    }
                }
                if speed == 0 && chance(self.seed ^ 0x5a66, self.steps, at) & 1 == 0 {
                    self.stay(x, y);
                    return;
                }
            }
            // A drop whose way down was only opened this step, by the one under it going, while under
            // that the way is shut (a queue, not a drop falling freely ahead of it), with open air beside
            // it and under that, goes down past the side, at its speed: so a column of water standing on
            // a pool comes apart into it, and does not creep down one cell a step behind its foot (until
            // 24 Nov 2026 it crept). Rain, whose drops fall freely, is left alone: taking every drop that
            // just had its way opened made falling water three times as dear.
            if p.kind == Kind::Liquid && speed != 0 && material(below) == EMPTY && clock_of(below) == self.clock && material(self.cell_at(at + 2 * s)) != EMPTY {
                let open = |side: isize| {
                    let beside = at.wrapping_add_signed(side);
                    material(self.cell_at(beside)) == EMPTY && material(self.cell_at(beside + s)) == EMPTY
                };
                let (left, right) = (open(-1), open(1));
                if left || right {
                    let roll = chance(self.seed ^ 0x5b11, self.steps, at);
                    let side: isize = if left && right { if roll & 1 == 0 { -1 } else { 1 } } else if left { -1 } else { 1 };
                    self.swap(at, at.wrapping_add_signed(side) + s, speed, (x, y), (x + side as i32, y + 1));
                    return;
                }
            }
            self.drop(at, x, y, below, speed, p);
            return;
        }
        // Held up by something that is itself still falling, it waits behind it and keeps its speed.
        // It has not landed: a grain that took the one ahead for ground stopped in the air, and a
        // pour backed up into a slow column of grains each starting again from rest.
        if speed != 0 && speed_of(below) != 0 && matches!(props(below).kind, Kind::Powder | Kind::Liquid) {
            self.stay(x, y);
            return;
        }
        let roll = chance(self.seed, self.steps, at);
        if p.kind == Kind::Liquid {
            if material(self.cell_at(at - s)) == material(cell) {
                // Under its own kind it does not go itself: the top of what lies on it goes, to the
                // open place nearest along this row (`levels`), once it has landed. Were it to go,
                // everything over it would drop a cell into its place and nothing else of a column
                // would move that step: a spike of water one cell wide stood and sank a cell a step.
                if speed == 0 && self.levelling && self.levels(at, (x, y), roll, p) {
                    return;
                }
                // Where levelling found nowhere to put it, a face of a pool with open air beside it and
                // under that spills down and out, as the top of a pool runs off, so that water does not
                // stand with upright sides over the air or drain off a shelf a cell at a time (until 24 Nov
                // 2026 it did, and stood as a wedge out over a slope). Not between two corners, as nothing
                // squeezes there.
                let open = |side: isize| {
                    let beside = at.wrapping_add_signed(side);
                    self.sinks_into(p.density, self.cell_at(beside)) && self.sinks_into(p.density, self.cell_at(beside + s)) && material(self.cell_at(beside)) != VOID
                };
                let (left, right) = (open(-1), open(1));
                if left || right {
                    let side: isize = if left && right { if (roll >> 3) & 1 == 0 { -1 } else { 1 } } else if left { -1 } else { 1 };
                    let to = at.wrapping_add_signed(side) + s;
                    self.swap(at, to, 1, (x, y), (x + side as i32, y + 1));
                    return;
                }
            } else {
                // At the surface: to a side where that takes it lower, down the slope beside it or
                // along the level to the next drop, as far as it spreads in a step. A level surface
                // is still.
                let (left, right) = (self.runs(at, -1, p), self.runs(at, 1, p));
                if left.is_some() || right.is_some() {
                    if !self.paced(roll, x, y, p) {
                        return;
                    }
                    // the way that takes it lower, or either by chance
                    let (to, along, down) = match (left, right) {
                        (Some(l), Some(r)) if l.2 != r.2 => if l.2 > r.2 { l } else { r },
                        (Some(l), Some(r)) => if (roll >> 1) & 1 == 0 { l } else { r },
                        (Some(l), None) => l,
                        (_, Some(r)) => r,
                        (None, None) => unreachable!(),
                    };
                    // with nothing under it there it is falling, at a speed of its own, as from the
                    // brush, so that what pours over an edge together comes apart into drops
                    let falls = if self.sinks_into(p.density, self.cell_at(to + s)) { 1 + (roll >> 5) % 3 } else { 0 };
                    self.swap(at, to, falls, (x, y), (x + along, y + down));
                    return;
                }
            }
        } else if p.slide > 0 {
            // Down a slope. The cell beside it must be open too, so nothing squeezes between two
            // corners: a wall of cells touching only at their corners holds.
            let slide = p.slide as usize;
            // past another grain only now and then, so that what comes down into a hollow comes from
            // above and from both sides by chance, and no line of gaps is drawn through the sand
            let squeeze = (roll >> 12) & 1 == 0;
            let left = self.slides(at, -1, slide, p.density, squeeze);
            let right = self.slides(at, 1, slide, p.density, squeeze);
            if !(left || right || squeeze) && (self.slides(at, -1, slide, p.density, true) || self.slides(at, 1, slide, p.density, true)) {
                // it could have, and by chance did not: it is reached again
                self.stay(x, y);
            }
            if left || right {
                let side = if left && right { if roll & 1 == 0 { -1 } else { 1 } } else if left { -1 } else { 1 };
                self.slide_down(at, (x, y), side, speed, slide, p);
                return;
            }
        }
        if p.roll != 0 && self.roll_off(at, (x, y), speed, roll, p) {
            return;
        }
        if speed != 0 {
            // It has landed. A grain landing on a step with the slope going on below the far side
            // of it rolls on by chance, so a heap rests at a gentler angle than a grain at rest
            // could hold.
            if p.roll != 0 && (roll >> 16) & 255 < p.roll as u32 {
                let open = |k: isize| self.sinks_into(p.density, self.cell_at(at.wrapping_add_signed(k)));
                let s = s as isize;
                let step = |side: isize| open(side) && open(2 * side) && open(2 * side + s) && !open(side + s);
                let (left, right) = (step(-1), step(1));
                if left || right {
                    let side = if left && right { if (roll >> 3) & 1 == 0 { -1 } else { 1 } } else if left { -1 } else { 1 };
                    // it keeps its speed, so where it next stops it may roll again
                    self.swap(at, at.wrapping_add_signed(side), 1, (x, y), (x + side as i32, y));
                    return;
                }
            }
            // A liquid that lands fast splashes: a quarter of its cells bounce up a cell or two and to
            // a side, and fall back. (Half of them, as high as they were fast, stood up from a pool
            // in the rain as a fringe of spikes.)
            if p.kind == Kind::Liquid && speed >= SPLASH_FROM {
                let up = 1 + (roll >> 22) as usize % 2;
                let side = ((roll >> 25) % 5) as isize - 2;
                if y as usize >= up {
                    let to = (at - up * s).wrapping_add_signed(side);
                    if material(self.cell_at(to)) == EMPTY && material(self.cell_at(at - s)) == EMPTY {
                        self.swap(at, to, 0, (x, y), (x + side as i32, y - up as i32));
                        return;
                    }
                }
            }
            self.cells[at] = with_state(cell, clock_of(cell), 0);
            self.touch(x, y, x, y);
        }
    }

    /// A grain of powder slides down to `side`. One already moving goes on down the slope as far
    /// as its speed and the slope allow, gathering speed as a falling grain does, so that the sides
    /// of a heap carry away what lands on it and a collapsing face runs out. It keeps that speed,
    /// so where it stops it has landed and may roll on. Kept out of `fall`, so the path of a
    /// falling grain stays short.
    #[inline(never)]
    fn slide_down(&mut self, at: usize, (x, y): (i32, i32), side: isize, speed: u32, slide: usize, p: Props) {
        let s = self.stride;
        // a grain that slides freely leaves its place by a few cells at once, clear of the face it
        // came off, so that the grain behind it can go the next step and a pillar's sides come away
        // a layer a step
        let reach = if p.slide != 1 { if speed == 0 { 1 } else { (speed + 1).min(p.fall as u32).min(SLIDE_MOST) } } else if speed == 0 { SLIDE_CLEAR } else { SLIDE_FAR };
        let (mut to, mut gone) = ((at + s).wrapping_add_signed(side), 1);
        // not on past the edge of an open world, where it is gone
        // on down the slope while there is slope under it: where the ground falls away it stops
        // sliding and falls (a grain off the top of a sheer pile was carried out through the air as
        // far as it could slide)
        while gone < reach && material(self.cell_at(to)) != VOID && (gone < SLIDE_CLEAR || !self.sinks_into(p.density, self.cell_at(to + s))) && self.slides(to, side, slide, p.density, false) {
            to = (to + s).wrapping_add_signed(side);
            gone += 1;
        }
        self.swap(at, to, (speed + 1).min(p.fall as u32 - 1).min(SLIDE_MOST - 1), (x, y), (x + side as i32 * gone as i32, y + gone as i32));
    }

    /// Sand rolls one cell along a slope steeper than it holds, at rest or not: one where the
    /// ground `ROLL_ALONG` cells along is as many or more cells lower. A slope of three in four,
    /// about 37 degrees, holds; one of 45 does not, so a heap built quickly at 45 degrees settles
    /// to sand's own angle. The margins a change wakes reach as far as this looks. Gives whether
    /// it rolled.
    #[inline(never)]
    fn roll_off(&mut self, at: usize, (x, y): (i32, i32), speed: u32, roll: u32, p: Props) -> bool {
        const ROLL: isize = ROLL_ALONG as isize;
        let s = self.stride as isize;
        let rolls = |side: isize| {
            let along = |n: isize, down: isize| self.sinks_into(p.density, self.cell_at(at.wrapping_add_signed(side * n + down * s)));
            (1..ROLL).all(|n| along(n, 0)) && (0..ROLL).all(|down| along(ROLL, down))
        };
        let (left, right) = (rolls(-1), rolls(1));
        if !(left || right) {
            return false;
        }
        let side = if left && right { if (roll >> 5) & 1 == 0 { -1 } else { 1 } } else if left { -1 } else { 1 };
        self.swap(at, at.wrapping_add_signed(side), speed.max(1), (x, y), (x + side as i32, y));
        true
    }

    /// Whether a slow liquid moves this step, by its `pace`. One that does not is reached again
    /// next step, since it could have.
    #[inline(always)]
    fn paced(&mut self, roll: u32, x: i32, y: i32, p: Props) -> bool {
        if p.pace == 0 || (roll >> 8) & 255 < p.pace as u32 {
            return true;
        }
        self.stay(x, y);
        false
    }

    /// The rule for fire: up, or up and to a side by chance, so a flame wavers as it rises, one to
    /// `fall` cells in a step, by chance, so a body of flames is drawn out into tongues; to a side now
    /// and then when it cannot rise. A hot flame now and then leaps clear as a spark, a few cells up
    /// and to a side. It is always reached again next step: it is cooling.
    #[inline(always)]
    fn flicker(&mut self, at: usize, x: i32, y: i32, cell: u32, p: Props) {
        let s = self.stride;
        let roll = chance(self.seed ^ 0xf1a3e, self.steps, at);
        if temperature(cell) >= SPARK_FROM && (roll >> 8).is_multiple_of(SPARK_ONE_IN) {
            let up = 3 + (roll >> 16) as usize % 5;
            let side = ((roll >> 20) % 7) as isize - 3;
            if y as usize >= up {
                let to = (at - up * s).wrapping_add_signed(side);
                if material(self.cell_at(to)) == EMPTY {
                    self.swap(at, to, 0, (x, y), (x + side as i32, y - up as i32));
                    return;
                }
            }
        }
        let up = |side: isize| {
            let to = (at - s).wrapping_add_signed(side);
            // not between two cells that touch only at their corners
            self.rises_into(p.density, self.cell_at(to)) && (side == 0 || self.rises_into(p.density, self.cell_at(at.wrapping_add_signed(side))))
        };
        // a flame leans with the wind: as often as the wind is strong it goes up to that side
        let (right, _) = self.wind(x, y);
        let side: isize = match roll & 7 {
            _ if right != 0 && (((roll >> 24) & 127) as i32) * BLOWN < right.abs() * 127 => right.signum() as isize,
            0 => -1,
            7 => 1,
            _ => 0,
        };
        let goes = if up(side) {
            Some(side)
        } else if side != 0 && up(0) {
            Some(0)
        } else {
            None
        };
        if let Some(side) = goes {
            // on up through open air, as far as this step's chance takes it
            let reach = 1 + (roll >> 12) as usize % p.fall as usize;
            let (mut to, mut risen) = ((at - s).wrapping_add_signed(side), 1);
            while risen < reach && material(self.cell_at(to - s)) == EMPTY {
                to -= s;
                risen += 1;
            }
            self.swap(at, to, 0, (x, y), (x + side as i32, y - risen as i32));
            return;
        }
        let side: isize = if (roll >> 3) & 1 == 0 { -1 } else { 1 };
        if (roll >> 4) & 3 == 0 && self.rises_into(p.density, self.cell_at(at.wrapping_add_signed(side))) {
            self.swap(at, at.wrapping_add_signed(side), 0, (x, y), (x + side as i32, y));
            return;
        }
        self.stay(x, y);
    }

    /// Carries a cell that is in the air with the wind: aside as many cells as the wind is strong and
    /// the cell light, the part of a cell left over by chance, through open air only, and falling a
    /// cell as it goes; and where the wind rises and the cell is as light as snow, up a cell, by chance
    /// as often as the wind is strong. Gives whether it was moved.
    #[inline(never)]
    fn blown(&mut self, at: usize, (x, y): (i32, i32), cell: u32, p: Props, (right, down): (i32, i32)) -> bool {
        let s = self.stride;
        let roll = chance(self.seed ^ 0xb10e, self.steps, at);
        let light = 255 - p.density as i32;
        if down < 0 && p.density < LIGHT_POWDER && ((roll >> 16) & 127) as i32 * BLOWN < -down * 127 && material(self.cell_at(at - s)) == EMPTY {
            self.swap(at, at - s, 1, (x, y), (x, y - 1));
            return true;
        }
        // in 256ths of a cell: four cells for the lightest in the strongest wind
        let far = right.abs() * light * 4 * 256 / (BLOWN * 255);
        let cells = (far >> 8) + (((roll & 255) as i32) < (far & 255)) as i32;
        let side: isize = if right > 0 { 1 } else { -1 };
        let (mut to, mut gone) = (at, 0);
        while gone < cells && material(self.cell_at(to.wrapping_add_signed(side))) == EMPTY {
            to = to.wrapping_add_signed(side);
            gone += 1;
        }
        if gone == 0 {
            return false;
        }
        // and down a cell from there if it can, so that it still falls as it is carried
        let (to, fell) = if material(self.cell_at(to + s)) == EMPTY { (to + s, 1) } else { (to, 0) };
        self.swap(at, to, speed_of(cell).max(1), (x, y), (x + gone * side as i32, y + fell));
        true
    }

    /// The rule for lightning: down through the air, up to `fall` cells in a step, a cell aside now
    /// and then so that it is jagged, leaving a flash of light in each empty cell it leaves; a gas or
    /// a flame in its way changes places with it. While it runs it stays as hot as it was made. Where
    /// it reaches a powder its lines change, it runs on into it a few grains and is spent; anywhere
    /// else it can go no further it stays, cooling, for its lines to do their work on what it has
    /// reached (`REACTIONS`), and is always reached again next step.
    #[inline(never)]
    fn strike(&mut self, at: usize, x: i32, y: i32, cell: u32, p: Props) {
        let s = self.stride;
        let roll = chance(self.seed ^ 0xb017, self.steps, at);
        let through = |c: u32| matches!(props(c).kind, Kind::Empty | Kind::Gas | Kind::Fire) && clock_of(c) != self.clock || material(c) == EMPTY;
        let bolt = with_temperature(with_state(cell, self.clock, 0), MATERIALS[material(cell) as usize].made);
        let (mut here, mut cx, mut gone) = (at, x, 0);
        while gone < p.fall as i32 {
            // two bits of the roll for each cell of the way: one in four goes aside
            let side: isize = match (roll >> ((gone as u32 % 16) * 2)) & 3 {
                0 if gone % 2 == 0 => -1,
                0 => 1,
                _ => 0,
            };
            let straight = self.cell_at(here + s);
            if material(straight) == VOID {
                // out of an open world: it is gone
                self.cells[here] = AIR | self.clock << 24;
                self.touch(x.min(cx) - 2, y, x.max(cx) + 2, y + gone);
                self.warmed(x.min(cx) - 2, y, x.max(cx) + 2, y + gone);
                return;
            }
            let aside = (here + s).wrapping_add_signed(side);
            let to = if side != 0 && through(self.cell_at(aside)) && through(self.cell_at(here.wrapping_add_signed(side))) {
                aside
            } else if through(straight) {
                here + s
            } else {
                break;
            };
            let passed = self.cell_at(to);
            // a flash where it leaves empty air, and in the empty air either side of it, so the bolt
            // is three cells thick; a gas or flame it passes comes back to where it was
            let flash = FLASH as u32 | 255 << 8 | 255 << 16 | self.clock << 24;
            self.cells[here] = if material(passed) == EMPTY { flash } else { with_state(passed, self.clock, 0) };
            for beside in [here - 1, here + 1] {
                if material(self.cell_at(beside)) == EMPTY && beside != to {
                    self.cells[beside] = flash;
                }
            }
            self.cells[to] = bolt;
            if to != here + s {
                cx += side as i32;
            }
            here = to;
            gone += 1;
        }
        // Where it has reached a powder one of its lines changes (sand, which it fuses to glass), it
        // runs on into it and is spent: the next few grains down, straight or a cell aside, are changed
        // as the line says, each counted as the line happening, and the bolt itself is a last flash.
        let under = material(self.cell_at(here + s));
        let (first, last) = LINES[material(cell) as usize];
        let line = (first as usize..last as usize).find(|&k| REACTIONS[k].b == under && REACTIONS[k].b_becomes != SAME);
        if let Some(k) = line.filter(|_| props(self.cell_at(here + s)).kind == Kind::Powder) {
            let made = REACTIONS[k].b_becomes as u32 | (roll >> 8 & 0xff) << 8 | (REACTIONS[k].hot.max(ROOM) as u32) << 16 | self.clock << 24;
            let (mut into, mut deep) = (here + s, 0);
            while deep < 3 + (roll >> 20) % 4 && material(self.cell_at(into)) == under {
                self.cells[into] = made;
                self.fired[k] += 1;
                deep += 1;
                let aside = (into + s).wrapping_add_signed(if (roll >> (deep * 3)) & 7 == 0 { -1 } else if (roll >> (deep * 3)) & 7 == 7 { 1 } else { 0 });
                into = if material(self.cell_at(aside)) == under { aside } else { into + s };
            }
            self.cells[here] = FLASH as u32 | 255 << 8 | 255 << 16 | self.clock << 24;
            self.touch(x.min(cx) - 3, y, x.max(cx) + 3, y + gone + deep as i32);
            self.warmed(x.min(cx) - 3, y, x.max(cx) + 3, y + gone + deep as i32);
            return;
        }
        if gone == 0 {
            self.stay(x, y);
            return;
        }
        self.touch(x.min(cx) - 2, y, x.max(cx) + 2, y + gone);
        self.warmed(x.min(cx) - 2, y, x.max(cx) + 2, y + gone);
    }

    /// Falls: through empty cells, gathering speed, or one cell through a lighter liquid or gas or
    /// out of an open world.
    #[inline(always)]
    fn drop(&mut self, at: usize, x: i32, y: i32, below: u32, speed: u32, p: Props) {
        let s = self.stride;
        if material(below) != EMPTY {
            self.swap(at, at + s, 0, (x, y), (x, y + 1));
            return;
        }
        let reach = (speed + 1).min(p.fall as u32);
        let (mut to, mut fallen) = (at + s, 1);
        while fallen < reach && material(self.cell_at(to + s)) == EMPTY {
            to += s;
            fallen += 1;
        }
        let mut next = (speed + 1).min(p.fall as u32 - 1).min(SPEED_MOST);
        // A liquid that comes down onto something has landed there and then, at rest, so that what
        // it lands on can pass it on at once (`levels`): under a steady pour the top of a pool is
        // always a cell that has just arrived. One in four that land fast keep their speed for a
        // step, and splash.
        let under = self.cell_at(to + s);
        let moving = speed_of(under) != 0 && matches!(props(under).kind, Kind::Powder | Kind::Liquid);
        if p.kind == Kind::Liquid && !moving && !self.sinks_into(p.density, under) && !(next >= SPLASH_FROM && chance(self.seed ^ 0x51a5, self.steps, to) & 3 == 0) {
            next = 0;
        }
        self.swap(at, to, next, (x, y), (x, y + fallen as i32));
    }

    /// A liquid finding its level. A cell that can neither fall nor run, with its own kind lying on
    /// it, looks along its row, through its own kind at rest, for an open place within `PRESS` cells;
    /// where there is one, the cell at the top of what lies on it goes where a drop let go at that
    /// place would be: set down at rest on whatever holds within `fall` cells under the place, or,
    /// with nothing that near, let go into the air a cell under the row, falling at a speed of its
    /// own. So a heap of water sinks from its top and widens at every height at once, as fast as it
    /// is deep, and is flat in a fraction of a second; a face of water over a slope or a drop slumps
    /// and pours as fast as it is high; a bubble of air in a pool is filled from the pool's top. What
    /// goes is always lower than the top it is taken from, so this comes to an end. Gives whether a
    /// cell was moved.
    #[inline(never)]
    fn levels(&mut self, at: usize, (x, y): (i32, i32), roll: u32, p: Props) -> bool {
        let s = self.stride;
        let own = material(self.cell_at(at));
        // First a few looks, at 1, 2, 4 cells and so on: deep in a body they all find its own kind,
        // and that is all it costs there. Where one does not, every cell as far as that one is
        // looked at in turn, so nothing is ever reached through a wall.
        let place = |side: isize| {
            let room = if side < 0 { x + 1 } else { self.width - x } as usize;
            let mut far = 0;
            let mut look = 1;
            while look <= PRESS {
                let reach = look.min(room);
                if material(self.cell_at(at.wrapping_add_signed(side * reach as isize))) != own {
                    far = reach;
                    break;
                }
                if reach == room {
                    break;
                }
                look *= 2;
            }
            (1..=far as isize).map(|k| (k, at.wrapping_add_signed(side * k))).find_map(|(k, to)| {
                let there = self.cell_at(to);
                if material(there) == own {
                    // Not through one that is moving, or has moved this step and not come to rest: it
                    // is not part of the body but falling from it. (Until 26 Nov 2026 the look went on
                    // through it, and a row was pressed out into the air cell after cell in one step.)
                    return if moving(there) { Some(None) } else { None };
                }
                // open to it: air, a gas, a flame, or a lighter liquid or ash, which then comes up to
                // the top in its place, so brine spreads out under water and ash floats
                if !self.sinks_into(p.density, there) {
                    return Some(None);
                }
                if material(there) != EMPTY {
                    let falls = if self.sinks_into(p.density, self.cell_at(to + s)) { 1 } else { 0 };
                    return Some(Some((k, to, 0, falls)));
                }
                // Where a drop let go here would be: on down through the air to what holds it, if that
                // is within `fall` cells, and at rest there; else a cell down, falling. Never in the air
                // level with the row it left, at rest: until 24 Nov 2026 a pool on a shelf pressed its
                // rows out into the air, where they fell as long flat dashes, and from then until 26 Nov
                // a place over any drop was refused but at the foot of a body, so water stood on a ramp
                // as a wedge with an upright face over the air, which crept.
                let mut down = 0;
                while down < p.fall as usize && material(self.cell_at(to + (down + 1) * s)) == EMPTY {
                    down += 1;
                }
                let under = self.cell_at(to + (down + 1) * s);
                let holds = !self.sinks_into(p.density, under) && !(moving(under) && matches!(props(under).kind, Kind::Powder | Kind::Liquid));
                if holds {
                    Some(Some((k, to + down * s, down as i32, 0)))
                } else if down > 0 {
                    Some(Some((k, to + s, 1, 1 + (roll >> 12) % 3)))
                } else if self.sinks_into(p.density, under) {
                    // a lighter liquid under it: it is let go there, and sinks through
                    Some(Some((k, to, 0, 1)))
                } else {
                    // over something falling, not stacked on it
                    Some(None)
                }
            })?
        };
        let (left, right) = (place(-1), place(1));
        let ((far, to, down, falls), side) = match (left, right) {
            (Some(l), Some(r)) if l.0 != r.0 => if l.0 < r.0 { (l, -1) } else { (r, 1) },
            (Some(l), Some(r)) => if (roll >> 2) & 1 == 0 { (l, -1) } else { (r, 1) },
            (Some(l), None) => (l, -1),
            (None, Some(r)) => (r, 1),
            (None, None) => return false,
        };
        if !self.paced(roll, x, y, p) {
            return true;
        }
        let (mut top, mut high) = (at - s, 1);
        while high < HEAD && material(self.cell_at(top - s)) == own {
            top -= s;
            high += 1;
        }
        // one still coming down is left to, and this cell is reached again
        if speed_of(self.cell_at(top)) != 0 {
            self.stay(x, y);
            return true;
        }
        self.swap(top, to, falls, (x, y - high as i32), (x + side * far as i32, y + down));
        self.levelled += 1;
        true
    }

    /// Where a liquid that cannot fall straight runs to on one side in a step, and how far along and
    /// down that is: through the open cell beside it and into the one under that where the ground
    /// falls away, else along the level, up to `spread` cells along. It stops where it could fall
    /// straight down, and falls from there next step. Nothing where it would end no lower than it
    /// began, unless it is `pushed`. Only into air, a gas or a flame along the level, not into a
    /// lighter liquid: two liquids side by side would trade places for ever, and a heavier one gets
    /// under a lighter by falling and sliding. Nor first into a bubble of gas, or a grain of ash, with
    /// liquid over it: that rises through the liquid by itself, and pushed sideways every step by the
    /// water beside it would never come up; ash with nothing over it is pushed aside, so a heap of it
    /// does not dam water. Nothing squeezes between two cells that touch only at their corners.
    #[inline(always)]
    fn runs(&self, at: usize, side: isize, p: Props) -> Option<(usize, i32, i32)> {
        let s = self.stride;
        let first = at.wrapping_add_signed(side);
        if matches!(props(self.cell_at(first)).kind, Kind::Gas | Kind::Powder) && props(self.cell_at(first - s)).kind == Kind::Liquid {
            return None;
        }
        let (mut to, mut along, mut down) = (at, 0, 0);
        while along < p.spread as i32 {
            let beside = to.wrapping_add_signed(side);
            let there = self.cell_at(beside);
            if !self.sinks_into(p.density, there) {
                break;
            }
            if self.sinks_into(p.density, self.cell_at(beside + s)) {
                to = beside + s;
                down += 1;
            } else if props(there).kind != Kind::Liquid && !(material(there) == EMPTY && clock_of(there) == self.clock) {
                // along the level, but not into a place left this step: a row would follow its end
                // out, cell after cell, and the rows of a heap of water slid over one another like a
                // pack of cards
                to = beside;
            } else {
                break;
            }
            along += 1;
            // past the edge of an open world it is gone; over a drop it falls from here
            if material(self.cell_at(to)) == VOID || self.sinks_into(p.density, self.cell_at(to + s)) {
                break;
            }
        }
        if along > 0 && down > 0 { Some((to, along * side as i32, down)) } else { None }
    }

    /// How far a liquid or gas goes to one side: to the nearest cell within `reach` with an open
    /// cell past it (below a liquid, above a gas, `beyond` cells on), or, when `pushed`, to the
    /// farthest it can reach; 0 when it cannot go that way.
    #[inline(always)]
    fn sideways(&self, at: usize, side: isize, reach: isize, pushed: bool, beyond: isize, open: impl Fn(u32) -> bool) -> isize {
        let mut farthest = 0;
        for k in 1..=reach {
            let to = at.wrapping_add_signed(side * k);
            if !open(self.cell_at(to)) {
                break;
            }
            if open(self.cell_at(to.wrapping_add_signed(beyond))) {
                return k;
            }
            farthest = k;
        }
        if pushed { farthest } else { 0 }
    }

    /// Whether a cell can slide down to the side: `depth` cells are open under the cell beside it,
    /// and that cell is open too, or, if it may `squeeze`, is itself a grain or a drop. Past
    /// something that can give way a grain squeezes, so that sand above a hollow comes down from both
    /// sides of it as a funnel and not as a plug with upright sides; between two corners of what
    /// stands (a wall drawn one cell thick on a slant) nothing squeezes.
    #[inline(always)]
    fn slides(&self, at: usize, side: isize, depth: usize, density: u8, squeeze: bool) -> bool {
        let beside = at.wrapping_add_signed(side);
        let there = self.cell_at(beside);
        if !((squeeze && matches!(props(there).kind, Kind::Powder | Kind::Liquid)) || self.sinks_into(density, there)) {
            return false;
        }
        (1..=depth).all(|k| self.sinks_into(density, self.cell_at(beside + k * self.stride)))
    }

    /// The rule for gases: rise, straight or to a side by chance; or spread sideways toward
    /// somewhere higher, or anywhere when pushed from below.
    #[inline(always)]
    fn rise(&mut self, at: usize, x: i32, y: i32, p: Props) {
        let s = self.stride;
        let roll = chance(self.seed, self.steps, at);
        let above = self.cell_at(at - s);
        // A bubble of gas under a liquid rises through it a cell a step. Without this, water beside
        // a bubble spreads sideways into it for ever and it never comes up.
        if props(above).kind == Kind::Liquid && clock_of(above) != self.clock {
            self.swap(at, at - s, 0, (x, y), (x, y - 1));
            return;
        }
        // The wind carries a gas along with it, a cell a step as often as the wind is strong, and a
        // wind that blows down holds it down. It could always have, so it is reached again.
        let (right, down) = self.wind(x, y);
        if right != 0 || down != 0 {
            let blow = chance(self.seed ^ 0xb10e, self.steps, at);
            let side: isize = if right > 0 { 1 } else { -1 };
            if ((blow & 127) as i32) * BLOWN < right.abs() * 127 && self.rises_into(p.density, self.cell_at(at.wrapping_add_signed(side))) {
                self.swap(at, at.wrapping_add_signed(side), 0, (x, y), (x + side as i32, y));
                return;
            }
            if down > 0 && (((blow >> 8) & 127) as i32) * BLOWN < down * 127 {
                if material(self.cell_at(at + s)) == EMPTY {
                    self.swap(at, at + s, 0, (x, y), (x, y + 1));
                } else {
                    self.stay(x, y);
                }
                return;
            }
            self.stay(x, y);
        }
        // A gas that hovers, a cloud, does not rise: now and then it drifts a cell to a side. It could
        // always have, so it is reached again next step.
        if p.drift != 0 {
            let side: isize = if roll & 1 == 0 { -1 } else { 1 };
            if (roll >> 1) & 31 == 0 && self.rises_into(p.density, self.cell_at(at.wrapping_add_signed(side))) {
                self.swap(at, at.wrapping_add_signed(side), 0, (x, y), (x + side as i32, y));
            } else {
                self.stay(x, y);
            }
            return;
        }
        let up = self.rises_into(p.density, above);
        let side_open = |side: isize| self.rises_into(p.density, self.cell_at(at.wrapping_add_signed(side))) && self.rises_into(p.density, self.cell_at((at - s).wrapping_add_signed(side)));
        let (left, right) = (side_open(-1), side_open(1));
        if up || left || right {
            // straight up half the time, when it can; otherwise up to whichever side is open
            let side: isize = if up && (roll & 1 == 0 || !(left || right)) {
                0
            } else if left && right {
                if (roll >> 1) & 1 == 0 { -1 } else { 1 }
            } else if left {
                -1
            } else if right {
                1
            } else {
                0
            };
            if side == 0 {
                let (mut to, mut risen) = (at - s, 1);
                while risen < p.fall as usize && material(self.cell_at(to)) == EMPTY && material(self.cell_at(to - s)) == EMPTY {
                    to -= s;
                    risen += 1;
                }
                self.swap(at, to, 0, (x, y), (x, y - risen as i32));
            } else {
                self.swap(at, (at - s).wrapping_add_signed(side), 0, (x, y), (x + side as i32, y - 1));
            }
            return;
        }
        // sideways, as a liquid does but upside down: pushed when there is gas under it
        let pushed = props(self.cell_at(at + s)).kind == Kind::Gas;
        let higher = |side: isize| self.sideways(at, side, p.spread as isize, pushed, -(s as isize), |c| self.rises_into(p.density, c));
        let (left, right) = (higher(-1), higher(1));
        if left > 0 || right > 0 {
            let side = if left > 0 && right > 0 { if (roll >> 2) & 1 == 0 { -left } else { right } } else if left > 0 { -left } else { right };
            self.swap(at, at.wrapping_add_signed(side), 0, (x, y), (x + side as i32, y));
        }
    }

    /// Paints a line of `of` from (x0, y0) to (x1, y1), `radius` cells either side of it, with no
    /// gaps however long it is. Each cell is filled by a chance of `fill` in 100, so a powder can
    /// be poured rather than laid, at the temperature its material is made at. Painting empty
    /// erases, leaving air at room temperature. Otherwise only empty cells are filled, unless
    /// `replace`.
    #[allow(clippy::too_many_arguments)]
    pub fn paint(&mut self, of: u8, x0: i32, y0: i32, x1: i32, y1: i32, radius: i32, fill: u32, replace: bool) {
        self.pour(of, x0, y0, x1, y1, radius, fill, replace, None);
    }

    /// Paints as `paint` does, with each cell's shade a stripe of `count` stripes whose colors are
    /// numbered from `first`: which stripe by where the cell lies across the line, so a stroke lays
    /// the stripes side by side along it. The first stripe is on the line's upper side, or its left
    /// side when the line goes straight up or down. A line that goes somewhere lays only the cells
    /// it has newly reached, beyond the brush at its start, so that a stroke drawn in many short lines
    /// lays each part of its ribbon once, whole, and it falls as stripes rather than being poured
    /// over again as it falls. A line of one point, a brush held still, is taken as going down, as its
    /// grains do: its stripes are side by side across it, and fall as a curtain.
    #[allow(clippy::too_many_arguments)]
    pub fn paint_striped(&mut self, of: u8, x0: i32, y0: i32, x1: i32, y1: i32, radius: i32, fill: u32, first: u8, count: u8) {
        self.pour(of, x0, y0, x1, y1, radius, fill, false, Some(stripes(first, count)));
    }

    #[allow(clippy::too_many_arguments)]
    fn pour(&mut self, of: u8, x0: i32, y0: i32, x1: i32, y1: i32, radius: i32, fill: u32, replace: bool, striped: Option<(u32, u32)>) {
        self.strokes += 1;
        let radius = radius.clamp(0, 256);
        let left = (x0.min(x1) - radius).max(0);
        let right = (x0.max(x1) + radius).min(self.width - 1);
        let top = (y0.min(y1) - radius).max(0);
        let bottom = (y0.max(y1) + radius).min(self.height - 1);
        if left > right || top > bottom {
            return;
        }
        // a cell is painted when its middle is within the radius and half a cell of the line
        let reach = radius as f32 + 0.5;
        let (dx, dy) = ((x1 - x0) as f32, (y1 - y0) as f32);
        let long = dx * dx + dy * dy;
        // across the line, pointing down, or right when the line is upright or a point
        let (mut nx, mut ny) = if long > 0.0 { (-dy, dx) } else { (1.0, 0.0) };
        if ny < 0.0 || (ny == 0.0 && nx < 0.0) {
            (nx, ny) = (-nx, -ny);
        }
        let norm = root(nx * nx + ny * ny);
        let (nx, ny) = (nx / norm, ny / norm);
        let mut painted = false;
        for y in top..=bottom {
            for x in left..=right {
                let (px, py) = ((x - x0) as f32, (y - y0) as f32);
                let along = if long > 0.0 { ((px * dx + py * dy) / long).clamp(0.0, 1.0) } else { 0.0 };
                let (ox, oy) = (px - along * dx, py - along * dy);
                if ox * ox + oy * oy > reach * reach || (striped.is_some() && long > 0.0 && px * px + py * py <= reach * reach) {
                    continue;
                }
                let at = self.index(x, y);
                let here = self.cell_at(at);
                if of == EMPTY {
                    if material(here) != EMPTY {
                        self.cells[at] = AIR;
                        painted = true;
                    }
                    continue;
                }
                let roll = chance(self.seed ^ 0x5eed, self.strokes, at);
                // fire lights what it is laid on: half of what could burn under the brush at each stroke
                if of == FIRE && material(here) != EMPTY && material(here) != FIRE {
                    if roll & 1 == 0 && self.light(at, x, y) {
                        painted = true;
                    }
                    continue;
                }
                if (material(here) != EMPTY && !replace) || material(here) == of {
                    continue;
                }
                if roll % 100 >= fill {
                    continue;
                }
                let shade = match striped {
                    Some((first, count)) => {
                        // which stripe by where it lies across the line, its edge moved a little by
                        // chance so the stripes meet grainily, as poured sand's do; now and then a
                        // grain near an edge has strayed across it
                        let wide = 2.0 * reach / count as f32;
                        let jitter = (wide * 0.25).min(0.6) * (((roll >> 16) & 255) as f32 / 128.0 - 1.0);
                        let across = ((px * nx + py * ny + reach + jitter) / wide).max(0.0);
                        let (mut stripe, into) = (across as i32, across - (across as i32) as f32);
                        if roll >> 24 < STRAY {
                            stripe += if into < 0.3 { -1 } else if into > 0.7 { 1 } else { 0 };
                        }
                        stripe_shade(first, stripe.clamp(0, count as i32 - 1) as u32, roll)
                    }
                    None => (roll >> 8) & 0xff,
                };
                // What falls leaves the brush already falling, each grain at a speed of its own, so a
                // pour comes down as a ragged stream and not as a block that keeps the brush's shape.
                // A stripe's grains all leave at one speed, so the ribbon falls whole.
                let speed = match MATERIALS[of as usize].kind {
                    Kind::Powder | Kind::Liquid if striped.is_some() => 3,
                    Kind::Powder | Kind::Liquid => 3 + (roll >> 20) % 3,
                    _ => 0,
                };
                self.cells[at] = of as u32 | shade << 8 | (MATERIALS[of as usize].made as u32) << 16 | speed << 28;
                painted = true;
            }
        }
        if painted {
            self.touch(left, top, right, bottom);
            self.warmed(left, top, right, bottom);
        }
    }

    /// Lays a block of `of`, `wide` by `high` cells with its top left at (x, y), in `count` stripes
    /// whose colors are numbered from `first`, top to bottom: a whole flag, laid as sand is layered
    /// in a jar. Each edge between two stripes wanders smoothly along the flag, by up to a quarter of
    /// a stripe and never more than two rows, so a stripe is a little thicker in one place than
    /// another; each grain's edge is moved a little more by chance, so the stripes meet grainily;
    /// and now and then a grain near an edge has strayed across it. Every stripe stays in its order.
    /// All of it comes from the world's seed and the press, so the same press lays the same flag.
    /// Only empty cells are filled, every one of them.
    #[allow(clippy::too_many_arguments)]
    pub fn flag(&mut self, of: u8, x: i32, y: i32, wide: i32, high: i32, first: u8, count: u8) {
        self.strokes += 1;
        let (first, count) = stripes(first, count);
        let (wide, high) = (wide.clamp(1, 4096), high.clamp(1, 4096));
        let (left, right) = (x.max(0), (x + wide - 1).min(self.width - 1));
        let (top, bottom) = (y.max(0), (y + high - 1).min(self.height - 1));
        if of == EMPTY || left > right || top > bottom {
            return;
        }
        // heights in 256ths of a row: a stripe's, how far an edge wanders, how far a grain's edge is
        // moved; each a quarter of a stripe at most, so no two edges ever meet
        let band = high as i64 * 256 / count as i64;
        let (wander, jitter) = ((band / 4).min(2 * 256), (band / 4).min(160));
        let mut edges = [0i64; STRIPES as usize];
        let mut painted = false;
        for column in left..=right {
            for (k, edge) in edges.iter_mut().enumerate().take(count as usize).skip(1) {
                *edge = k as i64 * high as i64 * 256 / count as i64 + wander * wandering(self.seed, self.strokes, k, column - x) / 256;
            }
            for row in top..=bottom {
                let at = self.index(column, row);
                if material(self.cell_at(at)) != EMPTY {
                    continue;
                }
                let roll = chance(self.seed ^ 0xf1a6, self.strokes, at);
                let middle = (row - y) as i64 * 256 + 128 + (((roll >> 16) & 255) as i64 - 128) * jitter / 128;
                let mut stripe = edges[1..count as usize].iter().filter(|&&edge| edge <= middle).count();
                if roll >> 24 < STRAY {
                    // the nearest edge, if it is within two rows: the grain is of the stripe across it
                    let near = (1..count as usize).min_by_key(|&k| (edges[k] - middle).abs());
                    if let Some(k) = near.filter(|&k| (edges[k] - middle).abs() < (2 * 256).min(band)) {
                        stripe = if middle >= edges[k] { k - 1 } else { k };
                    }
                }
                self.cells[at] = of as u32 | stripe_shade(first, stripe as u32, roll) << 8 | (MATERIALS[of as usize].made as u32) << 16;
                painted = true;
            }
        }
        if painted {
            self.touch(left, top, right, bottom);
            self.warmed(left, top, right, bottom);
        }
    }

    /// The wind at the cell (x, y): how hard it blows to the right and downward.
    #[inline(always)]
    pub(crate) fn wind(&self, x: i32, y: i32) -> (i32, i32) {
        let [right, down] = self.winds[((y / GUST) * self.gusts + x / GUST) as usize];
        (right as i32, down as i32)
    }

    /// Paints wind along the line from (x0, y0) to (x1, y1), `radius` cells either side: every block
    /// of the field that the stroke reaches blows the way the stroke went, as hard as wind blows. A
    /// stroke that goes nowhere stills the blocks under it. What the wind could now move is woken.
    pub fn blow(&mut self, x0: i32, y0: i32, x1: i32, y1: i32, radius: i32) {
        let (dx, dy) = ((x1 - x0) as f32, (y1 - y0) as f32);
        let long = root(dx * dx + dy * dy);
        let still = x0 == x1 && y0 == y1;
        let blown = if still { [0, 0] } else { [(dx / long * BLOWN as f32) as i8, (dy / long * BLOWN as f32) as i8] };
        let reach = radius.clamp(0, 256) + GUST / 2;
        let (left, right) = ((x0.min(x1) - reach).max(0), (x0.max(x1) + reach).min(self.width - 1));
        let (top, bottom) = ((y0.min(y1) - reach).max(0), (y0.max(y1) + reach).min(self.height - 1));
        if left > right || top > bottom {
            return;
        }
        for by in top / GUST..=bottom / GUST {
            for bx in left / GUST..=right / GUST {
                // by the block's middle, how far it lies from the stroke
                let (px, py) = ((bx * GUST + GUST / 2 - x0) as f32, (by * GUST + GUST / 2 - y0) as f32);
                let along = if still { 0.0 } else { ((px * dx + py * dy) / (long * long)).clamp(0.0, 1.0) };
                let (ox, oy) = (px - along * dx, py - along * dy);
                if ox * ox + oy * oy <= (reach * reach) as f32 {
                    self.winds[(by * self.gusts + bx) as usize] = blown;
                }
            }
        }
        self.touch(left, top, right, bottom);
    }

    /// Stills every wind.
    pub fn still(&mut self) {
        self.winds.fill([0; 2]);
    }

    /// How many blocks of the field have a wind in them.
    pub fn windy(&self) -> usize {
        self.winds.iter().filter(|wind| **wind != [0, 0]).count()
    }

    /// Turns the world a quarter, so that what was its left side is its floor: the cell at (x, y) is
    /// at (y, width - 1 - x) of a world as wide as this was high. Everything is at rest and awake
    /// afterward, with its heat and shade. The page draws the world turned back the other way, so that
    /// what is seen stays where it was and falls another way: this is how gravity is turned, the
    /// rules themselves knowing only down.
    pub fn turn(&mut self) {
        let (wide, high) = (self.width, self.height);
        let mut next = World::new(high, wide, self.seed);
        for y in 0..high {
            for x in 0..wide {
                let to = next.index(y, wide - 1 - x);
                next.cells[to] = self.cell_at(self.index(x, y)) & 0x00ff_ffff;
            }
        }
        // each block's wind is that of the block its middle came from, turned as the world is: what
        // blew to the right blows up the new world, and what blew down blows to its right
        for by in 0..(wide + GUST - 1) / GUST {
            for bx in 0..next.gusts {
                let (cx, cy) = ((bx * GUST + GUST / 2).min(high - 1), (by * GUST + GUST / 2).min(wide - 1));
                let (right, down) = self.wind(wide - 1 - cy, cx);
                next.winds[(by * next.gusts + bx) as usize] = [down as i8, -right as i8];
            }
        }
        next.levelled = self.levelled;
        next.levelling = self.levelling;
        next.steps = self.steps;
        next.strokes = self.strokes + 1;
        next.sleeping = self.sleeping;
        next.order = self.order;
        next.fired = core::mem::take(&mut self.fired);
        next.set_edges(self.edges);
        next.touch(0, 0, high - 1, wide - 1);
        next.warmed(0, 0, high - 1, wide - 1);
        *self = next;
    }

    /// Shakes the world once: every grain of powder and cell of liquid with open air over it is
    /// thrown up by chance, one time in two, as many as `by` cells and no farther than the air reaches,
    /// and now and then a cell aside as well, to fall back as the step lets it. Called for a few steps
    /// running, it is a tremor: heaps slump to a gentler slope and a lake slops.
    pub fn shake(&mut self, by: u32) {
        self.strokes += 1;
        let s = self.stride;
        // from the top down, so a cell thrown up is not reached again
        for y in 1..self.height {
            for x in 0..self.width {
                let at = self.index(x, y);
                let cell = self.cell_at(at);
                if !matches!(props(cell).kind, Kind::Powder | Kind::Liquid) || material(self.cell_at(at - s)) != EMPTY {
                    continue;
                }
                let roll = chance(self.seed ^ 0x5ba4e, self.strokes, at);
                if roll & 1 == 0 {
                    continue;
                }
                let (mut to, mut up) = (at - s, 1);
                while up < 1 + (roll >> 1) % by.max(1) && (up as i32) < y && material(self.cell_at(to - s)) == EMPTY {
                    to -= s;
                    up += 1;
                }
                let side: isize = match (roll >> 8) & 7 {
                    0 => -1,
                    7 => 1,
                    _ => 0,
                };
                let aside = to.wrapping_add_signed(side);
                let (to, tx) = if side != 0 && material(self.cell_at(aside)) == EMPTY { (aside, x + side as i32) } else { (to, x) };
                self.cells[to] = with_state(cell, 0, 0);
                self.cells[at] = AIR;
                self.touch(x.min(tx), y - up as i32, x.max(tx), y);
                if temperature(cell) != ROOM || restless(cell) {
                    self.warmed(x.min(tx), y - up as i32, x.max(tx), y);
                }
            }
        }
    }

    /// Fills the space the cell at (x, y) lies in: with `of`, every empty cell joined to it by its
    /// sides, each laid at rest as the brush lays a solid; or, when `of` is empty, erases the body of
    /// one material the cell belongs to. Gives how many cells it changed: none when the cell is not
    /// one to fill (it holds something, or for erasing nothing), or when the space is more than `most`
    /// cells, which is a space that is not closed; nothing is changed then.
    pub fn flood(&mut self, of: u8, x: i32, y: i32, most: usize) -> usize {
        if x < 0 || y < 0 || x >= self.width || y >= self.height {
            return 0;
        }
        let start = self.index(x, y);
        let target = material(self.cell_at(start));
        if (of == EMPTY) == (target == EMPTY) {
            return 0;
        }
        self.strokes += 1;
        // each cell reached is marked as it is found, by a number no material has, and kept as it was
        const FOUND: u32 = 255;
        let mut was: Vec<(u32, u32)> = Vec::new();
        let mut stack = vec![start as u32];
        let s = self.stride;
        while let Some(at) = stack.pop() {
            let at = at as usize;
            if material(self.cell_at(at)) != target || was.len() > most {
                continue;
            }
            was.push((at as u32, self.cell_at(at)));
            self.cells[at] = FOUND;
            stack.extend([at - 1, at + 1, at - s, at + s].map(|next| next as u32));
        }
        if was.len() > most {
            for &(at, cell) in &was {
                self.cells[at as usize] = cell;
            }
            return 0;
        }
        let (mut left, mut top, mut right, mut bottom) = (i32::MAX, i32::MAX, i32::MIN, i32::MIN);
        for &(at, _) in &was {
            let at = at as usize;
            let roll = chance(self.seed ^ 0xf100d, self.strokes, at);
            self.cells[at] = if of == EMPTY { AIR } else { of as u32 | ((roll >> 8) & 0xff) << 8 | (MATERIALS[of as usize].made as u32) << 16 };
            let (cx, cy) = ((at % s) as i32 - BORDER as i32, (at / s) as i32 - BORDER as i32);
            (left, top, right, bottom) = (left.min(cx), top.min(cy), right.max(cx), bottom.max(cy));
        }
        self.touch(left, top, right, bottom);
        self.warmed(left, top, right, bottom);
        was.len()
    }

    /// The page has written cells into the grid itself: a world opened from a link or a file, or
    /// one put back after it was cleared. Every cell is made one the step can work: a number with
    /// no material, or an edge, becomes air, and each cell's clock and speed go back to nothing.
    /// With `fresh`, each is also made as the brush makes it, at the temperature of its material,
    /// with a shade by chance (a stripe keeps its color). Then the whole world is woken and drawn.
    pub fn rewritten(&mut self, fresh: bool) {
        self.strokes += 1;
        for y in 0..self.height {
            for x in 0..self.width {
                let at = self.index(x, y);
                let cell = self.cell_at(at) & 0x00ff_ffff;
                let m = material(cell);
                let real = (m as usize) < MATERIALS.len() && m != WALL && m != VOID;
                self.cells[at] = if !real || (m == EMPTY && fresh) {
                    AIR
                } else if fresh {
                    let roll = chance(self.seed ^ 0x10ad, self.strokes, at);
                    let shade = match MATERIALS[m as usize].glow {
                        3 => (cell >> 8 & 0xfc) | (roll & 3),
                        _ => (roll >> 8) & 0xff,
                    };
                    m as u32 | shade << 8 | (MATERIALS[m as usize].made as u32) << 16
                } else {
                    cell
                };
            }
        }
        for chunk in self.chunks.iter_mut() {
            *chunk = Chunk::ASLEEP;
        }
        self.touch(0, 0, self.width - 1, self.height - 1);
        self.warmed(0, 0, self.width - 1, self.height - 1);
        self.changed = (0, self.height - 1);
        self.bands.fill((0, self.width - 1));
    }

    /// Empties the world.
    pub fn clear(&mut self) {
        for y in 0..self.height {
            let start = self.index(0, y);
            self.cells[start..start + self.width as usize].fill(AIR);
        }
        for chunk in self.chunks.iter_mut() {
            *chunk = Chunk::ASLEEP;
        }
        self.changed = (0, self.height - 1);
        self.bands.fill((0, self.width - 1));
    }
}

/// The first color and the number of stripes, kept to the colors there are and at least one stripe.
fn stripes(first: u8, count: u8) -> (u32, u32) {
    let first = (first as u32).min(STRIPES as u32 - 1);
    (first, (count as u32).clamp(1, STRIPES as u32 - first))
}

/// The square root of a number of at least 1, by Newton's method: the browser's build has no
/// standard library to ask, and sums, products and divisions round the same on every machine.
fn root(of: f32) -> f32 {
    let mut guess = of.max(1.0);
    for _ in 0..24 {
        guess = 0.5 * (guess + of / guess);
    }
    guess
}

/// How likely a grain laid in stripes near an edge is to have strayed across it, in 256ths.
const STRAY: u32 = 9;

/// How far edge `edge` of the flag laid by stroke `stroke` wanders up or down at `column` of it,
/// from -256 to 255: a smooth curve through a height chosen by chance every `ALONG` columns.
fn wandering(seed: u64, stroke: u64, edge: usize, column: i32) -> i64 {
    const ALONG: i32 = 12;
    let height = |knot: i32| (chance(seed ^ 0xed6e, stroke, edge << 16 | (knot as usize & 0xffff)) >> 23) as i64 - 256;
    let (knot, into) = (column.div_euclid(ALONG), column.rem_euclid(ALONG) as i64);
    let (a, b) = (height(knot), height(knot + 1));
    // eased from one height to the next, so the edge has no corners
    let t = into * 256 / ALONG as i64;
    let eased = t * t * (3 * 256 - 2 * t) / (256 * 256);
    a + (b - a) * eased / 256
}

/// The shade of a cell of stripe `stripe` of stripes whose colors begin at `first`, with a slight
/// shade of its own from `roll`.
fn stripe_shade(first: u32, stripe: u32, roll: u32) -> u32 {
    ((first + stripe) * STRIPE as u32) | ((roll >> 8) & (STRIPE as u32 - 1))
}

/// Whether the four cells from `at` are all empty, so they can be passed over at once. Only the
/// material byte counts: an empty cell may still carry the clock of the step it was left in.
#[inline(always)]
fn four_empty(cells: &[u32], at: usize) -> bool {
    #[cfg(all(target_arch = "wasm32", target_feature = "simd128", not(feature = "scalar")))]
    {
        use core::arch::wasm32::{u32x4_splat, v128, v128_and, v128_any_true, v128_load};
        let four = &cells[at..at + 4];
        // a read of sixteen bytes that need not be aligned, from four cells checked to be there
        !v128_any_true(v128_and(unsafe { v128_load(four.as_ptr() as *const v128) }, u32x4_splat(0xff)))
    }
    #[cfg(all(target_arch = "x86_64", not(feature = "scalar")))]
    {
        use core::arch::x86_64::{__m128i, _mm_and_si128, _mm_cmpeq_epi32, _mm_loadu_si128, _mm_movemask_epi8, _mm_set1_epi32, _mm_setzero_si128};
        let four = &cells[at..at + 4];
        unsafe { _mm_movemask_epi8(_mm_cmpeq_epi32(_mm_and_si128(_mm_loadu_si128(four.as_ptr() as *const __m128i), _mm_set1_epi32(0xff)), _mm_setzero_si128())) == 0xffff }
    }
    #[cfg(not(any(all(target_arch = "wasm32", target_feature = "simd128", not(feature = "scalar")), all(target_arch = "x86_64", not(feature = "scalar")))))]
    {
        (cells[at] | cells[at + 1] | cells[at + 2] | cells[at + 3]) & 0xff == 0
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::materials::{PRIDE, SAND, STONE, WATER};

    #[test]
    fn a_new_world_is_empty_and_walled() {
        let world = World::new(100, 70, 1);
        assert_eq!(world.count(EMPTY), 7000);
        assert_eq!(material(world.get(-1, 0)), WALL);
        assert_eq!(material(world.get(100, 69)), WALL);
        assert_eq!(world.chunks.len(), 4);
    }

    #[test]
    fn four_empty_cells_are_seen_as_empty_and_one_grain_is_not() {
        let mut cells = vec![0u32; 8];
        cells[1] = 5 << 24;
        assert!(four_empty(&cells, 0), "an empty cell with a clock is empty");
        cells[2] = SAND as u32;
        assert!(!four_empty(&cells, 0) && !four_empty(&cells, 1) && four_empty(&cells, 3));
    }

    #[test]
    fn a_grain_falls_faster_the_longer_it_falls() {
        let mut world = World::new(16, 120, 3);
        world.paint(SAND, 8, 0, 8, 0, 0, 100, false);
        let (mut at, mut fallen) = (0, vec![]);
        for _ in 0..11 {
            world.step();
            let now = (0..120).find(|&y| world.at(8, y) == SAND).unwrap();
            fallen.push(now - at);
            at = now;
        }
        // it leaves the brush at four to six cells a step, gathers a cell a step, and tops out at ten
        assert!((4..=6).contains(&fallen[0]), "{fallen:?}");
        assert!(fallen.windows(2).all(|pair| pair[1] == (pair[0] + 1).min(10)), "{fallen:?}");
        assert_eq!(fallen[10], 10);
    }

    #[test]
    fn a_line_has_no_gaps_however_fast_it_is_drawn() {
        let mut world = World::new(200, 100, 1);
        world.paint(STONE, 3, 90, 190, 7, 0, 100, false);
        // every column it crosses has stone, and each stone cell touches the next by a side or a corner
        for x in 3..=190 {
            assert!((0..100).any(|y| world.at(x, y) == STONE), "column {x}");
        }
    }

    #[test]
    fn a_brush_fills_only_empty_cells_unless_told_to_replace() {
        let mut world = World::new(40, 40, 1);
        world.paint(STONE, 20, 20, 20, 20, 3, 100, false);
        let stone = world.count(STONE);
        assert_eq!(stone, 37, "a disc of radius 3");
        world.paint(WATER, 20, 20, 20, 20, 5, 100, false);
        assert_eq!(world.count(STONE), stone);
        world.paint(WATER, 20, 20, 20, 20, 5, 100, true);
        assert_eq!(world.count(STONE), 0);
        world.paint(EMPTY, 0, 0, 39, 39, 60, 100, false);
        assert_eq!(world.count(EMPTY), 1600);
    }

    #[test]
    fn only_the_bands_of_rows_that_changed_are_marked_for_the_page() {
        let mut world = World::new(200, 400, 1);
        assert!((0..7).all(|band| world.band_changed(band)), "a new world is all to be drawn");
        world.forget_changed();
        assert!((0..7).all(|band| !world.band_changed(band)));
        // stone laid near the top and near the bottom: two bands, not the rows between
        world.paint(STONE, 50, 10, 60, 10, 1, 100, false);
        world.paint(STONE, 50, 390, 60, 390, 1, 100, false);
        let marked: Vec<usize> = (0..7).filter(|&band| world.band_changed(band)).collect();
        assert_eq!(marked, vec![0, 6]);
        // and in each, only the columns that changed, not the whole width
        let (x0, x1) = world.band_columns(0);
        assert!((45..=50).contains(&x0) && (60..=65).contains(&x1), "{x0} to {x1}");
        assert_eq!(world.band_columns(3), (i32::MAX, i32::MIN));
        assert_eq!(world.changed(), (9, 391));
        assert!(!world.band_changed(7), "past the last band nothing is");
        // a grain falling marks the bands it passes through
        world.forget_changed();
        world.paint(SAND, 100, 60, 100, 60, 0, 100, false);
        for _ in 0..6 {
            world.step();
        }
        assert!(world.band_changed(0) && world.band_changed(1) && !world.band_changed(3));
    }

    #[test]
    fn wind_carries_what_is_in_the_air_the_lighter_the_farther_and_is_stilled() {
        use crate::materials::{SMOKE, SNOW};
        // the column a grain let go at column 100 has reached when it has fallen 100 cells
        let landed = |of: u8, windy: bool| {
            let mut world = World::new(400, 200, 9);
            if windy {
                world.blow(40, 100, 360, 100, 120);
            }
            world.paint(of, 100, 30, 100, 30, 0, 100, false);
            for _ in 0..400 {
                world.step();
                let at = (0..400).flat_map(|x| (0..200).map(move |y| (x, y))).find(|&(x, y)| world.at(x, y) == of);
                if let Some((x, _)) = at.filter(|&(_, y)| y >= 130) {
                    return x;
                }
            }
            panic!("it never fell 100 cells");
        };
        assert_eq!(landed(SAND, false), 100);
        let (sand, snow) = (landed(SAND, true), landed(SNOW, true));
        assert!(sand > 110 && snow > sand + 60, "sand is carried a little and snow far: sand to {sand}, snow to {snow}");
        // smoke goes with it
        let mut world = World::new(400, 200, 9);
        world.blow(40, 100, 360, 100, 120);
        assert_eq!(world.windy(), 25 * 13);
        world.paint(SMOKE, 100, 150, 100, 150, 2, 100, false);
        for _ in 0..40 {
            world.step();
        }
        let smoke: Vec<i32> = (0..400).filter(|&x| (0..200).any(|y| world.at(x, y) == SMOKE)).collect();
        assert!(smoke.iter().all(|&x| x > 105), "smoke is blown along: columns {:?} to {:?}", smoke.first(), smoke.last());
        // a stroke that goes nowhere stills the blocks under it, and the word stills them all
        world.blow(200, 100, 200, 100, 20);
        assert!(world.windy() < 25 * 13 && world.wind(200, 100) == (0, 0) && world.wind(60, 100).0 == BLOWN);
        world.still();
        assert_eq!(world.windy(), 0);
        // turned with the world, a wind to the right blows up the turned world, which is seen as to the right still
        world.blow(40, 100, 360, 100, 120);
        world.turn();
        assert_eq!(world.wind(100, 200), (0, -BLOWN));
    }

    #[test]
    fn a_turn_puts_the_left_side_down_keeps_every_cell_and_four_turns_bring_the_world_back() {
        let mut world = World::new(90, 50, 6);
        // stone along the left side, a cell of water by the top right corner, sand on the floor
        world.paint(STONE, 0, 0, 0, 49, 0, 100, false);
        world.paint(SAND, 10, 49, 80, 49, 0, 100, false);
        let water = world.index(88, 1);
        world.cells[water] = WATER as u32 | 77 << 8 | 60 << 16;
        let before = world.cells.clone();
        let (stone, sand) = (world.count(STONE), world.count(SAND));
        world.turn();
        assert_eq!((world.width, world.height), (50, 90));
        // the left side is the floor, the floor the right side, and the water is by the top left
        assert!((0..50).all(|x| world.at(x, 89) == STONE));
        assert!((10..=80).all(|y| world.at(49, 89 - y) == SAND));
        assert_eq!((world.at(1, 1), world.get(1, 1) >> 8 & 0xffff), (WATER, 77 | 60 << 8), "with its shade and heat");
        assert_eq!((world.count(STONE), world.count(SAND), world.count(WATER)), (stone, sand, 1));
        assert!(world.awake() > 0 && material(world.get(-1, 0)) == WALL && material(world.get(50, 89)) == WALL);
        // the sand that lay on the floor now stands against the right side, and falls
        world.step();
        world.step();
        assert!(world.at(49, 9) == EMPTY || world.at(49, 10) == EMPTY, "it falls the new way");
        // four turns of a world that has not been stepped bring every cell back, at rest
        let mut round = World::new(90, 50, 6);
        round.cells = before.clone();
        for _ in 0..4 {
            round.turn();
        }
        assert!(round.cells.iter().zip(&before).all(|(now, was)| now & 0x00ff_ffff == was & 0x00ff_ffff));
    }

    #[test]
    fn a_shake_throws_up_what_lies_open_keeps_every_grain_and_lets_a_steep_heap_slump() {
        let mut world = World::new(160, 100, 4);
        // a block of sand standing with upright sides, twenty wide and forty high, on the floor
        for y in 60..100 {
            world.paint(SAND, 70, y, 89, y, 0, 100, false);
        }
        for _ in 0..200 {
            world.step();
        }
        let sand = world.count(SAND);
        let top = |w: &World| (0..100).find(|&y| (0..160).any(|x| w.at(x, y) == SAND)).unwrap();
        let wide = |w: &World| (0..160).filter(|&x| (0..100).any(|y| w.at(x, y) == SAND)).count();
        let (top_before, wide_before) = (top(&world), wide(&world));
        world.shake(3);
        assert!(top(&world) < top_before, "grains at the top are thrown up");
        for _ in 0..30 {
            world.shake(3);
            world.step();
        }
        for _ in 0..300 {
            world.step();
        }
        assert_eq!(world.count(SAND), sand, "no grain is made or lost");
        assert!(top(&world) > top_before && wide(&world) > wide_before, "the heap is lower and wider: top {} from {top_before}, {} wide from {wide_before}", top(&world), wide(&world));
        assert_eq!(world.awake(), 0, "and comes to rest");
    }

    #[test]
    fn a_fill_takes_a_closed_space_and_no_more_and_an_open_one_is_refused() {
        let mut world = World::new(120, 80, 2);
        // a cup of stone, open at the top: its inside is joined to all the air of the world
        world.paint(STONE, 30, 60, 60, 60, 0, 100, false);
        world.paint(STONE, 30, 40, 30, 60, 0, 100, false);
        world.paint(STONE, 60, 40, 60, 60, 0, 100, false);
        let air = world.count(EMPTY);
        assert_eq!(world.flood(WATER, 45, 50, 2000), 0, "not closed: it is more than the most");
        assert_eq!(world.count(EMPTY), air, "and nothing is changed");
        // with a lid it is closed: 29 by 19 cells
        world.paint(STONE, 30, 40, 60, 40, 0, 100, false);
        assert_eq!(world.flood(WATER, 45, 50, 2000), 29 * 19);
        assert_eq!(world.count(WATER), 29 * 19);
        assert!((41..60).all(|y| (31..60).all(|x| world.at(x, y) == WATER)));
        // a cell that holds something is not filled over, and erasing takes the whole body of one material
        assert_eq!(world.flood(SAND, 45, 50, 2000), 0);
        assert_eq!(world.flood(EMPTY, 45, 50, 2000), 29 * 19);
        assert_eq!(world.count(WATER), 0);
        assert_eq!(world.flood(EMPTY, 45, 50, 2000), 0, "nothing there to erase");
        // past the world's edges there is nothing to fill
        assert_eq!(world.flood(SAND, -3, 5, 2000), 0);
    }

    #[test]
    fn a_world_left_alone_goes_to_sleep() {
        let mut world = World::new(128, 128, 1);
        world.paint(SAND, 64, 10, 64, 10, 6, 100, false);
        assert!(world.awake() > 0);
        for _ in 0..400 {
            world.step();
        }
        assert_eq!(world.awake(), 0);
    }

    /// The stripe a cell of pride sand was poured in.
    fn stripe(world: &World, x: i32, y: i32) -> u32 {
        (world.get(x, y) >> 8 & 0xff) / STRIPE as u32
    }

    #[test]
    fn a_striped_stroke_lays_its_stripes_side_by_side_along_it_whichever_way_it_goes() {
        // across, left to right and right to left: the first stripe on top either way
        for (from, to) in [(10, 60), (60, 10)] {
            let mut world = World::new(80, 40, 1);
            world.paint_striped(PRIDE, from, 20, to, 20, 5, 100, 7, 3);
            // the brush where the line starts was laid by the line before it
            assert_eq!(world.at(from, 20), EMPTY);
            // the middle of each stripe is certain; near an edge a grain may be of either side
            let rows: Vec<u32> = (15..=25).map(|y| stripe(&world, 35, y)).collect();
            assert_eq!((rows[0], rows[1], rows[5], rows[9], rows[10]), (7, 7, 8, 9, 9), "{from} to {to}: {rows:?}");
            // and along the stroke the stripes meet grainily: an edge is not one straight line
            let edge = |x: i32| (15..=25).position(|y| stripe(&world, x, y) == 8).unwrap();
            assert!((20..50).any(|x| edge(x) != edge(20)), "{from} to {to}");
        }
        // straight down: the first stripe on the left
        let mut world = World::new(40, 80, 1);
        world.paint_striped(PRIDE, 20, 60, 20, 10, 5, 100, 0, 2);
        assert_eq!((stripe(&world, 15, 30), stripe(&world, 25, 30)), (0, 1));
        // a brush held still pours its stripes side by side, as a stroke straight down does
        let mut world = World::new(40, 40, 1);
        world.paint_striped(PRIDE, 20, 20, 20, 20, 4, 100, 3, 3);
        assert_eq!((stripe(&world, 16, 20), stripe(&world, 20, 20), stripe(&world, 24, 20)), (3, 4, 5));
    }

    #[test]
    fn a_flag_is_laid_whole_as_layered_sand_every_stripe_in_order_into_empty_cells_only() {
        let lay = |seed: u64| {
            let mut world = World::new(160, 100, seed);
            world.paint(STONE, 30, 12, 30, 12, 0, 100, false);
            world.flag(PRIDE, 10, 5, 120, 80, 10, 5);
            world
        };
        let world = lay(2);
        assert_eq!(world.count(PRIDE), 120 * 80 - 1, "every cell but the stone");
        assert_eq!(world.at(30, 12), STONE);
        // each stripe about its share, every one of them in every column
        let mut each = [0usize; 5];
        for y in 5..85 {
            for x in 10..130 {
                if world.at(x, y) == PRIDE {
                    each[stripe(&world, x, y) as usize - 10] += 1;
                }
            }
        }
        assert!(each.iter().all(|&n| (1700..2140).contains(&n)), "{each:?}");
        // down every column the stripes come in order, but for a few grains that have strayed
        // across an edge, never more than a stripe
        let (mut strayed, mut grains) = (0, 0);
        for x in 10..130 {
            let column: Vec<u32> = (5..85).filter(|&y| world.at(x, y) == PRIDE).map(|y| stripe(&world, x, y)).collect();
            assert_eq!((column[0], *column.last().unwrap()), (10, 14), "column {x}");
            assert!((10..15).all(|s| column.contains(&s)), "column {x}");
            for pair in column.windows(2) {
                assert!(pair[1] + 1 >= pair[0] && pair[1] <= pair[0] + 1, "column {x}: {column:?}");
                strayed += (pair[1] < pair[0]) as usize;
            }
            grains += column.len();
        }
        assert!(strayed > 0 && strayed * 100 < grains, "a few strays: {strayed} of {grains}");
        // each edge wanders along the flag, up to two rows from where it would be level
        let edge = |w: &World, x: i32| (5..85).filter(|&y| stripe(w, x, y) < 12).count() as i32;
        let edges: Vec<i32> = (10..130).map(|x| edge(&world, x)).collect();
        let (low, high) = (*edges.iter().min().unwrap(), *edges.iter().max().unwrap());
        assert!(high - low >= 2 && (29..=35).contains(&low) && (29..=35).contains(&high), "{edges:?}");
        // the same press lays the same flag, another world another
        assert!(lay(2).cells == world.cells);
        assert!(lay(3).cells != world.cells);
        // a flag cut by the world's edge, and stripes past the colors there are, stay inside it
        let mut world = lay(2);
        world.flag(PRIDE, 150, 80, 30, 30, 62, 9);
        assert!((80..100).all(|y| stripe(&world, 155, y) >= 62 && stripe(&world, 155, y) < 64));
        // a flag too small to wander still has every stripe, in order
        let mut world = World::new(40, 40, 4);
        world.flag(PRIDE, 5, 5, 12, 8, 0, 4);
        for x in 5..17 {
            let column: Vec<u32> = (5..13).map(|y| stripe(&world, x, y)).collect();
            assert!(column.windows(2).all(|pair| pair[1] + 1 >= pair[0]), "{column:?}");
        }
    }

    #[test]
    fn pride_sand_keeps_its_stripes_as_it_falls_and_piles() {
        let mut world = World::new(120, 100, 4);
        world.flag(PRIDE, 40, 0, 40, 24, 0, 6);
        let poured = world.count(PRIDE);
        for _ in 0..600 {
            world.step();
        }
        assert_eq!(world.count(PRIDE), poured);
        // every cell keeps the stripe it was laid in: the six stripes are all still there, each as many cells
        let mut each = [0usize; 6];
        for y in 0..100 {
            for x in 0..120 {
                if world.at(x, y) == PRIDE {
                    each[stripe(&world, x, y) as usize] += 1;
                }
            }
        }
        assert!(each.iter().all(|&n| (120..200).contains(&n)), "{each:?}");
        // and lie mostly in their order: the middle column of the heap, from the top down, never goes back more than a stripe
        let column: Vec<u32> = (0..100).filter(|&y| world.at(60, y) == PRIDE).map(|y| stripe(&world, 60, y)).collect();
        assert!(column.windows(2).all(|pair| pair[1] + 1 >= pair[0]), "{column:?}");
    }

    #[test]
    fn cells_written_by_the_page_are_made_ones_the_step_can_work_and_the_world_wakes() {
        let mut world = World::new(64, 64, 5);
        for _ in 0..10 {
            world.step();
        }
        assert_eq!(world.awake(), 0);
        let (sand, unknown, edge, pride) = (world.index(3, 3), world.index(4, 3), world.index(5, 3), world.index(6, 3));
        world.cells[sand] = SAND as u32 | 0xff00_0000;
        world.cells[unknown] = 200 | 0x0011_2200;
        world.cells[edge] = WALL as u32;
        world.cells[pride] = PRIDE as u32 | (9 * STRIPE as u32) << 8;
        world.rewritten(true);
        assert_eq!((world.at(3, 3), world.at(4, 3), world.at(5, 3), world.at(6, 3)), (SAND, EMPTY, EMPTY, PRIDE));
        assert_eq!(world.get(3, 3) >> 24, 0, "no clock, no speed");
        assert_eq!((world.temperature_at(3, 3), world.temperature_at(4, 3)), (ROOM, ROOM));
        assert_eq!(stripe(&world, 6, 3), 9, "a stripe keeps its color");
        assert!(world.awake() > 0 && world.changed() == (0, 63));
        world.step();
        assert_eq!(world.at(3, 4), SAND, "it falls");
    }

    #[test]
    fn chance_depends_on_its_three_numbers_alone() {
        assert_eq!(chance(1, 2, 3), chance(1, 2, 3));
        assert_ne!(chance(1, 2, 3), chance(1, 2, 4));
        assert_ne!(chance(1, 2, 3), chance(2, 2, 3));
        // the low bit is even about half the time
        let ones = (0..10_000).filter(|&k| chance(7, 1, k) & 1 == 1).count();
        assert!((4800..5200).contains(&ones), "{ones}");
    }
}
