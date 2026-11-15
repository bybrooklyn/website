// What choosing and moving marks is held to: the mark under the pointer is the last one drawn there;
// an arrow is taken along its line, a box by its edge so that what is inside it can still be
// reached, and text by its block; and a moved mark keeps its shape. Drawing them is seen in the
// browser tests of the editor.

import { expect, test } from "bun:test";
import { allAt, headOf, markAt, markBox, moved } from "./marks";
import type { Mark } from "./steps";

const arrow: Mark = { type: "arrow", from: { x: 10, y: 10 }, to: { x: 110, y: 10 }, color: "#d52d00", thickness: 4 };
const box: Mark = { type: "box", rect: { x: 50, y: 50, width: 100, height: 60 }, color: "#000000", thickness: 4 };
const text: Mark = { type: "text", at: { x: 200, y: 200 }, text: "Here", color: "#ffffff", size: 20 };

test("the mark under the pointer is the last one drawn there, an arrow along its line, a box by its edge, text by its block", () => {
    const marks = [arrow, box, text];
    expect(markAt(marks, { x: 60, y: 12 }, 2)).toBe(0);
    expect(markAt(marks, { x: 60, y: 30 }, 2)).toBe(-1);
    expect(markAt(marks, { x: 50, y: 80 }, 2)).toBe(1);
    expect(markAt(marks, { x: 100, y: 80 }, 2)).toBe(-1);
    expect(markAt(marks, { x: 210, y: 210 }, 2)).toBe(2);
    expect(markAt([box, { ...box, color: "#ffffff" }], { x: 50, y: 80 }, 2)).toBe(1);
});

test("how far a mark reaches takes in its thickness and an arrow's head, and a box dragged backwards", () => {
    expect(markBox({ ...box, rect: { x: 150, y: 110, width: -100, height: -60 } })).toEqual({ x: 48, y: 48, width: 104, height: 64 });
    expect(markBox(arrow).y).toBeLessThan(10 - headOf(4) / 2);
    expect(markBox(text).width).toBeGreaterThan(40);
});

test("a moved mark keeps its shape", () => {
    expect(moved(arrow, { x: 5, y: -5 })).toMatchObject({ from: { x: 15, y: 5 }, to: { x: 115, y: 5 } });
    expect(moved(box, { x: 1, y: 1 })).toMatchObject({ rect: { x: 51, y: 51, width: 100, height: 60 } });
    expect(moved(text, { x: -200, y: 0 })).toMatchObject({ at: { x: 0, y: 200 }, text: "Here" });
});

test("a box and a cover turned on their own are taken where they are turned, and not where they would be upright", () => {
    const box: Mark = { type: "box", rect: { x: 0, y: 0, width: 200, height: 20 }, color: "#000000", thickness: 4, angle: 30 };
    // the box's right end, turned 30 degrees about its middle (100, 10): about (186.6, 60)
    expect(markAt([box], { x: 186.6, y: 60 }, 2)).toBe(0);
    expect(markAt([box], { x: 200, y: 10 }, 2)).toBe(-1);
    const cover = { type: "cover" as const, rect: { x: 0, y: 0, width: 200, height: 20 }, angle: -30 };
    expect(allAt([cover], { x: 150, y: -20 }, 0)).toEqual([0]);
    expect(allAt([cover], { x: 150, y: 15 }, 0)).toEqual([]);
});
