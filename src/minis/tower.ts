// The dice tower that the Dice mini rolls in: the dice, the tower and the
// tray as solid things, and a roll run to its end, on Mote's own 3D physics
// (space.ts). Kept apart from the drawing so that a roll can be run, and
// tested, without a screen.

import { Space, angled, turn, type Solid } from "../mote/space";
import { apply, cube, diamond, normals, pyramid, ten, twelve, twenty, type Mesh, type V3 } from "../mote/solids";

export type Sides = 4 | 6 | 8 | 10 | 12 | 20;
export const SIDES: Sides[] = [4, 6, 8, 10, 12, 20];

/** How big a die is beside the tower. */
/**
 * How big each die is: the distance from its middle to a corner, in millimetres, as in an ordinary set
 * (a 16 mm cube, a twenty-sided die 20 mm from face to face, and the rest to match), and how many of
 * the tower's units a millimetre is.
 */
const CORNER: Record<Sides, number> = { 4: 11, 6: 13.9, 8: 11, 10: 11.5, 12: 11.6, 20: 12.6 };
const UNIT = 0.034;
const sized = (mesh: Mesh, sides: Sides): Mesh => {
    const now = Math.max(...mesh.points.map((point) => Math.hypot(...point)));
    const by = (CORNER[sides] * UNIT) / now;
    return { faces: mesh.faces, points: mesh.points.map(([x, y, z]): V3 => [x * by, y * by, z * by]) };
};
export const SHAPES: Record<Sides, Mesh> = { 4: sized(pyramid(), 4), 6: sized(cube(), 6), 8: sized(diamond(), 8), 10: sized(ten(), 10), 12: sized(twelve(), 12), 20: sized(twenty(), 20) };
const OUT: Record<Sides, V3[]> = Object.fromEntries(SIDES.map((sides) => [sides, normals(SHAPES[sides])])) as Record<Sides, V3[]>;

/** The tower stands at the left of the tray. These are its edges, in units. */
export const TOWER = { left: -5.6, right: -1, deep: 1.25, top: 8.6 };
export const TRAY = { left: -5.6, right: 6.4, deep: 3, rim: 0.8 };
export type Tray = { left: number; right: number; deep: number; rim: number };
/** The tray for this many dice: the usual one for a handful, longer and deeper for a crowd, so that each die has room to lie flat. */
export const trayFor = (count: number): Tray => ({ ...TRAY, right: TRAY.right + Math.max(0, count - 20) * 0.11, deep: Math.max(TRAY.deep, 2.4 + count / 30) });
/** How high the opening at the foot of the tower is. */
const OPENING = 4.2;
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
/** Half the width of a ridge. Higher, and a die can come to rest against one. */
const RIDGE = 0.045;
/** A low ridge across a ramp, at `x` along it: a square bar lying corner up on the ramp's face. */
const ridge = (highX: number, highY: number, drop: number, x: number): Slab => {
    const tip = Math.atan2(-drop * Math.abs(x - highX), x - highX);
    const y = highY - drop * Math.abs(x - highX);
    return { at: [x - Math.sin(tip) * (THICK / 2), y + Math.cos(tip) * (THICK / 2), 0], half: [RIDGE, RIDGE, TOWER.deep], tip: tip + Math.PI / 4, kind: "ramp" };
};
const tall = TOWER.top + 2.4;

/** Everything that does not move, around a tray of the size given. */
export const slabs = (TRAY: Tray): Slab[] => [
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
    // Ridges across the ramps: a die that is sliding trips on one and goes over, so no die gets down on one face.
    ridge(TOWER.right, 7.7, 0.7, -2.3),
    ridge(TOWER.left, 4.1, 0.62, -4.1),
    ridge(TOWER.left, 4.1, 0.62, -2.5),
];


export interface Die {
    sides: Sides;
    body: Solid;
    /** Not yet let into the tower. */
    waiting: boolean;
}

export interface Throw {
    dice: Die[];
    space: Space;
    /** The tray these dice roll out into, and everything that stands still around it. */
    tray: Tray;
    slabs: Slab[];
    /** Moves the dice on by `dt` seconds. */
    step(dt: number): void;
    /** Whether every die has come to rest. */
    done(): boolean;
    /** What each die shows. */
    values(): number[];
}

/** How much the dice and the tower rub, and how much of its speed a die keeps when it hits something. */
/**
 * How a throw goes. `rub` is how much the dice and the tower grip each other and `floor` how much the
 * tray's felt does; `bounce` is how much of its speed a die keeps when it hits something; `spin` is the
 * most a die is turning when it is dropped in, in radians a second about each axis, and `damp` how
 * quickly that dies away. With these a die makes about eight whole turns on its way to rest, and never
 * fewer than three.
 */
const TUNE = { rub: 0.4, bounce: 0.5, spin: 30, damp: 0.03, floor: 2, apart: 1.4, push: 1 };

/** How long after one die the next is let into the tower, in seconds. A stream goes down the ramps where a stack would wedge. */
const BETWEEN = 0.11;
/** How long past its turn a die waits for the top of the tower to be clear before it is let in anyway, in seconds. */
const STUCK = 3;

/** Lets these dice into the top of the tower one after another, each turned and spun its own way. `random` gives numbers from 0 to 1. */
export function throwDice(kinds: Sides[], random: () => number = Math.random): Throw {
    const between = (low: number, high: number) => low + random() * (high - low);
    const space = new Space();
    space.sleeps = true;
    const tray = trayFor(kinds.length);
    const still = slabs(tray);
    // the floor of the tray, and under the tower: felt, which a die grips and tumbles on and does not skate across
    space.slab([0, -1, 0], [40, 1, 40], undefined, { friction: TUNE.floor });
    for (const slab of still) space.slab(slab.at, slab.half, angled(0, 0, slab.tip), { friction: TUNE.rub });

    // each die waits far out of the way, and is put at the top of the tower when its turn comes
    const starts: V3[] = [];
    const dice = kinds.map((sides, index): Die => {
        starts.push([between(-2.9, -1.9), TOWER.top + 0.9, between(-0.5, 0.5)]);
        const body = space.solid(
            SHAPES[sides],
            [index * 4, 500, 0],
            { friction: TUNE.rub, bounce: TUNE.bounce },
            angled(between(0, 6.28), between(0, 6.28), between(0, 6.28)),
        );
        body.v = [between(-1, 1) * TUNE.push, 0, between(-0.6, 0.6) * TUNE.push];
        body.w = [between(-1, 1) * TUNE.spin, between(-1, 1) * TUNE.spin, between(-1, 1) * TUNE.spin];
        body.damping = 0.03;
        body.spinDamping = TUNE.damp;
        space.hold(body);
        return { sides, body, waiting: true };
    });

    let waited = 0;
    let [gone, last] = [0, 0];
    return {
        dice,
        space,
        tray,
        slabs: still,
        step(dt) {
            // the next die goes in once its turn has come and the one before has fallen clear of where it starts;
            // or, if one has stayed there, after a long wait all the same, so that the roll can still end
            const [next, start] = [dice[gone], starts[gone]];
            const clear = () => dice.every((die) => die.waiting || Math.hypot(die.body.p[0] - start![0], die.body.p[1] - start![1], die.body.p[2] - start![2]) > 1.5);
            if (next && start && waited >= gone * BETWEEN && (waited >= gone * BETWEEN + STUCK || clear())) {
                next.waiting = false;
                next.body.p = start;
                space.wake(next.body);
                [gone, last] = [gone + 1, waited];
            }
            waited += dt;
            space.step(dt);
        },
        // A die that will not lie still is not waited on for ever.
        done: () => gone === dice.length && (waited - last > 9 || space.still()),
        values: () => dice.map(shown),
    };
}

/**
 * The number a die shows: the face on top. A four-sided die has no face on top, so it is read as real
 * ones are, from the corner on top: its corners are numbered 1 to 4, and each face carries the numbers
 * of its three corners.
 */
export function shown(die: Die): number {
    const turned = turn(die.body);
    const ups = (die.sides === 4 ? SHAPES[4].points : OUT[die.sides]).map((direction) => apply(turned, direction)[1]);
    return ups.indexOf(Math.max(...ups)) + 1;
}

/** Rolls to the end without drawing anything, and returns what each die shows. */
export function roll(kinds: Sides[], random: () => number = Math.random): number[] {
    const thrown = throwDice(kinds, random);
    while (!thrown.done()) thrown.step(1 / 120);
    return thrown.values();
}
