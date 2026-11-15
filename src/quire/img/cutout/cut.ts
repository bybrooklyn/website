// The cut-out, the one piece the page at /cutout/ and imgQuire's tool share: what a cut-out is (the
// mask a model found, kept as runs of bytes at most 1024 a side, the brush's strokes that keep or
// remove, the subject pressed when there are several, and what it is laid on), and the cut-out made
// from it at the picture's full size: the mask brushed and narrowed to the subject pressed, worked out
// at its own size against the picture made as small (refine.ts), then laid over the full-size picture
// on the card (render.ts).
//
//   const pixels = await cutOut(bitmap, { found, background: "clear" });

import { decodeRuns, stamp, type Found, type Stroke } from "../masks";
import { boxMean, lowOf, type Background, type Low } from "./refine";
import { renderCut, type Behind } from "./render";

/** The longest side a cut-out's mask is kept at. */
export const CUT_SIDE = 1024;

/** What a cut-out is laid on, as kept: nothing, a color, or the old picture blurred. */
export type Laid = "clear" | "color" | "blur";

/** A cut-out as the document keeps it: the mask found, the brush's strokes (an erasing stroke removes), the subject pressed (a mask of it, if one was), what it is laid on and its color. */
export interface Cut {
    found: Found;
    strokes?: Stroke[];
    pick?: Found;
    background: Laid;
    color?: string;
}

/** A found mask's values from 0 to 1, or nothing if its runs do not read. */
export function valuesOf(found: Found): Float32Array | undefined {
    const bytes = decodeRuns(found.runs, found.width * found.height);
    return bytes && Float32Array.from(bytes, (value) => value / 255);
}

/** One mask read at another's size, between its entries. */
function resized(values: Float32Array, from: { width: number; height: number }, to: { width: number; height: number }): Float32Array {
    if (from.width === to.width && from.height === to.height) return values;
    const out = new Float32Array(to.width * to.height);
    for (let y = 0; y < to.height; y++)
        for (let x = 0; x < to.width; x++) {
            const u = ((x + 0.5) / to.width) * from.width - 0.5;
            const v = ((y + 0.5) / to.height) * from.height - 0.5;
            const left = Math.floor(u);
            const top = Math.floor(v);
            const at = (column: number, row: number) => values[Math.min(from.height - 1, Math.max(0, row)) * from.width + Math.min(from.width - 1, Math.max(0, column))]!;
            const upper = at(left, top) + (at(left + 1, top) - at(left, top)) * (u - left);
            const lower = at(left, top + 1) + (at(left + 1, top + 1) - at(left, top + 1)) * (u - left);
            out[y * to.width + x] = upper + (lower - upper) * (v - top);
        }
    return out;
}

/**
 * The cut-out's mask at its own size, from 0 to 1: the mask found; where a subject was pressed, only
 * what lies in it (its mask widened by a few pixels and softened, so the found edge is kept and not
 * the pressing model's coarser one); then each stroke of the brush in order, keeping or removing.
 */
export function maskOf(cut: Cut, picture: { width: number; height: number }): Float32Array | undefined {
    const values = valuesOf(cut.found);
    if (!values) return undefined;
    const size = { width: cut.found.width, height: cut.found.height };
    const alpha = new Float32Array(values);
    const picked = cut.pick && valuesOf(cut.pick);
    if (cut.pick && picked) {
        const grown = boxMean(resized(picked, cut.pick, size), size.width, size.height, 3);
        for (let at = 0; at < alpha.length; at++) alpha[at] = alpha[at]! * Math.min(1, grown[at]! * 2);
    }
    for (const stroke of cut.strokes ?? []) stamp(alpha, size, picture, stroke);
    return alpha;
}

/** The picture drawn at a size, as RGBA, its numbers as they are. */
async function pixelsAt(bitmap: ImageBitmap, width: number, height: number): Promise<Uint8ClampedArray> {
    const small = await createImageBitmap(bitmap, { resizeWidth: width, resizeHeight: height, resizeQuality: "high", colorSpaceConversion: "none", premultiplyAlpha: "none" });
    const canvas = new OffscreenCanvas(width, height);
    const context = canvas.getContext("2d")!;
    context.drawImage(small, 0, 0);
    small.close();
    return context.getImageData(0, 0, width, height).data;
}

/** The old picture blurred for laying a cut-out on: made 160 on its longer side and averaged three times over 4 of those pixels, which is near a Gaussian of a fortieth of the picture's longer side. */
export async function behindOf(bitmap: ImageBitmap): Promise<Behind> {
    const scale = 160 / Math.max(bitmap.width, bitmap.height);
    const width = Math.max(1, Math.round(bitmap.width * scale));
    const height = Math.max(1, Math.round(bitmap.height * scale));
    const rgba = await pixelsAt(bitmap, width, height);
    const out = new Uint8ClampedArray(rgba.length);
    for (let channel = 0; channel < 4; channel++) {
        let plane: Float32Array = Float32Array.from({ length: width * height }, (_, at) => rgba[at * 4 + channel]!);
        for (let pass = 0; pass < 3; pass++) plane = boxMean(plane, width, height, 4);
        for (let at = 0; at < width * height; at++) out[at * 4 + channel] = Math.round(plane[at]!);
    }
    return { width, height, rgba: out };
}

/** What a cut-out needs worked out at its mask's size, for a picture: the numbers the card lays over the full-size picture. */
export async function lowFor(bitmap: ImageBitmap, cut: Cut): Promise<Low | undefined> {
    const alpha = maskOf(cut, bitmap);
    if (!alpha) return undefined;
    return lowOf(alpha, await pixelsAt(bitmap, cut.found.width, cut.found.height), cut.found.width, cut.found.height);
}

/** The background a kept cut-out is laid on, as refine.ts takes it. */
export const backgroundOf = (cut: Cut): Background => (cut.background === "color" ? { kind: "color", color: cut.color ?? "#ffffff" } : { kind: cut.background });

/** The cut-out of a picture at its full size: RGBA, straight alpha (clear) or laid on its background. */
export async function cutOut(bitmap: ImageBitmap, cut: Cut): Promise<ImageData | undefined> {
    const low = await lowFor(bitmap, cut);
    if (!low) return undefined;
    return renderCut(bitmap, low, backgroundOf(cut), cut.color ?? "#ffffff", cut.background === "blur" ? await behindOf(bitmap) : undefined);
}
