// What decides the selection bar is held to: it shows only for selected text that can take marks,
// and shows pressed what is true of the selection. Run with `bun test src/quire`.

import { expect, test } from "bun:test";
import { caret } from "./keys";
import { read } from "./read";
import { barFor } from "./select-bar";

test("it shows for selected text and not for a cursor alone", () => {
    const doc = read("Some words here\n");
    expect(barFor(doc, { anchor: { path: [0], offset: 0 }, focus: { path: [0], offset: 4 } }, []).show).toBe(true);
    expect(barFor(doc, caret([0], 2), []).show).toBe(false);
});

test("it does not show inside code, where there is nothing for it to do, but does in a table cell", () => {
    const doc = read("```\nlet a = 1;\n```\n\n| a | b |\n| - | - |\n| one | two |\n");
    expect(barFor(doc, { anchor: { path: [0], offset: 0 }, focus: { path: [0], offset: 3 } }, []).show).toBe(false);
    expect(barFor(doc, { anchor: { path: [1, 1, 0], offset: 0 }, focus: { path: [1, 1, 0], offset: 3 } }, []).show).toBe(true);
});

test("it shows as pressed the marks, link and kind of block of the selection", () => {
    const doc = read("# A [linked](/x) title\n\n> quoted\n\n- listed\n");
    const heading = barFor(doc, { anchor: { path: [0], offset: 2 }, focus: { path: [0], offset: 6 } }, ["bold"]).pressed;
    expect(heading).toMatchObject({ bold: true, italic: false, link: true, heading: true, quote: false, list: false });
    expect(barFor(doc, { anchor: { path: [1, 0], offset: 0 }, focus: { path: [1, 0], offset: 3 } }, []).pressed.quote).toBe(true);
    expect(barFor(doc, { anchor: { path: [2, 0, 0], offset: 0 }, focus: { path: [2, 0, 0], offset: 3 } }, []).pressed.list).toBe(true);
});
