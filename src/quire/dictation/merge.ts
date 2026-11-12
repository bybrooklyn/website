// Putting together what a recognizer says over windows of sound that overlap. Each time dictation
// asks again, the window holds a little more of the same speech, so the new transcript says again
// most of what the last one did. This keeps what has been settled apart from what may still change,
// finds the words two answers agree on, and drops words a new window repeats from the end of what
// was settled already.
//
//   const merger = createMerger();
//   const { settled, provisional, stable } = merger.update(words, { final: false, before: 12.5 });
//
// Words carry times in seconds from the start of the dictation, so windows can be told apart.

/** A word and where it was heard. */
export interface Word {
    text: string;
    start: number;
    end: number;
}

/** A word reduced to what is compared: letters and digits, lowercase. */
export const same = (word: string): string => word.toLowerCase().replace(/[^\p{L}\p{N}]/gu, "");

/** How many words at the start of both lists are the same. */
export function agreeing(a: string[], b: string[]): number {
    let count = 0;
    while (count < a.length && count < b.length && same(a[count]!) === same(b[count]!)) count++;
    return count;
}

/** `next` without the words at its start that repeat the end of `settled`: the longest run, up to `limit` words, that both have. */
export function dropOverlap(settled: string[], next: Word[], limit = 8): Word[] {
    const tail = settled.slice(-limit);
    for (let size = Math.min(limit, tail.length, next.length); size > 0; size--) {
        if (agreeing(tail.slice(-size), next.slice(0, size).map((word) => word.text)) === size) return next.slice(size);
    }
    return next;
}

/** What one answer from the recognizer changes. */
export interface Merged {
    /** Words that are now settled, in order. */
    settled: Word[];
    /** Words after them that may still change. */
    provisional: Word[];
    /** How many of the provisional words the last two answers agreed on. */
    stable: number;
}

/** Remembers the last answer to compare the next with. */
export interface Merger {
    /**
     * Takes the words of an answer. With `final`, every word is settled (a pause, or the end). With
     * `before`, the words that end before that time and that the last answer agreed on are settled
     * (the window is moving past them). Otherwise all stay provisional.
     */
    update(words: Word[], how: { final?: boolean; before?: number }): Merged;
    /** Every word settled so far. */
    all(): Word[];
    reset(): void;
}

/** Makes a merger with nothing settled. */
export function createMerger(): Merger {
    let done: Word[] = [];
    let previous: string[] = [];
    return {
        all: () => done,
        reset() {
            done = [];
            previous = [];
        },
        update(words, how) {
            const fresh = dropOverlap(
                done.map((word) => word.text),
                words,
            );
            const agree = agreeing(previous, fresh.map((word) => word.text));
            let take = 0;
            if (how.final) take = fresh.length;
            else if (how.before !== undefined) while (take < agree && fresh[take]!.end <= how.before) take++;
            const settled = fresh.slice(0, take);
            const provisional = fresh.slice(take);
            done = [...done, ...settled];
            previous = how.final || take > 0 ? [] : fresh.map((word) => word.text);
            return { settled, provisional, stable: Math.max(0, Math.min(provisional.length, agree - take)) };
        },
    };
}

/** Words with times spread evenly over a stretch, for a recognizer that gives text alone. */
export function spread(text: string, start: number, end: number): Word[] {
    const parts = text.split(/\s+/).filter(Boolean);
    const each = (end - start) / Math.max(1, parts.length);
    return parts.map((part, index) => ({ text: part, start: start + index * each, end: start + (index + 1) * each }));
}

/** Words joined back into text. */
export const join = (words: Word[]): string => words.map((word) => word.text).join(" ");
