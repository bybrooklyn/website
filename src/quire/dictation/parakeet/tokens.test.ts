// The vocabulary reader: pieces by id, the blank, words joined from pieces with their frames,
// punctuation kept against the word before, control pieces left out, and typed words split into
// pieces in the ways the biasing needs.

import { describe, expect, test } from "bun:test";
import { close, join, text, vocabulary, type Open } from "./tokens";

const vocab = vocabulary(["▁the 0", "▁cat 1", "▁sat 2", "▁sh 3", "ar 4", "vari 5", "▁she 6", ". 7", "▁. 8", "<|pnc|> 9", "▁ 10", "<blk> 11"].join("\n"));

describe("vocabulary", () => {
    test("reads a piece and its id from every line and finds the blank", () => {
        expect(vocab.pieces[1]).toBe("▁cat");
        expect(vocab.pieces.length).toBe(12);
        expect(vocab.blank).toBe(11);
    });
    test(
        "refuses at once a line whose id is past the count of lines, which once hung the worker for seconds",
        () => {
            const started = performance.now();
            expect(() => vocabulary("a 0\nx 30000000\n<blk> 2")).toThrow("only 3 lines");
            expect(() => vocabulary("x 4294967294")).toThrow();
            expect(performance.now() - started).toBeLessThan(100);
        },
        1000,
    );
    test("takes the last piece as the blank when none is named", () => {
        expect(vocabulary("a 0\nb 1\n").blank).toBe(1);
    });
    test("knows which pieces start a word and which are text", () => {
        expect([vocab.starts(1), vocab.starts(4), vocab.spoken(1), vocab.spoken(9), vocab.spoken(11)]).toEqual([true, false, true, false, false]);
        expect(vocab.letters(1)).toBe("cat");
    });
});

describe("encode", () => {
    test("splits a word into the pieces the model has", () => {
        expect(vocab.encode("Sharvari")).toEqual([[3, 4, 5]]);
        expect(vocab.encode("sharvari")).toEqual([[3, 4, 5]]);
    });
    test("gives nothing for a word it cannot spell", () => {
        expect(vocab.encode("zzz")).toEqual([]);
    });
    test("joins the words of a phrase with the word mark", () => {
        expect(vocab.encode("the cat")).toEqual([[0, 1]]);
    });
});

describe("words", () => {
    const run = (ids: number[]) => {
        const done: string[] = [];
        let open: Open | null = null;
        ids.forEach((id, frame) => {
            const joined = join(vocab, open, id, frame, frame + 1, 0.5);
            if (joined.done) done.push(`${joined.done.text}:${joined.done.from}-${joined.done.to}`);
            open = joined.open;
        });
        if (open) done.push(`${close(open).text}:${(open as Open).from}-${(open as Open).to}`);
        return done;
    };
    test("a word ends where the next begins, with its first and last frame", () => {
        expect(run([0, 1, 3, 4, 5])).toEqual(["the:0-1", "cat:1-2", "sharvari:2-5"]);
    });
    test("punctuation stays against the word before it", () => {
        expect(run([0, 1, 7, 2, 8])).toEqual(["the:0-1", "cat.:1-3", "sat.:3-5"]);
    });
    test("control pieces and the blank change nothing", () => {
        expect(run([9, 0, 11, 1])).toEqual(["the:1-2", "cat:3-4"]);
    });
    test("the mean probability of the pieces is the confidence", () => {
        let open: Open | null = null;
        for (const [id, sure] of [[3, 1], [4, 0.5]] as const) open = join(vocab, open, id, 0, 1, sure).open;
        expect(close(open!).confidence).toBe(0.75);
    });
    test("text puts the words in a line", () => {
        expect(text(vocab, [0, 1, 7, 2])).toBe("the cat. sat");
    });
});
