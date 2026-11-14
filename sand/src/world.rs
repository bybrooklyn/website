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
//! - byte 3, bits 0 to 5 the clock of the step it last moved or changed in, bits 6 and 7 its
//!   falling speed.
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
use crate::materials::{EMPTY, Kind, MATERIALS, Props, REACTIONS, ROLL_ALONG, ROOM, STRIPE, STRIPES, TABLE, VOID, WALL, deepest, widest};

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
const CLOCK_MOST: u32 = 63;
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

    fn add(&mut self, x0: i32, y0: i32, x1: i32, y1: i32) {
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
    stirred: bool,
}

impl Chunk {
    const ASLEEP: Chunk = Chunk { now: Rect::EMPTY, next: Rect::EMPTY, warm_now: Rect::EMPTY, warm_next: Rect::EMPTY, stirred: false };
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
    (cell >> 24) & 63
}

#[inline(always)]
fn speed_of(cell: u32) -> u32 {
    cell >> 30
}

/// A cell with its clock and speed set.
#[inline(always)]
pub(crate) fn with_state(cell: u32, clock: u32, speed: u32) -> u32 {
    (cell & 0x00ff_ffff) | (clock << 24) | (speed << 30)
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
    pub(crate) levels: Levels,
    /// Two rows of cells as they were before the heat pass, kept while it works down the world.
    pub(crate) rows: Vec<u32>,
    /// How many times each line of `REACTIONS` has happened, by its place in the table.
    pub fired: Vec<u64>,
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
            levels: Levels::new(stride * rows),
            rows: vec![0; 2 * stride],
            fired: vec![0; REACTIONS.len()],
        };
        world.set_edges(Edges::Walled);
        world
    }

    /// Where cell (x, y) is in `cells`. x and y may be up to `BORDER` outside the world.
    #[inline(always)]
    pub fn index(&self, x: i32, y: i32) -> usize {
        (y + BORDER as i32) as usize * self.stride + (x + BORDER as i32) as usize
    }

    /// The cell at (x, y).
    pub fn get(&self, x: i32, y: i32) -> u32 {
        self.cells[self.index(x, y)]
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
        self.cells[at] = with_temperature(self.cells[at], t);
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

    /// How many chunks will be worked through next step.
    pub fn awake(&self) -> usize {
        self.chunks.iter().filter(|chunk| !chunk.next.is_empty() || !chunk.warm_next.is_empty()).count()
    }

    /// The first and last rows changed since `forget_changed`, or an empty range.
    pub fn changed(&self) -> (i32, i32) {
        self.changed
    }

    /// The page has drawn what changed.
    pub fn forget_changed(&mut self) {
        self.changed = (i32::MAX, i32::MIN);
    }

    /// Something changed in the cells from (x0, y0) to (x1, y1): what they could set moving is
    /// reached later this step and next step.
    #[inline]
    pub(crate) fn touch(&mut self, x0: i32, y0: i32, x1: i32, y1: i32) {
        self.changed.0 = self.changed.0.min(y0.max(0));
        self.changed.1 = self.changed.1.max(y1.min(self.height - 1));
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
                        *cell &= 0xc0ff_ffff;
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
        let cell = self.cells[at];
        let p = props(cell);
        if p.kind == Kind::Empty || clock_of(cell) == self.clock {
            return;
        }
        let t = temperature(cell);
        if p.acts && !(p.calm_from <= t && t <= p.calm_to) && self.react(at, x, y, cell, p) {
            return;
        }
        let cell = self.cells[at];
        match p.kind {
            Kind::Powder | Kind::Liquid => self.fall(at, x, y, cell, p),
            Kind::Gas => self.rise(at, x, y, p),
            Kind::Fire => self.flicker(at, x, y, p),
            _ => {}
        }
    }

    /// Whether a cell falling or spreading, of this density, may move into `target`: it is empty,
    /// the edge of an open world, or a lighter liquid or gas that has not moved this step.
    #[inline(always)]
    fn sinks_into(&self, density: u8, target: u32) -> bool {
        let p = props(target);
        match p.kind {
            Kind::Empty | Kind::Void => true,
            Kind::Liquid | Kind::Gas | Kind::Fire => p.density < density && clock_of(target) != self.clock,
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
        let mover = with_state(self.cells[from], self.clock, speed);
        let target = self.cells[to];
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
        let below = self.cells[at + s];
        let open = self.sinks_into(p.density, below);
        // A resting cell whose support has moved away this step goes to a side if it can, rather
        // than following it down: so the face of a heap of water, all resting on cells that have
        // just left, flows out at once and does not drop a cell at a time. So does a grain of
        // powder in a crowded column (`drop` says which).
        let undermined = speed == 0 && material(below) == EMPTY && clock_of(below) == self.clock;
        if open && !undermined && self.drop(at, x, y, below, speed, p, true) {
            return;
        }
        let roll = chance(self.seed, self.steps, at);
        // Down a slope. The cell beside it must be open too, so nothing squeezes between two
        // corners: a wall of cells touching only at their corners holds.
        let slide = if p.kind == Kind::Liquid { 1 } else { p.slide as usize };
        if slide > 0 {
            // A grain spilling from a crowded column goes only into open air, not into a cell its
            // neighbor has just left: so the face of a pillar spills outward, while a block of grains
            // landing together keeps its order (the stripes of a flag poured from high up land as
            // stripes, not shuffled).
            let crowded = open && !undermined;
            let left = self.slides(at, -1, slide, p.density, !crowded);
            let right = self.slides(at, 1, slide, p.density, !crowded);
            if left || right {
                if !self.paced(roll, x, y, p) {
                    return;
                }
                let side = if left && right { if roll & 1 == 0 { -1 } else { 1 } } else if left { -1 } else { 1 };
                if p.kind == Kind::Liquid {
                    self.swap(at, (at + s).wrapping_add_signed(side), 0, (x, y), (x + side as i32, y + 1));
                    return;
                }
                self.slide_down(at, (x, y), side, speed, slide, p);
                return;
            }
        }
        if p.kind == Kind::Liquid {
            // Sideways. A cell at the surface goes only toward somewhere lower within reach, so
            // that a level surface is still; one with something resting on it is pushed, and goes
            // as far as it can, so the face of a heap of water flows out.
            let pushed = matches!(props(self.cells[at - s]).kind, Kind::Liquid | Kind::Powder);
            // Only into air or a gas, not into a lighter liquid: two liquids side by side would trade
            // places for ever. A heavier liquid gets under a lighter one by falling and sliding.
            let lower = |side: isize| self.sideways(at, side, p.spread as isize, pushed, s as isize, |c| props(c).kind != Kind::Liquid && self.sinks_into(p.density, c));
            let (left, right_far) = (lower(-1), lower(1));
            if left > 0 || right_far > 0 {
                if !self.paced(roll, x, y, p) {
                    return;
                }
                let side = if left > 0 && right_far > 0 { if (roll >> 1) & 1 == 0 { -left } else { right_far } } else if left > 0 { -left } else { right_far };
                self.swap(at, at.wrapping_add_signed(side), 0, (x, y), (x + side as i32, y));
                return;
            }
        }
        if open {
            // its support has gone and it can go nowhere to the side: it follows it down
            self.drop(at, x, y, below, speed, p, false);
            return;
        }
        if p.roll != 0 && self.roll_off(at, (x, y), speed, roll, p) {
            return;
        }
        if speed != 0 {
            // It has landed. A grain landing on a step with the slope going on below the far side
            // of it rolls on by chance, so a heap rests at a gentler angle than a grain at rest
            // could hold.
            if p.roll != 0 && (roll >> 16) & 255 < p.roll as u32 {
                let open = |k: isize| self.sinks_into(p.density, self.cells[at.wrapping_add_signed(k)]);
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
        let reach = if speed > 0 { (speed + 1).min(p.fall as u32) } else { 1 };
        let (mut to, mut gone) = ((at + s).wrapping_add_signed(side), 1);
        while gone < reach && self.slides(to, side, slide, p.density, true) {
            to = (to + s).wrapping_add_signed(side);
            gone += 1;
        }
        self.swap(at, to, (speed + 1).min(3), (x, y), (x + side as i32 * gone as i32, y + gone as i32));
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
            let along = |n: isize, down: isize| self.sinks_into(p.density, self.cells[at.wrapping_add_signed(side * n + down * s)]);
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

    /// The rule for fire: up, or up and to a side by chance, so a flame wavers as it rises; to a
    /// side now and then when it cannot rise. It is always reached again next step: it is cooling.
    #[inline(always)]
    fn flicker(&mut self, at: usize, x: i32, y: i32, p: Props) {
        let s = self.stride;
        let roll = chance(self.seed ^ 0xf1a3e, self.steps, at);
        let up = |side: isize| {
            let to = (at - s).wrapping_add_signed(side);
            // not between two cells that touch only at their corners
            self.rises_into(p.density, self.cells[to]) && (side == 0 || self.rises_into(p.density, self.cells[at.wrapping_add_signed(side)]))
        };
        let side: isize = match roll & 7 {
            0 | 1 => -1,
            6 | 7 => 1,
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
            self.swap(at, (at - s).wrapping_add_signed(side), 0, (x, y), (x + side as i32, y - 1));
            return;
        }
        let side: isize = if (roll >> 3) & 1 == 0 { -1 } else { 1 };
        if (roll >> 4) & 3 == 0 && self.rises_into(p.density, self.cells[at.wrapping_add_signed(side)]) {
            self.swap(at, at.wrapping_add_signed(side), 0, (x, y), (x + side as i32, y));
            return;
        }
        self.stay(x, y);
    }

    /// Falls: through empty cells, gathering speed, or one cell through a lighter liquid or gas or
    /// out of an open world. Gives whether it fell.
    ///
    /// With `spill`, a grain of powder in a crowded column does not fall but is left to go to a
    /// side, as a resting cell whose support has gone does: one already moving, with powder
    /// pressing on it, whose support has gone this step but only one cell, so it can follow it only
    /// one. In a pillar draining from its foot every grain of its face spills outward as it comes
    /// down, and the pillar gives way all along its height rather than wearing away only where it
    /// meets the ground. Grains falling freely, as a stream from the brush, are farther apart and
    /// fall as a stream. It is found here, where how far it can fall is known.
    #[inline(always)]
    #[allow(clippy::too_many_arguments)]
    fn drop(&mut self, at: usize, x: i32, y: i32, below: u32, speed: u32, p: Props, spill: bool) -> bool {
        let s = self.stride;
        if material(below) != EMPTY {
            self.swap(at, at + s, 0, (x, y), (x, y + 1));
            return true;
        }
        let reach = (speed + 1).min(p.fall as u32);
        let (mut to, mut fallen) = (at + s, 1);
        while fallen < reach && material(self.cells[to + s]) == EMPTY {
            to += s;
            fallen += 1;
        }
        if spill && fallen == 1 && speed > 0 && p.kind == Kind::Powder && clock_of(below) == self.clock && props(self.cells[at - s]).kind == Kind::Powder {
            return false;
        }
        self.swap(at, to, (speed + 1).min(3), (x, y), (x, y + fallen as i32));
        true
    }

    /// How far a liquid or gas goes to one side: to the nearest cell within `reach` with an open
    /// cell past it (below a liquid, above a gas, `beyond` cells on), or, when `pushed`, to the
    /// farthest it can reach; 0 when it cannot go that way.
    #[inline(always)]
    fn sideways(&self, at: usize, side: isize, reach: isize, pushed: bool, beyond: isize, open: impl Fn(u32) -> bool) -> isize {
        let mut farthest = 0;
        for k in 1..=reach {
            let to = at.wrapping_add_signed(side * k);
            if !open(self.cells[to]) {
                break;
            }
            if open(self.cells[to.wrapping_add_signed(beyond)]) {
                return k;
            }
            farthest = k;
        }
        if pushed { farthest } else { 0 }
    }

    /// Whether a falling cell can slide down to the side: the cell beside it is open, and so are
    /// `depth` cells under that. Unless it `follows`, the cell beside it must not have been left
    /// this step.
    #[inline(always)]
    fn slides(&self, at: usize, side: isize, depth: usize, density: u8, follows: bool) -> bool {
        let beside = at.wrapping_add_signed(side);
        let there = self.cells[beside];
        if !self.sinks_into(density, there) || (!follows && material(there) == EMPTY && clock_of(there) == self.clock) {
            return false;
        }
        (1..=depth).all(|k| self.sinks_into(density, self.cells[beside + k * self.stride]))
    }

    /// The rule for gases: rise, straight or to a side by chance; or spread sideways toward
    /// somewhere higher, or anywhere when pushed from below.
    #[inline(always)]
    fn rise(&mut self, at: usize, x: i32, y: i32, p: Props) {
        let s = self.stride;
        let roll = chance(self.seed, self.steps, at);
        let up = self.rises_into(p.density, self.cells[at - s]);
        let side_open = |side: isize| self.rises_into(p.density, self.cells[at.wrapping_add_signed(side)]) && self.rises_into(p.density, self.cells[(at - s).wrapping_add_signed(side)]);
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
                while risen < p.fall as usize && material(self.cells[to]) == EMPTY && material(self.cells[to - s]) == EMPTY {
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
        let pushed = props(self.cells[at + s]).kind == Kind::Gas;
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
                let here = self.cells[at];
                if of == EMPTY {
                    if material(here) != EMPTY {
                        self.cells[at] = AIR;
                        painted = true;
                    }
                    continue;
                }
                if (material(here) != EMPTY && !replace) || material(here) == of {
                    continue;
                }
                let roll = chance(self.seed ^ 0x5eed, self.strokes, at);
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
                self.cells[at] = of as u32 | shade << 8 | (MATERIALS[of as usize].made as u32) << 16;
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
                if material(self.cells[at]) != EMPTY {
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
                let cell = self.cells[at] & 0x00ff_ffff;
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
        let mut world = World::new(16, 60, 3);
        world.paint(SAND, 8, 0, 8, 0, 0, 100, false);
        let mut fallen = vec![];
        for _ in 0..5 {
            world.step();
            fallen.push((0..60).find(|&y| world.at(8, y) == SAND).unwrap());
        }
        assert_eq!(fallen, vec![1, 3, 6, 10, 14]);
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
