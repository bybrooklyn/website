// What the stage's arithmetic is held to: a picture is fitted inside its room and never blown up past
// one to one; zooming keeps the pixel under the pointer where it was; the crop's frame stays inside
// the picture in whole pixels, turns over when a corner passes the one opposite, and keeps its shape
// when one is held, the opposite corner staying put.

import { expect, test } from "bun:test";
import { dragFrame, fit, oneToOne, shapeFrame, spanned, toPicture, zoomAt } from "./geometry";

const picture = { width: 1000, height: 500 };

test("a picture is fitted inside its room with a margin, centred, and a small one is shown at its own size", () => {
    expect(fit(picture, { width: 548, height: 400 })).toEqual({ scale: 0.5, x: 24, y: 75 });
    expect(fit({ width: 100, height: 50 }, { width: 800, height: 600 })).toEqual({ scale: 1, x: 350, y: 275 });
});

test("zooming keeps the picture's pixel under the pointer where it was, and one to one is one to one", () => {
    const view = { scale: 0.5, x: 24, y: 75 };
    const at = { x: 300, y: 200 };
    const before = toPicture(view, at);
    const zoomed = zoomAt(view, 3, at);
    expect(zoomed.scale).toBe(1.5);
    expect(toPicture(zoomed, at).x).toBeCloseTo(before.x, 9);
    expect(toPicture(zoomed, at).y).toBeCloseTo(before.y, 9);
    expect(oneToOne(zoomed, at).scale).toBe(1);
    expect(zoomAt(view, 1e9, at).scale).toBe(32);
});

test("the frame dragged by a corner stays inside the picture in whole pixels, and turns over past the opposite corner", () => {
    const start = { x: 100, y: 100, width: 200, height: 100 };
    expect(dragFrame(start, "se", { x: 50.4, y: 20.6 }, picture)).toEqual({ x: 100, y: 100, width: 250, height: 121 });
    expect(dragFrame(start, "nw", { x: -500, y: -500 }, picture)).toEqual({ x: 0, y: 0, width: 300, height: 200 });
    expect(dragFrame(start, "e", { x: -300, y: 0 }, picture)).toEqual({ x: 0, y: 100, width: 100, height: 100 });
    expect(dragFrame(start, "move", { x: 5000, y: 3 }, picture)).toEqual({ x: 800, y: 103, width: 200, height: 100 });
});

test("with a shape held, the frame keeps it and the opposite corner stays put, even at the picture's edge", () => {
    const start = { x: 100, y: 100, width: 200, height: 100 };
    const square = dragFrame(start, "se", { x: 100, y: 10 }, picture, 1);
    expect(square.width).toBe(square.height);
    expect([square.x, square.y]).toEqual([100, 100]);
    const edge = dragFrame(start, "se", { x: 2000, y: 2000 }, picture, 1);
    expect(edge).toEqual({ x: 100, y: 100, width: 400, height: 400 });
    const wide = dragFrame(start, "e", { x: 100, y: 0 }, picture, 16 / 9);
    expect(Math.abs(wide.width / wide.height - 16 / 9)).toBeLessThan(0.02);
});

test("a shape chosen makes the largest frame of it that fits, centred where the frame was", () => {
    expect(shapeFrame({ x: 0, y: 0, width: 1000, height: 500 }, 1, picture)).toEqual({ x: 250, y: 0, width: 500, height: 500 });
    expect(spanned({ x: 10, y: 50 }, { x: 0, y: 0 })).toEqual({ x: 0, y: 0, width: 10, height: 50 });
});
