// The points a piece is bent by in the marble run, as arithmetic: they keep one size on the screen at
// any distance, a fingertip's reach; this file says where they are on the screen, which one a pointer is
// on, how a drag of one moves it and what it snaps to, from the camera of orbit.ts. marbles.ts draws
// them. (A chosen piece has no other handles: it is moved by carrying it, and turned, raised, lowered
// and lengthened by the words of the column and their keys.)
//
//   const size = across(orbit, degrees, height, point);         // centimetres a pixel there
//   const shown = pointsLayout(orbit, degrees, width, height, points);
//   which(shown, x, y, "touch");                                // "point0", "point1" or nothing

import { eyeOf, project, ray, type Orbit } from "./orbit";
import type { V3 } from "../mote/solids";

/** How large a point is drawn on the screen, in pixels. */
export const ARROW = 74;
/** How near a pointer must be to a point to take it, in pixels: a fingertip's half width, and less for a mouse. */
export const REACH = { touch: 24, mouse: 13 };

/** A point a piece is bent by, by number. */
export type Handle = `point${number}`;

/** Which point a handle is, if it is one. */
export const pointOf = (handle: Handle | undefined): number | undefined => (handle?.startsWith("point") ? Number(handle.slice(5)) : undefined);

/** The axes, for the little axes in the corner of the scene. */
export const AXES: Record<"x" | "y" | "z", V3> = { x: [1, 0, 0], y: [0, 1, 0], z: [0, 0, 1] };

/** How many centimetres one pixel of the picture covers at a point of the scene, for a picture `height` pixels high. */
export function across(orbit: Orbit, degrees: number, height: number, p: V3): number {
    const eye = eyeOf(orbit);
    const back = [eye[0] - orbit.at[0], eye[1] - orbit.at[1], eye[2] - orbit.at[2]];
    const long = Math.hypot(back[0]!, back[1]!, back[2]!) || 1;
    const depth = ((eye[0] - p[0]) * back[0]! + (eye[1] - p[1]) * back[1]! + (eye[2] - p[2]) * back[2]!) / long;
    return (Math.max(1, depth) * 2 * Math.tan((degrees * Math.PI) / 360)) / Math.max(1, height);
}

/** Where the points of a piece being bent are on the screen, in pixels. */
export interface Shown {
    points: { x: number; y: number }[];
}

/** Where the points of a piece being bent are on the screen. */
export function pointsLayout(orbit: Orbit, degrees: number, width: number, height: number, points: V3[]): Shown {
    const aspect = width / Math.max(1, height);
    const screen = (p: V3) => {
        const seen = project(orbit, degrees, aspect, p);
        return seen && { x: ((seen.x + 1) / 2) * width, y: ((1 - seen.y) / 2) * height };
    };
    return { points: points.map((p) => screen(p) ?? { x: -1e6, y: -1e6 }) };
}

/** Which point a pointer at (x, y) takes, if any: the nearest, from a little further than a fingertip's half width, since points sit on the track. */
export function which(shown: Shown, x: number, y: number, kind: "touch" | "mouse"): Handle | undefined {
    let [nearest, least] = [-1, REACH[kind] * 1.25];
    for (let index = 0; index < shown.points.length; index++) {
        const d = Math.hypot(shown.points[index]!.x - x, shown.points[index]!.y - y);
        if (d < least) [nearest, least] = [index, d];
    }
    return nearest >= 0 ? `point${nearest}` : undefined;
}

/**
 * How far along an axis through `origin` a drag has gone, in centimetres, from the pointer at `from` to
 * `to` (each from -1 to 1 across the picture, y up): the nearest point of the axis to the line through
 * each, so that the piece stays under the pointer as nearly as the axis allows.
 */
export function along(orbit: Orbit, degrees: number, aspect: number, origin: V3, axis: V3, from: [number, number], to: [number, number]): number {
    const at = (x: number, y: number) => {
        const line = ray(orbit, degrees, aspect, x, y);
        // the nearest points of two lines, origin + axis s and from + way t
        const w0 = [origin[0] - line.from[0], origin[1] - line.from[1], origin[2] - line.from[2]];
        const b = axis[0] * line.way[0] + axis[1] * line.way[1] + axis[2] * line.way[2];
        const d = axis[0] * w0[0]! + axis[1] * w0[1]! + axis[2] * w0[2]!;
        const e = line.way[0] * w0[0]! + line.way[1] * w0[1]! + line.way[2] * w0[2]!;
        const under = 1 - b * b;
        // an axis that points at the eye gives nothing to go by
        if (under < 1e-6) return 0;
        return (b * e - d) / under;
    };
    return at(...to) - at(...from);
}

// ---- dragging a point a piece is bent by ----

/**
 * How a point is dragged, decided when the drag begins from how the view sees the point's two ways,
 * up and aside: in the plane of both where the view sees both well (then the point stays under the
 * pointer exactly), else along the one it sees, the other held. From straight above, up cannot be told
 * from staying still, so a point moves only aside; from the side of a piece, only up.
 */
export type Freedom = "both" | "up" | "aside";

/** How many of the picture's units (-1 to 1 across) a centimetre up and a centimetre aside of a point are, and the way each goes on the screen. */
function seenWays(orbit: Orbit, degrees: number, aspect: number, at: V3, up: V3, aside: V3) {
    const p = project(orbit, degrees, aspect, at);
    const u = project(orbit, degrees, aspect, [at[0] + up[0], at[1] + up[1], at[2] + up[2]]);
    const a = project(orbit, degrees, aspect, [at[0] + aside[0], at[1] + aside[1], at[2] + aside[2]]);
    if (!p || !u || !a) return undefined;
    // in the picture's units, but with x stretched by the aspect so that both axes count alike
    const su = [(u.x - p.x) * aspect, u.y - p.y];
    const sa = [(a.x - p.x) * aspect, a.y - p.y];
    return { su, sa, lu: Math.hypot(su[0]!, su[1]!), la: Math.hypot(sa[0]!, sa[1]!) };
}

/** How a drag of a point at `at` whose ways are `up` and `aside` (each of length one) is taken, from how the view sees them. */
export function freedomOf(orbit: Orbit, degrees: number, aspect: number, at: V3, up: V3, aside: V3): Freedom {
    const seen = seenWays(orbit, degrees, aspect, at, up, aside);
    if (!seen) return "both";
    const { su, sa, lu, la } = seen;
    const most = Math.max(lu, la, 1e-12);
    const sine = Math.abs(su[0]! * sa[1]! - su[1]! * sa[0]!) / Math.max(1e-12, lu * la);
    if (lu > most * 0.3 && la > most * 0.3 && sine > 0.35) return "both";
    return lu >= la ? "up" : "aside";
}

/**
 * How far a drag moves a point, in centimetres up and aside, from the pointer at `from` to `to` (each
 * from -1 to 1 across the picture, y up): where the pointer's line meets the plane of the point's two
 * ways, or the nearest point of the one way it is free along.
 */
export function dragged(orbit: Orbit, degrees: number, aspect: number, at: V3, up: V3, aside: V3, freedom: Freedom, from: [number, number], to: [number, number]): { up: number; aside: number } {
    if (freedom === "up") return { up: along(orbit, degrees, aspect, at, up, from, to), aside: 0 };
    if (freedom === "aside") return { up: 0, aside: along(orbit, degrees, aspect, at, aside, from, to) };
    const n: V3 = [up[1] * aside[2] - up[2] * aside[1], up[2] * aside[0] - up[0] * aside[2], up[0] * aside[1] - up[1] * aside[0]];
    const hit = (x: number, y: number): V3 | undefined => {
        const line = ray(orbit, degrees, aspect, x, y);
        const facing = line.way[0] * n[0] + line.way[1] * n[1] + line.way[2] * n[2];
        if (Math.abs(facing) < 1e-9) return undefined;
        const t = ((at[0] - line.from[0]) * n[0] + (at[1] - line.from[1]) * n[1] + (at[2] - line.from[2]) * n[2]) / facing;
        return [line.from[0] + line.way[0] * t, line.from[1] + line.way[1] * t, line.from[2] + line.way[2] * t];
    };
    const [a, b] = [hit(...from), hit(...to)];
    if (!a || !b) return { up: 0, aside: 0 };
    const d: V3 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
    return { up: d[0] * up[0] + d[1] * up[1] + d[2] * up[2], aside: d[0] * aside[0] + d[1] * aside[1] + d[2] * aside[2] };
}

/** Where a point's numbers may snap to, each way, in millimetres: the values it is drawn to, and what each is. */
export interface Snaps {
    up: { at: number; why: string }[];
    aside: { at: number; why: string }[];
}

/**
 * A point's numbers (millimetres up and aside) snapped: each way to the nearest of its snaps that is
 * within `reach` pixels on the screen (`pixels` says how many pixels a millimetre each way is there),
 * or left as it is. Each way snaps on its own, so a point can be level and free aside at once.
 */
export function snapped(wanted: { up: number; aside: number }, snaps: Snaps, pixels: { up: number; aside: number }, reach: number): { up: number; aside: number; why: string[] } {
    const why: string[] = [];
    const one = (value: number, options: { at: number; why: string }[], perMm: number) => {
        let best: { at: number; why: string; d: number } | undefined;
        for (const option of options) {
            const d = Math.abs(option.at - value) * perMm;
            if (d <= reach && (!best || d < best.d)) best = { ...option, d };
        }
        if (!best) return value;
        why.push(best.why);
        return best.at;
    };
    return { up: pixels.up > 0 ? one(wanted.up, snaps.up, pixels.up) : wanted.up, aside: pixels.aside > 0 ? one(wanted.aside, snaps.aside, pixels.aside) : wanted.aside, why };
}

/** How many pixels a millimetre up and a millimetre aside of a point are on a picture `width` by `height`. */
export function pixelsOf(orbit: Orbit, degrees: number, width: number, height: number, at: V3, up: V3, aside: V3): { up: number; aside: number } {
    const seen = seenWays(orbit, degrees, width / Math.max(1, height), at, up, aside);
    if (!seen) return { up: 0, aside: 0 };
    // the picture's units are half its height to a unit, and these are a centimetre's
    return { up: (seen.lu * height) / 2 / 10, aside: (seen.la * height) / 2 / 10 };
}
