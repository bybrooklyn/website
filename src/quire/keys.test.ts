// What each key and piece of typing is held to: the Markdown the document then writes, and where
// the cursor then is, the way a person typing would expect. Every Markdown shortcut is checked
// with the one undo that gives back the characters typed. Run with `bun test src/quire`.

import { expect, test } from "bun:test";
import { blockAt, blockPaths, documentOf, paragraph, removeBlock, runsText, type Block, type Run, type Selection } from "./document";
import { createHistory } from "./history";
import { activeBlock, activeMarks, caret, characterReach, fragment, paste, step, type Editor, type Input } from "./keys";
import { read } from "./read";
import { write } from "./write";

/** An editor on some Markdown, the cursor at a place, with a clock that moves on 10 ms a key. */
function editor(source: string, path: number[] = [0], offset = 0) {
    let current: Editor = { state: { doc: source === "" ? documentOf([paragraph()]) : read(source), selection: caret(path, offset) }, history: createHistory() };
    let time = 0;
    const send = (input: Input) => {
        const result = step(current, input, time);
        current = result.editor;
        time += 10;
        return result.outcome;
    };
    return {
        type(text: string) {
            for (const value of text) send({ type: "text", text: value });
        },
        key(key: string, modifiers: { shift?: boolean; mod?: boolean; alt?: boolean } = {}) {
            return send({ type: "key", key, ...modifiers });
        },
        select(selection: Selection) {
            current = { ...current, state: { doc: current.state.doc, selection } };
        },
        wait() {
            time += 5000;
        },
        get markdown() {
            return write(current.state.doc);
        },
        get cursor() {
            return current.state.selection.focus;
        },
        get state() {
            return current.state;
        },
        undo: () => send({ type: "key", key: "z", mod: true }),
        redo: () => send({ type: "key", key: "z", mod: true, shift: true }),
    };
}

test("typing a sentence into an empty document writes it, the cursor after the last letter", () => {
    const e = editor("");
    e.type("Hello, world.");
    expect(e.markdown).toBe("Hello, world.\n");
    expect(e.cursor).toEqual({ path: [0], offset: 13 });
});

test("typing replaces what is selected", () => {
    const e = editor("Hello world\n");
    e.select({ anchor: { path: [0], offset: 6 }, focus: { path: [0], offset: 11 } });
    e.type("there");
    expect(e.markdown).toBe("Hello there\n");
});

test("typing is one undo step until a pause, and undo and redo walk back and forth", () => {
    const e = editor("");
    e.type("one two");
    e.wait();
    e.type(" three");
    e.undo();
    expect(e.markdown).toBe("one two\n");
    e.undo();
    expect(e.state.doc.blocks[0]).toMatchObject({ kind: "paragraph", runs: [] });
    e.redo();
    e.redo();
    expect(e.markdown).toBe("one two three\n");
});

test("Enter splits a paragraph and puts the cursor at the start of the new one", () => {
    const e = editor("Hello world\n", [0], 5);
    e.key("Enter");
    expect(e.markdown).toBe("Hello\n\nworld\n");
    expect(e.cursor).toEqual({ path: [1], offset: 0 });
});

test("Backspace at the start of a paragraph joins it to the one before, the cursor at the join", () => {
    const e = editor("Hello\n\nworld\n", [1], 0);
    e.key("Backspace");
    expect(e.markdown).toBe("Helloworld\n");
    expect(e.cursor).toEqual({ path: [0], offset: 5 });
});

test("Backspace deletes one character, a whole emoji, or a word with a modifier", () => {
    const e = editor("Hi \u{1F600}!\n", [0], 5);
    e.key("Backspace");
    expect(e.markdown).toBe("Hi !\n");
    const w = editor("Two words here\n", [0], 14);
    w.key("Backspace", { alt: true });
    expect(w.markdown).toBe("Two words\n");
    expect(w.cursor).toEqual({ path: [0], offset: 10 });
});

test("Backspace at the start of a heading or list item first makes it a paragraph", () => {
    const h = editor("# Title\n", [0], 0);
    h.key("Backspace");
    expect(h.markdown).toBe("Title\n");
    // the first item has no item above to join: it becomes a paragraph
    const l = editor("- one\n- two\n", [0, 0, 0], 0);
    l.key("Backspace");
    expect(l.markdown).toBe("one\n\n- two\n");
    expect(l.cursor).toEqual({ path: [0], offset: 0 });
    const q = editor("> quoted\n", [0, 0], 0);
    q.key("Backspace");
    expect(q.markdown).toBe("quoted\n");
});

test("Backspace with a selection across blocks removes it and joins the ends", () => {
    const e = editor("First line\n\nSecond line\n\nThird line\n");
    e.select({ anchor: { path: [0], offset: 5 }, focus: { path: [2], offset: 5 } });
    e.key("Backspace");
    expect(e.markdown).toBe("First line\n");
    expect(e.cursor).toEqual({ path: [0], offset: 5 });
});

test("Backspace after a divider removes it; on an empty paragraph it removes the paragraph", () => {
    const e = editor("Above\n\n---\n\nBelow\n", [2], 0);
    e.key("Backspace");
    expect(e.markdown).toBe("Above\n\nBelow\n");
    expect(e.cursor).toEqual({ path: [1], offset: 0 });
    const empty = editor("Above\n", [0], 5);
    empty.key("Enter");
    empty.key("Backspace");
    expect(empty.markdown).toBe("Above\n");
    expect(empty.cursor).toEqual({ path: [0], offset: 5 });
});

test("Delete removes the next character, and at the end of a block joins the next one", () => {
    const e = editor("Hello\n\nworld\n", [0], 4);
    e.key("Delete");
    expect(e.markdown).toBe("Hell\n\nworld\n");
    e.key("Delete");
    expect(e.markdown).toBe("Hellworld\n");
    expect(e.cursor).toEqual({ path: [0], offset: 4 });
});

test("Enter in a list makes a new item, and on an empty item leaves the list", () => {
    const e = editor("- one\n", [0, 0, 0], 3);
    e.key("Enter");
    e.type("two");
    expect(e.markdown).toBe("- one\n- two\n");
    expect(e.cursor).toEqual({ path: [0, 1, 0], offset: 3 });
    e.key("Enter");
    e.key("Enter");
    e.type("after");
    expect(e.markdown).toBe("- one\n- two\n\nafter\n");
    expect(e.cursor).toEqual({ path: [1], offset: 5 });
});

test("Enter in code is a newline, and on an empty last line leaves the code", () => {
    const e = editor("```js\nlet a\n```\n", [0], 5);
    e.key("Enter");
    e.type("b");
    expect(e.markdown).toBe("```js\nlet a\nb\n```\n");
    e.key("Enter");
    e.key("Enter");
    e.type("text");
    expect(e.markdown).toBe("```js\nlet a\nb\n```\n\ntext\n");
});

test("Enter at the end of a heading starts a paragraph, at its start puts a paragraph above", () => {
    const e = editor("# Title\n", [0], 5);
    e.key("Enter");
    e.type("Body");
    expect(e.markdown).toBe("# Title\n\nBody\n");
    const s = editor("# Title\n", [0], 0);
    s.key("Enter");
    expect(s.markdown).toBe("# Title\n");
    expect(read(s.markdown).blocks.length).toBe(1);
    expect(s.state.doc.blocks.map((block) => block.kind)).toEqual(["paragraph", "heading"]);
    expect(s.cursor).toEqual({ path: [1], offset: 0 });
});

test("Shift+Enter puts a hard line break in a paragraph", () => {
    const e = editor("one\n", [0], 3);
    e.key("Enter", { shift: true });
    e.type("two");
    expect(e.markdown).toBe("one\\\ntwo\n");
    expect(e.cursor).toEqual({ path: [0], offset: 7 });
});

test("Tab and Shift+Tab indent and outdent a list item, the cursor staying in it", () => {
    const e = editor("- one\n- two\n", [0, 1, 0], 2);
    e.key("Tab");
    expect(e.markdown).toBe("- one\n  - two\n");
    expect(e.cursor).toEqual({ path: [0, 0, 1, 0, 0], offset: 2 });
    e.key("Tab", { shift: true });
    expect(e.markdown).toBe("- one\n- two\n");
    expect(e.cursor).toEqual({ path: [0, 1, 0], offset: 2 });
});

test("Tab moves to the next table cell, adding a row after the last, and Shift+Tab goes back", () => {
    const e = editor("| a | b |\n| - | - |\n| 1 | 2 |\n", [0, 1, 1], 1);
    e.key("Tab");
    expect(e.cursor).toEqual({ path: [0, 2, 0], offset: 0 });
    e.type("3");
    expect(e.markdown).toBe("| a   | b   |\n| --- | --- |\n| 1   | 2   |\n| 3   |     |\n");
    e.key("Tab", { shift: true });
    expect(e.cursor).toEqual({ path: [0, 1, 1], offset: 1 });
    expect(editor("Plain\n").key("Tab")).toBeNull();
});

test("Enter in a table's last row adds a row, and Enter on that empty row leaves the table for a line under it, even at the document's end", () => {
    const e = editor("| a | b |\n| - | - |\n| 1 | 2 |\n", [0, 1, 0], 1);
    e.key("Enter");
    expect(e.cursor).toEqual({ path: [0, 2, 0], offset: 0 });
    e.key("Enter");
    expect(e.cursor).toEqual({ path: [1], offset: 0 });
    e.type("After");
    expect(e.markdown).toBe("| a   | b   |\n| --- | --- |\n| 1   | 2   |\n\nAfter\n");
    // a row with words in it is never taken away
    const kept = editor("| a | b |\n| - | - |\n| 1 | 2 |\n|  | 3 |\n", [0, 2, 0], 0);
    kept.key("Enter");
    expect(kept.cursor).toEqual({ path: [0, 3, 0], offset: 0 });
    // and a table keeps at least one row of its body
    const one = editor("| a | b |\n| - | - |\n|  |  |\n", [0, 1, 0], 0);
    one.key("Enter");
    expect(one.cursor).toEqual({ path: [0, 2, 0], offset: 0 });
});

test("the mark shortcuts bold, italicise, underline, strike and code a selection, and toggle back", () => {
    const shortcuts: [string, { shift?: boolean }, string][] = [
        ["b", {}, "a **word** here\n"],
        ["i", {}, "a *word* here\n"],
        ["u", {}, "a <u>word</u> here\n"],
        ["x", { shift: true }, "a ~~word~~ here\n"],
        ["e", {}, "a `word` here\n"],
    ];
    for (const [key, modifiers, expected] of shortcuts) {
        const e = editor("a word here\n");
        e.select({ anchor: { path: [0], offset: 2 }, focus: { path: [0], offset: 6 } });
        e.key(key, { mod: true, ...modifiers });
        expect(e.markdown).toBe(expected);
        e.key(key, { mod: true, ...modifiers });
        expect(e.markdown).toBe("a word here\n");
    }
});

test("a mark shortcut with nothing selected applies to what is typed next", () => {
    const e = editor("Plain\n", [0], 5);
    e.type(" ");
    e.key("b", { mod: true });
    expect(activeMarks(e.state)).toEqual(["bold"]);
    e.type("bold");
    e.key("b", { mod: true });
    e.type(" plain");
    expect(e.markdown).toBe("Plain **bold** plain\n");
});

test("undo, redo, link and heading levels have their shortcuts", () => {
    const e = editor("Text\n");
    expect(e.key("k", { mod: true })).toEqual({ action: "link" });
    e.key("2", { mod: true, alt: true });
    expect(e.markdown).toBe("## Text\n");
    e.key("0", { mod: true, alt: true });
    expect(e.markdown).toBe("Text\n");
    e.undo();
    expect(e.markdown).toBe("## Text\n");
    e.key("y", { mod: true });
    expect(e.markdown).toBe("Text\n");
    expect(activeBlock(read("# T\n"), [0])).toEqual({ kind: "heading", level: 1, quoted: false });
    expect(activeBlock(read("> - a\n"), [0, 0, 0, 0])).toEqual({ kind: "paragraph", list: "bullet", quoted: true });
});

test("each block shortcut turns into its block, and one undo gives back the characters typed", () => {
    const cases: [string, string, string][] = [
        ["# ", "Title", "# Title\n"],
        ["### ", "Small", "### Small\n"],
        ["###### ", "Tiny", "###### Tiny\n"],
        ["- ", "item", "- item\n"],
        ["* ", "item", "- item\n"],
        ["1. ", "first", "1. first\n"],
        ["[ ] ", "task", "- [ ] task\n"],
        ["[x] ", "done", "- [x] done\n"],
        ["> ", "quote", "> quote\n"],
        ["``` ", "code", "```\ncode\n```\n"],
        ["```rust ", "let a;", "```rust\nlet a;\n```\n"],
    ];
    for (const [typed, then, expected] of cases) {
        const e = editor("");
        e.type(typed);
        e.type(then);
        expect(e.markdown).toBe(expected);
        e.undo();
        expect(write(e.state.doc)).toBe(read(expected).blocks.length ? write(e.state.doc) : "");
        e.undo();
        const literal = e.markdown;
        expect(e.state.doc.blocks[0]!.kind).toBe("paragraph");
        expect(literal.trimEnd().replace(/\\/g, "")).toBe(typed.trimEnd());
    }
});

test("three backticks alone stay as typed until a space or Enter, and Enter makes the block in its language too", () => {
    const waiting = editor("");
    waiting.type("```js");
    expect(waiting.state.doc.blocks[0]!.kind).toBe("paragraph");
    waiting.key("Enter");
    waiting.type("let a;");
    expect(waiting.markdown).toBe("```js\nlet a;\n```\n");
    const plain = editor("");
    plain.type("```");
    plain.key("Enter");
    plain.type("x");
    expect(plain.markdown).toBe("```\nx\n```\n");
    // not when there are other words on the line
    const words = editor("");
    words.type("see ``` ");
    expect(words.state.doc.blocks[0]!.kind).toBe("paragraph");
});

test("--- typed on its own line becomes a divider with a paragraph after it", () => {
    const e = editor("");
    e.type("---");
    e.type("next");
    expect(e.markdown).toBe("---\n\nnext\n");
    expect(e.state.doc.blocks.map((block) => block.kind)).toEqual(["divider", "paragraph"]);
    expect(e.cursor).toEqual({ path: [1], offset: 4 });
});

test("each inline shortcut turns into its mark when the closing mark is typed, and one undo gives back the characters", () => {
    const cases: [string, string][] = [
        ["**bold**", "**bold**"],
        ["*italic*", "*italic*"],
        ["`code`", "`code`"],
        ["~~gone~~", "~~gone~~"],
    ];
    for (const [typed, written] of cases) {
        const e = editor("");
        e.type(`a ${typed}`);
        e.type(" b");
        expect(e.markdown).toBe(`a ${written} b\n`);
        expect(activeMarks(e.state)).toEqual([]);
        e.undo();
        e.undo();
        const back = e.state.doc.blocks[0]!;
        expect(back.kind === "paragraph" && back.runs).toEqual([{ kind: "text", text: `a ${typed}`, marks: [] }]);
    }
    const unclosed = editor("");
    unclosed.type("2 * 3 * 4");
    expect(unclosed.state.doc.blocks[0]).toMatchObject({ runs: [{ text: "2 * 3 * 4", marks: [] }] });
});

test("a block shortcut is only taken at the start of a paragraph", () => {
    const e = editor("");
    e.type("a # b - c");
    expect(e.state.doc.blocks.map((block) => block.kind)).toEqual(["paragraph"]);
});

test("a slash typed on an empty line is reported, and one typed in text is not", () => {
    const e = editor("");
    const first = step({ state: e.state, history: createHistory() }, { type: "text", text: "/" }, 0).outcome;
    expect(first && "state" in first && first.slash).toBe(true);
    const later = step({ state: { doc: read("text\n"), selection: caret([0], 4) }, history: createHistory() }, { type: "text", text: "/" }, 0).outcome;
    expect(later && "state" in later && later.slash).toBe(false);
});

test("pasting one paragraph goes into the line; pasting several splits the block around them", () => {
    const inline = paste({ doc: read("Hello world\n"), selection: caret([0], 6) }, [{ kind: "paragraph", runs: [{ kind: "text", text: "big", marks: ["italic"] }, { kind: "text", text: " ", marks: [] }], gap: "" }]);
    expect(write(inline.doc)).toBe("Hello *big* world\n");
    expect(inline.selection.focus).toEqual({ path: [0], offset: 10 });

    const several = paste({ doc: read("Start end\n"), selection: caret([0], 6) }, read("one\n\n- two\n- three\n\nfour\n").blocks);
    expect(write(several.doc)).toBe("Start one\n\n- two\n- three\n\nfourend\n");
    expect(several.selection.focus).toEqual({ path: [2], offset: 4 });

    const intoEmpty = paste({ doc: documentOf([paragraph()]), selection: caret([0], 0) }, read("# A\n\nb\n").blocks as Block[]);
    expect(write(intoEmpty.doc)).toBe("# A\n\nb\n");
    expect(intoEmpty.selection.focus).toEqual({ path: [1], offset: 1 });
});

test("the selected part of a document is copied as blocks, list items staying in their list", () => {
    const doc = read("Para one\n\n- a\n- b\n\nLast\n");
    const blocks = fragment(doc, { anchor: { path: [0], offset: 5 }, focus: { path: [2], offset: 2 } });
    expect(write(documentOf(blocks))).toBe("one\n\n- a\n- b\n\nLa\n");
    expect(write(documentOf(fragment(doc, { anchor: { path: [0], offset: 0 }, focus: { path: [0], offset: 4 } })))).toBe("Para\n");
});

test("Ctrl+Enter puts a page break at the cursor, splitting the line there, as one undo step", () => {
    const typed = editor("One two.\n", [0], 3);
    typed.key("Enter", { mod: true });
    expect(typed.markdown).toBe('One\n\n<div style="break-after: page"></div>\n\ntwo.\n');
    expect(typed.cursor).toEqual({ path: [2], offset: 0 });
    typed.undo();
    expect(typed.markdown).toBe("One two.\n");
});

test("a page break at the start of a line goes before it, and after a list it goes after the list with a line to write on", () => {
    const start = editor("First.\n\nSecond.\n", [1], 0);
    start.key("Enter", { mod: true });
    expect(start.markdown).toBe('First.\n\n<div style="break-after: page"></div>\n\nSecond.\n');
    expect(start.cursor).toEqual({ path: [2], offset: 0 });
    const listed = editor("- one\n- two\n", [0, 1, 0], 3);
    listed.key("Enter", { mod: true });
    expect(listed.markdown.startsWith('- one\n- two\n\n<div style="break-after: page"></div>\n')).toBe(true);
    expect(listed.cursor).toEqual({ path: [2], offset: 0 });
});

test("Backspace after a page break takes the break away, as it does a divider", () => {
    const typed = editor('One\n\n<div style="break-after: page"></div>\n\nTwo\n', [2], 0);
    typed.key("Backspace");
    expect(typed.markdown).toBe("One\n\nTwo\n");
});

// ---- lists as Google Docs has them ----

test("a list mark typed after a soft line break makes that line alone the item, and the line above stays a paragraph", () => {
    // the owner's report: "it made the previous line one too". The line above was the same paragraph, joined by Shift+Enter.
    for (const [typed, expected] of [
        ["* ", "It is written in typescript\n\n- item\n"],
        ["1. ", "It is written in typescript\n\n1. item\n"],
        ["[ ] ", "It is written in typescript\n\n- [ ] item\n"],
        ["## ", "It is written in typescript\n\n## item\n"],
        ["> ", "It is written in typescript\n\n> item\n"],
    ] as const) {
        const e = editor("It is written in typescript\n", [0], 27);
        e.key("Enter", { shift: true });
        e.type(typed);
        e.type("item");
        expect(e.markdown).toBe(expected);
        // one undo gives back the line as typed, break and all
        e.undo();
        e.undo();
        expect(e.state.doc.blocks.length).toBe(1);
        expect(runsText((e.state.doc.blocks[0] as { runs: Run[] }).runs)).toBe(`It is written in typescript\n${typed}`);
    }
});

test("every list mark Docs takes converts only the paragraph it is typed in, the one before untouched", () => {
    const cases: [string, string][] = [
        ["* ", "- x"],
        ["- ", "- x"],
        ["+ ", "- x"],
        ["1. ", "1. x"],
        ["1) ", "1. x"],
        ["3. ", "3. x"],
        ["a. ", "1. x"],
        ["[] ", "- [ ] x"],
        ["[ ] ", "- [ ] x"],
        ["[x] ", "- [x] x"],
    ];
    for (const [typed, item] of cases) {
        const e = editor("Before\n", [0], 6);
        e.key("Enter");
        e.type(typed);
        e.type("x");
        expect({ typed, md: e.markdown }).toEqual({ typed, md: `Before\n\n${item}\n` });
        e.undo();
        e.undo();
        expect({ typed, kind: e.state.doc.blocks.map((block) => block.kind) }).toEqual({ typed, kind: ["paragraph", "paragraph"] });
    }
});

test("a mark typed at the start of a line that has text makes that line an item with its text", () => {
    const e = editor("first\n\nsecond\n", [1], 0);
    e.type("* ");
    expect(e.markdown).toBe("first\n\n- second\n");
});

test("Enter on an empty nested item takes it out one level, and at the top level out of the list", () => {
    const e = editor("- one\n  - two\n", [0, 0, 1, 0, 0], 3);
    e.key("Enter");
    e.key("Enter");
    expect(e.markdown).toBe("- one\n  - two\n-\n");
    e.key("Enter");
    e.type("after");
    expect(e.markdown).toBe("- one\n  - two\n\nafter\n");
});

test("Backspace at the start of a later item takes its bullet away and keeps its text as a line of the item above; again joins the lines", () => {
    const e = editor("- one\n- two\n", [0, 1, 0], 0);
    e.key("Backspace");
    expect(e.markdown).toBe("- one\\\n  two\n");
    expect(e.cursor).toEqual({ path: [0, 0, 0], offset: 4 });
    e.key("Backspace");
    expect(e.markdown).toBe("- onetwo\n");
    expect(e.cursor).toEqual({ path: [0, 0, 0], offset: 3 });
});

test("Tab nests an item with its own children, and Shift+Tab brings it back with them", () => {
    const e = editor("- one\n- two\n  - child\n", [0, 1, 0], 0);
    e.key("Tab");
    expect(e.markdown).toBe("- one\n  - two\n    - child\n");
    e.key("Tab", { shift: true });
    expect(e.markdown).toBe("- one\n- two\n  - child\n");
});

test("Delete at the end of an item before an empty one joins them and never writes a missing value into the file", () => {
    const e = editor("- a\n-\n- b\n", [0, 0, 0], 1);
    e.key("Delete");
    expect(e.markdown).toBe("- a\n- b\n");
    for (const source of ["- a\n-\n- b\n", "> a\n>\n", "- a\n- [ ]\n- b\n"]) {
        const each = editor(source, [0, 0, 0], 1);
        each.key("Delete");
        each.key("Delete");
        expect(each.markdown).not.toMatch(/undefined|NaN|null|\[object Object\]/);
    }
});

test("lists edited into new shapes are written so that they read back as the same lists, whatever stood there before", () => {
    // what a list reads back as: its nesting, and each item's text
    const shape = (markdown: string): unknown => {
        const of = (blocks: Block[]): unknown => blocks.map((block) => (block.kind === "list" ? { list: block.style, start: block.start, items: block.items.map((item) => of(item.blocks)) } : block.kind === "paragraph" ? runsText(block.runs) : block.kind));
        return of(read(markdown).blocks);
    };
    // Enter then Tab at the end of an item starts an empty item under it, not a heading
    const bullet = editor("- a\n", [0, 0, 0], 1);
    bullet.key("Enter");
    bullet.key("Tab");
    expect(shape(bullet.markdown)).toEqual([{ list: "bullet", start: 1, items: [["a", { list: "bullet", start: 1, items: [[""]] }]] }]);
    const number = editor("1. a\n", [0, 0, 0], 1);
    number.key("Enter");
    number.key("Tab");
    expect(shape(number.markdown)).toEqual([{ list: "number", start: 1, items: [["a", { list: "number", start: 1, items: [[""]] }]] }]);
    // Backspace at the start of a nested list's first item leaves two lines of text that stay two
    const nested = editor("- two\n  - nested\n  - nested two\n- three\n", [0, 0, 1, 0, 0], 0);
    nested.key("Backspace");
    expect(shape(nested.markdown)).toEqual([{ list: "bullet", start: 1, items: [["two", "nested", { list: "bullet", start: 1, items: [["nested two"]] }], ["three"]] }]);
});

test("a heading is one line: Shift+Enter in it does nothing, and a paragraph with a break made a heading has a space there", () => {
    const e = editor("# Title\n", [0], 0);
    e.key("Enter", { shift: true });
    expect(e.markdown).toBe("# Title\n");
    const two = editor("one\\\ntwo\n", [0], 0);
    two.key("2", { mod: true, alt: true });
    expect(two.markdown).toBe("## one two\n");
});

test("the cursor lands in a cell, never on a table: after pasting a table, and after Backspace below one", () => {
    // a pasted table leaves the cursor at the end of its last cell, where typing goes into the cell
    const pasted = paste({ doc: read("x\n"), selection: caret([0], 1) }, read("| a | b |\n|---|---|\n| 1 | 2 |\n").blocks);
    expect(pasted.selection.focus).toEqual({ path: [1, 1, 1], offset: 1 });
    const empty = paste({ doc: documentOf([paragraph()]), selection: caret([0], 0) }, read("| a |\n|---|\n| 1 |\n").blocks);
    expect(empty.selection.focus).toEqual({ path: [0, 1, 0], offset: 1 });
    // Backspace on an empty line under a table takes the line away and goes to the end of the table's last cell
    const below = editor("| a |\n|---|\n| 1 |\n\nx\n", [1], 1);
    below.key("Backspace");
    below.key("Backspace");
    expect(below.cursor).toEqual({ path: [0, 1, 0], offset: 1 });
});

test("Normal text on an item's line takes it out of the list, and the selection goes with the text", () => {
    const normal = editor("- a\n- b\n", [0, 1, 0], 0);
    normal.key("0", { mod: true, alt: true });
    expect(normal.markdown).toBe("- a\n\nb\n");
    expect(normal.cursor).toEqual({ path: [1], offset: 0 });
});

test("a definition list keeps a line of text for each term and definition: no other kind is made in it, and an item edited past that is written as its blocks", () => {
    for (const key of ["1", "2"]) {
        const e = editor("Term\n: def\n", [0, 0, 1], 0);
        e.key(key, { mod: true, alt: true });
        expect(e.markdown).toBe("Term\n: def\n");
    }
    const tab = editor("Term\n: def\n\nTwo\n: more\n", [0, 1, 0], 0);
    tab.key("Tab");
    tab.key("Enter", { shift: true });
    expect(tab.markdown).toBe("Term\n: def\n\nTwo\n: more\n");
    // Delete at the end of a term joins its only definition into it: the item is a paragraph now
    const joined = editor("Term\n: def\n\nTwo\n: more\n", [0, 0, 0], 4);
    joined.key("Delete");
    expect(joined.markdown).toBe("Termdef\n\nTwo\n: more\n");
    // blocks pasted into a definition go in as their words
    const pasted = paste({ doc: read("Term\n: def\n"), selection: caret([0, 0, 1], 3) }, read("- a\n- b\n\n# c\n").blocks);
    expect(write(pasted.doc)).toBe("Term\n: defa b c\n");
});

test("Shift+Enter at the end of a paragraph, saved before anything is typed after it, leaves no stray backslash in the file", () => {
    for (const [source, path, offset] of [["text\n", [0], 4], ["- item\n", [0, 0, 0], 4], ["> quote\n", [0, 0], 5]] as const) {
        const e = editor(source, [...path], offset);
        e.key("Enter", { shift: true });
        expect(e.markdown).toBe(source);
        e.type("more");
        expect(e.markdown).not.toBe(source);
    }
});

test("a line break typed beside a line the file already broke stays one paragraph", () => {
    const e = editor("Plain\nlines\n", [0], 5);
    e.key("Enter", { shift: true });
    expect(read(e.markdown).blocks.length).toBe(1);
    const start = editor("Plain\nlines\n", [0], 5);
    start.key("Backspace", { mod: true });
    start.key("Enter", { shift: true });
    expect(read(start.markdown).blocks.length).toBe(1);
});

test("Shift+Tab with a selection that starts in a table's cell keeps that end in the cell", () => {
    const e = editor("| a |\n|---|\n| 12 |\n\n- one\n  - two\n", [1, 0, 1, 0, 0], 0);
    e.select({ anchor: { path: [0, 1, 0], offset: 1 }, focus: { path: [1, 0, 1, 0, 0], offset: 2 } });
    e.key("Tab", { shift: true });
    expect(e.markdown).toBe("| a |\n|---|\n| 12 |\n\n- one\n- two\n");
    expect(e.state.selection).toEqual({ anchor: { path: [0, 1, 0], offset: 1 }, focus: { path: [1, 1, 0], offset: 2 } });
});

test("taking away the only block leaves an empty line to write on", () => {
    const doc = removeBlock(read("only\n"), [0]);
    expect(doc.blocks.length).toBe(1);
    expect(blockPaths(doc)).toEqual([[0]]);
});

test("Backspace and Delete take a whole character as a reader sees one, never half an emoji, and Backspace takes a combining mark first", () => {
    const cases: [string, number, boolean, number][] = [
        ["x👨‍👩‍👧", 9, true, 8],
        ["x🇫🇷", 5, true, 4],
        ["🇫🇷🇩🇪", 8, true, 4],
        ["a❤️", 3, true, 2],
        ["👍🏽", 4, true, 4],
        ["1️⃣", 3, true, 3],
        ["🏴󠁧󠁢󠁥󠁮󠁧󠁿", 14, true, 14],
        ["éx", 0, false, 2],
        ["é̂", 3, true, 1],
        ["x́", 2, true, 1],
        ["ab", 2, true, 1],
        ["ab", 0, false, 1],
        ["👨‍👩‍👧x", 0, false, 8],
    ];
    for (const cutter of [new Intl.Segmenter(undefined, { granularity: "grapheme" }), null]) {
        for (const [text, offset, back, width] of cases) expect({ text, offset, back, hand: cutter === null, width: characterReach(text, offset, back, cutter) }).toEqual({ text, offset, back, hand: cutter === null, width });
    }
    const e = editor("x👨‍👩‍👧 🇫🇷\n", [0], 14);
    e.key("Backspace");
    expect(e.markdown).toBe("x👨‍👩‍👧\n");
    e.key("Backspace");
    e.key("Backspace");
    expect(e.markdown).toBe("x\n");
    const forward = editor("éx\n", [0], 0);
    forward.key("Delete");
    expect(forward.markdown).toBe("x\n");
});

test("the selection lands on real text after pasting onto an empty heading in a list, and after Delete on an empty line before a table", () => {
    const heading = editor("- a\n- #\n", [0, 1, 0], 0);
    expect(heading.state.doc.blocks[0]?.kind).toBe("list");
    const pasted = paste(heading.state, read("- x\n\ntail text\n").blocks);
    const cursor = pasted.selection.focus;
    expect(runsText((blockAt(pasted.doc, cursor.path) as { runs: Run[] }).runs).length).toBeGreaterThanOrEqual(cursor.offset);
    expect(write(pasted.doc)).toBe("- a\n- - x\n\n  tail text\n");
    const before = editor("x\n\n| a |\n|---|\n| 1 |\n", [0], 1);
    before.key("Backspace");
    before.key("Delete");
    expect(before.cursor).toEqual({ path: [0, 0, 0], offset: 0 });
});

test("a typed shortcode becomes an emoji only as a word of its own, not inside a word or a web address", () => {
    for (const typed of ["tag:cat:", "http://a.b/:fire:"]) {
        const e = editor("");
        e.type(typed);
        expect(e.markdown).toBe(`${typed}\n`);
    }
    const e = editor("");
    e.type("a :cat:");
    expect(e.state.doc.blocks[0]).toMatchObject({ runs: [{ kind: "text", text: "a " }, { kind: "emoji", name: "cat" }] });
});

test("typing over Select All replaces everything, a divider, picture or table at either end too, and one undo brings it all back", () => {
    for (const source of ["---\n\ntext\n\n![a](b.png)\n", "![a](b.png)\n\n- one\n- two\n\n---\n", "| a |\n|---|\n| 1 |\n\nmiddle\n\n| b |\n|---|\n| 2 |\n"]) {
        const e = editor(source);
        const paths = blockPaths(e.state.doc);
        const last = paths[paths.length - 1]!;
        const lastBlock = blockAt(e.state.doc, last);
        const end = lastBlock?.kind === "table" ? { path: [...last, lastBlock.rows.length, lastBlock.header.length - 1], offset: 1 } : { path: last, offset: 0 };
        const start = blockAt(e.state.doc, paths[0]!)?.kind === "table" ? { path: [...paths[0]!, 0, 0], offset: 0 } : { path: paths[0]!, offset: 0 };
        e.select({ anchor: start, focus: end });
        e.type("x");
        expect({ source, written: e.markdown }).toEqual({ source, written: "x\n" });
        e.undo();
        expect({ source, written: e.markdown }).toEqual({ source, written: source });
    }
});
