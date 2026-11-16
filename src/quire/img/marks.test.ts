// What choosing and moving marks is held to: the mark under the pointer is the last one drawn there;
// an arrow is taken along its line, a box by its edge so that what is inside it can still be
// reached, and text by its block (aligned and outlined); a number by its circle, a highlighter along its
// stroke, a magnifier by its lens or the place it looks at, each moved on its own, and a spotlight by its
// edge; the ring round what is picked lies on it; a moved mark keeps its shape. Drawing them is seen in the
// browser tests of the editor.

import { expect, test } from "bun:test";
import { alignShare, allAt, canvasOf, gripsOf, headOf, inkOfHighlight, inkOn, lensRegion, markAt, markBox, moved, partOf, reshaped, ringsOf } from "./marks";
import type { Mark, Point, Rect } from "./steps";

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

const number: Mark = { type: "number", at: { x: 400, y: 400 }, color: "#ffd60a", size: 40, value: 3 };
const highlight: Mark = { type: "highlight", from: { x: 100, y: 300 }, to: { x: 300, y: 300 }, color: "#ffd60a", thickness: 20 };
const lens: Mark = { type: "magnifier", at: { x: 600, y: 200 }, from: { x: 300, y: 500 }, radius: 80, zoom: 2, color: "#ff3b30", thickness: 4 };
const spot: Mark = { type: "spotlight", rect: { x: 700, y: 500, width: 200, height: 100 }, dim: 0.55 };
const oval: Mark = { ...spot, round: true };

test("a number is taken anywhere in its circle, a highlighter along its stroke as thick as it is, a lens by its lens or the place it looks at, a spotlight by its edge", () => {
    expect(markAt([number], { x: 413, y: 413 }, 0)).toBe(0);
    expect(markAt([number], { x: 416, y: 416 }, 0)).toBe(-1);
    expect(markAt([highlight], { x: 200, y: 309 }, 0)).toBe(0);
    expect(markAt([highlight], { x: 200, y: 312 }, 0)).toBe(-1);
    expect(partOf(lens as Extract<Mark, { type: "magnifier" }>, { x: 650, y: 200 }, 0)).toBe("lens");
    expect(partOf(lens as Extract<Mark, { type: "magnifier" }>, { x: 330, y: 500 }, 0)).toBe("source");
    expect(partOf(lens as Extract<Mark, { type: "magnifier" }>, { x: 450, y: 350 }, 0)).toBeUndefined();
    // a spotlight's middle is left for what is in it; its edge picks it, the ellipse's own edge too
    expect(markAt([spot], { x: 700, y: 550 }, 2)).toBe(0);
    expect(markAt([spot], { x: 800, y: 550 }, 2)).toBe(-1);
    expect(markAt([oval], { x: 800, y: 500 }, 2)).toBe(0);
    expect(markAt([oval], { x: 702, y: 502 }, 2)).toBe(-1);
});

test("a lens moves on its own, or the place it looks at on its own, or both; the other marks move whole", () => {
    expect(moved(lens, { x: 10, y: 0 }, "lens")).toMatchObject({ at: { x: 610, y: 200 }, from: { x: 300, y: 500 } });
    expect(moved(lens, { x: 10, y: 0 }, "source")).toMatchObject({ at: { x: 600, y: 200 }, from: { x: 310, y: 500 } });
    expect(moved(lens, { x: 10, y: 0 })).toMatchObject({ at: { x: 610, y: 200 }, from: { x: 310, y: 500 } });
    expect(moved(highlight, { x: 0, y: 5 })).toMatchObject({ from: { x: 100, y: 305 }, to: { x: 300, y: 305 } });
    expect(moved(spot, { x: -700, y: 0 })).toMatchObject({ rect: { x: 0, y: 500, width: 200, height: 100 } });
    expect(moved(number, { x: 1, y: 1 })).toMatchObject({ at: { x: 401, y: 401 }, value: 3 });
});

test("the ring round what is picked lies on it: a circle round a number, two round a magnifier, a rectangle along a slanted highlighter", () => {
    expect(ringsOf(number)).toEqual([{ middle: { x: 400, y: 400 }, radius: 20 }]);
    expect(ringsOf(lens)).toEqual([
        { middle: { x: 600, y: 200 }, radius: 80 },
        { middle: { x: 300, y: 500 }, radius: 40 },
    ]);
    const slanted = ringsOf({ ...highlight, to: { x: 100, y: 500 } })[0] as { rect: Rect; angle: number; pivot: Point };
    expect(slanted.angle).toBe(90);
    expect(slanted.rect).toEqual({ x: 0, y: 390, width: 200, height: 20 });
    expect(slanted.pivot).toEqual({ x: 100, y: 400 });
});

test("a centered text's block lies about its place and a right-aligned one ends at it, its lines and its outline counted", () => {
    const lines: Mark = { type: "text", at: { x: 500, y: 100 }, text: "one\nthree", color: "#ffffff", size: 20, align: "center", outline: "#000000", outlineWidth: 2 };
    const box = markBox(lines);
    expect(box.x + box.width / 2).toBeCloseTo(500);
    expect(box.height).toBeCloseTo(2 * 20 * 1.2 + 4);
    const right = markBox({ ...lines, align: "right", outline: undefined, outlineWidth: undefined });
    expect(right.x + right.width).toBeCloseTo(500);
    expect(alignShare(undefined)).toBe(0);
});

test("a lens shows the square of the level picture round the place it looks at, as wide as the lens over its enlargement, drawn as many pixels across as the lens is", () => {
    const place = { across: 0.5, down: 0.5, x: 10, y: 20 };
    expect(lensRegion(lens as Extract<Mark, { type: "magnifier" }>, place)).toEqual({ crop: { x: 260, y: 460, width: 80, height: 80 }, pixels: 80 });
    // on a picture turned 90 degrees about its middle, the place it looks at is turned too
    const turned = lensRegion(lens as Extract<Mark, { type: "magnifier" }>, { across: 1, down: 1, x: 0, y: 0, turn: { degrees: 90, x: 500, y: 500 } });
    expect(turned.crop.x + 40).toBeCloseTo(500);
    expect(turned.crop.y + 40).toBeCloseTo(300);
    expect(canvasOf(place, { x: 100, y: 100 })).toEqual({ x: 60, y: 70 });
});

test("a number's figure is black on a light color and white on a dark one", () => {
    expect(inkOn("#ffd60a")).toBe("#000000");
    expect(inkOn("#ffffff")).toBe("#000000");
    expect(inkOn("#30d158")).toBe("#000000");
    expect(inkOn("#ff3b30")).toBe("#ffffff");
    expect(inkOn("#0a84ff")).toBe("#ffffff");
    expect(inkOn("#000000")).toBe("#ffffff");
});

test("a highlighter's ink is its color a third of the way to white", () => {
    expect(inkOfHighlight("#ffd60a")).toBe("#ffe45c");
    expect(inkOfHighlight("#000000")).toBe("#555555");
    expect(inkOfHighlight("#ffffff")).toBe("#ffffff");
});

const close = (point: Point, x: number, y: number) => {
    expect(point.x).toBeCloseTo(x, 6);
    expect(point.y).toBeCloseTo(y, 6);
};

test("a picked box has a handle at each corner and side, an arrow one at each end, and a text or a number none", () => {
    expect(gripsOf(box).map((each) => [each.grip, each.at.x, each.at.y])).toEqual([
        ["nw", 50, 50],
        ["n", 100, 50],
        ["ne", 150, 50],
        ["e", 150, 80],
        ["se", 150, 110],
        ["s", 100, 110],
        ["sw", 50, 110],
        ["w", 50, 80],
    ]);
    expect(gripsOf(arrow).map((each) => each.grip)).toEqual(["from", "to"]);
    expect(gripsOf(text)).toEqual([]);
    expect(gripsOf({ type: "number", at: { x: 5, y: 5 }, color: "#000000", size: 20 })).toEqual([]);
    // a box turned on its own: its handles are turned with it, a quarter turn putting its right side at the bottom
    const turned = gripsOf({ ...box, angle: 90 });
    close(turned.find((each) => each.grip === "e")!.at, 100, 130);
});

test("a handle dragged resizes from the corner or side opposite, which stays where it was, and never past a pixel", () => {
    expect(reshaped(box, "se", { x: 20, y: 10 })).toMatchObject({ rect: { x: 50, y: 50, width: 120, height: 70 } });
    expect(reshaped(box, "n", { x: 40, y: -10 })).toMatchObject({ rect: { x: 50, y: 40, width: 100, height: 70 } });
    expect(reshaped(box, "w", { x: 500, y: 0 })).toMatchObject({ rect: { x: 149, width: 1 } });
    // a cover turned a quarter: its bottom on the screen is its own right side, which a drag down moves out, its left side held
    const cover = { type: "cover" as const, rect: { x: 0, y: 0, width: 100, height: 40 }, angle: 90 };
    const before = gripsOf(cover).find((each) => each.grip === "w")!.at;
    const grown = reshaped(cover, "e", { x: 0, y: 30 });
    expect(grown.rect.width).toBeCloseTo(130, 6);
    expect(grown.rect.height).toBeCloseTo(40, 6);
    close(gripsOf(grown).find((each) => each.grip === "w")!.at, before.x, before.y);
});

test("an arrow's end moves alone; a highlighter keeps its direction and grows longer or thicker; a lens stays round", () => {
    expect(reshaped(arrow, "to", { x: 5, y: 30 })).toMatchObject({ from: { x: 10, y: 10 }, to: { x: 115, y: 40 } });
    const stroke: Mark = { type: "highlight", from: { x: 0, y: 50 }, to: { x: 100, y: 50 }, color: "#ffd60a", thickness: 20 };
    const longer = reshaped(stroke, "e", { x: 50, y: 0 }) as Extract<Mark, { type: "highlight" }>;
    close(longer.from, 0, 50);
    close(longer.to, 150, 50);
    const thicker = reshaped(stroke, "s", { x: 0, y: 10 }) as Extract<Mark, { type: "highlight" }>;
    expect(thicker.thickness).toBeCloseTo(30, 6);
    close(thicker.from, 0, 55);
    const lens: Mark = { type: "magnifier", at: { x: 100, y: 100 }, from: { x: 20, y: 20 }, radius: 30, zoom: 2, color: "#000000", thickness: 4 };
    // the right side dragged out: the lens grows round, its left side held
    expect(reshaped(lens, "e", { x: 20, y: 0 })).toMatchObject({ at: { x: 110, y: 100 }, radius: 40, from: { x: 20, y: 20 } });
});
