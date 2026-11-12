// Phrases written into real documents: text, a replaced mark, breaks, headings and lists, and the
// commands that are left for the dictation to carry out.

import { describe, expect, test } from "bun:test";
import { blockPaths, documentOf, paragraph, textAt } from "../document";
import type { State } from "../history";
import { caret } from "../keys";
import { read } from "../read";
import { write as markdown } from "../write";
import { textBefore, write } from "./insert";
import { interpret } from "./spoken";

const start = (text: string): State => {
    const doc = text === "" ? documentOf([paragraph()]) : read(text);
    const path = blockPaths(doc).at(-1)!;
    return { doc, selection: caret(path, textAt(doc, path).length) };
};
/** Says a phrase at the end of a state, as dictation would. */
const say = (state: State, phrase: string, pending = {}) => {
    const steps = interpret(phrase, { before: textBefore(state, (path) => textAt(state.doc, path)), commands: true });
    return write(state, steps, pending);
};
const text = (state: State) => markdown(state.doc).trim();

describe("text", () => {
    test("is written at the cursor with the cursor after it", () => {
        const written = say(start("Hello"), "world period");
        expect(text(written.state)).toBe("Hello world.");
        expect(written.state.selection.focus.offset).toBe("Hello world.".length);
    });
    test("into an empty document begins with a capital", () => {
        expect(text(say(start(""), "hello there").state)).toBe("Hello there");
    });
    test("replaces a mark the earlier phrase ended with", () => {
        const first = say(start(""), "hello,");
        expect(text(say(first.state, "period").state)).toBe("Hello.");
    });
    test("replaces what is selected", () => {
        const state = start("Hello world");
        const selected: State = { doc: state.doc, selection: { anchor: { path: [0], offset: 6 }, focus: { path: [0], offset: 11 } } };
        expect(text(write(selected, [{ kind: "text", text: "there" }]).state)).toBe("Hello there");
    });
});

describe("breaks", () => {
    test("enter starts the next block, where the next phrase begins with a capital", () => {
        const first = say(start("First line."), "enter");
        expect(text(say(first.state, "second line").state)).toBe("First line.\n\nSecond line");
    });
    test("in a list it starts the next item", () => {
        const first = say(start("- one"), "new line");
        expect(text(say(first.state, "two").state)).toBe("- one\n- Two");
    });
});

describe("headings and lists", () => {
    test("heading makes the next phrase a heading, and what follows a paragraph", () => {
        const asked = say(start(""), "heading");
        expect(asked.pending).toEqual({ heading: 1 });
        const titled = say(asked.state, "the plan", asked.pending);
        expect(text(titled.state)).toBe("# The plan");
        expect(titled.pending).toEqual({});
        expect(text(say(titled.state, "first we begin").state)).toBe("# The plan\n\nFirst we begin");
    });
    test("heading two makes a level two heading", () => {
        const asked = say(start(""), "heading two");
        expect(text(say(asked.state, "details", asked.pending).state)).toBe("## Details");
    });
    test("bullet makes the block a bulleted item and numbered list a numbered one", () => {
        const bullet = say(start(""), "bullet");
        expect(text(say(bullet.state, "milk", bullet.pending).state)).toBe("- Milk");
        const numbered = say(start(""), "numbered list");
        expect(text(say(numbered.state, "milk", numbered.pending).state)).toBe("1. Milk");
    });
});

describe("commands for the dictation", () => {
    test("are handed back and change nothing in the text", () => {
        const written = say(start("Hello"), "undo that");
        expect(written.commands).toEqual(["undo"]);
        expect(text(written.state)).toBe("Hello");
        expect(say(start("Hello"), "that is all stop dictation").commands).toEqual(["stop"]);
    });
});
