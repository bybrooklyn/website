// The downsampler: the right number of samples out for the rate, channels averaged, a steady level
// kept, and a block boundary not mattering.

import { describe, expect, test } from "bun:test";
import { createDownsampler, FRAME } from "./resample";

const block = (length: number, value: number) => new Float32Array(length).fill(value);

describe("createDownsampler", () => {
    test("gives one frame for each tenth of a second at 48 kHz", () => {
        const down = createDownsampler(48000);
        const frames = down.push([block(4800, 0.5)]);
        expect(frames).toHaveLength(1);
        expect(frames[0]!).toHaveLength(FRAME);
        expect(frames[0]![10]).toBeCloseTo(0.5);
    });
    test("handles 44.1 kHz, which does not divide evenly", () => {
        const down = createDownsampler(44100);
        let total = 0;
        for (let i = 0; i < 1000; i++) total += down.push([block(441, 0.1)]).length;
        // ten seconds of sound make a hundred frames, give or take the one still filling
        expect(total).toBeGreaterThanOrEqual(99);
        expect(total).toBeLessThanOrEqual(100);
    });
    test("passes 16 kHz through", () => {
        const frames = createDownsampler(16000).push([Float32Array.from({ length: FRAME }, (_, i) => i / FRAME)]);
        expect(frames[0]![800]).toBeCloseTo(0.5);
    });
    test("averages two channels into one", () => {
        const frames = createDownsampler(16000).push([block(FRAME, 1), block(FRAME, 0)]);
        expect(frames[0]![0]).toBeCloseTo(0.5);
    });
    test("is not changed by where the blocks are cut", () => {
        const a = createDownsampler(48000);
        const b = createDownsampler(48000);
        const long = Float32Array.from({ length: 9600 }, (_, i) => Math.sin(i / 30));
        const whole = a.push([long]).flatMap((frame) => [...frame]);
        const pieces = [128, 4000, 3000, 2472].reduce<{ at: number; out: number[] }>(
            (state, size) => ({ at: state.at + size, out: [...state.out, ...b.push([long.slice(state.at, state.at + size)]).flatMap((frame) => [...frame])] }),
            { at: 0, out: [] },
        ).out;
        expect(pieces).toEqual(whole);
    });
    test("gives nothing for no channels", () => {
        expect(createDownsampler(48000).push([])).toEqual([]);
    });
});
