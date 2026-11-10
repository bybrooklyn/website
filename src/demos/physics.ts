// A very small 2D physics engine: rotating boxes, gravity, stacking, friction,
// resting, and a hold for dragging one about. It is enough for the demos on
// this site and nothing more. No dependencies.
//
// The approach is the classic one for a small engine: find where two boxes
// overlap by clipping one's edge against the other's face, then nudge their
// velocities apart a little at a time, several passes per step, until they
// agree. Units are pixels and seconds; y points down.

export interface Vec {
    x: number;
    y: number;
}

export interface Box {
    x: number;
    y: number;
    angle: number;
    vx: number;
    vy: number;
    spin: number;
    /** Half the width and half the height. */
    hw: number;
    hh: number;
    /** 1 / mass and 1 / moment of inertia. Zero for something that never moves. */
    im: number;
    ii: number;
    /** Resting: skipped until something disturbs it. */
    asleep: boolean;
    quiet: number;
}

interface Contact {
    a: Box;
    b: Box;
    /** The point of contact, and the direction from a to b. */
    px: number;
    py: number;
    nx: number;
    ny: number;
    depth: number;
    massNormal: number;
    massTangent: number;
    bias: number;
    pushed: number;
    dragged: number;
}

const GRAVITY = 1800;
const FRICTION = 0.55;
const PASSES = 12;
/** Overlap that is left alone, so resting boxes do not jitter. */
const SLOP = 0.5;
/** Below this speed for long enough, a box goes to sleep. */
const STILL = 5;

export function box(x: number, y: number, width: number, height: number, fixed = false): Box {
    const mass = width * height * 0.001;
    return {
        x,
        y,
        angle: 0,
        vx: 0,
        vy: 0,
        spin: 0,
        hw: width / 2,
        hh: height / 2,
        im: fixed ? 0 : 1 / mass,
        ii: fixed ? 0 : 12 / (mass * (width * width + height * height)),
        asleep: false,
        quiet: 0,
    };
}

export function contains(body: Box, point: Vec): boolean {
    const cos = Math.cos(body.angle);
    const sin = Math.sin(body.angle);
    const dx = point.x - body.x;
    const dy = point.y - body.y;
    return Math.abs(dx * cos + dy * sin) <= body.hw && Math.abs(-dx * sin + dy * cos) <= body.hh;
}

export function wake(body: Box): void {
    body.asleep = false;
    body.quiet = 0;
}

/** Keep the part of a segment on the inner side of a line. */
function clip(points: Vec[], nx: number, ny: number, offset: number): Vec[] {
    const [first, second] = points as [Vec, Vec];
    const d0 = nx * first.x + ny * first.y - offset;
    const d1 = nx * second.x + ny * second.y - offset;
    const kept: Vec[] = [];
    if (d0 <= 0) kept.push(first);
    if (d1 <= 0) kept.push(second);
    if (d0 * d1 < 0) {
        const t = d0 / (d0 - d1);
        kept.push({ x: first.x + t * (second.x - first.x), y: first.y + t * (second.y - first.y) });
    }
    return kept;
}

/** The edge of `body` that most faces against the direction (nx, ny). */
function facingEdge(body: Box, nx: number, ny: number): Vec[] {
    const cos = Math.cos(body.angle);
    const sin = Math.sin(body.angle);
    // the direction, seen from inside the box, reversed
    const lx = -(nx * cos + ny * sin);
    const ly = -(-nx * sin + ny * cos);
    let corners: [number, number, number, number];
    if (Math.abs(lx) > Math.abs(ly)) {
        corners = lx > 0 ? [body.hw, -body.hh, body.hw, body.hh] : [-body.hw, body.hh, -body.hw, -body.hh];
    } else {
        corners = ly > 0 ? [body.hw, body.hh, -body.hw, body.hh] : [-body.hw, -body.hh, body.hw, -body.hh];
    }
    const world = (x: number, y: number): Vec => ({ x: body.x + x * cos - y * sin, y: body.y + x * sin + y * cos });
    return [world(corners[0], corners[1]), world(corners[2], corners[3])];
}

/** Where two boxes touch: none, one or two points. */
function collide(a: Box, b: Box): Contact[] {
    const ca = Math.cos(a.angle);
    const sa = Math.sin(a.angle);
    const cb = Math.cos(b.angle);
    const sb = Math.sin(b.angle);
    const dx = b.x - a.x;
    const dy = b.y - a.y;

    // the gap between them, measured along each box's own two directions
    const dax = dx * ca + dy * sa;
    const day = -dx * sa + dy * ca;
    const dbx = dx * cb + dy * sb;
    const dby = -dx * sb + dy * cb;
    // how one box's directions project onto the other's
    const c00 = Math.abs(ca * cb + sa * sb);
    const c01 = Math.abs(-ca * sb + sa * cb);
    const c10 = Math.abs(-sa * cb + ca * sb);
    const c11 = Math.abs(sa * sb + ca * cb);

    const gapAx = Math.abs(dax) - a.hw - (c00 * b.hw + c01 * b.hh);
    const gapAy = Math.abs(day) - a.hh - (c10 * b.hw + c11 * b.hh);
    if (gapAx > 0 || gapAy > 0) return [];
    const gapBx = Math.abs(dbx) - b.hw - (c00 * a.hw + c10 * a.hh);
    const gapBy = Math.abs(dby) - b.hh - (c01 * a.hw + c11 * a.hh);
    if (gapBx > 0 || gapBy > 0) return [];

    // Pick the face with the smallest overlap, preferring the current one a
    // little so the choice does not flicker between two near-equal faces.
    let face = 0;
    let gap = gapAx;
    if (gapAy > 0.95 * gap + 0.01 * a.hh) [face, gap] = [1, gapAy];
    if (gapBx > 0.95 * gap + 0.01 * b.hw) [face, gap] = [2, gapBx];
    if (gapBy > 0.95 * gap + 0.01 * b.hh) [face, gap] = [3, gapBy];

    // (nx, ny) points from a to b; the reference box owns the chosen face.
    let nx: number, ny: number, sx: number, sy: number, half: number, reach: number;
    const owner = face < 2 ? a : b;
    const other = face < 2 ? b : a;
    const co = face < 2 ? ca : cb;
    const so = face < 2 ? sa : sb;
    if (face === 0 || face === 2) {
        const sign = (face === 0 ? dax : dbx) > 0 ? 1 : -1;
        [nx, ny] = [co * sign, so * sign];
        [sx, sy] = [-so, co];
        [reach, half] = [owner.hw, owner.hh];
    } else {
        const sign = (face === 1 ? day : dby) > 0 ? 1 : -1;
        [nx, ny] = [-so * sign, co * sign];
        [sx, sy] = [co, so];
        [reach, half] = [owner.hh, owner.hw];
    }
    // out of the owner's face: along n for a, against it for b
    const fx = face < 2 ? nx : -nx;
    const fy = face < 2 ? ny : -ny;
    const front = owner.x * fx + owner.y * fy + reach;
    const side = owner.x * sx + owner.y * sy;

    let points = facingEdge(other, fx, fy);
    points = clip(points, -sx, -sy, -side + half);
    if (points.length < 2) return [];
    points = clip(points, sx, sy, side + half);
    if (points.length < 2) return [];

    const contacts: Contact[] = [];
    for (const point of points) {
        const depth = fx * point.x + fy * point.y - front;
        if (depth > 0) continue;
        contacts.push({
            a,
            b,
            px: point.x - depth * fx,
            py: point.y - depth * fy,
            nx,
            ny,
            depth,
            massNormal: 0,
            massTangent: 0,
            bias: 0,
            pushed: 0,
            dragged: 0,
        });
    }
    return contacts;
}

function push(contact: Contact, jx: number, jy: number): void {
    const { a, b, px, py } = contact;
    a.vx -= a.im * jx;
    a.vy -= a.im * jy;
    a.spin -= a.ii * ((px - a.x) * jy - (py - a.y) * jx);
    b.vx += b.im * jx;
    b.vy += b.im * jy;
    b.spin += b.ii * ((px - b.x) * jy - (py - b.y) * jx);
}

/** How fast b is moving past a at the contact point, along (dx, dy). */
function closing(contact: Contact, dx: number, dy: number): number {
    const { a, b, px, py } = contact;
    const vx = b.vx - b.spin * (py - b.y) - (a.vx - a.spin * (py - a.y));
    const vy = b.vy + b.spin * (px - b.x) - (a.vy + a.spin * (px - a.x));
    return vx * dx + vy * dy;
}

export interface Hold {
    body: Box;
    /** Where on the box it is held, in the box's own coordinates. */
    lx: number;
    ly: number;
    /** Where the pointer is. */
    target: Vec;
}

/** Move everything forward by `dt` seconds. */
export function step(bodies: Box[], dt: number, hold?: Hold): void {
    const moving = (body: Box) => body.im > 0 && !body.asleep;

    for (const body of bodies) {
        if (moving(body)) body.vy += GRAVITY * dt;
    }

    // Carry a held box toward the pointer: firm, but never a hard yank.
    if (hold) {
        const { body, lx, ly, target } = hold;
        wake(body);
        const cos = Math.cos(body.angle);
        const sin = Math.sin(body.angle);
        const rx = lx * cos - ly * sin;
        const ry = lx * sin + ly * cos;
        const wantX = (target.x - (body.x + rx)) * 14;
        const wantY = (target.y - (body.y + ry)) * 14;
        let fx = (wantX - (body.vx - body.spin * ry)) * 0.35;
        let fy = (wantY - (body.vy + body.spin * rx)) * 0.35;
        // A hand, not a bulldozer: there is a limit to how hard it can pull.
        const pull = Math.hypot(fx, fy);
        const most = 9000 * dt;
        if (pull > most) {
            fx *= most / pull;
            fy *= most / pull;
        }
        body.vx += fx;
        body.vy += fy - GRAVITY * dt;
        body.spin += (rx * fy - ry * fx) * body.ii * (1 / body.im) * 0.35;
        body.spin *= 0.92;
    }

    const contacts: Contact[] = [];
    for (let i = 0; i < bodies.length; i++) {
        for (let j = i + 1; j < bodies.length; j++) {
            const a = bodies[i]!;
            const b = bodies[j]!;
            if (!moving(a) && !moving(b)) continue;
            const far = a.hw + a.hh + b.hw + b.hh;
            if (Math.abs(a.x - b.x) > far || Math.abs(a.y - b.y) > far) continue;
            contacts.push(...collide(a, b));
        }
    }

    // Something resting is woken by anything that hits it with some speed.
    for (const contact of contacts) {
        for (const [sleeper, mover] of [[contact.a, contact.b], [contact.b, contact.a]] as const) {
            if (sleeper.asleep && moving(mover) && Math.hypot(mover.vx, mover.vy) + Math.abs(mover.spin) * 20 > 60) {
                wake(sleeper);
            }
        }
    }
    const im = (body: Box) => (body.asleep ? 0 : body.im);
    const ii = (body: Box) => (body.asleep ? 0 : body.ii);

    for (const contact of contacts) {
        const { a, b, px, py, nx, ny } = contact;
        const along = (dx: number, dy: number) => {
            const ra = (px - a.x) * dy - (py - a.y) * dx;
            const rb = (px - b.x) * dy - (py - b.y) * dx;
            return 1 / (im(a) + im(b) + ii(a) * ra * ra + ii(b) * rb * rb);
        };
        contact.massNormal = along(nx, ny);
        contact.massTangent = along(ny, -nx);
        contact.bias = (-0.2 / dt) * Math.min(0, contact.depth + SLOP);
    }

    for (let pass = 0; pass < PASSES; pass++) {
        for (const contact of contacts) {
            const { a, b, nx, ny } = contact;
            if (a.asleep && b.asleep) continue;
            const saved = [a.im, a.ii, b.im, b.ii] as const;
            [a.im, a.ii, b.im, b.ii] = [im(a), ii(a), im(b), ii(b)];

            // apart: only ever a push, never a pull
            let change = contact.massNormal * (-closing(contact, nx, ny) + contact.bias);
            const pushed = Math.max(contact.pushed + change, 0);
            change = pushed - contact.pushed;
            contact.pushed = pushed;
            push(contact, nx * change, ny * change);

            // sideways: friction, limited by how hard they are pressed together
            const tx = ny;
            const ty = -nx;
            change = contact.massTangent * -closing(contact, tx, ty);
            const limit = FRICTION * contact.pushed;
            const dragged = Math.max(-limit, Math.min(contact.dragged + change, limit));
            change = dragged - contact.dragged;
            contact.dragged = dragged;
            push(contact, tx * change, ty * change);

            [a.im, a.ii, b.im, b.ii] = saved;
        }
    }

    for (const body of bodies) {
        if (!moving(body)) continue;
        body.x += body.vx * dt;
        body.y += body.vy * dt;
        body.angle += body.spin * dt;

        const still = Math.hypot(body.vx, body.vy) < STILL && Math.abs(body.spin) < 0.15;
        body.quiet = still && hold?.body !== body ? body.quiet + dt : 0;
        if (body.quiet > 0.8) {
            body.asleep = true;
            body.vx = body.vy = body.spin = 0;
        }
    }
}
