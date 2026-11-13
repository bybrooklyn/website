// The slash menu: "/" typed on an empty line opens a menu at the cursor of the blocks that can be
// made there. Typing after the slash narrows it; the arrow keys and Enter choose; Escape closes it
// and leaves the slash as typed. Choosing takes the slash and what followed it away and makes the
// block. The menu grows out of the cursor as the bar's menus grow out of their buttons.
//
// The items, how typing narrows them and what choosing does are pure and tested; the rest is DOM.

import { addDivider, addTable, setStyleOf, toggleList, type Action } from "./bar";
import { importFor, TEMPLATES } from "./components";
import { blockAt, changeKind, deleteText, insertBlock, insertText, makeBox, moveBlock, paragraph, removeBlock, runsText, setRaw, textAt, type Details, type Document } from "./document";
import type { State } from "./history";
import { caret, pageBreakAt, sameLeaf } from "./keys";
import type { Surface } from "./surface";
import { flowMenu, make, type MenuItem } from "./ui";

/** One thing the slash menu can make. `image` asks the host for a picture instead of running an action. An item for `mdx` is offered in MDX files alone. */
export interface SlashItem {
    key: string;
    label: string;
    icon: string;
    words: string[];
    action?: Action;
    mdx?: boolean;
}

/** Makes the cursor's block a box: a callout or a folding section, the cursor staying in it. */
const boxOf =
    (box: { callout: string } | { details: Details }): Action =>
    (state) => {
        const path = state.selection.focus.path;
        const doc = makeBox(state.doc, path, box);
        return { doc, selection: caret(sameLeaf(state.doc, path, doc), 0) };
    };

/** Makes the cursor's empty line the term of a new definition list, with a definition under it to write. */
const definitionList: Action = (state) => {
    const path = state.selection.focus.path;
    let doc = changeKind(state.doc, path, { kind: "list", style: "definition" });
    const term = sameLeaf(state.doc, path, doc);
    doc = insertBlock(doc, term, paragraph());
    return { doc, selection: caret(term, 0) };
};

/** Makes the cursor's line a block of maths or a diagram, a diagram with a small flowchart to start from. */
const drawnBlock =
    (language: "math" | "mermaid"): Action =>
    (state) => {
        const path = state.selection.focus.path;
        let doc = changeKind(state.doc, path, { kind: "code", language, dollars: language === "math" });
        const at = sameLeaf(state.doc, path, doc);
        const start = "flowchart TD\n    A[Start] --> B[Next]";
        if (language === "mermaid" && textAt(doc, at) === "") doc = insertText(doc, { path: at, offset: 0 }, start);
        return { doc, selection: caret(at, language === "mermaid" ? start.length : 0) };
    };

/**
 * Puts one of the site's own components where the cursor's empty line is: its tags as cards, with a
 * line to write in where the component holds Markdown, and the import it needs added to the file's
 * imports if it is not there.
 */
export const component =
    (name: string): Action =>
    (state) => {
        const path = state.selection.focus.path;
        let doc = state.doc;
        let at = path;
        let slot: number[] | undefined;
        for (const piece of TEMPLATES[name] ?? []) {
            doc = insertBlock(doc, at, piece === null ? paragraph() : { kind: "raw", text: piece, gap: "" });
            at = [...at.slice(0, -1), at[at.length - 1]! + 1];
            if (piece === null) slot ??= at;
        }
        doc = removeBlock(doc, path);
        const moved = (place: number[]) => [...place.slice(0, -1), place[place.length - 1]! - 1];
        let cursor = slot ? moved(slot) : path;
        for (const needed of name === "Timeline" ? ["Timeline", "Moment"] : [name]) {
            const line = importFor(needed);
            if (doc.blocks.some((block) => block.kind === "raw" && new RegExp(`^import\\s+${needed}\\b`, "m").test(block.text))) continue;
            const last = doc.blocks.map((block, index) => (block.kind === "raw" && /^import\s/.test(block.text) ? index : -1)).filter((index) => index >= 0).pop();
            if (last !== undefined) doc = setRaw(doc, [last], `${(doc.blocks[last] as { text: string }).text}${doc.eol}${line}`);
            else {
                doc = moveBlock(insertBlock(doc, [0], { kind: "raw", text: line, gap: "" }), [1], -1);
                cursor = [cursor[0]! + 1, ...cursor.slice(1)];
            }
        }
        return { doc, selection: caret(cursor, 0) };
    };

/** Everything the slash menu offers, in the order it shows them. */
export const SLASH_ITEMS: SlashItem[] = [
    { key: "heading1", label: "Heading 1", icon: "heading", words: ["h1", "title", "big"], action: setStyleOf("heading1") },
    { key: "heading2", label: "Heading 2", icon: "heading", words: ["h2", "subtitle"], action: setStyleOf("heading2") },
    { key: "heading3", label: "Heading 3", icon: "heading", words: ["h3", "small"], action: setStyleOf("heading3") },
    { key: "bullet", label: "Bulleted list", icon: "bullet", words: ["ul", "unordered", "points"], action: toggleList("bullet") },
    { key: "number", label: "Numbered list", icon: "number", words: ["ol", "ordered"], action: toggleList("number") },
    { key: "task", label: "Checklist", icon: "task", words: ["todo", "task", "checkbox"], action: toggleList("task") },
    { key: "quote", label: "Quote", icon: "quote", words: ["blockquote", "citation"], action: setStyleOf("quote") },
    { key: "code", label: "Code block", icon: "code", words: ["pre", "snippet"], action: setStyleOf("code") },
    { key: "table", label: "Table", icon: "table", words: ["grid", "columns", "rows"], action: addTable },
    { key: "image", label: "Picture", icon: "image", words: ["image", "photo", "img"] },
    { key: "pagebreak", label: "Page break", icon: "pagebreak", words: ["new page", "break"], action: pageBreakAt },
    { key: "divider", label: "Divider", icon: "divider", words: ["rule", "line", "hr", "separator"], action: addDivider },
    { key: "callout", label: "Callout", icon: "quote", words: ["note", "tip", "warning", "important", "caution", "admonition", "alert"], action: boxOf({ callout: "NOTE" }) },
    { key: "details", label: "Folding section", icon: "chevron", words: ["details", "collapse", "collapsible", "toggle", "summary", "hide"], action: boxOf({ details: { summary: "", open: false } }) },
    { key: "definitions", label: "Definition list", icon: "indent", words: ["terms", "glossary", "dl"], action: definitionList },
    { key: "maths", label: "Maths", icon: "plus", words: ["math", "equation", "formula", "latex", "tex"], action: drawnBlock("math") },
    { key: "diagram", label: "Diagram", icon: "row", words: ["mermaid", "flowchart", "chart", "graph"], action: drawnBlock("mermaid") },
    { key: "figure", label: "Figure", icon: "image", words: ["component", "caption", "video"], action: component("Figure"), mdx: true },
    { key: "terminal", label: "Terminal", icon: "code", words: ["component", "cast", "recording"], action: component("Terminal"), mdx: true },
    { key: "timeline", label: "Timeline", icon: "spacing", words: ["component", "moment", "dates"], action: component("Timeline"), mdx: true },
    { key: "playhere", label: "PlayHere", icon: "file", words: ["component", "game", "embed", "play"], action: component("PlayHere"), mdx: true },
];

/** The items whose name or other words start with what was typed after the slash, those whose name starts with it first; the site's components only for an MDX file. */
export function filterSlash(query: string, mdx = true): SlashItem[] {
    const items = SLASH_ITEMS.filter((item) => mdx || !item.mdx);
    const wanted = query.trim().toLowerCase();
    if (!wanted) return items;
    const starts = (word: string) => word.toLowerCase().startsWith(wanted);
    const byName = items.filter((item) => item.label.toLowerCase().split(/\s+/).some(starts) || starts(item.label));
    const byWord = items.filter((item) => !byName.includes(item) && item.words.some(starts));
    return [...byName, ...byWord];
}

/** What was typed after the slash, if the cursor's block is a paragraph that starts with one; undefined when the menu should close. */
export function slashQuery(doc: Document, path: number[], offset: number): string | undefined {
    const block = blockAt(doc, path);
    if (block?.kind !== "paragraph") return undefined;
    const text = runsText(block.runs);
    if (!text.startsWith("/") || offset < 1 || /\s{2}|\n/.test(text)) return undefined;
    return text.slice(1, offset);
}

/** Takes away the slash and what followed it, then makes the item's block there. */
export function chooseSlash(state: State, item: SlashItem): State {
    const path = state.selection.focus.path;
    const block = blockAt(state.doc, path);
    const length = block?.kind === "paragraph" ? runsText(block.runs).length : 0;
    const cleared: State = { doc: deleteText(state.doc, { start: { path, offset: 0 }, end: { path, offset: length } }), selection: caret(path, 0) };
    return item.action ? item.action(cleared) : cleared;
}

/** Builds the slash menu for a surface. `pickImage` asks the host for a picture to put where the slash was. */
export function createSlash(surface: Surface, pickImage: () => void): { close(): void } {
    // the menu grows from where the cursor is: a box the size of the cursor, never seen, is what it grows out of
    const anchor = make("span", "quire-anchor");
    anchor.setAttribute("aria-hidden", "true");
    document.body.append(anchor);
    const menu = flowMenu("Make a block", { className: "quire-slash", onClose: () => (open = false) });
    let open = false;
    let active = 0;
    let shown: SlashItem[] = [];

    const choose = (item: SlashItem) => {
        menu.close(false);
        surface.run((doc, selection) => chooseSlash({ doc, selection }, item));
        if (!item.action) pickImage();
        surface.focus();
    };

    function lines(): MenuItem[] {
        if (shown.length === 0) return [{ label: "Nothing by that name", run: () => menu.close(false) }];
        return shown.map((item) => ({ label: item.label, icon: item.icon, hint: item.key.startsWith("heading") ? `H${item.key.slice(-1)}` : undefined, run: () => choose(item) }));
    }

    function mark() {
        menu.box.querySelectorAll(".quire-menu-line").forEach((line, index) => {
            line.classList.toggle("active", index === active);
            line.setAttribute("aria-selected", String(index === active));
        });
    }

    function render(rect: DOMRect | null) {
        if (rect) {
            anchor.style.left = `${rect.left}px`;
            anchor.style.top = `${rect.top}px`;
            anchor.style.height = `${Math.max(rect.height, 16)}px`;
        }
        menu.open(anchor, lines());
        open = true;
        mark();
    }

    surface.on("slash", ({ rect }) => {
        shown = filterSlash("", surface.getDocument().mdx);
        active = 0;
        render(rect);
    });

    // typing after the slash narrows the menu; leaving the line or the slash closes it
    surface.on("change", ({ doc }) => {
        if (!open) return;
        const { path, offset } = surface.getSelection().focus;
        const query = slashQuery(doc, path, offset);
        if (query === undefined) return menu.close(false);
        shown = filterSlash(query, doc.mdx);
        active = Math.min(active, Math.max(0, shown.length - 1));
        render(null);
    });
    surface.on("select", ({ selection }) => {
        if (open && slashQuery(surface.getDocument(), selection.focus.path, selection.focus.offset) === undefined) menu.close(false);
    });

    // as the page scrolls, the cursor's place moves, and the menu, tied to it, with it
    addEventListener(
        "scroll",
        () => {
            if (!open) return;
            const selection = getSelection();
            const rect = selection?.rangeCount ? selection.getRangeAt(0).getBoundingClientRect() : undefined;
            if (rect && (rect.width || rect.height)) {
                anchor.style.left = `${rect.left}px`;
                anchor.style.top = `${rect.top}px`;
            }
        },
        { passive: true },
    );

    // while it is open its keys come before the editor's
    surface.element.addEventListener(
        "keydown",
        (event) => {
            if (!open || event.isComposing) return;
            if (event.key === "ArrowDown" || event.key === "ArrowUp") {
                if (shown.length) active = (active + (event.key === "ArrowDown" ? 1 : shown.length - 1)) % shown.length;
                mark();
            } else if (event.key === "Enter" || event.key === "Tab") {
                const item = shown[active];
                if (item) choose(item);
                else menu.close(false);
            } else if (event.key === "Escape") menu.close(false);
            else return;
            event.preventDefault();
            event.stopImmediatePropagation();
        },
        true,
    );

    return { close: () => menu.close(false) };
}
