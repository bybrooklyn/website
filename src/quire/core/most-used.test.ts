// What the counts of what is used most are held to, for any kind of document: one more for each
// thing counted, the most used first with ties keeping their order, and rubbish kept in the browser
// read as nothing counted. mdQuire's own counting is held in md/made.test.ts.

import { expect, test } from "bun:test";
import { counted, ranked, readCounts } from "./most-used";

test("one more is counted for each key, and a key not counted before starts at one", () => {
    expect(counted({ stamp: 2 }, ["stamp", "tidy"])).toEqual({ stamp: 3, tidy: 1 });
});

test("the most used come first, and those used as often keep the order they came in", () => {
    const items = ["a", "b", "c", "d"].map((key) => ({ key }));
    expect(ranked(items, { c: 2, d: 2, a: 1 }).map((item) => item.key)).toEqual(["c", "d", "a", "b"]);
});

test("rubbish reads as nothing counted, and with nothing known given any whole count is kept", () => {
    for (const kept of [null, "", "not json", "[1,2]", "null", "7"]) expect(readCounts(kept)).toEqual({});
    expect(readCounts('{"stamp":3,"tidy":0,"odd":1.5}')).toEqual({ stamp: 3 });
});
