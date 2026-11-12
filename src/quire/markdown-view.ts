// The Markdown beside the rich view: the plain text of the document, editable there too, and the
// two kept in step both ways. What is typed in one shows in the other at once, without moving the
// cursor in the one being typed in. Side by side when the screen is wide, one in place of the other
// when it is narrow.
//
// Text typed here is read again as Markdown, so every byte of it is kept; keepSame then hands back
// the blocks that did not change as the very blocks the surface already drew, so that only the
// changed ones are drawn again. keepSame is pure and tested; the rest is DOM.

import type { Document } from "./document";
import { read } from "./read";
import type { Surface } from "./surface";
import { make } from "./ui";
import { write } from "./write";

/** A newly read document, with each block that is the same as before (same source and gap) replaced by the old block itself. */
export function keepSame(old: Document, next: Document): Document {
    const before = old.blocks;
    const after = next.blocks;
    const same = (a: (typeof before)[number], b: (typeof after)[number]) => a.source !== undefined && a.source === b.source && a.gap === b.gap && a.kind === b.kind;
    let start = 0;
    while (start < before.length && start < after.length && same(before[start]!, after[start]!)) start++;
    let end = 0;
    while (end < before.length - start && end < after.length - start && same(before[before.length - 1 - end]!, after[after.length - 1 - end]!)) end++;
    if (start === before.length && start === after.length && old.frontmatter === next.frontmatter && old.lead === next.lead && old.bom === next.bom) return old;
    return { ...next, blocks: [...before.slice(0, start), ...after.slice(start, after.length - end), ...before.slice(before.length - end)] };
}

/** Builds the Markdown view for a surface. */
export function createMarkdownView(surface: Surface): { element: HTMLTextAreaElement; refresh(): void } {
    const field = make("textarea", "quire-source");
    field.spellcheck = false;
    field.setAttribute("aria-label", "The document as Markdown");
    field.value = write(surface.getDocument());

    // the rich view changed: the text follows, unless it is the text being typed in
    const refresh = () => {
        if (document.activeElement === field) return;
        const text = write(surface.getDocument());
        if (field.value !== text) field.value = text;
    };
    surface.on("change", refresh);

    // the text changed: it is read again, and the rich view follows
    let waiting = false;
    field.addEventListener("input", () => {
        if (waiting) return;
        waiting = true;
        requestAnimationFrame(() => {
            waiting = false;
            const current = surface.getDocument();
            const next = keepSame(current, read(field.value, { mdx: current.mdx }));
            if (next !== current) surface.run(() => next, "type");
        });
    });
    field.addEventListener("blur", refresh);
    return { element: field, refresh };
}
