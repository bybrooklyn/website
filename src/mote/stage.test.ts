// What the stage's loop is held to, measured without a browser: how many fixed steps each frame takes
// at the refresh rates screens have, with the jitter real frame times come with.

import { expect, test } from "bun:test";
import { TICK, paced } from "./stage";

/** The steps taken by each of `count` frames at `hertz`, each frame's time read up to a tenth of a millisecond off. */
function frames(hertz: number, count = 2000): number[] {
    let [owed, last, seed] = [0, 0, 7];
    const jitter = () => ((seed = (seed * 16807) % 2147483647) / 2147483647 - 0.5) * 0.0002;
    return Array.from({ length: count }, (_, frame) => {
        const now = (frame + 1) / hertz + jitter();
        const due = paced(owed, now - last);
        [owed, last] = [due.owed, now];
        return due.steps;
    });
}

test("a screen at 60 Hz takes two steps every frame, at 120 Hz one, and at 240 Hz one every other frame", () => {
    expect(new Set(frames(60))).toEqual(new Set([2]));
    expect(new Set(frames(120))).toEqual(new Set([1]));
    const fast = frames(240);
    expect(fast.every((steps, at) => at === 0 || steps + fast[at - 1]! === 1)).toBe(true);
});

test("at any rate the steps keep time with the clock, and no frame takes more than it must", () => {
    for (const hertz of [50, 60, 75, 90, 120, 144, 165, 240]) {
        const taken = frames(hertz);
        const seconds = taken.length / hertz;
        expect(Math.abs(taken.reduce((sum, steps) => sum + steps, 0) * TICK - seconds)).toBeLessThan(2 * TICK);
        expect(Math.max(...taken)).toBe(Math.ceil(120 / hertz - 1e-9));
    }
});

test("a long pause is not made up, and a time that is not a number or runs backward stops nothing for good", () => {
    expect(paced(0, 3).steps).toBe(6);
    for (const bad of [Number.NaN, -1, -Infinity, Infinity]) {
        const after = paced(0, bad);
        expect(after.steps).toBeLessThanOrEqual(6);
        expect(paced(after.owed, 1 / 60).steps).toBeGreaterThan(0);
    }
    expect(paced(Number.NaN, 1 / 60).steps).toBe(2);
});
