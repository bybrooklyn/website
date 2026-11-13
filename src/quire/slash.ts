// The slash menu: "/" typed on an empty line opens a menu at the cursor of the blocks that can be
// made there. Typing after the slash narrows it; the arrow keys and Enter choose; Escape closes it
// and leaves the slash as typed. Choosing takes the slash and what followed it away and makes the
// block. The menu grows out of the cursor as the bar's menus grow out of their buttons.
//
// The items, how typing narrows them and what choosing does are pure and tested; the rest is DOM.

import { addDivider, addTable, setStyleOf, toggleList, type Action } from "./bar";
import { blockAt, deleteText, runsText, type Document } from "./document";
import type { State } from "./history";
import { caret, pageBreakAt } from "./keys";
import type { Surface } from "./surface";
import { flowMenu, make, type MenuItem } from "./ui";

/** One thing the slash menu can make. `image` asks the host for a picture instead of running an action. */
export interface SlashItem {
    key: string;
    label: string;
    icon: string;
    words: string[];
    action?: Action;
}

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
];

/** The items whose name or other words start with what was typed after the slash, those whose name starts with it first. */
export function filterSlash(query: string): SlashItem[] {
    const wanted = query.trim().toLowerCase();
    if (!wanted) return SLASH_ITEMS;
    const starts = (word: string) => word.toLowerCase().startsWith(wanted);
    const byName = SLASH_ITEMS.filter((item) => item.label.toLowerCase().split(/\s+/).some(starts) || starts(item.label));
    const byWord = SLASH_ITEMS.filter((item) => !byName.includes(item) && item.words.some(starts));
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
        shown = SLASH_ITEMS;
        active = 0;
        render(rect);
    });

    // typing after the slash narrows the menu; leaving the line or the slash closes it
    surface.on("change", ({ doc }) => {
        if (!open) return;
        const { path, offset } = surface.getSelection().focus;
        const query = slashQuery(doc, path, offset);
        if (query === undefined) return menu.close(false);
        shown = filterSlash(query);
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
