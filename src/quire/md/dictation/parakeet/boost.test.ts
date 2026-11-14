// Biasing toward the user's words: the trie follows a boosted word piece by piece, a rare name the
// pretend network mishears is written right with the boost and wrong without it, ordinary speech
// is untouched by a list that does not match it, an empty list or a strength of 0 changes nothing,
// and a stronger bonus can be too strong (the cost is measured, not hidden).

import { describe, expect, test } from "bun:test";
import { booster } from "./boost";
import { createDecoder, type Step } from "./decode";
import { text, vocabulary } from "./tokens";

const vocab = vocabulary(["▁the 0", "▁she 1", "▁sh 2", "ar 3", "vari 4", "▁sat 5", "▁sha 6", "rv 7", "▁is 8", "▁here 9", "<blk> 10"].join("\n"));
const BLANK = 10;
const DURATIONS = [0, 1];

/** A pretend network that is given, for each frame, the scores of the pieces that matter there (given the last piece), else the blank wins. */
function hearing(table: (frame: number, token: number) => Record<number, number>): Step {
    const step: Step = (frame, token, state) => {
        const logits = new Float32Array(vocab.pieces.length + DURATIONS.length).fill(-5);
        logits[BLANK] = 3;
        for (const [piece, score] of Object.entries(table(frame[0]!, token))) logits[Number(piece)] = score;
        logits[vocab.pieces.length + 1] = 5;
        return { logits, state };
    };
    step.layers = 1;
    step.hidden = 1;
    return step;
}

const listen = async (table: (frame: number, token: number) => Record<number, number>, frameCount: number, words: string[] = [], strength?: number) => {
    const run = createDecoder(hearing(table), { vocabulary: vocab, durations: DURATIONS, blank: BLANK, boost: words.length || strength === 0 ? booster(words, vocab, strength) : undefined });
    const frames = Float32Array.from({ length: frameCount * 2 }, (_, index) => (index % 2 === 0 ? index / 2 : 0));
    const { tokens } = await run.decode(frames, frameCount, 2, run.start());
    return text(vocab, tokens);
};

/** The name "Sharvari" is said, as ▁sh, ar, vari, but at the first piece the network thinks "she" is a little likelier. */
const name = (frame: number, token: number): Record<number, number> => {
    if (frame === 0) return { 1: 5, 2: 4.2 };
    if (frame === 1) return token === 2 ? { 3: 5 } : {};
    if (frame === 2) return token === 3 ? { 4: 5 } : {};
    if (frame === 4) return { 5: 5 };
    return {};
};

describe("the trie", () => {
    const boost = booster(["Sharvari", "the sat"], vocab);
    test("offers the first pieces of each word at the start and the next piece inside one", () => {
        expect(new Set(boost.candidates(boost.start()))).toEqual(new Set([2, 0, 5]));
        const inside = boost.advance(boost.start(), 2);
        expect(new Set(boost.candidates(inside))).toEqual(new Set([3, 2, 0, 5]));
    });
    test("goes back to the start when a word is finished or the path breaks", () => {
        let at = boost.start();
        for (const piece of [2, 3, 4]) at = boost.advance(at, piece);
        expect(at).toBe(boost.start());
        expect(boost.advance(boost.advance(boost.start(), 2), 1)).toBe(boost.start());
    });
    test("keeps the words of a phrase apart as well as together", () => {
        expect(new Set(boost.candidates(0))).toContain(5);
    });
    test("has nothing to offer for an empty list or a strength of 0", () => {
        expect(booster([], vocab).candidates(0)).toEqual([]);
        expect(booster(["Sharvari"], vocab, 0).candidates(0)).toEqual([]);
    });
});

describe("decoding with a list", () => {
    test("mishears the name without the list", async () => {
        expect(await listen(name, 6)).toBe("she sat");
    });
    test("writes the name right with the list", async () => {
        expect(await listen(name, 6, ["Sharvari"])).toBe("sharvari sat");
    });
    test("leaves ordinary speech as it was when the list has no part of it", async () => {
        const plain = (frame: number): Record<number, number> => ({ 0: { 0: 5 }, 2: { 1: 5 }, 4: { 5: 5 }, 6: { 8: 5 }, 8: { 9: 5 } })[frame] ?? {};
        const without = await listen(plain, 10);
        expect(without).toBe("the she sat is here");
        expect(await listen(plain, 10, ["Kulkarni", "Zoe"])).toBe(without);
    });
    test("is the same as no list when the list is empty or the strength is 0", async () => {
        const without = await listen(name, 6);
        expect(await listen(name, 6, [])).toBe(without);
        expect(await listen(name, 6, ["Sharvari"], 0)).toBe(without);
    });
    test("does not write a boosted word over a clear winner", async () => {
        // "she" leads "sh" by 6 here, far more than the bonus, so the name is not forced
        const clear = (frame: number): Record<number, number> => (frame === 0 ? { 1: 9, 2: 3 } : {});
        expect(await listen(clear, 3, ["Sharvari"])).toBe("she");
    });
    test("does not write a boosted word out of silence", async () => {
        expect(await listen(() => ({}), 6, ["Sharvari"])).toBe("");
    });
    test("a bonus that is too large does hijack a close word, which is why the default is small", async () => {
        const close = (frame: number): Record<number, number> => (frame === 0 ? { 1: 7, 2: 2 } : {});
        expect(await listen(close, 3, ["Sharvari"])).toBe("she");
        expect(await listen(close, 3, ["Sharvari"], 6)).toBe("sh");
    });
});
