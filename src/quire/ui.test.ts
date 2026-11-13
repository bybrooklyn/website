// What the controls' counting is held to: the arrow keys walk a toolbar round and round, and a
// floating bar goes above what it is about when there is room, below when not, and never past the
// window's edges; a menu drops below its control, and its shortcuts are drawn as the keys' symbols. Run with `bun test src/quire`.

import { expect, test } from "bun:test";
import { keySymbols, menuPlace, MOTION, moveIndex, placeNear, springCurve, typeAhead } from "./ui";

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

test("a shortcut is drawn as its keys' symbols and said in words; a hint that is not a shortcut stays as it is", () => {
    expect(keySymbols("Ctrl+B")).toEqual({ shown: "⌃B", words: "Control B" });
    expect(keySymbols("Ctrl+Shift+Z")).toEqual({ shown: "⌃⇧Z", words: "Control Shift Z" });
    expect(keySymbols("Ctrl+Alt+2")).toEqual({ shown: "⌃⌥2", words: "Control Alt 2" });
    expect(keySymbols("Ctrl+Enter")).toEqual({ shown: "⌃↵", words: "Control Enter" });
    expect(keySymbols("Ctrl+B", true)).toEqual({ shown: "⌘B", words: "Command B" });
    for (const hint of ["›", ".md", "bring back", "Ctrl+"]) expect(keySymbols(hint)).toEqual({ shown: hint, words: "" });
});

test("a menu drops below its control, its left edge on the control's, and covers nothing", () => {
    const control = { left: 100, top: 40, width: 50, height: 30 };
    const at = menuPlace(control, { width: 200, height: 300 }, { width: 1000, height: 800 });
    expect(at).toEqual({ left: 100, top: 74, width: 200, height: 300, up: false });
    expect(at.top).toBeGreaterThanOrEqual(control.top + control.height);
});

test("with no room to the right a menu keeps to the control's right edge, and with no room below it grows upward", () => {
    expect(menuPlace({ left: 900, top: 40, width: 50, height: 30 }, { width: 200, height: 100 }, { width: 1000, height: 800 }).left).toBe(750);
    const up = menuPlace({ left: 100, top: 700, width: 50, height: 30 }, { width: 200, height: 300 }, { width: 1000, height: 800 });
    expect(up.up).toBe(true);
    expect(up.top + up.height).toBeLessThanOrEqual(700);
    // a menu taller than any room is cut to the room, and scrolls inside itself
    expect(menuPlace({ left: 100, top: 40, width: 50, height: 30 }, { width: 200, height: 2000 }, { width: 1000, height: 800 }).height).toBe(800 - 8 - 74);
});

test("the menus open in 200 ms on a slight spring and close in 140 ms, their lines 14 ms apart, as the lab chose", () => {
    expect(MOTION).toEqual({ open: 200, close: 140, stagger: 14, bounce: 0.14 });
    const points = springCurve(MOTION.bounce).slice(7, -1).split(", ").map(Number);
    expect(points[0]).toBe(0);
    expect(points.at(-1)).toBe(1);
    // a slight spring goes a little past its end and comes back
    expect(Math.max(...points)).toBeGreaterThan(1);
    expect(Math.max(...points)).toBeLessThan(1.1);
});
