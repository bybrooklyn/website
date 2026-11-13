// What capitalisation is held to: the letters change and nothing else does (marks and links stay
// on the letters they were on), a character made of several code points is changed whole, Title
// Case leaves the small words small but first and last, and nothing selected means the cursor's
// word. Run with `bun test src/quire`.

import { expect, test } from "bun:test";
import { recase, recaseText, titleStarts } from "./capitals";
import { caret } from "./keys";
import { read } from "./read";
import { write } from "./write";

const run = (markdown: string, how: "lower" | "upper" | "title", from = 0, to = Infinity) => {
    const doc = read(markdown);
    const end = Math.min(to, markdown.replace(/[*\[\]]|\(.*?\)/g, "").trimEnd().length);
    return recase(how)({ doc, selection: { anchor: { path: [0], offset: from }, focus: { path: [0], offset: end } } });
};

test("lowercase and UPPERCASE change the letters and keep bold and links where they were", () => {
    expect(write(run("Some **Bold** and a [Link](/x) here\n", "upper").doc)).toBe("SOME **BOLD** AND A [LINK](/x) HERE\n");
    expect(write(run("SOME **BOLD** TEXT\n", "lower").doc)).toBe("some **bold** text\n");
});

test("Title Case capitalises each word, leaving the small ones small but the first and the last", () => {
    expect(write(run("the lord of the rings and a tale to tell of\n", "title").doc)).toBe("The Lord of the Rings and a Tale to Tell Of\n");
    expect(write(run("WAR AND PEACE\n", "title").doc)).toBe("War and Peace\n");
    expect(write(run("a **bold** move\n", "title").doc)).toBe("A **Bold** Move\n");
});

test("accented letters and emoji are changed a whole character at a time, by the language's own rules", () => {
    expect(recaseText("élan éte", "upper")).toBe("ÉLAN ÉTE");
    expect(recaseText("straße", "upper")).toBe("STRASSE");
    expect(recaseText("👨‍👩‍👧 ÇA", "lower")).toBe("👨‍👩‍👧 ça");
    expect(recaseText("émile zola", "title", 0, titleStarts("émile zola", 0, 10))).toBe("Émile Zola");
});

test("with nothing selected the cursor's word changes, and a letter that grows moves the selection's end with it", () => {
    const state = recase("upper")({ doc: read("one two three\n"), selection: caret([0], 5) });
    expect(write(state.doc)).toBe("one TWO three\n");
    const grown = run("weiß\n", "upper");
    expect(write(grown.doc)).toBe("WEISS\n");
    expect(grown.selection.focus.offset).toBe(5);
});
