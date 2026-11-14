// Undo for the marble run is held to being without loss: over a thousand changes, undos and redos made
// at random, going all the way back gives the first run and all the way forward the last, at every step
// the same text as was recorded there; a change after an undo drops what was undone; what is kept in the
// browser is the newest steps that fit, read back the same. Run with `bun run test`.

import { expect, test } from "bun:test";
import { begun, canRedo, canUndo, readSteps, recorded, redone, trimmed, undone } from "./history";
import { read, write, type Placed } from "./run";
import { RUNS } from "./runs";

/** A small generator of numbers that is the same every run. */
function chance(seed: number) {
    return () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
}

test("a thousand changes, undos and redos at random: every step back and forward is the run as it was then", () => {
    const next = chance(7);
    let run: Placed[] = read(RUNS[2]!.text);
    let steps = begun(write(run));
    /** What the run's text should be at each step, kept by the test itself. */
    let shadow = [write(run)];
    let at = 0;
    for (let i = 0; i < 1000; i++) {
        const roll = next();
        if (roll < 0.25 && canUndo(steps)) {
            steps = undone(steps);
            at--;
        } else if (roll < 0.4 && canRedo(steps)) {
            steps = redone(steps);
            at++;
        } else {
            // a change: a piece moved a cell, taken away, or added
            run = read(steps.texts[steps.at]!);
            const which = Math.floor(next() * Math.max(1, run.length));
            if (next() < 0.3 && run.length > 1) run = run.filter((_, index) => index !== which);
            else if (next() < 0.5 || !run.length) run = [...run, { id: 0, kind: { family: "s", sizes: [1], mirror: false }, place: { x: Math.floor(next() * 30) - 15, z: Math.floor(next() * 30) - 15, y: 1, turn: 0 } }];
            else run = run.map((piece, index) => (index === which ? { ...piece, place: { ...piece.place, x: piece.place.x + 1 } } : piece));
            const text = write(run);
            steps = recorded(steps, text);
            if (shadow[at] !== text) {
                shadow = [...shadow.slice(0, at + 1), text];
                at++;
            }
        }
        expect(steps.texts[steps.at]).toBe(shadow[at]!);
    }
    const last = steps.texts[steps.at];
    while (canUndo(steps)) steps = undone(steps);
    expect(steps.texts[steps.at]).toBe(write(read(RUNS[2]!.text)));
    while (canRedo(steps)) steps = redone(steps);
    expect(steps.texts[steps.at]).toBe(shadow.at(-1)!);
    expect(steps.texts.length).toBe(shadow.length);
    expect(typeof last).toBe("string");
});

test("a change after an undo drops what was undone; the same run again is no step", () => {
    let steps = recorded(recorded(begun("v1"), "v1.s1_0_0_1_0"), "v1.s1_0_0_1_0.s1_1_0_1_0");
    steps = undone(steps);
    expect(canRedo(steps)).toBe(true);
    steps = recorded(steps, "v1.s1_0_0_1_0");
    expect(canRedo(steps)).toBe(true);
    steps = recorded(steps, "v1.s2_0_0_1_0");
    expect(steps.texts).toEqual(["v1", "v1.s1_0_0_1_0", "v1.s2_0_0_1_0"]);
    expect(canRedo(steps)).toBe(false);
    expect(undone(begun("v1")).at).toBe(0);
});

test("what is kept in the browser is the newest steps that fit, with the one shown and those after it, and reads back the same", () => {
    let steps = begun("v1");
    for (let i = 0; i < 100; i++) steps = recorded(steps, `v1.s1_${i}_0_1_0`);
    steps = undone(undone(steps));
    const kept = trimmed(steps, 200);
    expect(kept.texts.join("").length).toBeLessThanOrEqual(200);
    expect(kept.texts.at(-1)).toBe(steps.texts.at(-1));
    expect(kept.texts[kept.at]).toBe(steps.texts[steps.at]);
    expect(trimmed(steps).texts.length).toBe(101);
    expect(readSteps(JSON.parse(JSON.stringify(kept)))).toEqual(kept);
    for (const wrong of [undefined, null, 3, { texts: [], at: 0 }, { texts: ["v1"], at: 1 }, { texts: [4], at: 0 }]) expect(readSteps(wrong)).toBeUndefined();
});
