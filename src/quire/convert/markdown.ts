// Markdown to HTML and HTML to Markdown, through mdQuire's own reader and writer. The page script
// (src/scripts/convert.ts) hands them in as an engine, since one kind of document here never imports
// another: `toHtml` is mdQuire's Markdown read into blocks and written as plain HTML, `fromHtml` its
// HTML reader (src/quire/md/html.ts), which keeps only what Markdown can hold, written as Markdown.
//
//   markdownToHtml("# Hello\n", engine, "hello");   a whole page
//   htmlToMarkdown("<h1>Hello</h1>", engine);        gives "# Hello\n"

/** The two ways through mdQuire: Markdown into the HTML of its body, and HTML into Markdown. */
export interface MarkdownEngine {
    toHtml(markdown: string): string;
    fromHtml(html: string): string;
}

/** What HTML is read into Markdown, in a sentence for the page. */
export const HTML_UNDERSTOOD = "Read from HTML: headings, paragraphs, line breaks, bulleted, numbered and checkbox lists, quotes, code blocks with their language, tables with their alignment, dividers, links, pictures by address, and bold, italic, underline, strikethrough and code, whether written as elements or as styles.";

/** What HTML is left out, in a sentence for the page. */
export const HTML_DROPPED = "Left out: the head, scripts, styles, forms and their controls, frames, embedded objects, canvases, SVG and MathML, with everything inside them, and comments. Any other element is left out with its text kept. Classes, ids, colors, sizes, highlighting, superscript and subscript are left out, and so are links and pictures whose addresses are not web, mail or relative ones, and pictures held inside the page itself.";

const escape = (text: string) => text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** Markdown written as a whole small HTML page: its title, and the body mdQuire makes of it. */
export function markdownToHtml(markdown: string, engine: MarkdownEngine, title: string): string {
    const body = engine.toHtml(markdown.replace(/^\ufeff/, ""));
    return `<!doctype html>\n<html>\n<head>\n<meta charset="utf-8">\n<meta name="viewport" content="width=device-width, initial-scale=1">\n<title>${escape(title)}</title>\n</head>\n<body>\n${body}\n</body>\n</html>\n`;
}

/** HTML read into Markdown, ending in one line break. */
export function htmlToMarkdown(html: string, engine: MarkdownEngine): string {
    const markdown = engine.fromHtml(html.replace(/^\ufeff/, ""));
    return markdown.trim() ? `${markdown.replace(/\s+$/, "")}\n` : "";
}
