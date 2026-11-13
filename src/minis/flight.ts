// The comet's flight, without its picture: the field it flies through, the pull of everything on it,
// and how a flight ends. comet.ts draws it; fields.ts makes the fields and finds a way through each.
//
// A flight is the same on every machine for the same field and the same launch. It moves in fixed
// steps of 1/120 of a second whatever the screen does, and it is worked out with nothing but adding,
// multiplying, dividing and square roots, which every browser rounds alike. Sines, cosines and
// powers are left out on purpose: browsers may differ in their last digit, and a field kept or thrown
// away by the generator must not depend on which browser made it. Directions are taken from `AIMS`,
// a table built by turning one step at a time.
//
// The rules a flight keeps:
//   a star pulls and a pusher pushes, each by its mass over the square of the distance;
//   the black hole pulls hardest, and a comet that comes within its reach is swallowed: the field is won;
//   a comet that touches a star or a pusher, leaves the field, or is still flying after `LIMIT`
//   seconds has missed;
//   a comet that enters a wormhole's mouth comes out of the other mouth of the pair at once, at the
//   same speed and heading, just outside it on the side it is heading for. Wormholes do not pull.

/** The field, in its own units: a comet at full strength crosses it in about a second and a half. */
export const WIDE = 1000;
export const HIGH = 640;
/** One step of the flight, in seconds. */
export const STEP = 1 / 120;
/** A flight that has not ended after this many seconds is a miss. */
export const LIMIT = 12;
/** How fast a comet sets off at full strength, in units a second, and the least strength there is. */
export const FASTEST = 720;
export const WEAKEST = 0.15;
/** Strength comes in steps of this much, for the keyboard and the solver; a drag may give any strength between. */
export const NOTCH = 0.025;
/** How many directions the keyboard and the solver aim in: half a degree apart. */
export const TURNS = 720;

export interface Star {
    x: number;
    y: number;
    radius: number;
    /** Above 0 it pulls; below 0 it pushes. */
    mass: number;
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
    x: number;
    y: number;
    /** The dark disc that is drawn. */
    radius: number;
    /** A comet whose middle comes this near is swallowed. */
    reach: number;
    mass: number;
}

export interface Field {
    seed: string;
    level: number;
    start: { x: number; y: number };
    hole: Hole;
    stars: Star[];
    gates: Gate[];
}

export type Ending = "won" | "out" | "struck" | "late";

/** A comet on its way. */
export interface Comet {
    x: number;
    y: number;
    vx: number;
    vy: number;
    /** Seconds since it was launched. */
    time: number;
    /** The pull on it now, kept from one step to the next. */
    ax: number;
    ay: number;
    ended?: Ending;
    /** For a comet that struck something, which star; for one that went through a wormhole this step, which gate it came out of. */
    star?: number;
    through?: number;
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

/** The pull on a comet at (x, y): stars pull, pushers push, the hole pulls hardest. Each is softened near its middle, where a comet never is anyway. */
export function pull(field: Field, x: number, y: number): [number, number] {
    pulling(field, x, y);
    return [pulled.x, pulled.y];
}

/** Where `pulling` leaves its answer: no new array on every step of every flight the solver tries. */
const pulled = { x: 0, y: 0 };
function pulling(field: Field, x: number, y: number): void {
    const hole = field.hole;
    let dx = hole.x - x;
    let dy = hole.y - y;
    let near = dx * dx + dy * dy + hole.reach * hole.reach * 0.25;
    let by = hole.mass / (near * Math.sqrt(near));
    let ax = dx * by;
    let ay = dy * by;
    // a plain loop, not a call for each star: the solver flies thousands of these
    const stars = field.stars;
    for (let i = 0; i < stars.length; i++) {
        const star = stars[i]!;
        dx = star.x - x;
        dy = star.y - y;
        near = dx * dx + dy * dy + star.radius * star.radius * 0.25;
        by = star.mass / (near * Math.sqrt(near));
        ax += dx * by;
        ay += dy * by;
    }
    pulled.x = ax;
    pulled.y = ay;
}

/** A comet at the start, sent off with this velocity. */
export function launch(field: Field, vx: number, vy: number): Comet {
    const [ax, ay] = pull(field, field.start.x, field.start.y);
    return { x: field.start.x, y: field.start.y, vx, vy, time: 0, ax, ay };
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

/**
 * Moves a comet on by one step: half the pull's effect on its speed, the move, the other half with
 * the pull where it arrived (the leapfrog way, which keeps an orbit from gaining or losing energy).
 * The move is checked along its whole length, so a fast comet cannot pass through anything.
 */
export function advance(field: Field, comet: Comet): Comet {
    if (comet.ended) return comet;
    comet.through = undefined;
    const half = STEP / 2;
    comet.vx += comet.ax * half;
    comet.vy += comet.ay * half;
    const dx = comet.vx * STEP;
    const dy = comet.vy * STEP;
    // the first thing met along the way, if anything
    let first = meets(comet.x, comet.y, dx, dy, field.hole.x, field.hole.y, field.hole.reach);
    let what = first <= 1 ? "hole" : "";
    let which = -1;
    for (let i = 0; i < field.stars.length; i++) {
        const star = field.stars[i]!;
        const t = meets(comet.x, comet.y, dx, dy, star.x, star.y, star.radius);
        if (t < first) [first, what, which] = [t, "star", i];
    }
    for (let i = 0; i < field.gates.length; i++) {
        const gate = field.gates[i]!;
        const t = meets(comet.x, comet.y, dx, dy, gate.x, gate.y, gate.radius);
        if (t < first) [first, what, which] = [t, "gate", i];
    }
    comet.time += STEP;
    if (first <= 1) {
        comet.x += dx * first;
        comet.y += dy * first;
        if (what === "hole") comet.ended = "won";
        if (what === "star") [comet.ended, comet.star] = ["struck", which];
        if (what === "gate") {
            // out of the other mouth, just beyond its edge, heading the same way at the same speed
            const out = field.gates[field.gates[which]!.to]!;
            const speed = Math.sqrt(comet.vx * comet.vx + comet.vy * comet.vy) || 1;
            comet.x = out.x + (comet.vx / speed) * (out.radius + 0.5);
            comet.y = out.y + (comet.vy / speed) * (out.radius + 0.5);
            comet.through = field.gates[which]!.to;
        }
        if (comet.ended) return comet;
    } else {
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

/** A whole flight, to its end: how it ended and after how many steps. */
export function fly(field: Field, vx: number, vy: number): { ended: Ending; steps: number } {
    const comet = launch(field, vx, vy);
    let steps = 0;
    while (!comet.ended) {
        advance(field, comet);
        steps++;
    }
    return { ended: comet.ended!, steps };
}
