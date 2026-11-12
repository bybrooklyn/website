// What the menu row's menus are held to: the six words in order, every command there by name with
// its shortcut beside it, what a Markdown file cannot keep offered only for a .quire document, and
// a command the editor did not give left out. The row itself is used in editor.test.ts. Run with
// `bun test src/quire/menu-row.test.ts`.

import { expect, test } from "bun:test";
import { headings, type Command, type RowActions } from "./menu-row";

const all: Command[] = ["turnRich", "download", "downloadQuire", "print", "history", "undo", "redo", "selectAll", "link", "outline", "markdown", "table", "picture", "divider", "code", "footnote", "bullet", "number", "task", "bold", "italic", "underline", "strike", "inline", "paragraph", "heading1", "heading2", "heading3", "quote", "color", "size", "center", "font", "highlight"];
const every: RowActions = Object.fromEntries(all.map((command) => [command, () => {}]));
const lines = (rich: boolean, act = every) => Object.fromEntries(headings({ rich, outline: true, markdown: false, words: 1204 }, act).map((heading) => [heading.label, heading.items().map((item) => (item.hint ? `${item.label} ${item.hint}` : item.label))]));

test("the row has its six words, and each command is in its menu by name with its shortcut", () => {
    const seen = lines(true);
    expect(Object.keys(seen)).toEqual(["File", "Edit", "View", "Insert", "Format", "Tools"]);
    expect(seen.Edit).toEqual(["Undo Ctrl+Z", "Redo Ctrl+Shift+Z", "Select all Ctrl+A", "Link Ctrl+K"]);
    expect(seen.Format).toEqual(["Bold Ctrl+B", "Italic Ctrl+I", "Underline Ctrl+U", "Strikethrough Ctrl+Shift+X", "Inline code Ctrl+E", "Paragraph Ctrl+Alt+0", "Heading 1 Ctrl+Alt+1", "Heading 2 Ctrl+Alt+2", "Heading 3 Ctrl+Alt+3", "Quote", "Text color", "Text size", "Centre", "Typeface", "Highlight"]);
    expect(seen.Insert).toContain("Table");
    expect(seen.Insert).toContain("Picture");
    expect(seen.Tools![0]).toBe("1,204 words");
    // every command given is somewhere in the row
    const labels = Object.values(lines(true)).flat().concat(Object.values(lines(false)).flat()).join("\n");
    for (const word of ["Turn into a .quire document", "Download .quire", "Download as Markdown .md", "Print Ctrl+P", "Version history", "Outline", "The Markdown beside the page", "Horizontal line", "Code block", "Footnote", "Checklist"]) expect(labels).toContain(word);
});

test("what a Markdown file cannot keep is offered only for a .quire document, and turning one into a .quire only for Markdown", () => {
    expect(lines(false).Format).not.toContain("Typeface");
    expect(lines(false).Format).not.toContain("Highlight");
    expect(lines(false).File).toContain("Turn into a .quire document");
    expect(lines(false).File).toContain("Download .md");
    expect(lines(true).File).not.toContain("Turn into a .quire document");
});

test("a command the editor does not give is left out, and the page's own lines lead the File menu", () => {
    const seen = lines(false, { undo: () => {}, file: () => [{ label: "New document", run: () => {} }] });
    expect(seen.Edit).toEqual(["Undo Ctrl+Z"]);
    expect(seen.File).toEqual(["New document"]);
    expect(headings({ rich: false, outline: true, markdown: false, words: 0 }, every)[2]!.items()[0]!.pressed).toBe(true);
});
