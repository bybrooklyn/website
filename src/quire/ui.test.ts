// What the controls' counting is held to: the arrow keys walk a toolbar round and round, and a
// floating bar goes above what it is about when there is room, below when not, and never past the
// window's edges. Run with `bun test src/quire`.

import { expect, test } from "bun:test";
import { moveIndex, placeNear, typeAhead } from "./ui";

test("a letter typed in a menu goes to the next line starting with it, round again, and more letters spell more of it", () => {
    const labels = ["Undo", "Redo", "Select all", "Show the Markdown", "Search"];
    expect(typeAhead(labels, -1, "s")).toBe(2);
    expect(typeAhead(labels, 2, "s")).toBe(3);
    expect(typeAhead(labels, 4, "s")).toBe(2);
    expect(typeAhead(labels, 2, "sh")).toBe(3);
    expect(typeAhead(labels, 0, "x")).toBeUndefined();
    expect(typeAhead(labels, 0, "")).toBeUndefined();
});

test("the arrow keys move along a toolbar and wrap at the ends, Home and End go to the ends", () => {
    expect(moveIndex(0, "ArrowRight", 4)).toBe(1);
    expect(moveIndex(3, "ArrowRight", 4)).toBe(0);
    expect(moveIndex(0, "ArrowLeft", 4)).toBe(3);
    expect(moveIndex(2, "Home", 4)).toBe(0);
    expect(moveIndex(1, "End", 4)).toBe(3);
    expect(moveIndex(1, "ArrowDown", 4)).toBeUndefined();
    expect(moveIndex(1, "ArrowDown", 4, true)).toBe(2);
    expect(moveIndex(-1, "ArrowDown", 4, true)).toBe(0);
    expect(moveIndex(0, "ArrowRight", 0)).toBeUndefined();
});

test("a floating bar sits above its target, centred, when there is room", () => {
    const place = placeNear({ left: 400, top: 300, width: 200, height: 20 }, { width: 100, height: 40 }, { width: 1000, height: 800 });
    expect(place).toEqual({ left: 450, top: 252, side: "above" });
});

test("with no room above it goes below, and it never covers the target", () => {
    const target = { left: 400, top: 20, width: 200, height: 20 };
    const place = placeNear(target, { width: 100, height: 40 }, { width: 1000, height: 800 });
    expect(place.side).toBe("below");
    expect(place.top).toBeGreaterThanOrEqual(target.top + target.height);
});

test("it is slid along to stay inside the window at both edges", () => {
    expect(placeNear({ left: 0, top: 300, width: 10, height: 20 }, { width: 300, height: 40 }, { width: 390, height: 800 }).left).toBe(8);
    expect(placeNear({ left: 380, top: 300, width: 10, height: 20 }, { width: 300, height: 40 }, { width: 390, height: 800 }).left).toBe(82);
});
