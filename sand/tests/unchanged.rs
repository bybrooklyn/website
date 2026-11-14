//! The fingerprint of one busy world, made through the very functions the page calls, held to the
//! number it gave when it was taken. `src/minis/grains.test.ts` makes the same world in the built
//! WebAssembly modules, with and without SIMD, and holds them to the same number: so the browser
//! and this machine give the same cells to the byte. A change to the rules changes it on purpose,
//! and then both are taken again.

use sand::api::{count, create, fingerprint, paint, step};

/// What the strokes pour in turn: sand, water, dirt, steam, wood, oil, lava, ice, smoke, fire and acid.
const STROKES: [u32; 11] = [1, 2, 4, 5, 8, 9, 10, 11, 12, 13, 14];

/// The world: a cup of stone, twenty-two strokes of every material but stone, a hole erased, then
/// four hundred steps, so that heat and the reactions are in it as well as movement.
fn busy() -> (u32, u32) {
    assert_eq!(create(256, 160, 7, 0), 1);
    paint(3, 20, 150, 236, 150, 2, 100, 0);
    paint(3, 20, 150, 60, 100, 1, 100, 0);
    paint(3, 236, 150, 236, 90, 1, 100, 0);
    for k in 0..22 {
        paint(STROKES[k % STROKES.len()], 40 + k as i32 * 9, 10, 50 + k as i32 * 7, 30, 4, 60, 0);
        step(15);
    }
    paint(0, 100, 120, 140, 140, 6, 100, 0);
    step(400);
    (fingerprint(0), fingerprint(1))
}

#[test]
fn a_busy_world_comes_out_as_it_did_when_the_fingerprint_was_taken() {
    let made = busy();
    let counts: Vec<u32> = (0..18u32).map(|m| count(m)).collect();
    println!("fingerprint {:#010x} {:#010x}, counts {counts:?}", made.0, made.1);
    assert_eq!(made, (0x5201_c852, 0x1c6d_82ac));
}
