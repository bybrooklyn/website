// What the HTML reader and writer are held to: pasted HTML becomes the blocks and marks it shows and
// nothing else, with scripts, styles, handlers and unsafe addresses dropped; and blocks written as
// HTML for the clipboard read back as the same blocks. Run with `bun test src/quire`.

import { expect, test } from "bun:test";
import { documentOf, type Block } from "./document";
import { cleanHtml, cleanTag, readHtml, safeAddress, writeHtml } from "./html";
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

test("a pasted address is read as a browser reads it: a tab, line break, control character or entity inside the scheme does not hide javascript:", () => {
    const html = '<p><a href="java&#9;script:alert(1)">a</a> <a href="\u0001javascript:alert(2)">b</a> <a href="jav&#x0A;ascript:alert(3)">c</a> <a href=" JAVASCRIPT:alert(4)">d</a> <a href="vbscript:x">e</a> <img src="java&#10;script:1" alt="f"> <a href="https://ok.example/a:b">g</a> <a href="./notes:1.md">h</a></p>';
    const out = markdown(readHtml(html));
    expect(out).not.toMatch(/script/i);
    expect(out).toContain("[g](https://ok.example/a:b)");
    expect(out).toContain("[h](./notes:1.md)");
});

test("the one sanitiser keeps ordinary addresses and refuses the rest, after decoding and taking out what a browser ignores", () => {
    for (const good of ["https://example.com", "http://a.example/x?y=1#z", "mailto:me@example.com", "#top", "/blog/", "./a.png", "../b/c.md", "pictures/cat.png", "notes.md?x=a:b"]) expect({ good, kept: safeAddress(good) }).toEqual({ good, kept: good });
    for (const bad of ["javascript:alert(1)", "java\tscript:1", "java&#9;script:1", "java&amp;#9;script:1", "\u0000javascript:1", " javascript:1", "JaVaScRiPt:1", "vbscript:1", "data:text/html,x", "file:///etc/passwd", "c:\\windows", "%6Aavascript:1"]) expect({ bad, kept: safeAddress(bad) }).toEqual({ bad, kept: undefined });
    expect(safeAddress("data:image/png;base64,AAAA", "picture")).toBe("data:image/png;base64,AAAA");
    expect(safeAddress("data:image/svg+xml;base64,AAAA", "picture")).toBeUndefined();
    expect(safeAddress("data:image/png;base64,AAAA", "link")).toBeUndefined();
    expect(safeAddress("mailto:a@b.c", "picture")).toBeUndefined();
});

test("HTML written in a document keeps only plain elements and attributes; script, embedding, handlers, styles with addresses and remote pictures go", () => {
    expect(cleanHtml('<p class="a" onclick="x()">Hi <b>there</b><script>alert(1)</script></p>')).toBe('<p class="a">Hi <b>there</b></p>');
    expect(cleanHtml('<a href="javascript:alert(1)" title="t">x</a><a href="https://a.example">y</a>')).toBe('<a title="t">x</a><a href="https://a.example">y</a>');
    expect(cleanHtml('<img src="https://evil.example/p.gif" alt="pixel"><img src="./cat.png" alt="cat">')).toBe('pixel<img src="./cat.png" alt="cat">');
    expect(cleanHtml('<div style="color:red">a</div><div style="background:url(x)">b</div><div style="color:u\\72l(x)">c</div>')).toBe('<div style="color:red">a</div><div>b</div><div>c</div>');
    expect(cleanHtml("<svg><script>alert(1)</script></svg><iframe src=x></iframe><form><input></form>ok")).toBe("ok");
    expect(cleanTag("<script>")).toBe("&lt;script&gt;");
    expect(cleanTag('<img src=x onerror="alert(1)">')).toBe('<img src="x">');
    expect(cleanTag('<a href="java&#9;script:alert(1)">')).toBe("<a>");
    expect(cleanTag("</b>")).toBe("</b>");
    expect(cleanTag("&amp;")).toBe("&amp;");
});

test("copied as HTML, a document's link or picture with a hostile address is copied as its words, and a colour cannot add a rule", () => {
    const html = writeHtml(read("[x](javascript:alert(1)) ![p](javascript:alert(2)) [ok](https://a.example)\n").blocks);
    expect(html).not.toMatch(/javascript/i);
    expect(html).toContain('<a href="https://a.example">ok</a>');
    const styled = writeHtml([{ kind: "paragraph", gap: "", runs: [{ kind: "text", text: "w", marks: [], color: "red;background:url(https://evil.example/c.gif)", size: "2em" }] }]);
    expect(styled).not.toContain("evil.example");
    expect(styled).toContain('style="font-size:2em"');
});
