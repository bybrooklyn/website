// The one-press fixes and what the Grade surface measures, done on the processor from a small copy
// of the picture so that nothing waits on the card: Balance (white balance from something pressed in
// the picture that should be gray), Auto (a color cast and the levels, landing as the Warmth and
// Tint sliders and the points of the curve, each to be tuned afterwards), a picture graded here by
// the reference arithmetic (grade.ts), and the histogram and waveform of what it gives.
//
//   const { warmth, tint } = balanceFrom([0.52, 0.5, 0.41]);
//   const { warmth, tint, curve } = autoFix(small.data, "srgb");
//   const counts = histogram(gradeImage(small, grades, "srgb").data);

import { decode, encode, gainsOf, gradeOne, REACH, space, type Prepared, type Space } from "./grade";
import type { Point } from "./steps";

const clamp = (value: number, low: number, high: number) => Math.min(high, Math.max(low, value));
const tenth = (value: number) => Math.round(value * 10) / 10 || 0;

/** The Warmth and Tint that make an encoded color neutral: white balance's gains are the inverse of its light, red against blue and green against the two. Held to the sliders' range, in tenths. The same in any space, being ratios of light. */
export function balanceFrom(color: number[]): { warmth: number; tint: number } {
    const lin = color.map((value) => Math.max(1e-4, decode(clamp(value, 0, 1))));
    const u = Math.log2(lin[2]! / lin[0]!);
    const v = Math.log2(lin[0]!) / 2 + Math.log2(lin[2]!) / 2 - Math.log2(lin[1]!);
    return { warmth: tenth(clamp((u / REACH.warmth) * 100, -100, 100)), tint: tenth(clamp((-v / REACH.tint) * 100, -100, 100)) };
}

/** The average of a square of pixels round a place, encoded: what Balance reads where it is pressed. */
export function averageAround(data: ArrayLike<number>, width: number, height: number, x: number, y: number, radius = 2): number[] {
    const sum = [0, 0, 0];
    let count = 0;
    for (let row = Math.max(0, Math.round(y) - radius); row <= Math.min(height - 1, Math.round(y) + radius); row++)
        for (let column = Math.max(0, Math.round(x) - radius); column <= Math.min(width - 1, Math.round(x) + radius); column++) {
            for (let channel = 0; channel < 3; channel++) sum[channel]! += data[(row * width + column) * 4 + channel]! / 255;
            count++;
        }
    return sum.map((value) => value / Math.max(1, count));
}

/**
 * Auto: the color cast, found as the average of the pixels near gray and neither near black nor near
 * white (the whole picture's when too few are), made neutral by Warmth and Tint; then the levels, the
 * darkest and lightest half percent of the balanced picture's luminance set as the ends of the curve
 * of all three, so that its tones span the range. Each is a value she can see and change.
 */
export function autoFix(data: ArrayLike<number>, name: Space): { warmth: number; tint: number; curve: Point[] } {
    const { luma } = space(name);
    const count = Math.floor(data.length / 4);
    const near = [0, 0, 0];
    const all = [0, 0, 0];
    let nearCount = 0;
    let allCount = 0;
    for (let at = 0; at < count; at++) {
        const r = data[at * 4]! / 255;
        const g = data[at * 4 + 1]! / 255;
        const b = data[at * 4 + 2]! / 255;
        const lin = [decode(r), decode(g), decode(b)];
        const y = luma[0] * lin[0]! + luma[1] * lin[1]! + luma[2] * lin[2]!;
        if (y < 0.02 || y > 0.9) continue;
        for (let channel = 0; channel < 3; channel++) all[channel]! += lin[channel]!;
        allCount++;
        if (Math.max(r, g, b) - Math.min(r, g, b) < 0.15) {
            for (let channel = 0; channel < 3; channel++) near[channel]! += lin[channel]!;
            nearCount++;
        }
    }
    const from = nearCount >= Math.max(16, count * 0.01) ? near.map((each) => each / nearCount) : allCount ? all.map((each) => each / allCount) : [1, 1, 1];
    const { warmth, tint } = balanceFrom(from.map(encode));
    // the levels, of the picture as the balance leaves it
    const ready: Prepared = { gains: gainsOf(warmth, tint, luma).map(Math.fround) as [number, number, number], exposure: 1, contrast: 1, shadows: 0, highs: 0, saturation: 0, wheels: [0, 0, 0, 0, 0, 0, 0, 0, 0], colors: [] };
    const numbers = space(name);
    const bins = new Uint32Array(1024);
    for (let at = 0; at < count; at++) {
        const out = gradeOne([data[at * 4]! / 255, data[at * 4 + 1]! / 255, data[at * 4 + 2]! / 255], ready, numbers);
        bins[Math.min(1023, Math.floor((luma[0] * out[0]! + luma[1] * out[1]! + luma[2] * out[2]!) * 1024))]!++;
    }
    const level = (share: number) => {
        let seen = 0;
        for (let at = 0; at < 1024; at++) {
            seen += bins[at]!;
            if (seen >= share * count) return at / 1023;
        }
        return 1;
    };
    const low = Math.round(clamp(level(0.005), 0, 0.4) * 1000) / 1000;
    const high = Math.round(clamp(level(0.995), 0.6, 1) * 1000) / 1000;
    const curve = low <= 0.004 && high >= 0.996 ? [{ x: 0, y: 0 }, { x: 1, y: 1 }] : [{ x: low, y: 0 }, { x: high, y: 1 }];
    return { warmth, tint, curve };
}

/** One grade of a list, as a picture is graded: its numbers, and how much of each pixel it takes (all of it for the whole picture). */
export interface Layer {
    ready: Prepared;
    /** How much of the pixel at a place (in the picture's own pixels, its middle at half) the grade takes, from 0 to 1. */
    mask?(x: number, y: number): number;
}

/** A picture (RGBA, row by row) graded by a list of grades in order, each blended in by its mask, as the card does it; the pixels' places are given in the original's pixels by `place`. */
export function gradeImage(image: { width: number; height: number; data: ArrayLike<number> }, layers: Layer[], name: Space, place: (x: number, y: number) => { x: number; y: number } = (x, y) => ({ x: x + 0.5, y: y + 0.5 })): { width: number; height: number; data: Uint8ClampedArray } {
    const numbers = space(name);
    const out = new Uint8ClampedArray(image.width * image.height * 4);
    for (let y = 0; y < image.height; y++)
        for (let x = 0; x < image.width; x++) {
            const at = (y * image.width + x) * 4;
            let color = [image.data[at]! / 255, image.data[at + 1]! / 255, image.data[at + 2]! / 255];
            const where = layers.some((layer) => layer.mask) ? place(x, y) : undefined;
            for (const layer of layers) {
                const share = layer.mask ? layer.mask(where!.x, where!.y) : 1;
                if (share <= 0) continue;
                const graded = gradeOne(color, layer.ready, numbers);
                color = share >= 1 ? graded : color.map((value, channel) => value + (graded[channel]! - value) * share);
            }
            out[at] = Math.round(color[0]! * 255);
            out[at + 1] = Math.round(color[1]! * 255);
            out[at + 2] = Math.round(color[2]! * 255);
            out[at + 3] = image.data[at + 3]!;
        }
    return { width: image.width, height: image.height, data: out };
}

/** The histogram of a picture: how many pixels at each of 256 levels, for red, green, blue and luminance (on the encoded numbers, as editors show it). */
export function histogram(data: ArrayLike<number>, name: Space = "srgb"): { red: Uint32Array; green: Uint32Array; blue: Uint32Array; luma: Uint32Array } {
    const { luma } = space(name);
    const counts = { red: new Uint32Array(256), green: new Uint32Array(256), blue: new Uint32Array(256), luma: new Uint32Array(256) };
    for (let at = 0; at + 3 < data.length; at += 4) {
        const r = data[at]!;
        const g = data[at + 1]!;
        const b = data[at + 2]!;
        counts.red[r]!++;
        counts.green[g]!++;
        counts.blue[b]!++;
        counts.luma[Math.min(255, Math.round(luma[0] * r + luma[1] * g + luma[2] * b))]!++;
    }
    return counts;
}

/** The waveform of a picture: for each of `columns` across it, how many of its pixels fall at each of `rows` levels of luminance, from the bottom. */
export function waveform(image: { width: number; height: number; data: ArrayLike<number> }, columns: number, rows: number, name: Space = "srgb"): Uint32Array {
    const { luma } = space(name);
    const counts = new Uint32Array(columns * rows);
    for (let y = 0; y < image.height; y++)
        for (let x = 0; x < image.width; x++) {
            const at = (y * image.width + x) * 4;
            const level = (luma[0] * image.data[at]! + luma[1] * image.data[at + 1]! + luma[2] * image.data[at + 2]!) / 255;
            const column = Math.min(columns - 1, Math.floor((x / image.width) * columns));
            counts[Math.min(rows - 1, Math.floor(level * rows)) * columns + column]!++;
        }
    return counts;
}
