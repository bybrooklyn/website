// What each editing operation is held to: it does what it says to the block it is given, and every
// block it did not touch is written back as exactly the bytes it was read from. Run with
// `bun test src/quire`.

import { expect, test } from "bun:test";
import {
    addColumn,
    addRow,
    changeKind,
    code,
    countWords,
    deleteText,
    divider,
    documentOf,
    fields,
    isPageBreak,
    pageBreak,
    paragraph,
    image,
    indent,
    insertBlock,
    insertText,
    joinBlock,
    moveBlock,
    outdent,
    outline,
    removeColumn,
    removeRow,
    setAlign,
    setColumnAlign,
    setField,
    setLink,
    setStyle,
    splitBlock,
    table,
    textAt,
    toggleMark,
    toggleTask,
    type Document,
    type List,
    type Paragraph,
    type Position,
} from "./document";
import { read } from "./read";
import { write } from "./write";

const SAMPLE = [
    "---",
    "title: A test",
    "draft: true",
    "---",
    "",
    "# Title",
    "",
    "A *first* paragraph with __strong__ words.",
    "",
    "* one",
    "* two",
    "  * two and a half",
    "* three",
    "",
    "1) first",
    "1) second",
    "",
    "- [ ] open",
    "- [x] done",
    "",
    "> quoted",
    "> text",
    "",
    "| a | b |",
    "|:--|--:|",
    "| 1 | 2 |",
    "",
    "```js",
    "let x = 1;",
    "```",
    "",
    "Last line, no newline after.",
].join("\n");

const sample = () => read(SAMPLE);
const at = (path: number[], offset: number): Position => ({ path, offset });
const span = (path: number[], from: number, to: number) => ({ start: at(path, from), end: at(path, to) });

/**
 * Writes an edited document and holds that every top-level block still carrying its source is
 * written as those exact bytes, which are bytes of the file it was read from. Returns the written text.
 */
function kept(before: Document, after: Document, untouched: number): string {
    const text = write(after);
    const again = read(text, { mdx: after.mdx });
    const old = write(before);
    let count = 0;
    after.blocks.forEach((block, index) => {
        if (block.source === undefined) return;
        expect(old.includes(block.source)).toBe(true);
        expect(again.blocks[index]?.source).toBe(block.source);
        count++;
    });
    expect(count).toBe(untouched);
    expect(text.startsWith(before.frontmatter ?? "")).toBe(true);
    return text;
}

/** The bytes a block is written as, found by reading the written file again. */
const written = (doc: Document, index: number) => read(write(doc)).blocks[index]?.source;

test("the sample reads into the blocks it is made of", () => {
    expect(write(sample())).toBe(SAMPLE);
    expect(sample().blocks.map((block) => block.kind)).toEqual(["heading", "paragraph", "list", "list", "list", "quote", "table", "code", "paragraph"]);
});

test("typing inserts text with the look of the character before it, and touches nothing else", () => {
    const doc = sample();
    const typed = insertText(doc, at([1], 2), "very ");
    expect(textAt(typed, [1])).toBe("A very first paragraph with strong words.");
    kept(doc, typed, 8);
    expect(written(typed, 1)).toBe("A very *first* paragraph with **strong** words.");
    expect(written(insertText(doc, at([1], 4), "!!"), 1)).toBe("A *fi!!rst* paragraph with **strong** words.");

    const coded = insertText(doc, at([7], 0), "// ");
    kept(doc, coded, 8);
    expect(written(coded, 7)).toBe("```js\n// let x = 1;\n```");

    const cell = insertText(doc, at([6, 1, 0], 1), "0");
    kept(doc, cell, 8);
    expect(textAt(cell, [6, 1, 0])).toBe("10");

    const nested = insertText(doc, at([2, 1, 1, 0, 0], 14), "!");
    kept(doc, nested, 8);
    expect(written(nested, 2)).toBe("* one\n* two\n  * two and a half!\n* three");
    expect(insertText(doc, at([1], 0), "")).toBe(doc);
});

test("deleting removes text in a block, or the blocks between two ends and joins the ends", () => {
    const doc = sample();
    const cut = deleteText(doc, span([1], 0, 2));
    kept(doc, cut, 8);
    expect(written(cut, 1)).toBe("*first* paragraph with **strong** words.");

    const across = deleteText(doc, { start: at([1], 2), end: at([8], 5) });
    expect(across.blocks.map((block) => block.kind)).toEqual(["heading", "paragraph"]);
    expect(kept(doc, across, 1)).toBe("---\ntitle: A test\ndraft: true\n---\n\n# Title\n\nA line, no newline after.");

    const backwards = deleteText(doc, { start: at([8], 5), end: at([1], 2) });
    expect(write(backwards)).toBe(write(across));
});

test("splitting a block makes two, and in a list item makes a new item", () => {
    const doc = sample();
    const split = splitBlock(doc, at([1], 17));
    expect(split.blocks.length).toBe(10);
    expect([textAt(split, [1]), textAt(split, [2])]).toEqual(["A first paragraph", " with strong words."]);
    kept(doc, split, 8);

    const item = splitBlock(doc, at([3, 0, 0], 3));
    kept(doc, item, 8);
    expect(written(item, 3)).toBe("1) fir\n2) st\n1) second");

    // Enter on an empty item leaves the list
    const empty = splitBlock(doc, at([3, 0, 0], 5));
    expect((empty.blocks[3] as List).items.length).toBe(3);
    const left = splitBlock(empty, at([3, 1, 0], 0));
    expect(left.blocks.slice(3, 6).map((block) => block.kind)).toEqual(["list", "paragraph", "list"]);

    expect(written(splitBlock(doc, at([7], 6)), 7)).toBe("```js\nlet x \n= 1;\n```");
});

test("joining a block puts it on the end of the one before", () => {
    const doc = sample();
    const split = splitBlock(doc, at([1], 17));
    const joined = joinBlock(split, [2]);
    expect(textAt(joined, [1])).toBe("A first paragraph with strong words.");
    kept(doc, joined, 8);

    const items = joinBlock(doc, [3, 1, 0]);
    expect((items.blocks[3] as List).items.length).toBe(1);
    expect(written(items, 3)).toBe("1) firstsecond");
    kept(doc, items, 8);

    // a paragraph cannot be joined onto code, so nothing changes
    expect(joinBlock(doc, [8])).toBe(doc);
    expect(joinBlock(doc, [0])).toBe(doc);
});

test("a mark is turned on over a range, and off when the whole range has it", () => {
    const doc = sample();
    const bold = toggleMark(doc, span([1], 0, 1), "bold");
    kept(doc, bold, 8);
    expect(written(bold, 1)).toBe("**A** *first* paragraph with **strong** words.");
    expect(written(toggleMark(bold, span([1], 0, 1), "bold"), 1)).toBe("A *first* paragraph with **strong** words.");
    expect(toggleMark(doc, span([1], 3, 3), "bold")).toBe(doc);

    const plain = toggleMark(doc, span([1], 2, 7), "italic");
    expect(written(plain, 1)).toBe("A first paragraph with **strong** words.");

    const across = toggleMark(doc, { start: at([0], 0), end: at([1], 3) }, "strike");
    kept(doc, across, 7);
    expect([written(across, 0), written(across, 1)]).toEqual(["# ~~Title~~", "~~A *f*~~*irst* paragraph with **strong** words."]);

    for (const mark of ["code", "underline"] as const) expect(read(write(toggleMark(doc, span([1], 2, 7), mark))).blocks[1]).toMatchObject({ kind: "paragraph" });
    expect(written(toggleMark(doc, span([1], 2, 7), "underline"), 1)).toBe("A <u>*first*</u> paragraph with **strong** words.");
});

test("a link is set over a range, and taken off again", () => {
    const doc = sample();
    const linked = setLink(doc, span([1], 2, 7), "https://example.com", "Example");
    kept(doc, linked, 8);
    expect(written(linked, 1)).toBe('A [*first*](https://example.com "Example") paragraph with **strong** words.');
    const unlinked = setLink(linked, span([1], 2, 7), null);
    expect((unlinked.blocks[1] as Paragraph).runs.some((run) => run.kind === "link")).toBe(false);
    expect(written(setLink(doc, span([1], 0, 1), "/a b"), 1)).toBe("[A](</a b>) *first* paragraph with **strong** words.");
});

test("color, size and alignment are set on a range or a block", () => {
    const doc = sample();
    const styled = setStyle(doc, span([1], 2, 7), { color: "rebeccapurple" });
    kept(doc, styled, 8);
    expect(written(styled, 1)).toBe('A <span style="color:rebeccapurple">*first*</span> paragraph with **strong** words.');
    expect(written(setStyle(styled, span([1], 0, 50), { color: null }), 1)).toBe("A *first* paragraph with **strong** words.");
    expect(written(setStyle(doc, span([1], 0, 1), { size: "2em", color: "red" }), 1)).toBe('<span style="color:red; font-size:2em">A</span> *first* paragraph with **strong** words.');
    const centred = setAlign(doc, [0], "center");
    kept(doc, centred, 8);
    expect(written(centred, 0)).toBe('<div align="center">\n\n# Title\n\n</div>');
});

test("a block changes kind to a heading, a list, a quote or code, and back", () => {
    const doc = sample();
    const heading = changeKind(doc, [1], { kind: "heading", level: 2 });
    kept(doc, heading, 8);
    expect(written(heading, 1)).toBe("## A *first* paragraph with **strong** words.");
    expect(textAt(changeKind(heading, [1], { kind: "paragraph" }), [1])).toBe("A first paragraph with strong words.");

    // wrapped in a list or quote, the paragraph keeps its bytes; taken out again, the file is as it was
    const listed = changeKind(doc, [1], { kind: "list", style: "bullet" });
    kept(doc, listed, 8);
    expect(written(listed, 1)).toBe("- A *first* paragraph with __strong__ words.");
    expect(write(changeKind(listed, [1, 0, 0], { kind: "paragraph" }))).toBe(SAMPLE);

    const quoted = changeKind(doc, [1], { kind: "quote" });
    expect(written(quoted, 1)).toBe("> A *first* paragraph with __strong__ words.");
    expect(write(changeKind(quoted, [1, 0], { kind: "paragraph" }))).toBe(SAMPLE);

    const numbered = changeKind(doc, [2, 0, 0], { kind: "list", style: "number" });
    kept(doc, numbered, 8);
    expect(written(numbered, 2)).toBe("1. one\n2. two\n   * two and a half\n3. three");

    const tasks = changeKind(doc, [2, 2, 0], { kind: "list", style: "task" });
    expect(tasks).not.toBe(doc);
    expect(written(changeKind(doc, [4, 0, 0], { kind: "list", style: "bullet" }), 4)).toBe("- open\n- done");

    const code = changeKind(doc, [1], { kind: "code", language: "txt" });
    expect(written(code, 1)).toBe("```txt\nA first paragraph with strong words.\n```");
    expect(written(changeKind(doc, [7], { kind: "paragraph" }), 7)).toBe("let x = 1;");

    // a paragraph turned into a list after a list of that kind joins it
    const short = read("- a\n- b\n\nc\n");
    const joins = changeKind(short, [1], { kind: "list", style: "bullet" });
    expect(joins.blocks.length).toBe(1);
    expect(write(joins)).toBe("- a\n- b\n- c\n");
    expect(written(changeKind(doc, [2], { kind: "list", style: "number" }), 2)).toBe("1. one\n2. two\n   * two and a half\n3. three");
    expect(changeKind(doc, [1], { kind: "paragraph" })).toBe(doc);
});

test("a list item is indented into the item before it and outdented back out", () => {
    const doc = sample();
    const indented = indent(doc, [2, 1]);
    kept(doc, indented, 8);
    expect(written(indented, 2)).toBe("* one\n  * two\n    * two and a half\n* three");
    expect(indent(doc, [2, 0, 0])).toBe(doc);

    const out = outdent(doc, [2, 1, 1, 0]);
    kept(doc, out, 8);
    expect(written(out, 2)).toBe("* one\n* two\n* two and a half\n* three");

    const lifted = outdent(doc, [3, 1]);
    kept(doc, lifted, 9);
    expect(lifted.blocks.slice(3, 5).map((block) => block.kind)).toEqual(["list", "paragraph"]);
    expect(write(lifted)).toContain("1) first\n\nsecond\n\n- [ ] open");
});

test("a task item is ticked and unticked, and an item with no box gains one", () => {
    const doc = sample();
    const ticked = toggleTask(doc, [4, 0]);
    kept(doc, ticked, 8);
    expect(written(ticked, 4)).toBe("- [x] open\n- [x] done");
    expect(written(toggleTask(doc, [4, 1, 0]), 4)).toBe("- [ ] open\n- [ ] done");
    expect(written(toggleTask(doc, [2, 0]), 2)).toBe("* [ ] one\n* two\n  * two and a half\n* three");
});

test("a table, picture, divider or code block is inserted after a block", () => {
    const doc = sample();
    const ruled = insertBlock(doc, [1], divider());
    kept(doc, ruled, 9);
    expect(write(ruled)).toContain("A *first* paragraph with __strong__ words.\n\n---\n\n* one");
    expect(written(insertBlock(doc, [1], table(["x", "y"], [["1", "2"]])), 2)).toBe("| x   | y   |\n| --- | --- |\n| 1   | 2   |");
    expect(written(insertBlock(doc, [1], image("/p.png", "A picture")), 2)).toBe("![A picture](/p.png)");

    // after the last block, the new one ends the file as the old last one did, with no newline
    const last = insertBlock(doc, [8], code("x", "sh"));
    kept(doc, last, 9);
    expect(write(last).endsWith("Last line, no newline after.\n\n```sh\nx\n```")).toBe(true);

    const inItem = insertBlock(doc, [2, 0, 0], code("y"));
    kept(doc, inItem, 8);
    expect(written(inItem, 2)).toBe("* one\n  ```\n  y\n  ```\n* two\n  * two and a half\n* three");
});

test("table rows and columns are added and removed, and cells and alignment are set", () => {
    const doc = sample();
    let edited = addRow(doc, [6], 1);
    edited = insertText(edited, at([6, 2, 0], 0), "3");
    edited = addColumn(edited, [6], 1);
    edited = insertText(edited, at([6, 0, 1], 0), "middle");
    edited = setColumnAlign(edited, [6], 1, "center");
    kept(doc, edited, 8);
    expect(written(edited, 6)).toBe("| a   | middle | b   |\n| :-- | :----: | --: |\n| 1   |        | 2   |\n| 3   |        |     |");
    edited = removeColumn(edited, [6], 0);
    edited = removeRow(edited, [6], 0);
    expect(written(edited, 6)).toBe("| middle | b   |\n| :----: | --: |\n|        |     |");
    expect(removeColumn(removeColumn(edited, [6], 0), [6], 0).blocks[6]).toMatchObject({ header: [[{ text: "b" }]] });
    expect(removeRow(doc, [6], 5)).toBe(doc);
});

test("a block moves up or down and keeps its bytes, and so does a list item", () => {
    const doc = sample();
    const moved = moveBlock(doc, [1], 1);
    expect(moved.blocks.map((block) => block.kind).slice(0, 3)).toEqual(["heading", "list", "paragraph"]);
    expect(kept(doc, moved, 9)).toContain("# Title\n\n* one\n* two\n  * two and a half\n* three\n\nA *first* paragraph with __strong__ words.\n\n1) first");
    expect(moveBlock(doc, [8], 1)).toBe(doc);
    expect(moveBlock(doc, [0], -1)).toBe(doc);

    const item = moveBlock(doc, [2, 2], -1);
    kept(doc, item, 8);
    expect(written(item, 2)).toBe("* one\n* three\n* two\n  * two and a half");
});

test("the outline lists every heading with its level, and words are counted outside code", () => {
    const doc = insertBlock(sample(), [5, 0], { kind: "heading", level: 3, runs: [{ kind: "text", text: "Inside a quote", marks: [] }], gap: "" });
    expect(outline(doc)).toEqual([
        { level: 1, text: "Title", path: [0] },
        { level: 3, text: "Inside a quote", path: [5, 1] },
    ]);
    expect(countWords(sample())).toBe(29);
});

test("frontmatter values are read and set, and every other byte of the file stays", () => {
    const doc = sample();
    const field = (from: Document, key: string) => fields(from).find(([name]) => name === key)?.[1];
    expect(field(doc, "title")).toBe("A test");
    expect(field(doc, "missing")).toBeUndefined();
    const renamed = setField(doc, "title", "New: a title");
    expect(write(renamed)).toBe(SAMPLE.replace("title: A test", 'title: "New: a title"'));
    expect(field(renamed, "title")).toBe("New: a title");
    const added = setField(doc, "tags", "plain");
    expect(write(added)).toBe(SAMPLE.replace("draft: true\n---", "draft: true\ntags: plain\n---"));
    expect(write(setField(read("Body\r\n"), "title", "Hi"))).toBe("---\r\ntitle: Hi\r\n---\r\nBody\r\n");
});

test("an edit in a CRLF file writes its fresh block with CRLF and leaves every other byte alone", () => {
    const source = SAMPLE.replace(/\n/g, "\r\n");
    const doc = read(source);
    expect(write(doc)).toBe(source);
    const typed = insertText(doc, at([2, 1, 1, 0, 0], 0), "nearly ");
    const text = kept(doc, typed, 8);
    expect(text.replace(/\r\n/g, "")).not.toContain("\n");
    expect(text).toBe(source.replace("  * two and a half", "  * nearly two and a half"));
});

test("an edit to one paragraph of a real post leaves every other block of it byte for byte", async () => {
    const source = await Bun.file(`${import.meta.dir}/../content/blog/kitchen-sink.mdx`).text();
    const doc = read(source, { mdx: true });
    const index = doc.blocks.findIndex((block) => block.kind === "paragraph");
    const edited = insertText(doc, at([index], 0), "Edited. ");
    const text = kept(doc, edited, doc.blocks.length - 1);
    expect(text.length).toBe(source.length + "Edited. ".length);
});

test("a frontmatter value can be written exactly as given, for a list, a date or true", () => {
    const doc = read("---\ndraft: false\ntags: [a]\n---\nBody\n");
    expect(write(setField(doc, "draft", "true", true))).toBe("---\ndraft: true\ntags: [a]\n---\nBody\n");
    expect(write(setField(doc, "draft", "true"))).toBe('---\ndraft: "true"\ntags: [a]\n---\nBody\n');
    expect(write(setField(doc, "tags", "[a, b]", true))).toBe("---\ndraft: false\ntags: [a, b]\n---\nBody\n");
});

test("a page break is the HTML that makes one, known however it is spaced or quoted", () => {
    expect(write(documentOf([paragraph("One"), pageBreak(), paragraph("Two")]))).toBe('One\n\n<div style="break-after: page"></div>\n\nTwo\n');
    for (const html of ['<div style="break-after: page"></div>', "<div style='break-after:page;'></div>", '<div style="page-break-after: always"></div>']) expect(isPageBreak({ kind: "raw", text: html, gap: "" })).toBe(true);
    expect(isPageBreak({ kind: "raw", text: "<div>break-after: page</div>", gap: "" })).toBe(false);
    expect(read('<div style="break-after: page"></div>\n').blocks.map(isPageBreak)).toEqual([true]);
});

test("a frontmatter value with a line break in it is quoted, and read back with the break", () => {
    const doc = setField(read("Body\n"), "title", "a\nb");
    expect(write(doc)).toBe('---\ntitle: "a\\nb"\n---\nBody\n');
    expect(fields(read(write(doc)))).toEqual([["title", "a\nb"]]);
    expect(fields(read('---\na: "tab\\there \\"q\\""\nb: \'it\'\'s\'\n---\n'))).toEqual([
        ["a", 'tab\there "q"'],
        ["b", "it's"],
    ]);
});
