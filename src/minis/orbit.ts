// The marble run's camera, as arithmetic: an eye that circles a point it looks at, turned about the
// upright and tipped over it, at a distance; the line through a point of the picture into the scene,
// to find what a finger is on; where a point of the scene is in the picture; a pan that keeps what was
// under the pointer under it; and the view that frames a whole run. It matches what gl.ts draws from
// `view.look(eye, at, degrees)`.
//
//   const eye = eyeOf(orbit);
//   const line = ray(orbit, 40, width / height, x, y);    // x and y from -1 to 1 across the picture
//   ground(line, 0);                                      // where it meets the level y = 0

import type { V3 } from "../mote/solids";

/** Where the camera is: the point it looks at, its turn about the upright and its tip over (radians), and how far off it is. */
export interface Orbit {
    at: V3;
    turn: number;
    tip: number;
    far: number;
}

/** How far the eye may tip, over the ground to nearly overhead, and how near and far it may be, in centimetres. */
export const TIP: [number, number] = [0.12, 1.45];
export const FAR: [number, number] = [18, 900];

/** A line into the scene: where it starts and the way it goes, of length one. */
export interface Ray {
    from: V3;
    way: V3;
}

const unit = (a: V3): V3 => {
    const long = Math.hypot(a[0], a[1], a[2]) || 1;
    return [a[0] / long, a[1] / long, a[2] / long];
};
const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const dot = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

/** Where the eye is. */
export function eyeOf(orbit: Orbit): V3 {
    const level = Math.cos(orbit.tip) * orbit.far;
    return [orbit.at[0] + Math.sin(orbit.turn) * level, orbit.at[1] + Math.sin(orbit.tip) * orbit.far, orbit.at[2] + Math.cos(orbit.turn) * level];
}

/** The eye's own right, up and back, as gl.ts works them out. */
function axes(orbit: Orbit): [V3, V3, V3] {
    const back = unit(minus(eyeOf(orbit), orbit.at));
    const right = unit(cross(Math.abs(back[1]) > 0.999 ? [0, 0, -1] : [0, 1, 0], back));
    return [right, cross(back, right), back];
}
const minus = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];

/** The line from the eye through a point of the picture, `x` and `y` from -1 to 1 (y up), for a view `degrees` high and `aspect` wide for each unit high. */
export function ray(orbit: Orbit, degrees: number, aspect: number, x: number, y: number): Ray {
    const [right, up, back] = axes(orbit);
    const reach = Math.tan((degrees * Math.PI) / 360);
    const way = unit([-back[0] + right[0] * x * reach * aspect + up[0] * y * reach, -back[1] + right[1] * x * reach * aspect + up[1] * y * reach, -back[2] + right[2] * x * reach * aspect + up[2] * y * reach]);
    return { from: eyeOf(orbit), way };
}

/** Where a point of the scene is in the picture, x and y from -1 to 1, and how far in front of the eye; nothing if it is behind. */
export function project(orbit: Orbit, degrees: number, aspect: number, p: V3): { x: number; y: number; depth: number } | undefined {
    const [right, up, back] = axes(orbit);
    const d = minus(p, eyeOf(orbit));
    const depth = -dot(d, back);
    if (depth <= 1e-6) return undefined;
    const reach = Math.tan((degrees * Math.PI) / 360);
    return { x: dot(d, right) / (depth * reach * aspect), y: dot(d, up) / (depth * reach), depth };
}

/** Where a line meets the level plane at height `y`, going forward along it; nothing if it never does. */
export function ground(line: Ray, y: number): V3 | undefined {
    if (Math.abs(line.way[1]) < 1e-9) return undefined;
    const t = (y - line.from[1]) / line.way[1];
    if (t <= 0) return undefined;
    return [line.from[0] + line.way[0] * t, y, line.from[2] + line.way[2] * t];
}

/** How far along a line it first enters a box (by its middle and half its size), or nothing if it misses. */
export function enters(line: Ray, at: V3, half: V3): number | undefined {
    let [near, far] = [0, Infinity];
    for (let axis = 0; axis < 3; axis++) {
        const [from, way] = [line.from[axis]!, line.way[axis]!];
        const [low, high] = [at[axis]! - half[axis]!, at[axis]! + half[axis]!];
        if (Math.abs(way) < 1e-12) {
            if (from < low || from > high) return undefined;
            continue;
        }
        let [t0, t1] = [(low - from) / way, (high - from) / way];
        if (t0 > t1) [t0, t1] = [t1, t0];
        near = Math.max(near, t0);
        far = Math.min(far, t1);
        if (near > far) return undefined;
    }
    return near;
}

/** How far the views straight on may tip: level with the ground, and all but straight down (straight down has no way round). */
export const STRAIGHT: [number, number] = [0, Math.PI / 2 - 0.002];

/**
 * The camera kept within its limits: tipped no further than `TIP`, no nearer or further than `FAR`. Given
 * where it was, a camera already tipped past `TIP` by a view straight on may stay there and come back,
 * so that the first drag from the view from above does not jump; and one nearer than `FAR` allows, as a
 * camera riding a marble leaves it, may stay as near and draw back.
 */
export function kept(orbit: Orbit, was?: Orbit): Orbit {
    const low = Math.max(STRAIGHT[0], Math.min(TIP[0], was?.tip ?? TIP[0]));
    const high = Math.min(STRAIGHT[1], Math.max(TIP[1], was?.tip ?? TIP[1]));
    const near = Math.min(FAR[0], was?.far ?? FAR[0]);
    return { at: orbit.at, turn: orbit.turn, tip: Math.max(low, Math.min(high, orbit.tip)), far: Math.max(near, Math.min(FAR[1], orbit.far)) };
}

/** The views straight on: from above (the far side up the picture), from the front (looking along -z) and from the side (looking along -x). */
export const VIEWS = {
    top: { turn: 0, tip: STRAIGHT[1] },
    front: { turn: 0, tip: 0 },
    side: { turn: Math.PI / 2, tip: 0 },
} as const;

/** The name of a view straight on. */
export type Straight = keyof typeof VIEWS;

/** A turn about the upright the same as `goal`, but the nearest to `from`: so that turning to a view goes the short way round. */
export function nearest(from: number, goal: number): number {
    return goal + Math.round((from - goal) / (2 * Math.PI)) * 2 * Math.PI;
}

/** Which view straight on the camera is in, if it is, to within a hundredth of a radian. */
export function straightOn(orbit: Orbit): Straight | undefined {
    for (const [name, view] of Object.entries(VIEWS) as [Straight, (typeof VIEWS)[Straight]][]) {
        const turned = Math.abs(nearest(orbit.turn, view.turn) - orbit.turn) < 0.01;
        if (Math.abs(orbit.tip - view.tip) < 0.01 && (turned || name === "top")) return name;
    }
    return undefined;
}

/**
 * The narrow lens of the views straight on, in degrees, that is all but a drawing without depth: pieces
 * line up in it as on a plan. `lensed` moves the eye back so that what was seen at the point looked at
 * is the same size in it.
 */
export const NARROW = 5;
export function lensed(orbit: Orbit, from: number, to: number): Orbit {
    return { ...orbit, far: (orbit.far * Math.tan((from * Math.PI) / 360)) / Math.tan((to * Math.PI) / 360) };
}

/** What a pan holds under the pointer: the point of the scene it took hold of, and the plane that point is moved in, by the way the plane faces. */
export interface Grip {
    at: V3;
    facing: V3;
}

/**
 * Where a pan takes hold, pressed at (x, y) of the picture (from -1 to 1, y up): the point of the level
 * plane at `height` (the table) under the pointer, so that the table is moved in its own plane. Where
 * the eye looks along that plane, or all but along it (the views from the front and the side, the
 * pointer over the horizon), it is the point under the pointer of the plane facing the eye through
 * `through` (what is under the pointer, or else the point looked at), so that the picture is moved in
 * its own plane, up and down as well as across, and what is under the pointer stays under it.
 */
export function gripAt(orbit: Orbit, degrees: number, aspect: number, x: number, y: number, height = 0, through: V3 = orbit.at): Grip {
    const line = ray(orbit, degrees, aspect, x, y);
    const met = Math.abs(line.way[1]) > 0.05 ? ground(line, height) : undefined;
    // (a point met so far off that a small move of the pointer would carry the view away is not held either)
    if (met && Math.hypot(met[0] - line.from[0], met[1] - line.from[1], met[2] - line.from[2]) < orbit.far * 8) return { at: met, facing: [0, 1, 0] };
    const [, , back] = axes(orbit);
    const t = dot(minus(through, line.from), back) / dot(line.way, back);
    return { at: [line.from[0] + line.way[0] * t, line.from[1] + line.way[1] * t, line.from[2] + line.way[2] * t], facing: back };
}

/**
 * The camera moved, never turned or brought nearer, so that the point a pan holds is exactly under the
 * point (x, y) of the picture: the eye and the point looked at slide together in the grip's plane, by
 * just what puts the held point on the line through (x, y), which keeps its way as the eye slides. Left
 * as it is where that line never meets the plane (the pointer gone over the horizon).
 */
export function pannedTo(orbit: Orbit, degrees: number, aspect: number, grip: Grip, x: number, y: number): Orbit {
    const line = ray(orbit, degrees, aspect, x, y);
    const toward = dot(line.way, grip.facing);
    if (Math.abs(toward) < 1e-9) return orbit;
    const off = minus(grip.at, line.from);
    const t = dot(off, grip.facing) / toward;
    if (t <= 0) return orbit;
    // held on the table, the eye keeps its height exactly, with nothing of rounding to creep up or down
    const up = grip.facing[1] === 1 ? orbit.at[1] : orbit.at[1] + off[1] - line.way[1] * t;
    return { ...orbit, at: [orbit.at[0] + off[0] - line.way[0] * t, up, orbit.at[2] + off[2] - line.way[2] * t] };
}

/**
 * The camera brought nearer or further, to `far`, toward the point of the table under the point (x, y)
 * of the picture: that point stays under the pointer, as a pan would keep it (`gripAt`, `pannedTo`).
 */
export function zoomedAt(orbit: Orbit, degrees: number, aspect: number, x: number, y: number, far: number): Orbit {
    const grip = gripAt(orbit, degrees, aspect, x, y);
    return pannedTo({ ...orbit, far }, degrees, aspect, grip, x, y);
}

/** How far the keys move the view each second, as a share of how far off the eye is: so that the view goes as fast on the screen near and far. */
export const WALK = 0.9;

/**
 * The camera moved over the table for `seconds` by the keys held: `ahead` forward (1) or back (-1) and
 * `aside` right (1) or left (-1), as the camera sees them, along the ground, never up or down, at a speed
 * that suits how near the view is (`WALK`). Forward is the way the eye looks, along the ground; from
 * above, up the picture.
 */
export function walked(orbit: Orbit, ahead: number, aside: number, seconds: number): Orbit {
    const step = WALK * orbit.far * seconds;
    const [s, c] = [Math.sin(orbit.turn), Math.cos(orbit.turn)];
    const long = Math.hypot(ahead, aside) || 1;
    const [f, r] = [(ahead / long) * step, (aside / long) * step];
    return { ...orbit, at: [orbit.at[0] - s * f + c * r, orbit.at[1], orbit.at[2] - c * f - s * r] };
}

/** The camera that frames a box (by its least and greatest corners) from the way it now looks, with a little room round it. */
export function framing(orbit: Orbit, degrees: number, aspect: number, low: V3, high: V3): Orbit {
    const at: V3 = [(low[0] + high[0]) / 2, (low[1] + high[1]) / 2, (low[2] + high[2]) / 2];
    const radius = Math.hypot(high[0] - low[0], high[1] - low[1], high[2] - low[2]) / 2;
    const narrow = Math.min(Math.tan((degrees * Math.PI) / 360), Math.tan((degrees * Math.PI) / 360) * aspect);
    // as near as lets every corner be seen within nine tenths of the picture: far enough for the ball
    // round the box always does, and nearer is found by halving
    const seen = (far: number) => {
        let most = 0;
        for (const x of [low[0], high[0]]) for (const y of [low[1], high[1]]) for (const z of [low[2], high[2]]) {
            const p = project({ ...orbit, at, far }, degrees, aspect, [x, y, z]);
            most = Math.max(most, p ? Math.max(Math.abs(p.x), Math.abs(p.y)) : Infinity);
        }
        return most;
    };
    let [near, far] = [radius * 0.5, (radius * 1.12) / narrow];
    for (let go = 0; go < 30; go++) {
        const middle = (near + far) / 2;
        if (seen(middle) > 0.9) near = middle;
        else far = middle;
    }
    return kept({ ...orbit, at, far });
}
