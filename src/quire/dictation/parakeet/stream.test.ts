// Tests of stream.ts with a made-up encoder and decoder: that sound already settled is never
// decoded twice, that the tail is decoded on a copy and so can change, that a step waits for enough
// new sound, and that finishing covers everything to the end of the sound.

import { describe, expect, test } from "bun:test";
import type { Decoder, DecodeState } from "./decode";
import { createStream } from "./stream";

/** A decoder that writes one word for each run it is given, named for the frames it covered. */
function fakeDecoder() {
    const runs: { from: number; frames: number; real: boolean }[] = [];
    const real = new Set<DecodeState>();
    const decoder: Decoder = {
        start() {
            const state: DecodeState = { prediction: { layers: 1, hidden: 1, h: new Float32Array(1), c: new Float32Array(1) }, token: 0, skip: 0, frame: 0, open: null };
            real.add(state);
            return state;
        },
        finish: () => null,
        async decode(_encoded, frames, _width, state) {
            runs.push({ from: state.frame, frames, real: real.has(state) });
            const word = { text: `${state.frame}-${state.frame + frames}`, from: state.frame, to: state.frame + frames, confidence: 1 };
            state.frame += frames;
            return { tokens: [], words: [word], state };
        },
    };
    return { decoder, runs };
}

/** An encoder that gives one frame of width 2 for every 8 feature frames, and records the window it was given. */
function fakeEncoder() {
    const windows: number[] = [];
    /** The first number of each window as the encoder got it, normalized. */
    const starts: number[] = [];
    return {
        windows,
        starts,
        encode: async (data: Float32Array, _bins: number, frames: number) => {
            windows.push(frames);
            starts.push(data[0]!);
            const steps = Math.floor((frames - 1) / 8) + 1;
            return { data: new Float32Array(steps * 2), frames: steps, width: 2 };
        },
    };
}

const second = () => new Float32Array(16000).map((_, at) => Math.sin(at * 0.05) * 0.2);

describe("a stream", () => {
    test("waits for a chunk of new sound before it steps", async () => {
        const { decoder } = fakeDecoder();
        const encoder = fakeEncoder();
        const stream = createStream({ bins: 80, encode: encoder.encode, decoder }, { chunk: 1 });
        expect(await stream.push(second().subarray(0, 8000))).toBeUndefined();
        expect(encoder.windows.length).toBe(0);
        expect(await stream.push(second().subarray(0, 8000))).toBeDefined();
        expect(encoder.windows.length).toBe(1);
    });

    test("settles sound once, in runs that join end to start, and decodes the tail on a copy", async () => {
        const { decoder, runs } = fakeDecoder();
        const encoder = fakeEncoder();
        const stream = createStream({ bins: 80, encode: encoder.encode, decoder }, { chunk: 1, left: 1, right: 1 });
        for (let s = 0; s < 6; s++) await stream.push(second());
        const settled = runs.filter((run) => run.real);
        for (let at = 1; at < settled.length; at++) expect(settled[at]!.from).toBe(settled[at - 1]!.from + settled[at - 1]!.frames);
        // every step also looked at the tail, on a copy that is not the real state
        expect(runs.some((run) => !run.real)).toBe(true);
        const last = await stream.finish();
        // all words are in order and none covers sound that an earlier word covered
        for (let at = 1; at < last.length; at++) expect(last[at]!.start).toBeGreaterThanOrEqual(last[at - 1]!.end - 1e-9);
        // 6 seconds is 75 encoder frames (76 with the one the first feature frame adds), and finishing covered up to the end
        expect(last.at(-1)!.end).toBeGreaterThan(5.9);
    });

    test("encodes only the left context and the new sound, not the whole phrase", async () => {
        const { decoder } = fakeDecoder();
        const encoder = fakeEncoder();
        const stream = createStream({ bins: 80, encode: encoder.encode, decoder }, { chunk: 1, left: 1, right: 1 });
        for (let s = 0; s < 12; s++) await stream.push(second());
        // 12 s of sound in all, but no window is longer than left + right + chunk and a little over
        expect(Math.max(...encoder.windows)).toBeLessThan(100 * 4 + 20);
    });

    test("a window that begins mid-phrase starts with silence, which the first window does not", async () => {
        const { decoder } = fakeDecoder();
        const encoder = fakeEncoder();
        const stream = createStream({ bins: 80, encode: encoder.encode, decoder }, { chunk: 1, left: 1, right: 1 });
        for (let s = 0; s < 6; s++) await stream.push(second());
        expect(encoder.windows.length).toBeGreaterThan(3);
        // silence is far below the sound, so after normalizing a window that starts with it begins lower than one that starts with sound
        expect(encoder.starts.at(-1)!).toBeLessThan(encoder.starts[0]! - 1);
    });

    test("after a phrase is finished the next one starts from nothing", async () => {
        const { decoder } = fakeDecoder();
        const encoder = fakeEncoder();
        const stream = createStream({ bins: 80, encode: encoder.encode, decoder }, { chunk: 1 });
        for (let s = 0; s < 3; s++) await stream.push(second());
        await stream.finish();
        await stream.push(second());
        const again = await stream.finish();
        expect(again[0]!.start).toBe(0);
    });

    test("says how far behind it is when steps are not running", async () => {
        const { decoder } = fakeDecoder();
        const stream = createStream({ bins: 80, encode: async () => new Promise(() => {}), decoder }, { chunk: 1 });
        void stream.push(second());
        await stream.push(second());
        expect(stream.behind()).toBeGreaterThan(1.5);
    });
});
