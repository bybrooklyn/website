// Which names are mdQuire's, and its ways to start: a blank page, a blog post dated today, notes,
// meeting notes, a changelog entry and a project page, each with its line in File, New.

import { expect, test } from "bun:test";
import { kindFor } from "../core/kind";
import { markdownName, templates } from "./starts";
import { read } from "./read";

test("Markdown, text and .quire files are mdQuire's, and so is a name with no ending, as the browser keeps a document", () => {
    for (const name of ["post.md", "page.mdx", "notes.markdown", "plain.txt", "Letter.quire", "Untitled", "Meeting notes"]) expect({ name, ours: markdownName(name) }).toEqual({ name, ours: true });
    expect(markdownName("photo.png")).toBe(false);
    // listed first, mdQuire takes whatever no other kind claims
    const md = { opens: markdownName };
    const other = { opens: (name: string) => name.endsWith(".note") };
    expect(kindFor([md, other], "photo.png")).toBe(md);
    expect(kindFor([md, other], "Today.note")).toBe(other);
});

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

test("each way to start has its own line in File, New", () => {
    expect(templates(new Date()).map((each) => each.said)).toEqual(["Document", "Blog post", "Notes", "Meeting notes", "Changelog entry", "Project page"]);
});
