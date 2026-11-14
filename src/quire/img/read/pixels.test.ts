// The pixel work is exact where it can be: a picture made smaller keeps its average, a block halved
// stays a block, a straight cut is the pixels themselves, a slanted cut follows its slant, turning is
// a turn, and a model's numbers are blue, green, red, scaled and centred as its file says.

import { expect, test } from "bun:test";
import { corners, cut, halfTurn, HALVES, IMAGENET, place, shrink, turn, type Pixels } from "./pixels";

/** A picture of one color, with a block of another. */
function picture(width: number, height: number, block?: { x: number; y: number; width: number; height: number }): Pixels {
    const data = new Uint8ClampedArray(width * height * 4);
    for (let y = 0; y < height; y++)
        for (let x = 0; x < width; x++) {
            const inside = block && x >= block.x && x < block.x + block.width && y >= block.y && y < block.y + block.height;
            data.set(inside ? [0, 0, 0, 255] : [240, 240, 240, 255], (y * width + x) * 4);
        }
    return { width, height, data };
}
const at = (pixels: Pixels, x: number, y: number) => [...pixels.data.subarray((y * pixels.width + x) * 4, (y * pixels.width + x) * 4 + 4)];

test("made smaller, a picture keeps its average and a block on even pixels stays a block", () => {
    const big = picture(40, 20, { x: 10, y: 4, width: 10, height: 8 });
    const half = shrink(big, 20, 10);
    expect(at(half, 7, 4)).toEqual([0, 0, 0, 255]);
    expect(at(half, 2, 2)).toEqual([240, 240, 240, 255]);
    const mean = (pixels: Pixels) => pixels.data.filter((_, index) => index % 4 === 0).reduce((sum, value) => sum + value, 0) / (pixels.width * pixels.height);
    expect(Math.abs(mean(shrink(big, 13, 7)) - mean(big))).toBeLessThan(1.5);
    expect(shrink(big, 40, 20)).toBe(big);
});

test("a straight cut at the same size is the pixels themselves", () => {
    const big = picture(30, 20, { x: 5, y: 5, width: 4, height: 3 });
    const part = cut(big, { at: { x: 3, y: 4 }, along: { x: 1, y: 0 }, length: 10, height: 6 }, 10, 6);
    for (let y = 0; y < 6; y++) for (let x = 0; x < 10; x++) expect(at(part, x, y)).toEqual(at(big, x + 3, y + 4));
});

test("a slanted cut follows its slant: a block turned a quarter is laid flat", () => {
    // a dark bar 12 long and 4 high, standing upright from (10, 4) down to (10, 16)
    const big = picture(30, 30, { x: 8, y: 4, width: 4, height: 12 });
    // read downwards, the line's "down" is to the left
    const flat = cut(big, { at: { x: 12, y: 4 }, along: { x: 0, y: 1 }, length: 12, height: 4 }, 12, 4);
    for (let y = 0; y < 4; y++) for (let x = 0; x < 12; x++) expect(at(flat, x, y)[0]).toBeLessThan(10);
    const box = corners({ at: { x: 12, y: 4 }, along: { x: 0, y: 1 }, length: 12, height: 4 });
    expect(box).toEqual([{ x: 12, y: 4 }, { x: 12, y: 16 }, { x: 8, y: 16 }, { x: 8, y: 4 }]);
});

test("a cut made smaller keeps a thin stroke that point samples would miss", () => {
    const big = picture(60, 20, { x: 31, y: 0, width: 1, height: 20 });
    const small = cut(big, { at: { x: 0, y: 0 }, along: { x: 1, y: 0 }, length: 60, height: 20 }, 15, 5);
    const darkest = Math.min(...Array.from({ length: 15 }, (_, x) => at(small, x, 2)[0]!));
    expect(darkest).toBeLessThan(200);
});

test("turning: a half turn, and quarter turns that come back round", () => {
    const big = picture(5, 3, { x: 0, y: 0, width: 1, height: 1 });
    expect(at(halfTurn(big), 4, 2)).toEqual([0, 0, 0, 255]);
    const quarter = turn(big, 1);
    expect([quarter.width, quarter.height]).toEqual([3, 5]);
    expect(at(quarter, 2, 0)).toEqual([0, 0, 0, 255]);
    expect(turn(turn(turn(turn(big, 1), 1), 1), 1).data).toEqual(big.data);
    expect(turn(turn(big, 1), 3).data).toEqual(big.data);
});

test("a model's numbers are blue, green, red, scaled and centred, and what the part does not fill is zero", () => {
    const one: Pixels = { width: 1, height: 1, data: new Uint8ClampedArray([255, 0, 51, 255]) };
    const into = new Float32Array(2 * 2 * 3);
    place(one, into, 0, 2, 1, HALVES);
    // blue 51 first, then green 0, then red 255; the second column untouched
    expect([...into.subarray(0, 6)].map((value) => Math.round(value * 100) / 100)).toEqual([-0.6, 0, -1, 0, 1, 0]);
    // ImageNet's means are taken from blue, green and red in that order, so red 104, green 116, blue 124 is zero
    const imagenet = new Float32Array(3);
    place({ width: 1, height: 1, data: new Uint8ClampedArray([104, 116, 124, 255]) }, imagenet, 0, 1, 1, IMAGENET);
    for (const value of imagenet) expect(Math.abs(value)).toBeLessThan(0.02);
});
