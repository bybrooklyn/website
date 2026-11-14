// What mdQuire gives the command palette is held to: where the cursor is, the headings to go to,
// the slash items' words and where each command fits, and the slash menu's first five to open on.
// The palette itself is held in core/palette.test.ts.

import { expect, test } from "bun:test";
import { headings, type RowActions } from "./menus";
import { caret } from "./keys";
import { read } from "./read";
import { commandLines as coreLines, rank as coreRank, type Line } from "../core/palette";
import { describe, FIRST, headingLines, placeOf } from "./slash-menu";
import type { Heading } from "../core/menu-row";
import type { Counts } from "../core/most-used";

const line = (label: string, more: Partial<Line> = {}): Line => ({ key: label.toLowerCase(), label, run: () => {}, ...more });
/** The palette's ranking as mdQuire's palette does it, opening on the slash menu's first five. */
const rank = (lines: Line[], query: string, place: string | undefined, counts: Counts, few = 8) => coreRank(lines, query, place, counts, few, FIRST);
/** The menus' lines as mdQuire's palette reads them. */
const commandLines = (menus: Heading[], reveal?: (path: string[]) => void) => coreLines(menus, reveal, describe);

test("with nothing typed it opens on what fits, then the most used, then the first five, and no headings", () => {
    const lines = [line("Print", { key: "print" }), line("Code block", { key: "code" }), line("Heading 2", { key: "heading2" }), line("Remove", { fits: "picture" }), line("Go to: Intro", { heading: "Intro" })];
    expect(rank(lines, "", undefined, {}).map((each) => each.key)).toEqual(["heading2", "code", "print", "remove"]);
    expect(rank(lines, "", "picture", { print: 2 }).map((each) => each.key)).toEqual(["remove", "print", "heading2", "code"]);
    expect(rank(lines, "", undefined, {}, 2)).toHaveLength(2);
});

test("typing words of a heading offers to go to it", () => {
    const doc = read("# Mote and its moons\n\nText.\n\n## Minis\n\n## \n");
    const went: number[][] = [];
    const lines = headingLines(doc, (path) => went.push(path));
    expect(lines.map((each) => each.label)).toEqual(["Go to: Mote and its moons", "Go to: Minis"]);
    const found = rank([line("Mode"), ...lines], "moons", undefined, {});
    expect(found.map((each) => each.label)).toEqual(["Go to: Mote and its moons"]);
    found[0]!.run();
    expect(went).toEqual([[0]]);
    // a heading is found by its own words, not by "go to"
    expect(rank(lines, "go", undefined, {})).toEqual([]);
});

test("where the cursor is: a picked picture, a table, selected words, a list", () => {
    const doc = read("Words here.\n\n- one\n- two\n\n| a | b |\n| --- | --- |\n| c | d |\n");
    expect(placeOf(doc, caret([0], 2))).toBeUndefined();
    expect(placeOf(doc, caret([0], 2), true)).toBe("picture");
    expect(placeOf(doc, { anchor: { path: [0], offset: 0 }, focus: { path: [0], offset: 5 } })).toBe("words");
    expect(placeOf(doc, caret([1, 0, 0], 1))).toBe("list");
    expect(placeOf(doc, caret([2, 1, 0], 0))).toBe("table");
});

test("its commands are the menus' own lines, each once, those inside a group with the group's path, with their other names, the slash items' words, where they fit and their shortcuts", () => {
    const given: Record<string, unknown> = { file: undefined, tools: undefined, subs: { size: () => [{ label: "12", hint: "12", run: () => {} }] }, forms: { bookmark: () => ({}) } };
    const act = new Proxy(given, { get: (_, name: string) => (name in given ? given[name] : () => {}) }) as RowActions;
    const revealed: string[][] = [];
    const lines = commandLines(headings({ rich: false, outline: false, markdown: false }, act), (path) => revealed.push(path));
    const find = (key: string) => lines.find((each) => each.key === key)!;
    expect(find("bold")).toMatchObject({ label: "Bold", menu: "Format › Text", hint: "Ctrl+B", fits: "words" });
    expect(find("bullet")).toMatchObject({ menu: "Format › Bullets and numbering", fits: "list" });
    expect(find("task").words).toContain("todo");
    expect(find("picture").words).toContain("photo");
    // a hint that is not a shortcut is not shown as one, and a line that only opens a group is not a command
    expect(find("Format › Text › Size: 12").hint).toBeUndefined();
    expect(lines.some((each) => each.label === "Text" || each.label === "Size")).toBe(false);
    // what the wording renamed is found by its old name
    expect(rank(lines, "indent more", undefined, {})[0]!.key).toBe("indent");
    expect(rank(lines, "typeface", undefined, {}).length).toBe(0);
    expect(rank(lines, "the markdown beside", undefined, {})[0]!.key).toBe("markdown");
    expect(rank(lines, "todo", undefined, {})[0]!.key).toBe("task");
    expect(rank(lines, "bold", "words", {})[0]!.key).toBe("bold");
    // a line whose form opens beside it opens the menus down to it
    find("bookmark").run();
    expect(revealed).toEqual([["Insert", "Bookmark"]]);
});
