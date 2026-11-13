// What a table's controls are held to: each adds or removes the row or column at the cursor, or
// sets its alignment, and leaves the cursor in a cell where a person would look for it. Run with
// `bun test src/quire`.

import { expect, test } from "bun:test";
import type { State } from "./history";
import { caret } from "./keys";
import { read } from "./read";
import { alignHere, columnRight, removeColumnHere, removeRowHere, rowBelow, sortHere, tableAt } from "./tables";
import { write } from "./write";

const TABLE = "| a | b |\n| --- | --- |\n| 1 | 2 |\n";
const at = (row: number, column: number): State => ({ doc: read(TABLE), selection: caret([0, row, column], 0) });

test("it knows the table, row and column the cursor is in, and when it is in none", () => {
    expect(tableAt(read(TABLE), [0, 1, 1])).toMatchObject({ path: [0], row: 1, column: 1 });
    expect(tableAt(read("text\n"), [0])).toBeUndefined();
});

test("a row is added below the cursor's and removed, the heading row staying", () => {
    const added = rowBelow(at(0, 1));
    expect(write(added.doc)).toBe("| a   | b   |\n| --- | --- |\n|     |     |\n| 1   | 2   |\n");
    expect(added.selection).toEqual(caret([0, 1, 1], 0));
    const removed = removeRowHere(at(1, 0));
    expect(write(removed.doc)).toBe("| a   | b   |\n| --- | --- |\n");
    expect(removed.selection.focus.path).toEqual([0, 0, 0]);
    expect(removeRowHere(at(0, 0)).doc).toEqual(read(TABLE));
});

test("a column is added to the right of the cursor's and removed, never the last one", () => {
    const added = columnRight(at(1, 0));
    expect(write(added.doc)).toBe("| a   |     | b   |\n| --- | --- | --- |\n| 1   |     | 2   |\n");
    expect(added.selection).toEqual(caret([0, 1, 1], 0));
    const removed = removeColumnHere(at(1, 1));
    expect(write(removed.doc)).toBe("| a   |\n| --- |\n| 1   |\n");
    expect(removed.selection).toEqual(caret([0, 1, 0], 0));
    expect(removeColumnHere({ doc: removed.doc, selection: caret([0, 1, 0], 0) }).doc).toBe(removed.doc);
});

test("a column's alignment is set, and set again goes back to none", () => {
    const centred = alignHere("center")(at(1, 1));
    expect(write(centred.doc)).toBe("| a   | b   |\n| --- | :-: |\n| 1   | 2   |\n");
    expect(write(alignHere("center")(centred).doc)).toBe("| a   | b   |\n| --- | --- |\n| 1   | 2   |\n");
});

test("rows sort by the cursor's column, words A to Z or Z to A and numbers by value, the heading row staying first and the cursor going with its row", () => {
    const words = "| name | n |\n| --- | --- |\n| pear | 10 |\n| Apple | 9 |\n| éclair | 1,000 |\n|  | 2 |\n";
    const sorted = sortHere(false)({ doc: read(words), selection: caret([0, 1, 0], 2) });
    expect(write(sorted.doc).split("\n").slice(2, 6).map((line) => line.split("|")[1]!.trim())).toEqual(["Apple", "éclair", "pear", ""]);
    expect(sorted.selection).toEqual(caret([0, 3, 0], 2));
    const numbers = sortHere(true)({ doc: read(words), selection: caret([0, 0, 1], 0) });
    expect(write(numbers.doc).split("\n").slice(2, 6).map((line) => line.split("|")[2]!.trim())).toEqual(["1,000", "10", "9", "2"]);
    expect(write(sortHere(false)({ doc: read(TABLE), selection: caret([0, 1, 0], 0) }).doc)).toBe(write(read(TABLE)));
});
