// The document mdQuire edits: frontmatter kept as text, then a list of blocks, each holding runs of
// text. Every block read from a file remembers its exact source and the blank text after it, so a
// block nobody touched is written back byte for byte. An edit clears the source of the block it
// changes and of the blocks that hold it, and those alone are written fresh.
//
// The editing operations below are pure: each takes a document and returns a new one, sharing every
// block it did not change. A place in the text is a Position: the path to a block, then an offset
// into that block's text.

// ---- runs ----

/**
 * A way text can be marked. Underline is not Markdown and is written as `<u>`; superscript and
 * subscript as `<sup>` and `<sub>`. "mark" is `==highlighted==` text, and "spoiler" is `||hidden||`
 * text, as Discord has it. "math" was inline maths, read from `$...$` before a `$` became a dollar
 * sign as standard Markdown has it; nothing makes it now and no saved file can hold it (every store
 * keeps Markdown, where `$x$` reads as text). It stays in this list only while the export, Word and
 * web page writers still name it; the model drops it as it tidies runs, and the writer writes such
 * text plainly.
 */
export type Mark = "bold" | "italic" | "strike" | "code" | "underline" | "mark" | "sup" | "sub" | "math" | "spoiler";

/** How a paragraph, heading or picture sits across the page. Written as `<div align="...">`; justified is for `.quire` documents alone. */
export type Align = "left" | "center" | "right" | "justify";

/** Text with its marks. Color and size are not Markdown, and are written as a `<span style>`. Font and highlight are kept only by a `.quire` document. */
export interface TextRun {
    kind: "text";
    text: string;
    marks: Mark[];
    color?: string;
    size?: string;
    font?: string;
    highlight?: string;
    /** The writer's own notes on this text, by their ids (comments.ts). Never written into the Markdown. */
    comments?: string[];
}

/** How text looks beyond its marks: what setStyle changes, and what a `.quire` document keeps in its style.json. */
export interface Look {
    color?: string;
    size?: string;
    font?: string;
    highlight?: string;
}

/** The parts of a look, in the order they are kept. */
export const LOOKS = ["color", "size", "font", "highlight"] as const;

/** A picture inside a line of text. */
export interface ImageRun {
    kind: "image";
    src: string;
    alt: string;
    title?: string;
}

/** A hard line break inside a paragraph. */
export interface BreakRun {
    kind: "break";
}

/** A footnote reference, `[^label]`. */
export interface FootnoteRun {
    kind: "footnote";
    label: string;
}

/** Inline HTML, a JSX tag, an `{expression}` or an entity, kept exactly as written. */
export interface HtmlRun {
    kind: "html";
    html: string;
}

/** An emoji written as its shortcode, `:smile:`, and kept as that shortcode. Only names in emoji.ts are read as one. */
export interface EmojiRun {
    kind: "emoji";
    name: string;
}

/** Anything that can sit inside a link. */
export type Leaf = TextRun | ImageRun | BreakRun | FootnoteRun | HtmlRun | EmojiRun;

/**
 * A link around some runs. `ref` is set for a reference link, `[text][ref]`; it is empty for one
 * written `[text][]` or `[text]`, whose `label` is the text the file had in its brackets, which
 * names its definition, and whose `shortcut` says it was written without the empty brackets.
 */
export interface LinkRun {
    kind: "link";
    href: string;
    title?: string;
    ref?: string;
    label?: string;
    shortcut?: boolean;
    runs: Leaf[];
}

/** One piece of a block's inline content. */
export type Run = Leaf | LinkRun;

// ---- blocks ----

/** What every block carries: its exact source if it is untouched, and the text after it up to the next block. */
interface Kept {
    /** Exactly what the file said. Present only while the block is unchanged. */
    source?: string;
    /** The line ending and blank lines after the block. Empty for the last block in a list item or quote. */
    gap: string;
}

/** A heading's level. */
export type Level = 1 | 2 | 3 | 4 | 5 | 6;

/** A paragraph of running text. */
export interface Paragraph extends Kept {
    kind: "paragraph";
    runs: Run[];
    align?: Align;
    /** Line spacing, as a multiple of the usual; kept only by a `.quire` document. */
    spacing?: number;
    /** Small, quiet text, written `-# text` as Discord has it. */
    subtext?: boolean;
    /** A subtitle, larger than the text and quieter: one to a document, under the title. A `.quire` document keeps it in its style.json, a Markdown file as `subtitle:` in its frontmatter (subtitle.ts). */
    subtitle?: boolean;
}

/** A heading, `#` to `######`. */
export interface Heading extends Kept {
    kind: "heading";
    level: Level;
    runs: Run[];
    align?: Align;
    spacing?: number;
}

/** The kinds of list. A task list is a bulleted list whose items have boxes. In a definition list each item is a term (its first block) and its definitions (the rest), written `Term` then `: definition` lines. */
export type ListStyle = "bullet" | "number" | "task" | "definition";

/** One item of a list: the blocks in it, and its box if it has one. */
export interface ListItem {
    blocks: Block[];
    checked?: boolean;
    source?: string;
    gap: string;
}

/** A list. `marker` is the bullet a bulleted list uses; `start` and `delimiter` number a numbered one. */
export interface List extends Kept {
    kind: "list";
    style: ListStyle;
    marker: "-" | "*" | "+";
    delimiter: "." | ")";
    start: number;
    loose: boolean;
    items: ListItem[];
}

/**
 * A quotation, holding blocks. Two other boxes of blocks are quotes too, so that everything that
 * edits a quote edits them: a callout (`> [!NOTE]`, its kind as written in `callout` and any words
 * after the marker in `title`), and a folding section (`<details>` with its `<summary>`).
 */
export interface Quote extends Kept {
    kind: "quote";
    blocks: Block[];
    callout?: string;
    title?: string;
    details?: Details;
}

/** A folding section's summary line, and whether it starts open. */
export interface Details {
    summary: string;
    open: boolean;
}

/** A fenced block of code. A block of display maths written between `$$` lines is one too, its language "math" and `dollars` set. */
export interface Code extends Kept {
    kind: "code";
    language: string;
    code: string;
    dollars?: boolean;
}

/** A table: the heading row, each column's alignment, and the rows. Each cell holds runs. */
export interface Table extends Kept {
    kind: "table";
    header: Run[][];
    align: (Align | null)[];
    rows: Run[][][];
}

/** A picture standing alone as a block. */
export interface Image extends Kept {
    kind: "image";
    src: string;
    alt: string;
    title?: string;
    align?: Align;
    /** How wide it is drawn, as a percentage of the text's width; unset, it is drawn at its own size (pictures.ts says how it is written). */
    width?: number;
    /** Words shown under it. */
    caption?: string;
    /** True when the text flows round it, beside it at the left (its alignment unset) or the right. */
    wrap?: boolean;
}

/** A line across the page, `---`. */
export interface Divider extends Kept {
    kind: "divider";
}

/** A footnote's text, `[^label]: ...`, holding blocks. */
export interface Footnote extends Kept {
    kind: "footnote";
    label: string;
    blocks: Block[];
}

/** Anything not understood (MDX imports and exports, components, expressions, HTML), kept as its text. */
export interface Raw extends Kept {
    kind: "raw";
    text: string;
}

/** Every kind of block. */
export type Block = Paragraph | Heading | List | Quote | Code | Table | Image | Divider | Footnote | Raw;

/** A whole file. `eol` is the line ending fresh text is written with; `mdx` says whether JSX and expressions are read. */
export interface Document {
    bom: string;
    frontmatter: string | null;
    lead: string;
    blocks: Block[];
    eol: "\n" | "\r\n";
    mdx: boolean;
    /** Present when the document is a `.quire` one: what it keeps beyond Markdown that is not on its blocks and runs. */
    quire?: QuireExtras;
    /** The writer's notes, each marked on its text by id (comments.ts). Never written into the Markdown. */
    comments?: Comment[];
    /** Set when the file held reference links, `[text][label]`, so that the writer checks their definitions are still there. */
    references?: boolean;
}

/** A note the writer keeps on some of her text: what it says, and whether it is dealt with. */
export interface Comment {
    id: string;
    text: string;
    resolved?: boolean;
    /** When it was written, in milliseconds. */
    created: number;
    /** The words it was on, kept for when they are gone. */
    quote: string;
}

/** A page's paper, as page setup chooses it. Margins are in millimetres. The header and footer are a line each, repeated on every page, and `numbers` puts the page's number in the footer. */
export interface Page {
    size: "A4" | "Letter" | "A5";
    orientation: "portrait" | "landscape";
    margins: number;
    header?: string;
    footer?: string;
    numbers?: boolean;
}

/** What a `.quire` document holds besides its blocks: page setup, and its notes kept as they were read. */
export interface QuireExtras {
    page: Page;
    notes: unknown;
}

/** A place in the text: the path to a block (through list items, quotes and table cells), then an offset into its text. */
export interface Position {
    path: number[];
    offset: number;
}

/** A stretch of text from one position to another. */
export interface Range {
    start: Position;
    end: Position;
}

/** What is selected: where the selection began, and where the cursor is now. They are the same when nothing is selected. */
export interface Selection {
    anchor: Position;
    focus: Position;
}

// ---- making runs and blocks ----

/** Plain text as runs, with the marks given. */
export function text(value: string, marks: Mark[] = []): Run[] {
    return value ? [{ kind: "text", text: value, marks }] : [];
}

/** A new paragraph. */
export function paragraph(value = ""): Paragraph {
    return { kind: "paragraph", runs: text(value), gap: "" };
}

/** A new heading. */
export function heading(level: Level, value = ""): Heading {
    return { kind: "heading", level, runs: text(value), gap: "" };
}

/** A new block of code. */
export function code(value = "", language = ""): Code {
    return { kind: "code", language, code: value, gap: "" };
}

/** A new divider. */
export function divider(): Divider {
    return { kind: "divider", gap: "" };
}

/** How a page break is written: HTML that print, and most things that show Markdown, take as the end of a page. */
const PAGE_BREAK = '<div style="break-after: page"></div>';

/** A new page break, kept in the Markdown as the HTML that makes one. */
export function pageBreak(): Raw {
    return { kind: "raw", text: PAGE_BREAK, gap: "" };
}

/** True for a block that is a page break, however its HTML is spaced or quoted. */
export function isPageBreak(block: Block | undefined): boolean {
    return block?.kind === "raw" && /^<div\s+style\s*=\s*["']\s*(break-after\s*:\s*page|page-break-after\s*:\s*always)\s*;?\s*["']\s*>\s*<\/div>$/i.test(block.text.trim());
}

/** A new picture block. */
export function image(src: string, alt = ""): Image {
    return { kind: "image", src, alt, gap: "" };
}

/** A new table of plain text cells. */
export function table(header: string[], rows: string[][] = []): Table {
    return { kind: "table", header: header.map((cell) => text(cell)), align: header.map(() => null), rows: rows.map((row) => header.map((_, column) => text(row[column] ?? ""))), gap: "" };
}

/** A new list, one item to each text given. */
export function list(style: ListStyle, items: string[]): List {
    return {
        kind: "list",
        style,
        marker: "-",
        delimiter: ".",
        start: 1,
        loose: false,
        items: items.map((value) => ({ blocks: [paragraph(value)], checked: style === "task" ? false : undefined, gap: "" })),
        gap: "",
    };
}

// ---- runs, flattened for editing ----

/** The link a leaf sits in, if any. */
interface LinkInfo {
    href: string;
    title?: string;
    ref?: string;
    label?: string;
    shortcut?: boolean;
}

/** One leaf with the link around it: runs are edited in this flat form and grouped again after. */
interface Piece {
    leaf: Leaf;
    link?: LinkInfo;
}

const ORDER: Mark[] = ["code", "spoiler", "bold", "italic", "strike", "underline", "mark", "sup", "sub"];

const leafLength = (leaf: Leaf) => (leaf.kind === "text" ? leaf.text.length : 1);

/** How long a run of text is: a picture, a break, a footnote or an HTML span counts as one. */
export function runsLength(runs: Run[]): number {
    return runs.reduce((sum, run) => sum + (run.kind === "link" ? runsLength(run.runs) : leafLength(run)), 0);
}

/** The text of runs as a reader sees it: a break is a newline, other atoms are U+FFFC. */
export function runsText(runs: Run[]): string {
    return runs.map((run) => (run.kind === "link" ? runsText(run.runs) : run.kind === "text" ? run.text : run.kind === "break" ? "\n" : "￼")).join("");
}

function pieces(runs: Run[]): Piece[] {
    return runs.flatMap((run): Piece[] => (run.kind === "link" ? run.runs.map((leaf) => ({ leaf, link: { href: run.href, title: run.title, ref: run.ref, label: run.label, shortcut: run.shortcut } })) : [{ leaf: run }]));
}

const sameLink = (a?: LinkInfo, b?: LinkInfo) => a === b || (!!a && !!b && a.href === b.href && a.title === b.title && a.ref === b.ref && a.label === b.label && a.shortcut === b.shortcut);
const sameMarks = (a: Mark[], b: Mark[]) => a.length === b.length && a.every((mark) => b.includes(mark));
const sameNotes = (a?: string[], b?: string[]) => (a?.length ?? 0) === (b?.length ?? 0) && (!a || a.every((id) => b!.includes(id)));
const sameFormat = (a: TextRun, b: TextRun) => sameMarks(a.marks, b.marks) && LOOKS.every((key) => a[key] === b[key]) && sameNotes(a.comments, b.comments);

/** Pieces back into runs: neighbouring text with the same marks joins, and neighbours in the same link are grouped into one. */
function fromPieces(list: Piece[]): Run[] {
    const merged: Piece[] = [];
    for (const piece of list) {
        if (piece.leaf.kind === "text" && piece.leaf.text === "") continue;
        const last = merged[merged.length - 1];
        if (last && last.leaf.kind === "text" && piece.leaf.kind === "text" && sameLink(last.link, piece.link) && sameFormat(last.leaf, piece.leaf)) {
            merged[merged.length - 1] = { leaf: { ...last.leaf, text: last.leaf.text + piece.leaf.text }, link: last.link };
        } else merged.push(piece);
    }
    const runs: Run[] = [];
    for (const piece of merged) {
        const last = runs[runs.length - 1];
        if (!piece.link) runs.push(piece.leaf);
        else if (last?.kind === "link" && sameLink(last, piece.link)) last.runs.push(piece.leaf);
        else runs.push({ kind: "link", ...piece.link, runs: [piece.leaf] });
    }
    return runs.map((run) => (run.kind === "link" ? tidyLink(run) : run));
}

function tidyLink(run: LinkRun): LinkRun {
    const out: LinkRun = { kind: "link", href: run.href, runs: run.runs };
    if (run.title !== undefined) out.title = run.title;
    if (run.ref !== undefined) out.ref = run.ref;
    if (run.label !== undefined) out.label = run.label;
    if (run.shortcut) out.shortcut = true;
    return out;
}

/** Normalises runs read from a file: marks in one order, text with the same look joined. */
export function tidyRuns(runs: Run[]): Run[] {
    return fromPieces(pieces(runs).map((piece) => (piece.leaf.kind === "text" ? { ...piece, leaf: { ...piece.leaf, marks: ORDER.filter((mark) => (piece.leaf as TextRun).marks.includes(mark)) } } : piece)));
}

function splitPieces(list: Piece[], offset: number): [Piece[], Piece[]] {
    let at = 0;
    for (let index = 0; index < list.length; index++) {
        const piece = list[index]!;
        const length = leafLength(piece.leaf);
        if (offset <= at) return [list.slice(0, index), list.slice(index)];
        if (offset < at + length && piece.leaf.kind === "text") {
            const cut = offset - at;
            const before = { ...piece, leaf: { ...piece.leaf, text: piece.leaf.text.slice(0, cut) } };
            const after = { ...piece, leaf: { ...piece.leaf, text: piece.leaf.text.slice(cut) } };
            return [[...list.slice(0, index), before], [after, ...list.slice(index + 1)]];
        }
        at += length;
    }
    return [list, []];
}

function insertRuns(runs: Run[], offset: number, value: string | Leaf, marks?: Mark[]): Run[] {
    const [before, after] = splitPieces(pieces(runs), offset);
    const last = before[before.length - 1];
    const next = after[0];
    // typed text takes the look of the character before it, and stays in a link only when inside one
    const model = [...before].reverse().find((piece) => piece.leaf.kind === "text")?.leaf ?? next?.leaf;
    const look = model?.kind === "text" ? model : undefined;
    const link = last?.link && sameLink(last.link, next?.link) ? last.link : undefined;
    if (typeof value !== "string") return fromPieces([...before, { leaf: value, link }, ...after]);
    const leaf: TextRun = { kind: "text", text: value, marks: marks ? ORDER.filter((mark) => marks.includes(mark)) : look ? ORDER.filter((mark) => look.marks.includes(mark)) : [] };
    for (const key of LOOKS) if (look?.[key]) leaf[key] = look[key];
    // text typed inside a note's words joins them; typed at either end it stays outside
    const left = last?.leaf.kind === "text" ? last.leaf.comments : undefined;
    const right = next?.leaf.kind === "text" ? next.leaf.comments : undefined;
    const inside = left?.filter((id) => right?.includes(id));
    if (inside?.length) leaf.comments = inside;
    return fromPieces([...before, { leaf, link }, ...after]);
}

function deleteRuns(runs: Run[], from: number, to: number): Run[] {
    const [before, rest] = splitPieces(pieces(runs), from);
    const [, after] = splitPieces(rest, to - from);
    return fromPieces([...before, ...after]);
}

/** The runs between two offsets. */
export function sliceRuns(runs: Run[], from: number, to = Infinity): Run[] {
    const [, rest] = splitPieces(pieces(runs), from);
    const [middle] = splitPieces(rest, to - from);
    return fromPieces(middle);
}

function mapRuns(runs: Run[], from: number, to: number, change: (piece: Piece) => Piece): Run[] {
    const [before, rest] = splitPieces(pieces(runs), from);
    const [middle, after] = splitPieces(rest, to - from);
    return fromPieces([...before, ...middle.map(change), ...after]);
}

/** Blocks with what only a `.quire` document keeps taken off them (font, highlight, line spacing, justified), as they go into a Markdown file. */
export function markdownOnly(blocks: Block[]): Block[] {
    const plain = (runs: Run[]) => restyleRuns(runs, 0, Infinity, { font: null, highlight: null });
    return blocks.map((block): Block => {
        switch (block.kind) {
            case "paragraph":
            case "heading": {
                const { spacing: _spacing, ...rest } = block;
                const next = { ...rest, runs: plain(block.runs) };
                if (next.kind === "paragraph") delete next.subtitle;
                if (next.align === "justify") delete next.align;
                return next;
            }
            case "image":
                return block.align === "justify" ? { ...block, align: undefined } : block;
            case "table":
                return { ...block, header: block.header.map(plain), rows: block.rows.map((row) => row.map(plain)) };
            case "list":
                return { ...block, items: block.items.map((item) => ({ ...item, blocks: markdownOnly(item.blocks) })) };
            case "quote":
            case "footnote":
                return { ...block, blocks: markdownOnly(block.blocks) };
            default:
                return block;
        }
    });
}

/** Gives the text between two offsets a look, or takes parts of one away with null. Values cannot hold quotes or semicolons. */
export function restyleRuns(runs: Run[], from: number, to: number, look: { [key in keyof Look]?: string | null }): Run[] {
    const clean = (value: string) => value.replace(/["';<>]/g, "").trim();
    return mapRuns(runs, from, to, (piece) => {
        if (piece.leaf.kind !== "text") return piece;
        const leaf: TextRun = { ...piece.leaf };
        for (const key of LOOKS) {
            const value = look[key];
            if (value === undefined) continue;
            if (value === null || clean(value) === "") delete leaf[key];
            else leaf[key] = clean(value);
        }
        return { ...piece, leaf };
    });
}

function middlePieces(runs: Run[], from: number, to: number): Piece[] {
    const [, rest] = splitPieces(pieces(runs), from);
    return splitPieces(rest, to - from)[0];
}

// ---- finding blocks ----

/** The block at a path, or undefined if there is none (a table cell is not a block). */
export function blockAt(doc: Document, path: number[]): Block | undefined {
    let blocks = doc.blocks;
    for (let depth = 0; depth < path.length; ) {
        const block = blocks[path[depth]!];
        if (!block || depth === path.length - 1) return block;
        if (block.kind === "list") {
            const item = block.items[path[depth + 1]!];
            if (!item || depth + 2 >= path.length) return undefined;
            blocks = item.blocks;
            depth += 2;
        } else if (block.kind === "quote" || block.kind === "footnote") {
            blocks = block.blocks;
            depth += 1;
        } else return undefined;
    }
    return undefined;
}

function cellAt(doc: Document, path: number[]): Run[] | undefined {
    if (path.length < 3) return undefined;
    const block = blockAt(doc, path.slice(0, -2));
    if (block?.kind !== "table") return undefined;
    const row = path[path.length - 2]!;
    return (row === 0 ? block.header : block.rows[row - 1])?.[path[path.length - 1]!];
}

/** The plain text at a path: a paragraph's, a heading's, a cell's, a code block's or a raw block's. */
export function textAt(doc: Document, path: number[]): string {
    const block = blockAt(doc, path);
    if (block?.kind === "paragraph" || block?.kind === "heading") return runsText(block.runs);
    if (block?.kind === "code") return block.code;
    if (block?.kind === "raw") return block.text;
    const cell = cellAt(doc, path);
    return cell ? runsText(cell) : "";
}

const lengthAt = (doc: Document, path: number[]) => {
    const block = blockAt(doc, path);
    if (block?.kind === "paragraph" || block?.kind === "heading") return runsLength(block.runs);
    return textAt(doc, path).length;
};

/** The path of every block that holds no other blocks, in reading order. */
function leafPaths(blocks: Block[], prefix: number[] = []): number[][] {
    return blocks.flatMap((block, index): number[][] => {
        const path = [...prefix, index];
        if (block.kind === "list") return block.items.flatMap((item, k) => leafPaths(item.blocks, [...path, k]));
        if (block.kind === "quote" || block.kind === "footnote") return leafPaths(block.blocks, path);
        return [path];
    });
}

const samePath = (a: number[], b: number[]) => a.length === b.length && a.every((step, index) => step === b[index]);

function comparePaths(a: number[], b: number[]): number {
    for (let index = 0; index < Math.min(a.length, b.length); index++) if (a[index] !== b[index]) return a[index]! - b[index]!;
    return a.length - b.length;
}

/** The list item a path points into: the deepest list on the path, and which of its items. */
function itemOf(doc: Document, path: number[]): { list: number[]; item: number } | undefined {
    let found: { list: number[]; item: number } | undefined;
    let blocks = doc.blocks;
    for (let depth = 0; depth < path.length; ) {
        const block = blocks[path[depth]!];
        if (!block) break;
        if (block.kind === "list" && depth + 1 < path.length) {
            const item = block.items[path[depth + 1]!];
            if (!item) break;
            found = { list: path.slice(0, depth + 1), item: path[depth + 1]! };
            blocks = item.blocks;
            depth += 2;
        } else if (block.kind === "quote" || block.kind === "footnote") {
            blocks = block.blocks;
            depth += 1;
        } else break;
    }
    return found;
}

/** What directly holds the block at a path. */
function parentOf(doc: Document, path: number[]): { kind: "top" } | { kind: "item"; list: number[]; item: number } | { kind: "quote" | "footnote"; path: number[] } {
    if (path.length === 1) return { kind: "top" };
    const item = itemOf(doc, path);
    if (item && item.list.length + 2 === path.length) return { kind: "item", ...item };
    const holder = blockAt(doc, path.slice(0, -1));
    if (holder?.kind === "quote" || holder?.kind === "footnote") return { kind: holder.kind, path: path.slice(0, -1) };
    return { kind: "top" };
}

// ---- changing blocks ----

type Siblings = (blocks: Block[], index: number, sep: string) => Block[];

/** Replaces blocks in a list, keeping the text at the end of the region at the end. */
function spliceBlocks<T extends { gap: string }>(list: T[], index: number, count: number, added: T[]): T[] {
    const out = [...list.slice(0, index), ...added, ...list.slice(index + count)];
    // the last block holds the file's final newline, or nothing at the end of a container: it moves to the new last one
    if (index + count === list.length && count > 0) {
        const tail = list[list.length - 1]!.gap;
        const last = out.length - 1;
        if (last >= 0 && added.length === 0) out[last] = { ...out[last]!, gap: tail };
    }
    return out;
}

/** Calls `change` on the array holding the block at a path, then rebuilds every holder above it with its source cleared. */
function editIn(blocks: Block[], path: number[], sep: string, eol: string, change: Siblings): Block[] {
    if (path.length === 1) return change(blocks, path[0]!, sep);
    const index = path[0]!;
    const block = blocks[index];
    if (!block) return blocks;
    let next: Block | null;
    if (block.kind === "list" && path.length >= 3) {
        const item = block.items[path[1]!];
        if (!item) return blocks;
        const inner = editIn(item.blocks, path.slice(2), block.loose ? eol + eol : eol, eol, change);
        if (inner === item.blocks) return blocks;
        const items = inner.length === 0 ? spliceBlocks(block.items, path[1]!, 1, []) : block.items.map((each, k) => (k === path[1] ? { ...item, blocks: inner, source: undefined } : each));
        next = items.length ? { ...block, items, source: undefined } : null;
    } else if (block.kind === "quote" || block.kind === "footnote") {
        const inner = editIn(block.blocks, path.slice(1), eol + eol, eol, change);
        if (inner === block.blocks) return blocks;
        next = inner.length ? { ...block, blocks: inner, source: undefined } : null;
    } else return blocks;
    return next ? blocks.map((each, k) => (k === index ? next : each)) : spliceBlocks(blocks, index, 1, []);
}

function edit(doc: Document, path: number[], change: Siblings): Document {
    if (path.length === 0) return doc;
    const blocks = editIn(doc.blocks, path, doc.eol + doc.eol, doc.eol, change);
    if (blocks === doc.blocks) return doc;
    // a document always has a line to write on: taking its last block away leaves an empty paragraph
    if (blocks.length === 0) return { ...doc, blocks: [{ ...paragraph(), gap: doc.blocks[doc.blocks.length - 1]?.gap ?? "" }] };
    return { ...doc, blocks };
}

/** Replaces the block at a path with the blocks `change` gives (none removes it). */
function replace(doc: Document, path: number[], change: (block: Block, sep: string) => Block[] | null): Document {
    return edit(doc, path, (blocks, index, sep) => {
        const block = blocks[index];
        const added = block && change(block, sep);
        return added ? spliceBlocks(blocks, index, 1, added) : blocks;
    });
}

/** Changes the items of the list at a path. */
function editItems(doc: Document, path: number[], change: (items: ListItem[], sep: string, list: List) => ListItem[] | null): Document {
    return replace(doc, path, (block) => {
        if (block.kind !== "list") return null;
        const items = change(block.items, block.loose ? doc.eol + doc.eol : doc.eol, block);
        if (!items) return null;
        return items.length ? [{ ...block, items, source: undefined }] : [];
    });
}

/** Removes the block at a path, and any list item, list or quote it leaves empty. */
function removeAt(doc: Document, path: number[]): Document {
    return edit(doc, path, (blocks, index) => spliceBlocks(blocks, index, 1, []));
}

/** Runs with each line break made a space: a heading is one line in Markdown, and cannot keep a break. */
function unbroken(runs: Run[]): Run[] {
    if (!pieces(runs).some((piece) => piece.leaf.kind === "break")) return runs;
    return fromPieces(pieces(runs).map((piece) => (piece.leaf.kind === "break" ? { ...piece, leaf: { kind: "text", text: " ", marks: [] } } : piece)));
}

/** Changes the runs at a path, in a paragraph, a heading or a table cell. */
function editRuns(doc: Document, path: number[], change: (runs: Run[]) => Run[]): Document {
    const block = blockAt(doc, path);
    if (block?.kind === "paragraph") return replace(doc, path, () => [{ ...block, runs: change(block.runs), source: undefined }]);
    if (block?.kind === "heading") return replace(doc, path, () => [{ ...block, runs: unbroken(change(block.runs)), source: undefined }]);
    const cell = cellAt(doc, path);
    if (!cell) return doc;
    const row = path[path.length - 2]!;
    const column = path[path.length - 1]!;
    return replace(doc, path.slice(0, -2), (found) => {
        if (found.kind !== "table") return null;
        // a cell cannot keep a spoiler: its pipes would be the cell's edges (write.ts), so none is made there
        const plain = (runs: Run[]) => mapRuns(runs, 0, Infinity, (piece) => (piece.leaf.kind === "text" && piece.leaf.marks.includes("spoiler") ? { ...piece, leaf: { ...piece.leaf, marks: piece.leaf.marks.filter((mark) => mark !== "spoiler") } } : piece));
        const swap = (cells: Run[][]) => cells.map((each, k) => (k === column ? plain(change(each)) : each));
        return [{ ...found, header: row === 0 ? swap(found.header) : found.header, rows: found.rows.map((each, k) => (k === row - 1 ? swap(each) : each)), source: undefined }];
    });
}

function editString(doc: Document, path: number[], change: (value: string) => string): Document {
    const block = blockAt(doc, path);
    if (block?.kind === "code") return replace(doc, path, () => [{ ...block, code: change(block.code), source: undefined }]);
    if (block?.kind === "raw") return replace(doc, path, () => [{ ...block, text: change(block.text), source: undefined }]);
    return doc;
}

// ---- editing text ----

/** Types text at a position. Inside a paragraph a newline is a soft line break. `marks`, if given, are the marks the text gets instead of those of the character before it. */
export function insertText(doc: Document, at: Position, value: string, marks?: Mark[]): Document {
    if (value === "") return doc;
    const block = blockAt(doc, at.path);
    if (block?.kind === "code" || block?.kind === "raw") return editString(doc, at.path, (old) => old.slice(0, at.offset) + value + old.slice(at.offset));
    return editRuns(doc, at.path, (runs) => insertRuns(runs, at.offset, value, marks));
}

/** Puts a hard line break, or a picture, footnote or other atom, at a position in a paragraph, heading or cell. */
export function insertAtom(doc: Document, at: Position, leaf: Leaf): Document {
    return editRuns(doc, at.path, (runs) => insertRuns(runs, at.offset, leaf));
}

/** Puts runs (pasted text with its marks and links) at a position in a paragraph, heading or cell. */
export function insertRunsAt(doc: Document, at: Position, runs: Run[]): Document {
    return editRuns(doc, at.path, (old) => {
        const [before, after] = splitPieces(pieces(old), at.offset);
        return fromPieces([...before, ...pieces(runs), ...after]);
    });
}

/** A new document of the given blocks, with no frontmatter, a blank line between blocks and a newline at the end. */
export function documentOf(blocks: Block[], options: { eol?: "\n" | "\r\n"; mdx?: boolean } = {}): Document {
    const eol = options.eol ?? "\n";
    return { bom: "", frontmatter: null, lead: "", blocks: blocks.map((block, index) => ({ ...block, gap: index === blocks.length - 1 ? eol : eol + eol })), eol, mdx: !!options.mdx };
}

/** Removes the block at a path, and any list item, list or quote it leaves empty. */
export function removeBlock(doc: Document, path: number[]): Document {
    return removeAt(doc, path);
}

/** The path of every block that holds no other blocks (paragraphs, headings, code, tables and so on), in reading order. */
export function blockPaths(doc: Document): number[][] {
    return leafPaths(doc.blocks);
}

/** How long the text at a path is. */
export function lengthOf(doc: Document, path: number[]): number {
    return lengthAt(doc, path);
}

/** Compares two positions in reading order: negative if `a` comes first. */
export function comparePositions(a: Position, b: Position): number {
    return comparePaths(a.path, b.path) || a.offset - b.offset;
}

/** Puts a range's two ends in reading order. */
export function ordered(range: Range): Range {
    const order = comparePaths(range.start.path, range.end.path);
    return order > 0 || (order === 0 && range.start.offset > range.end.offset) ? { start: range.end, end: range.start } : range;
}

/** Deletes the text in a range. A range across blocks removes the blocks between and joins its two ends into one. */
export function deleteText(doc: Document, range: Range): Document {
    const { start, end } = ordered(range);
    const cut = (path: number[], from: number, to: number) => {
        const block = blockAt(doc, path);
        if (block?.kind === "code" || block?.kind === "raw") return editString(doc, path, (old) => old.slice(0, from) + old.slice(to));
        return editRuns(doc, path, (runs) => deleteRuns(runs, from, to));
    };
    if (samePath(start.path, end.path)) return start.offset === end.offset ? doc : cut(start.path, start.offset, end.offset);
    const all = leafPaths(doc.blocks);
    const first = all.findIndex((path) => samePath(path, start.path));
    const last = all.findIndex((path) => samePath(path, end.path));
    if (first < 0 || last < 0) return doc;
    doc = cut(end.path, 0, end.offset);
    doc = cut(start.path, start.offset, lengthAt(doc, start.path));
    doc = joinOnto(doc, start.path, end.path);
    for (let index = last - 1; index > first; index--) doc = removeAt(doc, all[index]!);
    return doc;
}

/** Moves the text of the block at `from` onto the end of the block at `onto`, and removes `from`. */
function joinOnto(doc: Document, onto: number[], from: number[]): Document {
    const target = blockAt(doc, onto);
    const source = blockAt(doc, from);
    if (!target || !source) return doc;
    const textual = (block: Block) => block.kind === "paragraph" || block.kind === "heading";
    if (textual(target) && textual(source)) {
        const runs = (source as Paragraph).runs;
        doc = removeAt(doc, from);
        return editRuns(doc, onto, (old) => fromPieces([...pieces(old), ...pieces(runs)]));
    }
    if (target.kind === "code" && source.kind === "code") {
        doc = removeAt(doc, from);
        return editString(doc, onto, (old) => `${old}\n${source.code}`);
    }
    return doc;
}

/** Splits a block in two at a position, as the Enter key does. In a list item it makes a new item; on an empty item it leaves the list. */
export function splitBlock(doc: Document, at: Position): Document {
    const block = blockAt(doc, at.path);
    if (!block) return doc;
    if (block.kind === "code" || block.kind === "raw") return insertText(doc, at, "\n");
    if (block.kind !== "paragraph" && block.kind !== "heading") return doc;
    const length = runsLength(block.runs);
    const first: Block = { ...block, runs: sliceRuns(block.runs, 0, at.offset), source: undefined };
    const rest = sliceRuns(block.runs, at.offset);
    const second: Block = block.kind === "heading" && at.offset < length ? { ...block, runs: rest, source: undefined } : { kind: "paragraph", runs: rest, gap: block.gap };
    const parent = parentOf(doc, at.path);
    // in a definition list the new line is another definition of the same term
    if (parent.kind === "item" && (blockAt(doc, parent.list) as List).style !== "definition") {
        const index = at.path[at.path.length - 1]!;
        const container = blockAt(doc, parent.list) as List;
        const item = container.items[parent.item]!;
        if (length === 0 && item.blocks.length === 1) return outdent(doc, at.path);
        return editItems(doc, parent.list, (items, sep) => {
            const before: ListItem = { ...item, blocks: [...item.blocks.slice(0, index), { ...first, gap: "" }], source: undefined, gap: sep };
            const after: ListItem = { blocks: [{ ...second, gap: item.blocks.length - 1 === index ? "" : second.gap }, ...item.blocks.slice(index + 1)], gap: item.gap };
            if (item.checked !== undefined) after.checked = false;
            return spliceBlocks(items, parent.item, 1, [before, after]);
        });
    }
    return replace(doc, at.path, (_, sep) => [{ ...first, gap: sep }, { ...second, gap: block.gap }]);
}

/** Joins the block at a path onto the text block before it in reading order, as Backspace at the start of a block does. */
export function joinBlock(doc: Document, path: number[]): Document {
    const all = leafPaths(doc.blocks);
    const index = all.findIndex((each) => samePath(each, path));
    if (index <= 0) return doc;
    const parent = parentOf(doc, path);
    // the first block of a later list item: the rest of the item's blocks move into the item before it
    if (parent.kind === "item" && path[path.length - 1] === 0 && parent.item > 0) {
        const container = blockAt(doc, parent.list) as List;
        const item = container.items[parent.item]!;
        const previous = container.items[parent.item - 1]!;
        const tail = previous.blocks[previous.blocks.length - 1];
        const head = item.blocks[0]!;
        const textual = (block?: Block) => block?.kind === "paragraph" || block?.kind === "heading";
        return editItems(doc, parent.list, (items, sep) => {
            let blocks: Block[];
            if (textual(tail) && textual(head)) {
                const joined = { ...(tail as Paragraph), runs: fromPieces([...pieces((tail as Paragraph).runs), ...pieces((head as Paragraph).runs)]), source: undefined, gap: item.blocks.length > 1 ? head.gap : "" };
                blocks = [...previous.blocks.slice(0, -1), joined, ...item.blocks.slice(1)];
            } else if (!tail) blocks = item.blocks;
            else blocks = [...previous.blocks.slice(0, -1), { ...tail, gap: container.loose ? doc.eol + doc.eol : sep }, ...item.blocks];
            return spliceBlocks(items, parent.item - 1, 2, [{ ...previous, blocks, source: undefined, gap: item.gap }]);
        });
    }
    return joinOnto(doc, all[index - 1]!, path);
}

/** The text blocks a range covers, each with the part of its text inside the range. */
function covered(doc: Document, range: Range): { path: number[]; from: number; to: number }[] {
    const { start, end } = ordered(range);
    if (samePath(start.path, end.path)) return [{ path: start.path, from: start.offset, to: end.offset }];
    const all = leafPaths(doc.blocks);
    const first = all.findIndex((path) => samePath(path, start.path));
    const last = all.findIndex((path) => samePath(path, end.path));
    if (first < 0 || last < 0) return [];
    return all.slice(first, last + 1).map((path, index) => ({ path, from: index === 0 ? start.offset : 0, to: first + index === last ? end.offset : lengthAt(doc, path) }));
}

function runsAt(doc: Document, path: number[]): Run[] | undefined {
    const block = blockAt(doc, path);
    if (block?.kind === "paragraph" || block?.kind === "heading") return block.runs;
    return cellAt(doc, path);
}

/** Turns a mark on over a range, or off if every character in it already has it. `force` turns it on or off regardless. */
export function toggleMark(doc: Document, range: Range, mark: Mark, force?: boolean): Document {
    // a table cell cannot keep a spoiler (write.ts), so none is made there
    const parts = covered(doc, range).filter((part) => runsAt(doc, part.path) && part.to > part.from && !(mark === "spoiler" && cellAt(doc, part.path)));
    const texts = parts.flatMap((part) => middlePieces(runsAt(doc, part.path)!, part.from, part.to)).filter((piece) => piece.leaf.kind === "text");
    if (texts.length === 0) return doc;
    const on = force ?? !texts.every((piece) => (piece.leaf as TextRun).marks.includes(mark));
    for (const part of parts) {
        doc = editRuns(doc, part.path, (runs) =>
            mapRuns(runs, part.from, part.to, (piece) => {
                if (piece.leaf.kind !== "text") return piece;
                const marks = on ? ORDER.filter((each) => each === mark || (piece.leaf as TextRun).marks.includes(each)) : piece.leaf.marks.filter((each) => each !== mark);
                return { ...piece, leaf: { ...piece.leaf, marks } };
            }),
        );
    }
    return doc;
}

/** Changes the characters of the text in a range, piece by piece, keeping every mark, link, look and note on them. `change` is given each piece's text, where it starts in its block's text, and the part of that block the range covers. */
export function changeText(doc: Document, range: Range, change: (text: string, at: number, part: { path: number[]; from: number; to: number }) => string): Document {
    for (const part of covered(doc, range)) {
        if (!runsAt(doc, part.path) || part.to <= part.from) continue;
        let at = part.from;
        doc = editRuns(doc, part.path, (runs) =>
            mapRuns(runs, part.from, part.to, (piece) => {
                const from = at;
                at += leafLength(piece.leaf);
                return piece.leaf.kind === "text" ? { ...piece, leaf: { ...piece.leaf, text: change(piece.leaf.text, from, part) } } : piece;
            }),
        );
    }
    return doc;
}

/** Sets or clears (with null) the color, size, font or highlight of the text in a range. Values cannot hold quotes or semicolons. */
export function setStyle(doc: Document, range: Range, style: { [key in keyof Look]?: string | null }): Document {
    for (const part of covered(doc, range)) {
        if (!runsAt(doc, part.path) || part.to <= part.from) continue;
        doc = editRuns(doc, part.path, (runs) => restyleRuns(runs, part.from, part.to, style));
    }
    return doc;
}

/** Makes the text in a range a link, or takes the link off with null. */
export function setLink(doc: Document, range: Range, href: string | null, title?: string): Document {
    for (const part of covered(doc, range)) {
        if (!runsAt(doc, part.path) || part.to <= part.from) continue;
        const link: LinkInfo | undefined = href === null ? undefined : title === undefined ? { href } : { href, title };
        doc = editRuns(doc, part.path, (runs) => mapRuns(runs, part.from, part.to, (piece) => ({ leaf: piece.leaf, link })));
    }
    return doc;
}


/** Sets the text of a raw block, as a component's card does when one of its fields is changed. */
export function setRaw(doc: Document, path: number[], value: string): Document {
    return replace(doc, path, (block) => (block.kind === "raw" && block.text !== value ? [{ ...block, text: value, source: undefined }] : null));
}

/** Changes what kind of box a quote is: a callout's kind and title, or a folding section's summary and whether it starts open. Undefined leaves a part as it is, null takes it away. */
export function setBox(doc: Document, path: number[], change: { callout?: string | null; title?: string | null; details?: Details | null }): Document {
    return replace(doc, path, (block) => {
        if (block.kind !== "quote") return null;
        const next: Quote = { ...block, source: undefined };
        for (const key of ["callout", "title", "details"] as const) {
            const value = change[key];
            if (value === null) delete next[key];
            else if (value !== undefined) (next as unknown as Record<string, unknown>)[key] = value;
        }
        return [next];
    });
}

/** Makes the block at a path a box of blocks: a callout of a kind ("NOTE", "TIP" and so on) or a folding section. The first block of a plain quote makes the quote a callout, as `> [!NOTE]` does; anything else is put inside a box of its own. */
export function makeBox(doc: Document, path: number[], box: { callout: string } | { details: Details }): Document {
    const block = blockAt(doc, path);
    if (!block) return doc;
    const parent = parentOf(doc, path);
    const holder = parent.kind === "quote" ? blockAt(doc, parent.path) : undefined;
    if (parent.kind === "quote" && "callout" in box && holder?.kind === "quote" && !holder.callout && !holder.details && path[path.length - 1] === 0) return setBox(doc, parent.path, { callout: box.callout });
    return replace(doc, path, (found) => [{ kind: "quote", blocks: [{ ...found, gap: "" }], ...box, gap: found.gap }]);
}

/** Turns the empty definition at a path into the term of a new item after its own, as Enter on an empty definition does. */
export function definitionToTerm(doc: Document, path: number[]): Document {
    const found = itemOf(doc, path);
    if (!found || found.list.length + 2 !== path.length) return doc;
    const index = path[path.length - 1]!;
    return editItems(doc, found.list, (items, sep) => {
        const item = items[found.item]!;
        const kept = item.blocks.filter((_, k) => k !== index);
        const before: ListItem = { ...item, blocks: kept.map((block, k) => ({ ...block, gap: k === kept.length - 1 ? "" : block.gap || doc.eol })), source: undefined, gap: sep };
        return spliceBlocks(items, found.item, 1, [before, { blocks: [paragraph()], gap: item.gap }]);
    });
}

/** Makes the paragraph at a path a definition of the paragraph before it, which becomes its term; after a definition list, it joins that list's last term. */
export function makeDefinition(doc: Document, path: number[]): Document {
    const block = blockAt(doc, path);
    if (block?.kind !== "paragraph") return doc;
    return edit(doc, path, (blocks, index) => {
        const before = blocks[index - 1];
        const detail: Paragraph = { ...block, source: undefined, gap: "" };
        if (before?.kind === "list" && before.style === "definition") {
            const last = before.items[before.items.length - 1]!;
            const items = [...before.items.slice(0, -1), { ...last, blocks: [...last.blocks.map((each) => ({ ...each, gap: each.gap || doc.eol })), detail], source: undefined }];
            return spliceBlocks(blocks, index - 1, 2, [{ ...before, items, source: undefined, gap: block.gap }]);
        }
        if (before?.kind !== "paragraph") return blocks;
        const term: Paragraph = { ...before, source: undefined, gap: doc.eol };
        const made: List = { ...list("definition", []), items: [{ blocks: [term, detail], gap: "" }], gap: block.gap };
        return spliceBlocks(blocks, index - 1, 2, [made]);
    });
}

/** Changes a picture block's alt text, width or caption; a width or caption of undefined takes it away. */
export function setImage(doc: Document, path: number[], change: { alt?: string; width?: number | undefined; caption?: string | undefined; wrap?: boolean; src?: string }): Document {
    return replace(doc, path, (block) => {
        if (block.kind !== "image") return null;
        const next: Image = { ...block, source: undefined };
        if (change.alt !== undefined) next.alt = change.alt;
        if (change.src !== undefined) next.src = change.src;
        // text flows round a picture at the left or the right; one in the centre is moved to the left for it
        if (change.wrap) {
            next.wrap = true;
            if (next.align !== "right") delete next.align;
        } else if (change.wrap === false) delete next.wrap;
        if ("width" in change) {
            if (change.width === undefined) delete next.width;
            else next.width = change.width;
        }
        if ("caption" in change) {
            if (!change.caption) delete next.caption;
            else next.caption = change.caption;
        }
        const same = next.alt === block.alt && next.width === block.width && next.caption === block.caption && next.wrap === block.wrap && next.src === block.src && next.align === block.align;
        return same ? null : [next];
    });
}

/** Sets how a paragraph, heading or picture sits across the page; null puts it back to the usual left. */
export function setAlign(doc: Document, path: number[], align: Align | null): Document {
    return replace(doc, path, (block) => {
        if (block.kind !== "paragraph" && block.kind !== "heading" && block.kind !== "image") return null;
        const next = { ...block, source: undefined };
        if (align) next.align = align;
        else delete next.align;
        // text flows round a picture only at the left or the right
        if (next.kind === "image" && (align === "center" || align === "justify")) delete next.wrap;
        return [next];
    });
}

/** Sets a paragraph's or heading's line spacing, as a multiple of the usual; null or 1 puts back the usual. Kept only by a `.quire` document. */
export function setSpacing(doc: Document, path: number[], spacing: number | null): Document {
    return replace(doc, path, (block) => {
        if (block.kind !== "paragraph" && block.kind !== "heading") return null;
        if ((block.spacing ?? null) === (spacing === 1 ? null : spacing)) return null;
        const next = { ...block, source: undefined };
        if (spacing && spacing !== 1) next.spacing = spacing;
        else delete next.spacing;
        return [next];
    });
}

// ---- changing what a block is ----

/** What a block can be turned into. */
export type Kind = { kind: "paragraph" } | { kind: "heading"; level: Level } | { kind: "list"; style: ListStyle } | { kind: "quote" } | { kind: "code"; language?: string; dollars?: boolean };

function runsOf(block: Block): Run[] | undefined {
    if (block.kind === "paragraph" || block.kind === "heading") return block.runs;
    if (block.kind === "code") return text(block.code);
    if (block.kind === "raw") return text(block.text);
    return undefined;
}

/** Turns a block into another kind. A paragraph in a list or quote turned into a paragraph leaves the list or quote. */
export function changeKind(doc: Document, path: number[], to: Kind): Document {
    const block = blockAt(doc, path);
    if (!block) return doc;
    const parent = parentOf(doc, path);
    const runs = runsOf(block);
    // a definition list holds a line of text for each term and definition, and nothing else
    if (parent.kind === "item" && (blockAt(doc, parent.list) as List).style === "definition" && to.kind !== "paragraph") return doc;

    if (to.kind === "paragraph" || to.kind === "heading") {
        if (to.kind === "paragraph" && block.kind === "paragraph") {
            if (parent.kind === "item") return liftItem(doc, parent.list, parent.item);
            if (parent.kind === "quote") return liftFromQuote(doc, path);
            return doc;
        }
        if (!runs) return doc;
        if (to.kind === "heading" && block.kind === "heading" && block.level === to.level) return doc;
        const next: Paragraph | Heading = to.kind === "heading" ? { kind: "heading", level: to.level, runs: unbroken(runs), gap: block.gap } : { kind: "paragraph", runs, gap: block.gap };
        if ((block.kind === "paragraph" || block.kind === "heading") && block.align) next.align = block.align;
        return replace(doc, path, () => [next]);
    }
    if (to.kind === "code") {
        if (block.kind === "code") return to.language === undefined || to.language === block.language ? doc : replace(doc, path, () => [{ ...block, language: to.language!, source: undefined }]);
        if (!runs) return doc;
        return replace(doc, path, () => [{ kind: "code", language: to.language ?? "", code: runsText(runs), ...(to.dollars ? { dollars: true } : {}), gap: block.gap }]);
    }
    if (to.kind === "list") {
        // the first block of an item changes the whole list
        if (parent.kind === "item" && path[path.length - 1] === 0) {
            const owner = blockAt(doc, parent.list) as List;
            return owner.style === to.style ? doc : restyle(doc, parent.list, to.style);
        }
        if (block.kind === "list") return block.style === to.style ? doc : restyle(doc, path, to.style);
        const item: ListItem = { blocks: [{ ...block, gap: "" }], gap: "" };
        if (to.style === "task") item.checked = false;
        return edit(doc, path, (blocks, index) => {
            const before = blocks[index - 1];
            if (before?.kind === "list" && before.style === to.style) {
                const itemSep = before.loose ? doc.eol + doc.eol : doc.eol;
                const items = [...before.items.slice(0, -1), { ...before.items[before.items.length - 1]!, gap: itemSep }, item];
                return spliceBlocks(blocks, index - 1, 2, [{ ...before, items, source: undefined, gap: block.gap }]);
            }
            return spliceBlocks(blocks, index, 1, [{ ...list(to.style, []), items: [item], gap: block.gap }]);
        });
    }
    // a quote
    if (parent.kind === "quote") return doc;
    return edit(doc, path, (blocks, index, sep) => {
        const before = blocks[index - 1];
        // a callout or folding section before is a box of its own, which a plain quote does not join
        if (before?.kind === "quote" && !before.callout && !before.details) {
            const inner = [...before.blocks.slice(0, -1), { ...before.blocks[before.blocks.length - 1]!, gap: sep }, { ...block, gap: "" }];
            return spliceBlocks(blocks, index - 1, 2, [{ ...before, blocks: inner, source: undefined, gap: block.gap }]);
        }
        return spliceBlocks(blocks, index, 1, [{ kind: "quote", blocks: [{ ...block, gap: "" }], gap: block.gap }]);
    });
}

function restyle(doc: Document, path: number[], style: ListStyle): Document {
    return replace(doc, path, (block) => {
        if (block.kind !== "list") return null;
        const items = block.items.map((item) => {
            const next: ListItem = { ...item, source: undefined };
            if (style === "task") next.checked = item.checked ?? false;
            else delete next.checked;
            return next;
        });
        return [{ ...block, style, items, source: undefined }];
    });
}

/** Ends a block list with the given gap, filling empty gaps between with the separator. */
function chain(blocks: Block[], sep: string, last: string): Block[] {
    return blocks.map((block, index) => ({ ...block, gap: index === blocks.length - 1 ? last : block.gap || sep }));
}

/** Takes one item out of its list: the list is split around it, and the item's blocks stand where it was. */
function liftItem(doc: Document, path: number[], index: number): Document {
    return replace(doc, path, (block, sep) => {
        if (block.kind !== "list") return null;
        const item = block.items[index]!;
        const before = block.items.slice(0, index);
        const after = block.items.slice(index + 1);
        const out: Block[] = [];
        if (before.length) out.push({ ...block, items: [...before.slice(0, -1), { ...before[before.length - 1]!, gap: "" }], source: undefined, gap: sep });
        out.push(...chain(item.blocks, sep, after.length ? sep : block.gap));
        if (after.length) out.push({ ...block, items: after, start: block.start + index + 1, source: undefined, gap: block.gap });
        return out;
    });
}

function liftFromQuote(doc: Document, path: number[]): Document {
    const index = path[path.length - 1]!;
    return replace(doc, path.slice(0, -1), (block, sep) => {
        if (block.kind !== "quote") return null;
        const before = block.blocks.slice(0, index);
        const after = block.blocks.slice(index + 1);
        const out: Block[] = [];
        if (before.length) out.push({ ...block, blocks: chain(before, sep, ""), source: undefined, gap: sep });
        out.push({ ...block.blocks[index]!, gap: after.length ? sep : block.gap });
        if (after.length) out.push({ ...block, blocks: after, source: undefined, gap: block.gap });
        return out;
    });
}

// ---- lists ----

/** Moves a list item into the item before it, as a nested list. The path may point to the item or to a block in it. */
export function indent(doc: Document, path: number[]): Document {
    const found = itemOf(doc, path);
    if (!found || found.item === 0) return doc;
    return editItems(doc, found.list, (items, sep, owner) => {
        const previous = items[found.item - 1]!;
        const moved: ListItem = { ...items[found.item]!, source: undefined, gap: "" };
        const tail = previous.blocks[previous.blocks.length - 1];
        let blocks: Block[];
        if (tail?.kind === "list" && tail.style === owner.style) {
            const innerSep = tail.loose ? doc.eol + doc.eol : doc.eol;
            const inner = [...tail.items.slice(0, -1), { ...tail.items[tail.items.length - 1]!, gap: innerSep }, moved];
            blocks = [...previous.blocks.slice(0, -1), { ...tail, items: inner, source: undefined }];
        } else {
            const nested: List = { ...owner, start: 1, loose: false, items: [moved], source: undefined, gap: "" };
            blocks = [...chain(previous.blocks, sep, owner.loose ? doc.eol + doc.eol : doc.eol), nested];
        }
        const joined: ListItem = { ...previous, blocks, source: undefined, gap: items[found.item]!.gap };
        return spliceBlocks(items, found.item - 1, 2, [joined]);
    });
}

/** Moves a nested list item out to the list that holds it, after its parent item. A top-level item leaves the list. */
export function outdent(doc: Document, path: number[]): Document {
    const found = itemOf(doc, path);
    if (!found) return doc;
    const outer = itemOf(doc, found.list);
    const listIndex = found.list[found.list.length - 1]!;
    if (!outer || outer.list.length + 2 !== found.list.length) return liftItem(doc, found.list, found.item);
    const owner = blockAt(doc, found.list) as List;
    return editItems(doc, outer.list, (items, sep) => {
        const parentItem = items[outer.item]!;
        const kept = owner.items.slice(0, found.item);
        const after = owner.items.slice(found.item + 1);
        const moved = owner.items[found.item]!;
        const movedBlocks = after.length ? [...chain(moved.blocks, owner.loose ? doc.eol + doc.eol : doc.eol, owner.loose ? doc.eol + doc.eol : doc.eol), { ...owner, items: after, start: 1, source: undefined, gap: "" } as List] : moved.blocks;
        const lifted: ListItem = { ...moved, blocks: chain(movedBlocks, sep, ""), source: undefined, gap: parentItem.gap };
        let parentBlocks = parentItem.blocks.map((block, k) => (k === listIndex ? ({ ...owner, items: kept.length ? [...kept.slice(0, -1), { ...kept[kept.length - 1]!, gap: "" }] : [], source: undefined } as Block) : block));
        if (kept.length === 0) parentBlocks = spliceBlocks(parentItem.blocks, listIndex, 1, []);
        const parentNext: ListItem = { ...parentItem, blocks: parentBlocks, source: undefined, gap: sep };
        return spliceBlocks(items, outer.item, 1, [parentNext, lifted]);
    });
}

/** Makes the paragraph at a path small quiet text (`-# `), or ordinary text again. */
export function setSubtext(doc: Document, path: number[], on: boolean): Document {
    return replace(doc, path, (block) => {
        if (block.kind !== "paragraph" || !!block.subtext === on) return null;
        const next: Paragraph = { ...block, source: undefined };
        if (on) next.subtext = true;
        else delete next.subtext;
        return [next];
    });
}

/** Makes the paragraph at a path a subtitle (no longer subtext), or ordinary text again, where it stands. */
export function setSubtitle(doc: Document, path: number[], on: boolean): Document {
    return replace(doc, path, (block) => {
        if (block.kind !== "paragraph" || !!block.subtitle === on) return null;
        const { subtitle: _subtitle, subtext: _subtext, ...rest } = block;
        return [on ? { ...rest, subtitle: true, source: undefined } : { ...rest, source: undefined }];
    });
}

/**
 * Makes the paragraph or heading at a path the document's subtitle, which stands first, under the
 * title: its words move to the top, and a subtitle there before becomes ordinary text where it stood,
 * so that a document has one. The same in a `.quire` document and a Markdown file.
 */
export function makeSubtitle(doc: Document, path: number[]): Document {
    const block = blockAt(doc, path);
    if (block?.kind !== "paragraph" && block?.kind !== "heading") return doc;
    let next = doc;
    for (const each of blockPaths(doc)) if (each.join() !== path.join()) next = setSubtitle(next, each, false);
    if (path.length === 1 && path[0] === 0) return setSubtitle(block.kind === "paragraph" ? next : changeKind(next, path, { kind: "paragraph" }), path, true);
    next = removeAt(next, path);
    return { ...next, blocks: [{ ...paragraph(), runs: block.runs, subtitle: true, gap: doc.eol + doc.eol }, ...next.blocks] };
}

/** Puts the block at a path and every block after it among its neighbours into one quote, as Discord's `>>> ` does. */
export function quoteRest(doc: Document, path: number[]): Document {
    return edit(doc, path, (blocks, index, sep) => {
        const taken = blocks.slice(index);
        if (taken.length === 0) return blocks;
        const tail = taken[taken.length - 1]!.gap;
        const quote: Quote = { kind: "quote", blocks: chain(taken, sep, ""), gap: tail };
        return [...blocks.slice(0, index), quote];
    });
}

/** Sets the number a numbered list at a path starts from. */
export function setListStart(doc: Document, path: number[], start: number): Document {
    return replace(doc, path, (block) => (block.kind === "list" ? [{ ...block, start, source: undefined }] : null));
}

/** The list a path is in, and which of its items: the deepest list on the path. */
export function listAt(doc: Document, path: number[]): { list: number[]; item: number } | undefined {
    return itemOf(doc, path);
}

/** Sets the sign a bulleted list is written with. All three read as the same bullet. */
export function setListMarker(doc: Document, path: number[], marker: List["marker"]): Document {
    return replace(doc, path, (block) => (block.kind === "list" && block.marker !== marker ? [{ ...block, marker, source: undefined }] : null));
}

/** Numbers the list at a path afresh from item `item`, starting at `start`, each of those items written with its new number: at its first item the list's own start changes; further down, the list is cut in two there. */
export function restartList(doc: Document, path: number[], item: number, start: number): Document {
    return replace(doc, path, (block, sep) => {
        if (block.kind !== "list" || item >= block.items.length) return null;
        const after: List = { ...block, items: block.items.slice(Math.max(0, item)).map((each) => ({ ...each, source: undefined })), start, source: undefined, gap: block.gap };
        if (item <= 0) return [after];
        const before = block.items.slice(0, item);
        return [{ ...block, items: [...before.slice(0, -1), { ...before[before.length - 1]!, gap: "" }], source: undefined, gap: sep }, after];
    });
}

/** Joins the list at a path onto the list just before it, when both are numbered or both are not, so that the two are one list of the first one's kind. */
export function joinLists(doc: Document, path: number[]): Document {
    return edit(doc, path, (blocks, index) => {
        const before = blocks[index - 1];
        const block = blocks[index];
        if (before?.kind !== "list" || block?.kind !== "list" || before.style === "definition" || block.style === "definition" || (before.style === "number") !== (block.style === "number")) return blocks;
        const last = { ...before.items[before.items.length - 1]!, gap: before.loose ? doc.eol + doc.eol : doc.eol };
        // the items joined are written with their new numbers, and take the boxes of the list they join or lose theirs
        const boxed = (each: ListItem): ListItem => (before.style === "task" ? { ...each, checked: each.checked ?? false } : before.style === block.style ? each : (({ checked: _checked, ...rest }) => rest)(each));
        const items = [...before.items.slice(0, -1), last, ...block.items.map((each) => ({ ...boxed(each), source: undefined }))];
        return spliceBlocks(blocks, index - 1, 2, [{ ...before, items, source: undefined, gap: block.gap }]);
    });
}

/** Ticks or unticks a task item. An item with no box gains an empty one. */
export function toggleTask(doc: Document, path: number[]): Document {
    const found = itemOf(doc, path);
    if (!found) return doc;
    return editItems(doc, found.list, (items) => items.map((item, k) => (k === found.item ? { ...item, checked: item.checked === undefined ? false : !item.checked, source: undefined } : item)));
}

// ---- adding and moving blocks ----

/** Puts a new block after the block at a path. A new block's own source and gap are ignored. */
export function insertBlock(doc: Document, path: number[], block: Block): Document {
    const fresh = { ...block, source: undefined };
    return edit(doc, path, (blocks, index, sep) => {
        const before = blocks[index];
        if (!before) return blocks;
        return spliceBlocks(blocks, index, 1, [{ ...before, gap: sep }, { ...fresh, gap: before.gap }]);
    });
}

/** Moves a block, or a list item, one place up (-1) or down (1) among its neighbours. */
export function moveBlock(doc: Document, path: number[], by: -1 | 1): Document {
    const swap = <T extends { gap: string }>(list: T[], index: number): T[] | null => {
        const other = index + by;
        if (other < 0 || other >= list.length) return null;
        // the blocks change places, the gaps stay where they are
        return list.map((each, k) => (k === index ? { ...list[other]!, gap: each.gap } : k === other ? { ...list[index]!, gap: each.gap } : each));
    };
    if (!blockAt(doc, path)) {
        const found = itemOf(doc, path);
        if (!found || found.list.length + 1 !== path.length) return doc;
        return editItems(doc, found.list, (items) => swap(items, found.item));
    }
    return edit(doc, path, (blocks, index) => swap(blocks, index) ?? blocks);
}

// ---- tables ----

function editTable(doc: Document, path: number[], change: (table: Table) => Table | null): Document {
    return replace(doc, path, (block) => {
        if (block.kind !== "table") return null;
        const next = change(block);
        return next ? [{ ...next, source: undefined }] : null;
    });
}

/** Adds an empty row before row `at` of the body (the end if it is past the end). */
export function addRow(doc: Document, path: number[], at: number): Document {
    return editTable(doc, path, (found) => ({ ...found, rows: [...found.rows.slice(0, at), found.header.map(() => []), ...found.rows.slice(at)] }));
}

/** Removes body row `row`. */
export function removeRow(doc: Document, path: number[], row: number): Document {
    return editTable(doc, path, (found) => (row < 0 || row >= found.rows.length ? null : { ...found, rows: found.rows.filter((_, k) => k !== row) }));
}

/** Adds an empty column before column `at`. */
export function addColumn(doc: Document, path: number[], at: number): Document {
    const put = <T>(list: T[], value: T) => [...list.slice(0, at), value, ...list.slice(at)];
    return editTable(doc, path, (found) => ({ ...found, header: put(found.header, []), align: put(found.align, null), rows: found.rows.map((row) => put(row, [])) }));
}

/** Removes column `column`. The last column cannot be removed. */
export function removeColumn(doc: Document, path: number[], column: number): Document {
    const drop = <T>(list: T[]) => list.filter((_, k) => k !== column);
    return editTable(doc, path, (found) => (found.header.length <= 1 || column >= found.header.length ? null : { ...found, header: drop(found.header), align: drop(found.align), rows: found.rows.map(drop) }));
}

/** The order of a table's body rows sorted by a column, as their old numbers: by value when every cell in it with words is a number, as words otherwise, empty cells last. The heading row is not a body row. */
export function sortedRows(table: Table, column: number, descending = false): number[] {
    const words = table.rows.map((row) => runsText(row[column] ?? []).trim());
    const number = (text: string) => (/^[-+]?(\d{1,3}(,\d{3})+|\d*)(\.\d+)?%?$/.test(text) && /\d/.test(text) ? parseFloat(text.replace(/[,%]/g, "")) : NaN);
    const numeric = words.some((text) => text !== "") && words.every((text) => text === "" || !Number.isNaN(number(text)));
    const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });
    return words
        .map((_, index) => index)
        .sort((a, b) => {
            const [x, y] = [words[a]!, words[b]!];
            if (x === "" || y === "") return Number(x === "") - Number(y === "");
            const by = numeric ? number(x) - number(y) : collator.compare(x, y);
            return descending ? -by : by;
        });
}

/** Puts a table's body rows in the order given, as their old numbers. */
export function orderRows(doc: Document, path: number[], order: number[]): Document {
    return editTable(doc, path, (found) => (order.length !== found.rows.length || order.every((each, index) => each === index) ? null : { ...found, rows: order.map((index) => found.rows[index]!) }));
}

/** Sets a column's alignment; null is no alignment. */
export function setColumnAlign(doc: Document, path: number[], column: number, align: Align | null): Document {
    return editTable(doc, path, (found) => (column >= found.header.length ? null : { ...found, align: found.align.map((each, k) => (k === column ? align : each)) }));
}

// ---- reading the whole ----

/** One heading in the outline. */
export interface OutlineEntry {
    level: Level;
    text: string;
    path: number[];
}

function visit(blocks: Block[], prefix: number[], each: (block: Block, path: number[]) => void) {
    blocks.forEach((block, index) => {
        const path = [...prefix, index];
        each(block, path);
        if (block.kind === "list") block.items.forEach((item, k) => visit(item.blocks, [...path, k], each));
        if (block.kind === "quote" || block.kind === "footnote") visit(block.blocks, path, each);
    });
}

/** The headings of a document in order, with their levels, text and paths. */
export function outline(doc: Document): OutlineEntry[] {
    const out: OutlineEntry[] = [];
    visit(doc.blocks, [], (block, path) => {
        if (block.kind === "heading") out.push({ level: block.level, text: runsText(block.runs).replace(/￼/g, "").trim(), path });
    });
    return out;
}

/** How many words a reader sees: in paragraphs, headings, list items, quotes, footnotes and tables, not in code or raw blocks. */
export function countWords(doc: Document): number {
    let count = 0;
    const words = (runs: Run[]) => (runsText(runs).match(/[\p{L}\p{N}][\p{L}\p{N}'’_-]*/gu) ?? []).length;
    visit(doc.blocks, [], (block) => {
        if (block.kind === "paragraph" || block.kind === "heading") count += words(block.runs);
        if (block.kind === "table") for (const row of [block.header, ...block.rows]) for (const cell of row) count += words(cell);
    });
    return count;
}

// ---- frontmatter ----

const FIELD = /^([A-Za-z0-9_-]+):[ \t]*(.*?)[ \t]*$/;

function frontLines(front: string): string[] {
    return front.split(/(?<=\n)/);
}

/** The simple `key: value` lines of the frontmatter, in order, with quotes taken off the values. */
export function fields(doc: Document): [string, string][] {
    if (!doc.frontmatter) return [];
    const lines = frontLines(doc.frontmatter).slice(1, -1);
    return lines.flatMap((line): [string, string][] => {
        const match = FIELD.exec(line.replace(/\r?\n$/, ""));
        return match ? [[match[1]!, unquote(match[2]!)]] : [];
    });
}

function unquote(value: string): string {
    if (/^"(?:[^"\\]|\\.)*"$/.test(value)) {
        // YAML's double quotes take the escapes JSON does (\n is a line break, \t a tab), and a few more
        try {
            return JSON.parse(value) as string;
        } catch {
            return value.slice(1, -1).replace(/\\(.)/g, "$1");
        }
    }
    if (/^'(?:[^']|'')*'$/.test(value)) return value.slice(1, -1).replace(/''/g, "'");
    return value;
}

/**
 * A frontmatter value written on its own line as one plain or quoted value, with quotes taken off;
 * undefined when the key is not there, or is written in a form this does not read (a block of lines
 * after `|` or `>`, a list, a value going on to the next line), which is then left as it is.
 */
export function plainField(doc: Document, key: string): string | undefined {
    if (!doc.frontmatter) return undefined;
    const lines = frontLines(doc.frontmatter);
    const index = lines.findIndex((line, k) => k > 0 && k < lines.length - 1 && FIELD.exec(line.replace(/\r?\n$/, ""))?.[1] === key);
    if (index < 0) return undefined;
    const raw = FIELD.exec(lines[index]!.replace(/\r?\n$/, ""))![2]!;
    if (/^[|>[{&*!]/.test(raw) || (index + 1 < lines.length - 1 && /^[ \t]/.test(lines[index + 1]!))) return undefined;
    return unquote(raw);
}

/** Takes a frontmatter line away; a frontmatter left with no lines goes, with the blank lines after it. */
export function dropField(doc: Document, key: string): Document {
    if (!doc.frontmatter) return doc;
    const lines = frontLines(doc.frontmatter);
    const kept = lines.filter((line, k) => k === 0 || k === lines.length - 1 || FIELD.exec(line.replace(/\r?\n$/, ""))?.[1] !== key);
    if (kept.length === lines.length) return doc;
    if (kept.length === 2) return { ...doc, frontmatter: null, lead: "" };
    return { ...doc, frontmatter: kept.join("") };
}

/**
 * Sets a frontmatter value, adding the line (or the frontmatter) if it is not there. Every other
 * line is kept as it was. The value is quoted when YAML would read it as something else, unless
 * `raw` says it is to be written exactly as given (a date, a list, `true`).
 */
export function setField(doc: Document, key: string, value: string, raw = false): Document {
    const plain = raw || (value !== "" && !/^[\s\-?:,[\]{}#&*!|>'"%@`]|: | #|\s$|[\r\n]|^(true|false|null|yes|no|~)$|^[\d.+-]+$/i.test(value));
    const written = `${key}: ${plain ? value : JSON.stringify(value)}`;
    const eol = doc.eol;
    if (!doc.frontmatter) return { ...doc, frontmatter: `---${eol}${written}${eol}---${eol}` };
    const lines = frontLines(doc.frontmatter);
    const index = lines.findIndex((line, k) => k > 0 && k < lines.length - 1 && FIELD.exec(line.replace(/\r?\n$/, ""))?.[1] === key);
    if (index >= 0) {
        const ending = /\r?\n$/.exec(lines[index]!)?.[0] ?? "";
        lines[index] = written + ending;
    } else lines.splice(lines.length - 1, 0, written + eol);
    return { ...doc, frontmatter: lines.join("") };
}
