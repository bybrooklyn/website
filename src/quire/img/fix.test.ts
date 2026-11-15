// What the one-press fixes and the measures are held to: Balance on a gray patch under a warm or a
// green cast makes it neutral to within a level, as the grade then draws it; Auto finds a cast and
// stretches dull levels, landing as slider and curve values, and leaves a picture that needs nothing
// as it was; a picture graded by a list blends each part by its mask; and the histogram and waveform
// count every pixel once.

import { expect, test } from "bun:test";
import { autoFix, averageAround, balanceFrom, gradeImage, histogram, waveform } from "./fix";
import { decode, encode, gradeOne, neutral, prepare, space } from "./grade";

const srgb = space("srgb");
const byte = (value: number) => Math.round(value * 255);

test("Balance on a gray patch under a warm, a cool or a green cast makes it neutral to within a level", () => {
    for (const name of ["srgb", "p3"] as const) {
        for (const cast of [[1.25, 1, 0.7], [0.8, 0.95, 1.3], [0.9, 1.2, 0.85], [1, 1, 1]]) {
            const gray = 0.3;
            const patch = cast.map((gain) => encode(gray * gain!));
            const { warmth, tint } = balanceFrom(patch);
            const out = gradeOne(patch, prepare({ ...neutral(), warmth, tint }, name), space(name)).map(byte);
            expect(Math.max(...out) - Math.min(...out)).toBeLessThanOrEqual(1);
        }
    }
    expect(balanceFrom([0.5, 0.5, 0.5])).toEqual({ warmth: 0, tint: 0 });
    // a cast too strong for the sliders is held to their ends
    expect(balanceFrom([1, 0.5, 0.01]).warmth).toBe(-100);
});

test("Balance reads the average of a small square round where it is pressed", () => {
    const data = new Uint8ClampedArray(10 * 10 * 4);
    for (let at = 0; at < 100; at++) data.set([at % 10 < 5 ? 100 : 200, 50, 25, 255], at * 4);
    expect(averageAround(data, 10, 10, 2, 5).map(byte)).toEqual([100, 50, 25]);
    expect(averageAround(data, 10, 10, 0, 0, 1).map(byte)).toEqual([100, 50, 25]);
});

test("Auto finds a cast and stretches dull levels into slider and curve values, and leaves a picture that needs nothing as it was", () => {
    // a dull, warm gradient: grays from 0.2 to 0.7 under a warm light
    const count = 4096;
    const dull = new Uint8ClampedArray(count * 4);
    for (let at = 0; at < count; at++) {
        const gray = 0.2 + (0.5 * at) / count;
        dull.set([byte(encode(decode(gray) * 1.2)), byte(gray), byte(encode(decode(gray) * 0.75)), 255], at * 4);
    }
    const fixed = autoFix(dull, "srgb");
    expect(fixed.warmth).toBeLessThan(-10);
    expect(fixed.curve[0]!.x).toBeGreaterThan(0.15);
    expect(fixed.curve.at(-1)!.x).toBeLessThan(0.75);
    // graded by what Auto gave, the grays are neutral and span the range
    const graded = gradeImage({ width: count, height: 1, data: dull }, [{ ready: prepare({ ...neutral(), warmth: fixed.warmth, tint: fixed.tint, curves: { ...neutral().curves, all: fixed.curve } }, "srgb") }], "srgb");
    let spread = 0;
    for (let at = 0; at < count; at++) spread = Math.max(spread, Math.max(graded.data[at * 4]!, graded.data[at * 4 + 1]!, graded.data[at * 4 + 2]!) - Math.min(graded.data[at * 4]!, graded.data[at * 4 + 1]!, graded.data[at * 4 + 2]!));
    expect(spread).toBeLessThanOrEqual(3);
    expect(graded.data[1]).toBeLessThan(10);
    expect(graded.data[(count - 1) * 4 + 1]).toBeGreaterThan(245);
    // a neutral picture from black to white needs nothing
    const full = new Uint8ClampedArray(256 * 4);
    for (let at = 0; at < 256; at++) full.set([at, at, at, 255], at * 4);
    expect(autoFix(full, "srgb")).toEqual({ warmth: 0, tint: 0, curve: [{ x: 0, y: 0 }, { x: 1, y: 1 }] });
});

test("a picture graded by a list blends each part by its mask, the whole picture first", () => {
    const image = { width: 4, height: 1, data: new Uint8ClampedArray([128, 128, 128, 255, 128, 128, 128, 255, 128, 128, 128, 255, 128, 128, 128, 200]) };
    const darker = prepare({ ...neutral(), light: -100 }, "srgb");
    const out = gradeImage(image, [{ ready: darker, mask: (x) => (x < 2 ? 1 : x < 3 ? 0.5 : 0) }], "srgb");
    const full = byte(gradeOne([128 / 255, 128 / 255, 128 / 255], darker, srgb)[0]!);
    expect([out.data[0], out.data[4]]).toEqual([full, full]);
    expect(Math.abs(out.data[8]! - (128 + full) / 2)).toBeLessThanOrEqual(1);
    expect([out.data[12], out.data[15]]).toEqual([128, 200]);
});

test("the histogram and the waveform count every pixel once", () => {
    const image = { width: 8, height: 2, data: new Uint8ClampedArray(64) };
    for (let at = 0; at < 16; at++) image.data.set([at * 16, 0, 255, 255], at * 4);
    const counts = histogram(image.data);
    expect(counts.red.reduce((a, b) => a + b, 0)).toBe(16);
    expect(counts.blue[255]).toBe(16);
    expect(counts.green[0]).toBe(16);
    const wave = waveform(image, 4, 8);
    expect(wave.reduce((a, b) => a + b, 0)).toBe(16);
});
