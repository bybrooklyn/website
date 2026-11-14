// Mote's moving parts for a marble run, held to arithmetic: a solid on a hinge swings with the period
// a pendulum has; a hinge with a spring settles where the spring's push and a marble's weight balance;
// a hinge resting on its stop under a marble is held still, falls asleep, and wakes when a marble comes;
// a driven plate carries a marble up at its own steady speed without dropping it or pressing into it; a
// marble never passes through a thin part that turns or moves, however fast either goes; and a scene of
// moving parts gives the same numbers to the bit, run twice and in Chromium as in Bun. Run with
// `bun run test`.

import { expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { browser, chromium } from "../../scripts/browser";
import { block, type V3 } from "./solids";
import { MARBLE, marbleSpace, type Hinge, type Space } from "./space";

const G = 981;

/** A pendulum: a plate 8 cm long hung from a line along z through its top end, let go from `from` radians. */
function pendulum(space: Space, from: number): Hinge {
    const hinge = space.hinge([{ mesh: block([0.3, 4, 1]), at: [0, 0, 0], stuff: { density: 0.6 } }], [0, 4, 0], [0, 0, 1]);
    space.turnTo(hinge, from);
    return hinge;
}

test("a solid on a hinge swings with a pendulum's period, 2 pi root(I / m g d), to a tenth of a percent", () => {
    const space = marbleSpace();
    const from = 0.1;
    const hinge = pendulum(space, from);
    // a box's turning about its middle is m (a^2 + b^2) / 3 for half sizes a and b, and m d^2 more about the line
    const m = 0.6 * 0.6 * 8 * 2;
    const inertia = (m * (0.3 * 0.3 + 4 * 4)) / 3 + m * 16;
    // swung this far, a pendulum is slower than a small swing by about a sixteenth of the angle squared
    const period = 2 * Math.PI * Math.sqrt(inertia / (m * G * 4)) * (1 + (from * from) / 16);
    const crossings: number[] = [];
    let [was, time, widest] = [hinge.angle, 0, 0];
    for (let step = 0; step < 4 * 240; step++) {
        space.step(1 / 240);
        time += 1 / 240;
        if (step > 3 * 240) widest = Math.max(widest, Math.abs(hinge.angle));
        if (was > 0 && hinge.angle <= 0) crossings.push(time - (1 / 240) * (hinge.angle / (hinge.angle - was)));
        was = hinge.angle;
    }
    expect(crossings.length).toBeGreaterThanOrEqual(4);
    const measured = (crossings.at(-1)! - crossings[0]!) / (crossings.length - 1);
    expect(Math.abs(measured / period - 1)).toBeLessThan(0.001);
    // and it keeps its swing: no energy made or lost by the hinge itself
    expect(Math.abs(widest / from - 1)).toBeLessThan(0.01);
});

/** A beam on a hinge through its middle, the same above and below its line, with a notch on top 4 cm out that holds a marble. */
function scale(space: Space, spring: number): Hinge {
    const wall = (x: number, y: number) => ({ mesh: block([0.3, 0.6, 1]), at: [x, y, 0] as V3, stuff: { density: 0.6 } });
    const notch = [3.2 - 0.3, 4.8 + 0.3, -3.2 + 0.3, -4.8 - 0.3];
    return space.hinge([{ mesh: block([6, 0.25, 1]), at: [0, 0, 0], stuff: { density: 0.6 } }, ...notch.map((x) => wall(x, 0.85)), ...notch.map((x) => wall(x, -0.85))], [0, 0, 0], [0, 0, 1], { spring, low: -0.6, high: 0.6, friction: 8 });
}

test("a hinge with a spring settles where the spring's push and a marble's weight balance, to a tenth of a percent", () => {
    const space = marbleSpace();
    const mass = (4 / 3) * Math.PI * 0.8 ** 3 * 2.5;
    // a spring that a marble 4 cm out turns by about a tenth of a radian
    const spring = (mass * G * 4) / 0.1;
    const hinge = scale(space, spring);
    // awake throughout, so that it settles all the way rather than sleeping while it still sways a little
    space.sleeps = false;
    space.ball(0.8, [4, 0.25 + 0.8, 0], MARBLE);
    for (let step = 0; step < 8 * 240; step++) space.step(1 / 240);
    // turned by the angle a, the marble's middle is 4 cos a - 1.05 sin a out: the spring holds that turning push
    const balance = (a: number) => spring * a + mass * G * (4 * Math.cos(a) - 1.05 * Math.sin(a));
    let [low, high] = [-0.3, 0];
    for (let go = 0; go < 60; go++) [low, high] = balance((low + high) / 2) > 0 ? [low, (low + high) / 2] : [(low + high) / 2, high];
    expect(Math.abs(hinge.angle / low - 1)).toBeLessThan(0.001);
});

test("a hinge resting on its stop under a marble is held still, falls asleep with it, and wakes when another marble comes", () => {
    const space = marbleSpace();
    const hinge = scale(space, 0);
    const resting = space.ball(0.8, [4, 0.25 + 0.8, 0], MARBLE);
    const angles: number[] = [];
    for (let step = 0; step < 3 * 240; step++) {
        space.step(1 / 240);
        if (step > 240) angles.push(hinge.angle);
    }
    // on its stop at -0.6, still to a ten thousandth of a radian, and asleep with the marble on it
    expect(Math.abs(angles.at(-1)! + 0.6)).toBeLessThan(0.002);
    expect(Math.max(...angles) - Math.min(...angles)).toBeLessThan(1e-4);
    expect(hinge.parts.every((part) => part.rest)).toBe(true);
    expect(resting.rest).toBeDefined();
    // a heavier marble dropped into the notch on the other arm wakes it, and it tips back the other way
    const [c, s] = [Math.cos(hinge.angle), Math.sin(hinge.angle)];
    space.ball(0.8, [-4 * c - 1.05 * s, -4 * s + 1.05 * c + 1, 0], { ...MARBLE, density: 5.5 });
    let woke = false;
    for (let step = 0; step < 2 * 240; step++) {
        space.step(1 / 240);
        woke ||= hinge.parts.every((part) => !part.rest);
    }
    expect(woke).toBe(true);
    expect(hinge.angle).toBeGreaterThan(0.55);
});

test("a driven plate carries a marble up at its own steady speed, without dropping it or pressing into it", () => {
    const space = marbleSpace();
    const speed = 12;
    let height = 0;
    const plate = space.driven(block([3, 0.3, 3]), [0, 0, 0], (dt) => {
        height += speed * dt;
        return { p: [0, height, 0], q: [0, 0, 0, 1] };
    });
    const marble = space.ball(0.8, [0, 1.1, 0], MARBLE);
    const gaps: number[] = [];
    for (let step = 0; step < 3 * 240; step++) {
        space.step(1 / 240);
        if (step > 120) {
            gaps.push(marble.p[1] - plate.p[1] - 1.1);
            expect(Math.abs(marble.v[1] - speed)).toBeLessThan(0.05 * speed);
        }
    }
    expect(Math.abs(height - 36)).toBeLessThan(1e-9);
    // it rides on the plate: never more than a fortieth of a millimetre into it or off it
    expect(Math.max(...gaps.map(Math.abs))).toBeLessThan(0.025);
    expect(Math.abs(marble.p[0]) + Math.abs(marble.p[2])).toBeLessThan(1e-6);
});

test("a marble never passes through a thin wheel turning fast, nor through a thin plate driven at it", () => {
    let through = 0;
    for (let i = 0; i < 24; i++) {
        const space = marbleSpace();
        space.gravity = [0, 0, 0];
        // a wheel of four plates 3 mm thick, turning 40 radians a second, a marble fired at it from the side
        const arms = [0, 1, 2, 3].map((k) => ({ mesh: block([3, 0.15, 1.5]), at: [3 * Math.cos((k * Math.PI) / 2), 3 * Math.sin((k * Math.PI) / 2), 0] as V3, q: [0, 0, Math.sin((k * Math.PI) / 4), Math.cos((k * Math.PI) / 4)] as [number, number, number, number] }));
        const wheel = space.hinge(arms, [0, 0, 0], [0, 0, 1]);
        wheel.spin = 40;
        const speed = 100 + i * 40;
        const angle = (i * Math.PI) / 12;
        const marble = space.ball(0.8, [-12, 4 * Math.sin(angle), 0], MARBLE);
        marble.v = [speed, 0, 0];
        for (let step = 0; step < 240; step++) space.step(1 / 240);
        // it met an arm and came back, or slipped between them as they turned: never inside one
        for (const arm of wheel.parts) {
            const local = [0, 1, 2].map((axis) => marble.p[axis]! - arm.p[axis]!);
            if (Math.hypot(...local) < 0.8 + 0.1) through++;
        }
    }
    for (let i = 0; i < 12; i++) {
        const space = marbleSpace();
        space.gravity = [0, 0, 0];
        const speed = 200 + i * 100;
        let x = 0;
        // a plate 2 mm thick driven at the marble as it comes the other way
        space.driven(block([0.1, 3, 3]), [0, 0, 0], (dt) => {
            x -= 60 * dt;
            return { p: [x, 0, 0], q: [0, 0, 0, 1] };
        });
        const marble = space.ball(0.8, [-10, 0.5 * i - 2.5, 0], MARBLE);
        marble.v = [speed, 0, 0];
        for (let step = 0; step < 120; step++) space.step(1 / 240);
        if (marble.p[0] > x) through++;
    }
    expect(through).toBe(0);
});

/** A small scene of every kind of moving part, as text, so that the same code runs here and in the browser: a seesaw, a wheel, a lift. */
const scene = (here: string) => `
import { MARBLE, marbleSpace } from "${here}/space.ts";
import { block } from "${here}/solids.ts";
import { cosine, sine } from "${here}/track.ts";
export function race() {
    const space = marbleSpace();
    space.slab([0, -1, 0], [60, 1, 60], undefined, { friction: 0.5, roll: 0.03 });
    const seesaw = space.hinge([{ mesh: block([8, 0.3, 2]), at: [0, 10, 0] }, { mesh: block([0.3, 1, 2]), at: [7.7, 11.3, 0] }], [0, 10, 0], [0, 0, 1], { low: -0.35, high: 0.35, friction: 0.5 });
    const wheel = space.hinge([0, 1, 2].map((k) => ({ mesh: block([2.5, 0.2, 1]), at: [20 + 2.5 * cosine(k * 2.0943951023931953), 8 + 2.5 * sine(k * 2.0943951023931953), 0], q: [0, 0, sine(k * 1.0471975511965976), cosine(k * 1.0471975511965976)] })), [20, 8, 0], [0, 0, 1], { friction: 0.2 });
    let t = 0;
    space.driven(block([2, 0.3, 2]), [-15, 1, 0], (dt) => {
        t += dt;
        const k = t % 4;
        return { p: [-15, 1 + 10 * (k < 2 ? k : 4 - k), 0], q: [0, 0, 0, 1] };
    });
    const marbles = [];
    const bits = new Uint32Array(2);
    const floats = new Float64Array(bits.buffer);
    for (let step = 0; step < 6 * space.rate; step++) {
        if (step % 90 === 0 && marbles.length < 10) {
            const k = marbles.length;
            marbles.push(space.ball(0.8, k % 3 === 0 ? [-6 + k * 0.3, 16, 0.1 * k] : k % 3 === 1 ? [19 + k * 0.1, 14, 0] : [-15, 3, 0], MARBLE));
        }
        space.step(1 / space.rate);
    }
    const numbers = [...marbles.flatMap((m) => [...m.p, ...m.v, ...m.w]), seesaw.angle, seesaw.spin, wheel.angle, wheel.spin];
    return numbers.map((x) => { floats[0] = x; return bits[1].toString(16).padStart(8, "0") + bits[0].toString(16).padStart(8, "0"); }).join(" ");
}
`;

test("a scene of moving parts run twice gives the same numbers to the bit", async () => {
    const folder = await mkdtemp(join(tmpdir(), "mote-parts-"));
    try {
        await Bun.write(join(folder, "race.ts"), scene(import.meta.dir));
        const { race } = (await import(join(folder, "race.ts"))) as { race: () => string };
        const first = race();
        expect(race()).toBe(first);
        expect(new Set(first.split(" ")).size).toBeGreaterThan(20);
    } finally {
        await rm(folder, { recursive: true, force: true });
    }
}, 60_000);

test.skipIf(!chromium())("a scene of moving parts gives the same numbers to the bit in Chromium as in Bun", async () => {
    const folder = await mkdtemp(join(tmpdir(), "mote-parts-"));
    const tab = await browser({ width: 300, height: 200 });
    try {
        await Bun.write(join(folder, "race.ts"), scene(import.meta.dir));
        await Bun.write(join(folder, "page.ts"), `import { race } from "./race.ts"; (window as unknown as { result: string }).result = race();`);
        const built = await Bun.build({ entrypoints: [join(folder, "page.ts")], target: "browser" });
        await Bun.write(join(folder, "page.html"), `<!doctype html><script type="module">${await built.outputs[0]!.text()}</script>`);
        await tab.open(`file://${join(folder, "page.html")}`);
        expect(tab.errors).toEqual([]);
        const there = await tab.run<string>("window.result");
        const { race } = (await import(join(folder, "race.ts"))) as { race: () => string };
        expect(there).toBe(race());
    } finally {
        await tab.close();
        await rm(folder, { recursive: true, force: true });
    }
}, 120_000);
