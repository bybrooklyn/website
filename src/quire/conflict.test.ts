// What the side-by-side view of a conflict is held to: the lines both share are level, and each
// line only one side has is shown against a gap on the other. Run with `bun test src/quire`.

import { expect, test } from "bun:test";
import { sideBySide } from "./conflict";

test("the same text is every line the same", () => {
    expect(sideBySide("a\nb\n", "a\nb\n")).toEqual([
        { mine: "a", theirs: "a", same: true },
        { mine: "b", theirs: "b", same: true },
    ]);
});

test("a line changed on each side shows against the other, the lines around kept level", () => {
    const rows = sideBySide("title\nmy line\nend\n", "title\ntheir line\nend\n");
    expect(rows[0]).toEqual({ mine: "title", theirs: "title", same: true });
    expect(rows.filter((row) => !row.same).map((row) => row.mine ?? row.theirs)).toEqual(["their line", "my line"]);
    expect(rows[rows.length - 1]).toEqual({ mine: "end", theirs: "end", same: true });
});

test("a line only one side has is shown against nothing on the other", () => {
    expect(sideBySide("a\nadded\nb", "a\nb")).toEqual([
        { mine: "a", theirs: "a", same: true },
        { mine: "added", same: false },
        { mine: "b", theirs: "b", same: true },
    ]);
    expect(sideBySide("a", "a\ntheirs")).toEqual([
        { mine: "a", theirs: "a", same: true },
        { theirs: "theirs", same: false },
    ]);
});

test("two long texts too big to compare line against line are shown one after the other at once, without building the table", () => {
    const mine = Array.from({ length: 12_000 }, (_, index) => `mine ${index}`).join("\n");
    const theirs = Array.from({ length: 12_000 }, (_, index) => `theirs ${index}`).join("\n");
    Bun.gc(true);
    const before = process.memoryUsage().rss;
    const started = performance.now();
    const rows = sideBySide(mine, theirs);
    expect(performance.now() - started).toBeLessThan(200);
    // the table for these would be 144 million cells, most of a gigabyte
    expect(process.memoryUsage().rss - before).toBeLessThan(100_000_000);
    expect(rows.length).toBe(24_000);
});
