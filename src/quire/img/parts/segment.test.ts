// What the part models' arithmetic is held to: a picture lands in each model's square as its card
// says; its pixels become the model's numbers; presses become points in that square, labelled; the
// best mask is the one scored highest; and a model's answer becomes a found mask of the picture's
// shape, at most 512 a side, its logits read through the sigmoid, only the part the picture fills.

import { expect, test } from "bun:test";
import { decodeRuns } from "../masks";
import { bestOf, cropOf, fitOf, foundOf, planesOf, promptOf } from "./segment";

test("a picture lands in each model's square as its card says", () => {
    expect(fitOf("sam2", 4000, 3000).filled).toEqual({ width: 1024, height: 1024 });
    expect(fitOf("slim", 4000, 3000).filled).toEqual({ width: 1024, height: 768 });
    expect(fitOf("slim", 4000, 3000).input).toEqual({ width: 1024, height: 1024 });
    expect(fitOf("modnet", 4000, 3000).input).toEqual({ width: 672, height: 512 });
    expect(fitOf("ormbg", 300, 200).input).toEqual({ width: 1024, height: 1024 });
});

test("pixels become the model's numbers, plane by plane", () => {
    const rgba = [255, 0, 128, 255];
    const sam = planesOf(rgba, 1, 1, "slim");
    expect(sam[0]).toBeCloseTo((1 - 0.485) / 0.229, 5);
    expect(sam[1]).toBeCloseTo(-0.456 / 0.224, 5);
    expect([...planesOf(rgba, 1, 1, "modnet")].map((each) => Math.round(each * 100) / 100)).toEqual([1, -1, 0]);
    expect([...planesOf(rgba, 1, 1, "ormbg")].map((each) => Math.round(each * 100) / 100)).toEqual([1, 0, 0.5]);
});

test("presses become points in the model's square, labelled one to add and zero to take away", () => {
    const { points, labels } = promptOf([{ x: 2000, y: 1500, add: true }, { x: 400, y: 300, add: false }], fitOf("slim", 4000, 3000));
    expect([...points].map((each) => Math.round(each * 10) / 10)).toEqual([512, 384, 102.4, 76.8]);
    expect([...labels]).toEqual([1n, 0n]);
    expect([...promptOf([{ x: 2000, y: 1500, add: true }], fitOf("sam2", 4000, 3000)).points]).toEqual([512, 512]);
});

test("the best mask is the one scored highest, and an answer becomes a found mask of the picture's shape over only the part it fills", () => {
    expect(bestOf([0.2, 0.9, 0.5])).toBe(1);
    // a 4 by 4 logit grid over the square, the picture filling its top three quarters: positive on the left half
    const logits = new Float32Array(16).map((_, at) => (at % 4 < 2 ? 8 : -8));
    const fit = fitOf("slim", 4000, 3000);
    expect(cropOf(fit, 4)).toEqual({ x: 0, y: 0, width: 4, height: 3 });
    const found = foundOf(logits, 4, 4, cropOf(fit, 4), fit.picture, true);
    expect([found.width, found.height]).toEqual([512, 384]);
    const values = decodeRuns(found.runs, 512 * 384)!;
    expect(values[100 * 512 + 10]).toBe(255);
    expect(values[100 * 512 + 500]).toBe(0);
    expect(foundOf([0.5], 1, 1, { x: 0, y: 0, width: 1, height: 1 }, { width: 10, height: 10 }).width).toBe(10);
});
