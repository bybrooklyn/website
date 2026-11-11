// A small 2D physics engine written for this site. No dependencies.
//
//   const world = new World();
//   world.add(rect(x, y, w, h), ball(x, y, r), shape(x, y, points), rect(..., { fixed: true }));
//   world.join(a, b, [ax, ay], [bx, by]);          // pin two bodies together at those points
//   world.join(a, b, [ax, ay], [bx, by], 40, true); // or a rope 40 long
//   world.grab(point); world.drag(point); world.release();
//   world.step(1 / 120);
//
// Bodies are circles or convex shapes. Each step finds where bodies touch,
// then nudges velocities a little at a time, several passes over, until
// contacts, joints and the grabbed point all agree. Bodies that have ended up
// overlapping, or joints that have come apart, are then put right by moving
// them, separately from their velocities, so that fixing a mistake never
// throws anything. Units are pixels and seconds; y points down.
//
// physics.test.ts says what it is held to: friction angles, a standing tower,
// a pendulum's period, no energy from nowhere.

export type V = [number, number];

export interface Body {
    id: number;
    /** No part of it is further than this from its center. */
    far: number;
    x: number;
    y: number;
    a: number;
    vx: number;
    vy: number;
    w: number;
    /** Radius for a ball; 0 for a shape. */
    r: number;
    /** A shape's corners, around its center, and the same in the world. */
    p: V[];
    wp: V[];
    wn: V[];
    /** 1 / mass and 1 / moment of inertia; 0 for something fixed. */
    im: number;
    ii: number;
    friction: number;
    bounce: number;
    asleep: boolean;
    quiet: number;
}

export interface Options {
    fixed?: boolean;
    friction?: number;
    bounce?: number;
    angle?: number;
    /** How heavy for its size, against the usual 1. */
    density?: number;
}

/** One thing the solver has to satisfy: a contact, one axis of a joint, or the grab. */
interface Tie {
    a: Body;
    b: Body;
    /** Arms from each body's center to the point, and the direction acted along. */
    ax: number;
    ay: number;
    bx: number;
    by: number;
    nx: number;
    ny: number;
    mass: number;
    /** The speed the solver aims for along the direction: a bounce, or the grab's pull. */
    bias: number;
    sum: number;
    /** How fast to move the two apart (or together) to undo an overlap or a stretched joint. Positions only. */
    fix: number;
    moved: number;
    /** Limits on the total push: a contact only pushes, a rope only pulls. */
    lo: number;
    hi: number;
    /** A contact's friction partner, limited by how hard the contact presses. */
    grip?: Tie;
    mu?: number;
    /** Names the same tie from one step to the next, so it can start from last time's answer. */
    key?: string;
}

interface Joint {
    a: Body;
    b: Body;
    pa: V;
    pb: V;
    length: number;
    rope: boolean;
}

const dot = (ax: number, ay: number, bx: number, by: number) => ax * bx + ay * by;
const cross = (ax: number, ay: number, bx: number, by: number) => ax * by - ay * bx;
const turn = (b: Body, [x, y]: V): V => {
    const c = Math.cos(b.a);
    const s = Math.sin(b.a);
    return [b.x + x * c - y * s, b.y + x * s + y * c];
};

let count = 0;

/** How far two bodies may overlap, in pixels, before they are moved apart. */
export const SLACK = 0.25;

function body(x: number, y: number, r: number, p: V[], area: number, spread: number, o: Options): Body {
    const mass = area * 0.001 * (o.density ?? 1);
    return {
        id: ++count,
        far: r || Math.max(...p.map(([px, py]) => Math.hypot(px, py))),
        x, y, r, p, a: o.angle ?? 0, vx: 0, vy: 0, w: 0, wp: [], wn: [],
        im: o.fixed ? 0 : 1 / mass,
        ii: o.fixed ? 0 : 1 / (mass * spread),
        friction: o.friction ?? 0.55,
        bounce: o.bounce ?? 0,
        asleep: false,
        quiet: 0,
    };
}

export const ball = (x: number, y: number, r: number, o: Options = {}): Body => body(x, y, r, [], Math.PI * r * r, (r * r) / 2, o);

/** Any convex shape, from its corners in order. They are re-centered on the shape's middle. */
export function shape(x: number, y: number, points: V[], o: Options = {}): Body {
    let area = 0, cx = 0, cy = 0, spread = 0;
    points.forEach(([px, py], i) => {
        const [qx, qy] = points[(i + 1) % points.length]!;
        const k = cross(px, py, qx, qy);
        area += k / 2;
        cx += (px + qx) * k;
        cy += (py + qy) * k;
    });
    cx /= 6 * area;
    cy /= 6 * area;
    const p = points.map(([px, py]): V => [px - cx, py - cy]);
    p.forEach(([px, py], i) => {
        const [qx, qy] = p[(i + 1) % p.length]!;
        spread += cross(px, py, qx, qy) * (px * px + px * qx + qx * qx + py * py + py * qy + qy * qy);
    });
    return body(x, y, 0, p, Math.abs(area), Math.abs(spread / (12 * area)), o);
}

export const rect = (x: number, y: number, w: number, h: number, o: Options = {}): Body =>
    shape(x, y, [[-w / 2, -h / 2], [w / 2, -h / 2], [w / 2, h / 2], [-w / 2, h / 2]], o);

/** Work out where a shape's corners and faces are in the world. */
function place(b: Body): void {
    b.wp = b.p.map((point) => turn(b, point));
    b.wn = b.wp.map(([px, py], i) => {
        const [qx, qy] = b.wp[(i + 1) % b.wp.length]!;
        let nx = qy - py, ny = px - qx;
        const length = Math.hypot(nx, ny) || 1;
        // out of the shape, whichever way round its corners were given
        if (dot(nx, ny, (px + qx) / 2 - b.x, (py + qy) / 2 - b.y) < 0) [nx, ny] = [-nx, -ny];
        return [nx / length, ny / length];
    });
}

export function contains(b: Body, [x, y]: V): boolean {
    if (b.r) return Math.hypot(x - b.x, y - b.y) <= b.r;
    return b.wn.every(([nx, ny], i) => dot(nx, ny, x - b.wp[i]![0], y - b.wp[i]![1]) <= 0);
}

export function wake(b: Body): void {
    b.asleep = false;
    b.quiet = 0;
}

/** A touch between two bodies: the point, the direction from a to b, and how deep. */
type Touch = [px: number, py: number, nx: number, ny: number, depth: number];

/** The face of `a` that `b` is least far behind, and by how much. Positive means apart. */
function gap(a: Body, b: Body): [number, number] {
    let best = -Infinity, face = 0;
    a.wn.forEach(([nx, ny], i) => {
        const [fx, fy] = a.wp[i]!;
        const least = Math.min(...b.wp.map(([x, y]) => dot(nx, ny, x - fx, y - fy)));
        if (least > best) [best, face] = [least, i];
    });
    return [best, face];
}

function touchShapes(a: Body, b: Body): Touch[] {
    const [ga, fa] = gap(a, b);
    if (ga > 0) return [];
    const [gb, fb] = gap(b, a);
    if (gb > 0) return [];
    // The face with the smaller overlap is the one to push along; lean toward a's so it does not flicker.
    const flip = gb > 0.95 * ga + 0.01;
    const [ref, inc, face] = flip ? [b, a, fb] : [a, b, fa];
    const [nx, ny] = ref.wn[face]!;
    const [x1, y1] = ref.wp[face]!;
    const [x2, y2] = ref.wp[(face + 1) % ref.wp.length]!;
    // the other body's face that most squarely meets it
    let against = 0, least = Infinity;
    inc.wn.forEach(([ix, iy], i) => {
        const facing = dot(ix, iy, nx, ny);
        if (facing < least) [least, against] = [facing, i];
    });
    let edge: V[] = [inc.wp[against]!, inc.wp[(against + 1) % inc.wp.length]!];
    // keep the part of that edge that lies alongside the reference face
    const length = Math.hypot(x2 - x1, y2 - y1);
    const tx = (x2 - x1) / length, ty = (y2 - y1) / length;
    for (const [sx, sy, limit] of [[-tx, -ty, -dot(tx, ty, x1, y1)], [tx, ty, dot(tx, ty, x2, y2)]] as const) {
        const [[px, py], [qx, qy]] = edge as [V, V];
        const d0 = dot(sx, sy, px, py) - limit, d1 = dot(sx, sy, qx, qy) - limit;
        const kept: V[] = [];
        if (d0 <= 0) kept.push([px, py]);
        if (d1 <= 0) kept.push([qx, qy]);
        if (d0 * d1 < 0) kept.push([px + (d0 / (d0 - d1)) * (qx - px), py + (d0 / (d0 - d1)) * (qy - py)]);
        if (kept.length < 2) return [];
        edge = kept;
    }
    const sign = flip ? -1 : 1;
    return edge.flatMap(([px, py]): Touch[] => {
        const depth = dot(nx, ny, px - x1, py - y1);
        return depth > 0 ? [] : [[px - depth * nx, py - depth * ny, nx * sign, ny * sign, depth]];
    });
}

/** A ball against a shape. The direction returned runs from the shape to the ball. */
function touchBall(s: Body, c: Body): Touch[] {
    const [g, face] = gap(s, { ...c, wp: [[c.x, c.y]] });
    if (g > c.r) return [];
    const [nx, ny] = s.wn[face]!;
    if (g < 0) return [[c.x - nx * c.r, c.y - ny * c.r, nx, ny, g - c.r]];
    const [x1, y1] = s.wp[face]!;
    const [x2, y2] = s.wp[(face + 1) % s.wp.length]!;
    const along = Math.max(0, Math.min(1, dot(c.x - x1, c.y - y1, x2 - x1, y2 - y1) / ((x2 - x1) ** 2 + (y2 - y1) ** 2)));
    const qx = x1 + along * (x2 - x1), qy = y1 + along * (y2 - y1);
    const away = Math.hypot(c.x - qx, c.y - qy);
    return away > c.r || !away ? [] : [[qx, qy, (c.x - qx) / away, (c.y - qy) / away, away - c.r]];
}

function touch(a: Body, b: Body): Touch[] {
    if (a.r && b.r) {
        const away = Math.hypot(b.x - a.x, b.y - a.y);
        if (away > a.r + b.r || !away) return [];
        const nx = (b.x - a.x) / away, ny = (b.y - a.y) / away;
        return [[a.x + nx * a.r, a.y + ny * a.r, nx, ny, away - a.r - b.r]];
    }
    if (b.r) return touchBall(a, b);
    if (a.r) return touchBall(b, a).map(([px, py, nx, ny, depth]): Touch => [px, py, -nx, -ny, depth]);
    return touchShapes(a, b);
}

export class World {
    bodies: Body[] = [];
    gravity = 1800;
    /** How quickly anything moving through the air slows, per second. */
    air = 0.03;
    /** How quickly something touching something else stops spinning, per second: what makes a rolling ball come to a stop. */
    roll = 0.7;
    /** Each step is taken as this many smaller ones. More holds stacks and chains together better. */
    parts = 2;
    /** How many times the solver goes over everything in each of those. More is stiffer and slower. */
    passes = 8;
    #joints: Joint[] = [];
    /** Pairs that are joined, which pass through each other. */
    #joined = new Set<string>();
    /** What each tie settled on last step. */
    #was = new Map<string, number>();
    #held?: { b: Body; at: V; to: V };
    /** Stands in for "the world" on the far side of the grab. */
    #anchor = ball(0, 0, 1, { fixed: true });
    /** How hard the grab can pull, in multiples of the held body's weight. */
    grip = 40;
    /** How much of the gap to the pointer a held body closes each step: 1 snaps to it, lower trails behind. */
    follow = 0.35;

    add(...bodies: Body[]): this {
        for (const b of bodies) {
            place(b);
            this.bodies.push(b);
        }
        return this;
    }

    remove(b: Body): void {
        this.bodies = this.bodies.filter((other) => other !== b);
        this.#joints = this.#joints.filter((joint) => joint.a !== b && joint.b !== b);
        if (this.#held?.b === b) this.#held = undefined;
    }

    /** Join two bodies at a point on each (given around their centers). Length 0 pins them together. */
    join(a: Body, b: Body, pa: V = [0, 0], pb: V = [0, 0], length = 0, rope = false): void {
        this.#joints.push({ a, b, pa, pb, length, rope });
        this.#joined.add(`${a.id}:${b.id}`).add(`${b.id}:${a.id}`);
    }

    /** The topmost body under a point. */
    at(point: V): Body | undefined {
        return [...this.bodies].reverse().find((b) => b.im && contains(b, point));
    }

    /** Take hold of whatever is under the point. Returns it, if there was anything. */
    grab(point: V): Body | undefined {
        const b = this.at(point);
        if (b) {
            const c = Math.cos(b.a), s = Math.sin(b.a), dx = point[0] - b.x, dy = point[1] - b.y;
            this.#held = { b, at: [dx * c + dy * s, -dx * s + dy * c], to: point };
        }
        return b;
    }

    drag(point: V): void {
        if (this.#held) this.#held.to = point;
    }

    release(): void {
        this.#held = undefined;
    }

    get holding(): boolean {
        return Boolean(this.#held);
    }

    step(dt: number): void {
        for (let part = 0; part < this.parts; part++) this.#advance(dt / this.parts);
    }

    #advance(dt: number): void {
        const { bodies } = this;
        const live = (b: Body) => b.im > 0 && !b.asleep;
        const held = this.#held;
        if (held) wake(held.b);

        for (const b of bodies) {
            if (live(b)) b.vy += this.gravity * dt;
            place(b);
        }

        const ties: Tie[] = [];
        const tie = (a: Body, b: Body, px: number, py: number, nx: number, ny: number, bias: number, lo: number, hi: number): Tie => {
            const t: Tie = { a, b, ax: px - a.x, ay: py - a.y, bx: px - b.x, by: py - b.y, nx, ny, mass: 0, bias, sum: 0, lo, hi, fix: 0, moved: 0 };
            ties.push(t);
            return t;
        };

        // The fastest any overlap or stretched joint is undone. Without a limit a deep overlap is a launch.
        const most = 240;
        const touching = new Set<Body>();

        // contacts
        for (let i = 0; i < bodies.length; i++) {
            for (let j = i + 1; j < bodies.length; j++) {
                const a = bodies[i]!, b = bodies[j]!;
                if (!live(a) && !live(b)) continue;
                if (Math.hypot(a.x - b.x, a.y - b.y) > a.far + b.far && a.im && b.im) continue;
                if (this.#joined.has(`${a.id}:${b.id}`)) continue;
                touch(a, b).forEach(([px, py, nx, ny, depth], k) => {
                    // something resting is woken by anything that hits it with some speed
                    for (const [sleeper, mover] of [[a, b], [b, a]] as const) {
                        if (sleeper.asleep && live(mover) && (mover === held?.b || Math.hypot(mover.vx, mover.vy) + Math.abs(mover.w) * 20 > 25)) wake(sleeper);
                    }
                    touching.add(a).add(b);
                    const press = tie(a, b, px, py, nx, ny, 0, 0, Infinity);
                    // A quarter of a pixel of overlap is left alone, so resting contacts do not flicker on and off.
                    press.fix = Math.min(most, (-0.2 / dt) * Math.min(0, depth + SLACK));
                    const speed = this.#closing(press);
                    if (speed < -120) press.bias -= Math.max(a.bounce, b.bounce) * speed;
                    press.grip = tie(a, b, px, py, ny, -nx, 0, 0, 0);
                    press.mu = Math.sqrt(a.friction * b.friction);
                    press.key = `${a.id}:${b.id}:${k}`;
                    press.grip.key = press.key + "f";
                });
            }
        }

        // joints: a pin is held on both axes; a rod or rope along the line between its ends
        this.#joints.forEach(({ a, b, pa, pb, length, rope }, index) => {
            if (!live(a) && !live(b)) return;
            wake(a);
            wake(b);
            const [ax, ay] = turn(a, pa), [bx, by] = turn(b, pb);
            const dx = bx - ax, dy = by - ay, gapNow = Math.hypot(dx, dy);
            const mx = (ax + bx) / 2, my = (ay + by) / 2;
            const fix = (nx: number, ny: number, error: number, lo: number) => {
                const t = tie(a, b, mx, my, nx, ny, 0, lo, Infinity);
                t.fix = Math.max(-most * 4, Math.min(most * 4, (-0.3 / dt) * error));
                [t.ax, t.ay, t.bx, t.by] = [ax - a.x, ay - a.y, bx - b.x, by - b.y];
                t.key = `j${index}${nx === 1 ? "x" : ""}`;
            };
            if (!length) {
                fix(1, 0, dx, -Infinity);
                fix(0, 1, dy, -Infinity);
            } else if (gapNow && !(rope && gapNow < length)) {
                // a rope only ever pulls its ends together
                fix(-dx / gapNow, -dy / gapNow, length - gapNow, rope ? 0 : -Infinity);
            }
        });

        // the grab: the held point goes to the pointer, as hard as a firm hand could move it
        if (held) {
            const [hx, hy] = turn(held.b, held.at);
            const pull = (this.grip * this.gravity * dt) / held.b.im;
            // It follows in whole steps, however many parts a step is taken in.
            const rate = this.follow / (dt * this.parts);
            for (const [nx, ny, error] of [[1, 0, held.to[0] - hx], [0, 1, held.to[1] - hy]] as const) {
                const t = tie(this.#anchor, held.b, hx, hy, nx, ny, rate * error, -pull, pull);
                [t.ax, t.ay] = [0, 0];
            }
            held.b.w *= 0.9;
        }

        const im = (b: Body) => (b.asleep ? 0 : b.im);
        const ii = (b: Body) => (b.asleep ? 0 : b.ii);
        for (const t of ties) {
            const ra = cross(t.ax, t.ay, t.nx, t.ny), rb = cross(t.bx, t.by, t.nx, t.ny);
            t.mass = 1 / (im(t.a) + im(t.b) + ii(t.a) * ra * ra + ii(t.b) * rb * rb || 1);
        }
        const push = (t: Tie, j: number) => {
            const { a, b } = t, jx = t.nx * j, jy = t.ny * j;
            a.vx -= im(a) * jx;
            a.vy -= im(a) * jy;
            a.w -= ii(a) * cross(t.ax, t.ay, jx, jy);
            b.vx += im(b) * jx;
            b.vy += im(b) * jy;
            b.w += ii(b) * cross(t.bx, t.by, jx, jy);
        };
        // Start from what held last step: a resting pile is then already nearly solved.
        for (const t of ties) {
            t.sum = (t.key && this.#was.get(t.key)) || 0;
            push(t, t.sum);
        }

        for (let pass = 0; pass < this.passes; pass++) {
            // Forward then backward, so a push travels along a chain or up a stack in both directions.
            const order = pass % 2 ? ties.toReversed() : ties;
            for (const t of order) {
                if (t.grip) [t.grip.lo, t.grip.hi] = [-t.mu! * t.sum, t.mu! * t.sum];
                const sum = Math.max(t.lo, Math.min(t.sum + t.mass * (t.bias - this.#closing(t)), t.hi));
                push(t, sum - t.sum);
                t.sum = sum;
            }
        }
        this.#was.clear();
        for (const t of ties) if (t.key) this.#was.set(t.key, t.sum);

        // Putting right what has overlapped or come apart. The same sums, done on a
        // second set of velocities that only ever move things and are then thrown away.
        const shift = new Map<Body, [number, number, number]>();
        const of = (b: Body) => shift.get(b) ?? (shift.set(b, [0, 0, 0]), shift.get(b)!);
        const mending = ties.filter((t) => t.fix !== 0);
        for (let pass = 0; pass < 4 && mending.length > 0; pass++) {
            for (const t of pass % 2 ? mending.toReversed() : mending) {
                const sa = of(t.a), sb = of(t.b);
                const closing = dot(sb[0] - sb[2] * t.by - (sa[0] - sa[2] * t.ay), sb[1] + sb[2] * t.bx - (sa[1] + sa[2] * t.ax), t.nx, t.ny);
                const moved = Math.max(t.lo, Math.min(t.moved + t.mass * (t.fix - closing), t.hi));
                const j = moved - t.moved, jx = t.nx * j, jy = t.ny * j;
                t.moved = moved;
                sa[0] -= im(t.a) * jx;
                sa[1] -= im(t.a) * jy;
                sa[2] -= ii(t.a) * cross(t.ax, t.ay, jx, jy);
                sb[0] += im(t.b) * jx;
                sb[1] += im(t.b) * jy;
                sb[2] += ii(t.b) * cross(t.bx, t.by, jx, jy);
            }
        }

        for (const b of bodies) {
            if (!live(b)) continue;
            const slow = 1 - this.air * dt;
            b.vx *= slow;
            b.vy *= slow;
            if (touching.has(b)) {
                // Rolling costs a little at any speed, as well as more the faster it goes, so a ball rolls to a stop.
                const least = ((0.03 * this.gravity) / b.far) * dt;
                b.w = Math.abs(b.w) <= least ? 0 : (b.w - Math.sign(b.w) * least) * (1 - this.roll * dt);
            }
            const mend = shift.get(b) ?? [0, 0, 0];
            b.x += (b.vx + mend[0]) * dt;
            b.y += (b.vy + mend[1]) * dt;
            b.a += (b.w + mend[2]) * dt;
            // still for long enough, it goes to sleep until something disturbs it
            const still = Math.hypot(b.vx, b.vy) < 5 && Math.abs(b.w) < 0.15 && held?.b !== b;
            b.quiet = still ? b.quiet + dt : 0;
            if (b.quiet > 0.8) {
                b.asleep = true;
                b.vx = b.vy = b.w = 0;
            }
        }
    }

    /** How fast b is moving away from a at a tie's point, along its direction. */
    #closing(t: Tie): number {
        const { a, b } = t;
        return dot(b.vx - b.w * t.by - (a.vx - a.w * t.ay), b.vy + b.w * t.bx - (a.vy + a.w * t.ax), t.nx, t.ny);
    }
}
