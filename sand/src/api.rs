//! What the page calls. Every function takes and gives plain numbers. The cells stay in the
//! module's memory: `cells` gives a pointer to the first, of the border's top left corner, and the
//! page reads them through a view over `memory.buffer`, `stride` cells to a row. Memory grows only
//! in `create`, so a view made after it stays good until the next `create`. README.md lists each
//! function.
//!
//! There is one world per module. A page wanting two instantiates the module twice.

use crate::Shared;
use crate::materials::{MATERIALS, PALETTE};
use crate::world::{BORDER, Edges, Order, World};

static WORLD: Shared<Option<World>> = Shared::new(None);

fn world() -> Option<&'static mut World> {
    WORLD.get().as_mut()
}

/// Makes a new, empty, walled world of `width` by `height` cells, whose chance comes from the seed
/// (two halves of 32 bits). Gives 1, or 0 for a size it will not make (each side 1 to 4096).
#[unsafe(no_mangle)]
pub extern "C" fn create(width: u32, height: u32, seed_low: u32, seed_high: u32) -> u32 {
    if !(1..=4096).contains(&width) || !(1..=4096).contains(&height) {
        return 0;
    }
    *WORLD.get() = None;
    *WORLD.get() = Some(World::new(width as i32, height as i32, (seed_high as u64) << 32 | seed_low as u64));
    1
}

/// Moves the world on by `count` steps.
#[unsafe(no_mangle)]
pub extern "C" fn step(count: u32) {
    if let Some(world) = world() {
        for _ in 0..count {
            world.step();
        }
    }
}

/// Paints a line of a material between two cells, `radius` cells either side, each cell filled by
/// a chance of `fill` in 100. Material 0 erases. With `replace` 1 it paints over what is there;
/// with 0 only into empty cells.
#[unsafe(no_mangle)]
#[allow(clippy::too_many_arguments)]
pub extern "C" fn paint(material: u32, x0: i32, y0: i32, x1: i32, y1: i32, radius: i32, fill: u32, replace: u32) {
    if let Some(world) = world()
        && (material as usize) < MATERIALS.len()
        && MATERIALS[material as usize].paint | (material == 0)
    {
        world.paint(material as u8, x0, y0, x1, y1, radius, fill.min(100), replace != 0);
    }
}

/// Empties the world.
#[unsafe(no_mangle)]
pub extern "C" fn clear() {
    if let Some(world) = world() {
        world.clear();
    }
}

/// Where the cells are: the byte offset of the border's top left cell.
#[unsafe(no_mangle)]
pub extern "C" fn cells() -> *const u32 {
    world().map_or(core::ptr::null(), |world| world.cells.as_ptr())
}

/// Cells from one row to the next, border included.
#[unsafe(no_mangle)]
pub extern "C" fn stride() -> u32 {
    world().map_or(0, |world| world.stride as u32)
}

/// How many cells of border lie around the world on each side.
#[unsafe(no_mangle)]
pub extern "C" fn border() -> u32 {
    BORDER as u32
}

/// The world's width in cells.
#[unsafe(no_mangle)]
pub extern "C" fn width() -> u32 {
    world().map_or(0, |world| world.width as u32)
}

/// The world's height in cells.
#[unsafe(no_mangle)]
pub extern "C" fn height() -> u32 {
    world().map_or(0, |world| world.height as u32)
}

/// How many chunks will be worked through next step: 0 when nothing is moving.
#[unsafe(no_mangle)]
pub extern "C" fn awake() -> u32 {
    world().map_or(0, |world| world.awake() as u32)
}

/// The first row changed since `forget_changed`, or -1 when none has.
#[unsafe(no_mangle)]
pub extern "C" fn changed_from() -> i32 {
    world().map_or(-1, |world| if world.changed().0 > world.changed().1 { -1 } else { world.changed().0 })
}

/// The last row changed since `forget_changed`, or -1 when none has.
#[unsafe(no_mangle)]
pub extern "C" fn changed_to() -> i32 {
    world().map_or(-1, |world| if world.changed().0 > world.changed().1 { -1 } else { world.changed().1 })
}

/// The page has drawn the rows that changed.
#[unsafe(no_mangle)]
pub extern "C" fn forget_changed() {
    if let Some(world) = world() {
        world.forget_changed();
    }
}

/// Whether chunks with nothing moving are left alone (1, as it starts) or every cell is reached
/// every step (0), which gives the same world more slowly.
#[unsafe(no_mangle)]
pub extern "C" fn set_sleeping(on: u32) {
    if let Some(world) = world() {
        world.sleeping = on != 0;
    }
}

/// Works through chunks row by row across the world (0, as it starts) or in a checkerboard of four
/// phases (1).
#[unsafe(no_mangle)]
pub extern "C" fn set_order(phases: u32) {
    if let Some(world) = world() {
        world.order = if phases != 0 { Order::Phases } else { Order::Rows };
    }
}

/// Walls at the edges (0, as it starts), or nothing, so what moves past them is gone (1).
#[unsafe(no_mangle)]
pub extern "C" fn set_edges(open: u32) {
    if let Some(world) = world() {
        world.set_edges(if open != 0 { Edges::Open } else { Edges::Walled });
    }
}

/// How many cells of a material there are.
#[unsafe(no_mangle)]
pub extern "C" fn count(material: u32) -> u32 {
    world().map_or(0, |world| if material < 256 { world.count(material as u8) as u32 } else { 0 })
}

/// Half of the world's fingerprint: the low 32 bits for `part` 0, the high for 1.
#[unsafe(no_mangle)]
pub extern "C" fn fingerprint(part: u32) -> u32 {
    world().map_or(0, |world| (world.fingerprint() >> if part == 0 { 0 } else { 32 }) as u32)
}

/// Steps taken since the world was made.
#[unsafe(no_mangle)]
pub extern "C" fn steps() -> u32 {
    world().map_or(0, |world| world.steps as u32)
}

/// How many materials there are, numbered from 0.
#[unsafe(no_mangle)]
pub extern "C" fn material_count() -> u32 {
    MATERIALS.len() as u32
}

/// Where a material's name is, as UTF-8 bytes; `name_length` gives how many.
#[unsafe(no_mangle)]
pub extern "C" fn name(material: u32) -> *const u8 {
    MATERIALS.get(material as usize).map_or(core::ptr::null(), |m| m.name.as_ptr())
}

/// How many bytes a material's name has.
#[unsafe(no_mangle)]
pub extern "C" fn name_length(material: u32) -> u32 {
    MATERIALS.get(material as usize).map_or(0, |m| m.name.len() as u32)
}

/// 1 if a material is offered to the brush.
#[unsafe(no_mangle)]
pub extern "C" fn paintable(material: u32) -> u32 {
    MATERIALS.get(material as usize).map_or(0, |m| m.paint as u32)
}

/// What kind a material is: 0 empty, 1 solid, 2 powder, 3 liquid, 4 gas, 5 void.
#[unsafe(no_mangle)]
pub extern "C" fn kind(material: u32) -> u32 {
    MATERIALS.get(material as usize).map_or(1, |m| m.kind as u32)
}

/// Where the colors are: 2048 bytes, two rows of 256 RGBA (`materials::PALETTE`).
#[unsafe(no_mangle)]
pub extern "C" fn palette() -> *const u8 {
    PALETTE.as_ptr()
}
