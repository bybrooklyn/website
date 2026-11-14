// What find and replace is held to: matches are found in reading order through paragraphs, list
// items and table cells, with or without matching capitals and as whole words or not; replacing
// keeps the rest of the text, its marks included; and the current match is the first at or after
// the cursor. The bar itself is used in editor.test.ts.

import { expect, test } from "bun:test";
import { findMatches, matchAfter, replaceMatches } from "./find";
import { read } from "./read";
import { write } from "./write";

const doc = read("The cat sat.\n\n- A Cat\n- concatenate\n\n| cat | dog |\n| --- | --- |\n| **cat** | x |\n");

test("matches are found in reading order, in list items and table cells too, without capitals mattering unless asked", () => {
    const all = findMatches(doc, "cat");
    expect(all.map((match) => `${match.path.join(".")}:${match.from}`)).toEqual(["0:4", "1.0.0:2", "1.1.0:3", "2.0.0:0", "2.1.0:0"]);
    expect(findMatches(doc, "Cat", { matchCase: true }).map((match) => match.path.join("."))).toEqual(["1.0.0"]);
    expect(findMatches(doc, "")).toEqual([]);
});

test("whole word leaves out a match inside a longer word", () => {
    expect(findMatches(doc, "cat", { wholeWord: true }).map((match) => match.path.join("."))).toEqual(["0", "1.0.0", "2.0.0", "2.1.0"]);
    expect(findMatches(read("a-cat b cat_x cat.\n"), "cat", { wholeWord: true }).map((match) => match.from)).toEqual([2, 14]);
});

test("a match found again after another does not overlap it", () => {
    expect(findMatches(read("aaaa\n"), "aa").map((match) => match.from)).toEqual([0, 2]);
});

test("replacing all changes every match and nothing else, a bold word staying bold", () => {
    const next = replaceMatches(doc, findMatches(doc, "cat"), "fox");
    expect(write(next)).toBe("The fox sat.\n\n- A fox\n- confoxenate\n\n| fox     | dog |\n| ------- | --- |\n| **fox** | x   |\n");
    expect(write(replaceMatches(doc, [], "fox"))).toBe(write(doc));
});

test("replacing one leaves the others", () => {
    const [, second] = findMatches(doc, "cat");
    expect(write(replaceMatches(doc, [second!], "dog"))).toContain("- A dog\n- concatenate");
});

test("the current match is the first that does not end before the cursor, round to the first after the last", () => {
    const all = findMatches(doc, "cat");
    expect(matchAfter(all, { path: [0], offset: 0 })).toBe(0);
    expect(matchAfter(all, { path: [0], offset: 6 })).toBe(0);
    expect(matchAfter(all, { path: [0], offset: 7 })).toBe(1);
    expect(matchAfter(all, { path: [2, 1, 1], offset: 0 })).toBe(0);
    expect(matchAfter([], { path: [0], offset: 0 })).toBe(-1);
});
