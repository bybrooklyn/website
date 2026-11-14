// The comet's flight, without its picture: the field it flies through, the pull of everything on it,
// and how a flight ends. comet.ts draws it; fields.ts makes the fields and finds a way through each.
//
// A flight is the same on every machine for the same field and the same launch. It moves in fixed
// steps of 1/120 of a second whatever the screen does, and it is worked out with nothing but adding,
// multiplying, dividing, square roots and rounding down, which every browser does alike. Sines,
// cosines and powers are left out on purpose: browsers may differ in their last digit, and a field
// kept or thrown away by the generator must not depend on which browser made it. Directions are
// taken from `AIMS`, a table built by turning one step at a time, and things that go round are placed
// from it too.
//
// The rules a flight keeps, one to each kind of thing:
//   a star pulls and a pusher pushes, only within its reach, which is drawn: strongly near it, fading
//   to nothing at the edge of its reach;
//   the black hole pulls hardest of all, close in, and its reach is small: near its middle it also
//   grips, taking speed away, so a comet that comes close spirals in; a comet within its mouth is
//   swallowed and the field is won;
//   a rock does not pull; touching it, a star or a pusher is a miss;
//   a gas cloud slows a comet while it is inside;
//   a ring speeds a comet up each time it goes in;
//   a wall bounces a comet off it, as a mirror would;
//   a comet that enters a wormhole's mouth comes out of the other mouth of the pair at once, at the
//   same speed and heading, just outside it on the side it is heading for;
//   sparks are picked up on the way and change nothing;
//   a comet that leaves the field, or is still flying after `LIMIT` seconds, has missed.
// Things that move (planets, moons, rocks that drift, a hole that wanders) move by the clock of the
// flight, which starts at the launch: where each is at any step is worked out from the step alone, so
// a field is the same puzzle on every try.

/** The field, in its own units: wider than high, turned on its side on a tall screen. */
export const WIDE = 1600;
export const HIGH = 1000;
/** One step of the flight, in seconds. */
export const STEP = 1 / 120;
/** A flight that has not ended after this many seconds is a miss. */
export const LIMIT = 20;
/** How fast a comet sets off at full strength, in units a second, and the least strength there is. */
export const FASTEST = 600;
export const WEAKEST = 0.2;
/** Strength comes in steps of this much, for the keyboard and the solver; a drag may give any strength between. */
export const NOTCH = 0.025;
/** How many directions the keyboard and the solver aim in: half a degree apart. */
export const TURNS = 720;
/** What going into a ring does to a comet's speed, and the fastest rings can make it. */
export const BOOST = 1.4;
export const TOP = 1000;
/** How much of its speed a comet loses each second in a cloud, and in the hole's grip at its middle. */
export const CLOUD_DRAG = 1.2;
export const GRIP_DRAG = 5;
/** How near a spark the comet's middle must pass to pick it up. */
export const SPARK = 16;

/** How a thing moves: round a middle, or to and fro along a line. */
export type Path =
    /** Round (x, y) at distance r, starting at `from` in `AIMS` and turning `rate` of them a step (less than 0 turns the other way). */
    | { kind: "circle"; x: number; y: number; r: number; from: number; rate: number }
    /** To and fro between two ends, easing at each, once there and back in `period` steps, starting `from` of the way through (0 to 1). */
    | { kind: "line"; ax: number; ay: number; bx: number; by: number; period: number; from: number };

/** A star, a pusher or a rock: round, and a miss to touch. */
export interface Body {
    /** Where it is at the launch. */
    x: number;
    y: number;
    radius: number;
    /** Above 0 it pulls; below 0 it pushes; 0 is a rock, which does neither. */
    mass: number;
    /** How far from its middle the pull or push is felt at all. */
    reach: number;
    path?: Path;
}

export interface Gate {
    x: number;
    y: number;
    radius: number;
    /** The gate at the other end, by its place in the field's list. */
    to: number;
    /** Which pair it belongs to, for its color. */
    pair: number;
}

export interface Hole {
    /** Where it is at the launch. */
    x: number;
    y: number;
    /** The dark disc that is drawn. */
    radius: number;
    /** A comet whose middle comes this near is swallowed. */
    mouth: number;
    /** How far from its middle the pull is felt at all. */
    reach: number;
    /** How far from its middle it grips, taking speed away. */
    grip: number;
    mass: number;
    path?: Path;
}

/** A round thing a comet passes through: a cloud slows it, a ring speeds it up. */
export interface Round {
    x: number;
    y: number;
    radius: number;
}

/** A wall, from one end to the other. */
export interface Wall {
    ax: number;
    ay: number;
    bx: number;
    by: number;
}

/** A spark to pick up on the way. */
export interface Spark {
    x: number;
    y: number;
}

export interface Field {
    seed: string;
    level: number;
    /** What the field is made round, as fields.ts names it. */
    idea: string;
    start: { x: number; y: number };
    hole: Hole;
    bodies: Body[];
    gates: Gate[];
    clouds: Round[];
    rings: Round[];
    walls: Wall[];
    sparks: Spark[];
}

export type Ending = "won" | "out" | "struck" | "late";

/** A comet on its way. */
export interface Comet {
    x: number;
    y: number;
    vx: number;
    vy: number;
    /** Steps since it was launched, and the same in seconds. */
    step: number;
    time: number;
    /** The pull on it now, kept from one step to the next. */
    ax: number;
    ay: number;
    ended?: Ending;
    /** For a comet that struck something, which body; for one that went through a wormhole this step, which gate it came out of. */
    body?: number;
    through?: number;
    /** What happened this step, for the picture: which wall it bounced off, which ring it went into. */
    bounced?: number;
    boosted?: number;
    /** Whether it is in a cloud now. */
    braked: boolean;
    /** The sparks picked up, one bit each. */
    sparks: number;
}

/**
 * Directions half a degree apart, counterclockwise from the right as the field is drawn (y down, so
 * the second number is negated when shown). Built by turning (1, 0) by half a degree again and again,
 * with the turn written out as numbers, so the table is the same in every browser.
 */
export const AIMS: readonly (readonly [number, number])[] = (() => {
    const [c, s] = [0.9999619230641713, 0.008726535498373935];
    const made: [number, number][] = [];
    let [x, y] = [1, 0];
    for (let i = 0; i < TURNS; i++) {
        made.push([x, y]);
        [x, y] = [x * c - y * s, x * s + y * c];
        const long = Math.sqrt(x * x + y * y);
        [x, y] = [x / long, y / long];
    }
    return made;
})();

/** The velocity of a launch in the keyboard's terms: a direction from `AIMS` and a strength in notches. */
export function velocity(aim: number, notches: number): [number, number] {
    const [x, y] = AIMS[((aim % TURNS) + TURNS) % TURNS]!;
    const speed = Math.min(1, Math.max(WEAKEST, notches * NOTCH)) * FASTEST;
    return [x * speed, y * speed];
}

/** The direction in `AIMS` nearest to a heading. */
export function nearest(dx: number, dy: number): number {
    let [best, most] = [0, -Infinity];
    for (let i = 0; i < TURNS; i++) {
        const along = AIMS[i]![0] * dx + AIMS[i]![1] * dy;
        if (along > most) [best, most] = [i, along];
    }
    return best;
}

/** Where `where` leaves its answer when it is not given a place of its own. */
const spot = { x: 0, y: 0 };

/** Where a thing that may move is, `step` steps after the launch. Nothing but adding, multiplying, dividing, square roots and rounding down. */
export function where(thing: { x: number; y: number; path?: Path }, step: number, into: { x: number; y: number } = spot): { x: number; y: number } {
    const path = thing.path;
    if (!path) {
        into.x = thing.x;
        into.y = thing.y;
    } else if (path.kind === "circle") {
        // between two directions of the table, and made one long again
        const turned = path.from + path.rate * step;
        const at = Math.floor(turned);
        const part = turned - at;
        const one = AIMS[((at % TURNS) + TURNS) % TURNS]!;
        const two = AIMS[(((at + 1) % TURNS) + TURNS) % TURNS]!;
        const x = one[0] + (two[0] - one[0]) * part;
        const y = one[1] + (two[1] - one[1]) * part;
        const long = Math.sqrt(x * x + y * y);
        into.x = path.x + (x / long) * path.r;
        into.y = path.y + (y / long) * path.r;
    } else {
        let along = step / path.period + path.from;
        along -= Math.floor(along);
        const there = along < 0.5 ? along * 2 : 2 - along * 2;
        const eased = there * there * (3 - 2 * there);
        into.x = path.ax + (path.bx - path.ax) * eased;
        into.y = path.ay + (path.by - path.ay) * eased;
    }
    return into;
}

/**
 * How strongly something of `mass` pulls at a distance whose square is `near`, within a `reach`: the
 * pull of mass over distance squared, softened very near the middle, and brought down smoothly to
 * nothing at the reach, so that beyond the ring that is drawn there is no pull at all. Gives the
 * pull divided by the distance, to be multiplied by the offset.
 */
export function strength(mass: number, reach: number, soft: number, near: number): number {
    const reached = reach * reach;
    if (near >= reached) return 0;
    const fade = 1 - near / reached;
    const softened = near + soft * soft;
    return (mass * fade * fade) / (softened * Math.sqrt(softened));
}

/** Where things are this step, worked out once for the step: each body's place, then the hole's. No new arrays on every step of every flight the solver tries. */
let placed = new Float64Array(64);
function place(field: Field, step: number): void {
    const bodies = field.bodies;
    if (placed.length < bodies.length * 2 + 2) placed = new Float64Array(bodies.length * 4 + 4);
    for (let i = 0; i < bodies.length; i++) {
        const body = bodies[i]!;
        if (body.path) {
            where(body, step);
            placed[i * 2] = spot.x;
            placed[i * 2 + 1] = spot.y;
        } else {
            placed[i * 2] = body.x;
            placed[i * 2 + 1] = body.y;
        }
    }
    where(field.hole, step);
    placed[bodies.length * 2] = spot.x;
    placed[bodies.length * 2 + 1] = spot.y;
}

/** Where `pulling` leaves its answer. */
const pulled = { x: 0, y: 0 };
/** The pull on a comet at (x, y), with things where `place` last put them. */
function pulling(field: Field, x: number, y: number): void {
    const bodies = field.bodies;
    const hole = field.hole;
    const at = bodies.length * 2;
    let dx = placed[at]! - x;
    let dy = placed[at + 1]! - y;
    let by = strength(hole.mass, hole.reach, hole.mouth * 0.5, dx * dx + dy * dy);
    let ax = dx * by;
    let ay = dy * by;
    for (let i = 0; i < bodies.length; i++) {
        const body = bodies[i]!;
        if (body.mass === 0) continue;
        dx = placed[i * 2]! - x;
        dy = placed[i * 2 + 1]! - y;
        by = strength(body.mass, body.reach, body.radius * 0.5, dx * dx + dy * dy);
        ax += dx * by;
        ay += dy * by;
    }
    pulled.x = ax;
    pulled.y = ay;
}

/** The pull on a comet at (x, y), `step` steps after the launch: stars pull, pushers push, the hole pulls hardest, each only within its reach. */
export function pull(field: Field, x: number, y: number, step = 0): [number, number] {
    place(field, step);
    pulling(field, x, y);
    return [pulled.x, pulled.y];
}

/** A comet at the start, sent off with this velocity. */
export function launch(field: Field, vx: number, vy: number): Comet {
    const [ax, ay] = pull(field, field.start.x, field.start.y, 0);
    return { x: field.start.x, y: field.start.y, vx, vy, step: 0, time: 0, ax, ay, braked: false, sparks: 0 };
}

/** How far along the move from (x, y) by (dx, dy), from 0 to 1, it first comes within `r` of (cx, cy); 2 if it does not. */
function meets(x: number, y: number, dx: number, dy: number, cx: number, cy: number, r: number): number {
    const fx = x - cx;
    const fy = y - cy;
    const c = fx * fx + fy * fy - r * r;
    if (c <= 0) return 0;
    const a = dx * dx + dy * dy;
    const b = fx * dx + fy * dy;
    if (b >= 0 || a === 0) return 2;
    const d = b * b - a * c;
    if (d < 0) return 2;
    const t = (-b - Math.sqrt(d)) / a;
    return t <= 1 ? t : 2;
}

/** How far along the move from (x, y) by (dx, dy) it crosses the wall; 2 if it does not. */
function crosses(x: number, y: number, dx: number, dy: number, wall: Wall): number {
    const ex = wall.bx - wall.ax;
    const ey = wall.by - wall.ay;
    const across = dx * ey - dy * ex;
    if (across === 0) return 2;
    const wx = wall.ax - x;
    const wy = wall.ay - y;
    const t = (wx * ey - wy * ex) / across;
    const u = (wx * dy - wy * dx) / across;
    return t >= 0 && t <= 1 && u >= 0 && u <= 1 ? t : 2;
}

/**
 * Moves a comet on by one step: the drag of a cloud or of the hole's grip, half the pull's effect on
 * its speed, the move, the other half with the pull where it arrived (the leapfrog way, which keeps
 * an orbit from gaining or losing energy). The move is checked along its whole length, against
 * things where they are at the end of the step, so a fast comet cannot pass through anything.
 */
export function advance(field: Field, comet: Comet): Comet {
    if (comet.ended) return comet;
    comet.through = comet.bounced = comet.boosted = undefined;
    // the drag: of every cloud it is in, and of the hole's grip, strongest at its middle
    let drag = 0;
    comet.braked = false;
    for (let i = 0; i < field.clouds.length; i++) {
        const cloud = field.clouds[i]!;
        const [fx, fy] = [comet.x - cloud.x, comet.y - cloud.y];
        if (fx * fx + fy * fy < cloud.radius * cloud.radius) {
            drag += CLOUD_DRAG;
            comet.braked = true;
        }
    }
    const hole = where(field.hole, comet.step);
    const [hx, hy] = [comet.x - hole.x, comet.y - hole.y];
    const gripped = 1 - (hx * hx + hy * hy) / (field.hole.grip * field.hole.grip);
    if (gripped > 0) drag += GRIP_DRAG * gripped * gripped;
    if (drag > 0) {
        const kept = 1 / (1 + drag * STEP);
        comet.vx *= kept;
        comet.vy *= kept;
    }
    const half = STEP / 2;
    comet.vx += comet.ax * half;
    comet.vy += comet.ay * half;
    const dx = comet.vx * STEP;
    const dy = comet.vy * STEP;
    comet.step++;
    comet.time = comet.step * STEP;
    place(field, comet.step);
    const bodies = field.bodies;
    // the first thing met along the way, if anything
    const at = bodies.length * 2;
    let first = meets(comet.x, comet.y, dx, dy, placed[at]!, placed[at + 1]!, field.hole.mouth);
    let what = first <= 1 ? 1 : 0;
    let which = -1;
    for (let i = 0; i < bodies.length; i++) {
        const t = meets(comet.x, comet.y, dx, dy, placed[i * 2]!, placed[i * 2 + 1]!, bodies[i]!.radius);
        if (t < first) [first, what, which] = [t, 2, i];
    }
    for (let i = 0; i < field.gates.length; i++) {
        const gate = field.gates[i]!;
        const t = meets(comet.x, comet.y, dx, dy, gate.x, gate.y, gate.radius);
        if (t < first) [first, what, which] = [t, 3, i];
    }
    for (let i = 0; i < field.walls.length; i++) {
        const t = crosses(comet.x, comet.y, dx, dy, field.walls[i]!);
        if (t < first) [first, what, which] = [t, 4, i];
    }
    // sparks along the part of the move that is made
    for (let i = 0; i < field.sparks.length; i++) {
        const spark = field.sparks[i]!;
        if (meets(comet.x, comet.y, dx, dy, spark.x, spark.y, SPARK) <= Math.min(1, first)) comet.sparks |= 1 << i;
    }
    if (first <= 1) {
        const [x, y] = [comet.x + dx * first, comet.y + dy * first];
        comet.x = x;
        comet.y = y;
        if (what === 1) comet.ended = "won";
        else if (what === 2) [comet.ended, comet.body] = ["struck", which];
        else if (what === 3) {
            // out of the other mouth, just beyond its edge, heading the same way at the same speed
            const out = field.gates[field.gates[which]!.to]!;
            const speed = Math.sqrt(comet.vx * comet.vx + comet.vy * comet.vy) || 1;
            comet.x = out.x + (comet.vx / speed) * (out.radius + 0.5);
            comet.y = out.y + (comet.vy / speed) * (out.radius + 0.5);
            comet.through = field.gates[which]!.to;
        } else {
            // off the wall as off a mirror, and set just off it on the side it came from
            const wall = field.walls[which]!;
            const [ex, ey] = [wall.bx - wall.ax, wall.by - wall.ay];
            const long = Math.sqrt(ex * ex + ey * ey);
            const [nx, ny] = [-ey / long, ex / long];
            const along = comet.vx * nx + comet.vy * ny;
            comet.vx -= 2 * along * nx;
            comet.vy -= 2 * along * ny;
            const side = along > 0 ? -1 : 1;
            comet.x += nx * side * 0.5;
            comet.y += ny * side * 0.5;
            comet.bounced = which;
        }
        if (comet.ended) return comet;
    } else {
        // into a ring: faster, the same way
        for (let i = 0; i < field.rings.length; i++) {
            const ring = field.rings[i]!;
            const t = meets(comet.x, comet.y, dx, dy, ring.x, ring.y, ring.radius);
            if (t > 0 && t <= 1) {
                const speed = Math.sqrt(comet.vx * comet.vx + comet.vy * comet.vy);
                const faster = Math.min(TOP, speed * BOOST) / (speed || 1);
                comet.vx *= faster;
                comet.vy *= faster;
                comet.boosted = i;
            }
        }
        comet.x += dx;
        comet.y += dy;
    }
    pulling(field, comet.x, comet.y);
    comet.ax = pulled.x;
    comet.ay = pulled.y;
    comet.vx += comet.ax * half;
    comet.vy += comet.ay * half;
    if (comet.x < 0 || comet.x > WIDE || comet.y < 0 || comet.y > HIGH) comet.ended = "out";
    else if (comet.time >= LIMIT - STEP / 2) comet.ended = "late";
    return comet;
}

/** A whole flight, to its end: how it ended, after how many steps, and the sparks picked up. */
export function fly(field: Field, vx: number, vy: number): { ended: Ending; steps: number; sparks: number } {
    const comet = launch(field, vx, vy);
    while (!comet.ended) advance(field, comet);
    return { ended: comet.ended!, steps: comet.step, sparks: comet.sparks };
}
