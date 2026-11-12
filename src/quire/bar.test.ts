// What the bar's buttons are held to: given a document and a selection, each writes the Markdown it
// says it will, puts the cursor where the next words go, and shows as pressed when it is in force.
// Run with `bun test src/quire`.

import { expect, test } from "bun:test";
import { addCode, addDivider, addFootnote, addImage, addTable, center, color, currentStyle, link, linkAt, pressedAt, setStyleOf, size, toggle, toggleList, wordAt, type Action } from "./bar";
import type { Selection } from "./document";
import type { State } from "./history";
import { caret } from "./keys";
import { read } from "./read";
import { write } from "./write";

const at = (source: string, selection: Selection): State => ({ doc: read(source), selection });
const span = (path: number[], from: number, to: number): Selection => ({ anchor: { path, offset: from }, focus: { path, offset: to } });
const run = (action: Action, state: State) => action(state);
const md = (state: State) => write(state.doc);

test("the mark buttons mark the selection, and with nothing selected wait for the next words", () => {
    expect(md(run(toggle("bold"), at("a word here\n", span([0], 2, 6))))).toBe("a **word** here\n");
    expect(md(run(toggle("italic"), at("a word here\n", span([0], 2, 6))))).toBe("a *word* here\n");
    expect(md(run(toggle("underline"), at("a word here\n", span([0], 2, 6))))).toBe("a <u>word</u> here\n");
    expect(md(run(toggle("strike"), at("a word here\n", span([0], 2, 6))))).toBe("a ~~word~~ here\n");
    expect(md(run(toggle("code"), at("a word here\n", span([0], 2, 6))))).toBe("a `word` here\n");
    const waiting = run(toggle("bold"), at("text\n", caret([0], 4)));
    expect(waiting.marks).toEqual(["bold"]);
    expect(waiting.doc).toEqual(read("text\n"));
});

test("a link is set on the selection, on the word at the cursor, and taken off the whole link", () => {
    expect(md(run(link("https://a.example"), at("a word here\n", span([0], 2, 6))))).toBe("a [word](https://a.example) here\n");
    expect(md(run(link("/b"), at("a word here\n", caret([0], 4))))).toBe("a [word](/b) here\n");
    const linked = at("a [long link](/x) here\n", caret([0], 4));
    expect(linkAt(linked.doc, linked.selection.focus)?.href).toBe("/x");
    expect(md(run(link(null), linked))).toBe("a long link here\n");
    expect(wordAt(read("one two\n"), { path: [0], offset: 5 })).toEqual({ start: { path: [0], offset: 4 }, end: { path: [0], offset: 7 } });
});

test("color and size are written as small HTML on the selection or the word at the cursor", () => {
    expect(md(run(color("salmon"), at("a word here\n", span([0], 2, 6))))).toBe('a <span style="color:salmon">word</span> here\n');
    expect(md(run(size("1.25em"), at("a word here\n", caret([0], 3))))).toBe('a <span style="font-size:1.25em">word</span> here\n');
    expect(md(run(color(null), at('a <span style="color:red">word</span>\n', caret([0], 3))))).toBe("a word\n");
});

test("the style picker makes headings, quotes, code and paragraphs, and shows which the cursor is in", () => {
    const heading = run(setStyleOf("heading2"), at("Title\n", caret([0], 2)));
    expect(md(heading)).toBe("## Title\n");
    expect(currentStyle(heading.doc, [0])).toBe("heading2");
    expect(md(run(setStyleOf("paragraph"), heading))).toBe("Title\n");
    const quoted = run(setStyleOf("quote"), at("Said\n", caret([0], 1)));
    expect(md(quoted)).toBe("> Said\n");
    expect(quoted.selection).toEqual(caret([0, 0], 1));
    expect(currentStyle(quoted.doc, [0, 0])).toBe("quote");
    expect(md(run(setStyleOf("quote"), quoted))).toBe("Said\n");
    expect(md(run(setStyleOf("code"), at("let a\n", caret([0], 0))))).toBe("```\nlet a\n```\n");
    expect(md(run(setStyleOf("heading1"), at("One\n\nTwo\n", span([0], 0, 0))))).toBe("# One\n\nTwo\n");
    expect(md(run(setStyleOf("heading3"), at("One\n\nTwo\n", { anchor: { path: [0], offset: 1 }, focus: { path: [1], offset: 1 } })))).toBe("### One\n\n### Two\n");
});

test("the list buttons make lists of all the touched paragraphs, and pressed again take them off", () => {
    const listed = run(toggleList("bullet"), at("One\n\nTwo\n", { anchor: { path: [0], offset: 0 }, focus: { path: [1], offset: 3 } }));
    expect(md(listed)).toBe("- One\n- Two\n");
    expect(listed.selection.focus).toEqual({ path: [0, 1, 0], offset: 3 });
    expect(pressedAt(listed.doc, [0, 1, 0], []).bullet).toBe(true);
    expect(md(run(toggleList("bullet"), listed))).toBe("One\n\nTwo\n");
    expect(md(run(toggleList("number"), at("One\n", caret([0], 0))))).toBe("1. One\n");
    expect(md(run(toggleList("task"), at("One\n", caret([0], 0))))).toBe("- [ ] One\n");
});

test("centre centres the cursor's block in a div and takes it off again", () => {
    const centred = run(center, at("Middle\n", caret([0], 0)));
    expect(md(centred)).toBe('<div align="center">\n\nMiddle\n\n</div>\n');
    expect(pressedAt(centred.doc, [0], []).center).toBe(true);
    expect(md(run(center, centred))).toBe("Middle\n");
});

test("the + menu adds a table, code, a divider, a picture and a footnote, the cursor where to write next", () => {
    const tabled = run(addTable, at("Above\n", caret([0], 5)));
    expect(md(tabled)).toBe("Above\n\n|     |     |     |\n| --- | --- | --- |\n|     |     |     |\n|     |     |     |\n");
    expect(tabled.selection).toEqual(caret([1, 0, 0], 0));
    // on an empty line the block takes the line's place
    const empty = run(addCode, { doc: read("A\n\nB\n"), selection: caret([0], 1) });
    expect(empty.selection).toEqual(caret([1], 0));
    expect(md(empty)).toBe("A\n\n```\n```\n\nB\n");
    const ruled = run(addDivider, at("Above\n", caret([0], 0)));
    expect(md(ruled)).toBe("Above\n\n---\n");
    expect(ruled.selection).toEqual(caret([2], 0));
    expect(md(run(addImage("/p.png", "A picture"), at("Above\n", caret([0], 0))))).toBe("Above\n\n![A picture](/p.png)\n");
    const noted = run(addFootnote, at("A claim.\n", caret([0], 8)));
    expect(md(noted)).toBe("A claim.[^1]\n\n[^1]: \n");
    expect(noted.selection).toEqual(caret([1, 0], 0));
});
