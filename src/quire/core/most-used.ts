// What the writer makes most, so that the slash menu can open on her own five. A thing is counted
// however it was made (the slash menu, the bar, a menu, its shortcut, or a Markdown mark typed such
// as `* `): the command palette (palette.ts) compares the document before and after each change
// that makes things and counts what there is more of, and counts apart what is picked from it. The
// counts are kept in this browser alone and never sent anywhere.

import { isPageBreak, type Block, type Document, type Run } from "../md/document";

/** How many times each thing has been made, by its key in the slash menu. */
export type Counts = Record<string, number>;

/** The five the slash menu opens on before anything has been counted, in this order. */
export const FIRST_FIVE = ["heading2", "bullet", "task", "image", "code"];

/** Where this browser keeps the counts of what was made. */
const KEPT = "quire-most-used";

/** Where it keeps the counts of what was picked from the command palette (palette.ts). */
export const PICKED = "quire-most-picked";

const LISTS: Record<string, string> = { bullet: "bullet", number: "number", task: "task", definition: "definitions" };

/** Every thing a document holds that the slash menu makes, by key, with how many of each. */
export function tally(doc: Document): Counts {
    const found: Counts = {};
    const add = (key: string) => (found[key] = (found[key] ?? 0) + 1);
    const runs = (list: Run[]) => list.forEach((run) => run.kind === "image" && add("image"));
    const walk = (block: Block): void => {
        if (block.kind === "heading") add(`heading${block.level}`);
        else if (block.kind === "paragraph") (block.subtext && add("subtext"), runs(block.runs));
        else if (block.kind === "list") block.items.forEach((item) => (add(LISTS[block.style]!), item.blocks.forEach(walk)));
        else if (block.kind === "quote") (add(block.callout ? "callout" : block.details ? "details" : "quote"), block.blocks.forEach(walk));
        else if (block.kind === "code") add(block.language === "math" ? "maths" : block.language === "mermaid" ? "diagram" : "code");
        else if (block.kind === "footnote") block.blocks.forEach(walk);
        else if (block.kind === "raw") {
            const tag = /^<(Figure|Terminal|Timeline|PlayHere)\b/.exec(block.text);
            if (isPageBreak(block)) add("pagebreak");
            else if (tag) add(tag[1]!.toLowerCase());
        } else add(block.kind);
    };
    doc.blocks.forEach(walk);
    return found;
}

/** The things there are more of after a change than before it: what the change made. */
export function made(before: Document, after: Document): string[] {
    const was = tally(before);
    return Object.entries(tally(after)).flatMap(([key, count]) => (count > (was[key] ?? 0) ? [key] : []));
}

/** The counts with one more for each thing made. */
export function counted(counts: Counts, keys: string[]): Counts {
    const next = { ...counts };
    for (const key of keys) next[key] = (next[key] ?? 0) + 1;
    return next;
}

/** Counts read from what was kept, anything that is not a whole count of a known thing (of anything, with nothing known given) left out; rubbish reads as nothing counted. */
export function readCounts(kept: string | null, known?: string[]): Counts {
    let value: unknown;
    try {
        value = JSON.parse(kept ?? "{}");
    } catch {
        return {};
    }
    if (!value || typeof value !== "object" || Array.isArray(value)) return {};
    return Object.fromEntries(Object.entries(value).filter(([key, count]) => (!known || known.includes(key)) && Number.isSafeInteger(count) && count > 0));
}

/** The items, the most made first; those made as often keep the order they came in. */
export function ranked<T extends { key: string }>(items: T[], counts: Counts): T[] {
    return [...items].sort((a, b) => (counts[b.key] ?? 0) - (counts[a.key] ?? 0));
}

/** The items as the slash menu opens on them: the first five ahead of the rest, then the most made first. */
export function opening<T extends { key: string }>(items: T[], counts: Counts): T[] {
    const first = FIRST_FIVE.flatMap((key) => items.filter((item) => item.key === key));
    return ranked([...first, ...items.filter((item) => !first.includes(item))], counts);
}

/** The counts this browser keeps in a place; nothing, where it keeps nothing or cannot be read. */
export function remembered(known?: string[], where = KEPT): Counts {
    try {
        return readCounts(localStorage.getItem(where), known);
    } catch {
        return {};
    }
}

/** Keeps the counts in this browser, or forgets them all, made and picked, when given none. Where the browser will not keep them, they are not kept. */
export function remember(counts?: Counts, where = KEPT) {
    try {
        if (counts) localStorage.setItem(where, JSON.stringify(counts));
        else for (const place of [KEPT, PICKED]) localStorage.removeItem(place);
    } catch {
        // then nothing is learned, and the menu opens on the first five
    }
}
