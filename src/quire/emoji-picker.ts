// The emoji list, as Discord has it in mdQuire's own manner: a colon and two letters typed open a
// small list by the cursor of the emoji whose names (or other words) start with them, narrowing as
// more is typed. Up and Down move, Tab or Enter puts the emoji in place of what was typed; Escape,
// a space, or any character that cannot be in a name closes it and leaves the text exactly as typed,
// so ignoring it changes nothing. It is never offered in code, and a line starting `: ` (a
// definition) is not touched. Typing the closing colon of a known name still turns it into its
// emoji (keys.ts), list or no list. The list grows out of the cursor as the slash menu does.
//
// What is typed and what matches are pure and tested; the rest is DOM.

import { blockAt, deleteText, insertAtom, runsText, sliceRuns, type Document, type Run } from "./document";
import { EMOJI, EMOJI_WORDS } from "./emoji";
import type { State } from "./history";
import { caret } from "./keys";
import type { Surface } from "./surface";
import { flowMenu, make, type MenuItem } from "./ui";

/** What has been typed after a colon just before the cursor, two letters or more of a name; undefined when no list should be open. */
export function emojiQuery(doc: Document, path: number[], offset: number): string | undefined {
    const block = blockAt(doc, path);
    if (block?.kind !== "paragraph" && block?.kind !== "heading") return undefined;
    const before = runsText(block.runs).slice(0, offset);
    // the colon starts a word: at the start, or after a space or an opening sign, never after a letter or digit (10:30, http:)
    const found = /(?:^|[\s([{"'“‘])(:([a-z0-9_+-]{2,}))$/i.exec(before);
    if (!found) return undefined;
    // never in code
    const start = offset - found[1]!.length;
    const piece = sliceRuns(block.runs, start, offset);
    if (piece.some((run) => run.kind === "text" && run.marks.includes("code"))) return undefined;
    return found[2]!.toLowerCase();
}

/** The emoji a query finds, names that start with it first, then names with a part that does, then other words; at most `limit`. */
export function matchEmoji(query: string, limit = 8): { name: string; emoji: string }[] {
    const wanted = query.toLowerCase();
    const names = Object.keys(EMOJI);
    const starts = names.filter((name) => name.startsWith(wanted)).sort((a, b) => a.length - b.length);
    const parts = names.filter((name) => !starts.includes(name) && name.split("_").some((part) => part.startsWith(wanted)));
    const words = names.filter((name) => !starts.includes(name) && !parts.includes(name) && (EMOJI_WORDS[name] ?? []).some((word) => word.startsWith(wanted)));
    return [...starts, ...parts, ...words].slice(0, limit).map((name) => ({ name, emoji: EMOJI[name]! }));
}

/** Takes away the colon and what followed it, and puts the emoji there. */
export function chooseEmoji(state: State, name: string): State {
    const { path, offset } = state.selection.focus;
    const query = emojiQuery(state.doc, path, offset);
    if (query === undefined) return state;
    const start = offset - query.length - 1;
    const doc = insertAtom(deleteText(state.doc, { start: { path, offset: start }, end: { path, offset } }), { path, offset: start }, { kind: "emoji", name } as Run & { kind: "emoji" });
    return { doc, selection: caret(path, start + 1) };
}

/** Builds the emoji list for a surface. */
export function createEmojiPicker(surface: Surface): { close(): void } {
    const anchor = make("span", "quire-anchor");
    anchor.setAttribute("aria-hidden", "true");
    document.body.append(anchor);
    const menu = flowMenu("Emoji", { className: "quire-slash quire-emoji-list", onClose: () => (open = false) });
    let open = false;
    let active = 0;
    let shown: { name: string; emoji: string }[] = [];
    // a list put away with Escape stays away for the rest of that name
    let dismissed = "";
    const startOf = () => {
        const { path, offset } = surface.getSelection().focus;
        const query = emojiQuery(surface.getDocument(), path, offset);
        return query === undefined ? "" : `${path.join(",")}:${offset - query.length}`;
    };

    const choose = (name: string) => {
        menu.close(false);
        surface.run((doc, selection) => chooseEmoji({ doc, selection }, name), "type");
        surface.focus();
    };
    const lines = (): MenuItem[] => shown.map((each) => ({ label: `${each.emoji}  ${each.name.replace(/_/g, " ")}`, hint: `:${each.name}:`, run: () => choose(each.name) }));
    const mark = () =>
        menu.box.querySelectorAll(".quire-menu-line").forEach((line, index) => {
            line.classList.toggle("active", index === active);
            line.setAttribute("aria-selected", String(index === active));
        });
    const look = () => {
        const { path, offset } = surface.getSelection().focus;
        const query = emojiQuery(surface.getDocument(), path, offset);
        shown = query === undefined || startOf() === dismissed ? [] : matchEmoji(query);
        if (shown.length === 0) return menu.close(false);
        active = Math.min(active, shown.length - 1);
        const selection = getSelection();
        const rect = selection?.rangeCount ? selection.getRangeAt(0).getBoundingClientRect() : undefined;
        if (rect && (rect.width || rect.height)) {
            anchor.style.left = `${rect.left}px`;
            anchor.style.top = `${rect.top}px`;
            anchor.style.height = `${Math.max(rect.height, 16)}px`;
        }
        // open, it is filled again in place; closed, it grows out of the cursor
        menu.open(anchor, lines());
        open = true;
        mark();
    };
    // it opens and narrows as a name is typed, and closes as soon as what is before the cursor is no longer one
    surface.on("change", () => {
        if (!open) active = 0;
        look();
    });
    surface.on("select", () => {
        if (!open) return;
        const { path, offset } = surface.getSelection().focus;
        if (emojiQuery(surface.getDocument(), path, offset) === undefined) menu.close(false);
    });
    surface.element.addEventListener(
        "keydown",
        (event) => {
            if (!open || event.isComposing) return;
            if (event.key === "ArrowDown" || event.key === "ArrowUp") {
                active = (active + (event.key === "ArrowDown" ? 1 : shown.length - 1)) % shown.length;
                mark();
            } else if (event.key === "Enter" || event.key === "Tab") {
                const pick = shown[active];
                if (pick) choose(pick.name);
            } else if (event.key === "Escape") {
                dismissed = startOf();
                menu.close(false);
            } else return;
            event.preventDefault();
            event.stopImmediatePropagation();
        },
        true,
    );
    return { close: () => menu.close(false) };
}
