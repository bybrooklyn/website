// What reading is held to: every file on the site, and every construct written by hand, comes back
// from read and write as the very same bytes, and is read into the blocks and runs it means. Run
// with `bun test src/quire`.

import { expect, test } from "bun:test";
import { Glob } from "bun";
import { blockAt, blockPaths, fields, type Block, type Document, type List, type Paragraph, type Run } from "./document";
import { parseInline, read } from "./read";
import { write } from "./write";

const root = `${import.meta.dir}/../../`;

/** Every Markdown file the round trip is checked on: all of the site's content, and the notes at the top of the repo. */
async function siteFiles(): Promise<string[]> {
    const content = await Array.fromAsync(new Glob("src/content/**/*.{md,mdx}").scan({ cwd: root }));
    return [...content.sort(), "README.md", "docs/minis.md", "STYLE.md", "src/mote/README.md"];
}

/** A document with every source cleared, so that every block is written fresh. */
function fresh(doc: Document): Document {
    const clear = (value: unknown): unknown => {
        if (Array.isArray(value)) return value.map(clear);
        if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).filter(([key]) => key !== "source").map(([key, inner]) => [key, clear(inner)]));
        return value;
    };
    return { ...doc, blocks: clear(doc.blocks) as Block[] };
}

/** What a document means, without the text it was read from. */
function meaning(blocks: Block[]): unknown {
    const strip = (value: unknown): unknown => {
        if (Array.isArray(value)) return value.map(strip);
        if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).filter(([key]) => key !== "source" && key !== "gap").map(([key, inner]) => [key, strip(inner)]));
        return value;
    };
    return strip(blocks);
}

const same = (source: string, mdx = false) => expect(write(read(source, { mdx }))).toBe(source);

test("every Markdown and MDX file on the site reads and writes back as the identical bytes", async () => {
    const files = await siteFiles();
    expect(files.length).toBeGreaterThan(20);
    let checked = 0;
    for (const file of files) {
        const source = await Bun.file(root + file).text();
        expect(source.length).toBeGreaterThan(0);
        expect({ file, written: write(read(source, { mdx: file.endsWith(".mdx") })) }).toEqual({ file, written: source });
        checked++;
    }
    expect(checked).toBe(files.length);
    console.log(`round trip: ${checked} files checked byte for byte`);
});

test("every file on the site, written wholly fresh, reads back to the same blocks and runs", async () => {
    for (const file of await siteFiles()) {
        const doc = read(await Bun.file(root + file).text(), { mdx: file.endsWith(".mdx") });
        const again = read(write(fresh(doc)), { mdx: doc.mdx });
        expect({ file, blocks: meaning(again.blocks) }).toEqual({ file, blocks: meaning(doc.blocks) });
    }
});

test("the site's resume is read as headings and lists between its components, not as one raw block", async () => {
    const doc = read(await Bun.file(`${root}src/content/resume/resume.mdx`).text(), { mdx: true });
    expect(doc.blocks.filter((block) => block.kind === "heading").length).toBeGreaterThan(3);
    expect(doc.blocks.filter((block) => block.kind === "list").length).toBeGreaterThan(5);
});

test("line endings, final newlines, tabs and trailing spaces all come back exactly", () => {
    const cases = [
        "",
        "\n",
        "\n\n\n",
        "  \n\t\n",
        "One line, no newline",
        "One line\n",
        "One line\n\n",
        "One line\n\n\n",
        "\n\nStarts after blank lines\n",
        "First\r\nSecond\r\n\r\nThird\r\n",
        "CRLF with no final newline\r\n\r\nend",
        "Mixed\r\nendings\n\nhere\r\n",
        "\tTabbed start\n",
        "Trailing spaces   \n\nand tabs\t\t\n",
        "Para one\nPara one continued\n# Heading right after\nText right after\n",
        "﻿A file with a byte order mark\n",
        "Ends with spaces on the last line   ",
        "Two blank lines\n\n\nbetween blocks\n",
        "A gap of spaces\n   \n\t\nafter\n",
    ];
    for (const source of cases) same(source);
});

test("frontmatter is kept as text, in CRLF files too, and a body line that starts with --- does not end it", () => {
    const crlf = "---\r\ntitle: Hello\r\ndate: 2026-11-12\r\n---\r\n\r\nBody\r\n";
    same(crlf);
    const doc = read(crlf);
    expect(doc.frontmatter).toBe("---\r\ntitle: Hello\r\ndate: 2026-11-12\r\n---\r\n");
    expect(doc.eol).toBe("\r\n");
    expect(fields(doc)).toEqual([
        ["title", "Hello"],
        ["date", "2026-11-12"],
    ]);

    const tricky = "---\ntitle: x\n---not the end\nsummary: 'it''s'\n---\nBody\n\n---\n\nAfter a divider\n";
    same(tricky);
    const parsed = read(tricky);
    expect(parsed.frontmatter).toBe("---\ntitle: x\n---not the end\nsummary: 'it''s'\n---\n");
    expect(fields(parsed)).toContainEqual(["summary", "it's"]);
    expect(parsed.blocks.map((block) => block.kind)).toEqual(["paragraph", "divider", "paragraph"]);

    same("---\ntitle: only frontmatter\n---");
    same("---\nnever closed\n\nBody\n");
    expect(read("---\nnever closed\n\nBody\n").frontmatter).toBeNull();
});

test("emphasis spelled with _ or *, and __ or **, comes back as written and means the same", () => {
    for (const source of ["_italic_ and *italic*\n", "__bold__ and **bold**\n", "***both*** and ___both___ and **_mixed_**\n", "snake_case_name stays plain\n", "~~struck~~ and ~also~\n"]) same(source);
    const runs = (read("_a_ *b* __c__ **d** ~~e~~\n").blocks[0] as Paragraph).runs;
    const marked = runs.filter((run) => run.kind === "text" && run.marks.length).map((run) => run.kind === "text" && [run.text, run.marks.join()]);
    expect(marked).toEqual([
        ["a", "italic"],
        ["b", "italic"],
        ["c", "bold"],
        ["d", "bold"],
        ["e", "strike"],
    ]);
    expect(runText(read("snake_case_name\n").blocks[0]!)).toBe("snake_case_name");
});

test("list markers, numbering and tight or loose spacing all come back as written", () => {
    const cases = ["- dash\n- dash\n", "* star\n* star\n", "+ plus\n+ plus\n", "1. one\n1. one\n1. one\n", "3) three\n4) four\n", "- tight\n- list\n", "- loose\n\n- list\n", "-   wide marker gap\n-   again\n", " - indented one space\n - again\n", "1. ten\n2. eleven\n10. twelve\n"];
    for (const source of cases) same(source);
    const loose = read("- a\n\n- b\n").blocks[0] as List;
    const tight = read("- a\n- b\n").blocks[0] as List;
    expect([loose.loose, tight.loose]).toEqual([true, false]);
    const numbered = read("3) three\n4) four\n").blocks[0] as List;
    expect([numbered.style, numbered.start, numbered.delimiter]).toEqual(["number", 3, ")"]);
    expect((read("* a\n- b\n").blocks as List[]).map((block) => block.marker)).toEqual(["*", "-"]);
});

test("nested lists and task lists are read into items that hold blocks", () => {
    const source = "- one\n  - one and a half\n    - deeper\n- two\n\n  a second paragraph in two\n- [ ] open task\n- [x] done task\n";
    same(source);
    const list = read(source).blocks[0] as List;
    expect(list.items.length).toBe(4);
    const nested = list.items[0]!.blocks[1] as List;
    expect(nested.kind).toBe("list");
    expect(runText(nested.items[0]!.blocks[0]!)).toBe("one and a half");
    expect((nested.items[0]!.blocks[1] as List).items.length).toBe(1);
    expect(list.items[1]!.blocks.map((block) => block.kind)).toEqual(["paragraph", "paragraph"]);
    expect(list.items.map((item) => item.checked)).toEqual([undefined, undefined, false, true]);
    expect(runText(list.items[2]!.blocks[0]!)).toBe("open task");

    const tasks = read("- [ ] a\n- [X] b\n").blocks[0] as List;
    expect(tasks.style).toBe("task");
    same("1. [ ] numbered task\n2. [x] done\n");
    same("- item\n\n      indented code in an item\n");
    same("- lazy\ncontinuation line\n- next\n");
    expect(((read("- lazy\ncontinuation line\n").blocks[0] as List).items[0]!.blocks[0] as Paragraph).runs).toEqual([{ kind: "text", text: "lazy\ncontinuation line", marks: [] }]);
});

test("footnotes are read as references and as definitions holding blocks", () => {
    const source = "A claim.[^1] Another.[^note]\n\n[^1]: The source.\n[^note]: A longer note\n    that runs on.\n\n    And a second paragraph.\n";
    same(source);
    const doc = read(source);
    const runs = (doc.blocks[0] as Paragraph).runs;
    expect(runs.filter((run) => run.kind === "footnote")).toEqual([
        { kind: "footnote", label: "1" },
        { kind: "footnote", label: "note" },
    ]);
    expect(doc.blocks.slice(1).map((block) => block.kind === "footnote" && [block.label, block.blocks.length])).toEqual([
        ["1", 1],
        ["note", 2],
    ]);
});

test("pictures inside text, hard breaks, entities and inline HTML are runs, not raw blocks", () => {
    const source = "Text with ![a cat](/cat.png \"Cat\") inside.  \nA hard break before this, and one after\\\nthis. A &copy; sign, &#x41;, an unknown &frac12;, <kbd>Ctrl</kbd> keys, and <!-- a comment -->.\n";
    same(source);
    const doc = read(source);
    expect(doc.blocks.length).toBe(1);
    const runs = (doc.blocks[0] as Paragraph).runs;
    expect(runs.find((run) => run.kind === "image")).toEqual({ kind: "image", src: "/cat.png", alt: "a cat", title: "Cat" });
    expect(runs.filter((run) => run.kind === "break").length).toBe(2);
    expect(runs.filter((run) => run.kind === "html").map((run) => run.kind === "html" && run.html)).toEqual(["&frac12;", "<kbd>", "</kbd>", "<!-- a comment -->"]);
    expect(runText(doc.blocks[0]!)).toContain("A © sign, A, an unknown");
});

test("links of every kind are read with their address and title", () => {
    const source = "An [inline](https://a.example \"A\") link, a [reference][ref], a [shortcut], <https://auto.example>, and [**bold** text](</with space>).\n\n[ref]: https://ref.example\n[shortcut]: /short 'Short'\n";
    same(source);
    const links = (read(source).blocks[0] as Paragraph).runs.filter((run) => run.kind === "link");
    expect(links.map((run) => run.kind === "link" && [run.href, run.title, run.ref])).toEqual([
        ["https://a.example", "A", undefined],
        ["https://ref.example", undefined, "ref"],
        ["/short", "Short", ""],
        ["https://auto.example", undefined, undefined],
        ["/with space", undefined, undefined],
    ]);
    expect(read(source).blocks[1]!.kind).toBe("raw");
});

test("raw HTML blocks are kept whole, a folding section is read as one, and Markdown in it is still read", () => {
    const source = '<p align="center">\n  <img src="logo.png">\n</p>\n\n<details>\n<summary>More</summary>\n\nHidden *text*.\n\n</details>\n\n<pre>\nkept\n\nwith blank lines\n</pre>\n\n<!-- a\ncomment -->\n';
    same(source);
    expect(read(source).blocks.map((block) => block.kind)).toEqual(["raw", "quote", "raw", "raw"]);
});

test("an MDX file keeps its imports, exports, components and expressions as raw blocks", () => {
    const source = [
        "---",
        "title: An MDX page",
        "---",
        "",
        'import Figure from "../components/Figure.astro";',
        'import { Thing } from "./thing";',
        "",
        "export const answer = 42;",
        "",
        "Some text with {answer} in it and an inline <Thing size={2} />.",
        "",
        '<Figure src="/a.webp" alt="A picture" width={960}',
        '  caption="Over two lines" />',
        "",
        "<Thing>",
        "",
        "- markdown inside a component",
        "",
        "</Thing>",
        "",
        "{/* a comment */}",
        "",
        "{",
        "  [1, 2].map((n) => n * 2)",
        "}",
        "",
        "    <Indented />",
        "",
    ].join("\n");
    same(source, true);
    const doc = read(source, { mdx: true });
    expect(doc.blocks.map((block) => block.kind)).toEqual(["raw", "raw", "paragraph", "raw", "raw", "list", "raw", "raw", "raw", "raw"]);
    const runs = (doc.blocks[2] as Paragraph).runs;
    expect(runs.filter((run) => run.kind === "html").map((run) => run.kind === "html" && run.html)).toEqual(["{answer}", "<Thing size={2} />"]);
});

test("headings, quotes, code, tables and dividers of every spelling come back exactly", () => {
    const cases = [
        "# One\n## Two ##\n###### Six\n",
        "Setext one\n===\n\nSetext two\n---\n",
        "> quoted\nlazy line\n> > nested\n",
        ">no space\n>\n> after an empty line\n",
        "```ts title=\"x\"\nconst a = 1;\n```\n",
        "~~~\ntilde fence\n~~~\n",
        "````\n```\nfence in fence\n```\n````\n",
        "```\nnever closed\n",
        "    indented code\n\n    more\n",
        "| a | b |\n|:--|--:|\n| 1 | 2 |\n",
        "a | b\n--- | :-:\nno | pipes at ends\n",
        "| one column |\n| --- |\n",
        "***\n\n- - -\n\n___\n",
        "Paragraph\n***\nthen more\n",
    ];
    for (const source of cases) same(source);
    expect(read("# One\n## Two ##\n").blocks.map((block) => block.kind === "heading" && [block.level, runText(block)])).toEqual([
        [1, "One"],
        [2, "Two"],
    ]);
    expect(read("Setext one\n===\n").blocks[0]).toMatchObject({ kind: "heading", level: 1 });
    expect(read("```ts title=\"x\"\nconst a = 1;\n```\n").blocks[0]).toMatchObject({ kind: "code", language: 'ts title="x"', code: "const a = 1;" });
    expect(read("    indented code\n\n    more\n").blocks[0]).toMatchObject({ kind: "code", code: "indented code\n\nmore" });
    const table = read("| a | b | c |\n|:--|:-:|--:|\n| 1 | `x \\| y` |\n").blocks[0]!;
    expect(table.kind === "table" && [table.align, table.rows[0]!.map((cell) => cell.map((run) => run.kind === "text" && run.text).join(""))]).toEqual([
        ["left", "center", "right"],
        ["1", "x | y", ""],
    ]);
    const quote = read("> quoted\nlazy line\n> > nested\n").blocks[0]!;
    expect(quote.kind === "quote" && quote.blocks.map((block) => block.kind)).toEqual(["paragraph", "quote"]);
    expect(read("Paragraph\n***\nthen more\n").blocks.map((block) => block.kind)).toEqual(["paragraph", "divider", "paragraph"]);
});

test("a picture alone in a paragraph is an image block", () => {
    same("![A tower](/tower.png)\n");
    expect(read("![A tower](/tower.png \"Tall\")\n").blocks[0]).toMatchObject({ kind: "image", src: "/tower.png", alt: "A tower", title: "Tall" });
});

test("color, size and underline written as small HTML are read back as marks", () => {
    const runs = parseInline('<span style="color:#c33">red</span>, <span style="font-size:1.5em">big</span>, <span style="color:teal; font-size:2em">both **bold**</span> and <u>under</u>');
    expect(runs).toEqual([
        { kind: "text", text: "red", marks: [], color: "#c33" },
        { kind: "text", text: ", ", marks: [] },
        { kind: "text", text: "big", marks: [], size: "1.5em" },
        { kind: "text", text: ", ", marks: [] },
        { kind: "text", text: "both ", marks: [], color: "teal", size: "2em" },
        { kind: "text", text: "bold", marks: ["bold"], color: "teal", size: "2em" },
        { kind: "text", text: " and ", marks: [] },
        { kind: "text", text: "under", marks: ["underline"] },
    ]);
    const other = parseInline('<span class="x">not ours</span>');
    expect(other.map((run) => run.kind)).toEqual(["html", "text", "html"]);
});

test("a block wrapped in a div with an align is read as that block, aligned", () => {
    const source = '<div align="center">\n\n## Centred\n\n</div>\n\n<div align="right">\n\nRight *text*.\n\n</div>\n';
    same(source);
    expect(read(source).blocks.map((block) => block.kind !== "raw" && block.kind !== "divider" && "align" in block && [block.kind, block.align])).toEqual([
        ["heading", "center"],
        ["paragraph", "right"],
    ]);
    expect(read('<div align="center">\n\nOne\n\nTwo\n\n</div>\n').blocks[0]!.kind).toBe("raw");
});

test("the old editor's mistakes are gone: a single newline gap stays single and nothing is lost at the end", () => {
    for (const source of ["# Title\nText under it\n", "Text\n```\ncode\n```\nText\n", "- a\n- b\nText after a list", "End with two newlines\n\n"]) same(source);
});

function runText(block: Block): string {
    const runs: Run[] = block.kind === "paragraph" || block.kind === "heading" ? block.runs : [];
    return runs.map((run) => (run.kind === "text" ? run.text : "")).join("");
}

test("an empty list item, quote or footnote holds one empty line the cursor can go into, and is written back exactly as it was", () => {
    for (const source of ["- a\n-\n- b\n", "> \n", ">\n", "[^1]: \n", "- [ ]\n", "1.\n", "- a\n  - b\n  -\n"]) {
        const doc = read(source);
        same(source);
        const leaves = blockPaths(doc).filter((path) => blockAt(doc, path)?.kind === "paragraph");
        expect({ source, places: leaves.length > 0 }).toEqual({ source, places: true });
    }
    const items = (read("- a\n-\n- b\n").blocks[0] as List).items;
    expect(items.map((item) => item.blocks.length)).toEqual([1, 1, 1]);
});

test("only a definition block defines a link: a line that looks like one in code or inside a paragraph does not", () => {
    const linkIn = (source: string) => {
        const block = read(source).blocks.find((each) => each.kind === "paragraph" && runText(each).startsWith("see"));
        return block?.kind === "paragraph" && block.runs.some((run) => run.kind === "link");
    };
    expect(linkIn("```\n[a]: http://evil\n```\n\nsee [a]\n")).toBe(false);
    expect(linkIn("    [a]: http://evil\n\nsee [a]\n")).toBe(false);
    expect(linkIn("text\n[a]: http://evil\n\nsee [a]\n")).toBe(false);
    expect(linkIn("see [a]\n\n[a]: http://good\n")).toBe(true);
    expect(linkIn("see [a]\n\n> [a]: http://good\n")).toBe(true);
    same("```\n[a]: http://evil\n```\n\nsee [a]\n");
});
