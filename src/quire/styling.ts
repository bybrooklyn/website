// What a `.quire` document keeps beside its Markdown, in style.json: the look of text and blocks
// that Markdown cannot say (color, size, font, highlight, alignment, line spacing, a subtitle, a
// picture's width, caption and whether the text flows round it) and the page.
// Its document.md is plain Markdown with none of that in it, readable by anything.
//
// Each style is addressed to a block by where it stood (its number among the blocks that hold no
// other blocks, in reading order) and by a short hash of the block's text; a style on part of a
// line also carries the words it covers and a few characters before them. That is what lets
// styling survive document.md being edited somewhere else:
//
//   - a block is found again by its hash, the nearest one to where it stood, so blocks added,
//     removed or moved around it do not matter;
//   - a block whose text was changed keeps its alignment and spacing only if the number of blocks
//     is unchanged, so that it is surely the same block;
//   - a style on words is put back on the same words, looked for first where they were and then
//     anywhere, preferring the place with the same characters before them;
//   - a style whose block or words are gone is dropped, quietly. A style.json that cannot be read
//     at all is dropped whole, and the document opens as the plain Markdown it is.
//
//   const { markdown, style } = collect(doc);   // to save
//   const doc = restore(read(markdown), style);  // to open

import { blockAt, blockPaths, LOOKS, restyleRuns, runsText, tidyRuns, type Align, type Block, type Document, type Look, type Page, type Run } from "./document";
import { write } from "./write";

/** Where a style belongs: the block's number among the blocks holding no others, and a hash of its text. */
interface Anchor {
    block: number;
    hash: string;
}

/** A block's alignment and line spacing, and a picture's width, caption and whether the text flows round it. */
export interface BlockStyle extends Anchor {
    align?: Align;
    spacing?: number;
    width?: number;
    caption?: string;
    wrap?: boolean;
    /** A paragraph that is a subtitle. */
    subtitle?: boolean;
}

/** A look on part of a block's text: offsets into it (or into one of a table's cells), the words, and what comes before them. */
export interface RunStyle extends Anchor, Look {
    cell?: [number, number];
    from: number;
    to: number;
    quote: string;
    before: string;
}

/** The whole of style.json. `count` is how many blocks there were, to tell a block changed in place from one moved. */
export interface StyleFile {
    quire: 1;
    page: Page;
    count: number;
    blocks: BlockStyle[];
    runs: RunStyle[];
}

/** The page a new document has. */
export const PAGE: Page = { size: "A4", orientation: "portrait", margins: 25 };

/** A short hash of some text (FNV-1a), to know a block again. */
export function hash(text: string): string {
    let value = 0x811c9dc5;
    for (let index = 0; index < text.length; index++) value = Math.imul(value ^ text.charCodeAt(index), 0x01000193) >>> 0;
    return value.toString(16).padStart(8, "0");
}

/** The runs a block holds that can be styled: a paragraph's or heading's, or each cell of a table. */
function runLists(block: Block | undefined): { cell?: [number, number]; runs: Run[] }[] {
    if (block?.kind === "paragraph" || block?.kind === "heading") return [{ runs: block.runs }];
    if (block?.kind === "table") return [block.header, ...block.rows].flatMap((row, r) => row.map((runs, c) => ({ cell: [r, c] as [number, number], runs })));
    return [];
}

/** A block's text as its hash is made from. */
function blockText(block: Block | undefined): string {
    if (block?.kind === "image") return `${block.src}\n${block.alt}`;
    return runLists(block)
        .map((part) => runsText(part.runs))
        .join("\t");
}

const lookOf = (leaf: Run): Look | undefined => {
    if (leaf.kind !== "text") return undefined;
    const look: Look = {};
    for (const key of LOOKS) if (leaf[key]) look[key] = leaf[key];
    return Object.keys(look).length ? look : undefined;
};
const sameLook = (a: Look, b: Look) => LOOKS.every((key) => a[key] === b[key]);

/** The stretches of runs that have a look, with their offsets, neighbours with the same look joined. */
function looks(runs: Run[]): { from: number; to: number; look: Look }[] {
    const found: { from: number; to: number; look: Look }[] = [];
    let at = 0;
    for (const leaf of runs.flatMap((run) => (run.kind === "link" ? run.runs : [run]))) {
        const length = leaf.kind === "text" ? leaf.text.length : 1;
        const look = lookOf(leaf);
        const last = found[found.length - 1];
        if (look && last && last.to === at && sameLook(last.look, look)) last.to += length;
        else if (look) found.push({ from: at, to: at + length, look });
        at += length;
    }
    return found;
}

/** Takes the looks off runs. */
const plainRuns = (runs: Run[]): Run[] => (looks(runs).length ? tidyRuns(restyleRuns(runs, 0, Infinity, { color: null, size: null, font: null, highlight: null })) : runs);

/** The document with the styling that goes to style.json taken off every block written fresh; an untouched block is written as it was read. */
function strip(blocks: Block[]): Block[] {
    return blocks.map((block): Block => {
        if (block.source !== undefined) return block;
        switch (block.kind) {
            case "paragraph":
            case "heading": {
                const { align: _align, spacing: _spacing, ...rest } = block;
                if (rest.kind === "paragraph") delete rest.subtitle;
                return { ...rest, runs: plainRuns(block.runs) };
            }
            case "image": {
                const { align: _align, width: _width, caption: _caption, wrap: _wrap, ...rest } = block;
                return rest;
            }
            case "table":
                return { ...block, header: block.header.map(plainRuns), rows: block.rows.map((row) => row.map(plainRuns)) };
            case "list":
                return { ...block, items: block.items.map((item) => (item.source !== undefined ? item : { ...item, blocks: strip(item.blocks) })) };
            case "quote":
            case "footnote":
                return { ...block, blocks: strip(block.blocks) };
            default:
                return block;
        }
    });
}

/** What a `.quire` document saves: its Markdown, plain, and its style.json. */
export function collect(doc: Document): { markdown: string; style: StyleFile } {
    const paths = blockPaths(doc);
    const style: StyleFile = { quire: 1, page: doc.quire?.page ?? PAGE, count: paths.length, blocks: [], runs: [] };
    paths.forEach((path, number) => {
        const block = blockAt(doc, path);
        if (!block) return;
        const anchor = { block: number, hash: "" };
        const sign = () => (anchor.hash ||= hash(blockText(block)));
        if ((block.kind === "paragraph" || block.kind === "heading" || block.kind === "image") && block.align) style.blocks.push({ ...anchor, hash: sign(), align: block.align });
        if ((block.kind === "paragraph" || block.kind === "heading") && block.spacing) {
            const last = style.blocks[style.blocks.length - 1];
            if (last?.block === number) last.spacing = block.spacing;
            else style.blocks.push({ ...anchor, hash: sign(), spacing: block.spacing });
        }
        if (block.kind === "paragraph" && block.subtitle) {
            const last = style.blocks[style.blocks.length - 1];
            if (last?.block === number) last.subtitle = true;
            else style.blocks.push({ ...anchor, hash: sign(), subtitle: true });
        }
        if (block.kind === "image" && (block.width !== undefined || block.caption || block.wrap)) {
            const last = style.blocks[style.blocks.length - 1];
            const into = last?.block === number ? last : (style.blocks[style.blocks.push({ ...anchor, hash: sign() }) - 1] as BlockStyle);
            if (block.width !== undefined) into.width = block.width;
            if (block.caption) into.caption = block.caption;
            if (block.wrap) into.wrap = true;
        }
        for (const part of runLists(block)) {
            const whole = runsText(part.runs);
            for (const stretch of looks(part.runs)) {
                const run: RunStyle = { block: number, hash: sign(), from: stretch.from, to: stretch.to, quote: whole.slice(stretch.from, stretch.to), before: whole.slice(Math.max(0, stretch.from - 12), stretch.from), ...stretch.look };
                if (part.cell) run.cell = part.cell;
                style.runs.push(run);
            }
        }
    });
    return { markdown: write({ ...doc, blocks: strip(doc.blocks) }), style };
}

/** Reads style.json, keeping what is sound in it and dropping the rest; nothing in it can stop a document opening. */
export function readStyle(text: string | undefined): StyleFile {
    const empty: StyleFile = { quire: 1, page: { ...PAGE }, count: 0, blocks: [], runs: [] };
    let raw: Partial<StyleFile>;
    try {
        raw = JSON.parse(text ?? "") as Partial<StyleFile>;
    } catch {
        return empty;
    }
    if (!raw || typeof raw !== "object") return empty;
    const page = (raw.page ?? {}) as Partial<Page>;
    const number = (value: unknown) => typeof value === "number" && Number.isFinite(value);
    const anchored = (value: Partial<Anchor>) => !!value && number(value.block) && typeof value.hash === "string";
    const kept: Page = {
        size: page.size === "Letter" || page.size === "A5" ? page.size : "A4",
        orientation: page.orientation === "landscape" ? "landscape" : "portrait",
        margins: number(page.margins) && page.margins! >= 5 && page.margins! <= 60 ? page.margins! : PAGE.margins,
    };
    // the header and footer are a line of plain text each
    for (const key of ["header", "footer"] as const) if (typeof page[key] === "string" && page[key]!.trim()) kept[key] = page[key]!.replace(/\s+/g, " ").trim().slice(0, 200);
    if (page.numbers === true) kept.numbers = true;
    return {
        quire: 1,
        page: kept,
        count: number(raw.count) ? raw.count! : 0,
        blocks: (Array.isArray(raw.blocks) ? raw.blocks : []).filter((each) => anchored(each) && (["left", "center", "right", "justify"].includes(each.align as string) || number(each.spacing) || (number(each.width) && each.width! >= 1 && each.width! <= 100) || (typeof each.caption === "string" && each.caption !== "") || each.wrap === true || each.subtitle === true)),
        runs: (Array.isArray(raw.runs) ? raw.runs : []).filter((each) => anchored(each) && number(each.from) && number(each.to) && typeof each.quote === "string" && each.quote.length > 0 && LOOKS.some((key) => typeof each[key] === "string")),
    };
}

/** Changes the block at a path without forgetting its source: styling from style.json is not in the Markdown, so the block is still as it was read. */
function setAt(blocks: Block[], path: number[], change: (block: Block) => Block): Block[] {
    const [index, ...rest] = path;
    const block = blocks[index!];
    if (!block) return blocks;
    let next: Block = block;
    if (rest.length === 0) next = change(block);
    else if (block.kind === "list") {
        const [item, ...inner] = rest;
        next = { ...block, items: block.items.map((each, k) => (k === item ? { ...each, blocks: setAt(each.blocks, inner, change) } : each)) };
    } else if (block.kind === "quote" || block.kind === "footnote") next = { ...block, blocks: setAt(block.blocks, rest, change) };
    return blocks.map((each, k) => (k === index ? next : each));
}

/** Puts style.json back on a document read from its Markdown, finding each style's block and words again, and dropping what cannot be found. */
export function restore(doc: Document, style: StyleFile): Document {
    const paths = blockPaths(doc);
    const found = paths.map((path) => {
        const block = blockAt(doc, path);
        return { path, block, hash: hash(blockText(block)), parts: runLists(block) };
    });
    // each anchor finds the nearest block with its hash that no other anchor has taken
    const taken = new Map<number, string>();
    const resolved = new Map<string, number | undefined>();
    const resolve = (anchor: Anchor) => {
        const key = `${anchor.block}:${anchor.hash}`;
        if (resolved.has(key)) return resolved.get(key);
        let best: number | undefined;
        found.forEach((each, number) => {
            if (each.hash !== anchor.hash || (taken.has(number) && taken.get(number) !== key)) return;
            if (best === undefined || Math.abs(number - anchor.block) < Math.abs(best - anchor.block)) best = number;
        });
        if (best !== undefined) taken.set(best, key);
        resolved.set(key, best);
        return best;
    };
    let blocks = doc.blocks;
    for (const each of style.blocks) {
        let number = resolve(each);
        if (number === undefined && style.count === paths.length && found[each.block]) number = each.block;
        if (number === undefined) continue;
        blocks = setAt(blocks, found[number]!.path, (block) => {
            if (block.kind !== "paragraph" && block.kind !== "heading" && block.kind !== "image") return block;
            const next = { ...block };
            if (each.align) next.align = each.align;
            if (each.spacing && next.kind !== "image") next.spacing = each.spacing;
            if (next.kind === "image" && typeof each.width === "number" && each.width >= 1 && each.width <= 100) next.width = Math.round(each.width);
            if (next.kind === "image" && typeof each.caption === "string" && each.caption) next.caption = each.caption;
            if (next.kind === "image" && each.wrap === true) next.wrap = true;
            if (next.kind === "paragraph" && each.subtitle === true) next.subtitle = true;
            return next;
        });
    }
    for (const run of style.runs) {
        const place = findWords(found, resolve(run), run);
        if (!place) continue;
        const look: Look = {};
        for (const key of LOOKS) if (typeof run[key] === "string") look[key] = run[key];
        blocks = setAt(blocks, found[place.number]!.path, (block) => {
            if (block.kind === "paragraph" || block.kind === "heading") return { ...block, runs: restyleRuns(block.runs, place.from, place.to, look) };
            if (block.kind !== "table" || !place.cell) return block;
            const [r, c] = place.cell;
            const swap = (row: Run[][]) => row.map((cell, k) => (k === c ? restyleRuns(cell, place.from, place.to, look) : cell));
            return { ...block, header: r === 0 ? swap(block.header) : block.header, rows: block.rows.map((row, k) => (k === r - 1 ? swap(row) : row)) };
        });
    }
    return { ...doc, blocks, quire: { page: style.page, notes: doc.quire?.notes ?? null } };
}

/** Where a styled stretch of words is now: where it was if the words are still there, or else the likeliest place they are found. */
function findWords(found: { parts: { cell?: [number, number]; runs: Run[] }[] }[], number: number | undefined, run: RunStyle): { number: number; cell?: [number, number]; from: number; to: number } | undefined {
    const sameCell = (cell?: [number, number]) => (!cell && !run.cell) || (!!cell && !!run.cell && cell[0] === run.cell[0] && cell[1] === run.cell[1]);
    if (number !== undefined) {
        const part = found[number]!.parts.find((each) => sameCell(each.cell));
        if (part && runsText(part.runs).slice(run.from, run.to) === run.quote) return { number, cell: part.cell, from: run.from, to: run.to };
    }
    // looked for everywhere, nearest first; a short stretch is put back only where the characters before it match too
    const order = found.map((_, index) => index).sort((a, b) => Math.abs(a - run.block) - Math.abs(b - run.block));
    let loose: { number: number; cell?: [number, number]; from: number; to: number } | undefined;
    for (const index of order) {
        for (const part of found[index]!.parts) {
            const whole = runsText(part.runs);
            for (let at = whole.indexOf(run.quote); at >= 0; at = whole.indexOf(run.quote, at + 1)) {
                const place = { number: index, cell: part.cell, from: at, to: at + run.quote.length };
                // words found whole, not inside a longer word ("is" in "This"), unless the characters before them say where they are
                const apart = wholeWords(whole, at, run.quote);
                if (whole.slice(0, at).endsWith(run.before) && (run.before !== "" || apart)) return place;
                if (apart) loose ??= place;
            }
        }
    }
    return loose && run.quote.trim().length >= 4 ? loose : undefined;
}

/** True when words found at `at` in a text are not part of a longer word on either side. */
function wholeWords(text: string, at: number, quote: string): boolean {
    const letter = /[\p{L}\p{N}_]/u;
    const startsWord = letter.test(quote[0] ?? "");
    const endsWord = letter.test(quote[quote.length - 1] ?? "");
    return !(startsWord && letter.test(text[at - 1] ?? "")) && !(endsWord && letter.test(text[at + quote.length] ?? ""));
}
