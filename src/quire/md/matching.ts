// Select all occurrences, from Edit: every place the selected words appear (the cursor's word
// when nothing is selected) is selected at once, each drawn as a selection through the browser's
// highlights, as find draws its matches (find.ts finds them). While they are, typing writes in every
// one, Backspace and Delete take from every one, and a Format command (from its menu or its keys)
// goes on every one; each is one step, and a run of typing gathers into one undo as typing does.
// Escape leaves it, the cursor staying on the place it was on; so does any other key, a press in
// the text, or a change made anywhere else.
//
// What happens to the text is pure and tested (writeAt, eraseAt, eachSpot); the rest is DOM.

import { wordAt, type Action } from "./bar";
import { insertText, textAt, type Document } from "./document";
import { findMatches, replaceMatches, type Match } from "./find";
import type { State } from "./history";
import { characterReach } from "./keys";
import type { Surface } from "./surface";

/** The places selected: each is a match, and `fresh` while they still hold the words found, before anything was typed. */
export interface Spots {
    spots: Match[];
    fresh: boolean;
}

/** One change at one place: the text between `from` and `to` becomes `text`, and the place is then from `start` (which the change does not move) to just after the text. */
interface Change {
    from: number;
    to: number;
    text: string;
    start: number;
}

/** Makes a change at every place, the last first so that the earlier stay where they are, and gives where each place is after. */
function changeAll(doc: Document, spots: Match[], change: (spot: Match) => Change): { doc: Document; spots: Match[] } {
    const changes = spots.map(change);
    for (let index = spots.length - 1; index >= 0; index--) {
        const { from, to, text } = changes[index]!;
        const path = spots[index]!.path;
        // typed over words, the new text takes the look of their first letter (replaceMatches); typed after, of the letter before
        if (to > from) doc = replaceMatches(doc, [{ path, from, to }], text);
        else if (text) doc = insertText(doc, { path, offset: from }, text);
    }
    // each change moves the places after it in the same text by what it added or took away
    let moved = 0;
    return {
        doc,
        spots: spots.map((spot, index) => {
            if (index > 0 && spots[index - 1]!.path.join() !== spot.path.join()) moved = 0;
            const { from, to, text, start } = changes[index]!;
            const placed = { path: spot.path, from: start + moved, to: from + text.length + moved };
            moved += text.length - (to - from);
            return placed;
        }),
    };
}

/** Types text at every place: places still holding the words found have them replaced, and places typed in already grow by it. */
export function writeAt(doc: Document, { spots, fresh }: Spots, text: string): { doc: Document; spots: Match[] } {
    return changeAll(doc, spots, (spot) => (fresh ? { from: spot.from, to: spot.to, text, start: spot.from } : { from: spot.to, to: spot.to, text, start: spot.from }));
}

/** Backspace (`back`) or Delete at every place: places still holding the words found lose them; places typed in lose a character at their end (Backspace) or after it (Delete). */
export function eraseAt(doc: Document, { spots, fresh }: Spots, back: boolean): { doc: Document; spots: Match[] } {
    return changeAll(doc, spots, (spot) => {
        if (fresh) return { from: spot.from, to: spot.to, text: "", start: spot.from };
        const text = textAt(doc, spot.path);
        if (!back) return { from: spot.to, to: Math.min(text.length, spot.to + characterReach(text, spot.to, false)), text: "", start: spot.from };
        const from = Math.max(0, spot.to - characterReach(text, spot.to, true));
        return { from, to: spot.to, text: "", start: Math.min(spot.from, from) };
    });
}

/** Runs a Format command on every place that holds text, one after another, as one change. */
export function eachSpot(doc: Document, spots: Match[], action: Action): Document {
    for (const spot of spots) if (spot.to > spot.from) doc = action({ doc, selection: { anchor: { path: spot.path, offset: spot.from }, focus: { path: spot.path, offset: spot.to } } }).doc;
    return doc;
}

/** Where every place the words of a selection on one line appear is, in capitals or not, as Docs finds words; the cursor's word when nothing is selected. */
export function matchingSpots(state: State): Match[] {
    const { anchor, focus } = state.selection;
    if (anchor.path.join() !== focus.path.join()) return [];
    const word = anchor.offset === focus.offset ? wordAt(state.doc, focus) : { start: anchor, end: focus };
    const [from, to] = [word.start.offset, word.end.offset].sort((a, b) => a - b);
    return findMatches(state.doc, textAt(state.doc, focus.path).slice(from, to));
}

/** Builds select all matching for a surface. `command` runs a Format command for a key press and says whether it did. */
export function createMatching(surface: Surface, options: { command: (event: KeyboardEvent) => boolean; told?: (count: number) => void }) {
    let now: Spots | undefined;
    /** The place the real selection is on. */
    let main = 0;
    let busy = false;
    const marks = typeof CSS !== "undefined" && "highlights" in CSS ? (CSS as unknown as { highlights: Map<string, unknown> }).highlights : undefined;
    const Marker = (globalThis as unknown as { Highlight?: new (...ranges: Range[]) => unknown }).Highlight;

    /** Draws every place as selected. */
    function show() {
        if (!now) return marks?.delete("quire-matching");
        if (marks && Marker) marks.set("quire-matching", new Marker(...now.spots.map((each) => surface.rangeOf({ path: each.path, offset: each.from }, { path: each.path, offset: each.to })).filter((range): range is Range => !!range)));
    }

    /** Leaves the places; `end` puts the cursor at the end of the one it was on, as Escape does. */
    function leave(end = false) {
        if (!now) return;
        const spot = now.spots[main]!;
        now = undefined;
        show();
        if (end) surface.setSelection({ anchor: { path: spot.path, offset: spot.to }, focus: { path: spot.path, offset: spot.to } });
    }

    function change(made: { doc: Document; spots: Match[] }) {
        const spot = made.spots[main]!;
        busy = true;
        surface.run(() => ({ doc: made.doc, selection: { anchor: { path: spot.path, offset: spot.from }, focus: { path: spot.path, offset: spot.to } } }), "type");
        busy = false;
        now = { spots: made.spots, fresh: false };
        show();
    }

    const keys = (event: KeyboardEvent) => {
        if (!now) return;
        const plain = !event.ctrlKey && !event.metaKey;
        const take = () => {
            event.preventDefault();
            event.stopImmediatePropagation();
        };
        if (event.key === "Escape") {
            take();
            leave(true);
        } else if (event.isComposing) leave();
        else if (plain && (event.key === "Backspace" || event.key === "Delete")) {
            take();
            change(eraseAt(surface.getDocument(), now, event.key === "Backspace"));
        } else if (plain && [...event.key].length === 1) {
            take();
            change(writeAt(surface.getDocument(), now, event.key));
        } else if (!plain && options.command(event)) take();
        else if (!["Shift", "Control", "Alt", "Meta", "AltGraph", "CapsLock"].includes(event.key)) leave();
    };
    surface.element.addEventListener("keydown", keys, true);
    surface.element.addEventListener("pointerdown", () => leave());
    // a change made anywhere else (undo, dictation, a menu) leaves it
    surface.on("change", () => !busy && leave());

    return {
        /** Selects every place the selected words appear; false when there is nothing to match. */
        start(): boolean {
            const spots = matchingSpots({ doc: surface.getDocument(), selection: surface.getSelection() });
            if (!spots.length) return false;
            const at = surface.getSelection().focus;
            main = Math.max(0, spots.findIndex((spot) => spot.path.join() === at.path.join() && spot.from <= at.offset && spot.to >= at.offset));
            now = { spots, fresh: true };
            // the real selection is on the place the cursor was in, the others drawn as selected
            const spot = spots[main]!;
            surface.setSelection({ anchor: { path: spot.path, offset: spot.from }, focus: { path: spot.path, offset: spot.to } });
            show();
            surface.focus();
            options.told?.(spots.length);
            return true;
        },
        /** Runs a change on every place while they are selected, or as it would run on the selection when they are not. */
        apply(action: Action, state: State): State {
            if (!now) return action(state);
            const doc = eachSpot(state.doc, now.spots, action);
            // a command that changed the text's length (a letter that is longer in capitals) leaves the places where they no longer are
            const same = now.spots.every((spot) => textAt(doc, spot.path).length === textAt(state.doc, spot.path).length);
            busy = true;
            queueMicrotask(() => {
                busy = false;
                if (same) show();
                else leave();
            });
            return { ...state, doc };
        },
        active: () => !!now,
        leave,
    };
}
