// What a slider's movement is held to: the seventeen positions are evenly along the track, a place
// rounds to the nearest of them, a pointer is read mirrored right to left, and each key goes where
// it should and no further than the ends, and the glide eases as the site does. Run with `bun run test`.

import { expect, test } from "bun:test";
import { along, keyed, nearest, pointed, settle } from "./slider";

test("the seventeen positions are evenly along the track, from end to end", () => {
    expect(along(1)).toBe(0);
    expect(along(9)).toBe(0.5);
    expect(along(17)).toBe(1);
    expect(along(2)).toBe(1 / 16);
    expect(along(0)).toBe(0);
    expect(along(30)).toBe(1);
});

test("a place along the track rounds to the nearest position", () => {
    for (let value = 1; value <= 17; value++) expect(nearest(along(value))).toBe(value);
    expect(nearest(0.49)).toBe(9);
    expect(nearest(0.47)).toBe(9);
    expect(nearest(0.46)).toBe(8);
    expect(nearest(0.03)).toBe(1);
    expect(nearest(0.04)).toBe(2);
    expect(nearest(-1)).toBe(1);
    expect(nearest(2)).toBe(17);
});

test("a pointer is read along the track, held to its ends, and mirrored right to left", () => {
    expect(pointed(150, 100, 200)).toBe(0.25);
    expect(pointed(150, 100, 200, true)).toBe(0.75);
    expect(pointed(0, 100, 200)).toBe(0);
    expect(pointed(900, 100, 200)).toBe(1);
    expect(pointed(150, 100, 0)).toBe(0);
});

test("the arrows move one position, left and right as they look", () => {
    expect(keyed(9, "ArrowRight")).toBe(10);
    expect(keyed(9, "ArrowLeft")).toBe(8);
    expect(keyed(9, "ArrowUp")).toBe(10);
    expect(keyed(9, "ArrowDown")).toBe(8);
    expect(keyed(9, "ArrowRight", true)).toBe(8);
    expect(keyed(9, "ArrowLeft", true)).toBe(10);
    expect(keyed(9, "ArrowUp", true)).toBe(10);
});

test("Page Up and Page Down move four, Home and End go to the ends, and nothing goes past them", () => {
    expect(keyed(9, "PageUp")).toBe(13);
    expect(keyed(9, "PageDown")).toBe(5);
    expect(keyed(15, "PageUp")).toBe(17);
    expect(keyed(2, "PageDown")).toBe(1);
    expect(keyed(9, "Home")).toBe(1);
    expect(keyed(9, "End")).toBe(17);
    expect(keyed(17, "ArrowRight")).toBe(17);
    expect(keyed(1, "ArrowLeft")).toBe(1);
});

test("the glide starts quickly and settles slowly, without overshoot", () => {
    expect(settle(0)).toBe(0);
    expect(settle(1)).toBe(1);
    expect(settle(-1)).toBe(0);
    expect(settle(0.25)).toBeGreaterThan(0.6);
    expect(settle(0.5)).toBeGreaterThan(0.85);
    let last = 0;
    for (let time = 0; time <= 1; time += 0.01) {
        const now = settle(time);
        expect(now).toBeGreaterThanOrEqual(last - 1e-9);
        expect(now).toBeLessThanOrEqual(1);
        last = now;
    }
    // a straight line, asked for, is a straight line
    expect(settle(0.3, [0.25, 0.25, 0.75, 0.75])).toBeCloseTo(0.3, 4);
});

test("other keys do not move it", () => {
    for (const key of ["Tab", "Enter", " ", "a", "Escape"]) expect(keyed(9, key)).toBeUndefined();
});
