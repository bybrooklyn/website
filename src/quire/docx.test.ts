// What is held true of the Word file: it unzips into the parts Word reads, each well-formed XML;
// headings, paragraphs, marks, links, lists, tables and pictures are in document.xml as Word writes
// them; every relationship named there exists; and a picture Word cannot show becomes its alt text.
// It has not been opened in Word: this reads the XML. Run with `bun test src/quire`.

import { expect, test } from "bun:test";
import { docx, halfPoints } from "./docx";
import { setImage } from "./document";
import type { Picture } from "./export";
import { read } from "./read";
import { readZip } from "./zip";

/** True when XML text is well-formed as far as its tags go: each opened tag closed in order, one root. */
function wellFormed(text: string): boolean {
    const body = text.replace(/^<\?xml[^>]*\?>\s*/, "");
    const stack: string[] = [];
    let roots = 0;
    for (const match of body.matchAll(/<(\/?)([\w:]+)((?:\s+[\w:]+="[^"<]*")*)\s*(\/?)>|<|>/g)) {
        if (match[0] === "<" || match[0] === ">") return false;
        const [, closing, name, , self] = match;
        if (closing) {
            if (stack.pop() !== name) return false;
        } else if (!self) {
            if (stack.length === 0) roots++;
            stack.push(name!);
        } else if (stack.length === 0) roots++;
    }
    return stack.length === 0 && roots === 1;
}

const TEXT = '# The title\n\nPlain, **bold**, *italic*, <u>under</u>, ~~struck~~, `code` & a [link](https://example.com/?a=1&b=2) to [the end](#the-end).\n\n- one\n  - inside\n- [x] done\n\n3. three\n4. four\n\n> Quoted.\n\n| Name | Size |\n| :--- | ---: |\n| one  | 1    |\n\n![A wide picture](wide.png)\n\n![A drawing](drawing.svg)\n\n<div style="break-after: page"></div>\n\n## The end\n\nA <span style="color:salmon; font-size:1.5em">coloured</span> word.[^1]\n\n[^1]: The note.\n';

const PNG: Picture = { bytes: new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]), type: "image/png", width: 800, height: 400 };
const SVG: Picture = { bytes: new TextEncoder().encode("<svg/>"), type: "image/svg+xml", width: 10, height: 10 };

async function files(text = TEXT, options = {}) {
    let doc = read(text);
    doc = setImage(doc, [6], { width: 50, caption: "Two colours" });
    const bytes = await docx(doc, { pictures: new Map([["wide.png", PNG], ["drawing.svg", SVG]]), hex: (color) => (color === "salmon" ? "FA8072" : undefined), title: "Test", ...options });
    const all = await readZip(bytes);
    const decode = (name: string) => new TextDecoder().decode(all.get(name));
    return { all, decode };
}

test("it unzips into the parts Word reads, each of them well-formed XML", async () => {
    const { all, decode } = await files();
    expect([...all.keys()].sort()).toEqual(["[Content_Types].xml", "_rels/.rels", "docProps/core.xml", "word/_rels/document.xml.rels", "word/document.xml", "word/media/image1.png", "word/numbering.xml", "word/styles.xml"]);
    for (const name of all.keys()) if (name.endsWith(".xml") || name.endsWith(".rels")) expect(wellFormed(decode(name))).toBe(true);
    expect(all.get("word/media/image1.png")).toEqual(PNG.bytes);
});

test("headings, marks, links, lists, tables, a page break and the picture are written as Word writes them", async () => {
    const { decode } = await files();
    const document = decode("word/document.xml");
    expect(document).toContain('<w:pStyle w:val="Heading1"/>');
    expect(document).toContain('<w:bookmarkStart w:id="2" w:name="h_the_end"/>');
    expect(document).toContain('<w:hyperlink w:anchor="h_the_end">');
    expect(document).toContain("<w:rPr><w:b/></w:rPr><w:t xml:space=\"preserve\">bold</w:t>");
    expect(document).toContain("<w:rPr><w:i/></w:rPr>");
    expect(document).toContain('<w:rPr><w:u w:val="single"/></w:rPr>');
    expect(document).toContain("<w:rPr><w:strike/></w:rPr>");
    expect(document).toContain('<w:rFonts w:ascii="Consolas"');
    expect(document).toContain("code</w:t>");
    expect(document).toContain(" &amp; a ");
    expect(document).toContain('<w:color w:val="FA8072"/><w:sz w:val="36"/>');
    expect(document).toContain('<w:numPr><w:ilvl w:val="1"/>');
    expect(document).toContain("☒ </w:t>");
    expect(document).toContain("<w:tblHeader/>");
    expect(document).toContain('<w:jc w:val="right"/>');
    expect(document).toContain('<w:br w:type="page"/>');
    // the picture at half the text's width keeps its shape: A4 less two 25 mm margins is 160 mm, 5,760,000 EMU
    expect(document).toMatch(/<wp:extent cx="(\d+)" cy="(\d+)"\/>/);
    const [, cx, cy] = /<wp:extent cx="(\d+)" cy="(\d+)"\/>/.exec(document)!;
    expect(Math.abs(Number(cx) - 2_880_000)).toBeLessThan(2000);
    expect(Number(cx) / Number(cy)).toBeCloseTo(2, 2);
    expect(document).toContain('descr="A wide picture"');
    expect(document).toContain('<w:pStyle w:val="Caption"/>');
    // an SVG, which Word does not show, is its alt text
    expect(document).toContain("[Picture: A drawing]");
    expect(document).toContain('<w:pStyle w:val="FootnoteText"/>');
});

test("every relationship document.xml names is in its rels, and the numbered list starts where it starts", async () => {
    const { decode } = await files();
    const document = decode("word/document.xml");
    const rels = decode("word/_rels/document.xml.rels");
    for (const [, id] of document.matchAll(/r:(?:id|embed)="(rId\d+)"/g)) expect(rels).toContain(`Id="${id}"`);
    expect(rels).toContain('Target="https://example.com/?a=1&amp;b=2" TargetMode="External"');
    expect(decode("word/numbering.xml")).toContain('<w:startOverride w:val="3"/>');
    expect(decode("[Content_Types].xml")).toContain('PartName="/word/document.xml"');
});

test("a landscape Letter page is the page Word is given", async () => {
    const page = { size: "Letter" as const, orientation: "landscape" as const, margins: 20 };
    const bytes = await docx({ ...read("Words.\n"), quire: { page, notes: null } });
    const document = new TextDecoder().decode((await readZip(bytes)).get("word/document.xml"));
    expect(document).toContain('<w:pgSz w:w="15840" w:h="12240" w:orient="landscape"/>');
    expect(document).toContain('w:top="1134"');
});

test("sizes are turned into Word's half points, the text's own being 12 points", () => {
    expect(halfPoints("1.5em")).toBe(36);
    expect(halfPoints("18px")).toBe(27);
    expect(halfPoints("15pt")).toBe(30);
    expect(halfPoints("nonsense")).toBeUndefined();
});
