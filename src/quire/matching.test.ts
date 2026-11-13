// What Select all matching text is held to: it finds every place the selected words appear, exactly
// as written, or the cursor's word; typing replaces them all and then grows them all, keeping each
// one's marks; Backspace and Delete take from every one; a Format command goes on every one; and
// places in the same line stay right as the ones before them change length. The keys and the
// drawing are tried in the browser (more-commands.test.ts). Run with `bun test src/quire`.

import { expect, test } from "bun:test";
import { toggle } from "./bar";
import { caret } from "./keys";
import { eachSpot, eraseAt, matchingSpots, writeAt } from "./matching";
import { read } from "./read";
import { write } from "./write";

const doc = read("The cat sat. A **cat** ran.\n\nCat and cat.\n");
const spots = matchingSpots({ doc, selection: { anchor: { path: [0], offset: 4 }, focus: { path: [0], offset: 7 } } });

test("every place the selected words appear is found, exactly as written, or the cursor's word when nothing is selected", () => {
    expect(spots).toEqual([
        { path: [0], from: 4, to: 7 },
        { path: [0], from: 15, to: 18 },
        { path: [1], from: 8, to: 11 },
    ]);
    expect(matchingSpots({ doc, selection: caret([1], 1) })).toEqual([{ path: [1], from: 0, to: 3 }]);
    expect(matchingSpots({ doc, selection: { anchor: { path: [0], offset: 4 }, focus: { path: [1], offset: 2 } } })).toEqual([]);
});

test("typing replaces every place, keeping its marks, then grows every one; places later in a line move with it", () => {
    const first = writeAt(doc, { spots, fresh: true }, "d");
    expect(write(first.doc)).toBe("The d sat. A **d** ran.\n\nCat and d.\n");
    const second = writeAt(first.doc, { spots: first.spots, fresh: false }, "og");
    expect(write(second.doc)).toBe("The dog sat. A **dog** ran.\n\nCat and dog.\n");
    expect(second.spots).toEqual([
        { path: [0], from: 4, to: 7 },
        { path: [0], from: 15, to: 18 },
        { path: [1], from: 8, to: 11 },
    ]);
});

test("Backspace and Delete take the words found, then a character from every place", () => {
    const gone = eraseAt(doc, { spots, fresh: true }, true);
    expect(write(gone.doc)).toBe("The  sat. A  ran.\n\nCat and .\n");
    const typed = writeAt(doc, { spots, fresh: true }, "bé");
    const back = eraseAt(typed.doc, { spots: typed.spots, fresh: false }, true);
    expect(write(back.doc)).toBe("The b sat. A **b** ran.\n\nCat and b.\n");
    expect(write(eraseAt(back.doc, { spots: back.spots, fresh: false }, false).doc)).toBe("The bsat. A **b**ran.\n\nCat and b\n");
});

test("a Format command goes on every place", () => {
    expect(write(eachSpot(doc, spots, toggle("italic")))).toBe("The *cat* sat. A ***cat*** ran.\n\nCat and *cat*.\n");
});
