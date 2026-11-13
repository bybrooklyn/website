// The menu row: File, Edit, View, Insert, Format and Tools, above the bar in the site's top row.
// Every command mdQuire has is in it by name, with its shortcut beside it, so nothing has to be
// known by its keys or its Markdown to be found. Its menus are the editor's own (flowMenu in
// ui.ts): one box that flows open from the word pressed and, while open, slides along to the next
// word as the pointer moves over the row. The side arrows go from menu to menu, a letter goes to
// the line that starts with it, and Escape closes. On a narrow window the row folds into the
// three-dot menu, each word a line there that opens its menu.
//
// What is in each menu is built by `headings`, which is pure: the editor gives it how things
// stand and what each command does.

import type { Align } from "./document";
import { keysFor } from "./shortcuts";
import { flowMenu, make, moveIndex, type MenuItem } from "./ui";

/** A word of the row, and the lines of its menu. */
export interface Heading {
    label: string;
    items: () => MenuItem[];
}

/** How things stand, as far as the menus show it. */
export interface RowState {
    /** True for a `.quire` document, which can have what a Markdown file cannot keep. */
    rich: boolean;
    /** True in page view: the paper set up, as real pages. */
    paged?: boolean;
    /** The look of the writing: no page, or light paper. */
    look?: "none" | "paper";
    outline: boolean;
    markdown: boolean;
    words: number;
    /** How the cursor's block sits across the page, shown as pressed in Format. */
    align?: Align;
    /** Whether typed arrows and signs become their characters, shown as pressed in Tools. */
    symbols?: boolean;
    /** True when the document has a table of contents, which Insert then offers to make again. */
    contents?: boolean;
}

/** What each command does, given by the editor. A command not given is left out. */
export type RowActions = Partial<Record<Command, () => void>> & { file?: () => MenuItem[]; tools?: () => MenuItem[] };

/** Every command the row can hold. */
export type Command =
    | "turnRich" | "download" | "downloadQuire" | "print" | "history" | "pageSetup" | "zoom"
    | "undo" | "redo" | "selectAll" | "link" | "find" | "replace" | "pastePlain"
    | "outline" | "markdown" | "pageView" | "lookNone" | "lookPaper" | "zoomIn" | "zoomOut" | "zoomReset"
    | "table" | "picture" | "divider" | "code" | "footnote" | "bullet" | "number" | "task" | "pageBreak" | "headerFooter"
    | "callout" | "details" | "definitions" | "maths" | "diagram"
    | "bold" | "italic" | "underline" | "strike" | "inline" | "paragraph" | "heading1" | "heading2" | "heading3" | "heading4" | "heading5" | "heading6" | "quote" | "subtext" | "spoiler"
    | "color" | "size" | "font" | "highlight" | "spacing" | "left" | "center" | "right" | "justify" | "indent" | "outdent" | "bigger" | "smaller" | "clear"
    | "check" | "about" | "wordCount" | "shortcuts" | "searchMenus" | "forgetUsed"
    | "superscript" | "subscript" | "marked" | "typedSigns"
    | "downloadAs" | "notes" | "nextNote" | "previousNote" | "comment" | "date" | "symbols" | "contents" | "updateContents"
    | "capitals" | "lists" | "title" | "subtitle" | "selectMatching" | "bookmark";

/** The menus of the row, for a document as it stands. A line's shortcut, if it has one, comes from the table in shortcuts.ts. */
export function headings(state: RowState, act: RowActions): Heading[] {
    const line = (command: Command, label: string, extra: Partial<MenuItem> = {}): MenuItem[] => {
        if (!act[command]) return [];
        const keys = keysFor(command);
        return [{ label, run: act[command]!, ...(keys && !extra.hint ? { hint: keys } : {}), ...extra }];
    };
    return [
        {
            label: "File",
            items: () => [
                ...(act.file?.() ?? []),
                ...(state.rich ? [] : line("turnRich", "Turn into a .quire document", { icon: "file" })),
                ...(state.rich ? line("downloadQuire", "Download", { hint: ".quire" }) : []),
                ...line("download", state.rich ? "Download as Markdown" : "Download", { hint: ".md" }),
                ...line("downloadAs", "Download as", { hint: "›" }),
                ...line("history", "Version history"),
                ...(state.rich ? line("pageSetup", "Page setup", { hint: "›" }) : []),
                ...line("print", "Print"),
            ],
        },
        {
            label: "Edit",
            items: () => [
                ...line("undo", "Undo", { icon: "undo" }),
                ...line("redo", "Redo", { icon: "redo" }),
                ...line("selectAll", "Select all"),
                ...line("selectMatching", "Select all matching text"),
                ...line("pastePlain", "Paste without formatting"),
                ...line("find", "Find", { icon: "search" }),
                ...line("replace", "Find and replace"),
                ...line("link", "Link", { icon: "link" }),
            ],
        },
        {
            label: "View",
            items: () => [
                ...line("outline", "Outline", { icon: "outline", pressed: state.outline }),
                ...line("markdown", "The Markdown beside the page", { pressed: state.markdown }),
                ...line("notes", "Notes", { hint: "›" }),
                ...line("nextNote", "Next note"),
                ...line("previousNote", "Previous note"),
                // the two looks are a choice: the menu stays open while the page eases from one to the other
                ...line("lookNone", "No page", { pressed: (state.look ?? "none") === "none", group: "look" }),
                ...line("lookPaper", "Light paper", { pressed: state.look === "paper", group: "look" }),
                ...line("pageView", "Page view", { pressed: !!state.paged }),
                ...line("zoom", "Zoom", { hint: "›" }),
                ...line("zoomIn", "Zoom in"),
                ...line("zoomOut", "Zoom out"),
                ...line("zoomReset", "Zoom back to the usual"),
            ],
        },
        {
            label: "Insert",
            items: () => [
                ...line("table", "Table", { icon: "table" }),
                ...line("picture", "Picture", { icon: "image" }),
                ...line("divider", "Horizontal line", { icon: "divider" }),
                ...line("code", "Code block", { icon: "code" }),
                ...line("callout", "Callout", { icon: "quote" }),
                ...line("details", "Folding section", { icon: "chevron" }),
                ...line("definitions", "Definition list", { icon: "indent" }),
                ...line("maths", "Maths"),
                ...line("diagram", "Diagram"),
                ...line("footnote", "Footnote", { icon: "footnote" }),
                ...line("pageBreak", "Page break", { icon: "pagebreak" }),
                ...line("date", "Date"),
                ...line("symbols", "Special characters", { hint: "›" }),
                ...(state.contents ? line("updateContents", "Update the table of contents") : line("contents", "Table of contents")),
                ...line("comment", "Comment"),
                ...(state.rich ? line("headerFooter", "Header, footer and page numbers", { hint: "›" }) : []),
                ...line("bullet", "Bulleted list", { icon: "bullet" }),
                ...line("number", "Numbered list", { icon: "number" }),
                ...line("task", "Checklist", { icon: "task" }),
                ...line("link", "Link", { icon: "link" }),
                ...line("bookmark", "Bookmark"),
            ],
        },
        {
            label: "Format",
            items: () => [
                ...line("bold", "Bold"),
                ...line("italic", "Italic"),
                ...line("underline", "Underline"),
                ...line("strike", "Strikethrough"),
                ...line("inline", "Inline code", { icon: "code" }),
                ...line("marked", "Marked"),
                ...line("spoiler", "Spoiler"),
                ...line("superscript", "Superscript"),
                ...line("subscript", "Subscript"),
                ...line("capitals", "Capitalisation", { hint: "›" }),
                ...line("paragraph", "Normal text"),
                ...line("title", "Title"),
                ...(state.rich ? line("subtitle", "Subtitle") : []),
                ...line("heading1", "Heading 1"),
                ...line("heading2", "Heading 2"),
                ...line("heading3", "Heading 3"),
                ...line("heading4", "Heading 4"),
                ...line("heading5", "Heading 5"),
                ...line("heading6", "Heading 6"),
                ...line("subtext", "Subtext"),
                ...line("quote", "Quote", { icon: "quote" }),
                ...line("color", "Text color", { hint: "›" }),
                ...line("size", "Text size", { hint: "›" }),
                ...line("bigger", "Larger text"),
                ...line("smaller", "Smaller text"),
                // what a Markdown file cannot keep is not offered for one
                ...(state.rich ? [...line("font", "Typeface", { hint: "›" }), ...line("highlight", "Highlight", { icon: "highlight", hint: "›" }), ...line("spacing", "Line spacing", { icon: "spacing", hint: "›" })] : []),
                ...line("left", "Align left", { icon: "left", pressed: (state.align ?? "left") === "left" }),
                ...line("center", "Centre", { icon: "center", pressed: state.align === "center" }),
                ...line("right", "Align right", { icon: "right", pressed: state.align === "right" }),
                ...(state.rich ? line("justify", "Justify", { icon: "justify", pressed: state.align === "justify" }) : []),
                ...line("indent", "Indent more", { icon: "indent" }),
                ...line("outdent", "Indent less", { icon: "outdent" }),
                ...line("lists", "Bullets and numbering", { icon: "bullet", hint: "›" }),
                ...line("clear", "Clear formatting", { icon: "clear" }),
            ],
        },
        {
            label: "Tools",
            items: () => [
                { label: `${state.words.toLocaleString("en")} ${state.words === 1 ? "word" : "words"}`, note: true, run: () => {} },
                ...line("wordCount", "Word count"),
                ...line("history", "Version history"),
                ...line("check", "Checking", { hint: "›" }),
                ...line("typedSigns", "Typed signs, -> to →", { pressed: state.symbols !== false }),
                ...line("searchMenus", "Search the menus", { icon: "search" }),
                ...line("shortcuts", "Keyboard shortcuts"),
                ...line("forgetUsed", "Forget what I use most"),
                ...(act.tools?.() ?? []),
                ...line("about", "About mdQuire"),
            ],
        },
    ];
}

/** Builds the row over the menus `headings` gives each time one is opened. */
export function createMenuRow(menus: () => Heading[]) {
    const row = make("div", "quire-menu-row");
    row.setAttribute("role", "menubar");
    row.setAttribute("aria-label", "Menus");
    let current = -1;
    const menu = flowMenu("Menu", {
        className: "quire-row-menu",
        onSide: (by) => open((current + by + words.length) % words.length, true),
        onClose: () => {
            current = -1;
            menu.box.classList.remove("sliding");
        },
    });
    const words = ["File", "Edit", "View", "Insert", "Format", "Tools"].map((label, index) => {
        const word = make("button", "quire-row-word", label);
        word.type = "button";
        word.setAttribute("role", "menuitem");
        word.setAttribute("aria-haspopup", "menu");
        word.tabIndex = index === 0 ? 0 : -1;
        // pressing a word must leave the selection in the text it will act on
        word.addEventListener("mousedown", (event) => event.preventDefault());
        word.addEventListener("click", () => (current === index && menu.isOpen() ? menu.close(true) : open(index, document.activeElement === word)));
        // while a menu is open, the pointer moving along the row takes it to the word it is over
        word.addEventListener("pointerenter", () => {
            if (menu.isOpen() && current !== index && current >= 0) open(index, false);
        });
        row.append(word);
        return word;
    });
    row.addEventListener("keydown", (event) => {
        const at = words.indexOf(document.activeElement as HTMLButtonElement);
        if (at < 0) return;
        if (event.key === "ArrowDown" || event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            open(at, true);
            return;
        }
        const next = moveIndex(at, event.key, words.length);
        if (next === undefined) return;
        event.preventDefault();
        for (const word of words) word.tabIndex = word === words[next] ? 0 : -1;
        words[next]!.focus();
    });

    /** Opens a word's menu; from an open one, the box slides over to it. */
    function open(index: number, focus: boolean) {
        const heading = menus()[index];
        if (!heading) return;
        menu.box.classList.toggle("sliding", menu.isOpen());
        current = index;
        for (const word of words) word.tabIndex = word === words[index] ? 0 : -1;
        if (focus) words[index]!.focus({ preventScroll: true });
        menu.open(words[index]!, heading.items(), focus);
    }

    return {
        element: row,
        menu,
        /** The menus as they stand now, for the search of them. */
        headings: menus,
        words,
        open,
        /** Opens a word's menu from somewhere else, as the three-dot menu does when the row has folded into it. */
        openFrom(trigger: HTMLElement, index: number) {
            const heading = menus()[index];
            if (!heading) return;
            current = -1;
            menu.box.classList.remove("sliding");
            menu.open(trigger, heading.items(), true);
        },
    };
}
