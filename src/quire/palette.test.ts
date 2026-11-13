// What the command palette is held to: two quick taps of Ctrl alone open it and nothing else does
// (a Ctrl shortcut, AltGr, a held Ctrl, a click or the wheel with Ctrl held, an input method); a
// line is found by its name, its other words and its menu; among answers as good, what fits where
// the cursor is comes first; headings are offered to go to; and the menus' own lines are its
// commands. Run with `bun test src/quire`.

import { expect, test } from "bun:test";
import { headings, type Command, type RowActions } from "./menu-row";
import { caret } from "./keys";
import { commandLines, headingLines, placeOf, rank, score, tap, TAP, type Line, type Stroke, type Taps } from "./palette";
import { read } from "./read";

/** Plays strokes through the double tap and gives back the times it opened. */
function play(strokes: Stroke[], keys?: string[]): number[] {
    let taps: Taps = {};
    const opened: number[] = [];
    for (const stroke of strokes) {
        const next = tap(taps, stroke, keys);
        taps = next.taps;
        if (next.open) opened.push(stroke.time);
    }
    return opened;
}
const press = (key: string, at: number, length = 60, more: Partial<Stroke> = {}): Stroke[] => [
    { type: "down", key, time: at, ...more },
    { type: "up", key, time: at + length, ...more },
];

test("two quick taps of Ctrl alone open it, on the second letting go", () => {
    expect(play([...press("Control", 0), ...press("Control", 150)])).toEqual([210]);
    // a third tap does not open it again; a fourth, with the third, does
    expect(play([...press("Control", 0), ...press("Control", 150), ...press("Control", 300), ...press("Control", 450)])).toEqual([210, 510]);
});

test("taps too far apart, or a press held longer than a tap, do not open it", () => {
    expect(play([...press("Control", 0), ...press("Control", 60 + TAP + 1)])).toEqual([]);
    expect(play([...press("Control", 0, TAP + 1), ...press("Control", TAP + 100)])).toEqual([]);
    expect(play([...press("Control", 0), { type: "down", key: "Control", time: 150 }, { type: "down", key: "Control", time: 650, repeat: true }, { type: "up", key: "Control", time: 700 }])).toEqual([]);
});

test("a key pressed between the taps, as in Ctrl+C, starts it over", () => {
    expect(play([{ type: "down", key: "Control", time: 0 }, { type: "down", key: "c", time: 40 }, { type: "up", key: "Control", time: 80 }, ...press("Control", 150)])).toEqual([]);
    expect(play([...press("Control", 0), ...press("a", 100, 20), ...press("Control", 150)])).toEqual([]);
    // a key let go from before the taps changes nothing
    expect(play([{ type: "down", key: "Control", time: 0 }, { type: "up", key: "a", time: 20 }, { type: "up", key: "Control", time: 60 }, ...press("Control", 150)])).toEqual([210]);
});

test("AltGr, which Windows and Linux send with Ctrl, never counts as a tap", () => {
    // Windows: Ctrl down, then Alt down, for one AltGr press
    const windows = (at: number): Stroke[] => [
        { type: "down", key: "Control", time: at },
        { type: "down", key: "Alt", time: at + 1, held: true },
        { type: "up", key: "Control", time: at + 60, held: true },
        { type: "up", key: "Alt", time: at + 61 },
    ];
    expect(play([...windows(0), ...windows(150)])).toEqual([]);
    expect(play([...press("Control", 0, 60, { held: true }), ...press("Control", 150, 60, { held: true })])).toEqual([]);
    expect(play([...press("AltGraph", 0), ...press("AltGraph", 150)])).toEqual([]);
});

test("a click or the wheel with Ctrl held, or typing with an input method, starts it over", () => {
    expect(play([...press("Control", 0), { type: "down", key: "Control", time: 150 }, { type: "other", time: 170 }, { type: "up", key: "Control", time: 210 }])).toEqual([]);
    expect(play([...press("Control", 0, 60, { composing: true }), ...press("Control", 150, 60, { composing: true })])).toEqual([]);
});

test("on a Mac Cmd taps as Ctrl does, but one of each is not a double tap", () => {
    const mac = ["Control", "Meta"];
    expect(play([...press("Meta", 0), ...press("Meta", 150)], mac)).toEqual([210]);
    expect(play([...press("Control", 0), ...press("Meta", 150)], mac)).toEqual([]);
    expect(play([...press("Meta", 0), ...press("Meta", 150)])).toEqual([]);
});

const line = (label: string, more: Partial<Line> = {}): Line => ({ key: label.toLowerCase(), label, run: () => {}, ...more });

test("a line answers by its name first, then by its other words and its menu", () => {
    expect(score(line("Heading 2"), "head")).toBe(4);
    expect(score(line("Add a row below"), "row bel")).toBe(3);
    expect(score(line("Checklist", { words: ["todo"] }), "todo")).toBe(2);
    expect(score(line("Zoom in", { menu: "View" }), "view zoom")).toBe(2);
    expect(score(line("Underline"), "line")).toBe(1);
    expect(score(line("Bold"), "table")).toBe(0);
    expect(score(line("Bold"), "  ")).toBe(0);
});

test("among answers as good, what fits where the cursor is comes first, then the most used", () => {
    const lines = [line("Align left"), line("Align the column left", { fits: "table" }), line("Bold", { fits: "words" })];
    expect(rank(lines, "align", undefined, {}).map((each) => each.label)).toEqual(["Align left", "Align the column left"]);
    expect(rank(lines, "align", "table", {}).map((each) => each.label)).toEqual(["Align the column left", "Align left"]);
    expect(rank(lines, "al", undefined, { "align the column left": 3 }).map((each) => each.label)).toEqual(["Align the column left", "Align left"]);
    // a better answer stays ahead of one that fits
    expect(rank([line("Bold", { fits: "words" }), line("Clear formatting")], "clear", "words", {}).map((each) => each.label)).toEqual(["Clear formatting"]);
});

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

test("its commands are the menus' own lines, each once, with the slash items' words, where they fit and their shortcuts", () => {
    const act = new Proxy({}, { get: (_, name) => (name === "file" || name === "tools" ? undefined : () => {}) }) as RowActions;
    const lines = commandLines(headings({ rich: false, outline: false, markdown: false, words: 3 }, act));
    const find = (key: Command) => lines.find((each) => each.key === key)!;
    expect(find("bold")).toMatchObject({ label: "Bold", menu: "Format", hint: "Ctrl+B", fits: "words" });
    expect(find("bullet")).toMatchObject({ menu: "Insert", fits: "list" });
    expect(find("task").words).toContain("todo");
    expect(find("picture").words).toContain("photo");
    // a hint that is not a shortcut is not shown as one, and the word count is not a command
    expect(find("download").hint).toBeUndefined();
    expect(lines.some((each) => each.label.endsWith("words"))).toBe(false);
    // a command in two menus is one line, in the first
    expect(lines.filter((each) => each.key === "link")).toHaveLength(1);
    expect(rank(lines, "todo", undefined, {})[0]!.key).toBe("task");
    expect(rank(lines, "bold", "words", {})[0]!.key).toBe("bold");
});
