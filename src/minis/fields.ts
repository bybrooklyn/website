// Comet's fields: each made from a seed and a level, and never handed out until the flight itself
// has found a way to win it. comet.ts plays them; flight.ts is how a comet flies.
//
// A field is laid out with intent. The comet starts near one side and the hole is near the other,
// the sides swapping each level, so the hole just reached is near where the next field starts. One
// planet always stands across the straight way, so a shot aimed at the hole strikes it; the rest
// stand where a curve to the hole would pass: beside the way, or guarding the hole. The first field
// is that one planet alone.
//
// Then it is searched: the flight is run for a launch in every direction a degree apart at strengths
// from the weakest to full. A field is kept only if some launches win and not too many: the number
// of winning launches is how hard it is, and each level asks for fewer, so later fields need a finer
// or a longer curve. Aiming straight at the hole must never win, and the launch handed out with a
// field, from the middle of its widest way in, arrives within a few seconds.

import { record, text, whole } from "./checked";
import { CATCH, HIGH, STEP, TURNS, WEAKEST, WIDE, fly, nearest, velocity, type Field, type Planet } from "./flight";

/** A string made into a number, the same in every browser. */
export function hash(words: string): number {
    let h = 2166136261;
    for (let i = 0; i < words.length; i++) h = Math.imul(h ^ words.charCodeAt(i), 16777619);
    return h >>> 0;
}

/** Numbers from 0 to 1 that follow from a seed, the same in every browser (mulberry32). */
export function numbers(seed: number): () => number {
    let s = seed >>> 0;
    return () => {
        s = (s + 0x6d2b79f5) >>> 0;
        let t = s;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

/** The highest level there is, and the one past which fields ask no more. */
export const MOST_LEVEL = 1_000_000;
const HARDEST = 30;
/** The longest seed, as a link's is cut to. */
export const LONGEST_SEED = 40;

/** What a level asks for: how far apart the start and the hole are, how many planets, and how many winning launches a kept field may have. */
export interface Plan {
    span: number;
    planets: number;
    /** The narrowest way in a kept field may have, in degrees: narrower is too fine to find by hand. */
    narrowest: number;
    /** More winning launches than this is too easy. */
    most: number;
}

/** What a level asks for. Anything that is not a sane level, as from a damaged store, is level 1. */
export function plan(level: number, seed = ""): Plan {
    const l = Math.min(HARDEST, whole(level, 1, MOST_LEVEL, 1));
    const extra = numbers(hash(`${seed}:${level}:count`))();
    const planets = l === 1 ? 1 : l <= 4 ? 2 : l <= 12 ? 3 : extra < 0.5 ? 3 : 4;
    // the first field may be found by anyone; from there the ways in narrow, slowly, to a floor
    const most = Math.max(42, 170 - (l - 1) * 7);
    // the first fields are short; then the way to the hole grows, to most of the field's width
    const span = Math.min(1160, 760 + (l - 1) * 40);
    return { span, planets, narrowest: l <= 8 ? 3 : 2, most };
}

/** A number times itself: multiplied, not raised to a power, which a browser may round its own way. */
const square = (n: number) => n * n;

/** How far a planet must keep from the edges, the start, the hole and other planets. */
const EDGE = 40;
const START_ROOM = 110;
const HOLE_ROOM = CATCH + 50;
const APART = 80;

/** Lays out a field for a seed and level: where it starts, the hole, and its planets. Nothing is checked yet. */
export function layout(seed: string, level: number, wanted: Plan, attempt = 0): Field {
    const random = numbers(hash(`${seed}:${level}:${attempt}`));
    const between = (low: number, high: number) => low + (high - low) * random();
    const rise = between(-0.32, 0.32) * Math.min(wanted.span, HIGH - 420);
    const run = Math.sqrt(square(wanted.span) - square(rise));
    const left = (WIDE - run) / 2 + between(-0.5, 0.5) * Math.max(0, WIDE - run - 380);
    const middle = HIGH / 2 + between(-60, 60);
    let start = { x: left, y: middle - rise / 2 };
    let hole = { x: left + run, y: middle + rise / 2 };
    // the sides swap each level: the hole just reached is near where the next field starts
    if (level % 2 === 0) [start, hole] = [{ x: WIDE - start.x, y: start.y }, { x: WIDE - hole.x, y: hole.y }];
    const long = Math.sqrt(square(hole.x - start.x) + square(hole.y - start.y));
    const [ux, uy] = [(hole.x - start.x) / long, (hole.y - start.y) / long];
    const [nx, ny] = [-uy, ux];
    /** A place `along` the way from the start to the hole, as a part of it, and `across` to one side. */
    const on = (along: number, across: number) => ({ x: start.x + ux * along * long + nx * across, y: start.y + uy * along * long + ny * across });

    const planets: Planet[] = [];
    const fits = (p: Planet) =>
        p.x > p.r + EDGE &&
        p.x < WIDE - p.r - EDGE &&
        p.y > p.r + EDGE &&
        p.y < HIGH - p.r - EDGE &&
        square(p.x - start.x) + square(p.y - start.y) > square(p.r + START_ROOM) &&
        square(p.x - hole.x) + square(p.y - hole.y) > square(p.r + HOLE_ROOM) &&
        planets.every((other) => square(p.x - other.x) + square(p.y - other.y) > square(p.r + other.r + APART));
    const put = (make: () => Planet) => {
        for (let tries = 0; tries < 30; tries++) {
            const planet = make();
            if (fits(planet)) return void planets.push(planet);
        }
    };

    // the one across the straight way, which a shot aimed at the hole strikes
    const big = level === 1 ? between(72, 88) : between(48, 82);
    put(() => ({ ...on(between(0.38, 0.62), between(-0.3, 0.3) * big), r: big }));
    // the rest where a curve to the hole would pass: beside the way, or guarding the hole
    for (let i = 1; i < wanted.planets; i++) {
        const r = between(28, 70);
        const side = random() < 0.5 ? -1 : 1;
        if (random() < 0.4) put(() => ({ ...on(1 - between(140, 240) / long, side * between(60, 170)), r }));
        else put(() => ({ ...on(between(0.2, 0.85), side * between(170, 330)), r }));
    }
    return { seed, level, start, hole, planets };
}

/** A launch that wins, and how much room there is round it. */
export interface Solution {
    /** A direction from `AIMS` and a strength from the weakest to 1. */
    aim: number;
    power: number;
    /** How many degrees of directions side by side win at that strength, this one among them. */
    window: number;
    /** Steps the winning flight takes. */
    steps: number;
}

/** What a search of a field found. */
export interface Searched {
    /** How many of the launches tried won. */
    wins: number;
    /** The launch from the middle of the widest way in, if any won. */
    solution?: Solution;
    /** Aiming straight at the hole won, at one of the strengths tried. */
    straight: boolean;
}

/** The strengths the search tries, from the weakest to full; and its directions, a degree apart. */
export const POWERS = Array.from({ length: 21 }, (_, i) => WEAKEST + ((1 - WEAKEST) * i) / 20);
const EVERY = 2;
/** A winning flight handed out with a field arrives within this many steps. */
const PROMPT = Math.round(5 / STEP);
/** How many flights the search runs between pauses. */
const PIECE = 24;

/**
 * Searches a field for launches that win, pausing every few flights so that a page can spread the
 * work over frames. Gives how many won, whether aiming straight at the hole did, and the launch at the
 * middle of the widest run of winning directions at any one strength.
 */
export function* solving(field: Field): Generator<undefined, Searched> {
    const toward = nearest(field.hole.x - field.start.x, field.hole.y - field.start.y);
    let flown = 0;
    let wins = 0;
    let straight = false;
    let solution: Solution | undefined;
    for (const power of POWERS) {
        // the directions in a row of one strength, starting straight at the hole
        const won: number[] = [];
        for (let off = 0; off < TURNS; off += EVERY) {
            if (++flown % PIECE === 0) yield;
            const flight = fly(field, ...velocity(toward + off, power));
            if (flight.ended !== "won") continue;
            wins++;
            if (off === 0) straight = true;
            won.push(off);
        }
        // runs of winning directions side by side, going round past the start of the row
        const runs: number[][] = [];
        for (const off of won) {
            const last = runs[runs.length - 1];
            if (last && off - last[last.length - 1]! === EVERY) last.push(off);
            else runs.push([off]);
        }
        if (runs.length > 1 && runs[0]![0] === 0 && won[won.length - 1] === TURNS - EVERY) runs[0] = [...runs.pop()!.map((off) => off - TURNS), ...runs[0]!];
        for (const run of runs) {
            const window = (run.length * EVERY * 360) / TURNS;
            if (solution && window <= solution.window) continue;
            const aim = (((toward + run[Math.floor(run.length / 2)]!) % TURNS) + TURNS) % TURNS;
            const steps = fly(field, ...velocity(aim, power)).steps;
            if (steps <= PROMPT) solution = { aim, power, window, steps };
        }
    }
    return { wins, solution, straight };
}

/** A field ready to play, with a launch that proves it can be won. */
export interface Made {
    field: Field;
    solution: Solution;
    /** How many winning launches the search found: the fewer, the harder. */
    wins: number;
    /** How many layouts were searched before this one was kept. */
    tries: number;
}

/** How many layouts a level tries before it takes the nearest it found. */
const TRIES = 10;
/** Past this many layouts with no launch that wins, the field is the hole alone. It has not happened. */
const GIVE_UP = 60;

/** Runs the making of a field to its end at once. */
function finish<T>(work: Generator<undefined, T>): T {
    for (;;) {
        const next = work.next();
        if (next.done) return next.value;
    }
}

/** The field for a seed and a level: always the same one, and always one that can be won. */
export const make = (seed: string, level: number): Made => finish(making(seed, level));

/**
 * `make`, in pieces: it pauses often, so that a page can make the next field between frames. Layouts
 * are tried until one has as many winning launches as its level asks; if none of the first few does,
 * the one nearest to it is taken, so long as aiming straight at the hole does not win it.
 */
export function* making(seed: string, level: number): Generator<undefined, Made> {
    const l = whole(level, 1, MOST_LEVEL, 1);
    const wanted = plan(l, seed);
    let nearestYet: { made: Made; miss: number } | undefined;
    for (let attempt = 0; ; attempt++) {
        // a seed that keeps giving fields no launch wins gets fewer planets, down to the hole alone, which a straight shot wins
        if (attempt >= GIVE_UP) {
            const field = { ...layout(seed, l, wanted, attempt), planets: [] };
            const aim = nearest(field.hole.x - field.start.x, field.hole.y - field.start.y);
            return { field, solution: { aim, power: 0.5, window: 0, steps: fly(field, ...velocity(aim, 0.5)).steps }, wins: 0, tries: attempt + 1 };
        }
        const field = layout(seed, l, attempt < TRIES * 3 ? wanted : { ...wanted, planets: 1 }, attempt);
        const found = yield* solving(field);
        if (!found.solution || found.straight || found.solution.window < wanted.narrowest) continue;
        const made = { field, solution: found.solution, wins: found.wins, tries: attempt + 1 };
        if (found.wins <= wanted.most) return made;
        const miss = found.wins - wanted.most;
        if (!nearestYet || miss < nearestYet.miss) nearestYet = { made, miss };
        if (attempt + 1 >= TRIES && nearestYet) return nearestYet.made;
    }
}

/** Where a visitor left off: the seed and the field. */
export interface Place {
    seed: string;
    level: number;
}

/** A place kept from an earlier visit, read back as a short seed and a sane level; undefined if it has no usable seed. */
export function kept(value: unknown): Place | undefined {
    const place = record(value);
    const seed = text(place?.seed, LONGEST_SEED, "").trim();
    if (!place || !seed) return undefined;
    return { seed, level: whole(place.level, 1, MOST_LEVEL, 1) };
}
