// What is held true of the downloads made from a document: Markdown is the file byte for byte for
// a Markdown document, and a `.quire` document's styling that Markdown can say is written into it;
// plain text reads as the words alone; the web page holds everything it shows, pictures inlined, and
// its contents' links reach its headings. Word is in docx.test.ts. Run with `bun test src/quire`.

import { expect, test } from "bun:test";
import { setImage, type Document } from "./document";
import { gatherPictures, heldElsewhere, markdownFor, pageHtml, pictureAddresses, plainText, type Picture } from "./export";
import { opened, written } from "./quire-file";
import { read } from "./read";
import { write } from "./write";

const POST = "---\ntitle: A post\n---\n\n# A post\n\nSome *words* and a [link](https://example.com).\n\n- one\n- [x] two\n\n> Quoted.\n\n| a | b |\n| - | - |\n| 1 | 2 |\n\n![A cat](cat.png)\n\n<!-- contents -->\n\nThe end.[^1]\n\n[^1]: A note.\n";

test("a Markdown document downloads as Markdown byte for byte", () => {
    expect(markdownFor(read(POST))).toBe(POST);
});

test("a .quire document downloads as Markdown with the alignment, color and picture width that Markdown can say written into it", () => {
    const page = { size: "A4" as const, orientation: "portrait" as const, margins: 25 };
    let doc: Document = { ...read("Centred.\n\n![Cat](cat.png)\n"), quire: { page, notes: null } };
    doc = setImage(doc, [1], { width: 50 });
    doc.blocks[0] = { ...doc.blocks[0]!, align: "center" } as typeof doc.blocks[0];
    const saved = written(doc, write);
    const back = opened(saved.text, saved.quire);
    expect(write(back)).toBe("Centred.\n\n![Cat](cat.png)\n");
    expect(markdownFor(back)).toBe('<div align="center">\n\nCentred.\n\n</div>\n\n<img src="cat.png" alt="Cat" width="50%" />\n');
});

test("plain text is the words alone: bullets, boxes, tab-apart cells, a picture by what it shows, no markers", () => {
    const text = plainText(read(POST));
    expect(text).toContain("A post\n\nSome words and a link.\n\n• one\n[x] two\n\n    Quoted.\n\na\tb\n1\t2\n\n[Picture: A cat]\n\nThe end.[1]\n\n[1] A note.\n");
    expect(text).not.toContain("title:");
    expect(text).not.toContain("contents");
});

test("the web page stands alone: the reading styles inside it, pictures inlined, headings with the ids its contents link to", () => {
    const pictures = new Map<string, Picture>([["cat.png", { bytes: new Uint8Array([137, 80, 78, 71]), type: "image/png", width: 4, height: 2 }]]);
    const doc = setImage(read("# Hello there\n\n[Back up](#hello-there)\n\n![A cat](cat.png)\n\n<script>alert(1)</script>\n", { mdx: true }), [2], { width: 50, caption: "Moss" });
    const html = pageHtml(doc, { title: "Hello & more", styles: ".prose { color: red; }", pictures });
    expect(html.startsWith("<!doctype html>")).toBe(true);
    expect(html).toContain("<title>Hello &amp; more</title>");
    expect(html).toContain(".prose { color: red; }");
    expect(html).toContain('<h1 id="hello-there">Hello there</h1>');
    expect(html).toContain('<a href="#hello-there">Back up</a>');
    expect(html).toContain('src="data:image/png;base64,iVBORw==" alt="A cat" style="width:50%"');
    expect(html).toContain("<figcaption>Moss</figcaption>");
    // what an MDX file holds that is not plain HTML is shown as its text, never run
    expect(html).toContain("&lt;script&gt;");
    expect(html).not.toContain("<script>");
});

/** An MDX file with every further kind: a callout, a definition list, sub and sup, marked text, an emoji, maths in a line and as a block, a diagram, a folding section and a component. */
const KINDS = 'import Figure from "../../components/Figure.astro";\n\n> [!WARNING] Mind the gap\n> Callout words.\n\nApple\n: Definition words.\n\nWater is H<sub>2</sub>O and E = mc<sup>2</sup>, ==marked words== :tada:\n\nArea $\\pi r^2$ inline.\n\n$$\n\\frac{a}{b}\n$$\n\n```mermaid\nflowchart TD\n  A[Start] --> B[Finish]\n```\n\n<details>\n<summary>Summary words</summary>\n\nFolded words.\n\n</details>\n\n<Figure src="/a.webp" alt="Card words" width={960} height={540} />\n';
/** Words each download must keep, one or more for each kind. */
const KEPT = ["Warning", "Mind the gap", "Callout words.", "Apple", "Definition words.", "Water is H", "mc", "marked words", "\u{1F389}", "\\pi r^2", "\\frac{a}{b}", "A[Start] --> B[Finish]", "Summary words", "Folded words.", "Card words"];
const decoded = (html: string) => html.replace(/&gt;/g, ">").replace(/&lt;/g, "<").replace(/&quot;/g, '"').replace(/&amp;/g, "&");

test("every further kind downloads as Markdown byte for byte, as plain text with every word, and as a web page with every word", () => {
    const doc = read(KINDS, { mdx: true });
    expect(markdownFor(doc)).toBe(KINDS);
    const text = plainText(doc);
    for (const word of KEPT) expect({ word, kept: text.includes(word) }).toEqual({ word, kept: true });
    expect(text).toContain("Warning: Mind the gap");
    const page = decoded(pageHtml(doc, { title: "Kinds" }).replace(/<[^>]+>/g, ""));
    for (const word of KEPT) expect({ word, kept: page.includes(word) }).toEqual({ word, kept: true });
    const html = pageHtml(doc, { title: "Kinds" });
    for (const part of ['<blockquote class="callout callout-warning">', "<dl>", "<dt>Apple</dt>", "<dd>Definition words.</dd>", "<sub>2</sub>", "<sup>2</sup>", "<mark>marked words</mark>", '<code class="language-math">', "<details>", "<summary>Summary words</summary>"]) expect(html).toContain(part);
});

test("every picture a document shows is found, in blocks, lines, lists and tables", () => {
    const doc = read("![a](one.png)\n\nText ![b](two.png).\n\n- ![c](three.png)\n\n| x |\n| - |\n| ![d](four.png) |\n");
    expect(pictureAddresses(doc).sort()).toEqual(["four.png", "one.png", "three.png", "two.png"]);
});

/** What a document from someone else might hold to run script or fetch from elsewhere when its web page is opened: the audit's cases, and more. */
const HOSTILE = [
    "[click](javascript:alert(1))",
    "[tab](<java\tscript:alert(1)>)",
    "[entity](java&#9;script:alert(1))",
    "[upper](JaVaScRiPt:alert(1))",
    "[data](data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg==)",
    "[vb](vbscript:msgbox(1))",
    "hello <script>alert(1)</script> world",
    "hello <img src=x onerror=alert(1)> world",
    "a <a href=\"javascript:alert(1)\" onclick=\"alert(2)\">link</a> b",
    "a <span style=\"background:url(https://evil.example/s.gif)\">styled</span> b",
    "a <iframe src=\"https://evil.example\"></iframe> b",
    "<svg/onload=alert(1)>",
    "<img/src=x/onerror=alert(2)>",
    '<a href="javascript:alert(3)">z</a>',
    '<a href="java&#x09;script:alert(4)">t</a>',
    "<style>@import url(https://evil.example/x.css)</style>",
    '<meta http-equiv=refresh content="0;url=https://evil.example">',
    '<img src="https://evil.example/p.gif">',
    '<img src="//evil.example/q.gif">',
    "<div onmouseover=\"alert(1)\">over</div>",
    '<object data="https://evil.example/o"></object>',
    '<embed src="https://evil.example/e">',
    '<form action="https://evil.example"><input name="x"></form>',
    "<math><mi xlink:href=\"javascript:alert(1)\">m</mi></math>",
    '<base href="https://evil.example/">',
    '<link rel="stylesheet" href="https://evil.example/l.css">',
    '<div style="width: expression(alert(1))">expr</div>',
    '<p style="color:red;background-image:u\\72l(https://evil.example/b.gif)">escaped</p>',
    "![](https://evil.example/pixel.gif)",
    "![tracker](//evil.example/pixel2.gif)",
].join("\n\n") + "\n";

/** Every way in the written page that would run script or ask the network for something, as a list of what was found. */
function dangers(html: string): string[] {
    const found: string[] = [];
    const body = html.slice(html.indexOf("<body>"));
    for (const [what, pattern] of [
        ["script element", /<script/i],
        ["event handler", /<[^>]+\son\w+\s*=/i],
        ["javascript address", /(href|src|action|data)\s*=\s*"[^"]*(script|data:text)/i],
        ["embedding element", /<(iframe|object|embed|svg|math|form|input|base|link|meta|style)\b/i],
        ["picture from elsewhere", /<img[^>]+src="(https?:)?\/\//i],
        ["address in a style", /style="[^"]*(url|expression|\\)/i],
    ] as const)
        if (pattern.test(body)) found.push(what);
    return found;
}

test("the downloaded web page runs nothing from the document and fetches nothing: hostile HTML, addresses and styles are escaped or left out", () => {
    const html = pageHtml(read(HOSTILE), { title: "Hostile" });
    expect(dangers(html)).toEqual([]);
    // the page carries its own policy, first in its head, which forbids script and every fetch but its own pictures and fonts
    expect(html).toMatch(/<head>\n<meta charset="utf-8">\n<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:;/);
    // plain HTML that is harmless is still shown, and the words of what was not are kept as text
    const safe = pageHtml(read('Some <b>bold</b> and <a href="https://example.com" title="t">a link</a>.\n\n<div align="center"><em>Centred</em></div>\n'), { title: "t" });
    expect(safe).toContain("<b>bold</b>");
    expect(safe).toContain('<a href="https://example.com" title="t">a link</a>');
    expect(safe).toContain('<div align="center"><em>Centred</em></div>');
    expect(html).toContain("&lt;script&gt;");
    // a picture from elsewhere is a link to where it is, not shown
    expect(html).toContain('<a class="picture-link" href="https://evil.example/pixel.gif">');
});

test("a colour, size or highlight from a file is used only if it is plainly one, so the page asks nothing of another site", () => {
    let doc = read("Words.\n");
    const hostile = "red 45%, transparent), url(https://evil.example/p.gif) no-repeat, color-mix(in oklch, red";
    doc = { ...doc, blocks: [{ kind: "paragraph", gap: "", runs: [{ kind: "text", text: "Words.", marks: [], color: "red;background:url(https://evil.example/c.gif)", size: "1em", highlight: hostile }] }] } as Document;
    const html = pageHtml(doc, { title: "t" });
    expect(html).not.toContain("evil.example");
    expect(html).toContain('style="font-size:1em"');
    expect(dangers(html)).toEqual([]);
});

test("pictures from elsewhere on the web are never fetched to make a download; only those a store keeps or held in their own address", async () => {
    const asked: string[] = [];
    const real = globalThis.fetch;
    globalThis.fetch = (async (address: string) => {
        asked.push(String(address));
        return new Response(new Uint8Array([137, 80, 78, 71]), { headers: { "content-type": "image/png" } });
    }) as typeof fetch;
    try {
        const doc = read("![kept](pictures/kept.png)\n\n![tracker](https://evil.example/pixel.gif)\n\n![other](//evil.example/two.gif)\n");
        const pictures = await gatherPictures(doc, async (src) => (src === "pictures/kept.png" ? "blob:kept" : undefined)).catch(() => new Map());
        expect(asked).toEqual(["blob:kept"]);
        // (with no browser here to measure it the kept picture is left out too; in a browser it is held)
        expect(heldElsewhere(doc, pictures)).toEqual(expect.arrayContaining(["//evil.example/two.gif", "https://evil.example/pixel.gif"]));
    } finally {
        globalThis.fetch = real;
    }
});
