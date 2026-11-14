// The tools, the second line of the editor's top: in Google Docs' order, as she chose it. Undo,
// redo, print, spelling and paint format; zoom; the style; the typeface; the size as a number with
// minus and plus; bold, italic, underline, strikethrough, text color and highlight; link and
// picture; alignment; line spacing; the lists; indent less and more; clear formatting; and at the
// right end find, the three dots and the microphone. Alignment and the lists are one button each
// that grows open in place into its choices (choices, below). What a Markdown file cannot keep
// (typeface, highlight, line spacing, justified) is away for one. Buttons show as pressed when what
// they do is true at the cursor. It is a toolbar: Tab reaches it once, the arrow keys move along
// it. When it has less room than it needs, at any width, its tools fold into the three dots in a
// set order (FOLDS), those a writer needs least first; the dots hold nothing else of the bar's.
//
// The document's name and how saving stands are made here too, for the page to put on the first
// line. What each button does to a document is a pure Action, below, tested in bar.test.ts; the DOM
// is built by createBar. Its styles are in src/styles/quire.css.

import {
    blockAt,
    blockPaths,
    changeKind,
    code as codeBlock,
    countWords,
    deleteText,
    divider,
    image as imageBlock,
    indent,
    insertAtom,
    insertBlock,
    lengthOf,
    outdent,
    paragraph,
    removeBlock,
    runsLength,
    runsText,
    setAlign,
    setLink,
    setSpacing,
    setSubtext,
    setSubtitle,
    splitBlock,
    setStyle,
    table,
    toggleMark,
    textAt,
    type Align,
    type Block,
    type Document,
    type Level,
    type ListStyle,
    type Mark,
    type Position,
    type Range,
    type Run,
    type Selection,
} from "./document";
import type { State } from "./history";
import { activeBlock, caret, collapsed, mark, pageBreakAt, paste, rangeOf, sameLeaf, tableOf } from "./keys";
import { growsFrom } from "./dialog";
import { SHORTCUTS } from "./shortcuts";
import type { Surface } from "./surface";
import { closeOthers, composing, control, dots, EASE, flowMenu, glyph, icon, make, MOTION, moveIndex, springCurve, still, type Menu, type MenuItem } from "./ui";

/** What a button does: from the state at the cursor to the next one. */
export type Action = (state: State) => State;

/** The kinds of block the style picker offers. */
export type Style = "paragraph" | "title" | "subtitle" | "heading1" | "heading2" | "heading3" | "heading4" | "heading5" | "heading6" | "quote" | "code";

/** The style picker's lines, in order, with their names. */
export const STYLES: [Style, string][] = [
    ["paragraph", "Normal text"],
    ["title", "Title"],
    ["subtitle", "Subtitle"],
    ["heading1", "Heading 1"],
    ["heading2", "Heading 2"],
    ["heading3", "Heading 3"],
    ["heading4", "Heading 4"],
    ["heading5", "Heading 5"],
    ["heading6", "Heading 6"],
    ["quote", "Quote"],
    ["code", "Code"],
];

// ---- reading the state ----

/** The leaf blocks a selection touches, as their places in reading order. */
function touched(doc: Document, selection: Selection): number[] {
    const paths = blockPaths(doc);
    const { start, end } = rangeOf(selection);
    const leaf = (path: number[]) => tableOf(doc, path) ?? path;
    const same = (a: number[], b: number[]) => a.join(",") === b.join(",");
    const first = paths.findIndex((path) => same(path, leaf(start.path)));
    const last = paths.findIndex((path) => same(path, leaf(end.path)));
    if (first < 0) return [];
    return Array.from({ length: Math.max(0, last - first) + 1 }, (_, index) => first + index);
}

/** Which style the cursor's block has, as the style picker shows it. Text in a callout or a folding section is normal text: only a plain quote is Quote. */
export function currentStyle(doc: Document, path: number[]): Style {
    const block = activeBlock(doc, path);
    if (block.kind === "heading") return `heading${block.level ?? 1}` as Style;
    if (block.kind === "code") return "code";
    const plainQuote = (depth: number) => {
        const holder = blockAt(doc, path.slice(0, depth + 1));
        return holder?.kind === "quote" && !holder.callout && !holder.details;
    };
    if (path.some((_, depth) => plainQuote(depth))) return "quote";
    const here = blockAt(doc, path);
    return here?.kind === "paragraph" && here.subtitle ? "subtitle" : "paragraph";
}

/** Whether the cursor's block is centred. */
export function centred(doc: Document, path: number[]): boolean {
    const block = blockAt(doc, path);
    return !!block && "align" in block && block.align === "center";
}

/** Moves a selection to follow its blocks through a change that moved them. */
function follow(before: Document, selection: Selection, after: Document): Selection {
    const keep = (position: Position): Position => (tableOf(before, position.path) ? position : { path: sameLeaf(before, position.path, after), offset: Math.min(position.offset, lengthOf(after, sameLeaf(before, position.path, after))) });
    return { anchor: keep(selection.anchor), focus: keep(selection.focus) };
}

// ---- marks and links ----

/** Turns a mark on or off, as Ctrl+B and the others do. */
export function toggle(which: Mark): Action {
    return (state) => {
        const outcome = mark(state, which);
        return outcome && "state" in outcome ? outcome.state : state;
    };
}

/** The word around a position, for color, size and links when nothing is selected. */
export function wordAt(doc: Document, at: Position): Range {
    const text = textAt(doc, at.path);
    const word = /[\p{L}\p{N}_'’-]/u;
    let start = at.offset;
    let end = at.offset;
    while (start > 0 && word.test(text[start - 1]!)) start--;
    while (end < text.length && word.test(text[end]!)) end++;
    return { start: { path: at.path, offset: start }, end: { path: at.path, offset: end } };
}

/** The stretch of the link the cursor is in, if it is in one. */
export function linkAt(doc: Document, at: Position): { range: Range; href: string } | undefined {
    const block = blockAt(doc, at.path);
    const runs: Run[] = block?.kind === "paragraph" || block?.kind === "heading" ? block.runs : [];
    let offset = 0;
    for (const run of runs) {
        const length = runsLength([run]);
        if (run.kind === "link" && at.offset >= offset && at.offset <= offset + length) return { range: { start: { path: at.path, offset }, end: { path: at.path, offset: offset + length } }, href: run.href };
        offset += length;
    }
    return undefined;
}

/** What a mark-like change applies to: the selection, or with nothing selected the word (or link) at the cursor. */
function reach(state: State, preferLink = false): Range {
    if (!collapsed(state.selection)) return rangeOf(state.selection);
    const link = preferLink ? linkAt(state.doc, state.selection.focus) : undefined;
    return link?.range ?? wordAt(state.doc, state.selection.focus);
}

/** Sets a link on the selection (or the word at the cursor), or takes it off with null. */
export function link(href: string | null): Action {
    return (state) => ({ ...state, doc: setLink(state.doc, reach(state, true), href) });
}

/** Sets the text's color, written as a `<span style>`; null takes it off. */
export function color(value: string | null): Action {
    return (state) => ({ ...state, doc: setStyle(state.doc, reach(state), { color: value }) });
}

/** Sets the text's typeface, one of FONTS; null puts back the page's own. For `.quire` documents alone. */
export function font(value: string | null): Action {
    return (state) => ({ ...state, doc: setStyle(state.doc, reach(state), { font: value }) });
}

/** Lays a color behind the text; null takes it away. For `.quire` documents alone. */
export function highlight(value: string | null): Action {
    return (state) => ({ ...state, doc: setStyle(state.doc, reach(state), { highlight: value }) });
}

/** The typefaces text can be given: the two the site ships, and the system's own three. Nothing is downloaded for any of them. */
export const FONTS: [string, string | null][] = [
    ["The page's own", null],
    ["Torrens", "torrens"],
    ["Drafting Mono", "drafting"],
    ["System serif", "serif"],
    ["System sans", "sans"],
    ["System mono", "mono"],
];

/** The colors of the two flags in the site's corner, offered beside the site's own for text and highlights. */
export const FLAGS: { name: string; value: string }[] = [
    { name: "Trans blue", value: "#5bcefa" },
    { name: "Trans pink", value: "#f5a9b8" },
    { name: "White", value: "#ffffff" },
    { name: "Dark orange", value: "#d52d00" },
    { name: "Orange", value: "#ff9a56" },
    { name: "Orchid", value: "#d362a4" },
    { name: "Dark rose", value: "#a30262" },
];

/** Sets the text's size; null takes it off. */
export function size(value: string | null): Action {
    return (state) => ({ ...state, doc: setStyle(state.doc, reach(state), { size: value }) });
}

// ---- kinds of block ----

/** Makes the touched blocks a paragraph, a subtitle, a heading, a quote or code. Quote, pressed in a quote, takes the quote off. Title changes nothing here: the title is the line above the writing, which the editor goes to. */
export function setStyleOf(style: Style): Action {
    return (state) => {
        let doc = state.doc;
        const quoted = currentStyle(doc, state.selection.focus.path) === "quote";
        for (const index of touched(state.doc, state.selection)) {
            const path = blockPaths(doc)[index];
            if (!path) continue;
            const block = blockAt(doc, path);
            if (!block) continue;
            const inQuote = activeBlock(doc, path).quoted;
            if (style === "quote") {
                if (quoted) doc = inQuote && block.kind === "paragraph" ? changeKind(doc, path, { kind: "paragraph" }) : doc;
                else {
                    // a quote in the picker is a quoted paragraph: a heading or code becomes a paragraph first
                    if (block.kind !== "paragraph") doc = changeKind(doc, path, { kind: "paragraph" });
                    doc = changeKind(doc, blockPaths(doc)[index]!, { kind: "quote" });
                }
            }
            else if (style === "code") doc = changeKind(doc, path, { kind: "code", language: "" });
            else if (style === "title") continue;
            else if (style === "subtitle") doc = setSubtitle(block.kind === "paragraph" ? doc : changeKind(doc, path, { kind: "paragraph" }), path, true);
            else if (style === "paragraph") doc = block.kind === "paragraph" ? (block.subtitle ? setSubtitle(doc, path, false) : inQuote ? changeKind(doc, path, { kind: "paragraph" }) : doc) : changeKind(doc, path, { kind: "paragraph" });
            else doc = changeKind(doc, path, { kind: "heading", level: Number(style.slice(-1)) as Level });
        }
        return { doc, selection: follow(state.doc, state.selection, doc) };
    };
}

/** Makes the touched paragraphs subtext (`-# `, small and quiet), or ordinary text again if the cursor's already is. */
export const toggleSubtext: Action = (state) => {
    const here = blockAt(state.doc, state.selection.focus.path);
    const on = !(here?.kind === "paragraph" && here.subtext);
    let doc = state.doc;
    for (const index of touched(state.doc, state.selection)) {
        const path = blockPaths(doc)[index];
        let block = path && blockAt(doc, path);
        if (!path || !block) continue;
        // a heading becomes a paragraph first, as Docs turns a heading into small text
        if (on && block.kind === "heading") {
            doc = changeKind(doc, path, { kind: "paragraph" });
            block = blockAt(doc, path);
        }
        if (block?.kind === "paragraph") doc = setSubtext(doc, path, on);
    }
    return { doc, selection: follow(state.doc, state.selection, doc) };
};

/**
 * With only a cursor in a paragraph of several lines (Shift+Enter) that is not in a list, the
 * paragraph cut so that the cursor's line is a paragraph of its own, as a mark typed at the start
 * of such a line cuts it (keys.ts).
 */
function ownLine(state: State): State {
    const at = state.selection.focus;
    const block = blockAt(state.doc, at.path);
    if (!collapsed(state.selection) || block?.kind !== "paragraph" || activeBlock(state.doc, at.path).list) return state;
    const text = runsText(block.runs);
    const start = at.offset > 0 ? text.lastIndexOf("\n", at.offset - 1) + 1 : 0;
    const end = text.indexOf("\n", at.offset);
    if (start === 0 && end < 0) return state;
    let doc = state.doc;
    let path = at.path;
    const cut = (offset: number) => splitBlock(deleteText(doc, { start: { path, offset }, end: { path, offset: offset + 1 } }), { path, offset });
    if (end >= 0) doc = cut(end);
    if (start > 0) {
        doc = cut(start - 1);
        path = [...path.slice(0, -1), path[path.length - 1]! + 1];
    }
    return { doc, selection: caret(path, at.offset - start) };
}

/** Makes the touched blocks a list of a kind, or, if they already are one, plain paragraphs again. A cursor on one line of a paragraph of several makes a list of that line alone. */
export function toggleList(style: ListStyle): Action {
    return (given) => {
        const state = ownLine(given);
        const already = activeBlock(state.doc, state.selection.focus.path).list === style;
        let doc = state.doc;
        for (const index of touched(state.doc, state.selection)) {
            const path = blockPaths(doc)[index];
            const block = path && blockAt(doc, path);
            if (!path || !block || (block.kind !== "paragraph" && block.kind !== "heading")) continue;
            const inList = activeBlock(doc, path).list;
            if (already) doc = inList ? changeKind(doc, path, { kind: "paragraph" }) : doc;
            else doc = changeKind(doc, path, { kind: "list", style });
        }
        return { doc, selection: follow(state.doc, state.selection, doc) };
    };
}

/** Centres the cursor's block, or puts it back to the left. */
export const center: Action = (state) => {
    const path = state.selection.focus.path;
    return { ...state, doc: setAlign(state.doc, path, centred(state.doc, path) ? null : "center") };
};

/** How the cursor's block sits across the page: left unless it says otherwise. */
export function aligned(doc: Document, path: number[]): Align {
    const block = blockAt(doc, tableOf(doc, path) ?? path);
    return (block && "align" in block && typeof block.align === "string" && block.align) || "left";
}

/** Sets how every touched paragraph, heading and picture sits across the page; left is the usual, and is written as nothing. */
export function align(value: Align): Action {
    return (state) => {
        let doc = state.doc;
        for (const index of touched(state.doc, state.selection)) doc = setAlign(doc, blockPaths(doc)[index]!, value === "left" ? null : value);
        return { ...state, doc };
    };
}

/** The cursor's block's line spacing, 1 being the usual. */
export function spacedAt(doc: Document, path: number[]): number {
    const block = blockAt(doc, path);
    return (block && (block.kind === "paragraph" || block.kind === "heading") && block.spacing) || 1;
}

/** Sets the line spacing of every touched paragraph and heading; 1 puts back the usual. For `.quire` documents alone. */
export function spacing(value: number): Action {
    return (state) => {
        let doc = state.doc;
        for (const index of touched(state.doc, state.selection)) doc = setSpacing(doc, blockPaths(doc)[index]!, value);
        return { ...state, doc };
    };
}

/** The line spacings offered, by name. */
export const SPACINGS: [string, number][] = [
    ["Single", 1],
    ["1.15", 1.15],
    ["1.5", 1.5],
    ["Double", 2],
];

/** The ways a block can sit across the page, by name, with their icons; justified is for `.quire` documents alone. */
export const ALIGNS: [Align, string][] = [
    ["left", "Align left"],
    ["center", "Center"],
    ["right", "Align right"],
    ["justify", "Justify"],
];

/** The kinds of list, by name, in the bar's order. */
export const LISTS: [ListStyle, string][] = [
    ["task", "Checklist"],
    ["bullet", "Bulleted list"],
    ["number", "Numbered list"],
];

/** A control's tooltip: its name, with its shortcut in words where it has one, "Bold (Ctrl+B)"; on a Mac Ctrl is said as Cmd. */
export function tip(label: string, command?: string, onMac = false): string {
    const keys = command && SHORTCUTS.find((each) => each.command === command)?.keys;
    return keys ? `${label} (${onMac ? keys.replace("Ctrl", "Cmd") : keys})` : label;
}

/** The sizes the size menu offers: Google Docs' own for a `.quire` document, which keeps any size, and the five a Markdown file can keep for one. */
export function sizesOffered(rich: boolean): number[] {
    return rich ? [8, 9, 10, 11, 12, 14, 18, 24, 30, 36, 48, 60, 72, 96] : SIZE_STEPS;
}

// ---- adding blocks ----

/** Puts a block after the cursor's block, or in place of it if it is an empty paragraph, giving the document and where the new block is. */
function put(state: State, block: Block): { doc: Document; path: number[] } {
    const at = state.selection.focus.path;
    const path = tableOf(state.doc, at) ?? at;
    const here = blockAt(state.doc, path);
    const empty = here?.kind === "paragraph" && here.runs.length === 0;
    let doc = insertBlock(state.doc, path, block);
    const next = [...path.slice(0, -1), path[path.length - 1]! + 1];
    if (!empty) return { doc, path: next };
    doc = removeBlock(doc, path);
    return { doc, path };
}

const sibling = (path: number[]) => [...path.slice(0, -1), path[path.length - 1]! + 1];

/** Adds a table of three columns and three rows, the cursor in its first cell; with nothing after it, an empty line follows it, as in Docs, to go on writing under it. */
export const addTable: Action = (state) => {
    const placed = put(state, table(["", "", ""], [["", "", ""], ["", "", ""]]));
    const doc = blockAt(placed.doc, sibling(placed.path)) ? placed.doc : insertBlock(placed.doc, placed.path, paragraph());
    return { doc, selection: caret([...placed.path, 0, 0], 0) };
};

/** Adds an empty code block, the cursor in it. */
export const addCode: Action = (state) => {
    const { doc, path } = put(state, codeBlock("", ""));
    return { doc, selection: caret(path, 0) };
};

/** Adds a block that is not written in (a divider or a picture) with an empty paragraph after it for the cursor. */
function addWithLine(block: Block): Action {
    return (state) => {
        const placed = put(state, block);
        const doc = insertBlock(placed.doc, placed.path, paragraph());
        return { doc, selection: caret(sibling(placed.path), 0) };
    };
}

/** Adds a divider. */
export const addDivider: Action = addWithLine(divider());

/**
 * Adds a picture by its address exactly where the cursor is, as a pasted one goes: in the middle of a
 * paragraph it splits the paragraph there, and on an empty line it takes the line's place. The cursor
 * goes on after it, onto an empty line of its own when nothing follows.
 */
export function addImage(src: string, alt = ""): Action {
    return (state) => {
        const placed = paste(state, [imageBlock(src, alt)]);
        const at = placed.selection.focus.path;
        if (blockAt(placed.doc, at)?.kind !== "image") return placed;
        const next = sibling(at);
        return { doc: blockAt(placed.doc, next) ? placed.doc : insertBlock(placed.doc, at, paragraph()), selection: caret(next, 0) };
    };
}

/** Puts a footnote reference at the cursor and its note at the end of the document, the cursor in the note. */
export const addFootnote: Action = (state) => {
    const labels = state.doc.blocks.flatMap((block) => (block.kind === "footnote" ? [Number(block.label)] : [])).filter(Number.isFinite);
    const label = String(Math.max(0, ...labels) + 1);
    const at = rangeOf(state.selection).end;
    const block = blockAt(state.doc, at.path);
    let doc = block?.kind === "paragraph" || block?.kind === "heading" || tableOf(state.doc, at.path) ? insertAtom(state.doc, at, { kind: "footnote", label }) : state.doc;
    doc = insertBlock(doc, [doc.blocks.length - 1], { kind: "footnote", label, blocks: [paragraph()], gap: "" });
    return { doc, selection: caret([doc.blocks.length - 1, 0], 0) };
};

/** What is pressed at the cursor, for the bar to show. */
export function pressedAt(doc: Document, path: number[], marks: Mark[]) {
    const block = activeBlock(doc, path);
    return {
        bold: marks.includes("bold"),
        italic: marks.includes("italic"),
        underline: marks.includes("underline"),
        strike: marks.includes("strike"),
        code: marks.includes("code"),
        bullet: block.list === "bullet",
        number: block.list === "number",
        task: block.list === "task",
        center: centred(doc, path),
    };
}

// ---- the size, as a number ----

/** The size a number stands for: 12 is the text's own, as 11 is in Docs; the number is the size in twelfths of it. */
export const BASE_SIZE = 12;

/** The sizes a Markdown file can keep, as numbers: the five it has always had (0.85em, the text's own, 1.25em, 1.5em, 2em). */
export const SIZE_STEPS = [10, 12, 15, 18, 24];

/** The smallest and largest size a `.quire` document is given. */
const SIZE_RANGE: [number, number] = [6, 96];

/** The number a size is shown as: "1.25em" is 15, no size is 12. */
export function sizeNumber(size: string | undefined): number {
    if (!size) return BASE_SIZE;
    const value = parseFloat(size);
    if (!Number.isFinite(value)) return BASE_SIZE;
    const em = size.trim().endsWith("%") ? value / 100 : size.trim().endsWith("px") ? value / 16 : value;
    return Math.round(em * BASE_SIZE);
}

/** The size kept for a number: twelfths of the text's own, in em; 12 keeps none. A Markdown step keeps the size it always has. */
export function sizeValue(number: number): string | null {
    if (number === BASE_SIZE) return null;
    const known: Record<number, string> = { 10: "0.85em", 15: "1.25em", 18: "1.5em", 24: "2em" };
    return known[number] ?? `${+(number / BASE_SIZE).toFixed(4)}em`;
}

/** The size after minus or plus: one more or less in a `.quire` document, the next of the Markdown steps in a Markdown file. */
export function nextSize(now: number, by: -1 | 1, rich: boolean): number {
    if (rich) return Math.min(SIZE_RANGE[1], Math.max(SIZE_RANGE[0], now + by));
    const steps = by > 0 ? SIZE_STEPS.filter((each) => each > now) : SIZE_STEPS.filter((each) => each < now).reverse();
    return steps[0] ?? now;
}

/** The size for a number typed into the field: kept as typed in a `.quire` document, the nearest Markdown step in a Markdown file. */
export function typedSize(number: number, rich: boolean): number {
    if (!Number.isFinite(number)) return BASE_SIZE;
    if (rich) return Math.min(SIZE_RANGE[1], Math.max(SIZE_RANGE[0], Math.round(number)));
    return SIZE_STEPS.reduce((best, each) => (Math.abs(each - number) < Math.abs(best - number) ? each : best));
}

// ---- formatting, copied and cleared ----

/** How text looks: its marks and its look, as paint format copies it. */
export interface Format {
    marks: Mark[];
    color?: string;
    size?: string;
    font?: string;
    highlight?: string;
}

/** How the text at a position looks: the character before it, or with `after` the one after it (the first of a selection). */
export function formatAt(doc: Document, at: Position, after = false): Format {
    const block = blockAt(doc, at.path);
    const runs: Run[] = block?.kind === "paragraph" || block?.kind === "heading" ? block.runs : [];
    const leaves = runs.flatMap((run) => (run.kind === "link" ? run.runs : [run]));
    const wanted = after ? at.offset : Math.max(0, at.offset - 1);
    let offset = 0;
    for (const leaf of leaves) {
        const length = runsLength([leaf]);
        if (leaf.kind === "text" && wanted >= offset && wanted < offset + length) return { marks: [...leaf.marks], color: leaf.color, size: leaf.size, font: leaf.font, highlight: leaf.highlight };
        offset += length;
    }
    return { marks: [] };
}

/** Gives the selection (or the word at the cursor) exactly a format: its marks on and every other off, its look and no other. Links stay. */
export function applyFormat(format: Format): Action {
    return (state) => {
        const range = reach(state);
        let doc = state.doc;
        for (const each of ["code", "bold", "italic", "strike", "underline"] as Mark[]) doc = toggleMark(doc, range, each, format.marks.includes(each));
        doc = setStyle(doc, range, { color: format.color ?? null, size: format.size ?? null, font: format.font ?? null, highlight: format.highlight ?? null });
        return { ...state, doc };
    };
}

/** Clear formatting: the marks and the look taken off, the links left. */
export const clearFormat: Action = applyFormat({ marks: [] });

/** Indent less or more: a list item moved out of or into the item before it; nothing outside a list. */
export function indentBy(by: -1 | 1): Action {
    return (state) => {
        const at = state.selection.focus;
        if (!activeBlock(state.doc, at.path).list) return state;
        const doc = by > 0 ? indent(state.doc, at.path) : outdent(state.doc, at.path);
        if (doc === state.doc) return state;
        return { doc, selection: { anchor: { path: sameLeaf(state.doc, state.selection.anchor.path, doc), offset: state.selection.anchor.offset }, focus: { path: sameLeaf(state.doc, at.path, doc), offset: at.offset } } };
    };
}

// ---- the DOM ----

/** What the bar needs from the editor around it. */
export interface BarOptions {
    name: string;
    /** Opens the documents list from the name. */
    onName?: (from: HTMLElement) => void;
    /** The colors offered for text, by name. */
    colors?: { name: string; value: string }[];
    onImage?: (file: File) => Promise<string>;
    /** Lines of the page's own that are in no menu (`bun run edit`'s Publish), put in the three dots after the folded tools. */
    more?: MenuItem[] | (() => MenuItem[]);
    /** Opens the link field for the selection. */
    onLink?: (from: HTMLElement) => void;
    /** Opens find and replace. */
    onFind?: () => void;
    onPrint?: () => void;
    /** Opens checking, from the spelling button. */
    onSpelling?: (from: HTMLElement) => void;
    /** Opens the zoom's menu. */
    onZoom?: (from: HTMLElement) => void;
    /** Goes to the title, the line above the writing, as the style Title does. */
    onTitle?: () => void;
}

/** One control of the bar, or a few that go together: how soon it folds into the three dots when the bar is too narrow (0 never, then 1 first), and what it puts there. */
interface Tool {
    element: HTMLElement;
    fold: number;
    lines: () => MenuItem[];
    /** For a `.quire` document alone: away while the document is Markdown. */
    rich?: boolean;
    /** How much wider it is open than shut, for a button that grows open in place; the bar keeps that much room for it. */
    extra?: () => number;
    width: number;
}

/**
 * The order the tools fold in as the bar narrows, least used first: paint format, print, clear
 * formatting, the indents and line spacing, as she gave them, then zoom, spelling, the typeface, the
 * highlight, the size, strikethrough, underline, text color and redo. What a writer needs most stays
 * longest, as she asked: picture, alignment, link, the style, italic, the lists, bold, and undo last.
 */
export const FOLDS = { paint: 1, print: 2, clear: 3, indent: 4, spacing: 5, zoom: 6, spelling: 7, font: 8, highlight: 9, size: 10, strike: 11, underline: 12, color: 13, redo: 14, picture: 15, align: 16, link: 17, style: 18, italic: 19, lists: 20, bold: 21, undo: 22 } as const;

/** How long a message in the status stays before how saving stands comes back, in milliseconds. */
export const STATUS_PASSES = 5000;

/** Builds the bar for a surface. */
export function createBar(surface: Surface, options: BarOptions) {
    const bar = make("div", "quire-bar");
    bar.setAttribute("role", "toolbar");
    bar.setAttribute("aria-label", "Formatting");
    const strip = make("div", "quire-bar-strip");
    bar.append(strip);
    const doing = (action: Action) => () => {
        surface.run((doc, selection) => action({ doc, selection }));
        surface.focus();
    };
    const tools: Tool[] = [];
    let richOn = false;
    /** A group of tools, parted from the one before by a thin rule. */
    const group = (...parts: Omit<Tool, "width">[]) => {
        const element = make("div", "quire-bar-group");
        for (const part of parts) {
            // each tool is held in a box of its own that folds, so that the tool keeps its own width to be measured by
            const holder = make("span", "quire-tool");
            holder.append(part.element);
            element.append(holder);
            tools.push({ ...part, element: holder, width: 0 });
        }
        strip.append(element);
        return element;
    };
    const tool = (element: HTMLElement, fold: number, lines: () => MenuItem[] = () => [], rich = false) => ({ element, fold, lines, rich });
    const apple = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);
    /** A tooltip with its shortcut, as this computer writes it. */
    const named = (label: string, command?: string) => tip(label, command, apple);
    /** Several controls folding as one. */
    const cluster = (...controls: HTMLElement[]) => {
        const element = make("span", "quire-tool-set");
        element.append(...controls);
        return element;
    };
    const opener = (menu: Menu, label: string, content: string | Node, lines: () => MenuItem[] | HTMLElement) => {
        const button = control(label, content, (pressed) => {
            if (menu.isOpen()) return menu.close(true);
            menu.open(pressed, lines(), document.activeElement === pressed);
        });
        button.setAttribute("aria-haspopup", "menu");
        return button;
    };

    // the three dots, made first because folded tools open their menus from them
    const moreButton = dots("More tools");

    // the document's name, which the page puts at the end of its trail: pressed, the documents list grows out of it
    const name = make("button", "quire-button quire-name");
    name.type = "button";
    name.setAttribute("aria-haspopup", "menu");
    const nameText = make("span", "quire-name-text", options.name);
    name.append(nameText, icon("chevron"));
    const fitName = (value: string) => {
        nameText.textContent = value;
        name.title = value;
        name.setAttribute("aria-label", `${value}: documents`);
    };
    fitName(options.name);
    name.addEventListener("mousedown", (event) => event.preventDefault());
    name.addEventListener("click", () => options.onName?.(name));

    // ---- undo, redo, print, spelling, paint format ----
    const undo = () => {
        surface.undo();
        surface.focus();
    };
    const redo = () => {
        surface.redo();
        surface.focus();
    };
    const print = () => options.onPrint?.();
    // paint format: the look of the selection is held, and given to the next text selected
    let held: Format | undefined;
    const paintButton = control("Paint format", icon("paint"), () => (held ? hold(undefined) : hold(formatAt(surface.getDocument(), rangeOf(surface.getSelection()).start, !collapsed(surface.getSelection())))));
    paintButton.setAttribute("aria-pressed", "false");
    const hold = (format: Format | undefined) => {
        held = format;
        paintButton.setAttribute("aria-pressed", String(!!format));
        paintButton.classList.toggle("pressed", !!format);
        surface.element.classList.toggle("painting", !!format);
        if (format) surface.focus();
    };
    // the format is given once a selection is made: when the mouse is let go or the keys that select are let up
    const paintNow = () => {
        if (!held || collapsed(surface.getSelection())) return;
        const format = held;
        hold(undefined);
        doing(applyFormat(format))();
    };
    const paintKeys = (event: KeyboardEvent) => {
        if (held && event.key === "Escape") hold(undefined);
        else if (event.key === "Shift") paintNow();
    };
    surface.element.addEventListener("pointerup", () => setTimeout(paintNow));
    surface.element.addEventListener("keyup", paintKeys);
    group(
        tool(control(named("Undo", "undo"), icon("undo"), undo), FOLDS.undo, () => [{ label: "Undo", icon: "undo", hint: "Ctrl+Z", run: undo }]),
        tool(control(named("Redo", "redo"), icon("redo"), redo), FOLDS.redo, () => [{ label: "Redo", icon: "redo", hint: "Ctrl+Shift+Z", run: redo }]),
        tool(control(named("Print", "print"), icon("print"), print), FOLDS.print, () => [{ label: "Print", icon: "print", hint: "Ctrl+P", run: print }]),
        tool(control("Spelling", icon("spelling"), (button) => options.onSpelling?.(button)), FOLDS.spelling, () => [{ label: "Spelling", icon: "spelling", run: () => options.onSpelling?.(moreButton) }]),
        tool(paintButton, FOLDS.paint, () => [{ label: "Paint format", icon: "paint", run: () => paintButton.click() }]),
    );

    // ---- zoom ----
    const zoomLabel = make("span", "quire-zoom-label", "100%");
    const zoomButton = control("Zoom", zoomLabel, (button) => options.onZoom?.(button), "quire-button quire-zoom");
    zoomButton.append(icon("chevron"));
    zoomButton.setAttribute("aria-haspopup", "menu");
    group(tool(zoomButton, FOLDS.zoom, () => [{ label: "Zoom", hint: "›", run: () => options.onZoom?.(moreButton) }]));

    // ---- the style ----
    const styles = flowMenu("Style");
    const styleLabel = make("span", "quire-style-label", STYLES[0]![1]);
    // Title does not restyle the line: the title is the line above the writing, and the status says the cursor went there
    const toTitle = () => {
        options.onTitle?.();
        say("At the title", "The title is the line above the writing: the cursor is there now");
    };
    const styleLines = (): MenuItem[] => {
        const now = currentStyle(surface.getDocument(), surface.getSelection().focus.path);
        // a subtitle is kept only by a .quire document
        const offered = STYLES.filter(([style]) => style !== "subtitle" || !!surface.getDocument().quire);
        return offered.map(([style, label]) => ({ label, pressed: style === now, icon: sample(style), run: style === "title" ? toTitle : doing(setStyleOf(style)) }));
    };
    const styleButton = opener(styles, "Style", styleLabel, styleLines);
    styleButton.classList.add("quire-style");
    styleButton.append(icon("chevron"));
    group(tool(styleButton, FOLDS.style, () => [{ label: "Style", hint: "›", run: () => styles.open(moreButton, styleLines(), true) }]));

    // ---- the typeface ----
    const fonts = flowMenu("Typeface");
    const fontSample = (value: string | null) => {
        const shown = make("span", "quire-font-sample", "Ag");
        if (value) shown.dataset.font = value;
        return shown;
    };
    const fontLines = (): MenuItem[] => FONTS.map(([label, value]) => ({ label, icon: fontSample(value), run: doing(font(value)) }));
    const fontLabel = make("span", "quire-font-label", FONTS[0]![0]);
    const fontButton = opener(fonts, "Typeface", fontLabel, fontLines);
    fontButton.classList.add("quire-font");
    fontButton.append(icon("chevron"));
    group(tool(fontButton, FOLDS.font, () => [{ label: "Typeface", hint: "›", run: () => fonts.open(moreButton, fontLines(), true) }], true));

    // ---- the size: a number with minus and plus either side, typed into as well ----
    const sizes = flowMenu("Text size");
    const sizeAt = () => sizeNumber(formatAt(surface.getDocument(), rangeOf(surface.getSelection()).start, !collapsed(surface.getSelection())).size);
    const setSize = (number: number) => {
        doing(size(sizeValue(number)))();
        showSize();
    };
    const sizeField = make("input", "quire-size-field");
    sizeField.type = "text";
    sizeField.inputMode = "numeric";
    sizeField.setAttribute("aria-label", "Text size");
    sizeField.title = "Text size";
    // Enter applies the size and gives the text the focus back, and the field's change on losing the focus must not apply it again
    let entered = false;
    // clicked or reached, the number is selected, so that what is typed takes its place (typing 17 into 12 made 1172)
    let selecting = false;
    sizeField.addEventListener("focus", () => {
        entered = false;
        selecting = true;
        sizeField.select();
    });
    // the click's own mouseup would put a caret where it was let go, so the one that ends the focusing click is held back
    sizeField.addEventListener("mouseup", (event) => {
        if (selecting) event.preventDefault();
        selecting = false;
    });
    sizeField.addEventListener("keydown", (event) => {
        selecting = false;
        if (composing(event)) return;
        if (event.key === "Enter") {
            event.preventDefault();
            entered = true;
            setSize(typedSize(parseFloat(sizeField.value), richOn));
        } else if (event.key === "Escape") {
            // the old number back and nothing changed: the field is let go first, as showSize leaves a field being typed in alone
            event.preventDefault();
            entered = true;
            surface.focus();
            showSize();
        }
    });
    sizeField.addEventListener("change", () => {
        if (!entered) setSize(typedSize(parseFloat(sizeField.value), richOn));
    });
    const showSize = () => {
        if (document.activeElement === sizeField) return;
        const was = parseFloat(sizeField.value);
        const now = sizeAt();
        if (was === now) return;
        sizeField.value = String(now);
        // the new number rolls in from the side it went: up from below for larger, down from above for smaller
        // (its box stays still: only the number inside moves, pushed by the padding, and comes clear)
        if (!Number.isNaN(was) && !still()) sizeField.animate([now > was ? { paddingTop: "0.9em", color: "transparent" } : { paddingBottom: "0.9em", color: "transparent" }], { duration: 220, easing: "cubic-bezier(0.22, 1, 0.36, 1)" });
    };
    const sizeLines = (): MenuItem[] => {
        const now = sizeAt();
        return sizesOffered(richOn).map((number) => ({ label: String(number), pressed: number === now, run: () => setSize(number) }));
    };
    group(
        tool(
            cluster(control(named("Smaller", "smaller"), icon("minus"), () => setSize(nextSize(sizeAt(), -1, richOn)), "quire-button quire-size-step"), sizeField, control(named("Larger", "bigger"), icon("plus"), () => setSize(nextSize(sizeAt(), 1, richOn)), "quire-button quire-size-step")),
            FOLDS.size,
            () => [{ label: "Text size", hint: "›", run: () => sizes.open(moreButton, sizeLines(), true) }],
        ),
    );

    // ---- bold, italic, underline, strikethrough, text colour, highlight ----
    const pressable = new Map<string, HTMLButtonElement>();
    const press = (key: string, label: string, content: string | Node, action: () => void) => {
        const button = control(label, content, action);
        button.setAttribute("aria-pressed", "false");
        pressable.set(key, button);
        return button;
    };
    const palette = () => [...(options.colors ?? []), ...FLAGS];
    const colors = flowMenu("Text color");
    const highlights = flowMenu("Highlight");
    /**
     * A grid of swatches, as Docs has, each named in its tooltip, under a line that takes the color
     * off; the one at the cursor is pressed. The arrows move across and down it.
     */
    const swatches = (menu: Menu, none: string, now: string | undefined, give: (value: string | null) => Action, mark = false) => {
        const whole = make("div", "quire-swatches");
        const take = (value: string | null) => () => {
            menu.close(false);
            doing(give(value))();
        };
        const off = control(none, make("span", "quire-menu-label", none), take(null), "quire-menu-line");
        const grid = make("div", "quire-swatch-grid");
        grid.setAttribute("role", "group");
        grid.setAttribute("aria-label", menu.box.getAttribute("aria-label") ?? "");
        for (const each of palette()) {
            const dot = make("span", `quire-swatch${mark ? " quire-swatch-mark" : ""}`);
            dot.style.background = each.value;
            const button = control(each.name, dot, take(each.value), "quire-button quire-swatch-button");
            button.setAttribute("aria-pressed", String(each.value === now));
            button.classList.toggle("pressed", each.value === now);
            grid.append(button);
        }
        // across a row with the side arrows and between rows with up and down, the way the swatches are drawn
        grid.addEventListener("keydown", (event) => {
            const all = [...grid.children] as HTMLElement[];
            const at = all.indexOf(document.activeElement as HTMLElement);
            const across = Math.round(grid.offsetWidth / (all[0]?.offsetWidth || 1)) || 1;
            const by = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -across, ArrowDown: across }[event.key];
            if (by === undefined || at < 0) return;
            event.preventDefault();
            event.stopPropagation();
            const next = at + by;
            (next < 0 ? off : all[Math.min(next, all.length - 1)])!.focus();
        });
        whole.append(off, grid);
        return whole;
    };
    const look = () => formatAt(surface.getDocument(), rangeOf(surface.getSelection()).start, !collapsed(surface.getSelection()));
    const colorGrid = () => swatches(colors, "Default color", look().color, color);
    const highlightGrid = () => swatches(highlights, "No highlight", look().highlight, highlight, true);
    const colorMark = make("span", "quire-color-mark", "A");
    const highlightButton = opener(highlights, "Highlight", icon("highlight"), highlightGrid);
    highlightButton.classList.add("quire-highlight-button");
    group(
        tool(press("bold", named("Bold", "bold"), glyph("B", "bold"), doing(toggle("bold"))), FOLDS.bold, () => [{ label: "Bold", hint: "Ctrl+B", run: doing(toggle("bold")) }]),
        tool(press("italic", named("Italic", "italic"), glyph("I", "italic"), doing(toggle("italic"))), FOLDS.italic, () => [{ label: "Italic", hint: "Ctrl+I", run: doing(toggle("italic")) }]),
        tool(press("underline", named("Underline", "underline"), glyph("U", "underline"), doing(toggle("underline"))), FOLDS.underline, () => [{ label: "Underline", hint: "Ctrl+U", run: doing(toggle("underline")) }]),
        tool(press("strike", named("Strikethrough", "strike"), glyph("S", "strike"), doing(toggle("strike"))), FOLDS.strike, () => [{ label: "Strikethrough", hint: "Alt+Shift+5", run: doing(toggle("strike")) }]),
        tool(opener(colors, "Text color", colorMark, colorGrid), FOLDS.color, () => [{ label: "Text color", hint: "›", run: () => colors.open(moreButton, colorGrid(), true) }]),
        tool(highlightButton, FOLDS.highlight, () => [{ label: "Highlight", icon: "highlight", hint: "›", run: () => highlights.open(moreButton, highlightGrid(), true) }], true),
    );

    // ---- link, picture ----
    const chooser = make("input");
    chooser.type = "file";
    chooser.accept = "image/*";
    chooser.className = "quire-file";
    chooser.tabIndex = -1;
    chooser.setAttribute("aria-hidden", "true");
    chooser.addEventListener("change", async () => {
        const file = chooser.files?.[0];
        chooser.value = "";
        if (!file || !options.onImage) return;
        // a store that cannot keep the picture says why, and nothing is put in the text
        const address = await options.onImage(file).catch(() => undefined);
        if (!address) return;
        doing(addImage(address, file.name.replace(/\.[^.]+$/, "")))();
    });
    bar.append(chooser);
    group(
        tool(control(named("Link", "link"), icon("link"), (button) => options.onLink?.(button)), FOLDS.link, () => [{ label: "Link", icon: "link", hint: "Ctrl+K", run: () => options.onLink?.(moreButton) }]),
        tool(control("Picture", icon("image"), () => chooser.click()), FOLDS.picture, () => [{ label: "Picture", icon: "image", run: () => chooser.click() }]),
    );

    // ---- alignment and the lists: one button each, growing open in place into its choices ----

    /** Lays the bar out again once a button that grew open has closed (layout is made below). */
    let settled = () => {};
    /**
     * One button for a few choices side by side, showing the one at the cursor. Pressed, it grows
     * open in place into all of them, as dictation's Choose grows into its cards (growsFrom), the
     * tools after it sliding aside to make room and back again after; it is not a menu and covers
     * nothing. A choice, Escape or a press elsewhere closes it back to one. The keyboard stays on the
     * button: while it is open the side arrows move a lit mark along the choices, and Enter or Space
     * takes the lit one. Each choice's value is also the name of its command, for its shortcut.
     */
    const choices = <T extends string>(label: string, kinds: [T, string][], take: (value: T) => Action, offered: () => T[]) => {
        const element = make("span", "quire-grow");
        const main = control(label, icon(kinds[0]![0]), () => (open ? pick(lit, true) : grow()), "quire-button quire-grow-main");
        const row = make("span", "quire-grow-row");
        row.id = `quire-grow-row-${label.toLowerCase()}`;
        row.setAttribute("role", "listbox");
        row.setAttribute("aria-label", label);
        main.setAttribute("role", "combobox");
        main.setAttribute("aria-haspopup", "listbox");
        main.setAttribute("aria-expanded", "false");
        main.setAttribute("aria-controls", row.id);
        const buttons = new Map(
            kinds.map(([value, name]) => {
                const button = control(named(name, value), icon(value), () => pick(value, false), "quire-button quire-grow-line");
                button.id = `${row.id}-${value}`;
                button.setAttribute("role", "option");
                return [value, button] as const;
            }),
        );
        element.append(main, row);
        let open = false;
        let now: T | undefined;
        let lit = kinds[0]![0];
        const mark = () => {
            for (const [value, button] of buttons) button.classList.toggle("lit", value === lit);
            main.setAttribute("aria-activedescendant", buttons.get(lit)!.id);
        };
        /** The change from shut to open or back, made at once; the width it makes is then eased to, and the new face grows out of `from`. */
        const move = (from: HTMLElement, change: () => void, opening: boolean) => {
            const before = element.offsetWidth;
            const sweep = growsFrom(from);
            change();
            const after = element.offsetWidth;
            // on a phone, where no room is kept for it, the row slides along so that the open choices are clear of the end
            const over = element.getBoundingClientRect().left + after - end.getBoundingClientRect().left;
            if (opening && over > 0) strip.scrollBy({ left: over + 4, behavior: still() ? "instant" : "smooth" });
            if (still()) return settled();
            element.classList.add("moving");
            sweep(opening ? row : main, element, MOTION.open);
            const width = element.animate([{ width: `${before}px` }, { width: `${after}px` }], { duration: opening ? MOTION.open : MOTION.close + 60, easing: opening ? springCurve(MOTION.bounce) : EASE });
            const done = () => {
                element.classList.remove("moving");
                if (!open) settled();
            };
            void width.finished.then(done, done);
        };
        // while it is open a press anywhere else, or Escape wherever the keyboard is, closes it with nothing changed
        const outside = (event: PointerEvent) => !element.contains(event.target as Node) && shut();
        const escape = (event: KeyboardEvent) => {
            if (event.key !== "Escape") return;
            event.preventDefault();
            event.stopPropagation();
            shut();
        };
        const grow = () => {
            closeOthers();
            row.replaceChildren(...offered().map((value) => buttons.get(value)!));
            lit = now && offered().includes(now) ? now : offered()[0]!;
            mark();
            main.classList.add("open");
            move(main, () => {
                open = true;
                element.classList.add("open");
                main.setAttribute("aria-expanded", "true");
            }, true);
            document.addEventListener("pointerdown", outside, true);
            document.addEventListener("keydown", escape, true);
        };
        const shut = (from = buttons.get(lit)!) => {
            if (!open) return;
            open = false;
            document.removeEventListener("pointerdown", outside, true);
            document.removeEventListener("keydown", escape, true);
            move(from, () => {
                element.classList.remove("open");
                main.classList.remove("open");
                main.setAttribute("aria-expanded", "false");
                main.removeAttribute("aria-activedescendant");
            }, false);
        };
        /** A choice taken: from the keyboard the focus stays on the button, from the mouse it goes back to the writing. */
        const pick = (value: T, keyboard: boolean) => {
            const action = take(value);
            surface.run((doc, selection) => action({ doc, selection }));
            shut(buttons.get(value));
            if (!keyboard) surface.focus();
        };
        main.addEventListener("keydown", (event) => {
            if (!open) return;
            const all = offered();
            const next = moveIndex(all.indexOf(lit), event.key, all.length);
            // up and down would open it again or move along the bar; while it is open they do nothing
            if (next === undefined && event.key !== "ArrowUp" && event.key !== "ArrowDown") return;
            event.preventDefault();
            event.stopPropagation();
            if (next === undefined) return;
            lit = all[next]!;
            mark();
        });
        main.addEventListener("blur", () => shut());
        let shownIcon = kinds[0]![0];
        return {
            element,
            /** Shows the choice at the cursor on the button, pressed when `pressed`, and the same among the choices. */
            show(value: T | undefined, pressed: boolean) {
                now = value;
                const face = value ?? kinds[0]![0];
                if (face !== shownIcon) main.replaceChildren(icon((shownIcon = face)));
                main.classList.toggle("pressed", pressed);
                for (const [each, button] of buttons) {
                    button.classList.toggle("pressed", each === value);
                    button.setAttribute("aria-selected", String(each === value));
                }
            },
            /** Its choices as lines of the three dots, for when it has folded there. */
            lines: (): MenuItem[] => offered().map((value) => ({ label: kinds.find(([each]) => each === value)![1], icon: value, pressed: value === now, run: doing(take(value)) })),
            /** How much wider it is open than shut. */
            extra: () => Math.max(0, offered().length - 1) * (main.offsetWidth + 2),
            shut: () => shut(),
        };
    };

    // justified is for a .quire document alone
    const alignment = choices("Alignment", ALIGNS, align, () => ALIGNS.map(([value]) => value).filter((value) => value !== "justify" || richOn));
    group({ ...tool(alignment.element, FOLDS.align, alignment.lines), extra: alignment.extra });

    // ---- line spacing ----
    const spacings = flowMenu("Line spacing");
    const spacingLines = (): MenuItem[] => {
        const now = spacedAt(surface.getDocument(), surface.getSelection().focus.path);
        return SPACINGS.map(([label, value]) => ({ label, pressed: now === value, run: doing(spacing(value)) }));
    };
    group(tool(opener(spacings, "Line spacing", icon("spacing"), spacingLines), FOLDS.spacing, () => [{ label: "Line spacing", icon: "spacing", hint: "›", run: () => spacings.open(moreButton, spacingLines(), true) }], true));

    // ---- checklist, bulleted list, numbered list: the button shows the cursor's list, and its own kind again turns the list off ----
    const lists = choices("Lists", LISTS, toggleList, () => LISTS.map(([kind]) => kind));
    group({ ...tool(lists.element, FOLDS.lists, lists.lines), extra: lists.extra });

    // ---- indent less, indent more ----
    group(
        tool(cluster(control(named("Indent less", "outdent"), icon("outdent"), doing(indentBy(-1))), control(named("Indent more", "indent"), icon("indent"), doing(indentBy(1)))), FOLDS.indent, () => [
            { label: "Indent less", icon: "outdent", hint: "Ctrl+[", run: doing(indentBy(-1)) },
            { label: "Indent more", icon: "indent", hint: "Ctrl+]", run: doing(indentBy(1)) },
        ]),
    );

    // ---- clear formatting ----
    group(tool(control(named("Clear formatting", "clear"), icon("clear"), doing(clearFormat)), FOLDS.clear, () => [{ label: "Clear formatting", icon: "clear", hint: "Ctrl+\\", run: doing(clearFormat) }]));

    // ---- at the right end: find, the three dots and the microphone (the editor adds that) ----
    // the dots hold the tools that did not fit, in the bar's order, and the page's own lines; with none of either they fold away too
    const more = flowMenu("More tools", { align: "right" });
    const own = () => (typeof options.more === "function" ? options.more() : (options.more ?? []));
    const folded = () => tools.filter((each) => each.element.classList.contains("folded") && !each.element.classList.contains("away"));
    moreButton.addEventListener("click", () => {
        if (more.isOpen()) return more.close(true);
        more.open(moreButton, [...folded().flatMap((each) => each.lines()), ...own()], document.activeElement === moreButton);
    });
    moreButton.setAttribute("aria-haspopup", "menu");
    const end = make("div", "quire-bar-group quire-bar-end");
    if (options.onFind) end.append(control(named("Find", "find"), icon("find"), () => options.onFind!()));
    const dotsHolder = make("span", "quire-tool");
    dotsHolder.append(moreButton);
    end.append(dotsHolder);
    strip.append(end);

    // how saving stands and the word count, "Saved · 7 words", which the page puts at the right of its first line
    // the count is not announced as it changes, which in a run of typing would be every quarter second; the word count dialog says it on request
    const count = make("span", "quire-count");
    const status = make("span", "quire-status");
    status.setAttribute("role", "status");
    let words = make("span", "quire-status-words here");
    status.append(words);
    const statusLine = make("p", "quire-status-line");
    const dot = make("span", "quire-status-dot", "·");
    dot.setAttribute("aria-hidden", "true");
    statusLine.append(status, dot, count);
    const showStatus = (short: string, full: string, tone: "quiet" | "warn") => {
        status.title = full;
        status.setAttribute("aria-label", full);
        status.classList.toggle("warn", tone === "warn");
        // with nothing said about saving, the dot goes with it (a class, so that no rule has to look inside to know)
        statusLine.classList.toggle("unsaid", !short);
        if (words.textContent === short) return;
        // the new words fade in where the old ones fade out, so that nothing beside them moves
        const leaving = words;
        words = make("span", "quire-status-words", short);
        status.append(words);
        leaving.classList.remove("here");
        requestAnimationFrame(() => words.classList.add("here"));
        setTimeout(() => leaving.remove(), 400);
    };
    /** How saving stands, which stays until it changes; a message passes after a few seconds and gives the place back to it. */
    let standing: [string, string, "quiet" | "warn"] = ["", "", "quiet"];
    let passing: ReturnType<typeof setTimeout> | undefined;
    const say = (short: string, full: string, tone: "quiet" | "warn" = "quiet", stays = false) => {
        clearTimeout(passing);
        if (stays) standing = [short, full, tone];
        else passing = setTimeout(() => showStatus(...standing), STATUS_PASSES);
        showStatus(short, full, tone);
    };

    // ---- folding what does not fit ----

    /** Gives the bar its Tab stop back when the control that held it has folded away (set once the stops are known, below). */
    let keepStop: (() => void) | undefined;

    /**
     * Folds the tools that do not fit, least used first, so that nothing wraps and nothing has to be
     * slid to, at every width; but for a phone's, room is kept for the widest button that grows open
     * in place to open into. While one is open, or moving, the bar is left as it is, so that nothing
     * moves by itself.
     */
    function layout() {
        if (strip.querySelector(".quire-grow:is(.open, .moving)")) return;
        for (const each of tools) {
            const away = !!each.rich && !richOn;
            each.element.classList.toggle("away", away);
            each.width = (each.element.firstElementChild as HTMLElement).offsetWidth + 2;
        }
        const shown = new Set(tools.filter((each) => !each.element.classList.contains("away")));
        const groups = [...strip.querySelectorAll<HTMLElement>(".quire-bar-group:not(.quire-bar-end)")];
        // the rule between two groups and the space each side of it, 0.4rem and 0.4rem and a line (quire.css)
        const rem = parseFloat(getComputedStyle(document.documentElement).fontSize) || 16;
        const ruleWidth = 0.8 * rem + 1;
        // a phone has no room to keep for a button to grow into: there it slides the row along instead
        const narrow = typeof matchMedia !== "undefined" && matchMedia("(max-width: 40rem)").matches;
        // the end is measured with the three dots in it, as they come back the moment anything folds
        const endWidth = end.offsetWidth - dotsHolder.offsetWidth + moreButton.offsetWidth;
        const needed = () => {
            let sum = endWidth;
            for (const element of groups) {
                const inside = tools.filter((each) => shown.has(each) && element.contains(each.element));
                if (inside.length) sum += inside.reduce((total, each) => total + each.width, 0) + ruleWidth;
            }
            if (!narrow) sum += Math.max(0, ...tools.filter((each) => shown.has(each) && each.extra).map((each) => each.extra!()));
            // the first group shown has no rule before it
            return sum - ruleWidth;
        };
        const room = strip.clientWidth - 2;
        const folding = [...tools].filter((one) => shown.has(one)).sort((a, b) => a.fold - b.fold);
        const folded: Tool[] = [];
        for (const each of folding) {
            if (needed() <= room) break;
            shown.delete(each);
            folded.push(each);
        }
        // what was folded on the way and fits in the room left comes back, most needed first; one that does not fit keeps every less needed one folded too, so that the order holds
        for (const each of folded.reverse()) {
            shown.add(each);
            if (needed() <= room) continue;
            shown.delete(each);
            break;
        }
        const dotsFold = !tools.some((each) => !shown.has(each) && !each.element.classList.contains("away")) && !own().length;
        dotsHolder.classList.toggle("folded", dotsFold);
        dotsHolder.inert = dotsFold;
        for (const each of tools) {
            const fold = !shown.has(each);
            each.element.classList.toggle("folded", fold);
            each.element.inert = fold;
        }
        for (const element of groups) element.classList.toggle("folded", !tools.some((each) => shown.has(each) && element.contains(each.element)));
        // the first group still shown has no rule before it, so that the line starts on the same edge as the one above
        const lead = groups.find((element) => !element.classList.contains("folded"));
        for (const element of groups) element.classList.toggle("lead", element === lead);
        keepStop?.();
    }
    // laid out again when the room changes, when a tool's own width does (a label, a typeface arriving) and when the fonts have come
    let waiting = 0;
    const soon = () => (waiting ||= requestAnimationFrame(() => ((waiting = 0), layout())));
    settled = soon;
    if (typeof ResizeObserver !== "undefined") {
        const watcher = new ResizeObserver(soon);
        watcher.observe(strip);
        for (const each of tools) watcher.observe(each.element.firstElementChild!);
    }
    void document.fonts?.ready.then(soon);

    // ---- keeping it true to the cursor ----

    // each top-level block's words are kept by the block, so that a count after a key reads again only the block it changed
    const wordsIn = new WeakMap<Block, number>();
    const counted = (doc: Document) => {
        let words = 0;
        for (const block of doc.blocks) {
            let own = wordsIn.get(block);
            if (own === undefined) wordsIn.set(block, (own = countWords({ ...doc, blocks: [block] })));
            words += own;
        }
        count.textContent = `${words.toLocaleString("en")} ${words === 1 ? "word" : "words"}`;
    };
    counted(surface.getDocument());
    // The count is made after the keystroke, never inside it (counting a long document's every word
    // took most of the 16 ms a key may take), and at most every 250 ms in a run of typing; a change
    // after a quiet moment (a document opened) is shown as soon as the key's work is done.
    let counting: ReturnType<typeof setTimeout> | undefined;
    let countingWaiting: Document | undefined;
    let countedAt = -Infinity;
    surface.on("change", ({ doc }) => {
        countingWaiting = doc;
        if (counting) return;
        counting = setTimeout(
            () => {
                counting = undefined;
                countedAt = performance.now();
                const next = countingWaiting!;
                countingWaiting = undefined;
                counted(next);
            },
            Math.max(0, countedAt + 250 - performance.now()),
        );
    });
    surface.on("select", ({ selection, marks }) => {
        const doc = surface.getDocument();
        const now = pressedAt(doc, selection.focus.path, marks);
        for (const [key, button] of pressable) {
            const on = now[key as keyof typeof now];
            button.setAttribute("aria-pressed", String(on));
            button.classList.toggle("pressed", on);
        }
        alignment.show(aligned(doc, selection.focus.path), false);
        const list = activeBlock(doc, selection.focus.path).list;
        lists.show(list, !!list);
        const style = currentStyle(doc, selection.focus.path);
        styleLabel.textContent = STYLES.find(([each]) => each === style)![1];
        const format = formatAt(doc, rangeOf(selection).start, !collapsed(selection));
        fontLabel.textContent = FONTS.find(([, value]) => value === (format.font ?? null))?.[0] ?? FONTS[0]![0];
        colorMark.style.borderBottomColor = format.color ?? "";
        highlightButton.style.setProperty("--mark", format.highlight ?? "currentColor");
        showSize();
    });

    // ---- the keyboard: one stop for Tab, the arrows along it ----

    // a grown button's choices are not stops of their own: the keyboard stays on the button while they are open
    const stops = () => [...strip.querySelectorAll<HTMLElement>("button, input")].filter((each) => !each.closest(".folded, .away, .quire-grow-row"));
    const rove = (current: HTMLElement) => {
        for (const each of strip.querySelectorAll<HTMLElement>("button, input")) each.tabIndex = each === current ? 0 : -1;
    };
    rove(stops()[0]!);
    // the one Tab stop may be a tool that has just folded away; then the first one left takes it
    keepStop = () => {
        const all = stops();
        if (all.length && !all.some((each) => each.tabIndex === 0)) rove(all[0]!);
    };
    strip.addEventListener("focusin", (event) => {
        if (stops().includes(event.target as HTMLElement)) rove(event.target as HTMLElement);
    });
    strip.addEventListener("keydown", (event) => {
        const all = stops();
        const at = all.indexOf(document.activeElement as HTMLElement);
        if (at < 0) return;
        // in the size field the side arrows move through the number
        if (document.activeElement === sizeField && (event.key === "ArrowLeft" || event.key === "ArrowRight" || event.key === "Home" || event.key === "End")) return;
        if (event.key === "ArrowDown" && document.activeElement?.getAttribute("aria-haspopup")) {
            event.preventDefault();
            (document.activeElement as HTMLElement).click();
            return;
        }
        const next = moveIndex(at, event.key, all.length);
        if (next === undefined) return;
        event.preventDefault();
        all[next]!.focus();
        all[next]!.scrollIntoView({ block: "nearest", inline: "nearest" });
    });
    const menus = [styles, fonts, sizes, colors, highlights, spacings, more];
    strip.addEventListener("scroll", () => closeOthers(), { passive: true });

    /**
     * The bar's button for a tool if it can be seen, or else the three dots it is folded into: a menu is tied to
     * the control it opens from, and the browser does not draw a menu tied to a control out of sight (folded
     * away, or scrolled out of the strip on a phone), so the menu was open, and its field focused, unseen.
     */
    const seen = (label: string): HTMLElement => {
        const button = bar.querySelector<HTMLElement>(`[aria-label^="${label}"]`);
        const box = button?.getBoundingClientRect();
        if (!button || !box || box.width === 0 || button.closest(".folded, .away")) return moreButton;
        const room = strip.contains(button) ? strip.getBoundingClientRect() : undefined;
        return !room || (box.left >= room.left - 1 && box.right <= room.right + 1) ? button : moreButton;
    };

    return {
        element: bar,
        setName(value: string) {
            fitName(value);
        },
        menus,
        layout,
        statusLine,
        pickImage: () => chooser.click(),
        setZoom(text: string) {
            zoomLabel.textContent = text;
        },
        /** Says something at the right of the first line. A message passes after a few seconds; with `stays`, how saving stands, it stays until the next. */
        setStatus: say,
        name,
        setRich(on: boolean) {
            if (on === richOn) return;
            richOn = on;
            bar.classList.toggle("rich", on);
            // what a Markdown file cannot keep is not offered for one, and its menus close
            if (!on) for (const menu of [fonts, highlights, spacings]) menu.close(false);
            layout();
            showSize();
        },
        rich: () => richOn,
        seen,
        /** Makes the text one size larger or smaller, as the plus and minus beside the size do (Ctrl+Shift+. and Ctrl+Shift+,). */
        sizeBy(by: -1 | 1) {
            setSize(nextSize(sizeAt(), by, richOn));
        },
        destroy() {
            surface.element.removeEventListener("keyup", paintKeys);
            clearTimeout(passing);
            alignment.shut();
            lists.shut();
        },
        // the menus of the colors, size, typeface, highlight and line spacing, opened from somewhere else, as the menu row does
        pickers: {
            color: (from: HTMLElement) => colors.open(from, colorGrid(), true),
            size: (from: HTMLElement) => sizes.open(from, sizeLines(), true),
            font: (from: HTMLElement) => fonts.open(from, fontLines(), true),
            highlight: (from: HTMLElement) => highlights.open(from, highlightGrid(), true),
            spacing: (from: HTMLElement) => spacings.open(from, spacingLines(), true),
        },
    };
}

/** A small sample of what a style looks like, for its line in the picker. */
function sample(style: Style): HTMLElement {
    const shown = make("span", `quire-style-sample quire-style-${style}`, style === "code" ? "{ }" : style === "quote" ? "“" : style === "paragraph" ? "¶" : style === "title" ? "T" : style === "subtitle" ? "S" : `H${style.slice(-1)}`);
    shown.setAttribute("aria-hidden", "true");
    return shown;
}
