// Running a model over a picture too large to hand it whole, for repairing, restoring and enlarging with a
// model (the models themselves are chosen later). The picture is cut into tiles (`planTiles`); each is read
// with a margin of the picture round it, so that the model sees what lies past the tile's edge, run, and only
// its middle kept, enlarged by the model's scale. A model whose reach is no wider than the margin then gives
// each kept middle exactly as it would have given that part of the whole picture, so the tiles join with no
// seam and nothing is blended. At the picture's edge the margin is cut off by the edge itself, as it would be
// for the whole picture.
//
// Only one tile in and one tile out are held at a time (`runTiles`): the picture is read a tile at a time from
// wherever it is kept, and each finished tile handed on, row by row, to whatever keeps the result, so a 50
// megapixel photograph never sits in memory more than once. It says how far it has got after each tile, and
// stops between tiles when asked, handing on nothing more.
//
//   const plan = planTiles({ width, height }, { tile: 512, margin: 32, scale: 2 });
//   await runTiles(plan, readPart, model, keep, { signal, progress: (share) => say(share) });

import type { Rect } from "./steps";

/** Pixels of a part of a picture: RGBA, row by row. */
export interface Pixels {
    width: number;
    height: number;
    data: Uint8ClampedArray;
}

/** One tile: the part of the picture read (its middle and a margin round it, held to the picture), the middle kept, where that middle lies in what is read, and where it goes in the result. */
export interface Tile {
    read: Rect;
    keep: Rect;
    inside: { x: number; y: number };
    out: Rect;
}

/** How a picture is cut: the tiles, row by row, and the size of the result. */
export interface TilePlan {
    scale: number;
    width: number;
    height: number;
    tiles: Tile[];
}

/** The largest side a result may have, as for any picture the editor makes (steps.ts). */
export const MOST_SIDE = 16_384;

/** The largest whole scale (up to `most`) at which a picture's result stays within the largest side. */
export const largestScale = (size: { width: number; height: number }, most = 4): number => Math.max(1, Math.min(most, Math.floor(MOST_SIDE / Math.max(size.width, size.height))));

/**
 * The tiles a picture is cut into: middles of `tile` pixels a side (smaller at the right and the foot), each
 * read with `margin` pixels more round it where the picture has them, and enlarged `scale` times in the
 * result. Undefined when the result would be larger than the largest side.
 */
export function planTiles(size: { width: number; height: number }, how: { tile: number; margin: number; scale: number }): TilePlan | undefined {
    const { tile, margin, scale } = how;
    if (tile < 1 || margin < 0 || scale < 1 || !Number.isInteger(scale)) return undefined;
    if (size.width * scale > MOST_SIDE || size.height * scale > MOST_SIDE) return undefined;
    const tiles: Tile[] = [];
    for (let y = 0; y < size.height; y += tile)
        for (let x = 0; x < size.width; x += tile) {
            const keep = { x, y, width: Math.min(tile, size.width - x), height: Math.min(tile, size.height - y) };
            const left = Math.max(0, x - margin);
            const top = Math.max(0, y - margin);
            const right = Math.min(size.width, keep.x + keep.width + margin);
            const bottom = Math.min(size.height, keep.y + keep.height + margin);
            tiles.push({ read: { x: left, y: top, width: right - left, height: bottom - top }, keep, inside: { x: x - left, y: y - top }, out: { x: x * scale, y: y * scale, width: keep.width * scale, height: keep.height * scale } });
        }
    return { scale, width: size.width * scale, height: size.height * scale, tiles };
}

/** A part cut out of pixels. */
export function cut(pixels: Pixels, rect: Rect): Pixels {
    const data = new Uint8ClampedArray(rect.width * rect.height * 4);
    for (let row = 0; row < rect.height; row++) data.set(pixels.data.subarray(((rect.y + row) * pixels.width + rect.x) * 4, ((rect.y + row) * pixels.width + rect.x + rect.width) * 4), row * rect.width * 4);
    return { width: rect.width, height: rect.height, data };
}

/** The error a run stopped when asked ends with, which a caller tells from a failure by its name. */
export class Stopped extends Error {
    override name = "Stopped";
    constructor() {
        super("Stopped");
    }
}

/**
 * Runs a step (a model, or anything standing in for one) over a picture tile by tile: each tile's part read
 * by `read`, the step given it and expected to give it back `scale` times larger, its middle cut out and
 * handed to `keep` with where it goes in the result. Says the share done after each tile; between tiles,
 * stops when `signal` is aborted, throwing `Stopped` and handing on nothing more. A step that gives back the
 * wrong size is an error.
 */
export async function runTiles(plan: TilePlan, read: (rect: Rect) => Promise<Pixels> | Pixels, step: (pixels: Pixels, signal?: AbortSignal) => Promise<Pixels> | Pixels, keep: (out: Rect, pixels: Pixels) => Promise<void> | void, how: { signal?: AbortSignal; progress?: (share: number) => void } = {}): Promise<void> {
    const { scale } = plan;
    for (let at = 0; at < plan.tiles.length; at++) {
        if (how.signal?.aborted) throw new Stopped();
        const tile = plan.tiles[at]!;
        const made = await step(await read(tile.read), how.signal);
        if (how.signal?.aborted) throw new Stopped();
        if (made.width !== tile.read.width * scale || made.height !== tile.read.height * scale) throw new Error(`the step gave ${made.width} by ${made.height} for a tile of ${tile.read.width} by ${tile.read.height} at ${scale} times`);
        await keep(tile.out, cut(made, { x: tile.inside.x * scale, y: tile.inside.y * scale, width: tile.out.width, height: tile.out.height }));
        how.progress?.((at + 1) / plan.tiles.length);
    }
}

/** A keeper that lays each finished tile into one picture of the result's size, for a result small enough to hold whole. */
export function intoPicture(plan: TilePlan): { pixels: Pixels; keep: (out: Rect, part: Pixels) => void } {
    const pixels = { width: plan.width, height: plan.height, data: new Uint8ClampedArray(plan.width * plan.height * 4) };
    return {
        pixels,
        keep(out, part) {
            for (let row = 0; row < out.height; row++) pixels.data.set(part.data.subarray(row * out.width * 4, (row + 1) * out.width * 4), ((out.y + row) * plan.width + out.x) * 4);
        },
    };
}
