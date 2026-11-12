// What decides the outline's current heading is held to: the last heading at or before the cursor,
// and while scrolling the last heading whose top has passed the line under the bar. Run with
// `bun test src/quire`.

import { expect, test } from "bun:test";
import { outline } from "./document";
import { headingAtCursor, headingAtScroll } from "./outline";
import { read } from "./read";

const doc = read("Intro\n\n# One\n\ntext\n\n## Two\n\n> ### Three in a quote\n\n- a list\n");
const entries = outline(doc);

test("the current heading is the last one at or before the cursor", () => {
    expect(entries.map((entry) => entry.text)).toEqual(["One", "Two", "Three in a quote"]);
    expect(headingAtCursor(entries, { path: [0], offset: 2 })).toBe(-1);
    expect(headingAtCursor(entries, { path: [1], offset: 0 })).toBe(0);
    expect(headingAtCursor(entries, { path: [2], offset: 1 })).toBe(0);
    expect(headingAtCursor(entries, { path: [3], offset: 1 })).toBe(1);
    expect(headingAtCursor(entries, { path: [4, 0], offset: 1 })).toBe(2);
    expect(headingAtCursor(entries, { path: [5, 0, 0], offset: 1 })).toBe(2);
});

test("while scrolling, it is the last heading whose top has passed the line, or the first", () => {
    expect(headingAtScroll([200, 600, 1200], 100)).toBe(0);
    expect(headingAtScroll([-300, 80, 1200], 100)).toBe(1);
    expect(headingAtScroll([-900, -400, -10], 100)).toBe(2);
    expect(headingAtScroll([], 100)).toBe(-1);
});
