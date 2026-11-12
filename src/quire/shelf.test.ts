// What the home screen is held to: its ways to start are a blank page, a blog post dated today and
// notes; the recent documents from every place come most recently touched first; a picture is
// drawn from no more than the first blocks; and a copy's name keeps its ending. The screen itself,
// and the page growing out of a picture, are used in app.test.ts.

import { expect, test } from "bun:test";
import { read } from "./read";
import { copyName, firstBlocks, recent, templates } from "./shelf";

test("the ways to start are Blank, Blog post and Notes, the post dated today and readable as a post", () => {
    const made = templates(new Date("2026-11-12T10:00:00Z"));
    expect(made.map((each) => each.label)).toEqual(["Blank", "Blog post", "Notes"]);
    expect(made[0]!.text).toBe("");
    const post = read(made[1]!.text);
    expect(post.frontmatter).toContain("date: 2026-11-12");
    expect(post.frontmatter).toContain("title:");
    expect(made[2]!.text.startsWith("Thursday, 12 November 2026")).toBe(true);
    expect(made.filter((each) => each.quire).map((each) => each.key)).toEqual(["blank", "notes"]);
});

test("recent documents from every place come newest first, those with no time after them in their places' order, and no more than asked", () => {
    const shown = recent([
        { store: "browser", entries: [{ id: "a", name: "A", modified: 30 }, { id: "b", name: "B", modified: 10 }] },
        { store: "github", entries: [{ id: "x", name: "X" }, { id: "y", name: "Y" }] },
        { store: "folder", entries: [{ id: "f", name: "F", modified: 20 }] },
    ]);
    expect(shown.map((each) => `${each.store}:${each.id}`)).toEqual(["browser:a", "folder:f", "browser:b", "github:x", "github:y"]);
    expect(recent([{ store: 1, entries: Array.from({ length: 40 }, (_, index) => ({ id: String(index), name: String(index), modified: index })) }], 24).length).toBe(24);
    expect(recent([])).toEqual([]);
});

test("a picture of a page is drawn from its first blocks only, so a long document is as quick to show as a short one", () => {
    const long = read(Array.from({ length: 5000 }, (_, index) => `Line ${index}.`).join("\n\n"));
    expect(firstBlocks(long).blocks.length).toBe(10);
    const short = read("# One\n\nTwo\n");
    expect(firstBlocks(short)).toBe(short);
});

test("a copy is named with copy before its ending", () => {
    expect(copyName("Plans")).toBe("Plans copy");
    expect(copyName("post.md")).toBe("post copy.md");
    expect(copyName("posts/hello.mdx")).toBe("posts/hello copy.mdx");
    expect(copyName("letter.quire")).toBe("letter copy.quire");
});
