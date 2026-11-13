// What Enter does in a field that belongs to the writing: a folding section's summary, a component's
// property, a picture's caption and description, the document's name. It keeps what was typed and
// gives the keyboard back to the writing, at the place the field belongs to, so the next key typed
// goes on with the work. It never leaves the keyboard on the page's body, where keys do nothing.
//
// Where the caret goes is decided by afterField, which is pure and tested; enterGivesBack is the one
// DOM helper the fields outside the text use.

import { blockAt, blockPaths, type Document, type Position } from "./document";

/** The kinds of field drawn inside a block of the text. */
export type FieldKind = "summary" | "prop";

/**
 * Where the caret goes after Enter in a field drawn in the block at `path`: from a folding section's
 * summary, the start of the first line in the section, as Docs moves from a heading into its text;
 * from a component's property, the start of the first line after the component. With no line there,
 * the nearest line before it.
 */
export function afterField(doc: Document, path: number[], kind: FieldKind): Position {
    const paths = blockPaths(doc);
    const inside = (each: number[]) => each.length > path.length && path.every((step, k) => each[k] === step);
    const writable = (each: number[]) => {
        const block = blockAt(doc, each);
        return block !== undefined && ["paragraph", "heading", "code"].includes(block.kind);
    };
    if (kind === "summary") {
        const first = paths.find((each) => inside(each) && writable(each));
        if (first) return { path: first, offset: 0 };
    }
    // the first line past the block, and everything in it
    const past = (each: number[]) => {
        for (let k = 0; k < Math.min(each.length, path.length); k++) if (each[k] !== path[k]) return each[k]! > path[k]!;
        return false;
    };
    const after = paths.find((each) => past(each) && writable(each));
    if (after) return { path: after, offset: 0 };
    const before = [...paths].reverse().find((each) => !past(each) && !inside(each) && writable(each) && each.join() !== path.join());
    return { path: before ?? paths[0] ?? [0], offset: 0 };
}

/**
 * The folding section a change has just made round the caret, still with no summary, whose summary
 * then takes the keyboard first, as the line that names what is folded; undefined if there is none.
 */
export function freshFold(before: Document, after: Document, caret: number[]): number[] | undefined {
    for (let length = caret.length - 1; length >= 1; length--) {
        const path = caret.slice(0, length);
        const block = blockAt(after, path);
        if (block?.kind !== "quote" || !block.details) continue;
        const was = blockAt(before, path);
        return block.details.summary === "" && !(was?.kind === "quote" && was.details) ? path : undefined;
    }
    return undefined;
}

/** Whether a key is the Enter that finishes a field, and not one an input method uses to choose a word. */
export function finishes(event: KeyboardEvent): boolean {
    return event.key === "Enter" && !event.shiftKey && !event.isComposing && event.keyCode !== 229;
}

/**
 * Makes Enter in a field keep what was typed, by `keep` with the value trimmed, and then give the
 * keyboard back by `back`. The field's own change event, when it is left another way, keeps it too,
 * once: a value already kept is not kept again.
 */
export function enterGivesBack(field: HTMLInputElement, keep: (value: string) => void, back: () => void) {
    let kept = field.value.trim();
    const once = () => {
        const value = field.value.trim();
        if (value === kept) return;
        kept = value;
        keep(value);
    };
    field.addEventListener("focus", () => (kept = field.value.trim()));
    field.addEventListener("change", once);
    field.addEventListener("keydown", (event) => {
        if (!finishes(event)) return;
        event.preventDefault();
        event.stopPropagation();
        once();
        back();
    });
}
