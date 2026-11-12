// What finding a document in a long list is held to: every word typed must be in the name, in any
// order and either case, and the list keeps its order. Run with `bun test src/quire`.

import { expect, test } from "bun:test";
import { filterEntries } from "./documents";

const entries = [
    { id: "1", name: "Five versions of this site" },
    { id: "2", name: "Colophon" },
    { id: "3", name: "A site's colors" },
];

test("every word typed must be in a name, in any order and either case", () => {
    expect(filterEntries(entries, "site").map((entry) => entry.id)).toEqual(["1", "3"]);
    expect(filterEntries(entries, "SITE five").map((entry) => entry.id)).toEqual(["1"]);
    expect(filterEntries(entries, "colo").map((entry) => entry.id)).toEqual(["2", "3"]);
    expect(filterEntries(entries, "nothing")).toEqual([]);
});

test("with nothing typed, every document is there in its order", () => {
    expect(filterEntries(entries, "  ")).toEqual(entries);
});
