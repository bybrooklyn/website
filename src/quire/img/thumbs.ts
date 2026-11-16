// The small copy of each picture of a batch, for the strip under the picture: made once as the picture
// arrives (its longer side 192 pixels, kept in the document beside the original), and drawn as the picture
// looks on the processor at that size: its crop, its whole grade, its covers and its cut-out. Marks, parts,
// a turn and a perspective are left off a picture so small. Opening a batch reads only these, never the
// originals, which are decoded one at a time as each is worked on.
//
//   const small = await smallOf(file);                 a WebP of 192 on its longer side
//   const drawn = smallLook(await pixelsOf(small), picture, "srgb");

import { gradeImage } from "./fix";
import { prepare, type Space } from "./grade";
import { look, type Picture } from "./steps";
import { valuesOf } from "./cutout/cut";
import { displayable } from "./picture-out";

/** The longer side of a picture's small copy, in pixels: twice what the strip shows, for a sharp screen. */
export const SMALL_SIDE = 192;

/** A picture's small copy: its longer side `SMALL_SIDE`, as a WebP (a PNG where the browser writes no WebP). */
export async function smallOf(file: Blob): Promise<Blob> {
    const bitmap = await createImageBitmap(await displayable(file));
    const scale = Math.min(1, SMALL_SIDE / Math.max(bitmap.width, bitmap.height));
    const width = Math.max(1, Math.round(bitmap.width * scale));
    const height = Math.max(1, Math.round(bitmap.height * scale));
    const canvas = new OffscreenCanvas(width, height);
    canvas.getContext("2d")!.drawImage(bitmap, 0, 0, width, height);
    bitmap.close();
    const webp = await canvas.convertToBlob({ type: "image/webp", quality: 0.82 });
    return webp.type === "image/webp" ? webp : canvas.convertToBlob({ type: "image/png" });
}

/** A small copy's pixels. */
export async function pixelsOf(small: Blob): Promise<ImageData> {
    const bitmap = await createImageBitmap(small);
    const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
    const context = canvas.getContext("2d")!;
    context.drawImage(bitmap, 0, 0);
    bitmap.close();
    return context.getImageData(0, 0, canvas.width, canvas.height);
}

/** Two hex digits of a color as a number from 0 to 255. */
const channel = (hex: string, at: number) => parseInt(hex.slice(1 + at * 2, 3 + at * 2), 16);

/**
 * A picture's small copy drawn as the picture looks, worked out on the processor: the part its crop keeps,
 * its whole grade, its covers in their colors and its cut-out (clear where it is clear, laid on its color).
 * Marks, parts of the grade, a turn and a perspective are left off.
 */
export function smallLook(small: { width: number; height: number; data: ArrayLike<number> }, picture: Picture, space: Space): { width: number; height: number; data: Uint8ClampedArray } {
    const shown = look(picture);
    const scale = small.width / picture.original.width;
    const crop = shown.crop;
    const width = Math.max(1, Math.round(crop.width * scale));
    const height = Math.max(1, Math.round(crop.height * scale));
    const out = new Uint8ClampedArray(width * height * 4);
    const cut = shown.cutout;
    const mask = cut ? valuesOf(cut.found) : undefined;
    const laid = cut?.background === "color" ? [channel(cut.color ?? "#ffffff", 0), channel(cut.color ?? "#ffffff", 1), channel(cut.color ?? "#ffffff", 2)] : undefined;
    for (let y = 0; y < height; y++)
        for (let x = 0; x < width; x++) {
            // the place in the original, and the small copy's pixel there
            const ox = crop.x + ((x + 0.5) / width) * crop.width;
            const oy = crop.y + ((y + 0.5) / height) * crop.height;
            const sx = Math.min(small.width - 1, Math.max(0, Math.floor(ox * scale)));
            const sy = Math.min(small.height - 1, Math.max(0, Math.floor(oy * scale)));
            const from = (sy * small.width + sx) * 4;
            const to = (y * width + x) * 4;
            let alpha = small.data[from + 3]! / 255;
            if (cut && mask) {
                const mx = Math.min(cut.found.width - 1, Math.max(0, Math.floor((ox / picture.original.width) * cut.found.width)));
                const my = Math.min(cut.found.height - 1, Math.max(0, Math.floor((oy / picture.original.height) * cut.found.height)));
                const kept = mask[my * cut.found.width + mx]!;
                if (cut.background === "clear") alpha *= kept;
                else if (laid) {
                    for (let at = 0; at < 3; at++) out[to + at] = Math.round(small.data[from + at]! * kept + laid[at]! * (1 - kept));
                    out[to + 3] = 255;
                    continue;
                }
            }
            for (let at = 0; at < 3; at++) out[to + at] = small.data[from + at]!;
            out[to + 3] = Math.round(alpha * 255);
        }
    // the covers in their colors, painted before the grade as the card paints them
    for (const cover of shown.covers) {
        const left = Math.max(0, Math.floor(((cover.rect.x - crop.x) / crop.width) * width));
        const top = Math.max(0, Math.floor(((cover.rect.y - crop.y) / crop.height) * height));
        const right = Math.min(width, Math.ceil(((cover.rect.x + cover.rect.width - crop.x) / crop.width) * width));
        const bottom = Math.min(height, Math.ceil(((cover.rect.y + cover.rect.height - crop.y) / crop.height) * height));
        for (let y = top; y < bottom; y++)
            for (let x = left; x < right; x++) {
                const to = (y * width + x) * 4;
                for (let at = 0; at < 3; at++) out[to + at] = channel(cover.color, at);
                out[to + 3] = 255;
            }
    }
    const whole = shown.grades.find((each) => !each.part);
    if (!whole) return { width, height, data: out };
    return gradeImage({ width, height, data: out }, [{ ready: prepare(whole.grade, space) }], space);
}
