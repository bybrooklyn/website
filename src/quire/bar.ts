// The bar at the top of the editor: one rounded strip as wide as the writing column, holding the
// document's name, the style picker, the marks, the lists, the "+" menu, color, size and centring,
// undo and redo, the word count and a three-dot menu for the rest. Buttons show as pressed when
// what they do is true at the cursor. It is a toolbar: Tab reaches it once, the arrow keys move
// along it. On a narrow screen it scrolls sideways rather than wrapping.
//
// What each button does to a document is a pure Action, below, tested in bar.test.ts; the DOM is
// built by createBar. Its styles are in src/styles/quire.css.

import {
    blockAt,
    blockPaths,
    changeKind,
    code as codeBlock,
    countWords,
    divider,
    image as imageBlock,
    insertAtom,
    insertBlock,
    lengthOf,
    paragraph,
    removeBlock,
    runsLength,
    setAlign,
    setLink,
    setStyle,
    table,
    textAt,
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
import { activeBlock, caret, collapsed, mark, rangeOf, sameLeaf, tableOf } from "./keys";
import type { Surface } from "./surface";
import { closeOthers, control, dots, flowMenu, glyph, icon, make, moveIndex, type Menu, type MenuItem } from "./ui";

/** What a button does: from the state at the cursor to the next one. */
export type Action = (state: State) => State;

/** The kinds of block the style picker offers. */
export type Style = "paragraph" | "heading1" | "heading2" | "heading3" | "quote" | "code";

/** The style picker's lines, in order, with their names. */
export const STYLES: [Style, string][] = [
    ["paragraph", "Paragraph"],
    ["heading1", "Heading 1"],
    ["heading2", "Heading 2"],
    ["heading3", "Heading 3"],
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
    if (block.kind === "heading") return block.level === 1 ? "heading1" : block.level === 2 ? "heading2" : "heading3";
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

// ---- the DOM ----

/** What the bar needs from the editor around it. */
export interface BarOptions {
    name: string;
    onRename?: (name: string) => void;
    /** The colors offered for text, by name. */
    colors?: { name: string; value: string }[];
    onImage?: (file: File) => Promise<string>;
    /** The lines of the three-dot menu. */
    more?: MenuItem[] | (() => MenuItem[]);
    /** Opens the link field for the selection. */
    onLink?: (from: HTMLElement) => void;
}

const SIZES: [string, string | null][] = [
    ["Small", "0.85em"],
    ["Normal", null],
    ["Large", "1.25em"],
    ["Larger", "1.5em"],
];

/** Builds the bar for a surface. */
export function createBar(surface: Surface, options: BarOptions): { element: HTMLElement; setName(name: string): void; menus: Menu[]; layout(): void } {
    const bar = make("div", "quire-bar");
    bar.setAttribute("role", "toolbar");
    bar.setAttribute("aria-label", "Formatting");
    const strip = make("div", "quire-bar-strip");
    bar.append(strip);
    const doing = (action: Action) => () => {
        surface.run((doc, selection) => action({ doc, selection }));
        surface.focus();
    };
    /** The groups of the bar, with how soon each folds into the three-dot menu when the bar is too narrow (0 never) and the lines it then adds there. */
    const groups: { element: HTMLElement; fold: number; lines: () => MenuItem[]; width: number }[] = [];
    const group = (fold: number, lines: () => MenuItem[], ...children: HTMLElement[]) => {
        const element = make("div", "quire-bar-group");
        element.append(...children);
        strip.append(element);
        groups.push({ element, fold, lines, width: 0 });
        return element;
    };
    const none = () => [];

    // the name, a field that reads as a title until it is clicked
    const name = make("input", "quire-name");
    name.value = options.name;
    name.setAttribute("aria-label", "Document name");
    name.spellcheck = false;
    let named = options.name;
    const fitName = () => {
        name.style.width = `${Math.max(4, Math.min(12, name.value.length + 1))}ch`;
        name.title = name.value;
    };
    fitName();
    name.addEventListener("input", fitName);
    name.addEventListener("keydown", (event) => {
        if (event.key === "Enter") {
            event.preventDefault();
            name.blur();
        } else if (event.key === "Escape") {
            name.value = named;
            fitName();
            name.blur();
        }
        event.stopPropagation();
    });
    name.addEventListener("change", () => {
        const value = name.value.trim() || named;
        name.value = value;
        fitName();
        if (value !== named) {
            named = value;
            options.onRename?.(value);
        }
    });
    group(0, none, name);

    // the style picker
    const styles = flowMenu("Style");
    const styleLabel = make("span", "quire-style-label", "Paragraph");
    const styleButton = control("Style", styleLabel, (button) => {
        if (styles.isOpen()) return styles.close(true);
        const now = currentStyle(surface.getDocument(), surface.getSelection().focus.path);
        styles.open(
            button,
            STYLES.map(([style, label]) => ({ label, pressed: style === now, icon: sample(style), run: doing(setStyleOf(style)) })),
            document.activeElement === button,
        );
    });
    styleButton.classList.add("quire-style");
    styleButton.setAttribute("aria-haspopup", "menu");
    styleButton.append(icon("chevron"));
    group(0, none, styleButton);

    // marks
    const pressable = new Map<string, HTMLButtonElement>();
    const press = (key: string, label: string, content: string | Node, action: () => void) => {
        const button = control(label, content, action);
        button.setAttribute("aria-pressed", "false");
        pressable.set(key, button);
        return button;
    };
    const linkButton = control("Link (Ctrl+K)", icon("link"), (button) => options.onLink?.(button));
    group(
        0,
        none,
        press("bold", "Bold (Ctrl+B)", glyph("B", "bold"), doing(toggle("bold"))),
        press("italic", "Italic (Ctrl+I)", glyph("I", "italic"), doing(toggle("italic"))),
        press("underline", "Underline (Ctrl+U)", glyph("U", "underline"), doing(toggle("underline"))),
        press("strike", "Strikethrough (Ctrl+Shift+X)", glyph("S", "strike"), doing(toggle("strike"))),
        press("code", "Inline code (Ctrl+E)", icon("code"), doing(toggle("code"))),
        linkButton,
    );

    // lists
    group(
        4,
        () => [
            { label: "Bulleted list", icon: "bullet", run: doing(toggleList("bullet")) },
            { label: "Numbered list", icon: "number", run: doing(toggleList("number")) },
            { label: "Checklist", icon: "task", run: doing(toggleList("task")) },
        ],
        press("bullet", "Bulleted list", icon("bullet"), doing(toggleList("bullet"))),
        press("number", "Numbered list", icon("number"), doing(toggleList("number"))),
        press("task", "Checklist", icon("task"), doing(toggleList("task"))),
    );

    // the "+" menu
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
        const address = await options.onImage(file);
        doing(addImage(address, file.name.replace(/\.[^.]+$/, "")))();
    });
    const additions = (): MenuItem[] => [
        { label: "Table", icon: "table", run: doing(addTable) },
        { label: "Picture", icon: "image", run: () => chooser.click() },
        { label: "Divider", icon: "divider", run: doing(addDivider) },
        { label: "Code block", icon: "code", run: doing(addCode) },
        { label: "Footnote", icon: "footnote", run: doing(addFootnote) },
    ];
    const adds = flowMenu("Add");
    const addButton = control("Add a block", icon("plus"), (button) => {
        if (adds.isOpen()) return adds.close(true);
        adds.open(button, additions(), document.activeElement === button);
    });
    addButton.setAttribute("aria-haspopup", "menu");
    group(3, () => additions().map((item) => ({ ...item, label: `Add ${item.label.toLowerCase()}` })), addButton, chooser);

    // color, size, centre
    const swatch = (value: string | null) => {
        const dot = make("span", "quire-swatch");
        if (value) dot.style.background = value;
        return dot;
    };
    const colorLines = (): MenuItem[] => [{ label: "Default color", icon: swatch(null), run: doing(color(null)) }, ...(options.colors ?? []).map((each) => ({ label: each.name, icon: swatch(each.value), run: doing(color(each.value)) }))];
    const sizeLines = (): MenuItem[] =>
        SIZES.map(([label, value]) => {
            const shown = make("span", "quire-size-sample", "A");
            if (value) shown.style.fontSize = value;
            return { label, icon: shown, run: doing(size(value)) };
        });
    const colors = flowMenu("Text color");
    const colorButton = control("Text color", make("span", "quire-color-mark", "A"), (button) => {
        if (colors.isOpen()) return colors.close(true);
        colors.open(button, colorLines(), document.activeElement === button);
    });
    colorButton.setAttribute("aria-haspopup", "menu");
    const sizes = flowMenu("Text size");
    const sizeButton = control("Text size", "Aa", (button) => {
        if (sizes.isOpen()) return sizes.close(true);
        sizes.open(button, sizeLines(), document.activeElement === button);
    });
    sizeButton.setAttribute("aria-haspopup", "menu");
    group(1, () => [...colorLines(), ...sizeLines().map((item) => ({ ...item, label: `${item.label} text` })), { label: "Centre", icon: "center", run: doing(center) }], colorButton, sizeButton, press("center", "Centre", icon("center"), doing(center)));

    // undo and redo
    const undo = () => {
        surface.undo();
        surface.focus();
    };
    const redo = () => {
        surface.redo();
        surface.focus();
    };
    group(
        2,
        () => [
            { label: "Undo", icon: "undo", hint: "Ctrl+Z", run: undo },
            { label: "Redo", icon: "redo", hint: "Ctrl+Shift+Z", run: redo },
        ],
        control("Undo (Ctrl+Z)", icon("undo"), undo),
        control("Redo (Ctrl+Shift+Z)", icon("redo"), redo),
    );

    // the word count and the rest
    const count = make("span", "quire-count");
    count.setAttribute("aria-live", "polite");
    const more = flowMenu("More", { align: "right" });
    const moreButton = dots("More");
    moreButton.addEventListener("click", () => {
        if (more.isOpen()) return more.close(true);
        const folded = groups.filter((each) => each.element.classList.contains("folded")).sort((a, b) => a.fold - b.fold);
        const own = typeof options.more === "function" ? options.more() : (options.more ?? []);
        more.open(moreButton, [...folded.flatMap((each) => each.lines()), ...own], document.activeElement === moreButton);
    });
    moreButton.setAttribute("aria-haspopup", "menu");
    const end = group(0, none, count, moreButton);
    end.classList.add("quire-bar-end");

    // ---- folding what does not fit ----

    /** Folds the groups that do not fit, least used first, so that nothing wraps; what still does not fit scrolls. */
    function layout() {
        // a group's whole width, even while it is still unfolding or folded away
        for (const each of groups) each.width = each.element.scrollWidth || each.width;
        const room = strip.clientWidth - 12;
        let needed = groups.reduce((sum, each) => sum + each.width, 0);
        for (const each of [...groups].sort((a, b) => a.fold - b.fold)) {
            if (each.fold === 0) continue;
            const fold = needed > room;
            if (fold) needed -= each.width;
            each.element.classList.toggle("folded", fold);
            each.element.inert = fold;
        }
    }
    new ResizeObserver(() => layout()).observe(bar);

    // ---- keeping it true to the cursor ----

    const counted = (doc: Document) => {
        const words = countWords(doc);
        count.textContent = `${words.toLocaleString("en")} ${words === 1 ? "word" : "words"}`;
    };
    counted(surface.getDocument());
    surface.on("change", ({ doc }) => counted(doc));
    surface.on("select", ({ selection, marks }) => {
        const doc = surface.getDocument();
        const now = pressedAt(doc, selection.focus.path, marks);
        for (const [key, button] of pressable) {
            const on = now[key as keyof typeof now];
            button.setAttribute("aria-pressed", String(on));
            button.classList.toggle("pressed", on);
        }
        const style = currentStyle(doc, selection.focus.path);
        styleLabel.textContent = STYLES.find(([each]) => each === style)![1];
    });

    // ---- the keyboard: one stop for Tab, the arrows along it ----

    const stops = () => [...strip.querySelectorAll<HTMLElement>("button, input.quire-name")].filter((each) => !each.closest(".folded"));
    const rove = (current: HTMLElement) => {
        for (const each of strip.querySelectorAll<HTMLElement>("button, input.quire-name")) each.tabIndex = each === current ? 0 : -1;
    };
    rove(stops()[0]!);
    strip.addEventListener("focusin", (event) => {
        if (stops().includes(event.target as HTMLElement)) rove(event.target as HTMLElement);
    });
    strip.addEventListener("keydown", (event) => {
        const all = stops();
        const at = all.indexOf(document.activeElement as HTMLElement);
        if (at < 0 || document.activeElement === name) return;
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
    const menus = [styles, adds, colors, sizes, more];
    // a menu drawn under a sticky bar keeps to its button as the page scrolls
    addEventListener("scroll", () => menus.forEach((menu) => menu.follow()), { passive: true });
    strip.addEventListener("scroll", () => closeOthers(), { passive: true });

    return {
        element: bar,
        setName(value) {
            named = value;
            name.value = value;
            fitName();
        },
        menus,
        layout,
    };
}

/** A small sample of what a style looks like, for its line in the picker. */
function sample(style: Style): HTMLElement {
    const shown = make("span", `quire-style-sample quire-style-${style}`, style === "code" ? "{ }" : style === "quote" ? "“" : style === "paragraph" ? "¶" : `H${style.slice(-1)}`);
    shown.setAttribute("aria-hidden", "true");
    return shown;
}
