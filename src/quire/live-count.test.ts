// The words of the counter while typing (live-count.ts): the whole, or the part selected of the whole.

import { expect, test } from "bun:test";
import { countLines } from "./live-count";

test("the counter says the words, then the characters, and the pages only in page view", () => {
    expect(countLines({ whole: "One small word" })).toEqual(["3 words", "14 characters"]);
    expect(countLines({ whole: "Alone" })).toEqual(["1 word", "5 characters"]);
    expect(countLines({ whole: "Alone", pages: 1 })).toEqual(["1 word", "5 characters", "1 page"]);
    expect(countLines({ whole: "", pages: 3 })).toEqual(["0 words", "0 characters", "3 pages"]);
});

test("with a selection it says how much of the whole is selected", () => {
    expect(countLines({ whole: "One small word here", part: "small word" })).toEqual(["2 of 4 words", "10 of 19 characters"]);
});
