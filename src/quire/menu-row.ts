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
    /** True when the document has a table of contents, which Insert then offers to make again. */
    contents?: boolean;
}

/** What each command does, given by the editor. A command not given is left out. */
export type RowActions = Partial<Record<Command, () => void>> & { file?: () => MenuItem[] };

/** Every command the row can hold. */
export type Command =
    | "turnRich" | "download" | "downloadQuire" | "print" | "history" | "pageSetup" | "zoom"
    | "undo" | "redo" | "selectAll" | "link" | "find" | "replace"
    | "outline" | "markdown" | "pageView" | "lookNone" | "lookPaper"
    | "table" | "picture" | "divider" | "code" | "footnote" | "bullet" | "number" | "task" | "pageBreak" | "headerFooter"
    | "bold" | "italic" | "underline" | "strike" | "inline" | "paragraph" | "heading1" | "heading2" | "heading3" | "quote"
    | "color" | "size" | "font" | "highlight" | "spacing" | "left" | "center" | "right" | "justify"
    | "check" | "about"
    | "downloadAs" | "notes" | "nextNote" | "previousNote" | "comment" | "date" | "symbols" | "contents" | "updateContents";

/** The menus of the row, for a document as it stands. */
export function headings(state: RowState, act: RowActions): Heading[] {
    const line = (command: Command, label: string, extra: Partial<MenuItem> = {}): MenuItem[] => (act[command] ? [{ label, run: act[command]!, ...extra }] : []);
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
                ...line("print", "Print", { hint: "Ctrl+P" }),
            ],
        },
        {
            label: "Edit",
            items: () => [
                ...line("undo", "Undo", { icon: "undo", hint: "Ctrl+Z" }),
                ...line("redo", "Redo", { icon: "redo", hint: "Ctrl+Shift+Z" }),
                ...line("selectAll", "Select all", { hint: "Ctrl+A" }),
                ...line("find", "Find", { icon: "search", hint: "Ctrl+F" }),
                ...line("replace", "Find and replace", { hint: "Ctrl+H" }),
                ...line("link", "Link", { icon: "link", hint: "Ctrl+K" }),
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
            ],
        },
        {
            label: "Insert",
            items: () => [
                ...line("table", "Table", { icon: "table" }),
                ...line("picture", "Picture", { icon: "image" }),
                ...line("divider", "Horizontal line", { icon: "divider" }),
                ...line("code", "Code block", { icon: "code" }),
                ...line("footnote", "Footnote", { icon: "footnote" }),
                ...line("pageBreak", "Page break", { icon: "pagebreak", hint: "Ctrl+Enter" }),
                ...line("date", "Date"),
                ...line("symbols", "Special characters", { hint: "›" }),
                ...(state.contents ? line("updateContents", "Update the table of contents") : line("contents", "Table of contents")),
                ...line("comment", "Comment", { hint: "Ctrl+Alt+M" }),
                ...(state.rich ? line("headerFooter", "Header, footer and page numbers", { hint: "›" }) : []),
                ...line("bullet", "Bulleted list", { icon: "bullet" }),
                ...line("number", "Numbered list", { icon: "number" }),
                ...line("task", "Checklist", { icon: "task" }),
                ...line("link", "Link", { icon: "link", hint: "Ctrl+K" }),
            ],
        },
        {
            label: "Format",
            items: () => [
                ...line("bold", "Bold", { hint: "Ctrl+B" }),
                ...line("italic", "Italic", { hint: "Ctrl+I" }),
                ...line("underline", "Underline", { hint: "Ctrl+U" }),
                ...line("strike", "Strikethrough", { hint: "Ctrl+Shift+X" }),
                ...line("inline", "Inline code", { icon: "code", hint: "Ctrl+E" }),
                ...line("paragraph", "Paragraph", { hint: "Ctrl+Alt+0" }),
                ...line("heading1", "Heading 1", { hint: "Ctrl+Alt+1" }),
                ...line("heading2", "Heading 2", { hint: "Ctrl+Alt+2" }),
                ...line("heading3", "Heading 3", { hint: "Ctrl+Alt+3" }),
                ...line("quote", "Quote", { icon: "quote" }),
                ...line("color", "Text color", { hint: "›" }),
                ...line("size", "Text size", { hint: "›" }),
                // what a Markdown file cannot keep is not offered for one
                ...(state.rich ? [...line("font", "Typeface", { hint: "›" }), ...line("highlight", "Highlight", { icon: "highlight", hint: "›" }), ...line("spacing", "Line spacing", { icon: "spacing", hint: "›" })] : []),
                ...line("left", "Align left", { icon: "left", pressed: (state.align ?? "left") === "left" }),
                ...line("center", "Centre", { icon: "center", pressed: state.align === "center" }),
                ...line("right", "Align right", { icon: "right", pressed: state.align === "right" }),
                ...(state.rich ? line("justify", "Justify", { icon: "justify", pressed: state.align === "justify" }) : []),
            ],
        },
        {
            label: "Tools",
            items: () => [{ label: `${state.words.toLocaleString("en")} ${state.words === 1 ? "word" : "words"}`, note: true, run: () => {} }, ...line("history", "Version history"), ...line("check", "Checking", { hint: "›" }), ...line("about", "About mdQuire")],
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
