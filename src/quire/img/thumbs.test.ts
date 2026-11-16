// What a picture's small copy is held to: drawn as the picture looks at that size, the part its crop keeps,
// its covers in their colors, its grade, and clear where a cut-out laid on nothing is clear.

import { expect, test } from "bun:test";
import { encodeRuns } from "./masks";
import { smallLook } from "./thumbs";
import { add } from "./steps";

/** A small copy 40 by 20 of a picture 400 by 200: its left half red, its right half blue. */
const small = () => {
    const data = new Uint8ClampedArray(40 * 20 * 4);
    for (let y = 0; y < 20; y++)
        for (let x = 0; x < 40; x++) data.set(x < 20 ? [200, 0, 0, 255] : [0, 0, 200, 255], (y * 40 + x) * 4);
    return { width: 40, height: 20, data };
};
const original = { name: "pictures/a.png", width: 400, height: 200, type: "image/png", bytes: 1 };
const at = (image: { width: number; data: Uint8ClampedArray }, x: number, y: number) => [...image.data.subarray((y * image.width + x) * 4, (y * image.width + x) * 4 + 4)];

test("the small copy keeps the part its crop keeps, at the same scale, with its covers in their colors", () => {
    let steps = add([], { type: "crop", rect: { x: 200, y: 0, width: 200, height: 100 } });
    steps = add(steps, { type: "cover", rect: { x: 300, y: 0, width: 100, height: 50 }, color: "#00ff00" });
    const drawn = smallLook(small(), { original, steps }, "srgb");
    expect([drawn.width, drawn.height]).toEqual([20, 10]);
    expect(at(drawn, 2, 8)).toEqual([0, 0, 200, 255]);
    expect(at(drawn, 15, 2)).toEqual([0, 255, 0, 255]);
});

test("a grade brightens the small copy as it does the picture, and a cut-out laid on nothing is clear where it is cut away", () => {
    const graded = smallLook(small(), { original, steps: add([], { type: "grade", grade: { light: 60 } }) }, "srgb");
    expect(at(graded, 2, 2)[0]!).toBeGreaterThan(200);
    const mask = new Uint8Array(8 * 4).map((_, index) => (index % 8 < 4 ? 255 : 0));
    const cut = smallLook(small(), { original, steps: add([], { type: "cutout", found: { width: 8, height: 4, runs: encodeRuns(mask) }, background: "clear" }) }, "srgb");
    expect(at(cut, 5, 5)[3]).toBe(255);
    expect(at(cut, 35, 5)[3]).toBe(0);
});
