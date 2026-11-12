// The parts of Moonshine decoding that are plain code: reading token ids back into text, reading
// the pieces from the tokenizer file, and choosing the next token. The model itself is measured by
// hand (MODELS.md), not here.

import { describe, expect, test } from "bun:test";
import { best, decodeTokens, piecesOf } from "./moonshine";

const tokenizer = JSON.stringify({ model: { vocab: { "<unk>": 0, "<s>": 1, "</s>": 2, "<0xC3>": 3, "<0xA9>": 4, "▁the": 5, "▁cafe": 6, "ing": 7 } } });

describe("piecesOf", () => {
    test("puts each piece at its id", () => {
        const pieces = piecesOf(tokenizer);
        expect(pieces[5]).toBe("▁the");
        expect(pieces).toHaveLength(8);
    });
});

describe("decodeTokens", () => {
    const pieces = piecesOf(tokenizer);
    test("joins pieces, turns the word mark into a space and drops the first one", () => {
        expect(decodeTokens(pieces, [5, 6])).toBe("the cafe");
        expect(decodeTokens(pieces, [6, 7])).toBe("cafeing");
    });
    test("leaves out the special tokens", () => {
        expect(decodeTokens(pieces, [1, 5, 2])).toBe("the");
    });
    test("puts byte pieces together into the character they spell", () => {
        expect(decodeTokens(pieces, [6, 3, 4])).toBe("cafeé");
    });
    test("skips an id it does not know", () => {
        expect(decodeTokens(pieces, [5, 999])).toBe("the");
    });
    test("is empty for nothing", () => {
        expect(decodeTokens(pieces, [])).toBe("");
    });
});

describe("best", () => {
    test("is the largest value of the last row", () => {
        expect(best(Float32Array.from([9, 0, 0, 0.1, 0.7, 0.2]), 3)).toBe(1);
    });
    test("takes the first of equal values", () => {
        expect(best(Float32Array.from([1, 1]), 2)).toBe(0);
    });
});
