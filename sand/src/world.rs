//! The world: a grid of cells in one flat array, cut into chunks of 64 by 64, and the step that
//! moves them.
//!
//! A cell is four bytes, kept as one u32 so the page can draw the grid as a picture of four
//! channels straight out of memory:
//!
//! - byte 0, its material (`materials.rs`);
//! - byte 1, its shade, chosen by chance when it is made, so sand is not one flat color;
//! - byte 2, kept for stage 2: a lifetime or a temperature;
//! - byte 3, bits 0 to 5 the clock of the step it last moved in, bits 6 and 7 its falling speed.
//!
//! An empty cell has material 0, and is all zeros but for the clock of the step something left
//! it, which tells a cell resting on it that its support has just gone. Around the world is a border of `BORDER` cells, wall or void by the
//! setting for the edges, so that a cell near the edge can look at its neighbors without a check.
//!
//! Each chunk keeps a rectangle of where something may move this step (`now`) and next step
//! (`next`). A change to a cell adds the cells it could set moving, the cell and a margin around
//! it, to both. A chunk whose rectangle is empty sleeps and costs nothing. The rectangles are read
//! as the step reaches them, so a cell set moving earlier in the same step is still reached.

use alloc::vec;
use alloc::vec::Vec;

use crate::level::Levels;
use crate::materials::{EMPTY, Kind, Props, TABLE, VOID, WALL, widest};

/// The side of a chunk, in cells.
pub const CHUNK: i32 = 64;
/// How many cells of edge lie around the world on every side.
pub const BORDER: usize = 8;
/// How far sideways a change can set a cell moving: as far as any material looks.
const MARGIN_X: i32 = widest();
/// How far up or down a change can set a cell moving: a powder looks two cells under its side.
const MARGIN_Y: i32 = 2;
/// The clock runs 1 to this, then every cell's clock is set back to 0.
const CLOCK_MOST: u32 = 63;

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

    fn has_row(&self, y: i32) -> bool {
        self.y0 <= y && y <= self.y1 && self.x0 <= self.x1
    }
}

/// One chunk's two rectangles, and whether anything in it has moved since the clock last went
/// round.
#[derive(Clone, Copy)]
pub(crate) struct Chunk {
    pub now: Rect,
    pub next: Rect,
    stirred: bool,
}

impl Chunk {
    const ASLEEP: Chunk = Chunk { now: Rect::EMPTY, next: Rect::EMPTY, stirred: false };
}

/// The material of a cell.
#[inline(always)]
pub fn material(cell: u32) -> u8 {
    cell as u8
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
fn props(cell: u32) -> Props {
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
    seed: u64,
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
            cells: vec![0; stride * rows],
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

    /// How many cells of a material there are.
    pub fn count(&self, of: u8) -> usize {
        (0..self.height).map(|y| (0..self.width).filter(|&x| self.at(x, y) == of).count()).sum()
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
        self.chunks.iter().filter(|chunk| !chunk.next.is_empty()).count()
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
            chunk.now = if self.sleeping {
                chunk.next
            } else {
                let (cx, cy) = (at as i32 % self.across, at as i32 / self.across);
                Rect { x0: cx * CHUNK, y0: cy * CHUNK, x1: (cx * CHUNK + CHUNK - 1).min(self.width - 1), y1: (cy * CHUNK + CHUNK - 1).min(self.height - 1) }
            };
            chunk.next = Rect::EMPTY;
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

    /// Moves one cell by the rule for its kind.
    #[inline(always)]
    fn visit(&mut self, at: usize, x: i32, y: i32) {
        let cell = self.cells[at];
        let p = props(cell);
        match p.kind {
            Kind::Powder | Kind::Liquid | Kind::Gas if clock_of(cell) != self.clock => {
                if p.kind == Kind::Gas {
                    self.rise(at, x, y, p);
                } else {
                    self.fall(at, x, y, cell, p);
                }
            }
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
            Kind::Liquid | Kind::Gas => p.density < density && clock_of(target) != self.clock,
            _ => false,
        }
    }

    /// Whether a gas of this density may rise or spread into `target`: it is empty, the edge of an
    /// open world, or a heavier gas that has not moved this step.
    #[inline(always)]
    fn rises_into(&self, density: u8, target: u32) -> bool {
        let p = props(target);
        match p.kind {
            Kind::Empty | Kind::Void => true,
            Kind::Gas => p.density > density && clock_of(target) != self.clock,
            _ => false,
        }
    }

    /// Moves the cell at `from` to `to`, and what was at `to` back to `from`, both marked as moved
    /// this step. Into the edge of an open world, the cell is gone.
    #[inline(always)]
    fn swap(&mut self, from: usize, to: usize, speed: u32, (x, y): (i32, i32), (tx, ty): (i32, i32)) {
        let mover = with_state(self.cells[from], self.clock, speed);
        let target = self.cells[to];
        // an empty cell left behind keeps the clock, so a cell resting on it knows its support
        // has just gone
        let left = self.clock << 24;
        if material(target) == VOID {
            self.cells[from] = left;
        } else {
            self.cells[from] = if material(target) == EMPTY { left } else { with_state(target, self.clock, 0) };
            self.cells[to] = mover;
        }
        self.touch(x.min(tx), y.min(ty), x.max(tx), y.max(ty));
    }

    /// The rule for powders and liquids: fall, gathering speed; or slide off a slope; or, for a
    /// liquid, spread sideways toward somewhere lower, or anywhere when pushed from above.
    #[inline(always)]
    fn fall(&mut self, at: usize, x: i32, y: i32, cell: u32, p: Props) {
        let s = self.stride;
        let speed = speed_of(cell);
        let below = self.cells[at + s];
        let open = self.sinks_into(p.density, below);
        // A resting cell whose support has moved away this step goes to a side if it can, rather
        // than following it down: so the face of a heap of water, all resting on cells that have
        // just left, flows out at once and does not drop a cell at a time.
        let undermined = speed == 0 && material(below) == EMPTY && clock_of(below) == self.clock;
        if open && !undermined {
            self.drop(at, x, y, below, speed, p);
            return;
        }
        let roll = chance(self.seed, self.steps, at);
        // Down a slope. The cell beside it must be open too, so nothing squeezes between two
        // corners: a wall of cells touching only at their corners holds.
        let slide = if p.kind == Kind::Liquid { 1 } else { p.slide as usize };
        if slide > 0 {
            let left = self.slides(at, -1, slide, p.density);
            let right = self.slides(at, 1, slide, p.density);
            if left || right {
                let side = if left && right { if roll & 1 == 0 { -1 } else { 1 } } else if left { -1 } else { 1 };
                self.swap(at, (at + s).wrapping_add_signed(side), 0, (x, y), (x + side as i32, y + 1));
                return;
            }
        }
        if p.kind == Kind::Liquid {
            // Sideways. A cell at the surface goes only toward somewhere lower within reach, so
            // that a level surface is still; one with something resting on it is pushed, and goes
            // as far as it can, so the face of a heap of water flows out.
            let pushed = matches!(props(self.cells[at - s]).kind, Kind::Liquid | Kind::Powder);
            let lower = |side: isize| self.sideways(at, side, p.spread as isize, pushed, s as isize, |c| self.sinks_into(p.density, c));
            let (left, right_far) = (lower(-1), lower(1));
            if left > 0 || right_far > 0 {
                let side = if left > 0 && right_far > 0 { if (roll >> 1) & 1 == 0 { -left } else { right_far } } else if left > 0 { -left } else { right_far };
                self.swap(at, at.wrapping_add_signed(side), 0, (x, y), (x + side as i32, y));
                return;
            }
        }
        if open {
            // its support has gone and it can go nowhere to the side: it follows it down
            self.drop(at, x, y, below, speed, p);
            return;
        }
        if speed != 0 {
            // it has landed
            self.cells[at] = with_state(cell, clock_of(cell), 0);
            self.touch(x, y, x, y);
        }
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
        while fallen < reach && material(self.cells[to + s]) == EMPTY {
            to += s;
            fallen += 1;
        }
        self.swap(at, to, (speed + 1).min(3), (x, y), (x, y + fallen as i32));
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
    /// `depth` cells under that.
    #[inline(always)]
    fn slides(&self, at: usize, side: isize, depth: usize, density: u8) -> bool {
        let beside = at.wrapping_add_signed(side);
        if !self.sinks_into(density, self.cells[beside]) {
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
    /// be poured rather than laid. Painting empty erases. Otherwise only empty cells are filled,
    /// unless `replace`.
    #[allow(clippy::too_many_arguments)]
    pub fn paint(&mut self, of: u8, x0: i32, y0: i32, x1: i32, y1: i32, radius: i32, fill: u32, replace: bool) {
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
        let mut painted = false;
        for y in top..=bottom {
            for x in left..=right {
                let (px, py) = ((x - x0) as f32, (y - y0) as f32);
                let along = if long > 0.0 { ((px * dx + py * dy) / long).clamp(0.0, 1.0) } else { 0.0 };
                let (ox, oy) = (px - along * dx, py - along * dy);
                if ox * ox + oy * oy > reach * reach {
                    continue;
                }
                let at = self.index(x, y);
                let here = self.cells[at];
                if of == EMPTY {
                    if material(here) != EMPTY {
                        self.cells[at] = 0;
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
                self.cells[at] = of as u32 | ((roll >> 8) & 0xff) << 8;
                painted = true;
            }
        }
        if painted {
            self.touch(left, top, right, bottom);
        }
    }

    /// Empties the world.
    pub fn clear(&mut self) {
        for y in 0..self.height {
            let start = self.index(0, y);
            self.cells[start..start + self.width as usize].fill(0);
        }
        for chunk in self.chunks.iter_mut() {
            *chunk = Chunk::ASLEEP;
        }
        self.changed = (0, self.height - 1);
    }
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
    use crate::materials::{SAND, STONE, WATER};

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
