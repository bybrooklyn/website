// Words are placed by their ink: on a cut line of dark blocks for letters, each word's box is tight
// round its own blocks whatever slices the recognizer saw it in, on a light ground or a dark one;
// a box goes back to the picture along the line's slant, and the right way round for a line that was
// turned to be read; and a word's cover is its box grown by a tenth of the line's height, the same
// every time.

import { expect, test } from "bun:test";
import { backToPicture, background, boundsOf, coverFor, cutSize, inkOf, wordsOf } from "./words";
import type { Character } from "./ctc";
import type { Pixels, Slanted } from "./pixels";

/** A cut line 48 high with dark blocks (letters) at the given columns, on a light ground, or light ones on a dark ground. */
function lineOf(width: number, blocks: [number, number][], dark = false, rows: [number, number] = [14, 34]): Pixels {
    const data = new Uint8ClampedArray(width * 48 * 4);
    const [ground, ink] = dark ? [30, 220] : [245, 20];
    for (let y = 0; y < 48; y++)
        for (let x = 0; x < width; x++) {
            const on = y >= rows[0] && y < rows[1] && blocks.some(([from, to]) => x >= from && x < to);
            data.set([on ? ink : ground, on ? ink : ground, on ? ink : ground, 255], (y * width + x) * 4);
        }
    return { width, height: 48, data };
}
const said = (text: string, first: number, last = first): Character => ({ text, first, last, sure: 0.9 });
const level: Slanted = { at: { x: 100, y: 200 }, along: { x: 1, y: 0 }, length: 400, height: 48 };

test("the background is the color round the edge, and ink is what is far from it", () => {
    const crop = lineOf(100, [[10, 20]]);
    expect(background(crop).map(Math.round)).toEqual([245, 245, 245]);
    const ink = inkOf(crop);
    expect(ink[20 * 100 + 15]).toBe(1);
    expect(ink[20 * 100 + 50]).toBe(0);
});

test("each word's box is tight round its own ink, whatever slices it was seen in, on light and dark grounds", () => {
    for (const dark of [false, true]) {
        // "ab cd": blocks 40..60 and 70..90, a gap, then 150..170 and 180..200; the recognizer saw the letters a little off
        const crop = lineOf(400, [[40, 60], [70, 90], [150, 170], [180, 200]], dark);
        const words = wordsOf([said("a", 6), said("b", 9), said(" ", 14), said("c", 19), said("d", 23)], crop, level, false, 0);
        expect(words.map((word) => word.text)).toEqual(["ab", "cd"]);
        expect(words[0]!.box).toEqual({ at: { x: 140, y: 214 }, along: { x: 1, y: 0 }, length: 50, height: 20 });
        expect(words[1]!.box).toEqual({ at: { x: 250, y: 214 }, along: { x: 1, y: 0 }, length: 50, height: 20 });
        expect(words[0]!.line).toBe(0);
    }
});

test("a word's height is its own ink: a word with a tall letter is taller", () => {
    const crop = lineOf(300, [[20, 40]]);
    // a tall block for the second word, from row 6
    const tall = lineOf(300, [[200, 220]], false, [6, 34]);
    for (let y = 0; y < 48; y++) for (let x = 200; x < 220; x++) crop.data.set(tall.data.subarray((y * 300 + x) * 4, (y * 300 + x) * 4 + 4), (y * 300 + x) * 4);
    const words = wordsOf([said("a", 3), said(" ", 12), said("l", 26)], crop, { ...level, length: 300 }, false, 3);
    expect(words[0]!.box.height).toBe(20);
    expect(words[1]!.box.height).toBe(28);
});

test("a box goes back to the picture along the line's slant, and the right way round for a turned line", () => {
    const slanted: Slanted = { at: { x: 0, y: 0 }, along: { x: 0, y: 1 }, length: 200, height: 24 };
    // the cut was 400 by 48, twice the line's size each way: a word at 100..200 across and 0..48 down is 50..100 along the line
    const back = backToPicture(slanted, 400, 48, false, { left: 100, top: 0, right: 200, bottom: 48 });
    expect(back).toEqual({ at: { x: 0, y: 50 }, along: { x: 0, y: 1 }, length: 50, height: 24 });
    const turned = backToPicture(level, 400, 48, true, { left: 0, top: 0, right: 100, bottom: 48 });
    // read upside down, the cut's left end is the line's far end, and the word reads back towards the start
    expect(turned.along).toEqual({ x: -1, y: -0 });
    expect(boundsOf(turned)).toEqual({ x: 400, y: 200, width: 100, height: 48 });
});

test("a word's cover is its box grown by a tenth of the line's height, at least two pixels, in whole pixels, the same every time", () => {
    const word = { box: { at: { x: 10.4, y: 20.6 }, along: { x: 1, y: 0 }, length: 30, height: 12 } };
    expect(coverFor(word, 40)).toEqual({ x: 6, y: 16, width: 39, height: 21 });
    expect(coverFor(word, 40)).toEqual(coverFor(word, 40));
    expect(coverFor(word, 10)).toEqual({ x: 8, y: 18, width: 35, height: 17 });
});

test("a line is cut 48 high and as wide as its shape, at most 3200", () => {
    expect(cutSize({ ...level, length: 240, height: 24 })).toEqual({ width: 480, height: 48 });
    expect(cutSize({ ...level, length: 10000, height: 10 }).width).toBe(3200);
});
