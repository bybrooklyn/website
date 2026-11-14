// The color a cover is drawn in, taken from the picture round the place covered, so that hiding a
// word on a screenshot leaves a block the color of the page behind it rather than a black bar. The
// pixels in a thin ring just outside the rectangle are counted in coarse bins; the bin most of them
// fall in wins, and the cover is the average of the pixels in it. A photograph's patch, with no one
// color round it, gets the color most common there, which is the quietest choice.

import type { Rect } from "./steps";

/** How far outside the rectangle the ring reaches, in pixels. */
const RING = 3;

/** A color as `#rrggbb`. */
export const hex = (red: number, green: number, blue: number): string => `#${[red, green, blue].map((value) => Math.round(value).toString(16).padStart(2, "0")).join("")}`;

/**
 * The color to cover `rect` with. `pixels` are RGBA rows of `area`, a part of the original that holds
 * the rectangle and the ring round it where the picture has one; both are in the original's pixels.
 * With no ring at all (the rectangle is the whole picture) the pixels inside it are counted instead.
 */
export function coverColor(pixels: Uint8ClampedArray, area: Rect, rect: Rect): string {
    const bins = new Map<number, { count: number; red: number; green: number; blue: number }>();
    const count = (x: number, y: number) => {
        const at = ((y - area.y) * area.width + (x - area.x)) * 4;
        const red = pixels[at]!;
        const green = pixels[at + 1]!;
        const blue = pixels[at + 2]!;
        const key = ((red >> 4) << 8) | ((green >> 4) << 4) | (blue >> 4);
        const bin = bins.get(key) ?? { count: 0, red: 0, green: 0, blue: 0 };
        bin.count++;
        bin.red += red;
        bin.green += green;
        bin.blue += blue;
        bins.set(key, bin);
    };
    const left = Math.max(area.x, rect.x - RING);
    const top = Math.max(area.y, rect.y - RING);
    const right = Math.min(area.x + area.width, rect.x + rect.width + RING);
    const bottom = Math.min(area.y + area.height, rect.y + rect.height + RING);
    const inside = (x: number, y: number) => x >= rect.x && x < rect.x + rect.width && y >= rect.y && y < rect.y + rect.height;
    for (let y = top; y < bottom; y++) for (let x = left; x < right; x++) if (!inside(x, y)) count(x, y);
    if (!bins.size) for (let y = Math.max(top, rect.y); y < Math.min(bottom, rect.y + rect.height); y++) for (let x = Math.max(left, rect.x); x < Math.min(right, rect.x + rect.width); x++) count(x, y);
    let best = { count: 0, red: 0, green: 0, blue: 0 };
    for (const bin of bins.values()) if (bin.count > best.count) best = bin;
    return best.count ? hex(best.red / best.count, best.green / best.count, best.blue / best.count) : "#000000";
}

/** The part of the original to read to choose a cover's color: the rectangle and its ring, inside the picture. */
export function ringArea(rect: Rect, size: { width: number; height: number }): Rect {
    const x = Math.max(0, rect.x - RING);
    const y = Math.max(0, rect.y - RING);
    return { x, y, width: Math.min(size.width, rect.x + rect.width + RING) - x, height: Math.min(size.height, rect.y + rect.height + RING) - y };
}
