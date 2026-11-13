// Her writing rules as data: what reads as written by a model (a dash used as punctuation, an emoji,
// the keep-out words, a "not just X" framing) and her own pages, which those rules do not second-
// guess. This is the one place they are written down. The editor's rules (writing.ts) find them in
// a document, and the site's linter (scripts/lint.ts) imports this file to find them in posts,
// pages and code comments, so the two always give the same verdict. It imports nothing, so the
// linter can load it without the editor.

/** A stretch of text, from one offset to another. */
export interface Stretch {
    from: number;
    to: number;
}

/** Her own pages, in her own words, which the word rules do not second-guess. */
export const HERS: readonly string[] = ["src/content/pages/about.mdx"];

/** True for a document that is one of her own pages, by its path in the repository. */
export const isHers = (path: string | undefined) => !!path && HERS.some((page) => path === page || path.endsWith(`/${page}`));

/** The words from the keep-out list: ones she has struck out of text written for her as sounding like a model. */
export const KEEP_OUT = /\b(journey|passion|crafted|delightful|seamless(ly)?|leverag(e|ing)|robust|elevate|effortless(ly)?|game.changer)\b/gi;

/** A framing that builds something up to knock it down: "not just", "more than just". */
export const FRAMING = /\b(not just|not only|isn't just|more than just)\b/gi;

/** An emoji, whole: its picture with any selector, skin tone, tag or joined picture, a flag's two letters, or a keycap. */
export const EMOJI = /(?:(?:\p{Extended_Pictographic}|\p{Regional_Indicator}|[#*0-9]\u{FE0F}?\u{20E3})(?:[\u{FE0E}\u{FE0F}\u{20E3}\u{E0020}-\u{E007F}]|\p{Emoji_Modifier}|\u{200D}\p{Extended_Pictographic})*)+/gu;

/**
 * Dashes used as punctuation in some text, with the spaces round them. In prose a spaced hyphen or a
 * double hyphen standing for a dash counts too; in code (`prose` false) only the dashes themselves
 * do, since a spaced hyphen there is a minus sign. A dash between two digits is a range of numbers,
 * and one at the very start or end of the text is a list's mark or an attribution, not punctuation.
 */
export function dashes(text: string, prose = true): Stretch[] {
    const found: Stretch[] = [];
    for (const match of text.matchAll(prose ? /\s*[—–]\s*|\s+--?\s+/g : /\s*[—–]\s*/g)) {
        const from = match.index;
        const to = from + match[0].length;
        if (/\d/.test(text[from - 1] ?? "") && /\d/.test(text[to] ?? "")) continue;
        if (from === 0 || to === text.length) continue;
        found.push({ from, to });
    }
    return found;
}

/** What each tell is called where the linter reports it. */
export const TELL_NAMES = { dash: "a dash used as punctuation", emoji: "an emoji", "keep-out": "a word from the keep-out list", framing: "a 'not just X' framing" } as const;

/** One of the tells. */
export type Tell = keyof typeof TELL_NAMES;

/** The tells in a stretch of text: in prose all four, in a code comment all but the framing, which is ordinary there. */
export function tellsIn(text: string, prose = true): Tell[] {
    const found: Tell[] = [];
    if (dashes(text, prose).length) found.push("dash");
    if (new RegExp(EMOJI.source, "u").test(text)) found.push("emoji");
    if (new RegExp(KEEP_OUT.source, "i").test(text)) found.push("keep-out");
    if (prose && new RegExp(FRAMING.source, "i").test(text)) found.push("framing");
    return found;
}

/**
 * The tells in a post or page's source, line by line, as the linter reads it: code fences, import
 * lines, lines of HTML or components and table rules are skipped, and inline code and the address
 * of a link are taken out first. Her own pages have none.
 */
export function pageTells(path: string, source: string): { line: number; tell: Tell }[] {
    if (isHers(path)) return [];
    const found: { line: number; tell: Tell }[] = [];
    let fenced = false;
    source.split("\n").forEach((line, index) => {
        if (/^(```|~~~)/.test(line)) fenced = !fenced;
        if (fenced || /^\s*(import |<|\|?\s*-{3})/.test(line)) return;
        for (const tell of tellsIn(line.replace(/`[^`]*`/g, "").replace(/\]\([^)]*\)/g, "]"))) found.push({ line: index + 1, tell });
    });
    return found;
}
