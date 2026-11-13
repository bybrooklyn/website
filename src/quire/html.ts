// HTML in and out of mdQuire. Pasted HTML is read by a small reader of its own, with no DOM, into
// blocks and marks: headings, paragraphs, lists, quotes, code, tables, links, bold, italic,
// underline, strike, code and pictures by address. Everything else is dropped, its text kept where
// it has text, and nothing pasted is ever kept as HTML. Copying writes the selected blocks as
// plain HTML for other programs.
//
// The one sanitiser for HTML that leaves mdQuire is here too, used by paste, copy and the web page
// download (export.ts): `safeAddress` lets through only ordinary addresses, checked as a browser
// would read them; `cleanHtml` and `cleanTag` keep only a short list of plain elements and
// attributes from HTML written in a document, so that nothing in it can run or fetch anything.

import { tidyRuns, type Align, type Block, type Leaf, type ListItem, type Mark, type Run } from "./document";
import { emojiOf } from "./emoji";

// ---- reading ----

interface Element {
    name: string;
    attributes: Record<string, string>;
    children: Node[];
}

type Node = Element | string;

const VOID = new Set("area base br col embed hr img input link meta param source track wbr".split(" "));
/** Elements whose content is never wanted. */
const DROPPED = new Set("head script style template noscript svg math iframe object canvas title button select textarea".split(" "));
const BLOCKS = new Set("address article aside blockquote center details dd div dl dt figcaption figure footer h1 h2 h3 h4 h5 h6 header hr li main nav ol p pre section summary table tbody td tfoot th thead tr ul".split(" "));
const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", copy: "©", reg: "®", hellip: "…", mdash: "—", ndash: "–", lsquo: "‘", rsquo: "’", ldquo: "“", rdquo: "”", bull: "•", middot: "·", times: "×" };

/** Turns character references into characters. */
function decode(text: string): string {
    return text.replace(/&(#\d{1,7}|#[xX][0-9a-fA-F]{1,6}|[A-Za-z]{2,8});/g, (whole, name: string) => {
        if (name[0] === "#") {
            const code = name[1] === "x" || name[1] === "X" ? parseInt(name.slice(2), 16) : parseInt(name.slice(1), 10);
            return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : "�";
        }
        return ENTITIES[name] ?? whole;
    });
}

/** Reads HTML text into a loose tree, closing what was left open the way browsers mostly do. */
function parse(html: string): Element {
    const root: Element = { name: "#root", attributes: {}, children: [] };
    const stack: Element[] = [root];
    const top = () => stack[stack.length - 1]!;
    const closeTo = (name: string) => {
        const index = stack.map((each) => each.name).lastIndexOf(name);
        if (index > 0) stack.length = index;
    };
    // an open item is closed by the next one only inside the same list, not from a list nested in it
    const closeWithin = (name: string, owners: string[]) => {
        const names = stack.map((each) => each.name);
        const index = names.lastIndexOf(name);
        const owner = Math.max(...owners.map((each) => names.lastIndexOf(each)));
        if (index > 0 && index > owner) stack.length = index;
    };
    let index = 0;
    while (index < html.length) {
        const open = html.indexOf("<", index);
        const text = html.slice(index, open < 0 ? html.length : open);
        if (text) top().children.push(decode(text));
        if (open < 0) break;
        index = open;
        if (html.startsWith("<!--", index)) {
            const end = html.indexOf("-->", index + 4);
            index = end < 0 ? html.length : end + 3;
            continue;
        }
        const tag = /^<(\/?)([A-Za-z][\w:-]*)((?:\s+[^\s"'>/=]+(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+))?)*)\s*(\/?)>/.exec(html.slice(index));
        if (!tag) {
            if (/^<[!?]/.test(html.slice(index))) {
                const end = html.indexOf(">", index);
                index = end < 0 ? html.length : end + 1;
                continue;
            }
            top().children.push("<");
            index++;
            continue;
        }
        index += tag[0].length;
        const name = tag[2]!.toLowerCase();
        if (tag[1]) {
            closeTo(name);
            continue;
        }
        const attributes: Record<string, string> = {};
        for (const match of tag[3]!.matchAll(/([^\s"'>/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g)) attributes[match[1]!.toLowerCase()] = decode(match[2] ?? match[3] ?? match[4] ?? "");
        if (DROPPED.has(name)) {
            const end = html.toLowerCase().indexOf(`</${name}`, index);
            index = end < 0 ? html.length : html.indexOf(">", end) + 1 || html.length;
            continue;
        }
        // a new paragraph, item, row or cell closes the one left open
        if (BLOCKS.has(name) && top().name === "p") stack.pop();
        if (name === "li") closeWithin("li", ["ul", "ol"]);
        if (name === "tr") closeWithin("tr", ["table"]);
        if (name === "td" || name === "th") {
            const last = stack[stack.length - 1]!;
            if (last.name === "td" || last.name === "th") stack.pop();
        }
        const element: Element = { name, attributes, children: [] };
        top().children.push(element);
        if (!VOID.has(name) && !tag[4]) stack.push(element);
    }
    return root;
}

const styleOf = (element: Element) => (element.attributes.style ?? "").toLowerCase();

// ---- the sanitiser ----

/** What a browser leaves out of an address before it reads its scheme: control characters, spaces and the like anywhere in it. */
const UNSEEN = /[\u0000-\u0020\u007f-\u00a0\u00ad\u1680\u180e\u2000-\u200f\u2028-\u202f\u205f-\u2064\u3000\ufeff]/g;
/** Pictures a page may hold inside itself: the ordinary kinds of picture, and never SVG, which can carry script. */
const DATA_PICTURE = /^data:image\/(png|jpeg|gif|webp|avif|bmp)[;,]/;

/**
 * An address, if it leads somewhere ordinary: the web (`http:`, `https:`), `mailto:` for a link, a
 * place in the page or beside it, and for a picture a picture held in the address itself (`data:`
 * of an ordinary picture kind, when `data` allows it). Anything else (`javascript:`, `vbscript:`,
 * `data:text/html`, `file:`) gives undefined. The scheme is read as a browser reads it: entities
 * decoded, and tabs, line breaks, control characters and spaces taken out first, so that
 * `java&#9;script:` is seen for what it is.
 */
export function safeAddress(address: string | undefined, kind: "link" | "picture" = "link", data = true): string | undefined {
    if (!address) return undefined;
    let seen = address;
    // decoded until it no longer changes: stricter than a browser, which decodes once
    for (let times = 0; times < 4; times++) {
        const next = decode(seen);
        if (next === seen) break;
        seen = next;
    }
    seen = seen.replace(UNSEEN, "").toLowerCase();
    const scheme = /^([a-z][a-z0-9+.-]*):/.exec(seen)?.[1];
    const kept = address.trim();
    if (scheme === undefined) return seen.includes(":") && !/^[^:]*[/?#]/.test(seen) ? undefined : kept;
    if (scheme === "http" || scheme === "https") return kept;
    if (scheme === "mailto" && kind === "link") return kept;
    if (scheme === "data" && kind === "picture" && data && DATA_PICTURE.test(seen)) return kept;
    return undefined;
}

/** True for an address on another site, which a page showing it would fetch from there. */
export function remote(address: string): boolean {
    return /^(https?:)?\/\//i.test(address.replace(UNSEEN, ""));
}

/** The elements HTML written in a document may keep when it leaves mdQuire: text and its structure, nothing that runs, fetches, embeds or asks. */
const ALLOWED = new Set("a abbr b bdi bdo blockquote br caption center cite code col colgroup dd del details dfn div dl dt em figcaption figure h1 h2 h3 h4 h5 h6 hr i img ins kbd li mark ol p pre q rp rt ruby s samp small span strong sub summary sup table tbody td tfoot th thead time tr u ul var wbr".split(" "));
/** The attributes any of them may keep, and those only some may. */
const EVERYWHERE = new Set(["title", "lang", "dir", "class", "id", "align", "style"]);
const OWN: Record<string, string[]> = { a: ["href"], img: ["src", "alt", "width", "height"], td: ["colspan", "rowspan"], th: ["colspan", "rowspan", "scope"], col: ["span"], colgroup: ["span"], ol: ["start", "reversed", "type"], li: ["value"], details: ["open"], time: ["datetime"] };

/** A style attribute's value, if it can only change how text looks: no address, no expression, no escapes to hide them. */
export function safeStyle(style: string): string | undefined {
    if (!/^[\w\s#%.,:;()'"!/+-]*$/.test(style)) return undefined;
    if (/url\s*\(|expression|@import|image-set|image\s*\(|element\s*\(|binding|behavior|javascript|src\s*\(/i.test(style)) return undefined;
    return style;
}

/** A CSS value for one property (a colour, a size), if it is plainly one: a word, a number, a hex colour, or one colour function. */
export function safeValue(value: string | undefined): string | undefined {
    if (!value) return undefined;
    const plain = value.trim();
    if (/^[#\w.%\s-]+$/.test(plain)) return plain;
    if (/^(rgb|rgba|hsl|hsla|hwb|lab|lch|oklab|oklch|color)\([\w\s.,%#/+-]*\)$/i.test(plain)) return plain;
    return undefined;
}

/** An element's attributes as written out, keeping only those on the list, with addresses and styles checked. */
function cleanAttributes(name: string, attributes: Record<string, string>): string {
    let out = "";
    for (const [key, value] of Object.entries(attributes)) {
        if (!EVERYWHERE.has(key) && !OWN[name]?.includes(key)) continue;
        const kept = key === "href" ? safeAddress(value, "link") : key === "src" ? safeAddress(value, "picture") : key === "style" ? safeStyle(value) : value;
        // a picture is never fetched from elsewhere by a page written from a document
        if (kept === undefined || (key === "src" && remote(kept))) continue;
        out += ` ${key}="${escape(kept)}"`;
    }
    return out;
}

/** HTML written in a document, made safe to put into a page: only the allowed elements and attributes, every text escaped. */
export function cleanHtml(html: string): string {
    const write = (nodes: Node[]): string =>
        nodes
            .map((node) => {
                if (typeof node === "string") return escape(node);
                const inner = write(node.children);
                if (!ALLOWED.has(node.name)) return inner;
                if (node.name === "img" && !cleanAttributes("img", node.attributes).includes(" src=")) return node.attributes.alt ? escape(node.attributes.alt) : "";
                return VOID.has(node.name) ? `<${node.name}${cleanAttributes(node.name, node.attributes)}>` : `<${node.name}${cleanAttributes(node.name, node.attributes)}>${inner}</${node.name}>`;
            })
            .join("");
    return write(parse(html).children);
}

/** One tag or character reference written in a line of a document, as `cleanHtml` would keep it, or escaped to show as text. */
export function cleanTag(html: string): string {
    const plain = html.trim();
    if (/^&(#\d{1,7}|#x[0-9a-f]{1,6}|[a-z][a-z0-9]{1,31});$/i.test(plain)) return plain;
    const tag = /^<(\/?)([a-z][\w-]*)((?:\s+[^\s"'>/=]+(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+))?)*)\s*\/?>$/i.exec(plain);
    const name = tag?.[2]!.toLowerCase();
    if (!tag || !name || !ALLOWED.has(name)) return escape(html);
    if (tag[1]) return VOID.has(name) ? "" : `</${name}>`;
    const attributes: Record<string, string> = {};
    for (const match of tag[3]!.matchAll(/([^\s"'>/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g)) attributes[match[1]!.toLowerCase()] = decode(match[2] ?? match[3] ?? match[4] ?? "");
    if (name === "img") {
        const kept = cleanAttributes(name, attributes);
        return kept.includes(" src=") ? `<img${kept}>` : escape(attributes.alt ?? "");
    }
    return `<${name}${cleanAttributes(name, attributes)}>`;
}

/** Only addresses that lead somewhere ordinary are kept from a paste: no `javascript:`, no `data:`. */
const safe = (href: string | undefined, kind: "link" | "picture" = "link") => safeAddress(href, kind, false);

interface Look {
    marks: Mark[];
    link?: { href: string; title?: string };
    pre: boolean;
}

function marksFor(element: Element, marks: Mark[]): Mark[] {
    const out = new Set(marks);
    const style = styleOf(element);
    const name = element.name;
    // Google Docs wraps a whole copy in <b style="font-weight:normal">
    const weight = /font-weight\s*:\s*(\w+)/.exec(style)?.[1];
    if ((name === "b" || name === "strong") && weight !== "normal" && weight !== "400") out.add("bold");
    if (weight === "bold" || weight === "700" || weight === "600" || weight === "800" || weight === "900") out.add("bold");
    if (name === "em" || name === "i" || /font-style\s*:\s*italic/.test(style)) out.add("italic");
    if (name === "u" || name === "ins" || /text-decoration[^;]*underline/.test(style)) out.add("underline");
    if (name === "s" || name === "strike" || name === "del" || /text-decoration[^;]*line-through/.test(style)) out.add("strike");
    if (name === "code" || name === "kbd" || name === "samp" || name === "tt") out.add("code");
    return [...out];
}

function inline(nodes: Node[], look: Look): Run[] {
    const runs: Run[] = [];
    const push = (leaf: Leaf) => {
        if (look.link) runs.push({ kind: "link", href: look.link.href, ...(look.link.title ? { title: look.link.title } : {}), runs: [leaf] });
        else runs.push(leaf);
    };
    for (const node of nodes) {
        if (typeof node === "string") {
            const text = look.pre ? node : node.replace(/[\s ]+/g, (spaces) => (spaces.includes(" ") && !/[ \t\n\r]/.test(spaces) ? spaces : " "));
            if (text) push({ kind: "text", text, marks: [...look.marks] });
        } else if (node.name === "br") push({ kind: "break" });
        else if (node.name === "img") {
            const src = safe(node.attributes.src, "picture");
            if (src) push({ kind: "image", src, alt: node.attributes.alt ?? "", ...(node.attributes.title ? { title: node.attributes.title } : {}) });
        } else if (node.name === "input") continue;
        else if (node.name === "a") {
            const href = safe(node.attributes.href);
            runs.push(...inline(node.children, { ...look, link: href ? { href, ...(node.attributes.title ? { title: node.attributes.title } : {}) } : look.link }));
        } else runs.push(...inline(node.children, { ...look, marks: marksFor(node, look.marks) }));
    }
    return runs;
}

/** Trims the spaces at the two ends of a line of runs, as a browser does when it shows them. */
function trimRuns(runs: Run[]): Run[] {
    const tidy = tidyRuns(runs);
    const edge = (run: Run | undefined, start: boolean): Run | undefined => {
        if (!run) return run;
        if (run.kind === "text") return { ...run, text: start ? run.text.replace(/^ +/, "") : run.text.replace(/ +$/, "") };
        if (run.kind === "link") {
            const inner = [...run.runs];
            const index = start ? 0 : inner.length - 1;
            inner[index] = edge(inner[index], start) as Leaf;
            return { ...run, runs: inner };
        }
        return run;
    };
    if (tidy.length) tidy[0] = edge(tidy[0], true)!;
    if (tidy.length) tidy[tidy.length - 1] = edge(tidy[tidy.length - 1], false)!;
    return tidyRuns(tidy);
}

const textOf = (node: Node): string => (typeof node === "string" ? node : node.name === "br" ? "\n" : node.children.map(textOf).join(""));
const findAll = (element: Element, name: string): Element[] => element.children.flatMap((child) => (typeof child === "string" ? [] : child.name === name ? [child] : ["thead", "tbody", "tfoot"].includes(child.name) ? findAll(child, name) : []));

function alignOf(element: Element): Align | null {
    const value = (element.attributes.align ?? /text-align\s*:\s*(\w+)/.exec(styleOf(element))?.[1] ?? "").toLowerCase();
    return value === "center" || value === "right" || value === "left" ? value : null;
}

function blocks(nodes: Node[], look: Look): Block[] {
    const out: Block[] = [];
    let pending: Node[] = [];
    const flush = () => {
        const runs = trimRuns(inline(pending, look));
        pending = [];
        if (runs.length === 0) return;
        const only = runs[0];
        if (runs.length === 1 && only?.kind === "image") out.push({ kind: "image", src: only.src, alt: only.alt, ...(only.title ? { title: only.title } : {}), gap: "" });
        else if (runs.some((run) => run.kind !== "text" || run.text.trim() !== "")) out.push({ kind: "paragraph", runs, gap: "" });
    };
    for (const node of nodes) {
        if (typeof node === "string" || !BLOCKS.has(node.name)) {
            pending.push(node);
            continue;
        }
        flush();
        const name = node.name;
        if (/^h[1-6]$/.test(name)) {
            const runs = trimRuns(inline(node.children, look));
            if (runs.length) out.push({ kind: "heading", level: Number(name[1]) as 1, runs, gap: "" });
        } else if (name === "ul" || name === "ol") {
            const items: ListItem[] = findAll(node, "li").map((li) => {
                const box = li.children.find((child): child is Element => typeof child !== "string" && child.name === "input" && child.attributes.type === "checkbox");
                const item: ListItem = { blocks: blocks(li.children, look), gap: "" };
                if (box) item.checked = "checked" in box.attributes;
                if (item.blocks.length === 0) item.blocks = [{ kind: "paragraph", runs: [], gap: "" }];
                return item;
            });
            if (items.length === 0) continue;
            const task = items.every((item) => item.checked !== undefined);
            const start = parseInt(node.attributes.start ?? "1", 10);
            out.push({ kind: "list", style: name === "ol" ? "number" : task ? "task" : "bullet", marker: "-", delimiter: ".", start: Number.isFinite(start) ? start : 1, loose: false, items, gap: "" });
        } else if (name === "blockquote") {
            const inner = blocks(node.children, look);
            if (inner.length) out.push({ kind: "quote", blocks: inner, gap: "" });
        } else if (name === "pre") {
            const codeElement = node.children.find((child): child is Element => typeof child !== "string" && child.name === "code");
            const language = /(?:^|\s)(?:language|lang)-(\S+)/.exec(`${codeElement?.attributes.class ?? ""} ${node.attributes.class ?? ""}`)?.[1] ?? "";
            out.push({ kind: "code", language, code: textOf(node).replace(/\n$/, ""), gap: "" });
        } else if (name === "table") {
            const rows = findAll(node, "tr").map((row) => row.children.filter((child): child is Element => typeof child !== "string" && (child.name === "td" || child.name === "th")));
            const [head, ...body] = rows.filter((row) => row.length);
            if (!head) continue;
            const width = Math.max(head.length, ...body.map((row) => row.length));
            const cell = (element?: Element) => (element ? trimRuns(inline(element.children, look).map((run) => (run.kind === "break" ? { kind: "text" as const, text: " ", marks: [] } : run))) : []);
            const pad = (row: Element[]) => Array.from({ length: width }, (_, column) => cell(row[column]));
            out.push({ kind: "table", header: pad(head), align: Array.from({ length: width }, (_, column) => (head[column] ? alignOf(head[column]!) : null)), rows: body.map(pad), gap: "" });
        } else if (name === "hr") out.push({ kind: "divider", gap: "" });
        else out.push(...blocks(node.children, look));
    }
    flush();
    return out;
}

/** Reads pasted HTML into blocks, keeping only what Markdown can hold. */
export function readHtml(html: string): Block[] {
    const body = /<body[^>]*>([\s\S]*)<\/body>/i.exec(html)?.[1] ?? html;
    const cut = /<!--StartFragment-->([\s\S]*)<!--EndFragment-->/.exec(body)?.[1] ?? body;
    return blocks(parse(cut).children, { marks: [], pre: false });
}

// ---- writing ----

const escape = (text: string) => text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const TAGS: [Mark, string][] = [
    ["bold", "strong"],
    ["italic", "em"],
    ["underline", "u"],
    ["strike", "s"],
    ["code", "code"],
    ["mark", "mark"],
    ["sup", "sup"],
    ["sub", "sub"],
];

function runsHtml(runs: Run[]): string {
    return runs
        .map((run): string => {
            if (run.kind === "link") {
                const href = safeAddress(run.href);
                return href === undefined ? runsHtml(run.runs) : `<a href="${escape(href)}"${run.title ? ` title="${escape(run.title)}"` : ""}>${runsHtml(run.runs)}</a>`;
            }
            if (run.kind === "break") return "<br>";
            if (run.kind === "image") return picture(run.src, run.alt);
            if (run.kind === "footnote") return `<sup>[${escape(run.label)}]</sup>`;
            if (run.kind === "html") return escape(run.html);
            if (run.kind === "emoji") return emojiOf(run.name) ?? `:${escape(run.name)}:`;
            let html = escape(run.marks.includes("math") ? `$${run.text}$` : run.text);
            for (const [mark, tag] of [...TAGS].reverse()) if (run.marks.includes(mark)) html = `<${tag}>${html}</${tag}>`;
            const color = safeValue(run.color);
            const size = safeValue(run.size);
            const style = [color && `color:${color}`, size && `font-size:${size}`].filter(Boolean).join(";");
            return style ? `<span style="${escape(style)}">${html}</span>` : html;
        })
        .join("");
}

/** A picture for the clipboard, or its words where its address is not an ordinary one. */
function picture(src: string, alt: string): string {
    const address = safeAddress(src, "picture");
    return address === undefined ? escape(alt) : `<img src="${escape(address)}" alt="${escape(alt)}">`;
}

/** Writes blocks as plain HTML, for the clipboard. */
export function writeHtml(list: Block[]): string {
    return list
        .map((block): string => {
            const align = "align" in block && block.align ? ` style="text-align:${block.align}"` : "";
            switch (block.kind) {
                case "paragraph":
                    return `<p${align}>${runsHtml(block.runs)}</p>`;
                case "heading":
                    return `<h${block.level}${align}>${runsHtml(block.runs)}</h${block.level}>`;
                case "list": {
                    if (block.style === "definition") return `<dl>${block.items.map((item) => item.blocks.map((child, index) => `<${index === 0 ? "dt" : "dd"}>${writeHtml([child])}</${index === 0 ? "dt" : "dd"}>`).join("")).join("")}</dl>`;
                    const tag = block.style === "number" ? "ol" : "ul";
                    const start = block.style === "number" && block.start !== 1 ? ` start="${block.start}"` : "";
                    const items = block.items.map((item) => `<li>${item.checked !== undefined ? `<input type="checkbox" disabled${item.checked ? " checked" : ""}> ` : ""}${writeHtml(item.blocks)}</li>`);
                    return `<${tag}${start}>${items.join("")}</${tag}>`;
                }
                case "quote":
                    if (block.details) return `<details${block.details.open ? " open" : ""}><summary>${escape(block.details.summary)}</summary>${writeHtml(block.blocks)}</details>`;
                    if (block.callout !== undefined) return `<blockquote><p><strong>${escape(block.callout.charAt(0) + block.callout.slice(1).toLowerCase())}</strong>${block.title ? ` ${escape(block.title)}` : ""}</p>${writeHtml(block.blocks)}</blockquote>`;
                    return `<blockquote>${writeHtml(block.blocks)}</blockquote>`;
                case "footnote":
                    return `<div><sup>[${escape(block.label)}]</sup> ${writeHtml(block.blocks)}</div>`;
                case "code":
                    return `<pre><code${block.language ? ` class="language-${escape(block.language.split(/\s/)[0]!)}"` : ""}>${escape(block.code)}</code></pre>`;
                case "table": {
                    const cell = (tag: string, runs: Run[], column: number) => `<${tag}${block.align[column] ? ` style="text-align:${block.align[column]}"` : ""}>${runsHtml(runs)}</${tag}>`;
                    const head = `<tr>${block.header.map((runs, column) => cell("th", runs, column)).join("")}</tr>`;
                    const rows = block.rows.map((row) => `<tr>${row.map((runs, column) => cell("td", runs, column)).join("")}</tr>`);
                    return `<table><thead>${head}</thead><tbody>${rows.join("")}</tbody></table>`;
                }
                case "image":
                    return `<p${align}>${picture(block.src, block.alt)}</p>`;
                case "divider":
                    return "<hr>";
                case "raw":
                    return `<pre>${escape(block.text)}</pre>`;
            }
        })
        .join("");
}
