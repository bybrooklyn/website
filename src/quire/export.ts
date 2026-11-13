// A document downloaded as something else: Markdown, a web page, plain text (and Word, in docx.ts).
// Each is made here from the document as the editor holds it; the editor gives the file. A `.quire`
// document is its own download (quire-file.ts), and PDF is the browser's print dialog with the
// page set up already (editor.ts), as a browser cannot write a PDF by itself without a library.
//
//   markdownFor(doc)                    the Markdown a reader of the file would see
//   pageHtml(doc, { title, styles, pictures })   one web page holding everything, pictures inlined
//   plainText(doc)                      the words alone, laid out to read
//   await gatherPictures(doc, show)     the pictures a document shows, as bytes with their sizes
//   await readingStyles()               the site's reading styles, from the page, fonts inlined

import { markdownOnly, runsText, type Block, type Document, type Leaf, type Run } from "./document";
import { emojiOf } from "./emoji";
import { isContentsMark, slug } from "./inserts";
import { isPageBreak } from "./document";
import { write } from "./write";

// ---- Markdown ----

/** True for a block whose look a `.quire` document keeps in style.json but Markdown can write itself (alignment, color, size, a picture's width and caption). */
function styled(block: Block): boolean {
    if (block.kind === "image") return !!block.align || block.width !== undefined || !!block.caption;
    if (block.kind === "paragraph" || block.kind === "heading") return !!block.align || coloured(block.runs);
    if (block.kind === "table") return [block.header, ...block.rows].some((row) => row.some(coloured));
    return false;
}
const coloured = (runs: Run[]): boolean => runs.some((run) => (run.kind === "link" ? coloured(run.runs) : run.kind === "text" && !!(run.color || run.size)));

/** Blocks with the source taken off each one that has a look its source does not show, and off what holds it, so that the look is written. */
function unkeep(blocks: Block[]): Block[] {
    return blocks.map((block): Block => {
        if (block.kind === "list") {
            const items = block.items.map((item) => {
                const inner = unkeep(item.blocks);
                return inner.some((each, k) => each !== item.blocks[k]) ? { ...item, blocks: inner, source: undefined } : item;
            });
            return items.some((each, k) => each !== block.items[k]) ? { ...block, items, source: undefined } : block;
        }
        if (block.kind === "quote" || block.kind === "footnote") {
            const inner = unkeep(block.blocks);
            return inner.some((each, k) => each !== block.blocks[k]) ? { ...block, blocks: inner, source: undefined } : block;
        }
        return block.source !== undefined && styled(block) ? { ...block, source: undefined } : block;
    });
}

/** The Markdown a document downloads as. A Markdown file is written as it is, byte for byte where untouched; a `.quire` document's styling that Markdown can say (alignment, color, size, a picture's width and caption) is written into it, and what it cannot (a typeface, a highlight, line spacing) is left out. */
export function markdownFor(doc: Document): string {
    if (!doc.quire) return write(doc);
    const { quire: _quire, ...plain } = doc;
    return write({ ...plain, blocks: unkeep(markdownOnly(doc.blocks)) });
}

// ---- plain text ----

/** The rows of the word count, as Docs shows them: words, characters, characters without spaces, and paragraphs, for the whole text and for a part of it if given. */
export function countRows(whole: string, part?: string): [string, number, number | undefined][] {
    const words = (text: string) => (text.match(/[\p{L}\p{N}][\p{L}\p{N}'’_-]*/gu) ?? []).length;
    const characters = (text: string) => [...text.replace(/\n/g, "")].length;
    const solid = (text: string) => [...text.replace(/\s/g, "")].length;
    const paragraphs = (text: string) => text.split(/\n\s*\n/).filter((each) => each.trim() !== "").length;
    return [
        ["Words", words(whole), part === undefined ? undefined : words(part)],
        ["Characters", characters(whole), part === undefined ? undefined : characters(part)],
        ["Characters, no spaces", solid(whole), part === undefined ? undefined : solid(part)],
        ["Paragraphs", paragraphs(whole), part === undefined ? undefined : paragraphs(part)],
    ];
}

/** The words of a document alone, laid out to read: headings on their own lines, lists with bullets and numbers, a table's cells apart by tabs, a picture by what it shows. */
export function plainText(doc: Document): string {
    const runs = (list: Run[]): string =>
        list
            .map((run) => (run.kind === "link" ? runs(run.runs) : run.kind === "text" ? (run.marks.includes("math") ? `$${run.text}$` : run.text) : run.kind === "break" ? "\n" : run.kind === "image" ? (run.alt ? `[${run.alt}]` : "") : run.kind === "footnote" ? `[${run.label}]` : run.kind === "emoji" ? (emojiOf(run.name) ?? `:${run.name}:`) : run.html))
            .join("");
    const blocks = (list: Block[], indent: string): string[] =>
        list.flatMap((block): string[] => {
            switch (block.kind) {
                case "paragraph":
                case "heading":
                    return [indent + runs(block.runs).replace(/\n/g, `\n${indent}`)];
                case "list":
                    // a definition list: each term on its line, its definitions indented under it
                    if (block.style === "definition") return block.items.flatMap((item) => item.blocks.flatMap((child, index) => blocks([child], index === 0 ? indent : `${indent}    `)));
                    return [
                        block.items
                            .map((item, index) => {
                                const marker = block.style === "number" ? `${block.start + index}. ` : item.checked === true ? "[x] " : item.checked === false ? "[ ] " : "• ";
                                const inner = blocks(item.blocks, indent + " ".repeat(marker.length)).join("\n");
                                return indent + marker + inner.slice(indent.length + marker.length);
                            })
                            .join("\n"),
                    ];
                case "quote": {
                    // a callout says its kind first, and a folding section its summary
                    const head = block.callout !== undefined ? `${indent}${block.callout.charAt(0).toUpperCase()}${block.callout.slice(1).toLowerCase()}:${block.title ? ` ${block.title}` : ""}` : block.details ? `${indent}${block.details.summary}` : undefined;
                    return [...(head !== undefined ? [head] : []), ...blocks(block.blocks, `${indent}    `)];
                }
                case "code":
                    return [block.code.split("\n").map((line) => indent + line).join("\n")];
                case "table":
                    return [[block.header, ...block.rows].map((row) => indent + row.map(runs).join("\t")).join("\n")];
                case "image":
                    return [indent + [block.alt ? `[Picture: ${block.alt}]` : "[Picture]", block.caption ?? ""].filter(Boolean).join(" ")];
                case "divider":
                    return [`${indent}* * *`];
                case "footnote":
                    return [`${indent}[${block.label}] ${blocks(block.blocks, indent).join("\n").trimStart()}`];
                case "raw":
                    return isPageBreak(block) || isContentsMark(block) || /^(import|export)\b/.test(block.text) ? [] : [indent + block.text];
            }
        });
    const out = blocks(doc.blocks, "").filter((each) => each.trim() !== "").join("\n\n");
    return out ? `${out}\n` : "";
}

// ---- a web page ----

/** A picture as a download carries it: its bytes, its type, and its size in pixels. */
export interface Picture {
    bytes: Uint8Array;
    type: string;
    width: number;
    height: number;
}

const escape = (text: string) => text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const TAGS: [string, string][] = [
    ["code", "code"],
    ["bold", "strong"],
    ["italic", "em"],
    ["strike", "s"],
    ["underline", "u"],
    ["mark", "mark"],
    ["sup", "sup"],
    ["sub", "sub"],
];

/** A picture's bytes as an address the page holds inside itself. */
function dataAddress(picture: Picture): string {
    let binary = "";
    for (let index = 0; index < picture.bytes.length; index += 0x8000) binary += String.fromCharCode(...picture.bytes.subarray(index, index + 0x8000));
    return `data:${picture.type};base64,${btoa(binary)}`;
}

/** True for inline HTML that a browser can show as it is: a lowercase tag or an entity, not a component or an expression of MDX. */
const plainHtml = (html: string) => /^(<\/?[a-z][\w-]*(\s[^>]*)?\/?>|&#?\w+;)$/.test(html.trim());

/** The body of a web page for a document. */
function pageBody(doc: Document, address: (src: string) => string): string {
    const seen = new Map<string, number>();
    const leaf = (run: Leaf): string => {
        if (run.kind === "break") return "<br>";
        if (run.kind === "image") return `<img src="${escape(address(run.src))}" alt="${escape(run.alt)}">`;
        if (run.kind === "footnote") return `<sup><a href="#note-${escape(run.label)}" id="back-${escape(run.label)}">${escape(run.label)}</a></sup>`;
        if (run.kind === "html") return plainHtml(run.html) ? run.html : escape(run.html);
        if (run.kind === "emoji") return escape(emojiOf(run.name) ?? `:${run.name}:`);
        // inline maths is given as its TeX, which any reader of the page can read and a maths script can lay out
        let html = run.marks.includes("math") ? `<code class="math">$${escape(run.text)}$</code>` : escape(run.text);
        for (const [mark, tag] of [...TAGS].reverse()) if (run.marks.includes(mark as never)) html = `<${tag}>${html}</${tag}>`;
        const style = [run.color && `color:${run.color}`, run.size && `font-size:${run.size}`, run.highlight && `background:color-mix(in oklch, ${run.highlight} 45%, transparent)`].filter(Boolean).join(";");
        return style ? `<span style="${escape(style)}">${html}</span>` : html;
    };
    const runs = (list: Run[]): string => list.map((run) => (run.kind === "link" ? `<a href="${escape(address(run.href))}"${run.title ? ` title="${escape(run.title)}"` : ""}>${run.runs.map(leaf).join("")}</a>` : leaf(run))).join("");
    const aligned = (align?: string) => (align ? ` style="text-align:${align}"` : "");
    const blocks = (list: Block[]): string =>
        list
            .map((block): string => {
                switch (block.kind) {
                    case "paragraph":
                        return block.runs.length ? `<p${aligned(block.align)}>${runs(block.runs)}</p>` : "";
                    case "heading": {
                        const id = slug(runsText(block.runs).replace(/￼/g, "").trim(), seen);
                        return `<h${block.level} id="${escape(id)}"${aligned(block.align)}>${runs(block.runs)}</h${block.level}>`;
                    }
                    case "list": {
                        if (block.style === "definition") return `<dl>\n${block.items.map((item) => item.blocks.map((child, index) => `<${index === 0 ? "dt" : "dd"}>${blocks([child]).replace(/^<p>([\s\S]*?)<\/p>$/, "$1")}</${index === 0 ? "dt" : "dd"}>`).join("\n")).join("\n")}\n</dl>`;
                        const tag = block.style === "number" ? "ol" : "ul";
                        const start = block.style === "number" && block.start !== 1 ? ` start="${block.start}"` : "";
                        const items = block.items.map((item) => `<li>${item.checked !== undefined ? `<input type="checkbox" disabled${item.checked ? " checked" : ""}> ` : ""}${blocks(item.blocks).replace(/^<p>([\s\S]*?)<\/p>/, "$1")}</li>`);
                        return `<${tag}${start}>\n${items.join("\n")}\n</${tag}>`;
                    }
                    case "quote":
                        if (block.details) return `<details${block.details.open ? " open" : ""}>\n<summary>${escape(block.details.summary)}</summary>\n${blocks(block.blocks)}\n</details>`;
                        if (block.callout !== undefined) return `<blockquote class="callout callout-${escape(block.callout.toLowerCase())}">\n<p><strong>${escape(block.callout.charAt(0).toUpperCase() + block.callout.slice(1).toLowerCase())}</strong>${block.title ? ` ${escape(block.title)}` : ""}</p>\n${blocks(block.blocks)}\n</blockquote>`;
                        return `<blockquote>\n${blocks(block.blocks)}\n</blockquote>`;
                    case "footnote":
                        return `<div class="footnote" id="note-${escape(block.label)}"><sup>${escape(block.label)}</sup> ${blocks(block.blocks)}</div>`;
                    case "code":
                        return `<pre><code${block.language ? ` class="language-${escape(block.language.split(/\s/)[0]!)}"` : ""}>${escape(block.code)}</code></pre>`;
                    case "table": {
                        const cell = (tag: string, cells: Run[], column: number) => `<${tag}${aligned(block.align[column] ?? undefined)}>${runs(cells)}</${tag}>`;
                        return `<table>\n<thead><tr>${block.header.map((cells, column) => cell("th", cells, column)).join("")}</tr></thead>\n<tbody>\n${block.rows.map((row) => `<tr>${row.map((cells, column) => cell("td", cells, column)).join("")}</tr>`).join("\n")}\n</tbody>\n</table>`;
                    }
                    case "image": {
                        const width = block.width !== undefined ? ` style="width:${block.width}%"` : "";
                        const side = block.align === "left" ? "margin-inline:0 auto" : block.align === "right" ? "margin-inline:auto 0" : "margin-inline:auto";
                        const picture = `<img src="${escape(address(block.src))}" alt="${escape(block.alt)}"${width}>`;
                        return `<figure style="text-align:${block.align ?? "center"}"><div style="display:block;${side};width:fit-content;max-width:100%">${picture}</div>${block.caption ? `<figcaption>${escape(block.caption)}</figcaption>` : ""}</figure>`;
                    }
                    case "divider":
                        return "<hr>";
                    case "raw":
                        if (isPageBreak(block)) return '<div style="break-after: page"></div>';
                        if (isContentsMark(block) || /^(import|export)\b/.test(block.text)) return "";
                        return /^<[a-z]/.test(block.text.trim()) && !doc.mdx && !/<(script|iframe|object|embed)\b|\son\w+=/i.test(block.text) ? block.text : `<pre class="kept">${escape(block.text)}</pre>`;
                }
            })
            .filter(Boolean)
            .join("\n");
    return blocks(doc.blocks);
}

/** The whole of a web page for a document: the site's reading styles and every picture inside it, so that the one file stands alone. */
export function pageHtml(doc: Document, options: { title: string; styles?: string; pictures?: Map<string, Picture> }): string {
    const inlined = new Map<string, string>();
    const address = (src: string) => {
        const picture = options.pictures?.get(src);
        if (!picture) return src;
        if (!inlined.has(src)) inlined.set(src, dataAddress(picture));
        return inlined.get(src)!;
    };
    // the title the editor shows above the writing heads the page too, unless the document has one of its own
    const titled = doc.blocks.some((block) => block.kind === "heading" && block.level === 1);
    const body = `${titled ? "" : `<h1>${escape(options.title)}</h1>\n`}${pageBody(doc, address)}`;
    const frame = "body { box-sizing: border-box; max-width: calc(var(--measure, 38rem) + 4rem); margin: 0 auto; padding: 3rem 2rem 5rem; background: var(--ground, Canvas); color: var(--ink, CanvasText); } figure img { max-width: 100%; height: auto; } figcaption { text-align: center; font-style: italic; color: var(--muted, gray); } .footnote { font-size: 0.9em; color: var(--muted, gray); } pre.kept { opacity: 0.7; white-space: pre-wrap; } @media print { body { max-width: none; padding: 0; background: none; color: black; } }";
    return `<!doctype html>\n<html lang="en">\n<head>\n<meta charset="utf-8">\n<meta name="viewport" content="width=device-width, initial-scale=1">\n<title>${escape(options.title)}</title>\n<style>\n${options.styles ?? ""}\n${frame}\n</style>\n</head>\n<body>\n<main class="prose">\n${body}\n</main>\n</body>\n</html>\n`;
}

// ---- what the browser gives ----

/** Every picture address a document shows, in blocks and in lines. */
export function pictureAddresses(doc: Document): string[] {
    const found = new Set<string>();
    const runs = (list: Run[]) => list.forEach((run) => (run.kind === "link" ? runs(run.runs) : run.kind === "image" && found.add(run.src)));
    const blocks = (list: Block[]) =>
        list.forEach((block) => {
            if (block.kind === "image") found.add(block.src);
            else if (block.kind === "paragraph" || block.kind === "heading") runs(block.runs);
            else if (block.kind === "list") block.items.forEach((item) => blocks(item.blocks));
            else if (block.kind === "quote" || block.kind === "footnote") blocks(block.blocks);
            else if (block.kind === "table") [block.header, ...block.rows].forEach((row) => row.forEach(runs));
        });
    blocks(doc.blocks);
    return [...found];
}

/** The pictures a document shows, fetched as bytes with their size; `show` gives where one kept by a store is seen from. A picture that cannot be fetched is left out, and stays an address. */
export async function gatherPictures(doc: Document, show: (src: string) => Promise<string | undefined>): Promise<Map<string, Picture>> {
    const out = new Map<string, Picture>();
    for (const src of pictureAddresses(doc)) {
        try {
            const from = (await show(src)) ?? src;
            const answer = await fetch(from);
            if (!answer.ok) continue;
            const blob = await answer.blob();
            const size = await new Promise<{ width: number; height: number }>((done) => {
                const image = new Image();
                const url = URL.createObjectURL(blob);
                image.onload = () => (done({ width: image.naturalWidth || 400, height: image.naturalHeight || 300 }), URL.revokeObjectURL(url));
                image.onerror = () => (done({ width: 400, height: 300 }), URL.revokeObjectURL(url));
                image.src = url;
            });
            out.set(src, { bytes: new Uint8Array(await blob.arrayBuffer()), type: blob.type || "image/png", ...size });
        } catch {
            // a picture from somewhere that will not give it stays an address
        }
    }
    return out;
}

/** Selectors of the site's reading styles: the ground, the type, and what a post's Markdown makes. Anything of the editor's own is left out. */
const READING = /^(:root|html|body|\.prose\b[^,]*|h[1-6]|p|a|ul|ol|li|blockquote|code|pre|kbd|table|thead|tbody|tr|th|td|img|figure|figcaption|hr|em|strong|sup|sub|mark|s|u|del|small)(\s*[:>+~\s].*)?$/;

/** The site's reading styles, taken from the page's own stylesheets, with its colors and the fonts they use inlined, for a web page that stands alone. */
export async function readingStyles(): Promise<string> {
    const kept: string[] = [];
    const faces: CSSFontFaceRule[] = [];
    const take = (rules: CSSRuleList, into: string[]) => {
        for (const rule of rules) {
            if (rule instanceof CSSFontFaceRule) faces.push(rule);
            else if (rule instanceof CSSStyleRule) {
                const parts = rule.selectorText.split(",").map((part) => part.trim());
                if (parts.every((part) => READING.test(part) && !part.includes("quire"))) into.push(rule.cssText);
            } else if (rule instanceof CSSMediaRule && /prefers-color-scheme|max-width|min-width/.test(rule.conditionText)) {
                const inner: string[] = [];
                take(rule.cssRules, inner);
                if (inner.length) into.push(`@media ${rule.conditionText} {\n${inner.join("\n")}\n}`);
            }
        }
    };
    for (const sheet of document.styleSheets) {
        try {
            take(sheet.cssRules, kept);
        } catch {
            // a stylesheet from elsewhere cannot be read, and is not the site's
        }
    }
    // the theme's colors are set on <html> itself
    const own = document.documentElement.getAttribute("style");
    if (own) kept.push(`:root { ${own} }`);
    const text = kept.join("\n");
    const used = new Set([...text.matchAll(/--font-[\w-]+:\s*([^;]+)/g)].flatMap((match) => match[1]!.split(",").map((name) => name.trim().replace(/^["']|["']$/g, ""))));
    const inlined: string[] = [];
    for (const face of faces) {
        const family = face.style.getPropertyValue("font-family").trim().replace(/^["']|["']$/g, "");
        if (!used.has(family)) continue;
        let css = face.cssText;
        for (const match of css.matchAll(/url\(["']?([^"')]+)["']?\)/g)) {
            try {
                const bytes = new Uint8Array(await (await fetch(new URL(match[1]!, document.baseURI))).arrayBuffer());
                css = css.replace(match[0], `url("${dataAddress({ bytes, type: "font/woff2", width: 0, height: 0 })}")`);
            } catch {
                // a font that cannot be fetched is named, and the reader's own is used
            }
        }
        inlined.push(css);
    }
    return [...inlined, text].join("\n");
}

/** A CSS color as six hex digits, as Word wants one, worked out by painting it; undefined where there is no canvas. */
export function colorHex(color: string): string | undefined {
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = 1;
    const paint = canvas.getContext("2d", { willReadFrequently: true });
    if (!paint) return undefined;
    paint.fillStyle = "#000";
    paint.fillStyle = color;
    paint.fillRect(0, 0, 1, 1);
    const [red, green, blue] = paint.getImageData(0, 0, 1, 1).data;
    return [red, green, blue].map((value) => (value ?? 0).toString(16).padStart(2, "0")).join("").toUpperCase();
}
