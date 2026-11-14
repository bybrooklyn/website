// The emoji list opens only after a colon and two letters at the start of a word, never in code or a
// time or an address, finds names before other words, and choosing puts the emoji in place of what was typed.
// The grid's groups hold every emoji once; a skin tone follows the emoji's first character; what was
// used lately is read back only as far as it is sound; and an emoji put in from the grid is written
// as the colon list writes it, or as its character where no shortcode says it.

import { expect, test } from "bun:test";
import { read } from "./read";
import { write } from "./write";
import { chooseEmoji, emojiQuery, grouped, GROUPS, matchEmoji, putEmoji, readUsed, takesTone, toned, used } from "./emoji-picker";
import { EMOJI } from "./emoji";
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

test("the grid's groups hold every emoji once, each where a reader would look for it", () => {
    const groups = grouped();
    expect([...groups.keys()]).toEqual(GROUPS.map((group) => group.key));
    const shown = [...groups.values()].flat();
    expect(new Set(shown.map((name) => EMOJI[name])).size).toBe(new Set(Object.values(EMOJI)).size);
    expect(shown.length).toBe(new Set(Object.values(EMOJI)).size);
    const where = (name: string) => [...groups].find(([, names]) => names.includes(name))?.[0];
    expect(["smile", "wave", "ninja", "pizza", "cat", "soccer", "car", "bulb", "heart", "rainbow_flag", "white_flag", "arrow_right"].map(where)).toEqual(["people", "people", "people", "food", "nature", "activities", "travel", "objects", "symbols", "flags", "flags", "symbols"]);
    // every group's first emoji is named in the table, so a renamed one cannot quietly empty a group
    for (const group of GROUPS) for (const name of group.starts) expect(Object.hasOwn(EMOJI, name)).toBe(true);
});

test("a skin tone follows an emoji's first character, in place of the sign asking for a picture, and only hands and people take one", () => {
    expect(toned("wave", 3)).toBe("\u{1F44B}\u{1F3FD}");
    expect(toned("v", 1)).toBe("\u{270C}\u{1F3FB}");
    expect(toned("technologist", 5)).toBe("\u{1F9D1}\u{1F3FF}\u{200D}\u{1F4BB}");
    expect(toned("wave", 0)).toBe(EMOJI.wave!);
    expect(toned("smile", 4)).toBe(EMOJI.smile!);
    expect(takesTone("thumbsup") || takesTone("+1")).toBe(true);
    expect(takesTone("cat")).toBe(false);
});

test("what was used lately comes first, once, three rows at most, and is read back only as far as it is sound", () => {
    let lately = used([], { name: "smile", tone: 0 });
    lately = used(lately, { name: "wave", tone: 2 });
    lately = used(lately, { name: "smile", tone: 0 });
    expect(lately).toEqual([{ name: "smile", tone: 0 }, { name: "wave", tone: 2 }]);
    expect(readUsed(JSON.stringify(lately))).toEqual(lately);
    for (const broken of [null, "", "not json", "{}", "[1, 2]", '[{"name": "nothing_like_it", "tone": 0}]', '[{"name": "wave", "tone": 9}]', '[{"name": "wave"}]', '[{"name": "toString", "tone": 0}]']) expect(readUsed(broken)).toEqual([]);
    // a tone on an emoji that takes none is let go
    expect(readUsed('[{"name": "cat", "tone": 3}]')).toEqual([{ name: "cat", tone: 0 }]);
    const many = Array.from({ length: 40 }, () => ({ name: "smile", tone: 0 }));
    expect(readUsed(JSON.stringify(many)).length).toBe(24);
    expect(Array.from({ length: 40 }, (_, index) => Object.keys(EMOJI)[index]!).reduce((all, name) => used(all, { name, tone: 0 }), [] as { name: string; tone: number }[]).length).toBe(24);
});

test("an emoji put in from the grid is written as the colon list writes it, over what was selected; in a skin tone or in code it is the character", () => {
    const put = (markdown: string, name: string, tone: number, from: number, to = from, path = [0]) => write(putEmoji({ doc: read(markdown), selection: { anchor: { path, offset: from }, focus: { path, offset: to } } }, name, tone).doc);
    expect(put("Hi you\n", "smile", 0, 3, 6)).toBe("Hi :smile:\n");
    expect(put("I am here\n", "heart", 0, 5, 9)).toBe("I am :heart:\n");
    expect(put("Hi\n", "wave", 3, 2)).toBe("Hi\u{1F44B}\u{1F3FD}\n");
    expect(put("```\ncode\n```\n", "smile", 0, 4)).toBe("```\ncode\u{1F604}\n```\n");
    const state = putEmoji({ doc: read("Hi\n"), selection: caret([0], 2) }, "smile", 0);
    expect(state.doc.blocks[0]).toMatchObject({ runs: [{ text: "Hi" }, { kind: "emoji", name: "smile" }] });
    expect(state.selection.focus).toEqual({ path: [0], offset: 3 });
});
