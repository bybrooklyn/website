// HTML in and out of mdQuire. Pasted HTML is read by a small reader of its own, with no DOM, into
// blocks and marks: headings, paragraphs, lists, quotes, code, tables, links, bold, italic,
// underline, strike, code and pictures by address. Everything else is dropped, its text kept where
// it has text, and nothing pasted is ever kept as HTML. Copying writes the selected blocks as
// plain HTML for other programs.

import { tidyRuns, type Align, type Block, type Leaf, type ListItem, type Mark, type Run } from "./document";

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

/** Only addresses that lead somewhere ordinary are kept: no `javascript:`, no `data:`. */
function safe(href: string | undefined): string | undefined {
    if (!href) return undefined;
    const trimmed = href.trim();
    if (/^(https?:|mailto:|\/|#|\.{0,2}\/)/i.test(trimmed) || !/^[a-z][a-z0-9+.-]*:/i.test(trimmed)) return trimmed;
    return undefined;
}

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
            const src = safe(node.attributes.src);
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
];

function runsHtml(runs: Run[]): string {
    return runs
        .map((run): string => {
            if (run.kind === "link") return `<a href="${escape(run.href)}"${run.title ? ` title="${escape(run.title)}"` : ""}>${runsHtml(run.runs)}</a>`;
            if (run.kind === "break") return "<br>";
            if (run.kind === "image") return `<img src="${escape(run.src)}" alt="${escape(run.alt)}">`;
            if (run.kind === "footnote") return `<sup>[${escape(run.label)}]</sup>`;
            if (run.kind === "html") return escape(run.html);
            let html = escape(run.text);
            for (const [mark, tag] of [...TAGS].reverse()) if (run.marks.includes(mark)) html = `<${tag}>${html}</${tag}>`;
            const style = [run.color && `color:${run.color}`, run.size && `font-size:${run.size}`].filter(Boolean).join(";");
            return style ? `<span style="${escape(style)}">${html}</span>` : html;
        })
        .join("");
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
                    const tag = block.style === "number" ? "ol" : "ul";
                    const start = block.style === "number" && block.start !== 1 ? ` start="${block.start}"` : "";
                    const items = block.items.map((item) => `<li>${item.checked !== undefined ? `<input type="checkbox" disabled${item.checked ? " checked" : ""}> ` : ""}${writeHtml(item.blocks)}</li>`);
                    return `<${tag}${start}>${items.join("")}</${tag}>`;
                }
                case "quote":
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
                    return `<p${align}><img src="${escape(block.src)}" alt="${escape(block.alt)}"></p>`;
                case "divider":
                    return "<hr>";
                case "raw":
                    return `<pre>${escape(block.text)}</pre>`;
            }
        })
        .join("");
}
