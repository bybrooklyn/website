// What the home screen is held to: its ways to start are a blank page, a blog post dated today,
// notes, meeting notes, a changelog entry and a project page; the recent documents from every place come most recently touched first; when each was
// touched is said shortly; and a copy's name keeps its ending. The screen itself, and the page
// growing out of a row, are used in app.test.ts.

import { expect, test } from "bun:test";
import { read } from "./md/read";
import { copyName, recent, shortWhen, templates } from "./shelf";

test("the ways to start are blank, blog post, notes, meeting notes, a changelog entry and a project page, the post dated today and readable as a post", () => {
    const made = templates(new Date("2026-11-12T10:00:00Z"));
    expect(made.map((each) => each.label)).toEqual(["blank", "blog post", "notes", "meeting notes", "changelog entry", "project page"]);
    expect(made[0]!.text).toBe("");
    const post = read(made[1]!.text);
    expect(post.frontmatter).toContain("date: 2026-11-12");
    expect(post.frontmatter).toContain("title:");
    expect(made[2]!.text.startsWith("Thursday, 12 November 2026")).toBe(true);
    expect(made.filter((each) => each.quire).map((each) => each.key)).toEqual(["blank", "notes", "meeting"]);
});

test("meeting notes end on a checklist, a changelog entry is a dated heading as CHANGELOG.md has, and a project page is an .mdx file with the fields the site's projects need", () => {
    const made = templates(new Date("2026-11-12T10:00:00Z"));
    const meeting = read(made[3]!.text);
    expect(meeting.blocks.map((block) => block.kind)).toEqual(["paragraph", "heading", "paragraph", "heading", "paragraph", "heading", "list"]);
    expect(made[3]!.text.endsWith("- [ ] Something to do\n")).toBe(true);
    const changelog = read(made[4]!.text);
    expect(changelog.blocks[0]).toMatchObject({ kind: "heading", level: 2, runs: [{ text: "12 November 2026" }] });
    expect(changelog.blocks.filter((block) => block.kind === "heading" && block.level === 3).map((block) => (block.kind === "heading" ? block.runs.map((run) => ("text" in run ? run.text : "")).join("") : ""))).toEqual(["Added", "Changed", "Fixed"]);
    expect(made[5]!.name.endsWith(".mdx")).toBe(true);
    const project = read(made[5]!.text, { mdx: true });
    // the projects collection requires these, and a new page stays a draft until it is ready
    for (const field of ["name:", "summary:", "language:", "order: 99", "draft: true"]) expect(project.frontmatter).toContain(field);
    expect(project.blocks[0]).toMatchObject({ kind: "heading", level: 2 });
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

test("when a document was touched is said as a row has room for: the time today, yesterday, the day this year, the year before that", () => {
    const now = new Date(2026, 10, 13, 15, 30).getTime();
    expect(shortWhen(new Date(2026, 10, 13, 9, 4).getTime(), now)).toBe("today 09:04");
    expect(shortWhen(new Date(2026, 10, 12, 23, 59).getTime(), now)).toBe("yesterday");
    expect(shortWhen(new Date(2026, 10, 3, 12, 0).getTime(), now)).toBe("Nov 3");
    expect(shortWhen(new Date(2025, 0, 20, 12, 0).getTime(), now)).toBe("Jan 20, 2025");
});

test("a copy is named with copy before its ending", () => {
    expect(copyName("Plans")).toBe("Plans copy");
    expect(copyName("post.md")).toBe("post copy.md");
    expect(copyName("posts/hello.mdx")).toBe("posts/hello copy.mdx");
    expect(copyName("letter.quire")).toBe("letter copy.quire");
});
