// What is held true of the Insert menu's own additions: the date in the site's style, typed at
// the cursor; the special characters found by name; and the table of contents, made from the
// headings with the ids her site gives them, marked so that it can be made again, and made again
// without touching anything else. Run with `bun test src/quire`.

import { expect, test } from "bun:test";
import { insertText } from "./document";
import { caret } from "./keys";
import { addContents, CONTENTS, contentsList, dateText, findContents, findSpecials, isContentsMark, slug, SPECIALS, typeIn, updateContents } from "./inserts";
import { read } from "./read";
import { write } from "./write";

test("the date is written as her site writes one, and typed at the cursor in place of what is selected", () => {
    expect(dateText(new Date(2026, 10, 12))).toBe("November 12, 2026");
    const state = { doc: read("Written on X.\n"), selection: { anchor: { path: [0], offset: 11 }, focus: { path: [0], offset: 12 } } };
    expect(write(typeIn(state, dateText(new Date(2026, 0, 3))).doc)).toBe("Written on January 3, 2026.\n");
});

test("special characters are found by any word of their name, by their group, or by themselves", () => {
    expect(findSpecials("")).toBe(SPECIALS);
    expect(findSpecials("euro").flatMap((group) => group.chars.map((each) => each.char))).toEqual(["€"]);
    expect(findSpecials("right arrow").flatMap((group) => group.chars.map((each) => each.char))).toContain("→");
    expect(findSpecials("money")[0]!.chars.length).toBe(SPECIALS.find((group) => group.group === "Money")!.chars.length);
    expect(findSpecials("→").flatMap((group) => group.chars.map((each) => each.char))).toEqual(["→"]);
    expect(findSpecials("nothing like this")).toEqual([]);
    // every character is written once, and each has a name
    const all = SPECIALS.flatMap((group) => group.chars);
    expect(new Set(all.map((each) => each.char)).size).toBe(all.length);
    expect(all.every((each) => each.name.length > 1)).toBe(true);
});

test("a heading's id is made as her site makes it, numbered when the words came before", () => {
    const seen = new Map<string, number>();
    expect(slug("What's in a name?", seen)).toBe("whats-in-a-name");
    expect(slug("Ünïcode stays", seen)).toBe("ünïcode-stays");
    expect(slug("Notes", seen)).toBe("notes");
    expect(slug("Notes", seen)).toBe("notes-1");
    expect(slug("Notes", seen)).toBe("notes-2");
});

const POST = "# The title\n\nIntro.\n\n## One\n\n### One, inside\n\n## Two\n\nText.\n";

test("the table of contents lists the headings as links, nested by level, leaving out a lone title", () => {
    const list = contentsList(read(POST))!;
    const state = { doc: read(POST), selection: caret([1], 0) };
    const out = write(addContents(state).doc);
    expect(out).toBe("# The title\n\nIntro.\n\n<!-- contents -->\n\n- [One](#one)\n  - [One, inside](#one-inside)\n- [Two](#two)\n\n## One\n\n### One, inside\n\n## Two\n\nText.\n");
    expect(list.items).toHaveLength(2);
    // the cursor is left on an empty line after the list, so that what is put next goes after it
    expect(addContents(state).selection.focus.path).toEqual([4]);
    expect(contentsList(read("Just words.\n"))).toBeUndefined();
});

test("in MDX the marker is a comment MDX can read, and on an empty line the contents take its place", () => {
    const doc = read("## A\n\n\n## B\n", { mdx: true });
    const withLine = insertText(doc, { path: [0], offset: 1 }, "");
    const state = { doc: withLine, selection: caret([0], 0) };
    expect(write(addContents(state).doc)).toContain(CONTENTS.mdx);
});

test("updating makes the list again from the headings as they are, and changes nothing else; unchanged, it is left as it was", () => {
    const made = write(addContents({ doc: read(POST), selection: caret([1], 0) }).doc);
    expect(updateContents(read(made))).toEqual(read(made));
    const renamed = made.replace("## Two\n", "## Two and a half\n");
    const again = write(updateContents(read(renamed)));
    expect(again).toBe(renamed.replace("- [Two](#two)", "- [Two and a half](#two-and-a-half)"));
    expect(findContents(read(again))).toEqual({ mark: 2, list: true });
    expect(isContentsMark(read("<!-- contents -->\n").blocks[0])).toBe(true);
});
