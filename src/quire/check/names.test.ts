// The site's own names are known to the spelling check whatever their capitals and with a possessive,
// and are found in text as whole words only, for the browser's spelling to be told to leave them.

import { expect, test } from "bun:test";
import { readDictionary } from "./dictionary";
import { isName, namesIn } from "./names";
import { createSpeller } from "./spelling";

test("the site's names are known, whatever their capitals, and with a possessive", () => {
    for (const word of ["mdQuire", "MDQUIRE", "mdquire", "imgQuire", "Mote", "charlotte", "Charlotte's", "Fraunces", "Torrens", "bybrooklyn"]) expect({ word, known: isName(word) }).toEqual({ word, known: true });
    expect(isName("mdQuirk")).toBe(false);
});

test("the speller lets the names through though the dictionary has never heard of them", () => {
    const speller = createSpeller(readDictionary("hello\nworld\n"), "us");
    expect(speller.known("mdQuire")).toBe(true);
    expect(speller.known("Fraunces")).toBe(true);
    expect(speller.known("wrold")).toBe(false);
});

test("names are found in text as whole words, where they are", () => {
    expect(namesIn("Welcome to mdQuire")).toEqual([[11, 18]]);
    expect(namesIn("mdQuires and xmdQuire are not")).toEqual([]);
    expect(namesIn("Mote, by charlotte.")).toEqual([
        [0, 4],
        [9, 18],
    ]);
});
