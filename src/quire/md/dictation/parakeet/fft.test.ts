// Tests that the real FFT agrees with a slow direct transform, for several sizes and inputs.
import { describe, expect, test } from "bun:test";
import { createRealFft } from "./fft";

/** The definition of the transform, one multiplication per pair, slow and plainly right. */
function slow(input: Float64Array) {
    const size = input.length;
    const re = new Float64Array(size / 2 + 1);
    const im = new Float64Array(size / 2 + 1);
    for (let k = 0; k <= size / 2; k++)
        for (let n = 0; n < size; n++) {
            re[k]! += input[n]! * Math.cos((2 * Math.PI * k * n) / size);
            im[k]! -= input[n]! * Math.sin((2 * Math.PI * k * n) / size);
        }
    return { re, im };
}

/** Numbers that repeat, so a failure can be reproduced. */
function noise(length: number) {
    let state = 12345;
    return Float64Array.from({ length }, () => {
        state = (state * 1664525 + 1013904223) >>> 0;
        return state / 2 ** 31 - 1;
    });
}

describe("real FFT", () => {
    test("matches a slow DFT at sizes 4 to 512 on noise", () => {
        for (const size of [4, 8, 16, 64, 256, 512]) {
            const input = noise(size);
            const fast = { re: new Float64Array(size / 2 + 1), im: new Float64Array(size / 2 + 1) };
            createRealFft(size).transform(input, fast.re, fast.im);
            const want = slow(input);
            let worst = 0;
            for (let k = 0; k <= size / 2; k++) worst = Math.max(worst, Math.abs(fast.re[k]! - want.re[k]!), Math.abs(fast.im[k]! - want.im[k]!));
            expect(worst).toBeLessThan(1e-9);
        }
    });
    test("puts a pure tone in its own bin", () => {
        const input = Float64Array.from({ length: 512 }, (_, n) => Math.cos((2 * Math.PI * 40 * n) / 512));
        const re = new Float64Array(257);
        const im = new Float64Array(257);
        createRealFft(512).transform(input, re, im);
        expect(re[40]).toBeCloseTo(256, 6);
        expect(Math.abs(re[41]!)).toBeLessThan(1e-9);
    });
    test("can be called again with different input and gives the same answers", () => {
        const fft = createRealFft(64);
        const re = new Float64Array(33);
        const im = new Float64Array(33);
        fft.transform(noise(64), re, im);
        const first = Array.from(re);
        fft.transform(new Float64Array(64).fill(1), re, im);
        expect(re[0]).toBeCloseTo(64, 9);
        fft.transform(noise(64), re, im);
        expect(Array.from(re)).toEqual(first);
    });
    test("refuses sizes that are not powers of two", () => {
        expect(() => createRealFft(100)).toThrow();
        expect(() => createRealFft(2)).toThrow();
    });
});
