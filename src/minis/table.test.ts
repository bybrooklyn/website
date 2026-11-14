// The table a marble run rolls on is held to carrying marbles: each made run takes every marble let go
// from its hopper to its tray, where they come to rest and sleep; the same run gives the same race to
// the bit; a piece taken away while marbles roll takes its track with it and a marble on it falls; the
// ends of pieces that meet are joined, so that a marble crosses with no rim between them; and a run of
// bent pieces is rolled as smoothly as a made one, at its joints and its points, the same every time.
// Run with `bun run test`.

import { expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { browser, chromium } from "../../scripts/browser";
import { pointsIn } from "./pieces";
import { RUNS } from "./runs";
import { jointsOf, read, type Placed } from "./run";
import { makeTable, type Table } from "./table";
import type { Solid } from "../mote/space";
import type { V3 } from "../mote/solids";

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

/** A run of long pieces down from a hopper, and the same run with every piece that bends bent gently, down, aside, or both. */
const PLAIN = "v2.h0_0_22_0.s1_0_1_22_2.d2_1_-1_1_22_2.s6_-3_1_21_2.c3_1_-9_1_21_2.s6_-11_-1_21_3.c3_1_-11_-7_21_3.d3_1_-9_-9_21_0.s3_-6_-9_20_0.t-3_-9_20_0";
const BENT = "v2.h0_0_22_0.s1_0_1_22_2.d2_1_-1_1_22_2b-8_0_-6_0.s6_-3_1_21_2b-15_0_-25_0_-15_0.c3_1_-9_1_21_2b-8_6_-8_6.s6_-11_-1_21_3b0_20_0_30_0_20.c3_1_-11_-7_21_3b-8_0_-8_0.d3_1_-9_-9_21_0b-10_0_-10_0.s3_-6_-9_20_0b-15_8_-15_-8.t-3_-9_20_0";

/** One marble down a run at 240 steps a second: the track's hardest push on it near a joint, near a point of a bent piece, and anywhere on a piece but the tray; and the most it changed from one step to the next, in g. */
function pushes(text: string) {
    const run = read(text);
    const table = makeTable();
    table.set(run);
    const joints = run.flatMap((piece) => jointsOf(piece));
    const points = run.flatMap((piece) => pointsIn(piece.kind, piece.place));
    const tray = run.at(-1)!.id;
    const near = (marble: Solid, at: V3) => Math.hypot(marble.p[0] - at[0], marble.p[1] + 0.7 - at[1], marble.p[2] - at[2]) <= 1;
    const found = { joint: 0, point: 0, most: 0, change: 0, joints: new Set<string>(), arrived: false };
    let before: number[] | undefined;
    let last: number | undefined;
    for (let step = 0; step < 25 * 240 && !found.arrived; step++) {
        if (!table.marbles.length) table.letGo();
        table.step(1 / 240);
        const marble = table.marbles[0];
        if (!marble) continue;
        found.arrived = table.arrived(marble);
        const on = table.pieceAt(marble.p);
        if (before && on !== undefined && on !== tray) {
            const push = (Math.hypot(marble.v[0] - before[0]!, marble.v[1] - before[1]! + 981 / 240, marble.v[2] - before[2]!) * 240) / 981;
            found.most = Math.max(found.most, push);
            if (last !== undefined) found.change = Math.max(found.change, Math.abs(push - last));
            last = push;
            for (const joint of joints) {
                if (!near(marble, joint.at)) continue;
                found.joints.add(`${joint.at}`);
                found.joint = Math.max(found.joint, push);
            }
            for (const point of points) if (near(marble, point.at)) found.point = Math.max(found.point, push);
        }
        before = [...marble.v];
    }
    return found;
}

test("a marble rolls a bent run as smoothly as a made one: no harder push near a joint of a bent piece than 2.5 times its weight, none near a bent piece's points, and the push never jumping from one step to the next", () => {
    const [plain, bent] = [pushes(PLAIN), pushes(BENT)];
    for (const one of [plain, bent]) {
        expect(one.arrived).toBe(true);
        // every joint of the run crossed, the hopper's to the tray's
        expect(one.joints.size).toBe(9);
    }
    // measured: the made run 1.18 g near a joint and 1.47 at most, the push changing by 0.24 g a step at
    // most; bent, 1.53 near a joint, 1.82 near a point, 2.0 at most (a curve bent down and in), 0.28 a step
    expect(bent.joint).toBeLessThan(2.5);
    expect(bent.point).toBeLessThan(2.5);
    expect(bent.most).toBeLessThan(2.5);
    expect(bent.change).toBeLessThan(0.4);
    expect(bent.change).toBeLessThan(plain.change + 0.15);
}, 60_000);

test.skipIf(!chromium())("a bent run gives the same race in Chromium as in Bun, to the bit", async () => {
    const folder = await mkdtemp(join(tmpdir(), "marbles-bent-"));
    const tab = await browser({ width: 300, height: 200 });
    try {
        // the same race, as text, so that the same code runs here and in the browser: every marble's place, speed and spin as the bits of each number
        await Bun.write(join(folder, "race.ts"), `
import { makeTable } from "${import.meta.dir}/table.ts";
import { read } from "${import.meta.dir}/run.ts";
export function race() {
    const table = makeTable();
    table.set(read(${JSON.stringify(BENT)}));
    let [made, wait] = [0, 0];
    for (let step = 0; step < 6 * 120; step++) {
        wait -= 1 / 120;
        if (made < 4 && wait <= 0 && table.letGo().length) [made, wait] = [made + 1, 0.7];
        table.step(1 / 120);
    }
    const bits = new Uint32Array(2);
    const floats = new Float64Array(bits.buffer);
    return table.marbles.flatMap((m) => [...m.p, ...m.v, ...m.w]).map((x) => { floats[0] = x; return bits[1].toString(16).padStart(8, "0") + bits[0].toString(16).padStart(8, "0"); }).join(" ");
}
`);
        await Bun.write(join(folder, "page.ts"), `import { race } from "./race.ts"; (window as unknown as { result: string }).result = race();`);
        const built = await Bun.build({ entrypoints: [join(folder, "page.ts")], target: "browser" });
        await Bun.write(join(folder, "page.html"), `<!doctype html><script type="module">${await built.outputs[0]!.text()}</script>`);
        await tab.open(`file://${join(folder, "page.html")}`);
        expect(tab.errors).toEqual([]);
        const there = await tab.run<string>("window.result");
        const { race } = (await import(join(folder, "race.ts"))) as { race: () => string };
        expect(there.split(" ").length).toBe(4 * 9);
        expect(there).toBe(race());
    } finally {
        await tab.close();
        await rm(folder, { recursive: true, force: true });
    }
}, 120_000);

test("a bent run gives the same race every time, to the bit", () => {
    const ending = () => {
        const table = makeTable();
        table.set(read(BENT));
        race(table, 4, 0.7, 8);
        return table.marbles.flatMap((marble) => [...marble.p, ...marble.v, ...marble.q, ...marble.w]);
    };
    const [one, two] = [ending(), ending()];
    expect(one.length).toBe(4 * 13);
    expect(new Float64Array(two)).toEqual(new Float64Array(one));
}, 60_000);
