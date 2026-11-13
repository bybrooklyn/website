// The emoji list opens only after a colon and two letters at the start of a word, never in code or a
// time or an address, finds names before other words, and choosing puts the emoji in place of what was typed.

import { expect, test } from "bun:test";
import { read } from "./read";
import { write } from "./write";
import { chooseEmoji, emojiQuery, matchEmoji } from "./emoji-picker";
import { caret } from "./keys";

const query = (markdown: string, offset?: number) => {
    const doc = read(markdown);
    const text = markdown.replace(/\n$/, "").replace(/`/g, "");
    return emojiQuery(doc, [0], offset ?? text.length);
};

test("a colon and two letters at the start of a word open the list; one letter, a time, an address or code do not", () => {
    expect(query("I am :sm\n")).toBe("sm");
    expect(query(":he\n")).toBe("he");
    expect(query("I am :s\n")).toBeUndefined();
    expect(query("at 10:30\n")).toBeUndefined();
    expect(query("see http:ab\n")).toBeUndefined();
    expect(query("a `:sm`\n", 5)).toBeUndefined();
    // a space after the name closes it
    expect(query("I am :smile x\n", 12)).toBeUndefined();
});

test("names that start with what was typed come first, then a part of a name, then other words", () => {
    const found = matchEmoji("hea").map((each) => each.name);
    expect(found[0]).toBe("heart");
    expect(found).toContain("heart_eyes");
    expect(matchEmoji("eyes").map((each) => each.name)).toContain("heart_eyes");
    expect(matchEmoji("lol").map((each) => each.name)).toContain("joy");
    expect(matchEmoji("trans").map((each) => each.name)).toContain("transgender_flag");
    expect(matchEmoji("zzzqqq")).toEqual([]);
});

test("choosing takes the colon and the letters away and puts the emoji there, written as its name", () => {
    const doc = read("I am :hea\n");
    const chosen = chooseEmoji({ doc, selection: caret([0], 9) }, "heart");
    expect(write(chosen.doc)).toBe("I am :heart:\n");
    expect(chosen.selection.focus).toEqual({ path: [0], offset: 6 });
});
