// The table a marble run rolls on is held to carrying marbles: each made run takes every marble let go
// from its hopper to its tray, where they come to rest and sleep; the same run gives the same race to
// the bit; a piece taken away while marbles roll takes its track with it and a marble on it falls; the
// ends of pieces that meet are joined, so that a marble crosses with no rim between them.
// Run with `bun run test`.

import { expect, test } from "bun:test";
import { RUNS } from "./runs";
import { jointsOf, read, type Placed } from "./run";
import { makeTable, type Table } from "./table";

/** Steps a table for `seconds`, letting a marble go from each hopper every `every` seconds until `count` have gone. */
function race(table: Table, count: number, every: number, seconds: number): void {
    let [made, wait] = [0, 0];
    for (let step = 0; step < seconds * 120; step++) {
        wait -= 1 / 120;
        if (made < count && wait <= 0 && table.letGo().length) {
            made++;
            wait = every;
        }
        table.step(1 / 120);
    }
    expect(made).toBe(count);
}

for (const made of RUNS) {
    test(`${made.name}: every marble let go reaches the tray and falls asleep there`, () => {
        const table = makeTable();
        table.set(read(made.text));
        const lost: unknown[] = [];
        table.gone = (marble) => lost.push(marble);
        race(table, 6, 1, 45);
        expect(lost.length).toBe(0);
        expect(table.marbles.length).toBe(6);
        expect(table.marbles.every(table.arrived)).toBe(true);
        expect(table.marbles.every((marble) => marble.rest)).toBe(true);
    }, 120_000);
}

test("the same run gives the same race, to the bit", () => {
    const ending = () => {
        const table = makeTable();
        table.set(read(RUNS[1]!.text));
        race(table, 4, 0.7, 6);
        return table.marbles.flatMap((marble) => [...marble.p, ...marble.v, ...marble.q, ...marble.w]);
    };
    const [one, two] = [ending(), ending()];
    expect(one.length).toBe(4 * 13);
    expect(new Float64Array(two)).toEqual(new Float64Array(one));
}, 60_000);

test("the ends of pieces that meet are joined, and open again when the piece beyond is taken away", () => {
    const run = read(RUNS[0]!.text);
    const table = makeTable();
    table.set(run);
    table.step(1 / 120);
    const solids = () => table.space.solids.filter((solid) => solid.piece?.ends);
    // seven joints meet in a run of eight pieces in a line
    const joined = () => solids().reduce((sum, solid) => sum + Number(solid.piece!.joined[0]) + Number(solid.piece!.joined[1]), 0);
    expect(joined()).toBe(14);
    table.set(run.filter((piece) => piece.id !== 4));
    table.step(1 / 120);
    expect(joined()).toBe(10);
});

test("a piece taken away while a marble rolls on it takes its track away, and the marble falls", () => {
    const run = read(RUNS[0]!.text);
    const table = makeTable();
    table.set(run);
    race(table, 1, 1, 0.8);
    const marble = table.marbles[0]!;
    // the piece under the marble now, by which piece's cells it is over
    const under = run.find((piece) => piece.id === 3)!;
    let guard = 0;
    while (Math.abs(marble.p[0] - (under.place.x * 8 - 8)) > 6 && guard++ < 600) table.step(1 / 120);
    const height = marble.p[1];
    table.set(run.filter((piece: Placed) => piece.id !== under.id));
    for (let step = 0; step < 60; step++) table.step(1 / 120);
    expect(marble.p[1]).toBeLessThan(height - 5);
});

test("a hopper holds a marble at its mouth, lets it go, and another comes out of its box to wait", () => {
    const table = makeTable();
    table.set(read("v1.h0_0_4_0"));
    expect(table.letGo()).toEqual([]);
    for (let step = 0; step < 60; step++) table.step(1 / 120);
    expect(table.held().length).toBe(1);
    const first = table.letGo();
    expect(first.length).toBe(1);
    expect(table.marbles).toEqual(first);
    // straight away the next is on its way out, and a moment later it waits
    expect(table.held().length).toBe(1);
    expect(table.letGo()).toEqual([]);
    for (let step = 0; step < 60; step++) table.step(1 / 120);
    expect(table.letGo().length).toBe(1);
    table.clear();
    expect(table.marbles.length).toBe(0);
});

test("a marble crosses every join of a run with no jolt: the track pushes it no harder near a joint than three times its weight", () => {
    const run = read(RUNS[0]!.text);
    const table = makeTable();
    table.set(run);
    const joints = run.flatMap((piece) => jointsOf(piece));
    let before: number[] | undefined;
    const crossed = new Set<string>();
    let hardest = 0;
    for (let step = 0; step < 20 * 240; step++) {
        if (!table.marbles.length) table.letGo();
        table.step(1 / 240);
        const marble = table.marbles[0];
        if (!marble || table.arrived(marble)) {
            before = undefined;
            continue;
        }
        if (before) {
            // how hard the track pushed it this step, as the change in its velocity less gravity's, in g
            const push = (Math.hypot(marble.v[0] - before[0]!, marble.v[1] - before[1]! + 981 / 240, marble.v[2] - before[2]!) * 240) / 981;
            for (const joint of joints) {
                // the marble's middle sits 0.7 below the line the track is made along
                if (Math.hypot(marble.p[0] - joint.at[0], marble.p[1] + 0.7 - joint.at[1], marble.p[2] - joint.at[2]) > 1) continue;
                crossed.add(`${joint.at}`);
                hardest = Math.max(hardest, push);
            }
        }
        before = [...marble.v];
    }
    // every place two pieces of the run meet, from the hopper's to the tray's
    expect(crossed.size).toBe(7);
    expect(hardest).toBeLessThan(3);
}, 60_000);
