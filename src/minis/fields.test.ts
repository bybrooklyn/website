// The comet's fields, held to what they promise: the same field for the same seed and level, every
// one of them winnable with one shot that is neither needle-fine nor a straight shot, each made round
// its level's idea with the kinds of thing brought in one level at a time, nothing off the field or on
// top of anything else, sparks that one launch picks up, a level that asks more than the one before,
// and a solver that keeps a page responsive. Also the score. Run with `bun test`.

import { expect, test } from "bun:test";
import { HIGH, WIDE, fly, nearest, velocity, where, type Field } from "./flight";
import { IDEAS, KINDS, NARROWEST, begin, bestFor, hash, ideaOf, keptBests, keptRun, kindsIn, layout, make, making, numbers, passes, plan, shoot, win, type Made } from "./fields";

const median = (values: number[]) => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)]!;

test("the same seed and level give the same field, and a different seed or level a different one", () => {
    const one = make("nebula", 5);
    expect(make("nebula", 5)).toEqual(one);
    expect(make("nebula", 6).field).not.toEqual(one.field);
    expect(make("nebulae", 5).field).not.toEqual(one.field);
    // made in pieces, it is the same field as made at once
    const work = making("nebula", 5);
    let next = work.next();
    let pauses = 0;
    while (!next.done) [next, pauses] = [work.next(), pauses + 1];
    expect(next.value).toEqual(one);
    expect(pauses).toBeGreaterThan(50);
});

test("the numbers a field is made from are the same on every machine", () => {
    expect(hash("comet")).toBe(3306034447);
    const random = numbers(7);
    expect([random(), random()]).toEqual([0.011704753153026104, 0.06195825757458806]);
    // Written down once: if this changes, every link to a field now leads somewhere else. Last
    // changed when fields were made round ideas, on a bigger field, with a hole of short reach.
    const made = make("comet", 4);
    expect([made.field.start.x, made.solution.aim, made.solution.notches, made.field.bodies.length]).toEqual(GOLDEN);
});
const GOLDEN = [127.87755044177175, 11, 18, 4];

test("a field is laid out with adding, multiplying, dividing and square roots only, never a power, which a browser may round its own way", () => {
    expect(layout.toString()).not.toContain("**");
    expect(layout.toString()).not.toContain("Math.pow");
    expect(layout.toString()).not.toContain("Math.sin");
    expect(layout.toString()).not.toContain("Math.cos");
});

/** Every level from 1 to 12, for this many seeds each. */
const SEEDS = 30;
const made: Made[][] = [];
/** How long each field took to make, and each stretch between two pauses, in milliseconds. */
const took: number[] = [];
const pieces: number[] = [];
/** The fields of a level, made the first time a test asks, so that any test can be run alone. */
const fieldsAt = (level: number): Made[] =>
    (made[level] ??= Array.from({ length: SEEDS }, (_, seed) => {
        const work = making(`s${seed}`, level);
        const began = performance.now();
        let last = began;
        for (;;) {
            const next = work.next();
            const now = performance.now();
            pieces.push(now - last);
            last = now;
            if (next.done) {
                took.push(now - began);
                return next.value;
            }
        }
    }));

test(`every one of ${SEEDS * 12} fields can be won by the launch it comes with, and the launches around it win too`, () => {
    for (let level = 1; level <= 12; level++) {
        for (const one of fieldsAt(level)) {
            const { field, solution } = one;
            const wins = (aim: number, notches: number) => fly(field, ...velocity(aim, notches)).ended === "won";
            expect(wins(solution.aim, solution.notches)).toBe(true);
            // half a degree either way, and a notch weaker or stronger: the way in has room
            expect(wins(solution.aim - 1, solution.notches)).toBe(true);
            expect(wins(solution.aim + 1, solution.notches)).toBe(true);
            expect(wins(solution.aim, solution.notches - 1)).toBe(true);
            expect(wins(solution.aim, solution.notches + 1)).toBe(true);
            expect(solution.window).toBeGreaterThanOrEqual(NARROWEST);
        }
    }
}, 600_000);

test("making a field never holds a page for long: each piece is short, and a field is made while the one before is played", () => {
    for (let level = 1; level <= 12; level++) fieldsAt(level);
    const slowest = Math.max(...took);
    const sorted = [...pieces].sort((a, b) => a - b);
    const nearly = sorted[Math.floor(sorted.length * 0.999)]!;
    console.log(`making a field: median ${median(took).toFixed(0)} ms, slowest ${slowest.toFixed(0)} ms; pieces between pauses: ${nearly.toFixed(1)} ms or less for all but one in a thousand, the longest ${sorted[sorted.length - 1]!.toFixed(1)} ms`);
    // a frame is about 16 ms; pieces longer than this would be felt (the very longest is left out, since a busy machine or the collection of garbage can stretch any one)
    expect(nearly).toBeLessThan(8);
    expect(median(took)).toBeLessThan(1500);
}, 600_000);

/** The places a thing is found over a flight's whole length, for one that moves; the one place for one that does not. */
const ways = (thing: { x: number; y: number; path?: Field["bodies"][number]["path"] }): { x: number; y: number }[] =>
    thing.path ? Array.from({ length: 60 }, (_, i) => ({ ...where(thing, i * 40) })) : [{ x: thing.x, y: thing.y }];
/** How far a point is from a wall. */
const fromWall = (x: number, y: number, wall: Field["walls"][number]) => {
    const [ex, ey] = [wall.bx - wall.ax, wall.by - wall.ay];
    const t = Math.max(0, Math.min(1, ((x - wall.ax) * ex + (y - wall.ay) * ey) / (ex * ex + ey * ey)));
    return Math.hypot(x - wall.ax - ex * t, y - wall.ay - ey * t);
};

test("nothing in a field is off it, overlaps, crowds the start or the hole, or stands on a wall, wherever it moves", () => {
    for (let level = 1; level <= 12; level++) {
        for (const { field } of fieldsAt(level)) {
            const round = [...field.bodies, ...field.gates.slice(0, 1), ...field.rings];
            for (const one of round) {
                for (const at of ways(one)) {
                    expect(at.x - one.radius).toBeGreaterThan(20);
                    expect(at.y - one.radius).toBeGreaterThan(20);
                    expect(at.x + one.radius).toBeLessThan(WIDE - 20);
                    expect(at.y + one.radius).toBeLessThan(HIGH - 20);
                    expect(Math.hypot(at.x - field.start.x, at.y - field.start.y)).toBeGreaterThan(one.radius + 80);
                    for (const hole of ways(field.hole)) expect(Math.hypot(at.x - hole.x, at.y - hole.y)).toBeGreaterThan(one.radius + field.hole.grip);
                    for (const wall of field.walls) expect(fromWall(at.x, at.y, wall)).toBeGreaterThan(one.radius + 20);
                    for (const other of round) {
                        if (other === one) continue;
                        for (const there of ways(other)) expect(Math.hypot(at.x - there.x, at.y - there.y)).toBeGreaterThan(one.radius + other.radius + 10);
                    }
                }
            }
            for (const wall of field.walls) {
                for (const x of [wall.ax, wall.bx]) expect(x > 20 && x < WIDE - 20).toBe(true);
                for (const y of [wall.ay, wall.by]) expect(y > 20 && y < HIGH - 20).toBe(true);
                expect(fromWall(field.start.x, field.start.y, wall)).toBeGreaterThan(100);
            }
            expect(Math.hypot(field.hole.x - field.start.x, field.hole.y - field.start.y)).toBeGreaterThanOrEqual(900);
        }
    }
}, 600_000);

test("each field is made round its level's idea, and each kind of thing is first met on its own level", () => {
    for (let level = 1; level <= 12; level++) {
        const asked = plan(level);
        const fields = fieldsAt(level);
        expect(asked.idea).toBe(IDEAS[level - 1]!);
        expect(fields.filter((one) => one.field.idea === asked.idea).length / fields.length).toBeGreaterThan(0.9);
        // nothing of a kind not yet met
        const later = new Set(KINDS.filter((kind) => ![...Array(level).keys()].some((l) => plan(l + 1).fresh === kind)));
        for (const one of fields) for (const kind of kindsIn(one.field)) expect(later.has(kind)).toBe(false);
        // the kind the level brings is there in almost every field of it
        if (asked.fresh) expect(fields.filter((one) => kindsIn(one.field).has(asked.fresh!)).length / fields.length).toBeGreaterThan(0.9);
    }
    // past twelve the ideas come round again, never the same twice running
    for (const seed of ["a", "b", "orion", "s7"]) {
        for (let level = 12; level < 60; level++) expect(ideaOf(seed, level + 1)).not.toBe(ideaOf(seed, level));
        const seen = new Set(Array.from({ length: 22 }, (_, i) => ideaOf(seed, 13 + i)));
        expect(seen.size).toBe(IDEAS.length - 1);
    }
});

test("the sparks of a field are all picked up by the launch they were laid for, and none is needed to win", () => {
    for (const level of [2, 6, 9, 12]) {
        for (const { field, route, solution } of fieldsAt(level)) {
            expect(field.sparks.length).toBeLessThanOrEqual(plan(level).sparks);
            const flight = fly(field, ...velocity(route.aim, route.notches));
            expect(flight.ended).toBe("won");
            expect(flight.sparks).toBe((1 << field.sparks.length) - 1);
            expect(fly(field, ...velocity(solution.aim, solution.notches)).ended).toBe("won");
        }
        expect(fieldsAt(level).filter((one) => one.field.sparks.length === plan(level).sparks).length / SEEDS).toBeGreaterThan(0.9);
    }
}, 600_000);

test("a level asks for more than the one before, and the fields show it: a narrower way in, never straight at the hole", () => {
    const rows: string[] = [];
    const windows: number[] = [];
    const [bands, straights]: number[][] = [[], []];
    for (let level = 1; level <= 12; level++) {
        const asked = plan(level);
        const fields = fieldsAt(level);
        const window = median(fields.map((one) => one.solution.window));
        const near = fields.reduce((sum, one) => sum + passes(one.field, one.solution), 0) / fields.length;
        const inBand = fields.filter((one) => one.solution.window >= asked.narrowest && one.solution.window <= asked.widest).length / fields.length;
        const things = fields.reduce((sum, { field }) => sum + field.bodies.length + field.gates.length + field.clouds.length + field.rings.length + field.walls.length, 0) / fields.length;
        const seconds = median(fields.map((one) => one.solution.steps / 120));
        // how often aiming straight at the hole wins at any strength
        const toward = (one: Made) => nearest(one.field.hole.x - one.field.start.x, one.field.hole.y - one.field.start.y);
        const straight = fields.filter((one) => [14, 18, 22, 26, 30, 34, 38].some((notches) => fly(one.field, ...velocity(toward(one), notches)).ended === "won")).length / fields.length;
        windows.push(window);
        rows.push(`| ${level} | ${asked.idea} | ${asked.fresh ?? ""} | ${things.toFixed(1)} | ${asked.mouth} | ${asked.narrowest.toFixed(1)} to ${asked.widest.toFixed(0)} | ${window.toFixed(1)} | ${seconds.toFixed(1)} | ${Math.round(straight * 100)}% | ${near.toFixed(2)} | ${Math.round(inBand * 100)}% |`);
        if (level > 1) {
            const before = plan(level - 1);
            expect(asked.extra).toBeGreaterThanOrEqual(before.extra);
            expect(asked.mouth).toBeLessThanOrEqual(before.mouth);
            expect(asked.widest).toBeLessThanOrEqual(before.widest);
        }
        bands.push(inBand);
        straights.push(straight);
    }
    console.log(["| level | idea | new | things | mouth | way in asked (degrees) | way in, median | winning flight, median (s) | straight at the hole wins | bodies passed within 3 radii | in band |", "|---|---|---|---|---|---|---|---|---|---|---|", ...rows].join("\n"));
    // almost every field is as hard as its level says, and is not won by aiming straight at the hole; the rest are the nearest that could be made
    for (const inBand of bands) expect(inBand).toBeGreaterThan(0.8);
    for (const straight of straights) expect(straight).toBeLessThan(0.05);
    expect(median(windows.slice(0, 4))).toBeGreaterThan(median(windows.slice(8, 12)));
}, 600_000);

test("every launch is a shot, a win keeps the fewest shots for that field and goes on to the next", () => {
    let run = begin("orion", 3);
    run = shoot(shoot(shoot(run)));
    expect(run).toEqual({ seed: "orion", level: 3, shots: 3, total: 3, won: 0 });
    let result = win(run, {});
    expect(result.best).toBe(true);
    expect(result.run).toEqual({ seed: "orion", level: 4, shots: 0, total: 3, won: 1 });
    expect(bestFor(result.bests, "orion", 3)).toBe(3);
    // the same field again in more shots does not take the best away; in fewer it does
    result = win({ ...shoot(shoot(shoot(shoot(begin("orion", 3))))) }, result.bests);
    expect(result.best).toBe(false);
    expect(bestFor(result.bests, "orion", 3)).toBe(3);
    result = win(shoot(begin("orion", 3)), result.bests);
    expect(result.best).toBe(true);
    expect(bestFor(result.bests, "orion", 3)).toBe(1);
    expect(bestFor(result.bests, "orion", 4)).toBeUndefined();
    expect(begin("x", 0).level).toBe(1);
});

/** Makes a field a piece at a time, giving up after `ms`: a generator that never ends shows as not done, instead of freezing the test. */
function within(seed: string, level: number, ms: number): Made | undefined {
    const work = making(seed, level);
    const deadline = performance.now() + ms;
    while (performance.now() < deadline) {
        const next = work.next();
        if (next.done) return next.value;
    }
    return undefined;
}

test("a level that is not a sane number, as from a damaged store or an old link, still makes a field, and soon", () => {
    for (const level of [Number("abc"), NaN, Infinity, -Infinity, -3, 0, 1e300, 999_999, "abc" as unknown as number, null as unknown as number, undefined as unknown as number]) {
        const made = within("x", level, 10_000);
        expect(made).toBeDefined();
        expect(made!.field.bodies.length + made!.field.gates.length).toBeGreaterThanOrEqual(0);
    }
    expect(plan(Number.NaN)).toEqual(plan(1));
    expect(plan(Infinity)).toEqual(plan(1));
}, 120_000);

test("a kept run is read back only as sane whole numbers and a short seed, and a damaged one is left out", () => {
    expect(keptRun({ seed: "orion", level: 3, shots: 2, total: 9, won: 2 })).toEqual({ seed: "orion", level: 3, shots: 2, total: 9, won: 2 });
    expect(keptRun({ seed: "orion", level: "abc", shots: "x", total: null, won: -1 })).toEqual({ seed: "orion", level: 1, shots: 0, total: 0, won: 0 });
    expect(keptRun({ seed: "orion", level: null, shots: 0, total: 0, won: 0 })!.level).toBe(1);
    expect(keptRun({ seed: "orion", level: 2.7, shots: 1e300, total: 0, won: 0 })).toEqual({ seed: "orion", level: 2, shots: 1e9, total: 1e9, won: 0 });
    for (const value of [null, undefined, 3, "orion", [], { level: 3 }, { seed: 4, level: 3 }, { seed: "", level: 3 }, { seed: "a".repeat(41), level: 3 }]) expect(keptRun(value)).toBeUndefined();
    // a link's field of Infinity cannot become a level, nor be written down as null
    expect(begin("x", Infinity).level).toBe(1);
    expect(begin("x", NaN).level).toBe(1);
    expect(JSON.parse(JSON.stringify(begin("x", Infinity))).level).toBe(1);
});

test("kept bests are read back as whole numbers of shots for short seeds, and anything else is left out", () => {
    expect(keptBests({ orion: { 1: 3, 2: 5 } })).toEqual({ orion: { 1: 3, 2: 5 } });
    expect(keptBests({ orion: { 1: "x", 2: 5, x: 3, 3: 2.5 }, ["a".repeat(41)]: { 1: 1 }, bad: 3, list: [1] })).toEqual({ orion: { 2: 5, 3: 2 } });
    for (const value of [null, undefined, 3, "x", []]) expect(keptBests(value)).toEqual({});
});
