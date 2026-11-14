// The comet's fields: each made from a seed and a level round one idea, and never handed out until
// a way through it has been found. comet.ts plays them; flight.ts is how a comet flies through one.
//
// Each level has an idea (go round a big star, sling round a giant, a row of pushers, a cloud in
// the way, a ring, a wall to bank off, a wormhole into a walled hole, a planet going round, rocks
// drifting across a gap, a moon, a relay of stars, a hole that wanders). The first twelve levels
// bring in one new kind of thing each, in that order; past twelve, the ideas come round again in an
// order that follows from the seed, never the same idea twice running, with more around them. The
// idea is laid out first, then a few lesser things of kinds already met, away from it.
//
// A field is made, then searched: launches are tried over a wide fan of directions around the hole
// and a range of strengths, and around each that wins, the directions beside it are tried half a
// degree at a time to see how wide the way in is. A field is kept only if some launch wins, the
// directions either side of it win for a span the level allows (wide enough to be found by hand,
// narrow enough not to be given away), the same direction still wins a notch weaker and a notch
// stronger, and aiming straight at the hole does not win at any strength tried. If none of a level's
// tries passes all of that, the nearest of them that some launch wins is handed out instead. Only if
// no try at all could be won is the field made again with less in it, down to the hole alone, which
// a straight shot always reaches; so every field handed out can be won with one shot, and `solution`
// says how. Things that move are part of the search: the flight's clock starts at the launch, so a
// launch that wins always wins.
//
// Sparks to pick up are laid along a second, harder way in when there is one: picking them all up is
// a choice, never needed.

import { record, text, whole } from "./checked";
import { AIMS, HIGH, TURNS, WIDE, advance, fly, launch, nearest, velocity, where, type Body, type Field, type Gate, type Path, type Round, type Spark, type Wall } from "./flight";

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

/** What a field can be made round, in the order the first twelve levels bring them. */
export const IDEAS = ["bend", "slingshot", "push", "cloud", "ring", "bounce", "wormhole", "orbit", "gap", "moon", "relay", "wander"] as const;
export type Idea = (typeof IDEAS)[number];

/** The kinds of thing there are, each with one rule, in the order they are met. */
export const KINDS = ["star", "spark", "pusher", "cloud", "ring", "wall", "wormhole", "planet", "rock", "moon", "wandering hole"] as const;
export type Kind = (typeof KINDS)[number];
/** The new kind each of the first twelve levels brings in; the eleventh brings none. */
const BRINGS: (Kind | undefined)[] = ["star", "spark", "pusher", "cloud", "ring", "wall", "wormhole", "planet", "rock", "moon", undefined, "wandering hole"];

/** What kind of thing a body is, by what it does and how it moves. */
export function kindOf(body: Body): Kind {
    if (body.mass > 0) return body.path ? "planet" : "star";
    if (body.mass < 0) return "pusher";
    return body.path?.kind === "circle" ? "moon" : "rock";
}

/** Every kind of thing in a field. */
export function kindsIn(field: Field): Set<Kind> {
    const kinds = new Set<Kind>(field.bodies.map(kindOf));
    if (field.sparks.length) kinds.add("spark");
    if (field.clouds.length) kinds.add("cloud");
    if (field.rings.length) kinds.add("ring");
    if (field.walls.length) kinds.add("wall");
    if (field.gates.length) kinds.add("wormhole");
    if (field.hole.path) kinds.add("wandering hole");
    return kinds;
}

/** What a level puts in a field. */
export interface Plan {
    idea: Idea;
    /** The kind of thing met for the first time on this level, if any. */
    fresh?: Kind;
    /** Lesser things laid round the idea. */
    extra: number;
    /** Sparks to pick up. */
    sparks: number;
    /** How near the hole's middle a comet must come to be swallowed. */
    mouth: number;
    /** The span of winning directions a kept field must have, in degrees: at least `narrowest`, at most `widest`. */
    narrowest: number;
    widest: number;
}

/** No field is kept whose way in is narrower than this, in degrees: three presses of an arrow key. */
export const NARROWEST = 1.5;
/** Past this level a field asks no more of a player. */
const HARDEST = 24;

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

/** The idea of a seed's field at a level: the first twelve in order, then round again from a place the seed picks, five ideas on each time, which is never the same idea twice running. */
export function ideaOf(seed: string, level: number): Idea {
    if (level <= IDEAS.length) return IDEAS[level - 1]!;
    // the bend is for learning; the rest come round
    const rest = IDEAS.length - 1;
    // where the round starts is never the last of the twelve, which has just been played
    const from = hash(`${seed}:ideas`) % (rest - 1);
    return IDEAS[1 + ((from + (level - IDEAS.length - 1) * 5) % rest)]!;
}

/** What each level asks for. */
export function plan(level: number, seed = ""): Plan {
    // anything that is not a number, as from a damaged store, is level 1: a plan of NaNs could never be met
    const l = whole(level, 1, 1_000_000, 1);
    const hard = Math.min(l, HARDEST);
    return {
        idea: ideaOf(seed, l),
        fresh: l <= BRINGS.length ? BRINGS[l - 1] : undefined,
        extra: Math.min(9, 2 + Math.floor(hard / 2)),
        sparks: l < 2 ? 0 : l < 6 ? 3 : l < 12 ? 4 : 5,
        mouth: Math.max(18, 26 - Math.floor(hard / 3)),
        narrowest: Math.max(NARROWEST, 3 - 0.15 * (hard - 1)),
        widest: Math.max(5, 24 - 1.8 * (hard - 1)),
    };
}

/** The kinds a level has met so far, for the lesser things round its idea. */
function met(level: number): Set<Kind> {
    return new Set(level > BRINGS.length ? KINDS : BRINGS.slice(0, level).filter((kind): kind is Kind => kind !== undefined));
}

/** How strongly a star of a given size pulls, and a pusher pushes: its mass for each squared unit of radius; and how far each is felt, in radii. */
const PULL = 4000;
const PUSH = -4000;
const STAR_REACH = 4.5;
const PUSH_REACH = 4;
/** The hole: how hard it pulls, how far, and how far its grip goes. */
const HOLE_MASS = 3e7;
const HOLE_REACH = 220;
const HOLE_GRIP = 90;
/** Half the side of the walls round a walled hole. */
const WALLED = 160;
/** A number times itself: multiplied, not raised to a power, which a browser may round in its own way (see flight.ts). */
const square = (n: number) => n * n;

/** A star or a pusher of radius r at (x, y), moving if given a path. */
const star = (x: number, y: number, r: number, path?: Path): Body => ({ x, y, radius: r, mass: PULL * r * r, reach: STAR_REACH * r, ...(path ? { path } : {}) });
const pusher = (x: number, y: number, r: number): Body => ({ x, y, radius: r, mass: PUSH * r * r, reach: PUSH_REACH * r });
const rock = (x: number, y: number, r: number, path?: Path): Body => ({ x, y, radius: r, mass: 0, reach: 0, ...(path ? { path } : {}) });

/** A circle the layout keeps clear: something placed, or one place along the way of something that moves. */
interface Taken {
    x: number;
    y: number;
    r: number;
}

/** Lays out a field to a plan, round its idea. Nothing in it is checked yet; undefined if the idea itself did not fit. */
export function layout(seed: string, level: number, wanted: Plan, attempt = 0): Field | undefined {
    const random = numbers(hash(`${seed}:${level}:${attempt}`));
    const between = (low: number, high: number) => low + (high - low) * random();
    const side = random() < 0.5 ? -1 : 1;
    // the start near one side and the hole well across from it; which side is chosen too
    let start = { x: between(110, 220), y: between(170, HIGH - 170) };
    let hole = { x: between(1260, 1430), y: between(170, HIGH - 170) };
    while (square(hole.x - start.x) + square(hole.y - start.y) < 1080 * 1080) hole = { x: between(1260, 1430), y: between(170, HIGH - 170) };
    // a walled hole keeps its walls inside the field
    if (wanted.idea === "wormhole") hole = { x: Math.min(hole.x, WIDE - WALLED - 50), y: Math.min(Math.max(hole.y, WALLED + 50), HIGH - WALLED - 50) };
    if (random() < 0.5) [start, hole] = [{ x: WIDE - start.x, y: start.y }, { x: WIDE - hole.x, y: hole.y }];
    const long = Math.sqrt(square(hole.x - start.x) + square(hole.y - start.y));
    const [ux, uy] = [(hole.x - start.x) / long, (hole.y - start.y) / long];
    const [nx, ny] = [-uy, ux];
    /** A place `d` along the way from the start to the hole and `across` to one side of it. */
    const on = (d: number, across: number): [number, number] => [start.x + ux * d + nx * across, start.y + uy * d + ny * across];

    const bodies: Body[] = [];
    const gates: Gate[] = [];
    const clouds: Round[] = [];
    const rings: Round[] = [];
    const walls: Wall[] = [];
    let holePath: Path | undefined;
    const taken: Taken[] = [];

    const inside = (x: number, y: number, r: number) => x > r + 30 && x < WIDE - r - 30 && y > r + 30 && y < HIGH - r - 30;
    const nearWall = (x: number, y: number, wall: Wall) => {
        const [ex, ey] = [wall.bx - wall.ax, wall.by - wall.ay];
        const t = Math.max(0, Math.min(1, ((x - wall.ax) * ex + (y - wall.ay) * ey) / (ex * ex + ey * ey)));
        return Math.sqrt(square(x - wall.ax - ex * t) + square(y - wall.ay - ey * t));
    };
    /** Whether a round thing of radius r at (x, y) leaves room around the start, the hole, the edges, the walls and what is already placed. */
    const free = (x: number, y: number, r: number, room = 45) =>
        inside(x, y, r) &&
        square(x - start.x) + square(y - start.y) > square(r + 100) &&
        square(x - hole.x) + square(y - hole.y) > square(r + HOLE_GRIP + 45) &&
        walls.every((wall) => nearWall(x, y, wall) > r + 30) &&
        taken.every((other) => square(x - other.x) + square(y - other.y) > square(r + other.r + room));
    /** The places along a path, to keep clear and to be kept clear of. */
    const along = (thing: { x: number; y: number; path?: Path }, r: number): Taken[] => {
        if (!thing.path) return [{ x: thing.x, y: thing.y, r }];
        const period = thing.path.kind === "line" ? thing.path.period : TURNS / Math.abs(thing.path.rate);
        return Array.from({ length: 24 }, (_, i) => ({ ...where(thing, (i / 24) * period), r }));
    };
    const fits = (thing: { x: number; y: number; path?: Path }, r: number, room = 45) => along(thing, r).every((at) => free(at.x, at.y, r, room));
    const keep = (thing: { x: number; y: number; path?: Path }, r: number) => taken.push(...along(thing, r));
    /** Tries a few places near a wanted one for a thing, and keeps the first that fits. */
    const put = <T extends { x: number; y: number; path?: Path }>(make: () => T, r: number, into: T[], room = 45): T | undefined => {
        for (let tries = 0; tries < 40; tries++) {
            const thing = make();
            if (fits(thing, r, room)) {
                into.push(thing);
                keep(thing, r);
                return thing;
            }
        }
        return undefined;
    };
    /** Whether a wall from (ax, ay) to (bx, by) is inside the field and clear of the start, the hole and what is placed. */
    const wallFits = (wall: Wall) => {
        const length = Math.sqrt(square(wall.bx - wall.ax) + square(wall.by - wall.ay));
        for (let at = 0; at <= length; at += 20) {
            const [x, y] = [wall.ax + ((wall.bx - wall.ax) * at) / length, wall.ay + ((wall.by - wall.ay) * at) / length];
            if (x < 40 || x > WIDE - 40 || y < 40 || y > HIGH - 40) return false;
            if (square(x - start.x) + square(y - start.y) < 130 * 130 || square(x - hole.x) + square(y - hole.y) < square(HOLE_GRIP + 50)) return false;
        }
        return taken.every((other) => nearWall(other.x, other.y, wall) > other.r + 30);
    };
    const putWall = (make: () => Wall): Wall | undefined => {
        for (let tries = 0; tries < 40; tries++) {
            const wall = make();
            if (wallFits(wall)) {
                walls.push(wall);
                return wall;
            }
        }
        return undefined;
    };
    /** A wall across the way, `d` along it and centred `across` to one side, `half` long each way. */
    const across = (d: number, centre: number, half: number): Wall => {
        const [ax, ay] = on(d, centre - half);
        const [bx, by] = on(d, centre + half);
        return { ax, ay, bx, by };
    };
    const circle = (x: number, y: number, r: number, rate: number): Path => ({ kind: "circle", x, y, r, from: Math.floor(between(0, TURNS)), rate });
    const turning = (low: number, high: number) => (random() < 0.5 ? -1 : 1) * between(low, high);

    // ---- the idea ----
    const s = side;
    let fitted = true;
    const must = (thing: unknown) => {
        if (!thing) fitted = false;
    };
    switch (wanted.idea) {
        case "bend": {
            const r = between(34, 44);
            must(put(() => star(...on(long * between(0.42, 0.56), s * between(0, 40)), r), r, bodies));
            break;
        }
        case "slingshot": {
            const r = between(62, 72);
            must(put(() => star(...on(long * between(0.6, 0.7), s * between(0, 50)), r), r, bodies));
            break;
        }
        case "push": {
            const d = long * between(0.45, 0.58);
            const centre = s * between(0, 50);
            const gap = between(130, 160);
            let placed = 0;
            for (const k of [-1, 0, 1]) {
                const r = between(22, 28);
                if (put(() => pusher(...on(d + between(-20, 20), centre + k * gap), r), r, bodies)) placed++;
            }
            if (placed < 2) fitted = false;
            const r = between(28, 36);
            put(() => star(...on(d - long * between(0.12, 0.2), -s * between(230, 300)), r), r, bodies);
            break;
        }
        case "cloud": {
            // a star across the straight way; round one side is a cloud to brake through, round the other a pusher
            const d = long * between(0.45, 0.55);
            const r = between(30, 38);
            must(put(() => star(...on(d, s * between(0, 30)), r), r, bodies));
            const cr = between(110, 135);
            must(put(() => ({ ...xy(on(d + between(-40, 40), s * (r + cr + between(40, 70)))), radius: cr }), cr, clouds, 20));
            const pr = between(22, 28);
            put(() => pusher(...on(d + between(-60, 60), -s * (r + between(130, 170))), pr), pr, bodies);
            break;
        }
        case "ring": {
            // a star across the straight way, pushers guarding the hole, and a ring off to one side for the speed to get past them
            const r = between(30, 38);
            must(put(() => star(...on(long * between(0.42, 0.52), -s * between(0, 30)), r), r, bodies));
            for (const k of [-1, 1]) {
                const pr = between(20, 24);
                put(() => pusher(...on(long - between(200, 240), k * between(100, 130)), pr), pr, bodies);
            }
            must(put(() => ({ ...xy(on(long * between(0.2, 0.35), s * between(150, 240))), radius: 26 }), 26, rings));
            break;
        }
        case "bounce": {
            const d = long * between(0.48, 0.6);
            const centre = s * between(0, 60);
            must(putWall(() => across(d + between(-30, 30), centre, between(230, 290))));
            const [ax, ay] = on(long * between(0.15, 0.25), -s * between(300, 380));
            const [bx, by] = on(long * between(0.65, 0.78), -s * between(300, 380));
            putWall(() => ({ ax, ay, bx, by }));
            break;
        }
        case "wormhole": {
            // the hole walled in on all four sides, with one mouth of the pair inside the walls: the only way in is through the other
            const h = WALLED;
            const [x0, y0, x1, y1] = [hole.x - h, hole.y - h, hole.x + h, hole.y + h];
            walls.push({ ax: x0, ay: y0, bx: x1, by: y0 }, { ax: x1, ay: y0, bx: x1, by: y1 }, { ax: x1, ay: y1, bx: x0, by: y1 }, { ax: x0, ay: y1, bx: x0, by: y0 });
            taken.push({ x: hole.x, y: hole.y, r: h * 1.42 });
            const a = put(() => ({ ...xy(on(long * between(0.3, 0.5), s * between(150, 300))), radius: 22, to: 1, pair: 0 }), 22, gates);
            must(a);
            const [dx, dy] = AIMS[Math.floor(between(0, TURNS))]!;
            if (a) gates.push({ x: hole.x + dx * 118, y: hole.y + dy * 118, radius: 22, to: 0, pair: 0 });
            break;
        }
        case "orbit": {
            const r = between(40, 50);
            const middle = put(() => star(...on(long * between(0.45, 0.55), s * between(0, 40)), r), r, bodies);
            must(middle);
            if (middle) {
                const pr = between(15, 19);
                must(
                    put(() => {
                        const path = circle(middle.x, middle.y, r + between(105, 140), turning(0.3, 0.5));
                        return star(...xyOf(where({ x: 0, y: 0, path }, 0)), pr, path);
                    }, pr, bodies, 20),
                );
            }
            break;
        }
        case "gap": {
            // a star across the straight way, and rocks drifting across both ways round it: the gap between them is timed by strength
            const sr = between(28, 34);
            must(put(() => star(...on(long * between(0.48, 0.54), between(-20, 20)), sr), sr, bodies));
            for (const part of [0.3, 0.72]) {
                const r = between(20, 26);
                must(
                    put(() => {
                        const [ax, ay] = on(long * (part + between(-0.03, 0.03)), -between(250, 300));
                        const [bx, by] = on(long * part, between(250, 300));
                        const path: Path = { kind: "line", ax, ay, bx, by, period: Math.floor(between(480, 760)), from: random() };
                        return rock(...xyOf(where({ x: 0, y: 0, path }, 0)), r, path);
                    }, r, bodies, 30),
                );
            }
            break;
        }
        case "moon": {
            const r = between(44, 54);
            const middle = put(() => star(...on(long * between(0.42, 0.55), s * between(40, 110)), r), r, bodies);
            must(middle);
            if (middle) {
                const mr = between(13, 17);
                must(
                    put(() => {
                        const path = circle(middle.x, middle.y, r + between(48, 66), turning(0.8, 1.2));
                        return rock(...xyOf(where({ x: 0, y: 0, path }, 0)), mr, path);
                    }, mr, bodies, 15),
                );
            }
            const pr = between(22, 28);
            put(() => pusher(...on(long * between(0.55, 0.7), -s * between(200, 260)), pr), pr, bodies);
            break;
        }
        case "relay": {
            let placed = 0;
            for (const [k, part] of [0.3, 0.5, 0.7].entries()) {
                const r = between(26, 36);
                if (put(() => star(...on(long * part, (k % 2 ? -s : s) * between(170, 250)), r), r, bodies)) placed++;
            }
            if (placed < 2) fitted = false;
            // and a pusher across the straight way, so the stars must be used
            const pr = between(24, 30);
            must(put(() => pusher(...on(long * between(0.45, 0.55), between(-20, 20)), pr), pr, bodies));
            break;
        }
        case "wander": {
            const [ax, ay] = [hole.x - nx * between(120, 170), hole.y - ny * between(120, 170)];
            const [bx, by] = [hole.x + nx * between(120, 170), hole.y + ny * between(120, 170)];
            if (!inside(ax, ay, HOLE_REACH * 0.5) || !inside(bx, by, HOLE_REACH * 0.5)) fitted = false;
            holePath = { kind: "line", ax, ay, bx, by, period: Math.floor(between(1500, 2100)), from: random() };
            const r = between(34, 44);
            put(() => star(...on(long * between(0.45, 0.6), s * between(0, 60)), r), r, bodies);
            break;
        }
    }
    if (!fitted) return undefined;
    // the hole that wanders keeps everything clear of the whole of its way
    if (holePath) {
        const at = where({ x: 0, y: 0, path: holePath }, 0);
        hole = { x: at.x, y: at.y };
        for (const place of along({ x: 0, y: 0, path: holePath }, HOLE_GRIP)) taken.push(place);
    }

    // ---- lesser things, of kinds already met, anywhere they fit ----
    const kinds = met(level);
    const choices: Kind[] = (["star", "pusher", "cloud", "ring", "wall", "rock"] as const).filter((kind) => kinds.has(kind));
    for (let i = 0; i < wanted.extra; i++) {
        const kind = choices[Math.floor(random() * choices.length)]!;
        const anywhere = (r: number): [number, number] => [between(r + 30, WIDE - r - 30), between(r + 30, HIGH - r - 30)];
        if (kind === "star") {
            const r = between(18, 30);
            put(() => star(...anywhere(r), r), r, bodies, 60);
        } else if (kind === "pusher") {
            const r = between(17, 24);
            put(() => pusher(...anywhere(r), r), r, bodies, 60);
        } else if (kind === "cloud") {
            const r = between(70, 105);
            put(() => ({ ...xy(anywhere(r)), radius: r }), r, clouds, 30);
        } else if (kind === "ring") put(() => ({ ...xy(anywhere(26)), radius: 26 }), 26, rings, 60);
        else if (kind === "wall") {
            putWall(() => {
                const [x, y] = anywhere(100);
                const half = between(80, 130);
                const [dx, dy] = AIMS[Math.floor(between(0, TURNS))]!;
                return { ax: x - dx * half, ay: y - dy * half, bx: x + dx * half, by: y + dy * half };
            });
        } else {
            const r = between(15, 21);
            put(() => {
                const [ax, ay] = anywhere(r);
                const [dx, dy] = AIMS[Math.floor(between(0, TURNS))]!;
                const length = between(180, 320);
                const path: Path = { kind: "line", ax, ay, bx: ax + dx * length, by: ay + dy * length, period: Math.floor(between(500, 900)), from: random() };
                return rock(...xyOf(where({ x: 0, y: 0, path }, 0)), r, path);
            }, r, bodies, 40);
        }
    }
    return {
        seed,
        level,
        idea: wanted.idea,
        start,
        hole: { ...hole, radius: wanted.mouth * 0.75, mouth: wanted.mouth, reach: HOLE_REACH, grip: HOLE_GRIP, mass: HOLE_MASS, ...(holePath ? { path: holePath } : {}) },
        bodies,
        gates,
        clouds,
        rings,
        walls,
        sparks: [],
    };
}

const xy = ([x, y]: [number, number]) => ({ x, y });
const xyOf = (at: { x: number; y: number }): [number, number] => [at.x, at.y];

/** Directions tried either side of the hole's, and how far apart (in steps of half a degree); strengths tried, in notches. */
const FAN = 300;
const SPREAD = 4;
const STRENGTHS = [14, 18, 22, 26, 30, 34, 38];
/** How far the span around a win is followed each way, in half degrees: past this a way in counts as wide enough anyway. */
const FOLLOW = 70;

/** What a search of a field found. */
export interface Searched {
    solution?: Solution;
    /** Every way in that was measured, the widest first. */
    ways: Solution[];
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
 * Searches a field for launches that win, pausing after every few flights so that a page can spread
 * the work over frames. Gives the one with the widest span of winning directions around it (the
 * middle of that span), or undefined if none was found; every way in it measured; and how many of
 * the launches tried won.
 */
export function* solving(field: Field): Generator<undefined, Searched> {
    const toward = nearest(field.hole.x - field.start.x, field.hole.y - field.start.y);
    let flown = 0;
    const wins = (aim: number, notches: number) => {
        flown++;
        const [vx, vy] = velocity(aim, notches);
        const flight = fly(field, vx, vy);
        return flight.ended === "won" ? flight.steps : 0;
    };
    let [won, tried, straight] = [0, 0, false];
    const ways: Solution[] = [];
    for (const notches of STRENGTHS) {
        // in one row of strength, a run of coarse wins is one way in: it is measured once
        let covered = -Infinity;
        for (let off = -FAN; off <= FAN; off += SPREAD) {
            if (flown >= 2) {
                flown = 0;
                yield;
            }
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
            ways.push({ aim: ((middle % TURNS) + TURNS) % TURNS, notches, window, steps });
        }
    }
    // the widest way in first: a field is only as hard as its easiest way through
    ways.sort((a, b) => b.window - a.window);
    return { solution: ways[0], ways, wins: won, tried, straight };
}

/** A field ready to play, with the launch that proves it can be won. */
export interface Made {
    field: Field;
    solution: Solution;
    /** The way in the sparks are laid along: all of them are picked up by this launch. */
    route: Solution;
    /** How many fields were laid out before this one was kept. */
    tries: number;
}

/** How many layouts a level tries before it asks for less in the field. */
const TRIES = 8;

/** The field for a seed and a level: always the same one, and always one that can be won. */
export const make = (seed: string, level: number): Made => finish(making(seed, level));

/** `make`, in pieces: it pauses often, so that a page can make the next field between frames. */
export function* making(seed: string, level: number): Generator<undefined, Made> {
    const asked = plan(level, seed);
    const l = whole(level, 1, 1_000_000, 1);
    let tries = 0;
    let fallback: { field: Field; search: Searched; miss: number } | undefined;
    // less and less in the field, down to the hole alone, until a field passes
    for (let less = 0; ; less++) {
        const wanted: Plan =
            less === 0
                ? asked
                : {
                      ...asked,
                      extra: Math.max(0, asked.extra - less * 2),
                      // after two rounds the idea gives way to the first one, and after four the field is the hole alone
                      idea: less < 3 ? asked.idea : "bend",
                      narrowest: NARROWEST,
                      widest: Infinity,
                  };
        const alone = less >= 5;
        for (let attempt = 0; attempt < (alone ? 1 : TRIES); attempt++) {
            tries++;
            const laid = alone ? emptied(layout(seed, l, { ...wanted, idea: "bend", extra: 0 }, less * 100)) : layout(seed, l, wanted, less * 100 + attempt);
            if (!laid) {
                yield;
                continue;
            }
            const search = yield* solving(laid);
            const solution = search.solution;
            if (!solution || solution.window < NARROWEST) continue;
            if (solution.window >= wanted.narrowest && solution.window <= wanted.widest && (!search.straight || less > 0)) return yield* sparked(laid, search, asked.sparks, tries);
            // too wide, a little too narrow, or won by a straight shot: kept in case nothing better comes, the nearest to the level first
            const miss = (search.straight ? 1000 : 0) + Math.abs(solution.window - asked.widest);
            if (less === 0 && (!fallback || miss < fallback.miss)) fallback = { field: laid, search, miss };
        }
        if (fallback) return yield* sparked(fallback.field, fallback.search, asked.sparks, tries);
        // the hole alone is always won by a straight shot; the bound holds whatever was asked for
        if (less > 6) throw new Error(`No field could be made for ${seed} at level ${level}.`);
    }
}

/** A field with nothing in it but the start and the hole. */
function emptied(field: Field | undefined): Field | undefined {
    return field && { ...field, bodies: [], gates: [], clouds: [], rings: [], walls: [], hole: { ...field.hole, path: undefined } };
}

/**
 * Lays sparks along a way in: a second one, unlike the widest, if the search found one (the narrowest
 * such, so that picking them all up is the harder way through), or else the widest. They are laid on
 * the way's own flight, evenly by time, clear of the start and the hole, so that its launch picks up
 * every one.
 */
function* sparked(field: Field, search: Searched, count: number, tries: number): Generator<undefined, Made> {
    const best = search.solution!;
    const unlike = search.ways.filter((way) => Math.abs(((way.aim - best.aim + 1080) % TURNS) - 360) >= 16 || Math.abs(way.notches - best.notches) >= 8);
    const route = unlike.length ? unlike[unlike.length - 1]! : best;
    const sparks: Spark[] = [];
    if (count > 0) {
        const comet = launch(field, ...velocity(route.aim, route.notches));
        const path: { x: number; y: number }[] = [];
        while (!comet.ended) {
            advance(field, comet);
            if (comet.through === undefined) path.push({ x: comet.x, y: comet.y });
        }
        const clear = path.filter((at) => square(at.x - field.start.x) + square(at.y - field.start.y) > 140 * 140 && square(at.x - field.hole.x) + square(at.y - field.hole.y) > square(field.hole.reach));
        for (let i = 0; i < count && clear.length > count; i++) {
            const at = clear[Math.floor(((i + 0.5) / count) * clear.length)]!;
            sparks.push({ x: at.x, y: at.y });
        }
    }
    yield;
    return { field: { ...field, sparks }, solution: best, route, tries };
}

/** How many stars and pushers the winning flight passes close to: within three of their radii. */
export function passes(field: Field, solution: Solution): number {
    const comet = launch(field, ...velocity(solution.aim, solution.notches));
    const near = new Set<number>();
    while (!comet.ended) {
        advance(field, comet);
        field.bodies.forEach((body, at) => {
            const place = where(body, comet.step);
            if (square(comet.x - place.x) + square(comet.y - place.y) < square(body.radius * 3)) near.add(at);
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

/** A run starting at a level of a seed. */
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
