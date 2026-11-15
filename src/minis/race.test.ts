// Tests for races: the same run gives the same race every time, to the bit, in Bun and in Chromium;
// marbles are let go in their order, each with its own look; several hoppers are dealt marbles in turn
// and let go together; a marble that falls or stops does not finish; a photo finish is said.

import { expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { browser, chromium } from "../../scripts/browser";
import { RACE, RACERS, ROUND, makeRace, progress, runRace, standing, timeOf } from "./race";
import { fit, jointsOf, read, type Placed } from "./run";
import { RUNS } from "./runs";
import { makeTable } from "./table";
import type { Kind } from "./pieces";

const kind = (family: Kind["family"], sizes: number[] = []): Kind => ({ family, sizes, mirror: false });

/** A run from a hopper at a level, each piece's first joint on the last joint of the piece before. */
function chain(level: number, kinds: Kind[], at: { x: number; z: number } = { x: 0, z: 0 }, first = 1): Placed[] {
    const run: Placed[] = [{ id: first, kind: kind("h"), place: { x: at.x, z: at.z, y: level, turn: 0 } }];
    for (const one of kinds) run.push({ id: first + run.length, kind: one, place: fit(one, 0, jointsOf(run.at(-1)!).at(-1)!)! });
    return run;
}

/** Every racer's time and every marble's place and speed, as the bits of each number. */
function bitsOf(text: string, count: number): string {
    const table = makeTable();
    table.set(read(text));
    const race = runRace(table, count);
    const bits = new Uint32Array(2);
    const floats = new Float64Array(bits.buffer);
    const numbers = [...race.racers.map((racer) => racer.time ?? -1), ...table.marbles.flatMap((marble) => [...marble.p, ...marble.v])];
    return numbers.map((x) => ((floats[0] = x), bits[1]!.toString(16).padStart(8, "0") + bits[0]!.toString(16).padStart(8, "0"))).join(" ");
}

const raced = RUNS.filter((made) => read(made.text).some((piece) => piece.kind.family === "t"));

test("the same run gives the same race every time, to the bit: every time, place and speed", () => {
    for (const made of raced) for (const count of [4, 8]) expect(bitsOf(made.text, count)).toBe(bitsOf(made.text, count));
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

test("a race lets go the number asked, two to eight, in order from the hopper a round apart, each with a look and a name of its own", () => {
    expect(RACERS.length).toBe(RACE[1]);
    expect(new Set(RACERS.map((racer) => racer.name)).size).toBe(RACERS.length);
    expect(new Set(RACERS.map((racer) => `${racer.seed} ${racer.tints.flat().join(",")}`)).size).toBe(RACERS.length);
    for (const asked of [1, 2, 5, 8, 12]) {
        const table = makeTable();
        table.set(read(RUNS[0]!.text));
        const race = runRace(table, asked);
        const count = Math.max(RACE[0], Math.min(RACE[1], asked));
        expect(race.racers.length).toBe(count);
        expect(race.racers.map((racer) => racer.name)).toEqual(RACERS.slice(0, count).map((one) => one.name));
        race.racers.forEach((racer, i) => expect(racer.left).toBeCloseTo(ROUND * (i + 1), 9));
        // one lane and nothing to part them: they all take the same time, a photo finish
        expect(race.racers.every((racer) => racer.time !== undefined)).toBe(true);
        expect(standing(race).every((one) => one.close)).toBe(true);
    }
});

test("with several hoppers, marbles are dealt to them in turn in the run's order and each round is let go together; the first tray reached counts", () => {
    const lane = [kind("d", [2, 2]), kind("d", [2, 2]), kind("s", [1]), kind("t")];
    const run = [...chain(12, lane, { x: 0, z: 0 }, 1), ...chain(12, lane, { x: 0, z: 6 }, 10)];
    const table = makeTable();
    table.set(run);
    const race = runRace(table, 5);
    expect(race.racers.map((racer) => racer.hopper)).toEqual([1, 10, 1, 10, 1]);
    expect(race.racers.map((racer) => racer.round)).toEqual([0, 0, 1, 1, 2]);
    expect(race.racers[0]!.left).toBe(race.racers[1]!.left!);
    expect(race.racers.every((racer) => racer.time !== undefined)).toBe(true);
    // the two lanes are the same, moved: each lane's marble alone takes the same time to within a hundredth
    expect(Math.abs(race.racers[0]!.time! - race.racers[1]!.time!)).toBeLessThan(0.01);
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

test("the result: by time, a photo finish where two are within a hundredth, times to the hundredth", () => {
    const table = makeTable();
    table.set(read(RUNS[0]!.text));
    const race = makeRace(table, 4);
    race.racers[0]!.time = 3.456;
    race.racers[1]!.time = 3.2;
    race.racers[2]!.time = 3.209;
    race.racers[3]!.out = "fell";
    const placed = standing(race);
    expect(placed.map((one) => one.racer.index)).toEqual([1, 2, 0, 3]);
    expect(placed.map((one) => one.close)).toEqual([true, true, false, false]);
    expect(timeOf(3.456)).toBe("3.46 s");
});

test("how far along a way a point is, by the nearest of its places", () => {
    const way: [number, number, number][] = [[0, 0, 0], [3, 0, 0], [3, 4, 0], [3, 4, 10]];
    expect(progress(way, [3.2, 3.9, 0.1])).toBeCloseTo(7, 9);
    expect(progress(way, [-5, 0, 0])).toBe(0);
});
