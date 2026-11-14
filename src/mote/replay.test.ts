// Two things both kinds of physics are held to: the same scene run twice ends exactly the same (so
// nothing in a step depends on chance, or on the order things happen to be stored in), and a step with
// a hundred bodies is done well inside the 1/120 s it stands for. A marble race is held to more: it
// ends the same to the bit in Bun (JavaScriptCore) and in Chromium (V8), so that a race is fair and
// can be replayed anywhere. Run with `bun run test`.

import { expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { browser, chromium } from "../../scripts/browser";
import { TICK } from "./stage";
import { Flat } from "./flat";
import { cube } from "./solids";
import { Space } from "./space";

/** Numbers that look random and are the same every time. */
const dealer = (seed: number) => () => (seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 2 ** 32;

/** A hundred blocks and balls dropped into a box. */
function pile(): Flat {
    const flat = new Flat();
    const next = dealer(11);
    flat.wall([[0, 0], [0, 900], [700, 900], [700, 0]]);
    for (let i = 0; i < 100; i++) {
        const [x, y] = [60 + next() * 580, 800 - i * 45];
        if (i % 4 === 0) flat.ball(x, y, 18, { bounce: 0.3 });
        else flat.box(x, y, 36, 36, { angle: next() * 3 });
    }
    return flat;
}

/** Thirty cubes dropped onto a floor, each turning its own way. */
function heap(): Space {
    const space = new Space();
    const next = dealer(5);
    space.slab([0, -1, 0], [30, 1, 30]);
    for (let i = 0; i < 30; i++) {
        const solid = space.solid(cube(), [next() * 6 - 3, 2 + i * 2.4, next() * 6 - 3], { bounce: 0.3 });
        solid.w = [next() * 8 - 4, next() * 8 - 4, next() * 8 - 4];
    }
    return space;
}

/** How long a step takes, in milliseconds: the middle one of many, so that one slow moment does not count. */
function middle(step: () => void, steps: number): number {
    const times: number[] = [];
    for (let i = 0; i < steps; i++) {
        const before = performance.now();
        step();
        times.push(performance.now() - before);
    }
    return times.sort((a, b) => a - b)[steps >> 1]!;
}

test("the same pile of a hundred, run twice, ends the same to the last digit", () => {
    const end = () => {
        const flat = pile();
        for (let i = 0; i < 480; i++) flat.step(TICK);
        return flat.bodies.map((body) => [body.x, body.y, body.a, body.vx, body.vy, body.w]);
    };
    expect(end()).toEqual(end());
});

test("the same heap of thirty solids, run twice, ends the same to the last digit", () => {
    const end = () => {
        const space = heap();
        for (let i = 0; i < 480; i++) space.step(TICK);
        return space.solids.map((solid) => [...solid.p, ...solid.q, ...solid.v, ...solid.w]);
    };
    expect(end()).toEqual(end());
});

test("a step with a hundred bodies in a pile takes less than the time it stands for", () => {
    const flat = pile();
    expect(middle(() => flat.step(TICK), 600)).toBeLessThan(TICK * 1000);
});

test("a step with thirty solids in a heap takes less than the time it stands for", () => {
    const space = heap();
    expect(middle(() => space.step(TICK), 600)).toBeLessThan(TICK * 1000);
});

// A small marble race, as text, so that the same code runs here and in the browser: a sloped gutter
// into a banked spiral, down onto a funnel, twelve marbles let go one after another so that they meet
// on the way, for six seconds. What it gives back is every marble's place, speed and spin, as the bits
// of each number written out in hexadecimal.
const race = (here: string) => `
import { MARBLE, marbleSpace } from "${here}/space.ts";
import { curve, gutter, helix, sweep, turned } from "${here}/track.ts";
export function race() {
    const space = marbleSpace();
    const spiral = helix([0, 40, 0], 14, -6, 1.75, { from: [-1, 0, 0] });
    const start = spiral.point(0);
    const ramp = curve([[start[0] - 1, start[1] + 12, start[2] - 50], [start[0], start[1] + 3, start[2] - 15], start], { start: [0, -0.3, 1], end: spiral.speed(0) });
    space.track(sweep(ramp, gutter(1.6, Math.PI * 1.1, 0.2), { level: true }));
    space.track(sweep(spiral, gutter(1.6, Math.PI * 1.1, 0.2), { level: true, bank: [0, -0.3, -0.3, -0.3] }));
    space.track(turned([0, 0, 0], [[2.2, 0], [9, 4], [18, 10], [26, 17]], 0.3));
    const marbles = [];
    const bits = new Uint32Array(2);
    const floats = new Float64Array(bits.buffer);
    for (let step = 0; step < 6 * space.rate; step++) {
        if (step % 25 === 0 && marbles.length < 12) {
            const f = ramp.point(1 + (marbles.length % 3) * 0.7);
            marbles.push(space.ball(0.8, [f[0], f[1] - 0.55, f[2]], MARBLE));
        }
        space.step(1 / space.rate);
    }
    return marbles.flatMap((m) => [...m.p, ...m.v, ...m.w]).map((x) => { floats[0] = x; return bits[1].toString(16).padStart(8, "0") + bits[0].toString(16).padStart(8, "0"); }).join(" ");
}
`;

test("a marble race run twice ends the same to the bit", async () => {
    const folder = await mkdtemp(join(tmpdir(), "mote-race-"));
    try {
        await Bun.write(join(folder, "race.ts"), race(import.meta.dir));
        const { race: run } = (await import(join(folder, "race.ts"))) as { race: () => string };
        const first = run();
        expect(run()).toBe(first);
        // and the marbles did race: they are spread out over the track, not all in one place
        expect(new Set(first.split(" ")).size).toBeGreaterThan(100);
    } finally {
        await rm(folder, { recursive: true, force: true });
    }
}, 60_000);

test.skipIf(!chromium())("a marble race ends the same to the bit in Chromium as in Bun", async () => {
    const folder = await mkdtemp(join(tmpdir(), "mote-race-"));
    const tab = await browser({ width: 300, height: 200 });
    try {
        await Bun.write(join(folder, "race.ts"), race(import.meta.dir));
        await Bun.write(join(folder, "page.ts"), `import { race } from "./race.ts"; (window as unknown as { result: string }).result = race();`);
        const built = await Bun.build({ entrypoints: [join(folder, "page.ts")], target: "browser" });
        await Bun.write(join(folder, "page.html"), `<!doctype html><script type="module">${await built.outputs[0]!.text()}</script>`);
        await tab.open(`file://${join(folder, "page.html")}`);
        expect(tab.errors).toEqual([]);
        const there = await tab.run<string>("window.result");
        const { race: run } = (await import(join(folder, "race.ts"))) as { race: () => string };
        expect(there).toBe(run());
    } finally {
        await tab.close();
        await rm(folder, { recursive: true, force: true });
    }
}, 120_000);
