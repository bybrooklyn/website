// Comet's fields, held to what the generator promises: the same field for the same seed and level on
// every machine; every field won by the launch it comes with and never by a shot straight at the
// hole; one planet always across the straight way, and the first field that planet alone; nothing
// crowding the start, the hole or the edges; a way in wide enough to find by hand; fields that ask a
// little more each level; making that never holds a page for long; and what a browser kept from an
// earlier visit read back safely. Run with `bun test`; it prints the difficulty table.

import { expect, test } from "bun:test";
import { CATCH, HIGH, WIDE, fly, nearest, velocity, type Field } from "./flight";
import { MOST_LEVEL, hash, kept, layout, make, making, numbers, plan } from "./fields";

const SEEDS = ["lumen", "orchard", "tide", "bakulo", "ferro", "quill"];
const LEVELS = [1, 2, 3, 4, 6, 8, 10, 12, 16, 20, 30];
/** Every field the tests below look at, made once. */
const made = SEEDS.flatMap((seed) => LEVELS.map((level) => ({ seed, level, ...make(seed, level) })));

/** Whether the straight line from the start to the hole passes through a planet, with the comet's own width to spare. */
const blocked = (field: Field) =>
    field.planets.some((planet) => {
        const [dx, dy] = [field.hole.x - field.start.x, field.hole.y - field.start.y];
        const t = Math.max(0, Math.min(1, ((planet.x - field.start.x) * dx + (planet.y - field.start.y) * dy) / (dx * dx + dy * dy)));
        return Math.hypot(field.start.x + dx * t - planet.x, field.start.y + dy * t - planet.y) < planet.r;
    });

test("the numbers a field is made from are the same on every machine", () => {
    expect(hash("lumen")).toBe(hash("lumen"));
    expect(hash("lumen")).not.toBe(hash("lumen "));
    const one = numbers(12345);
    expect([one(), one(), one()].map((n) => n.toFixed(12))).toEqual(["0.979728267761", "0.306752264500", "0.484205421526"]);
});

test("the same seed and level give the same field, and another seed or level another one", () => {
    expect(make("lumen", 5).field).toEqual(make("lumen", 5).field);
    expect(make("lumen", 5).field).not.toEqual(make("lumen", 6).field);
    expect(make("lumen", 5).field).not.toEqual(make("tide", 5).field);
});

test(`every one of ${made.length} fields is won by the launch it comes with, soon, and never by a shot aimed straight at the hole`, () => {
    for (const { field, solution } of made) {
        const flight = fly(field, ...velocity(solution.aim, solution.power));
        expect(flight.ended).toBe("won");
        expect(flight.steps).toBe(solution.steps);
        expect(flight.steps / 120).toBeLessThanOrEqual(5);
        const toward = nearest(field.hole.x - field.start.x, field.hole.y - field.start.y);
        for (let power = 0.18; power <= 1; power += 0.02) expect(fly(field, ...velocity(toward, power)).ended).not.toBe("won");
    }
});

test("one planet always stands across the straight way, and the first field is that planet alone", () => {
    for (const { field, level } of made) {
        expect(blocked(field)).toBe(true);
        if (level === 1) expect(field.planets).toHaveLength(1);
        // a planet that finds no room is left out, never one more than the level asks
        expect(field.planets.length).toBeLessThanOrEqual(plan(level, field.seed).planets);
    }
});

test("nothing is off the field or crowds the start, the hole or another planet", () => {
    for (const { field } of made) {
        for (const point of [field.start, field.hole]) {
            expect(point.x).toBeGreaterThan(100);
            expect(point.x).toBeLessThan(WIDE - 100);
            expect(point.y).toBeGreaterThan(100);
            expect(point.y).toBeLessThan(HIGH - 100);
        }
        field.planets.forEach((planet, at) => {
            expect(planet.x - planet.r).toBeGreaterThan(0);
            expect(planet.x + planet.r).toBeLessThan(WIDE);
            expect(planet.y - planet.r).toBeGreaterThan(0);
            expect(planet.y + planet.r).toBeLessThan(HIGH);
            expect(Math.hypot(planet.x - field.start.x, planet.y - field.start.y) - planet.r).toBeGreaterThan(100);
            expect(Math.hypot(planet.x - field.hole.x, planet.y - field.hole.y) - planet.r).toBeGreaterThan(CATCH + 40);
            for (const other of field.planets.slice(at + 1)) expect(Math.hypot(planet.x - other.x, planet.y - other.y)).toBeGreaterThan(planet.r + other.r + 60);
        });
    }
});

test("the sides swap each level, so the hole just reached is near where the next field starts", () => {
    for (const { field, level } of made) expect(field.start.x < field.hole.x).toBe(level % 2 === 1);
});

test("each field's way in is wide enough to find by hand, and fields ask a little more each level", () => {
    const rows: string[] = ["level  planets  span  winning launches (median, least, most)  way in, degrees (median)  winning flight, s (median)"];
    const median = (values: number[]) => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)]!;
    const wins: number[] = [];
    for (const level of LEVELS) {
        const these = made.filter((one) => one.level === level);
        for (const one of these) expect(one.solution.window).toBeGreaterThanOrEqual(plan(level).narrowest);
        const counts = these.map((one) => one.wins);
        wins.push(median(counts));
        rows.push(`${String(level).padStart(5)}  ${String(plan(level).planets).padStart(7)}  ${String(plan(level).span).padStart(4)}  ${String(median(counts)).padStart(6)} ${String(Math.min(...counts)).padStart(4)} ${String(Math.max(...counts)).padStart(4)}  ${String(median(these.map((one) => one.solution.window))).padStart(24)}  ${(median(these.map((one) => one.solution.steps)) / 120).toFixed(1).padStart(26)}`);
    }
    console.log(rows.join("\n"));
    // fewer winning launches as the levels go on, over any few levels, though not every field is harder than the one before
    expect(wins[0]!).toBeGreaterThan(wins[3]!);
    expect(wins[3]!).toBeGreaterThan(wins[7]!);
    expect(wins[7]!).toBeGreaterThanOrEqual(wins[10]!);
    expect(plan(1).span).toBeLessThan(plan(12).span);
});

test("making a field never holds a page for long: almost every piece between pauses is short, and a whole field is quick", () => {
    const pieces: number[] = [];
    const wholes: number[] = [];
    for (const seed of ["one", "two", "three"]) {
        for (const level of [1, 7, 21]) {
            const work = making(seed, level);
            const began = performance.now();
            for (;;) {
                const before = performance.now();
                const next = work.next();
                pieces.push(performance.now() - before);
                if (next.done) break;
            }
            wholes.push(performance.now() - began);
        }
    }
    pieces.sort((a, b) => a - b);
    wholes.sort((a, b) => a - b);
    // a busy machine can stretch any one piece; all but one in a thousand must be short
    expect(pieces[Math.floor(pieces.length * 0.999)]!).toBeLessThan(8);
    expect(wholes[Math.floor(wholes.length / 2)]!).toBeLessThan(400);
    console.log(`making a field: median ${wholes[Math.floor(wholes.length / 2)]!.toFixed(0)} ms, slowest ${wholes.at(-1)!.toFixed(0)} ms; a piece between pauses at most ${pieces.at(-1)!.toFixed(2)} ms`);
});

test("a level that is not a sane number, as from a damaged store or an edited link, is level 1", () => {
    for (const level of [Number.NaN, -3, 0, Infinity, -Infinity]) expect(plan(level)).toEqual(plan(1));
    // one past any played asks what the hardest level asks
    expect(plan(2.5e300).span).toBe(plan(MOST_LEVEL).span);
    expect(layout("lumen", 1, plan(1)).planets).toHaveLength(1);
});

test("what an earlier visit kept is read back only as a short seed and a sane field, and anything else is dropped", () => {
    expect(kept({ seed: "lumen", level: 7 })).toEqual({ seed: "lumen", level: 7 });
    expect(kept({ seed: "lumen", level: "7" })).toEqual({ seed: "lumen", level: 1 });
    expect(kept({ seed: "lumen", level: 2.9 })).toEqual({ seed: "lumen", level: 2 });
    expect(kept({ seed: "lumen", level: 1e99 })).toEqual({ seed: "lumen", level: MOST_LEVEL });
    // the run kept by the version before, which counted shots too: its seed and field are read, the rest let go
    expect(kept({ seed: "bakulo", level: 4, shots: 3, total: 9, won: 3 })).toEqual({ seed: "bakulo", level: 4 });
    for (const damaged of [null, undefined, 3, "lumen", [], {}, { seed: "" }, { seed: "   " }, { seed: "x".repeat(41) }, { seed: 5, level: 2 }]) expect(kept(damaged)).toBeUndefined();
});
