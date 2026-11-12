// What the HTML reader and writer are held to: pasted HTML becomes the blocks and marks it shows and
// nothing else, with scripts, styles, handlers and unsafe addresses dropped; and blocks written as
// HTML for the clipboard read back as the same blocks. Run with `bun test src/quire`.

import { expect, test } from "bun:test";
import { documentOf, type Block } from "./document";
import { readHtml, writeHtml } from "./html";
import { read } from "./read";
import { write } from "./write";

const markdown = (blocks: Block[]) => write(documentOf(blocks));

test("headings, paragraphs, marks and links become Markdown", () => {
    const html = '<h2>A <em>title</em></h2><p>Some <strong>bold</strong>, <i>italic</i>, <u>under</u>, <del>gone</del> and <code>code</code>, with <a href="https://a.example" title="A">a link</a>.</p>';
    expect(markdown(readHtml(html))).toBe('## A *title*\n\nSome **bold**, *italic*, <u>under</u>, ~~gone~~ and `code`, with [a link](https://a.example "A").\n');
});

test("lists, nested lists, task boxes, quotes, code and dividers are read as blocks", () => {
    const html = '<ul><li>one<ul><li>nested</li></ul></li><li>two</ul><ol start="3"><li>three<li>four</ol><ul><li><input type="checkbox" checked> done</li><li><input type="checkbox"> open</li></ul><blockquote><p>quoted</p></blockquote><pre><code class="language-ts">let a = 1;\nlet b = 2;\n</code></pre><hr>';
    expect(markdown(readHtml(html))).toBe("- one\n  - nested\n- two\n\n3. three\n4. four\n\n- [x] done\n- [ ] open\n\n> quoted\n\n```ts\nlet a = 1;\nlet b = 2;\n```\n\n---\n");
});

test("a table is read with its heading row and alignment", () => {
    const html = '<table><thead><tr><th>Name</th><th style="text-align:right">Size</th></tr></thead><tbody><tr><td>a<br>b</td><td>1</td></tr><tr><td>c</td></tr></tbody></table>';
    expect(markdown(readHtml(html))).toBe("| Name | Size |\n| ---- | ---: |\n| a b  | 1    |\n| c    |      |\n");
});

test("scripts, styles, handlers, unsafe addresses and embedded pictures are dropped, never kept as HTML", () => {
    const html = '<style>p{color:red}</style><script>alert(1)</script><p onclick="steal()">Safe <a href="javascript:alert(1)">text</a> <img src="data:image/png;base64,AAAA" alt="x"><span style="color:red">red</span><iframe src="https://x"></iframe></p><p><img src="/picture.png" alt="A picture"></p>';
    const blocks = readHtml(html);
    expect(markdown(blocks)).toBe("Safe text red\n\n![A picture](/picture.png)\n");
    expect(JSON.stringify(blocks)).not.toContain("html");
    expect(JSON.stringify(blocks)).not.toContain("javascript");
});

test("a copy from a word processor, wrapped in a bold that is not bold, keeps only the real marks", () => {
    const html = '<meta charset="utf-8"><b style="font-weight:normal;" id="docs-internal-guid-1"><p dir="ltr"><span style="font-weight:700;">Bold</span><span style="font-weight:400;"> and </span><span style="font-style:italic;">italic</span><span>&nbsp;&amp; more</span></p></b>';
    expect(markdown(readHtml(html))).toBe("**Bold** and *italic*\u00a0& more\n");
});

test("only the fragment between the clipboard's markers is read, and loose text becomes a paragraph", () => {
    expect(markdown(readHtml("<html><body>before<!--StartFragment-->Just <b>text</b><!--EndFragment-->after</body></html>"))).toBe("Just **text**\n");
    expect(markdown(readHtml("plain &lt;words&gt;"))).toBe("plain \\<words>\n");
});

test("blocks written as HTML for the clipboard read back as the same blocks", () => {
    const source = "# Heading\n\nA **bold** and *italic* [link](https://a.example) with `code`.\n\n- one\n- [two](/two)\n\n1. first\n2. second\n\n- [x] done\n\n> quoted\n\n```js\nlet a = 1;\n```\n\n| a | b |\n| --- | --- |\n| 1 | 2 |\n\n![A picture](/p.png)\n\n---\n";
    const blocks = read(source).blocks;
    const html = writeHtml(blocks);
    expect(html).toContain("<h1>Heading</h1>");
    expect(markdown(readHtml(html))).toBe(markdown(read(source).blocks.map((block) => ({ ...block, source: undefined }))));
});
