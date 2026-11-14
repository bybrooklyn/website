// Which documents are mdQuire's, and its ways to start something new: what the shelf's "new" words
// and File, New offer for it (kind.ts gives them to the core's app). Pure, and tested apart from the
// editor.

import type { Template } from "../core/shelf";

/** True when a name is one of mdQuire's: a Markdown or text file, a `.quire` document, or a name with no ending, as the browser keeps a document. */
export const markdownName = (name: string): boolean => /\.(md|mdx|markdown|txt|quire)$/i.test(name) || !/\.[a-z0-9]{1,8}$/i.test(name);

/** The ways to start something new, dated today where they carry a date, each with its line in File, New. */
export function templates(today: Date): Template[] {
    const day = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
    const said = today.toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long", year: "numeric" });
    return [
        { key: "blank", label: "blank", name: "Untitled", text: "", quire: true, said: "Document", icon: "file" },
        { key: "post", label: "blog post", name: "A new post", text: `---\ntitle: A new post\ndate: ${day}\nsummary: What it is about, in a line.\n---\n\nThe first paragraph.\n`, quire: false, said: "Blog post", icon: "pen" },
        { key: "notes", label: "notes", name: "Notes", text: `${said}\n\n## To do\n\n- [ ] Something to do\n\n## Thoughts\n\nA first thought.\n`, quire: true, said: "Notes", icon: "task" },
        { key: "meeting", label: "meeting notes", name: "Meeting notes", text: `${said}\n\n## Who was there\n\nNames.\n\n## Decided\n\nWhat was decided.\n\n## Next\n\n- [ ] Something to do\n`, quire: true, said: "Meeting notes", icon: "comment" },
        // as CHANGELOG.md is written: the day as a heading, what changed under it
        { key: "changelog", label: "changelog entry", name: "Changelog entry", text: `## ${today.getDate()} ${today.toLocaleDateString("en-US", { month: "long" })} ${today.getFullYear()}\n\n### Added\n\n- What is new.\n\n### Changed\n\n- What works differently.\n\n### Fixed\n\n- What was broken.\n`, quire: false, said: "Changelog entry", icon: "history" },
        // the frontmatter the site's projects collection asks for (src/content.config.ts), a draft until it is ready, last in the list
        { key: "project", label: "project page", name: "A new project.mdx", text: `---\nname: A new project\nsummary: What it is, in one sentence.\nlanguage: TypeScript\nstatus: in development\norder: 99\ndraft: true\n---\n\n## What it is\n\nWhat it is and who it is for.\n\n## What it does\n\nWhat it can do.\n\n## Getting it\n\nWhere to get it.\n`, quire: false, said: "Project page", icon: "component" },
    ];
}
