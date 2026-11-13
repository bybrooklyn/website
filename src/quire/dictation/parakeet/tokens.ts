// The vocabulary of a Parakeet model: the pieces its decoder can say, to text and back as far as
// dictation needs. A `vocab.txt` has one piece per line with its id; a piece that begins with the
// SentencePiece mark "▁" starts a word, and the blank token comes last. This file reads that list,
// joins pieces into words with the frames they were heard in, and splits a word the user typed
// into pieces (for the word list that biases decoding, see boost.ts).
//
// Re-expressed from parakeet.js (MIT, Copyright (c) 2025 Yunus Seyhan Dede), tokenizer.js.

/** The mark SentencePiece puts at the start of a piece that begins a word. */
export const MARK = "▁";

/** The pieces of one model by id, with the blank, and the ways to spell a word from them. */
export interface Vocabulary {
    /** Every piece, by id; the blank is included, so this is also the count of token logits. */
    pieces: string[];
    /** The id of the blank token, which says "nothing heard here". */
    blank: number;
    /** True when the piece begins a new word. */
    starts(id: number): boolean;
    /** True when the piece is text; false for the blank and for control pieces like `<|pnc|>`. */
    spoken(id: number): boolean;
    /** The letters of a piece, with the word mark taken off. */
    letters(id: number): string;
    /** The ways a word can be written as pieces: the longest-first split and the fewest-pieces split, for the word as typed and in lower case. */
    encode(word: string): number[][];
}

/** Reads the text of a `vocab.txt`: lines of `piece id`, the blank written `<blk>`. */
export function vocabulary(text: string): Vocabulary {
    const pieces: string[] = [];
    const lines = text.split(/\r?\n/);
    for (const line of lines) {
        const cut = line.search(/\s\S+$/);
        if (cut < 0) continue;
        const id = Number(line.slice(cut).trim());
        // A file has a line for each piece, so no id can be past the count of lines. One that is would
        // make the list as long as the number says, which for a changed or hostile file hangs the worker.
        if (Number.isInteger(id) && id >= lines.length) throw new Error(`the vocabulary names piece ${id} but has only ${lines.length} lines`);
        if (Number.isInteger(id) && id >= 0) pieces[id] = line.slice(0, cut);
    }
    for (let id = 0; id < pieces.length; id++) pieces[id] ??= "";
    const found = pieces.indexOf("<blk>");
    const blank = found >= 0 ? found : pieces.length - 1;
    const ids = new Map<string, number>();
    let longest = 1;
    pieces.forEach((piece, id) => {
        if (piece !== "" && id !== blank && !ids.has(piece)) ids.set(piece, id);
        longest = Math.max(longest, piece.length);
    });
    const control = (id: number) => id === blank || /^<.*>$/.test(pieces[id] ?? "");
    return {
        pieces,
        blank,
        starts: (id) => (pieces[id] ?? "").startsWith(MARK),
        spoken: (id) => id >= 0 && id < pieces.length && !control(id),
        letters: (id) => (pieces[id] ?? "").replaceAll(MARK, ""),
        encode(word) {
            const found: number[][] = [];
            for (const form of new Set([word.trim(), word.trim().toLowerCase()])) {
                if (form === "") continue;
                const marked = MARK + form.replace(/\s+/g, MARK);
                for (const split of [longestFirst(marked, ids, longest), fewest(marked, ids, longest)]) {
                    if (split && !found.some((have) => same(have, split))) found.push(split);
                }
            }
            return found;
        },
    };
}

/** Whether two id lists are the same. */
const same = (a: number[], b: number[]) => a.length === b.length && a.every((id, index) => id === b[index]);

/** Splits text by always taking the longest piece that fits; null if some letter has no piece. */
function longestFirst(text: string, ids: Map<string, number>, longest: number): number[] | null {
    const out: number[] = [];
    for (let at = 0; at < text.length; ) {
        let took = 0;
        for (let length = Math.min(longest, text.length - at); length > 0 && !took; length--) {
            const id = ids.get(text.slice(at, at + length));
            if (id !== undefined) {
                out.push(id);
                took = length;
            }
        }
        if (!took) return null;
        at += took;
    }
    return out;
}

/** Splits text into the fewest pieces, preferring the longer first piece among equals; null if it cannot be split. */
function fewest(text: string, ids: Map<string, number>, longest: number): number[] | null {
    const best: number[] = Array(text.length + 1).fill(Infinity);
    const via: number[] = Array(text.length + 1).fill(0);
    best[text.length] = 0;
    for (let at = text.length - 1; at >= 0; at--) {
        for (let length = Math.min(longest, text.length - at); length > 0; length--) {
            if (!ids.has(text.slice(at, at + length))) continue;
            const cost = 1 + best[at + length]!;
            if (cost < best[at]!) {
                best[at] = cost;
                via[at] = length;
            }
        }
    }
    if (best[0] === Infinity) return null;
    const out: number[] = [];
    for (let at = 0; at < text.length; at += via[at]!) out.push(ids.get(text.slice(at, at + via[at]!))!);
    return out;
}

/** A word being put together from pieces: its letters, the frames it spans and how sure the model was. */
export interface Open {
    text: string;
    from: number;
    to: number;
    /** The sum of the probabilities of its pieces, and how many pieces there are, for the mean. */
    sure: number;
    pieces: number;
}

/** A finished word: its text, the first and last frame it was heard in, and the mean probability of its pieces. */
export interface Spelled {
    text: string;
    from: number;
    to: number;
    confidence: number;
}

/** Whether text is only punctuation, which belongs to the word before it. */
const bare = (text: string) => text !== "" && !/[\p{L}\p{N}]/u.test(text);

/**
 * Adds one piece, heard from frame `from` to frame `to` with probability `sure`, to the word being
 * put together. Returns the word that this piece finished (if it began a new one) and the word now
 * open. Pass `null` for no open word. Control pieces change nothing.
 */
export function join(vocab: Vocabulary, open: Open | null, id: number, from: number, to: number, sure: number): { done: Spelled | null; open: Open | null } {
    if (!vocab.spoken(id)) return { done: null, open };
    const letters = vocab.letters(id);
    if (open && !(vocab.starts(id) && !bare(letters))) {
        open.text += letters;
        open.to = to;
        open.sure += sure;
        open.pieces++;
        return { done: null, open };
    }
    return { done: open ? close(open) : null, open: { text: letters, from, to, sure, pieces: 1 } };
}

/** Finishes a word that is open. */
export function close(open: Open): Spelled {
    return { text: open.text, from: open.from, to: open.to, confidence: open.sure / open.pieces };
}

/** The text of a list of piece ids as one string, words separated by a space and punctuation left against the word before it. */
export function text(vocab: Vocabulary, ids: readonly number[]): string {
    const words: string[] = [];
    let open: Open | null = null;
    for (const id of ids) {
        const joined = join(vocab, open, id, 0, 0, 1);
        if (joined.done) words.push(joined.done.text);
        open = joined.open;
    }
    if (open) words.push(close(open).text);
    return words.filter((word) => word !== "").join(" ");
}
