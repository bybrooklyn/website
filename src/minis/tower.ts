// The dice tower that the Table mini rolls in: the dice, the tower's ramps and
// the tray as flat surfaces, and a roll run to its end. Kept apart from the
// drawing so that a roll can be run, and tested, without a screen.

import { cube, diamond, facing, pyramid, settled, surface, ten, tumble, tumbler, twelve, twenty, type Mesh, type Surface, type Tumbler, type V3 } from "../mote";

export type Sides = 4 | 6 | 8 | 10 | 12 | 20;
export const SIDES: Sides[] = [4, 6, 8, 10, 12, 20];

/** How big a die is beside the tower. */
const SCALE = 0.42;
const small = (mesh: Mesh): Mesh => ({ faces: mesh.faces, points: mesh.points.map(([x, y, z]): V3 => [x * SCALE, y * SCALE, z * SCALE]) });
const shapes: Record<Sides, Mesh> = { 4: small(pyramid()), 6: small(cube()), 8: small(diamond()), 10: small(ten()), 12: small(twelve()), 20: small(twenty()) };

export interface Die extends Tumbler {
    sides: Sides;
}

/** The tower stands at the left of the tray. These are its edges, in units. */
export const TOWER = { left: -4.6, right: -1, deep: 1.1, top: 9 };
export const TRAY = { left: -4.6, right: 4.6, deep: 3 };
/** How high the opening at the foot of the tower is: tall enough that no die catches on its way out. */
export const OPENING = 3.5;

const inTower = (point: V3) => point[0] < TOWER.right - 0.05;
/** How much a ramp drops for each unit along it: steep enough that a four-sided die, which does not roll, still slides. */
const STEEP = 0.62;

/** Everything a die can land on or hit. */
export const surfaces: Surface[] = [
    surface([0, 1, 0], [0, 0, 0]),
    surface([1, 0, 0], [TRAY.left, 0, 0]),
    surface([-1, 0, 0], [TRAY.right, 0, 0]),
    surface([0, 0, 1], [0, 0, -TRAY.deep]),
    surface([0, 0, -1], [0, 0, TRAY.deep]),
    // the tower's sides, from inside, and its front above the opening
    surface([0, 0, 1], [0, 0, -TOWER.deep], inTower),
    surface([0, 0, -1], [0, 0, TOWER.deep], inTower),
    surface([-1, 0, 0], [TOWER.right, 0, 0], (point) => point[1] > OPENING),
    // and from outside: nothing in the tray gets in beside it
    surface([1, 0, 0], [TOWER.right, 0, 0], (point) => Math.abs(point[2]) > TOWER.deep),
    // three ramps, each with a gap at its low end: down to the right, to the left, and out
    surface([STEEP, 1, 0], [TOWER.left, 7.7, 0], (point) => point[0] < -2.5),
    surface([-STEEP, 1, 0], [TOWER.right, 5.6, 0], (point) => point[0] > -3.1 && inTower(point)),
    surface([STEEP, 1, 0], [TOWER.left, 3.3, 0], inTower),
];

/** The ramps as their two ends, for drawing: [x, y] at the high end and at the low end. */
export const RAMPS: [V3, V3][] = [
    [[TOWER.left, 7.7, 0], [-2.5, 7.7 - STEEP * 2.1, 0]],
    [[TOWER.right, 5.6, 0], [-3.1, 5.6 - STEEP * 2.1, 0]],
    [[TOWER.left, 3.3, 0], [TOWER.right, 3.3 - STEEP * 3.6, 0]],
];

/** Dice dropped in at the top, one above another, each with a spin of its own. `random` gives numbers from 0 to 1. */
export function drop(kinds: Sides[], random: () => number = Math.random): Die[] {
    const between = (low: number, high: number) => low + random() * (high - low);
    return kinds.map((sides, index) => {
        const die = tumbler(shapes[sides], [between(-4, -3.2), TOWER.top + index * 1.5, between(-0.4, 0.4)], [between(-1, 1), 0, between(-1, 1)], [between(-9, 9), between(-9, 9), between(-9, 9)]) as Die;
        die.sides = sides;
        return die;
    });
}

/** One sixtieth of a second, in four parts so that nothing passes through a ramp. */
export function advance(dice: Die[]): void {
    for (let part = 0; part < 4; part++) tumble(dice, surfaces, 1 / 240);
}

export const done = (dice: Die[]) => dice.every(settled);

/** The number a die shows. A four-sided die is read from the face it rests on; the rest from the face on top. */
export const shown = (die: Die) => facing(die, die.sides === 4) + 1;

/** What is written on a face. */
export const written = (face: number) => String(face + 1);

/** Rolls to the end without drawing anything, and returns what each die shows. Gives up after 20 seconds. */
export function roll(kinds: Sides[], random: () => number = Math.random): number[] {
    const dice = drop(kinds, random);
    for (let frame = 0; frame < 1200 && !done(dice); frame++) advance(dice);
    return dice.map(shown);
}
