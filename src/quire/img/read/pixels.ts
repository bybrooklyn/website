// The pixel work round the text models, done by hand on plain RGBA rows: a picture made smaller by
// averaging the pixels each new one covers; a line cut out of the picture along its own slant and
// brought to the recognizer's height; and pictures turned into the numbers each model takes in, its
// channels blue, green, red (as PaddlePaddle's models were trained, from OpenCV), each scaled and
// centred as that model's file says.

/** Pixels: RGBA rows from the top. */
export interface Pixels {
    width: number;
    height: number;
    data: Uint8ClampedArray;
}

/** A place in a picture's pixels. */
export interface Point {
    x: number;
    y: number;
}

/**
 * A rectangle that may be turned: its corner where reading starts (`at`), the direction along the
 * line (`along`, a unit vector) and its length that way, and its height at right angles to that,
 * downwards as the line reads.
 */
export interface Slanted {
    at: Point;
    along: Point;
    length: number;
    height: number;
}

/** The four corners of a slanted rectangle, in reading order: top left, top right, bottom right, bottom left. */
export function corners(box: Slanted): [Point, Point, Point, Point] {
    const down = { x: -box.along.y, y: box.along.x };
    const at = (u: number, v: number) => ({ x: box.at.x + box.along.x * u + down.x * v, y: box.at.y + box.along.y * u + down.y * v });
    return [at(0, 0), at(box.length, 0), at(box.length, box.height), at(0, box.height)];
}

/** The picture made `width` by `height`, smaller or the same, each new pixel the average of the part of the old it covers. */
export function shrink(from: Pixels, width: number, height: number): Pixels {
    if (width === from.width && height === from.height) return from;
    const across = new Float32Array(width * from.height * 4);
    const stepX = from.width / width;
    for (let x = 0; x < width; x++) {
        const left = x * stepX;
        const right = Math.min(from.width, left + stepX);
        for (let source = Math.floor(left); source < right; source++) {
            const share = Math.min(right, source + 1) - Math.max(left, source);
            if (share <= 0) continue;
            for (let y = 0; y < from.height; y++) {
                const out = (y * width + x) * 4;
                const read = (y * from.width + source) * 4;
                for (let channel = 0; channel < 4; channel++) across[out + channel]! += from.data[read + channel]! * share;
            }
        }
    }
    const data = new Uint8ClampedArray(width * height * 4);
    const stepY = from.height / height;
    for (let y = 0; y < height; y++) {
        const top = y * stepY;
        const bottom = Math.min(from.height, top + stepY);
        const sums = new Float32Array(width * 4);
        for (let source = Math.floor(top); source < bottom; source++) {
            const share = Math.min(bottom, source + 1) - Math.max(top, source);
            if (share <= 0) continue;
            for (let at = 0; at < width * 4; at++) sums[at]! += across[source * width * 4 + at]! * share;
        }
        for (let at = 0; at < width * 4; at++) data[y * width * 4 + at] = sums[at]! / (stepX * stepY);
    }
    return { width, height, data };
}

/** One channel of the picture at a place between pixels, by the four round it, the edge carried on outside. */
function sample(from: Pixels, x: number, y: number, out: Float32Array) {
    const left = Math.max(0, Math.min(from.width - 1, Math.floor(x - 0.5)));
    const top = Math.max(0, Math.min(from.height - 1, Math.floor(y - 0.5)));
    const right = Math.min(from.width - 1, left + 1);
    const bottom = Math.min(from.height - 1, top + 1);
    const fx = Math.max(0, Math.min(1, x - 0.5 - left));
    const fy = Math.max(0, Math.min(1, y - 0.5 - top));
    const a = (top * from.width + left) * 4;
    const b = (top * from.width + right) * 4;
    const c = (bottom * from.width + left) * 4;
    const d = (bottom * from.width + right) * 4;
    for (let channel = 0; channel < 4; channel++) {
        const upper = from.data[a + channel]! * (1 - fx) + from.data[b + channel]! * fx;
        const lower = from.data[c + channel]! * (1 - fx) + from.data[d + channel]! * fx;
        out[channel]! += upper * (1 - fy) + lower * fy;
    }
}

/**
 * The slanted rectangle cut out of the picture and laid flat, `width` by `height`. Each new pixel is
 * the average of a few points of the old spread over the part it covers, so that a line made smaller
 * keeps its strokes rather than losing them between samples.
 */
export function cut(from: Pixels, box: Slanted, width: number, height: number): Pixels {
    const data = new Uint8ClampedArray(width * height * 4);
    const stepU = box.length / width;
    const stepV = box.height / height;
    const many = Math.max(1, Math.min(4, Math.ceil(Math.max(stepU, stepV))));
    const down = { x: -box.along.y, y: box.along.x };
    const sum = new Float32Array(4);
    for (let j = 0; j < height; j++)
        for (let i = 0; i < width; i++) {
            sum.fill(0);
            for (let b = 0; b < many; b++)
                for (let a = 0; a < many; a++) {
                    const u = (i + (a + 0.5) / many) * stepU;
                    const v = (j + (b + 0.5) / many) * stepV;
                    sample(from, box.at.x + box.along.x * u + down.x * v, box.at.y + box.along.y * u + down.y * v, sum);
                }
            const out = (j * width + i) * 4;
            for (let channel = 0; channel < 4; channel++) data[out + channel] = sum[channel]! / (many * many);
        }
    return { width, height, data };
}

/** The picture turned half round. */
export function halfTurn(from: Pixels): Pixels {
    const data = new Uint8ClampedArray(from.data.length);
    const count = from.width * from.height;
    for (let at = 0; at < count; at++) data.set(from.data.subarray(at * 4, at * 4 + 4), (count - 1 - at) * 4);
    return { ...from, data };
}

/** The picture turned a quarter round, clockwise `quarters` times (0 to 3). */
export function turn(from: Pixels, quarters: number): Pixels {
    const q = ((quarters % 4) + 4) % 4;
    if (q === 0) return from;
    if (q === 2) return halfTurn(from);
    const width = from.height;
    const height = from.width;
    const data = new Uint8ClampedArray(from.data.length);
    for (let y = 0; y < from.height; y++)
        for (let x = 0; x < from.width; x++) {
            // clockwise, (x, y) goes to (h - 1 - y, x); counter-clockwise to (y, w - 1 - x)
            const [nx, ny] = q === 1 ? [from.height - 1 - y, x] : [y, from.width - 1 - x];
            data.set(from.data.subarray((y * from.width + x) * 4, (y * from.width + x) * 4 + 4), (ny * width + nx) * 4);
        }
    return { width, height, data };
}

/** How a model wants its numbers: each channel's value over 255, less `mean`, over `spread`, in the order blue, green, red. */
export interface Scaling {
    mean: [number, number, number];
    spread: [number, number, number];
}

/** The detector's and the two orientation models' scaling (ImageNet's, applied to blue, green, red as the files say). */
export const IMAGENET: Scaling = { mean: [0.485, 0.456, 0.406], spread: [0.229, 0.224, 0.225] };
/** The recognizer's: each value from -1 to 1. */
export const HALVES: Scaling = { mean: [0.5, 0.5, 0.5], spread: [0.5, 0.5, 0.5] };

/**
 * Writes a part of a picture into a model's input, laid out channels first: `into` is the batch's
 * numbers, `index` the place in the batch, `width` and `height` the input's size. What the part does
 * not fill is left at zero, the middle of every channel.
 */
export function place(from: Pixels, into: Float32Array, index: number, width: number, height: number, scaling: Scaling, part = { x: 0, y: 0, width: from.width, height: from.height }) {
    const plane = width * height;
    const base = index * plane * 3;
    const high = Math.min(height, part.height);
    const wide = Math.min(width, part.width);
    for (let y = 0; y < high; y++)
        for (let x = 0; x < wide; x++) {
            const read = ((part.y + y) * from.width + part.x + x) * 4;
            const out = y * width + x;
            // blue, green, red, as the models were trained
            for (let channel = 0; channel < 3; channel++) into[base + channel * plane + out] = (from.data[read + 2 - channel]! / 255 - scaling.mean[channel]!) / scaling.spread[channel]!;
        }
}
