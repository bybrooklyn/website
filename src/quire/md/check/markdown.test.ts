// Markdown tidiness: each rule with examples that must fire and examples that must not, and its fix
// where it has one.

import { expect, test } from "bun:test";
import { textAt } from "../document";
import { read } from "../read";
import { write } from "../write";
import { check, DEFAULTS } from "./engine";
import { inlines, MARKDOWN } from "./markdown";

const found = (markdown: string, rule: string, mdx = false) => check(read(markdown, { mdx }), { settings: DEFAULTS }, MARKDOWN).filter((one) => one.rule === rule);
const fires = (markdown: string, rule: string) => found(markdown, rule).length;
/** The Markdown after the first finding's first fix. */
const fixed = (markdown: string, rule: string, which = 0) => {
    const doc = read(markdown);
    const [one] = found(markdown, rule);
    return write(one!.fixes[which]!.edit(doc, one!.range));
};

test("heading levels that skip", () => {
    expect(fires("## A\n\n#### B\n", "heading-skip")).toBe(1);
    expect(fires("## A\n\n### B\n\n## C\n\n### D\n", "heading-skip")).toBe(0);
    expect(fires("### Starts low\n\n#### Fine\n", "heading-skip")).toBe(0);
    expect(fixed("## A\n\n#### B\n", "heading-skip")).toBe("## A\n\n### B\n");
});

test("more than one top heading, or one under a title in the frontmatter", () => {
    expect(fires("# One\n\n# Two\n", "heading-top")).toBe(1);
    expect(fires("# One\n\n## Two\n", "heading-top")).toBe(0);
    expect(fires("---\ntitle: Post\n---\n\n# Again\n", "heading-top")).toBe(1);
    expect(fixed("# One\n\n# Two\n", "heading-top")).toBe("# One\n\n## Two\n");
});

test("headings that repeat", () => {
    expect(fires("## Setup\n\ntext\n\n## setup\n", "heading-duplicate")).toBe(1);
    expect(fires("## Setup\n\n## Running\n", "heading-duplicate")).toBe(0);
});

test("links with no address and links with no words", () => {
    expect(fires("A [link]() here.\n", "link-empty")).toBe(1);
    expect(fires("A [link](https://example.com) here.\n", "link-empty")).toBe(0);
    expect(fixed("A [link]() here.\n", "link-empty")).toBe("A link here.\n");
    expect(fires("A [](https://example.com) here.\n", "link-no-text")).toBe(1);
    expect(fires("A [ok](https://example.com) and ![](x.png) here.\n", "link-no-text")).toBe(0);
    expect(fires("A [![Logo](logo.png)](https://example.com) here.\n", "link-no-text")).toBe(0);
});

test("pictures with no alt text, in a line and standing alone", () => {
    expect(fires("![](cat.png)\n", "image-alt")).toBe(1);
    expect(fires("Look ![](cat.png) here.\n", "image-alt")).toBe(1);
    expect(fires("![A cat asleep](cat.png)\n", "image-alt")).toBe(0);
});

test("bare web addresses, and a fix that makes them links", () => {
    expect(fires("See https://example.com/page for more.\n", "bare-url")).toBe(1);
    expect(fires("See [the page](https://example.com/page).\n", "bare-url")).toBe(0);
    expect(fires("Run `curl https://example.com` now.\n", "bare-url")).toBe(0);
    expect(fixed("See https://example.com/page for more.\n", "bare-url")).toBe("See [https://example.com/page](https://example.com/page) for more.\n");
});

test("spaces at a line's end and doubled spaces", () => {
    expect(fires("Words here \nand more\n", "trailing-space")).toBe(1);
    expect(fires("Words here\n", "trailing-space")).toBe(0);
    expect(fires("A line break  \nis meant\n", "trailing-space")).toBe(0);
    expect(fixed("Words here \nand more\n", "trailing-space")).toBe("Words here\nand more\n");
    expect(fires("Two  spaces.\n", "double-space")).toBe(1);
    expect(fires("One space. Then another.\n", "double-space")).toBe(0);
    expect(fires("After a stop.  Next.\n", "double-space")).toBe(0);
    expect(fixed("Two  spaces.\n", "double-space")).toBe("Two spaces.\n");
});

test("a list that changes its bullet halfway", () => {
    expect(fires("- one\n- two\n* three\n", "list-marker")).toBe(1);
    expect(fires("1. one\n2. two\n3) three\n", "list-marker")).toBe(1);
    expect(fires("- one\n- two\n\nText.\n\n* other\n", "list-marker")).toBe(0);
    expect(fixed("- one\n- two\n* three\n", "list-marker")).toBe("- one\n- two\n- three\n");
});

test("emphasis or code left open", () => {
    expect(fires("This is *not closed.\n", "stray-mark")).toBe(1);
    expect(fires("A lone ` backtick.\n", "stray-mark")).toBe(1);
    expect(fires("This is *closed* fine.\n", "stray-mark")).toBe(0);
    expect(fires("Two * three is six, and snake_case stays.\n", "stray-mark")).toBe(0);
    expect(fires("An escaped \\*star.\n", "stray-mark")).toBe(0);
});

test("footnotes with no text, and text never pointed to", () => {
    expect(fires("A claim.[^1]\n", "footnote-missing")).toBe(1);
    expect(fires("A claim.[^1]\n\n[^1]: The source.\n", "footnote-missing")).toBe(0);
    expect(fires("A claim.\n\n[^1]: The source.\n", "footnote-unused")).toBe(1);
    expect(fires("A claim.[^1]\n\n[^1]: The source.\n", "footnote-unused")).toBe(0);
});

test("tables with ragged rows", () => {
    expect(fires("| a | b |\n| - | - |\n| 1 | 2 | 3 |\n| 4 |\n", "table-ragged")).toBe(2);
    expect(fires("| a | b |\n| - | - |\n| 1 | 2 |\n", "table-ragged")).toBe(0);
});

test("inlines are found with their places in the text", () => {
    const doc = read("Go [here](a.md) and ![x](b.png) then.[^n]\n");
    const block = doc.blocks[0]!;
    expect(block.kind === "paragraph" && inlines(block.runs).map((one) => `${one.kind}:${one.from}-${one.to}:${one.href}`)).toEqual(["link:3-7:a.md", "image:12-13:b.png", "footnote:19-20:n"]);
    expect(textAt(doc, [0]).slice(3, 7)).toBe("here");
});
