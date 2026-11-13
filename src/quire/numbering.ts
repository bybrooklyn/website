// Bullets and numbering, from Format: which sign a bulleted list is written with, numbering a list
// afresh from a number, and carrying on the list before. Markdown has three bullets, `-`, `*` and
// `+`, and reads them all as the same bullet, so the choice is only of the character saved: the list
// is drawn the same whichever it is, as the site draws it. A numbered list keeps the number it
// starts from; one restarted part way down is cut in two there, and the writer keeps the two apart
// in the Markdown by giving the second the other delimiter, `1)` after `1.` (write.ts).

import type { Action } from "./bar";
import { blockAt, joinLists, listAt, restartList, setListMarker, setListStart, type Document, type List, type Position } from "./document";
import type { State } from "./history";
import { sameLeaf, tableOf } from "./keys";

/** The list the cursor is in, and which of its items, or undefined outside a list. A definition list has no bullets or numbers. */
export function listHere(doc: Document, path: number[]): { path: number[]; list: List; item: number } | undefined {
    const found = listAt(doc, path);
    const list = found && blockAt(doc, found.list);
    return found && list?.kind === "list" && list.style !== "definition" ? { path: found.list, list, item: found.item } : undefined;
}

/** The state after a change that cut or joined lists: the selection on the same text, which has kept its place in reading order. */
function followed(state: State, doc: Document): State {
    const follow = (position: Position): Position => {
        const table = tableOf(state.doc, position.path);
        return { ...position, path: table ? [...sameLeaf(state.doc, table, doc), ...position.path.slice(table.length)] : sameLeaf(state.doc, position.path, doc) };
    };
    return { doc, selection: { anchor: follow(state.selection.anchor), focus: follow(state.selection.focus) } };
}

/** Writes the cursor's bulleted list with another sign. */
export function markWith(marker: List["marker"]): Action {
    return (state) => {
        const here = listHere(state.doc, state.selection.focus.path);
        return here && here.list.style !== "number" ? { ...state, doc: setListMarker(state.doc, here.path, marker) } : state;
    };
}

/** Numbers the cursor's list afresh from its item, starting at `start`. */
export function restartAt(start: number): Action {
    return (state) => {
        const here = listHere(state.doc, state.selection.focus.path);
        if (!here || here.list.style !== "number" || !Number.isInteger(start) || start < 0 || start > 999999999) return state;
        return followed(state, restartList(state.doc, here.path, here.item, start));
    };
}

/** Carries on the list before the cursor's: right before it, the two become one; further back, a numbered list starts where that one stopped. */
export function continuePrevious(state: State): State {
    const here = listHere(state.doc, state.selection.focus.path);
    if (!here) return state;
    const index = here.path[here.path.length - 1]!;
    const sibling = (at: number) => blockAt(state.doc, [...here.path.slice(0, -1), at]);
    const numbered = here.list.style === "number";
    const next = sibling(index - 1);
    if (next?.kind === "list" && next.style !== "definition" && (next.style === "number") === numbered) return followed(state, joinLists(state.doc, here.path));
    if (!numbered) return state;
    for (let at = index - 1; at >= 0; at--) {
        const before = sibling(at);
        if (before?.kind === "list" && before.style === "number") return { ...state, doc: setListStart(state.doc, here.path, before.start + before.items.length) };
    }
    return state;
}
