// The cut-out's edges, the arithmetic written by hand: a model's mask is found at its own size (at most
// 1024 a side) and applied at the picture's full size. Two things are worked out at the mask's size
// here, on the processor, from the mask and the picture made as small as it:
//
// - a guided filter (He, Sun and Tang) of the mask against the picture's lightness: for each place the
//   straight line `a × lightness + b` that best fits the mask round it, the lines then averaged; laid
//   over the full-size picture (`a` and `b` read between their entries) it gives the mask again at
//   full size, its edges following the real pixels, so hair finer than the mask's pixels is kept;
// - the colors of what is kept and of the old background near each place, as averages weighted by the
//   mask and by what is not in it.
//
// The card then does the full-size work in one pass (render.ts), as `applyOne` here does for a pixel:
// the mask from the line, and the edge pixels' color with the old background taken out of it (color
// decontamination: a pixel seen is `alpha × kept + (1 − alpha) × background`, solved for what is kept),
// so no halo of the old ground shows on a new background.
//
//   const low = lowOf(alpha, picture, width, height);   at the mask's size
//   const pixel = applyOne(low, rgb, u, v, background);  what render.ts does on the card for each pixel

/** How far round each place the guided filter looks, in the mask's pixels, and how smooth a flat place stays (a larger `eps` follows the picture less). */
export const GUIDE = { radius: 2, eps: 1e-4 };
/** How far round each place the colors of what is kept and of the old background are averaged, in the mask's pixels. */
export const COLOR_RADIUS = 8;

/** A picture's lightness from 0 to 1, as the guide reads it. */
export const lightness = (r: number, g: number, b: number): number => (0.299 * r + 0.587 * g + 0.114 * b) / 255;

/** A box average of a plane, each place the mean of the square of a radius round it, cut at the edges. */
export function boxMean(plane: Float32Array, width: number, height: number, radius: number): Float32Array {
    const across = new Float32Array(plane.length);
    const out = new Float32Array(plane.length);
    for (let y = 0; y < height; y++) {
        let sum = 0;
        const row = y * width;
        for (let x = 0; x <= Math.min(radius, width - 1); x++) sum += plane[row + x]!;
        for (let x = 0; x < width; x++) {
            const left = x - radius - 1;
            const right = x + radius;
            if (x > 0) {
                if (right < width) sum += plane[row + right]!;
                if (left >= 0) sum -= plane[row + left]!;
            }
            across[row + x] = sum / (Math.min(width - 1, right) - Math.max(0, x - radius) + 1);
        }
    }
    for (let x = 0; x < width; x++) {
        let sum = 0;
        for (let y = 0; y <= Math.min(radius, height - 1); y++) sum += across[y * width + x]!;
        for (let y = 0; y < height; y++) {
            const top = y - radius - 1;
            const bottom = y + radius;
            if (y > 0) {
                if (bottom < height) sum += across[bottom * width + x]!;
                if (top >= 0) sum -= across[top * width + x]!;
            }
            out[y * width + x] = sum / (Math.min(height - 1, bottom) - Math.max(0, y - radius) + 1);
        }
    }
    return out;
}

/** What the card needs at the mask's size: the guided filter's averaged lines (`a`, `b`), and the colors of what is kept (`kept`) and of the old background (`ground`), RGB from 0 to 1, three to a place. */
export interface Low {
    width: number;
    height: number;
    a: Float32Array;
    b: Float32Array;
    kept: Float32Array;
    ground: Float32Array;
}

/** The low-size numbers from a mask (0 to 1) and the picture made the mask's size (RGBA, 8 bits). */
export function lowOf(alpha: Float32Array, rgba: ArrayLike<number>, width: number, height: number, guide = GUIDE, colorRadius = COLOR_RADIUS): Low {
    const count = width * height;
    const light = new Float32Array(count);
    const lightAlpha = new Float32Array(count);
    const lightLight = new Float32Array(count);
    for (let at = 0; at < count; at++) {
        const value = lightness(rgba[at * 4]!, rgba[at * 4 + 1]!, rgba[at * 4 + 2]!);
        light[at] = value;
        lightAlpha[at] = value * alpha[at]!;
        lightLight[at] = value * value;
    }
    const meanLight = boxMean(light, width, height, guide.radius);
    const meanAlpha = boxMean(alpha, width, height, guide.radius);
    const meanLightAlpha = boxMean(lightAlpha, width, height, guide.radius);
    const meanLightLight = boxMean(lightLight, width, height, guide.radius);
    const a = new Float32Array(count);
    const b = new Float32Array(count);
    for (let at = 0; at < count; at++) {
        const spread = meanLightLight[at]! - meanLight[at]! * meanLight[at]!;
        a[at] = (meanLightAlpha[at]! - meanLight[at]! * meanAlpha[at]!) / (spread + guide.eps);
        b[at] = meanAlpha[at]! - a[at]! * meanLight[at]!;
    }
    // the colors near each place: weighted by the mask for what is kept, by what is not for the old background, averaged three times for a smooth reach
    const kept = new Float32Array(count * 3);
    const ground = new Float32Array(count * 3);
    const weightKept = new Float32Array(alpha);
    const weightGround = new Float32Array(count);
    for (let at = 0; at < count; at++) weightGround[at] = 1 - alpha[at]!;
    const smooth = (plane: Float32Array) => boxMean(boxMean(boxMean(plane, width, height, colorRadius), width, height, colorRadius), width, height, colorRadius);
    const wk = smooth(weightKept);
    const wg = smooth(weightGround);
    for (let channel = 0; channel < 3; channel++) {
        const k = new Float32Array(count);
        const g = new Float32Array(count);
        for (let at = 0; at < count; at++) {
            const value = rgba[at * 4 + channel]! / 255;
            k[at] = value * alpha[at]!;
            g[at] = value * (1 - alpha[at]!);
        }
        const ks = smooth(k);
        const gs = smooth(g);
        for (let at = 0; at < count; at++) {
            // where nothing of one kind is near, the picture's own color stands in
            const own = rgba[at * 4 + channel]! / 255;
            kept[at * 3 + channel] = wk[at]! > 1e-4 ? ks[at]! / wk[at]! : own;
            ground[at * 3 + channel] = wg[at]! > 1e-4 ? gs[at]! / wg[at]! : own;
        }
    }
    return { width, height, a: boxMean(a, width, height, guide.radius), b: boxMean(b, width, height, guide.radius), kept, ground };
}

/** What a cut-out is laid on: nothing (clear), a color, or the old background blurred. */
export type Background = { kind: "clear" } | { kind: "color"; color: string } | { kind: "blur" };

/** A plane of the low numbers read between its entries, at a place given as a share of the picture (0 to 1 each way), as the card reads it: the four nearest, by straight lines. */
export function readLow(plane: Float32Array, width: number, height: number, u: number, v: number, channels = 1, channel = 0): number {
    const x = u * width - 0.5;
    const y = v * height - 0.5;
    const left = Math.floor(x);
    const top = Math.floor(y);
    const fx = x - left;
    const fy = y - top;
    const at = (column: number, row: number) => plane[(Math.min(height - 1, Math.max(0, row)) * width + Math.min(width - 1, Math.max(0, column))) * channels + channel]!;
    const upper = at(left, top) + (at(left + 1, top) - at(left, top)) * fx;
    const lower = at(left, top + 1) + (at(left + 1, top + 1) - at(left, top + 1)) * fx;
    return upper + (lower - upper) * fy;
}

/** The smallest share of the mask at which the edge's color is solved for; below it the color of what is kept nearby is used, and between it and `SURE` the two are blended. */
export const FAINT = 0.02;
/** The share of the mask from which the edge's color is wholly the one solved for. */
export const SURE = 0.3;

/**
 * One pixel of the cut-out at full size, as the card works it out: its mask from the guided line at
 * its lightness, its kept color with the old background taken out, and laid on the background. Colors
 * from 0 to 1; gives red, green, blue and alpha (straight, not multiplied by alpha). `behind` is the
 * blurred old picture's color there, for a blurred background.
 */
export function applyOne(low: Low, rgb: [number, number, number], u: number, v: number, background: Background, color: [number, number, number] = [1, 1, 1], behind: [number, number, number] = rgb): [number, number, number, number] {
    const light = (0.299 * rgb[0] + 0.587 * rgb[1] + 0.114 * rgb[2]);
    const a = readLow(low.a, low.width, low.height, u, v);
    const b = readLow(low.b, low.width, low.height, u, v);
    const alpha = Math.min(1, Math.max(0, a * light + b));
    const kept: number[] = [];
    for (let channel = 0; channel < 3; channel++) {
        const near = readLow(low.kept, low.width, low.height, u, v, 3, channel);
        const ground = readLow(low.ground, low.width, low.height, u, v, 3, channel);
        const solved = alpha > FAINT ? Math.min(1, Math.max(0, (rgb[channel]! - (1 - alpha) * ground) / alpha)) : near;
        const t = Math.min(1, Math.max(0, (alpha - FAINT) / (SURE - FAINT)));
        const share = t * t * (3 - 2 * t);
        kept.push(near + (solved - near) * share);
    }
    if (background.kind === "clear") return [kept[0]!, kept[1]!, kept[2]!, alpha];
    const under = background.kind === "color" ? color : behind;
    return [kept[0]! * alpha + under[0] * (1 - alpha), kept[1]! * alpha + under[1] * (1 - alpha), kept[2]! * alpha + under[2] * (1 - alpha), 1];
}

/** `#rrggbb` as three numbers from 0 to 1. */
export const colorOf = (hex: string): [number, number, number] => [parseInt(hex.slice(1, 3), 16) / 255, parseInt(hex.slice(3, 5), 16) / 255, parseInt(hex.slice(5, 7), 16) / 255];
