// The whole reading, on stand-ins for the models that see dark pixels: a detector that marks dark ink
// (joined along a line) as text, and a recognizer that reads every dark slice as "x". Held true: two
// lines of dark blocks are found in reading order with their words where the blocks are, in the
// original's pixels, on a picture larger than one tile; the progress goes from the start to 1; a
// reading asked to stop gives nothing; a page model's turn is undone so the boxes are the original's;
// and a line model's "upside down" turns the line's cut and its words.

import { expect, test } from "bun:test";
import { readText, unturn, type Models } from "./read";
import { boundsOf } from "./words";
import type { Pixels } from "./pixels";

/** A light picture with dark blocks. */
function picture(width: number, height: number, blocks: [number, number, number, number][]): Pixels {
    const data = new Uint8ClampedArray(width * height * 4).fill(240);
    for (const [x, y, w, h] of blocks) for (let row = y; row < y + h; row++) for (let column = x; column < x + w; column++) data.set([20, 20, 20, 255], (row * width + column) * 4);
    for (let at = 3; at < data.length; at += 4) data[at] = 255;
    return { width, height, data };
}

/** The detector stand-in: a pixel is text where the input is dark within 12 pixels across or 3 down, shrunk by a little as the real one's training shrinks lines. */
const fakeDetect = async (input: Float32Array, width: number, height: number) => {
    const dark = (x: number, y: number) => x >= 0 && y >= 0 && x < width && y < height && input[y * width + x]! < -1;
    const map = new Float32Array(width * height);
    for (let y = 0; y < height; y++)
        for (let x = 0; x < width; x++) {
            let near = false;
            for (let dy = -1; dy <= 1 && !near; dy++) for (let dx = -12; dx <= 12 && !near; dx += 2) near = dark(x + dx, y + dy);
            map[y * width + x] = near && dark(x, y - 2) && dark(x, y + 2) ? 0.9 : near ? 0.3 : 0;
        }
    return map;
};
const DICTIONARY = ["", "x", " "];
/** The recognizer stand-in: "x" for a slice with dark pixels in it, a space for a light slice after a dark one, else the blank. */
const fakeRecognize = async (input: Float32Array, batch: number, width: number) => {
    const frames = width / 8;
    const data = new Float32Array(batch * frames * 3);
    for (let line = 0; line < batch; line++) {
        let was = false;
        for (let frame = 0; frame < frames; frame++) {
            let dark = false;
            for (let y = 14; y < 34 && !dark; y++) for (let x = frame * 8; x < frame * 8 + 8 && !dark; x++) dark = input[line * 3 * 48 * width + y * width + x]! < -0.5;
            const best = dark ? (was ? 0 : 1) : was ? 2 : 0;
            data[(line * frames + frame) * 3 + best] = 1;
            was = dark;
        }
    }
    return { data, frames, classes: 3 };
};
const models: Models = { detect: fakeDetect, recognize: fakeRecognize };

test("lines of dark blocks are read in order, with their words where the blocks are, in the original's pixels, across tiles", async () => {
    // two words of one line, then a word far along the same row (a line of its own, as the detector finds it) that crosses the line between the first two tiles, then a line below
    const blocks: [number, number, number, number][] = [
        [100, 100, 60, 24],
        [180, 100, 50, 24],
        [1240, 100, 90, 24],
        [100, 400, 40, 24],
    ];
    const progress: number[] = [];
    const lines = await readText(picture(1600, 600, blocks), models, { dictionary: DICTIONARY, sure: 0.5, progress: (done) => progress.push(done) });
    expect(lines.map((line) => line.words.length)).toEqual([2, 1, 1]);
    const placed = lines.flatMap((line) => line.words.map((word) => boundsOf(word.box)));
    blocks.forEach(([x, y, w, h], index) => {
        const box = placed[index]!;
        expect(Math.abs(box.x - x)).toBeLessThan(1.5);
        expect(Math.abs(box.y - y)).toBeLessThan(1.5);
        expect(Math.abs(box.width - w)).toBeLessThan(2.5);
        expect(Math.abs(box.height - h)).toBeLessThan(2.5);
    });
    expect(lines[2]!.words[0]!.line).toBe(2);
    expect(progress.at(-1)).toBe(1);
    expect(progress.every((value, at) => at === 0 || value >= progress[at - 1]!)).toBe(true);
});

test("a reading asked to stop gives nothing", async () => {
    expect(await readText(picture(400, 200, [[50, 50, 60, 24]]), models, { dictionary: DICTIONARY, sure: 0.5, stopped: () => true })).toEqual([]);
});

test("a box found on a turned page is turned back to the picture as it came", () => {
    // a picture 300 wide and 200 high turned a quarter clockwise is 200 wide and 300 high; its point (50, 20) was (20, 150)
    expect(unturn({ at: { x: 50, y: 20 }, along: { x: 1, y: 0 }, length: 10, height: 5 }, 1, 300, 200)).toEqual({ at: { x: 20, y: 150 }, along: { x: 0, y: -1 }, length: 10, height: 5 });
    expect(unturn({ at: { x: 50, y: 20 }, along: { x: 1, y: 0 }, length: 10, height: 5 }, 2, 300, 200).at).toEqual({ x: 250, y: 180 });
    expect(unturn({ at: { x: 50, y: 20 }, along: { x: 1, y: 0 }, length: 10, height: 5 }, 3, 300, 200).at).toEqual({ x: 280, y: 50 });
});

test("a page the page model says was turned is read upright, and its boxes are the original's", async () => {
    // a word standing upright: on the picture as it came, a block 24 wide and 60 high
    const turned = picture(400, 300, [[200, 100, 24, 60]]);
    let pages = 0;
    const lines = await readText(turned, { ...models, page: async () => (pages++, new Float32Array([0, 0.02, 0.02, 0.96])) }, { dictionary: DICTIONARY, sure: 0.5 });
    expect(pages).toBe(1);
    const box = boundsOf(lines[0]!.words[0]!.box);
    expect(Math.abs(box.x - 200)).toBeLessThan(1.5);
    expect(Math.abs(box.y - 100)).toBeLessThan(1.5);
    expect(Math.abs(box.height - 60)).toBeLessThan(2.5);
});

test("a line the line model says is upside down is turned, and its words read from its far end", async () => {
    const lines = await readText(picture(500, 200, [[100, 80, 60, 24], [180, 80, 60, 24]]), { ...models, line: async (_input, batch) => new Float32Array(batch * 2).map((_, at) => (at % 2 ? 0.95 : 0.05)) }, { dictionary: DICTIONARY, sure: 0.5 });
    const [first, second] = lines[0]!.words.map((word) => boundsOf(word.box));
    // read the other way, the first word is the one on the right
    expect(Math.abs(first!.x - 180)).toBeLessThan(1.5);
    expect(Math.abs(second!.x - 100)).toBeLessThan(1.5);
    expect(lines[0]!.words[0]!.box.along.x).toBe(-1);
});
