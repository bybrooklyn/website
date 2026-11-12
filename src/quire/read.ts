// Markdown or MDX text to a document. The file is cut into blocks along its own lines, and every
// block keeps the exact text it was cut from and the blank text after it, so writing an untouched
// document back gives the same bytes: line endings, final newlines, tabs, trailing spaces, list
// markers and all. What a block means is read the way CommonMark and GFM read it, closely enough to
// edit; what is not understood becomes a raw block, kept as its text.

import { tidyRuns, type Align, type Block, type Document, type Leaf, type Level, type ListItem, type ListStyle, type Mark, type Run, type TextRun } from "./document";

/** How to read a file. MDX turns on imports, exports, components and `{expressions}`, and turns off indented code. */
export interface ReadOptions {
    mdx?: boolean;
}

interface Line {
    text: string;
    eol: string;
}

interface Context {
    mdx: boolean;
    /** Link reference definitions, by their label in lower case. */
    refs: Map<string, { href: string; title?: string }>;
}

/** Reads a whole file into a document. */
export function read(source: string, options: ReadOptions = {}): Document {
    const bom = source.startsWith("﻿") ? "﻿" : "";
    const rest = source.slice(bom.length);
    const lines = splitLines(rest);
    const eol = rest.includes("\r\n") ? "\r\n" : "\n";
    let frontmatter: string | null = null;
    let at = 0;
    // frontmatter opens on the first line and closes on the first line that is only `---`, never on one that merely starts with it
    if (lines.length > 1 && /^---[ \t]*$/.test(lines[0]!.text)) {
        const close = lines.findIndex((line, index) => index > 0 && /^(---|\.\.\.)[ \t]*$/.test(line.text));
        if (close > 0) {
            frontmatter = joinFull(lines.slice(0, close + 1));
            at = close + 1;
        }
    }
    const body = lines.slice(at);
    const context: Context = { mdx: !!options.mdx, refs: definitions(body) };
    const { lead, blocks } = parseBlocks(body, context);
    return { bom, frontmatter, lead, blocks, eol, mdx: context.mdx };
}

// ---- lines ----

function splitLines(source: string): Line[] {
    const out: Line[] = [];
    let start = 0;
    while (start < source.length) {
        const newline = source.indexOf("\n", start);
        if (newline < 0) {
            out.push({ text: source.slice(start), eol: "" });
            break;
        }
        const cr = newline > start && source[newline - 1] === "\r";
        out.push({ text: source.slice(start, cr ? newline - 1 : newline), eol: cr ? "\r\n" : "\n" });
        start = newline + 1;
    }
    return out;
}

const joinFull = (lines: Line[]) => lines.map((line) => line.text + line.eol).join("");
const blank = (text: string | undefined) => text === undefined || /^[ \t]*$/.test(text);

/** The source of lines, without the last line's ending. */
function joinSource(lines: Line[]): string {
    return lines.map((line, index) => line.text + (index === lines.length - 1 ? "" : line.eol)).join("");
}

/** How many columns of indentation a line has, a tab reaching the next multiple of four. */
function indentOf(text: string): number {
    let column = 0;
    for (const char of text) {
        if (char === " ") column++;
        else if (char === "\t") column += 4 - (column % 4);
        else break;
    }
    return column;
}

/** Takes up to `columns` columns of indentation off a line. */
function stripIndent(text: string, columns: number): string {
    let column = 0;
    let index = 0;
    while (index < text.length && column < columns) {
        const char = text[index]!;
        if (char === " ") column++;
        else if (char === "\t") {
            const width = 4 - (column % 4);
            if (column + width > columns) return " ".repeat(column + width - columns) + text.slice(index + 1);
            column += width;
        } else break;
        index++;
    }
    return text.slice(index);
}

// ---- what starts a block ----

const FENCE = /^(`{3,})([^`]*)$|^(~{3,})(.*)$/;
const ATX = /^(#{1,6})(?=[ \t]|$)(.*)$/;
const THEMATIC = /^(?:(?:\*[ \t]*){3,}|(?:-[ \t]*){3,}|(?:_[ \t]*){3,})$/;
const SETEXT = /^(=+|-+)[ \t]*$/;
const FOOTNOTE = /^\[\^([^\]\s]+)\]:[ \t]?/;
const DEFINITION = /^ {0,3}\[((?:[^\]\\]|\\.)+)\]:[ \t]*(<[^>\n]*>|\S+)(?:[ \t]+("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|\((?:[^)\\]|\\.)*\)))?[ \t]*$/;
const DELIMITER_ROW = /^\|?[ \t]*:?-+:?[ \t]*(\|[ \t]*:?-+:?[ \t]*)*\|?[ \t]*$/;
const BLOCK_TAGS = new Set(
    "address article aside base basefont blockquote body caption center col colgroup dd details dialog dir div dl dt fieldset figcaption figure footer form frame frameset h1 h2 h3 h4 h5 h6 head header hr html iframe legend li link main menu menuitem nav noframes ol optgroup option p param search section summary table tbody td tfoot th thead title tr track ul pre script style textarea".split(" "),
);

interface ItemStart {
    marker: string;
    before: number;
    content: number;
    first: string;
}

/** A list item's marker at the start of a line, and where its content begins. */
function itemStart(text: string): ItemStart | undefined {
    const match = /^( {0,3})([-*+]|\d{1,9}[.)])([ \t]*)(.*)$/.exec(text);
    if (!match) return undefined;
    const [, lead, marker, spaces, rest] = match as unknown as [string, string, string, string, string];
    if (spaces === "" && rest !== "") return undefined;
    const before = lead.length;
    const after = before + marker.length;
    let width = indentOf(" ".repeat(after) + spaces) - after;
    let first = rest;
    if (rest === "") width = 1;
    else if (width >= 5) {
        first = " ".repeat(width - 1) + rest;
        width = 1;
    }
    return { marker, before, content: after + width, first };
}

const ordered = (marker: string) => /^\d/.test(marker);
const sameList = (a: string, b: string) => (ordered(a) ? ordered(b) && a.slice(-1) === b.slice(-1) : a === b);

/** True if a line starts an HTML block that may cut a paragraph short (CommonMark kinds 1 to 6). */
function htmlInterrupts(text: string): boolean {
    if (text.startsWith("<!--")) return true;
    const name = /^<\/?([A-Za-z][\w-]*)(?=[\s/>]|$)/.exec(text)?.[1];
    return !!name && BLOCK_TAGS.has(name.toLowerCase());
}

/** True if a line starts an HTML or JSX block at the start of a block. */
function htmlStarts(text: string, context: Context): boolean {
    if (htmlInterrupts(text)) return true;
    if (context.mdx && /^<\/?>/.test(text)) return true;
    const name = /^<\/?([A-Za-z][\w.:-]*)/.exec(text)?.[1];
    if (!name) return false;
    if (context.mdx && (/^[A-Z]/.test(name) || name.includes("."))) return true;
    // a whole tag alone on its line, or a tag whose attributes run on to the next line
    const end = tagEnd(text, 0);
    return end < 0 || blank(text.slice(end));
}

/** True if a line, already known to be indented less than four columns, cuts a paragraph short. */
function interrupts(line: string): boolean {
    const text = line.trimStart();
    if (FENCE.test(text) || ATX.test(text) || THEMATIC.test(text) || text.startsWith(">") || htmlInterrupts(text)) return true;
    const item = itemStart(text);
    if (item && !blank(item.first) && (!ordered(item.marker) || parseInt(item.marker, 10) === 1)) return true;
    return false;
}

// ---- blocks ----

function parseBlocks(lines: Line[], context: Context): { lead: string; blocks: Block[] } {
    let at = 0;
    while (at < lines.length && blank(lines[at]!.text)) at++;
    const lead = joinFull(lines.slice(0, at));
    const blocks: Block[] = [];
    while (at < lines.length) {
        const [block, end] = readBlock(lines, at, context);
        let next = end;
        while (next < lines.length && blank(lines[next]!.text)) next++;
        block.source = joinSource(lines.slice(at, end));
        block.gap = lines[end - 1]!.eol + joinFull(lines.slice(end, next));
        blocks.push(block);
        at = next;
    }
    return { lead, blocks };
}

/** Parses lines that sit inside a container, the last line's ending left to the container. */
function parseInside(lines: Line[], context: Context): Block[] {
    if (lines.length === 0) return [];
    const copy = lines.map((line, index) => (index === lines.length - 1 ? { text: line.text, eol: "" } : line));
    return parseBlocks(copy, context).blocks;
}

function untilBlank(lines: Line[], from: number): number {
    let end = from;
    while (end < lines.length && !blank(lines[end]!.text)) end++;
    return Math.max(end, from + 1);
}

function readBlock(lines: Line[], at: number, context: Context): [Block, number] {
    const line = lines[at]!.text;
    const indent = indentOf(line);
    const raw = (end: number): [Block, number] => [{ kind: "raw", text: joinSource(lines.slice(at, end)), gap: "" }, end];

    if (indent >= 4 && !context.mdx) return readIndentedCode(lines, at);
    const text = indent >= 4 ? line.trimStart() : stripIndent(line, indent);

    // MDX has no indented code, and reads a deeply indented component or expression as one
    if (indent >= 4) {
        if (text.startsWith("<") && htmlStarts(text, context)) return raw(elementEnd(lines, at));
        if (text.startsWith("{")) return raw(untilBlank(lines, braceEnd(lines, at)));
    } else {
        const fence = FENCE.exec(text);
        if (fence) return readFence(lines, at, indent, fence);
        const atx = ATX.exec(text);
        if (atx) {
            const content = atx[2]!.replace(/[ \t]+#+[ \t]*$/, "").replace(/^[ \t]*#+[ \t]*$/, "").trim();
            return [{ kind: "heading", level: atx[1]!.length as Level, runs: runsFrom(content, context), gap: "" }, at + 1];
        }
        if (THEMATIC.test(text)) return [{ kind: "divider", gap: "" }, at + 1];
        const aligned = readAligned(lines, at, context);
        if (aligned) return aligned;
        if (text.startsWith("<!--")) {
            let end = at;
            while (end < lines.length && !lines[end]!.text.includes("-->")) end++;
            return raw(Math.min(end + 1, lines.length));
        }
        if (text.startsWith("<") && htmlStarts(text, context)) return raw(elementEnd(lines, at));
        if (context.mdx && /^(import|export)(?=[\s{*])/.test(line)) return raw(untilBlank(lines, at));
        if (context.mdx && text.startsWith("{")) return raw(untilBlank(lines, braceEnd(lines, at)));
        if (text.startsWith(">")) return readQuote(lines, at, context);
        const item = itemStart(line);
        if (item) return readList(lines, at, context);
        const footnote = FOOTNOTE.exec(text);
        if (footnote) return readFootnote(lines, at, footnote, context);
        if (DEFINITION.test(line)) {
            let end = at + 1;
            while (end < lines.length && DEFINITION.test(lines[end]!.text)) end++;
            return raw(end);
        }
        const table = readTable(lines, at, context);
        if (table) return table;
    }
    return readParagraph(lines, at, context);
}

function readIndentedCode(lines: Line[], at: number): [Block, number] {
    let end = at;
    let last = at;
    while (end < lines.length && (blank(lines[end]!.text) || indentOf(lines[end]!.text) >= 4)) {
        if (!blank(lines[end]!.text)) last = end;
        end++;
    }
    const code = lines
        .slice(at, last + 1)
        .map((line) => stripIndent(line.text, 4))
        .join("\n");
    return [{ kind: "code", language: "", code, gap: "" }, last + 1];
}

function readFence(lines: Line[], at: number, indent: number, fence: RegExpExecArray): [Block, number] {
    const marks = fence[1] ?? fence[3]!;
    const info = (fence[2] ?? fence[4]!).trim();
    const closing = new RegExp(`^ {0,3}${marks[0] === "`" ? "`" : "~"}{${marks.length},}[ \\t]*$`);
    let end = at + 1;
    while (end < lines.length && !closing.test(lines[end]!.text)) end++;
    const code = lines
        .slice(at + 1, end)
        .map((line) => stripIndent(line.text, indent))
        .join("\n");
    return [{ kind: "code", language: info, code, gap: "" }, end < lines.length ? end + 1 : end];
}

/** A block wrapped in `<div align="...">`, a blank line, the block, a blank line and `</div>`: the form the writer gives. */
function readAligned(lines: Line[], at: number, context: Context): [Block, number] | undefined {
    const open = /^<div align="(left|center|right)">$/.exec(lines[at]!.text);
    if (!open || !blank(lines[at + 1]?.text) || lines[at + 1] === undefined) return undefined;
    let close = at + 2;
    while (close < lines.length && lines[close]!.text !== "</div>") close++;
    if (close >= lines.length || !blank(lines[close - 1]!.text)) return undefined;
    let first = at + 1;
    while (first < close && blank(lines[first]!.text)) first++;
    let last = close - 1;
    while (last > first && blank(lines[last]!.text)) last--;
    const inner = parseInside(lines.slice(first, last + 1), context);
    const block = inner[0];
    if (inner.length !== 1 || !block || (block.kind !== "paragraph" && block.kind !== "heading" && block.kind !== "image")) return undefined;
    block.align = open[1] as Align;
    return [block, close + 1];
}

/**
 * Where an HTML or JSX block that starts on a line ends. As in CommonMark it runs to the next blank
 * line, so a component with Markdown between its tags (`<Entry>`, a blank line, a list, a blank
 * line, `</Entry>`) becomes two small raw blocks with editable Markdown between. `<pre>`, `<script>`,
 * `<style>` and `<textarea>` run to their closing tag, since what is in them is never Markdown.
 */
function elementEnd(lines: Line[], from: number): number {
    const name = /^\s*<([A-Za-z][\w.:-]*)/.exec(lines[from]!.text)?.[1]?.toLowerCase();
    if (name === "pre" || name === "script" || name === "style" || name === "textarea") {
        for (let index = from; index < lines.length; index++) if (lines[index]!.text.toLowerCase().includes(`</${name}>`)) return index + 1;
        return lines.length;
    }
    return untilBlank(lines, from);
}

/** Where an `{expression}` that starts a line ends, counting its braces. */
function braceEnd(lines: Line[], from: number): number {
    let depth = 0;
    for (let index = from; index < lines.length; index++) {
        for (const char of lines[index]!.text) {
            if (char === "{") depth++;
            else if (char === "}") depth--;
        }
        if (depth <= 0) return index;
    }
    return from;
}

/** Gathers the lines that belong to a list item or footnote: indented by `content`, blank, or a lazy paragraph line. */
function gather(lines: Line[], at: number, first: string, content: number): { inner: Line[]; end: number } {
    const inner: Line[] = [{ text: first, eol: lines[at]!.eol }];
    let last = at;
    const emptyStart = blank(first);
    for (let index = at + 1; index < lines.length; index++) {
        const text = lines[index]!.text;
        if (blank(text)) {
            // an item that starts empty ends at its first blank line
            if (emptyStart && last === at) break;
            continue;
        }
        if (indentOf(text) >= content) {
            last = index;
            continue;
        }
        const lazy = last === index - 1 && !blank(lines[last]!.text) && !(emptyStart && last === at) && indentOf(text) < 4 && !interrupts(text) && !itemStart(text) && !FOOTNOTE.test(text.trimStart()) && !FENCE.test(lines[last]!.text.trimStart());
        if (lazy) {
            last = index;
            continue;
        }
        break;
    }
    for (let index = at + 1; index <= last; index++) {
        const line = lines[index]!;
        inner.push({ text: indentOf(line.text) >= content ? stripIndent(line.text, content) : blank(line.text) ? "" : line.text.trimStart(), eol: line.eol });
    }
    return { inner, end: last + 1 };
}

const hasBlank = (gap: string) => (gap.match(/\n/g) ?? []).length >= 2;

function readList(lines: Line[], at: number, context: Context): [Block, number] {
    const head = itemStart(lines[at]!.text)!;
    const items: ListItem[] = [];
    let loose = false;
    let index = at;
    let end = at + 1;
    let task = false;
    for (;;) {
        const start = itemStart(lines[index]!.text)!;
        const { inner, end: itemEnd } = gather(lines, index, start.first, start.content);
        const box = /^\[([ xX])\](?=[ \t]|$)[ \t]?/.exec(inner[0]!.text);
        if (box) inner[0] = { ...inner[0]!, text: inner[0]!.text.slice(box[0].length) };
        const blocks = parseInside(inner, context);
        if (blocks.slice(0, -1).some((block) => hasBlank(block.gap))) loose = true;
        const item: ListItem = { blocks, source: joinSource(lines.slice(index, itemEnd)), gap: "" };
        if (box) {
            item.checked = box[1] !== " ";
            if (items.length === 0) task = true;
        }
        let next = itemEnd;
        while (next < lines.length && blank(lines[next]!.text)) next++;
        const following = next < lines.length ? lines[next]!.text : undefined;
        const nextStart = following !== undefined && indentOf(following) < 4 && !THEMATIC.test(following.trimStart()) ? itemStart(following) : undefined;
        end = itemEnd;
        if (nextStart && sameList(nextStart.marker, head.marker)) {
            item.gap = lines[itemEnd - 1]!.eol + joinFull(lines.slice(itemEnd, next));
            if (next > itemEnd) loose = true;
            items.push(item);
            index = next;
            continue;
        }
        items.push(item);
        break;
    }
    const number = ordered(head.marker);
    const style: ListStyle = number ? "number" : task ? "task" : "bullet";
    return [
        {
            kind: "list",
            style,
            marker: number ? "-" : (head.marker as "-" | "*" | "+"),
            delimiter: number ? (head.marker.slice(-1) as "." | ")") : ".",
            start: number ? parseInt(head.marker, 10) : 1,
            loose,
            items,
            gap: "",
        },
        end,
    ];
}

function readQuote(lines: Line[], at: number, context: Context): [Block, number] {
    const inner: Line[] = [];
    let index = at;
    while (index < lines.length) {
        const text = lines[index]!.text;
        if (indentOf(text) < 4 && /^ {0,3}>/.test(text)) {
            inner.push({ text: text.replace(/^ {0,3}> ?/, ""), eol: lines[index]!.eol });
            index++;
        } else if (!blank(text) && inner.length > 0 && !blank(inner[inner.length - 1]!.text) && indentOf(text) < 4 && !interrupts(text) && !itemStart(text)) {
            inner.push({ text, eol: lines[index]!.eol });
            index++;
        } else break;
    }
    return [{ kind: "quote", blocks: parseInside(inner, context), gap: "" }, index];
}

function readFootnote(lines: Line[], at: number, match: RegExpExecArray, context: Context): [Block, number] {
    const text = stripIndent(lines[at]!.text, indentOf(lines[at]!.text));
    const { inner, end } = gather(lines, at, text.slice(match[0].length), 4);
    return [{ kind: "footnote", label: match[1]!, blocks: parseInside(inner, context), gap: "" }, end];
}

/** Splits a table row into cells on the pipes that are not escaped. */
function cells(row: string): string[] {
    let text = row.trim();
    if (text.startsWith("|")) text = text.slice(1);
    if (text.endsWith("|") && !text.endsWith("\\|")) text = text.slice(0, -1);
    const out: string[] = [];
    let cell = "";
    for (let index = 0; index < text.length; index++) {
        if (text[index] === "\\" && text[index + 1] === "|") {
            cell += "|";
            index++;
        } else if (text[index] === "|") {
            out.push(cell.trim());
            cell = "";
        } else cell += text[index];
    }
    out.push(cell.trim());
    return out;
}

function readTable(lines: Line[], at: number, context: Context): [Block, number] | undefined {
    const headRow = lines[at]!.text;
    const rule = lines[at + 1]?.text;
    if (!rule || !headRow.includes("|") || !rule.includes("|") || !DELIMITER_ROW.test(rule)) return undefined;
    const header = cells(headRow);
    const marks = cells(rule);
    if (header.length !== marks.length) return undefined;
    let end = at + 2;
    while (end < lines.length && !blank(lines[end]!.text) && !(indentOf(lines[end]!.text) < 4 && interrupts(lines[end]!.text))) end++;
    const align = marks.map((mark): Align | null => (mark.startsWith(":") && mark.endsWith(":") ? "center" : mark.endsWith(":") ? "right" : mark.startsWith(":") ? "left" : null));
    const rows = lines.slice(at + 2, end).map((line) => {
        const row = cells(line.text);
        return header.map((_, column) => runsFrom(row[column] ?? "", context));
    });
    return [{ kind: "table", header: header.map((cell) => runsFrom(cell, context)), align, rows, gap: "" }, end];
}

function readParagraph(lines: Line[], at: number, context: Context): [Block, number] {
    let end = at + 1;
    while (end < lines.length) {
        const text = lines[end]!.text;
        if (blank(text)) break;
        if (indentOf(text) < 4) {
            const setext = SETEXT.exec(text.trimStart());
            if (setext) {
                const runs = runsFrom(paragraphText(lines.slice(at, end)), context);
                return [{ kind: "heading", level: setext[1]!.startsWith("=") ? 1 : 2, runs, gap: "" }, end + 1];
            }
            if (interrupts(text)) break;
        }
        end++;
    }
    const runs = runsFrom(paragraphText(lines.slice(at, end)), context);
    const only = runs[0];
    if (runs.length === 1 && only?.kind === "image") {
        const block: Block = { kind: "image", src: only.src, alt: only.alt, gap: "" };
        if (only.title !== undefined) block.title = only.title;
        return [block, end];
    }
    return [{ kind: "paragraph", runs, gap: "" }, end];
}

const paragraphText = (lines: Line[]) =>
    lines
        .map((line) => line.text)
        .join("\n")
        .trim();

/** Every link reference definition in the body, so `[text][label]` and `[label]` can be read as links. */
function definitions(lines: Line[]): Map<string, { href: string; title?: string }> {
    const out = new Map<string, { href: string; title?: string }>();
    for (const line of lines) {
        const match = DEFINITION.exec(line.text);
        if (!match || match[1]!.startsWith("^")) continue;
        const label = normalLabel(match[1]!);
        if (out.has(label)) continue;
        const href = match[2]!.replace(/^<|>$/g, "");
        out.set(label, match[3] ? { href, title: unescape(match[3].slice(1, -1)) } : { href });
    }
    return out;
}

const normalLabel = (label: string) => label.trim().replace(/\s+/g, " ").toLowerCase();

// ---- inline ----

const PUNCTUATION = /[!-/:-@[-`{-~]/;
const UNICODE_PUNCTUATION = /[\p{P}\p{S}]/u;
const unescape = (value: string) => value.replace(/\\([!-/:-@[-`{-~])/g, "$1");

interface Delimiter {
    char: string;
    count: number;
    length: number;
    open: boolean;
    close: boolean;
}

type Token = { run: Run } | Delimiter;
const isDelimiter = (token: Token): token is Delimiter => "char" in token;

/** Where an HTML or JSX tag that starts at `from` ends, past its `>`, with quoted and braced attributes skipped; -1 if it does not end. */
function tagEnd(text: string, from: number): number {
    let quote = "";
    let depth = 0;
    for (let index = from + 1; index < text.length; index++) {
        const char = text[index]!;
        if (quote) {
            if (char === quote) quote = "";
        } else if (char === '"' || char === "'") quote = char;
        else if (char === "{") depth++;
        else if (char === "}") depth--;
        else if (char === ">" && depth <= 0) return index + 1;
        else if (char === "<" && depth <= 0) return -1;
    }
    return -1;
}

/** Skips a code span starting at `from`, returning where it ends, or -1 if its backticks never close. */
function codeSpanEnd(text: string, from: number): { end: number; ticks: number } {
    let ticks = 0;
    while (text[from + ticks] === "`") ticks++;
    for (let index = from + ticks; index < text.length; ) {
        if (text[index] !== "`") {
            index++;
            continue;
        }
        let run = 0;
        while (text[index + run] === "`") run++;
        if (run === ticks) return { end: index + run, ticks };
        index += run;
    }
    return { end: -1, ticks };
}

/** The index of the `]` that closes the `[` at `from`, skipping escapes, code spans and nested brackets. */
function bracketEnd(text: string, from: number): number {
    let depth = 0;
    for (let index = from; index < text.length; index++) {
        const char = text[index]!;
        if (char === "\\") index++;
        else if (char === "`") {
            const span = codeSpanEnd(text, index);
            index = span.end < 0 ? index + span.ticks - 1 : span.end - 1;
        } else if (char === "[") depth++;
        else if (char === "]" && --depth === 0) return index;
    }
    return -1;
}

/** An inline link's destination and title after `(`, and where the `)` ends. */
function destination(text: string, from: number): { href: string; title?: string; end: number } | undefined {
    let index = from + 1;
    const skip = () => {
        while (/[ \t\n]/.test(text[index] ?? "")) index++;
    };
    skip();
    let href = "";
    if (text[index] === "<") {
        const close = text.indexOf(">", index);
        if (close < 0 || text.slice(index, close).includes("\n")) return undefined;
        href = text.slice(index + 1, close);
        index = close + 1;
    } else {
        let depth = 0;
        const start = index;
        while (index < text.length) {
            const char = text[index]!;
            if (char === "\\" && PUNCTUATION.test(text[index + 1] ?? "")) index += 2;
            else if (/[\s]/.test(char)) break;
            else if (char === "(") {
                depth++;
                index++;
            } else if (char === ")") {
                if (depth === 0) break;
                depth--;
                index++;
            } else index++;
        }
        href = text.slice(start, index);
    }
    const afterHref = index;
    skip();
    let title: string | undefined;
    const opener = text[index];
    if ((opener === '"' || opener === "'" || opener === "(") && index > afterHref) {
        const closer = opener === "(" ? ")" : opener;
        let close = index + 1;
        while (close < text.length && text[close] !== closer) close += text[close] === "\\" ? 2 : 1;
        if (close >= text.length) return undefined;
        title = unescape(text.slice(index + 1, close));
        index = close + 1;
        skip();
    }
    if (text[index] !== ")") return undefined;
    return { href: unescape(href), title, end: index + 1 };
}

const textRun = (value: string, marks: Mark[] = []): TextRun => ({ kind: "text", text: value, marks });

/** The named character references read as their characters. Any other name is kept as an HTML run. */
const ENTITIES: Record<string, string> = {
    amp: "&",
    lt: "<",
    gt: ">",
    quot: '"',
    apos: "'",
    nbsp: " ",
    copy: "©",
    reg: "®",
    trade: "™",
    mdash: "—",
    ndash: "–",
    hellip: "…",
    lsquo: "‘",
    rsquo: "’",
    ldquo: "“",
    rdquo: "”",
    laquo: "«",
    raquo: "»",
    middot: "·",
    bull: "•",
    deg: "°",
    times: "×",
    divide: "÷",
    euro: "€",
    pound: "£",
    sect: "§",
};

function addMark(run: Run, mark: Mark) {
    if (run.kind === "text" && !run.marks.includes(mark)) run.marks.push(mark);
    if (run.kind === "link") for (const leaf of run.runs) addMark(leaf, mark);
}

function addStyle(run: Run, style: { color?: string; size?: string }) {
    if (run.kind === "text") {
        if (style.color) run.color = style.color;
        if (style.size) run.size = style.size;
    }
    if (run.kind === "link") for (const leaf of run.runs) addStyle(leaf, style);
}

/** Where the closing tag that matches an opening one ends, counting nested tags of the same name; -1 if it never closes. */
function closingTag(text: string, from: number, name: string): { inner: number; end: number } | undefined {
    let depth = 1;
    const open = new RegExp(`^<${name}(?=[\\s>])`);
    const close = `</${name}>`;
    for (let index = from; index < text.length; index++) {
        if (text[index] === "\\") index++;
        else if (text[index] === "`") {
            const span = codeSpanEnd(text, index);
            index = span.end < 0 ? index + span.ticks - 1 : span.end - 1;
        } else if (open.test(text.slice(index, index + name.length + 2))) depth++;
        else if (text.startsWith(close, index) && --depth === 0) return { inner: index, end: index + close.length };
    }
    return undefined;
}

const STYLE = /^<span style="(?:color:([^;"<>]+?)(?:; font-size:([^;"<>]+?))?|font-size:([^;"<>]+?))">/;

/** Reads the text of a paragraph, heading or cell into runs. */
export function parseInline(text: string, options: ReadOptions = {}): Run[] {
    return runsFrom(text, { mdx: !!options.mdx, refs: new Map() });
}

const runsFrom = (text: string, context: Context) => tidyRuns(inline(text, context));

function inline(text: string, context: Context): Run[] {
    const tokens: Token[] = [];
    let buffer = "";
    const flush = () => {
        if (buffer) tokens.push({ run: textRun(buffer) });
        buffer = "";
    };
    const push = (run: Run) => {
        flush();
        tokens.push({ run });
    };
    const nested = (inner: string) => inline(inner, context).flatMap((run): Leaf[] => (run.kind === "link" ? run.runs : [run]));

    let index = 0;
    while (index < text.length) {
        const char = text[index]!;
        const rest = text.slice(index);

        if (char === "\\") {
            if (text[index + 1] === "\n") {
                push({ kind: "break" });
                index += 2;
                while (/[ \t]/.test(text[index] ?? "")) index++;
                continue;
            }
            if (PUNCTUATION.test(text[index + 1] ?? "")) {
                buffer += text[index + 1];
                index += 2;
                continue;
            }
            buffer += char;
            index++;
            continue;
        }
        if (char === "\n") {
            const spaces = /[ \t]*$/.exec(buffer)![0];
            buffer = buffer.slice(0, buffer.length - spaces.length);
            if (spaces.replace(/\t/g, "").length >= 2 && !spaces.includes("\t")) push({ kind: "break" });
            else buffer += "\n";
            index++;
            while (/[ \t]/.test(text[index] ?? "")) index++;
            continue;
        }
        if (char === "`") {
            const span = codeSpanEnd(text, index);
            if (span.end < 0) {
                buffer += "`".repeat(span.ticks);
                index += span.ticks;
                continue;
            }
            let content = text.slice(index + span.ticks, span.end - span.ticks).replace(/\n/g, " ");
            if (content.length > 1 && content.startsWith(" ") && content.endsWith(" ") && content.trim() !== "") content = content.slice(1, -1);
            push(textRun(content, ["code"]));
            index = span.end;
            continue;
        }
        if (char === "!" && text[index + 1] === "[") {
            const close = bracketEnd(text, index + 1);
            if (close > 0) {
                const alt = runsPlain(nested(text.slice(index + 2, close)));
                if (text[close + 1] === "(") {
                    const target = destination(text, close + 1);
                    if (target) {
                        const run: Run = { kind: "image", src: target.href, alt };
                        if (target.title !== undefined) run.title = target.title;
                        push(run);
                        index = target.end;
                        continue;
                    }
                }
                const reference = referenceAt(text, close, context);
                if (reference) {
                    const run: Run = { kind: "image", src: reference.href, alt };
                    if (reference.title !== undefined) run.title = reference.title;
                    push(run);
                    index = reference.end;
                    continue;
                }
            }
        }
        if (char === "[") {
            const footnote = /^\[\^([^\]\s]+)\]/.exec(rest);
            if (footnote) {
                push({ kind: "footnote", label: footnote[1]! });
                index += footnote[0].length;
                continue;
            }
            const close = bracketEnd(text, index);
            if (close > 0) {
                const label = text.slice(index + 1, close);
                if (text[close + 1] === "(") {
                    const target = destination(text, close + 1);
                    if (target) {
                        const run: Run = { kind: "link", href: target.href, runs: nested(label) };
                        if (target.title !== undefined) run.title = target.title;
                        push(run);
                        index = target.end;
                        continue;
                    }
                }
                const reference = referenceAt(text, close, context, label);
                if (reference) {
                    const run: Run = { kind: "link", href: reference.href, ref: reference.ref, runs: nested(label) };
                    if (reference.title !== undefined) run.title = reference.title;
                    push(run);
                    index = reference.end;
                    continue;
                }
            }
        }
        if (char === "<") {
            const auto = /^<([A-Za-z][A-Za-z0-9+.-]{1,31}:[^\s<>]*)>/.exec(rest) ?? /^<([A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?)*)>/.exec(rest);
            if (auto) {
                const href = auto[1]!.includes(":") ? auto[1]! : `mailto:${auto[1]}`;
                push({ kind: "link", href, runs: [textRun(auto[1]!)] });
                index += auto[0].length;
                continue;
            }
            const style = STYLE.exec(rest);
            const underline = rest.startsWith("<u>");
            if (style || underline) {
                const name = style ? "span" : "u";
                const open = style ? style[0].length : 3;
                const close = closingTag(text, index + open, name);
                if (close) {
                    flush();
                    const runs = inline(text.slice(index + open, close.inner), context);
                    for (const run of runs) {
                        if (style) addStyle(run, { color: style[1], size: style[2] ?? style[3] });
                        else addMark(run, "underline");
                        tokens.push({ run });
                    }
                    index = close.end;
                    continue;
                }
            }
            if (rest.startsWith("<!--")) {
                const end = text.indexOf("-->", index + 4);
                if (end > 0) {
                    push({ kind: "html", html: text.slice(index, end + 3) });
                    index = end + 3;
                    continue;
                }
            }
            if (/^<\/?[A-Za-z]/.test(rest) || (context.mdx && /^<\/?>/.test(rest))) {
                const end = tagEnd(text, index);
                if (end > 0) {
                    push({ kind: "html", html: text.slice(index, end) });
                    index = end;
                    continue;
                }
            }
        }
        if (char === "{" && context.mdx) {
            let depth = 0;
            let end = -1;
            for (let k = index; k < text.length; k++) {
                if (text[k] === "{") depth++;
                else if (text[k] === "}" && --depth === 0) {
                    end = k + 1;
                    break;
                }
            }
            if (end > 0) {
                push({ kind: "html", html: text.slice(index, end) });
                index = end;
                continue;
            }
        }
        if (char === "&") {
            const entity = /^&(?:#(\d{1,7})|#[xX]([0-9a-fA-F]{1,6})|([A-Za-z][A-Za-z0-9]{1,31}));/.exec(rest);
            const number = entity && (entity[1] ? parseInt(entity[1], 10) : entity[2] ? parseInt(entity[2], 16) : undefined);
            const decoded = number !== undefined && number !== null ? (number > 0 && number <= 0x10ffff ? String.fromCodePoint(number) : "�") : entity ? ENTITIES[entity[3]!] : undefined;
            if (entity && decoded !== undefined) {
                buffer += decoded;
                index += entity[0].length;
                continue;
            }
            if (entity) {
                push({ kind: "html", html: entity[0] });
                index += entity[0].length;
                continue;
            }
        }
        if (char === "*" || char === "_" || char === "~") {
            let count = 0;
            while (text[index + count] === char) count++;
            if (char === "~" && count > 2) {
                buffer += char.repeat(count);
                index += count;
                continue;
            }
            const before = text[index - 1] ?? " ";
            const after = text[index + count] ?? " ";
            const space = (value: string) => /\s/.test(value);
            const punctuation = (value: string) => UNICODE_PUNCTUATION.test(value);
            const left = !space(after) && (!punctuation(after) || space(before) || punctuation(before));
            const right = !space(before) && (!punctuation(before) || space(after) || punctuation(after));
            flush();
            tokens.push({
                char,
                count,
                length: count,
                open: char === "_" ? left && (!right || punctuation(before)) : left,
                close: char === "_" ? right && (!left || punctuation(after)) : right,
            });
            index += count;
            continue;
        }
        buffer += char;
        index++;
    }
    flush();
    emphasis(tokens);
    return tokens.flatMap((token): Run[] => (isDelimiter(token) ? (token.count ? [textRun(token.char.repeat(token.count))] : []) : [token.run]));
}

/** A reference link's target after the `]` at `close`: `[text][label]`, `[label][]` or `[label]`. */
function referenceAt(text: string, close: number, context: Context, label?: string): { href: string; title?: string; ref: string; end: number } | undefined {
    if (text[close + 1] === "[") {
        const end = text.indexOf("]", close + 2);
        if (end > 0) {
            const ref = text.slice(close + 2, end);
            const name = ref === "" ? label : ref;
            const found = name !== undefined ? context.refs.get(normalLabel(name)) : undefined;
            if (found) return { ...found, ref, end: end + 1 };
        }
        return undefined;
    }
    const start = text.lastIndexOf("[", close);
    const name = label ?? text.slice(start + 1, close);
    const found = context.refs.get(normalLabel(name));
    return found ? { ...found, ref: "", end: close + 1 } : undefined;
}

function runsPlain(runs: Leaf[]): string {
    return runs.map((run) => (run.kind === "text" ? run.text : run.kind === "image" ? run.alt : "")).join("");
}

/** CommonMark's emphasis rule: each closing run of `*`, `_` or `~` finds the nearest opening run it can pair with. */
function emphasis(tokens: Token[]) {
    for (let close = 0; close < tokens.length; close++) {
        const closer = tokens[close]!;
        if (!isDelimiter(closer) || !closer.close) continue;
        let matched = true;
        while (closer.count > 0 && matched) {
            matched = false;
            for (let open = close - 1; open >= 0; open--) {
                const opener = tokens[open]!;
                if (!isDelimiter(opener) || opener.char !== closer.char || !opener.open || opener.count === 0) continue;
                if (closer.char === "~") {
                    if (opener.count !== closer.count) continue;
                } else if ((opener.close || closer.open) && (opener.length + closer.length) % 3 === 0 && !(opener.length % 3 === 0 && closer.length % 3 === 0)) continue;
                const use = closer.char === "~" ? closer.count : opener.count >= 2 && closer.count >= 2 ? 2 : 1;
                const mark: Mark = closer.char === "~" ? "strike" : use === 2 ? "bold" : "italic";
                for (let k = open + 1; k < close; k++) {
                    const token = tokens[k]!;
                    // a run left unpaired inside the emphasis is plain text, and takes the mark too
                    if (isDelimiter(token)) tokens[k] = { run: textRun(token.char.repeat(token.count)) };
                    addMark((tokens[k] as { run: Run }).run, mark);
                }
                opener.count -= use;
                closer.count -= use;
                matched = true;
                break;
            }
        }
    }
}
