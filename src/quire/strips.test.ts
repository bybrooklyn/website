// Where a floating strip goes: never over what it belongs to nor the lines next to it while there is
// room, passing over the lines in its way, and only when the window leaves none over the line next
// to it, then over the target's edge of the window. The strips themselves are placed in the browser
// in in-text.test.ts.

import { expect, test } from "bun:test";
import { placeClear } from "./strips";

const window = { left: 0, top: 100, width: 1000, height: 700 };
const strip = { width: 200, height: 36 };
/** A line of text 26 pixels tall across the writing, starting at `top`. */
const line = (top: number) => ({ left: 100, top, width: 700, height: 26 });

test("a strip goes above what it belongs to, over the line above it rather than on it", () => {
    const words = { left: 300, top: 400, width: 100, height: 26 };
    const placed = placeClear(words, strip, window, [line(374), line(426)]);
    expect(placed.side).toBe("above");
    // clear of the line above, which ends where the words begin
    expect(placed.top + strip.height).toBeLessThanOrEqual(374 - 8);
    // centred on the words
    expect(placed.left).toBe(250);
});

test("with no room above under the editor's bar, it goes below, under the line below", () => {
    const words = { left: 300, top: 150, width: 100, height: 26 };
    const placed = placeClear(words, strip, window, [line(124), line(176)]);
    expect(placed.side).toBe("below");
    expect(placed.top).toBeGreaterThanOrEqual(176 + 26 + 8);
});

test("only when neither side has room clear of the lines next to it does it cover one, and never what it belongs to", () => {
    const tight = { left: 0, top: 100, width: 1000, height: 160 };
    const words = { left: 300, top: 170, width: 100, height: 26 };
    const placed = placeClear(words, strip, tight, [line(144), line(196)]);
    const box = { top: placed.top, bottom: placed.top + strip.height };
    expect(box.bottom <= words.top || box.top >= words.top + words.height).toBe(true);
});

test("a strip asked to sit below goes below, and one set at the end lines up with the target's right edge", () => {
    const table = { left: 100, top: 300, width: 600, height: 200 };
    const placed = placeClear(table, strip, window, [line(274), line(500)], "below", "end");
    expect(placed).toEqual({ left: 500, top: 534, side: "below" });
});

test("it stays inside the window from side to side", () => {
    const words = { left: 0, top: 400, width: 20, height: 26 };
    expect(placeClear(words, strip, window).left).toBe(8);
    expect(placeClear({ ...words, left: 990 }, strip, window).left).toBe(1000 - 8 - 200);
});
