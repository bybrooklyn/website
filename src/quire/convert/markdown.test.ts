// What Markdown to HTML and back holds true, through mdQuire's own reader and writer handed in as the
// page hands them: a whole small page comes out with its title; Markdown to HTML to Markdown keeps the
// meaning of headings, emphasis, links, lists, a table, code, a quote and a picture; HTML to Markdown
// leaves out scripts, styles and the head with what they hold, and keeps the text of elements it does
// not know.

import { expect, test } from "bun:test";
import { readHtml, writeHtml } from "../md/html";
import { read } from "../md/read";
import { write } from "../md/write";
import { htmlToMarkdown, HTML_DROPPED, HTML_UNDERSTOOD, markdownToHtml, type MarkdownEngine } from "./markdown";

const engine: MarkdownEngine = {
    toHtml: (markdown) => writeHtml(read(markdown).blocks),
    fromHtml: (html) => write({ ...read(""), blocks: readHtml(html) }),
};

const sample = `# A title

Some **bold**, *italic*, ~~struck~~ and \`code\`, with [a link](https://example.com "Example").

## Lists

- one
- two

1. first
2. second

| Name | Age |
| :--- | ---: |
| Jo | 41 |

\`\`\`ts
const a = 1;
\`\`\`

> A quote.

![A cat](pictures/cat.png)

---
`;

test("Markdown becomes a whole small page with its title and its body", () => {
    const page = markdownToHtml(sample, engine, "Notes & <things>");
    expect(page.startsWith('<!doctype html>\n<html>\n<head>\n<meta charset="utf-8">')).toBe(true);
    expect(page).toContain("<title>Notes &amp; &lt;things&gt;</title>");
    expect(page).toContain("<h1>A title</h1>");
    expect(page).toContain('<a href="https://example.com" title="Example">a link</a>');
    expect(page).toContain("<strong>bold</strong>");
    expect(page).toContain('<pre><code class="language-ts">const a = 1;</code></pre>');
    expect(page).toContain('<img src="pictures/cat.png" alt="A cat">');
    expect(page.endsWith("</body>\n</html>\n")).toBe(true);
});

test("Markdown to HTML to Markdown keeps the meaning", () => {
    const back = htmlToMarkdown(markdownToHtml(sample, engine, "x"), engine);
    // the same document, read again, gives the same HTML: nothing of its meaning was lost
    expect(engine.toHtml(back)).toBe(engine.toHtml(sample));
    for (const piece of ["# A title", "**bold**", "*italic*", "~~struck~~", "`code`", '[a link](https://example.com "Example")', "- one", "1. first", "| Jo", "```ts", "> A quote.", "![A cat](pictures/cat.png)"]) expect(back).toContain(piece);
    expect(back.endsWith("\n")).toBe(true);
    expect(back.endsWith("\n\n")).toBe(false);
});

test("HTML to Markdown leaves out scripts, styles and the head with what they hold, and keeps the text of unknown elements", () => {
    const html = `<!doctype html><html><head><title>Hidden</title><style>p{color:red}</style></head><body>
<h2 class="x" id="y">Kept <span style="color:red">heading</span></h2>
<script>alert(1)</script>
<custom-thing>Its text stays</custom-thing>
<p>Text with <b>bold</b> and <span style="font-style:italic">styled italic</span> and <a href="javascript:alert(1)">a bad link</a>.</p>
<form><button>Press</button><textarea>typed</textarea></form>
<p><mark>marked</mark> H<sub>2</sub>O</p>
<!-- a comment -->
</body></html>`;
    const markdown = htmlToMarkdown(html, engine);
    expect(markdown).toBe("## Kept heading\nIts text stays\n\nText with **bold** and *styled italic* and a bad link.\n\nmarked H2O\n");
    for (const gone of ["Hidden", "color", "alert", "Press", "typed", "comment"]) expect(markdown).not.toContain(gone);
    expect(htmlToMarkdown("<script>x</script>", engine)).toBe("");
});

test("the page's sentences on HTML say what is read and what is left out", () => {
    expect(HTML_UNDERSTOOD).toContain("tables with their alignment");
    expect(HTML_DROPPED).toContain("scripts, styles");
});
