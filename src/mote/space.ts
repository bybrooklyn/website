// Mote's 3D physics: solid things with flat faces that fall, tumble and come
// to rest. It is here for the dice, and has only what they need: solids that
// bulge everywhere, fixed slabs to land on, friction and bounce. Each solid
// turns as its shape says, by its inertia tensor, so a long or lopsided one
// tumbles as a real one does. Units are whatever the scene uses; y points up.
//
//   const space = new Space();
//   space.slab([0, -0.5, 0], [10, 0.5, 10]);          // a floor
//   const die = space.solid(cube(), [0, 4, 0]);
//   space.step(dt);
//   die.p, turn(die)                                   // where it is and how it is turned
//
// A step goes as flat.ts's does: the grid in grid.ts finds which pairs are
// near enough to look at, where things touch is found once, then the
// step is taken in small parts, each solving every touch as a stiff, heavily
// damped spring, moving the solids, and solving once more without the spring.
// Before the touches are solved in each part, a solid that is not equally hard
// to turn every way has its spin changed by itself (`gyroscope`).
//
// What it is held to is in space.test.ts.

import { Grid, Kept, type Pairs } from "./grid";
import { block, cross, dot3 as dot, minus as sub, plus as add, scaled as mul, type Mesh, type Turn, type V3 } from "./solids";
import type { Piece, Touch } from "./track";

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
    /**
     * For a ball: how much rolling costs, as a share of how hard it is pressed, so that a ball rolling
     * on the flat comes to rest (it slows by 5/7 of this times gravity, and stays put on a slope
     * whose rise over run is less than this). None unless said.
     */
    roll?: number;
    /** For a ball: how much spinning in place on the spot it touches costs, the same way. None unless said. */
    twist?: number;
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
    /** How far its nearest face is from its middle. */
    readonly inner: number;
    readonly mass: number;
    /**
     * 1 / mass and 1 / how hard it is to turn: both 0 for something that does not move, or is asleep.
     * For a solid not equally hard to turn every way, `ii` is 1 / the mean of the three, and the
     * tensor below is what is used.
     */
    im: number;
    ii: number;
    /** For a solid not equally hard to turn every way: its inertia tensor and the tensor's inverse in its own frame, three rows of three. */
    readonly inertia?: number[];
    readonly turning?: number[];
    /** The inverse turned into the world, worked out afresh each step. */
    turned?: number[];
    /** Asleep: lying still, and left out of the work until something moving reaches it. What it weighs is kept here meanwhile. */
    rest?: [im: number, ii: number];
    /** Held by `hold`: kept where it is, and not woken by what touches it, until `wake`. */
    held?: boolean;
    friction: number;
    bounce: number;
    /** How quickly it slows by itself, per second, moving and turning. */
    damping: number;
    spinDamping: number;
    /** How long it has been all but still, in seconds. */
    quiet: number;
    /** A ball: its radius. A ball has no corners or faces; it is met by its middle and this. */
    readonly radius?: number;
    /** A ball's rolling and spinning costs, from its stuff. */
    rolling: number;
    twisting: number;
    /** A piece of fixed track (track.ts): it has no faces either, and only balls meet it. */
    readonly piece?: Piece;
    /** Asleep with others it touched, when islands sleep together: all of them, itself too, to be woken with it. */
    together?: Solid[];
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
    /**
     * With a ball: how far apart the two are as the part of a step begins, measured afresh rather than
     * from how far each has moved; where the ball was then thought to be going, how far apart it would
     * be there and the way the surface faces there; the speed it may close at, which lands it on the
     * surface; and the turning pushes that stand for rolling and spinning costs, with how much each takes.
     */
    now?: number;
    going?: V3;
    there?: number;
    toward?: V3;
    firm?: number;
    calm?: number;
    rollOne?: number;
    rollTwo?: number;
    spin?: number;
    rollOneMass?: number;
    rollTwoMass?: number;
    spinMass?: number;
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
    /** With a ball in it: solved by the ball's own rules. Its rolling and spinning costs, as the most turning push for each unit of push. */
    round?: boolean;
    roll?: number;
    twist?: number;
    /** Against track: which piece, which part of its section, and where along it. */
    piece?: Piece;
    part?: number;
    where?: number;
}

/** A vector's length by its square root, which every machine works out alike (Math.hypot may differ in its last bit). */
const length = (a: V3) => Math.sqrt(a[0] * a[0] + a[1] * a[1] + a[2] * a[2]);

/** A quaternion turned further by a small rotation, made whole again by a square root: as `turnedBy`, for balls, whose turn must come out alike everywhere. */
function rolled(q: Quat, by: V3): Quat {
    const [x, y, z, w] = q;
    const [bx, by2, bz] = [by[0] / 2, by[1] / 2, by[2] / 2];
    const next: Quat = [x + bx * w + by2 * z - bz * y, y + by2 * w + bz * x - bx * z, z + bz * w + bx * y - by2 * x, w - bx * x - by2 * y - bz * z];
    const long = Math.sqrt(next[0] * next[0] + next[1] * next[1] + next[2] * next[2] + next[3] * next[3]) || 1;
    return [next[0] / long, next[1] / long, next[2] / long, next[3] / long];
}

/**
 * The nearest point of a solid of faces to a point `c`, the way from it to `c`, and how far: less
 * than none if `c` is inside, then by the face it is least deep behind. Outside, the nearest point is
 * on a face `c` is in front of, if it lies within that face, or else on an edge or a corner.
 */
export function nearestOn(s: Solid, c: V3): { q: V3; n: V3; d: number } {
    let [best, face] = [-Infinity, 0];
    for (let f = 0; f < s.wn.length; f++) {
        const d = dot(s.wn[f]!, c) - s.offsets[f]!;
        if (d > best) [best, face] = [d, f];
    }
    if (best <= 0) return { q: sub(c, mul(s.wn[face]!, best)), n: s.wn[face]!, d: best };
    for (let f = 0; f < s.wn.length; f++) {
        const n = s.wn[f]!;
        const d = dot(n, c) - s.offsets[f]!;
        if (d <= 0) continue;
        const corners = s.faces[f]!;
        let [sign, within] = [0, true];
        for (let i = 0; i < corners.length && within; i++) {
            const a = s.wp[corners[i]!]!;
            const side = dot(cross(sub(s.wp[corners[(i + 1) % corners.length]!]!, a), sub(c, a)), n);
            if (side === 0) continue;
            if (!sign) sign = Math.sign(side);
            else if (Math.sign(side) !== sign) within = false;
        }
        if (within) return { q: sub(c, mul(n, d)), n, d };
    }
    let [least, q] = [Infinity, c];
    for (const [i, j] of s.edges) {
        const [a, b] = [s.wp[i]!, s.wp[j]!];
        const run = sub(b, a);
        const long = dot(run, run);
        const k = long > 0 ? Math.max(0, Math.min(1, dot(sub(c, a), run) / long)) : 0;
        const on = add(a, mul(run, k));
        const away = sub(c, on);
        const far = dot(away, away);
        if (far < least) [least, q] = [far, on];
    }
    const away = sub(c, q);
    const d = length(away);
    return { q, n: d > 0 ? mul(away, 1 / d) : s.wn[face]!, d };
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

/** Three rows of three, turned by `q` into the world, `q m q'`, written into `out`. */
function toWorld(q: Quat, m: number[], out: number[]): void {
    const r = turn({ q });
    for (let i = 0; i < 3; i++) {
        for (let j = 0; j < 3; j++) {
            let sum = 0;
            for (let k = 0; k < 3; k++) for (let l = 0; l < 3; l++) sum += r[i]![k]! * m[k * 3 + l]! * r[j]![l]!;
            out[i * 3 + j] = sum;
        }
    }
}

/** How much a solid turns for a push whose turning part is `x` (the push across from its middle), along `x`: `x` against 1 / its inertia. */
function hardness(s: Solid, x: V3): number {
    const t = s.turned;
    if (!t) return s.ii * dot(x, x);
    if (!s.ii) return 0;
    return x[0] * (t[0]! * x[0] + t[1]! * x[1] + t[2]! * x[2]) + x[1] * (t[3]! * x[0] + t[4]! * x[1] + t[5]! * x[2]) + x[2] * (t[6]! * x[0] + t[7]! * x[1] + t[8]! * x[2]);
}

/** Three rows of three times a vector. */
const times = (m: number[], v: V3): V3 => [m[0]! * v[0] + m[1]! * v[1] + m[2]! * v[2], m[3]! * v[0] + m[4]! * v[1] + m[5]! * v[2], m[6]! * v[0] + m[7]! * v[1] + m[8]! * v[2]];

/**
 * A spinning solid that is harder to turn one way than another changes how it spins by itself (the
 * gyroscopic term: a bar tumbles, a coin wobbles). This takes that on by `h` seconds, in the solid's
 * own frame, by the implicit midpoint rule: the new spin is the one for which the old and the new,
 * averaged, explain the change. That rule keeps both the energy of the spin and the size of its
 * angular momentum exactly, where a plain step adds energy each time and the spin flies apart. The
 * equation is solved by Newton's method, which needs two or three goes. Returns the new spin, in the world.
 */
export function gyroscope(q: Quat, tensor: number[], w: V3, h: number): V3 {
    const r = turn({ q });
    // into the solid's own frame
    const before: V3 = [r[0][0] * w[0] + r[1][0] * w[1] + r[2][0] * w[2], r[0][1] * w[0] + r[1][1] * w[1] + r[2][1] * w[2], r[0][2] * w[0] + r[1][2] * w[1] + r[2][2] * w[2]];
    let mid: V3 = [...before];
    for (let go = 0; go < 6; go++) {
        const held = times(tensor, mid);
        // what is left over: 2 I (mid - before) + h mid x (I mid)
        const over = add(mul(times(tensor, sub(mid, before)), 2), mul(cross(mid, held), h));
        // and how it changes with mid: 2 I + h (mid x I - (I mid) x)
        const slope: number[] = [];
        for (let i = 0; i < 3; i++) {
            for (let j = 0; j < 3; j++) {
                const column: V3 = [tensor[j]!, tensor[3 + j]!, tensor[6 + j]!];
                const across = cross(mid, column)[i]! - (cross(held, [j === 0 ? 1 : 0, j === 1 ? 1 : 0, j === 2 ? 1 : 0])[i] ?? 0);
                slope.push(2 * tensor[i * 3 + j]! + h * across);
            }
        }
        const change = times(inverse(slope), over);
        mid = sub(mid, change);
        if (size(change) <= 1e-15 * (size(mid) + 1e-300)) break;
    }
    const after = sub(mul(mid, 2), before);
    // back into the world
    return [r[0][0] * after[0] + r[0][1] * after[1] + r[0][2] * after[2], r[1][0] * after[0] + r[1][1] * after[1] + r[1][2] * after[2], r[2][0] * after[0] + r[2][1] * after[1] + r[2][2] * after[2]];
}

/** How far a box one unit from its middle along each of its own axes reaches along one of the world's, turned by `q`: a row of `turn`, each part made positive and added up. */
function across(q: Quat, axis: number): number {
    const [x, y, z, w] = q;
    if (axis === 0) return Math.abs(1 - 2 * (y * y + z * z)) + Math.abs(2 * (x * y - z * w)) + Math.abs(2 * (x * z + y * w));
    if (axis === 1) return Math.abs(2 * (x * y + z * w)) + Math.abs(1 - 2 * (x * x + z * z)) + Math.abs(2 * (y * z - x * w));
    return Math.abs(2 * (x * z - y * w)) + Math.abs(2 * (y * z + x * w)) + Math.abs(1 - 2 * (x * x + y * y));
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

/**
 * How hard a solid is to turn about each axis through a point, as three rows of three (its inertia
 * tensor), for a solid that bulges everywhere and whose faces wind outward, at this density. It is
 * summed over the pyramids from the point to each triangle of each face; give the points measured
 * from where the solid balances to have it about its middle.
 */
export function inertia(points: V3[], faces: number[][], density = 1): number[] {
    // the second moments: how far the solid reaches along each axis and each pair of axes, squared
    let [volume, xx, yy, zz, xy, xz, yz] = [0, 0, 0, 0, 0, 0, 0];
    for (const face of faces) {
        for (let i = 1; i + 1 < face.length; i++) {
            const [a, b, c] = [points[face[0]!]!, points[face[i]!]!, points[face[i + 1]!]!];
            const six = dot(a, cross(b, c));
            const s = add(add(a, b), c);
            const k = six / 120;
            volume += six / 6;
            xx += k * (a[0] * a[0] + b[0] * b[0] + c[0] * c[0] + s[0] * s[0]);
            yy += k * (a[1] * a[1] + b[1] * b[1] + c[1] * c[1] + s[1] * s[1]);
            zz += k * (a[2] * a[2] + b[2] * b[2] + c[2] * c[2] + s[2] * s[2]);
            xy += k * (a[0] * a[1] + b[0] * b[1] + c[0] * c[1] + s[0] * s[1]);
            xz += k * (a[0] * a[2] + b[0] * b[2] + c[0] * c[2] + s[0] * s[2]);
            yz += k * (a[1] * a[2] + b[1] * b[2] + c[1] * c[2] + s[1] * s[2]);
        }
    }
    // faces wound the other way round give everything the other sign
    const by = (volume < 0 ? -1 : 1) * density;
    [xx, yy, zz, xy, xz, yz] = [xx * by, yy * by, zz * by, xy * by, xz * by, yz * by];
    return [yy + zz, -xy, -xz, -xy, xx + zz, -yz, -xz, -yz, xx + yy];
}

/** The inverse of three rows of three, or all zeros if it has none. */
function inverse(m: number[]): number[] {
    const [a, b, c, d, e, f, g, h, k] = m as [number, number, number, number, number, number, number, number, number];
    const [A, B, C] = [e * k - f * h, f * g - d * k, d * h - e * g];
    const det = a * A + b * B + c * C;
    if (!det) return [0, 0, 0, 0, 0, 0, 0, 0, 0];
    return [A / det, (c * h - b * k) / det, (b * f - c * e) / det, B / det, (a * k - c * g) / det, (c * d - a * f) / det, C / det, (b * g - a * h) / det, (a * e - b * d) / det];
}

/** Within this share of each other, a solid's turning about its three axes is taken to be one number. */
const EVEN = 1e-9;

function make(mesh: Mesh, at: V3, q: Quat, fixed: boolean, stuff: Stuff): Solid {
    // Its middle is where it balances. How hard it is to turn is its inertia tensor; where that is the
    // same about every axis (a ball, a cube, every die but the ten) one number stands for it, as it
    // always did, so that those turn exactly as they did before the tensor.
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
    const tensor = inertia(points, mesh.faces, stuff.density ?? 1);
    const mean = (tensor[0]! + tensor[4]! + tensor[8]!) / 3;
    const even = [tensor[0]! - mean, tensor[4]! - mean, tensor[8]! - mean, tensor[1]!, tensor[2]!, tensor[5]!].every((part) => Math.abs(part) <= EVEN * mean);
    const solid: Solid = {
        id: ++count,
        p: add(at, spin(q, middle)), q, v: [0, 0, 0], w: [0, 0, 0],
        points, faces: mesh.faces, normals, edges, runs,
        far: Math.max(...points.map(size)),
        inner: Math.min(...normals.map((n, i) => dot(n, points[mesh.faces[i]![0]!]!))),
        mass,
        im: fixed ? 0 : 1 / mass,
        ii: fixed ? 0 : even ? 1 / ((2 / 3) * around * (stuff.density ?? 1)) : 1 / mean,
        inertia: even ? undefined : tensor,
        turning: even ? undefined : inverse(tensor),
        turned: even ? undefined : [0, 0, 0, 0, 0, 0, 0, 0, 0],
        friction: stuff.friction ?? 0.4,
        bounce: stuff.bounce ?? 0,
        damping: 0, spinDamping: 0, quiet: 0,
        rolling: stuff.roll ?? 0, twisting: stuff.twist ?? 0,
        wp: [], wn: [], wr: [], offsets: [], dp: [0, 0, 0], dq: [0, 0, 0, 1],
    };
    place(solid);
    return solid;
}

/**
 * A solid with no faces: a ball, met by its middle and radius, or a piece of track, met by its own
 * formula. A ball's inertia tensor is 2/5 of its mass times its radius squared about every axis; the
 * same every way, so, as for a cube in `make`, the one number stands for it and the solver's tensor
 * path takes it as it takes a cube.
 */
function bare(at: V3, stuff: Stuff, radius: number | undefined, piece: Piece | undefined): Solid {
    const density = stuff.density ?? 1;
    const mass = radius === undefined ? 0 : (4 / 3) * Math.PI * radius * radius * radius * density;
    const tensor = radius === undefined ? 0 : (2 / 5) * mass * radius * radius;
    return {
        id: ++count,
        p: [...at], q: [0, 0, 0, 1], v: [0, 0, 0], w: [0, 0, 0],
        points: [], faces: [], normals: [], edges: [], runs: [],
        far: radius ?? 0, inner: radius ?? 0, mass,
        im: mass ? 1 / mass : 0, ii: tensor ? 1 / tensor : 0,
        friction: stuff.friction ?? 0.4, bounce: stuff.bounce ?? 0,
        damping: 0, spinDamping: 0, quiet: 0,
        radius, piece, rolling: stuff.roll ?? 0, twisting: stuff.twist ?? 0,
        wp: [], wn: [], wr: [], offsets: [], dp: [0, 0, 0], dq: [0, 0, 0, 1],
    };
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

/**
 * A space for marbles: centimetres and real gravity, with the sizes that depend on units set for
 * that, and islands that sleep together. A glass marble is a ball of radius 0.8 with friction 0.5,
 * bounce 0.5 and a small rolling cost (`MARBLE`).
 */
export function marbleSpace(): Space {
    const space = new Space();
    space.gravity = [0, -981, 0];
    space.margin = 0.02;
    space.push = 20;
    // looked ahead far enough for a marble at 2,800 cm/s, five times as fast as a two metre drop gives
    space.ahead = 12;
    space.knock = 5;
    space.slow = 0.3;
    space.sleeps = true;
    space.islands = true;
    space.nap = 0.5;
    return space;
}

/** A glass marble's stuff on wood, in a marble space: its rolling cost brings one rolling at 50 cm/s on the flat to rest in about 18 seconds. */
export const MARBLE: Stuff = { friction: 0.5, bounce: 0.5, roll: 0.004, twist: 0.005, density: 2.5 };

/**
 * Pieces of track that meet end to end, with the same section and facing the same way, are joined
 * there, so that a ball rolls from one to the next with no rim between them. Found by where each end
 * is, to a thousandth of a unit, then checked closely.
 */
export function join(pieces: Piece[]): void {
    const near = (a: V3, b: V3, by: number) => length(sub(a, b)) <= by;
    const at = new Map<string, [Piece, number][]>();
    const key = (p: V3) => p.map((value) => Math.round(value * 1000)).join(" ");
    for (const piece of pieces) piece.ends?.forEach((end, which) => {
        for (const dx of [-1, 0, 1]) for (const dy of [-1, 0, 1]) for (const dz of [-1, 0, 1]) {
            const found = at.get(key(add(end.p, [dx / 1000, dy / 1000, dz / 1000])));
            for (const [other, side] of found ?? []) {
                if (other === piece || other.shape !== piece.shape) continue;
                const there = other.ends![side]!;
                // one piece's end against the other's start, going on the same way, up the same way
                const onward = which !== side && dot(end.along, there.along) > 1 - 1e-9 && dot(end.up, there.up) > 1 - 1e-9;
                if (!onward || !near(end.p, there.p, 1e-6)) continue;
                piece.joined[which] = true;
                other.joined[side] = true;
            }
        }
        const list = at.get(key(end.p));
        if (list) list.push([piece, which]);
        else at.set(key(end.p), [[piece, which]]);
    });
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
    /**
     * Whether solids that touch sleep together and wake together, as islands, rather than each on its
     * own: a marble resting on a sleeping heap then does not keep waking it. Off unless set, so that
     * the dice sleep as they always have.
     */
    islands = false;
    /**
     * Sizes that depend on the scene's units, each as it always was unless set: how near counts as
     * about to touch, the fastest an overlap is undone, the most that is looked ahead for anything
     * fast in one step, and the slowest a hit is told of and bounces. A scene in other units (a marble
     * run in centimetres, with real gravity) sets them for its own.
     */
    margin = MARGIN;
    push = PUSH;
    ahead = 1.5;
    knock = 1.2;
    /** Told of each pair that met hard this step, and how fast they were closing. For a sound, or a flash. */
    hit?: (a: Solid, b: Solid, speed: number) => void;
    /**
     * How pairs of solids near enough to touch are found: a grid, which hands them over in the order a
     * loop over every pair would. A test puts every pair here instead, to check the grid changes nothing.
     */
    pairs: Pairs = new Grid(3);
    /** Last step's contacts by pair, to start from; and the map the next step's go in. */
    #was = new Map<number, Manifold>();
    #next = new Map<number, Manifold>();
    #owed = 0;
    /** The track, its chunks in a table of their own that is filled once, and what each entry of the table is. */
    #pieces: Solid[] = [];
    #kept = new Kept();
    #keptPiece: number[] = [];
    #keptChunk: number[] = [];
    #built = true;
    /** Last step's contacts with track, by ball, piece and part; and the map the next step's go in. */
    #wasOn = new Map<number, Manifold[]>();
    #nextOn = new Map<number, Manifold[]>();
    #touches: Touch[] = [];
    #low = new Float64Array(3);
    #high = new Float64Array(3);

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

    /** A ball that moves: its radius and where its middle is. Its rolling and spinning costs are in its stuff. */
    ball(radius: number, at: V3, stuff: Stuff = {}): Solid {
        const made = bare(at, stuff, radius, undefined);
        this.solids.push(made);
        return made;
    }

    /**
     * A piece of fixed track from track.ts: balls roll on it, by its formula; other solids pass
     * through it. Its stuff gives its friction, bounce and rolling cost against a ball.
     */
    track(piece: Piece, stuff: Stuff = {}): Solid {
        const made = bare([0, 0, 0], stuff, undefined, piece);
        this.solids.push(made);
        this.#pieces.push(made);
        this.#built = false;
        return made;
    }

    /** Takes a solid, a ball or a piece of track out of the world. */
    remove(solid: Solid): void {
        const at = this.solids.indexOf(solid);
        if (at < 0) return;
        this.solids.splice(at, 1);
        if (solid.piece) {
            this.#pieces.splice(this.#pieces.indexOf(solid), 1);
            this.#built = false;
        }
        for (const other of solid.together ?? []) if (other !== solid) other.together = other.together?.filter((one) => one !== solid);
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
        solid.held = true;
    }

    wake(solid: Solid): void {
        solid.held = false;
        if (!solid.rest) return;
        [solid.im, solid.ii] = solid.rest;
        solid.rest = undefined;
        solid.quiet = 0;
        this.#rouse(solid);
    }

    /** Wakes a sleeping solid that is not held, and every solid that went to sleep with it. */
    #rouse(solid: Solid): void {
        for (const one of solid.together ?? [solid]) {
            if (!one.rest || one.held) continue;
            [one.im, one.ii] = one.rest;
            one.rest = undefined;
            one.quiet = 0;
        }
        for (const one of solid.together ?? []) one.together = undefined;
    }

    /** Where a ball meets another ball or a solid of faces, or comes within reach of it this step: a contact of one point, or none. */
    #round(a: Solid, b: Solid, dt: number, before: Manifold | undefined): Manifold | undefined {
        const closing = length(sub(b.v, a.v)) + length(a.w) * (a.im ? a.far : 0) + length(b.w) * (b.im ? b.far : 0);
        const margin = this.margin + Math.min(closing * dt, this.ahead);
        let [n, at, gap]: [V3, V3, number] = [[0, 1, 0], [0, 0, 0], 0];
        if (a.radius !== undefined && b.radius !== undefined) {
            const d = sub(b.p, a.p);
            const long = length(d);
            gap = long - a.radius - b.radius;
            if (gap > margin) return undefined;
            if (long > 0) n = mul(d, 1 / long);
            at = add(a.p, mul(n, a.radius + gap / 2));
        } else {
            const [ball, solid] = a.radius !== undefined ? [a, b] : [b, a];
            if (solid.piece || length(sub(ball.p, solid.p)) > solid.far + ball.radius! + margin) return undefined;
            const near = nearestOn(solid, ball.p);
            gap = near.d - ball.radius!;
            if (gap > margin) return undefined;
            at = add(near.q, mul(near.n, gap / 2));
            n = ball === b ? near.n : mul(near.n, -1);
        }
        // something asleep is woken by anything that reaches it while moving; something held is not
        for (const [lying, other] of [[a, b], [b, a]] as const) {
            if (lying.rest && !lying.held && other.im && length(other.v) + length(other.w) * other.far > 8 * this.slow) this.#rouse(lying);
        }
        return this.#meet(a, b, n, at, gap, before);
    }

    /** A contact with a ball at one point, `n` from a to b, starting from last step's pushes if it was there then. */
    #meet(a: Solid, b: Solid, n: V3, at: V3, gap: number, before: Manifold | undefined): Manifold {
        const across = Math.abs(n[0]) < 0.8 ? cross(n, [1, 0, 0]) : cross(n, [0, 1, 0]);
        const t1 = mul(across, 1 / length(across));
        const t2 = cross(n, t1);
        const [ra, rb] = [sub(at, a.p), sub(at, b.p)];
        // A ball has one point against anything, so last step's is this one.
        const old = before?.spots[0];
        const into = (one: number, two: number): [number, number] => (before ? [one * dot(before.t1, t1) + two * dot(before.t2, t1), one * dot(before.t1, t2) + two * dot(before.t2, t2)] : [0, 0]);
        const [oldOne, oldTwo] = old ? into(old.one, old.two) : [0, 0];
        const [rollOne, rollTwo] = old ? into(old.rollOne ?? 0, old.rollTwo ?? 0) : [0, 0];
        const ca = sub(ra, mul(n, gap / 2));
        const cb = add(rb, mul(n, gap / 2));
        const k = (d: V3) => {
            const sum = a.im + b.im + hardness(a, cross(ra, d)) + hardness(b, cross(rb, d));
            return sum > 0 ? 1 / sum : 0;
        };
        const turning = (d: V3) => {
            const sum = hardness(a, d) + hardness(b, d);
            return sum > 0 ? 1 / sum : 0;
        };
        const radius = Math.min(a.radius ?? Infinity, b.radius ?? Infinity);
        return {
            a, b, n, t1, t2,
            friction: Math.sqrt(a.friction * b.friction),
            bounce: Math.max(a.bounce, b.bounce),
            stiff: !a.im || !b.im,
            round: true,
            roll: Math.max(a.rolling, b.rolling) * radius,
            twist: Math.max(a.twisting, b.twisting) * radius,
            spots: [{
                ra, rb, ca, cb, la: ra, gap,
                adjusted: gap - dot(sub(cb, ca), n),
                normalMass: k(n), oneMass: k(t1), twoMass: k(t2),
                push: old?.push ?? 0, one: oldOne, two: oldTwo, speed: 0, springy: false, start: 0,
                closing: dot(sub(add(b.v, cross(b.w, rb)), add(a.v, cross(a.w, ra))), n),
                most: 0,
                rollOne, rollTwo, spin: old?.spin ?? 0,
                rollOneMass: turning(t1), rollTwoMass: turning(t2), spinMass: turning(n),
            }],
        };
    }

    /**
     * Every ball that moves against the track near it: the table of chunks gives the chunks its box
     * reaches, and each chunk's piece says where the ball touches it. A contact is found again from
     * last step by ball, piece and part, and by being near the same place along the piece.
     */
    #onTrack(manifolds: Manifold[], dt: number): void {
        const kept = this.#kept;
        if (!this.#built) {
            kept.clear();
            this.#keptPiece = [];
            this.#keptChunk = [];
            const [low, high] = [new Float64Array(3), new Float64Array(3)];
            this.#pieces.forEach((solid, index) => {
                for (let k = 0; k < solid.piece!.chunks; k++) {
                    solid.piece!.box(k, low, high, 0);
                    kept.add(low, high);
                    this.#keptPiece.push(index);
                    this.#keptChunk.push(k);
                }
            });
            kept.build();
            this.#built = true;
            join(this.#pieces.map((solid) => solid.piece!));
        }
        const was = this.#wasOn;
        this.#wasOn = this.#nextOn;
        this.#nextOn = was;
        const next = this.#wasOn;
        next.clear();
        const [low, high, touches] = [this.#low, this.#high, this.#touches];
        for (const ball of this.solids) {
            if (ball.radius === undefined || !ball.im) continue;
            const within = this.margin + Math.min((length(ball.v) + length(ball.w) * ball.radius) * dt, this.ahead);
            for (let axis = 0; axis < 3; axis++) {
                low[axis] = ball.p[axis]! - ball.radius - within;
                high[axis] = ball.p[axis]! + ball.radius + within;
            }
            const found = kept.find(low, high);
            for (let f = 0; f < found; f++) {
                const entry = kept.found[f]!;
                const index = this.#keptPiece[entry]!;
                const track = this.#pieces[index]!;
                const piece = track.piece!;
                touches.length = 0;
                piece.touch(this.#keptChunk[entry]!, ball.p, ball.radius, within, touches);
                for (const touch of touches) {
                    const key = ball.id * 2 ** 16 + index * 16 + touch.part;
                    // last step's contact with this part, if it was near the same place along the piece
                    let [before, near]: [Manifold | undefined, number] = [undefined, 2 * (piece.knots[1]! - piece.knots[0]!)];
                    for (const m of was.get(key) ?? []) {
                        if (Math.abs(m.where! - touch.where) < near) [before, near] = [m, Math.abs(m.where! - touch.where)];
                    }
                    const made = this.#meet(track, ball, touch.n, add(touch.at, mul(touch.n, touch.gap / 2)), touch.gap, before);
                    [made.piece, made.part, made.where] = [piece, touch.part, touch.where];
                    manifolds.push(made);
                    const list = next.get(key);
                    if (list) list.push(made);
                    else next.set(key, [made]);
                }
            }
        }
    }

    #advance(dt: number): void {
        const { solids } = this;
        const h = dt / this.parts;
        for (const s of solids) {
            if (s.im && s.radius === undefined) place(s);
            // how hard it is to turn, as it is turned now: the same for the whole step
            if (s.turning && s.turned && (s.im || s.rest)) toWorld(s.q, s.turning, s.turned);
        }

        // ---- which pairs are near enough to look at ----
        // The test below sets two moving solids against each other by their middles, and a moving one
        // against one that is not (fixed, asleep or held) by how far its middle is outside the other's
        // faces. Each solid is given a box that holds every place either test could let a pair through.
        const pairs = this.pairs;
        const count = solids.length;
        pairs.ready(count);
        // the most any solid that moves reaches: its size, and the most a pair's margin can be
        let far = 0;
        let fastest = 0;
        for (const s of solids) {
            if (s.im || s.rest) far = Math.max(far, s.far);
            fastest = Math.max(fastest, size(s.v) + size(s.w) * s.far);
        }
        const reach = far + this.margin + Math.min(2 * fastest * dt, this.ahead) + 1e-6;
        const { low, high } = pairs;
        for (let i = 0; i < count; i++) {
            const s = solids[i]!;
            pairs.moves[i] = s.im || s.rest ? 1 : 0;
            if (!s.im && !s.rest) {
                // Fixed, which only a slab is: a box whose faces are pushed out by `reach` is a box
                // `reach` larger along each of its own axes, which reaches this much further along the world's.
                for (let axis = 0; axis < 3; axis++) {
                    let least = Infinity;
                    let most = -Infinity;
                    for (const p of s.wp) {
                        least = Math.min(least, p[axis]!);
                        most = Math.max(most, p[axis]!);
                    }
                    const grow = reach * across(s.q, axis) + 1e-6;
                    low[i * 3 + axis] = least - grow;
                    high[i * 3 + axis] = most + grow;
                }
                continue;
            }
            // as the one that moves: its middle, its size and its share of the margin
            let out = s.far + this.margin / 2 + Math.min((size(s.v) + size(s.w) * s.far) * dt, this.ahead) + 1e-6;
            // Asleep or held, it may also be the one that does not move, its faces each pushed out by
            // `reach`: that lies inside the solid grown about its middle until its nearest face has moved that far.
            if (!s.im) out = Math.max(out, s.far * (1 + reach / s.inner) + 1e-6);
            for (let axis = 0; axis < 3; axis++) {
                low[i * 3 + axis] = s.p[axis]! - out;
                high[i * 3 + axis] = s.p[axis]! + out;
            }
        }
        pairs.find(count);

        // ---- where things touch ----
        const manifolds: Manifold[] = [];
        const was = this.#was;
        const { start, other } = pairs;
        for (let i = 0; i < count; i++) {
            const a = solids[i]!;
            for (let k = start[i]!; k < start[i + 1]!; k++) {
                const b = solids[other[k]!]!;
                if (!a.im && !b.im) continue;
                // a ball is met by its own rules, below
                if (a.radius !== undefined || b.radius !== undefined) {
                    const made = this.#round(a, b, dt, was.get(a.id * 2 ** 26 + b.id));
                    if (made) manifolds.push(made);
                    continue;
                }
                const closing = size(sub(b.v, a.v)) + size(a.w) * (a.im ? a.far : 0) + size(b.w) * (b.im ? b.far : 0);
                const margin = this.margin + Math.min(closing * dt, this.ahead);
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
                // something asleep is woken by anything that reaches it while moving; something held is not
                for (const [lying, other] of [[a, b], [b, a]] as const) {
                    if (lying.rest && !lying.held && other.im && size(other.v) + size(other.w) * other.far > 8 * this.slow) this.#rouse(lying);
                }
                const before = was.get(a.id * 2 ** 26 + b.id);
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
                            const sum = a.im + b.im + hardness(a, xa) + hardness(b, xb);
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
        // Kept by pair for the next step to find each again; the two maps take turns, so neither is made anew.
        this.#was = this.#next;
        this.#next = was;
        this.#next.clear();
        for (const m of manifolds) this.#was.set(m.a.id * 2 ** 26 + m.b.id, m);
        // balls against track, after every pair, by ball and then by piece and chunk
        if (this.#pieces.length) this.#onTrack(manifolds, dt);

        for (const s of solids) {
            s.dp = [0, 0, 0];
            s.dq = [0, 0, 0, 1];
        }
        const round = manifolds.some((m) => m.round);
        const contact = soft(Math.min(HERTZ, 0.25 / h), DAMPED, h);
        const firm = soft(Math.min(HERTZ * 2, 0.25 / h), DAMPED, h);

        /** An impulse `j` along `d` on one solid, at `r` from its middle. */
        const push = (solid: Solid, r: V3, d: V3, j: number) => {
            if (!solid.im) return;
            const x = cross(r, d);
            const t = solid.turned;
            for (let axis = 0; axis < 3; axis++) {
                solid.v[axis]! += solid.im * d[axis]! * j;
                if (t) solid.w[axis]! += (t[axis * 3]! * x[0] + t[axis * 3 + 1]! * x[1] + t[axis * 3 + 2]! * x[2]) * j;
                else solid.w[axis]! += solid.ii * x[axis]! * j;
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
                        if (!sweep && m.round) {
                            // With a ball, how far apart they are was measured as this part began. Against
                            // track or a ball the speed it may close at lands it on the surface, in both
                            // passes; against flat faces, a ball is pushed out softly as a solid is.
                            const gap = s.now!;
                            s.springy = s.calm === undefined && gap <= 0 && bias;
                            s.speed = (bias ? s.firm : s.calm) ?? (gap > 0 ? gap / h : bias ? Math.max(spring.rate * gap, -this.push) : 0);
                            s.start = s.push;
                        } else if (!sweep) {
                            // how far apart they are now, from how far each has moved and turned since the step began
                            const gap = dot(add(sub(b.dp, a.dp), sub(spin(b.dq, s.cb), spin(a.dq, s.ca))), n) + s.adjusted;
                            // Not yet touching: allowed to close exactly the gap, and no more. Overlapping: pushed out, softly.
                            s.springy = gap <= 0 && bias;
                            s.speed = gap > 0 ? gap / h : bias ? Math.max(spring.rate * gap, -this.push) : 0;
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
                    const [long, most] = [m.round ? Math.sqrt(one * one + two * two) : Math.hypot(one, two), m.friction * s.push];
                    const keep = long > most ? most / long : 1;
                    shove(m, s, m.t1, one * keep - s.one);
                    shove(m, s, m.t2, two * keep - s.two);
                    [s.one, s.two] = [one * keep, two * keep];
                }
                if (!m.roll && !m.twist) continue;
                for (const s of m.spots) {
                    // Rolling costs a turning push against the roll, up to `roll` for each unit the two are
                    // pressed together; spinning on the spot costs the same way about the line between them.
                    if (m.roll) {
                        const turning = sub(b.w, a.w);
                        const [one, two] = [s.rollOne! - s.rollOneMass! * dot(turning, m.t1), s.rollTwo! - s.rollTwoMass! * dot(turning, m.t2)];
                        const [long, most] = [Math.sqrt(one * one + two * two), m.roll * s.push];
                        const keep = long > most ? most / long : 1;
                        twist(m, m.t1, one * keep - s.rollOne!);
                        twist(m, m.t2, two * keep - s.rollTwo!);
                        [s.rollOne, s.rollTwo] = [one * keep, two * keep];
                    }
                    if (m.twist) {
                        const most = m.twist * s.push;
                        const spun = Math.max(-most, Math.min(most, s.spin! - s.spinMass! * dot(sub(b.w, a.w), n)));
                        twist(m, n, spun - s.spin!);
                        s.spin = spun;
                    }
                }
            }
        };
        /** A turning push `j` about `d` on b, and back on a. */
        const twist = (m: Manifold, d: V3, j: number) => {
            for (const [solid, by] of [[m.a, -j], [m.b, j]] as const) {
                if (!solid.im) continue;
                const t = solid.turned;
                for (let axis = 0; axis < 3; axis++) solid.w[axis]! += t ? (t[axis * 3]! * d[0] + t[axis * 3 + 1]! * d[1] + t[axis * 3 + 2]! * d[2]) * by : solid.ii * d[axis]! * by;
            }
        };
        /** A contact with a ball turned to face `toward` (any length), the two `gap` apart: its point, its directions across, and how much each push takes, made again. */
        const aim = (m: Manifold, s: Spot, toward: V3, gap: number) => {
            const long = length(toward);
            if (!(long > 0)) return;
            const n = mul(toward, 1 / long);
            const across = Math.abs(n[0]) < 0.8 ? cross(n, [1, 0, 0]) : cross(n, [0, 1, 0]);
            const t1 = mul(across, 1 / length(across));
            const t2 = cross(n, t1);
            // what has been pushed across so far, said in the new directions
            const into = (one: number, two: number): [number, number] => [one * dot(m.t1, t1) + two * dot(m.t2, t1), one * dot(m.t1, t2) + two * dot(m.t2, t2)];
            [s.one, s.two] = into(s.one, s.two);
            [s.rollOne, s.rollTwo] = into(s.rollOne!, s.rollTwo!);
            [m.n, m.t1, m.t2] = [n, t1, t2];
            const { a, b } = m;
            // the point half way between the two surfaces, from each one's middle
            const at = b.radius !== undefined ? sub(b.p, mul(n, b.radius + gap / 2)) : add(a.p, mul(n, a.radius! + gap / 2));
            [s.ra, s.rb] = [sub(at, a.p), sub(at, b.p)];
            const k = (d: V3) => {
                const sum = a.im + b.im + hardness(a, cross(s.ra, d)) + hardness(b, cross(s.rb, d));
                return sum > 0 ? 1 / sum : 0;
            };
            [s.normalMass, s.oneMass, s.twoMass] = [k(n), k(t1), k(t2)];
        };
        /**
         * The speed a ball may come in at over a part (less than none: it must be sent away that fast),
         * so that it ends the part just on the surface, by the surface's own formula: `there` is how far
         * apart they would be at the end if nothing pushed, `end` the way the surface faces there, `v`
         * the speed at which they close now, and the push along `n`, the way the surface faces now. A
         * ball already in deeper than it should be is let stay in, and pushed out at no more than `push`;
         * the second number is the same without that push out, for the pass after the move, so that
         * putting an overlap right moves the ball and leaves it no faster, as the soft solver does.
         *
         * This is the rule molecular dynamics calls SHAKE: the push is square to the surface where the
         * ball is, and just enough to land it on the surface. Round a curve or a funnel it keeps both the
         * ball's energy and its turning about the funnel's axis, where a push aimed anywhere else would
         * lean along the ball's path and speed it up or slow it down a little every part.
         */
        const landing = (now: number, there: number, v: V3, n: V3, end: V3): [number, number] => {
            const square = dot(n, end);
            const [allowed, kept] = [now < 0 ? Math.min(0, now + this.push * h) : 0, Math.min(0, now)];
            // Where the surface turns by more than a few degrees in one part (a thin rail met fast), where
            // the ball would be at the end says little of what it passed through on the way: then it may
            // close the gap there is now along the way the surface faces, and no more.
            if (square > 0.95) return [(there - allowed) / (h * square) - dot(v, n), (there - kept) / (h * square) - dot(v, n)];
            return [(now - allowed) / h, (now - kept) / h];
        };
        /**
         * For each contact with a ball, as a part of the step begins: how far apart the two are and the
         * speed the ball may come in at. Against track, that is by where the ball would be at the end
         * of the part, so that one held round a loop or a funnel is turned with it; the contact is aimed
         * at the way the surface faces where the ball is now.
         */
        const measure = (part: number) => {
            for (const m of manifolds) {
                if (!m.round) continue;
                const { a, b, n } = m;
                for (const s of m.spots) {
                    if (m.piece) {
                        // Where the last part said it would be, put right by where it went; unless the surface
                        // faced a good deal another way there (it was past a thin rail), when it is measured again.
                        let [now, toward] = part ? [s.there! + dot(sub(b.p, s.going!), s.toward!), s.toward!] : [s.gap, n];
                        if (part && dot(toward, n) <= 0.95) {
                            const again = m.piece.again(m.part!, m.where!, b.p, b.radius!);
                            [now, toward, m.where] = [again.gap, again.n, again.where];
                        }
                        aim(m, s, toward, now);
                        const going = add(b.p, mul(b.v, h));
                        const end = m.piece.again(m.part!, m.where!, going, b.radius!);
                        [m.where, s.there, s.going, s.toward] = [end.where, end.gap, going, end.n];
                        s.now = now;
                        [s.firm, s.calm] = landing(now, end.gap, b.v, m.n, end.n);
                    } else if (a.radius !== undefined && b.radius !== undefined) {
                        // Ball against ball: measured afresh and aimed between the two middles, but soft, as
                        // solids are. In a heap one ball often rests on several and against a wall, more
                        // than can all be held exactly; soft, they share it and settle.
                        const apart = sub(b.p, a.p);
                        const near = length(apart);
                        s.now = near - a.radius - b.radius;
                        if (near > 0) aim(m, s, apart, s.now);
                        [s.firm, s.calm] = [undefined, undefined];
                    } else {
                        // against flat faces: from how far each has moved, a ball's surface not turning with it
                        const [ca, cb] = [a.radius === undefined && a.im ? spin(a.dq, s.ca) : s.ca, b.radius === undefined && b.im ? spin(b.dq, s.cb) : s.cb];
                        s.now = dot(add(sub(b.dp, a.dp), sub(cb, ca)), n) + s.adjusted;
                        [s.firm, s.calm] = [undefined, undefined];
                    }
                    // A ball strikes at the speed it has when it gets there, gravity's last part included,
                    // not at the speed it had as the step began; its bounce and its sound go by that.
                    s.closing = Math.min(s.closing, leaving(m, s, m.n));
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
                if (s.inertia) s.w = gyroscope(s.q, s.inertia, s.w, h);
            }
            // a contact with a ball is aimed for this part before last part's pushes are given again along it
            if (round) measure(part);
            for (const m of manifolds) {
                for (const s of m.spots) {
                    shove(m, s, m.n, s.push);
                    shove(m, s, m.t1, s.one);
                    shove(m, s, m.t2, s.two);
                    if (m.roll) {
                        twist(m, m.t1, s.rollOne!);
                        twist(m, m.t2, s.rollTwo!);
                    }
                    if (m.twist) twist(m, m.n, s.spin!);
                }
            }
            contacts(true);
            for (const s of solids) {
                if (!s.im) continue;
                const [move, by] = [mul(s.v, h), mul(s.w, h)];
                s.p = add(s.p, move);
                s.dp = add(s.dp, move);
                if (s.radius !== undefined) {
                    s.q = rolled(s.q, by);
                    continue;
                }
                s.q = turnedBy(s.q, by);
                s.dq = turnedBy(s.dq, by);
            }
            contacts(false);
        }

        if (this.hit) {
            for (const m of manifolds) {
                const closing = Math.min(...m.spots.map((s) => s.closing));
                if (closing < -this.knock) this.hit(m.a, m.b, -closing);
            }
        }

        // ---- bounce: what hit hard enough leaves with some of the speed it came with ----
        for (const m of manifolds) {
            if (!m.bounce) continue;
            for (const s of m.spots) {
                if (s.closing > -this.knock || !s.most) continue;
                const push = Math.max(0, s.push - s.normalMass * (leaving(m, s, m.n) + m.bounce * s.closing));
                shove(m, s, m.n, push - s.push);
                s.push = push;
            }
        }

        for (const s of solids) {
            if (!s.im) continue;
            s.quiet = (s.radius === undefined ? size(s.v) + size(s.w) * s.far : length(s.v) + length(s.w) * s.far) < this.slow ? s.quiet + dt : 0;
            if (this.sleeps && !this.islands && s.quiet > this.nap) {
                s.rest = [s.im, s.ii];
                [s.im, s.ii, s.v, s.w] = [0, 0, [0, 0, 0], [0, 0, 0]];
            }
        }
        if (this.sleeps && this.islands) this.#sleepTogether(manifolds);
    }

    /**
     * Islands: solids that touch, and solids asleep that a moving one rests on, are one island, found
     * by joining the two of every contact. An island all of whose moving solids have been still for
     * `nap` seconds goes to sleep as one, each solid told of all the others, so that whatever wakes one
     * wakes them all. Fixed things, track among them, join nothing, or the whole floor would be one island.
     */
    #sleepTogether(manifolds: Manifold[]): void {
        const { solids } = this;
        const leader = new Map<Solid, Solid>();
        const find = (s: Solid): Solid => {
            let top = s;
            while (leader.get(top) !== top) top = leader.get(top)!;
            // shorten the way for next time
            while (s !== top) {
                const next = leader.get(s)!;
                leader.set(s, top);
                s = next;
            }
            return top;
        };
        const counts = (s: Solid) => s.im > 0 || (s.rest !== undefined && !s.held);
        for (const s of solids) if (counts(s)) leader.set(s, s);
        for (const m of manifolds) {
            if (!counts(m.a) || !counts(m.b) || (!m.a.im && !m.b.im)) continue;
            // only those truly touching join, not those merely near
            if (!m.spots.some((spot) => spot.push > 0)) continue;
            const [one, two] = [find(m.a), find(m.b)];
            if (one !== two) leader.set(one, two);
        }
        const calm = new Map<Solid, boolean>();
        for (const s of solids) {
            if (!s.im) continue;
            const top = find(s);
            calm.set(top, (calm.get(top) ?? true) && s.quiet > this.nap);
        }
        const members = new Map<Solid, Solid[]>();
        for (const s of solids) {
            if (!leader.has(s)) continue;
            const top = find(s);
            if (!calm.get(top)) continue;
            let list = members.get(top);
            if (!list) members.set(top, (list = []));
            list.push(s);
        }
        for (const list of members.values()) {
            for (const s of list) {
                if (s.im) {
                    s.rest = [s.im, s.ii];
                    [s.im, s.ii, s.v, s.w] = [0, 0, [0, 0, 0], [0, 0, 0]];
                }
                s.together = list;
            }
        }
    }
}
