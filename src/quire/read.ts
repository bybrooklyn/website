// Markdown or MDX text to a document. The file is cut into blocks along its own lines, and every
// block keeps the exact text it was cut from and the blank text after it, so writing an untouched
// document back gives the same bytes: line endings, final newlines, tabs, trailing spaces, list
// markers and all. What a block means is read the way CommonMark and GFM read it, closely enough to
// edit; what is not understood becomes a raw block, kept as its text.

import { asPicture } from "./pictures";
import { tidyRuns, type Align, type Block, type Document, type Leaf, type Level, type ListItem, type ListStyle, type Mark, type Paragraph, type Run, type TextRun } from "./document";
import { addresses, shortcodeAt } from "./emoji";

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
    /** How many reference links have been read, so that each block can be marked with whether it holds one. */
    references?: number;
    /** The definitions found in definition blocks as the body is read, when they are being gathered. */
    found?: Map<string, { href: string; title?: string }>;
    /** Set while a table cell is read, where pipes are the cell's edges and make no spoiler, and `<br>` is a line break. */
    cell?: boolean;
}

/** Reads a whole file into a document. */
export function read(source: string, options: ReadOptions = {}): Document {
    const bom = source.startsWith("﻿") ? "﻿" : "";
    const rest = source.slice(bom.length);
    const lines = splitLines(rest);
    // new text is written with the ending most of the file's lines have, so one stray CRLF does not set it
    let crlf = 0;
    let ended = 0;
    for (const line of lines) {
        if (line.eol === "\r\n") crlf++;
        if (line.eol !== "") ended++;
    }
    const eol = crlf * 2 > ended ? "\r\n" : "\n";
    let frontmatter: string | null = null;
    let at = 0;
    // frontmatter opens on the first line and closes on the first line that is only `---` or `...` (as YAML has it), never on one that merely starts with it
    if (lines.length > 1 && /^---[ \t]*$/.test(lines[0]!.text)) {
        const close = lines.findIndex((line, index) => index > 0 && /^(---|\.\.\.)[ \t]*$/.test(line.text));
        if (close > 0) {
            frontmatter = joinFull(lines.slice(0, close + 1));
            at = close + 1;
        }
    }
    const body = lines.slice(at);
    // links are read with every line that looks like a definition; only lines read as definition
    // blocks are definitions (not those in code, or inside a paragraph), so if those differ the body
    // is read again with the true ones, which is seldom
    const guessed = definitions(body);
    const context: Context = { mdx: !!options.mdx, refs: guessed, found: new Map() };
    let { lead, blocks } = parseBlocks(body, context);
    let references = context.references ?? 0;
    if (!sameDefinitions(guessed, context.found!)) {
        const again: Context = { mdx: context.mdx, refs: context.found! };
        ({ lead, blocks } = parseBlocks(body, again));
        references = again.references ?? 0;
    }
    const doc: Document = { bom, frontmatter, lead, blocks, eol, mdx: context.mdx };
    if (references > 0) doc.references = true;
    return doc;
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
    // CommonMark's tag name is letters, digits and `-`: `<http://x.y>` and `<a@b.co>` alone on a line are autolinks, not HTML
    if (!/^<\/?[A-Za-z][A-Za-z0-9-]*(?=[\s/>]|$)/.test(text)) return false;
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

/** For each block read, the block read straight after it among its neighbours: two blocks that still stand together keep the gap the file had between them (write.ts). */
export const followed = new WeakMap<Block, Block>();

/**
 * True if a block written as `afterText`, on the line straight after a block written as
 * `beforeText`, is read as a block of its own and not as more of the one before. These are the
 * reader's own rules for where each kind of block ends, so that the writer can choose between one
 * line ending and a blank line.
 */
export function standsApart(before: Block, beforeText: string, afterText: string): boolean {
    const head = beforeText.slice(0, beforeText.search(/\r?\n|$/));
    const last = beforeText.slice(beforeText.lastIndexOf("\n") + 1).replace(/\r$/, "");
    const first = afterText.slice(0, afterText.search(/\r?\n|$/));
    if (blank(first)) return true;
    const shallow = indentOf(first) < 4;
    const cuts = shallow && interrupts(first);
    const item = shallow ? itemStart(first) : undefined;
    switch (before.kind) {
        case "heading":
        case "divider":
            return true;
        case "code":
            // only indented code runs on into an indented line
            return shallow || FENCE.test(head.trimStart()) || head.trimStart().startsWith("$$");
        case "paragraph":
        case "image":
        case "table":
            // a block written inside `<div align>` ends at its `</div>`; a picture written as HTML runs to a blank line
            if (/^<div align="(left|center|right)">$/.test(head)) return true;
            if (head.startsWith("<")) return false;
            return cuts && (before.kind === "table" || !SETEXT.test(first.trim()));
        case "list":
        case "footnote": {
            // a definition list ends after its last definition, unless another term and definition follow;
            // an item it could not keep is written as plain blocks (write.ts), which run on as a paragraph does
            if (before.kind === "list" && before.style === "definition") return DETAIL.test(last) ? cuts || !!item || !DETAIL.test(afterText.split(/\r?\n/)[1] ?? "") : cuts && !SETEXT.test(first.trim());
            const own = itemStart(head);
            if (before.kind === "list" && item && own && sameList(item.marker, own.marker)) return false;
            // a line after a blank one, after a fence or after an item with nothing in it is not a lazy continuation
            if (blank(last) || FENCE.test(last.trimStart()) || (own && indentOf(last) === own.before && /^ {0,3}([-*+]|\d{1,9}[.)])[ \t]*$/.test(last))) return true;
            return cuts || !!item || FOOTNOTE.test(first.trimStart());
        }
        case "quote":
            if (before.details) return true;
            if (shallow && first.trimStart().startsWith(">")) return false;
            if (/^ {0,3}>[ \t]*$/.test(last)) return true;
            return cuts || !!item;
        case "raw": {
            // a comment ends at its `-->`, and <pre>, <script>, <style> and <textarea> at their closing tag; anything else runs to a blank line
            if (/^ {0,3}<!--/.test(head)) return last.includes("-->");
            const name = /^\s*<([A-Za-z][\w.:-]*)/.exec(head)?.[1]?.toLowerCase();
            if (name === "pre" || name === "script" || name === "style" || name === "textarea") return last.toLowerCase().includes(`</${name}>`);
            return false;
        }
    }
    return false;
}

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
        const before = blocks[blocks.length - 1];
        // the writer asks only of a gap of one line ending, so only such neighbours are noted
        if (before && before.gap.indexOf("\n") === before.gap.length - 1) followed.set(before, block);
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
    // a raw block's text has plain newlines, as code has, so that a line typed into it is the same
    // as the others; the block's source keeps the file's own line endings
    const raw = (end: number): [Block, number] => [{ kind: "raw", text: lines.slice(at, end).map((each) => each.text).join("\n"), gap: "" }, end];

    if (indent >= 4 && !context.mdx) return readIndentedCode(lines, at);
    const text = indent >= 4 ? line.trimStart() : stripIndent(line, indent);

    // MDX has no indented code, and reads a deeply indented component or expression as one
    if (indent >= 4) {
        if (text.startsWith("<") && htmlStarts(text, context)) return raw(elementEnd(lines, at));
        if (text.startsWith("{")) return raw(untilBlank(lines, braceEnd(lines, at)));
    } else {
        const fence = FENCE.exec(text);
        if (fence) return readFence(lines, at, indent, fence);
        const dollars = text.startsWith("$$") ? readDollars(lines, at, indent) : undefined;
        if (dollars) return dollars;
        const details = /^<details[\s>]/i.test(text) ? readDetails(lines, at, context) : undefined;
        if (details) return details;
        const atx = ATX.exec(text);
        if (atx) {
            const content = headingText(atx[2]!);
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
        if (text.startsWith("<") && htmlStarts(text, context)) {
            // a resized or captioned picture is HTML of one exact form, read back as the picture (pictures.ts)
            const [block, end] = raw(elementEnd(lines, at));
            return [asPicture(block), end];
        }
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
            if (context.found) for (const [label, target] of definitions(lines.slice(at, end))) if (!context.found.has(label)) context.found.set(label, target);
            return raw(end);
        }
        const table = readTable(lines, at, context);
        if (table) return table;
        const terms = DETAIL.test(lines[at + 1]?.text ?? "") ? readDefinitions(lines, at, context) : undefined;
        if (terms) return terms;
    }
    return readParagraph(lines, at, context);
}

/** A heading's text without its closing sequence of `#`s, which must stand after a space; worked by hand, as a pattern would be slow on a long run of spaces. */
function headingText(raw: string): string {
    let end = raw.length;
    while (end > 0 && (raw[end - 1] === " " || raw[end - 1] === "\t")) end--;
    let hashes = end;
    while (hashes > 0 && raw[hashes - 1] === "#") hashes--;
    if (hashes < end && (hashes === 0 || raw[hashes - 1] === " " || raw[hashes - 1] === "\t")) end = hashes;
    return raw.slice(0, end).trim();
}

/** A block of display maths between `$$` lines, or on one line as `$$ ... $$`; undefined if the `$$` never closes. */
function readDollars(lines: Line[], at: number, indent: number): [Block, number] | undefined {
    const text = stripIndent(lines[at]!.text, indent);
    const one = /^\$\$(.*\S.*)\$\$[ \t]*$/.exec(text);
    if (one) return [{ kind: "code", language: "math", code: one[1]!.trim(), dollars: true, gap: "" }, at + 1];
    if (!/^\$\$[ \t]*$/.test(text)) return undefined;
    let end = at + 1;
    while (end < lines.length && !/^ {0,3}\$\$[ \t]*$/.test(lines[end]!.text)) end++;
    if (end >= lines.length) return undefined;
    const code = lines
        .slice(at + 1, end)
        .map((line) => stripIndent(line.text, indent))
        .join("\n");
    return [{ kind: "code", language: "math", code, dollars: true, gap: "" }, end + 1];
}

/**
 * A folding section in the form GitHub shows: `<details>` (or `<details open>`), its `<summary>` on
 * the same line or the next, a blank line, Markdown, a blank line and `</details>` on a line of its
 * own. Sections inside it are counted, so the right closing line is found. Any other form is left
 * to be read as HTML, kept as its text.
 */
function readDetails(lines: Line[], at: number, context: Context): [Block, number] | undefined {
    const open = /^<details(\s+open(?:="")?)?\s*>[ \t]*(?:<summary>(.*?)<\/summary>[ \t]*)?$/i.exec(lines[at]!.text);
    if (!open) return undefined;
    let summary = open[2];
    let first = at + 1;
    if (summary === undefined) {
        const line = /^[ \t]*<summary>(.*?)<\/summary>[ \t]*$/i.exec(lines[first]?.text ?? "");
        if (!line) return undefined;
        summary = line[1]!;
        first++;
    }
    if (first >= lines.length || !blank(lines[first]!.text)) return undefined;
    let depth = 1;
    let close = first;
    for (; close < lines.length; close++) {
        const text = lines[close]!.text;
        if (/^<details[\s>]/i.test(text)) depth++;
        else if (/^<\/details>[ \t]*$/i.test(text) && --depth === 0) break;
    }
    if (close >= lines.length || !blank(lines[close - 1]!.text)) return undefined;
    let start = first;
    while (start < close && blank(lines[start]!.text)) start++;
    let last = close - 1;
    while (last >= start && blank(lines[last]!.text)) last--;
    const blocks = last >= start ? parseInside(lines.slice(start, last + 1), context) : [];
    return [{ kind: "quote", blocks: orEmpty(blocks), details: { summary, open: !!open[1] }, gap: "" }, close + 1];
}

/** An empty paragraph that stands for nothing in the file, so that an empty box has a line to write on. */
const emptyKept = (): Paragraph => ({ kind: "paragraph", runs: [], source: "", gap: "" });

/** The blocks of a list item, quote or footnote, or one empty line to write on if it has none, so that the cursor can go into it. */
const orEmpty = (blocks: Block[]): Block[] => (blocks.length ? blocks : [emptyKept()]);

/** A definition's line: a colon at the start, then the definition. */
const DETAIL = /^ {0,3}:[ \t]+(.*)$/;

/**
 * A definition list: a term on a line of its own, then one or more `: definition` lines; terms and
 * their definitions follow one another, with or without blank lines between. Each term and each
 * definition is one line. Each is kept with its own text, so a definition list written again after
 * an edit changes only the item edited.
 */
function readDefinitions(lines: Line[], at: number, context: Context): [Block, number] | undefined {
    const term = (text: string | undefined) => text !== undefined && !blank(text) && indentOf(text) < 4 && !interrupts(text) && !itemStart(text) && !DETAIL.test(text);
    if (!term(lines[at]!.text)) return undefined;
    const items: ListItem[] = [];
    let loose = false;
    let index = at;
    for (;;) {
        const head = lines[index]!;
        const blocks: Block[] = [{ kind: "paragraph", runs: runsFrom(head.text.trim(), context), source: head.text, gap: head.eol }];
        let end = index + 1;
        for (let match = DETAIL.exec(lines[end]?.text ?? ""); match; match = DETAIL.exec(lines[end]?.text ?? "")) {
            blocks.push({ kind: "paragraph", runs: runsFrom(match[1]!.trim(), context), source: match[1]!, gap: lines[end]!.eol });
            end++;
        }
        blocks[blocks.length - 1]!.gap = "";
        const item: ListItem = { blocks, source: joinSource(lines.slice(index, end)), gap: "" };
        let next = end;
        while (next < lines.length && blank(lines[next]!.text)) next++;
        if (term(lines[next]?.text) && DETAIL.test(lines[next + 1]?.text ?? "")) {
            item.gap = lines[end - 1]!.eol + joinFull(lines.slice(end, next));
            if (next > end) loose = true;
            items.push(item);
            index = next;
            continue;
        }
        items.push(item);
        return [{ kind: "list", style: "definition", marker: "-", delimiter: ".", start: 1, loose, items, gap: "" }, end];
    }
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
        // an empty item still has a line to write on, which stands for nothing in the file
        const blocks = orEmpty(parseInside(inner, context));
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
    // a callout, `> [!NOTE]`, with any words after the marker as its title
    const callout = /^\[!([A-Za-z]+)\][ \t]*(.*)$/.exec(inner[0]?.text ?? "");
    if (callout) {
        const block: Block = { kind: "quote", blocks: orEmpty(parseInside(inner.slice(1), context)), callout: callout[1]!, gap: "" };
        if (callout[2]) block.title = callout[2];
        return [block, index];
    }
    return [{ kind: "quote", blocks: orEmpty(parseInside(inner, context)), gap: "" }, index];
}

function readFootnote(lines: Line[], at: number, match: RegExpExecArray, context: Context): [Block, number] {
    const text = stripIndent(lines[at]!.text, indentOf(lines[at]!.text));
    const { inner, end } = gather(lines, at, text.slice(match[0].length), 4);
    return [{ kind: "footnote", label: match[1]!, blocks: orEmpty(parseInside(inner, context)), gap: "" }, end];
}

/** Splits a table row into cells on the pipes that are not escaped. Every `\|` is an escaped pipe, which is what lets the writer escape every pipe in a cell, text, code and all (write.ts). */
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
    const inCell: Context = { ...context, cell: true };
    let end = at + 2;
    while (end < lines.length && !blank(lines[end]!.text) && !(indentOf(lines[end]!.text) < 4 && interrupts(lines[end]!.text))) end++;
    const align = marks.map((mark): Align | null => (mark.startsWith(":") && mark.endsWith(":") ? "center" : mark.endsWith(":") ? "right" : mark.startsWith(":") ? "left" : null));
    const rows = lines.slice(at + 2, end).map((line) => {
        const row = cells(line.text);
        return header.map((_, column) => runsFrom(row[column] ?? "", inCell));
    });
    return [{ kind: "table", header: header.map((cell) => runsFrom(cell, inCell)), align, rows, gap: "" }, end];
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
    // `-# text`, Discord's small quiet text: a paragraph whose first line starts so (standard Markdown gives `-#` no meaning)
    const subtext = /^ {0,3}-#[ \t]+(?=\S)/.exec(lines[at]!.text);
    if (subtext) {
        const rest = [{ ...lines[at]!, text: lines[at]!.text.slice(subtext[0].length) }, ...lines.slice(at + 1, end)];
        return [{ kind: "paragraph", runs: runsFrom(paragraphText(rest), context), subtext: true, gap: "" }, end];
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

/** Every line of these that looks like a link reference definition, so `[text][label]` and `[label]` can be read as links. */
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

/** True if two sets of definitions name the same labels with the same targets. */
function sameDefinitions(a: Map<string, { href: string; title?: string }>, b: Map<string, { href: string; title?: string }>): boolean {
    if (a.size !== b.size) return false;
    for (const [label, target] of a) if (b.get(label)?.href !== target.href || b.get(label)?.title !== target.title) return false;
    return true;
}

/** The labels named by the definitions among these blocks, at any depth, in lower case. */
export function definedLabels(blocks: Block[]): Set<string> {
    const out = new Set<string>();
    const visit = (list: Block[]) => {
        for (const block of list) {
            if (block.kind === "raw") for (const line of block.text.split("\n")) {
                const match = DEFINITION.exec(line);
                if (match && !match[1]!.startsWith("^")) out.add(normalLabel(match[1]!));
            }
            else if (block.kind === "list") for (const item of block.items) visit(item.blocks);
            else if (block.kind === "quote" || block.kind === "footnote") visit(block.blocks);
        }
    };
    visit(blocks);
    return out;
}

/** A link label as definitions are matched: spacing made one space, in lower case. */
export const normalLabel = (label: string) => label.trim().replace(/\s+/g, " ").toLowerCase();

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
        // the address ends at the first `>` that is not escaped, and holds no `<` and no line ending
        let close = index + 1;
        while (close < text.length && text[close] !== ">" && text[close] !== "<" && text[close] !== "\n") close += text[close] === "\\" ? 2 : 1;
        if (text[close] !== ">") return undefined;
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

/** The HTML tags read as marks. */
const TAG_MARKS: Record<string, Mark> = { u: "underline", sup: "sup", sub: "sub", strong: "bold", em: "italic", del: "strike", mark: "mark" };

const STYLE = /^<span style="(?:color:([^;"<>]+?)(?:; font-size:([^;"<>]+?))?|font-size:([^;"<>]+?))">/;

const runsFrom = (text: string, context: Context) => tidyRuns(inline(text, context));

function inline(text: string, context: Context): Run[] {
    // which characters sit in a web address, worked out when a shortcode or a pipe or equals sign first asks
    let mask: Uint8Array | null | undefined;
    const inAddress = (at: number) => !!(mask === undefined ? (mask = addresses(text) ?? null) : mask)?.[at];
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
            // the spaces before the line ends, counted by hand: a pattern would take time growing with the square of a long run of them
            let cut = buffer.length;
            while (cut > 0 && (buffer[cut - 1] === " " || buffer[cut - 1] === "\t")) cut--;
            const spaces = buffer.slice(cut);
            buffer = buffer.slice(0, cut);
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
        if (char === ":") {
            // a shortcode standing as a word of its own, not in a word and not in a web address (emoji.ts)
            const name = shortcodeAt(text, index, inAddress(index));
            if (name) {
                push({ kind: "emoji", name });
                index += name.length + 2;
                continue;
            }
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
                    if (reference.ref === "") run.label = label;
                    if (reference.shortcut) run.shortcut = true;
                    context.references = (context.references ?? 0) + 1;
                    push(run);
                    index = reference.end;
                    continue;
                }
            }
        }
        if (char === "<" && context.cell) {
            const lineBreak = /^<br\s*\/?>/i.exec(rest);
            if (lineBreak) {
                push({ kind: "break" });
                index += lineBreak[0].length;
                continue;
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
            // underline, superscript and subscript have no Markdown; the others are the HTML the writer gives a
            // mark whose signs would not be read where they stand (write.ts)
            const simple = /^<(u|sup|sub|strong|em|del|mark)>/.exec(rest);
            if (style || simple) {
                const name = style ? "span" : simple![1]!;
                const open = style ? style[0].length : simple![0].length;
                const close = closingTag(text, index + open, name);
                if (close) {
                    flush();
                    const runs = inline(text.slice(index + open, close.inner), context);
                    for (const run of runs) {
                        if (style) addStyle(run, { color: style[1], size: style[2] ?? style[3] });
                        else addMark(run, TAG_MARKS[name]!);
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
        if (char === "*" || char === "_" || char === "~" || char === "=" || (char === "|" && !context.cell)) {
            let count = 0;
            while (text[index + count] === char) count++;
            // `==marked==` and `||spoiler||` take exactly two signs; one, or three and more, are only text
            if ((char === "~" && count > 2) || ((char === "=" || char === "|") && count !== 2)) {
                buffer += char.repeat(count);
                index += count;
                continue;
            }
            // the whole characters on either side, so that an emoji counts as the symbol it is
            const before = index === 0 ? " " : /[\uDC00-\uDFFF]/.test(text[index - 1]!) && index >= 2 ? text.slice(index - 2, index) : text[index - 1]!;
            const after = index + count >= text.length ? " " : String.fromCodePoint(text.codePointAt(index + count)!);
            const space = (value: string) => /\s/.test(value);
            const punctuation = (value: string) => UNICODE_PUNCTUATION.test(value);
            // `==` and `||` mean nothing in standard Markdown, so they need only touch text on the inside
            const loose = char === "=" || char === "|";
            const left = loose ? !space(after) : !space(after) && (!punctuation(after) || space(before) || punctuation(before));
            const right = loose ? !space(before) : !space(before) && (!punctuation(before) || space(after) || punctuation(after));
            flush();
            tokens.push({
                char,
                count,
                length: count,
                // inside a web address `==` and `||` are part of the address: they may close a mark opened before it, never open one
                open: char === "_" ? left && (!right || punctuation(before)) : loose && left && inAddress(index) ? false : left,
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
function referenceAt(text: string, close: number, context: Context, label?: string): { href: string; title?: string; ref: string; shortcut?: boolean; end: number } | undefined {
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
    return found ? { ...found, ref: "", shortcut: true, end: close + 1 } : undefined;
}

function runsPlain(runs: Leaf[]): string {
    return runs.map((run) => (run.kind === "text" ? run.text : run.kind === "image" ? run.alt : "")).join("");
}

/** CommonMark's emphasis rule: each closing run of `*`, `_` or `~` finds the nearest opening run it can pair with. */
function emphasis(tokens: Token[]) {
    // as in CommonMark's own reader: once a closer of a kind has looked back and found nothing, the
    // closers of that kind after it look no further back than it did, so a long line of signs that
    // never pair is read in time growing with its length, not with its square
    let floors: Map<string, number> | undefined;
    for (let close = 0; close < tokens.length; close++) {
        const closer = tokens[close]!;
        if (!isDelimiter(closer) || !closer.close) continue;
        let matched = true;
        while (closer.count > 0 && matched) {
            matched = false;
            const kind = closer.char === "*" || closer.char === "_" ? `${closer.char}${closer.length % 3}${closer.open ? 1 : 0}` : `${closer.char}${closer.count}`;
            const floor = floors?.get(kind) ?? -1;
            for (let open = close - 1; open > floor; open--) {
                const opener = tokens[open]!;
                if (!isDelimiter(opener) || opener.char !== closer.char || !opener.open || opener.count === 0) continue;
                const paired = closer.char === "~" || closer.char === "=" || closer.char === "|";
                if (paired) {
                    if (opener.count !== closer.count) continue;
                } else if ((opener.close || closer.open) && (opener.length + closer.length) % 3 === 0 && !(opener.length % 3 === 0 && closer.length % 3 === 0)) continue;
                const use = paired ? closer.count : opener.count >= 2 && closer.count >= 2 ? 2 : 1;
                const mark: Mark = closer.char === "=" ? "mark" : closer.char === "|" ? "spoiler" : closer.char === "~" ? "strike" : use === 2 ? "bold" : "italic";
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
            if (!matched) (floors ??= new Map()).set(kind, close - 1);
        }
    }
}
