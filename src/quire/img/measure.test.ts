// What the measuring worker's arithmetic is held to: with no copy yet it counts nothing; it counts
// only the small copy's part inside the crop, every pixel once; a grade at zero counts the picture as
// it is; a darker grade moves the counts down; and a part's mask, turned inside out or not, decides
// which pixels its grade reaches.

import { expect, test } from "bun:test";
import { histogram } from "./fix";
import { neutral, prepare } from "./grade";
import { serve, WAVE, type Kept } from "./measure";

const small = { width: 20, height: 10, data: new Uint8ClampedArray(20 * 10 * 4) };
for (let at = 0; at < 200; at++) small.data.set([200, 200, 200, 255], at * 4);
const size = { width: 200, height: 100 };
const whole = { x: 0, y: 0, width: 200, height: 100 };
const total = (counts: Uint32Array) => counts.reduce((a, b) => a + b, 0);

test("with no copy it counts nothing; with one it counts each pixel inside the crop once, as it is under a grade at zero", () => {
    const kept: Kept = {};
    expect(serve(kept, { type: "grade", id: 1, layers: [], crop: whole, space: "srgb" })).toBeUndefined();
    serve(kept, { type: "picture", small, size });
    const counts = serve(kept, { type: "grade", id: 2, layers: [{ ready: prepare(neutral(), "srgb") }], crop: whole, space: "srgb" })!;
    expect(counts.id).toBe(2);
    expect(total(counts.red)).toBe(200);
    expect(counts.red[200]).toBe(200);
    expect([...counts.luma]).toEqual([...histogram(small.data).luma]);
    expect(counts.wave.length).toBe(WAVE.columns * WAVE.rows);
    expect(total(counts.wave)).toBe(200);
    const half = serve(kept, { type: "grade", id: 3, layers: [], crop: { x: 0, y: 0, width: 100, height: 50 }, space: "srgb" })!;
    expect(total(half.red)).toBe(50);
});

test("a darker grade moves the counts down, and a part's mask decides which pixels it reaches", () => {
    const kept: Kept = {};
    serve(kept, { type: "picture", small, size });
    const darker = prepare({ ...neutral(), light: -100 }, "srgb");
    const all = serve(kept, { type: "grade", id: 1, layers: [{ ready: darker }], crop: whole, space: "srgb" })!;
    expect(all.red[200]).toBe(0);
    // a mask over the left half of the picture
    const layer = new Float32Array(20 * 10);
    for (let at = 0; at < 200; at++) layer[at] = at % 20 < 10 ? 1 : 0;
    serve(kept, { type: "masks", masks: { width: 20, height: 10, layers: [layer] } });
    const left = serve(kept, { type: "grade", id: 2, layers: [{ ready: darker, layer: 0 }], crop: whole, space: "srgb" })!;
    expect(left.red[200]).toBe(100);
    const right = serve(kept, { type: "grade", id: 3, layers: [{ ready: darker, layer: 0, invert: true }], crop: whole, space: "srgb" })!;
    expect(right.red[200]).toBe(100);
});
