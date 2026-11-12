// The tokeniser: sentences that end where a reader would end them, words with their apostrophes and
// hyphens, code and addresses left quiet, and the syllable count behind the reading score.

import { expect, test } from "bun:test";
import { text as runs } from "../document";
import { addresses, readingEase, readRuns, readText, sentences, syllables, words } from "./text";

const split = (value: string) => sentences(readText(value)).map((span) => value.slice(span.from, span.to));

test("sentences end at stops followed by a capital, and nowhere else", () => {
    expect(split("One fact. Another fact! A question? Yes.")).toEqual(["One fact.", "Another fact!", "A question?", "Yes."]);
    expect(split("It costs 3.14 dollars. Then more.")).toEqual(["It costs 3.14 dollars.", "Then more."]);
    expect(split("Mr. Smith met Dr. Jones, e.g. at noon. They talked.")).toEqual(["Mr. Smith met Dr. Jones, e.g. at noon.", "They talked."]);
    expect(split("Written by J. R. R. Tolkien. It is long.")).toEqual(["Written by J. R. R. Tolkien.", "It is long."]);
    expect(split("She said \"Stop.\" Then she left.")).toEqual(["She said \"Stop.\"", "Then she left."]);
    expect(split("Apples, pears, etc. are fruit. Bread, cheese, etc. Then we ate.")).toEqual(["Apples, pears, etc. are fruit.", "Bread, cheese, etc.", "Then we ate."]);
    expect(split("A file named site.ts here. done")).toEqual(["A file named site.ts here. done"]);
    expect(split("Wait... What?")).toEqual(["Wait...", "What?"]);
    expect(split("")).toEqual([]);
});

test("a stop inside code does not end a sentence", () => {
    const read = readRuns([...runs("Run "), ...runs("bun run edit. Now", ["code"]), ...runs(" it opens. Done.")]);
    expect(sentences(read).map((span) => read.text.slice(span.from, span.to))).toEqual(["Run bun run edit. Now it opens.", "Done."]);
});

test("words keep their apostrophes and hyphens and skip code, pictures and addresses", () => {
    const listed = (value: string) => words(readText(value)).map((word) => word.word);
    expect(listed("Don't stop the well-known cat’s dance")).toEqual(["Don't", "stop", "the", "well-known", "cat’s", "dance"]);
    expect(listed("See https://example.com/path or mail me@example.org now")).toEqual(["See", "or", "mail", "now"]);
    const read = readRuns([...runs("call "), ...runs("fooBar", ["code"]), ...runs(" here")]);
    expect(words(read).map((word) => word.word)).toEqual(["call", "here"]);
    expect(read.quiet[5]).toBe(1);
    expect(addresses("go to www.example.com, then stop").map((one) => one.word)).toEqual(["www.example.com"]);
});

test("syllables and the reading ease are near what a reader would count", () => {
    expect([syllables("cat"), syllables("table"), syllables("beautiful"), syllables("reading"), syllables("the")]).toEqual([1, 2, 3, 2, 1]);
    expect(readingEase(10, 1, 13)).toBeGreaterThan(80);
    expect(readingEase(40, 1, 80)).toBeLessThan(10);
    expect(readingEase(0, 0, 0)).toBe(0);
});
