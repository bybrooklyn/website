// The dice tower that the Table mini rolls in: the dice, the tower and the
// tray as solid things, and a roll run to its end, on Mote's own 3D physics
// (space.ts). Kept apart from the drawing so that a roll can be run, and
// tested, without a screen.

import { Space, angled, turn, type Solid } from "../mote/space";
import { apply, cube, diamond, normals, pyramid, ten, twelve, twenty, type Mesh, type V3 } from "../mote/solids";

export type Sides = 4 | 6 | 8 | 10 | 12 | 20;
export const SIDES: Sides[] = [4, 6, 8, 10, 12, 20];

/** How big a die is beside the tower. */
const SCALE = 0.42;
const small = (mesh: Mesh): Mesh => ({ faces: mesh.faces, points: mesh.points.map(([x, y, z]): V3 => [x * SCALE, y * SCALE, z * SCALE]) });
export const SHAPES: Record<Sides, Mesh> = { 4: small(pyramid()), 6: small(cube()), 8: small(diamond()), 10: small(ten()), 12: small(twelve()), 20: small(twenty()) };
const OUT: Record<Sides, V3[]> = Object.fromEntries(SIDES.map((sides) => [sides, normals(SHAPES[sides])])) as Record<Sides, V3[]>;

/** The tower stands at the left of the tray. These are its edges, in units. */
export const TOWER = { left: -5.6, right: -1, deep: 1.25, top: 8.6 };
export const TRAY = { left: -5.6, right: 6.4, deep: 3, rim: 0.8 };
/** How high the opening at the foot of the tower is. */
export const OPENING = 4.2;
/** How thick a wall or a ramp is. */
export const THICK = 0.16;

/** A slab: where its middle is, half its size each way, and how far it is tipped about the axis that runs front to back. */
export interface Slab {
    at: V3;
    half: V3;
    tip: number;
    /** What it is, for drawing: the tray, the tower's walls, a ramp, the tower's open face (which is there, and is drawn as glass), or something there but not drawn. */
    kind: "tray" | "wall" | "ramp" | "glass" | "unseen";
}

const ramp = (highX: number, highY: number, lowX: number, drop: number): Slab => {
    const [dx, dy] = [lowX - highX, -drop * Math.abs(lowX - highX)];
    return { at: [(highX + lowX) / 2, highY + dy / 2, 0], half: [Math.hypot(dx, dy) / 2, THICK / 2, TOWER.deep], tip: Math.atan2(dy, dx), kind: "ramp" };
};
const tall = TOWER.top + 2.4;

/** Everything that does not move. */
export const SLABS: Slab[] = [
    // the tray's four sides
    { at: [(TRAY.left + TRAY.right) / 2, TRAY.rim / 2, -TRAY.deep], half: [(TRAY.right - TRAY.left) / 2, TRAY.rim / 2, THICK / 2], tip: 0, kind: "tray" },
    { at: [(TRAY.left + TRAY.right) / 2, TRAY.rim / 2, TRAY.deep], half: [(TRAY.right - TRAY.left) / 2, TRAY.rim / 2, THICK / 2], tip: 0, kind: "tray" },
    { at: [TRAY.left, TRAY.rim / 2, 0], half: [THICK / 2, TRAY.rim / 2, TRAY.deep], tip: 0, kind: "tray" },
    { at: [TRAY.right, TRAY.rim / 2, 0], half: [THICK / 2, TRAY.rim / 2, TRAY.deep], tip: 0, kind: "tray" },
    // above the tray's sides, walls that are not drawn: a die that bounces high still comes back
    { at: [(TRAY.left + TRAY.right) / 2, 4, -TRAY.deep - THICK], half: [(TRAY.right - TRAY.left) / 2, 4, THICK / 2], tip: 0, kind: "unseen" },
    { at: [(TRAY.left + TRAY.right) / 2, 4, TRAY.deep + THICK], half: [(TRAY.right - TRAY.left) / 2, 4, THICK / 2], tip: 0, kind: "unseen" },
    { at: [TRAY.right + THICK, 4, 0], half: [THICK / 2, 4, TRAY.deep], tip: 0, kind: "unseen" },
    // the tower: back, left side, the side over the opening, and the open face
    { at: [(TOWER.left + TOWER.right) / 2, tall / 2, -TOWER.deep], half: [(TOWER.right - TOWER.left) / 2, tall / 2, THICK / 2], tip: 0, kind: "wall" },
    { at: [TOWER.left, tall / 2, 0], half: [THICK / 2, tall / 2, TOWER.deep], tip: 0, kind: "wall" },
    { at: [TOWER.right, (tall + OPENING) / 2, 0], half: [THICK / 2, (tall - OPENING) / 2, TOWER.deep], tip: 0, kind: "wall" },
    { at: [(TOWER.left + TOWER.right) / 2, tall / 2, TOWER.deep], half: [(TOWER.right - TOWER.left) / 2, tall / 2, THICK / 2], tip: 0, kind: "glass" },
    // Two ramps: one down to the left from the right wall, and under its end one down to the right and
    // out of the opening. Under the end of the first, and under the top of the opening, there is room
    // for one die riding on another, so that a handful cannot jam.
    ramp(TOWER.right, 7.7, -3.7, 0.7),
    ramp(TOWER.left, 4.1, TOWER.right + 0.6, 0.62),
];

export interface Die {
    sides: Sides;
    body: Solid;
}

export interface Throw {
    dice: Die[];
    space: Space;
    /** Moves the dice on by `dt` seconds. */
    step(dt: number): void;
    /** Whether every die has come to rest. */
    done(): boolean;
    /** What each die shows. */
    values(): number[];
}

/** How much the dice and the tower rub, and how much of its speed a die keeps when it hits something. */
const RUB = 0.35;
const BOUNCE = 0.3;

/** Drops these dice in at the top of the tower, one above another, each turned and spun its own way. `random` gives numbers from 0 to 1. */
export function throwDice(kinds: Sides[], random: () => number = Math.random): Throw {
    const between = (low: number, high: number) => low + random() * (high - low);
    const space = new Space();
    // the floor of the tray, and under the tower: felt, which a die grips and tumbles on and does not skate across
    space.slab([0, -1, 0], [30, 1, 30], undefined, { friction: 1.1 });
    for (const slab of SLABS) space.slab(slab.at, slab.half, angled(0, 0, slab.tip), { friction: RUB });

    const dice = kinds.map((sides, index): Die => {
        const body = space.solid(
            SHAPES[sides],
            [between(-2.9, -1.9), TOWER.top + 0.6 + index * 1.4, between(-0.5, 0.5)],
            { friction: RUB, bounce: BOUNCE },
            angled(between(0, 6.28), between(0, 6.28), between(0, 6.28)),
        );
        body.v = [between(-1, 1), 0, between(-0.6, 0.6)];
        body.w = [between(-9, 9), between(-9, 9), between(-9, 9)];
        body.damping = 0.03;
        body.spinDamping = 0.25;
        return { sides, body };
    });

    let waited = 0;
    return {
        dice,
        space,
        step(dt) {
            waited += dt;
            space.step(dt);
        },
        // A die that will not lie still is not waited on for ever.
        done: () => waited > 20 || space.still(),
        values: () => dice.map(shown),
    };
}

/** The number a die shows. A four-sided die is read from the face it rests on; the rest from the face on top. */
export function shown(die: Die): number {
    const turned = turn(die.body);
    const ups = OUT[die.sides].map((normal) => apply(turned, normal)[1] * (die.sides === 4 ? -1 : 1));
    return ups.indexOf(Math.max(...ups)) + 1;
}

/** Rolls to the end without drawing anything, and returns what each die shows. */
export function roll(kinds: Sides[], random: () => number = Math.random): number[] {
    const thrown = throwDice(kinds, random);
    while (!thrown.done()) thrown.step(1 / 120);
    return thrown.values();
}
