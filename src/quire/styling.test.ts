// What a `.quire` document's styling is held to: its Markdown is plain, its look comes back whole
// when nothing else touched it, and when document.md was edited somewhere else the styling follows
// its words and blocks, and what lost its text is dropped without an error. Run with
// `bun test src/quire/styling.test.ts`.

import { expect, test } from "bun:test";
import { blockAt, setAlign, setStyle, type Document, type Paragraph, type TextRun } from "./document";
import { read } from "./read";
import { collect, hash, readStyle, restore } from "./styling";

const at = (path: number[], offset: number) => ({ path, offset });
const range = (path: number[], from: number, to: number) => ({ start: at(path, from), end: at(path, to) });
const runs = (doc: Document, path: number[]) => (blockAt(doc, path) as Paragraph).runs as TextRun[];

/** A document with a red word, a centred heading, a font, a highlight and spaced lines. */
function styled(): Document {
    let doc = read("# Title\n\nThe quick brown fox.\n\nSecond paragraph here.\n\n- one item\n- two item\n");
    doc = setAlign(doc, [0], "center");
    doc = setStyle(doc, range([1], 4, 9), { color: "#d52d00", font: "serif" });
    doc = setStyle(doc, range([2], 0, 6), { highlight: "#ff9a56" });
    doc = setStyle(doc, range([3, 1, 0], 0, 3), { size: "1.4em" });
    doc = { ...doc, blocks: doc.blocks.map((block, index) => (index === 2 && block.kind === "paragraph" ? { ...block, spacing: 1.5 } : block)) };
    return doc;
}

test("a .quire document's Markdown is plain: no span, no div, nothing but the words", () => {
    const { markdown, style } = collect(styled());
    expect(markdown).toBe("# Title\n\nThe quick brown fox.\n\nSecond paragraph here.\n\n- one item\n- two item\n");
    expect(style.blocks).toEqual([
        { block: 0, hash: hash("Title"), align: "center" },
        { block: 2, hash: hash("Second paragraph here."), spacing: 1.5 },
    ]);
    expect(style.runs.map((run) => [run.block, run.quote])).toEqual([
        [1, "quick"],
        [2, "Second"],
        [4, "two"],
    ]);
});

test("styling saved and opened again comes back exactly", () => {
    const doc = styled();
    const { markdown, style } = collect(doc);
    const back = restore(read(markdown), readStyle(JSON.stringify(style)));
    expect(collect(back).style).toEqual(style);
    expect(runs(back, [1])[1]).toEqual({ kind: "text", text: "quick", marks: [], color: "#d52d00", font: "serif" });
    expect((blockAt(back, [0]) as Paragraph).align).toBe("center");
    // what was read is still its source, so it is written back byte for byte
    expect(collect(back).markdown).toBe(markdown);
});

test("blocks added and removed around styled ones elsewhere do not lose their styling", () => {
    const { style } = collect(styled());
    const edited = read("A new first line.\n\n# Title\n\nSecond paragraph here.\n\nThe quick brown fox.\n\n- one item\n- two item\n");
    const back = restore(edited, style);
    expect((blockAt(back, [1]) as Paragraph).align).toBe("center");
    expect((blockAt(back, [2]) as Paragraph).spacing).toBe(1.5);
    expect(runs(back, [3])[1]).toMatchObject({ text: "quick", color: "#d52d00" });
    expect(runs(back, [0]).every((run) => !run.color)).toBe(true);
});

test("words styled in a line that was changed elsewhere are found again in it", () => {
    const { style } = collect(styled());
    const back = restore(read("# Title\n\nSo the quick brown fox ran.\n\nSecond paragraph here.\n"), style);
    expect(runs(back, [1]).find((run) => run.color)).toMatchObject({ text: "quick", font: "serif" });
});

test("styling whose words are gone is dropped, and the rest still applies", () => {
    const { style } = collect(styled());
    const back = restore(read("# Title\n\nA slow dog.\n\nSecond paragraph here.\n"), style);
    expect(runs(back, [1]).some((run) => run.color)).toBe(false);
    expect((blockAt(back, [0]) as Paragraph).align).toBe("center");
    expect(runs(back, [2])[0]).toMatchObject({ text: "Second", highlight: "#ff9a56" });
});

test("a block changed in place keeps its alignment only while the number of blocks is the same", () => {
    const { style } = collect(styled());
    expect((blockAt(restore(read("# A new title\n\nThe quick brown fox.\n\nSecond paragraph here.\n\n- one item\n- two item\n"), style), [0]) as Paragraph).align).toBe("center");
    expect((blockAt(restore(read("# A new title\n\nThe quick brown fox.\n"), style), [0]) as Paragraph).align).toBeUndefined();
});

test("a style.json that is broken, empty or strange opens as plain Markdown without an error", () => {
    const doc = read("# Title\n\nWords.\n");
    for (const broken of ["", "{", "null", "[]", '{"runs":[{"block":"x"}],"blocks":7,"page":{"size":"B9","margins":-4}}', '{"runs":[{"block":0,"hash":"0","from":0,"to":99,"quote":"nowhere","color":"red"}]}']) {
        const back = restore(doc, readStyle(broken));
        expect(collect(back).markdown).toBe("# Title\n\nWords.\n");
        expect(back.quire?.page).toEqual({ size: "A4", orientation: "portrait", margins: 25 });
    }
});

test("a long styled document is collected and restored quickly, as saving it after each pause needs", () => {
    const parts: string[] = [];
    for (let index = 0; parts.length < 5000; index++) parts.push(`## Section ${index}`, "", `A paragraph of ordinary length, with some words in it. Number ${index}.`, "", "- one point", "- another point", "");
    let doc = read(parts.slice(0, 5000).join("\n") + "\n");
    for (let index = 0; index < 500; index++) doc = setStyle(doc, range([index * 3 + 1], 2, 11), { color: "#d362a4" });
    const started = performance.now();
    const { markdown, style } = collect(doc);
    const back = restore(read(markdown), style);
    const took = performance.now() - started;
    expect(collect(back).style.runs.length).toBe(500);
    console.log(`5,000 lines with 500 styles: collected, read and restored in ${took.toFixed(0)} ms`);
    expect(took).toBeLessThan(400);
});

test("page setup is kept in style.json", () => {
    const doc = { ...read("Words.\n"), quire: { page: { size: "Letter" as const, orientation: "landscape" as const, margins: 18 }, notes: null } };
    const { style } = collect(doc);
    expect(readStyle(JSON.stringify(style)).page).toEqual({ size: "Letter", orientation: "landscape", margins: 18 });
});

test("a color written as HTML by hand in document.md is read, and moved to style.json when its line is next changed", () => {
    const doc = read('Some <span style="color:red">red</span> words.\n');
    const { markdown, style } = collect(doc);
    expect(markdown).toBe('Some <span style="color:red">red</span> words.\n');
    expect(style.runs[0]).toMatchObject({ quote: "red", color: "red" });
    const changed = setStyle(doc, range([0], 0, 4), { size: "2em" });
    expect(collect(changed).markdown).toBe("Some red words.\n");
});

test("style.json keeps a header, a footer and page numbers as a line of plain text each, and drops what is not", () => {
    const page = readStyle(JSON.stringify({ page: { size: "A5", header: "  My   book ", footer: 7, numbers: true } })).page;
    expect(page).toEqual({ size: "A5", orientation: "portrait", margins: 25, header: "My book", numbers: true });
    expect(readStyle(JSON.stringify({ page: { header: "", numbers: "yes" } })).page).toEqual({ size: "A4", orientation: "portrait", margins: 25 });
});

test("styled words looked for again are found whole, never inside a longer word", () => {
    let doc = read("is it red.\n\nOther.\n");
    doc = setStyle(doc, range([0], 0, 2), { color: "#d52d00" });
    const { style } = collect(doc);
    // the line changed elsewhere: "is" is now inside "This" first, and a word of its own further on
    const back = restore(read("This line: is it red.\n\nOther.\n"), style);
    const red = runs(back, [0]).filter((run) => run.color);
    expect(red.map((run) => run.text)).toEqual(["is"]);
    expect(runs(back, [0]).map((run) => run.text).join("")).toBe("This line: is it red.");
    expect(runs(back, [0])[0]!.text.startsWith("This line: ")).toBe(true);
});
