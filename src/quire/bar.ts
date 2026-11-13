// The tools, the second line of the editor's top: in Google Docs' order, as she chose it. A search
// of the menus; undo, redo, print, spelling and paint format; zoom; the style; the typeface; the size
// as a number with minus and plus; bold, italic, underline, strikethrough, text colour and highlight;
// link and picture; the four alignments; line spacing; the three lists; indent less and more; clear
// formatting; and at the right end find, the three dots and the microphone. What a Markdown file
// cannot keep (typeface, highlight, line spacing, justified) is away for one. Buttons show as
// pressed when what they do is true at the cursor. It is a toolbar: Tab reaches it once, the arrow
// keys move along it. When it has less room than it needs, its least used tools fold into the
// three dots in a set order (FOLDS); on a narrow window it slides sideways instead.
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
    setAlign,
    setLink,
    setSpacing,
    setSubtext,
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
import { activeBlock, caret, collapsed, mark, pageBreakAt, rangeOf, sameLeaf, tableOf } from "./keys";
import type { Surface } from "./surface";
import { closeOthers, control, dots, flowMenu, glyph, icon, make, moveIndex, still, type Menu, type MenuItem } from "./ui";

/** What a button does: from the state at the cursor to the next one. */
export type Action = (state: State) => State;

/** The kinds of block the style picker offers. */
export type Style = "paragraph" | "heading1" | "heading2" | "heading3" | "heading4" | "heading5" | "heading6" | "quote" | "code";

/** The style picker's lines, in order, with their names. */
export const STYLES: [Style, string][] = [
    ["paragraph", "Paragraph"],
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

/** Which style the cursor's block has, as the style picker shows it. */
export function currentStyle(doc: Document, path: number[]): Style {
    const block = activeBlock(doc, path);
    if (block.kind === "heading") return `heading${block.level ?? 1}` as Style;
    if (block.kind === "code") return "code";
    if (block.quoted) return "quote";
    return "paragraph";
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
    { name: "Pink", value: "#d362a4" },
    { name: "Dark rose", value: "#a30262" },
];

/** Sets the text's size; null takes it off. */
export function size(value: string | null): Action {
    return (state) => ({ ...state, doc: setStyle(state.doc, reach(state), { size: value }) });
}

// ---- kinds of block ----

/** Makes the touched blocks a paragraph, a heading, a quote or code. Quote, pressed in a quote, takes the quote off. */
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
            else if (style === "paragraph") doc = block.kind === "paragraph" ? (inQuote ? changeKind(doc, path, { kind: "paragraph" }) : doc) : changeKind(doc, path, { kind: "paragraph" });
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

/** Makes the touched blocks a list of a kind, or, if they already are one, plain paragraphs again. */
export function toggleList(style: ListStyle): Action {
    return (state) => {
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
    ["center", "Centre"],
    ["right", "Align right"],
    ["justify", "Justify"],
];

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

/** Adds a table of three columns and three rows, the cursor in its first cell. */
export const addTable: Action = (state) => {
    const { doc, path } = put(state, table(["", "", ""], [["", "", ""], ["", "", ""]]));
    return { doc, selection: caret([...path, 0, 0], 0) };
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

/** Adds a picture by its address. */
export function addImage(src: string, alt = ""): Action {
    return addWithLine(imageBlock(src, alt));
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
    /** The lines of the three-dot menu. */
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
    /** Every command by name, for the search of the menus. */
    commands?: () => MenuItem[];
}

/** One control of the bar, or a few that go together: how soon it folds into the three dots when the bar is too narrow (0 never, then 1 first), and what it puts there. */
interface Tool {
    element: HTMLElement;
    fold: number;
    lines: () => MenuItem[];
    /** For a `.quire` document alone: away while the document is Markdown. */
    rich?: boolean;
    width: number;
}

/**
 * The order the tools fold in as the bar narrows, least used first, as she asked: paint format,
 * print, clear formatting, the indents, line spacing; then zoom, spelling, the search of the menus,
 * link and picture, the lists, the colours, the typeface, the size, undo and redo. The style, the
 * marks and the four alignments never fold.
 */
export const FOLDS = { paint: 1, print: 2, clear: 3, indent: 4, spacing: 5, zoom: 6, spelling: 7, search: 8, insert: 9, lists: 10, colors: 11, font: 12, size: 13, undo: 14 } as const;

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
    const moreButton = dots("More");

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

    // ---- the search of the menus: type, and every command whose name has it is a line ----
    const searching = flowMenu("Search the menus", { className: "quire-search-menu" });
    const searchForm = () => {
        const form = make("div", "quire-search");
        const field = make("input", "quire-link-field quire-search-field");
        field.type = "search";
        field.placeholder = "Search the menus";
        field.setAttribute("aria-label", "Search the menus");
        field.spellcheck = false;
        const found = make("div", "quire-search-found");
        found.setAttribute("role", "menu");
        const all = options.commands?.() ?? [];
        const show = () => {
            const wanted = field.value.trim().toLowerCase();
            const matching = wanted ? all.filter((item) => !item.note && item.label.toLowerCase().includes(wanted)).slice(0, 12) : [];
            found.replaceChildren(
                ...matching.map((item) => {
                    const line = make("button", "quire-menu-line");
                    line.type = "button";
                    line.setAttribute("role", "menuitem");
                    if (item.icon) line.append(typeof item.icon === "string" ? icon(item.icon) : item.icon);
                    line.append(make("span", "quire-menu-label", item.label));
                    line.addEventListener("mousedown", (event) => event.preventDefault());
                    line.addEventListener("click", () => {
                        searching.close(false);
                        item.run();
                    });
                    return line;
                }),
            );
            if (wanted && !matching.length) found.append(make("p", "quire-menu-note", "Nothing by that name"));
        };
        field.addEventListener("input", show);
        field.addEventListener("keydown", (event) => {
            if (event.key === "Enter") found.querySelector<HTMLElement>(".quire-menu-line")?.click();
            if (event.key === "ArrowDown") {
                event.preventDefault();
                found.querySelector<HTMLElement>(".quire-menu-line")?.focus();
            }
        });
        form.append(field, found);
        return form;
    };
    const searchButton = control("Search the menus", icon("search"), (button) => {
        if (searching.isOpen()) return searching.close(true);
        searching.open(button, searchForm());
        searching.box.querySelector("input")?.focus({ preventScroll: true });
    });
    searchButton.setAttribute("aria-haspopup", "menu");
    searchButton.classList.add("quire-search-button");
    group(tool(searchButton, FOLDS.search, () => (options.commands ? [{ label: "Search the menus", icon: "search", run: () => (searching.open(moreButton, searchForm()), searching.box.querySelector("input")?.focus({ preventScroll: true })) }] : [])));

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
    const paintButton = control("Paint format: copy the formatting of the selection, then select where it goes", icon("paint"), () => (held ? hold(undefined) : hold(formatAt(surface.getDocument(), rangeOf(surface.getSelection()).start, !collapsed(surface.getSelection())))));
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
        tool(cluster(control("Undo (Ctrl+Z)", icon("undo"), undo), control("Redo (Ctrl+Shift+Z)", icon("redo"), redo)), FOLDS.undo, () => [
            { label: "Undo", icon: "undo", hint: "Ctrl+Z", run: undo },
            { label: "Redo", icon: "redo", hint: "Ctrl+Shift+Z", run: redo },
        ]),
        tool(control("Print (Ctrl+P)", icon("print"), print), FOLDS.print, () => [{ label: "Print", icon: "print", hint: "Ctrl+P", run: print }]),
        tool(control("Spelling and checking", icon("spelling"), (button) => options.onSpelling?.(button)), FOLDS.spelling, () => [{ label: "Spelling and checking", icon: "spelling", run: () => options.onSpelling?.(moreButton) }]),
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
    const styleLabel = make("span", "quire-style-label", "Paragraph");
    const styleLines = (): MenuItem[] => {
        const now = currentStyle(surface.getDocument(), surface.getSelection().focus.path);
        return STYLES.map(([style, label]) => ({ label, pressed: style === now, icon: sample(style), run: doing(setStyleOf(style)) }));
    };
    const styleButton = opener(styles, "Style", styleLabel, styleLines);
    styleButton.classList.add("quire-style");
    styleButton.append(icon("chevron"));
    group(tool(styleButton, 0));

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
    sizeField.addEventListener("keydown", (event) => {
        if (event.key === "Enter") {
            event.preventDefault();
            setSize(typedSize(parseFloat(sizeField.value), richOn));
        } else if (event.key === "Escape") {
            showSize();
            surface.focus();
        }
    });
    sizeField.addEventListener("change", () => setSize(typedSize(parseFloat(sizeField.value), richOn)));
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
        return SIZE_STEPS.map((number) => ({ label: String(number), pressed: number === now, run: () => setSize(number) }));
    };
    group(
        tool(
            cluster(control("Smaller", icon("minus"), () => setSize(nextSize(sizeAt(), -1, richOn)), "quire-button quire-size-step"), sizeField, control("Larger", icon("plus"), () => setSize(nextSize(sizeAt(), 1, richOn)), "quire-button quire-size-step")),
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
    const swatch = (value: string | null) => {
        const dot = make("span", "quire-swatch");
        if (value) dot.style.background = value;
        return dot;
    };
    const marker = (value: string | null) => {
        const dot = make("span", "quire-swatch quire-swatch-mark");
        if (value) dot.style.background = value;
        return dot;
    };
    const palette = () => [...(options.colors ?? []), ...FLAGS];
    const colors = flowMenu("Text color");
    const highlights = flowMenu("Highlight");
    const colorLines = (): MenuItem[] => [{ label: "Default color", icon: swatch(null), run: doing(color(null)) }, ...palette().map((each) => ({ label: each.name, icon: swatch(each.value), run: doing(color(each.value)) }))];
    const highlightLines = (): MenuItem[] => [{ label: "No highlight", icon: marker(null), run: doing(highlight(null)) }, ...palette().map((each) => ({ label: each.name, icon: marker(each.value), run: doing(highlight(each.value)) }))];
    const colorMark = make("span", "quire-color-mark", "A");
    group(
        tool(press("bold", "Bold (Ctrl+B)", glyph("B", "bold"), doing(toggle("bold"))), 0),
        tool(press("italic", "Italic (Ctrl+I)", glyph("I", "italic"), doing(toggle("italic"))), 0),
        tool(press("underline", "Underline (Ctrl+U)", glyph("U", "underline"), doing(toggle("underline"))), 0),
        tool(press("strike", "Strikethrough (Ctrl+Shift+X)", glyph("S", "strike"), doing(toggle("strike"))), 0),
        tool(opener(colors, "Text color", colorMark, colorLines), FOLDS.colors, () => [{ label: "Text color", hint: "›", run: () => colors.open(moreButton, colorLines(), true) }]),
        tool(opener(highlights, "Highlight", icon("highlight"), highlightLines), FOLDS.colors, () => [{ label: "Highlight", icon: "highlight", hint: "›", run: () => highlights.open(moreButton, highlightLines(), true) }], true),
    );

    // ---- link, picture (comment comes when comments do) ----
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
        tool(control("Link (Ctrl+K)", icon("link"), (button) => options.onLink?.(button)), FOLDS.insert, () => [{ label: "Link", icon: "link", hint: "Ctrl+K", run: () => options.onLink?.(moreButton) }]),
        tool(control("Picture", icon("image"), () => chooser.click()), FOLDS.insert, () => [{ label: "Picture", icon: "image", run: () => chooser.click() }]),
    );

    // ---- alignment: four buttons, always there, the current one lit (justified for a .quire document alone) ----
    const alignButtons = new Map<Align, HTMLButtonElement>();
    group(
        ...ALIGNS.map(([value, label]) => {
            const button = control(label, icon(value), doing(align(value)));
            button.setAttribute("aria-pressed", "false");
            alignButtons.set(value, button);
            return tool(button, 0, () => [], value === "justify");
        }),
    );

    // ---- line spacing ----
    const spacings = flowMenu("Line spacing");
    const spacingLines = (): MenuItem[] => {
        const now = spacedAt(surface.getDocument(), surface.getSelection().focus.path);
        return SPACINGS.map(([label, value]) => ({ label, pressed: now === value, run: doing(spacing(value)) }));
    };
    group(tool(opener(spacings, "Line spacing", icon("spacing"), spacingLines), FOLDS.spacing, () => [{ label: "Line spacing", icon: "spacing", hint: "›", run: () => spacings.open(moreButton, spacingLines(), true) }], true));

    // ---- checklist, bulleted list, numbered list ----
    const listKinds: [ListStyle, string][] = [
        ["task", "Checklist"],
        ["bullet", "Bulleted list"],
        ["number", "Numbered list"],
    ];
    group(
        tool(cluster(...listKinds.map(([kind, label]) => press(kind, label, icon(kind), doing(toggleList(kind))))), FOLDS.lists, () => listKinds.map(([kind, label]) => ({ label, icon: kind, run: doing(toggleList(kind)) }))),
    );

    // ---- indent less, indent more ----
    group(
        tool(cluster(control("Indent less", icon("outdent"), doing(indentBy(-1))), control("Indent more", icon("indent"), doing(indentBy(1)))), FOLDS.indent, () => [
            { label: "Indent less", icon: "outdent", run: doing(indentBy(-1)) },
            { label: "Indent more", icon: "indent", run: doing(indentBy(1)) },
        ]),
    );

    // ---- clear formatting ----
    group(tool(control("Clear formatting", icon("clear"), doing(clearFormat)), FOLDS.clear, () => [{ label: "Clear formatting", icon: "clear", run: doing(clearFormat) }]));

    // ---- at the right end: find, the three dots and the microphone (the editor adds that) ----
    const more = flowMenu("More", { align: "right" });
    moreButton.addEventListener("click", () => {
        if (more.isOpen()) return more.close(true);
        const folded = tools.filter((each) => each.element.classList.contains("folded") && !each.element.classList.contains("away"));
        const own = typeof options.more === "function" ? options.more() : (options.more ?? []);
        more.open(moreButton, [...folded.flatMap((each) => each.lines()), ...own], document.activeElement === moreButton);
    });
    moreButton.setAttribute("aria-haspopup", "menu");
    const end = make("div", "quire-bar-group quire-bar-end");
    if (options.onFind) end.append(control("Find and replace (Ctrl+F)", icon("find"), () => options.onFind!()));
    end.append(moreButton);
    strip.append(end);

    // how saving stands and the word count, "Saved · 7 words", which the page puts at the right of its first line
    const count = make("span", "quire-count");
    count.setAttribute("aria-live", "polite");
    const status = make("span", "quire-status");
    status.setAttribute("role", "status");
    let words = make("span", "quire-status-words here");
    status.append(words);
    const statusLine = make("p", "quire-status-line");
    const dot = make("span", "quire-status-dot", "·");
    dot.setAttribute("aria-hidden", "true");
    statusLine.append(status, dot, count);

    // ---- folding what does not fit ----

    /** Folds the tools that do not fit, least used first, so that nothing wraps; on a narrow window nothing folds and the bar slides sideways instead. */
    function layout() {
        for (const each of tools) {
            const away = !!each.rich && !richOn;
            each.element.classList.toggle("away", away);
            each.width = (each.element.firstElementChild as HTMLElement).offsetWidth + 2;
        }
        const narrow = typeof matchMedia !== "undefined" && matchMedia("(max-width: 40rem)").matches;
        const shown = new Set(tools.filter((each) => !each.element.classList.contains("away")));
        const groups = [...strip.querySelectorAll<HTMLElement>(".quire-bar-group:not(.quire-bar-end)")];
        // the rule between two groups and the space each side of it, 0.4rem and 0.4rem and a line (quire.css)
        const rem = parseFloat(getComputedStyle(document.documentElement).fontSize) || 16;
        const ruleWidth = 0.8 * rem + 1;
        const needed = () => {
            let sum = end.offsetWidth;
            for (const element of groups) {
                const inside = tools.filter((each) => shown.has(each) && element.contains(each.element));
                if (inside.length) sum += inside.reduce((total, each) => total + each.width, 0) + ruleWidth;
            }
            // the first group shown has no rule before it
            return sum - ruleWidth;
        };
        const room = strip.clientWidth - 2;
        if (!narrow) {
            const folding = [...tools].filter((one) => one.fold > 0 && shown.has(one)).sort((a, b) => a.fold - b.fold);
            const folded: Tool[] = [];
            for (const each of folding) {
                if (needed() <= room) break;
                shown.delete(each);
                folded.push(each);
            }
            // a tool folded on the way that fits in what room is left comes back, so that no room is left empty
            for (const each of folded.reverse()) {
                shown.add(each);
                if (needed() > room) shown.delete(each);
            }
        }
        for (const each of tools) {
            const fold = !shown.has(each);
            each.element.classList.toggle("folded", fold);
            each.element.inert = fold;
        }
        for (const element of groups) element.classList.toggle("folded", !tools.some((each) => shown.has(each) && element.contains(each.element)));
        // the first group still shown has no rule before it, so that the line starts on the same edge as the one above
        const lead = groups.find((element) => !element.classList.contains("folded"));
        for (const element of groups) element.classList.toggle("lead", element === lead);
    }
    // laid out again when the room changes, when a tool's own width does (a label, a typeface arriving) and when the fonts have come
    let waiting = 0;
    const soon = () => (waiting ||= requestAnimationFrame(() => ((waiting = 0), layout())));
    if (typeof ResizeObserver !== "undefined") {
        const watcher = new ResizeObserver(soon);
        watcher.observe(strip);
        for (const each of tools) watcher.observe(each.element.firstElementChild!);
    }
    void document.fonts?.ready.then(soon);

    // ---- keeping it true to the cursor ----

    const counted = (doc: Document) => {
        const words = countWords(doc);
        count.textContent = `${words.toLocaleString("en")} ${words === 1 ? "word" : "words"}`;
    };
    counted(surface.getDocument());
    // it waits for a pause in a run of typing, but a change after a quiet moment (a document opened) is shown at once
    let counting: ReturnType<typeof setTimeout> | undefined;
    let countingWaiting: Document | undefined;
    surface.on("change", ({ doc }) => {
        if (counting) {
            countingWaiting = doc;
            return;
        }
        counted(doc);
        const settle = () => {
            counting = undefined;
            if (countingWaiting) {
                const next = countingWaiting;
                countingWaiting = undefined;
                counted(next);
                counting = setTimeout(settle, 250);
            }
        };
        counting = setTimeout(settle, 250);
    });
    surface.on("select", ({ selection, marks }) => {
        const doc = surface.getDocument();
        const now = pressedAt(doc, selection.focus.path, marks);
        for (const [key, button] of pressable) {
            const on = now[key as keyof typeof now];
            button.setAttribute("aria-pressed", String(on));
            button.classList.toggle("pressed", on);
        }
        const sits = aligned(doc, selection.focus.path);
        for (const [value, button] of alignButtons) {
            button.setAttribute("aria-pressed", String(value === sits));
            button.classList.toggle("pressed", value === sits);
        }
        const style = currentStyle(doc, selection.focus.path);
        styleLabel.textContent = STYLES.find(([each]) => each === style)![1];
        const format = formatAt(doc, rangeOf(selection).start, !collapsed(selection));
        fontLabel.textContent = FONTS.find(([, value]) => value === (format.font ?? null))?.[0] ?? FONTS[0]![0];
        colorMark.style.borderBottomColor = format.color ?? "";
        showSize();
    });

    // ---- the keyboard: one stop for Tab, the arrows along it ----

    const stops = () => [...strip.querySelectorAll<HTMLElement>("button, input")].filter((each) => !each.closest(".folded, .away"));
    const rove = (current: HTMLElement) => {
        for (const each of strip.querySelectorAll<HTMLElement>("button, input")) each.tabIndex = each === current ? 0 : -1;
    };
    rove(stops()[0]!);
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
    const menus = [searching, styles, fonts, sizes, colors, highlights, spacings, more];
    strip.addEventListener("scroll", () => closeOthers(), { passive: true });

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
        setStatus(short: string, full: string, tone: "quiet" | "warn" = "quiet") {
            status.title = full;
            status.setAttribute("aria-label", full);
            status.classList.toggle("warn", tone === "warn");
            if (words.textContent === short) return;
            // the new words fade in where the old ones fade out, so that nothing beside them moves
            const leaving = words;
            words = make("span", "quire-status-words", short);
            status.append(words);
            leaving.classList.remove("here");
            requestAnimationFrame(() => words.classList.add("here"));
            setTimeout(() => leaving.remove(), 400);
        },
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
        /** Opens the search of the menus, from its button or, folded away, from the three dots, its field focused (Alt+/). */
        search() {
            if (searching.isOpen()) return searching.box.querySelector("input")?.focus({ preventScroll: true });
            const from = searchButton.closest(".folded, .away") || searchButton.getBoundingClientRect().width === 0 ? moreButton : searchButton;
            searching.open(from, searchForm());
            searching.box.querySelector("input")?.focus({ preventScroll: true });
        },
        /** Makes the text one size larger or smaller, as the plus and minus beside the size do (Ctrl+Shift+. and Ctrl+Shift+,). */
        sizeBy(by: -1 | 1) {
            setSize(nextSize(sizeAt(), by, richOn));
        },
        destroy() {
            surface.element.removeEventListener("keyup", paintKeys);
        },
        // the menus of the colours, size, typeface, highlight and line spacing, opened from somewhere else, as the menu row does
        pickers: {
            color: (from: HTMLElement) => colors.open(from, colorLines(), true),
            size: (from: HTMLElement) => sizes.open(from, sizeLines(), true),
            font: (from: HTMLElement) => fonts.open(from, fontLines(), true),
            highlight: (from: HTMLElement) => highlights.open(from, highlightLines(), true),
            spacing: (from: HTMLElement) => spacings.open(from, spacingLines(), true),
        },
    };
}

/** A small sample of what a style looks like, for its line in the picker. */
function sample(style: Style): HTMLElement {
    const shown = make("span", `quire-style-sample quire-style-${style}`, style === "code" ? "{ }" : style === "quote" ? "“" : style === "paragraph" ? "¶" : `H${style.slice(-1)}`);
    shown.setAttribute("aria-hidden", "true");
    return shown;
}
