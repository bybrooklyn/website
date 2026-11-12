// What the Markdown view's reading is held to: text typed as Markdown comes back as a document
// that writes exactly that text, in which every block that did not change is the very block that
// was there before, so the rich view draws again only what changed. Run with `bun test src/quire`.

import { expect, test } from "bun:test";
import { insertText } from "./document";
import { keepSame, settleFor } from "./markdown-view";
import { read } from "./read";
import { write } from "./write";

const BEFORE = "---\ntitle: x\n---\n\n# Title\n\nFirst paragraph.\n\n- a\n- b\n\nLast paragraph.\n";

test("blocks that did not change are the same blocks as before, and the rest are new", () => {
    const old = read(BEFORE);
    const text = BEFORE.replace("First paragraph.", "First paragraph, changed.");
    const next = keepSame(old, read(text));
    expect(write(next)).toBe(text);
    expect(next.blocks[0]).toBe(old.blocks[0]);
    expect(next.blocks[1]).not.toBe(old.blocks[1]);
    expect(next.blocks[2]).toBe(old.blocks[2]);
    expect(next.blocks[3]).toBe(old.blocks[3]);
});

test("a block added or taken away in the middle leaves those around it as they were", () => {
    const old = read(BEFORE);
    const added = BEFORE.replace("- a\n- b\n", "- a\n- b\n\n> A new quote.\n");
    const next = keepSame(old, read(added));
    expect(write(next)).toBe(added);
    expect(next.blocks.length).toBe(5);
    expect(next.blocks[4]).toBe(old.blocks[3]);
    const removed = keepSame(old, read(BEFORE.replace("First paragraph.\n\n", "")));
    expect(removed.blocks.map((block) => block.kind)).toEqual(["heading", "list", "paragraph"]);
    expect(removed.blocks[2]).toBe(old.blocks[3]);
});

test("the same text gives back the same document, and new frontmatter or a fresh block in the old is taken from the new", () => {
    const old = read(BEFORE);
    expect(keepSame(old, read(BEFORE))).toBe(old);
    const titled = BEFORE.replace("title: x", "title: y");
    expect(write(keepSame(old, read(titled)))).toBe(titled);
    // a block edited in the rich view has no source, so the text's own reading of it is taken
    const edited = insertText(old, { path: [1], offset: 0 }, "Very ");
    const next = keepSame(edited, read(write(edited)));
    expect(next.blocks[1]).not.toBe(edited.blocks[1]);
    expect(next.blocks[1]!.source).toBe("Very First paragraph.");
    expect(next.blocks[0]).toBe(edited.blocks[0]);
});

test("a short document is read again at once, a long one only after a pause in typing", () => {
    expect(settleFor(500)).toBeLessThanOrEqual(16);
    expect(settleFor(150_000)).toBeGreaterThan(100);
    expect(settleFor(2_000_000)).toBeGreaterThanOrEqual(settleFor(150_000));
});
