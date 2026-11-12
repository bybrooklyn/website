// What writing is held to: an untouched block is its source, a changed block is written in one
// plain style, and whatever is written fresh reads back to the same blocks and runs, color, size
// and centring included. Run with `bun test src/quire`.

import { expect, test } from "bun:test";
import { code, divider, heading, image, list, paragraph, setAlign, setStyle, table, tidyRuns, toggleMark, type Block, type Document, type Paragraph, type Run } from "./document";
import { read } from "./read";
import { write } from "./write";

/** A document made of fresh blocks, as the editor would build one. */
function made(blocks: Block[], options: { eol?: "\n" | "\r\n"; mdx?: boolean } = {}): Document {
    const eol = options.eol ?? "\n";
    return { bom: "", frontmatter: null, lead: "", blocks: blocks.map((block, index) => ({ ...block, gap: index === blocks.length - 1 ? eol : eol + eol })), eol, mdx: !!options.mdx };
}

const withRuns = (runs: Run[]): Paragraph => ({ kind: "paragraph", runs, gap: "" });

/** The blocks and runs of a document without the text they came from. Marks on bare spaces are not seen, so they are not compared. */
function meaning(blocks: Block[]): unknown {
    const strip = (value: unknown): unknown => {
        if (Array.isArray(value) && value.some((each) => each && typeof each === "object" && "kind" in each && ["text", "link", "image", "break", "html", "footnote"].includes(each.kind))) {
            const runs = (value as Run[]).flatMap((run): Run[] => {
                if (run.kind !== "text" || run.marks.includes("code")) return [run];
                const [, lead, core, trail] = /^(\s*)([\s\S]*?)(\s*)$/.exec(run.text)!;
                return [{ kind: "text", text: lead!, marks: [] }, { ...run, text: core! }, { kind: "text", text: trail!, marks: [] }];
            });
            return (tidyRuns(runs) as unknown[]).map(strip);
        }
        if (Array.isArray(value)) return value.map(strip);
        if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).filter(([key]) => key !== "source" && key !== "gap").map(([key, inner]) => [key, strip(inner)]));
        return value;
    };
    return strip(blocks);
}

/** Writes a document fresh and expects it to read back to the same meaning. */
function readsBack(doc: Document): string {
    const text = write(doc);
    expect(meaning(read(text, { mdx: doc.mdx }).blocks)).toEqual(meaning(doc.blocks));
    return text;
}

test("fresh blocks are written in one plain style", () => {
    const doc = made([heading(2, "A heading"), paragraph("Some text."), list("bullet", ["one", "two"]), list("number", ["first", "second"]), list("task", ["to do"]), code("let a = 1;", "ts"), divider(), image("/a.png", "A picture"), table(["Name", "Value"], [["a", "1"]])]);
    expect(readsBack(doc)).toBe(["## A heading", "", "Some text.", "", "- one", "- two", "", "1. first", "2. second", "", "- [ ] to do", "", "```ts", "let a = 1;", "```", "", "---", "", "![A picture](/a.png)", "", "| Name | Value |", "| ---- | ----- |", "| a    | 1     |", ""].join("\n"));
});

test("a CRLF file gets CRLF in the blocks written fresh", () => {
    const doc = read("Kept\r\n\r\nChanged\r\n");
    const changed = { ...doc, blocks: [doc.blocks[0]!, { ...list("bullet", ["a", "b"]), gap: "\r\n" }] };
    expect(write(changed)).toBe("Kept\r\n\r\n- a\r\n- b\r\n");
});

test("plain text that looks like Markdown is escaped so it reads back as the same text", () => {
    const texts = ["# not a heading", "1. not a list", "2) nor this", "- not a bullet", "+ nor this", "* nor this", "> not a quote", "---", "===", "a * b and 2*3*4", "snake_case and _not italic_", "*not italic* and **not bold**", "[not a link](x) and ![not a picture](y)", "<div> and </b>", "a & b and &amp; spelled out", "`not code`", "back\\slash", "~~not struck~~", "line one\n# line two\n- line three","a | b", "[^1] not a footnote", "[label]: not a definition"];
    for (const value of texts) readsBack(made([paragraph(value)]));
    for (const value of ["{expression}", "import x from y", "export const a", "a < b"]) readsBack(made([paragraph(value)], { mdx: true }));
});

test("overlapping marks, code, links and atoms are written so that they read back the same", () => {
    const cases: Run[][] = [
        [
            { kind: "text", text: "bold ", marks: ["bold"] },
            { kind: "text", text: "both", marks: ["bold", "italic"] },
            { kind: "text", text: " italic", marks: ["italic"] },
        ],
        [
            { kind: "text", text: "a ", marks: [] },
            { kind: "text", text: "spaced ", marks: ["bold"] },
            { kind: "text", text: "word", marks: [] },
        ],
        [{ kind: "text", text: "code with ` tick", marks: ["code"] }],
        [
            { kind: "text", text: "intra", marks: [] },
            { kind: "text", text: "word", marks: ["italic"] },
            { kind: "text", text: "s", marks: [] },
        ],
        [{ kind: "link", href: "https://a.example/(x)", title: 'say "hi"', runs: [{ kind: "text", text: "a link", marks: ["bold"] }] }],
        [{ kind: "link", href: "/with space", runs: [{ kind: "text", text: "spaced", marks: [] }] }],
        [
            { kind: "text", text: "line", marks: [] },
            { kind: "break" },
            { kind: "text", text: "next", marks: [] },
            { kind: "footnote", label: "1" },
            { kind: "image", src: "/i.png", alt: "an [odd] alt" },
            { kind: "html", html: "<kbd>" },
            { kind: "text", text: "K", marks: [] },
            { kind: "html", html: "</kbd>" },
        ],
        [
            { kind: "text", text: "struck", marks: ["strike"] },
            { kind: "text", text: " and ", marks: [] },
            { kind: "text", text: "under", marks: ["underline", "bold"] },
        ],
    ];
    for (const runs of cases) readsBack(made([withRuns(runs)]));
    expect(write(made([withRuns(cases[1]!)]))).toBe("a **spaced** word\n");
});

test("color, size and centring are written as small HTML and read back to the same marks", () => {
    let doc = made([paragraph("red and big"), heading(2, "Centred")]);
    doc = setStyle(doc, { start: { path: [0], offset: 0 }, end: { path: [0], offset: 3 } }, { color: "#c33" });
    doc = setStyle(doc, { start: { path: [0], offset: 8 }, end: { path: [0], offset: 11 } }, { size: "1.5em", color: "teal" });
    doc = toggleMark(doc, { start: { path: [0], offset: 8 }, end: { path: [0], offset: 11 } }, "bold");
    doc = setAlign(doc, [1], "center");
    const text = readsBack(doc);
    expect(text).toBe('<span style="color:#c33">red</span> and <span style="color:teal; font-size:1.5em">**big**</span>\n\n<div align="center">\n\n## Centred\n\n</div>\n');
    const back = read(text);
    expect((back.blocks[0] as Paragraph).runs).toEqual([
        { kind: "text", text: "red", marks: [], color: "#c33" },
        { kind: "text", text: " and ", marks: [] },
        { kind: "text", text: "big", marks: ["bold"], color: "teal", size: "1.5em" },
    ]);
    expect(back.blocks[1]).toMatchObject({ kind: "heading", align: "center" });
    expect(write(back)).toBe(text);
});

test("nested lists, tasks, quotes and footnotes written fresh read back the same", () => {
    const source = "- one\n  - nested\n    1. deep\n- [x] done\n\n> A quote\n>\n> - with a list\n\nRef.[^a]\n\n[^a]: The note.\n\n    More of it.\n";
    const doc = read(source);
    const fresh = JSON.parse(JSON.stringify(doc, (key, value) => (key === "source" ? undefined : value))) as Document;
    readsBack(fresh);
});

test("tables written fresh keep alignment and escape pipes", () => {
    const doc = read("| a | b | c |\n|:--|:-:|--:|\n| `x \\| y` | p \\| q | 3 |\n");
    const fresh = { ...doc, blocks: [{ ...doc.blocks[0]!, source: undefined }] };
    expect(readsBack(fresh)).toBe("| a        | b      | c   |\n| :------- | :----: | --: |\n| `x \\| y` | p \\| q | 3   |\n");
});

test("code holding backticks gets a longer fence", () => {
    expect(readsBack(made([code("```\ninside\n```", "md")]))).toBe("````md\n```\ninside\n```\n````\n");
    expect(readsBack(made([code("", "")]))).toBe("```\n```\n");
});

test("an empty fresh paragraph is left out rather than written as nothing", () => {
    expect(write(made([paragraph("a"), paragraph(""), paragraph("b")]))).toBe("a\n\nb\n");
    expect(write(made([paragraph("a"), paragraph("")]))).toBe("a\n");
});

test("a fresh block beside untouched ones is kept apart from them by a blank line, and they keep their bytes", () => {
    const doc = read("First  \nline\nSecond line\n");
    const changed: Document = { ...doc, blocks: [doc.blocks[0]!, { ...paragraph("new"), gap: "" }] };
    changed.blocks[0] = { ...doc.blocks[0]!, gap: "\n" };
    expect(write(changed)).toBe("First  \nline\nSecond line\n\nnew");
});
