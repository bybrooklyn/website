// Suggesting the next words as she types, from what she has written before: no model of language,
// only counts. Every run of words she has written (in her documents, never across a full stop, a
// comma or a line) is counted as the word that came after each one, two and three words; to
// suggest, the words before the caret are looked up, the longest run that has been seen often
// enough first, backing off to shorter ones, and the word that followed is offered only when it
// followed there clearly more often than anything else. The word being typed is finished the same
// way, from the words she has used that start with its letters. It finishes words and carries on
// phrases she has written; it never makes a sentence of its own.
//
// The counts are kept in two tables of numbers (typed arrays, open addressing on two 32-bit hashes),
// not in a Map of strings, so that a few thousand documents stay within a few megabytes; when a
// table reaches its most, the rarest runs are dropped, which are below what is ever suggested.
// Pure: suggest-learn.ts feeds it documents in idle time and keeps it, suggest-view.ts draws it.
//
//   const model = createModel();
//   for (const part of paragraphsOf(markdown)) model.learn(part);
//   model.predict("I am writing a post about my web");   // "site and how it", when she writes that

import { withheld } from "./check/withheld";

/** How many times a word must have followed before it is offered. */
export const MIN = 3;
/** The most words a suggestion holds, the word being finished counted. */
export const MOST_WORDS = 4;
/** The most characters a suggestion holds. */
export const MOST_CHARACTERS = 48;
/** The longest run of words looked back at. */
const ORDER = 3;
/** The most words looked through to finish a word, so that a short beginning never costs more than this. */
const CANDIDATES = 2000;
/** The most words the vocabulary holds; a word after that breaks the runs it is in, as a full stop does. */
const MOST_VOCABULARY = 300_000;

/** The most slots of each table: runs ending in a word, and runs of words before a word. At 12 and 24 bytes a slot this is 3 MB each. */
export const LIMITS = { grams: 1 << 18, contexts: 1 << 17 };

// ---- hashing ----

/** Two independent 32-bit hashes of a list of word ids, so that two runs share a key about once in 2^64. */
function hashIds(ids: ArrayLike<number>, from: number, to: number, extra = -1): [number, number] {
    let a = 0x811c9dc5 ^ (to - from + (extra >= 0 ? 1 : 0));
    let b = 0x9747b28c ^ Math.imul(to - from + 7, 0x85ebca6b);
    const mixIn = (id: number) => {
        a = Math.imul(a ^ id, 0x01000193);
        a ^= a >>> 15;
        b = Math.imul(b ^ (id + 0x6b43a9b5), 0xc2b2ae35);
        b = Math.imul(b ^ (b >>> 13), 0x27d4eb2f);
    };
    for (let at = from; at < to; at++) mixIn(ids[at]!);
    if (extra >= 0) mixIn(extra);
    a = Math.imul(a ^ (a >>> 16), 0x85ebca6b);
    a ^= a >>> 13;
    b ^= b >>> 16;
    // an odd second key marks a slot as used, so that zero means empty
    return [a >>> 0, (b | 1) >>> 0];
}

// ---- a table of counts ----

/** Counts kept by a two-part key in typed arrays, each key with `width` numbers. Grows by doubling up to `most` slots. */
export class Table {
    a: Uint32Array;
    b: Uint32Array;
    values: Uint32Array;
    used = 0;
    constructor(
        readonly width: number,
        readonly most: number,
        size = 1024,
    ) {
        this.a = new Uint32Array(size);
        this.b = new Uint32Array(size);
        this.values = new Uint32Array(size * width);
    }
    get size(): number {
        return this.a.length;
    }
    /** True when the table is as large as it may grow and as full as it may be. */
    full(): boolean {
        return this.size >= this.most && this.used + 1 > this.size * 0.7;
    }
    /** The slot of a key, or -1. */
    find(a: number, b: number): number {
        const mask = this.size - 1;
        for (let at = a & mask; ; at = (at + 1) & mask) {
            const there = this.b[at]!;
            if (there === 0) return -1;
            if (there === b && this.a[at] === a) return at;
        }
    }
    /** The slot of a key, made if it is not there; -1 if the table is full. */
    slot(a: number, b: number): number {
        const found = this.find(a, b);
        if (found >= 0) return found;
        if (this.used + 1 > this.size * 0.7) {
            if (this.size >= this.most) return -1;
            this.grow(this.size * 2);
        }
        const mask = this.size - 1;
        let at = a & mask;
        while (this.b[at] !== 0) at = (at + 1) & mask;
        this.a[at] = a;
        this.b[at] = b;
        this.used++;
        return at;
    }
    private grow(size: number) {
        const { a, b, values, width } = this;
        this.a = new Uint32Array(size);
        this.b = new Uint32Array(size);
        this.values = new Uint32Array(size * width);
        this.used = 0;
        for (let at = 0; at < a.length; at++) if (b[at] !== 0) this.copy(a[at]!, b[at]!, values, at);
    }
    private copy(a: number, b: number, values: Uint32Array, from: number) {
        const mask = this.size - 1;
        let at = a & mask;
        while (this.b[at] !== 0) at = (at + 1) & mask;
        this.a[at] = a;
        this.b[at] = b;
        this.values.set(values.subarray(from * this.width, from * this.width + this.width), at * this.width);
        this.used++;
    }
    /** A table holding only the entries `keep` says yes to, sized for them. */
    keep(keep: (values: Uint32Array, at: number) => boolean): Table {
        let count = 0;
        for (let at = 0; at < this.size; at++) if (this.b[at] !== 0 && keep(this.values, at * this.width)) count++;
        let size = 1024;
        while (size * 0.5 < count) size *= 2;
        const next = new Table(this.width, this.most, Math.min(size, Math.max(this.most, 1024)));
        for (let at = 0; at < this.size; at++) if (this.b[at] !== 0 && keep(this.values, at * this.width)) next.copy(this.a[at]!, this.b[at]!, this.values, at);
        return next;
    }
    /** The used slots only, to be kept: their keys and values side by side. */
    pack(): { a: Uint32Array; b: Uint32Array; values: Uint32Array } {
        const a = new Uint32Array(this.used);
        const b = new Uint32Array(this.used);
        const values = new Uint32Array(this.used * this.width);
        let to = 0;
        for (let at = 0; at < this.size; at++) {
            if (this.b[at] === 0) continue;
            a[to] = this.a[at]!;
            b[to] = this.b[at]!;
            values.set(this.values.subarray(at * this.width, at * this.width + this.width), to * this.width);
            to++;
        }
        return { a, b, values };
    }
    /** A table from what `pack` gave. */
    static unpack(width: number, most: number, packed: { a: Uint32Array; b: Uint32Array; values: Uint32Array }): Table {
        let size = 1024;
        while (size * 0.6 < packed.a.length) size *= 2;
        const table = new Table(width, Math.max(most, size), size);
        for (let at = 0; at < packed.a.length; at++) table.copy(packed.a[at]!, packed.b[at]!, packed.values, at);
        return table;
    }
}

// ---- reading words ----

/** A word as written, and the place it starts. */
interface Word {
    text: string;
    start: number;
}

/** A word: letters and digits, with an apostrophe or a hyphen inside it. */
const WORD = /[\p{L}\p{M}\p{N}]+(?:['’-][\p{L}\p{M}\p{N}]+)*/gu;

/** The runs of words in some text: a run ends at anything between two words but spaces (a full stop, a comma, a bracket, a line). A word with a digit in it ends a run too, and is not in it. */
export function runsOf(text: string): Word[][] {
    const runs: Word[][] = [];
    let run: Word[] = [];
    let end = 0;
    for (const match of text.matchAll(WORD)) {
        const gap = text.slice(end, match.index);
        if (run.length && !/^[ \t ]*$/.test(gap)) {
            runs.push(run);
            run = [];
        }
        end = match.index + match[0].length;
        if (/\p{N}/u.test(match[0])) {
            if (run.length) runs.push(run);
            run = [];
            continue;
        }
        run.push({ text: match[0].replace(/’/g, "'"), start: match.index });
    }
    if (run.length) runs.push(run);
    return runs;
}

/** True when the run starting at `start` in `text` begins a sentence: nothing before it on the line, or a full stop, question or exclamation mark. */
const startsSentence = (text: string, start: number) => /(^|[.!?:]["'”’)\]]*\s+|\n\s*)$/.test(text.slice(Math.max(0, start - 6), start));

/**
 * The prose of a Markdown document, as paragraphs of plain words, for learning from: no
 * frontmatter, code, maths, tables, headings, HTML or link addresses. What cannot be read as words
 * (a picture, an address, inline code) is left as a break, so that words either side of it never run
 * together. A paragraph is its lines joined, since a long paragraph is often written on several.
 */
export function paragraphsOf(markdown: string): string[] {
    return [...paragraphs(markdown)];
}

/** The same paragraphs one at a time, so that a long document can be learned a slice at a time. */
export function* paragraphs(markdown: string): Generator<string> {
    const lines = markdown.replace(/\r\n?/g, "\n").split("\n");
    let current: string[] = [];
    const end = () => {
        const joined = current.join(" ");
        current = [];
        return joined;
    };
    let at = 0;
    // frontmatter, at the very start
    if (/^(---|\+\+\+)\s*$/.test(lines[0] ?? "")) {
        const close = lines.indexOf(lines[0]!.trim(), 1);
        if (close > 0) at = close + 1;
    }
    let fence: string | undefined;
    for (; at < lines.length; at++) {
        const line = lines[at]!;
        const trimmed = line.trim();
        if (fence) {
            if (trimmed.startsWith(fence)) fence = undefined;
            continue;
        }
        const opens = /^(`{3,}|~{3,}|\$\$)/.exec(trimmed);
        if (opens) {
            if (current.length) yield end();
            // $$ on one line with its maths closes itself
            if (!(opens[1] === "$$" && trimmed.length > 2 && trimmed.endsWith("$$"))) fence = opens[1]!;
            continue;
        }
        if (trimmed === "" || /^(#{1,6}\s|\||<|import\s|export\s|\[[^\]]+\]:\s|([-*_=])\s*\2\s*\2[\s\-*_=]*$|-#\s)/.test(trimmed)) {
            if (current.length) yield end();
            continue;
        }
        // a list item or a quote begins a block of its own
        if (current.length && /^([-*+]|\d{1,9}[.)])\s|^>/.test(trimmed)) yield end();
        const text = trimmed
            // what begins a line: a quote, a list's mark, a task's box
            .replace(/^(>\s*)+/, "")
            .replace(/^([-*+]|\d{1,9}[.)])\s+(\[[ xX]\]\s+)?/, "")
            // pictures, inline code, maths, footnote marks and HTML are breaks
            .replace(/!\[[^\]]*\]\([^)]*\)/g, " \u0001 ")
            .replace(/`[^`]*`/g, " \u0001 ")
            .replace(/\$[^$]+\$/g, " \u0001 ")
            .replace(/\[\^[^\]]*\]/g, " \u0001 ")
            .replace(/<[^>]+>/g, " \u0001 ")
            // a link is its words; its address goes
            .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
            .replace(/\bhttps?:\/\/\S+/g, " \u0001 ")
            // the marks of bold, italic, strikethrough and highlight are not words, and do not break a run
            .replace(/(\*{1,3}|_{1,3}|~{1,2}|={2}|\|\|)(?=\S)|(?<=\S)(\*{1,3}|_{1,3}|~{1,2}|={2}|\|\|)/g, "");
        current.push(text);
    }
    if (current.length) yield end();
}

// ---- the model ----

/** What is kept of a model between visits: plain arrays and strings, which IndexedDB keeps as they are. */
export interface ModelData {
    version: 1;
    words: string;
    forms: string;
    counts: Uint32Array;
    capitals: Int32Array;
    grams: { a: Uint32Array; b: Uint32Array; values: Uint32Array };
    contexts: { a: Uint32Array; b: Uint32Array; values: Uint32Array };
    floor: number;
    tokens: number;
}

/** The counts of what she has written, and what to suggest from them. */
export interface Model {
    /** Counts the words of some plain text; `sign` -1 takes back what an earlier learn of the same text counted. */
    learn(text: string, sign?: 1 | -1): void;
    /** The words to show after the caret, given the text before it in its block; undefined when nothing is clearly likely. */
    predict(before: string): string | undefined;
    /** Sorts the vocabulary for finishing words, which predict otherwise does the first time it is asked; done in idle time by the learner. */
    prepare(): void;
    /** What to keep, to be read back by `modelFrom`. */
    data(): ModelData;
    /** How much it holds: words, runs, the bytes its tables take in memory and, packed, to keep. */
    size(): { words: number; grams: number; contexts: number; memory: number; kept: number; tokens: number; floor: number };
}

/** The share of what followed a run that the likeliest word must have, by the run's length: one word before is asked the most. */
const RATIO = [0.6, 0.7, 0.5, 0.4];

/**
 * Whether the likeliest of what followed is clear: seen at least MIN times (five after a single
 * word), twice as often as the next, and a large enough share of all that followed.
 */
export function confident(best: number, second: number, total: number, order: number): boolean {
    if (best < MIN || best < 2 * second) return false;
    if (order === 1 && best < 5) return false;
    return best >= (RATIO[Math.min(order, 3)] ?? 0.4) * total;
}

/** A new model, empty or read back from what was kept; data that does not fit what a model keeps gives an empty one. */
export function createModel(kept?: ModelData): Model {
    let words: string[] = [];
    let forms: string[] = [];
    let ids = new Map<string, number>();
    let counts = new Uint32Array(1024);
    let capitals = new Int32Array(1024);
    let grams = new Table(1, LIMITS.grams);
    // each context: the likeliest next word, its count, the next likeliest's count, and the total
    let contexts = new Table(4, LIMITS.contexts);
    let floor = 0;
    let tokens = 0;
    let sorted: Int32Array | undefined;
    let sortedFor = -1;

    if (kept && valid(kept)) {
        words = kept.words === "" ? [] : kept.words.split("\n");
        forms = kept.forms.split("\n");
        if (forms.length !== words.length) forms = words.map(() => "");
        ids = new Map(words.map((word, id) => [word, id]));
        counts = new Uint32Array(Math.max(1024, words.length * 2));
        counts.set(kept.counts.subarray(0, words.length));
        capitals = new Int32Array(counts.length);
        capitals.set(kept.capitals.subarray(0, words.length));
        grams = Table.unpack(1, LIMITS.grams, kept.grams);
        contexts = Table.unpack(4, LIMITS.contexts, kept.contexts);
        floor = kept.floor;
        tokens = kept.tokens;
    }

    function idOf(word: string, add: boolean): number {
        const key = word.toLowerCase();
        const found = ids.get(key);
        if (found !== undefined || !add || words.length >= MOST_VOCABULARY) return found ?? -1;
        const id = words.length;
        words.push(key);
        forms.push("");
        ids.set(key, id);
        if (id >= counts.length) {
            const more = new Uint32Array(counts.length * 2);
            more.set(counts);
            counts = more;
            const caps = new Int32Array(more.length);
            caps.set(capitals);
            capitals = caps;
        }
        return id;
    }

    /** Drops the rarest runs, raising the floor below which counts are not trusted, until the tables have room again. */
    function prune() {
        while (grams.full() || contexts.full()) {
            floor++;
            grams = grams.keep((values, at) => values[at]! > floor);
            contexts = contexts.keep((values, at) => values[at + 3]! > floor);
        }
    }

    function count(ids: number[], at: number, sign: 1 | -1) {
        const word = ids[at]!;
        for (let order = 1; order <= ORDER && at - order >= 0; order++) {
            const [ga, gb] = hashIds(ids, at - order, at, word);
            const [ca, cb] = hashIds(ids, at - order, at);
            if (sign > 0) {
                if (grams.full() || contexts.full()) prune();
                const g = grams.slot(ga, gb);
                const c = contexts.slot(ca, cb);
                if (g < 0 || c < 0) continue;
                const now = ++grams.values[g]!;
                const v = contexts.values;
                const base = c * 4;
                v[base + 3]!++;
                if (v[base + 1] === 0 || v[base] === word) {
                    v[base] = word;
                    v[base + 1] = Math.max(now, v[base + 1]!);
                } else if (now > v[base + 1]!) {
                    v[base + 2] = v[base + 1]!;
                    v[base] = word;
                    v[base + 1] = now;
                } else if (now > v[base + 2]!) v[base + 2] = now;
            } else {
                const g = grams.find(ga, gb);
                if (g >= 0 && grams.values[g]! > 0) grams.values[g]!--;
                const c = contexts.find(ca, cb);
                if (c < 0) continue;
                const v = contexts.values;
                const base = c * 4;
                if (v[base + 3]! > 0) v[base + 3]!--;
                // the likeliest losing a count may no longer be the likeliest; the check against the second then fails, which is the safe way to be wrong
                if (v[base] === word && v[base + 1]! > 0) v[base + 1]!--;
            }
        }
    }

    function learn(text: string, sign: 1 | -1 = 1) {
        for (const run of runsOf(text)) {
            const list: number[] = [];
            const flush = () => {
                for (let at = 0; at < list.length; at++) {
                    const id = list[at]!;
                    counts[id] = Math.max(0, counts[id]! + sign);
                    tokens += sign;
                    count(list, at, sign);
                }
                list.length = 0;
            };
            run.forEach((word, index) => {
                const id = idOf(word.text, sign > 0);
                if (id < 0) return flush();
                list.push(id);
                // how a word is written in the middle of a sentence is how it is offered: mdQuire, I, Charlotte
                if (sign > 0 && !(index === 0 && startsSentence(text, word.start))) {
                    const lower = word.text.toLowerCase();
                    if (word.text === lower) capitals[id]!--;
                    else if (word.text !== word.text.toUpperCase() || word.text.length === 1) {
                        capitals[id]!++;
                        forms[id] = word.text;
                    }
                }
            });
            flush();
        }
    }

    function prepare() {
        if (sortedFor === words.length) return;
        const order = Int32Array.from(words.keys());
        order.sort((x, y) => (words[x]! < words[y]! ? -1 : words[x]! > words[y]! ? 1 : 0));
        sorted = order;
        sortedFor = words.length;
    }

    /** How a word is offered: as she writes it in a sentence's middle. */
    const formOf = (id: number) => (capitals[id]! > 0 && forms[id] ? forms[id]! : words[id]!);

    /** The count of a word after a run of ids (the last `order` of `history`), or its count anywhere for order 0. */
    function after(history: number[], order: number, id: number): number {
        if (order === 0) return counts[id]!;
        const [a, b] = hashIds(history, history.length - order, history.length, id);
        const at = grams.find(a, b);
        return at < 0 ? 0 : grams.values[at]!;
    }

    /** The word the letters typed most likely finish, given the words before them; undefined when it is not clear. */
    function finish(history: number[], typed: string): number | undefined {
        if (!sorted) prepare();
        const order = sorted!;
        const key = typed.toLowerCase();
        let low = 0;
        let high = order.length;
        while (low < high) {
            const middle = (low + high) >> 1;
            if (words[order[middle]!]! < key) low = middle + 1;
            else high = middle;
        }
        const candidates: number[] = [];
        for (let at = low; at < order.length && candidates.length < CANDIDATES && words[order[at]!]!.startsWith(key); at++) candidates.push(order[at]!);
        if (!candidates.length) return undefined;
        for (let length = Math.min(ORDER, history.length); length >= 0; length--) {
            // finishing a word from no words before it needs three letters typed
            if (length === 0 && key.length < 3) return undefined;
            let best = -1;
            let first = 0;
            let second = 0;
            let total = 0;
            for (const id of candidates) {
                const seen = after(history, length, id);
                if (seen <= floor && length > 0) continue;
                total += seen;
                if (seen > first) {
                    second = first;
                    first = seen;
                    best = id;
                } else if (seen > second) second = seen;
            }
            if (total < MIN) continue;
            if (!confident(first, second, total, length)) return undefined;
            return words[best] === key ? undefined : best;
        }
        return undefined;
    }

    /** The word most likely to come next after the history; undefined when it is not clear. */
    function next(history: number[]): number | undefined {
        for (let length = Math.min(ORDER, history.length); length >= 1; length--) {
            const [a, b] = hashIds(history, history.length - length, history.length);
            const at = contexts.find(a, b);
            if (at < 0) continue;
            const v = contexts.values;
            const total = v[at * 4 + 3]!;
            if (total < MIN) continue;
            const best = v[at * 4]!;
            const first = Math.min(v[at * 4 + 1]!, after(history, length, best));
            return confident(first, v[at * 4 + 2]!, total, length) ? best : undefined;
        }
        return undefined;
    }

    function predict(before: string): string | undefined {
        if (tokens === 0) return undefined;
        const tail = before.slice(-200);
        const typing = /[\p{L}\p{M}'’-]+$/u.exec(tail)?.[0] ?? "";
        // after a space only, never after two, a full stop or anything else
        if (!typing && !/[\p{L}\p{M}] $/u.test(tail)) return undefined;
        if (typing && (typing.replace(/['’-]/g, "").length < 2 || /^['’-]/.test(typing))) return undefined;
        // a word straight after a sign is something else: an emoji's name after a colon, a slash's command, a tag, an address
        if (typing && !/(^|\s)$/.test(tail.slice(0, tail.length - typing.length))) return undefined;
        const runs = runsOf(tail);
        let run = runs[runs.length - 1] ?? [];
        // the run must reach the caret: words before a break are not the history of the word typed
        const last = run[run.length - 1];
        if (!last || last.start + last.text.length !== (typing ? tail.length : tail.length - 1)) run = [];
        const done = typing ? run.slice(0, -1) : run;
        const history: number[] = [];
        for (const word of done) {
            const id = idOf(word.text, false);
            if (id < 0) history.length = 0;
            else history.push(id);
        }
        if (!typing && history.length === 0) return undefined;
        const shouting = typing.length >= 2 && typing === typing.toUpperCase() && typing !== typing.toLowerCase();
        const shown = (id: number) => (shouting ? words[id]!.toUpperCase() : formOf(id));
        let text = "";
        let count = 0;
        if (typing) {
            const finished = finish(history, typing.replace(/’/g, "'"));
            if (finished === undefined || withheld(words[finished]!)) return undefined;
            text = shown(finished).slice(typing.length);
            history.push(finished);
            count = 1;
        }
        while (count < MOST_WORDS) {
            const word = next(history);
            if (word === undefined || withheld(words[word]!)) break;
            const more = `${text || typing ? " " : ""}${shown(word)}`;
            if ((text + more).length > MOST_CHARACTERS) break;
            text += more;
            history.push(word);
            count++;
        }
        // a suggestion after a space starts with its word, not a space
        if (!typing) text = text.trimStart();
        return text.length >= 2 ? text : undefined;
    }

    return {
        learn,
        predict,
        prepare,
        data: () => ({ version: 1, words: words.join("\n"), forms: forms.join("\n"), counts: counts.slice(0, words.length), capitals: capitals.slice(0, words.length), grams: grams.pack(), contexts: contexts.pack(), floor, tokens }),
        size: () => {
            const text = words.reduce((sum, word) => sum + word.length + 1, 0) + forms.reduce((sum, form) => sum + form.length + 1, 0);
            return {
                words: words.length,
                grams: grams.used,
                contexts: contexts.used,
                tokens,
                floor,
                memory: grams.size * 12 + contexts.size * 24 + counts.length * 8 + text * 2,
                kept: grams.used * 12 + contexts.used * 24 + words.length * 8 + text,
            };
        },
    };
}

/** True when kept data has the shape a model keeps, so that nothing broken or from elsewhere is read as one. */
function valid(kept: ModelData): boolean {
    const array = (value: unknown, kind: typeof Uint32Array | typeof Int32Array) => value instanceof kind;
    const table = (value: ModelData["grams"] | undefined, width: number) => !!value && array(value.a, Uint32Array) && array(value.b, Uint32Array) && array(value.values, Uint32Array) && value.a.length === value.b.length && value.values.length === value.a.length * width;
    if (!kept || kept.version !== 1 || typeof kept.words !== "string" || typeof kept.forms !== "string") return false;
    const count = kept.words === "" ? 0 : kept.words.split("\n").length;
    return array(kept.counts, Uint32Array) && array(kept.capitals, Int32Array) && kept.counts.length >= count && kept.capitals.length >= count && table(kept.grams, 1) && table(kept.contexts, 4) && Number.isInteger(kept.floor) && kept.floor >= 0 && Number.isFinite(kept.tokens);
}
