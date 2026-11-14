// Capitalisation, from Format: lowercase, UPPERCASE and Title Case for the selected words, or the
// cursor's word when nothing is selected. The characters themselves change, so the Markdown changes
// with them; bold, links and every other look stay on the letters they were on. It goes a whole
// character at a time (an accented letter built of two code points, an emoji of several, is one),
// using the browser's own rules for the language, so that ß becomes SS and é becomes É.
//
//   surface.run((doc, selection) => recase("title")({ doc, selection }))

import { wordAt, type Action } from "./bar";
import { changeText, comparePositions, lengthOf, textAt, type Position } from "./document";
import { collapsed, rangeOf } from "./keys";

/** The three capitalisations, as Docs names them. */
export type Case = "lower" | "upper" | "title";

/** The words Title Case leaves small, unless one is the first or last word. */
const SMALL = new Set(["a", "an", "the", "of", "and", "or", "in", "on", "to", "for"]);

const graphemes = new Intl.Segmenter(undefined, { granularity: "grapheme" });
const words = new Intl.Segmenter(undefined, { granularity: "word" });

/** Where, in a block's text between two offsets, Title Case puts a capital: the first character of each word but the small ones in the middle. */
export function titleStarts(text: string, from: number, to: number): Set<number> {
    const found = [...words.segment(text.slice(from, to))].filter((word) => word.isWordLike);
    const starts = new Set<number>();
    found.forEach((word, index) => {
        if (index === 0 || index === found.length - 1 || !SMALL.has(word.segment.toLocaleLowerCase())) starts.add(from + word.index);
    });
    return starts;
}

/** Text in another case, a whole character at a time. `at` is where it starts in its block, and `starts` where Title Case puts capitals. */
export function recaseText(text: string, how: Case, at = 0, starts: Set<number> = new Set()): string {
    let out = "";
    for (const { segment, index } of graphemes.segment(text)) out += how === "upper" || (how === "title" && starts.has(at + index)) ? segment.toLocaleUpperCase() : segment.toLocaleLowerCase();
    return out;
}

/** Changes the capitals of the selected words, or the cursor's word, as one step. */
export function recase(how: Case): Action {
    return (state) => {
        const range = collapsed(state.selection) ? wordAt(state.doc, state.selection.focus) : rangeOf(state.selection);
        const starts = new Map<string, Set<number>>();
        const doc = changeText(state.doc, range, (text, at, part) => {
            const key = part.path.join();
            if (!starts.has(key)) starts.set(key, titleStarts(textAt(state.doc, part.path), part.from, part.to));
            return recaseText(text, how, at, starts.get(key));
        });
        // a letter can be longer in another case (ß is SS): the later end of the selection moves on by as much
        const { anchor, focus } = state.selection;
        const keep = (position: Position, other: Position): Position => {
            const grown = comparePositions(position, other) >= 0 ? lengthOf(doc, position.path) - lengthOf(state.doc, position.path) : 0;
            return { path: position.path, offset: Math.max(0, Math.min(position.offset + grown, lengthOf(doc, position.path))) };
        };
        return { doc, selection: { anchor: keep(anchor, focus), focus: keep(focus, anchor) } };
    };
}
