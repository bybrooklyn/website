// The marble run's camera, as arithmetic: an eye that circles a point it looks at, turned about the
// upright and tipped over it, at a distance; the line through a point of the picture into the scene,
// to find what a finger is on; where a point of the scene is in the picture; and the view that frames
// a whole run. It matches what gl.ts draws from `view.look(eye, at, degrees)`.
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

/** The camera kept within its limits: tipped no further than `TIP`, no nearer or further than `FAR`. */
export function kept(orbit: Orbit): Orbit {
    return { at: orbit.at, turn: orbit.turn, tip: Math.max(TIP[0], Math.min(TIP[1], orbit.tip)), far: Math.max(FAR[0], Math.min(FAR[1], orbit.far)) };
}

/** Moved across the picture by (dx, dy), each a share of its height: the point looked at slides over the ground so that what was under the finger stays under it. */
export function panned(orbit: Orbit, degrees: number, dx: number, dy: number): Orbit {
    const reach = Math.tan((degrees * Math.PI) / 360) * orbit.far * 2;
    const [right] = axes(orbit);
    // across the ground, and away from the eye along the ground, so a drag up moves the view on
    const away = unit([-Math.sin(orbit.turn), 0, -Math.cos(orbit.turn)]);
    const level = unit([right[0], 0, right[2]]);
    // a drag up the picture covers more ground the lower the eye is tipped
    const along = dy / Math.max(0.25, Math.sin(orbit.tip));
    return { ...orbit, at: [orbit.at[0] - level[0] * dx * reach + away[0] * along * reach, orbit.at[1], orbit.at[2] - level[2] * dx * reach + away[2] * along * reach] };
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
