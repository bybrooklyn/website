// How mdQuire shows and restores a version is held to: a .quire document's snapshot brings back its
// styling, a Markdown one keeps the page it is restored into, and a version shown marks the blocks it
// added since the one before. The history itself is held in core/versions.test.ts.

import { expect, test } from "bun:test";
import { setStyle } from "./document";
import { emptyParts } from "../core/quire-file";
import { opened, written } from "./quire-parts";
import { read } from "./read";
import { snapshotParts, snapshotText } from "../core/versions";
import { addedBlocks, snapshotDocument } from "./history-view";
import { write } from "./write";

test("a .quire document's snapshot carries its styling, and restoring it brings back the typeface, highlight and spacing", () => {
    const styled = setStyle(opened("A line of words\n", emptyParts()), { start: { path: [0], offset: 2 }, end: { path: [0], offset: 6 } }, { font: "serif", highlight: "yellow" });
    const spaced = { ...styled, blocks: styled.blocks.map((block) => (block.kind === "paragraph" ? { ...block, spacing: 2 } : block)) };
    const { text, quire } = written(spaced, write);
    const saved = snapshotText(text, quire);
    expect(snapshotParts(saved)).toEqual({ markdown: "A line of words\n", parts: quire });
    const back = snapshotDocument(saved, opened("Something else\n", emptyParts()));
    expect(written(back, write)).toEqual({ text, quire });
    const block = back.blocks[0]!;
    expect(block.kind === "paragraph" && block.spacing).toBe(2);
    expect(JSON.stringify(block)).toContain('"font":"serif"');
    expect(JSON.stringify(block)).toContain('"highlight":"yellow"');
});

test("a Markdown snapshot, or one kept before styling was, restores as Markdown and keeps the page it is restored into", () => {
    expect(snapshotParts("# Plain\n")).toEqual({ markdown: "# Plain\n" });
    const into = opened("x\n", emptyParts());
    const back = snapshotDocument("# Plain\n", into);
    expect(back.quire).toEqual(into.quire);
    expect(write(back)).toBe("# Plain\n");
    expect(snapshotDocument("# Plain\n", opened("x\n", undefined)).quire).toBeUndefined();
});

test("a version shown marks the blocks it added since the one before, a block there twice counting twice", () => {
    expect(addedBlocks(read("One.\n\nTwo.\n"), read("One.\n\nNew.\n\nTwo.\n"))).toEqual([1]);
    expect(addedBlocks(read("Same.\n"), read("Same.\n\nSame.\n"))).toEqual([1]);
    expect(addedBlocks(undefined, read("First.\n\nSecond.\n"))).toEqual([0, 1]);
    expect(addedBlocks(read("Gone.\n\nKept.\n"), read("Kept.\n"))).toEqual([]);
});
