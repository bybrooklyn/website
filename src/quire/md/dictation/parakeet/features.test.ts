// Tests that the sound features equal what NeMo's preprocessor (the model nemo128.onnx) makes, that
// the incremental form gives the same frames as the one-shot form however the sound is cut, and the
// edges: nothing, a little, silence.
import { describe, expect, test } from "bun:test";
import { createFeatures, features, normalize, type Features } from "./features";

/** A sweep with a little noise, 3000 samples; the same one that made features.fixture.f32. */
function sound(length = 3000) {
    let state = 99;
    return Float32Array.from({ length }, (_, i) => {
        state = (state * 1664525 + 1013904223) >>> 0;
        const t = i / 16000;
        return 0.3 * Math.sin(2 * Math.PI * (200 * t + 8000 * t * t)) + 0.05 * (state / 2 ** 31 - 1);
    });
}

/** Joins frame groups, each [bins, k], into one [bins, total]. */
function join(parts: Features[], bins: number): Features {
    const frames = parts.reduce((sum, part) => sum + part.frames, 0);
    const data = new Float32Array(bins * frames);
    let at = 0;
    for (const part of parts) {
        for (let m = 0; m < bins; m++) data.set(part.data.subarray(m * part.frames, (m + 1) * part.frames), m * frames + at);
        at += part.frames;
    }
    return { data, bins, frames };
}

/** Feeds the sound in pieces of `size` and returns every frame it gave, raw. */
function streamed(samples: Float32Array, size: number, bins: 80 | 128 = 128) {
    const stream = createFeatures({ bins });
    const parts: Features[] = [];
    for (let at = 0; at < samples.length; at += size) parts.push(stream.push(samples.subarray(at, at + size)));
    parts.push(stream.flush());
    return join(parts, bins);
}

describe("features against the model", () => {
    test("equal the output of nemo128.onnx on the fixture sound to within 2e-4", async () => {
        const want = new Float32Array(await Bun.file(new URL("./features.fixture.f32", import.meta.url).pathname).arrayBuffer());
        const got = features(sound());
        expect(got.bins).toBe(128);
        expect(got.frames).toBe(19);
        expect(got.data.length).toBe(want.length);
        let worst = 0;
        for (let i = 0; i < want.length; i++) worst = Math.max(worst, Math.abs(got.data[i]! - want[i]!));
        expect(worst).toBeLessThan(2e-4);
    });
    test("have one frame per 160 samples and one more", () => {
        expect(features(sound(1600)).frames).toBe(11);
        expect(features(sound(1599)).frames).toBe(10);
        expect(features(sound(300)).frames).toBe(2);
    });
    test("are normalized: each bin has mean 0 and deviation 1 over the frames", () => {
        const got = features(sound(16000));
        for (const m of [0, 40, 127]) {
            const row = got.data.subarray(m * got.frames, (m + 1) * got.frames);
            const mean = row.reduce((a, b) => a + b, 0) / row.length;
            const deviation = Math.sqrt(row.reduce((a, b) => a + (b - mean) ** 2, 0) / (row.length - 1));
            expect(Math.abs(mean)).toBeLessThan(1e-4);
            expect(Math.abs(deviation - 1)).toBeLessThan(1e-3);
        }
    });
    test("come in 80 bins when asked, for the 110m model", () => {
        const got = features(sound(), { bins: 80 });
        expect(got.bins).toBe(80);
        expect(got.data.length).toBe(80 * 19);
        expect(got.data.every(Number.isFinite)).toBe(true);
    });
    test("refuse other rates and other bin counts", () => {
        expect(() => features(sound(), { sampleRate: 8000 as 16000 })).toThrow();
        expect(() => features(sound(), { bins: 64 as 80 })).toThrow();
    });
    test("are empty for no sound, and finite for one frame of it", () => {
        expect(features(new Float32Array(0)).frames).toBe(0);
        const one = features(sound(100));
        expect(one.frames).toBe(1);
        expect(one.data.every(Number.isFinite)).toBe(true);
    });
});

describe("incremental features", () => {
    const samples = sound(16000 + 123);
    const whole = features(samples);
    for (const size of [1, 7, 160, 513, 1600, 5000, 40000]) {
        test(`in pieces of ${size} samples give the one-shot frames once normalized together`, () => {
            const got = normalize(streamed(samples, size));
            expect(got.frames).toBe(whole.frames);
            let worst = 0;
            for (let i = 0; i < whole.data.length; i++) worst = Math.max(worst, Math.abs(got.data[i]! - whole.data[i]!));
            expect(worst).toBe(0);
        });
    }
    test("give no frame before enough sound has come to mirror the left edge", () => {
        const stream = createFeatures();
        expect(stream.push(sound(256)).frames).toBe(0);
        expect(stream.push(sound(1)).frames).toBeGreaterThan(0);
    });
    test("give raw log-mel that is not normalized", () => {
        const raw = streamed(sound(), 1000);
        expect(raw.data.some((v) => Math.abs(v) > 3)).toBe(true);
    });
    test("start afresh after flush and after reset", () => {
        const stream = createFeatures();
        const first = join([stream.push(sound(3000)), stream.flush()], 128);
        const second = join([stream.push(sound(3000)), stream.flush()], 128);
        expect(Array.from(second.data)).toEqual(Array.from(first.data));
        stream.push(sound(777));
        stream.reset();
        const third = join([stream.push(sound(3000)), stream.flush()], 128);
        expect(Array.from(third.data)).toEqual(Array.from(first.data));
    });
    test("work in 80 bins too", () => {
        const got = normalize(streamed(sound(), 333, 80));
        const want = features(sound(), { bins: 80 });
        expect(got.frames).toBe(want.frames);
        expect(Array.from(got.data)).toEqual(Array.from(want.data));
    });
});

describe("silence", () => {
    test("is the log of the guard value, 2^-24, in every bin before normalizing", () => {
        const raw = streamed(new Float32Array(3000), 3000);
        expect(raw.data[0]).toBeCloseTo(Math.log(2 ** -24), 6);
        expect(raw.data.every((v) => v === raw.data[0])).toBe(true);
    });
});
