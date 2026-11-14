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
import { cleanHtml, cleanTag, safeAddress, safeValue } from "./html";
import { pictureType } from "../core/picture-bytes";

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
    // the subtitle goes into the frontmatter, as a Markdown file keeps it (write.ts)
    const subtitle = doc.blocks.findIndex((block) => block.kind === "paragraph" && block.subtitle);
    return write({ ...plain, blocks: unkeep(markdownOnly(doc.blocks)).map((block, index) => (index === subtitle ? { ...block, subtitle: true } : block)) });
}

// ---- plain text ----

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

/** True for HTML that MDX would read as a component or an expression rather than plain HTML. */
const component = (html: string) => /^<\/?[A-Z]|[{}]/.test(html.trim());

/**
 * The policy the downloaded page carries: it may show only pictures held inside it and its own
 * styles and fonts, and run nothing, so that nothing written in a document can run or fetch anything
 * when the page is opened, from a disk or anywhere else.
 */
export const PAGE_POLICY = "default-src 'none'; img-src data:; style-src 'unsafe-inline'; font-src data:; base-uri 'none'; form-action 'none'";

/** The body of a web page for a document. `address` gives a picture's bytes as an address held in the page, where they were gathered. */
function pageBody(doc: Document, address: (src: string) => string): string {
    const seen = new Map<string, number>();
    /** A picture held in the page; one that is not (from elsewhere on the web, or not found) is a link to where it is, so that opening the page fetches nothing. */
    const picture = (src: string, alt: string, width = "") => {
        const held = safeAddress(address(src), "picture");
        if (held?.startsWith("data:")) return `<img src="${escape(held)}" alt="${escape(alt)}"${width}>`;
        const link = safeAddress(src);
        const words = escape(alt || src);
        return link === undefined ? words : `<a class="picture-link" href="${escape(link)}">${words}</a>`;
    };
    const leaf = (run: Leaf): string => {
        if (run.kind === "break") return "<br>";
        if (run.kind === "image") return picture(run.src, run.alt);
        if (run.kind === "footnote") return `<sup><a href="#note-${escape(run.label)}" id="back-${escape(run.label)}">${escape(run.label)}</a></sup>`;
        if (run.kind === "html") return doc.mdx && component(run.html) ? escape(run.html) : cleanTag(run.html);
        if (run.kind === "emoji") return escape(emojiOf(run.name) ?? `:${run.name}:`);
        // inline maths is given as its TeX, which any reader of the page can read and a maths script can lay out
        let html = run.marks.includes("math") ? `<code class="math">$${escape(run.text)}$</code>` : escape(run.text);
        for (const [mark, tag] of [...TAGS].reverse()) if (run.marks.includes(mark as never)) html = `<${tag}>${html}</${tag}>`;
        // a colour, size or highlight from a file is used only if it is plainly one, so it cannot add a rule or an address
        const [color, size, highlight] = [safeValue(run.color), safeValue(run.size), safeValue(run.highlight)];
        const style = [color && `color:${color}`, size && `font-size:${size}`, highlight && `background:color-mix(in oklch, ${highlight} 45%, transparent)`].filter(Boolean).join(";");
        return style ? `<span style="${escape(style)}">${html}</span>` : html;
    };
    const runs = (list: Run[]): string =>
        list
            .map((run) => {
                if (run.kind !== "link") return leaf(run);
                const href = safeAddress(run.href);
                const inner = run.runs.map(leaf).join("");
                return href === undefined ? inner : `<a href="${escape(href)}"${run.title ? ` title="${escape(run.title)}"` : ""}>${inner}</a>`;
            })
            .join("");
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
                        const width = block.width !== undefined && Number.isFinite(Number(block.width)) ? ` style="width:${Number(block.width)}%"` : "";
                        // one the text flows round floats at its side, at its width, as the editor draws it
                        if (block.wrap) {
                            const float = block.align === "right" ? "right;margin:0.3em 0 0.5em 1.5em" : "left;margin:0.3em 1.5em 0.5em 0";
                            const size = width ? `width:${Number(block.width)}%` : "max-width:50%";
                            return `<figure style="float:${float};${size}">${picture(block.src, block.alt, ' style="width:100%"')}${block.caption ? `<figcaption>${escape(block.caption)}</figcaption>` : ""}</figure>`;
                        }
                        // a picture with no alignment sits at the left, as the editor draws it
                        const side = block.align === "center" ? "margin-inline:auto" : block.align === "right" ? "margin-inline:auto 0" : "margin-inline:0 auto";
                        const align = block.align === "center" || block.align === "right" ? block.align : "left";
                        return `<figure style="text-align:${align}"><div style="display:block;${side};width:fit-content;max-width:100%">${picture(block.src, block.alt, width)}</div>${block.caption ? `<figcaption>${escape(block.caption)}</figcaption>` : ""}</figure>`;
                    }
                    case "divider":
                        return "<hr>";
                    case "raw":
                        if (isPageBreak(block)) return '<div style="break-after: page"></div>';
                        if (isContentsMark(block) || /^(import|export)\b/.test(block.text)) return "";
                        // HTML written in a Markdown file is shown, through the allow-list; an MDX file's is its own, and is shown as written
                        return /^<[a-z]/.test(block.text.trim()) && !doc.mdx ? cleanHtml(block.text) : `<pre class="kept">${escape(block.text)}</pre>`;
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
    return `<!doctype html>\n<html lang="en">\n<head>\n<meta charset="utf-8">\n<meta http-equiv="Content-Security-Policy" content="${PAGE_POLICY}">\n<meta name="viewport" content="width=device-width, initial-scale=1">\n<title>${escape(options.title)}</title>\n<style>\n${options.styles ?? ""}\n${frame}\n</style>\n</head>\n<body>\n<main class="prose">\n${body}\n</main>\n</body>\n</html>\n`;
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

/** The pictures a document's web page or Word file would leave as addresses: those from elsewhere, or not found, rather than held inside it. */
export function heldElsewhere(doc: Document, pictures: Map<string, Picture>): string[] {
    return pictureAddresses(doc).filter((src) => !pictures.has(src));
}

/**
 * The pictures a document shows, fetched as bytes with their size; `show` gives where one kept by a
 * store is seen from. Only those a store keeps, and those held in their own address, are fetched:
 * a picture from elsewhere on the web is never asked for, so that downloading a document does not
 * tell another site it was (a tracking picture), and it stays an address.
 */
export async function gatherPictures(doc: Document, show: (src: string) => Promise<string | undefined>): Promise<Map<string, Picture>> {
    const out = new Map<string, Picture>();
    for (const src of pictureAddresses(doc)) {
        try {
            const from = (await show(src)) ?? (/^data:image\//i.test(src) ? src : undefined);
            if (from === undefined) continue;
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
            // the type is read from the bytes, so that a JPEG kept with no type is not written into Word as a PNG
            const bytes = new Uint8Array(await blob.arrayBuffer());
            const read = pictureType(bytes, src);
            out.set(src, { bytes, type: read === "application/octet-stream" ? blob.type || read : read, ...size });
        } catch {
            // a picture from somewhere that will not give it stays an address
        }
    }
    return out;
}

/** Selectors of the site's reading styles: the ground, the type, and what a post's Markdown makes. Anything of the editor's own is left out. */
const READING = /^(:root|html|body|\.prose\b[^,]*|h[1-6]|p|a|ul|ol|li|blockquote|code|pre|kbd|table|thead|tbody|tr|th|td|img|figure|figcaption|hr|em|strong|sup|sub|mark|s|u|del|small)(\s*[:>+~\s].*)?$/;

/** How a reading rule in prose.css leaves out the editor's own blocks. */
const EDITOR_LEFT_OUT = ":not(.quire > *)";

/** The site's reading styles, taken from the page's own stylesheets, with its colors and the fonts they use inlined, for a web page that stands alone. */
export async function readingStyles(): Promise<string> {
    const kept: string[] = [];
    const faces: CSSFontFaceRule[] = [];
    const take = (rules: CSSRuleList, into: string[]) => {
        for (const rule of rules) {
            if (rule instanceof CSSFontFaceRule) faces.push(rule);
            else if (rule instanceof CSSStyleRule) {
                // a reading rule that leaves the editor's own blocks out (prose.css) is the reader's still
                const parts = rule.selectorText.replaceAll(EDITOR_LEFT_OUT, "").split(",").map((part) => part.trim());
                if (parts.every((part) => READING.test(part) && !part.includes("quire"))) into.push(rule.cssText.replaceAll(EDITOR_LEFT_OUT, ""));
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
