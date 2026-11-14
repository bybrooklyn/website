// Words, from a line that was read. The recognizer says where each character was seen only to within
// a slice of eight pixels, and sees a character near its middle or its left, so the words it gives
// are only roughly placed. Each word is therefore placed again by its ink: the line's background is
// the color most common round its edge, a pixel is ink where it is far from that, and a word's box is
// drawn tight round the ink between the middles of the gaps to the words beside it. That box is taken
// back from the flat cut of the line to the picture, slant and all, so that a word's place is in the
// original's pixels, as every step's is.

import { SLICE, LINE_HEIGHT, textOf, sureOf, type Character } from "./ctc";
import { corners, type Pixels, type Slanted } from "./pixels";

/** A word read: its text, its box in the original's pixels, how sure the recognizer was, and the line it is on. */
export interface Word {
    text: string;
    box: Slanted;
    sure: number;
    line: number;
}

/** A line read: its text, its box, how sure the recognizer was, and its words. */
export interface Line {
    text: string;
    box: Slanted;
    sure: number;
    words: Word[];
}

/** The color most common round the edge of a cut line, two pixels deep, by coarse bins. */
export function background(crop: Pixels): [number, number, number] {
    const bins = new Map<number, { count: number; red: number; green: number; blue: number }>();
    const edge = 2;
    for (let y = 0; y < crop.height; y++)
        for (let x = 0; x < crop.width; x++) {
            if (x >= edge && x < crop.width - edge && y >= edge && y < crop.height - edge) continue;
            const at = (y * crop.width + x) * 4;
            const [red, green, blue] = [crop.data[at]!, crop.data[at + 1]!, crop.data[at + 2]!];
            const key = ((red >> 4) << 8) | ((green >> 4) << 4) | (blue >> 4);
            const bin = bins.get(key) ?? { count: 0, red: 0, green: 0, blue: 0 };
            bin.count++;
            bin.red += red;
            bin.green += green;
            bin.blue += blue;
            bins.set(key, bin);
        }
    let best = { count: 0, red: 0, green: 0, blue: 0 };
    for (const bin of bins.values()) if (bin.count > best.count) best = bin;
    return best.count ? [best.red / best.count, best.green / best.count, best.blue / best.count] : [255, 255, 255];
}

/** Which pixels of a cut line are ink: those further from the background than a third of the furthest, and at least 24 in some channel. */
export function inkOf(crop: Pixels): Uint8Array {
    const [red, green, blue] = background(crop);
    const far = new Float32Array(crop.width * crop.height);
    let most = 0;
    for (let at = 0; at < far.length; at++) {
        const distance = Math.max(Math.abs(crop.data[at * 4]! - red), Math.abs(crop.data[at * 4 + 1]! - green), Math.abs(crop.data[at * 4 + 2]! - blue));
        far[at] = distance;
        if (distance > most) most = distance;
    }
    const cut = Math.max(24, most / 3);
    const ink = new Uint8Array(far.length);
    for (let at = 0; at < far.length; at++) ink[at] = far[at]! > cut ? 1 : 0;
    return ink;
}

/** A box in a cut line's own pixels taken back to the picture: the cut was `width` by `height` from `line`, turned half round first if `turned`. */
export function backToPicture(line: Slanted, width: number, height: number, turned: boolean, box: { left: number; top: number; right: number; bottom: number }): Slanted {
    let { left, top, right, bottom } = box;
    if (turned) [left, right, top, bottom] = [width - right, width - left, height - bottom, height - top];
    const across = line.length / width;
    const down = line.height / height;
    const normal = { x: -line.along.y, y: line.along.x };
    const point = (x: number, y: number) => ({ x: line.at.x + line.along.x * x * across + normal.x * y * down, y: line.at.y + line.along.y * x * across + normal.y * y * down });
    const length = (right - left) * across;
    const height_ = (bottom - top) * down;
    // a turned line's words still read from their own start, so they start from the far corner and run back
    return turned ? { at: point(right, bottom), along: { x: -line.along.x, y: -line.along.y }, length, height: height_ } : { at: point(left, top), along: line.along, length, height: height_ };
}

/**
 * The words of a line read from `crop` (its cut, `LINE_HEIGHT` high and as wide as its text, before
 * any padding), from the characters the recognizer gave: split at its spaces, each placed by its ink.
 */
export function wordsOf(characters: Character[], crop: Pixels, line: Slanted, turned: boolean, index: number): Word[] {
    const groups: Character[][] = [];
    let current: Character[] = [];
    for (const each of characters) {
        if (/^\s$/.test(each.text)) {
            if (current.length) groups.push(current);
            current = [];
        } else current.push(each);
    }
    if (current.length) groups.push(current);
    const ink = inkOf(crop);
    const width = crop.width;
    const clamp = (x: number) => Math.max(0, Math.min(width, x));
    const rough = groups.map((group) => [clamp(group[0]!.first * SLICE), clamp((group.at(-1)!.last + 1) * SLICE)] as const);
    // columns with any ink in them
    const inked = new Uint8Array(width);
    for (let x = 0; x < width; x++) for (let y = 0; y < crop.height && !inked[x]; y++) inked[x] = ink[y * width + x]!;
    // Between two words the cut is the middle of the widest gap in the ink between where the last letter
    // of one was seen and the first letter of the next was seen; with no gap there, halfway between them.
    const cuts = groups.slice(1).map((group, at) => {
        const from = clamp(groups[at]!.at(-1)!.first * SLICE);
        const to = clamp((group[0]!.last + 1) * SLICE);
        let best = { length: 0, middle: Math.round((rough[at]![1] + rough[at + 1]![0]) / 2) };
        for (let x = from; x < to; ) {
            if (inked[x]) {
                x++;
                continue;
            }
            const start = x;
            while (x < to && !inked[x]) x++;
            if (x - start > best.length) best = { length: x - start, middle: Math.round((start + x) / 2) };
        }
        return best.middle;
    });
    return groups.map((group, at) => {
        const [start, end] = rough[at]!;
        const from = at === 0 ? 0 : cuts[at - 1]!;
        const to = at === groups.length - 1 ? width : cuts[at]!;
        let left = -1;
        let right = -1;
        for (let x = from; x < to; x++)
            for (let y = 0; y < crop.height; y++)
                if (ink[y * width + x]) {
                    if (left < 0) left = x;
                    right = x;
                    break;
                }
        if (left < 0) [left, right] = [start, Math.max(start, end - 1)];
        let top = -1;
        let bottom = -1;
        for (let y = 0; y < crop.height; y++)
            for (let x = left; x <= right; x++)
                if (ink[y * width + x]) {
                    if (top < 0) top = y;
                    bottom = y;
                    break;
                }
        if (top < 0) [top, bottom] = [0, crop.height - 1];
        return { text: textOf(group), sure: sureOf(group), line: index, box: backToPicture(line, width, crop.height, turned, { left, top, right: right + 1, bottom: bottom + 1 }) };
    });
}

/** The rectangle level with the picture's edges round a slanted box, in its pixels. */
export function boundsOf(box: Slanted): { x: number; y: number; width: number; height: number } {
    const points = corners(box);
    const left = Math.min(...points.map((point) => point.x));
    const top = Math.min(...points.map((point) => point.y));
    return { x: left, y: top, width: Math.max(...points.map((point) => point.x)) - left, height: Math.max(...points.map((point) => point.y)) - top };
}

/** A word's cover: the rectangle round its box, grown on every side by a tenth of the line's height and at least two pixels, in whole pixels outward. Always the same for the same word. */
export function coverFor(word: Pick<Word, "box">, lineHeight: number): { x: number; y: number; width: number; height: number } {
    const bounds = boundsOf(word.box);
    const margin = Math.max(2, lineHeight * 0.1);
    const left = Math.floor(bounds.x - margin);
    const top = Math.floor(bounds.y - margin);
    return { x: left, y: top, width: Math.ceil(bounds.x + bounds.width + margin) - left, height: Math.ceil(bounds.y + bounds.height + margin) - top };
}

/** The height a line is read at, and the width its cut is given: as wide as its shape at that height, at least one slice and at most 3200. */
export function cutSize(line: Slanted): { width: number; height: number } {
    return { width: Math.max(SLICE, Math.min(3200, Math.ceil((LINE_HEIGHT * line.length) / Math.max(1, line.height)))), height: LINE_HEIGHT };
}
