// Which of the menus' lines the text's right-click menu holds: link, comment, bold, italic and
// underline, in that order, the menus' own lines, leaving out what the document does not have. The
// menu is opened in the browser in in-text.test.ts.

import { expect, test } from "bun:test";
import { linesFor } from "./text-menu";
import type { MenuItem } from "./ui";

const item = (key: string, label: string, extra: Partial<MenuItem> = {}): MenuItem => ({ key, label, run: () => {}, ...extra });

test("the text's menu takes the menus' own lines for link, comment, bold, italic and underline, in that order", () => {
    const menus = [{ items: () => [item("bold", "Bold", { hint: "Ctrl+B" }), item("italic", "Italic"), item("table", "Table")] }, { items: () => [item("underline", "Underline"), item("comment", "Comment"), item("link", "Link")] }];
    const lines = linesFor(menus);
    expect(lines.map((line) => line.label)).toEqual(["Link", "Comment", "Bold", "Italic", "Underline"]);
    expect(lines[2]!.hint).toBe("Ctrl+B");
});

test("a line the document does not have, or that cannot act now, is left out", () => {
    const menus = [{ items: () => [item("bold", "Bold"), item("link", "Link", { disabled: true })] }];
    expect(linesFor(menus).map((line) => line.label)).toEqual(["Bold"]);
});
