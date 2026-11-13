// Mote's 3D physics: solid things with flat faces that fall, tumble and come
// to rest. It is here for the dice, and has only what they need: solids that
// bulge everywhere, fixed slabs to land on, friction and bounce. Units are
// whatever the scene uses; y points up.
//
//   const space = new Space();
//   space.slab([0, -0.5, 0], [10, 0.5, 10]);          // a floor
//   const die = space.solid(cube(), [0, 4, 0]);
//   space.step(dt);
//   die.p, turn(die)                                   // where it is and how it is turned
//
// A step goes as flat.ts's does: where things touch is found once, then the
// step is taken in small parts, each solving every touch as a stiff, heavily
// damped spring, moving the solids, and solving once more without the spring.
//
// What it is held to is in space.test.ts.

import { block, cross, dot3 as dot, minus as sub, plus as add, scaled as mul, type Mesh, type Turn, type V3 } from "./solids";

export type Quat = [x: number, y: number, z: number, w: number];

/** Solids this close are treated as about to touch. More is added for anything moving fast. */
const MARGIN = 0.04;
/** The fastest an overlap is undone, in units a second. */
const PUSH = 3;
const HERTZ = 120;
const DAMPED = 10;

export interface Stuff {
    friction?: number;
    bounce?: number;
    density?: number;
}

export interface Solid {
    readonly id: number;
    p: V3;
    q: Quat;
    v: V3;
    w: V3;
    readonly points: V3[];
    readonly faces: number[][];
    /** The outward direction of each face, and every direction an edge runs in, before it is turned. */
    readonly normals: V3[];
    readonly edges: [number, number][];
    readonly runs: V3[];
    readonly far: number;
    readonly mass: number;
    /** 1 / mass and 1 / how hard it is to turn: both 0 for something that does not move, or is asleep. */
    im: number;
    ii: number;
    /** Asleep: lying still, and left out of the work until something moving reaches it. What it weighs is kept here meanwhile. */
    rest?: [im: number, ii: number];
    friction: number;
    bounce: number;
    /** How quickly it slows by itself, per second, moving and turning. */
    damping: number;
    spinDamping: number;
    /** How long it has been all but still, in seconds. */
    quiet: number;
    // the solver's own: where its corners and faces are in the world, and how far it has moved this step
    wp: V3[];
    wn: V3[];
    wr: V3[];
    offsets: number[];
    dp: V3;
    dq: Quat;
}

interface Spot {
    /** From each solid's middle to the point, as the step began; and to its own surface behind the point. */
    ra: V3;
    rb: V3;
    ca: V3;
    cb: V3;
    /** Where it is on the first solid, unturned, to find it again next step. */
    la: V3;
    gap: number;
    adjusted: number;
    normalMass: number;
    oneMass: number;
    twoMass: number;
    push: number;
    one: number;
    two: number;
    /** For the pass under way: the speed it is solved toward, whether it is a spring, and its push when the pass began. */
    speed: number;
    springy: boolean;
    start: number;
    closing: number;
    most: number;
}

interface Manifold {
    a: Solid;
    b: Solid;
    /** From a to b, and two directions across it for friction. */
    n: V3;
    t1: V3;
    t2: V3;
    spots: Spot[];
    friction: number;
    bounce: number;
    stiff: boolean;
}

const size = (a: V3) => Math.hypot(a[0], a[1], a[2]);
const unit = (a: V3): V3 => mul(a, 1 / (size(a) || 1));

/** A vector turned by a quaternion. */
function spin(q: Quat, v: V3): V3 {
    const [x, y, z, w] = q;
    const [tx, ty, tz] = [2 * (y * v[2] - z * v[1]), 2 * (z * v[0] - x * v[2]), 2 * (x * v[1] - y * v[0])];
    return [v[0] + w * tx + y * tz - z * ty, v[1] + w * ty + z * tx - x * tz, v[2] + w * tz + x * ty - y * tx];
}

/** A quaternion turned further by a small rotation: an axis whose length is the angle. */
function turnedBy(q: Quat, by: V3): Quat {
    const [x, y, z, w] = q;
    const [bx, by2, bz] = [by[0] / 2, by[1] / 2, by[2] / 2];
    const next: Quat = [x + bx * w + by2 * z - bz * y, y + by2 * w + bz * x - bx * z, z + bz * w + bx * y - by2 * x, w - bx * x - by2 * y - bz * z];
    const long = Math.hypot(...next) || 1;
    return [next[0] / long, next[1] / long, next[2] / long, next[3] / long];
}

/** How a solid is turned, as three rows of three. */
export function turn(solid: { q: Quat }): Turn {
    const [x, y, z, w] = solid.q;
    return [
        [1 - 2 * (y * y + z * z), 2 * (x * y - z * w), 2 * (x * z + y * w)],
        [2 * (x * y + z * w), 1 - 2 * (x * x + z * z), 2 * (y * z - x * w)],
        [2 * (x * z - y * w), 2 * (y * z + x * w), 1 - 2 * (x * x + y * y)],
    ];
}

/** A quaternion from angles about x, then y, then z. */
export function angled(x: number, y: number, z: number): Quat {
    let q: Quat = [0, 0, 0, 1];
    const about = (axis: V3, angle: number): Quat => {
        const s = Math.sin(angle / 2);
        const [ax, ay, az, aw] = [axis[0] * s, axis[1] * s, axis[2] * s, Math.cos(angle / 2)];
        const [bx, by, bz, bw] = q;
        return [aw * bx + ax * bw + ay * bz - az * by, aw * by - ax * bz + ay * bw + az * bx, aw * bz + ax * by - ay * bx + az * bw, aw * bw - ax * bx - ay * by - az * bz];
    };
    q = about([1, 0, 0], x);
    q = about([0, 1, 0], y);
    q = about([0, 0, 1], z);
    return q;
}

let count = 0;

function make(mesh: Mesh, at: V3, q: Quat, fixed: boolean, stuff: Stuff): Solid {
    // its middle is where it balances, and how hard it is to turn is taken as the same about every axis,
    // which is true of a cube and of every regular die
    let [volume, around] = [0, 0];
    let middle: V3 = [0, 0, 0];
    for (const face of mesh.faces) {
        for (let i = 1; i + 1 < face.length; i++) {
            const [a, b, c] = [mesh.points[face[0]!]!, mesh.points[face[i]!]!, mesh.points[face[i + 1]!]!];
            const part = dot(a, cross(b, c)) / 6;
            volume += part;
            middle = add(middle, mul(add(add(a, b), c), part / 4));
        }
    }
    middle = mul(middle, 1 / volume);
    const points = mesh.points.map((point) => sub(point, middle));
    for (const face of mesh.faces) {
        for (let i = 1; i + 1 < face.length; i++) {
            const [a, b, c] = [points[face[0]!]!, points[face[i]!]!, points[face[i + 1]!]!];
            around += (Math.abs(dot(a, cross(b, c))) / 60) * (dot(a, a) + dot(b, b) + dot(c, c) + dot(a, b) + dot(a, c) + dot(b, c));
        }
    }
    const normals = mesh.faces.map((face) => {
        const n = unit(cross(sub(points[face[1]!]!, points[face[0]!]!), sub(points[face[2]!]!, points[face[0]!]!)));
        return dot(n, points[face[0]!]!) < 0 ? mul(n, -1) : n;
    });
    const edges: [number, number][] = [];
    const runs: V3[] = [];
    for (const face of mesh.faces) {
        face.forEach((from, i) => {
            const to = face[(i + 1) % face.length]!;
            if (edges.some(([a, b]) => (a === from && b === to) || (a === to && b === from))) return;
            edges.push([from, to]);
            const run = unit(sub(points[to]!, points[from]!));
            if (!runs.some((other) => Math.abs(dot(other, run)) > 0.999)) runs.push(run);
        });
    }
    const mass = Math.abs(volume) * (stuff.density ?? 1);
    const solid: Solid = {
        id: ++count,
        p: add(at, spin(q, middle)), q, v: [0, 0, 0], w: [0, 0, 0],
        points, faces: mesh.faces, normals, edges, runs,
        far: Math.max(...points.map(size)),
        mass,
        im: fixed ? 0 : 1 / mass,
        ii: fixed ? 0 : 1 / ((2 / 3) * around * (stuff.density ?? 1)),
        friction: stuff.friction ?? 0.4,
        bounce: stuff.bounce ?? 0,
        damping: 0, spinDamping: 0, quiet: 0,
        wp: [], wn: [], wr: [], offsets: [], dp: [0, 0, 0], dq: [0, 0, 0, 1],
    };
    place(solid);
    return solid;
}

function place(s: Solid): void {
    s.wp = s.points.map((point) => add(s.p, spin(s.q, point)));
    s.wn = s.normals.map((n) => spin(s.q, n));
    s.wr = s.runs.map((run) => spin(s.q, run));
    s.offsets = s.wn.map((n, i) => dot(n, s.wp[s.faces[i]![0]!]!));
}

// ---- where two solids touch ----

/** The least and most of a solid's corners along a direction. */
function span(s: Solid, d: V3): [number, number] {
    let [low, high] = [Infinity, -Infinity];
    for (const p of s.wp) {
        const along = p[0] * d[0] + p[1] * d[1] + p[2] * d[2];
        if (along < low) low = along;
        if (along > high) high = along;
    }
    return [low, high];
}

/** The face of `a` that `b` is least far behind, and by how much. Positive means apart. */
function apart(a: Solid, b: Solid): [number, number] {
    let [best, face] = [-Infinity, 0];
    for (let i = 0; i < a.wn.length; i++) {
        const n = a.wn[i]!;
        let least = Infinity;
        for (const p of b.wp) {
            const along = p[0] * n[0] + p[1] * n[1] + p[2] * n[2];
            if (along < least) least = along;
        }
        if (least - a.offsets[i]! > best) [best, face] = [least - a.offsets[i]!, i];
    }
    return [best, face];
}

type Found = { n: V3; spots: [at: V3, gap: number][] } | undefined;

/** A face of `ref` against the face of `inc` that most squarely meets it. `n` is the first's outward direction. */
function faceToFace(ref: Solid, face: number, inc: Solid, margin: number): [V3, number][] {
    const n = ref.wn[face]!;
    let [against, least] = [0, Infinity];
    inc.wn.forEach((other, i) => {
        const facing = dot(other, n);
        if (facing < least) [least, against] = [facing, i];
    });
    // the second face, cut down to the part that lies over the first
    let shape = inc.faces[against]!.map((corner) => inc.wp[corner]!);
    const corners = ref.faces[face]!.map((corner) => ref.wp[corner]!);
    for (let i = 0; i < corners.length && shape.length; i++) {
        const [from, to] = [corners[i]!, corners[(i + 1) % corners.length]!];
        // outward across this edge of the first face
        let side = cross(sub(to, from), n);
        if (dot(side, sub(corners[(i + 2) % corners.length]!, from)) > 0) side = mul(side, -1);
        const edge = dot(side, from);
        const kept: V3[] = [];
        shape.forEach((point, at) => {
            const next = shape[(at + 1) % shape.length]!;
            const [d0, d1] = [dot(side, point) - edge, dot(side, next) - edge];
            if (d0 <= 0) kept.push(point);
            if (d0 * d1 < 0) kept.push(add(point, mul(sub(next, point), d0 / (d0 - d1))));
        });
        shape = kept;
    }
    let spots = shape.map((point): [V3, number] => [point, dot(n, point) - ref.offsets[face]!]).filter(([, gap]) => gap <= margin);
    if (spots.length > 4) {
        // Four are enough to hold a face: the deepest, always, and the furthest each way along two
        // directions across the face. If that is five, the shallowest of them goes.
        const across = unit(sub(corners[1]!, corners[0]!));
        const over = cross(n, across);
        const pick = (d: V3, sign: number) => spots.reduce((best, spot) => (sign * dot(spot[0], d) > sign * dot(best[0], d) ? spot : best));
        const deepest = spots.reduce((best, spot) => (spot[1] < best[1] ? spot : best));
        const kept = [...new Set([deepest, pick(across, 1), pick(across, -1), pick(over, 1), pick(over, -1)])];
        if (kept.length > 4) kept.splice(kept.indexOf(kept.slice(1).reduce((worst, spot) => (spot[1] > worst[1] ? spot : worst))), 1);
        spots = kept;
    }
    return spots;
}

function touch(a: Solid, b: Solid, margin: number): Found {
    const [ga, fa] = apart(a, b);
    if (ga > margin) return undefined;
    const [gb, fb] = apart(b, a);
    if (gb > margin) return undefined;

    // an edge of one against an edge of the other: every pair of directions the two have edges in
    let [ge, axis, ra, rb] = [-Infinity, [0, 0, 0] as V3, 0, 0];
    for (let i = 0; i < a.wr.length; i++) {
        for (let j = 0; j < b.wr.length; j++) {
            const c = cross(a.wr[i]!, b.wr[j]!);
            const long = size(c);
            if (long < 0.05) continue;
            const d = mul(c, 1 / long);
            const [lowA, highA] = span(a, d);
            const [lowB, highB] = span(b, d);
            // either way round
            const [forward, back] = [lowB - highA, lowA - highB];
            const gap = Math.max(forward, back);
            if (gap > margin) return undefined;
            if (gap > ge) [ge, axis, ra, rb] = [gap, forward >= back ? d : mul(d, -1), i, j];
        }
    }

    // A face is preferred: it gives several points, and a die lying on a face should be held by one.
    const slack = 0.004;
    if (ge > Math.max(ga, gb) + slack) {
        // the two edges, of all those running these ways, that are furthest toward each other
        const furthest = (s: Solid, run: V3, d: V3) => {
            let [best, most] = [s.edges[0]!, -Infinity];
            for (const edge of s.edges) {
                const [from, to] = [s.wp[edge[0]]!, s.wp[edge[1]]!];
                if (Math.abs(dot(unit(sub(to, from)), run)) < 0.999) continue;
                const along = dot(add(from, to), d);
                if (along > most) [best, most] = [edge, along];
            }
            return [s.wp[best[0]]!, s.wp[best[1]]!] as const;
        };
        const [p1, q1] = furthest(a, a.wr[ra]!, axis);
        const [p2, q2] = furthest(b, b.wr[rb]!, mul(axis, -1));
        // the nearest points of the two edges
        const [d1, d2, r] = [sub(q1, p1), sub(q2, p2), sub(p1, p2)];
        const [aa, ee, ff, cc, bb] = [dot(d1, d1), dot(d2, d2), dot(d2, r), dot(d1, r), dot(d1, d2)];
        const denom = aa * ee - bb * bb;
        const clamp = (value: number) => Math.max(0, Math.min(1, value));
        let s = denom > 1e-12 ? clamp((bb * ff - cc * ee) / denom) : 0.5;
        let t = (bb * s + ff) / ee;
        if (t < 0) [t, s] = [0, clamp(-cc / aa)];
        else if (t > 1) [t, s] = [1, clamp((bb - cc) / aa)];
        const [onA, onB] = [add(p1, mul(d1, s)), add(p2, mul(d2, t))];
        return { n: axis, spots: [[mul(add(onA, onB), 0.5), ge]] };
    }
    if (gb > ga + slack) {
        const spots = faceToFace(b, fb, a, margin);
        // the point is put half way between the two surfaces
        return spots.length ? { n: mul(b.wn[fb]!, -1), spots: spots.map(([at, gap]) => [sub(at, mul(b.wn[fb]!, gap / 2)), gap]) } : undefined;
    }
    const spots = faceToFace(a, fa, b, margin);
    return spots.length ? { n: a.wn[fa]!, spots: spots.map(([at, gap]) => [sub(at, mul(a.wn[fa]!, gap / 2)), gap]) } : undefined;
}

/** How far the deepest corner of `b` is inside `a`: 0 if none is. For checking that nothing is in anything. */
export function inside(a: Solid, b: Solid): number {
    let most = 0;
    for (const p of b.wp) {
        let least = Infinity;
        for (let face = 0; face < a.wn.length; face++) least = Math.min(least, a.offsets[face]! - dot(a.wn[face]!, p));
        most = Math.max(most, least);
    }
    return most;
}

// ---- the world ----

interface Soft {
    rate: number;
    mass: number;
    impulse: number;
}

function soft(hertz: number, damped: number, h: number): Soft {
    const omega = 2 * Math.PI * hertz;
    const a1 = 2 * damped + h * omega;
    const a2 = h * omega * a1;
    const a3 = 1 / (1 + a2);
    return { rate: omega / a1, mass: a2 * a3, impulse: a3 };
}

export class Space {
    solids: Solid[] = [];
    /** Units per second, each second. */
    gravity: V3 = [0, -34, 0];
    /** How many times a second it looks for what is touching, and how many smaller parts each of those steps is taken in. */
    rate = 240;
    parts = 2;
    /** Slower than this, in units a second, counts as still. */
    slow = 0.12;
    /** Whether a solid that has lain still for `nap` seconds goes to sleep, and costs nothing until it is knocked. A full tray needs it. */
    sleeps = false;
    nap = 0.6;
    /** Told of each pair that met hard this step, and how fast they were closing. For a sound, or a flash. */
    hit?: (a: Solid, b: Solid, speed: number) => void;
    #was: Manifold[] = [];
    #owed = 0;

    /** A solid that moves, from a shape that bulges everywhere, with its middle at `at`. */
    solid(mesh: Mesh, at: V3, stuff: Stuff = {}, q: Quat = [0, 0, 0, 1]): Solid {
        const made = make(mesh, at, q, false, stuff);
        this.solids.push(made);
        return made;
    }

    /** A box that does not move: where its middle is, half its size each way, and how it is turned. */
    slab(at: V3, half: V3, q: Quat = [0, 0, 0, 1], stuff: Stuff = {}): Solid {
        const made = make(block(half), at, q, true, stuff);
        this.solids.push(made);
        return made;
    }

    /** Moves everything on by `dt` seconds, in steps of 1 / `rate`. A time that is not ahead is ignored, and more than a second is taken as a second. */
    step(dt: number): void {
        if (!(dt > 0)) return;
        this.#owed += Math.min(dt, 1);
        const each = 1 / this.rate;
        while (this.#owed >= each - 1e-9) {
            this.#advance(each);
            this.#owed -= each;
        }
    }

    /** Whether everything that can move has been all but still for `seconds`. */
    still(seconds = 0.4): boolean {
        return this.solids.every((solid) => !solid.im || solid.quiet >= seconds);
    }

    /** Holds a solid where it is, as if asleep, until `wake` lets it go: for things let into a scene one after another. */
    hold(solid: Solid): void {
        if (!solid.im) return;
        solid.rest = [solid.im, solid.ii];
        [solid.im, solid.ii] = [0, 0];
    }

    wake(solid: Solid): void {
        if (!solid.rest) return;
        [solid.im, solid.ii] = solid.rest;
        solid.rest = undefined;
        solid.quiet = 0;
    }

    #advance(dt: number): void {
        const { solids } = this;
        const h = dt / this.parts;
        for (const s of solids) if (s.im) place(s);

        // ---- where things touch ----
        const manifolds: Manifold[] = [];
        for (let i = 0; i < solids.length; i++) {
            const a = solids[i]!;
            for (let j = i + 1; j < solids.length; j++) {
                const b = solids[j]!;
                if (!a.im && !b.im) continue;
                const closing = size(sub(b.v, a.v)) + size(a.w) * (a.im ? a.far : 0) + size(b.w) * (b.im ? b.far : 0);
                const margin = MARGIN + Math.min(closing * dt, 1.5);
                // Too far off to matter: by their middles, or for something fixed, by how far the other is outside its faces.
                if (a.im && b.im) {
                    if (size(sub(b.p, a.p)) > a.far + b.far + margin) continue;
                } else {
                    const [box, ball] = a.im ? [b, a] : [a, b];
                    let out = false;
                    for (let f = 0; f < box.wn.length && !out; f++) out = dot(box.wn[f]!, ball.p) - box.offsets[f]! > ball.far + margin;
                    if (out) continue;
                }
                const found = touch(a, b, margin);
                if (!found) continue;
                // something asleep is woken by anything that reaches it while moving
                for (const [lying, other] of [[a, b], [b, a]] as const) {
                    if (lying.rest && other.im && size(other.v) + size(other.w) * other.far > 8 * this.slow) {
                        [lying.im, lying.ii] = lying.rest;
                        lying.rest = undefined;
                        lying.quiet = 0;
                    }
                }
                const before = this.#was.find((old) => old.a === a && old.b === b);
                const n = found.n;
                const t1 = unit(Math.abs(n[0]) < 0.8 ? cross(n, [1, 0, 0]) : cross(n, [0, 1, 0]));
                const t2 = cross(n, t1);
                const back: Quat = [-a.q[0], -a.q[1], -a.q[2], a.q[3]];
                manifolds.push({
                    a, b, n, t1, t2,
                    friction: Math.sqrt(a.friction * b.friction),
                    bounce: Math.max(a.bounce, b.bounce),
                    stiff: !a.im || !b.im,
                    spots: found.spots.map(([at, gap]): Spot => {
                        const [ra, rb] = [sub(at, a.p), sub(at, b.p)];
                        const la = spin(back, ra);
                        // Found again from last step by where it is on the first solid, so that it starts from last step's answer.
                        let [old, near]: [Spot | undefined, number] = [undefined, 0.06 * Math.max(a.im ? a.far : 0, b.im ? b.far : 0)];
                        for (const spot of before?.spots ?? []) {
                            const away = size(sub(spot.la, la));
                            if (away < near) [old, near] = [spot, away];
                        }
                        const [oldOne, oldTwo] = old && before ? [old.one * dot(before.t1, t1) + old.two * dot(before.t2, t1), old.one * dot(before.t1, t2) + old.two * dot(before.t2, t2)] : [0, 0];
                        const ca = sub(ra, mul(n, gap / 2));
                        const cb = add(rb, mul(n, gap / 2));
                        const k = (d: V3) => {
                            const [xa, xb] = [cross(ra, d), cross(rb, d)];
                            const sum = a.im + b.im + a.ii * dot(xa, xa) + b.ii * dot(xb, xb);
                            return sum > 0 ? 1 / sum : 0;
                        };
                        return {
                            ra, rb, ca, cb, la, gap,
                            adjusted: gap - dot(sub(cb, ca), n),
                            normalMass: k(n), oneMass: k(t1), twoMass: k(t2),
                            push: old?.push ?? 0, one: oldOne, two: oldTwo, speed: 0, springy: false, start: 0,
                            closing: dot(sub(add(b.v, cross(b.w, rb)), add(a.v, cross(a.w, ra))), n),
                            most: 0,
                        };
                    }),
                });
            }
        }
        this.#was = manifolds;

        for (const s of solids) {
            s.dp = [0, 0, 0];
            s.dq = [0, 0, 0, 1];
        }
        const contact = soft(Math.min(HERTZ, 0.25 / h), DAMPED, h);
        const firm = soft(Math.min(HERTZ * 2, 0.25 / h), DAMPED, h);

        /** An impulse `j` along `d` on one solid, at `r` from its middle. */
        const push = (solid: Solid, r: V3, d: V3, j: number) => {
            if (!solid.im) return;
            const x = cross(r, d);
            for (let axis = 0; axis < 3; axis++) {
                solid.v[axis]! += solid.im * d[axis]! * j;
                solid.w[axis]! += solid.ii * x[axis]! * j;
            }
        };
        const shove = (m: Manifold, s: Spot, d: V3, j: number) => {
            push(m.a, s.ra, d, -j);
            push(m.b, s.rb, d, j);
        };
        /** How fast b is leaving a at a point, along a direction. */
        const leaving = (m: Manifold, s: Spot, d: V3) => {
            const { a, b } = m;
            const [xa, xb] = [cross(a.w, s.ra), cross(b.w, s.rb)];
            return (b.v[0] + xb[0] - a.v[0] - xa[0]) * d[0] + (b.v[1] + xb[1] - a.v[1] - xa[1]) * d[1] + (b.v[2] + xb[2] - a.v[2] - xa[2]) * d[2];
        };

        let backward = false;
        const contacts = (bias: boolean) => {
            backward = !backward;
            for (let at = 0; at < manifolds.length; at++) {
                const m = manifolds[backward ? manifolds.length - 1 - at : at]!;
                const { a, b, n } = m;
                const spring = m.stiff ? firm : contact;
                const count = m.spots.length;
                // The points of one face are gone over several times, back and forth, so that they agree with
                // each other. Once through, the first is favored, the solid turns a hair, and friction makes
                // that a step sideways: a stack that walks.
                for (let sweep = 0; sweep < (count > 1 ? 4 : 1); sweep++) {
                    for (let k = 0; k < count; k++) {
                        const s = m.spots[backward !== (sweep % 2 === 1) ? count - 1 - k : k]!;
                        if (!sweep) {
                            // how far apart they are now, from how far each has moved and turned since the step began
                            const gap = dot(add(sub(b.dp, a.dp), sub(spin(b.dq, s.cb), spin(a.dq, s.ca))), n) + s.adjusted;
                            // Not yet touching: allowed to close exactly the gap, and no more. Overlapping: pushed out, softly.
                            s.springy = gap <= 0 && bias;
                            s.speed = gap > 0 ? gap / h : bias ? Math.max(spring.rate * gap, -PUSH) : 0;
                            s.start = s.push;
                        }
                        // a springy point gives a little, by how much it has been pushed since this pass began
                        const [mass, scale] = s.springy ? [spring.mass, spring.impulse] : [1, 0];
                        const push = Math.max(0, s.push - s.normalMass * mass * (leaving(m, s, n) + s.speed) - scale * s.start + (s.springy ? (1 - mass) * (s.start - s.push) : 0));
                        shove(m, s, n, push - s.push);
                        s.push = push;
                        s.most = Math.max(s.most, push);
                    }
                }
                for (let k = 0; k < count; k++) {
                    const s = m.spots[backward ? count - 1 - k : k]!;
                    // rubbing: no more than the two are pressed together allows, whichever way it is across the face
                    const [one, two] = [s.one - s.oneMass * leaving(m, s, m.t1), s.two - s.twoMass * leaving(m, s, m.t2)];
                    const [long, most] = [Math.hypot(one, two), m.friction * s.push];
                    const keep = long > most ? most / long : 1;
                    shove(m, s, m.t1, one * keep - s.one);
                    shove(m, s, m.t2, two * keep - s.two);
                    [s.one, s.two] = [one * keep, two * keep];
                }
            }
        };

        // ---- the step, in parts ----
        for (let part = 0; part < this.parts; part++) {
            for (const s of solids) {
                if (!s.im) continue;
                const [slow, turnSlow] = [1 / (1 + h * s.damping), 1 / (1 + h * s.spinDamping)];
                s.v = [(s.v[0] + this.gravity[0] * h) * slow, (s.v[1] + this.gravity[1] * h) * slow, (s.v[2] + this.gravity[2] * h) * slow];
                s.w = mul(s.w, turnSlow);
            }
            for (const m of manifolds) {
                for (const s of m.spots) {
                    shove(m, s, m.n, s.push);
                    shove(m, s, m.t1, s.one);
                    shove(m, s, m.t2, s.two);
                }
            }
            contacts(true);
            for (const s of solids) {
                if (!s.im) continue;
                const [move, by] = [mul(s.v, h), mul(s.w, h)];
                s.p = add(s.p, move);
                s.dp = add(s.dp, move);
                s.q = turnedBy(s.q, by);
                s.dq = turnedBy(s.dq, by);
            }
            contacts(false);
        }

        if (this.hit) {
            for (const m of manifolds) {
                const closing = Math.min(...m.spots.map((s) => s.closing));
                if (closing < -1.2) this.hit(m.a, m.b, -closing);
            }
        }

        // ---- bounce: what hit hard enough leaves with some of the speed it came with ----
        for (const m of manifolds) {
            if (!m.bounce) continue;
            for (const s of m.spots) {
                if (s.closing > -1.2 || !s.most) continue;
                const push = Math.max(0, s.push - s.normalMass * (leaving(m, s, m.n) + m.bounce * s.closing));
                shove(m, s, m.n, push - s.push);
                s.push = push;
            }
        }

        for (const s of solids) {
            if (!s.im) continue;
            s.quiet = size(s.v) + size(s.w) * s.far < this.slow ? s.quiet + dt : 0;
            if (this.sleeps && s.quiet > this.nap) {
                s.rest = [s.im, s.ii];
                [s.im, s.ii, s.v, s.w] = [0, 0, [0, 0, 0], [0, 0, 0]];
            }
        }
    }
}
