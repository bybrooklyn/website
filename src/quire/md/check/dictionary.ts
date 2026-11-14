// The English dictionary the spelling check asks, written for mdQuire from scratch. It reads the
// file scripts/dictionary.ts makes from SCOWL (public/quire/words-en.dat: gzip of sorted lines, each a
// letter for the word's size and country, a letter for how much it shares with the word before, and
// the rest) into one long string of every word with an index of where each starts, so that 126,000
// words take about two megabytes and "is this a word" is a binary search of a few microseconds.
//
//   const words = await loadDictionary(url)    fetched and unpacked when spelling is first switched on
//   words.known("Colour", "gb")                 true: capitals, possessives and country taken into account
//   words.suggest("recieve", "us")              ["receive", ...], best first
//   words.variant("colour")                     "color": the other country's spelling, if it has one
//
// Suggestions are every word within two edits (a letter added, taken out, changed, or two swapped),
// each edit weighed by how likely it is as a slip: a key beside the one meant, a vowel for a vowel, a
// letter doubled or not, s for c, two letters swapped. They are ranked by that weight and then by how
// common the word is (its SCOWL size). Two words run together ("alot") are offered apart when both are
// among the commonest words. A word in withheld.ts (slurs, explicit words) is never offered.

import { withheld } from "./withheld";

/** A country's spelling: American or British. */
export type Dialect = "us" | "gb";

/** The dictionary, unpacked. */
export interface Dictionary {
    /** How many words it has. */
    size: number;
    /** True if the word is spelled right in this country's spelling. */
    known(word: string, dialect: Dialect): boolean;
    /** Words that may have been meant, best first, in the capitals the word was written in. */
    suggest(word: string, dialect: Dialect, count?: number): string[];
    /** The other country's spelling of a word ("colour" for "color", "organise" for "organize"), if it has one. */
    variant(word: string): string | undefined;
    /** How common a word is, 0 for the commonest, 6 for the rarest; undefined if it is not a word. */
    rank(word: string): number | undefined;
}

/** Unpacks the dictionary from the bytes of its file. */
export async function unpackDictionary(bytes: ArrayBuffer | Uint8Array): Promise<Dictionary> {
    const stream = new Blob([bytes as BlobPart]).stream().pipeThrough(new DecompressionStream("gzip"));
    return readDictionary(await new Response(stream).text());
}

/** Fetches the dictionary and unpacks it. */
export async function loadDictionary(url: string): Promise<Dictionary> {
    const answer = await fetch(url);
    if (!answer.ok) throw new Error(`The dictionary did not load (${answer.status}).`);
    return unpackDictionary(await answer.arrayBuffer());
}

// ---- keyboard and letters ----

const ROWS = ["qwertyuiop", "asdfghjkl", "zxcvbnm"];
/** For each letter, the letters beside it on a keyboard. */
const NEIGHBOURS = new Map<number, Set<number>>();
ROWS.forEach((row, r) => {
    for (let c = 0; c < row.length; c++) {
        const near = new Set<number>();
        for (const [dr, dc] of [[0, -1], [0, 1], [-1, 0], [-1, 1], [1, 0], [1, -1]] as const) {
            const other = ROWS[r + dr]?.[c + dc];
            if (other) near.add(other.charCodeAt(0));
        }
        NEIGHBOURS.set(row.charCodeAt(c), near);
    }
});
const VOWELS = new Set([..."aeiouy"].map((letter) => letter.charCodeAt(0)));
/** Letters often written for each other because they sound alike. */
const SOUNDS = new Set(["cs", "sc", "ck", "kc", "sz", "zs", "gj", "jg", "fv", "vf", "td", "dt", "mn", "nm"]);

/** What it costs to write one letter for another, worked out once for the small letters a to z. */
const COSTS = new Float64Array(26 * 26);
for (let a = 97; a <= 122; a++)
    for (let b = 97; b <= 122; b++)
        COSTS[(a - 97) * 26 + b - 97] = a === b ? 0 : (VOWELS.has(a) && VOWELS.has(b)) || NEIGHBOURS.get(a)?.has(b) ? 0.6 : SOUNDS.has(String.fromCharCode(a, b)) ? 0.7 : 1;

/** What it costs to write one letter for another. */
function swapCost(a: number, b: number): number {
    if (a === b) return 0;
    return a >= 97 && a <= 122 && b >= 97 && b <= 122 ? COSTS[(a - 97) * 26 + b - 97]! : 1;
}

const lower = (code: number) => (code >= 65 && code <= 90 ? code + 32 : code);

/** Reads the dictionary from its unpacked text. */
export function readDictionary(text: string): Dictionary {
    const lines = text.split("\n");
    const list: string[] = [];
    const info: number[] = [];
    let last = "";
    for (const line of lines) {
        if (line.length < 2) continue;
        const word = last.slice(0, line.charCodeAt(1) - 48) + line.slice(2);
        list.push(word);
        info.push(line.charCodeAt(0) - 65);
        last = word;
    }
    // one string holds every word with a line break after each; `starts` is where each begins
    const all = `${list.join("\n")}\n`;
    const starts = new Uint32Array(list.length + 1);
    let at = 0;
    for (let index = 0; index < list.length; index++) {
        starts[index] = at;
        at += list[index]!.length + 1;
    }
    starts[list.length] = at;
    const sizes = Uint8Array.from(info);
    const count = list.length;
    list.length = 0;

    /** Where a word is in the list, or -1. */
    const find = (word: string): number => {
        let low = 0;
        let high = count - 1;
        while (low <= high) {
            const middle = (low + high) >> 1;
            const start = starts[middle]!;
            const length = starts[middle + 1]! - 1 - start;
            let order = 0;
            for (let index = 0; index < Math.min(length, word.length) && !order; index++) order = all.charCodeAt(start + index) - word.charCodeAt(index);
            if (!order) order = length - word.length;
            if (order === 0) return middle;
            if (order < 0) low = middle + 1;
            else high = middle - 1;
        }
        return -1;
    };
    const fits = (index: number, dialect: Dialect) => {
        const country = sizes[index]! % 3;
        return country === 0 || country === (dialect === "us" ? 1 : 2);
    };
    const has = (word: string, dialect: Dialect) => {
        const index = find(word);
        return index >= 0 && fits(index, dialect);
    };

    /** True if the word, as written, is in the list in one of the capitals it may take. */
    const listed = (word: string, dialect: Dialect): boolean => {
        if (has(word, dialect)) return true;
        const small = word.toLowerCase();
        const first = word[0]!;
        if (first !== first.toLowerCase()) {
            // "Then" at the start of a sentence, "THEN" in capitals
            const rest = word.slice(1);
            if (rest === rest.toLowerCase() && has(small, dialect)) return true;
            if (word.length > 1 && word === word.toUpperCase()) return has(small, dialect) || has(first + small.slice(1), dialect);
        }
        return false;
    };

    const known = (raw: string, dialect: Dialect): boolean => {
        // a letter and a combining accent are looked up as the one letter they make
        const word = raw.normalize("NFC").replace(/’/g, "'");
        if (!word || /\d/.test(word)) return true;
        if (listed(word, dialect)) return true;
        // possessives: "dog's", "dogs'", "James's"
        const possessive = /^(.+?)('s|')$/i.exec(word);
        if (possessive && listed(possessive[1]!, dialect)) return true;
        // words joined by hyphens are each looked up
        if (word.includes("-")) return word.split("-").every((part) => !part || known(part, dialect));
        return false;
    };

    /** The weighed distance of `target` from the list's word at `index`, or Infinity if more than `most`. Swaps of two letters count as one edit. */
    const row0 = new Float64Array(64);
    const row1 = new Float64Array(64);
    const row2 = new Float64Array(64);
    const distance = (target: number[], adds: Float64Array, index: number, most: number): number => {
        const start = starts[index]!;
        const length = starts[index + 1]! - 1 - start;
        const n = target.length;
        if (Math.abs(length - n) > 2 || length > 60 || n > 60) return Infinity;
        let before = row0;
        let previous = row1;
        let current = row2;
        for (let j = 0; j <= n; j++) previous[j] = j;
        let last = 0;
        let earlier = 0;
        let a = lower(all.charCodeAt(start));
        for (let i = 1; i <= length; i++) {
            const next = lower(all.charCodeAt(start + i));
            // a letter dropped costs less when it doubles the one beside it
            const drop = a === earlier || a === next ? 0.5 : 1;
            current[0] = i;
            let low = i;
            for (let j = 1; j <= n; j++) {
                const b = target[j - 1]!;
                let best = previous[j]! + drop;
                const added = current[j - 1]! + adds[j]!;
                if (added < best) best = added;
                const changed = previous[j - 1]! + (a === b ? 0 : swapCost(a, b));
                if (changed < best) best = changed;
                if (j > 1 && a === target[j - 2] && earlier === b && before[j - 2]! + 0.6 < best) best = before[j - 2]! + 0.6;
                current[j] = best;
                if (best < low) low = best;
            }
            if (low > most) return Infinity;
            const spare = before;
            before = previous;
            previous = current;
            current = spare;
            last = previous[n]!;
            earlier = a;
            a = next;
        }
        return length === 0 ? n : last;
    };

    const shaped = (word: string, like: string) => {
        if (like.length > 1 && like === like.toUpperCase()) return word.toUpperCase();
        if (like[0] !== like[0]!.toLowerCase()) return word[0]!.toUpperCase() + word.slice(1);
        return word;
    };

    const suggest = (raw: string, dialect: Dialect, wanted = 6): string[] => {
        const word = raw.normalize("NFC").replace(/’/g, "'");
        const small = word.toLowerCase();
        const target = [...small].map((letter) => letter.charCodeAt(0));
        // a letter added costs less when it doubles the one beside it
        const adds = new Float64Array(target.length + 1);
        for (let j = 1; j <= target.length; j++) adds[j] = target[j - 1] === target[j - 2] || target[j - 1] === target[j] ? 0.5 : 1;
        const scored = new Map<string, number>();
        const most = small.length <= 3 ? 1.2 : 2;
        for (let index = 0; index < count; index++) {
            if (!fits(index, dialect)) continue;
            const length = starts[index + 1]! - 1 - starts[index]!;
            if (Math.abs(length - small.length) > 2) continue;
            const cost = distance(target, adds, index, most);
            if (cost > most) continue;
            const found = all.slice(starts[index], starts[index + 1]! - 1);
            // a name keeps its capital; a word takes the capitals of what was typed
            const shown = found === found.toLowerCase() ? shaped(found, word) : found;
            if (shown === word || withheld(found)) continue;
            const score = cost + Math.floor(sizes[index]! / 3) * 0.12 + (found[0]!.toLowerCase() !== small[0] ? 0.3 : 0) + (found !== found.toLowerCase() && word === small ? 0.4 : 0);
            if (!scored.has(shown) || scored.get(shown)! > score) scored.set(shown, score);
        }
        // two words run together, offered apart only when both are among the commonest words: "a lot", not "public ally" or "occur ed"
        const common = (part: string) => {
            const index = find(part);
            return index >= 0 && fits(index, dialect) && Math.floor(sizes[index]! / 3) === 0;
        };
        for (let cut = 1; cut < small.length; cut++) {
            const left = small.slice(0, cut);
            const right = small.slice(cut);
            if ((cut > 1 || left === "a") && right.length > 1 && common(left) && common(right) && !withheld(`${left} ${right}`)) scored.set(shaped(`${left} ${right}`, word), 0.9);
        }
        return [...scored].sort((a, b) => a[1] - b[1]).slice(0, wanted).map(([found]) => found);
    };

    /** Spellings that differ by country, as American to British pieces of a word. */
    const PAIRS: [RegExp, string, RegExp, string][] = [
        [/or(?=s?$|ed$|ing$|ful|less|ite|able)/, "our", /our(?=s?$|ed$|ing$|ful|less|ite|able)/, "or"],
        [/iz(?=e|ing|ation)/, "is", /is(?=e|ing|ation)/, "iz"],
        [/yz(?=e|ing)/, "ys", /ys(?=e|ing)/, "yz"],
        [/er(?=s?$)/, "re", /re(?=s?$)/, "er"],
        [/og(?=s?$)/, "ogue", /ogue(?=s?$)/, "og"],
        [/ense(?=s?$)/, "ence", /ence(?=s?$)/, "ense"],
        [/(?<=[aeiou])l(?=ed$|ing$|er$|ers$)/, "ll", /(?<=[aeiou])ll(?=ed$|ing$|er$|ers$)/, "l"],
        [/(?<=[^aeiou])e(?=[^aeiou]+$)/, "ae", /ae/, "e"],
    ];
    const variant = (raw: string): string | undefined => {
        const word = raw.toLowerCase().replace(/’/g, "'");
        const index = find(word);
        if (index < 0) return undefined;
        const country = sizes[index]! % 3;
        for (const [us, gb, gbPattern, usText] of PAIRS) {
            // an American or shared word looks for a British one, a British word for an American or shared one
            const other = country === 2 ? word.replace(gbPattern, usText) : word.replace(us, gb);
            if (other === word) continue;
            const found = find(other);
            if (found < 0) continue;
            const otherCountry = sizes[found]! % 3;
            if (country === 2 ? otherCountry !== 2 : otherCountry === 2) return other;
        }
        return undefined;
    };

    const rank = (word: string) => {
        const index = find(word) >= 0 ? find(word) : find(word.toLowerCase());
        return index >= 0 ? Math.floor(sizes[index]! / 3) : undefined;
    };

    return { size: count, known, suggest, variant, rank };
}
