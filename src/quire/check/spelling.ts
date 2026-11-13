// Spelling: each word of the text that the dictionary (dictionary.ts) does not know, with the words
// that may have been meant. What is never checked: code and code blocks, web addresses and emails,
// the frontmatter, words with a digit or a full stop in them, words in a path (beside a slash) or after
// a # or @, words in capitals (an acronym such as GPU) and words
// with a capital inside (TypeScript, iPhone), which are names a dictionary does not hold.
//
// The speller the rule asks is made by createSpeller from the dictionary, the country's spelling,
// the site's own names (names.ts), and two lists: the words she has added to her own dictionary (kept in the browser) and the words
// she has said to ignore in this document.

import { replaceWith, type Rule, type Speller } from "./engine";
import type { Dialect, Dictionary } from "./dictionary";
import { isName } from "./names";

/** Makes the speller the rules ask, from a dictionary and the words she has let through. */
export function createSpeller(dictionary: Dictionary, dialect: Dialect, own: ReadonlySet<string> = new Set(), ignored: ReadonlySet<string> = new Set()): Speller {
    const allowed = (word: string) => isName(word) || own.has(word) || own.has(word.toLowerCase()) || ignored.has(word) || ignored.has(word.toLowerCase());
    // an accent typed as a letter and a combining mark is looked up as the one letter it makes; the document keeps what was typed
    return {
        known: (word) => allowed(word) || allowed(word.normalize("NFC")) || dictionary.known(word, dialect),
        suggest: (word) => dictionary.suggest(word, dialect),
        variant: (word) => dictionary.variant(word),
    };
}

/** True for a word the spelling check leaves alone: a number, an acronym, a name with a capital inside, or a file name or abbreviation with a full stop inside. */
export function unchecked(word: string): boolean {
    if (/\d/.test(word) || word.includes(".")) return true;
    const letters = word.replace(/['’-]/g, "");
    if (letters.length > 1 && letters === letters.toUpperCase()) return true;
    // a capital after the first letter of any part: TypeScript, iPhone, McDonald, but not Well-Known
    return word.split(/[-‐]/).some((part) => /^.+\p{Lu}/u.test(part.replace(/['’]s$/, "")));
}

/** True for a word that is part of a path, a hashtag or a handle: a slash or backslash beside it (src/quire, example.com/foo), or a # or @ before it. */
export function pathlike(text: string, from: number, to: number): boolean {
    return /[/\\#@~]/.test(text[from - 1] ?? "") || /[/\\]/.test(text[to] ?? "");
}

const misspelled: Rule = {
    id: "spelling",
    kind: "spelling",
    severity: "mistake",
    label: "Words not in the dictionary",
    why: "A word the dictionary does not know is often a slip of the fingers.",
    on: true,
    unit(unit, context) {
        const speller = context.speller;
        if (!speller || unit.code) return [];
        return unit.words
            .filter((one) => !unchecked(one.word) && !pathlike(unit.read.text, one.from, one.to) && !speller.known(one.word))
            .map((one) => ({
                from: one.from,
                to: one.to,
                message: `"${one.word}" is not in the dictionary.`,
                word: one.word,
                suggest: () => speller.suggest(one.word).slice(0, 5).map((better) => replaceWith(better, better)),
            }));
    },
};

/** The spelling rules. */
export const SPELLING: Rule[] = [misspelled];
