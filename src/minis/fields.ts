// The comet's fields: each made from a seed and a level, and never handed out until a way through it
// has been found. comet.ts plays them; flight.ts is how a comet flies through one.
//
// A field is made, then searched: launches are tried over a fan of directions around the hole and
// a range of strengths, and around each that wins, the directions beside it are tried half a degree
// at a time to see how wide the way in is. A field is kept only if some launch wins, the directions
// either side of it win for a span the level allows (wide enough to be found by hand, narrow enough
// not to be given away), the same direction still wins a notch weaker and a notch stronger, and
// aiming straight at the hole does not win at any strength tried.
// If none of a level's tries passes all of that, the nearest of them that some launch wins is handed
// out instead (its way in too wide or a little narrow, or, last of all, won by a straight shot, which
// the tests find in fewer than one field in twenty). Only if no try at all could be won is the field
// made again with fewer things in it, down to the hole alone, which a straight shot always reaches;
// so every field handed out can be won with one shot, and `solution` says how.
//
// A level asks for more: more stars, then pushers, then wormholes, a smaller reach for the hole,
// stars placed across the straight way in, and a narrower span of winning directions.

import { record, text, whole } from "./checked";
import { HIGH, TURNS, WIDE, advance, fly, launch, nearest, velocity, type Field, type Gate, type Star } from "./flight";

/** A launch that wins, and how much room there is around it. */
export interface Solution {
    /** A direction from `AIMS` and a strength in notches. */
    aim: number;
    notches: number;
    /** How many degrees of directions either side, together, also win at that strength. */
    window: number;
    /** Steps the winning flight takes. */
    steps: number;
}

/** What a level puts in a field. */
export interface Plan {
    pullers: number;
    pushers: number;
    /** Pairs of wormholes. */
    pairs: number;
    /** Stars placed across the straight way from the start to the hole. */
    guards: number;
    /** How near the hole's middle a comet must come. */
    reach: number;
    /** The span of winning directions a kept field must have, in degrees: at least `narrowest`, at most `widest`. */
    narrowest: number;
    widest: number;
}

/** No field is kept whose way in is narrower than this, in degrees: three presses of an arrow key. */
export const NARROWEST = 1.5;

/** What each level asks for. It stops growing at level 12. */
export function plan(level: number): Plan {
    // anything that is not a number, as from a damaged store, is level 1: a plan of NaNs could never be met
    const l = whole(level, 1, 12, 1);
    return {
        pullers: Math.min(6, 1 + Math.floor(l / 2)),
        pushers: l < 3 ? 0 : Math.min(4, Math.floor((l - 1) / 2)),
        pairs: l < 4 ? 0 : l < 8 ? 1 : 2,
        guards: l < 6 ? 1 : 2,
        reach: Math.max(17, 28 - l),
        narrowest: Math.max(NARROWEST, 5 - 0.4 * (l - 1)),
        widest: Math.max(6, 32 - 3 * (l - 1)),
    };
}

/** A string made into a number, the same in every browser. */
export function hash(text: string): number {
    let h = 2166136261;
    for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619);
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

/** How strongly a star of a given size pulls (or a pusher pushes): its mass for each cubed unit of radius. */
const DENSE = 380;
const HOLE_MASS = 2.4e7;
/** A number times itself: multiplied, not raised to a power, which a browser may round in its own way (see flight.ts). */
const square = (n: number) => n * n;

/** Lays out a field to a plan. Nothing in it is checked yet. */
export function layout(seed: string, level: number, wanted: Plan, attempt = 0): Field {
    const random = numbers(hash(`${seed}:${level}:${attempt}`));
    const between = (low: number, high: number) => low + (high - low) * random();
    // the start near one side and the hole well across from it; which side is chosen too
    let start = { x: between(70, 150), y: between(90, HIGH - 90) };
    let hole = { x: between(720, 920), y: between(90, HIGH - 90) };
    while (square(hole.x - start.x) + square(hole.y - start.y) < 600 * 600) hole = { x: between(720, 920), y: between(90, HIGH - 90) };
    if (random() < 0.5) [start, hole] = [{ x: WIDE - start.x, y: start.y }, { x: WIDE - hole.x, y: hole.y }];
    const stars: Star[] = [];
    const gates: Gate[] = [];
    /** Whether a round thing of radius r at (x, y) leaves room around the start, the hole, the edges and what is already placed. */
    const free = (x: number, y: number, r: number) =>
        x > r + 30 && x < WIDE - r - 30 && y > r + 30 && y < HIGH - r - 30 &&
        square(x - start.x) + square(y - start.y) > square(r + 75) &&
        square(x - hole.x) + square(y - hole.y) > square(r + wanted.reach + 70) &&
        [...stars, ...gates].every((other) => square(x - other.x) + square(y - other.y) > square(r + other.radius + 45));
    const place = (r: number, near?: () => [number, number]): [number, number] | undefined => {
        for (let tries = 0; tries < 60; tries++) {
            const [x, y] = near ? near() : [between(r + 30, WIDE - r - 30), between(r + 30, HIGH - r - 30)];
            if (free(x, y, r)) return [x, y];
        }
        return undefined;
    };
    const [sx, sy, long] = [hole.x - start.x, hole.y - start.y, Math.sqrt(square(hole.x - start.x) + square(hole.y - start.y))];
    for (let i = 0; i < wanted.pullers + wanted.pushers; i++) {
        const pushes = i >= wanted.pullers;
        const r = pushes ? between(15, 22) : between(17, 30);
        // the first stars stand across the straight way in, a little to one side or the other
        const guard = !pushes && i < wanted.guards;
        const at = place(r, guard ? () => {
            const t = between(0.35, 0.72);
            const side = between(-22, 22);
            return [start.x + sx * t - (sy / long) * side, start.y + sy * t + (sx / long) * side];
        } : undefined);
        if (at) stars.push({ x: at[0], y: at[1], radius: r, mass: (pushes ? -1.1 : 1) * DENSE * r * r * r });
    }
    for (let pair = 0; pair < wanted.pairs; pair++) {
        const a = place(19);
        if (!a) break;
        gates.push({ x: a[0], y: a[1], radius: 19, to: gates.length + 1, pair });
        const b = place(19, () => {
            const [x, y] = [between(50, WIDE - 50), between(50, HIGH - 50)];
            return square(x - a[0]) + square(y - a[1]) > 320 * 320 ? [x, y] : [-1000, -1000];
        });
        if (!b) {
            gates.pop();
            break;
        }
        gates.push({ x: b[0], y: b[1], radius: 19, to: gates.length - 1, pair });
    }
    return { seed, level, start, hole: { ...hole, radius: wanted.reach * 0.72, reach: wanted.reach, mass: HOLE_MASS }, stars, gates };
}

/** Directions tried either side of the hole's, and how far apart (in steps of half a degree); strengths tried, in notches. */
const FAN = 200;
const SPREAD = 4;
const STRENGTHS = [8, 12, 16, 20, 24, 28, 32, 36, 40];
/** How far the span around a win is followed each way, in half degrees: past this a way in counts as wide enough anyway. */
const FOLLOW = 70;

/** What a search of a field found. */
export interface Searched {
    solution?: Solution;
    wins: number;
    /** Aiming straight at the hole won, at one of the strengths tried. */
    straight: boolean;
    tried: number;
}

/** Runs the making of a field to its end at once. */
function finish<T>(work: Generator<undefined, T>): T {
    for (;;) {
        const next = work.next();
        if (next.done) return next.value;
    }
}

/**
 * Searches a field for launches that win, a row of strength at a time, pausing after each so that a
 * page can spread the work over frames. Gives the one with the widest span of winning directions
 * around it (the middle of that span), or undefined if none was found; and how many of the launches
 * tried won.
 */
export function* solving(field: Field): Generator<undefined, Searched> {
    const toward = nearest(field.hole.x - field.start.x, field.hole.y - field.start.y);
    const wins = (aim: number, notches: number) => {
        const [vx, vy] = velocity(aim, notches);
        const flight = fly(field, vx, vy);
        return flight.ended === "won" ? flight.steps : 0;
    };
    let [won, tried, straight] = [0, 0, false];
    let best: Solution | undefined;
    for (const notches of STRENGTHS) {
        // in one row of strength, a run of coarse wins is one way in: it is measured once
        let covered = -Infinity;
        for (let off = -FAN; off <= FAN; off += SPREAD) {
            const aim = toward + off;
            tried++;
            if (!wins(aim, notches)) continue;
            if (off === 0) straight = true;
            won++;
            if (aim <= covered) continue;
            let [low, high] = [0, 0];
            while (low < FOLLOW && wins(aim - low - 1, notches)) low++;
            while (high < FOLLOW && wins(aim + high + 1, notches)) high++;
            covered = aim + high;
            const window = (low + high + 1) * (360 / TURNS);
            const middle = aim + Math.floor((high - low) / 2);
            // it must still win a notch either side, so that strength need not be exact either
            if (!wins(middle, notches - 1) || !wins(middle, notches + 1)) continue;
            const steps = wins(middle, notches);
            if (!steps) continue;
            // the widest way in: a field is only as hard as its easiest way through
            if (!best || window > best.window) best = { aim: ((middle % TURNS) + TURNS) % TURNS, notches, window, steps };
        }
        yield;
    }
    return { solution: best, wins: won, tried, straight };
}

/** A field ready to play, with the launch that proves it can be won. */
export interface Made {
    field: Field;
    solution: Solution;
    /** How many fields were laid out before this one was kept. */
    tries: number;
}

/** How many layouts a level tries before it asks for fewer things in the field. */
const TRIES = 10;

/** The field for a seed and a level: always the same one, and always one that can be won. */
export const make = (seed: string, level: number): Made => finish(making(seed, level));

/** `make`, in pieces: it pauses often, so that a page can make the next field between frames. */
export function* making(seed: string, level: number): Generator<undefined, Made> {
    const asked = plan(level);
    let tries = 0;
    let fallback: { made: Made; miss: number } | undefined;
    // fewer and fewer things in the field, down to the hole alone, until a field passes
    for (let fewer = 0; ; fewer++) {
        const wanted: Plan = fewer === 0 ? asked : {
            ...asked,
            pullers: Math.max(0, asked.pullers - fewer),
            pushers: Math.max(0, asked.pushers - fewer),
            pairs: Math.max(0, asked.pairs - fewer),
            guards: Math.max(0, asked.guards - fewer),
            narrowest: NARROWEST,
            widest: Infinity,
        };
        const empty = wanted.pullers + wanted.pushers + wanted.pairs === 0;
        for (let attempt = 0; attempt < (empty ? 50 : TRIES); attempt++) {
            tries++;
            const field = layout(seed, level, wanted, fewer * 100 + attempt);
            const { solution, straight } = yield* solving(field);
            if (!solution || solution.window < NARROWEST) continue;
            const made = { field, solution, tries };
            if (solution.window >= wanted.narrowest && solution.window <= wanted.widest && (!straight || fewer > 0)) return made;
            // too wide, a little too narrow, or won by a straight shot: kept in case nothing better comes, the nearest to the level first
            const miss = (straight ? 1000 : 0) + Math.abs(solution.window - asked.widest);
            if (fewer === 0 && (!fallback || miss < fallback.miss)) fallback = { made, miss };
        }
        if (fallback) return { ...fallback.made, tries };
        // by now every level has come down to the hole alone; the bound holds whatever was asked for
        if (fewer > 20) throw new Error(`No field could be made for ${seed} at level ${level}.`);
    }
}

/** How many stars and pushers the winning flight passes close to: within three of their radii. */
export function passes(field: Field, solution: Solution): number {
    const comet = launch(field, ...velocity(solution.aim, solution.notches));
    const near = new Set<number>();
    while (!comet.ended) {
        advance(field, comet);
        field.stars.forEach((star, at) => {
            if ((comet.x - star.x) ** 2 + (comet.y - star.y) ** 2 < (star.radius * 3) ** 2) near.add(at);
        });
    }
    return near.size;
}

// ---- the score ----

/** A run through the fields of one seed. */
export interface Run {
    seed: string;
    level: number;
    /** Launches on this field so far. */
    shots: number;
    /** Launches on every field of this run. */
    total: number;
    /** Fields won in this run. */
    won: number;
}

/** The fewest shots each field of each seed has been won in: seed, then level. */
export type Bests = Record<string, Record<string, number>>;

/** The furthest field a run is counted to, and the most shots: far past any played, and still exact whole numbers. */
export const MOST_LEVEL = 1_000_000;
const MOST_SHOTS = 1_000_000_000;
/** The longest seed, as a link's is cut to. */
export const LONGEST_SEED = 40;

export const begin = (seed: string, level = 1): Run => ({ seed, level: whole(level, 1, MOST_LEVEL, 1), shots: 0, total: 0, won: 0 });

/** A run kept from an earlier visit, read back as sane whole numbers; undefined if it has no usable seed. */
export function keptRun(value: unknown): Run | undefined {
    const kept = record(value);
    const seed = text(kept?.seed, LONGEST_SEED, "");
    if (!kept || !seed) return undefined;
    const shots = whole(kept.shots, 0, MOST_SHOTS, 0);
    return { seed, level: whole(kept.level, 1, MOST_LEVEL, 1), shots, total: Math.max(shots, whole(kept.total, 0, MOST_SHOTS, 0)), won: whole(kept.won, 0, MOST_LEVEL, 0) };
}

/** Kept bests read back: whole numbers of shots, for short seeds and whole levels; anything else is left out. */
export function keptBests(value: unknown): Bests {
    const bests: Bests = {};
    for (const [seed, levels] of Object.entries(record(value) ?? {})) {
        if (!seed || seed.length > LONGEST_SEED) continue;
        for (const [level, shots] of Object.entries(record(levels) ?? {})) {
            if (!/^\d{1,7}$/.test(level) || typeof shots !== "number" || !Number.isFinite(shots)) continue;
            (bests[seed] ??= {})[level] = whole(shots, 0, MOST_SHOTS, 0);
        }
    }
    return bests;
}

/** Every launch is a shot, whether it wins or not. */
export const shoot = (run: Run): Run => ({ ...run, shots: run.shots + 1, total: run.total + 1 });

/** The field is won: its shots are kept if they are the fewest yet, and the run goes on to the next level. */
export function win(run: Run, bests: Bests): { run: Run; bests: Bests; best: boolean } {
    const before = bests[run.seed]?.[run.level];
    const best = before === undefined || run.shots < before;
    const kept = best ? { ...bests, [run.seed]: { ...bests[run.seed], [run.level]: run.shots } } : bests;
    return { run: { ...run, level: run.level + 1, shots: 0, won: run.won + 1 }, bests: kept, best };
}

/** The fewest shots this field has been won in, if it has been. */
export const bestFor = (bests: Bests, seed: string, level: number): number | undefined => bests[seed]?.[level];
