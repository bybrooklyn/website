// mdQuire's menus: File, Edit, View, Insert, Format, Tools and Help, as the core's menu row
// (core/menu-row.ts) shows them. Every command mdQuire has is in them by name, with its shortcut beside
// it, so nothing has to be known by its keys or its Markdown to be found. The menus follow Google
// Docs': the same menus, the same order of lines and the same words wherever mdQuire has the thing, an
// icon on every line, rules between groups, and the long menus folded into groups that open beside
// their line. mdQuire's own things go where they would fit in Docs: its blocks at the end of Insert,
// its marks in Format, Text. Each thing is in one menu only.
//
// What is in each menu is built by `headings`, which is pure: the editor gives it how things stand
// and what each command does. The palette, the right-click menu and the Ctrl+/ panel read the same
// table, so a command added here is in all of them.

import type { Align } from "./document";
import { keysFor } from "./shortcuts";
import type { Heading } from "../core/menu-row";
import { ruled, type MenuItem } from "../core/ui";

/** How things stand, as far as the menus show it. */
export interface RowState {
    /** True for a `.quire` document, which can have what a Markdown file cannot keep. */
    rich: boolean;
    /** True for an `.mdx` file, which can hold the site's components. */
    mdx?: boolean;
    /** True in Pages mode: the paper set up, as real pages. */
    paged?: boolean;
    /** How many places the selected words (or the cursor's word) appear in, counted only when the Edit menu is drawn, since in a long document it takes a while; Select all matching text is dimmed for fewer than two. */
    matches?: () => number;
    /** The paper the writing is on: dark (the site's ground, no page) or light. */
    look?: "none" | "paper";
    outline: boolean;
    markdown: boolean;
    /** True while the comments are shown beside the text. */
    comments?: boolean;
    /** How the cursor's block sits across the page, ticked in Format, Align and indent. */
    align?: Align;
    /** True when the document has a table of contents, which Insert then offers to make again. */
    contents?: boolean;
    /** True while the word count is kept at the window's lower left as the writer types. */
    counting?: boolean;
    /** Where the cursor is: in a list (which has options) or a heading (which is a place to link to already, and needs no bookmark). */
    inList?: boolean;
    inHeading?: boolean;
}

/** Every command the row can hold. */
export type Command =
    | "turnRich" | "downloadAs" | "print" | "history" | "pageSetup" | "zoom" | "makeCopy" | "rename" | "fileDetails"
    | "undo" | "redo" | "cut" | "copy" | "paste" | "pastePlain" | "selectAll" | "selectMatching" | "delete" | "find" | "replace"
    | "pageless" | "pages" | "lookNone" | "lookPaper" | "outline" | "comments" | "markdown" | "liveCount" | "fullScreen" | "zoomIn" | "zoomOut" | "zoomReset"
    | "picture" | "table" | "date" | "link" | "symbols" | "emoji" | "divider" | "pageBreak" | "bookmark" | "contents" | "updateContents" | "headerFooter" | "footnote" | "comment"
    | "code" | "callout" | "details" | "definitions" | "maths" | "diagram" | "figure" | "terminal" | "timeline" | "playhere"
    | "bold" | "italic" | "underline" | "strike" | "superscript" | "subscript" | "bigger" | "smaller" | "size" | "capitals" | "font" | "color" | "highlight"
    | "inline" | "marked" | "spoiler" | "subtext"
    | "paragraph" | "title" | "subtitle" | "heading1" | "heading2" | "heading3" | "heading4" | "heading5" | "heading6" | "quote"
    | "left" | "center" | "right" | "justify" | "indent" | "outdent" | "spacing" | "number" | "bullet" | "task" | "lists" | "clear"
    | "check" | "wordCount" | "typing" | "forgetUsed" | "help" | "shortcuts" | "about" | "palette";

/**
 * What each command does, given by the editor; a command not given is left out. `subs` gives the
 * lines of a command's menu beside its line, and `forms` the small form it opens there instead.
 * `file` gives the lines that start the File menu (New and Open), and `tools` dictation's lines.
 */
export type RowActions = Partial<Record<Command, () => void>> & {
    subs?: Partial<Record<Command, () => MenuItem[]>>;
    forms?: Partial<Record<Command, () => HTMLElement>>;
    file?: () => MenuItem[];
    tools?: () => MenuItem[];
};

/** The menus of the row, for a document as it stands. A line's shortcut, if it has one, comes from the table in shortcuts.ts. */
export function headings(state: RowState, act: RowActions): Heading[] {
    const line = (command: Command, label: string, icon = "", extra: Partial<MenuItem> = {}): MenuItem[] => {
        const run = act[command];
        const items = act.subs?.[command];
        const form = act.forms?.[command];
        if (!run && !items && !form) return [];
        const keys = keysFor(command);
        return [{ label, key: command, run: run ?? (() => {}), ...(icon ? { icon } : {}), ...(items ? { items } : {}), ...(form ? { form } : {}), ...(keys ? { hint: keys } : {}), ...extra }];
    };
    /** A line that opens a menu of these groups beside it; left out when they are all empty. */
    const group = (label: string, icon: string, ...groups: MenuItem[][]): MenuItem[] => {
        const inside = ruled(...groups);
        return inside.length ? [{ label, icon, items: () => inside, run: () => {} }] : [];
    };
    const rich = <T>(lines: T[]): T[] => (state.rich ? lines : []);
    const choice = (on: boolean, name: string) => ({ pressed: on, group: name });
    const headingLines = ([1, 2, 3, 4, 5, 6] as const).flatMap((level) => line(`heading${level}`, `Heading ${level}`, `heading${level}`));
    return [
        {
            label: "File",
            items: () =>
                ruled(
                    [...(act.file?.() ?? []), ...line("makeCopy", "Make a copy", "copy"), ...(state.rich ? [] : line("turnRich", "Save as .quire document", "file", { words: ["turn into a .quire document"] }))],
                    line("downloadAs", "Download", "download", { words: ["download as", "export"] }),
                    [...line("rename", "Rename", "rename"), ...line("history", "Version history", "history"), ...line("fileDetails", "Details", "info")],
                    [...rich(line("pageSetup", "Page setup", "page")), ...line("print", "Print", "print", { words: ["pdf"] })],
                ),
        },
        {
            label: "Edit",
            items: () =>
                ruled(
                    [...line("undo", "Undo", "undo"), ...line("redo", "Redo", "redo")],
                    [...line("cut", "Cut", "cut"), ...line("copy", "Copy", "copy"), ...line("paste", "Paste", "paste"), ...line("pastePlain", "Paste without formatting", "plain")],
                    [...line("selectAll", "Select all", "select"), ...line("selectMatching", "Select all matching text", "matching", { words: ["select all occurrences"], ...((state.matches?.() ?? 2) < 2 ? { disabled: true } : {}) }), ...line("delete", "Delete", "trash")],
                    line("replace", "Find and replace", "find", { words: ["find"] }),
                ),
        },
        {
            label: "View",
            items: () =>
                ruled(
                    [
                        ...group("Mode", "mode", [...line("pageless", "Pageless", "", { ...choice(!state.paged, "mode"), words: ["no page"] }), ...line("pages", "Pages", "", { ...choice(!!state.paged, "mode"), words: ["page view", "print layout"] })]),
                        ...group("Paper", "paper", [...line("lookNone", "Dark", "", { ...choice((state.look ?? "none") === "none", "look"), words: ["no page"] }), ...line("lookPaper", "Light", "", { ...choice(state.look === "paper", "look"), words: ["light paper"] })]),
                    ],
                    [
                        ...line("outline", "Show outline", "", { pressed: state.outline }),
                        ...line("comments", "Show comments", "", { pressed: !!state.comments, words: ["notes"] }),
                        ...line("markdown", "Show Markdown", "", { pressed: state.markdown, words: ["the markdown beside the page"] }),
                        ...line("liveCount", "Show word count", "", { pressed: !!state.counting, words: ["word count while typing"] }),
                    ],
                    [...line("zoom", "Zoom", "zoom"), ...line("fullScreen", "Full screen", "full")],
                ),
        },
        {
            label: "Insert",
            items: () =>
                ruled(
                    [...line("picture", "Picture", "image", { words: ["image"] }), ...line("table", "Table", "table"), ...line("date", "Date", "date"), ...line("link", "Link", "link"), ...line("symbols", "Special characters", "omega", { words: ["symbols"] })],
                    [
                        ...line("divider", "Horizontal line", "divider"),
                        ...line("emoji", "Emoji", "emoji", { words: ["smiley", "emoticon"] }),
                        ...line("pageBreak", "Page break", "pagebreak"),
                        ...line("bookmark", "Bookmark", "bookmark", state.inHeading ? { disabled: true } : {}),
                        ...(state.contents ? line("updateContents", "Update the table of contents", "contents") : line("contents", "Table of contents", "contents")),
                        // outside Pages mode, where a header shows nowhere, it is offered dimmed with the reason, as Docs dims it in pageless
                        ...rich(line("headerFooter", "Header, footer and page numbers", "header", state.paged ? {} : { hint: "Pages only", disabled: true })),
                        ...line("footnote", "Footnote", "footnote"),
                    ],
                    line("comment", "Comment", "comment", { words: ["note"] }),
                    [
                        ...line("code", "Code block", "block"),
                        ...line("callout", "Callout", "callout"),
                        ...line("details", "Folding section", "fold"),
                        ...line("definitions", "Definition list", "terms"),
                        ...line("maths", "Maths", "maths", { words: ["equation"] }),
                        ...line("diagram", "Diagram", "diagram"),
                        ...(state.mdx ? group("Components", "component", [...line("figure", "Figure", "image"), ...line("terminal", "Terminal", "terminal"), ...line("timeline", "Timeline", "timeline"), ...line("playhere", "PlayHere", "play")]) : []),
                    ],
                ),
        },
        {
            label: "Format",
            items: () =>
                ruled(
                    [
                        ...group(
                            "Text",
                            "text",
                            [...line("bold", "Bold", "bold"), ...line("italic", "Italic", "italic"), ...line("underline", "Underline", "underline"), ...line("strike", "Strikethrough", "strike"), ...line("superscript", "Superscript", "sup"), ...line("subscript", "Subscript", "sub")],
                            [
                                ...group("Size", "size", [...line("bigger", "Increase font size", "plus", { words: ["larger text"] }), ...line("smaller", "Decrease font size", "minus", { words: ["smaller text"] })], act.subs?.size?.() ?? []),
                                ...line("capitals", "Capitalization", "capitals", { words: ["capitalisation", "case"] }),
                            ],
                            // what a Markdown file cannot keep is not offered for one
                            [...rich(line("font", "Font", "font", { words: ["typeface"] })), ...line("color", "Text color", "color", { words: ["colour"] }), ...rich(line("highlight", "Highlight color", "highlight", { words: ["highlight"] }))],
                            [...line("inline", "Inline code", "code"), ...line("marked", "Marked", "marked"), ...line("spoiler", "Spoiler", "spoiler"), ...line("subtext", "Subtext", "subtext")],
                        ),
                        ...group("Paragraph styles", "styles", [...line("paragraph", "Normal text", "paragraph"), ...line("title", "Title", "title"), ...line("subtitle", "Subtitle", "subtitle"), ...headingLines], line("quote", "Quote", "quote")),
                        ...group(
                            "Align and indent",
                            "left",
                            [
                                ...line("left", "Align left", "left", { pressed: (state.align ?? "left") === "left" }),
                                ...line("center", "Center", "center", { pressed: state.align === "center", words: ["centre"] }),
                                ...line("right", "Align right", "right", { pressed: state.align === "right" }),
                                ...rich(line("justify", "Justify", "justify", { pressed: state.align === "justify" })),
                            ],
                            [...line("indent", "Increase indent", "indent", { words: ["indent more"] }), ...line("outdent", "Decrease indent", "outdent", { words: ["indent less"] })],
                        ),
                        ...rich(line("spacing", "Line and paragraph spacing", "spacing", { words: ["line spacing"] })),
                        ...group("Bullets and numbering", "bullet", [...line("number", "Numbered list", "number"), ...line("bullet", "Bulleted list", "bullet"), ...line("task", "Checklist", "task")], line("lists", "List options", "settings", state.inList ? {} : { disabled: true })),
                    ],
                    line("clear", "Clear formatting", "clear"),
                ),
        },
        {
            label: "Tools",
            items: () =>
                ruled(
                    [...line("check", "Spelling and grammar", "spelling", { words: ["checking"] }), ...line("wordCount", "Word count", "count")],
                    act.tools?.() ?? [],
                    [...line("typing", "Preferences", "typing", { words: ["typing preferences", "typed signs"] }), ...line("forgetUsed", "Forget what I use most", "forget")],
                ),
        },
        {
            label: "Help",
            items: () => ruled([...line("help", "mdQuire help", "help"), ...line("shortcuts", "Keyboard shortcuts", "keyboard")], line("about", "About mdQuire", "info")),
        },
    ];
}
