// A document back to Markdown text. A block that still has its source is written as that source,
// byte for byte; only a block that was changed is written fresh, in one style: `#` headings, `-`
// bullets, `**` and `*`, fenced code, padded tables. Color and size become a `<span style>`,
// underline `<u>`, and alignment a `<div align>` around the block, the forms the reader reads back.

import { pictureHtml, sized } from "./pictures";
import type { Align, Block, Document, Leaf, LinkRun, List, ListItem, Run, TextRun } from "./document";
import { addresses, emojiOf, inAddress } from "./emoji";
import { definedLabels, followed, normalLabel, standsApart } from "./read";

interface Context {
    eol: string;
    mdx: boolean;
    /** Set when the document was read with reference links in it. */
    references?: boolean;
    /** The labels the document's definitions name, found when a reference link is first written. */
    defined?: () => Set<string>;
}

/** Text marked as code is written as it is, inside its backticks, and never escaped. */
const literal = (leaf: TextRun) => leaf.marks.includes("code");

/** True while the tests run, where a value missing from the model must be seen as the failure it is. */
const strict = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env?.NODE_ENV === "test";

/**
 * A value from the model as text. A value that is not text, from a block or run built wrongly, would
 * otherwise be written into the file as the word "undefined", "null", "NaN" or "[object Object]": in
 * the tests that throws, and in use nothing is written for it.
 */
function said(value: unknown, what: string): string {
    if (typeof value === "string") return value;
    if (typeof value === "number" && Number.isFinite(value)) return String(value);
    if (strict) throw new Error(`write: ${what} is ${String(value)}, where text belongs`);
    return "";
}

/** Writes a whole document. */
export function write(doc: Document): string {
    let defined: Set<string> | undefined;
    const context: Context = { eol: doc.eol, mdx: doc.mdx, references: !!doc.references, defined: () => (defined ??= definedLabels(doc.blocks)) };
    let body = writeBlocks(doc.blocks, context, false);
    // a `---` on the first line opens frontmatter when another such line comes later, so a line across
    // the page that has come to the top is written `***` when it would be read so
    if (doc.frontmatter === null && doc.lead === "" && /^---[ \t]*(?=\r?\n|$)/.test(body) && /\n(?:---|\.\.\.)[ \t]*(?:\r?\n|$)/.test(body)) body = body.replace(/^---[ \t]*/, "***");
    return doc.bom + (doc.frontmatter ?? "") + doc.lead + body;
}

/** How many line endings a gap holds, counted no further than two, which is all that matters. */
function lineEndings(gap: string): number {
    const first = gap.indexOf("\n");
    if (first < 0) return 0;
    return gap.indexOf("\n", first + 1) < 0 ? 1 : 2;
}

/** The sign a list's items start with, as far as telling two lists apart goes: a bullet's character, or a number's delimiter. */
const signOf = (list: List) => (list.style === "number" ? list.delimiter : list.marker);

/**
 * A list written straight after another of the same sign would be read back as part of it, blank
 * line or not, so the second takes another sign: `*` after `-`, `-` after `*` or `+`, `)` after `.`
 * and `.` after `)`. Its items keep their text and take the new sign.
 */
function otherSign(list: List): List {
    if (list.style === "number") return { ...list, delimiter: list.delimiter === "." ? ")" : ".", source: undefined };
    return { ...list, marker: list.marker === "-" ? "*" : "-", source: undefined };
}

/**
 * True if a block still kept as its source holds a reference link whose definition is no longer in
 * the document: written as its source, the link would read back as plain text. Only a file read with
 * reference links, and a source with a `[` in it, can hold one, which keeps this quick.
 */
function lostReference(block: Block, context: Context): boolean {
    if (block.source === undefined || !context.references || !block.source.includes("[")) return false;
    const lost = (runs: Run[]) => runs.some((run) => run.kind === "link" && run.ref !== undefined && (run.ref || run.label) !== undefined && !context.defined?.().has(normalLabel(run.ref || run.label!)));
    switch (block.kind) {
        case "paragraph":
        case "heading":
            return lost(block.runs);
        case "table":
            return [block.header, ...block.rows].some((row) => row.some(lost));
        case "list":
            return block.items.some((item) => item.blocks.some((inner) => lostReference(inner, context)));
        case "quote":
        case "footnote":
            return block.blocks.some((inner) => lostReference(inner, context));
        default:
            return false;
    }
}

/** A block with its source, and the sources of what holds a lost reference inside it, taken away, so that it is written afresh with the link's address. */
function refreshed(block: Block, context: Context): Block {
    if (!lostReference(block, context)) return block;
    if (block.kind === "list") return { ...block, source: undefined, items: block.items.map((item) => (item.blocks.some((inner) => lostReference(inner, context)) ? { ...item, source: undefined, blocks: item.blocks.map((inner) => refreshed(inner, context)) } : item)) };
    if (block.kind === "quote" || block.kind === "footnote") return { ...block, source: undefined, blocks: block.blocks.map((inner) => refreshed(inner, context)) };
    return { ...block, source: undefined };
}

/** True for a paragraph of nothing but spaces and line breaks, which has no Markdown form. */
const empty = (block: Block) => block.kind === "paragraph" && block.runs.every((run) => run.kind === "break" || (run.kind === "text" && run.text.trim() === "" && !run.marks.includes("code")));

/** Writes blocks one after another. `inside` is true in a list item, quote or footnote, where the last block ends with nothing. */
function writeBlocks(all: Block[], context: Context, inside: boolean): string {
    // an empty paragraph (or one of spaces) has no Markdown form, so a fresh one is left out, and so is
    // the empty line an empty item, quote or footnote is read with, once something else stands beside
    // it; and so is a block written afresh as nothing at all (a list left holding only empty lines)
    const blocks: Block[] = [];
    const texts: string[] = [];
    for (const block of all) {
        if ((block.source === undefined || (block.source === "" && all.length > 1)) && empty(block)) continue;
        let each = block;
        const before = blocks[blocks.length - 1];
        if (each.kind === "list" && before?.kind === "list" && each.style !== "definition" && before.style !== "definition" && (before.style === "number") === (each.style === "number") && signOf(before) === signOf(each)) each = otherSign(each);
        if (context.references && lostReference(each, context)) each = refreshed(each, context);
        const text = each.source ?? said(writeBlock(each, context), `a block of kind ${String(each?.kind)}`);
        if (text === "" && each.source === undefined && all.length > 1) continue;
        blocks.push(each);
        texts.push(text);
    }
    // the last block holds what ends the file (or nothing, inside a container), wherever it went
    const last = blocks.length - 1;
    if (last >= 0 && blocks[last] !== all[all.length - 1]) blocks[last] = { ...blocks[last]!, gap: all[all.length - 1]!.gap };
    let out = "";
    for (let index = 0; index <= last; index++) {
        const block = blocks[index]!;
        out += texts[index];
        const next = blocks[index + 1];
        let gap = block.gap;
        if (!next) gap = inside ? "" : gap;
        // two blocks read one after the other keep the gap the file had; any other two are given one
        // line ending if the second still reads as a block of its own after it, and a blank line if not
        else {
            const endings = lineEndings(gap);
            if (endings < 2 && !(endings === 1 && block.source !== undefined && next.source !== undefined && followed.get(block) === next)) {
                if (endings === 0) gap = context.eol;
                if (!standsApart(block, texts[index]!, texts[index + 1]!)) gap = context.eol + context.eol;
            }
        }
        out += gap;
    }
    return out;
}

/** Takes spaces and tabs off the start of a line, the end, or both, counted by hand: a pattern would take time growing with the square of a long run of spaces inside the line. */
function trimSpaces(line: string, start: boolean, end: boolean): string {
    let from = 0;
    let to = line.length;
    if (start) while (from < to && (line[from] === " " || line[from] === "\t")) from++;
    if (end) while (to > from && (line[to - 1] === " " || line[to - 1] === "\t")) to--;
    return line.slice(from, to);
}

/** Text on one line: each line break, with the spaces and tabs around it, becomes one space. */
function oneLine(text: string): string {
    if (!text.includes("\n")) return text;
    const lines = text.split("\n");
    return lines.map((line, index) => trimSpaces(line, index > 0, index < lines.length - 1)).join(" ");
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
            // a heading is one line: a break that reached one is written as the space it is drawn as
            const runs = block.runs.map((run): Run => (run.kind === "break" ? { kind: "text", text: " ", marks: [] } : run));
            let content = oneLine(writeRuns(runs, context, false)).trim();
            // a heading that ends in #s would lose them as a closing sequence
            if (/(^|[ \t])#+$/.test(content)) content = content.replace(/#(#*)$/, "\\#$1");
            return aligned("#".repeat(Math.min(6, Math.max(1, Number(block.level) || 1))) + (content ? ` ${content}` : ""), block.align);
        }
        case "image":
            return aligned(sized(block) ? pictureHtml(block) : imageText(block.src, block.alt, block.title), block.align);
        case "divider":
            return "---";
        case "code": {
            if (block.dollars && block.language === "math" && !/^[ \t]*\$\$[ \t]*$/m.test(block.code)) return `$$${eol}${block.code.split("\n").join(eol)}${eol}$$`;
            const code = said(block.code, "a code block's text");
            const language = said(block.language, "a code block's language");
            const longest = Math.max(0, ...(code.match(/`+/g) ?? []).map((run) => run.length));
            const fence = language.includes("`") ? "~~~" : "`".repeat(Math.max(3, longest + 1));
            const body = code === "" ? "" : code.split("\n").join(eol) + eol;
            return `${fence}${language}${eol}${body}${fence}`;
        }
        case "table":
            return tableText(block.header, block.align, block.rows, context);
        case "list":
            return listText(block, context);
        case "quote": {
            const inner = writeBlocks(block.blocks, context, true);
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
            return prefixLines(writeBlocks(block.blocks, context, true), `[^${said(block.label, "a footnote's label")}]: `, "    ", "");
        case "raw":
            return said(block.text, "a raw block's text").replace(/\r?\n/g, eol);
    }
}

/**
 * Whether a definition list can keep an item: a term with words, then at least one definition, each
 * one line of text. An item edited past that (its definitions joined into its term, a list pasted in)
 * is written as the blocks it holds, standing between the definition lists before and after it.
 */
const definable = (item: ListItem) =>
    item.source !== undefined ||
    (item.blocks.length >= 2 && item.blocks.every((block) => block.kind === "paragraph" && !block.subtext && !block.align && !block.runs.some((run) => run.kind === "break")) && (item.blocks[0] as { runs: Run[] }).runs.some((run) => run.kind !== "text" || run.text.trim() !== ""));

function listText(list: List, context: Context): string {
    if (list.style === "definition" && !list.items.every(definable)) {
        // the items it can keep stay lists of their own; the others are written as their blocks
        const parts: string[] = [];
        let kept: ListItem[] = [];
        const flush = () => {
            if (kept.length) parts.push(listText({ ...list, items: kept.map((item, index) => (index === kept.length - 1 ? { ...item, gap: "" } : item)) }, context));
            kept = [];
        };
        for (const item of list.items) {
            if (definable(item)) kept.push(item);
            else {
                flush();
                const blocks = writeBlocks(item.blocks, context, true);
                if (blocks !== "") parts.push(blocks);
            }
        }
        flush();
        return parts.join(context.eol + context.eol);
    }
    const eol = context.eol;
    const sep = list.loose ? eol + eol : eol;
    let out = "";
    list.items.forEach((item, index) => {
        const marker = list.style === "number" ? `${said(list.start + index, "a list's number")}${said(list.delimiter, "a list's delimiter")}` : said(list.marker, "a list's bullet");
        let text: string;
        if (list.style === "definition") text = item.source ?? definitionText(item.blocks, context);
        else if (item.source !== undefined) {
            // only the first number of a numbered list counts, so it alone is kept right; a list written
            // afresh gives every item its sign, which differs only when it took another (otherSign)
            text = index === 0 && list.style === "number" ? item.source.replace(/^( {0,3})\d{1,9}(?=[.)])/, `$1${list.start}`) : item.source;
            if (list.source === undefined) text = list.style === "number" ? text.replace(/^( {0,3}\d{1,9})[.)]/, `$1${list.delimiter}`) : text.replace(/^( {0,3})[-*+]/, `$1${list.marker}`);
        } else {
            // a box belongs to an item, not to its list: a plain bullet among checklist items keeps its bullet
            const box = item.checked !== undefined ? `[${item.checked ? "x" : " "}]` : "";
            const inner = writeBlocks(item.blocks, context, true);
            const head = `${marker} ${box ? `${box} ` : ""}`;
            const indent = " ".repeat(marker.length + 1);
            text = inner === "" ? head.trimEnd() : prefixLines(inner, head, indent, "");
            // an item whose first line would read as a line across the page (`- ---`, or items nested on
            // one line, `- - -`) starts its text on the line after its bullet
            if (inner !== "" && /^(?:(?:\*[ \t]*){3,}|(?:-[ \t]*){3,}|(?:_[ \t]*){3,})$/.test(text.slice(0, text.search(/\r?\n|$/)))) text = head.trimEnd() + eol + prefixLines(inner, indent, indent, "");
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
            if (block.source !== undefined) return index === 0 ? block.source : `: ${block.source}`;
            // each is one line; a term must not read as a definition, or as the start of some other block
            const line = paragraphText(block.kind === "paragraph" ? block.runs : [], context).replace(/[ \t]*\r?\n[ \t]*/g, " ");
            return index === 0 ? line : `: ${line}`;
        })
        .join(context.eol);
}

function tableText(header: Run[][], align: (Align | null)[], rows: Run[][][], context: Context): string {
    // in a row a pipe is the edge of a cell before it is anything else, so every pipe written inside a
    // cell, in text, code, an address or HTML, is escaped; the reader takes the escapes off before it
    // reads the cell's text, as GitHub does
    const cell = (runs: Run[]) => oneLine(writeRuns(runs, context, true)).trim().replace(/\|/g, "\\|");
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
    // a backslash before punctuation would be read as an escape, so it is escaped itself; in angle
    // brackets `<` and `>` are escaped, so the address reads back as it is
    const escaped = href.replace(/\\(?=[!-/:-@[-`{-~]|$)/g, "\\\\");
    if (href === "" || /[\s<>]/.test(href) || !balanced || depth !== 0) return `<${escaped.replace(/[<>]/g, "\\$&")}>`;
    return escaped;
}

const titleText = (title?: string) => (title === undefined ? "" : ` "${title.replace(/["\\]/g, "\\$&")}"`);
const imageText = (src: string, alt: string, title?: string) => `![${alt.replace(/[[\]\\]/g, "\\$&")}](${destination(src)}${titleText(title)})`;

/** A paragraph's text, with each line kept from reading as the start of another block. */
function paragraphText(all: Run[], context: Context): string {
    // a line break at the very end of a paragraph has no Markdown form (its backslash would be read as
    // text), so it is left out, as are the spaces after it
    let end = all.length;
    while (end > 0 && (all[end - 1]!.kind === "break" || (all[end - 1]!.kind === "text" && (all[end - 1] as TextRun).text.trim() === "" && !(all[end - 1] as TextRun).marks.includes("code")))) end--;
    if (!all.slice(end).some((run) => run.kind === "break")) end = all.length;
    const runs = end < all.length ? all.slice(0, end) : all;
    // a blank line would end the paragraph, so a soft line break beside a hard one adds nothing
    const lines = writeRuns(runs, context, false)
        .split("\n")
        .filter((line) => /[^ \t]/.test(line));
    return lines
        .map((raw, index) => {
            let line = raw.replace(/^[ \t]+/, "");
            if (!line.endsWith("\\")) line = trimSpaces(line, false, true);
            if (/^(#{1,6}(\s|$)|>|[-+*_](\s|$)|-#\s|(=+|-+)\s*$|:[ \t])/.test(line)) line = `\\${line}`;
            line = line.replace(/^(\d{1,9})([.)])(?=\s|$)/, "$1\\$2");
            if (index === 0 && context.mdx && /^(import|export)\b/.test(line)) line = `&#${line.charCodeAt(0)};${line.slice(1)}`;
            return line;
        })
        .join(context.eol);
}

type Key = "style" | "underline" | "strike" | "bold" | "italic" | "mark" | "sup" | "sub" | "spoiler";

/**
 * Each mark's plain form, and for the marks whose plain form is a run of signs, the HTML the reader
 * takes for the same mark. The HTML is written only where the signs would not be read as the mark
 * (see `writeLeaves`).
 */
const FORMS: Record<Exclude<Key, "style">, { open: string; close: string; html?: [string, string] }> = {
    underline: { open: "<u>", close: "</u>" },
    sup: { open: "<sup>", close: "</sup>" },
    sub: { open: "<sub>", close: "</sub>" },
    spoiler: { open: "||", close: "||" },
    strike: { open: "~~", close: "~~", html: ["<del>", "</del>"] },
    mark: { open: "==", close: "==", html: ["<mark>", "</mark>"] },
    bold: { open: "**", close: "**", html: ["<strong>", "</strong>"] },
    italic: { open: "*", close: "*", html: ["<em>", "</em>"] },
};

/** The marks and looks a run is written with. In a table cell a spoiler is not one of them: its pipes would be read as the cell's edges, and escaped they make no spoiler, so its text is written plain. */
function keysOf(leaf: TextRun, cell: boolean): string[] {
    const keys: string[] = [];
    if (leaf.color || leaf.size) keys.push(`style:${leaf.color ?? ""}|${leaf.size ?? ""}`);
    for (const key of ["underline", "sup", "sub", "spoiler", "strike", "mark", "bold", "italic"] as Key[]) if (leaf.marks.includes(key as TextRun["marks"][number]) && !(cell && key === "spoiler")) keys.push(key);
    return keys;
}

/** Where a mark opens or closes, and whether it is written as HTML. Both ends of one mark share a `pair`. */
interface Sign {
    key: string;
    open: boolean;
    pair: number;
    html: boolean;
}

type Token = Sign | { text: string };

const isSign = (token: Token): token is Sign => "key" in token;

function signText(sign: Sign): string {
    if (sign.key.startsWith("style:")) {
        if (!sign.open) return "</span>";
        const [color, size] = sign.key.slice(6).split("|");
        const parts = [color ? `color:${color}` : "", size ? `font-size:${size}` : ""].filter(Boolean);
        return `<span style="${parts.join("; ")}">`;
    }
    const form = FORMS[sign.key as Exclude<Key, "style">];
    if (sign.html && form.html) return sign.open ? form.html[0] : form.html[1];
    return sign.open ? form.open : form.close;
}

/** The character a run of signs is made of, for the marks whose signs must flank text to be read: `*`, `~`, `=` or `|`. */
const signChar = (sign: Sign) => (!sign.html && FORMS[sign.key as Exclude<Key, "style">]?.html !== undefined) || sign.key === "spoiler" ? FORMS[sign.key as Exclude<Key, "style">].open[0]! : "";

// CommonMark's classes of character, as the reader uses them: the edge of the text counts as a space
const isSpace = (char: string) => char === "" || /\s/u.test(char);
const isPunctuation = (char: string) => /[\p{P}\p{S}]/u.test(char);
const firstOf = (text: string) => (text === "" ? "" : String.fromCodePoint(text.codePointAt(0)!));
const lastOf = (text: string) => (text === "" ? "" : Array.from(text.slice(-2)).pop()!);

/** Moves spaces at the edges of marked text out of the marks they would break, as `** bold**` does not read back. */
function spreadSpaces(leaves: Leaf[], cell: boolean): Leaf[] {
    const out: Leaf[] = [];
    const shared = (leaf: TextRun, other: Leaf | undefined): TextRun => {
        const next: TextRun = { kind: "text", text: "", marks: other?.kind === "text" ? leaf.marks.filter((mark) => mark !== "code" && other.marks.includes(mark)) : [] };
        if (other?.kind === "text" && other.color === leaf.color && leaf.color) next.color = leaf.color;
        if (other?.kind === "text" && other.size === leaf.size && leaf.size) next.size = leaf.size;
        return next;
    };
    leaves.forEach((leaf, index) => {
        if (leaf.kind !== "text" || literal(leaf) || keysOf(leaf, cell).length === 0) {
            out.push(leaf);
            return;
        }
        // counted by hand, not with a pattern, which would take time growing with the square of a long run of spaces
        let start = 0;
        while (start < leaf.text.length && /\s/.test(leaf.text[start]!)) start++;
        let end = leaf.text.length;
        while (end > start && /\s/.test(leaf.text[end - 1]!)) end--;
        if (start > 0) out.push({ ...shared(leaf, leaves[index - 1]), text: leaf.text.slice(0, start) });
        if (end > start) out.push({ ...leaf, text: leaf.text.slice(start, end) });
        if (end < leaf.text.length) out.push({ ...shared(leaf, leaves[index + 1]), text: leaf.text.slice(end) });
    });
    return out;
}

/** Joins neighbouring code that is written alike, as two code spans side by side would be read as one span with backticks inside. */
function joinCode(leaves: Leaf[], cell: boolean): Leaf[] {
    const out: Leaf[] = [];
    for (const leaf of leaves) {
        const last = out[out.length - 1];
        if (leaf.kind === "text" && last?.kind === "text" && leaf.marks.includes("code") && last.marks.includes("code") && keysOf(leaf, cell).join() === keysOf(last, cell).join()) out[out.length - 1] = { ...last, text: last.text + leaf.text };
        else out.push(leaf);
    }
    return out;
}

/**
 * Writes the leaves of one stretch of text: outside links, or the words of one link. `before` and
 * `after` are the characters written just outside it, which decide whether a mark's signs at its
 * edges are read.
 *
 * Marks are written in their plain form, `**bold**`, wherever CommonMark (and GitHub, for `~~`) will
 * read the signs as the mark: an opening run must stand before text and a closing run after it, by
 * the flanking rules the reader keeps too (read.ts). Where a run would not be read so, as in
 * `word**(see)**more`, that mark is written as the HTML the reader takes for it (`<strong>`, `<em>`,
 * `<del>`, `<mark>`), and the text inside is never changed.
 */
function writeLeaves(all: Leaf[], context: Context, cell: boolean, before = " ", after = " ", label = false): string {
    const leaves = spreadSpaces(joinCode(all, cell), cell);
    const tokens: Token[] = [];
    const items: (Leaf | undefined)[] = [];
    const stack: Sign[] = [];
    let pairs = 0;
    // a mark closes before the spaces and line breaks it ends on, as `**bold **` does not read back
    const spaces = (index: number) => {
        const leaf = items[index];
        return leaf?.kind === "break" || (leaf?.kind === "text" && !literal(leaf) && /^\s+$/.test(leaf.text));
    };
    const close = () => {
        const sign = stack.pop()!;
        let at = tokens.length;
        while (at > 0 && spaces(at - 1)) at--;
        tokens.splice(at, 0, { key: sign.key, open: false, pair: sign.pair, html: false });
        items.splice(at, 0, undefined);
    };
    for (const leaf of leaves) {
        // pictures, breaks and HTML sit inside whatever marks are open around them, and a mark never
        // opens on a space, where it would not read back: the space goes before it, unmarked
        const blankText = leaf.kind === "text" && !literal(leaf) && /^\s+$/.test(leaf.text);
        const want = leaf.kind === "text" ? keysOf(leaf, cell) : stack.map((sign) => sign.key);
        while (stack.some((sign) => !want.includes(sign.key))) close();
        for (const key of blankText ? [] : want) {
            if (stack.some((sign) => sign.key === key)) continue;
            const sign: Sign = { key, open: true, pair: pairs++, html: false };
            stack.push(sign);
            tokens.push(sign);
            items.push(undefined);
        }
        tokens.push({ text: "" });
        items.push(leaf);
    }
    while (stack.length) close();

    // what each piece of text is written as: the characters beside it decide what must be escaped,
    // and a sign beside it counts as its plain character
    const beside = (index: number, step: -1 | 1): string => {
        const token = tokens[index];
        if (!token) return step < 0 ? before : after;
        if (isSign(token)) return step < 0 ? lastOf(signText(token)) : firstOf(signText(token));
        const leaf = items[index]!;
        if (leaf.kind !== "text") return "x";
        if (literal(leaf)) return "`";
        return step < 0 ? lastOf(leaf.text) : firstOf(leaf.text);
    };
    // whether the token at `index` would be written on the end of a web address; asked only of text that holds one
    const addressed = leaves.some((leaf) => leaf.kind === "text" && (leaf.text.includes("://") || leaf.text.includes("www.")));
    const inAddressAt = (index: number): boolean => {
        if (!addressed) return false;
        const prefix = before + tokens.slice(0, index).map((each) => (isSign(each) ? signText(each) : each.text)).join("");
        return inAddress(`${prefix}:`, prefix.length);
    };
    const signNear = (index: number) => {
        const token = tokens[index];
        return token && isSign(token) ? signChar(token) : "";
    };
    tokens.forEach((token, index) => {
        if (isSign(token)) return;
        const leaf = items[index]!;
        if (leaf.kind === "text" && typeof leaf.text !== "string") said(leaf.text, "a run's text");
        else if (leaf.kind === "text") token.text = leaf.marks.includes("code") ? codeSpan(leaf.text) : escapeText(leaf.text, context, cell, beside(index - 1, -1), beside(index + 1, 1), [signNear(index - 1), signNear(index + 1)], label);
        else if (leaf.kind === "image") token.text = imageText(leaf.src, leaf.alt, leaf.title);
        else if (leaf.kind === "break") token.text = cell ? "<br>" : "\\\n";
        else if (leaf.kind === "footnote") token.text = `[^${said(leaf.label, "a footnote's label")}]`;
        else if (leaf.kind === "emoji") {
            // a shortcode against a letter or digit, or on the end of a web address, would not be read as
            // one (emoji.ts), so there the emoji itself is written
            const glued = /[\p{L}\p{N}]/u.test(beside(index - 1, -1)) || /[\p{L}\p{N}]/u.test(beside(index + 1, 1)) || inAddressAt(index);
            token.text = glued && emojiOf(leaf.name) ? emojiOf(leaf.name)! : `:${said(leaf.name, "an emoji's name")}:`;
        }
        else if (leaf.kind === "html") token.text = said(leaf.html, "inline HTML");
        else said(undefined, `a run of kind ${String((leaf as { kind?: unknown } | undefined)?.kind)}`);
    });

    // the characters written just outside the token at `index`, looking one way
    const outside = (index: number, step: -1 | 1): string => {
        for (let at = index; at >= 0 && at < tokens.length; at += step) {
            const token = tokens[at]!;
            const text = isSign(token) ? signText(token) : token.text;
            if (text !== "") return step < 0 ? lastOf(text) : firstOf(text);
        }
        return step < 0 ? before : after;
    };
    // each run of signs of one character is read as one run: it must flank text the way it is meant to
    for (let round = 0; round <= pairs; round++) {
        const failing = new Set<number>();
        for (let index = 0; index < tokens.length; ) {
            const first = tokens[index]!;
            const char = isSign(first) ? signChar(first) : "";
            if (!char) {
                index++;
                continue;
            }
            let end = index;
            while (end < tokens.length && isSign(tokens[end]!) && signChar(tokens[end] as Sign) === char) end++;
            const run = tokens.slice(index, end) as Sign[];
            const left = outside(index - 1, -1);
            const right = outside(end, 1);
            // `==` and `||` are read wherever they touch text on the inside (read.ts); `*` and `~` by CommonMark's rules
            const loose = char === "=" || char === "|";
            const opens = loose ? !isSpace(right) : !isSpace(right) && (!isPunctuation(right) || isSpace(left) || isPunctuation(left));
            const closes = loose ? !isSpace(left) : !isSpace(left) && (!isPunctuation(left) || isSpace(right) || isPunctuation(right));
            const opening = run.filter((sign) => sign.open);
            const closing = run.filter((sign) => !sign.open);
            // a run that both closes one mark and opens another could be read either way
            if (opening.length && closing.length) for (const sign of opening) failing.add(sign.pair);
            if (opening.length && !opens) for (const sign of opening) failing.add(sign.pair);
            // `==` and `||` written on the end of a web address are part of it, and open nothing (read.ts)
            if (opening.length && loose && !isSpace(left) && inAddressAt(index)) for (const sign of opening) failing.add(sign.pair);
            if (closing.length && !closes) for (const sign of closing) failing.add(sign.pair);
            index = end;
        }
        let changed = false;
        for (const token of tokens) {
            if (isSign(token) && failing.has(token.pair) && !token.html && FORMS[token.key as Exclude<Key, "style">]?.html) {
                token.html = true;
                changed = true;
            }
        }
        if (!changed) break;
    }
    return tokens.map((token) => (isSign(token) ? signText(token) : token.text)).join("");
}

/** Writes runs as Markdown text, with `\n` for line breaks. */
function writeRuns(runs: Run[], context: Context, cell: boolean): string {
    // a `$` is a dollar sign, as standard Markdown has it: maths in a line is not read, so nothing is escaped for it
    let out = "";
    let leaves: Leaf[] = [];
    const flush = (after: string) => {
        out += writeLeaves(leaves, context, cell, lastOf(out) || " ", after);
        leaves = [];
    };
    for (const [index, run] of runs.entries()) {
        if (run.kind !== "link") {
            leaves.push(run);
            continue;
        }
        flush("[");
        const label = writeLeaves(run.runs, context, cell, "[", "]", true);
        out += `[${label}]${linkTail(run, label, runs[index + 1], context)}`;
    }
    flush(" ");
    return out;
}

/**
 * What follows a link's words: its reference, or its address. A link written `[text][]` or `[text]`
 * is found by its words, so it keeps that form only while its words are still the label it was read
 * with; once they are changed it is written `[new words][label]`, which still names its definition.
 * A shortcut followed by `(` or `[` would be read as another kind of link, so it takes the empty brackets.
 * A reference whose definition has gone from the document is written with its address.
 */
function linkTail(run: LinkRun, label: string, following: Run | undefined, context: Context): string {
    // a reference whose definition is no longer in the document would leave plain text behind: it is written with its address
    const name = run.ref || run.label;
    const kept = name !== undefined && context.defined?.().has(normalLabel(name));
    if (kept && run.ref) return `[${said(run.ref, "a link's reference")}]`;
    if (kept && run.ref === "" && run.label !== undefined) {
        if (label !== run.label) return `[${run.label}]`;
        const next = following?.kind === "text" ? following.text[0] : following?.kind === "link" ? "[" : undefined;
        return run.shortcut && next !== "(" && next !== "[" ? "" : "[]";
    }
    return `(${destination(said(run.href, "a link's address"))}${titleText(run.title)})`;
}

function codeSpan(value: string): string {
    const longest = Math.max(0, ...(value.match(/`+/g) ?? []).map((run) => run.length));
    const fence = "`".repeat(longest + 1);
    const pad = value.startsWith("`") || value.endsWith("`") || (value.startsWith(" ") && value.endsWith(" ") && value.trim() !== "") ? " " : "";
    return fence + pad + value + pad + fence;
}

/** True if a known shortcode starts at `index` in text and would be read as one: not against a letter or digit on either side, nor in a web address (emoji.ts). */
function shortcode(value: string, index: number, left: string, after: string, address: () => Uint8Array | undefined): boolean {
    const name = /^:([a-z0-9_+-]+):/.exec(value.slice(index, index + 64))?.[1];
    if (name === undefined || emojiOf(name) === undefined) return false;
    const word = /[\p{L}\p{N}]/u;
    return !word.test(left) && !word.test(value[index + name.length + 2] ?? after) && !address()?.[index];
}

/**
 * Escapes what would otherwise be read as Markdown in plain text. `before` and `after` are the
 * characters written beside it, `signs` the characters of a mark's signs touching it on either side,
 * and `label` says it is a link's words, which a `]` would end and a `^` at the start would make a footnote.
 */
function escapeText(value: string, context: Context, cell: boolean, before: string, after: string, signs: [string, string] = ["", ""], label = false): string {
    let out = "";
    // which characters sit in a web address, worked out once, when a shortcode first asks
    let addressed: Uint8Array | null | undefined;
    for (let index = 0; index < value.length; index++) {
        const char = value[index]!;
        const left = index === 0 ? before : value[index - 1]!;
        const right = index === value.length - 1 ? after : value[index + 1]!;
        const third = index + 2 < value.length ? value[index + 2]! : index + 2 === value.length ? after : "";
        const space = (other: string) => /\s/.test(other);
        const word = (other: string) => /[\p{L}\p{N}]/u.test(other);
        const touching = (sign: string) => (index === 0 && signs[0] === sign) || (index === value.length - 1 && signs[1] === sign);
        const risky =
            "\\`[~".includes(char) ||
            (label && (char === "]" || (char === "^" && index === 0 && before === "["))) ||
            (char === "!" && right === "[") ||
            (char === "*" && !(space(left) && space(right))) ||
            (char === "_" && !(space(left) && space(right)) && !(word(left) && word(right))) ||
            (char === "<" && (context.mdx || /[A-Za-z/!?]/.test(right))) ||
            (char === "&" && /^&(#\d+|#x[0-9a-f]+|[a-z][a-z0-9]*);/i.test(value.slice(index))) ||
            (context.mdx && (char === "{" || char === "}")) ||
            // two `|` or two `=` that could hide or mark text, or one beside the signs of a spoiler or a
            // mark; and a known shortcode that would be read as one
            (char === "|" && !cell && (touching("|") || (left !== "|" && right === "|" && third !== "|" && !(space(left) && space(third))))) ||
            (char === "=" && (touching("=") || (left !== "=" && right === "=" && third !== "=" && !(space(left) && space(third))))) ||
            (char === ":" && shortcode(value, index, left, after, () => {
                if (addressed === undefined) addressed = addresses(value) ?? null;
                return addressed ?? undefined;
            }));
        // a no-break space would be invisible in the file, so it is written as the entity it is read from
        if (char === "\u00a0") out += "&nbsp;";
        else out += risky ? `\\${char}` : char;
    }
    return out;
}
