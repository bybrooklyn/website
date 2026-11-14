// The recognizer's answer is read as CTC is: the likeliest class at each slice, repeats joined, a
// blank between two of the same making them two, padding left unread, and each character keeping the
// slices it was seen in.

import { expect, test } from "bun:test";
import { decode, sureOf, textOf } from "./ctc";

const dictionary = ["", "a", "b", "c", " "];
/** An answer from the likeliest class at each slice, at 0.9, the rest sharing what is left. */
function answer(classes: number[]): Float32Array {
    const out = new Float32Array(classes.length * dictionary.length).fill(0.1 / (dictionary.length - 1));
    classes.forEach((best, frame) => (out[frame * dictionary.length + best] = 0.9));
    return out;
}

test("repeats are one character, a blank between two of the same makes two, and blanks are nothing", () => {
    const read = decode(answer([0, 1, 1, 0, 1, 2, 2, 4, 3, 0]), 10, 5, dictionary);
    expect(textOf(read)).toBe("aab c");
    expect(read.map((each) => [each.first, each.last])).toEqual([[1, 2], [4, 4], [5, 6], [7, 7], [8, 8]]);
    expect(sureOf(read)).toBeCloseTo(0.9);
});

test("a line's answer is read from its place in the batch, and its padding is not read", () => {
    const two = new Float32Array([...answer([1, 0, 2, 2]), ...answer([3, 3, 0, 1])]);
    expect(textOf(decode(two, 4, 5, dictionary, 4 * 5))).toBe("ca");
    expect(textOf(decode(two, 4, 5, dictionary, 4 * 5, 2))).toBe("c");
    expect(sureOf([])).toBe(0);
});
