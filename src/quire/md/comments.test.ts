// What is held true of the writer's notes: a note marks its words without changing the Markdown;
// the mark moves with the words through edits around them and inside them; a note whose words are
// deleted is kept and says so, and undo's document brings them back; notes go to notes.json in a
// `.quire` document and are found again after document.md was edited elsewhere. Run with
// `bun test src/quire`.

import { expect, test } from "bun:test";
import { addComment, changeComment, commentAt, deleteComment, inOrder, nextComment, notesData, spansOf, withNotes } from "./comments";
import { deleteText, insertText, splitBlock, toggleMark, type Document } from "./document";
import { opened, written } from "../core/quire-file";
import { read } from "./read";
import { write } from "./write";

const TEXT = "# Notes\n\nThe quick brown fox jumps over the lazy dog.\n\nA second _line_ here.\n";
const range = (path: number[], from: number, to: number) => ({ start: { path, offset: from }, end: { path, offset: to } });
const words = (doc: Document, id: string) => (spansOf(doc).get(id) ?? []).map((span) => span);

test("a note marks its words and leaves the Markdown byte for byte, even a block written in an unusual way", () => {
    const { doc, id } = addComment(read(TEXT), range([2], 2, 8), "Is this right?", 1000);
    expect(id).toBeDefined();
    expect(write(doc)).toBe(TEXT);
    expect(doc.comments).toEqual([{ id: id!, text: "Is this right?", created: 1000, quote: "second" }]);
    expect(words(doc, id!)).toEqual([{ path: [2], from: 2, to: 8 }]);
});

test("a note with no words or no text is not added", () => {
    expect(addComment(read(TEXT), range([1], 3, 3), "x").id).toBeUndefined();
    expect(addComment(read(TEXT), range([1], 0, 3), "  ").id).toBeUndefined();
});

test("the mark moves with its words as text is typed before them, inside them, and the line is split", () => {
    let { doc, id } = addComment(read(TEXT), range([1], 4, 15), "colour", 1);
    doc = insertText(doc, { path: [1], offset: 0 }, "So: ");
    expect(words(doc, id!)).toEqual([{ path: [1], from: 8, to: 19 }]);
    // typed inside the words, the new letters join them; typed at their end, they stay outside
    doc = insertText(doc, { path: [1], offset: 13 }, "-ish");
    doc = insertText(doc, { path: [1], offset: 23 }, "!");
    expect(words(doc, id!)).toEqual([{ path: [1], from: 8, to: 23 }]);
    doc = toggleMark(doc, range([1], 8, 12), "bold");
    expect(words(doc, id!)).toEqual([{ path: [1], from: 8, to: 23 }]);
    doc = splitBlock(doc, { path: [1], offset: 0 });
    expect(words(doc, id!)).toEqual([{ path: [2], from: 8, to: 23 }]);
    expect(commentAt(doc, { path: [2], offset: 10 })).toBe(id);
    expect(commentAt(doc, { path: [2], offset: 2 })).toBeUndefined();
});

test("a note across two lines marks both, and its words are found as two stretches", () => {
    const { doc, id } = addComment(read(TEXT), { start: { path: [1], offset: 40 }, end: { path: [2], offset: 8 } }, "both", 1);
    expect(words(doc, id!)).toEqual([
        { path: [1], from: 40, to: 44 },
        { path: [2], from: 0, to: 8 },
    ]);
    expect(doc.comments![0]!.quote).toBe("dog. A second");
});

test("a note whose words are deleted is kept, with the words it was on, until it is deleted itself", () => {
    const added = addComment(read(TEXT), range([1], 4, 9), "fast?", 1);
    const cut = deleteText(added.doc, range([1], 0, 20));
    expect(spansOf(cut).has(added.id!)).toBe(false);
    expect(cut.comments).toHaveLength(1);
    expect(inOrder(cut).map((each) => each.id)).toEqual([added.id!]);
    // the document before the cut still has its mark, as undo gives it back
    expect(spansOf(added.doc).get(added.id!)).toHaveLength(1);
    const gone = deleteComment(cut, added.id!);
    expect(gone.comments).toBeUndefined();
});

test("resolve, reopen, edit and delete change only the note; delete takes its mark off and keeps the source", () => {
    let { doc, id } = addComment(read(TEXT), range([2], 2, 8), "first", 1);
    doc = changeComment(doc, id!, { resolved: true });
    expect(doc.comments![0]!.resolved).toBe(true);
    expect(commentAt(doc, { path: [2], offset: 4 })).toBeUndefined();
    doc = changeComment(doc, id!, { resolved: false, text: "second thoughts" });
    expect(doc.comments![0]).toMatchObject({ text: "second thoughts" });
    expect(doc.comments![0]!.resolved).toBeUndefined();
    doc = deleteComment(doc, id!);
    expect(spansOf(doc).size).toBe(0);
    expect(doc.blocks[2]!.source).toBe("A second _line_ here.");
    expect(write(doc)).toBe(TEXT);
});

test("next and previous go through the open notes in the order of their words, round again", () => {
    let doc = read(TEXT);
    const late = addComment(doc, range([2], 0, 1), "late", 1);
    const early = addComment(late.doc, range([1], 0, 3), "early", 2);
    const third = addComment(early.doc, range([1], 10, 15), "middle", 3);
    doc = changeComment(third.doc, late.id!, { resolved: true });
    expect(nextComment(doc, undefined, 1)).toBe(early.id);
    expect(nextComment(doc, early.id, 1)).toBe(third.id);
    expect(nextComment(doc, third.id, 1)).toBe(early.id);
    expect(nextComment(doc, early.id, -1)).toBe(third.id);
});

test("in a .quire document notes go to notes.json, never into document.md, and come back marked", () => {
    const quire = { ...read(TEXT), quire: { page: { size: "A4" as const, orientation: "portrait" as const, margins: 25 }, notes: { quire: 1, other: "kept" } } };
    const { doc, id } = addComment(quire, range([1], 4, 15), "colour", 5);
    const saved = written(doc, write);
    expect(saved.text).toBe(TEXT);
    expect(saved.quire!.notes).toContain('"other": "kept"');
    expect(saved.quire!.notes).toContain('"quote":"quick brown"');
    const back = opened(saved.text, saved.quire);
    expect(back.comments).toEqual([{ id: id!, text: "colour", created: 5, quote: "quick brown" }]);
    expect(words(back, id!)).toEqual([{ path: [1], from: 4, to: 15 }]);
});

test("notes are found again after document.md was changed elsewhere; one whose words are gone is kept and counted", () => {
    let doc = addComment(read(TEXT), range([1], 4, 15), "colour", 1).doc;
    doc = addComment(doc, range([2], 2, 8), "count", 2).doc;
    const data = JSON.parse(JSON.stringify(notesData(doc)));
    const edited = "# Notes\n\nA new first line.\n\nThe quick brown fox, the lazy dog.\n\nA _line_ here.\n";
    const { doc: back, lost } = withNotes(read(edited), data);
    expect(lost).toBe(1);
    expect(back.comments).toHaveLength(2);
    const [colour, count] = back.comments!;
    expect(words(back, colour!.id)).toEqual([{ path: [2], from: 4, to: 15 }]);
    expect(spansOf(back).has(count!.id)).toBe(false);
    expect(count!.quote).toBe("second");
    // what cannot be read is left out, and the document opens as it is
    expect(withNotes(read(TEXT), "nonsense").doc.comments).toBeUndefined();
    expect(withNotes(read(TEXT), { comments: [{ id: 3 }, null] }).doc.comments).toBeUndefined();
});

test("a note's words are found again whole, not inside a longer word, when the block they were in has changed", () => {
    const note = (quote: string, before: string, from: number) => ({ comments: [{ id: "a", text: "c", parts: [{ block: 0, hash: "changed", from, to: from + quote.length, quote, before }] }] });
    // a note on "is" at the start of its paragraph, which has since gained words before it
    const { doc } = withNotes(read("This is it.\n"), note("is", "", 0));
    expect(words(doc, "a")).toEqual([{ path: [0], from: 5, to: 7 }]);
    // a short quote whose words before it are gone is not put just anywhere
    expect(spansOf(withNotes(read("Thistle.\n"), note("is", "The cat sat. Th", 12)).doc).has("a")).toBe(false);
    // a longer one is found whole
    expect(words(withNotes(read("Elsewhere the quick fox ran.\n"), note("quick fox", "Gone ", 5)).doc, "a")).toEqual([{ path: [0], from: 14, to: 23 }]);
});
