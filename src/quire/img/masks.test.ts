// What the parts' masks are held to: a mask's size keeps the original's shape at most 1024 a side;
// runs of bytes come back exactly and hostile runs give nothing; a brush covers all inside its hard
// part and none past its edge; strokes paint and erase in order; a feather blurs an edge and keeps a
// flat part flat; a gradient is whole at its start and gone at its end; a found mask is read at the
// layer's size; and the stack is the same object until a part's shape changes.

import { expect, test } from "bun:test";
import { brushAt, decodeRuns, encodeRuns, feather, maskSize, rasterize, stackFor, stamp } from "./masks";

test("a mask's size keeps the original's shape, at most 1024 on its longer side", () => {
    expect(maskSize({ width: 4000, height: 3000 })).toEqual({ width: 1024, height: 768 });
    expect(maskSize({ width: 300, height: 200 })).toEqual({ width: 300, height: 200 });
});

test("runs of bytes come back exactly, and runs that are not exactly that many values give nothing", () => {
    const values = new Uint8Array(1000);
    for (let at = 0; at < 1000; at++) values[at] = at < 400 ? 0 : at < 401 ? 128 : at < 900 ? 255 : (at * 7) % 256;
    const runs = encodeRuns(values);
    expect(decodeRuns(runs, 1000)).toEqual(values);
    expect(decodeRuns(runs, 999)).toBeUndefined();
    expect(decodeRuns(runs, 1001)).toBeUndefined();
    expect(decodeRuns("not base64!", 10)).toBeUndefined();
    expect(decodeRuns(btoa("\x05\x00"), 1)).toBeUndefined();
    // a mask of a few large regions is small
    expect(runs.length).toBeLessThan(300);
});

test("a brush covers all inside its hard part, none past its edge, and falls smoothly between", () => {
    expect(brushAt(0, 10, 0.5)).toBe(1);
    expect(brushAt(5, 10, 0.5)).toBe(1);
    expect(brushAt(7.5, 10, 0.5)).toBeCloseTo(0.5, 9);
    expect(brushAt(10, 10, 0.5)).toBe(0);
    expect(brushAt(9.99, 10, 0)).toBe(1);
});

test("strokes paint and erase in order, in the layer's places for the original's", () => {
    const size = { width: 100, height: 50 };
    const original = { width: 1000, height: 500 };
    const layer = new Float32Array(100 * 50);
    stamp(layer, size, original, { size: 100, soft: 0, points: [200, 250, 800, 250] });
    expect(layer[25 * 100 + 50]).toBe(1);
    expect(layer[25 * 100 + 5]).toBe(0);
    expect(layer[2 * 100 + 50]).toBe(0);
    stamp(layer, size, original, { size: 50, soft: 0, erase: true, points: [500, 250] });
    expect(layer[25 * 100 + 50]).toBe(0);
    expect(layer[25 * 100 + 30]).toBe(1);
});

test("a feather blurs an edge, keeps a flat part flat, and leaves the layer it was given alone", () => {
    const size = { width: 64, height: 8 };
    const layer = new Float32Array(64 * 8);
    for (let y = 0; y < 8; y++) for (let x = 32; x < 64; x++) layer[y * 64 + x] = 1;
    const soft = feather(layer, size, 4);
    expect(soft[4 * 64 + 2]).toBeCloseTo(0, 6);
    expect(soft[4 * 64 + 62]).toBeCloseTo(1, 6);
    expect(soft[4 * 64 + 31]!).toBeGreaterThan(0.2);
    expect(soft[4 * 64 + 31]!).toBeLessThan(0.5);
    for (let x = 1; x < 64; x++) expect(soft[4 * 64 + x]!).toBeGreaterThanOrEqual(soft[4 * 64 + x - 1]! - 1e-6);
    expect(layer[4 * 64 + 31]).toBe(0);
});

test("a gradient is whole at its start and gone at its end, and a found mask is read at the layer's size", () => {
    const original = { width: 200, height: 100 };
    const size = { width: 200, height: 100 };
    const sky = rasterize({ kind: "gradient", from: { x: 0, y: 20 }, to: { x: 0, y: 60 }, feather: 0 }, original, size);
    expect(sky[5 * 200 + 100]).toBe(1);
    expect(sky[40 * 200 + 100]).toBeCloseTo(0.5, 1);
    expect(sky[80 * 200 + 100]).toBe(0);
    const values = new Uint8Array(4 * 2);
    values.set([255, 255, 0, 0, 255, 255, 0, 0]);
    const found = rasterize({ kind: "found", found: { width: 4, height: 2, runs: encodeRuns(values) }, feather: 0 }, original, size);
    expect(found[50 * 200 + 10]).toBe(1);
    expect(found[50 * 200 + 190]).toBe(0);
});

test("the stack is the same object until a part's shape changes, and says each part's layer", () => {
    const original = { width: 200, height: 100 };
    const strokes = [{ size: 10, soft: 0.5, points: [50, 50] }];
    const grades = [{ id: "s1" }, { id: "s2", part: { kind: "paint" as const, strokes, feather: 0 } }, { id: "s3", part: { kind: "gradient" as const, from: { x: 0, y: 0 }, to: { x: 0, y: 100 }, feather: 2, invert: true } }];
    const one = stackFor(grades, original);
    expect(one.stack!.layers).toHaveLength(2);
    expect(one.layers("s1")).toEqual({});
    expect(one.layers("s3")).toEqual({ layer: 1, invert: true });
    expect(stackFor(grades.map((each) => ({ ...each })), original).stack).toBe(one.stack);
    const moved = stackFor([grades[0]!, { ...grades[1]!, part: { ...grades[1]!.part!, strokes: [...strokes, { size: 5, soft: 0, points: [10, 10] }] } }, grades[2]!], original);
    expect(moved.stack).not.toBe(one.stack);
    expect(moved.stack!.layers[1]).toBe(one.stack!.layers[1]);
});
