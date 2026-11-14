// What the command palette is held to: two quick taps of Ctrl alone open it and nothing else does
// (a Ctrl shortcut, AltGr, a held Ctrl, a click or the wheel with Ctrl held, an input method); a
// line is found by its name, its other words and its menu; among answers as good, what fits where
// the cursor is comes first; headings are offered to go to; and the menus' own lines are its
// commands. Run with `bun test src/quire`.

import { expect, test } from "bun:test";
import { commandLines, rank, score, tap, TAP, type Line, type Stroke, type Taps } from "./palette";

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

test("with nothing typed it opens on what fits, then the most used, then the kind's first commands, and no headings", () => {
    const lines = [line("Print", { key: "print" }), line("Stamp", { key: "stamp" }), line("Remove", { fits: "picture" }), line("Go to: Intro", { heading: "Intro" })];
    expect(rank(lines, "", undefined, {}, 8, ["stamp"]).map((each) => each.key)).toEqual(["stamp", "print", "remove"]);
    expect(rank(lines, "", "picture", { print: 2 }, 8, ["stamp"]).map((each) => each.key)).toEqual(["remove", "print", "stamp"]);
});

test("a kind's menus are its commands, each once, with what the kind adds to each line", () => {
    const menus = [{ label: "Edit", items: () => [{ label: "Insert the date", key: "stamp", hint: "Ctrl+Shift+D", run: () => {} }, { label: "Tidy", key: "tidy", run: () => {} }, { label: "Tidy", key: "tidy", run: () => {} }] }];
    const lines = commandLines(menus, undefined, (key) => (key === "tidy" ? { words: ["trim"], fits: "words" } : {}));
    expect(lines.map((each) => each.key)).toEqual(["stamp", "tidy"]);
    expect(lines[0]).toMatchObject({ menu: "Edit", hint: "Ctrl+Shift+D" });
    expect(rank(lines, "trim", undefined, {})[0]!.key).toBe("tidy");
});
