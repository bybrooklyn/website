// Sand's stepping keeps to a budget each frame: the first step always, more only while they fit, so a
// world whose steps are dear runs slower rather than making every frame later than the last.
import { expect, test } from "bun:test";
import { STEP_BUDGET, stepFits } from "./sand-core";

test("the first step of a frame is always taken", () => {
    expect(stepFits(0, 0)).toBe(true);
    expect(stepFits(0, 100)).toBe(true);
});

test("cheap steps catch up; a dear one stops the frame's stepping", () => {
    // a still world: steps of a millisecond, so several fit
    expect(stepFits(1, 1)).toBe(true);
    expect(stepFits(3, 3)).toBe(true);
    // a forest on fire: one step of 10 ms, and a second would take the frame past its budget
    expect(stepFits(1, 10)).toBe(false);
    // two of 4 ms fit, a third would not
    expect(stepFits(1, 4)).toBe(true);
    expect(stepFits(2, 8)).toBe(false);
    expect(STEP_BUDGET).toBeLessThan(16);
});
