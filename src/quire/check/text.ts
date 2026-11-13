// Reading a stretch of text the way the checks need it: its letters, which of them are quiet (code,
// a link's address written out, a picture, inline HTML, a web address or an email), its words and
// its sentences, and how hard it is to read.
//
// Sentences end at a full stop, a question or an exclamation mark, with any closing quote or bracket
// after it, followed by a space and something that can start a sentence. A full stop after a known
// abbreviation (Mr., e.g., etc. inside a sentence), after a single capital (an initial) or between
// digits (3.14) does not end one. Words are found at Unicode's word boundaries (the browser's segmenter,
// or the same rules by hand), joined by hyphens; an emoji and its selectors and skin tones are never a word.

import type { Run } from "../document";

/** A piece of text from one offset to another. */
export interface Span {
    from: number;
    to: number;
}

/** A word and where it is. */
export interface Word extends Span {
    word: string;
}

/** Text read for checking: the letters, and which of them are quiet and never checked. */
export interface Read {
    text: string;
    /** 1 where a letter is code, an atom, a link written as its own address, a web address or an email. */
    quiet: Uint8Array;
}

// an address takes brackets that pair up inside it (Foo_(bar)), as GitHub does, and never the stop or bracket after it
const ADDRESS = /\b(?:https?:\/\/|www\.)(?:[^\s<>()]|\([^\s<>()]*\))*(?:[^\s<>().,;:!?'"’”]|\([^\s<>()]*\))|\b[\w.+-]+@[\w-]+\.[\w.-]+\w/g;

/** Reads runs: their text, quiet where they are code, maths, pictures, HTML or a web address. */
export function readRuns(runs: Run[]): Read {
    let text = "";
    const marks: number[] = [];
    const walk = (list: Run[]) => {
        for (const run of list) {
            if (run.kind === "link") walk(run.runs);
            else if (run.kind === "text") {
                text += run.text;
                // a formula is quiet as code is: its letters are symbols, not words
                const quiet = run.marks.includes("code") || run.marks.includes("math") ? 1 : 0;
                for (let index = 0; index < run.text.length; index++) marks.push(quiet);
            } else {
                text += run.kind === "break" ? "\n" : "￼";
                marks.push(run.kind === "break" ? 0 : 1);
            }
        }
    };
    walk(runs);
    return quieten({ text, quiet: Uint8Array.from(marks) });
}

/** Reads plain text with nothing marked as code. */
export function readText(text: string): Read {
    return quieten({ text, quiet: new Uint8Array(text.length) });
}

function quieten(read: Read): Read {
    for (const match of read.text.matchAll(ADDRESS)) read.quiet.fill(1, match.index, match.index + match[0].length);
    return read;
}

/** Web addresses and emails written in the text, with where they are. */
export function addresses(text: string): Word[] {
    return [...text.matchAll(ADDRESS)].map((match) => ({ from: match.index, to: match.index + match[0].length, word: match[0] }));
}

const LETTER = /[\p{L}\p{M}]/u;

/** The browser's own word boundaries (Unicode's UAX #29), where it has them. */
const SEGMENTER = typeof Intl !== "undefined" && typeof Intl.Segmenter === "function" ? new Intl.Segmenter("en", { granularity: "word" }) : undefined;
/** Letters, marks and digits, with an apostrophe between letters or a full stop or comma between digits kept inside: the same boundaries, by hand. A variation selector or keycap is never part of a word. */
const PIECE = /[\p{L}\p{N}](?:(?![︎️⃣])[\p{L}\p{M}\p{N}])*(?:(?:(?<=\p{L}\p{M}*)['’.](?=\p{L})|(?<=\p{N})[.,](?=\p{N}))[\p{L}\p{N}](?:(?![︎️⃣])[\p{L}\p{M}\p{N}])*)*/gu;
/** What makes a piece part of an emoji: a picture, a skin tone, a flag's letter. */
const PICTURE = /\p{Extended_Pictographic}|\p{Emoji_Modifier}|\p{Regional_Indicator}/u;
/** What turns the letter or digit before it into an emoji: the emoji variation selector, or a keycap. */
const AS_EMOJI = /^[️⃣]/;
/** A selector or keycap the segmenter leaves on the end of a word. */
const SELECTORS = /[︎️⃣]+$/;

/** Spans of the text that are words by Unicode's boundaries: from the segmenter, or by hand where there is none (`byHand`, also for tests). */
export function wordSpans(text: string, byHand = !SEGMENTER): Span[] {
    const pieces: Span[] = [];
    const keep = (from: number, piece: string) => {
        const bare = piece.replace(SELECTORS, "");
        // a letter or digit shown as an emoji (the information sign, a keycap) and anything with a picture in it is not a word
        if (!bare || !/^[\p{L}\p{N}]/u.test(bare) || PICTURE.test(bare) || AS_EMOJI.test(text.slice(from + bare.length, from + bare.length + 1))) return;
        pieces.push({ from, to: from + bare.length });
    };
    if (byHand) for (const match of text.matchAll(PIECE)) keep(match.index, match[0]);
    else
        for (const segment of SEGMENTER!.segment(text)) {
            if (!segment.isWordLike) continue;
            // an underscore or a colon joins words for Unicode (snake_case, mailto:you); here, as by hand, they part them
            let at = segment.index;
            for (const part of segment.segment.split(/[\p{Pc}\u202F:\uFE13\uFE55\uFF1A]/u)) {
                keep(at, part);
                at += part.length + 1;
            }
        }
    // words joined by a hyphen are one word: well-known
    const joined: Span[] = [];
    for (const piece of pieces) {
        const last = joined[joined.length - 1];
        if (last && piece.from === last.to + 1 && /[-‐]/.test(text[last.to]!)) last.to = piece.to;
        else joined.push({ ...piece });
    }
    return joined;
}

/** The words of the text that are not quiet. A word touching a quiet letter is left out whole. */
export function words(read: Read): Word[] {
    const found: Word[] = [];
    for (const { from, to } of wordSpans(read.text)) {
        let quiet = false;
        for (let index = from; index < to && !quiet; index++) if (read.quiet[index]) quiet = true;
        if (quiet || (from > 0 && read.quiet[from - 1] && /\S/.test(read.text[from - 1]!)) || (to < read.text.length && read.quiet[to] && /\S/.test(read.text[to]!))) continue;
        found.push({ from, to, word: read.text.slice(from, to) });
    }
    return found;
}

/** Abbreviations whose full stop does not end a sentence. */
const ABBREVIATIONS = new Set(["mr", "mrs", "ms", "dr", "prof", "sr", "jr", "st", "vs", "etc", "e.g", "i.e", "eg", "ie", "cf", "approx", "no", "vol", "fig", "ca", "inc", "ltd", "co", "jan", "feb", "mar", "apr", "jun", "jul", "aug", "sep", "sept", "oct", "nov", "dec", "mt", "ft", "u.s", "u.k", "p.m", "a.m", "al"]);

/** The sentences of the text, as spans without the space between them. */
export function sentences(read: Read): Span[] {
    const { text } = read;
    const found: Span[] = [];
    let start = -1;
    const close = (end: number) => {
        if (start >= 0) {
            let to = end;
            while (to > start && /\s/.test(text[to - 1]!)) to--;
            if (to > start) found.push({ from: start, to });
        }
        start = -1;
    };
    for (let index = 0; index < text.length; index++) {
        const char = text[index]!;
        if (start < 0) {
            if (/\s/.test(char)) continue;
            start = index;
        }
        // a line break with nothing written after a stop is still inside a paragraph's line; only stops end sentences
        if (!/[.!?…]/.test(char) || read.quiet[index]) continue;
        let end = index + 1;
        while (end < text.length && /[.!?…]/.test(text[end]!)) end++;
        while (end < text.length && /["'”’)\]»*_]/.test(text[end]!)) end++;
        if (end < text.length && !/\s/.test(text[end]!)) {
            index = end - 1;
            continue;
        }
        if (char === ".") {
            const before = /([\p{L}.]+)$/u.exec(text.slice(Math.max(0, index - 12), index))?.[1] ?? "";
            const bare = before.toLowerCase().replace(/^\.+/, "");
            // "etc." can end a sentence as well as sit inside one: a capital after it says which
            const ends = bare === "etc" && /^\s*(\p{Lu}|$)/u.test(text.slice(end));
            if (ABBREVIATIONS.has(bare) && !ends) {
                index = end - 1;
                continue;
            }
            // an initial, as in "J. R. R. Tolkien"
            if (/^\p{Lu}$/u.test(before)) {
                index = end - 1;
                continue;
            }
        }
        // what follows must be able to start a sentence: a capital, a digit, a quote or a bracket, or the end
        const next = /\S/.exec(text.slice(end))?.[0];
        if (next !== undefined && LETTER.test(next) && next === next.toLowerCase() && next !== next.toUpperCase()) {
            index = end - 1;
            continue;
        }
        close(end);
        index = end - 1;
    }
    close(text.length);
    return found;
}

/** How many syllables a word has, by its vowel groups: close enough for a reading score. */
export function syllables(word: string): number {
    let lower = word.toLowerCase().replace(/[^a-z]/g, "");
    if (!lower) return 0;
    if (lower.length <= 3) return 1;
    lower = lower.replace(/(?:[^laeiouy]es|[^laeiouy]ed|[^laeiouy]e)$/, "").replace(/^y/, "");
    const groups = lower.match(/[aeiouy]+/g);
    return Math.max(1, groups?.length ?? 1);
}

/** The Flesch reading ease of so many words, sentences and syllables: 100 is very easy, 30 is hard. */
export function readingEase(wordCount: number, sentenceCount: number, syllableCount: number): number {
    if (!wordCount || !sentenceCount) return 0;
    return 206.835 - 1.015 * (wordCount / sentenceCount) - 84.6 * (syllableCount / wordCount);
}
