// Comet's flight, without its picture: a field of planets and one hole, and how a comet flies
// through it once let go. comet.ts draws it and plays it; fields.ts makes the fields and proves each
// can be won.
//
// A flight is the same on every machine for the same field and launch. It moves in fixed steps of
// 1/120 of a second, and is worked out with adding, multiplying, dividing and square roots only,
// which every browser does alike: sines and cosines may differ in their last digit, and a field kept
// or thrown away by the generator must not depend on the browser that made it. Directions come from
// `AIMS`, a table made by turning one step at a time.
//
// The rules: every planet pulls by its size over the distance squared, fading to nothing a few radii
// out, so a planet bends what passes near it and leaves the far side of the field alone. The hole
// pulls a little, close in. A comet whose middle comes inside the hole's ring has arrived; one that
// touches a planet, leaves the field or is still flying after `LIMIT` seconds has missed.

/** The field, in its own units: wider than high, and turned on its side on a tall screen. */
export const WIDE = 1600;
export const HIGH = 1000;
/** One step of the flight, in seconds. */
export const STEP = 1 / 120;
/** A flight still going after this many seconds has missed. */
export const LIMIT = 12;
/** The step a flight is late at. */
const LAST = Math.round(LIMIT / STEP);
/** How fast a comet sets off at full strength, in units a second. */
export const FASTEST = 520;
/** The weakest launch there is, as a part of full strength. */
export const WEAKEST = 0.18;
/** How far past the field's edge a comet may go before it has left. */
export const MARGIN = 50;
/** The hole's ring: a comet whose middle comes inside it has arrived. */
export const CATCH = 48;
/** How a planet pulls: its mass for each square unit of its radius, and how far out the pull is felt, in radii. */
export const PULL = 1970;
export const REACH = 6;
/** How the hole pulls: its mass, and how far out its pull is felt. */
export const HOLE_MASS = 1.87e6;
export const HOLE_REACH = 160;
/** How many directions the table holds: half a degree apart. */
export const TURNS = 720;

/** A planet: a circle that pulls, and a miss to touch. */
export interface Planet {
    x: number;
    y: number;
    r: number;
}

/** A field: where the comet starts, the hole, and the planets between. */
export interface Field {
    seed: string;
    level: number;
    start: { x: number; y: number };
    hole: { x: number; y: number };
    planets: Planet[];
}

/** How a flight ended. */
export type Ending = "won" | "struck" | "out" | "late";

/** A comet on its way. */
export interface Comet {
    x: number;
    y: number;
    vx: number;
    vy: number;
    /** The pull on it now, kept from one step to the next. */
    ax: number;
    ay: number;
    /** Steps since it was let go. */
    step: number;
    ended?: Ending;
}

/**
 * Directions half a degree apart, turning from the right toward +y. Made by turning (1, 0) by half a
 * degree again and again, with the turn written out as numbers, so the table is the same in every browser.
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

/** A direction of the table, by any whole number: past the end it comes round again. */
export const aimed = (aim: number): readonly [number, number] => AIMS[((aim % TURNS) + TURNS) % TURNS]!;

/** The velocity of a launch: a direction from `AIMS` and a strength from the weakest to 1. */
export function velocity(aim: number, power: number): [number, number] {
    const [x, y] = aimed(aim);
    const speed = Math.min(1, Math.max(WEAKEST, power)) * FASTEST;
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

/**
 * How strongly something of `mass` pulls at a distance whose square is `near`: mass over distance
 * squared, softened by `soft` at its middle, and brought smoothly down to nothing at `reach`. Gives
 * the pull divided by the distance, to be multiplied by the offset.
 */
export function strength(mass: number, reach: number, soft: number, near: number): number {
    const reached = reach * reach;
    if (near >= reached) return 0;
    const fade = 1 - near / reached;
    const softened = near + soft * soft;
    return (mass * fade * fade) / (softened * Math.sqrt(softened));
}

/** The pull on a comet at (x, y), from every planet and the hole, written into `into`. */
export function pull(field: Field, x: number, y: number, into: { ax: number; ay: number }): void {
    let dx = field.hole.x - x;
    let dy = field.hole.y - y;
    let by = strength(HOLE_MASS, HOLE_REACH, CATCH * 0.5, dx * dx + dy * dy);
    let ax = dx * by;
    let ay = dy * by;
    const planets = field.planets;
    for (let i = 0; i < planets.length; i++) {
        const planet = planets[i]!;
        dx = planet.x - x;
        dy = planet.y - y;
        by = strength(PULL * planet.r * planet.r, REACH * planet.r, planet.r * 0.5, dx * dx + dy * dy);
        ax += dx * by;
        ay += dy * by;
    }
    into.ax = ax;
    into.ay = ay;
}

/** A comet at the start, let go with this velocity. */
export function launch(field: Field, vx: number, vy: number): Comet {
    const comet: Comet = { x: field.start.x, y: field.start.y, vx, vy, ax: 0, ay: 0, step: 0 };
    pull(field, comet.x, comet.y, comet);
    return comet;
}

/** How far along the move from (x, y) by (dx, dy), from 0 to 1, it first comes within `r` of (cx, cy); 2 if it does not. */
export function meets(x: number, y: number, dx: number, dy: number, cx: number, cy: number, r: number): number {
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
 * Moves a comet on by one step, the leapfrog way: half the pull's effect on its speed, the move, then
 * the other half with the pull where it arrived, which keeps a pass round a planet from gaining or
 * losing speed. The move is checked along its whole length, so a fast comet passes through nothing.
 */
export function advance(field: Field, comet: Comet): Comet {
    if (comet.ended) return comet;
    const half = STEP / 2;
    comet.vx += comet.ax * half;
    comet.vy += comet.ay * half;
    const dx = comet.vx * STEP;
    const dy = comet.vy * STEP;
    comet.step++;
    let first = meets(comet.x, comet.y, dx, dy, field.hole.x, field.hole.y, CATCH);
    let ending: Ending | undefined = first <= 1 ? "won" : undefined;
    for (const planet of field.planets) {
        const t = meets(comet.x, comet.y, dx, dy, planet.x, planet.y, planet.r);
        if (t < first) [first, ending] = [t, "struck"];
    }
    if (ending) {
        comet.x += dx * first;
        comet.y += dy * first;
        comet.ended = ending;
        return comet;
    }
    comet.x += dx;
    comet.y += dy;
    pull(field, comet.x, comet.y, comet);
    comet.vx += comet.ax * half;
    comet.vy += comet.ay * half;
    if (comet.x < -MARGIN || comet.x > WIDE + MARGIN || comet.y < -MARGIN || comet.y > HIGH + MARGIN) comet.ended = "out";
    else if (comet.step >= LAST) comet.ended = "late";
    return comet;
}

/** A whole flight, to its end: how it ended and after how many steps. */
export function fly(field: Field, vx: number, vy: number): { ended: Ending; steps: number } {
    const comet = launch(field, vx, vy);
    while (!comet.ended) advance(field, comet);
    return { ended: comet.ended!, steps: comet.step };
}
