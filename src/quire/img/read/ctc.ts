// Reading the recognizer's answer. For each slice of a line, eight pixels wide at its height of 48,
// the recognizer gives how likely each character of its dictionary is there, with a blank for "no
// new character here" (CTC). The likeliest at each slice is taken; a character repeated over slices
// is one character, and a blank between two of the same makes them two. Each character keeps the
// slices it was seen in, which is where it is along the line, and how sure the recognizer was.

/** A character read, the slices it was seen in (first and last) and how sure the recognizer was of it, from 0 to 1. */
export interface Character {
    text: string;
    first: number;
    last: number;
    sure: number;
}

/** How wide a slice of the recognizer's answer is, in the pixels of a line brought to 48 high. */
export const SLICE = 8;
/** The height the recognizer reads a line at. */
export const LINE_HEIGHT = 48;

/**
 * The characters in one line's answer: `frames` slices of `classes` likelihoods each, starting at
 * `offset` in `answer`, the classes standing for the dictionary's characters (the blank first).
 * Slices from `upTo` on are padding and are not read.
 */
export function decode(answer: Float32Array, frames: number, classes: number, dictionary: string[], offset = 0, upTo = frames): Character[] {
    const found: Character[] = [];
    let previous = 0;
    for (let frame = 0; frame < Math.min(frames, upTo); frame++) {
        const base = offset + frame * classes;
        let best = 0;
        let likely = answer[base]!;
        for (let index = 1; index < classes; index++) {
            const value = answer[base + index]!;
            if (value > likely) {
                likely = value;
                best = index;
            }
        }
        if (best !== 0 && best === previous) {
            const last = found.at(-1)!;
            last.last = frame;
            last.sure = Math.max(last.sure, likely);
        } else if (best !== 0) found.push({ text: dictionary[best] ?? "", first: frame, last: frame, sure: likely });
        previous = best;
    }
    return found;
}

/** The text of characters read. */
export const textOf = (characters: Character[]): string => characters.map((each) => each.text).join("");

/** How sure the recognizer was of a line: the average over its characters, or 0 with none. */
export const sureOf = (characters: Character[]): number => (characters.length ? characters.reduce((sum, each) => sum + each.sure, 0) / characters.length : 0);
