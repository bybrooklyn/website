// What the bar's buttons are held to: given a document and a selection, each writes the Markdown it
// says it will, puts the cursor where the next words go, and shows as pressed when it is in force.
// Run with `bun test src/quire`.

import { expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { browser, chromium } from "../../scripts/browser";
import { addCode, addDivider, applyFormat, BASE_SIZE, clearFormat, FOLDS, formatAt, indentBy, nextSize, SIZE_STEPS, sizeNumber, sizeValue, typedSize, addFootnote, addImage, addTable, align, aligned, center, spacedAt, spacing, color, currentStyle, FLAGS, font, FONTS, highlight, link, linkAt, pressedAt, setStyleOf, size, toggle, toggleList, wordAt, type Action } from "./bar";
import { collect } from "./styling";
import { markdownOnly, type Paragraph, type TextRun } from "./document";
import type { Selection } from "./document";
import type { State } from "./history";
import { caret } from "./keys";
import { read } from "./read";
import { write } from "./write";

const at = (source: string, selection: Selection): State => ({ doc: read(source), selection });
const span = (path: number[], from: number, to: number): Selection => ({ anchor: { path, offset: from }, focus: { path, offset: to } });
const run = (action: Action, state: State) => action(state);
const md = (state: State) => write(state.doc);

test("a typeface and a highlight go on the selection of a .quire document, kept in its style and not in its Markdown", () => {
    const state = { ...at("a word here\n", span([0], 2, 6)), doc: { ...read("a word here\n"), quire: { page: { size: "A4" as const, orientation: "portrait" as const, margins: 25 }, notes: null } } };
    const styled = run(highlight("#ff9a56"), run(font("serif"), state));
    expect((styled.doc.blocks[0] as Paragraph).runs[1]).toEqual({ kind: "text", text: "word", marks: [], font: "serif", highlight: "#ff9a56" });
    const { markdown, style } = collect(styled.doc);
    expect(markdown).toBe("a word here\n");
    expect(style.runs[0]).toMatchObject({ quote: "word", font: "serif", highlight: "#ff9a56" });
    expect(((run(font(null), styled).doc.blocks[0] as Paragraph).runs as TextRun[]).some((each) => each.font)).toBe(false);
});

test("the typefaces offered are the site's two and the system's three, and the palette has both flags", () => {
    expect(FONTS.map(([, value]) => value)).toEqual([null, "torrens", "drafting", "serif", "sans", "mono"]);
    expect(FLAGS.map((each) => each.value)).toEqual(["#5bcefa", "#f5a9b8", "#ffffff", "#d52d00", "#ff9a56", "#d362a4", "#a30262"]);
});

test("what only a .quire document keeps is taken off blocks going into a Markdown file, and the rest stays", () => {
    const styled = run(font("mono"), run(color("red"), at("a word here\n", span([0], 2, 6))));
    const blocks = markdownOnly([{ ...(styled.doc.blocks[0] as Paragraph), align: "justify", spacing: 2 }]);
    expect(blocks[0]).toMatchObject({ kind: "paragraph", runs: [{ text: "a " }, { text: "word", color: "red" }, { text: " here" }] });
    expect((blocks[0] as Paragraph).align).toBeUndefined();
    expect((blocks[0] as Paragraph).spacing).toBeUndefined();
    expect(((blocks[0] as Paragraph).runs as TextRun[]).some((each) => each.font)).toBe(false);
});

test("the mark buttons mark the selection, and with nothing selected wait for the next words", () => {
    expect(md(run(toggle("bold"), at("a word here\n", span([0], 2, 6))))).toBe("a **word** here\n");
    expect(md(run(toggle("italic"), at("a word here\n", span([0], 2, 6))))).toBe("a *word* here\n");
    expect(md(run(toggle("underline"), at("a word here\n", span([0], 2, 6))))).toBe("a <u>word</u> here\n");
    expect(md(run(toggle("strike"), at("a word here\n", span([0], 2, 6))))).toBe("a ~~word~~ here\n");
    expect(md(run(toggle("code"), at("a word here\n", span([0], 2, 6))))).toBe("a `word` here\n");
    const waiting = run(toggle("bold"), at("text\n", caret([0], 4)));
    expect(waiting.marks).toEqual(["bold"]);
    expect(waiting.doc).toEqual(read("text\n"));
});

test("a link is set on the selection, on the word at the cursor, and taken off the whole link", () => {
    expect(md(run(link("https://a.example"), at("a word here\n", span([0], 2, 6))))).toBe("a [word](https://a.example) here\n");
    expect(md(run(link("/b"), at("a word here\n", caret([0], 4))))).toBe("a [word](/b) here\n");
    const linked = at("a [long link](/x) here\n", caret([0], 4));
    expect(linkAt(linked.doc, linked.selection.focus)?.href).toBe("/x");
    expect(md(run(link(null), linked))).toBe("a long link here\n");
    expect(wordAt(read("one two\n"), { path: [0], offset: 5 })).toEqual({ start: { path: [0], offset: 4 }, end: { path: [0], offset: 7 } });
});

test("color and size are written as small HTML on the selection or the word at the cursor", () => {
    expect(md(run(color("salmon"), at("a word here\n", span([0], 2, 6))))).toBe('a <span style="color:salmon">word</span> here\n');
    expect(md(run(size("1.25em"), at("a word here\n", caret([0], 3))))).toBe('a <span style="font-size:1.25em">word</span> here\n');
    expect(md(run(color(null), at('a <span style="color:red">word</span>\n', caret([0], 3))))).toBe("a word\n");
});

test("the style picker makes headings, quotes, code and paragraphs, and shows which the cursor is in", () => {
    const heading = run(setStyleOf("heading2"), at("Title\n", caret([0], 2)));
    expect(md(heading)).toBe("## Title\n");
    expect(currentStyle(heading.doc, [0])).toBe("heading2");
    expect(md(run(setStyleOf("paragraph"), heading))).toBe("Title\n");
    const quoted = run(setStyleOf("quote"), at("Said\n", caret([0], 1)));
    expect(md(quoted)).toBe("> Said\n");
    expect(quoted.selection).toEqual(caret([0, 0], 1));
    expect(currentStyle(quoted.doc, [0, 0])).toBe("quote");
    expect(md(run(setStyleOf("quote"), quoted))).toBe("Said\n");
    expect(md(run(setStyleOf("code"), at("let a\n", caret([0], 0))))).toBe("```\nlet a\n```\n");
    expect(md(run(setStyleOf("heading1"), at("One\n\nTwo\n", span([0], 0, 0))))).toBe("# One\n\nTwo\n");
    expect(md(run(setStyleOf("heading3"), at("One\n\nTwo\n", { anchor: { path: [0], offset: 1 }, focus: { path: [1], offset: 1 } })))).toBe("### One\n\n### Two\n");
});

test("the list buttons make lists of all the touched paragraphs, and pressed again take them off", () => {
    const listed = run(toggleList("bullet"), at("One\n\nTwo\n", { anchor: { path: [0], offset: 0 }, focus: { path: [1], offset: 3 } }));
    expect(md(listed)).toBe("- One\n- Two\n");
    expect(listed.selection.focus).toEqual({ path: [0, 1, 0], offset: 3 });
    expect(pressedAt(listed.doc, [0, 1, 0], []).bullet).toBe(true);
    expect(md(run(toggleList("bullet"), listed))).toBe("One\n\nTwo\n");
    expect(md(run(toggleList("number"), at("One\n", caret([0], 0))))).toBe("1. One\n");
    expect(md(run(toggleList("task"), at("One\n", caret([0], 0))))).toBe("- [ ] One\n");
});

test("centre centres the cursor's block in a div and takes it off again", () => {
    const centred = run(center, at("Middle\n", caret([0], 0)));
    expect(md(centred)).toBe('<div align="center">\n\nMiddle\n\n</div>\n');
    expect(pressedAt(centred.doc, [0], []).center).toBe(true);
    expect(md(run(center, centred))).toBe("Middle\n");
});

test("the + menu adds a table, code, a divider, a picture and a footnote, the cursor where to write next", () => {
    const tabled = run(addTable, at("Above\n", caret([0], 5)));
    expect(md(tabled)).toBe("Above\n\n|     |     |     |\n| --- | --- | --- |\n|     |     |     |\n|     |     |     |\n");
    expect(tabled.selection).toEqual(caret([1, 0, 0], 0));
    // on an empty line the block takes the line's place
    const empty = run(addCode, { doc: read("A\n\nB\n"), selection: caret([0], 1) });
    expect(empty.selection).toEqual(caret([1], 0));
    expect(md(empty)).toBe("A\n\n```\n```\n\nB\n");
    const ruled = run(addDivider, at("Above\n", caret([0], 0)));
    expect(md(ruled)).toBe("Above\n\n---\n");
    expect(ruled.selection).toEqual(caret([2], 0));
    expect(md(run(addImage("/p.png", "A picture"), at("Above\n", caret([0], 0))))).toBe("Above\n\n![A picture](/p.png)\n");
    const noted = run(addFootnote, at("A claim.\n", caret([0], 8)));
    expect(md(noted)).toBe("A claim.[^1]\n\n[^1]: \n");
    expect(noted.selection).toEqual(caret([1, 0], 0));
});

test("alignment goes on every touched block: left is written as nothing, centre and right as Markdown can say them, and justified only in a .quire document's style", () => {
    const two = at("One\n\nTwo\n", { anchor: { path: [0], offset: 1 }, focus: { path: [1], offset: 1 } });
    const right = run(align("right"), two);
    expect(md(right)).toBe('<div align="right">\n\nOne\n\n</div>\n\n<div align="right">\n\nTwo\n\n</div>\n');
    expect(aligned(right.doc, [1])).toBe("right");
    expect(md(run(align("left"), right))).toBe("One\n\nTwo\n");
    expect(aligned(two.doc, [0])).toBe("left");
    const justified = run(align("justify"), { ...two, doc: { ...two.doc, quire: { page: { size: "A4" as const, orientation: "portrait" as const, margins: 25 }, notes: null } } });
    const { markdown, style } = collect(justified.doc);
    expect(markdown).toBe("One\n\nTwo\n");
    expect(style.blocks.map((each) => each.align)).toEqual(["justify", "justify"]);
    expect(write({ ...justified.doc, blocks: markdownOnly(justified.doc.blocks) })).toBe("One\n\nTwo\n");
});

test("line spacing goes on every touched paragraph, is kept in style.json and never in the Markdown, and Single takes it off", () => {
    const state = at("One\n\nTwo\n", { anchor: { path: [0], offset: 0 }, focus: { path: [1], offset: 0 } });
    const spaced = run(spacing(1.5), { ...state, doc: { ...state.doc, quire: { page: { size: "A4" as const, orientation: "portrait" as const, margins: 25 }, notes: null } } });
    expect(spacedAt(spaced.doc, [1])).toBe(1.5);
    const { markdown, style } = collect(spaced.doc);
    expect(markdown).toBe("One\n\nTwo\n");
    expect(style.blocks.map((each) => each.spacing)).toEqual([1.5, 1.5]);
    const single = run(spacing(1), spaced);
    expect(spacedAt(single.doc, [0])).toBe(1);
    expect((single.doc.blocks[0] as Paragraph).spacing).toBeUndefined();
    // a spacing already there is not a change, so the block keeps its source and is written as read
    expect(run(spacing(1), state).doc).toBe(state.doc);
});

test("the text color menu offers both flags' colors, written as a color Markdown keeps", () => {
    const state = at("a word here\n", span([0], 2, 6));
    expect(md(run(color(FLAGS[0]!.value), state))).toBe('a <span style="color:#5bcefa">word</span> here\n');
    expect(FLAGS.map((each) => each.name)).toContain("Dark rose");
});

test("the size is shown as a number: the text's own is 12, and the sizes a Markdown file keeps are 10, 15, 18 and 24", () => {
    expect(sizeNumber(undefined)).toBe(BASE_SIZE);
    expect(["0.85em", "1.25em", "1.5em", "2em"].map(sizeNumber)).toEqual([10, 15, 18, 24]);
    // each number is kept as the size it stands for, the text's own as no size at all
    for (const number of SIZE_STEPS) expect(sizeNumber(sizeValue(number) ?? undefined)).toBe(number);
    expect(sizeValue(12)).toBeNull();
    expect(sizeValue(14)).toBe("1.1667em");
});

test("minus and plus step a Markdown file through its sizes and a .quire document by one; a typed number goes to the nearest Markdown size", () => {
    expect(nextSize(12, 1, false)).toBe(15);
    expect(nextSize(12, -1, false)).toBe(10);
    expect(nextSize(10, -1, false)).toBe(10);
    expect(nextSize(24, 1, false)).toBe(24);
    expect(nextSize(12, 1, true)).toBe(13);
    expect(nextSize(6, -1, true)).toBe(6);
    expect(typedSize(14, false)).toBe(15);
    expect(typedSize(14, true)).toBe(14);
    expect(typedSize(400, true)).toBe(96);
});

test("plus on a word writes the next size a Markdown file keeps", () => {
    const state = at("a word here\n", span([0], 2, 6));
    expect(md(run(size(sizeValue(nextSize(12, 1, false))), state))).toBe('a <span style="font-size:1.25em">word</span> here\n');
});

test("paint format copies the marks and look of the selection and gives exactly those to the next, links kept", () => {
    const source = "**bold** and [a link](/x) here\n";
    const copied = formatAt(read(source), { path: [0], offset: 0 }, true);
    expect(copied.marks).toEqual(["bold"]);
    const painted = run(applyFormat(copied), at(source, span([0], 9, 15)));
    expect(md(painted)).toBe("**bold** and [**a link**](/x) here\n");
    // painting plain text over bold text takes the bold off
    expect(md(run(applyFormat({ marks: [] }), at("**all bold**\n", span([0], 0, 3))))).toBe("all **bold**\n");
});

test("clear formatting takes off marks and color and leaves the words and the link", () => {
    const state = at('*a* <span style="color:#5bcefa">word</span> [link](/y)\n', span([0], 0, 11));
    expect(md(run(clearFormat, state))).toBe("a word [link](/y)\n");
});

test("indent more puts a list item under the one before, indent less takes it back out, and outside a list nothing changes", () => {
    const state = at("- one\n- two\n", caret([0, 1, 0], 1));
    const deeper = run(indentBy(1), state);
    expect(md(deeper)).toBe("- one\n  - two\n");
    expect(md(run(indentBy(-1), deeper))).toBe("- one\n- two\n");
    const plain = at("Just a line\n", caret([0], 2));
    expect(run(indentBy(1), plain)).toBe(plain);
});

test("the tools fold in the order she gave: paint format, print, clear formatting, the indents, line spacing, before the rest", () => {
    const order = Object.entries(FOLDS).sort((a, b) => a[1] - b[1]).map(([name]) => name);
    expect(order.slice(0, 5)).toEqual(["paint", "print", "clear", "indent", "spacing"]);
});

test.skipIf(!chromium())(
    "the word count is made after a key, not inside it, and reads again only the block the key changed",
    async () => {
        const folder = await mkdtemp(join(tmpdir(), "quire-bar-"));
        const tab = await browser({ width: 1200, height: 800 });
        try {
            await Bun.write(
                `${folder}/page.ts`,
                `import { createSurface } from "${import.meta.dir}/surface.ts";
                import { createBar } from "${import.meta.dir}/bar.ts";
                import * as model from "${import.meta.dir}/document.ts";
                import { read } from "${import.meta.dir}/read.ts";
                const host = document.querySelector("#host");
                const sheet = document.createElement("div");
                host.append(sheet);
                const surface = createSurface(sheet, read(Array.from({ length: 5000 }, (_, index) => "Paragraph " + index + " of five words.").join("\\n\\n") + "\\n"));
                const bar = createBar(surface, { name: "Test" });
                host.prepend(bar.element, bar.statusLine);
                window.surface = surface;
                window.model = model;`,
            );
            const built = await Bun.build({ entrypoints: [`${folder}/page.ts`], target: "browser" });
            if (!built.success) throw new Error(built.logs.join("\n"));
            await Bun.write(`${folder}/page.html`, `<!doctype html><meta charset="utf-8"><div id="host"></div><script type="module">${await built.outputs[0]!.text()}</script>`);
            await tab.open(`file://${folder}/page.html`, 300);
            const count = () => tab.run<string>("document.querySelector('.quire-count').textContent");
            expect(await count()).toBe("25,000 words");
            // the key's own work, from the change to the last listener, leaves the count as it was
            const during = await tab.run<string>(`(() => {
                surface.focus();
                surface.setSelection({ anchor: { path: [2500], offset: 0 }, focus: { path: [2500], offset: 0 } });
                surface.run((doc, selection) => model.insertText(doc, selection.focus, "two more "));
                return document.querySelector(".quire-count").textContent;
            })()`);
            expect(during).toBe("25,000 words");
            await tab.wait(300);
            expect(await count()).toBe("25,002 words");
            expect(tab.errors).toEqual([]);
        } finally {
            await tab.close();
            await rm(folder, { recursive: true, force: true });
        }
    },
    60_000,
);
