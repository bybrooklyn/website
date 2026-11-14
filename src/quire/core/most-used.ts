// What the writer uses most, counted by key, so that a list (mdQuire's slash menu, the command
// palette) can open on her own few. A kind of document says what it counts and when (mdQuire counts
// what each change made, md/made.ts); what is picked from the palette is counted apart. The counts
// are kept in this browser alone and never sent anywhere.

/** How many times each thing has been made or picked, by its key. */
export type Counts = Record<string, number>;

/** Where this browser keeps the counts of what was made. */
const KEPT = "quire-most-used";

/** Where it keeps the counts of what was picked from the command palette (palette.ts). */
export const PICKED = "quire-most-picked";

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
