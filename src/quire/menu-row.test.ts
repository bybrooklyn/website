// What the menu row's menus are held to: the six words in order, every command there by name with
// its shortcut beside it, what a Markdown file cannot keep offered only for a .quire document, and
// a command the editor did not give left out. The row itself is used in editor.test.ts. Run with
// `bun test src/quire/menu-row.test.ts`.

import { expect, test } from "bun:test";
import { headings, type Command, type RowActions } from "./menu-row";

const all: Command[] = ["turnRich", "download", "downloadQuire", "print", "history", "undo", "redo", "selectAll", "link", "outline", "markdown", "table", "picture", "divider", "code", "footnote", "bullet", "number", "task", "bold", "italic", "underline", "strike", "inline", "paragraph", "heading1", "heading2", "heading3", "quote", "color", "size", "font", "highlight", "spacing", "left", "center", "right", "justify", "pageSetup", "zoom"];
const every: RowActions = Object.fromEntries(all.map((command) => [command, () => {}]));
const lines = (rich: boolean, act = every) => Object.fromEntries(headings({ rich, outline: true, markdown: false, words: 1204 }, act).map((heading) => [heading.label, heading.items().map((item) => (item.hint ? `${item.label} ${item.hint}` : item.label))]));

test("the row has its six words, and each command is in its menu by name with its shortcut", () => {
    const seen = lines(true);
    expect(Object.keys(seen)).toEqual(["File", "Edit", "View", "Insert", "Format", "Tools"]);
    expect(seen.Edit).toEqual(["Undo Ctrl+Z", "Redo Ctrl+Shift+Z", "Select all Ctrl+A", "Link Ctrl+K"]);
    // the shortcuts come from the one table (shortcuts.ts), as Docs has them
    expect(seen.Format).toEqual(["Bold Ctrl+B", "Italic Ctrl+I", "Underline Ctrl+U", "Strikethrough Alt+Shift+5", "Inline code Ctrl+E", "Normal text Ctrl+Alt+0", "Heading 1 Ctrl+Alt+1", "Heading 2 Ctrl+Alt+2", "Heading 3 Ctrl+Alt+3", "Quote", "Text color ›", "Text size ›", "Typeface ›", "Highlight ›", "Line spacing ›", "Align left Ctrl+Shift+L", "Centre Ctrl+Shift+E", "Align right Ctrl+Shift+R", "Justify Ctrl+Shift+J"]);
    expect(seen.Insert).toContain("Table");
    expect(seen.Insert).toContain("Picture");
    expect(seen.Tools![0]).toBe("1,204 words");
    // every command given is somewhere in the row
    const labels = Object.values(lines(true)).flat().concat(Object.values(lines(false)).flat()).join("\n");
    for (const word of ["Turn into a .quire document", "Download .quire", "Download as Markdown .md", "Print Ctrl+P", "Version history", "Page setup ›", "Zoom ›", "Outline", "The Markdown beside the page", "Horizontal line", "Code block", "Footnote", "Checklist"]) expect(labels).toContain(word);
});

test("what a Markdown file cannot keep is offered only for a .quire document, and turning one into a .quire only for Markdown", () => {
    for (const kept of ["Typeface ›", "Highlight ›", "Line spacing ›", "Justify Ctrl+Shift+J"]) expect(lines(false).Format).not.toContain(kept);
    expect(lines(false).Format).toContain("Centre Ctrl+Shift+E");
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

test("Insert has a page break with its shortcut, and for a .quire document the header, footer and page numbers", () => {
    const act: RowActions = { ...every, pageBreak: () => {}, headerFooter: () => {} };
    expect(lines(true, act).Insert).toContain("Page break Ctrl+Enter");
    // outside page view, where a header shows nowhere, it is offered dimmed with the reason, as Docs dims it in pageless
    expect(lines(true, act).Insert).toContain("Header, footer and page numbers Page view only");
    const outside = headings({ rich: true, outline: true, markdown: false, words: 0 }, act)[3]!.items().find((item) => item.key === "headerFooter");
    expect(outside?.disabled).toBe(true);
    const paged = headings({ rich: true, paged: true, outline: true, markdown: false, words: 0 }, act)[3]!.items().find((item) => item.key === "headerFooter");
    expect(paged).toMatchObject({ hint: "›" });
    expect(paged?.disabled).toBeUndefined();
    expect(lines(false, act).Insert).toContain("Page break Ctrl+Enter");
    expect(lines(false, act).Insert.some((line) => line.startsWith("Header, footer"))).toBe(false);
});

test("Select all occurrences is dimmed while the words appear in fewer than two places", () => {
    const act: RowActions = { ...every, selectMatching: () => {} };
    const line = (matches: number) => headings({ rich: true, matches: () => matches, outline: true, markdown: false, words: 0 }, act)[1]!.items().find((item) => item.key === "selectMatching");
    expect(line(1)?.disabled).toBe(true);
    expect(line(3)?.disabled).toBeUndefined();
});

test("View has page view, pressed while it is on", () => {
    const act: RowActions = { ...every, pageView: () => {} };
    const view = (paged: boolean) => headings({ rich: true, paged, outline: false, markdown: false, words: 0 }, act)[2]!.items().find((item) => item.label === "Page view");
    expect(view(false)?.pressed).toBe(false);
    expect(view(true)?.pressed).toBe(true);
});
