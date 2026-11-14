// Where the small strips that float over the writing go: the bar over selected words, a table's strip
// and a picture's. One rule for all of them, so that none covers the words being worked on: a strip
// never covers what it belongs to, nor the line just above it or just below it, unless the window
// leaves no other room. It goes to the nearest place above (or below, when asked or when above has no
// room) that is clear of all of those, passing over the lines in its way; failing that, the nearest
// place clear of what it belongs to alone; failing that, inside the window wherever it fits.
//
// placeClear only counts, and is tested; linesAround reads the lines next to a box from the page.

import type { Box } from "./ui";

/** Where a strip goes: its top left corner in the window, and which side of what it belongs to it took. */
export interface Placed {
    left: number;
    top: number;
    side: "above" | "below";
}

const overlaps = (a: Box, b: Box) => a.left < b.left + b.width && b.left < a.left + a.width && a.top < b.top + b.height && b.top < a.top + a.height;

/**
 * Where a strip of `size` goes near `target`, inside `bounds` (the part of the window it may use, below
 * the editor's own bar), covering neither the target nor any of the `keep` boxes (the lines next to it)
 * while there is room for that, as the comment at the top of the file says. `align` sets it centred on
 * the target or with its right edge on the target's right edge.
 */
export function placeClear(target: Box, size: { width: number; height: number }, bounds: Box, keep: Box[] = [], prefer: "above" | "below" = "above", align: "center" | "end" = "center", gap = 8): Placed {
    const centre = align === "end" ? target.left + target.width - size.width : target.left + target.width / 2 - size.width / 2;
    const left = Math.round(Math.min(Math.max(bounds.left + gap, centre), Math.max(bounds.left + gap, bounds.left + bounds.width - gap - size.width)));
    const fits = (top: number) => top >= bounds.top + gap && top + size.height <= bounds.top + bounds.height - gap;
    /** The nearest place on one side clear of every box in `clear`, moving past each it would cover in turn. */
    const clearOf = (side: "above" | "below", clear: Box[]): number | undefined => {
        let top = side === "above" ? target.top - gap - size.height : target.top + target.height + gap;
        for (let step = 0; step <= clear.length; step++) {
            const strip = { left, top, width: size.width, height: size.height };
            const hit = clear.filter((box) => overlaps(strip, box));
            if (!hit.length) return fits(top) ? top : undefined;
            top = side === "above" ? Math.min(...hit.map((box) => box.top)) - gap - size.height : Math.max(...hit.map((box) => box.top + box.height)) + gap;
        }
        return undefined;
    };
    const other = prefer === "above" ? "below" : "above";
    for (const clear of [[target, ...keep], [target]])
        for (const side of [prefer, other] as const) {
            const top = clearOf(side, clear);
            if (top !== undefined) return { left, top: Math.round(top), side };
        }
    // no room anywhere clear of the target: inside the window, on the side asked for
    const top = prefer === "above" ? bounds.top + gap : bounds.top + bounds.height - gap - size.height;
    return { left, top: Math.round(top), side: prefer };
}

/** How tall a line of an element's text is, in pixels. */
function lineOf(element: Element): number {
    const style = getComputedStyle(element);
    const height = parseFloat(style.lineHeight);
    return Number.isFinite(height) ? height : parseFloat(style.fontSize) * 1.2;
}

/** The element drawn just before (or after) one in the writing, out through the lists and quotes it is in; before the first block, the document's title. */
function neighbour(writing: HTMLElement, element: Element, after: boolean): Element | null {
    let at: Element | null = element;
    while (at && at !== writing && !(after ? at.nextElementSibling : at.previousElementSibling)) at = at.parentElement;
    if (!at || at === writing) return after ? null : writing.previousElementSibling;
    return after ? at.nextElementSibling : at.previousElementSibling;
}

/**
 * The lines of text just above and just below a box in the writing, as wide as the writing. For a
 * block (a table, a picture), the last line of what is drawn before it and the first of what is after
 * it. For selected words, the line over the first and the line under the last: inside their
 * paragraph, or, on its first or last line, the last line of the block before (a heading, or the
 * document's title over the first block) or the first of the block after. `first` and `last` are
 * the elements the words start and end in.
 */
export function linesAround(writing: HTMLElement, box: Box, block?: Element, words?: { first: Element; last: Element }): Box[] {
    const area = writing.getBoundingClientRect();
    const span = (top: number, height: number): Box => ({ left: area.left, top, width: area.width, height });
    // a block of one line (a heading, with the room its own padding gives it) is its line whole
    const lastLineOf = (element: Element | null) => {
        if (!element) return [];
        const { top, bottom } = element.getBoundingClientRect();
        const line = lineOf(element);
        return [bottom - top < line * 2 ? span(top, bottom - top) : span(bottom - line, line)];
    };
    const firstLineOf = (element: Element | null) => {
        if (!element) return [];
        const { top, bottom } = element.getBoundingClientRect();
        const line = lineOf(element);
        return [span(top, bottom - top < line * 2 ? bottom - top : line)];
    };
    if (block) return [...lastLineOf(neighbour(writing, block, false)), ...firstLineOf(neighbour(writing, block, true))];
    const line = lineOf(words?.first ?? writing);
    const lines: Box[] = [];
    // on its block's first line the line above is the block before's; further down, the paragraph's own line above
    if (words && box.top - words.first.getBoundingClientRect().top < line / 2) lines.push(...lastLineOf(neighbour(writing, words.first, false)));
    else lines.push(span(box.top - line, line));
    if (words && words.last.getBoundingClientRect().bottom - (box.top + box.height) < line / 2) lines.push(...firstLineOf(neighbour(writing, words.last, true)));
    else lines.push(span(box.top + box.height, line));
    return lines;
}
