// The part models' arithmetic before and after a run, written by hand: where a picture lands in a
// model's square (SAM 2.1 squeezed to 1024 square, SlimSAM its longer side 1024 and padded below and
// to the right, ormbg 1024 square, MODNet its shorter side 512 in steps of 32), its pixels as the
// model's numbers, the presses as the decoder's points, and the model's answer as a found mask: the
// best of SAM's three masks, or the subject model's matte, cut to where the picture lies, made at
// most 512 on its longer side, and kept as runs of bytes (masks.ts) so the document holds it whole.
//
//   const fit = fitOf("slim", 4000, 3000);           where the picture lies in the model's square
//   const prompt = promptOf(presses, fit);
//   const found = foundOf(values, 256, 256, cropOf(fit, 256), fit.picture);

import { encodeRuns, type Found } from "../masks";

/** How a model takes a picture. */
export type Way = "sam2" | "slim" | "ormbg" | "modnet";

/** Where a picture lies in a model's input: the input's size, the part of it the picture fills, and the picture's own size. */
export interface Fit {
    way: Way;
    input: { width: number; height: number };
    filled: { width: number; height: number };
    picture: { width: number; height: number };
}

/** The longest side a found mask is kept at. */
export const FOUND_SIDE = 512;

/** Where a picture of a size lies in a model's input. */
export function fitOf(way: Way, width: number, height: number): Fit {
    const picture = { width, height };
    if (way === "sam2" || way === "ormbg") return { way, input: { width: 1024, height: 1024 }, filled: { width: 1024, height: 1024 }, picture };
    if (way === "slim") {
        const scale = 1024 / Math.max(width, height);
        return { way, input: { width: 1024, height: 1024 }, filled: { width: Math.round(width * scale), height: Math.round(height * scale) }, picture };
    }
    // MODNet: the shorter side 512, each side a whole number of 32s
    const scale = 512 / Math.min(width, height);
    const input = { width: Math.max(32, Math.round((width * scale) / 32) * 32), height: Math.max(32, Math.round((height * scale) / 32) * 32) };
    return { way, input, filled: input, picture };
}

/** A model's numbers from pixels already drawn at its input's size (RGBA, row by row): red, green and blue planes, each scaled to 0 to 1 and then made `(x - mean) / spread`. */
export function planesOf(rgba: ArrayLike<number>, width: number, height: number, way: Way): Float32Array {
    const mean = way === "modnet" ? [0.5, 0.5, 0.5] : way === "ormbg" ? [0, 0, 0] : [0.485, 0.456, 0.406];
    const spread = way === "modnet" ? [0.5, 0.5, 0.5] : way === "ormbg" ? [1, 1, 1] : [0.229, 0.224, 0.225];
    const count = width * height;
    const out = new Float32Array(count * 3);
    for (let at = 0; at < count; at++) for (let channel = 0; channel < 3; channel++) out[channel * count + at] = (rgba[at * 4 + channel]! / 255 - mean[channel]!) / spread[channel]!;
    return out;
}

/** A press on the picture, in its own pixels: adding to what is outlined, or taking away from it. */
export interface Press {
    x: number;
    y: number;
    add: boolean;
}

/** The decoder's points and labels for presses: each place moved into the model's square, labelled 1 to add and 0 to take away. */
export function promptOf(presses: Press[], fit: Fit): { points: Float32Array; labels: BigInt64Array } {
    const sx = fit.filled.width / fit.picture.width;
    const sy = fit.filled.height / fit.picture.height;
    const points = new Float32Array(presses.length * 2);
    const labels = new BigInt64Array(presses.length);
    presses.forEach((press, at) => {
        points[at * 2] = press.x * sx;
        points[at * 2 + 1] = press.y * sy;
        labels[at] = press.add ? 1n : 0n;
    });
    return { points, labels };
}

/** The part of a model's mask (of a side, laid over the model's whole input) the picture fills. */
export function cropOf(fit: Fit, width: number, height = width): { x: number; y: number; width: number; height: number } {
    return { x: 0, y: 0, width: (fit.filled.width / fit.input.width) * width, height: (fit.filled.height / fit.input.height) * height };
}

/** The index of the best of a model's masks, by its own score of each. */
export const bestOf = (scores: ArrayLike<number>): number => {
    let best = 0;
    for (let at = 1; at < scores.length; at++) if (scores[at]! > scores[best]!) best = at;
    return best;
};

/** A model's answer as a found mask: the values (logits when `logits`, else 0 to 1) of a grid, read between their entries over the part the picture fills, at most `side` (`FOUND_SIDE` unless asked) on the picture's longer side, kept as runs of bytes. */
export function foundOf(values: ArrayLike<number>, width: number, height: number, crop: { x: number; y: number; width: number; height: number }, picture: { width: number; height: number }, logits = false, side = FOUND_SIDE): Found {
    const scale = Math.min(1, side / Math.max(picture.width, picture.height));
    const outWidth = Math.max(1, Math.round(picture.width * scale));
    const outHeight = Math.max(1, Math.round(picture.height * scale));
    const bytes = new Uint8Array(outWidth * outHeight);
    const at = (x: number, y: number) => values[Math.min(height - 1, Math.max(0, y)) * width + Math.min(width - 1, Math.max(0, x))]!;
    for (let y = 0; y < outHeight; y++)
        for (let x = 0; x < outWidth; x++) {
            const u = crop.x + ((x + 0.5) / outWidth) * crop.width - 0.5;
            const v = crop.y + ((y + 0.5) / outHeight) * crop.height - 0.5;
            const lowX = Math.floor(u);
            const lowY = Math.floor(v);
            const fx = u - lowX;
            const fy = v - lowY;
            const top = at(lowX, lowY) + (at(lowX + 1, lowY) - at(lowX, lowY)) * fx;
            const bottom = at(lowX, lowY + 1) + (at(lowX + 1, lowY + 1) - at(lowX, lowY + 1)) * fx;
            const value = top + (bottom - top) * fy;
            const share = logits ? 1 / (1 + Math.exp(-value)) : value;
            bytes[y * outWidth + x] = Math.round(Math.min(1, Math.max(0, share)) * 255);
        }
    return { width: outWidth, height: outHeight, runs: encodeRuns(bytes) };
}
