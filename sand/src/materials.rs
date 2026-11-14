//! What each material is: one line each in `MATERIALS`, and what a material becomes, alone or beside
//! a neighbor, in `REACTIONS`. A material is added by adding a line and a constant for its number,
//! and what it does by adding lines to the reactions; nothing else in the engine names a material,
//! except that empty is 0 and the two kinds of edge are known by their numbers.
//!
//! How a cell moves comes from its kind alone: powders fall and slide off slopes, liquids fall and
//! spread sideways, gases rise and spread, fire rises and flickers, solids stay. Density decides who
//! sinks through whom: a falling cell may pass through a lighter liquid, gas or flame, and a rising
//! one through a heavier gas.
//!
//! Temperature is a number from 0 to 255 in each cell, room temperature being `ROOM`. It spreads to
//! neighbors (`heat.rs`) as fast as the slower of the two conducts. Heat is kept: a cell carries its
//! own when it moves, and only the lines of `REACTIONS` that say so, and the materials that warm or
//! cool themselves, make or take any. Melting and boiling store heat in the water or steam made
//! (`latent`), which freezing and condensing give back, so a cell's heat is its temperature plus
//! what its material stores.

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
    /// Rises and flickers from side to side, and never spreads.
    Fire,
}

/// One material: how it moves, how heavy it is, how it holds heat, and how it is drawn.
pub struct Material {
    /// Its name, as the page shows it.
    pub name: &'static str,
    /// How it moves.
    pub kind: Kind,
    /// How heavy it is. A falling cell passes through a lighter liquid, gas or flame; a rising gas
    /// through a heavier gas.
    pub density: u8,
    /// For a powder, how many open cells there must be under the cell beside it before a grain
    /// slides there: 1 piles at 45 degrees, 2 at about 63, 3 at about 72. 0 never slides.
    pub slide: u8,
    /// For a powder, how likely a grain that has just landed on a step is to roll on over it
    /// when the slope goes on below, in 256ths: sand rolls, so its heaps are gentler than 45
    /// degrees.
    pub roll: u8,
    /// For a liquid or gas, how many cells sideways it looks in one step for somewhere to go.
    pub spread: u8,
    /// The most cells it falls (or, for a gas, rises) in one step. A falling cell gathers speed:
    /// one cell in its first step, then two, up to this.
    pub fall: u8,
    /// How likely a liquid is to slide or spread in a step, in 256ths; 0 is every step. Lava is
    /// slow: it falls freely but creeps sideways.
    pub pace: u8,
    /// Whether the levelling pass carries it through a connected body (`level.rs`), so that it
    /// finds one level in joined vessels.
    pub level: bool,
    /// How readily heat passes through it, from 0 (not at all) to 32. Heat crosses between two
    /// neighbors as fast as the slower of them lets it.
    pub conduct: u8,
    /// The temperature it is made at by the brush.
    pub made: u8,
    /// Heat it stores beyond its temperature, given back when it changes into something that
    /// stores less: water stores what melting took, steam what boiling took as well.
    pub latent: u8,
    /// Heat it makes (more than 0) or loses (less than 0) each step by itself, until it reaches
    /// `toward`: burning wood keeps itself hot, a flame cools as it rises.
    pub warms: i8,
    /// The temperature its warming or cooling stops at.
    pub toward: u8,
    /// Whether it lets air reach what burns beside it: a solid or liquid catches fire only with
    /// one of these beside it.
    pub airy: bool,
    /// How its shade is chosen: 0 by chance when it is made; 1 by its temperature, so a flame and
    /// lava are brighter the hotter they are; 2 by its temperature with a flicker each step.
    pub glow: u8,
    /// Its color, red, green, blue and opacity, for a shade halfway along.
    pub color: [u8; 4],
    /// How far its shade moves each of red, green and blue, from darkest to lightest.
    pub vary: [u8; 3],
    /// Offered to the visitor's brush.
    pub paint: bool,
}

/// Room temperature: what empty air and everything the brush lays cold are made at.
pub const ROOM: u8 = 40;

/// Nothing. Always 0, which lets runs of empty cells be found four at a time.
pub const EMPTY: u8 = 0;
/// A powder that piles at 45 degrees and sinks through water.
pub const SAND: u8 = 1;
/// A liquid that levels, freezes and boils.
pub const WATER: u8 = 2;
/// A solid that acid eats.
pub const STONE: u8 = 3;
/// A powder that holds a steeper slope than sand, and soaks up water.
pub const DIRT: u8 = 4;
/// A gas that rises, gathers under whatever is above it, and condenses as it cools.
pub const STEAM: u8 = 5;
/// The edge of a walled world, around its outside.
pub const WALL: u8 = 6;
/// The edge of a world open at its edges.
pub const VOID: u8 = 7;
/// A solid that burns slowly once hot enough.
pub const WOOD: u8 = 8;
/// A liquid lighter than water that burns fast.
pub const OIL: u8 = 9;
/// A slow, heavy, hot liquid that hardens to stone as it cools.
pub const LAVA: u8 = 10;
/// A solid that melts.
pub const ICE: u8 = 11;
/// A gas that rises and thins to nothing.
pub const SMOKE: u8 = 12;
/// A flame: rises, flickers, cools and dies.
pub const FIRE: u8 = 13;
/// A liquid that eats stone, wood and dirt and is used up doing it.
pub const ACID: u8 = 14;
/// Dirt that has soaked up water: it holds a steeper slope, and dries when hot.
pub const WET_DIRT: u8 = 15;
/// Wood that is burning: it keeps itself hot, gives off flames, and burns away to ash.
pub const EMBER: u8 = 16;
/// What burnt wood leaves: a light powder that floats.
pub const ASH: u8 = 17;

/// Every material, by its number.
pub const MATERIALS: &[Material] = &[
    Material { name: "empty", kind: Kind::Empty, density: 0, slide: 0, roll: 0, spread: 0, fall: 0, pace: 0, level: false, conduct: 12, made: ROOM, latent: 0, warms: -1, toward: ROOM, airy: true, glow: 0, color: [0, 0, 0, 0], vary: [0, 0, 0], paint: false },
    Material { name: "sand", kind: Kind::Powder, density: 160, slide: 1, roll: 255, spread: 0, fall: 4, pace: 0, level: false, conduct: 12, made: ROOM, latent: 0, warms: 0, toward: 0, airy: false, glow: 0, color: [222, 190, 122, 255], vary: [34, 30, 26], paint: true },
    Material { name: "water", kind: Kind::Liquid, density: 100, slide: 0, roll: 0, spread: 5, fall: 4, pace: 0, level: true, conduct: 32, made: ROOM, latent: 8, warms: 0, toward: 0, airy: false, glow: 0, color: [52, 118, 214, 235], vary: [10, 16, 18], paint: true },
    Material { name: "stone", kind: Kind::Solid, density: 255, slide: 0, roll: 0, spread: 0, fall: 0, pace: 0, level: false, conduct: 24, made: ROOM, latent: 0, warms: 0, toward: 0, airy: false, glow: 0, color: [122, 120, 126, 255], vary: [22, 22, 22], paint: true },
    Material { name: "dirt", kind: Kind::Powder, density: 150, slide: 2, roll: 0, spread: 0, fall: 4, pace: 0, level: false, conduct: 12, made: ROOM, latent: 0, warms: 0, toward: 0, airy: false, glow: 0, color: [118, 84, 56, 255], vary: [26, 20, 16], paint: true },
    Material { name: "steam", kind: Kind::Gas, density: 4, slide: 0, roll: 0, spread: 3, fall: 1, pace: 0, level: true, conduct: 12, made: 120, latent: 28, warms: 0, toward: 0, airy: true, glow: 0, color: [206, 214, 224, 150], vary: [18, 18, 18], paint: true },
    Material { name: "wall", kind: Kind::Solid, density: 255, slide: 0, roll: 0, spread: 0, fall: 0, pace: 0, level: false, conduct: 0, made: ROOM, latent: 0, warms: 0, toward: 0, airy: false, glow: 0, color: [0, 0, 0, 0], vary: [0, 0, 0], paint: false },
    Material { name: "void", kind: Kind::Void, density: 0, slide: 0, roll: 0, spread: 0, fall: 0, pace: 0, level: false, conduct: 0, made: ROOM, latent: 0, warms: 0, toward: 0, airy: false, glow: 0, color: [0, 0, 0, 0], vary: [0, 0, 0], paint: false },
    Material { name: "wood", kind: Kind::Solid, density: 255, slide: 0, roll: 0, spread: 0, fall: 0, pace: 0, level: false, conduct: 24, made: ROOM, latent: 0, warms: 0, toward: 0, airy: false, glow: 0, color: [122, 78, 44, 255], vary: [22, 16, 10], paint: true },
    Material { name: "oil", kind: Kind::Liquid, density: 80, slide: 0, roll: 0, spread: 4, fall: 4, pace: 0, level: true, conduct: 16, made: ROOM, latent: 0, warms: 0, toward: 0, airy: false, glow: 0, color: [92, 62, 30, 240], vary: [14, 10, 6], paint: true },
    Material { name: "lava", kind: Kind::Liquid, density: 200, slide: 0, roll: 0, spread: 2, fall: 3, pace: 96, level: false, conduct: 24, made: 250, latent: 0, warms: 0, toward: 0, airy: false, glow: 1, color: [226, 92, 28, 255], vary: [58, 110, 40], paint: true },
    Material { name: "ice", kind: Kind::Solid, density: 255, slide: 0, roll: 0, spread: 0, fall: 0, pace: 0, level: false, conduct: 32, made: 0, latent: 0, warms: 0, toward: 0, airy: false, glow: 0, color: [176, 218, 240, 245], vary: [14, 12, 8], paint: true },
    Material { name: "smoke", kind: Kind::Gas, density: 3, slide: 0, roll: 0, spread: 3, fall: 1, pace: 0, level: false, conduct: 10, made: 90, latent: 0, warms: 0, toward: 0, airy: true, glow: 0, color: [70, 68, 72, 170], vary: [20, 20, 20], paint: true },
    Material { name: "fire", kind: Kind::Fire, density: 1, slide: 0, roll: 0, spread: 0, fall: 1, pace: 0, level: false, conduct: 32, made: 230, latent: 0, warms: -4, toward: 0, airy: true, glow: 1, color: [236, 116, 34, 255], vary: [40, 200, 80], paint: true },
    Material { name: "acid", kind: Kind::Liquid, density: 110, slide: 0, roll: 0, spread: 4, fall: 4, pace: 0, level: true, conduct: 28, made: ROOM, latent: 0, warms: 0, toward: 0, airy: false, glow: 0, color: [116, 214, 64, 230], vary: [20, 30, 14], paint: true },
    Material { name: "wet dirt", kind: Kind::Powder, density: 170, slide: 3, roll: 0, spread: 0, fall: 4, pace: 0, level: false, conduct: 12, made: ROOM, latent: 8, warms: 0, toward: 0, airy: false, glow: 0, color: [84, 58, 40, 255], vary: [18, 14, 10], paint: false },
    Material { name: "ember", kind: Kind::Solid, density: 255, slide: 0, roll: 0, spread: 0, fall: 0, pace: 0, level: false, conduct: 20, made: 200, latent: 0, warms: 16, toward: 200, airy: false, glow: 2, color: [196, 70, 26, 255], vary: [70, 80, 30], paint: false },
    Material { name: "ash", kind: Kind::Powder, density: 40, slide: 1, roll: 0, spread: 0, fall: 2, pace: 0, level: false, conduct: 6, made: ROOM, latent: 0, warms: 0, toward: 0, airy: true, glow: 0, color: [150, 146, 140, 255], vary: [24, 24, 24], paint: false },
];

/// In a reaction, a neighbor of any material that lets air in (`airy`).
pub const OPEN: u8 = 254;
/// In a reaction, no neighbor: the material changes on its own.
pub const ALONE: u8 = 253;
/// In a reaction, what the neighbor becomes when it stays as it was.
pub const SAME: u8 = 255;

/// How the temperatures of what a reaction makes are found. Neither way makes or takes heat
/// beyond `hot`.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum Heat {
    /// Each cell keeps its temperature, less what its new material stores more than its old one:
    /// ice that melts is that much cooler as water.
    Kept,
    /// The two cells share their heat evenly, less what the new materials store: the steam of
    /// water thrown on lava is as hot as the stone it leaves.
    Shared,
    /// What the neighbor becomes carries the cell's heat away, less what it stores more, and the
    /// cell takes the neighbor's: the steam that leaves drying dirt is as hot as the dirt was.
    Carried,
    /// As `Shared`, less this much heat, carried off by what the line says escapes: the steam that
    /// boils out of wet dirt under lava and away through the ground.
    Lost(u8),
}

/// One line of what a material becomes: the cell `a`, when its temperature is from `above` to
/// `below`, alone or beside a neighbor `b` on one of its four sides, by `chance` in 1024 each step,
/// becomes `a_becomes` and the neighbor `b_becomes`.
pub struct Reaction {
    /// The cell.
    pub a: u8,
    /// Its neighbor: a material, `OPEN` for anything airy, or `ALONE`.
    pub b: u8,
    /// The coldest the cell may be for it to happen.
    pub above: u8,
    /// The hottest the cell may be for it to happen.
    pub below: u8,
    /// What the cell becomes.
    pub a_becomes: u8,
    /// What the neighbor becomes, or `SAME`.
    pub b_becomes: u8,
    /// How likely it is in one step, in 1024ths; `ALWAYS` is every time.
    pub chance: u16,
    /// How the temperatures after are found.
    pub heat: Heat,
    /// Heat made: what catches fire starts at least this hot (the neighbor if it changes, else the
    /// cell). 0 makes none.
    pub hot: u8,
    /// Whether the cell must be at rest, not falling: lava hardens where it lands, not in the air.
    pub resting: bool,
}

/// The chance of a line that happens every time its cell is visited and can.
pub const ALWAYS: u16 = 1024;

/// A line of `REACTIONS`, written short.
#[allow(clippy::too_many_arguments)]
const fn line(a: u8, b: u8, above: u8, below: u8, a_becomes: u8, b_becomes: u8, chance: u16, heat: Heat, hot: u8) -> Reaction {
    Reaction { a, b, above, below, a_becomes, b_becomes, chance, heat, hot, resting: false }
}

/// A line of `REACTIONS` for a cell at rest only.
const fn resting(line: Reaction) -> Reaction {
    Reaction { resting: true, ..line }
}

/// Every reaction, those of one material together. A cell tries its lines in order each step and
/// the first that happens is the one; a line with a neighbor picks one of the four sides by chance
/// among those that match.
pub const REACTIONS: &[Reaction] = &[
    // water freezes when cold and boils when hot; what melting and boiling store is given back
    line(WATER, ALONE, 0, 12, ICE, SAME, ALWAYS, Heat::Kept, 0),
    line(WATER, ALONE, 80, 255, STEAM, SAME, ALWAYS, Heat::Kept, 0),
    // dirt soaks up the water it touches, one cell of water to one of dirt
    line(DIRT, WATER, 0, 255, WET_DIRT, EMPTY, 96, Heat::Shared, 0),
    // steam that cools turns back to water
    line(STEAM, ALONE, 0, 56, WATER, SAME, ALWAYS, Heat::Kept, 0),
    // wood hot enough, with air beside it, catches fire
    line(WOOD, OPEN, 90, 255, EMBER, SAME, 384, Heat::Kept, 0),
    // lava lights what burns where it touches it
    line(WOOD, LAVA, 0, 255, EMBER, SAME, 64, Heat::Kept, 0),
    // oil hot enough, with air beside it, bursts into flame; a flame lights the oil it touches
    line(OIL, OPEN, 85, 255, FIRE, SAME, 512, Heat::Kept, 230),
    line(OIL, LAVA, 0, 255, FIRE, SAME, 256, Heat::Kept, 230),
    // lava that cools hardens where it comes to rest; water on it hardens it and boils away
    resting(line(LAVA, ALONE, 0, 100, STONE, SAME, ALWAYS, Heat::Kept, 0)),
    line(LAVA, WATER, 0, 255, STONE, STEAM, 640, Heat::Shared, 0),
    // ice that warms melts
    line(ICE, ALONE, 28, 255, WATER, SAME, ALWAYS, Heat::Kept, 0),
    // smoke thins to nothing
    line(SMOKE, ALONE, 0, 255, EMPTY, SAME, 12, Heat::Kept, 0),
    // a flame that has cooled dies, some of it to smoke; water puts it out with a hiss of steam
    line(FIRE, ALONE, 0, 60, EMPTY, SAME, ALWAYS, Heat::Kept, 0),
    line(FIRE, ALONE, 0, 90, SMOKE, SAME, 160, Heat::Kept, 0),
    line(FIRE, WATER, 0, 255, EMPTY, STEAM, 640, Heat::Shared, 0),
    line(FIRE, OIL, 0, 255, SAME, FIRE, ALWAYS, Heat::Kept, 230),
    // acid eats stone, wood and dirt, a cell for a cell, and goes up in fumes
    line(ACID, STONE, 0, 255, SMOKE, EMPTY, 24, Heat::Kept, 0),
    line(ACID, WOOD, 0, 255, SMOKE, EMPTY, 32, Heat::Kept, 0),
    line(ACID, DIRT, 0, 255, SMOKE, EMPTY, 40, Heat::Kept, 0),
    line(ACID, WET_DIRT, 0, 255, SMOKE, EMPTY, 40, Heat::Kept, 0),
    // wet dirt that is hot dries, its water going up as steam into the air beside it
    line(WET_DIRT, EMPTY, 78, 255, DIRT, STEAM, 256, Heat::Carried, 0),
    // lava pressed against wet dirt hardens, boiling the water out of the dirt; that steam escapes
    // through the ground, taking its heat with it
    line(WET_DIRT, LAVA, 0, 255, DIRT, STONE, 128, Heat::Lost(90), 0),
    // burning wood gives off flames into the air beside it, burns away to smoke and now and then
    // to ash, and is put out by water
    line(EMBER, WATER, 0, 255, WOOD, STEAM, 512, Heat::Shared, 0),
    line(EMBER, ALONE, 0, 255, SMOKE, SAME, 4, Heat::Kept, 0),
    line(EMBER, ALONE, 0, 255, ASH, SAME, 2, Heat::Kept, 0),
    line(EMBER, EMPTY, 0, 255, SAME, FIRE, 256, Heat::Kept, 230),
];

/// The reactions of `a` beside `b` (with `b` a material), in the order they are tried.
pub fn reactions(a: u8, b: u8) -> impl Iterator<Item = &'static Reaction> {
    let (start, end) = LINES[a as usize];
    REACTIONS[start as usize..end as usize].iter().filter(move |line| line.b == b || (line.b == OPEN && MATERIALS.get(b as usize).is_some_and(|m| m.airy)))
}

/// What each line does to the count of each material: -1 for what is used, +1 for what is made.
/// `SAME`, and a neighbor that is any airy material, are left out, as they do not change.
pub fn changes(line: &Reaction) -> [(u8, i32); 4] {
    let mut out = [(EMPTY, 0); 4];
    out[0] = (line.a, -1);
    out[1] = (if line.a_becomes == SAME { line.a } else { line.a_becomes }, 1);
    if line.b_becomes != SAME {
        out[2] = (line.b, -1);
        out[3] = (line.b_becomes, 1);
    }
    out
}

/// Where each material's lines begin and end in `REACTIONS`.
pub(crate) static LINES: [(u16, u16); 256] = lines();

const fn lines() -> [(u16, u16); 256] {
    let mut out = [(0u16, 0u16); 256];
    let mut at = 0;
    while at < REACTIONS.len() {
        let a = REACTIONS[at].a as usize;
        assert!(out[a].1 == 0 || out[a].1 as usize == at, "the lines of one material must be together");
        if out[a].1 == 0 {
            out[a].0 = at as u16;
        }
        out[a].1 = at as u16 + 1;
        at += 1;
    }
    out
}

/// What the step needs to know of a material, kept small and looked up by number.
#[derive(Clone, Copy)]
pub(crate) struct Props {
    pub kind: Kind,
    pub density: u8,
    pub slide: u8,
    pub roll: u8,
    pub spread: u8,
    pub fall: u8,
    pub pace: u8,
    pub level: bool,
    /// Whether a visit has anything to do besides moving it: lines, or a shade that follows heat.
    pub acts: bool,
    /// The temperatures, around room temperature, at which none of its lines can happen: water
    /// between freezing and boiling. A visit there skips its lines. Empty when it glows.
    pub calm_from: u8,
    pub calm_to: u8,
    pub glow: u8,
    pub airy: bool,
}

/// `Props` for every number a cell can hold. Numbers with no material are solid, so a cell can
/// never be moved by mistake.
pub(crate) static TABLE: [Props; 256] = table();

const fn table() -> [Props; 256] {
    let mut out = [Props { kind: Kind::Solid, density: 255, slide: 0, roll: 0, spread: 0, fall: 0, pace: 0, level: false, acts: false, calm_from: 1, calm_to: 0, glow: 0, airy: false }; 256];
    let mut at = 0;
    while at < MATERIALS.len() {
        let m = &MATERIALS[at];
        let acts = LINES[at].1 > LINES[at].0 || m.glow != 0;
        let (calm_from, calm_to) = if m.glow != 0 { (1, 0) } else { calm(at) };
        out[at] = Props { kind: m.kind, density: m.density, slide: m.slide, roll: m.roll, spread: m.spread, fall: m.fall, pace: m.pace, level: m.level, acts, calm_from, calm_to, glow: m.glow, airy: m.airy };
        at += 1;
    }
    out
}

/// The widest stretch of temperatures around room temperature at which no line of material `m`
/// can happen; empty if one can at room temperature.
const fn calm(m: usize) -> (u8, u8) {
    let (mut from, mut to) = (0i32, 255i32);
    let mut k = LINES[m].0 as usize;
    while k < LINES[m].1 as usize {
        let (above, below) = (REACTIONS[k].above as i32, REACTIONS[k].below as i32);
        if above <= ROOM as i32 && ROOM as i32 <= below {
            return (1, 0);
        }
        if below < ROOM as i32 && below >= from {
            from = below + 1;
        }
        if above > ROOM as i32 && above <= to {
            to = above - 1;
        }
        k += 1;
    }
    (from as u8, to as u8)
}

/// What the heat pass needs of a material: how it conducts, whether hot cells of it pass heat
/// upward faster (it can flow), and how it warms or cools itself.
#[derive(Clone, Copy)]
pub(crate) struct Warmth {
    pub conduct: i32,
    pub flows: bool,
    pub warms: i32,
    pub toward: i32,
}

/// `Warmth` for every number a cell can hold; numbers with no material hold no heat.
pub(crate) static WARMTH: [Warmth; 256] = warmth();

const fn warmth() -> [Warmth; 256] {
    let mut out = [Warmth { conduct: 0, flows: false, warms: 0, toward: 0 }; 256];
    let mut at = 0;
    while at < MATERIALS.len() {
        let m = &MATERIALS[at];
        let flows = matches!(m.kind, Kind::Empty | Kind::Liquid | Kind::Gas | Kind::Fire);
        out[at] = Warmth { conduct: m.conduct as i32, flows, warms: m.warms as i32, toward: m.toward as i32 };
        at += 1;
    }
    out
}

/// The heat a material stores beyond its temperature, by number.
pub(crate) static LATENT: [u8; 256] = latent();

const fn latent() -> [u8; 256] {
    let mut out = [0u8; 256];
    let mut at = 0;
    while at < MATERIALS.len() {
        out[at] = MATERIALS[at].latent;
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

/// The farthest up or down any rule looks from a cell: a powder looks as many cells under its side
/// as it needs open to slide, and nothing else looks farther than 2.
pub(crate) const fn deepest() -> i32 {
    let mut most = 2;
    let mut at = 0;
    while at < MATERIALS.len() {
        if MATERIALS[at].kind as u8 == Kind::Powder as u8 && MATERIALS[at].slide as i32 > most {
            most = MATERIALS[at].slide as i32;
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
        let named = [
            (EMPTY, "empty"),
            (SAND, "sand"),
            (WATER, "water"),
            (STONE, "stone"),
            (DIRT, "dirt"),
            (STEAM, "steam"),
            (WALL, "wall"),
            (VOID, "void"),
            (WOOD, "wood"),
            (OIL, "oil"),
            (LAVA, "lava"),
            (ICE, "ice"),
            (SMOKE, "smoke"),
            (FIRE, "fire"),
            (ACID, "acid"),
            (WET_DIRT, "wet dirt"),
            (EMBER, "ember"),
            (ASH, "ash"),
        ];
        for (number, name) in named {
            assert_eq!(MATERIALS[number as usize].name, name);
        }
        assert_eq!(named.len(), MATERIALS.len());
        assert_eq!(MATERIALS[EMPTY as usize].kind, Kind::Empty);
    }

    #[test]
    fn heavier_things_sink_through_lighter_ones() {
        let density = |m: u8| MATERIALS[m as usize].density;
        assert!(density(SAND) > density(WATER) && density(DIRT) > density(WATER));
        assert!(density(WATER) > density(OIL), "oil floats on water");
        assert!(density(ACID) > density(WATER) && density(LAVA) > density(ACID));
        assert!(density(WATER) > density(STEAM) && density(STEAM) > density(SMOKE) && density(SMOKE) > density(FIRE) && density(FIRE) > density(EMPTY));
        assert!(density(ASH) < density(OIL), "ash floats");
    }

    #[test]
    fn every_line_names_materials_that_exist_and_ones_of_a_material_are_together() {
        let real = |m: u8| (m as usize) < MATERIALS.len();
        for line in REACTIONS {
            assert!(real(line.a) && (real(line.b) || line.b == OPEN || line.b == ALONE));
            assert!(real(line.a_becomes) || line.a_becomes == SAME);
            assert!(real(line.b_becomes) || line.b_becomes == SAME);
            assert!(line.b != ALONE || line.b_becomes == SAME, "a change on its own has no neighbor to change");
            assert!(line.b != OPEN || line.b_becomes == SAME, "anything airy is left as it is");
            assert!(line.chance >= 1 && line.chance <= ALWAYS && line.above <= line.below);
        }
        for (m, &(start, end)) in LINES.iter().enumerate().take(MATERIALS.len()) {
            assert!(REACTIONS[start as usize..end as usize].iter().all(|line| line.a as usize == m));
            assert_eq!((end - start) as usize, REACTIONS.iter().filter(|line| line.a as usize == m).count());
        }
    }

    #[test]
    fn the_reactions_named_in_the_plan_are_lines_of_the_table() {
        let one = |a: u8, b: u8| reactions(a, b).next().map(|line| (line.a_becomes, line.b_becomes));
        assert_eq!(one(LAVA, WATER), Some((STONE, STEAM)), "lava and water make stone and steam");
        assert_eq!(one(FIRE, WATER), Some((EMPTY, STEAM)), "water puts out fire with steam");
        assert_eq!(one(DIRT, WATER), Some((WET_DIRT, EMPTY)), "dirt and water make wet dirt");
        assert_eq!(one(WOOD, EMPTY), Some((EMBER, SAME)), "wood burns where air reaches it");
        assert_eq!(one(WOOD, ASH), Some((EMBER, SAME)), "ash lets air through");
        assert_eq!(one(WOOD, WATER), None, "water keeps air away");
        for eaten in [STONE, WOOD, DIRT] {
            assert_eq!(one(ACID, eaten), Some((SMOKE, EMPTY)), "acid eats {eaten} and is used up");
        }
        assert_eq!(one(ACID, SAND), None);
    }

    #[test]
    fn each_line_says_what_it_uses_and_makes() {
        let burn = reactions(LAVA, WATER).next().unwrap();
        let mut sum = [0i32; 32];
        for (m, by) in changes(burn) {
            sum[m as usize] += by;
        }
        assert_eq!((sum[LAVA as usize], sum[WATER as usize], sum[STONE as usize], sum[STEAM as usize]), (-1, -1, 1, 1));
        let flame = reactions(EMBER, EMPTY).next().unwrap();
        let mut sum = [0i32; 32];
        for (m, by) in changes(flame) {
            sum[m as usize] += by;
        }
        assert_eq!((sum[EMBER as usize], sum[EMPTY as usize], sum[FIRE as usize]), (0, -1, 1), "a flame is made from the air");
    }

    #[test]
    fn freezing_melting_boiling_and_condensing_never_undo_each_other_at_once() {
        // a cell changed by one line must not be at a temperature where the reverse line takes it back
        for line in REACTIONS.iter().filter(|line| line.b == ALONE && line.heat == Heat::Kept) {
            let moved = LATENT[line.a_becomes as usize] as i32 - LATENT[line.a as usize] as i32;
            for t in line.above as i32..=line.below as i32 {
                let after = t - moved;
                if moved != 0 {
                    assert!((0..=255).contains(&after), "{} at {t}", MATERIALS[line.a as usize].name);
                }
                for back in reactions(line.a_becomes, ALONE).filter(|back| back.a_becomes == line.a) {
                    assert!(after < back.above as i32 || after > back.below as i32, "{} at {t} flips back", MATERIALS[line.a as usize].name);
                }
            }
        }
    }

    #[test]
    fn water_is_calm_between_freezing_and_boiling_and_what_reacts_at_room_temperature_never_is() {
        let p = TABLE[WATER as usize];
        assert_eq!((p.calm_from, p.calm_to), (13, 79));
        assert!(TABLE[ICE as usize].calm_from > TABLE[ICE as usize].calm_to, "ice melts at room temperature");
        for m in [DIRT, ACID, SMOKE, FIRE, LAVA, EMBER] {
            assert!(TABLE[m as usize].calm_from > TABLE[m as usize].calm_to, "{}", MATERIALS[m as usize].name);
        }
        // no line of any material can happen inside its calm stretch
        for line in REACTIONS {
            let p = TABLE[line.a as usize];
            assert!(p.calm_from > p.calm_to || line.below < p.calm_from || line.above > p.calm_to);
        }
    }

    #[test]
    fn numbers_with_no_material_never_move_and_hold_no_heat() {
        assert_eq!(TABLE[200].kind, Kind::Solid);
        assert_eq!(WARMTH[200].conduct, 0);
        assert_eq!(TABLE[SAND as usize].kind, Kind::Powder);
        assert!(!TABLE[STONE as usize].acts && TABLE[WATER as usize].acts && TABLE[FIRE as usize].acts);
    }

    #[test]
    fn heat_crosses_no_faster_than_the_pass_can_hold_steady() {
        // four sides at the most each, doubled upward, stay within half of a cell's heat a step
        for m in MATERIALS {
            assert!(m.conduct <= 32, "{}", m.name);
        }
        assert_eq!(WARMTH[WALL as usize].conduct, 0);
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
