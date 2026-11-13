// The further Markdown, end to end through the reader and the writer: callouts, definition lists,
// folding sections, maths, superscript and subscript, `==marked==` text and emoji shortcodes. Each
// comes back byte for byte as written, with odd spacing, with CRLF, and inside lists and quotes;
// each is read into what it means; and each, written wholly fresh, reads back to the same meaning.

import { expect, test } from "bun:test";
import { addComment } from "./comments";
import { blockAt, changeKind, insertText, makeBox, makeDefinition, setBox, splitBlock, type Block, type Document, type List, type Quote } from "./document";
import { opened, written } from "./quire-file";
import { read } from "./read";
import { write } from "./write";

const same = (source: string, mdx = false) => expect({ source, written: write(read(source, { mdx })) }).toEqual({ source, written: source });

/** A document with every source cleared, so that every block is written fresh. */
function fresh(doc: Document): Document {
    const clear = (value: unknown): unknown => {
        if (Array.isArray(value)) return value.map(clear);
        if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).filter(([key]) => key !== "source").map(([key, inner]) => [key, clear(inner)]));
        return value;
    };
    return { ...doc, blocks: clear(doc.blocks) as Block[] };
}

/** What blocks mean, without the text they came from. */
function meaning(blocks: Block[]): unknown {
    const strip = (value: unknown): unknown => {
        if (Array.isArray(value)) return value.map(strip);
        if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).filter(([key]) => key !== "source" && key !== "gap").map(([key, inner]) => [key, strip(inner)]));
        return value;
    };
    return strip(blocks);
}

/** Written wholly fresh, a source reads back to what it meant. */
function meansTheSame(source: string, mdx = false) {
    const doc = read(source, { mdx });
    const again = write(fresh(doc));
    expect({ source, again, blocks: meaning(read(again, { mdx }).blocks) }).toEqual({ source, again, blocks: meaning(doc.blocks) });
    return again;
}

/** The same text with CRLF line endings, indented into a list item, and quoted: each must come back exactly too. */
function everywhere(source: string) {
    same(source);
    same(source.replace(/\n/g, "\r\n"));
    same(`- item\n\n${source.replace(/^(?=.)/gm, "  ").replace(/^ {2}/, "  ")}`);
    same(`> ${source.replace(/\n(?=.)/g, "\n> ").replace(/\n$/, "")}\n`);
    meansTheSame(source);
    meansTheSame(source.replace(/\n/g, "\r\n"));
}

// ---- callouts ----

test("callouts come back exactly, with their kind, title and blocks read", () => {
    for (const source of ["> [!NOTE]\n> Useful information.\n", "> [!warning] Mind the gap\n> A *second* line.\n>\n> - and a list\n", ">[!TIP]\n>No space after the marks.\n", "> [!IMPORTANT]\n", "> [!CAUTION]   \n>    Odd spacing.   \n"]) everywhere(source);
    const doc = read("> [!WARNING] Mind the gap\n> Text.\n");
    expect(doc.blocks[0]).toMatchObject({ kind: "quote", callout: "WARNING", title: "Mind the gap" });
    expect((doc.blocks[0] as Quote).blocks[0]).toMatchObject({ kind: "paragraph" });
    // an ordinary quote is not a callout, and a marker later in a quote is only text
    expect((read("> Just a quote\n").blocks[0] as Quote).callout).toBeUndefined();
    expect((read("> Text\n> [!NOTE]\n").blocks[0] as Quote).callout).toBeUndefined();
});

test("a callout written fresh is GitHub's form, and an empty one keeps a line to write on", () => {
    const doc = read("> [!NOTE]\n");
    expect((doc.blocks[0] as Quote).blocks).toHaveLength(1);
    expect(write(fresh(doc))).toBe("> [!NOTE]\n");
    const typed = insertText(doc, { path: [0, 0], offset: 0 }, "Hello");
    expect(write(typed)).toBe("> [!NOTE]\n> Hello\n");
    expect(write(setBox(read("> [!NOTE]\n> Hi\n"), [0], { callout: "TIP" }))).toBe("> [!TIP]\n> Hi\n");
});

test("a paragraph is made a callout, a quote becomes one, and a plain quote typed after a callout does not join it", () => {
    expect(write(makeBox(read("Take care.\n"), [0], { callout: "WARNING" }))).toBe("> [!WARNING]\n> Take care.\n");
    expect(write(makeBox(read("> Quoted.\n"), [0, 0], { callout: "NOTE" }))).toBe("> [!NOTE]\n> Quoted.\n");
    const after = changeKind(read("> [!NOTE]\n> One.\n\nTwo.\n"), [1], { kind: "quote" });
    expect(after.blocks.map((block) => block.kind)).toEqual(["quote", "quote"]);
});

// ---- definition lists ----

test("definition lists come back exactly, terms and definitions read", () => {
    for (const source of ["Term\n: Its definition.\n", "Apple\n: A fruit.\n: A company.\n\nPear\n: Another fruit.\n", "One\n:   spaced out\nTwo\n:\ttabbed\n", "*Marked* term\n: With `code` and **bold**.\n"]) everywhere(source);
    const list = read("Apple\n: A fruit.\n: A company.\n\nPear\n: Another.\n").blocks[0] as List;
    expect(list).toMatchObject({ kind: "list", style: "definition", loose: true });
    expect(list.items.map((item) => item.blocks.length)).toEqual([3, 2]);
    // a colon line after more than one line of text is not a definition, and a lone colon line is a paragraph
    expect(read("Two lines\nof text\n: here\n").blocks.map((block) => block.kind)).toEqual(["paragraph"]);
    expect(read(": alone\n").blocks.map((block) => block.kind)).toEqual(["paragraph"]);
});

test("in a definition list a changed definition writes back only its item, and Enter makes another definition", () => {
    const source = "Apple\n: A fruit.\n\nPear\n:   Another.\n";
    const doc = read(source);
    expect(write(insertText(doc, { path: [0, 0, 1], offset: 9 }, "!"))).toBe("Apple\n: A fruit.!\n\nPear\n:   Another.\n");
    const split = splitBlock(doc, { path: [0, 0, 1], offset: 9 });
    expect(write(insertText(split, { path: [0, 0, 2], offset: 0 }, "Red."))).toBe("Apple\n: A fruit.\n: Red.\n\nPear\n:   Another.\n");
});

test("a paragraph under another becomes its definition, and under a definition list it joins the last term", () => {
    expect(write(makeDefinition(read("Term\n\nMeaning\n"), [1]))).toBe("Term\n: Meaning\n");
    expect(write(makeDefinition(read("Term\n: One\n\nTwo\n"), [1]))).toBe("Term\n: One\n: Two\n");
});

test("plain text that would read as a definition is escaped when written fresh", () => {
    meansTheSame("Line one\\\n: not a definition\n");
    meansTheSame("Text\n\\: escaped\n");
});

// ---- folding sections ----

test("folding sections come back exactly, with their summary, whether they start open, and their Markdown read", () => {
    for (const source of ["<details>\n<summary>More</summary>\n\nHidden *text*.\n\n</details>\n", "<details open>\n<summary>Open one</summary>\n\n- a list\n- inside\n\n</details>\n", "<details><summary>Same line</summary>\n\nText.\n\n</details>\n", "<details>\n<summary>Outer</summary>\n\n<details>\n<summary>Inner</summary>\n\nDeep.\n\n</details>\n\n</details>\n"]) {
        same(source);
        same(source.replace(/\n/g, "\r\n"));
        meansTheSame(source);
    }
    const doc = read("<details open>\n<summary>Open one</summary>\n\nText.\n\n</details>\n");
    expect(doc.blocks[0]).toMatchObject({ kind: "quote", details: { summary: "Open one", open: true } });
    const nested = read("<details>\n<summary>Outer</summary>\n\n<details>\n<summary>Inner</summary>\n\nDeep.\n\n</details>\n\n</details>\n").blocks[0] as Quote;
    expect(nested.blocks[0]).toMatchObject({ kind: "quote", details: { summary: "Inner" } });
    // other forms are kept as HTML, as before
    expect(read("<details>\nNo summary\n</details>\n").blocks[0]!.kind).toBe("raw");
    same("<details>\nNo summary\n</details>\n");
});

test("a folding section's summary and opening are changed by themselves, and it is made from a paragraph", () => {
    const doc = read("<details>\n<summary>More</summary>\n\nText.\n\n</details>\n\nAfter.\n");
    expect(write(setBox(doc, [0], { details: { summary: "Less", open: true } }))).toBe("<details open>\n<summary>Less</summary>\n\nText.\n\n</details>\n\nAfter.\n");
    expect(write(makeBox(read("Hidden.\n"), [0], { details: { summary: "Show", open: false } }))).toBe("<details>\n<summary>Show</summary>\n\nHidden.\n\n</details>\n");
});

// ---- maths ----

test("maths as a block comes back exactly; dollars in a line are only dollar signs, as standard Markdown has them", () => {
    for (const source of ["The area is $\\pi r^2$ here.\n", "$$\n\\sum_{i=1}^n i = \\frac{n(n+1)}{2}\n$$\n", "$$ E = mc^2 $$\n", "```math\nx^2\n```\n", "It costs $5 and $10.\n", "Over $3,000 raised.\n"]) everywhere(source);
    expect((read("A $x^2$ b\n").blocks[0] as Extract<Block, { kind: "paragraph" }>).runs).toEqual([{ kind: "text", text: "A $x^2$ b", marks: [] }]);
    expect(read("$$\nx\n$$\n").blocks[0]).toMatchObject({ kind: "code", language: "math", code: "x", dollars: true });
    expect((read("It costs $5 and $10.\n").blocks[0] as Extract<Block, { kind: "paragraph" }>).runs).toEqual([{ kind: "text", text: "It costs $5 and $10.", marks: [] }]);
    // an unclosed $$ is not a block
    expect(read("$$\nnever closed\n").blocks[0]!.kind).toBe("paragraph");
});

test("dollars written fresh are left as they are, and an escaped one still means a dollar", () => {
    expect(meansTheSame("Prices: $5 and $10$ here.\n")).toBe("Prices: $5 and $10$ here.\n");
    expect(meansTheSame("Over $3,000 raised.\n")).toBe("Over $3,000 raised.\n");
    meansTheSame("Both $a$ and \\$b.\n");
});

// ---- superscript, subscript, marked text, emoji ----

test("superscript and subscript are read from their HTML and written back as it", () => {
    for (const source of ["E = mc<sup>2</sup> and H<sub>2</sub>O.\n", "A <sup>**bold** sup</sup>.\n"]) everywhere(source);
    const runs = (read("x<sup>2</sup>y<sub>i</sub>\n").blocks[0] as Extract<Block, { kind: "paragraph" }>).runs;
    expect(runs.map((run) => run.kind === "text" && [run.text, run.marks])).toEqual([
        ["x", []],
        ["2", ["sup"]],
        ["y", []],
        ["i", ["sub"]],
    ]);
});

test("==marked== text is read and written; one, three or spaced signs stay text", () => {
    for (const source of ["Some ==marked== words.\n", "a == b and c === d\n", "x ==not closed\n", "==**both**==\n"]) everywhere(source);
    const runs = (read("Some ==marked== words.\n").blocks[0] as Extract<Block, { kind: "paragraph" }>).runs;
    expect(runs[1]).toEqual({ kind: "text", text: "marked", marks: ["mark"] });
    expect((read("a == b\n").blocks[0] as Extract<Block, { kind: "paragraph" }>).runs).toEqual([{ kind: "text", text: "a == b", marks: [] }]);
    meansTheSame("Escaped \\==not marked== here.\n");
});

test("a known emoji shortcode is read as that emoji and written back as the shortcode; an unknown one stays text", () => {
    for (const source of ["Well done :tada: and :+1:\n", "Not a code :notanemoji: here\n", "Time 12:30:45\n"]) everywhere(source);
    const runs = (read("Hi :wave: there :nope:\n").blocks[0] as Extract<Block, { kind: "paragraph" }>).runs;
    expect(runs).toEqual([
        { kind: "text", text: "Hi ", marks: [] },
        { kind: "emoji", name: "wave" },
        { kind: "text", text: " there :nope:", marks: [] },
    ]);
    expect(meansTheSame("Escaped \\:smile: stays text\n")).toContain("\\:smile:");
    // inside code a shortcode is code
    expect((read("`:smile:`\n").blocks[0] as Extract<Block, { kind: "paragraph" }>).runs).toEqual([{ kind: "text", text: ":smile:", marks: ["code"] }]);
});

test("all the new kinds together in one file, nested in lists and quotes, come back exactly", () => {
    const source = [
        "# Notes",
        "",
        "> [!TIP]",
        "> Use $a^2 + b^2 = c^2$ :sparkles:",
        "",
        "- A list with ==marked== text",
        "  ",
        "  Term",
        "  : Definition",
        "",
        "- <details>",
        "  <summary>Inside a list</summary>",
        "",
        "  Hidden.",
        "",
        "  </details>",
        "",
        "$$",
        "\\int_0^1 x\\,dx",
        "$$",
        "",
        "```mermaid",
        "flowchart LR",
        "  A --> B",
        "```",
        "",
    ].join("\n");
    same(source);
    same(source.replace(/\n/g, "\r\n"));
    meansTheSame(source);
});

test("a note on words inside a callout, a definition or a folding section stays on them through saving, and never changes the Markdown", () => {
    const source = "> [!NOTE]\n> Callout words here.\n\nTerm\n: Definition words here.\n\n<details>\n<summary>More</summary>\n\nFolded words here.\n\n</details>\n";
    const page = { size: "A4" as const, orientation: "portrait" as const, margins: 25 };
    let doc: Document = { ...read(source), quire: { page, notes: null } };
    for (const path of [[0, 0], [1, 0, 1], [2, 0]]) doc = addComment(doc, { start: { path, offset: 0 }, end: { path, offset: 5 } }, "A note").doc;
    expect(write(doc)).toBe(source);
    const saved = written(doc, write);
    const back = opened(saved.text, saved.quire);
    expect(write(back)).toBe(source);
    const noted = (path: number[]) => {
        const block = blockAt(back, path);
        return block?.kind === "paragraph" ? block.runs.filter((run) => run.kind === "text" && run.comments?.length).map((run) => (run.kind === "text" ? run.text : "")) : [];
    };
    expect(noted([0, 0])).toEqual(["Callo"]);
    expect(noted([1, 0, 1])).toEqual(["Defin"]);
    expect(noted([2, 0])).toEqual(["Folde"]);
});
