// Tests for races: the same run and number give the same race every time, to the bit, in Bun and in
// Chromium; the racers stand in a line drawn from the number behind a starting gate that lets them
// through one at a time at the hopper's pace, each with its own look, every clock started at the first
// opening; several hoppers are dealt the line in turn and their gates keep step; a marble that falls or
// stops does not finish; a race in the line's order is said to be so.

import { expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { browser, chromium } from "../../scripts/browser";
import { DRAWN, RACE, RACERS, SETTLE, drawnOf, inLine, lineOf, makeRace, progress, runRace, standing, timeOf } from "./race";
import { fit, jointsOf, read, type Placed } from "./run";
import { RUNS } from "./runs";
import { PACE, makeTable } from "./table";
import type { Kind } from "./pieces";

const kind = (family: Kind["family"], sizes: number[] = []): Kind => ({ family, sizes, mirror: false });

/** A run from a hopper at a level, each piece's first joint on the last joint of the piece before. */
function chain(level: number, kinds: Kind[], at: { x: number; z: number } = { x: 0, z: 0 }, first = 1): Placed[] {
    const run: Placed[] = [{ id: first, kind: kind("h"), place: { x: at.x, z: at.z, y: level, turn: 0 } }];
    for (const one of kinds) run.push({ id: first + run.length, kind: one, place: fit(one, 0, jointsOf(run.at(-1)!).at(-1)!)! });
    return run;
}

/** Every racer's time and every marble's place and speed, as the bits of each number. */
function bitsOf(text: string, count: number, drawn = 1): string {
    const table = makeTable();
    table.set(read(text));
    const race = runRace(table, count, drawn);
    const bits = new Uint32Array(2);
    const floats = new Float64Array(bits.buffer);
    const numbers = [...race.racers.map((racer) => racer.time ?? -1), ...table.marbles.flatMap((marble) => [...marble.p, ...marble.v])];
    return numbers.map((x) => ((floats[0] = x), bits[1]!.toString(16).padStart(8, "0") + bits[0]!.toString(16).padStart(8, "0"))).join(" ");
}

const raced = RUNS.filter((made) => read(made.text).some((piece) => piece.kind.family === "t"));

test("the same run gives the same race every time, to the bit: every time, place and speed", () => {
    for (const made of raced) for (const count of [4, 8]) expect(bitsOf(made.text, count, count * 50 + 3)).toBe(bitsOf(made.text, count, count * 50 + 3));
}, 120_000);

test.skipIf(!chromium())("the same run gives the same race in Chromium as in Bun, to the bit", async () => {
    const folder = await mkdtemp(join(tmpdir(), "marbles-race-"));
    const tab = await browser({ width: 300, height: 200 });
    try {
        await Bun.write(join(folder, "page.ts"), `
import { makeTable } from "${import.meta.dir}/table.ts";
import { runRace } from "${import.meta.dir}/race.ts";
import { read } from "${import.meta.dir}/run.ts";
import { RUNS } from "${import.meta.dir}/runs.ts";
const bitsOf = ${bitsOf.toString()};
(window as unknown as { result: string[] }).result = RUNS.filter((made) => read(made.text).some((piece) => piece.kind.family === "t")).flatMap((made) => [4, 8].map((count) => bitsOf(made.text, count)));
`);
        const built = await Bun.build({ entrypoints: [join(folder, "page.ts")], target: "browser" });
        expect(built.success).toBe(true);
        await Bun.write(join(folder, "page.html"), `<!doctype html><script type="module">${await built.outputs[0]!.text()}</script>`);
        await tab.open(`file://${join(folder, "page.html")}`);
        expect(tab.errors).toEqual([]);
        const there = await tab.run<string[]>("window.result");
        const here = raced.flatMap((made) => [4, 8].map((count) => bitsOf(made.text, count)));
        expect(there.length).toBe(raced.length * 2);
        expect(there).toEqual(here);
    } finally {
        await tab.close();
        await rm(folder, { recursive: true, force: true });
    }
}, 240_000);

test("a line is drawn from a number: every racer once, the same line for the same number, and the numbers give many lines", () => {
    for (const count of [2, 5, 8]) {
        for (const drawn of [1, 2, 417, 999]) {
            expect([...lineOf(count, drawn)].sort((a, b) => a - b)).toEqual(Array.from({ length: count }, (_, i) => i));
            expect(lineOf(count, drawn)).toEqual(lineOf(count, drawn));
        }
    }
    const lines = new Set(Array.from({ length: DRAWN[1] }, (_, i) => lineOf(8, i + 1).join("")));
    expect(lines.size).toBeGreaterThan(900);
    // each racer stands at the front about as often as any other
    const fronts = Array.from({ length: 8 }, (_, racer) => Array.from({ length: DRAWN[1] }, (_, i) => lineOf(8, i + 1)[0]).filter((one) => one === racer).length);
    expect(Math.min(...fronts)).toBeGreaterThan(90);
    expect(Math.max(...fronts)).toBeLessThan(160);
});

test("a race lines up the number asked, two to eight, in the order drawn, each with a look and a name of its own; the gate holds them, then lets them through one at a time at the hopper's pace, every clock started at its first opening", () => {
    expect(RACERS.length).toBe(RACE[1]);
    expect(new Set(RACERS.map((racer) => racer.name)).size).toBe(RACERS.length);
    expect(new Set(RACERS.map((racer) => `${racer.seed} ${racer.tints.flat().join(",")}`)).size).toBe(RACERS.length);
    for (const asked of [1, 2, 5, 8, 12]) {
        const table = makeTable();
        table.set(read(RUNS[0]!.text));
        const count = Math.max(RACE[0], Math.min(RACE[1], asked));
        const race = makeRace(table, asked, 40 + asked);
        expect(race.racers.length).toBe(count);
        expect(race.racers.map((racer) => racer.name)).toEqual(RACERS.slice(0, count).map((one) => one.name));
        const line = lineOf(count, 40 + asked);
        expect(race.racers.map((racer) => line[racer.lined])).toEqual(race.racers.map((racer) => racer.index));
        // standing behind the gate: the gate is a body in the table, and the line is held where it is until it opens
        const [gate] = table.movers().find((one) => one.id === table.mouths()[0]!.id)!.solids;
        const before = race.racers.map((racer) => [...racer.marble!.p] as [number, number, number]);
        const shut = gate!.p[1];
        while (race.clock < SETTLE - 1e-9) race.step(1 / 120);
        race.racers.forEach((racer, i) => expect(racer.marble!.p).toEqual(before[i]!));
        // the front marble waits where a hopper's marble waits, and each of the rest more than a marble's width from the one before
        const front = race.racers.find((racer) => racer.lined === 0)!.marble!.p;
        expect(front).toEqual(table.mouths()[0]!.at);
        const waiting = [...race.racers].sort((a, b) => a.lined - b.lined).map((racer) => racer.marble!.p);
        for (let i = 1; i < waiting.length; i++) expect(Math.hypot(...waiting[i]!.map((x, axis) => x - waiting[i - 1]![axis]!))).toBeGreaterThan(2 * 0.8);
        // the gate rises for each and comes down again behind it
        let highest = 0;
        while (!race.done) {
            race.step(1 / 120);
            highest = Math.max(highest, gate!.p[1] - shut);
        }
        expect(highest).toBeGreaterThan(3.5);
        expect(gate!.p[1] - shut).toBeCloseTo(0, 9);
        race.racers.forEach((racer) => expect(racer.left).toBeCloseTo(SETTLE, 9));
        race.racers.forEach((racer) => expect(racer.leftAt).toBeCloseTo(SETTLE + racer.lined * PACE, 9));
        // one lane and nothing to mix them: they all finish, in the line's order, each a hopper's pace behind the one before
        expect(race.racers.every((racer) => racer.time !== undefined)).toBe(true);
        expect(inLine(race)).toBe(true);
        const byLine = [...race.racers].sort((a, b) => a.lined - b.lined);
        for (let i = 1; i < byLine.length; i++) expect(byLine[i]!.time! - byLine[i - 1]!.time!).toBeCloseTo(PACE, 2);
    }
});

test("with several hoppers, the line is dealt to them in turn in the run's order and their gates keep step; the first tray reached counts", () => {
    const lane = [kind("d", [2, 2]), kind("d", [2, 2]), kind("s", [1]), kind("t")];
    const run = [...chain(12, lane, { x: 0, z: 0 }, 1), ...chain(12, lane, { x: 0, z: 6 }, 10)];
    const table = makeTable();
    table.set(run);
    const race = runRace(table, 5, 7);
    const byLine = [...race.racers].sort((a, b) => a.lined - b.lined);
    expect(byLine.map((racer) => racer.hopper)).toEqual([1, 10, 1, 10, 1]);
    expect(new Set(race.racers.map((racer) => racer.left)).size).toBe(1);
    expect(byLine.map((racer) => Math.round((racer.leftAt! - SETTLE) / PACE))).toEqual([0, 0, 1, 1, 2]);
    expect(race.racers.every((racer) => racer.time !== undefined)).toBe(true);
    // the two lanes are the same, moved: the fronts of the two lines take the same time to within a hundredth
    expect(Math.abs(byLine[0]!.time! - byLine[1]!.time!)).toBeLessThan(0.01);
});

test("a marble that leaves the track, or stops, does not finish, and says why; a run with no hopper has no race", () => {
    const table = makeTable();
    table.set(chain(10, [kind("d", [2, 2]), kind("s", [1])]));
    const race = runRace(table, 2);
    expect(race.racers.map((racer) => racer.out)).toEqual(["fell", "fell"]);
    expect(standing(race).every((one) => one.time === undefined)).toBe(true);
    const level = makeTable();
    level.set(chain(4, [kind("s", [6]), kind("s", [6]), kind("s", [6]), kind("s", [6]), kind("t")]));
    expect(runRace(level, 2).racers.map((racer) => racer.out)).toEqual(["stopped", "stopped"]);
    const none = makeTable();
    none.set([]);
    expect(makeRace(none, 3).done).toBe(true);
}, 60_000);

test("the result: by time, two within a hundredth marked close, times to the hundredth; in the line's order when those that finished did so in the order they stood", () => {
    const table = makeTable();
    table.set(read(RUNS[0]!.text));
    const race = makeRace(table, 4);
    for (const racer of race.racers) racer.lined = racer.index;
    race.racers[0]!.time = 3.456;
    race.racers[1]!.time = 3.2;
    race.racers[2]!.time = 3.209;
    race.racers[3]!.out = "fell";
    race.done = true;
    const placed = standing(race);
    expect(placed.map((one) => one.racer.index)).toEqual([1, 2, 0, 3]);
    expect(placed.map((one) => one.close)).toEqual([true, true, false, false]);
    expect(timeOf(3.456)).toBe("3.46 s");
    expect(inLine(race)).toBe(false);
    // those that finished, in the order they stood, even with one out
    [race.racers[0]!.time, race.racers[1]!.time, race.racers[2]!.time] = [3.1, 3.2, 3.205];
    expect(inLine(race)).toBe(true);
    race.racers[3]!.out = undefined;
    [race.racers[0]!.time, race.racers[1]!.time, race.racers[2]!.time, race.racers[3]!.time] = [3.1, 3.2, 3.205, 3.5];
    expect(inLine(race)).toBe(true);
    // two the same to the bit: the one nearer the front of the line first
    race.racers[2]!.time = 3.2;
    expect(standing(race).map((one) => one.racer.index)).toEqual([0, 1, 2, 3]);
});

test("how far along a way a point is, by the nearest of its places", () => {
    const way: [number, number, number][] = [[0, 0, 0], [3, 0, 0], [3, 4, 0], [3, 4, 10]];
    expect(progress(way, [3.2, 3.9, 0.1])).toBeCloseTo(7, 9);
    expect(progress(way, [-5, 0, 0])).toBe(0);
});

test("a line typed in the box is run by the nearest number a line can be drawn by, which the box then shows", () => {
    // what the tester typed: 0, 1500, nothing, 3.7
    expect([0, 1500, Number(""), 3.7, 417].map(drawnOf)).toEqual([1, 999, 1, 4, 417]);
});
