// The words the visitor keeps for dictation: names and terms to prefer, each with the ways the
// recognizer tends to hear them wrong ("sounds like"), and spoken shortcuts ("my email" written
// out as an address). They are applied to every settled phrase as corrections: whole words only,
// whatever the case, and for a sounds-like form a small number of wrong letters is forgiven.
//
// The recognizer also leans toward these words while it decodes (parakeet/boost.ts); this correction
// after the fact catches what it still hears wrong, and does the sounds-like forms. The list is kept in localStorage, wrapped
// in try/catch because it can be missing or refuse.

import { same } from "./merge";

/** A word to prefer, and what the recognizer is likely to write instead. */
export interface Entry {
    word: string;
    sounds: string[];
}

/** A spoken phrase and the text it stands for. */
export interface Shortcut {
    say: string;
    write: string;
}

/** Everything the visitor has added. */
export interface Custom {
    words: Entry[];
    shortcuts: Shortcut[];
}

/** The number of single-letter changes (add, take away, change) that turn one text into the other. */
export function distance(a: string, b: string): number {
    if (a === b) return 0;
    let row = Array.from({ length: b.length + 1 }, (_, index) => index);
    for (let i = 1; i <= a.length; i++) {
        const next = [i];
        for (let j = 1; j <= b.length; j++) next[j] = Math.min(row[j]! + 1, next[j - 1]! + 1, row[j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1));
        row = next;
    }
    return row[b.length]!;
}

/** How many wrong letters a form of this many letters forgives: none in a short word, one in a middling one, two in a long one. */
export const allowed = (letters: number): number => (letters <= 3 ? 0 : letters <= 7 ? 1 : 2);

interface Piece {
    lead: string;
    core: string;
    trail: string;
    gap: string;
}

/** Text into its words, each with the punctuation around it and the space after it, so that it can be put back as it was. */
function pieces(text: string): Piece[] {
    const out: Piece[] = [];
    for (const [, word, gap] of text.matchAll(/(\S+)(\s*)/g)) {
        const found = /^([^\p{L}\p{N}]*)(.*?)([^\p{L}\p{N}]*)$/u.exec(word!)!;
        out.push({ lead: found[1]!, core: found[2]!, trail: found[3]!, gap: gap! });
    }
    return out;
}

const key = (parts: string[]) => parts.map(same).join("");
const wordsOf = (phrase: string) => phrase.split(/\s+/).filter(Boolean);

/** Replaces a run of words with other text, keeping the punctuation before the first and after the last. */
function replaceRun(list: Piece[], at: number, size: number, text: string): Piece[] {
    const first = list[at]!;
    const last = list[at + size - 1]!;
    return [...list.slice(0, at), { lead: first.lead, core: text, trail: last.trail, gap: last.gap }, ...list.slice(at + size)];
}

/** The text with the visitor's shortcuts and preferred words applied. */
export function correct(text: string, custom: Custom): string {
    if (!text || (custom.words.length === 0 && custom.shortcuts.length === 0)) return text;
    let list = pieces(text);
    // pieces that are already final text are not corrected again
    const fixed = new Set<string>();
    const shortcuts = custom.shortcuts.filter((each) => key(wordsOf(each.say)) && each.write).sort((a, b) => wordsOf(b.say).length - wordsOf(a.say).length);
    const forms = custom.words.flatMap((entry) => {
        const own = entry.sounds.length === 0 || !entry.sounds.some((form) => same(form) === same(entry.word));
        return [...entry.sounds.map((form) => ({ entry, form, sounds: true })), ...(own ? [{ entry, form: entry.word, sounds: false }] : [])];
    });

    for (let at = 0; at < list.length; at++) {
        const here = list[at]!;
        if (fixed.has(here.core + "\u0000" + at)) continue;
        let done = false;
        for (const shortcut of shortcuts) {
            const said = wordsOf(shortcut.say);
            const run = list.slice(at, at + said.length);
            if (run.length === said.length && run.slice(0, -1).every((piece) => !piece.trail) && key(run.map((piece) => piece.core)) === key(said)) {
                list = replaceRun(list, at, said.length, shortcut.write);
                fixed.add(shortcut.write + "\u0000" + at);
                done = true;
                break;
            }
        }
        if (done) continue;
        let best: { size: number; word: string; cost: number } | undefined;
        for (const { entry, form, sounds } of forms) {
            const parts = wordsOf(form);
            const size = parts.length;
            const run = list.slice(at, at + size);
            if (run.length !== size || run.slice(0, -1).some((piece) => piece.trail)) continue;
            const heard = key(run.map((piece) => piece.core));
            const wanted = key(parts);
            if (!wanted) continue;
            const limit = sounds ? allowed(wanted.length) : wanted.length >= 6 ? 1 : 0;
            const cost = distance(heard, wanted);
            if (cost > limit) continue;
            if (!best || cost < best.cost || (cost === best.cost && size > best.size)) best = { size, word: entry.word, cost };
        }
        if (best) {
            const unchanged = best.size === 1 && list[at]!.core === best.word;
            if (!unchanged) list = replaceRun(list, at, best.size, best.word);
            fixed.add(best.word + "\u0000" + at);
        }
    }
    return list.map((piece) => piece.lead + piece.core + piece.trail + piece.gap).join("");
}

const STORAGE_KEY = "mdquire-dictation-words";

/** A custom list with nothing in it. */
export const nothing = (): Custom => ({ words: [], shortcuts: [] });

/** Reads what was kept, or an empty list if there is none, it cannot be read, or it is not what was written. */
export function load(storage: Pick<Storage, "getItem"> | undefined = typeof localStorage === "undefined" ? undefined : localStorage): Custom {
    try {
        const parsed = JSON.parse(storage?.getItem(STORAGE_KEY) ?? "null") as Partial<Custom> | null;
        const words = (parsed?.words ?? []).filter((entry) => entry && typeof entry.word === "string" && entry.word.trim()).map((entry) => ({ word: entry.word.trim(), sounds: (Array.isArray(entry.sounds) ? entry.sounds : []).filter((form) => typeof form === "string" && form.trim()).map((form) => form.trim()) }));
        const shortcuts = (parsed?.shortcuts ?? []).filter((each) => each && typeof each.say === "string" && typeof each.write === "string" && each.say.trim() && each.write).map((each) => ({ say: each.say.trim(), write: each.write }));
        return { words, shortcuts };
    } catch {
        return nothing();
    }
}

/** Keeps the list. Gives false if the browser would not. */
export function save(custom: Custom, storage: Pick<Storage, "setItem"> | undefined = typeof localStorage === "undefined" ? undefined : localStorage): boolean {
    try {
        storage?.setItem(STORAGE_KEY, JSON.stringify(custom));
        return !!storage;
    } catch {
        return false;
    }
}
