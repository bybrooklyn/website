// What the menu row's menus are held to: Docs' seven menus in Docs' order, each line in Docs' words
// with its shortcut and an icon (or, for a line that can be on, a tick), rules between the groups,
// the long menus folded into menus beside their lines, each thing in one menu only, what a Markdown
// file cannot keep offered only for a .quire document, and a command the editor did not give left
// out. The row itself is used in app.test.ts. Run with `bun test src/quire/menu-row.test.ts`.

import { expect, test } from "bun:test";
import { headings, menuFor, type Command, type RowActions, type RowState } from "./menu-row";
import { everyLine, type MenuItem } from "./ui";

const all: Command[] = [
    "turnRich", "downloadAs", "print", "history", "pageSetup", "zoom", "makeCopy", "rename", "fileDetails",
    "undo", "redo", "cut", "copy", "paste", "pastePlain", "selectAll", "selectMatching", "delete", "find", "replace",
    "pageless", "pages", "lookNone", "lookPaper", "outline", "comments", "markdown", "liveCount", "fullScreen",
    "picture", "table", "date", "link", "symbols", "divider", "pageBreak", "bookmark", "contents", "headerFooter", "footnote", "comment",
    "code", "callout", "details", "definitions", "maths", "diagram", "figure", "terminal", "timeline", "playhere",
    "bold", "italic", "underline", "strike", "superscript", "subscript", "bigger", "smaller", "capitals", "font", "color", "highlight", "inline", "marked", "spoiler", "subtext",
    "paragraph", "title", "subtitle", "heading1", "heading2", "heading3", "heading4", "heading5", "heading6", "quote",
    "left", "center", "right", "justify", "indent", "outdent", "spacing", "number", "bullet", "task", "lists", "clear",
    "check", "wordCount", "typing", "forgetUsed", "help", "shortcuts", "about", "palette",
];
const every: RowActions = {
    ...Object.fromEntries(all.map((command) => [command, () => {}])),
    subs: { downloadAs: () => [{ label: "Markdown", run: () => {} }], zoom: () => [{ label: "100%", run: () => {} }], size: () => [{ label: "12", run: () => {} }] },
    file: () => [{ label: "New", icon: "plus", items: () => [{ label: "Document", run: () => {} }], run: () => {} }, { label: "Open", icon: "folder", run: () => {} }],
    tools: () => [{ label: "Start dictation", icon: "plus", hint: "Ctrl+D", run: () => {} }],
};
const STATE: RowState = { rich: true, outline: true, markdown: false };

/** A menu as words: a rule as "---", a line with its shortcut, a line that opens a menu with "›" and that menu's lines under it, indented. */
const shape = (items: MenuItem[], depth = 0): string[] =>
    items.flatMap((item) => {
        const pad = "  ".repeat(depth);
        if (item.rule) return [`${pad}---`];
        const tick = item.pressed === undefined ? "" : item.pressed ? "✓ " : "  ";
        const said = `${pad}${tick}${item.label}${item.hint ? ` ${item.hint}` : ""}${item.items || item.form ? " ›" : ""}`;
        return [said, ...(item.items ? shape(item.items(), depth + 1) : [])];
    });
const menus = (state: Partial<RowState> = {}, act = every) => Object.fromEntries(headings({ ...STATE, ...state }, act).map((heading) => [heading.label, shape(heading.items())]));

test("the row has Docs' seven menus in Docs' order", () => {
    expect(Object.keys(menus())).toEqual(["File", "Edit", "View", "Insert", "Format", "Tools", "Help"]);
});

test("File is New, Open, Make a copy, Download, Rename, Version history, Details, Page setup and Print, in Docs' order", () => {
    expect(menus().File).toEqual(["New ›", "  Document", "Open", "Make a copy", "---", "Download ›", "  Markdown", "---", "Rename", "Version history", "Details", "---", "Page setup", "Print Ctrl+P"]);
    // a Markdown file can be saved as a .quire document, as Docs saves an Office file as a Google Doc
    expect(menus({ rich: false }).File).toContain("Save as .quire document");
    expect(menus({ rich: false }).File).not.toContain("Page setup");
});

test("Edit is Docs' Edit, with Find and replace alone at its end", () => {
    expect(menus().Edit).toEqual(["Undo Ctrl+Z", "Redo Ctrl+Shift+Z", "---", "Cut Ctrl+X", "Copy Ctrl+C", "Paste Ctrl+V", "Paste without formatting Ctrl+Shift+V", "---", "Select all Ctrl+A", "Select all matching text", "Delete Delete", "---", "Find and replace Ctrl+H"]);
});

test("View is the mode, the paper, four things to show and the zoom, each choice ticked, nothing twice", () => {
    expect(menus({ paged: false, look: "none", comments: true }).View).toEqual([
        "Mode ›",
        "  ✓ Pageless",
        "    Pages",
        "Paper ›",
        "  ✓ Dark",
        "    Light",
        "---",
        "✓ Show outline",
        "✓ Show comments",
        "  Show Markdown",
        "  Show word count",
        "---",
        "Zoom ›",
        "  100%",
        "Full screen Ctrl+Shift+F",
    ]);
    const view = menus({ paged: true, look: "paper", outline: false }).View!;
    expect(view.slice(0, 6)).toEqual(["Mode ›", "    Pageless", "  ✓ Pages", "Paper ›", "    Dark", "  ✓ Light"]);
    expect(view).toContain("  Show outline");
});

test("Insert has Docs' own lines, then a comment, then mdQuire's blocks under a rule, the site's components only in an .mdx file", () => {
    expect(menus().Insert).toEqual([
        "Picture", "Table", "Date", "Link Ctrl+K", "Special characters", "---",
        "Horizontal line", "Page break Ctrl+Enter", "Bookmark", "Table of contents", "Header, footer and page numbers Pages only", "Footnote Ctrl+Alt+F", "---",
        "Comment Ctrl+Alt+M", "---",
        "Code block", "Callout", "Folding section", "Definition list", "Maths", "Diagram",
    ]);
    expect(menus({ mdx: true }).Insert!.slice(-5)).toEqual(["Components ›", "  Figure", "  Terminal", "  Timeline", "  PlayHere"]);
    // a header shows only on pages, and a heading is a place to link to already
    const insert = (state: Partial<RowState>) => everyLine(headings({ ...STATE, ...state }, every)[3]!.items()).map((each) => each.item);
    expect(insert({ paged: false }).find((item) => item.key === "headerFooter")?.disabled).toBe(true);
    expect(insert({ paged: true }).find((item) => item.key === "headerFooter")?.disabled).toBeUndefined();
    expect(insert({ inHeading: true }).find((item) => item.key === "bookmark")?.disabled).toBe(true);
    expect(menus({ rich: false }).Insert!.some((line) => line.startsWith("Header"))).toBe(false);
});

test("Format folds into Text, Paragraph styles, Align and indent, spacing and Bullets and numbering, as Docs folds it, with mdQuire's marks in Text", () => {
    expect(menus({ align: "center" }).Format).toEqual([
        "Text ›",
        "  Bold Ctrl+B", "  Italic Ctrl+I", "  Underline Ctrl+U", "  Strikethrough Alt+Shift+5", "  Superscript Ctrl+.", "  Subscript Ctrl+,", "  ---",
        "  Size ›", "    Increase font size Ctrl+Shift+.", "    Decrease font size Ctrl+Shift+,", "    ---", "    12", "  Capitalization",
        "  ---", "  Font", "  Text color", "  Highlight color", "  ---",
        "  Inline code Ctrl+E", "  Marked Ctrl+Shift+H", "  Spoiler", "  Subtext",
        "Paragraph styles ›",
        "  Normal text Ctrl+Alt+0", "  Title", "  Subtitle", "  Heading 1 Ctrl+Alt+1", "  Heading 2 Ctrl+Alt+2", "  Heading 3 Ctrl+Alt+3", "  Heading 4 Ctrl+Alt+4", "  Heading 5 Ctrl+Alt+5", "  Heading 6 Ctrl+Alt+6", "  ---", "  Quote",
        "Align and indent ›",
        "    Align left Ctrl+Shift+L", "  ✓ Center Ctrl+Shift+E", "    Align right Ctrl+Shift+R", "    Justify Ctrl+Shift+J", "  ---", "  Increase indent Ctrl+]", "  Decrease indent Ctrl+[",
        "Line and paragraph spacing",
        "Bullets and numbering ›", "  Numbered list Ctrl+Shift+7", "  Bulleted list Ctrl+Shift+8", "  Checklist Ctrl+Shift+9", "  ---", "  List options",
        "---",
        "Clear formatting Ctrl+\\",
    ]);
    // what a Markdown file cannot keep is not offered for one
    const plain = menus({ rich: false }).Format!.join("\n");
    for (const kept of ["Font", "Highlight color", "Justify", "Line and paragraph spacing"]) expect(plain).not.toContain(kept);
    // a Markdown file keeps a subtitle in its frontmatter
    expect(plain).toContain("Subtitle");
    expect(plain).toContain("Center Ctrl+Shift+E");
});

test("Tools and Help hold what is left, once each", () => {
    expect(menus().Tools).toEqual(["Spelling and grammar", "Word count Ctrl+Shift+C", "---", "Start dictation Ctrl+D", "---", "Preferences", "Forget what I use most"]);
    expect(menus().Help).toEqual(["mdQuire help", "Keyboard shortcuts Ctrl+/", "---", "About mdQuire"]);
});

test("every line has an icon or a tick, and each command is in one menu only", () => {
    const lines = headings({ ...STATE, mdx: true }, every).flatMap((heading) => everyLine(heading.items()).map((each) => each.item));
    const bare = lines.filter((item) => !item.icon && item.pressed === undefined && !["Markdown", "100%", "12", "Document"].includes(item.label));
    expect(bare.map((item) => item.label)).toEqual([]);
    const keys = lines.flatMap((item) => (item.key ? [item.key] : []));
    expect(keys.length).toBe(new Set(keys).size);
});

test("a command the editor does not give is left out, and a menu or a group left empty goes with it", () => {
    const seen = menus({}, { undo: () => {}, bold: () => {} });
    expect(seen.Edit).toEqual(["Undo Ctrl+Z"]);
    expect(seen.Format).toEqual(["Text ›", "  Bold Ctrl+B"]);
    expect(seen.View).toEqual([]);
});

test("Alt and a menu's letter opens it, as in Docs, Ctrl+Option on a Mac, and F10 opens File; Alt with anything else is not a menu", () => {
    const key = (code: string, held: Partial<{ altKey: boolean; ctrlKey: boolean; shiftKey: boolean; metaKey: boolean }> = { altKey: true }) => ({ key: code.replace("Key", "").toLowerCase(), code, altKey: false, ctrlKey: false, shiftKey: false, metaKey: false, ...held });
    expect(["KeyF", "KeyE", "KeyV", "KeyI", "KeyO", "KeyT", "KeyH"].map((code) => menuFor(key(code)))).toEqual([0, 1, 2, 3, 4, 5, 6]);
    expect(menuFor(key("KeyB"))).toBeUndefined();
    expect(menuFor(key("KeyF", { altKey: true, shiftKey: true }))).toBeUndefined();
    expect(menuFor(key("KeyF", { altKey: true, ctrlKey: true }))).toBeUndefined();
    expect(menuFor(key("KeyF"), true)).toBeUndefined();
    expect(menuFor(key("KeyF", { altKey: true, ctrlKey: true }), true)).toBe(0);
    expect(menuFor({ ...key("F10", {}), key: "F10" })).toBe(0);
});
