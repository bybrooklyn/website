// The dice tower that the Table mini rolls in: the dice, the tower and the
// tray as solid things, and a roll run to its end. The solving is Mote's fork
// of cannon (forks/cannon). Kept apart from the drawing so that a roll can be
// run, and tested, without a screen.

import { Body, Box, ConvexPolyhedron, Plane, Quaternion, Vec3, World } from "../mote/forks/cannon/cannon.js";
import { cube, diamond, normals, pyramid, ten, twelve, twenty, type Mesh, type V3 } from "../mote/three";

export type Sides = 4 | 6 | 8 | 10 | 12 | 20;
export const SIDES: Sides[] = [4, 6, 8, 10, 12, 20];

/** How big a die is beside the tower. */
const SCALE = 0.42;
const small = (mesh: Mesh): Mesh => ({ faces: mesh.faces, points: mesh.points.map(([x, y, z]): V3 => [x * SCALE, y * SCALE, z * SCALE]) });
export const SHAPES: Record<Sides, Mesh> = { 4: small(pyramid()), 6: small(cube()), 8: small(diamond()), 10: small(ten()), 12: small(twelve()), 20: small(twenty()) };
const OUT: Record<Sides, V3[]> = Object.fromEntries(SIDES.map((sides) => [sides, normals(SHAPES[sides])])) as Record<Sides, V3[]>;

/** The tower stands at the left of the tray. These are its edges, in units. */
export const TOWER = { left: -5.6, right: -1, deep: 1.25, top: 9 };
export const TRAY = { left: -5.6, right: 4.6, deep: 3, rim: 0.8 };
/** How high the opening at the foot of the tower is. */
export const OPENING = 3.4;
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
    // three ramps, each with a gap at its low end: down to the right, to the left, and out of the opening
    // The gaps are wide enough for two dice at once, so a handful cannot jam.
    ramp(TOWER.left, 8.3, -3.1, 0.7),
    ramp(TOWER.right, 6.2, -3.5, 0.7),
    ramp(TOWER.left, 4.1, TOWER.right + 0.6, 0.62),
];

export interface Die {
    sides: Sides;
    body: Body;
}

export interface Throw {
    dice: Die[];
    /** Moves the dice on by `dt` seconds. */
    step(dt: number): void;
    /** Whether every die has come to rest. */
    done(): boolean;
    /** What each die shows. */
    values(): number[];
}

/** Drops these dice in at the top of the tower, one above another, each turned and spun its own way. `random` gives numbers from 0 to 1. */
export function throwDice(kinds: Sides[], random: () => number = Math.random): Throw {
    const between = (low: number, high: number) => low + random() * (high - low);
    const world = new World({ gravity: new Vec3(0, -34, 0), allowSleep: true });
    world.defaultContactMaterial.friction = 0.28;
    // One rub for each pair of things that touch, not one for every corner that does.
    (world as unknown as { narrowphase: { enableFrictionReduction: boolean } }).narrowphase.enableFrictionReduction = true;
    (world.solver as unknown as { iterations: number }).iterations = 14;

    const floor = new Body({ mass: 0, shape: new Plane() });
    floor.quaternion.setFromEuler(-Math.PI / 2, 0, 0);
    world.addBody(floor);
    for (const slab of SLABS) {
        const body = new Body({ mass: 0, shape: new Box(new Vec3(...slab.half)), position: new Vec3(...slab.at) });
        body.quaternion.setFromEuler(0, 0, slab.tip);
        world.addBody(body);
    }

    const dice = kinds.map((sides, index): Die => {
        const mesh = SHAPES[sides];
        const body = new Body({
            mass: 1,
            shape: new ConvexPolyhedron({ vertices: mesh.points.map((point) => new Vec3(...point)), faces: mesh.faces }),
            position: new Vec3(between(-5, -4), TOWER.top + 0.6 + index * 1.4, between(-0.5, 0.5)),
            angularDamping: 0.1,
            linearDamping: 0.03,
            sleepSpeedLimit: 0.5,
            sleepTimeLimit: 0.4,
        });
        body.quaternion.setFromEuler(between(0, 6.28), between(0, 6.28), between(0, 6.28));
        body.velocity.set(between(-1, 1), 0, between(-0.6, 0.6));
        body.angularVelocity.set(between(-9, 9), between(-9, 9), between(-9, 9));
        world.addBody(body);
        return { sides, body };
    });

    let waited = 0;
    return {
        dice,
        step(dt) {
            waited += dt;
            // in two parts, so that nothing passes through a ramp
            world.step(dt / 2);
            world.step(dt / 2);
            // A die that comes to a stop inside the tower, caught in a corner or against another, is not left
            // there: it is kept awake and given a tap, as you would tap a tower that a die had stuck in.
            for (const { body } of dice) {
                if (body.position.x > TOWER.right + 0.3) {
                    // Out in the tray and nearly stopped, a die is settled the rest of the way: this solver would
                    // otherwise leave one rocking on an edge for a long time.
                    if (body.position.y < 1 && body.velocity.length() < 1.5 && body.angularVelocity.length() < 3) {
                        body.velocity.scale(0.9, body.velocity);
                        body.angularVelocity.scale(0.9, body.angularVelocity);
                    }
                    continue;
                }
                body.wakeUp();
                if (body.velocity.length() < 0.4) {
                    body.velocity.set(between(1.5, 3) * (body.position.y > 5 && body.position.y < 7 ? -1 : 1), between(1, 2.5), between(-1, 1));
                    body.angularVelocity.set(between(-6, 6), between(-6, 6), between(-6, 6));
                }
            }
        },
        // A die that will not lie still is not waited on for ever.
        done: () => waited > 20 || dice.every((die) => die.body.sleepState === Body.SLEEPING),
        values: () => dice.map(shown),
    };
}

/** The number a die shows. A four-sided die is read from the face it rests on; the rest from the face on top. */
export function shown(die: Die): number {
    const turn = die.body.quaternion as Quaternion;
    const ups = OUT[die.sides].map((normal) => turn.vmult(new Vec3(...normal)).y * (die.sides === 4 ? -1 : 1));
    return ups.indexOf(Math.max(...ups)) + 1;
}

/** Rolls to the end without drawing anything, and returns what each die shows. */
export function roll(kinds: Sides[], random: () => number = Math.random): number[] {
    const thrown = throwDice(kinds, random);
    while (!thrown.done()) thrown.step(1 / 60);
    return thrown.values();
}
