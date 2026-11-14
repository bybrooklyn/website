//! How water finds its level through a connected body, as in two joined vessels; and, upside down,
//! how steam gathers level under a lid.
//!
//! Cell by cell, a liquid only falls and spreads toward somewhere lower beside it, so the water in
//! one arm of a U never reaches the other: the bend between them is full. After the cells have
//! moved, each step therefore looks at every body of liquid near anything that changed: the cells
//! of one liquid joined by their sides. If its highest cell with open space above lies higher
//! than the lowest open cell it touches (above it, or beside it with something under it), the top
//! cell goes there, as the pressure through the body would push it. Cells that moved this step join
//! a body, so the busy edge of a spreading pool does not cut it in two, but are never taken from
//! its top: a stream still falling is not drawn back up. A few go each step, highest to
//! lowest, until the body's surfaces are within one cell of each other. Every move lowers a cell,
//! so it always comes to rest and never flickers. A gas is the same turned over: its surface faces
//! down, its lowest cells go to the highest open places it touches.
//!
//! What a body does depends only on its own cells, never on the order bodies are found in, so a
//! world run with sleeping off, where every body is looked at, comes out the same to the byte.

use crate::materials::{Kind, TABLE};
use crate::world::{World, clock_of, material, with_state};
use alloc::vec::Vec;

/// How many cells a body moves in one step.
const PER_BODY: usize = 64;
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
    moves: Vec<[(u32, u32); PER_BODY]>,
    lengths: [usize; BODIES],
    /// The body being found: its highest surface cells and lowest open places, best first, each
    /// with the number it is ranked by.
    tops: Vec<(u64, u32)>,
    tops_count: usize,
    places: Vec<(u64, u32)>,
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
            // made on the heap, filled with zeros, so the module does not carry a copy of them
            moves: alloc::vec![[(0, 0); PER_BODY]; BODIES],
            lengths: [0; BODIES],
            tops: alloc::vec![(0, 0); PER_BODY],
            tops_count: 0,
            places: alloc::vec![(0, 0); PER_BODY],
            places_count: 0,
        }
    }
}
/// What finding a body came to. Made once a body and used at once, never kept, so the moves are
/// carried in it rather than put on the heap, which the step never uses.
#[allow(clippy::large_enum_variant)]
/// What finding a body came to.
enum Found {
    /// It is level: nothing to move.
    Still,
    /// It has cells to move, and its highest top is in this column.
    Top(i64),
    /// Its moves, how many, and its first cell.
    Moves([(u32, u32); PER_BODY], usize, u32),
}

/// Keeps the `PER_BODY` smallest ranks in `list`, smallest first.
fn keep(list: &mut [(u64, u32)], count: &mut usize, rank: u64, cell: u32) {
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

/// Whether a cell of this kind can move into a cell holding `cell`: a liquid into an empty cell or a
/// gas, a gas into an empty cell.
#[inline(always)]
fn open(kind: Kind, cell: u32) -> bool {
    match TABLE[material(cell) as usize].kind {
        Kind::Empty => true,
        Kind::Gas => kind == Kind::Liquid,
        _ => false,
    }
}

impl World {
    /// Looks at every body of liquid or gas near a change this step, and moves the tops of those
    /// not level toward their lowest open places (for a gas, upside down).
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
                    if TABLE[material(cell) as usize].level != 0 && !self.counted(at) {
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
                let kind = TABLE[material(here) as usize].kind;
                let still = matches!(kind, Kind::Liquid | Kind::Gas) && clock_of(here) != self.clock;
                let empty = material(there) == crate::materials::EMPTY;
                if still && open(kind, there) && (empty || clock_of(there) != self.clock) {
                    self.cells[to] = with_state(here, self.clock, 0);
                    // what was there, air or a gas, goes back with its heat
                    self.cells[from] = with_state(there, self.clock, 0);
                    let (tx, ty) = self.place(to);
                    self.touch(fx, fy, fx, fy);
                    self.touch(tx, ty, tx, ty);
                    if crate::world::temperature(here) != crate::world::temperature(there) || crate::world::restless(here) || crate::world::restless(there) {
                        self.warmed(fx, fy, fx, fy);
                        self.warmed(tx, ty, tx, ty);
                    }
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

    /// Finds the body of liquid or gas that the cell at `seed` belongs to, a row of cells at a time,
    /// and keeps what it should move.
    fn body(&mut self, seed: usize) {
        // Of open places equally low, the nearest to the body's highest top go first, so a lake
        // poured into at one end rises there first and the water spreads out from it rather than
        // appearing at the far shore. Where that top is is known only once the body has been
        // found, so a body with anything to move is found twice, the second time ranking its places
        // by how far they are from it. A body at rest is found once.
        let mut reference: Option<i64> = None;
        loop {
            let moves = self.find(seed, reference);
            match moves {
                Found::Still => return,
                Found::Top(column) if reference.is_none() => reference = Some(column),
                Found::Top(_) => return,
                Found::Moves(moves, length, first) => {
                    self.keep_moves(moves, length, first);
                    return;
                }
            }
        }
    }

    /// Finds the body the cell at `seed` belongs to and what it should move: its highest tops
    /// paired with its lowest open places, ranked among equals by how far they are from the column
    /// `reference`, or, with none, gives where its highest top is.
    fn find(&mut self, seed: usize, reference: Option<i64>) -> Found {
        self.levels.body += 1;
        let id = self.levels.body;
        let liquid = material(self.cells[seed]);
        let kind = TABLE[liquid as usize].kind;
        let clock = self.clock;
        let s = self.stride;
        // A liquid's surface faces up and a gas's down. `out` is the way a surface faces, and
        // `height` how far a row lies that way: the highest top and the lowest place of a liquid,
        // the lowest top and the highest place of a gas.
        let gas = kind == Kind::Gas;
        let out = |at: usize| if gas { at + s } else { at - s };
        let under = |at: usize| if gas { at - s } else { at + s };
        // ties go to the left on one step and the right on the next, so nothing drifts
        let leftward = self.steps.is_multiple_of(2);
        let tie = |at: usize| if leftward { at as u64 } else { u32::MAX as u64 - at as u64 };
        // ties of distance go left on one step and right on the next
        let from = reference.unwrap_or(0);
        let near = |at: usize| ((at % s) as i64 - from).unsigned_abs() * 2 + (((at % s) as i64 > from) == leftward) as u64;
        let bottom = (self.height + 2 * crate::world::BORDER as i32) as u64;
        let height = |row: u64| if gas { row } else { bottom - row };
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
                material(cell) == liquid && marks[at] != id
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
            let beyond = (out(a) / s) as u64;
            for at in a..=b {
                levels.marks[at] = id;
                let past = out(at);
                if open(kind, cells[past]) && clock_of(cells[at]) != clock {
                    // a surface cell, and an open place past it
                    keep(&mut levels.tops, &mut levels.tops_count, ((bottom - height(row)) << 32) | tie(at), at as u32);
                    if levels.marks[past] != PLACE | id {
                        levels.marks[past] = PLACE | id;
                        keep(&mut levels.places, &mut levels.places_count, (height(beyond) << 32) | if reference.is_some() { near(past) } else { tie(past) }, past as u32);
                    }
                }
            }
            // open places at either end of the row, with something on the other side to rest against
            for end in [a - 1, b + 1] {
                let rest = cells[under(end)];
                if open(kind, cells[end]) && !open(kind, rest) && material(rest) != crate::materials::VOID && levels.marks[end] != PLACE | id {
                    levels.marks[end] = PLACE | id;
                    keep(&mut levels.places, &mut levels.places_count, (height(row) << 32) | if reference.is_some() { near(end) } else { tie(end) }, end as u32);
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
        // pair the highest tops with the lowest places, while each place is lower than its top, by
        // more than a thick liquid's surface may be uneven
        let uneven = TABLE[liquid as usize].level as u64 - 1;
        let mut moves = [(0u32, 0u32); PER_BODY];
        let mut length = 0;
        for k in 0..levels.tops_count.min(levels.places_count) {
            let (top_rank, top) = levels.tops[k];
            let (place_rank, place) = levels.places[k];
            if (place_rank >> 32) + uneven >= bottom - (top_rank >> 32) {
                break;
            }
            moves[length] = (top, place);
            length += 1;
        }
        if length == 0 {
            return Found::Still;
        }
        if reference.is_none() {
            return Found::Top((levels.tops[0].1 as usize % s) as i64);
        }
        Found::Moves(moves, length, first)
    }

    /// Keeps a body's moves to be made this step, in order of the body's first cell; past
    /// `BODIES`, the body with the largest first cell waits a step.
    fn keep_moves(&mut self, moves: [(u32, u32); PER_BODY], length: usize, first: u32) {
        let levels = &mut self.levels;
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
