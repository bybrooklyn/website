// Mote's 2D physics: bodies, contacts and joints, with no library under it.
// A mini works in pixels and seconds, with y pointing down.
//
//   const flat = new Flat();
//   const crate = flat.box(100, 40, 40, 40);
//   flat.wall([[0, 0], [600, 0], [600, 300], [0, 300]], true);
//   flat.hand.take(x, y); flat.hand.move(x, y); flat.hand.drop();
//   flat.step(dt);
//   trace(ctx, crate); ctx.fill();
//
// How a step goes. Where bodies touch is found once. The step is then taken
// in a few small parts, and in each one every contact and joint is solved as
// a very stiff, heavily damped spring, the bodies are moved, and everything
// is solved once more without the spring. This is the "soft step" method
// Erin Catto described for Box2D 3; the code here is Mote's own.
//
// What it is held to is in flat.test.ts: friction angles, a pile that does
// not move once it has settled, a chain that keeps its length.

export type P = [number, number];

/** How far two bodies may overlap, in pixels, and be left alone. */
export const SLOP = 0.25;
/** Bodies this close are treated as about to touch. More is added for anything moving fast. */
const MARGIN = 2;
/** The fastest an overlap is undone, in pixels a second: an overlap is never a launch. */
const PUSH = 160;
/** How stiff a contact is, in cycles a second, and how damped. */
const HERTZ = 120;
const DAMPED = 10;
/** Slower than this, in pixels a second, for this long, and a body sleeps. */
const SLOW = 3;
const REST = 0.5;

export interface Stuff {
    /** Does not move. */
    fixed?: boolean;
    angle?: number;
    /** How heavy for its size, against the usual 1. */
    density?: number;
    friction?: number;
    bounce?: number;
    /** Never turns. */
    upright?: boolean;
    /** Rounds the corners of a box or shape by this much, in pixels, without changing its size. */
    round?: number;
    /** Bodies given the same family pass through each other: the links of one chain. */
    family?: number;
}

export interface Body {
    readonly id: number;
    x: number;
    y: number;
    a: number;
    vx: number;
    vy: number;
    w: number;
    /** Its corners around its middle, in order, and the outward direction of the edge after each. A ball has one corner. */
    readonly points: P[];
    readonly normals: P[];
    /** How far its surface is beyond its corners: a ball's radius, a rounded shape's rounding. */
    readonly round: number;
    /** No part of it is further than this from its middle. */
    readonly far: number;
    readonly mass: number;
    /** 1 / mass and 1 / moment of inertia; 0 for something fixed. */
    readonly im: number;
    readonly ii: number;
    friction: number;
    bounce: number;
    /** How quickly it slows by itself, per second, moving and turning. */
    damping: number;
    spinDamping: number;
    asleep: boolean;
    family: number;
    // The rest is the solver's own.
    quiet: number;
    gone: boolean;
    wp: P[];
    wn: P[];
    sm: number;
    si: number;
    dx: number;
    dy: number;
    da: number;
    cq: number;
    sq: number;
    touching: boolean;
    root: Body;
    group?: Body[];
}

interface Spot {
    /** Which corners or faces made it, so it can be found again next step. */
    id: number;
    /** From each body's middle to the point, as the step began. */
    ax: number;
    ay: number;
    bx: number;
    by: number;
    /** The same, to the body's own corner (or its middle, for a ball) behind the point. */
    cax: number;
    cay: number;
    cbx: number;
    cby: number;
    gap: number;
    adjusted: number;
    normalMass: number;
    tangentMass: number;
    /** 1 / normalMass; and for this pass, the speed it is solved toward and whether it is a spring. */
    sides: number;
    speed: number;
    springy: boolean;
    push: number;
    rub: number;
    /** How fast the two were closing before the step, for a bounce, and the hardest it pushed. */
    closing: number;
    most: number;
}

interface Manifold {
    a: Body;
    b: Body;
    key: number;
    /** From a to b. */
    nx: number;
    ny: number;
    spots: Spot[];
    friction: number;
    bounce: number;
    /** Against something that cannot move, a contact can be stiffer. */
    stiff: boolean;
    sides: number;
}

interface Soft {
    rate: number;
    mass: number;
    impulse: number;
}

const RIGID: Soft = { rate: 0, mass: 1, impulse: 0 };

function soft(hertz: number, damped: number, h: number): Soft {
    if (!hertz) return RIGID;
    const omega = 2 * Math.PI * hertz;
    const a1 = 2 * damped + h * omega;
    const a2 = h * omega * a1;
    const a3 = 1 / (1 + a2);
    return { rate: omega / a1, mass: a2 * a3, impulse: a3 };
}

export interface Joint {
    readonly kind: "pin" | "rod" | "rope" | "spring";
    a: Body;
    b: Body;
    /** The point on each body, around its middle. */
    la: P;
    lb: P;
    length: number;
    /** A spring: where b's point should be, measured from a's; how stiff; and the hardest it can pull. */
    to: P;
    hertz: number;
    damped: number;
    force: number;
    // the solver's own
    ix: number;
    iy: number;
    rax: number;
    ray: number;
    rbx: number;
    rby: number;
    cx: number;
    cy: number;
}

export interface Wall {
    readonly slabs: Body[];
}

const cross = (ax: number, ay: number, bx: number, by: number) => ax * by - ay * bx;
let count = 0;

function make(x: number, y: number, corners: P[], round: number, stuff: Stuff): Body {
    let points = corners;
    let area = Math.PI * round * round;
    let spread = (round * round) / 2;
    if (points.length === 2) {
        const long = Math.hypot(points[1]![0] - points[0]![0], points[1]![1] - points[0]![1]);
        area += 2 * round * long;
        spread = ((long + round) ** 2 + 4 * round * round) / 12;
    } else if (points.length > 2) {
        let twice = 0, cx = 0, cy = 0, second = 0, around = 0;
        points.forEach(([px, py], i) => {
            const [qx, qy] = points[(i + 1) % points.length]!;
            const k = cross(px, py, qx, qy);
            twice += k;
            cx += (px + qx) * k;
            cy += (py + qy) * k;
            around += Math.hypot(qx - px, qy - py);
        });
        // Always the same way round, so that the outward side of an edge is known.
        if (twice < 0) points = points.toReversed();
        cx /= 3 * twice;
        cy /= 3 * twice;
        // Its middle is where it balances: the corners are measured from there, and it is put where that lands.
        const [c, s] = [Math.cos(stuff.angle ?? 0), Math.sin(stuff.angle ?? 0)];
        x += cx * c - cy * s;
        y += cx * s + cy * c;
        points = points.map(([px, py]): P => [px - cx, py - cy]);
        points.forEach(([px, py], i) => {
            const [qx, qy] = points[(i + 1) % points.length]!;
            second += cross(px, py, qx, qy) * (px * px + px * qx + qx * qx + py * py + py * qy + qy * qy);
        });
        const flat = Math.abs(twice) / 2;
        const whole = flat + around * round + Math.PI * round * round;
        spread = (Math.abs(second) / (12 * flat)) * (whole / flat);
        area = whole;
    }
    const normals = points.map(([px, py], i): P => {
        const [qx, qy] = points[(i + 1) % points.length]!;
        const long = Math.hypot(qx - px, qy - py) || 1;
        return [(qy - py) / long, (px - qx) / long];
    });
    const mass = area * 0.001 * (stuff.density ?? 1);
    const fixed = Boolean(stuff.fixed);
    const made: Body = {
        id: ++count,
        x, y, a: stuff.angle ?? 0, vx: 0, vy: 0, w: 0,
        points, normals, round,
        far: round + Math.max(0, ...points.map(([px, py]) => Math.hypot(px, py))),
        mass,
        im: fixed || !mass ? 0 : 1 / mass,
        ii: fixed || !mass || stuff.upright ? 0 : 1 / (mass * spread),
        friction: stuff.friction ?? 0.6,
        bounce: stuff.bounce ?? 0,
        damping: 0, spinDamping: 0,
        asleep: false, family: stuff.family ?? 0, quiet: 0, gone: false,
        wp: [], wn: [], sm: 0, si: 0, dx: 0, dy: 0, da: 0, cq: 1, sq: 0, touching: false,
        root: undefined as unknown as Body,
    };
    made.root = made;
    place(made);
    return made;
}

/** Works out where a body's corners and edges are in the world. */
function place(b: Body): void {
    const [c, s] = [Math.cos(b.a), Math.sin(b.a)];
    b.wp = b.points.map(([px, py]): P => [b.x + px * c - py * s, b.y + px * s + py * c]);
    b.wn = b.normals.map(([nx, ny]): P => [nx * c - ny * s, nx * s + ny * c]);
}

/** Wakes a body, and everything that went to sleep with it. */
export function wake(body: Body): void {
    for (const other of body.group ?? [body]) {
        other.asleep = false;
        other.quiet = 0;
        other.group = undefined;
    }
}

// ---- where two bodies touch ----

type Found = { nx: number; ny: number; spots: [x: number, y: number, gap: number, id: number][] } | undefined;

/** The edge of `a` that `b` is least far behind, and by how much. Positive means apart. */
function apart(a: Body, b: Body): [number, number] {
    let best = -Infinity, edge = 0;
    for (let i = 0; i < a.wn.length; i++) {
        const [nx, ny] = a.wn[i]!;
        const [fx, fy] = a.wp[i]!;
        let least = Infinity;
        for (const [x, y] of b.wp) least = Math.min(least, nx * (x - fx) + ny * (y - fy));
        if (least > best) [best, edge] = [least, i];
    }
    return [best, edge];
}

/** The nearest points of two lines, and how far along each they are, from 0 to 1. */
function nearest(p1: P, q1: P, p2: P, q2: P): [number, number] {
    const [d1x, d1y, d2x, d2y, rx, ry] = [q1[0] - p1[0], q1[1] - p1[1], q2[0] - p2[0], q2[1] - p2[1], p1[0] - p2[0], p1[1] - p2[1]];
    const [a, e, f] = [d1x * d1x + d1y * d1y, d2x * d2x + d2y * d2y, d2x * rx + d2y * ry];
    const [c, b] = [d1x * rx + d1y * ry, d1x * d2x + d1y * d2y];
    const denom = a * e - b * b;
    const clamp = (value: number) => Math.max(0, Math.min(1, value));
    let s = denom > 1e-9 ? clamp((b * f - c * e) / denom) : 0;
    let t = e > 1e-9 ? (b * s + f) / e : 0;
    if (t < 0) [t, s] = [0, a > 1e-9 ? clamp(-c / a) : 0];
    else if (t > 1) [t, s] = [1, a > 1e-9 ? clamp((b - c) / a) : 0];
    return [s, t];
}

/** Two shapes with edges. The direction found runs from a to b. */
function touchShapes(a: Body, b: Body, margin: number): Found {
    const reach = margin + a.round + b.round;
    const [ga, ea] = apart(a, b);
    if (ga > reach) return undefined;
    const [gb, eb] = apart(b, a);
    if (gb > reach) return undefined;
    // The edge with the smaller overlap is the one to push along; lean toward a's so it does not flicker.
    const flip = gb > ga + 0.1 * SLOP;
    const [one, two, e1] = flip ? [b, a, eb] : [a, b, ea];
    const sign = flip ? -1 : 1;
    const [nx, ny] = one.wn[e1]!;
    // the other body's edge that most squarely meets it
    let e2 = 0, least = Infinity;
    two.wn.forEach(([ix, iy], i) => {
        const facing = ix * nx + iy * ny;
        if (facing < least) [least, e2] = [facing, i];
    });
    const [i11, i12, i21, i22] = [e1, (e1 + 1) % one.wp.length, e2, (e2 + 1) % two.wp.length];
    const [v11, v12, v21, v22] = [one.wp[i11]!, one.wp[i12]!, two.wp[i21]!, two.wp[i22]!];
    const name = (first: number, second: number) => (flip ? (second << 8) | first : (first << 8) | second);

    if (Math.max(ga, gb) > 0.1 * SLOP) {
        // Not overlapping (only their rounding may be): corner to corner is its own case.
        const [s, t] = nearest(v11, v12, v21, v22);
        if ((s === 0 || s === 1) && (t === 0 || t === 1)) {
            const [p1, p2] = [s ? v12 : v11, t ? v22 : v21];
            const away = Math.hypot(p2[0] - p1[0], p2[1] - p1[1]);
            if (away > reach || away < 1e-9) return undefined;
            const [ux, uy] = [(p2[0] - p1[0]) / away, (p2[1] - p1[1]) / away];
            const half = one.round + (away - one.round - two.round) / 2;
            return { nx: ux * sign, ny: uy * sign, spots: [[p1[0] + ux * half, p1[1] + uy * half, away - one.round - two.round, 65536 | name(s ? i12 : i11, t ? i22 : i21)]] };
        }
    }

    // Edge against edge: the part of the second edge that lies alongside the first.
    const long = Math.hypot(v12[0] - v11[0], v12[1] - v11[1]) || 1;
    const [tx, ty] = [(v12[0] - v11[0]) / long, (v12[1] - v11[1]) / long];
    const upper2 = (v21[0] - v11[0]) * tx + (v21[1] - v11[1]) * ty;
    const lower2 = (v22[0] - v11[0]) * tx + (v22[1] - v11[1]) * ty;
    const span = upper2 - lower2;
    const along = (at: number): P => [v22[0] + ((v21[0] - v22[0]) * (at - lower2)) / span, v22[1] + ((v21[1] - v22[1]) * (at - lower2)) / span];
    const low = lower2 < 0 && span > 1e-9 ? along(0) : v22;
    const high = upper2 > long && span > 1e-9 ? along(long) : v21;
    const spots: [number, number, number, number][] = [];
    for (const [point, id] of [[low, name(i11, i22)], [high, name(i12, i21)]] as const) {
        const gap = (point[0] - v11[0]) * nx + (point[1] - v11[1]) * ny;
        if (gap - one.round - two.round > margin) continue;
        // the point is put half way between the two surfaces
        const shift = 0.5 * (one.round - two.round - gap);
        spots.push([point[0] + nx * shift, point[1] + ny * shift, gap - one.round - two.round, id]);
    }
    return spots.length ? { nx: nx * sign, ny: ny * sign, spots } : undefined;
}

/** A ball against a shape with edges. The direction found runs from the shape to the ball. */
function touchBall(s: Body, c: Body, margin: number): Found {
    const reach = margin + s.round + c.round;
    let nx = 0, ny = 0, away = 0;
    const at = (px: number, py: number) => {
        away = Math.hypot(c.x - px, c.y - py);
        [nx, ny] = [(c.x - px) / away, (c.y - py) / away];
    };
    const [gap, edge] = apart(s, { wp: [[c.x, c.y]] } as Body);
    if (gap > reach) return undefined;
    const [v1, v2] = [s.wp[edge]!, s.wp[(edge + 1) % s.wp.length]!];
    const u1 = (c.x - v1[0]) * (v2[0] - v1[0]) + (c.y - v1[1]) * (v2[1] - v1[1]);
    const u2 = (c.x - v2[0]) * (v1[0] - v2[0]) + (c.y - v2[1]) * (v1[1] - v2[1]);
    // Beyond either end of the nearest edge it is that corner it touches; a bar's whole line is tried the same way.
    const off = s.wp.length === 2 ? Math.abs(gap) > 1e-6 || u1 < 0 || u2 < 0 : gap > 1e-6;
    if (u1 < 0 && off) at(v1[0], v1[1]);
    else if (u2 < 0 && off) at(v2[0], v2[1]);
    else [nx, ny, away] = [s.wn[edge]![0], s.wn[edge]![1], gap];
    if (away > reach || !Number.isFinite(nx)) return undefined;
    // the point is put half way between the two surfaces
    const space = away - c.round - s.round;
    return { nx, ny, spots: [[c.x - nx * (c.round + space / 2), c.y - ny * (c.round + space / 2), space, 0]] };
}

function touch(a: Body, b: Body, margin: number): Found {
    const [one, two] = [a.points.length === 1, b.points.length === 1];
    if (one && two) {
        const away = Math.hypot(b.x - a.x, b.y - a.y);
        if (away > a.round + b.round + margin || away < 1e-9) return undefined;
        const [nx, ny] = [(b.x - a.x) / away, (b.y - a.y) / away];
        const half = a.round + (away - a.round - b.round) / 2;
        return { nx, ny, spots: [[a.x + nx * half, a.y + ny * half, away - a.round - b.round, 0]] };
    }
    if (two) return touchBall(a, b, margin);
    if (one) {
        const found = touchBall(b, a, margin);
        return found && { nx: -found.nx, ny: -found.ny, spots: found.spots };
    }
    return touchShapes(a, b, margin);
}

/** Whether a point is inside a body. */
export function inside(b: Body, x: number, y: number): boolean {
    if (b.points.length === 1) return Math.hypot(x - b.x, y - b.y) <= b.round;
    return apart(b, { wp: [[x, y]] } as Body)[0] <= b.round;
}

// ---- the world ----

export class Flat {
    bodies: Body[] = [];
    /** Pixels per second, each second, downward. */
    gravity: number;
    /** Each step of 1/120 s is taken in this many smaller parts. More holds long chains and heavy things better. */
    parts = 4;
    /** Told of each pair that met hard this step, and how fast they were closing. For a sound, or a flash. */
    hit?: (a: Body, b: Body, speed: number) => void;
    /** Stands for "the world" at one end of a joint. */
    readonly ground: Body;
    /** Picks things up, carries them and throws them. */
    readonly hand: Hand;
    #joints: Joint[] = [];
    /** Pairs that are joined, which pass through each other. */
    #through = new Map<number, number>();
    /** Last step's contacts, to start from. */
    #was = new Map<number, Manifold>();
    #owed = 0;

    constructor(gravity = 2600) {
        this.gravity = gravity;
        this.ground = make(0, 0, [], 0, { fixed: true });
        this.hand = new Hand(this);
    }

    #add(body: Body): Body {
        this.bodies.push(body);
        return body;
    }

    box(x: number, y: number, w: number, h: number, stuff: Stuff = {}): Body {
        const r = Math.min(stuff.round ?? 0, w / 2, h / 2);
        const [hw, hh] = [w / 2 - r, h / 2 - r];
        return this.#add(make(x, y, [[-hw, -hh], [hw, -hh], [hw, hh], [-hw, hh]], r, stuff));
    }

    ball(x: number, y: number, r: number, stuff: Stuff = {}): Body {
        return this.#add(make(x, y, [[0, 0]], r, stuff));
    }

    /** A bar with round ends, `long` from end to end and `thick` across, lying along its own x until turned. */
    bar(x: number, y: number, long: number, thick: number, stuff: Stuff = {}): Body {
        const half = Math.max(0, long - thick) / 2;
        return this.#add(make(x, y, [[-half, 0], [half, 0]], thick / 2, stuff));
    }

    /** Any shape that bulges everywhere, from its corners in order. Its middle is put where it balances. */
    shape(x: number, y: number, corners: P[], stuff: Stuff = {}): Body {
        return this.#add(make(x, y, corners, stuff.round ?? 0, stuff));
    }

    /**
     * A wall that does not move, along a line of points. With `loop` its end is joined to its start
     * and it encloses a space that bulges everywhere: the wall is thick, and all of it is outside.
     */
    wall(points: P[], loop = false, friction = 0.6): Wall {
        const slabs: Body[] = [];
        if (!loop) {
            for (let i = 0; i + 1 < points.length; i++) {
                const [[px, py], [qx, qy]] = [points[i]!, points[i + 1]!];
                slabs.push(this.#add(make((px + qx) / 2, (py + qy) / 2, [[(px - qx) / 2, (py - qy) / 2], [(qx - px) / 2, (qy - py) / 2]], 2, { fixed: true, friction })));
            }
            return { slabs };
        }
        const THICK = 80;
        const twice = points.reduce((sum, [px, py], i) => sum + cross(px, py, points[(i + 1) % points.length]![0], points[(i + 1) % points.length]![1]), 0);
        points.forEach(([px, py], i) => {
            const [qx, qy] = points[(i + 1) % points.length]!;
            const long = Math.hypot(qx - px, qy - py);
            if (long < 1e-6) return;
            const [tx, ty] = [(qx - px) / long, (qy - py) / long];
            // outward: away from the space enclosed
            const [ox, oy] = twice > 0 ? [ty, -tx] : [-ty, tx];
            // Wider at the back than at the front, so that the slabs leave no gaps where the wall turns.
            slabs.push(this.#add(make(0, 0, [[px, py], [qx, qy], [qx + (ox + tx) * THICK, qy + (oy + ty) * THICK], [px + (ox - tx) * THICK, py + (oy - ty) * THICK]], 0, { fixed: true, friction })));
        });
        return { slabs };
    }

    remove(thing: Body | Joint | Wall): void {
        if ("slabs" in thing) {
            for (const slab of thing.slabs) this.remove(slab);
        } else if ("kind" in thing) {
            if (!this.#joints.includes(thing)) return;
            this.#joints = this.#joints.filter((joint) => joint !== thing);
            this.#pass(thing.a, thing.b, -1);
            wake(thing.a);
            wake(thing.b);
        } else {
            thing.gone = true;
            wake(thing);
            // Something fixed sleeps with nothing, so what lay on it is woken by what touched it last.
            for (const old of this.#was.values()) if (old.a === thing || old.b === thing) wake(old.a === thing ? old.b : old.a);
            this.bodies = this.bodies.filter((body) => body !== thing);
            for (const joint of this.#joints) if (joint.a === thing || joint.b === thing) this.remove(joint);
            if (this.hand.held === thing) this.hand.drop();
        }
    }

    #pass(a: Body, b: Body, by: number): void {
        for (const key of [a.id * 1048576 + b.id, b.id * 1048576 + a.id]) {
            const left = (this.#through.get(key) ?? 0) + by;
            if (left > 0) this.#through.set(key, left);
            else this.#through.delete(key);
        }
    }

    #join(kind: Joint["kind"], a: Body, b: Body, la: P, lb: P, more: Partial<Joint> = {}): Joint {
        const joint: Joint = { kind, a, b, la, lb, length: 0, to: [0, 0], hertz: 0, damped: 1, force: Infinity, ix: 0, iy: 0, rax: 0, ray: 0, rbx: 0, rby: 0, cx: 0, cy: 0, ...more };
        this.#joints.push(joint);
        this.#pass(a, b, 1);
        wake(a);
        wake(b);
        return joint;
    }

    /** Pins two bodies together at a point in the world, so that they turn about it. */
    pin(a: Body, b: Body, x: number, y: number): Joint {
        return this.#join("pin", a, b, local(a, x, y), local(b, x, y));
    }

    /** Holds two points, one on each body, the distance apart that they are now: a rod. Points are measured from each body's middle. */
    rod(a: Body, b: Body, onA: P = [0, 0], onB: P = [0, 0]): Joint {
        const [[ax, ay], [bx, by]] = [world(a, onA), world(b, onB)];
        return this.#join("rod", a, b, onA, onB, { length: Math.hypot(bx - ax, by - ay) });
    }

    /** Lets two points come together but never get further apart than `length`: a rope. */
    rope(a: Body, b: Body, length: number, onA: P = [0, 0], onB: P = [0, 0]): Joint {
        return this.#join("rope", a, b, onA, onB, { length });
    }

    /**
     * A motor: pushes `b` toward a place measured from `a`'s middle, and pushes `a` back just as hard.
     * `strength` is how hard, in multiples of what the two weigh together. Call `to` on what is returned
     * to say where. The two pass through each other. This is an arm holding a tool: press the tool
     * against something and it is the body that moves.
     */
    motor(a: Body, b: Body, strength: number, hertz = 9): { to(dx: number, dy: number): void; joint: Joint } {
        const joint = this.#join("spring", a, b, [0, 0], [0, 0], { hertz, damped: 1, force: strength * (a.mass + b.mass) * this.gravity });
        return {
            joint,
            to: (dx, dy) => {
                joint.to = [dx, dy];
                wake(a);
                wake(b);
            },
        };
    }

    /** A spring that pulls a point on `b` toward a place in the world, as hard as `force` allows. The hand is one of these. */
    pull(b: Body, on: P, hertz: number, force: number): Joint {
        const joint = this.#join("spring", this.ground, b, [0, 0], on, { hertz, damped: 1, force });
        this.#pass(this.ground, b, -1);
        return joint;
    }

    /** The body under a point, if one that can move is there. The one added last is on top. */
    at(x: number, y: number): Body | undefined {
        for (let i = this.bodies.length - 1; i >= 0; i--) {
            const body = this.bodies[i]!;
            if (body.im && Math.hypot(x - body.x, y - body.y) <= body.far && inside(body, x, y)) return body;
        }
        return undefined;
    }

    /** Moves everything on by `dt` seconds, in steps of 1/120. */
    step(dt: number): void {
        this.#owed += dt;
        while (this.#owed >= 1 / 120 - 1e-9) {
            this.#advance(1 / 120);
            this.#owed -= 1 / 120;
        }
    }

    /** Forgets how hard everything was pressing on everything else, so that it is worked out afresh. */
    ease(): void {
        for (const old of this.#was.values()) for (const spot of old.spots) spot.push = spot.rub = 0;
    }

    /** Whether everything that can move has come to rest. */
    get still(): boolean {
        return this.bodies.every((body) => !body.im || body.asleep);
    }

    #advance(dt: number): void {
        const { bodies } = this;
        const h = dt / this.parts;
        const live = (b: Body) => b.im > 0 && !b.asleep;
        const held = this.hand.held;
        if (held) wake(held);

        for (const b of bodies) {
            if (b.im) place(b);
            b.touching = false;
        }

        // ---- where things touch ----
        let manifolds: Manifold[] = [];
        let now = new Map<number, Manifold>();
        let woke = false;
        const find = () => {
          manifolds = [];
          now = new Map();
          woke = false;
          for (let i = 0; i < bodies.length; i++) {
            const a = bodies[i]!;
            if (!a.points.length) continue;
            for (let j = i + 1; j < bodies.length; j++) {
                const b = bodies[j]!;
                if ((!live(a) && !live(b)) || !b.points.length || (a.family && a.family === b.family)) continue;
                const closing = Math.hypot(b.vx - a.vx, b.vy - a.vy) + Math.abs(a.w) * a.far + Math.abs(b.w) * b.far;
                // Anything that could reach it this step is found now, so that nothing fast gets through anything.
                const margin = MARGIN + Math.min(closing * dt, 400);
                const reach = a.far + b.far + margin;
                if ((b.x - a.x) ** 2 + (b.y - a.y) ** 2 > reach * reach) continue;
                const key = a.id * 1048576 + b.id;
                if (this.#through.has(key)) continue;
                const found = touch(a, b, margin);
                if (!found) continue;
                // Something asleep is woken by anything that reaches it while moving. Something lying still
                // against it does not wake it: the two would only keep each other up.
                if (a.im && b.im && (a.asleep || b.asleep) && closing > 2 * SLOW) {
                    wake(a);
                    wake(b);
                    woke = true;
                }
                const before = this.#was.get(key);
                const manifold: Manifold = {
                    a, b, key, nx: found.nx, ny: found.ny,
                    friction: Math.sqrt(a.friction * b.friction),
                    bounce: Math.max(a.bounce, b.bounce),
                    stiff: !a.im || !b.im,
                    sides: 0,
                    spots: found.spots.map(([x, y, gap, id]): Spot => {
                        const old = before?.spots.find((spot) => spot.id === id);
                        return { id, ax: x - a.x, ay: y - a.y, bx: x - b.x, by: y - b.y, gap, cax: 0, cay: 0, cbx: 0, cby: 0, adjusted: 0, normalMass: 0, tangentMass: 0, sides: 0, speed: 0, springy: false, push: old?.push ?? 0, rub: old?.rub ?? 0, closing: 0, most: 0 };
                    }),
                };
                manifolds.push(manifold);
                now.set(key, manifold);
            }
          }
        };
        find();
        // A pile that was woken is looked at again as a whole, so that it is held together from the first moment.
        if (woke) find();
        // What held a sleeping pile together is kept, for when it wakes.
        for (const [key, old] of this.#was) if (!now.has(key) && !old.a.gone && !old.b.gone && !live(old.a) && !live(old.b)) now.set(key, old);
        this.#was = now;

        // ---- getting ready ----
        for (const b of bodies) {
            [b.sm, b.si] = live(b) ? [b.im, b.ii] : [0, 0];
            [b.dx, b.dy, b.da, b.cq, b.sq] = [0, 0, 0, 1, 0];
        }
        for (const m of manifolds) {
            const { a, b, nx, ny } = m;
            for (const s of m.spots) {
                // The point on each body's own corners or middle, without its rounding: that is what turns with
                // the body. A ball's is its middle, so a ball that rolls is not taken to be lifting off.
                const [ra, rb] = [a.round + s.gap / 2, b.round + s.gap / 2];
                [s.cax, s.cay, s.cbx, s.cby] = [s.ax - nx * ra, s.ay - ny * ra, s.bx + nx * rb, s.by + ny * rb];
                s.adjusted = s.gap - ((s.cbx - s.cax) * nx + (s.cby - s.cay) * ny);
                const [ran, rbn] = [cross(s.ax, s.ay, nx, ny), cross(s.bx, s.by, nx, ny)];
                const [rat, rbt] = [cross(s.ax, s.ay, ny, -nx), cross(s.bx, s.by, ny, -nx)];
                const [kn, kt] = [a.sm + b.sm + a.si * ran * ran + b.si * rbn * rbn, a.sm + b.sm + a.si * rat * rat + b.si * rbt * rbt];
                s.sides = kn;
                s.normalMass = kn > 0 ? 1 / kn : 0;
                s.tangentMass = kt > 0 ? 1 / kt : 0;
                s.closing = (b.vx - b.w * s.by - (a.vx - a.w * s.ay)) * nx + (b.vy + b.w * s.bx - (a.vy + a.w * s.ax)) * ny;
                s.most = 0;
            }
            // How much a push at one point of a pair is felt at the other, for solving the two together;
            // 0 if they are too nearly the same point for that to be done safely.
            m.sides = 0;
            if (m.spots.length === 2) {
                const [one, two] = m.spots as [Spot, Spot];
                const k12 = a.sm + b.sm + a.si * cross(one.ax, one.ay, nx, ny) * cross(two.ax, two.ay, nx, ny) + b.si * cross(one.bx, one.by, nx, ny) * cross(two.bx, two.by, nx, ny);
                if (one.sides * one.sides < 1000 * (one.sides * two.sides - k12 * k12)) m.sides = k12;
            }
        }
        const joints = this.#joints.filter((joint) => live(joint.a) || live(joint.b));
        for (const joint of joints) {
            // joined things are awake together
            if (joint.a.asleep) wake(joint.a);
            if (joint.b.asleep) wake(joint.b);
            [joint.a.sm, joint.a.si] = [joint.a.im, joint.a.ii];
            [joint.b.sm, joint.b.si] = [joint.b.im, joint.b.ii];
            [joint.rax, joint.ray] = turn(joint.a, joint.la);
            [joint.rbx, joint.rby] = turn(joint.b, joint.lb);
            [joint.cx, joint.cy] = [joint.b.x - joint.a.x, joint.b.y - joint.a.y];
        }

        // As stiff as a part of a step this long can carry: a quarter of how often it is solved.
        const contact = soft(Math.min(HERTZ, 0.25 / h), DAMPED, h);
        const firm = soft(Math.min(HERTZ * 2, 0.25 / h), DAMPED, h);
        const jointed = soft(0.25 / h, 2, h);

        // Each pass goes through the contacts the other way from the one before. Whichever is solved
        // first is favored a little, and taking turns keeps that from adding up into a slow walk.
        let backward = false;
        const contacts = (bias: boolean) => {
            backward = !backward;
            for (let at = 0; at < manifolds.length; at++) {
                const m = manifolds[backward ? manifolds.length - 1 - at : at]!;
                const { a, b, nx, ny } = m;
                const spring = m.stiff ? firm : contact;
                if (backward !== (m.spots[0]!.id > (m.spots[1]?.id ?? -1))) m.spots.reverse();
                // For each point: how far apart the two are now, and so how fast they may close or must part.
                const paired = m.spots.length === 2 && m.sides !== 0;
                for (const s of m.spots) {
                    const [pax, pay] = [s.cax * a.cq - s.cay * a.sq, s.cax * a.sq + s.cay * a.cq];
                    const [pbx, pby] = [s.cbx * b.cq - s.cby * b.sq, s.cbx * b.sq + s.cby * b.cq];
                    const gap = (b.dx - a.dx + pbx - pax) * nx + (b.dy - a.dy + pby - pay) * ny + s.adjusted;
                    // Not yet touching: allowed to close exactly the gap, and no more. Overlapping: pushed out, softly.
                    s.springy = gap <= 0 && bias;
                    s.speed = gap > 0 ? gap / h : bias ? Math.max(spring.rate * gap, -PUSH) : 0;
                }
                if (paired) {
                    // Two points on one edge are solved together. One after the other, the first is favored,
                    // the block turns a hair, and friction makes that a step sideways: a pile that walks.
                    const [one, two] = m.spots as [Spot, Spot];
                    const closing = (s: Spot) => (b.vx - b.w * s.by - (a.vx - a.w * s.ay)) * nx + (b.vy + b.w * s.bx - (a.vy + a.w * s.ax)) * ny + s.speed;
                    // a springy point gives a little, in proportion to how hard it is pushed
                    const give = spring.impulse / spring.mass;
                    const [g1, g2] = [one.springy ? one.sides * give : 0, two.springy ? two.sides * give : 0];
                    const [a11, a22, a12] = [one.sides + g1, two.sides + g2, m.sides];
                    const q1 = a11 * one.push + a12 * two.push - closing(one) - g1 * one.push;
                    const q2 = a12 * one.push + a22 * two.push - closing(two) - g2 * two.push;
                    const det = a11 * a22 - a12 * a12;
                    // what each would be if neither had to be a push
                    let [x1, x2] = [(a22 * q1 - a12 * q2) / det, (a11 * q2 - a12 * q1) / det];
                    if (x1 < 0 || x2 < 0) {
                        // one of them is not pressing: find which, and solve the other alone
                        if (q1 >= 0 && a12 * (q1 / a11) - q2 >= 0) [x1, x2] = [q1 / a11, 0];
                        else if (q2 >= 0 && a12 * (q2 / a22) - q1 >= 0) [x1, x2] = [0, q2 / a22];
                        else if (q1 <= 0 && q2 <= 0) [x1, x2] = [0, 0];
                        else [x1, x2] = [Math.max(0, x1), Math.max(0, x2)];
                    }
                    for (const [s, push] of [[one, x1], [two, x2]] as const) {
                        const j = push - s.push;
                        s.push = push;
                        s.most = Math.max(s.most, push);
                        shove(a, b, s.ax, s.ay, s.bx, s.by, nx * j, ny * j);
                    }
                } else {
                    for (const s of m.spots) {
                        const [mass, scale] = s.springy ? [spring.mass, spring.impulse] : [1, 0];
                        const vn = (b.vx - b.w * s.by - (a.vx - a.w * s.ay)) * nx + (b.vy + b.w * s.bx - (a.vy + a.w * s.ax)) * ny;
                        const push = Math.max(0, s.push - s.normalMass * mass * (vn + s.speed) - scale * s.push);
                        const j = push - s.push;
                        s.push = push;
                        s.most = Math.max(s.most, push);
                        shove(a, b, s.ax, s.ay, s.bx, s.by, nx * j, ny * j);
                    }
                }
                for (const s of m.spots) {
                    const vt = (b.vx - b.w * s.by - (a.vx - a.w * s.ay)) * ny - (b.vy + b.w * s.bx - (a.vy + a.w * s.ax)) * nx;
                    const most = m.friction * s.push;
                    const rub = Math.max(-most, Math.min(most, s.rub - s.tangentMass * vt));
                    const j = rub - s.rub;
                    s.rub = rub;
                    shove(a, b, s.ax, s.ay, s.bx, s.by, ny * j, -nx * j);
                }
            }
        };

        const joined = (bias: boolean) => {
            for (const joint of joints) {
                const { a, b } = joint;
                // where each end is now
                const [rax, ray] = [joint.rax * a.cq - joint.ray * a.sq, joint.rax * a.sq + joint.ray * a.cq];
                const [rbx, rby] = [joint.rbx * b.cq - joint.rby * b.sq, joint.rbx * b.sq + joint.rby * b.cq];
                const [sx, sy] = [b.dx - a.dx + rbx - rax + joint.cx, b.dy - a.dy + rby - ray + joint.cy];
                const [vx, vy] = [b.vx - b.w * rby - (a.vx - a.w * ray), b.vy + b.w * rbx - (a.vy + a.w * rax)];
                if (joint.kind === "pin" || joint.kind === "spring") {
                    const spring = joint.kind === "pin" ? (bias ? jointed : RIGID) : soft(joint.hertz, joint.damped, h);
                    // A spring is only pulled on in the first pass; the second is for what must hold exactly.
                    if (joint.kind === "spring" && !bias) continue;
                    const [cx, cy] = [sx - joint.to[0], sy - joint.to[1]];
                    const k11 = a.sm + b.sm + a.si * ray * ray + b.si * rby * rby;
                    const k12 = -a.si * rax * ray - b.si * rbx * rby;
                    const k22 = a.sm + b.sm + a.si * rax * rax + b.si * rbx * rbx;
                    const det = k11 * k22 - k12 * k12;
                    if (det < 1e-12) continue;
                    const [ux, uy] = [vx + spring.rate * cx, vy + spring.rate * cy];
                    let jx = (-spring.mass * (k22 * ux - k12 * uy)) / det - spring.impulse * joint.ix;
                    let jy = (-spring.mass * (k11 * uy - k12 * ux)) / det - spring.impulse * joint.iy;
                    if (joint.kind === "spring") {
                        // no harder than it is allowed to pull
                        const [wasX, wasY] = [joint.ix, joint.iy];
                        const [tx, ty] = [wasX + jx, wasY + jy];
                        const [long, most] = [Math.hypot(tx, ty), joint.force * h];
                        const keep = long > most ? most / long : 1;
                        [jx, jy] = [tx * keep - wasX, ty * keep - wasY];
                    }
                    joint.ix += jx;
                    joint.iy += jy;
                    shove(a, b, rax, ray, rbx, rby, jx, jy);
                } else {
                    const long = Math.hypot(sx, sy);
                    if (long < 1e-9) continue;
                    const [ux, uy] = [sx / long, sy / long];
                    const [ca, cb] = [cross(rax, ray, ux, uy), cross(rbx, rby, ux, uy)];
                    const k = a.sm + b.sm + a.si * ca * ca + b.si * cb * cb;
                    if (k < 1e-12) continue;
                    const over = long - joint.length;
                    const closing = vx * ux + vy * uy;
                    let j: number;
                    if (joint.kind === "rod") {
                        const spring = bias ? jointed : RIGID;
                        j = (-spring.mass * (closing + spring.rate * over)) / k - spring.impulse * joint.ix;
                        joint.ix += j;
                    } else {
                        // a rope only ever pulls its ends together, and slack it does nothing
                        let [speed, mass, scale] = [0, 1, 0];
                        if (over < 0) speed = over / h;
                        else if (bias) [speed, mass, scale] = [jointed.rate * over, jointed.mass, jointed.impulse];
                        const pull = Math.min(0, joint.ix - (mass * (closing + speed)) / k - scale * joint.ix);
                        j = pull - joint.ix;
                        joint.ix = pull;
                    }
                    shove(a, b, rax, ray, rbx, rby, ux * j, uy * j);
                }
            }
        };

        // ---- the step, in parts ----
        for (let part = 0; part < this.parts; part++) {
            for (const b of bodies) {
                if (!b.sm) continue;
                b.vy += this.gravity * h;
                const slow = 1 / (1 + h * b.damping);
                b.vx *= slow;
                b.vy *= slow;
                b.w *= 1 / (1 + h * (b.spinDamping + (b === held ? 6 : 0)));
            }
            // starting from what held last time: something at rest is then already nearly solved
            for (const joint of joints) {
                const { a, b } = joint;
                // Each end where it is now, not where it was when the step began: pushing on a turning
                // thing at where its end used to be turns it faster, a little more every time.
                const [rax, ray] = [joint.rax * a.cq - joint.ray * a.sq, joint.rax * a.sq + joint.ray * a.cq];
                const [rbx, rby] = [joint.rbx * b.cq - joint.rby * b.sq, joint.rbx * b.sq + joint.rby * b.cq];
                if (joint.kind === "pin" || joint.kind === "spring") shove(a, b, rax, ray, rbx, rby, joint.ix, joint.iy);
                else {
                    const [sx, sy] = [b.dx - a.dx + rbx - rax + joint.cx, b.dy - a.dy + rby - ray + joint.cy];
                    const long = Math.hypot(sx, sy) || 1;
                    shove(a, b, rax, ray, rbx, rby, (sx / long) * joint.ix, (sy / long) * joint.ix);
                }
            }
            for (const m of manifolds) for (const s of m.spots) shove(m.a, m.b, s.ax, s.ay, s.bx, s.by, m.nx * s.push + m.ny * s.rub, m.ny * s.push - m.nx * s.rub);
            // Joints are gone over twice: a pull on one end of a chain has a long way to travel.
            joined(true);
            joined(true);
            contacts(true);
            for (const b of bodies) {
                if (!b.sm) continue;
                // nothing is allowed to go so fast that it could not be followed
                const fast = Math.hypot(b.vx, b.vy);
                if (fast > 9000) [b.vx, b.vy] = [(b.vx / fast) * 9000, (b.vy / fast) * 9000];
                b.w = Math.max(-0.7 / h, Math.min(0.7 / h, b.w));
                b.x += b.vx * h;
                b.y += b.vy * h;
                b.a += b.w * h;
                b.dx += b.vx * h;
                b.dy += b.vy * h;
                b.da += b.w * h;
                [b.cq, b.sq] = [Math.cos(b.da), Math.sin(b.da)];
            }
            joined(false);
            contacts(false);
        }

        if (this.hit) {
            for (const m of manifolds) {
                const closing = Math.min(...m.spots.map((s) => s.closing));
                if (closing < -80) this.hit(m.a, m.b, -closing);
            }
        }

        // ---- bounce: what hit hard enough leaves with some of the speed it came with ----
        for (const m of manifolds) {
            if (!m.bounce) continue;
            for (const s of m.spots) {
                if (s.closing > -80 || !s.most) continue;
                const { a, b, nx, ny } = m;
                const vn = (b.vx - b.w * s.by - (a.vx - a.w * s.ay)) * nx + (b.vy + b.w * s.bx - (a.vy + a.w * s.ax)) * ny;
                const push = Math.max(0, s.push - s.normalMass * (vn + m.bounce * s.closing));
                const j = push - s.push;
                s.push = push;
                shove(a, b, s.ax, s.ay, s.bx, s.by, nx * j, ny * j);
            }
        }

        // ---- afterwards: what is touching what, rolling, and sleep ----
        for (const b of bodies) b.root = b;
        const root = (b: Body): Body => (b.root === b ? b : (b.root = root(b.root)));
        const link = (a: Body, b: Body) => {
            if (live(a) && live(b)) root(a).root = root(b);
        };
        for (const m of manifolds) {
            if (!m.spots.some((s) => s.push > 0)) continue;
            m.a.touching = m.b.touching = true;
            link(m.a, m.b);
        }
        for (const joint of joints) link(joint.a, joint.b);

        const islands = new Map<Body, Body[]>();
        for (const b of bodies) {
            if (!live(b)) continue;
            if (b.touching && b.points.length === 1) {
                // Rolling costs a little at any speed, and more the faster it goes, so a ball rolls to a stop.
                const least = ((0.03 * this.gravity) / b.round) * dt;
                b.w = Math.abs(b.w) <= least ? 0 : (b.w - Math.sign(b.w) * least) * (1 - 0.7 * dt);
            }
            const still = Math.hypot(b.vx, b.vy) + Math.abs(b.w) * b.far < SLOW && b !== held;
            b.quiet = still ? b.quiet + dt : 0;
            const island = islands.get(root(b));
            if (island) island.push(b);
            else islands.set(root(b), [b]);
        }
        // Things that touch, or are joined, go to sleep together or not at all.
        for (const island of islands.values()) {
            if (island.some((b) => b.quiet < REST)) continue;
            for (const b of island) {
                b.asleep = true;
                b.vx = b.vy = b.w = 0;
                b.group = island;
            }
        }
    }
}

/** Pushes two bodies apart (or together) at a point on each, by an impulse. */
function shove(a: Body, b: Body, ax: number, ay: number, bx: number, by: number, jx: number, jy: number): void {
    a.vx -= a.sm * jx;
    a.vy -= a.sm * jy;
    a.w -= a.si * (ax * jy - ay * jx);
    b.vx += b.sm * jx;
    b.vy += b.sm * jy;
    b.w += b.si * (bx * jy - by * jx);
}

/** A point given around a body's middle, turned as the body is. */
const turn = (b: Body, [x, y]: P): P => [x * Math.cos(b.a) - y * Math.sin(b.a), x * Math.sin(b.a) + y * Math.cos(b.a)];
/** The same, as a place in the world; and a place in the world, measured from a body's middle. */
const world = (b: Body, on: P): P => [b.x + turn(b, on)[0], b.y + turn(b, on)[1]];
const local = (b: Body, x: number, y: number): P => [(x - b.x) * Math.cos(b.a) + (y - b.y) * Math.sin(b.a), -(x - b.x) * Math.sin(b.a) + (y - b.y) * Math.cos(b.a)];

/** How fast a body is going, in pixels a second. */
export const speed = (body: Body): number => Math.hypot(body.vx, body.vy);

/** Gives a body a speed, in pixels a second, and a spin. */
export function send(body: Body, vx: number, vy: number, spin = body.w): void {
    wake(body);
    [body.vx, body.vy, body.w] = [vx, vy, spin];
}

/** Lays a body's outline on a canvas as a path, ready to be filled or stroked. */
export function trace(ctx: CanvasRenderingContext2D, body: Body): void {
    const [c, s] = [Math.cos(body.a), Math.sin(body.a)];
    ctx.beginPath();
    if (body.points.length === 1) {
        ctx.arc(body.x, body.y, body.round, 0, Math.PI * 2);
        return;
    }
    body.points.forEach(([px, py], index) => {
        const [x, y] = [body.x + px * c - py * s, body.y + px * s + py * c];
        if (!body.round) return index ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
        // a rounded corner: an arc from the edge before it to the edge after
        const [before, after] = [body.normals[(index + body.points.length - 1) % body.points.length]!, body.normals[index]!];
        ctx.arc(x, y, body.round, Math.atan2(before[1], before[0]) + body.a, Math.atan2(after[1], after[0]) + body.a);
    });
    ctx.closePath();
}

/** How far a ball reaches from its middle, in pixels; 0 for anything else. */
export const radius = (body: Body): number => (body.points.length === 1 ? body.round : 0);

class Hand {
    #joint?: Joint;
    held?: Body;
    /** How hard it can pull, in multiples of what it holds weighs. */
    strength = 40;

    constructor(readonly flat: Flat) {}

    /** Takes hold of whatever is under the point, or of `body` if one is given. Returns what it took. */
    take(x: number, y: number, body = this.flat.at(x, y)): Body | undefined {
        this.drop();
        if (!body) return undefined;
        this.#joint = this.flat.pull(body, local(body, x, y), 8, this.strength * body.mass * this.flat.gravity);
        this.#joint.to = [x, y];
        this.held = body;
        wake(body);
        return body;
    }

    move(x: number, y: number): void {
        if (this.#joint) this.#joint.to = [x, y];
    }

    drop(): void {
        // What it was pressing on stops being pressed: started again from nothing, a squeezed row eases apart and is not sprung.
        if (this.#joint) this.flat.ease();
        const joint = this.#joint;
        this.#joint = undefined;
        this.held = undefined;
        if (joint) this.flat.remove(joint);
    }
}
