// The handles on what is selected in the marble run, as arithmetic and shapes: an arrow along each of
// the three axes to move it, a ring about the upright to turn it, and a knob at a piece's far end to make
// it longer or shorter. They keep one size on the screen at any distance, a fingertip's reach; this file
// says where they are on the screen, which one a pointer is on, and how far a drag along an arrow or round
// the ring has gone, from the camera of orbit.ts. marbles.ts draws them from the shapes here.
//
//   const size = across(orbit, degrees, height, middle);        // centimetres a pixel there
//   const shown = layout(orbit, degrees, width, height, middle, knob);
//   which(shown, x, y, "touch");                                // "x", "y", "z", "ring", "knob" or nothing
//   along(orbit, degrees, aspect, middle, [1, 0, 0], from, to); // centimetres a drag went along x

import { eyeOf, project, ray, type Orbit } from "./orbit";
import type { Mesh, V3 } from "../mote/solids";

/** How long an arrow is on the screen, in pixels, and how far from the middle it starts; the ring's radius. */
export const ARROW = 74;
export const GAP = 20;
export const RING = 54;
/** How near a pointer must be to a handle to take it, in pixels: a fingertip's half width, and less for a mouse. */
export const REACH = { touch: 24, mouse: 13 };

/** A handle: one of the arrows, the ring, or a piece's end knob. */
export type Handle = "x" | "y" | "z" | "ring" | "knob";

/** The axes the arrows point along. */
export const AXES: Record<"x" | "y" | "z", V3> = { x: [1, 0, 0], y: [0, 1, 0], z: [0, 0, 1] };

/** How many centimetres one pixel of the picture covers at a point of the scene, for a picture `height` pixels high. */
export function across(orbit: Orbit, degrees: number, height: number, p: V3): number {
    const eye = eyeOf(orbit);
    const back = [eye[0] - orbit.at[0], eye[1] - orbit.at[1], eye[2] - orbit.at[2]];
    const long = Math.hypot(back[0]!, back[1]!, back[2]!) || 1;
    const depth = ((eye[0] - p[0]) * back[0]! + (eye[1] - p[1]) * back[1]! + (eye[2] - p[2]) * back[2]!) / long;
    return (Math.max(1, depth) * 2 * Math.tan((degrees * Math.PI) / 360)) / Math.max(1, height);
}

/** Where the handles are on the screen, in pixels: each arrow from its start to its tip, the ring as points round it, the knob. */
export interface Shown {
    middle?: { x: number; y: number };
    arrows: Partial<Record<"x" | "y" | "z", { from: { x: number; y: number }; to: { x: number; y: number } }>>;
    ring: { x: number; y: number }[];
    knob?: { x: number; y: number };
}

/** Where every handle is on the screen for a selection whose middle is at `middle`, and a knob at `knob` if one piece that can be resized is selected. */
export function layout(orbit: Orbit, degrees: number, width: number, height: number, middle: V3, knob?: V3): Shown {
    const aspect = width / Math.max(1, height);
    const screen = (p: V3) => {
        const seen = project(orbit, degrees, aspect, p);
        return seen && { x: ((seen.x + 1) / 2) * width, y: ((1 - seen.y) / 2) * height };
    };
    const size = across(orbit, degrees, height, middle);
    const shown: Shown = { middle: screen(middle), arrows: {}, ring: [] };
    for (const [name, axis] of Object.entries(AXES) as ["x" | "y" | "z", V3][]) {
        const from = screen([middle[0] + axis[0] * GAP * size, middle[1] + axis[1] * GAP * size, middle[2] + axis[2] * GAP * size]);
        const to = screen([middle[0] + axis[0] * ARROW * size, middle[1] + axis[1] * ARROW * size, middle[2] + axis[2] * ARROW * size]);
        // an arrow seen end on is too short to take; it is left out of reach until the view turns
        if (from && to && Math.hypot(to.x - from.x, to.y - from.y) > ARROW * 0.3) shown.arrows[name] = { from, to };
    }
    for (let i = 0; i < 48; i++) {
        const angle = (i / 48) * 2 * Math.PI;
        const point = screen([middle[0] + Math.cos(angle) * RING * size, middle[1], middle[2] + Math.sin(angle) * RING * size]);
        if (point) shown.ring.push(point);
    }
    if (knob) shown.knob = screen(knob);
    return shown;
}

/** How far a point is from a stretch of line between two others, all on the screen. */
export function toSegment(p: { x: number; y: number }, a: { x: number; y: number }, b: { x: number; y: number }): number {
    const [dx, dy] = [b.x - a.x, b.y - a.y];
    const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / (dx * dx + dy * dy || 1)));
    return Math.hypot(p.x - a.x - dx * t, p.y - a.y - dy * t);
}

/** Which handle a pointer at (x, y) takes, if any: the knob first, then the nearest arrow by its outer part, then the ring (a ring seen nearly edge on is not offered). */
export function which(shown: Shown, x: number, y: number, kind: "touch" | "mouse"): Handle | undefined {
    const reach = REACH[kind];
    const p = { x, y };
    if (shown.knob && Math.hypot(shown.knob.x - x, shown.knob.y - y) < reach * 1.1) return "knob";
    let best: { handle: Handle; d: number } | undefined;
    for (const [name, arrow] of Object.entries(shown.arrows) as ["x" | "y" | "z", { from: { x: number; y: number }; to: { x: number; y: number } }][]) {
        // by its outer part and head only: the part near the middle is over the pieces, which a finger
        // pressing there means to carry
        const [dx, dy] = [arrow.to.x - arrow.from.x, arrow.to.y - arrow.from.y];
        const along = ((x - arrow.from.x) * dx + (y - arrow.from.y) * dy) / (dx * dx + dy * dy || 1);
        if (along < 0.4) continue;
        const d = toSegment(p, { x: arrow.from.x + dx * 0.4, y: arrow.from.y + dy * 0.4 }, { x: arrow.to.x + dx * 0.12, y: arrow.to.y + dy * 0.12 });
        if (d < reach && (!best || d < best.d)) best = { handle: name, d };
    }
    if (best) return best.handle;
    const ys = shown.ring.map((point) => point.y);
    const flat = Math.max(...ys) - Math.min(...ys) < RING * 0.35;
    if (!flat) for (let i = 0; i < shown.ring.length; i++) if (toSegment(p, shown.ring[i]!, shown.ring[(i + 1) % shown.ring.length]!) < reach) return "ring";
    return undefined;
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

/** How many quarter turns a drag round the ring has gone, from the pointer at `from` to `to` about the ring's middle, all in pixels with y down: a quarter for every quarter of the way round, the nearest. */
export function turnedBy(middle: { x: number; y: number }, from: { x: number; y: number }, to: { x: number; y: number }): number {
    let angle = Math.atan2(to.y - middle.y, to.x - middle.x) - Math.atan2(from.y - middle.y, from.x - middle.x);
    while (angle > Math.PI) angle -= 2 * Math.PI;
    while (angle < -Math.PI) angle += 2 * Math.PI;
    // seen from above, a turn of a piece (x toward z) goes the way the clock does on the screen
    return Math.round(angle / (Math.PI / 2));
}

// ---- the shapes they are drawn with, each one unit long, scaled by `across` times `ARROW` ----

/** A round shape swept along an axis: rings of points of these radii at these places along it, closed at both ends. */
function lathe(rings: [along: number, radius: number][], axis: "x" | "y" | "z", around = 14): Mesh {
    const points: V3[] = [];
    const faces: number[][] = [];
    const place = (t: number, u: number, v: number): V3 => (axis === "x" ? [t, u, v] : axis === "y" ? [v, t, u] : [u, v, t]);
    for (const [t, r] of rings) for (let i = 0; i < around; i++) points.push(place(t, r * Math.cos((i / around) * 2 * Math.PI), r * Math.sin((i / around) * 2 * Math.PI)));
    for (let ring = 0; ring + 1 < rings.length; ring++) {
        for (let i = 0; i < around; i++) {
            const [a, b] = [ring * around + i, ring * around + ((i + 1) % around)];
            faces.push([a, b, b + around, a + around]);
        }
    }
    const first = points.length;
    points.push(place(rings[0]![0], 0, 0), place(rings[rings.length - 1]![0], 0, 0));
    const last = (rings.length - 1) * around;
    for (let i = 0; i < around; i++) {
        faces.push([first, (i + 1) % around, i]);
        faces.push([first + 1, last + i, last + ((i + 1) % around)]);
    }
    return { points, faces, smooth: true };
}

/** An arrow along an axis, from the gap to the tip: a shaft and a head. */
export function arrowMesh(axis: "x" | "y" | "z"): Mesh {
    const [start, neck] = [GAP / ARROW, 0.78];
    return lathe([[start, 0.045], [neck, 0.045], [neck, 0.11], [1, 0.005]], axis);
}

/** The ring about the upright, a thin round band lying flat. */
export function ringMesh(): Mesh {
    const [radius, thick, around, tube] = [RING / ARROW, 0.035, 64, 8];
    const points: V3[] = [];
    const faces: number[][] = [];
    for (let i = 0; i < around; i++) {
        const angle = (i / around) * 2 * Math.PI;
        for (let j = 0; j < tube; j++) {
            const spin = (j / tube) * 2 * Math.PI;
            const out = radius + thick * Math.cos(spin);
            points.push([out * Math.cos(angle), thick * Math.sin(spin), out * Math.sin(angle)]);
        }
    }
    for (let i = 0; i < around; i++) {
        for (let j = 0; j < tube; j++) {
            const [a, b, c, d] = [i * tube + j, i * tube + ((j + 1) % tube), ((i + 1) % around) * tube + ((j + 1) % tube), ((i + 1) % around) * tube + j];
            faces.push([a, b, c, d]);
        }
    }
    return { points, faces, smooth: true };
}
