// What the change of rate is held to: a tone at 44.1 kHz comes out at 48 kHz as the same tone, in step
// and at its own strength, as long as the input calls for; a tone above the new rate's half is taken out
// rather than folded back; and a sound given in pieces of any size comes out the same as given whole.

import { expect, test } from "bun:test";
import { createResampler } from "./resample";

const tone = (frames: number, rate: number, hertz: number) => Float32Array.from({ length: frames }, (_, at) => 0.5 * Math.sin((2 * Math.PI * hertz * at) / rate));
const joined = (parts: Float32Array[]) => {
    const out = new Float32Array(parts.reduce((sum, part) => sum + part.length, 0));
    let at = 0;
    for (const part of parts) {
        out.set(part, at);
        at += part.length;
    }
    return out;
};

test("a tone at 44.1 kHz comes out at 48 kHz in step, at its own strength, as long as it should be", () => {
    const resampler = createResampler(44_100, 48_000, 1);
    const out = joined([resampler.push([tone(44_100, 44_100, 1000)])[0]!, resampler.end()[0]!]);
    expect(out.length).toBe(48_000);
    const want = tone(48_000, 48_000, 1000);
    let most = 0;
    for (let at = 200; at < 47_800; at++) most = Math.max(most, Math.abs(out[at]! - want[at]!));
    expect(most).toBeLessThan(0.003);
});

test("a tone above the new rate's half is taken out, not folded back", () => {
    const resampler = createResampler(48_000, 16_000, 1);
    const out = joined([resampler.push([tone(48_000, 48_000, 11_000)])[0]!, resampler.end()[0]!]);
    expect(out.length).toBe(16_000);
    let loudest = 0;
    for (let at = 200; at < 15_800; at++) loudest = Math.max(loudest, Math.abs(out[at]!));
    expect(loudest).toBeLessThan(0.01);
});

test("a sound given in pieces of any size comes out the same as given whole, channel by channel", () => {
    const left = tone(20_000, 44_100, 440);
    const right = tone(20_000, 44_100, 3000);
    const whole = createResampler(44_100, 48_000, 2);
    const once = whole.push([left, right]);
    const onceEnd = whole.end();
    const pieces = createResampler(44_100, 48_000, 2);
    const outs: Float32Array[][] = [];
    for (let at = 0, size = 1; at < 20_000; at += size, size = (size * 7 + 13) % 3000 || 1) outs.push(pieces.push([left.subarray(at, at + size), right.subarray(at, at + size)]));
    outs.push(pieces.end());
    for (const channel of [0, 1]) {
        const a = joined([once[channel]!, onceEnd[channel]!]);
        const b = joined(outs.map((each) => each[channel]!));
        expect(b.length).toBe(a.length);
        let most = 0;
        for (let at = 0; at < a.length; at++) most = Math.max(most, Math.abs(a[at]! - b[at]!));
        expect(most).toBeLessThan(1e-6);
    }
});
