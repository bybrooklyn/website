// What the chart's geometry is held to: corners are means of what is set, values land where they
// should, the shape breaks at an unset corner instead of crossing the middle, names sit outside the
// rings, and the shape flows with the site's easing. Run with `bun run test`.

import { expect, test } from "bun:test";
import { between, corners, label, place, RADIUS, ring, settle, shape, shown } from "./radar";

const all = (value: number) => Array.from({ length: 9 }, () => value);

test("a corner is the mean of its sliders that are set, and 0 when none is", () => {
    expect(corners(all(5))).toEqual([5, 5, 5, 5, 5]);
    // genderIdentity 2 and genderComfort 8 make the first corner 5; desire is 8, 7, 6
    expect(corners([2, 0, 0, 0, 8, 7, 6, 0, 8])).toEqual([5, 0, 0, 7, 0]);
    // an unset slider is left out of the mean, not counted as 0
    expect(corners([9, 0, 0, 0, 0, 0, 0, 0, 0])).toEqual([9, 0, 0, 0, 0]);
    expect(corners([0, 0, 0, 0, 1, 2, 2, 0, 0])[3]).toBeCloseTo(5 / 3);
});

test("9 lands on the outer ring, 0 in the middle, and the first corner is straight up", () => {
    for (let index = 0; index < 5; index++) expect(Math.hypot(place(9, index).x, place(9, index).y)).toBeCloseTo(RADIUS);
    expect(Math.hypot(place(0, 3).x, place(0, 3).y)).toBe(0);
    expect(place(9, 0).x).toBeCloseTo(0);
    expect(place(9, 0).y).toBeCloseTo(-RADIUS);
    // clockwise: the second corner is up and to the right
    expect(place(9, 1).x).toBeGreaterThan(0);
    expect(place(9, 1).y).toBeLessThan(0);
    expect(place(20, 0)).toEqual(place(9, 0));
});

test("a ring is a polygon through the same value on every corner", () => {
    const points = ring(9).split(" ");
    expect(points).toHaveLength(5);
    expect(points[0]).toBe("0,-100");
});

test("with every corner set the shape is closed and goes through every corner", () => {
    const { d, whole } = shape([5, 5, 5, 5, 5]);
    expect(whole).toBe(true);
    expect(d.startsWith("M")).toBe(true);
    expect(d.endsWith("Z")).toBe(true);
    expect(d.split("L")).toHaveLength(5);
});

test("an unset corner breaks the line, and the line is never drawn through the middle", () => {
    const { d, whole } = shape([5, 5, 0, 5, 5]);
    expect(whole).toBe(false);
    expect(d).not.toContain("Z");
    expect(d).not.toContain("0,0");
    // the corners on both sides of the gap join up round the back: 3, 4, 0, 1 is one line
    expect(d.match(/M/g)).toHaveLength(1);
    expect(d.split("L")).toHaveLength(4);
    expect(shape([5, 0, 5, 0, 5]).d.match(/M/g)).toHaveLength(1);
});

test("a corner on its own, or none set, makes no line", () => {
    expect(shape([0, 0, 7, 0, 0]).d).toBe("");
    expect(shape([0, 0, 0, 0, 0]).d).toBe("");
    expect(shape([5, 0, 5, 0, 0]).d).toBe("");
});

test("names sit outside the outer ring, and run away from the chart", () => {
    for (let index = 0; index < 5; index++) {
        const where = label(index);
        expect(Math.hypot(where.x, where.y)).toBeGreaterThan(RADIUS);
    }
    expect(label(0)).toMatchObject({ anchor: "middle", baseline: "auto" });
    expect(label(1).anchor).toBe("start");
    expect(label(4).anchor).toBe("end");
    expect(label(2).baseline).toBe("hanging");
});

test("between two sets of values, the start, the end, and on the way", () => {
    expect(between([3, 3, 3, 3, 3], [7, 7, 7, 7, 7], 0)).toEqual([3, 3, 3, 3, 3]);
    expect(between([3, 3, 3, 3, 3], [7, 7, 7, 7, 7], 1)).toEqual([7, 7, 7, 7, 7]);
    expect(between([3, 3, 3, 3, 3], [7, 7, 7, 7, 7], 0.5)).toEqual([5, 5, 5, 5, 5]);
});

test("a corner coming or going grows from the middle, and is unset only once it has gone", () => {
    const going = between([5, 5, 5, 5, 5], [5, 5, 0, 5, 5], 0.99)[2]!;
    expect(going).toBeGreaterThan(0);
    expect(going).toBeLessThan(0.1);
    expect(between([5, 5, 5, 5, 5], [5, 5, 0, 5, 5], 1)[2]).toBe(0);
    expect(between([5, 5, 0, 5, 5], [5, 5, 8, 5, 5], 0.5)[2]).toBe(4);
    expect(between([0, 0, 0, 0, 0], [0, 5, 5, 5, 5], 0.5)[0]).toBe(0);
});

test("the easing starts quickly and settles slowly, without overshoot", () => {
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

test("values are shown with one decimal at most", () => {
    expect([0, 5, 6.5, 7.666, 5 / 3].map(shown)).toEqual(["0", "5", "6.5", "7.7", "1.7"]);
});
