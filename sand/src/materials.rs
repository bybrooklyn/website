//! What each material is: one line each in `MATERIALS`, and what two neighbors make in `REACTIONS`.
//! A material is added by adding a line and a constant for its number; nothing else in the engine
//! names a material, except that empty is 0 and the two kinds of edge are known by their numbers.
//!
//! How a cell moves comes from its kind alone: powders fall and slide off slopes, liquids fall and
//! spread sideways, gases rise and spread, solids stay. Density decides who sinks through whom: a
//! falling cell may pass through a lighter liquid or gas, and a rising one through a heavier gas.

/// How a material moves.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum Kind {
    /// Nothing: any material may move into it.
    Empty,
    /// Stays where it is put.
    Solid,
    /// Falls, and slides off a slope steeper than it can hold.
    Powder,
    /// Falls, then spreads sideways toward somewhere lower.
    Liquid,
    /// Rises, then spreads sideways toward somewhere higher.
    Gas,
    /// The edge of a world open at its edges: whatever moves into it is gone.
    Void,
}

/// One material: how it moves, how heavy it is, and how it is drawn.
pub struct Material {
    /// Its name, as the page shows it.
    pub name: &'static str,
    /// How it moves.
    pub kind: Kind,
    /// How heavy it is. A falling cell passes through a lighter liquid or gas; a rising gas
    /// through a heavier gas.
    pub density: u8,
    /// For a powder, how many open cells there must be under the cell beside it before a grain
    /// slides there: 1 piles at 45 degrees, 2 at about 63. 0 never slides.
    pub slide: u8,
    /// For a liquid or gas, how many cells sideways it looks in one step for somewhere to go.
    pub spread: u8,
    /// The most cells it falls (or, for a gas, rises) in one step. A falling cell gathers speed:
    /// one cell in its first step, then two, up to this.
    pub fall: u8,
    /// Its color, red, green, blue and opacity, for a shade halfway along.
    pub color: [u8; 4],
    /// How far its shade moves each of red, green and blue, from darkest to lightest.
    pub vary: [u8; 3],
    /// Offered to the visitor's brush.
    pub paint: bool,
}

/// Nothing. Always 0, which lets runs of empty cells be found four at a time.
pub const EMPTY: u8 = 0;
/// A powder that piles at 45 degrees and sinks through water.
pub const SAND: u8 = 1;
/// A liquid that levels.
pub const WATER: u8 = 2;
/// A solid.
pub const STONE: u8 = 3;
/// A powder that holds a steeper slope than sand.
pub const DIRT: u8 = 4;
/// A gas that rises and gathers under whatever is above it.
pub const STEAM: u8 = 5;
/// The edge of a walled world, around its outside.
pub const WALL: u8 = 6;
/// The edge of a world open at its edges.
pub const VOID: u8 = 7;

/// Every material, by its number.
pub const MATERIALS: &[Material] = &[
    Material { name: "empty", kind: Kind::Empty, density: 0, slide: 0, spread: 0, fall: 0, color: [0, 0, 0, 0], vary: [0, 0, 0], paint: false },
    Material { name: "sand", kind: Kind::Powder, density: 160, slide: 1, spread: 0, fall: 4, color: [222, 190, 122, 255], vary: [34, 30, 26], paint: true },
    Material { name: "water", kind: Kind::Liquid, density: 100, slide: 0, spread: 5, fall: 4, color: [52, 118, 214, 235], vary: [10, 16, 18], paint: true },
    Material { name: "stone", kind: Kind::Solid, density: 255, slide: 0, spread: 0, fall: 0, color: [122, 120, 126, 255], vary: [22, 22, 22], paint: true },
    Material { name: "dirt", kind: Kind::Powder, density: 150, slide: 2, spread: 0, fall: 4, color: [118, 84, 56, 255], vary: [26, 20, 16], paint: true },
    Material { name: "steam", kind: Kind::Gas, density: 2, slide: 0, spread: 3, fall: 1, color: [206, 214, 224, 150], vary: [18, 18, 18], paint: true },
    Material { name: "wall", kind: Kind::Solid, density: 255, slide: 0, spread: 0, fall: 0, color: [0, 0, 0, 0], vary: [0, 0, 0], paint: false },
    Material { name: "void", kind: Kind::Void, density: 0, slide: 0, spread: 0, fall: 0, color: [0, 0, 0, 0], vary: [0, 0, 0], paint: false },
];

/// What two neighbors make, one line each: `a` beside `b`, by `chance` in 256 each step, becomes
/// `a_becomes` and `b_becomes`. Stage 2 fills this in (fire and wood, water and lava, dirt and
/// water); the step reads nothing from it yet, so that every material is kept exactly.
pub struct Reaction {
    /// The first of the two.
    pub a: u8,
    /// The second, a neighbor of the first.
    pub b: u8,
    /// What the first becomes.
    pub a_becomes: u8,
    /// What the second becomes.
    pub b_becomes: u8,
    /// How likely it is in one step, in 256ths.
    pub chance: u8,
}

/// Every reaction. None yet.
pub const REACTIONS: &[Reaction] = &[];

/// The reaction of `a` beside `b`, if there is one.
pub fn reaction(a: u8, b: u8) -> Option<&'static Reaction> {
    REACTIONS.iter().find(|line| line.a == a && line.b == b)
}

/// What the step needs to know of a material, kept small and looked up by number.
#[derive(Clone, Copy)]
pub(crate) struct Props {
    pub kind: Kind,
    pub density: u8,
    pub slide: u8,
    pub spread: u8,
    pub fall: u8,
}

/// `Props` for every number a cell can hold. Numbers with no material are solid, so a cell can
/// never be moved by mistake.
pub(crate) static TABLE: [Props; 256] = table();

const fn table() -> [Props; 256] {
    let mut out = [Props { kind: Kind::Solid, density: 255, slide: 0, spread: 0, fall: 0 }; 256];
    let mut at = 0;
    while at < MATERIALS.len() {
        let m = &MATERIALS[at];
        out[at] = Props { kind: m.kind, density: m.density, slide: m.slide, spread: m.spread, fall: m.fall };
        at += 1;
    }
    out
}

/// The widest any material looks sideways in a step, which is how far a change can reach.
pub(crate) const fn widest() -> i32 {
    let mut most = 1;
    let mut at = 0;
    while at < MATERIALS.len() {
        if MATERIALS[at].spread as i32 > most {
            most = MATERIALS[at].spread as i32;
        }
        at += 1;
    }
    most
}

/// The colors the page draws with: 256 materials of red, green, blue and opacity, then 256 of how
/// far the shade moves red, green and blue (and a 0), as two rows of a picture.
pub static PALETTE: [u8; 2048] = palette();

const fn palette() -> [u8; 2048] {
    let mut out = [0u8; 2048];
    let mut at = 0;
    while at < MATERIALS.len() {
        let m = &MATERIALS[at];
        let mut k = 0;
        while k < 4 {
            out[at * 4 + k] = m.color[k];
            if k < 3 {
                out[1024 + at * 4 + k] = m.vary[k];
            }
            k += 1;
        }
        at += 1;
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn every_constant_names_the_line_it_should() {
        for (number, name) in [(EMPTY, "empty"), (SAND, "sand"), (WATER, "water"), (STONE, "stone"), (DIRT, "dirt"), (STEAM, "steam"), (WALL, "wall"), (VOID, "void")] {
            assert_eq!(MATERIALS[number as usize].name, name);
        }
        assert_eq!(MATERIALS[EMPTY as usize].kind, Kind::Empty);
    }

    #[test]
    fn heavier_things_sink_through_lighter_ones() {
        let density = |m: u8| MATERIALS[m as usize].density;
        assert!(density(SAND) > density(WATER) && density(DIRT) > density(WATER));
        assert!(density(WATER) > density(STEAM) && density(STEAM) > density(EMPTY));
    }

    #[test]
    fn nothing_reacts_yet() {
        for a in 0..MATERIALS.len() as u8 {
            for b in 0..MATERIALS.len() as u8 {
                assert!(reaction(a, b).is_none());
            }
        }
    }

    #[test]
    fn numbers_with_no_material_never_move() {
        assert_eq!(TABLE[200].kind, Kind::Solid);
        assert_eq!(TABLE[SAND as usize].kind, Kind::Powder);
    }

    #[test]
    fn the_palette_holds_each_color_and_its_shade() {
        assert_eq!(&PALETTE[SAND as usize * 4..SAND as usize * 4 + 4], &MATERIALS[SAND as usize].color);
        assert_eq!(PALETTE[1024 + WATER as usize * 4 + 1], MATERIALS[WATER as usize].vary[1]);
        assert_eq!(PALETTE[3], 0, "empty is see-through");
    }

    #[test]
    fn a_change_reaches_as_far_as_water_looks() {
        assert_eq!(widest(), 5);
    }
}
