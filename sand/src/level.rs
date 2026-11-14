//! How water finds its level through a connected body, as in two joined vessels.
//!
//! Cell by cell, a liquid only falls and spreads toward somewhere lower beside it, so the water in
//! one arm of a U never reaches the other: the bend between them is full. After the cells have
//! moved, each step therefore looks at every body of liquid near anything that changed: the cells
//! of one liquid joined by their sides, leaving out those that moved this step (a stream still
//! falling is not yet part of the pool). If its highest cell with open space above lies higher
//! than the lowest open cell it touches (above it, or beside it with something under it), the top
//! cell goes there, as the pressure through the body would push it. A few go each step, highest to
//! lowest, until the body's surfaces are within one cell of each other. Every move lowers a cell,
//! so it always comes to rest and never flickers.
//!
//! What a body does depends only on its own cells, never on the order bodies are found in, so a
//! world run with sleeping off, where every body is looked at, comes out the same to the byte.

use crate::materials::{Kind, TABLE};
use crate::world::{World, clock_of, material, with_state};
use alloc::vec::Vec;

/// How many cells a body moves in one step.
const PER_BODY: usize = 16;
/// How many bodies may move cells in one step. Past this, those with the lowest first cell go
/// first and the rest wait a step.
const BODIES: usize = 64;
/// The top bit of a mark: a cell already counted as an open place for the body being looked at.
const PLACE: u32 = 1 << 31;

/// What the levelling keeps between steps, all made with the world so a step makes nothing.
pub(crate) struct Levels {
    /// The mark each cell was last given: the number of the body it belongs to, or, with the top
    /// bit, of the body it is an open place beside.
    marks: Vec<u32>,
    /// The number of the last body looked at. Bodies of this step have numbers from `first`.
    body: u32,
    first: u32,
    /// Cells still to look at in the body being found.
    stack: Vec<u32>,
    /// This step's bodies that move cells, by their first cell, smallest first.
    count: usize,
    keys: [u32; BODIES],
    moves: [[(u32, u32); PER_BODY]; BODIES],
    lengths: [usize; BODIES],
    /// The body being found: its highest surface cells and lowest open places, best first, each
    /// with the number it is ranked by.
    tops: [(u64, u32); PER_BODY],
    tops_count: usize,
    places: [(u64, u32); PER_BODY],
    places_count: usize,
}

impl Levels {
    pub(crate) fn new(cells: usize) -> Levels {
        Levels {
            marks: alloc::vec![0; cells],
            body: 0,
            first: 1,
            // a cell is put on the stack at most once from each of the two rows beside it
            stack: Vec::with_capacity(cells + 16),
            count: 0,
            keys: [0; BODIES],
            moves: [[(0, 0); PER_BODY]; BODIES],
            lengths: [0; BODIES],
            tops: [(0, 0); PER_BODY],
            tops_count: 0,
            places: [(0, 0); PER_BODY],
            places_count: 0,
        }
    }
}

/// Keeps the `PER_BODY` smallest ranks in `list`, smallest first.
fn keep(list: &mut [(u64, u32); PER_BODY], count: &mut usize, rank: u64, cell: u32) {
    if *count == PER_BODY && rank >= list[PER_BODY - 1].0 {
        return;
    }
    let mut at = (*count).min(PER_BODY - 1);
    while at > 0 && list[at - 1].0 > rank {
        list[at] = list[at - 1];
        at -= 1;
    }
    list[at] = (rank, cell);
    *count = (*count + 1).min(PER_BODY);
}

/// Whether a liquid can move into a cell holding this: it is empty or a gas.
#[inline(always)]
fn open(cell: u32) -> bool {
    matches!(TABLE[material(cell) as usize].kind, Kind::Empty | Kind::Gas)
}

impl World {
    /// Looks at every body of liquid near a change this step, and moves the tops of those not
    /// level toward their lowest open places.
    pub(crate) fn level(&mut self) {
        if self.levels.body > PLACE - (self.cells.len() as u32) - 2 {
            self.levels.marks.fill(0);
            self.levels.body = 0;
        }
        self.levels.first = self.levels.body + 1;
        self.levels.count = 0;
        for id in 0..self.chunks.len() {
            let rect = self.chunks[id].now;
            if rect.is_empty() {
                continue;
            }
            for y in rect.y0..=rect.y1 {
                for x in rect.x0..=rect.x1 {
                    let at = self.index(x, y);
                    let cell = self.cells[at];
                    if TABLE[material(cell) as usize].kind == Kind::Liquid && clock_of(cell) != self.clock && !self.counted(at) {
                        self.body(at);
                    }
                }
            }
        }
        // in order of each body's first cell, whatever order they were found in
        for b in 0..self.levels.count {
            for k in 0..self.levels.lengths[b] {
                let (from, to) = self.levels.moves[b][k];
                let (from, to) = (from as usize, to as usize);
                let (here, there) = (self.cells[from], self.cells[to]);
                let (fx, fy) = self.place(from);
                let still = TABLE[material(here) as usize].kind == Kind::Liquid && clock_of(here) != self.clock;
                let empty = material(there) == crate::materials::EMPTY;
                if still && open(there) && (empty || clock_of(there) != self.clock) {
                    self.cells[to] = with_state(here, self.clock, 0);
                    self.cells[from] = if empty { self.clock << 24 } else { with_state(there, self.clock, 0) };
                    let (tx, ty) = self.place(to);
                    self.touch(fx, fy, fx, fy);
                    self.touch(tx, ty, tx, ty);
                } else if still {
                    // another body took its place: it tries again next step
                    self.stay(fx, fy);
                }
            }
        }
    }

    /// Whether a cell already belongs to a body found this step.
    #[inline(always)]
    fn counted(&self, at: usize) -> bool {
        let mark = self.levels.marks[at];
        mark >= self.levels.first && mark < PLACE
    }

    /// The x and y of a cell from where it is in `cells`.
    fn place(&self, at: usize) -> (i32, i32) {
        ((at % self.stride) as i32 - crate::world::BORDER as i32, (at / self.stride) as i32 - crate::world::BORDER as i32)
    }

    /// Finds the body of liquid that the cell at `seed` belongs to, a row of cells at a time, and
    /// keeps what it should move.
    fn body(&mut self, seed: usize) {
        self.levels.body += 1;
        let id = self.levels.body;
        let liquid = material(self.cells[seed]);
        let clock = self.clock;
        let s = self.stride;
        // ties go to the left on one step and the right on the next, so nothing drifts
        let leftward = self.steps.is_multiple_of(2);
        let tie = |at: usize| if leftward { at as u64 } else { u32::MAX as u64 - at as u64 };
        let bottom = (self.height + crate::world::BORDER as i32) as u64;
        self.levels.tops_count = 0;
        self.levels.places_count = 0;
        let mut first = u32::MAX;
        self.levels.stack.clear();
        self.levels.stack.push(seed as u32);
        let cells = &self.cells;
        let levels = &mut self.levels;
        while let Some(start) = levels.stack.pop() {
            let start = start as usize;
            let joins = |marks: &[u32], at: usize| {
                let cell = cells[at];
                material(cell) == liquid && clock_of(cell) != clock && marks[at] != id
            };
            if !joins(&levels.marks, start) {
                continue;
            }
            let (mut a, mut b) = (start, start);
            while joins(&levels.marks, a - 1) {
                a -= 1;
            }
            while joins(&levels.marks, b + 1) {
                b += 1;
            }
            first = first.min(a as u32);
            let row = (a / s) as u64;
            for at in a..=b {
                levels.marks[at] = id;
                let above = cells[at - s];
                if open(above) {
                    // a surface cell, and an open place above it
                    keep(&mut levels.tops, &mut levels.tops_count, (row << 32) | tie(at), at as u32);
                    if levels.marks[at - s] != PLACE | id {
                        levels.marks[at - s] = PLACE | id;
                        keep(&mut levels.places, &mut levels.places_count, ((bottom - (row - 1)) << 32) | tie(at - s), (at - s) as u32);
                    }
                }
            }
            // open places at either end of the row, with something under them to stand on
            for end in [a - 1, b + 1] {
                if open(cells[end]) && !open(cells[end + s]) && material(cells[end + s]) != crate::materials::VOID && levels.marks[end] != PLACE | id {
                    levels.marks[end] = PLACE | id;
                    keep(&mut levels.places, &mut levels.places_count, ((bottom - row) << 32) | tie(end), end as u32);
                }
            }
            // the rows above and below: one start for each run of cells that join
            for next in [a - s, a + s] {
                let mut inside = false;
                for at in next..=next + (b - a) {
                    let joined = joins(&levels.marks, at);
                    if joined && !inside {
                        levels.stack.push(at as u32);
                    }
                    inside = joined;
                }
            }
        }
        // pair the highest tops with the lowest places, while each place is lower than its top
        let mut moves = [(0u32, 0u32); PER_BODY];
        let mut length = 0;
        for k in 0..levels.tops_count.min(levels.places_count) {
            let (top_rank, top) = levels.tops[k];
            let (place_rank, place) = levels.places[k];
            let top_row = top_rank >> 32;
            let place_row = bottom - (place_rank >> 32);
            if place_row <= top_row {
                break;
            }
            moves[length] = (top, place);
            length += 1;
        }
        if length == 0 {
            return;
        }
        // kept in order of first cell; past `BODIES`, the body with the largest first cell waits
        let count = levels.count;
        if count == BODIES && first > levels.keys[BODIES - 1] {
            let (x, y) = self.place(moves[0].0 as usize);
            self.stay(x, y);
            return;
        }
        if count == BODIES {
            let (waits, _) = levels.moves[BODIES - 1][0];
            levels.count -= 1;
            let (x, y) = self.place(waits as usize);
            self.stay(x, y);
        }
        let levels = &mut self.levels;
        let mut at = levels.count;
        while at > 0 && levels.keys[at - 1] > first {
            levels.keys[at] = levels.keys[at - 1];
            levels.moves[at] = levels.moves[at - 1];
            levels.lengths[at] = levels.lengths[at - 1];
            at -= 1;
        }
        levels.keys[at] = first;
        levels.moves[at] = moves;
        levels.lengths[at] = length;
        levels.count += 1;
    }
}
