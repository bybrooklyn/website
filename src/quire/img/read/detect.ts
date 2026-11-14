// Finding the lines of text, around the detector. The detector gives, for every pixel, how likely it
// is to be inside a line of text; this file plans what it is given and reads what it gives back:
//
// - The scale: a picture is read at its own size up to 4000 pixels on its longer side, as PaddleOCR
//   does, so that the small words of a screenshot are not lost, and a larger one is made smaller.
// - The tiles: a large picture is given to the detector in squares of 1280 with 64 pixels of overlap,
//   and the middle of each square is kept, so that the map is whole and memory stays small.
// - The lines: the map is cut at 0.2 into pixels that are text, joined into patches; each patch's
//   smallest turned rectangle (its convex hull's, by rotating calipers) is kept when the map is sure
//   enough of it on average, and grown by its area times 1.4 over its edge, as the detector's training
//   shrank its lines by that much. The same steps as PaddleOCR's DB post-processing, written here.

import type { Point, Slanted } from "./pixels";

/** The longest side a picture is read at; a larger one is made smaller first. */
export const LONGEST = 4000;
/** A tile's side, in the pixels the detector is given: a multiple of 32, as it needs. */
export const TILE = 1280;
/** How far tiles overlap, also a multiple of 32. */
export const OVERLAP = 64;

/** How much smaller a picture is read: 1 up to LONGEST pixels a side. */
export const scaleFor = (width: number, height: number): number => Math.min(1, LONGEST / Math.max(width, height));

/** A part of the picture the detector is given (`x`, `y`, `width`, `height`, its size rounded up to 32 as `inWidth` and `inHeight`), and the part of its answer that is kept (`keep`, in the picture's pixels). */
export interface Tile {
    x: number;
    y: number;
    width: number;
    height: number;
    inWidth: number;
    inHeight: number;
    keep: { x: number; y: number; width: number; height: number };
}

const up32 = (value: number) => Math.max(32, Math.ceil(value / 32) * 32);

/** The tiles for a picture of this size: their kept parts cover it once each, edge to edge. */
export function tiles(width: number, height: number, side = TILE, overlap = OVERLAP): Tile[] {
    const starts = (length: number) => {
        if (length <= side) return [0];
        const found: number[] = [];
        for (let at = 0; ; at += side - overlap) {
            if (at + side >= length) {
                found.push(Math.max(0, length - side));
                break;
            }
            found.push(at);
        }
        return found;
    };
    const across = starts(width);
    const down = starts(height);
    const result: Tile[] = [];
    // each tile keeps up to the middle of its overlap with the next
    const kept = (list: number[], index: number, length: number) => {
        const from = index === 0 ? 0 : Math.round((list[index]! + Math.min(length, list[index - 1]! + side)) / 2);
        const to = index === list.length - 1 ? length : Math.round((list[index + 1]! + Math.min(length, list[index]! + side)) / 2);
        return [from, to] as const;
    };
    down.forEach((y, row) =>
        across.forEach((x, column) => {
            const tileWidth = Math.min(side, width - x);
            const tileHeight = Math.min(side, height - y);
            const [left, right] = kept(across, column, width);
            const [top, bottom] = kept(down, row, height);
            result.push({ x, y, width: tileWidth, height: tileHeight, inWidth: up32(tileWidth), inHeight: up32(tileHeight), keep: { x: left, y: top, width: right - left, height: bottom - top } });
        }),
    );
    return result;
}

/** Copies the kept part of one tile's answer (a map `tile.inWidth` wide) into the whole map, as bytes from 0 to 255. */
export function stitch(map: Uint8Array, width: number, tile: Tile, answer: Float32Array) {
    for (let y = tile.keep.y; y < tile.keep.y + tile.keep.height; y++)
        for (let x = tile.keep.x; x < tile.keep.x + tile.keep.width; x++) map[y * width + x] = Math.round(Math.max(0, Math.min(1, answer[(y - tile.y) * tile.inWidth + (x - tile.x)]!)) * 255);
}

/** The settings of reading the map, as the models' files give them. */
export interface Reading {
    /** A pixel is text above this (0 to 1). */
    cut: number;
    /** A patch is kept when the map's average inside its rectangle is above this. */
    sure: number;
    /** How much a patch's rectangle is grown: its area times this over its edge. */
    grow: number;
    /** The thinnest a line may be, in the map's pixels. */
    thinnest: number;
    /** The most patches read. */
    most: number;
}

/** PaddleOCR's settings for these detectors, but `sure`, which each model's file gives. */
export const READING: Reading = { cut: 0.2, sure: 0.4, grow: 1.4, thinnest: 3, most: 3000 };

/** The convex hull of points, counter-clockwise from the lowest left, by the monotone chain. */
export function hull(points: Point[]): Point[] {
    const sorted = [...points].sort((a, b) => a.x - b.x || a.y - b.y);
    if (sorted.length < 3) return sorted;
    const cross = (o: Point, a: Point, b: Point) => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
    const lower: Point[] = [];
    for (const point of sorted) {
        while (lower.length >= 2 && cross(lower.at(-2)!, lower.at(-1)!, point) <= 0) lower.pop();
        lower.push(point);
    }
    const upper: Point[] = [];
    for (const point of [...sorted].reverse()) {
        while (upper.length >= 2 && cross(upper.at(-2)!, upper.at(-1)!, point) <= 0) upper.pop();
        upper.push(point);
    }
    return [...lower.slice(0, -1), ...upper.slice(0, -1)];
}

/** The smallest rectangle round a convex hull, by rotating calipers: its middle, the unit direction of one side, and its length along that side and across it. */
export function smallestRectangle(points: Point[]): { middle: Point; along: Point; length: number; across: number } {
    let best = { area: Infinity, middle: { x: 0, y: 0 }, along: { x: 1, y: 0 }, length: 0, across: 0 };
    const count = points.length;
    for (let at = 0; at < Math.max(1, count); at++) {
        const a = points[at]!;
        const b = points[(at + 1) % count] ?? a;
        const size = Math.hypot(b.x - a.x, b.y - a.y);
        const along = size > 1e-9 ? { x: (b.x - a.x) / size, y: (b.y - a.y) / size } : { x: 1, y: 0 };
        let [lowU, highU, lowV, highV] = [Infinity, -Infinity, Infinity, -Infinity];
        for (const point of points) {
            const u = point.x * along.x + point.y * along.y;
            const v = -point.x * along.y + point.y * along.x;
            lowU = Math.min(lowU, u);
            highU = Math.max(highU, u);
            lowV = Math.min(lowV, v);
            highV = Math.max(highV, v);
        }
        const area = (highU - lowU) * (highV - lowV);
        if (area < best.area - 1e-9) {
            const u = (lowU + highU) / 2;
            const v = (lowV + highV) / 2;
            best = { area, middle: { x: u * along.x - v * along.y, y: u * along.y + v * along.x }, along, length: highU - lowU, across: highV - lowV };
        }
    }
    return best;
}

/** A rectangle given by its middle, one side's direction and its two lengths, laid as a line reads: along its longer side, left to right (or downwards when upright), its corner where reading starts. */
export function asLine(middle: Point, along: Point, length: number, across: number): Slanted {
    let direction = length >= across ? along : { x: -along.y, y: along.x };
    const long = Math.max(length, across);
    const short = Math.min(length, across);
    // the direction is kept between straight up (not included) and straight down, so that a level line reads left to right
    if (direction.x < -1e-9 || (Math.abs(direction.x) <= 1e-9 && direction.y < 0)) direction = { x: -direction.x, y: -direction.y };
    const down = { x: -direction.y, y: direction.x };
    return { at: { x: middle.x - (direction.x * long) / 2 - (down.x * short) / 2, y: middle.y - (direction.y * long) / 2 - (down.y * short) / 2 }, along: direction, length: long, height: short };
}

/** A line found by the detector: its rectangle and how sure the detector was of it. */
export interface Found {
    box: Slanted;
    sure: number;
}

/**
 * The lines in a map `width` by `height` (bytes, 255 for certain), as slanted rectangles in the
 * map's pixels, in reading order: top to bottom, and left to right along a row.
 */
export function linesIn(map: Uint8Array, width: number, height: number, reading: Reading = READING): Found[] {
    const cut = Math.round(reading.cut * 255);
    const seen = new Uint8Array(width * height);
    const stack = new Int32Array(width * height);
    const found: Found[] = [];
    for (let start = 0; start < width * height && found.length < reading.most; start++) {
        if (seen[start] || map[start]! <= cut) continue;
        // the patch, by filling from here through the eight neighbours, noting each row's two ends
        const rows = new Map<number, [number, number]>();
        let size = 0;
        let top = 0;
        stack[top++] = start;
        seen[start] = 1;
        while (top) {
            const at = stack[--top]!;
            const x = at % width;
            const y = (at - x) / width;
            size++;
            const row = rows.get(y);
            if (row) {
                if (x < row[0]) row[0] = x;
                if (x > row[1]) row[1] = x;
            } else rows.set(y, [x, x]);
            for (let dy = -1; dy <= 1; dy++)
                for (let dx = -1; dx <= 1; dx++) {
                    const nx = x + dx;
                    const ny = y + dy;
                    if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
                    const next = ny * width + nx;
                    if (!seen[next] && map[next]! > cut) {
                        seen[next] = 1;
                        stack[top++] = next;
                    }
                }
        }
        if (size < reading.thinnest * reading.thinnest) continue;
        const corners: Point[] = [];
        for (const [y, [left, right]] of rows) corners.push({ x: left, y }, { x: right + 1, y }, { x: left, y: y + 1 }, { x: right + 1, y: y + 1 });
        const shape = hull(corners);
        const box = smallestRectangle(shape);
        if (Math.min(box.length, box.across) < reading.thinnest) continue;
        const sure = averageIn(map, width, height, box) / 255;
        if (sure < reading.sure) continue;
        // grown by its area times the ratio over its edge, as the training shrank it
        const by = (box.length * box.across * reading.grow) / (2 * (box.length + box.across));
        const length = box.length + 2 * by;
        const across = box.across + 2 * by;
        if (Math.min(length, across) < reading.thinnest + 2) continue;
        found.push({ box: asLine(box.middle, box.along, length, across), sure });
    }
    return inReadingOrder(found);
}

/** The map's average inside a turned rectangle. */
function averageIn(map: Uint8Array, width: number, height: number, box: { middle: Point; along: Point; length: number; across: number }): number {
    const reach = Math.hypot(box.length, box.across) / 2;
    let sum = 0;
    let count = 0;
    for (let y = Math.max(0, Math.floor(box.middle.y - reach)); y < Math.min(height, Math.ceil(box.middle.y + reach)); y++)
        for (let x = Math.max(0, Math.floor(box.middle.x - reach)); x < Math.min(width, Math.ceil(box.middle.x + reach)); x++) {
            const dx = x + 0.5 - box.middle.x;
            const dy = y + 0.5 - box.middle.y;
            if (Math.abs(dx * box.along.x + dy * box.along.y) > box.length / 2 || Math.abs(-dx * box.along.y + dy * box.along.x) > box.across / 2) continue;
            sum += map[y * width + x]!;
            count++;
        }
    return count ? sum / count : 0;
}

/** The middle of a slanted rectangle. */
export const middleOf = (box: Slanted): Point => ({ x: box.at.x + (box.along.x * box.length) / 2 - (box.along.y * box.height) / 2, y: box.at.y + (box.along.y * box.length) / 2 + (box.along.x * box.height) / 2 });

/** Lines in reading order: by their middles from the top, and two whose middles are within half a line's height of each other from the left. */
export function inReadingOrder<T extends { box: Slanted }>(lines: T[]): T[] {
    const sorted = [...lines].sort((a, b) => middleOf(a.box).y - middleOf(b.box).y);
    for (let pass = 0; pass < sorted.length; pass++) {
        let moved = false;
        for (let at = 0; at + 1 < sorted.length; at++) {
            const a = sorted[at]!;
            const b = sorted[at + 1]!;
            const same = Math.abs(middleOf(a.box).y - middleOf(b.box).y) < Math.min(a.box.height, b.box.height) / 2;
            if (same && middleOf(b.box).x < middleOf(a.box).x) {
                sorted[at] = b;
                sorted[at + 1] = a;
                moved = true;
            }
        }
        if (!moved) break;
    }
    return sorted;
}
