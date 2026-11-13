// A document back to Markdown text. A block that still has its source is written as that source,
// byte for byte; only a block that was changed is written fresh, in one style: `#` headings, `-`
// bullets, `**` and `*`, fenced code, padded tables. Color and size become a `<span style>`,
// underline `<u>`, and alignment a `<div align>` around the block, the forms the reader reads back.

import { pictureHtml, sized } from "./pictures";
import type { Align, Block, Document, Leaf, List, Run, TextRun } from "./document";
import { emojiOf } from "./emoji";

interface Context {
    eol: string;
    mdx: boolean;
    /** Set while the runs being written hold dollar signs that could pair as maths, so that each is escaped. */
    dollars?: boolean;
}

/** Text marked as maths or code is written as it is, inside its own delimiters, and never escaped. */
const literal = (leaf: TextRun) => leaf.marks.includes("code") || leaf.marks.includes("math");

/** Writes a whole document. */
export function write(doc: Document): string {
    const context: Context = { eol: doc.eol, mdx: doc.mdx };
    return doc.bom + (doc.frontmatter ?? "") + doc.lead + writeBlocks(doc.blocks, context, false, false);
}

const lineEndings = (gap: string) => (gap.match(/\n/g) ?? []).length;

/** Whether two neighbours need a blank line between them so that they read back as two blocks. */
function needsBlank(before: Block, after: Block, tight: boolean): boolean {
    if (before.kind === "heading" || after.kind === "heading") return false;
    if (tight && after.kind === "list") return false;
    return true;
}

/** Writes blocks one after another. `inside` is true in a list item, quote or footnote, where the last block ends with nothing. */
function writeBlocks(all: Block[], context: Context, tight: boolean, inside: boolean): string {
    // an empty paragraph has no Markdown form, so a fresh one is left out
    const blocks = all.filter((block) => !(block.source === undefined && block.kind === "paragraph" && block.runs.length === 0));
    if (blocks.length && blocks.length < all.length && all[all.length - 1] !== blocks[blocks.length - 1]) blocks[blocks.length - 1] = { ...blocks[blocks.length - 1]!, gap: all[all.length - 1]!.gap };
    let out = "";
    blocks.forEach((block, index) => {
        out += block.source ?? writeBlock(block, context);
        const next = blocks[index + 1];
        let gap = block.gap;
        if (!next) gap = inside ? "" : gap;
        else if (block.source === undefined || next.source === undefined || lineEndings(gap) === 0) {
            // a gap beside a fresh block keeps the two apart
            if (lineEndings(gap) === 0) gap = context.eol;
            if (lineEndings(gap) < 2 && needsBlank(block, next, tight)) gap = context.eol + context.eol;
        }
        out += gap;
    });
    return out;
}

/** Puts a prefix before each line of text: `first` on the first, `rest` on the others, `empty` on blank ones. */
function prefixLines(text: string, first: string, rest: string, empty: string): string {
    const parts = text.split(/(\r?\n)/);
    let out = "";
    for (let index = 0; index < parts.length; index += 2) {
        const line = parts[index]!;
        const prefix = index === 0 ? first : /^[ \t]*$/.test(line) ? empty : rest;
        out += (line === "" && index !== 0 ? prefix.trimEnd() : prefix) + line + (parts[index + 1] ?? "");
    }
    return out;
}

function writeBlock(block: Block, context: Context): string {
    const eol = context.eol;
    const aligned = (inner: string, align?: string) => (align ? `<div align="${align}">${eol}${eol}${inner}${eol}${eol}</div>` : inner);
    switch (block.kind) {
        case "paragraph":
            return aligned((block.subtext ? "-# " : "") + paragraphText(block.runs, context), block.align);
        case "heading": {
            let content = writeRuns(block.runs, context, false).replace(/[ \t]*\n[ \t]*/g, " ").trim();
            // a heading that ends in #s would lose them as a closing sequence
            if (/(^|[ \t])#+$/.test(content)) content = content.replace(/#(#*)$/, "\\#$1");
            return aligned("#".repeat(block.level) + (content ? ` ${content}` : ""), block.align);
        }
        case "image":
            return aligned(sized(block) ? pictureHtml(block) : imageText(block.src, block.alt, block.title), block.align);
        case "divider":
            return "---";
        case "code": {
            if (block.dollars && block.language === "math" && !/^[ \t]*\$\$[ \t]*$/m.test(block.code)) return `$$${eol}${block.code.split("\n").join(eol)}${eol}$$`;
            const longest = Math.max(0, ...(block.code.match(/`+/g) ?? []).map((run) => run.length));
            const fence = block.language.includes("`") ? "~~~" : "`".repeat(Math.max(3, longest + 1));
            const body = block.code === "" ? "" : block.code.split("\n").join(eol) + eol;
            return `${fence}${block.language}${eol}${body}${fence}`;
        }
        case "table":
            return tableText(block.header, block.align, block.rows, context);
        case "list":
            return listText(block, context);
        case "quote": {
            const inner = writeBlocks(block.blocks, context, false, true);
            if (block.details) {
                const { summary, open } = block.details;
                return `<details${open ? " open" : ""}>${eol}<summary>${summary.replace(/[\r\n]+/g, " ")}</summary>${eol}${eol}${inner === "" ? "" : inner + eol + eol}</details>`;
            }
            if (block.callout !== undefined) {
                const head = `[!${block.callout}]${block.title ? ` ${block.title.replace(/[\r\n]+/g, " ")}` : ""}`;
                return prefixLines(inner === "" ? head : head + eol + inner, "> ", "> ", ">");
            }
            return prefixLines(inner, "> ", "> ", ">");
        }
        case "footnote":
            return prefixLines(writeBlocks(block.blocks, context, false, true), `[^${block.label}]: `, "    ", "");
        case "raw":
            return block.text;
    }
}

function listText(list: List, context: Context): string {
    const eol = context.eol;
    const sep = list.loose ? eol + eol : eol;
    let out = "";
    list.items.forEach((item, index) => {
        const marker = list.style === "number" ? `${list.start + index}${list.delimiter}` : list.marker;
        let text: string;
        if (list.style === "definition") text = item.source ?? definitionText(item.blocks, context);
        else if (item.source !== undefined) {
            // only the first number of a numbered list counts, so it alone is kept right
            text = index === 0 && list.style === "number" ? item.source.replace(/^( {0,3})\d{1,9}(?=[.)])/, `$1${list.start}`) : item.source;
        } else {
            // a box belongs to an item, not to its list: a plain bullet among checklist items keeps its bullet
            const box = item.checked !== undefined ? `[${item.checked ? "x" : " "}]` : "";
            const inner = writeBlocks(item.blocks, context, !list.loose, true);
            const head = `${marker} ${box ? `${box} ` : ""}`;
            text = inner === "" ? head.trimEnd() : prefixLines(inner, head, " ".repeat(marker.length + 1), "");
        }
        out += text;
        if (index < list.items.length - 1) out += lineEndings(item.gap) > 0 && (item.source !== undefined || lineEndings(item.gap) >= lineEndings(sep)) ? item.gap : sep;
    });
    return out;
}

/** A definition list's item: its term on a line, then each definition on a line after a colon. Each keeps its own text if it was not changed. */
function definitionText(blocks: Block[], context: Context): string {
    return blocks
        .map((block, index) => {
            let line = block.source ?? (block.kind === "paragraph" || block.kind === "heading" ? writeRuns(block.runs, context, false).replace(/[ \t]*\n[ \t]*/g, " ").trim() : writeBlock(block, context).replace(/\r?\n/g, " "));
            // a term must not read as a definition, or as the start of some other block
            if (index === 0 && block.source === undefined) line = /^(:|#{1,6}(\s|$)|>|[-+*](\s|$))/.test(line) ? `\\${line}` : line.replace(/^(\d{1,9})([.)])(?=\s|$)/, "$1\\$2");
            return index === 0 ? line : `: ${line}`;
        })
        .join(context.eol);
}

function tableText(header: Run[][], align: (Align | null)[], rows: Run[][][], context: Context): string {
    const cell = (runs: Run[]) => writeRuns(runs, context, true).replace(/[ \t]*\n[ \t]*/g, " ").trim();
    const head = header.map(cell);
    const body = rows.map((row) => header.map((_, column) => cell(row[column] ?? [])));
    const widths = head.map((value, column) => Math.max(3, value.length, ...body.map((row) => row[column]!.length)));
    const line = (row: string[]) => `| ${row.map((value, column) => value.padEnd(widths[column]!)).join(" | ")} |`;
    const rule = widths.map((width, column) => {
        const side = align[column];
        if (side === "center") return `:${"-".repeat(width - 2)}:`;
        if (side === "left") return `:${"-".repeat(width - 1)}`;
        if (side === "right") return `${"-".repeat(width - 1)}:`;
        return "-".repeat(width);
    });
    return [line(head), `| ${rule.join(" | ")} |`, ...body.map(line)].join(context.eol);
}

// ---- inline ----

/** A link or picture address, in angle brackets if it would not read back bare. */
function destination(href: string): string {
    let depth = 0;
    let balanced = true;
    for (const char of href) {
        if (char === "(") depth++;
        else if (char === ")" && --depth < 0) balanced = false;
    }
    if (href === "" || /[\s<>]/.test(href) || !balanced || depth !== 0) return `<${href.replace(/[<>]/g, (char) => encodeURIComponent(char))}>`;
    return href;
}

const titleText = (title?: string) => (title === undefined ? "" : ` "${title.replace(/["\\]/g, "\\$&")}"`);
const imageText = (src: string, alt: string, title?: string) => `![${alt.replace(/[[\]\\]/g, "\\$&")}](${destination(src)}${titleText(title)})`;

/** A paragraph's text, with each line kept from reading as the start of another block. */
function paragraphText(runs: Run[], context: Context): string {
    const lines = writeRuns(runs, context, false).split("\n");
    return lines
        .map((raw, index) => {
            let line = raw.replace(/^[ \t]+/, "");
            if (!line.endsWith("\\")) line = line.replace(/[ \t]+$/, "");
            if (/^(#{1,6}(\s|$)|>|[-+*_](\s|$)|-#\s|(=+|-+)\s*$|:[ \t])/.test(line)) line = `\\${line}`;
            line = line.replace(/^(\d{1,9})([.)])(?=\s|$)/, "$1\\$2");
            if (index === 0 && context.mdx && /^(import|export)\b/.test(line)) line = `&#${line.charCodeAt(0)};${line.slice(1)}`;
            return line;
        })
        .join(context.eol);
}

type Key = "style" | "underline" | "strike" | "bold" | "italic" | "mark" | "sup" | "sub" | "spoiler";

const OPEN: Record<Exclude<Key, "style">, string> = { underline: "<u>", strike: "~~", bold: "**", italic: "*", mark: "==", sup: "<sup>", sub: "<sub>", spoiler: "||" };
const CLOSE: Record<Exclude<Key, "style">, string> = { underline: "</u>", strike: "~~", bold: "**", italic: "*", mark: "==", sup: "</sup>", sub: "</sub>", spoiler: "||" };

function keysOf(leaf: TextRun): string[] {
    const keys: string[] = [];
    if (leaf.color || leaf.size) keys.push(`style:${leaf.color ?? ""}|${leaf.size ?? ""}`);
    for (const key of ["underline", "sup", "sub", "spoiler", "strike", "mark", "bold", "italic"] as Key[]) if (leaf.marks.includes(key as TextRun["marks"][number])) keys.push(key);
    return keys;
}

function openKey(key: string): string {
    if (key.startsWith("style:")) {
        const [color, size] = key.slice(6).split("|");
        const parts = [color ? `color:${color}` : "", size ? `font-size:${size}` : ""].filter(Boolean);
        return `<span style="${parts.join("; ")}">`;
    }
    return OPEN[key as Exclude<Key, "style">];
}

const closeKey = (key: string) => (key.startsWith("style:") ? "</span>" : CLOSE[key as Exclude<Key, "style">]);

/** Moves spaces at the edges of marked text out of the marks they would break, as `** bold**` does not read back. */
function spreadSpaces(leaves: Leaf[]): Leaf[] {
    const out: Leaf[] = [];
    const shared = (leaf: TextRun, other: Leaf | undefined): TextRun => {
        const next: TextRun = { kind: "text", text: "", marks: other?.kind === "text" ? leaf.marks.filter((mark) => mark !== "code" && mark !== "math" && other.marks.includes(mark)) : [] };
        if (other?.kind === "text" && other.color === leaf.color && leaf.color) next.color = leaf.color;
        if (other?.kind === "text" && other.size === leaf.size && leaf.size) next.size = leaf.size;
        return next;
    };
    leaves.forEach((leaf, index) => {
        if (leaf.kind !== "text" || literal(leaf) || keysOf(leaf).length === 0) {
            out.push(leaf);
            return;
        }
        const [, lead, core, trail] = /^(\s*)([\s\S]*?)(\s*)$/.exec(leaf.text)!;
        if (lead) out.push({ ...shared(leaf, leaves[index - 1]), text: lead! });
        if (core) out.push({ ...leaf, text: core! });
        if (trail) out.push({ ...shared(leaf, leaves[index + 1]), text: trail! });
    });
    return out;
}

function writeLeaves(all: Leaf[], context: Context, cell: boolean): string {
    const leaves = spreadSpaces(all);
    const stack: string[] = [];
    let out = "";
    leaves.forEach((leaf, index) => {
        // pictures, breaks and HTML sit inside whatever marks are open around them, and a mark never
        // opens on a space, where it would not read back: the space goes before it, unmarked
        const blankText = leaf.kind === "text" && !literal(leaf) && /^\s+$/.test(leaf.text);
        const want = leaf.kind === "text" ? keysOf(leaf) : [...stack];
        while (stack.some((key) => !want.includes(key))) out += closeKey(stack.pop()!);
        for (const key of blankText ? [] : want) {
            if (!stack.includes(key)) {
                out += openKey(key);
                stack.push(key);
            }
        }
        if (leaf.kind === "text") out += leaf.marks.includes("code") ? codeSpan(leaf.text, cell) : leaf.marks.includes("math") ? `$${cell ? leaf.text.replace(/\|/g, "\\|") : leaf.text}$` : escapeText(leaf.text, context, cell, leaves[index - 1], leaves[index + 1]);
        else if (leaf.kind === "image") out += imageText(leaf.src, leaf.alt, leaf.title);
        else if (leaf.kind === "break") out += cell ? "<br>" : "\\\n";
        else if (leaf.kind === "footnote") out += `[^${leaf.label}]`;
        else if (leaf.kind === "emoji") out += `:${leaf.name}:`;
        else out += leaf.html;
    });
    while (stack.length) out += closeKey(stack.pop()!);
    return out;
}

/** Writes runs as Markdown text, with `\n` for line breaks. */
function writeRuns(runs: Run[], context: Context, cell: boolean): string {
    // a `$` is a dollar sign, as standard Markdown has it: maths in a line is not read, so nothing is escaped for it
    context.dollars = false;
    let out = "";
    let leaves: Leaf[] = [];
    const flush = () => {
        out += writeLeaves(leaves, context, cell);
        leaves = [];
    };
    for (const run of runs) {
        if (run.kind !== "link") {
            leaves.push(run);
            continue;
        }
        flush();
        const label = writeLeaves(run.runs, context, cell);
        out += run.ref !== undefined ? `[${label}][${run.ref}]` : `[${label}](${destination(run.href)}${titleText(run.title)})`;
    }
    flush();
    return out;
}

function codeSpan(value: string, cell: boolean): string {
    const longest = Math.max(0, ...(value.match(/`+/g) ?? []).map((run) => run.length));
    const fence = "`".repeat(longest + 1);
    const pad = value.startsWith("`") || value.endsWith("`") || (value.startsWith(" ") && value.endsWith(" ") && value.trim() !== "") ? " " : "";
    const body = cell ? value.replace(/\|/g, "\\|") : value;
    return fence + pad + body + pad + fence;
}

/** Escapes what would otherwise be read as Markdown in plain text. */
function escapeText(value: string, context: Context, cell: boolean, previous?: Leaf, following?: Leaf): string {
    const edge = (leaf?: Leaf) => (leaf?.kind === "text" ? (literal(leaf) ? "x" : leaf.text) : leaf ? "x" : " ");
    const before = edge(previous).slice(-1);
    const after = edge(following).slice(0, 1);
    let out = "";
    for (let index = 0; index < value.length; index++) {
        const char = value[index]!;
        const left = index === 0 ? before : value[index - 1]!;
        const right = index === value.length - 1 ? after : value[index + 1]!;
        const space = (other: string) => /\s/.test(other);
        const word = (other: string) => /[\p{L}\p{N}]/u.test(other);
        const risky =
            "\\`[~".includes(char) ||
            (char === "*" && !(space(left) && space(right))) ||
            (char === "_" && !(space(left) && space(right)) && !(word(left) && word(right))) ||
            (char === "<" && (context.mdx || /[A-Za-z/!?]/.test(right))) ||
            (char === "&" && /^&(#\d+|#x[0-9a-f]+|[a-z][a-z0-9]*);/i.test(value.slice(index))) ||
            (context.mdx && (char === "{" || char === "}")) ||
            (cell && char === "|") ||
            // two `|` or two `=` that could hide or mark text, a known shortcode (`context.dollars` is no longer set)
            (char === "$" && !!context.dollars) ||
            (char === "|" && left !== "|" && right === "|" && (index + 2 < value.length ? value[index + 2] : after) !== "|" && !(space(left) && space(index + 2 < value.length ? value[index + 2]! : after))) ||
            (char === "=" && left !== "=" && right === "=" && (index + 2 < value.length ? value[index + 2] : after) !== "=" && !(space(left) && space(index + 2 < value.length ? value[index + 2]! : after))) ||
            (char === ":" && emojiOf(/^:([a-z0-9_+-]+):/.exec(value.slice(index))?.[1] ?? "") !== undefined);
        out += risky ? `\\${char}` : char;
    }
    return out;
}
