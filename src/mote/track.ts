// Mote's fixed track for balls to roll on, worked out by formula and not by faces, so that a ball
// meets one smooth surface with no seam between samples or between pieces that join.
//
//   const path = curve([[0, 30, 0], [40, 20, 0], [70, 18, 25]]);     // a smooth curve through points
//   const piece = sweep(path, gutter(1.2, Math.PI, 0.2));            // a gutter swept along it
//   space.track(piece);                                              // space.ts: balls roll on it
//   view.add(piece.mesh(), look);                                    // gl.ts: drawn from the same numbers
//
// Two kinds. A section swept along a path: the path is a smooth curve through points, or a helix,
// and carries a frame (the way along, the way up, the way across); the section is a few parts in the
// plane across the path (a gutter that is an arc of a circle, a V, a flat bed with walls, a tube, a
// pair of round rails), each part a line or an arc with a thickness. And a profile turned about an
// upright axis: a funnel or a bowl.
//
// How a ball is met. Each piece is cut into short chunks along its length for the broad phase. For a
// chunk near a ball, the nearest point of the path to the ball's middle is the root of one equation,
// found by Newton's method kept inside the chunk; there the ball's middle lies in the plane across
// the path, and the nearest point of each part of the section in that plane is the nearest point of
// the surface. That is exact where the frame does not twist about the path (the up carried along it,
// as by default), since the surface's own slope along the path then lies along the path; where it is
// asked to twist (a bank that changes, or the up kept level round a spiral) the surface's slope tilts
// by the twist times the distance from the path, a degree or so in a spiral, and the contact found is
// that much off square, but still smooth. A turned profile is met exactly in the half plane through
// its axis and the ball.
//
// Only + - * / and square roots are used in meeting a piece, and in making one only those and the
// sines and cosines worked out below from them, so that the same run gives the same numbers to the
// bit in every browser and on every machine. What it is held to is in track.test.ts.

import { cross, dot3 as dot, minus as sub, plus as add, scaled as mul, type Mesh, type V3 } from "./solids";

/** A point in the plane across a path: across it (to the right, looking along it) and up. */
export type V2 = [number, number];

const root = Math.sqrt;
const size = (a: V3) => root(a[0] * a[0] + a[1] * a[1] + a[2] * a[2]);
const unit = (a: V3): V3 => mul(a, 1 / (size(a) || 1));

// ---- sine and cosine from + - * / alone ----

/** The first 33 bits of a quarter turn, and what is left of it, so that a whole number of quarter turns is taken off exactly. */
const QUARTER = 1.5707963267341256;
const QUARTER_REST = 6.077100506506192e-11;

/** sin(x + n quarter turns), worked out the same way on every machine. */
function wave(x: number, shift: number): number {
    const k = Math.round(x / (Math.PI / 2));
    const r = x - k * QUARTER - k * QUARTER_REST;
    const q = (((k + shift) % 4) + 4) % 4;
    const r2 = r * r;
    // the series for sine and cosine, enough terms for a sixteenth of a turn either way
    const s = r * (1 + r2 * (-1 / 6 + r2 * (1 / 120 + r2 * (-1 / 5040 + r2 * (1 / 362880 + r2 * (-1 / 39916800 + r2 * (1 / 6227020800 + r2 * (-1 / 1307674368000 + r2 / 355687428096000))))))));
    const c = 1 + r2 * (-1 / 2 + r2 * (1 / 24 + r2 * (-1 / 720 + r2 * (1 / 40320 + r2 * (-1 / 3628800 + r2 * (1 / 479001600 + r2 * (-1 / 87178291200 + r2 / 20922789888000)))))));
    return q === 0 ? s : q === 1 ? c : q === 2 ? -s : -c;
}

/** The sine of an angle in radians, the same to the bit on every machine (Math.sin may differ in its last bit between browsers). */
export const sine = (x: number): number => wave(x, 0);
/** The cosine of an angle in radians, the same to the bit on every machine. */
export const cosine = (x: number): number => wave(x, 1);

// ---- paths ----

/** A curve in space, by a parameter that runs from 0 to `end`: its point, and its first and second change with the parameter. */
export interface Path {
    readonly end: number;
    point(t: number): V3;
    speed(t: number): V3;
    bend(t: number): V3;
    /** All three at once into `out`, point then first change then second, nine numbers: what finding the nearest point asks for at every go. */
    local(t: number, out: Float64Array): void;
}

/**
 * The second changes of a cubic spline through `values` at `knots`, solved once: natural (not bending)
 * at an end whose slope is not given, or with the slope given there.
 */
function seconds(knots: number[], values: number[], first?: number, last?: number): number[] {
    const n = knots.length - 1;
    const below = new Array<number>(n + 1).fill(0);
    const middle = new Array<number>(n + 1).fill(1);
    const above = new Array<number>(n + 1).fill(0);
    const right = new Array<number>(n + 1).fill(0);
    for (let i = 1; i < n; i++) {
        const [h0, h1] = [knots[i]! - knots[i - 1]!, knots[i + 1]! - knots[i]!];
        below[i] = h0;
        middle[i] = 2 * (h0 + h1);
        above[i] = h1;
        right[i] = 6 * ((values[i + 1]! - values[i]!) / h1 - (values[i]! - values[i - 1]!) / h0);
    }
    if (first !== undefined) {
        const h = knots[1]! - knots[0]!;
        [middle[0], above[0], right[0]] = [2 * h, h, 6 * ((values[1]! - values[0]!) / h - first)];
    }
    if (last !== undefined) {
        const h = knots[n]! - knots[n - 1]!;
        [below[n], middle[n], right[n]] = [h, 2 * h, 6 * (last - (values[n]! - values[n - 1]!) / h)];
    }
    // the rows have three numbers each, so they are solved by going down once and up once
    for (let i = 1; i <= n; i++) {
        const by = below[i]! / middle[i - 1]!;
        middle[i]! -= by * above[i - 1]!;
        right[i]! -= by * right[i - 1]!;
    }
    const out = new Array<number>(n + 1).fill(0);
    out[n] = right[n]! / middle[n]!;
    for (let i = n - 1; i >= 0; i--) out[i] = (right[i]! - above[i]! * out[i + 1]!) / middle[i]!;
    return out;
}

/** Which span of the knots `t` falls in, kept to the first and last. */
function span(knots: number[], t: number): number {
    let [low, high] = [0, knots.length - 2];
    while (low < high) {
        const mid = (low + high + 1) >> 1;
        if (knots[mid]! <= t) low = mid;
        else high = mid - 1;
    }
    return low;
}

/** A cubic spline's value (`order` 0), slope (1) or second change (2) at `t`. */
function cubic(knots: number[], values: number[], second: number[], t: number, order: 0 | 1 | 2): number {
    const i = span(knots, t);
    const [t0, t1] = [knots[i]!, knots[i + 1]!];
    const h = t1 - t0;
    const [a, b] = [t1 - t, t - t0];
    const [m0, m1] = [second[i]!, second[i + 1]!];
    const [y0, y1] = [values[i]! / h - (m0 * h) / 6, values[i + 1]! / h - (m1 * h) / 6];
    if (order === 0) return (m0 * a * a * a) / (6 * h) + (m1 * b * b * b) / (6 * h) + y0 * a + y1 * b;
    if (order === 1) return (-m0 * a * a) / (2 * h) + (m1 * b * b) / (2 * h) - y0 + y1;
    return (m0 * a) / h + (m1 * b) / h;
}

/** A cubic spline's value, slope and second change at `t`, in span `i`, into `out` at `at`, `at + 3` and `at + 6`. */
function cubics(knots: number[], values: number[], second: number[], t: number, i: number, out: Float64Array, at: number): void {
    const [t0, t1] = [knots[i]!, knots[i + 1]!];
    const h = t1 - t0;
    const [a, b] = [t1 - t, t - t0];
    const [m0, m1] = [second[i]!, second[i + 1]!];
    const [y0, y1] = [values[i]! / h - (m0 * h) / 6, values[i + 1]! / h - (m1 * h) / 6];
    out[at] = (m0 * a * a * a) / (6 * h) + (m1 * b * b * b) / (6 * h) + y0 * a + y1 * b;
    out[at + 3] = (-m0 * a * a) / (2 * h) + (m1 * b * b) / (2 * h) - y0 + y1;
    out[at + 6] = (m0 * a) / h + (m1 * b) / h;
}

/** Which way a path leaves its first point and comes into its last, if they are to be held: for a piece that must meet another squarely. */
export interface Ends {
    start?: V3;
    end?: V3;
}

/**
 * A smooth curve through points: a cubic spline in each of x, y and z, by the distance from point to
 * point, so it bends evenly. Its bending changes smoothly too, with no jump at a point. Each end is
 * left straight unless its direction is given, which a piece that joins another uses.
 */
export function curve(points: V3[], ends: Ends = {}): Path {
    if (points.length < 2) throw new Error("A curve needs two points or more.");
    const knots = [0];
    for (let i = 1; i < points.length; i++) {
        const long = size(sub(points[i]!, points[i - 1]!));
        if (!(long > 0)) throw new Error("A curve's points must each be somewhere new.");
        knots.push(knots[i - 1]! + long);
    }
    const [start, end] = [ends.start && unit(ends.start), ends.end && unit(ends.end)];
    const axes = [0, 1, 2].map((axis) => {
        const values = points.map((point) => point[axis]!);
        return { values, second: seconds(knots, values, start?.[axis], end?.[axis]) };
    });
    const at = (t: number, order: 0 | 1 | 2): V3 => [cubic(knots, axes[0]!.values, axes[0]!.second, t, order), cubic(knots, axes[1]!.values, axes[1]!.second, t, order), cubic(knots, axes[2]!.values, axes[2]!.second, t, order)];
    return {
        end: knots[knots.length - 1]!,
        point: (t) => at(t, 0),
        speed: (t) => at(t, 1),
        bend: (t) => at(t, 2),
        local(t, out) {
            const i = span(knots, t);
            for (let axis = 0; axis < 3; axis++) cubics(knots, axes[axis]!.values, axes[axis]!.second, t, i, out, axis);
        },
    };
}

/** A straight path from one point to another. */
export const line = (from: V3, to: V3): Path => curve([from, to]);

/** How a helix stands: the line it winds about and where on it it starts. */
export interface Winding {
    /** The way its axis points; it climbs this way. Up unless said. */
    axis?: V3;
    /** The way from the axis to where it starts. Across x unless said. */
    from?: V3;
}

/**
 * A helix about an axis through `middle`: `radius` out, climbing `rise` along the axis each turn, for
 * `turns` turns (fewer than none winds the other way). Its parameter is the distance along it. With
 * the axis level and a small rise, it is a loop that comes out beside where it went in.
 */
export function helix(middle: V3, radius: number, rise: number, turns: number, winding: Winding = {}): Path & { facing: number } {
    const axis = unit(winding.axis ?? [0, 1, 0]);
    let from = winding.from ?? (Math.abs(axis[0]) < 0.9 ? [1, 0, 0] : [0, 0, 1]);
    from = unit(sub(from, mul(axis, dot(from, axis))));
    const other = cross(axis, from);
    const climb = rise / (2 * Math.PI);
    const long = Math.abs(turns) * root(4 * Math.PI * Math.PI * radius * radius + rise * rise);
    // the angle turned for each unit along it, signed
    const rate = (turns * 2 * Math.PI) / long;
    const out = (t: number): [number, number] => [cosine(t * rate), sine(t * rate)];
    return {
        end: long,
        // An up carried with no twist drifts away from the axis by the helix's torsion, evenly along it;
        // twisting it back by as much keeps a section started facing the axis facing it all the way (a loop).
        facing: (climb / (radius * radius + climb * climb)) * long,
        point(t) {
            const [c, s] = out(t);
            return add(middle, add(add(mul(from, radius * c), mul(other, radius * s)), mul(axis, climb * t * rate)));
        },
        speed(t) {
            const [c, s] = out(t);
            return mul(add(add(mul(from, -radius * s), mul(other, radius * c)), mul(axis, climb)), rate);
        },
        bend(t) {
            const [c, s] = out(t);
            return mul(add(mul(from, -radius * c), mul(other, -radius * s)), rate * rate);
        },
        local(t, into) {
            const [c, s] = out(t);
            for (let k = 0; k < 3; k++) {
                into[k] = middle[k]! + from[k]! * radius * c + other[k]! * radius * s + axis[k]! * climb * t * rate;
                into[k + 3] = (from[k]! * -radius * s + other[k]! * radius * c + axis[k]! * climb) * rate;
                into[k + 6] = (from[k]! * -radius * c + other[k]! * -radius * s) * rate * rate;
            }
        },
    };
}

// ---- sections ----

/** A straight part of a section, from one point to another, `thick` through: a wall, a bed, or (from a point to itself) a round rail. */
export interface Line {
    from: V2;
    to: V2;
    thick: number;
}

/** A part of a section that is an arc of a circle about `middle`, from one angle to another (in radians, from across toward up), `thick` through. */
export interface Arc {
    middle: V2;
    radius: number;
    from: number;
    to: number;
    thick: number;
}

/** What a piece of track looks like across: a few parts, each a line or an arc with a thickness, in the plane across the path, the path at its origin. */
export type Section = (Line | Arc)[];

/** A gutter: an arc of a circle of `radius` about the path, `span` radians of it centred below, its surface `thick` through. */
export const gutter = (radius: number, span: number, thick: number): Section => [{ middle: [0, 0], radius, from: -Math.PI / 2 - span / 2, to: -Math.PI / 2 + span / 2, thick }];

/** A tube: a whole circle of `radius` about the path. */
export const tube = (radius: number, thick: number): Section => [{ middle: [0, 0], radius, from: -Math.PI, to: Math.PI, thick }];

/** A V: two straight sides from the path, which is its bottom, up to `wide` across and `deep` high. */
export const vee = (wide: number, deep: number, thick: number): Section => [
    { from: [-wide / 2, deep], to: [0, 0], thick },
    { from: [0, 0], to: [wide / 2, deep], thick },
];

/** A flat bed `wide` across with a wall `high` at each side; the path runs along the middle of the bed's top. */
export const bed = (wide: number, high: number, thick: number): Section => [
    { from: [-wide / 2, -thick / 2], to: [wide / 2, -thick / 2], thick },
    { from: [-wide / 2 - thick / 2, -thick / 2], to: [-wide / 2 - thick / 2, high], thick },
    { from: [wide / 2 + thick / 2, -thick / 2], to: [wide / 2 + thick / 2, high], thick },
];

/** Two round rails `apart` from middle to middle, each of `radius`, level with the path, which runs between them. */
export const rails = (apart: number, radius: number): Section => [
    { from: [-apart / 2, 0], to: [-apart / 2, 0], thick: 2 * radius },
    { from: [apart / 2, 0], to: [apart / 2, 0], thick: 2 * radius },
];

/** A part made ready to be met: an arc's ends and the middle of its span worked out once. */
interface Ready {
    line?: Line;
    arc?: Arc & { ends: [V2, V2]; mid: V2; least: number; whole: boolean };
    thick: number;
}

function ready(part: Line | Arc): Ready {
    if ("from" in part && Array.isArray(part.from)) return { line: part as Line, thick: part.thick };
    const arc = part as Arc;
    const ends: [V2, V2] = [
        [arc.middle[0] + arc.radius * cosine(arc.from), arc.middle[1] + arc.radius * sine(arc.from)],
        [arc.middle[0] + arc.radius * cosine(arc.to), arc.middle[1] + arc.radius * sine(arc.to)],
    ];
    const half = (arc.to - arc.from) / 2;
    return { arc: { ...arc, ends, mid: [cosine(arc.from + half), sine(arc.from + half)], least: cosine(half), whole: arc.to - arc.from >= 2 * Math.PI - 1e-12 }, thick: arc.thick };
}

/** The nearest point of a part's middle line to (u, v). */
function nearest(part: Ready, u: number, v: number): V2 {
    if (part.line) {
        const { from, to } = part.line;
        const [dx, dy] = [to[0] - from[0], to[1] - from[1]];
        const long = dx * dx + dy * dy;
        const s = long > 0 ? Math.max(0, Math.min(1, ((u - from[0]) * dx + (v - from[1]) * dy) / long)) : 0;
        return [from[0] + dx * s, from[1] + dy * s];
    }
    const arc = part.arc!;
    const [wx, wy] = [u - arc.middle[0], v - arc.middle[1]];
    const long = root(wx * wx + wy * wy);
    if (long < 1e-12) return [arc.middle[0] + arc.mid[0] * arc.radius, arc.middle[1] + arc.mid[1] * arc.radius];
    const [dx, dy] = [wx / long, wy / long];
    if (arc.whole || dx * arc.mid[0] + dy * arc.mid[1] >= arc.least) return [arc.middle[0] + dx * arc.radius, arc.middle[1] + dy * arc.radius];
    const [a, b] = arc.ends;
    const [au, av, bu, bv] = [u - a[0], v - a[1], u - b[0], v - b[1]];
    return au * au + av * av <= bu * bu + bv * bv ? a : b;
}

/** How far a section reaches from the path, at most. */
function reachOf(parts: Ready[]): number {
    let most = 0;
    for (const part of parts) {
        if (part.line) most = Math.max(most, root(part.line.from[0] * part.line.from[0] + part.line.from[1] * part.line.from[1]), root(part.line.to[0] * part.line.to[0] + part.line.to[1] * part.line.to[1]));
        else most = Math.max(most, root(part.arc!.middle[0] * part.arc!.middle[0] + part.arc!.middle[1] * part.arc!.middle[1]) + part.arc!.radius);
    }
    return most + Math.max(...parts.map((part) => part.thick / 2));
}

/** A closed outline round a part, as many points as asked for each curved end, for drawing. */
function outline(part: Ready, round: number): V2[][] {
    const half = part.thick / 2;
    const circle = (middle: V2, radius: number, from: number, to: number, count: number): V2[] => Array.from({ length: count + 1 }, (_, i): V2 => [middle[0] + radius * cosine(from + ((to - from) * i) / count), middle[1] + radius * sine(from + ((to - from) * i) / count)]);
    if (part.line) {
        const { from, to } = part.line;
        const [dx, dy] = [to[0] - from[0], to[1] - from[1]];
        const long = root(dx * dx + dy * dy);
        if (long < 1e-12) return [circle(from, half, 0, 2 * Math.PI, round * 2).slice(0, -1)];
        const angle = Math.atan2(dy, dx);
        // round the far end, back along the other side, round the near end
        return [[...circle(to, half, angle - Math.PI / 2, angle + Math.PI / 2, round), ...circle(from, half, angle + Math.PI / 2, angle + (3 * Math.PI) / 2, round)]];
    }
    const arc = part.arc!;
    const along = Math.max(4, Math.ceil(((arc.to - arc.from) / Math.PI) * round * 2));
    if (arc.whole) return [circle(arc.middle, arc.radius + half, 0, 2 * Math.PI, along).slice(0, -1), circle(arc.middle, arc.radius - half, 0, 2 * Math.PI, along).slice(0, -1)];
    const [a, b] = arc.ends;
    return [[...circle(arc.middle, arc.radius + half, arc.from, arc.to, along), ...circle(b, half, arc.to, arc.to + Math.PI, round).slice(1, -1), ...circle(arc.middle, arc.radius - half, arc.to, arc.from, along), ...circle(a, half, arc.from + Math.PI, arc.from + 2 * Math.PI, round).slice(1, -1)]];
}

// ---- pieces ----

/** Where a ball meets a piece of track, or is near enough to be about to. */
export interface Touch {
    /** The nearest point of the track's surface, and the way from it to the ball's middle. */
    at: V3;
    n: V3;
    /** How far apart the two surfaces are: less than none is overlap. */
    gap: number;
    /** Which part of the section it is, and where along the piece, to find it again next step. */
    part: number;
    where: number;
}

/** A piece of fixed track, as `space.ts` meets it and `gl.ts` draws it. */
export interface Piece {
    /** How many short chunks it is cut into along its length. */
    readonly chunks: number;
    /** How far along the piece each chunk begins, and one more for where the last ends. */
    readonly knots: number[];
    /**
     * Whether each end is joined to another piece: a joined end is left open, so that a ball crossing
     * to the next piece meets one surface. `space.ts` joins pieces that meet end to end by itself.
     */
    readonly joined: [start: boolean, end: boolean];
    /** For a swept piece, the frame at each end and its section written out, by which pieces that meet are found. */
    readonly ends?: [Frame, Frame];
    readonly shape?: string;
    /** The box chunk `k` and the surface round it take up: its least corner into `low` and greatest into `high`, at `at` and the two after. */
    box(k: number, low: Float64Array, high: Float64Array, at: number): void;
    /** Each place a ball with its middle at `c` and radius `r` touches chunk `k`, or comes within `reach` of it, added to `out`. */
    touch(k: number, c: V3, r: number, reach: number, out: Touch[]): void;
    /** Where a ball at `c` meets one part, found again near `where` along the piece: for how the surface curves away within a step. */
    again(part: number, where: number, c: V3, r: number): Touch;
    /** Faces to draw it with, from the same numbers. */
    mesh(): Mesh;
}

/** The middle curve's frame at a place along a piece: its point, the way along, up and across (to the right, looking along it). */
export interface Frame {
    p: V3;
    along: V3;
    up: V3;
    across: V3;
}

/** How a section is carried along its path. */
export interface Along {
    /** The way up at the start, or the way to stay leaning toward if `level`. Up the world's y unless said. */
    up?: V3;
    /** Keep the up as near `up` as the path allows all the way (a spiral, a level bend); otherwise it is carried along the path with no twist (a loop). */
    level?: boolean;
    /** How far the up leans to the right, in radians, about the path: one number for all of it, or several spaced evenly from start to end with a smooth curve through them. */
    bank?: number | number[];
    /** A turn about the path added evenly from start to end, in radians: a corkscrew. */
    twist?: number;
    /** An end that meets another piece with the same section is left open there, so that a ball crossing feels one surface. */
    joined?: [start: boolean, end: boolean];
    /** How long each chunk is, about. The section's reach unless said. */
    step?: number;
}

/** A vector turned as `from` turns into `to` (both of length one), by the least turn: the way a frame is carried with no twist. */
function carry(x: V3, from: V3, to: V3): V3 {
    const c = dot(from, to);
    const v = cross(from, to);
    return add(add(mul(x, c), cross(v, x)), mul(v, dot(v, x) / (1 + c)));
}

/** Room for a path's point and its two changes, used over and over while a nearest point is found. */
const here = new Float64Array(9);

/** (c - P) . P' and its change with t, at `t`, from what `here` holds once `path.local` has filled it. */
function change(path: Path, c: V3, t: number): [g: number, slope: number] {
    path.local(t, here);
    const [wx, wy, wz] = [c[0] - here[0]!, c[1] - here[1]!, c[2] - here[2]!];
    const [dx, dy, dz] = [here[3]!, here[4]!, here[5]!];
    return [wx * dx + wy * dy + wz * dz, wx * here[6]! + wy * here[7]! + wz * here[8]! - (dx * dx + dy * dy + dz * dz)];
}

/** The point of a path nearest `c` within [low, high], given the change of distance there: a root of (c - P) . P' found by Newton's method kept inside by halving. */
function closest(path: Path, c: V3, low: number, high: number, gLow: number, gHigh: number): number {
    let t = low + ((high - low) * gLow) / (gLow - gHigh);
    for (let go = 0; go < 30; go++) {
        const [g, slope] = change(path, c, t);
        if (g > 0) low = t;
        else high = t;
        let next = slope < 0 ? t - g / slope : (low + high) / 2;
        if (!(next > low && next < high)) next = (low + high) / 2;
        if (Math.abs(next - t) <= 1e-13 * (1 + Math.abs(t))) return next;
        t = next;
    }
    return t;
}

/** Newton's method for the nearest point of a path to `c`, from `t`, with no chunk to keep it in: for a ball found last step, a little further on. */
function settle(path: Path, c: V3, t: number): number {
    for (let go = 0; go < 6; go++) {
        const [g, slope] = change(path, c, t);
        if (!(slope < 0)) break;
        const next = Math.max(0, Math.min(path.end, t - g / slope));
        if (Math.abs(next - t) <= 1e-13 * (1 + Math.abs(t))) return next;
        t = next;
    }
    return t;
}

/** A section swept along a path: a straight, a bend, a slope, a loop or a spiral. */
export function sweep(path: Path, section: Section, along: Along = {}): Piece & { frame(t: number): Frame; path: Path } {
    const parts = section.map(ready);
    const reach = reachOf(parts);
    const count = Math.max(1, Math.ceil(path.end / (along.step ?? reach)));
    const knots = Array.from({ length: count + 1 }, (_, k) => (path.end * k) / count);
    const joined: [boolean, boolean] = [...(along.joined ?? [false, false])];
    const wanted = unit(along.up ?? [0, 1, 0]);

    // The way up at each knot: kept level where asked and where the path allows, otherwise carried from
    // the last knot by the least turn there is (the double reflection of Wang, Juttler, Zheng and Liu, 2008).
    const tangents = knots.map((t) => unit(path.speed(t)));
    const ups: V3[] = [];
    const level: boolean[] = [];
    const flat = (t: V3): V3 | undefined => {
        const off = sub(wanted, mul(t, dot(wanted, t)));
        return size(off) > 0.2 ? unit(off) : undefined;
    };
    for (let k = 0; k <= count; k++) {
        const t = tangents[k]!;
        const kept = along.level ? flat(t) : undefined;
        level.push(Boolean(kept));
        if (kept) {
            ups.push(kept);
            continue;
        }
        if (k === 0) {
            const off = sub(wanted, mul(t, dot(wanted, t)));
            ups.push(size(off) > 1e-6 ? unit(off) : unit(cross(t, Math.abs(t[0]) < 0.9 ? [1, 0, 0] : [0, 0, 1])));
            continue;
        }
        const step = sub(path.point(knots[k]!), path.point(knots[k - 1]!));
        const c1 = dot(step, step);
        const up = ups[k - 1]!;
        const mirrored = sub(up, mul(step, (2 / c1) * dot(step, up)));
        const back = sub(tangents[k - 1]!, mul(step, (2 / c1) * dot(step, tangents[k - 1]!)));
        const second = sub(t, back);
        const c2 = dot(second, second);
        const next = c2 > 1e-30 ? sub(mirrored, mul(second, (2 / c2) * dot(second, mirrored))) : mirrored;
        ups.push(unit(sub(next, mul(t, dot(next, t)))));
    }
    const banks = typeof along.bank === "number" ? [along.bank, along.bank] : along.bank && along.bank.length > 1 ? along.bank : [along.bank?.[0] ?? 0, along.bank?.[0] ?? 0];
    const bankKnots = banks.map((_, i) => i / (banks.length - 1));
    const bankSecond = seconds(bankKnots, banks);
    const twist = along.twist ?? 0;

    const frame = (t: number): Frame => {
        const p = path.point(t);
        const tangent = unit(path.speed(t));
        const k = Math.min(count - 1, Math.max(0, Math.floor((t / path.end) * count)));
        let up: V3;
        if (level[k] && level[k + 1]) up = flat(tangent) ?? ups[k]!;
        else {
            // carried from the knots either side and blended between them, so that it changes smoothly
            const w = Math.max(0, Math.min(1, (t - knots[k]!) / (knots[k + 1]! - knots[k]!)));
            up = add(mul(carry(ups[k]!, tangents[k]!, tangent), 1 - w), mul(carry(ups[k + 1]!, tangents[k + 1]!, tangent), w));
            up = unit(sub(up, mul(tangent, dot(up, tangent))));
        }
        const lean = cubic(bankKnots, banks, bankSecond, Math.max(0, Math.min(1, t / path.end)), 0) + (twist * t) / path.end;
        let across = cross(tangent, up);
        if (lean) {
            const [c, s] = [cosine(lean), sine(lean)];
            [up, across] = [add(mul(up, c), mul(across, s)), sub(mul(across, c), mul(up, s))];
        }
        return { p, along: tangent, up, across };
    };

    /** The place a part of the section nearest `c` is, from the frame at `t`, and the way and distance from it. */
    const meet = (t: number, c: V3, r: number, index: number, f: Frame, onward = false): Touch => {
        const part = parts[index]!;
        const w = sub(c, f.p);
        const [qu, qv] = nearest(part, dot(w, f.across), dot(w, f.up));
        const q = add(f.p, add(mul(f.across, qu), mul(f.up, qv)));
        // past an end joined to another piece, the section is taken to go straight on, as the next piece does
        const d = onward ? sub(sub(c, q), mul(f.along, dot(w, f.along))) : sub(c, q);
        const long = size(d);
        const n = long > 1e-12 ? mul(d, 1 / long) : f.up;
        return { at: add(q, mul(n, part.thick / 2)), n, gap: long - part.thick / 2 - r, part: index, where: t };
    };
    // the point and the way along at each knot, kept, so that a chunk is looked at by its ends without working out the curve
    const atKnots = knots.map((t) => [path.point(t), path.speed(t)] as const);
    const g = (k: number, c: V3) => {
        const [p, d] = atKnots[k]!;
        return (c[0] - p[0]) * d[0] + (c[1] - p[1]) * d[1] + (c[2] - p[2]) * d[2];
    };

    return {
        path,
        chunks: count,
        knots,
        joined,
        ends: [frame(0), frame(path.end)],
        shape: JSON.stringify(section),
        frame,
        box(k, low, high, at) {
            const [t0, t1] = [knots[k]!, knots[k + 1]!];
            const points = [0, 0.25, 0.5, 0.75, 1].map((s) => path.point(t0 + (t1 - t0) * s));
            // the curve may bow out between the points looked at by a little; that is allowed for
            const bow = size(sub(points[2]!, mul(add(points[0]!, points[4]!), 0.5))) + 1e-9;
            for (let axis = 0; axis < 3; axis++) {
                const values = points.map((point) => point[axis]!);
                low[at + axis] = Math.min(...values) - reach - bow;
                high[at + axis] = Math.max(...values) + reach + bow;
            }
        },
        touch(k, c, r, within, out) {
            const [t0, t1] = [knots[k]!, knots[k + 1]!];
            const [g0, g1] = [g(k, c), g(k + 1, c)];
            let t: number;
            if (g0 > 0 && g1 <= 0) t = closest(path, c, t0, t1, g0, g1);
            // past an end: the ball meets the section's rim there, unless the end is joined to another piece
            else if (k === 0 && g0 <= 0 && !joined[0]) t = 0;
            else if (k === count - 1 && g1 > 0 && !joined[1]) t = path.end;
            else return;
            const f = frame(t);
            for (let index = 0; index < parts.length; index++) {
                const found = meet(t, c, r, index, f);
                if (found.gap < within) out.push(found);
            }
        },
        again(part, where, c, r) {
            const t = settle(path, c, where);
            const onward = (t <= 0 && joined[0]) || (t >= path.end && joined[1]);
            return meet(t, c, r, part, frame(t), onward);
        },
        mesh() {
            const loops = parts.flatMap((part) => outline(part, 6));
            const rings = Math.max(2, Math.ceil(path.end / Math.max(reach * 0.5, path.end / 4000)) + 1);
            const points: V3[] = [];
            const faces: number[][] = [];
            for (const loop of loops) {
                const first = points.length;
                for (let i = 0; i < rings; i++) {
                    const f = frame((path.end * i) / (rings - 1));
                    for (const [u, v] of loop) points.push(add(f.p, add(mul(f.across, u), mul(f.up, v))));
                }
                const around = loop.length;
                for (let i = 0; i + 1 < rings; i++) {
                    for (let j = 0; j < around; j++) {
                        const [a, b] = [first + i * around + j, first + i * around + ((j + 1) % around)];
                        faces.push([a, b, b + around, a + around]);
                    }
                }
            }
            return { points, faces, smooth: true };
        },
    };
}

/**
 * A profile turned about an upright axis through `at`: a funnel, a bowl. The profile is a smooth
 * curve through points, each how far out from the axis and how high above `at`, and its surface is
 * `thick` through. Its two ends are round rims: a ball can roll over the top one or drop through the
 * hole the bottom one leaves.
 */
export function turned(at: V3, profile: V2[], thick: number, step?: number): Piece {
    const path = curve(profile.map(([out, high]): V3 => [out, high, 0]));
    const reach = Math.max(...profile.map(([out]) => out)) + thick / 2;
    const count = Math.max(1, Math.ceil(path.end / (step ?? Math.max(thick * 4, path.end / 64))));
    const knots = Array.from({ length: count + 1 }, (_, k) => (path.end * k) / count);
    /** Where a ball's middle is in the half plane through the axis and itself: out from the axis and up; and the way out. */
    const flatten = (c: V3): [V3, V3] => {
        const [x, z] = [c[0] - at[0], c[2] - at[2]];
        const out = root(x * x + z * z);
        return [[out, c[1] - at[1], 0], out > 1e-12 ? [x / out, 0, z / out] : [1, 0, 0]];
    };
    /** The nearest point of the profile to a point of the half plane from `t`, and the touch it makes, `side` 0 on the ball's side of the axis, 1 across it. */
    const meet = (t: number, plane: V3, away: V3, r: number, side: number): Touch => {
        const q = path.point(t);
        const [du, dv] = [plane[0] - q[0], plane[1] - q[1]];
        const long = root(du * du + dv * dv);
        const [nu, nv] = long > 1e-12 ? [du / long, dv / long] : [0, 1];
        const sign = side ? -1 : 1;
        const n: V3 = [away[0] * nu * sign, nv, away[2] * nu * sign];
        const surface: V3 = [at[0] + away[0] * q[0] * sign, at[1] + q[1], at[2] + away[2] * q[0] * sign];
        return { at: add(surface, mul(n, thick / 2)), n, gap: long - thick / 2 - r, part: side, where: t };
    };
    const atKnots = knots.map((t) => [path.point(t), path.speed(t)] as const);
    const g = (k: number, plane: V3) => {
        const [p, d] = atKnots[k]!;
        return (plane[0] - p[0]) * d[0] + (plane[1] - p[1]) * d[1];
    };
    return {
        chunks: count,
        knots,
        joined: [false, false],
        box(k, low, high, i) {
            const [t0, t1] = [knots[k]!, knots[k + 1]!];
            const points = [0, 0.25, 0.5, 0.75, 1].map((s) => path.point(t0 + (t1 - t0) * s));
            const bow = size(sub(points[2]!, mul(add(points[0]!, points[4]!), 0.5))) + 1e-9;
            const out = Math.max(...points.map((point) => point[0])) + thick / 2 + bow;
            const heights = points.map((point) => point[1]);
            [low[i], low[i + 1], low[i + 2]] = [at[0] - out, at[1] + Math.min(...heights) - thick / 2 - bow, at[2] - out];
            [high[i], high[i + 1], high[i + 2]] = [at[0] + out, at[1] + Math.max(...heights) + thick / 2 + bow, at[2] + out];
        },
        touch(k, c, r, within, out) {
            const [plane, away] = flatten(c);
            for (let side = 0; side < 2; side++) {
                // across the axis, the ball is as far out the other way
                const point: V3 = side ? [-plane[0], plane[1], 0] : plane;
                if (side && plane[0] > reach + r + within) continue;
                const [t0, t1] = [knots[k]!, knots[k + 1]!];
                const [g0, g1] = [g(k, point), g(k + 1, point)];
                let t: number;
                if (g0 > 0 && g1 <= 0) t = closest(path, point, t0, t1, g0, g1);
                else if (k === 0 && g0 <= 0) t = 0;
                else if (k === count - 1 && g1 > 0) t = path.end;
                else continue;
                const found = meet(t, point, away, r, side);
                if (found.gap < within) out.push(found);
            }
        },
        again(part, where, c, r) {
            const [plane, away] = flatten(c);
            const point: V3 = part ? [-plane[0], plane[1], 0] : plane;
            return meet(settle(path, point, where), point, away, r, part);
        },
        mesh() {
            // the profile's outline: out along one side, round the end, back along the other, round the start
            const down = 48;
            const sides: V2[] = [];
            const offset = (t: number, by: number): V2 => {
                const q = path.point(t);
                const d = unit(path.speed(t));
                return [q[0] - d[1] * by, q[1] + d[0] * by];
            };
            for (let i = 0; i <= down; i++) sides.push(offset((path.end * i) / down, thick / 2));
            const capEnd = (t: number, from: number) => {
                const q = path.point(t);
                const d = unit(path.speed(t));
                const angle = Math.atan2(d[1], d[0]) + from;
                for (let i = 1; i < 6; i++) sides.push([q[0] + (thick / 2) * Math.cos(angle + (Math.PI * i) / 6), q[1] + (thick / 2) * Math.sin(angle + (Math.PI * i) / 6)]);
            };
            capEnd(path.end, Math.PI / 2);
            for (let i = down; i >= 0; i--) sides.push(offset((path.end * i) / down, -thick / 2));
            capEnd(0, -Math.PI / 2);
            const around = 72;
            const points: V3[] = [];
            const faces: number[][] = [];
            for (let i = 0; i < around; i++) {
                const [c, s] = [cosine((2 * Math.PI * i) / around), sine((2 * Math.PI * i) / around)];
                for (const [out, high] of sides) points.push([at[0] + out * c, at[1] + high, at[2] + out * s]);
            }
            const n = sides.length;
            for (let i = 0; i < around; i++) {
                for (let j = 0; j < n; j++) {
                    const [a, b] = [i * n + j, i * n + ((j + 1) % n)];
                    const next = ((i + 1) % around) * n;
                    faces.push([a, b, next + ((j + 1) % n), next + j]);
                }
            }
            return { points, faces, smooth: true };
        },
    };
}
