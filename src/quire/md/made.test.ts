// What the slash menu's learning is held to: it counts what a change made however it was made,
// ranks the most made first with ties in the menu's order, opens on the first five before anything
// is counted, and reads rubbish kept in the browser as nothing counted.

import { expect, test } from "bun:test";
import { documentOf, paragraph } from "./document";
import { caret, handle } from "./keys";
import { counted, ranked, readCounts } from "../core/most-used";
import { FIRST_FIVE, made, opening, tally } from "./made";
import { read } from "./read";
import { filterSlash, SLASH_KEYS } from "./slash";

const keys = (items: { key: string }[]) => items.map((item) => item.key);

/** Types each character into an empty document, as the keyboard would, and gives back what the last one made, if it was a Markdown mark. */
function typed(text: string): string[] {
    let state = { doc: documentOf([paragraph()]), selection: caret([0], 0) };
    let last: string[] = [];
    for (const character of text) {
        const outcome = handle(state, { type: "text", text: character });
        if (!outcome || !("state" in outcome)) throw new Error(`nothing came of ${character}`);
        last = outcome.kind === "shortcut" ? made(state.doc, outcome.state.doc) : [];
        state = { doc: outcome.state.doc, selection: outcome.state.selection };
    }
    return last;
}

test("before anything is counted, the menu opens on Heading 2, Bulleted list, Checklist, Picture and Code block", () => {
    expect(keys(filterSlash("", false)).slice(0, 5)).toEqual(FIRST_FIVE);
    expect(keys(filterSlash("", false)).slice(0, 5)).toEqual(["heading2", "bullet", "task", "image", "code"]);
    // the rest follow in the menu's own order
    expect(keys(filterSlash("", false)).slice(5, 8)).toEqual(["heading1", "heading3", "number"]);
});

test("the most made come first, and those made as often keep the order they had", () => {
    expect(keys(filterSlash("", false, { bullet: 3 })).slice(0, 5)).toEqual(["bullet", "heading2", "task", "image", "code"]);
    expect(keys(filterSlash("", false, { table: 2, quote: 2, code: 1 })).slice(0, 5)).toEqual(["quote", "table", "code", "heading2", "bullet"]);
    expect(keys(ranked([{ key: "a" }, { key: "b" }, { key: "c" }], { c: 1 }))).toEqual(["c", "a", "b"]);
    expect(keys(opening([{ key: "x" }, { key: "code" }], {}))).toEqual(["code", "x"]);
});

test("typing after the slash puts the most made first among those that match as well", () => {
    expect(keys(filterSlash("head", false, { heading3: 4 }))).toEqual(["heading3", "heading1", "heading2"]);
    // a match by name still comes before a match by another word, however often the other is made
    expect(keys(filterSlash("list", false, { definitions: 9 }))).toEqual(["definitions", "bullet", "number"]);
    // Horizontal line has "li" in its name, so it is a match by name, and the most made of those comes first
    expect(keys(filterSlash("li", false, { divider: 9 }))).toEqual(["divider", "bullet", "number", "definitions"]);
});

test("the site's components stay in MDX files alone, however often they were made", () => {
    expect(filterSlash("", false, { figure: 50 }).some((item) => item.mdx)).toBe(false);
    expect(keys(filterSlash("", true, { figure: 50 }))[0]).toBe("figure");
});

test("rubbish kept in the browser reads as nothing counted, and only whole counts of known things are kept", () => {
    for (const kept of [null, "", "not json", "[1,2]", "null", "7", '"text"']) expect(readCounts(kept, SLASH_KEYS)).toEqual({});
    expect(readCounts('{"bullet":3,"nonsense":4,"code":-1,"table":1.5,"quote":"2","task":0,"__proto__":5}', SLASH_KEYS)).toEqual({ bullet: 3 });
});

test("one more is counted for each thing made", () => {
    expect(counted({ bullet: 1 }, ["bullet", "code"])).toEqual({ bullet: 2, code: 1 });
});

test("a typed Markdown mark counts what it made", () => {
    expect(typed("* ")).toEqual(["bullet"]);
    expect(typed("## ")).toEqual(["heading2"]);
    expect(typed("``` ")).toEqual(["code"]);
    expect(typed("```rust ")).toEqual(["code"]);
    expect(typed("> ")).toEqual(["quote"]);
    expect(typed("[ ] ")).toEqual(["task"]);
    expect(typed("1. ")).toEqual(["number"]);
    expect(typed("---")).toEqual(["divider"]);
    expect(typed("$$")).toEqual(["maths"]);
});

test("what a change made is what there is more of after it, so a new item of a list already there counts and a changed one does not", () => {
    expect(made(read("- a\n"), read("- a\n- b\n"))).toEqual(["bullet"]);
    expect(made(read("# A\n"), read("## A\n"))).toEqual(["heading2"]);
    expect(made(read("- a\n"), read("1. a\n"))).toEqual(["number"]);
    expect(made(read("Text\n"), read("Text\n"))).toEqual([]);
    expect(made(read("## A\n"), read("A\n"))).toEqual([]);
    expect(tally(read("> [!NOTE]\n> a\n\n![x](y.png)\n\n| a |\n| - |\n| b |\n\n```mermaid\nA\n```\n"))).toEqual({ callout: 1, image: 1, table: 1, diagram: 1 });
});
