// The parts of a picture a grade can be given to, as masks: a gradient dragged across it (for a sky),
// strokes of a soft brush (painted and erased), and a mask a model found, kept as runs of bytes so
// that the grade is the same when the document is opened again without the model. Each part is
// drawn here into a layer of floats of one size, fitted to the original's shape at most 1024 on its
// longer side, and its edge feathered by a blur; the card and the reference read the layers alike
// (grade-shader.ts). A stack of layers is made again only when a part's shape changes.
//
//   const size = maskSize(original);              { width: 1024, height: 683 }
//   const layer = rasterize(part, original, size);
//   const { stack, layers } = stackFor(look.grades, original);

import type { Point } from "./steps";

/** The longest side of a mask, in its own entries. */
export const MASK_SIDE = 1024;

/** A stroke of the brush: its radius in the original's pixels, its softness (0 a hard edge, 1 soft from the middle), whether it erases, and its places as x, y, x, y in the original's pixels. */
export interface Stroke {
    size: number;
    soft: number;
    erase?: boolean;
    points: number[];
}

/** A mask a model found: its size, and its values (0 to 255) row by row as runs of a value and a count, in base64. */
export interface Found {
    width: number;
    height: number;
    runs: string;
}

/** What a part is: a gradient from where the grade is whole to where it is gone, or a found mask, or nothing to start from; then strokes, a feathered edge (in the original's pixels) and whether it is turned inside out. */
export interface Shape {
    kind: "gradient" | "paint" | "found";
    from?: Point;
    to?: Point;
    found?: Found;
    strokes?: Stroke[];
    feather: number;
    invert?: boolean;
}

/** The most strokes a part keeps, and the most places a stroke. */
export const MOST_STROKES = { strokes: 400, points: 4000 };

/** A mask's size for an original: the original's shape, at most `MASK_SIDE` on its longer side. */
export function maskSize(original: { width: number; height: number }): { width: number; height: number } {
    const scale = Math.min(1, MASK_SIDE / Math.max(original.width, original.height));
    return { width: Math.max(1, Math.round(original.width * scale)), height: Math.max(1, Math.round(original.height * scale)) };
}

/** Values from 0 to 255 as runs of a value and a count up to 255, in base64. */
export function encodeRuns(values: Uint8Array): string {
    const out: number[] = [];
    for (let at = 0; at < values.length; ) {
        const value = values[at]!;
        let count = 1;
        while (at + count < values.length && values[at + count] === value && count < 255) count++;
        out.push(value, count);
        at += count;
    }
    let text = "";
    const bytes = Uint8Array.from(out);
    for (let at = 0; at < bytes.length; at += 0x8000) text += String.fromCharCode(...bytes.subarray(at, at + 0x8000));
    return btoa(text);
}

/** Runs read back into `count` values; nothing when they are not runs of exactly that many. */
export function decodeRuns(text: string, count: number): Uint8Array | undefined {
    if (!/^[A-Za-z0-9+/]*={0,2}$/.test(text) || text.length > count * 4) return undefined;
    let bytes: string;
    try {
        bytes = atob(text);
    } catch {
        return undefined;
    }
    if (bytes.length % 2) return undefined;
    const out = new Uint8Array(count);
    let at = 0;
    for (let index = 0; index < bytes.length; index += 2) {
        const run = bytes.charCodeAt(index + 1);
        if (!run || at + run > count) return undefined;
        out.fill(bytes.charCodeAt(index), at, at + run);
        at += run;
    }
    return at === count ? out : undefined;
}

const smooth = (t: number) => {
    const x = Math.min(1, Math.max(0, t));
    return x * x * (3 - 2 * x);
};

/** How much a brush covers at a distance from its middle: all of it inside its hard part, falling smoothly to none at its edge. */
export function brushAt(distance: number, size: number, soft: number): number {
    const hard = size * (1 - soft);
    if (distance <= hard) return 1;
    if (distance >= size) return 0;
    return 1 - smooth((distance - hard) / Math.max(1e-6, size - hard));
}

/** The distance from a place to a segment. */
function toSegment(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
    const dx = bx - ax;
    const dy = by - ay;
    const long = dx * dx + dy * dy;
    const t = long ? Math.min(1, Math.max(0, ((px - ax) * dx + (py - ay) * dy) / long)) : 0;
    return Math.hypot(px - ax - t * dx, py - ay - t * dy);
}

/** Paints one stroke into a layer: each entry takes the most of what it had and what the brush covers, or, erasing, the least of what it had and what the brush leaves. */
export function stamp(layer: Float32Array, size: { width: number; height: number }, original: { width: number; height: number }, stroke: Stroke): void {
    const sx = size.width / original.width;
    const sy = size.height / original.height;
    const radius = stroke.size * Math.max(sx, sy);
    const points = stroke.points;
    for (let at = 0; at + 1 < points.length; at += 2) {
        // each segment, or the one place of a stroke with no length
        const ax = points[at]! * sx;
        const ay = points[at + 1]! * sy;
        const bx = (points[at + 2] ?? points[at]!) * sx;
        const by = (points[at + 3] ?? points[at + 1]!) * sy;
        if (at + 2 >= points.length && at > 0) break;
        const left = Math.max(0, Math.floor(Math.min(ax, bx) - radius - 1));
        const right = Math.min(size.width - 1, Math.ceil(Math.max(ax, bx) + radius + 1));
        const top = Math.max(0, Math.floor(Math.min(ay, by) - radius - 1));
        const bottom = Math.min(size.height - 1, Math.ceil(Math.max(ay, by) + radius + 1));
        for (let y = top; y <= bottom; y++)
            for (let x = left; x <= right; x++) {
                const cover = brushAt(toSegment(x + 0.5, y + 0.5, ax, ay, bx, by), radius, stroke.soft);
                if (!cover) continue;
                const index = y * size.width + x;
                layer[index] = stroke.erase ? Math.min(layer[index]!, 1 - cover) : Math.max(layer[index]!, cover);
            }
    }
}

/** A layer blurred by three passes of a box each way, which is near a Gaussian of the radius given (in the layer's entries), its edges held. */
export function feather(layer: Float32Array, size: { width: number; height: number }, radius: number): Float32Array {
    if (radius < 0.5) return layer;
    // three boxes whose spread together is the radius's
    const box = Math.max(1, Math.round(Math.sqrt((12 * radius * radius) / 3 + 1)));
    const half = Math.floor(box / 2);
    let from: Float32Array = layer;
    let into: Float32Array = new Float32Array(layer.length);
    const pass = (across: boolean) => {
        const lines = across ? size.height : size.width;
        const long = across ? size.width : size.height;
        const step = across ? 1 : size.width;
        for (let line = 0; line < lines; line++) {
            const start = across ? line * size.width : line;
            let sum = 0;
            for (let at = -half; at <= half; at++) sum += from[start + Math.min(long - 1, Math.max(0, at)) * step]!;
            for (let at = 0; at < long; at++) {
                into[start + at * step] = sum / (2 * half + 1);
                sum += from[start + Math.min(long - 1, at + half + 1) * step]! - from[start + Math.max(0, at - half) * step]!;
            }
        }
        [from, into] = [into, from === layer ? new Float32Array(layer.length) : from];
    };
    for (let round = 0; round < 3; round++) {
        pass(true);
        pass(false);
    }
    return from;
}

/** A part drawn into a layer of a size: its gradient or found mask, its strokes in order, its edge feathered. Turning it inside out is the card's, so it is left out here. */
export function rasterize(shape: Shape, original: { width: number; height: number }, size: { width: number; height: number }): Float32Array {
    let layer: Float32Array = new Float32Array(size.width * size.height);
    const sx = original.width / size.width;
    const sy = original.height / size.height;
    if (shape.kind === "gradient" && shape.from && shape.to) {
        // whole at its start, gone at its end, easing between, level beyond
        const dx = shape.to.x - shape.from.x;
        const dy = shape.to.y - shape.from.y;
        const long = dx * dx + dy * dy || 1;
        for (let y = 0; y < size.height; y++)
            for (let x = 0; x < size.width; x++) {
                const t = (((x + 0.5) * sx - shape.from.x) * dx + ((y + 0.5) * sy - shape.from.y) * dy) / long;
                layer[y * size.width + x] = 1 - smooth(t);
            }
    } else if (shape.kind === "found" && shape.found) {
        const { width, height } = shape.found;
        const values = decodeRuns(shape.found.runs, width * height);
        if (values) {
            // the model's mask read between its entries, at this layer's places
            for (let y = 0; y < size.height; y++)
                for (let x = 0; x < size.width; x++) {
                    const u = ((x + 0.5) / size.width) * width - 0.5;
                    const v = ((y + 0.5) / size.height) * height - 0.5;
                    const lowX = Math.max(0, Math.min(width - 1, Math.floor(u)));
                    const lowY = Math.max(0, Math.min(height - 1, Math.floor(v)));
                    const highX = Math.min(width - 1, lowX + 1);
                    const highY = Math.min(height - 1, lowY + 1);
                    const fx = Math.min(1, Math.max(0, u - lowX));
                    const fy = Math.min(1, Math.max(0, v - lowY));
                    const at = (column: number, row: number) => values[row * width + column]! / 255;
                    const top = at(lowX, lowY) + (at(highX, lowY) - at(lowX, lowY)) * fx;
                    const bottom = at(lowX, highY) + (at(highX, highY) - at(lowX, highY)) * fx;
                    layer[y * size.width + x] = top + (bottom - top) * fy;
                }
        }
    }
    for (const stroke of shape.strokes ?? []) stamp(layer, size, original, stroke);
    layer = feather(layer, size, shape.feather * (size.width / original.width));
    return layer;
}

/** A part's shape in a few characters that change when it does, so that its layer is drawn again only then. */
const shapeKeys = new WeakMap<object, number>();
let nextKey = 0;
const identity = (value: object | undefined) => {
    if (!value) return "-";
    let key = shapeKeys.get(value);
    if (key === undefined) shapeKeys.set(value, (key = ++nextKey));
    return String(key);
};
/** The key of a shape: its kind, gradient, feather, and which strokes and found mask it holds. */
export const shapeKey = (shape: Shape): string => `${shape.kind}|${shape.from?.x},${shape.from?.y},${shape.to?.x},${shape.to?.y}|${shape.feather}|${identity(shape.strokes)}|${identity(shape.found)}`;

/** The masks of a look's parts, as the card takes them: one layer a part, and each part's layer and whether it is inside out. */
export interface Stacked {
    stack?: { width: number; height: number; layers: Float32Array[] };
    layers(id: string): { layer?: number; invert?: boolean };
}

const drawn = new Map<string, Float32Array>();
let lastStack: { keys: string; stack: NonNullable<Stacked["stack"]> } | undefined;

/** The stack for a look's parts, the same object as last time when no part's shape changed, so the card is sent nothing new. */
export function stackFor(grades: { id: string; part?: Shape }[], original: { width: number; height: number }): Stacked {
    const parts = grades.filter((each) => each.part);
    const index = new Map(parts.map((each, at) => [each.id, at]));
    const layers = (id: string) => {
        const at = index.get(id);
        if (at === undefined) return {};
        return { layer: at, ...(parts[at]!.part!.invert ? { invert: true } : {}) };
    };
    if (!parts.length) return { layers };
    const size = maskSize(original);
    const keys = parts.map((each) => `${original.width}x${original.height}|${shapeKey(each.part!)}`);
    const joined = keys.join("\n");
    if (lastStack?.keys === joined) return { stack: lastStack.stack, layers };
    const made = keys.map((key, at) => {
        let layer = drawn.get(key);
        if (!layer) {
            layer = rasterize(parts[at]!.part!, original, size);
            drawn.set(key, layer);
            // a few layers kept, the oldest let go first
            while (drawn.size > 24) drawn.delete(drawn.keys().next().value!);
        }
        return layer;
    });
    lastStack = { keys: joined, stack: { ...size, layers: made } };
    return { stack: lastStack.stack, layers };
}
