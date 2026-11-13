// The comet's fields, held to what they promise: the same field for the same seed and level, every
// one of them winnable with one shot that is neither needle-fine nor a straight shot, and a level that
// asks measurably more than the one before. Also the score. Run with `bun test`.

import { expect, test } from "bun:test";
import { HIGH, WIDE, fly, nearest, velocity } from "./flight";
import { NARROWEST, begin, bestFor, hash, layout, make, making, numbers, passes, plan, shoot, win, type Made } from "./fields";

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
    expect(pauses).toBeGreaterThan(5);
});

test("the numbers a field is made from are the same on every machine", () => {
    expect(hash("comet")).toBe(3306034447);
    const random = numbers(7);
    expect([random(), random()]).toEqual([0.011704753153026104, 0.06195825757458806]);
    // written down once: if this changes, every link to a field now leads somewhere else
    const made = make("comet", 4);
    expect([made.field.start.x, made.solution.aim, made.solution.notches, made.field.stars.length]).toEqual(GOLDEN);
});
const GOLDEN = [900.6624900922179, 437, 8, 4];

test("a field is laid out with adding, multiplying, dividing and square roots only, never a power, which a browser may round its own way", () => {
    expect(layout.toString()).not.toContain("**");
    expect(layout.toString()).not.toContain("Math.pow");
});

/** Every level from 1 to 12, for this many seeds each. */
const SEEDS = 200;
const made: Made[][] = [];

test(`every one of ${SEEDS * 12} fields can be won by the launch it comes with, and the launches around it win too`, () => {
    for (let level = 1; level <= 12; level++) {
        made[level] = [];
        for (let seed = 0; seed < SEEDS; seed++) {
            const one = make(`s${seed}`, level);
            made[level]!.push(one);
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

test("nothing in a field overlaps, crowds the start or the hole, or stands at the edge", () => {
    for (const level of [1, 6, 12]) {
        for (const { field } of made[level]!) {
            const things = [...field.stars, ...field.gates];
            for (const one of things) {
                expect(one.x - one.radius).toBeGreaterThan(20);
                expect(one.y - one.radius).toBeGreaterThan(20);
                expect(one.x + one.radius).toBeLessThan(WIDE - 20);
                expect(one.y + one.radius).toBeLessThan(HIGH - 20);
                expect(Math.hypot(one.x - field.start.x, one.y - field.start.y)).toBeGreaterThan(one.radius + 60);
                expect(Math.hypot(one.x - field.hole.x, one.y - field.hole.y)).toBeGreaterThan(one.radius + field.hole.reach + 60);
                for (const other of things) if (other !== one) expect(Math.hypot(one.x - other.x, one.y - other.y)).toBeGreaterThan(one.radius + other.radius + 40);
            }
            expect(Math.hypot(field.hole.x - field.start.x, field.hole.y - field.start.y)).toBeGreaterThanOrEqual(600);
        }
    }
});

test("a level asks for more than the one before, and the fields show it: a narrower way in, past more stars, never straight at the hole", () => {
    const rows: string[] = [];
    const windows: number[] = [];
    for (let level = 1; level <= 12; level++) {
        const asked = plan(level);
        const fields = made[level]!;
        const window = median(fields.map((one) => one.solution.window));
        const near = fields.reduce((sum, one) => sum + passes(one.field, one.solution), 0) / fields.length;
        const inBand = fields.filter((one) => one.solution.window >= asked.narrowest && one.solution.window <= asked.widest).length / fields.length;
        // how far from the hole the winning shot is aimed, and how often aiming straight at the hole wins at any strength
        const toward = (one: Made) => nearest(one.field.hole.x - one.field.start.x, one.field.hole.y - one.field.start.y);
        const off = median(fields.map((one) => Math.abs((((one.solution.aim - toward(one)) % 720) + 1080) % 720 - 360) / 2));
        const straight = fields.filter((one) => [8, 12, 16, 20, 24, 28, 32, 36, 40].some((notches) => fly(one.field, ...velocity(toward(one), notches)).ended === "won")).length / fields.length;
        windows.push(window);
        rows.push(`| ${level} | ${asked.pullers} | ${asked.pushers} | ${asked.pairs} | ${asked.reach} | ${asked.narrowest.toFixed(1)} to ${asked.widest} | ${window.toFixed(1)} | ${off.toFixed(1)} | ${Math.round(straight * 100)}% | ${near.toFixed(2)} | ${Math.round(inBand * 100)}% |`);
        if (level > 1) {
            const before = plan(level - 1);
            expect(asked.pullers + asked.pushers + asked.pairs).toBeGreaterThanOrEqual(before.pullers + before.pushers + before.pairs);
            expect(asked.reach).toBeLessThanOrEqual(before.reach);
            expect(asked.widest).toBeLessThanOrEqual(before.widest);
        }
        // almost every field is as hard as its level says, and is not won by aiming straight at the hole; the rest are the nearest that could be made
        expect(inBand).toBeGreaterThan(0.9);
        expect(straight).toBeLessThan(0.05);
    }
    console.log(["| level | stars | pushers | wormhole pairs | reach | way in asked (degrees) | way in, median | aimed off the hole, median (degrees) | straight at the hole wins | stars passed within 3 radii | in band |", "|---|---|---|---|---|---|---|---|---|---|---|", ...rows].join("\n"));
    expect(windows[0]!).toBeGreaterThan(windows[3]!);
    expect(windows[3]!).toBeGreaterThan(windows[7]!);
    expect(windows[7]!).toBeGreaterThan(windows[11]!);
});

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
