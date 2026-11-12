// Putting together overlapping transcripts: words two answers agree on, words repeated at the seam
// of two windows dropped, and settling by a pause or by the window moving on.

import { describe, expect, test } from "bun:test";
import { agreeing, createMerger, dropOverlap, join, same, spread, type Word } from "./merge";

/** Words one per half second from a time, so that their ends are known. */
const words = (text: string, from = 0): Word[] => text.split(" ").map((part, index) => ({ text: part, start: from + index * 0.5, end: from + index * 0.5 + 0.5 }));

test("same compares letters and digits only", () => {
    expect(same("Hello,")).toBe("hello");
    expect(same("don't")).toBe("dont");
});

describe("agreeing", () => {
    test("counts the words two lists share at the start", () => {
        expect(agreeing(["a", "b", "c"], ["A", "b", "x"])).toBe(2);
        expect(agreeing([], ["a"])).toBe(0);
        expect(agreeing(["a"], ["b"])).toBe(0);
    });
});

describe("dropOverlap", () => {
    test("drops the words that repeat the end of what was settled", () => {
        expect(join(dropOverlap(["we", "went", "to", "the"], words("to the market today")))).toBe("market today");
    });
    test("drops the longest repeat, not the shortest", () => {
        expect(join(dropOverlap(["the", "cat", "the", "cat"], words("the cat sat")))).toBe("sat");
    });
    test("keeps everything when nothing repeats", () => {
        expect(join(dropOverlap(["one", "two"], words("three four")))).toBe("three four");
    });
    test("does not drop a word that merely matches by chance further back", () => {
        expect(join(dropOverlap(["a", "b", "c", "d", "e", "f", "g", "h", "i", "a"], words("b c d")))).toBe("b c d");
    });
    test("ignores case and punctuation in the match", () => {
        expect(join(dropOverlap(["Hello,", "world."], words("world next")))).toBe("next");
    });
});

describe("a merger", () => {
    test("keeps everything provisional until told otherwise", () => {
        const merger = createMerger();
        const first = merger.update(words("hello there"), {});
        expect(first.settled).toEqual([]);
        expect(join(first.provisional)).toBe("hello there");
        expect(first.stable).toBe(0);
    });
    test("counts the words the last two answers agree on", () => {
        const merger = createMerger();
        merger.update(words("hello there my"), {});
        const second = merger.update(words("hello there my friend"), {});
        expect(second.stable).toBe(3);
        const third = merger.update(words("hello there a friend"), {});
        expect(third.stable).toBe(2);
    });
    test("a final answer settles every word and forgets the comparison", () => {
        const merger = createMerger();
        merger.update(words("hello there"), {});
        const done = merger.update(words("hello there friend"), { final: true });
        expect(join(done.settled)).toBe("hello there friend");
        expect(done.provisional).toEqual([]);
        expect(join(merger.all())).toBe("hello there friend");
    });
    test("the window moving on settles only the agreed words that end before the cut", () => {
        const merger = createMerger();
        merger.update(words("one two three four"), {});
        const next = merger.update(words("one two three four five"), { before: 1.5 });
        expect(join(next.settled)).toBe("one two three");
        expect(join(next.provisional)).toBe("four five");
    });
    test("a word the last answer did not agree on is not settled even if it ends before the cut", () => {
        const merger = createMerger();
        merger.update(words("one two tree four"), {});
        const next = merger.update(words("one two three four five"), { before: 2 });
        expect(join(next.settled)).toBe("one two");
    });
    test("the next window, which starts again inside the settled speech, does not repeat it", () => {
        const merger = createMerger();
        merger.update(words("we went to the market"), { final: true });
        const next = merger.update(words("the market and then home", 1.5), {});
        expect(join(next.provisional)).toBe("and then home");
        const done = merger.update(words("the market and then home", 1.5), { final: true });
        expect(join(merger.all())).toBe("we went to the market and then home");
        expect(join(done.settled)).toBe("and then home");
    });
    test("with overlap off a repeated word at the seam is kept", () => {
        const merger = createMerger({ overlap: false });
        merger.update(words("it had"), { final: true });
        expect(join(merger.update(words("had better"), { final: true }).settled)).toBe("had better");
    });
    test("reset forgets everything", () => {
        const merger = createMerger();
        merger.update(words("a b"), { final: true });
        merger.reset();
        expect(merger.all()).toEqual([]);
    });
});

test("spread gives text without times even times from start to end", () => {
    const spoken = spread("a b c d", 10, 12);
    expect(spoken.map((word) => word.start)).toEqual([10, 10.5, 11, 11.5]);
    expect(spoken[3]!.end).toBe(12);
    expect(spread("", 0, 1)).toEqual([]);
});
