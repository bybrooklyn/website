// The editing surface: a document drawn into an element, kept in step with the model, and typed in.
//
// The element is made contenteditable only so that the browser gives it a cursor, a keyboard and an
// input method. The browser never edits it by itself: every key and `beforeinput` is cancelled and
// turned into an Input for keys.ts, the document changes through the model's own operations, the
// blocks that changed are drawn again, and the selection is put back from the model. The one
// exception is composition (an input method building a character): while it lasts the browser
// shows the text it is composing, and when it ends the block is drawn again from the model and the
// committed text is typed into it. No shortcut fires while composing.
//
// For the layer above (the bar, the selection bar, the slash menu, storage):
//
//   const surface = createSurface(element, document, { onImage: async (file) => address });
//   surface.getDocument()        the document as it is now
//   surface.setDocument(doc)     shows another document, with a fresh history
//   surface.getSelection()       { anchor, focus }, each a Position in the model
//   surface.setSelection(sel)    puts the cursor or selection somewhere
//   surface.run(operation)       calls `operation(doc, selection)`, which returns a new Document
//                                or a { doc, selection } state, for example
//                                (doc, sel) => toggleMark(doc, rangeOf(sel), "bold"); it is one undo step
//   surface.undo(), surface.redo(), surface.focus(), surface.destroy()
//   surface.on(name, listener)   returns a function that stops listening. The names:
//     "change"   { doc }                           the document changed
//     "select"   { selection, marks, block, rect } the cursor moved: the marks and kind of block at
//                                                  it, and the selection's rectangle on screen
//     "slash"    { selection, rect }               "/" was typed on an empty line
//     "link"     { selection, rect }               the link shortcut was pressed; the bar asks for an
//                                                  address and calls run with setLink
//
// The host styles the element with these classes: `quire` on it, `quire-code` and `quire-raw` on
// code and raw blocks (with the language or "raw" in `data-label`), `quire-image`, `quire-divider`,
// `quire-footnote`, `quire-tight` on a list written without blank lines between its items,
// `quire-task` on a task item and `quire-box` on its box (`data-checked`),
// `quire-atom` on an inline HTML span or footnote reference.

import { blockAt, blockPaths, changeKind, documentOf, image as imageBlock, isPageBreak, markdownOnly, paragraph, setBox, setImageAlt, setRaw, toggleTask, type Block, type Code, type Document, type Leaf, type Mark, type Position, type Run, type Selection } from "./document";
import { createHistory, redo as redoStep, undo as undoStep, type ChangeKind, type State } from "./history";
import { readHtml, writeHtml } from "./html";
import { drawPicture } from "./picture-tools";
import { isContentsMark } from "./inserts";
import { activeBlock, activeMarks, apply, caret, collapsed, fragment, paste, step, type Editor, type Input, type Outcome } from "./keys";
import { read } from "./read";
import { write } from "./write";
import { fieldsOf, KNOWN, readTag, setProp, type Tag } from "./components";
import { diagram } from "./diagram";
import { emojiOf } from "./emoji";
import { highlight, LANGUAGE_NAMES } from "./highlight";
import { maths } from "./maths";

/** What the host gives the surface. `onImage` stores a pasted or dropped picture and gives back its address. */
export interface SurfaceOptions {
    onImage?: (file: File) => Promise<string>;
    /** Where a picture written in the document can be shown from, when that is not its address (a picture kept in the browser, say). */
    picture?: (address: string) => Promise<string | undefined>;
}

/** Where the cursor is and what is there, sent with "select". */
export interface SelectionInfo {
    selection: Selection;
    marks: Mark[];
    block: ReturnType<typeof activeBlock>;
    rect: DOMRect | null;
}

/** The events and what each one carries. */
export interface SurfaceEvents {
    change: { doc: Document };
    select: SelectionInfo;
    slash: { selection: Selection; rect: DOMRect | null };
    link: { selection: Selection; rect: DOMRect | null };
}

/** A change the bars ask for: given the document and selection, the new document or state. */
export type Operation = (doc: Document, selection: Selection) => Document | State;

/** The surface, as the layer above sees it. */
export interface Surface {
    getDocument(): Document;
    setDocument(doc: Document): void;
    getSelection(): Selection;
    setSelection(selection: Selection): void;
    /** Makes a change from outside, as one undo step; `kind` "type" lets a run of them gather into one. */
    run(operation: Operation, kind?: ChangeKind): void;
    /** The element the surface draws into. */
    element: HTMLElement;
    /** The drawn element of the block (or table cell) at a path. */
    elementAt(path: number[]): HTMLElement | undefined;
    /** The page's own range over a stretch of the text, to mark or measure it without selecting it. */
    rangeOf(start: Position, end: Position): globalThis.Range | undefined;
    undo(): void;
    redo(): void;
    focus(): void;
    on<K extends keyof SurfaceEvents>(name: K, listener: (detail: SurfaceEvents[K]) => void): () => void;
    destroy(): void;
    /** Turns typed arrows and signs (-> to an arrow, != to not equal) on or off, and with them `==` shown joined. On to begin with. */
    setSymbols(on: boolean): void;
    /** Whether typed arrows and signs become their characters. */
    symbols(): boolean;
    /** Puts text in at the cursor as it is, each line a paragraph, with no formatting and no Markdown read from it. */
    pasteText(text: string): void;
}

const MAC = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform);
const TAGS: [Mark, string][] = [
    ["bold", "strong"],
    ["italic", "em"],
    ["underline", "u"],
    ["strike", "s"],
    ["code", "code"],
    ["mark", "mark"],
    ["sup", "sup"],
    ["sub", "sub"],
    ["spoiler", "span"],
];

/** A code block longer than this many characters is drawn as plain text at once and highlighted a moment after typing stops, so that a key in it stays quick. */
const LONG_CODE = 6000;

/** How blocks are drawn: whether the file is MDX (its components shown as cards), whether `==` and `===` are shown joined, and how a long code block is highlighted later. */
interface Drawing {
    mdx: boolean;
    join: boolean;
    later?: (holder: HTMLElement, block: Code) => void;
}

const plainDrawing: Drawing = { mdx: false, join: true };

// ---- drawing ----

/** Text with each `==` and `===` drawn joined into one sign, as a display matter only: the characters are the ones typed. */
function joined(text: string): Node {
    const parts = text.split(/((?<!=)={2,3}(?!=))/);
    if (parts.length === 1) return document.createTextNode(text);
    const span = document.createElement("span");
    parts.forEach((part, index) => {
        if (part === "") return;
        if (index % 2 === 0) span.append(part);
        else {
            const sign = document.createElement("span");
            sign.className = "quire-join";
            sign.textContent = part;
            span.append(sign);
        }
    });
    return span;
}

/** Inline maths: its source, which is the text, and beside it the maths laid out, which counts as nothing. The source shows while the cursor is in it, or when the maths cannot be laid out. */
function drawMath(source: string): HTMLElement {
    const wrap = document.createElement("span");
    wrap.className = "quire-math";
    const text = document.createElement("span");
    text.className = "quire-math-source";
    text.textContent = source;
    wrap.append(text);
    const html = maths(source, false);
    if (html === null) {
        wrap.classList.add("quire-math-plain");
        return wrap;
    }
    const shown = document.createElement("span");
    shown.className = "quire-math-shown";
    shown.contentEditable = "false";
    shown.dataset.shown = "";
    shown.innerHTML = html;
    wrap.append(shown);
    return wrap;
}

/** Draws one leaf of text: the text inside an element for each of its marks. */
function drawLeaf(leaf: Leaf, how: Drawing = plainDrawing): Node {
    if (leaf.kind === "break") return document.createElement("br");
    if (leaf.kind === "emoji") {
        const atom = document.createElement("span");
        atom.className = "quire-emoji";
        atom.contentEditable = "false";
        atom.dataset.atom = "";
        atom.title = `:${leaf.name}:`;
        atom.textContent = emojiOf(leaf.name) ?? `:${leaf.name}:`;
        return atom;
    }
    if (leaf.kind === "image") {
        const picture = document.createElement("img");
        picture.src = leaf.src;
        picture.alt = leaf.alt;
        picture.dataset.atom = "";
        return picture;
    }
    if (leaf.kind === "footnote" || leaf.kind === "html") {
        const atom = document.createElement(leaf.kind === "footnote" ? "sup" : "span");
        atom.className = "quire-atom";
        atom.contentEditable = "false";
        atom.dataset.atom = "";
        atom.textContent = leaf.kind === "footnote" ? `[${leaf.label}]` : leaf.html;
        return atom;
    }
    let node: Node = leaf.marks.includes("math") ? drawMath(leaf.text) : how.join && !leaf.marks.includes("code") && leaf.text.includes("==") ? joined(leaf.text) : document.createTextNode(leaf.text);
    for (const [mark, tag] of [...TAGS].reverse()) {
        if (!leaf.marks.includes(mark)) continue;
        const wrap = document.createElement(tag);
        // a spoiler is drawn dimmed with a dotted edge, so that it can still be read and written in here
        if (mark === "spoiler") wrap.className = "quire-spoiler";
        wrap.append(node);
        node = wrap;
    }
    if (leaf.color || leaf.size || leaf.font || leaf.highlight) {
        const span = document.createElement("span");
        if (leaf.color) span.style.color = leaf.color;
        if (leaf.size) span.style.fontSize = leaf.size;
        // a font is a name the stylesheet turns into a typeface, so only the site's own can be chosen
        if (leaf.font) span.dataset.font = leaf.font;
        if (leaf.highlight) {
            // the color is laid behind the words half seen, so that text of any color stays readable on it
            span.style.backgroundColor = `color-mix(in oklch, ${leaf.highlight} 45%, transparent)`;
            span.classList.add("quire-highlight");
        }
        span.append(node);
        node = span;
    }
    return node;
}

/** A `<br>` that holds an empty line open; it is not part of the text. */
function filler(): HTMLElement {
    const br = document.createElement("br");
    br.dataset.filler = "";
    return br;
}

function fillRuns(holder: HTMLElement, runs: Run[], how: Drawing = plainDrawing) {
    for (const run of runs) {
        if (run.kind !== "link") {
            holder.append(drawLeaf(run, how));
            continue;
        }
        const link = document.createElement("a");
        link.href = run.href;
        if (run.title) link.title = run.title;
        for (const leaf of run.runs) link.append(drawLeaf(leaf, how));
        holder.append(link);
    }
    const last = runs[runs.length - 1];
    if (runs.length === 0 || last?.kind === "break" || (last?.kind === "link" && last.runs[last.runs.length - 1]?.kind === "break")) holder.append(filler());
}

function fillText(holder: HTMLElement, text: string) {
    holder.textContent = text;
    if (text === "" || text.endsWith("\n")) holder.append(filler());
}

const holderOf = (element: HTMLElement, inner: number[]) => {
    element.dataset.holder = inner.join(",");
    return element;
};

/** Fills a code holder with its code cut into tokens, each in a span its color comes from. */
function fillTokens(holder: HTMLElement, code: string, language: string) {
    holder.replaceChildren();
    for (const token of highlight(code, language)) {
        if (token.kind === "plain") {
            holder.append(token.text);
            continue;
        }
        const span = document.createElement("span");
        span.className = `quire-t-${token.kind}`;
        span.textContent = token.text;
        holder.append(span);
    }
    if (code === "" || code.endsWith("\n")) holder.append(filler());
}

/** A small element that is not part of the text: what it holds is the surface's to show, not to edit. */
function aside<K extends keyof HTMLElementTagNameMap>(tag: K, className: string): HTMLElementTagNameMap[K] {
    const element = document.createElement(tag);
    element.className = className;
    element.contentEditable = "false";
    return element;
}

/** A code block: its language, as a field with the languages offered, and its code, highlighted. */
function drawCode(block: Code, inner: number[], how: Drawing): HTMLElement {
    const pre = document.createElement("pre");
    pre.className = "quire-code";
    pre.dataset.label = block.language;
    const holder = holderOf(document.createElement("code"), inner);
    if (block.code.length > LONG_CODE && how.later) {
        fillText(holder, block.code);
        how.later(holder, block);
    } else fillTokens(holder, block.code, block.language);
    const corner = aside("span", "quire-lang-corner");
    const field = document.createElement("input");
    field.className = "quire-lang";
    field.value = block.language;
    field.placeholder = "language";
    field.spellcheck = false;
    field.setAttribute("list", "quire-languages");
    field.setAttribute("aria-label", "The code's language");
    field.dataset.lang = inner.join(",");
    corner.append(field);
    pre.append(corner, holder);
    return pre;
}

/** Maths or a diagram: laid out above its source, which is what is saved and is edited as code. What cannot be laid out says so, and its source stays in full view. */
function drawDrawn(block: Code, inner: number[], how: Drawing): HTMLElement {
    const box = document.createElement("div");
    box.className = "quire-drawn";
    box.dataset.kind = block.language;
    const preview = aside("div", "quire-preview");
    const html = block.language === "math" ? maths(block.code, true) : diagram(block.code);
    if (html !== null) preview.innerHTML = html;
    else {
        box.classList.add("quire-drawn-plain");
        preview.textContent = block.code.trim() === "" ? (block.language === "math" ? "Maths, written below in TeX" : "A diagram, written below as a flowchart") : block.language === "math" ? "Shown as written: this uses more TeX than mdQuire lays out" : "Shown as code: mdQuire draws flowcharts only";
    }
    box.append(preview, drawCode(block, inner, how));
    return box;
}

/** The names a callout's kind steps through when its label is pressed. */
const CALLOUTS = ["NOTE", "TIP", "IMPORTANT", "WARNING", "CAUTION"];

/** A component's tag as a card: its name, what it is, and a field for each property. */
function drawCard(tag: Tag, inner: number[]): HTMLElement {
    const card = aside("div", `quire-comp quire-comp-${tag.kind}`);
    card.dataset.card = inner.join(",");
    const head = document.createElement("div");
    head.className = "quire-comp-head";
    const name = document.createElement("span");
    name.className = "quire-comp-name";
    name.textContent = tag.kind === "close" ? `End of ${tag.name}` : tag.name;
    head.append(name);
    const about = KNOWN[tag.name]?.about;
    if (about && tag.kind !== "close") {
        const line = document.createElement("span");
        line.className = "quire-comp-about";
        line.textContent = about;
        head.append(line);
    }
    card.append(head);
    if (tag.kind === "close") return card;
    const fields = document.createElement("div");
    fields.className = "quire-comp-fields";
    for (const field of fieldsOf(tag)) {
        const label = document.createElement("label");
        label.className = `quire-comp-field${field.flag ? " quire-comp-flag" : ""}${field.kind === "missing" ? " quire-comp-missing" : ""}`;
        const word = document.createElement("span");
        word.textContent = field.name;
        const input = document.createElement("input");
        input.dataset.prop = field.name;
        if (field.flag) {
            input.type = "checkbox";
            input.checked = field.kind !== "missing";
            label.append(input, word);
        } else {
            input.value = field.value;
            input.spellcheck = false;
            if (field.kind === "expression") input.classList.add("quire-comp-expression");
            label.append(word, input);
        }
        fields.append(label);
    }
    card.append(fields);
    return card;
}

/** Draws a block, `inner` being its path inside the top-level block it belongs to. */
function draw(block: Block, inner: number[], how: Drawing = plainDrawing): HTMLElement {
    switch (block.kind) {
        case "paragraph":
        case "heading": {
            const element = holderOf(document.createElement(block.kind === "paragraph" ? "p" : `h${block.level}`), inner);
            if (block.align) element.style.textAlign = block.align;
            if (block.kind === "paragraph" && block.subtext) element.className = "quire-subtext";
            if (block.spacing) element.style.setProperty("--spacing", String(block.spacing));
            fillRuns(element, block.runs, how);
            return element;
        }
        case "list": {
            if (block.style === "definition") {
                // a definition list: each item's first block is its term, the rest its definitions
                const element = document.createElement("dl");
                element.className = `quire-terms${block.loose ? "" : " quire-tight"}`;
                block.items.forEach((item, k) =>
                    item.blocks.forEach((child, j) => {
                        const holder = document.createElement(j === 0 ? "dt" : "dd");
                        holder.append(draw(child, [...inner, k, j], how));
                        element.append(holder);
                    }),
                );
                return element;
            }
            const element = document.createElement(block.style === "number" ? "ol" : "ul");
            if (block.style === "number" && block.start !== 1) element.setAttribute("start", String(block.start));
            if (!block.loose) element.className = "quire-tight";
            block.items.forEach((item, k) => {
                const li = document.createElement("li");
                if (item.checked !== undefined) {
                    li.className = "quire-task";
                    const box = document.createElement("span");
                    box.className = "quire-box";
                    box.contentEditable = "false";
                    box.dataset.box = [...inner, k].join(",");
                    box.dataset.checked = String(item.checked);
                    box.setAttribute("role", "checkbox");
                    box.setAttribute("aria-checked", String(item.checked));
                    li.append(box);
                }
                item.blocks.forEach((child, j) => li.append(draw(child, [...inner, k, j], how)));
                element.append(li);
            });
            return element;
        }
        case "quote":
            if (block.details) {
                // a folding section: its summary as a field, whether it starts open as a button, and its blocks always shown to be written in
                const element = document.createElement("div");
                element.className = `quire-fold${block.details.open ? " open" : ""}`;
                const head = aside("div", "quire-fold-head");
                const turn = document.createElement("button");
                turn.type = "button";
                turn.className = "quire-fold-turn";
                turn.dataset.fold = inner.join(",");
                turn.setAttribute("aria-pressed", String(block.details.open));
                turn.setAttribute("aria-label", block.details.open ? "Starts open; press to start it closed" : "Starts closed; press to start it open");
                turn.title = block.details.open ? "Starts open" : "Starts closed";
                const summary = document.createElement("input");
                summary.className = "quire-summary";
                summary.value = block.details.summary;
                summary.placeholder = "What is folded away";
                summary.setAttribute("aria-label", "The section's summary");
                summary.dataset.summary = inner.join(",");
                head.append(turn, summary);
                const body = document.createElement("div");
                body.className = "quire-fold-body";
                block.blocks.forEach((child, j) => body.append(draw(child, [...inner, j], how)));
                element.append(head, body);
                return element;
            }
            if (block.callout !== undefined) {
                // a callout: its kind as a label that steps to the next kind when pressed, any title beside it
                const element = document.createElement("blockquote");
                element.className = "quire-callout";
                element.dataset.callout = block.callout.toLowerCase();
                const head = aside("div", "quire-callout-head");
                const kind = document.createElement("button");
                kind.type = "button";
                kind.className = "quire-callout-kind";
                kind.dataset.calloutKind = inner.join(",");
                kind.textContent = block.callout.charAt(0).toUpperCase() + block.callout.slice(1).toLowerCase();
                kind.title = "Press for another kind of callout";
                head.append(kind);
                if (block.title) {
                    const title = document.createElement("span");
                    title.className = "quire-callout-title";
                    title.textContent = block.title;
                    head.append(title);
                }
                element.append(head);
                block.blocks.forEach((child, j) => element.append(draw(child, [...inner, j], how)));
                return element;
            }
        // a plain quote is drawn as a footnote is, below
        // falls through
        case "footnote": {
            const element = document.createElement(block.kind === "quote" ? "blockquote" : "div");
            if (block.kind === "footnote") {
                element.className = "quire-footnote";
                const label = document.createElement("span");
                label.className = "quire-atom";
                label.contentEditable = "false";
                label.textContent = `[${block.label}]`;
                element.append(label);
            }
            block.blocks.forEach((child, j) => element.append(draw(child, [...inner, j], how)));
            return element;
        }
        case "code":
            if (block.language === "math" || block.language === "mermaid") return drawDrawn(block, inner, how);
            return drawCode(block, inner, how);
        case "raw": {
            const tag = how.mdx ? readTag(block.text) : undefined;
            if (tag) return drawCard(tag, inner);
            if (isContentsMark(block)) {
                // the marker of a table of contents (inserts.ts): a quiet label over the list it heads
                const element = document.createElement("div");
                element.className = "quire-contents-mark";
                element.contentEditable = "false";
                element.dataset.label = "Table of contents";
                return element;
            }
            if (isPageBreak(block)) {
                // the end of a page: a marked line on screen, where the pages (pages.ts) start the next sheet
                const element = document.createElement("div");
                element.className = "quire-break";
                element.contentEditable = "false";
                element.dataset.label = "Page break";
                return element;
            }
            const pre = document.createElement("pre");
            pre.className = "quire-raw";
            pre.dataset.label = "raw";
            const holder = holderOf(document.createElement("code"), inner);
            fillText(holder, block.text);
            pre.append(holder);
            return pre;
        }
        case "table": {
            const table = document.createElement("table");
            const head = table.createTHead().insertRow();
            const body = table.createTBody();
            const cell = (row: HTMLTableRowElement, runs: Run[], r: number, c: number, tag: "th" | "td") => {
                const element = holderOf(document.createElement(tag), [...inner, r, c]);
                if (block.align[c]) element.style.textAlign = block.align[c]!;
                fillRuns(element, runs, how);
                row.append(element);
            };
            block.header.forEach((runs, c) => cell(head, runs, 0, c, "th"));
            block.rows.forEach((cells, r) => {
                const row = body.insertRow();
                cells.forEach((runs, c) => cell(row, runs, r + 1, c, "td"));
            });
            return table;
        }
        case "image":
            return drawPicture(block, inner);
        case "divider": {
            const element = document.createElement("div");
            element.className = "quire-divider";
            element.contentEditable = "false";
            element.append(document.createElement("hr"));
            return element;
        }
    }
}

// ---- between DOM places and model positions ----

const isElement = (node: Node): node is HTMLElement => node.nodeType === 1;
const isAtom = (node: Node) => isElement(node) && (node.tagName === "BR" ? !("filler" in node.dataset) : "atom" in node.dataset);

/** How much model text a DOM node stands for. */
function units(node: Node): number {
    if (node.nodeType === 3) return (node as Text).length;
    if (!isElement(node)) return 0;
    if ("filler" in node.dataset || "shown" in node.dataset) return 0;
    if (isAtom(node)) return 1;
    let sum = 0;
    for (const child of node.childNodes) sum += units(child);
    return sum;
}

/** The offset in a holder's text of a DOM point inside it. */
function offsetIn(holder: HTMLElement, node: Node, offset: number): number {
    // a point inside laid-out maths counts as the end of its source, which is just before it
    const shown = isElement(node) ? node.closest("[data-shown]") : node.parentElement?.closest("[data-shown]");
    if (shown && holder.contains(shown)) return offsetIn(holder, shown.parentNode!, [...shown.parentNode!.childNodes].indexOf(shown as ChildNode));
    // a point inside an atom counts as just before or after it
    const atom = isElement(node) ? node.closest("[data-atom]") : node.parentElement?.closest("[data-atom]");
    if (atom && atom !== holder && holder.contains(atom)) return offsetIn(holder, atom.parentNode!, [...atom.parentNode!.childNodes].indexOf(atom as ChildNode)) + (offset > 0 ? 1 : 0);
    let total = node.nodeType === 3 ? Math.min(offset, (node as Text).length) : [...node.childNodes].slice(0, offset).reduce((sum, child) => sum + units(child), 0);
    for (let at: Node = node; at !== holder && at.parentNode; at = at.parentNode) for (let sibling = at.previousSibling; sibling; sibling = sibling.previousSibling) total += units(sibling);
    return total;
}

/** The DOM point for an offset in a holder's text. */
function pointIn(holder: HTMLElement, offset: number): { node: Node; offset: number } {
    let left = offset;
    const find = (element: Node): { node: Node; offset: number } | undefined => {
        const children = [...element.childNodes];
        for (let index = 0; index < children.length; index++) {
            const child = children[index]!;
            if (isElement(child) && "filler" in child.dataset) return { node: element, offset: index };
            const size = units(child);
            if (child.nodeType === 3) {
                if (left <= size) return { node: child, offset: left };
                left -= size;
            } else if (isAtom(child)) {
                if (left === 0) return { node: element, offset: index };
                left -= 1;
            } else if (size > 0 && left <= size) {
                const inner = find(child);
                if (inner) return inner;
            } else left -= size;
        }
        return left === 0 ? { node: element, offset: children.length } : undefined;
    };
    return find(holder) ?? { node: holder, offset: holder.childNodes.length };
}

// ---- the surface ----

/** Makes an element an editing surface for a document. */
export function createSurface(root: HTMLElement, initial: Document, options: SurfaceOptions = {}): Surface {
    let drawn = new WeakMap<Block, HTMLElement>();
    let editor: Editor = { state: { doc: ensure(initial), selection: caret([0], 0) }, history: createHistory() };
    editor.state.selection = caret(firstText(editor.state.doc), 0);
    let composing = false;
    let composedAt: Selection | undefined;
    const listeners = new Map<string, Set<(detail: never) => void>>();

    root.contentEditable = "true";
    root.classList.add("quire");
    root.spellcheck = true;
    // the model's spaces and soft line breaks are shown as they are, so each is somewhere to put the cursor
    root.style.whiteSpace = "pre-wrap";
    root.setAttribute("role", "textbox");
    root.setAttribute("aria-multiline", "true");

    function ensure(doc: Document): Document {
        return doc.blocks.length ? doc : { ...doc, blocks: [{ ...paragraph(), gap: doc.eol }] };
    }

    function firstText(doc: Document): number[] {
        return blockPaths(doc).find((path) => ["paragraph", "heading", "code", "raw"].includes(blockAt(doc, path)?.kind ?? "") && !isPageBreak(blockAt(doc, path)) && !isContentsMark(blockAt(doc, path))) ?? [0];
    }

    function emit<K extends keyof SurfaceEvents>(name: K, detail: SurfaceEvents[K]) {
        for (const listener of listeners.get(name) ?? []) (listener as (detail: SurfaceEvents[K]) => void)(detail);
    }

    // ---- drawing the document ----

    // the languages a code block's field offers, once for the page
    if (!document.getElementById("quire-languages")) {
        const list = document.createElement("datalist");
        list.id = "quire-languages";
        for (const name of LANGUAGE_NAMES) list.append(new Option(name));
        document.body.append(list);
    }

    /** Whether typed arrows and signs become their characters, and `==` is shown joined: on unless the writer turned it off. */
    let symbols = true;
    const drawing = (): Drawing => ({ mdx: editor.state.doc.mdx, join: symbols, later });

    // a long code block is highlighted once typing in it pauses, the newest drawing of it only
    const waiting = new Map<HTMLElement, Code>();
    let painting: ReturnType<typeof setTimeout> | undefined;
    function later(holder: HTMLElement, block: Code) {
        waiting.set(holder, block);
        clearTimeout(painting);
        painting = setTimeout(() => {
            let touched = false;
            for (const [element, code] of waiting) {
                if (!element.isConnected) continue;
                fillTokens(element, code.code, code.language);
                touched = true;
            }
            waiting.clear();
            if (touched) placeSelection();
        }, 250);
    }

    /** Lights what the cursor is in that shows its source only then: inline maths, and a block of maths or a diagram. */
    let lit: HTMLElement[] = [];
    function markHere() {
        const now: HTMLElement[] = [];
        const { focus } = editor.state.selection;
        const holder = holderAt(focus.path);
        if (holder) {
            const box = holder.closest<HTMLElement>(".quire-drawn");
            if (box) now.push(box);
            for (const math of holder.querySelectorAll<HTMLElement>(".quire-math, .quire-spoiler")) {
                const start = offsetIn(holder, math, 0);
                if (focus.offset >= start && focus.offset <= start + units(math)) now.push(math);
            }
        }
        for (const element of lit) if (!now.includes(element)) element.classList.remove("quire-editing");
        for (const element of now) element.classList.add("quire-editing");
        lit = now;
    }

    function render() {
        const fresh: HTMLElement[] = [];
        const wanted = editor.state.doc.blocks.map((block) => {
            let element = drawn.get(block);
            if (!element) {
                element = draw(block, [], drawing());
                showPictures(element);
                drawn.set(block, element);
                fresh.push(element);
            }
            return element;
        });
        // a block drawn by an edit is laid out at once, so that what is measured next (the cursor's
        // place, where a menu goes) is its real size; afterwards it may be skipped while out of sight
        if (fresh.length <= 50) {
            for (const element of fresh) element.classList.add("quire-fresh");
            requestAnimationFrame(() => requestAnimationFrame(() => fresh.forEach((element) => element.classList.remove("quire-fresh"))));
        }
        const keep = new Set<Node>(wanted);
        for (const node of [...root.childNodes]) if (!keep.has(node)) node.remove();
        let child = root.firstChild;
        for (const element of wanted) {
            if (element === child) child = child.nextSibling;
            else root.insertBefore(element, child);
        }
        while (child) {
            const next = child.nextSibling;
            child.remove();
            child = next;
        }
    }

    /** Gives each picture drawn in an element the address it can be shown from, once that is known. */
    function showPictures(element: HTMLElement) {
        if (!options.picture) return;
        for (const picture of element.querySelectorAll("img")) {
            const address = picture.getAttribute("src") ?? "";
            void options.picture(address).then((shown) => {
                if (shown && picture.getAttribute("src") === address) picture.src = shown;
            });
        }
    }

    function topOf(node: Node): HTMLElement | undefined {
        let at: Node | null = node;
        while (at && at.parentNode !== root) at = at.parentNode;
        return at && isElement(at) ? at : undefined;
    }

    function holderAt(path: number[]): HTMLElement | undefined {
        const top = root.children[path[0]!] as HTMLElement | undefined;
        if (!top) return undefined;
        const inner = path.slice(1).join(",");
        return top.dataset.holder === inner ? top : (top.querySelector(`[data-holder="${inner}"]`) as HTMLElement | null) ?? undefined;
    }

    /** A DOM point as a model position. */
    function toPosition(node: Node, offset: number): { path: number[]; offset: number } | undefined {
        if (node === root) {
            const top = root.children[Math.min(offset, root.children.length - 1)] as HTMLElement | undefined;
            if (!top) return undefined;
            const atEnd = offset >= root.children.length;
            return edgeOf(top, atEnd);
        }
        if (!root.contains(node)) return undefined;
        const holder = (isElement(node) ? node : node.parentElement)?.closest("[data-holder]") as HTMLElement | null;
        const top = topOf(node);
        if (!top) return undefined;
        const index = [...root.children].indexOf(top);
        if (holder && root.contains(holder)) {
            const inner = holder.dataset.holder ? holder.dataset.holder.split(",").map(Number) : [];
            return { path: [index, ...inner], offset: offsetIn(holder, node, offset) };
        }
        // a point between blocks inside a list or quote: the nearest text
        if (isElement(node) && node.childNodes.length) {
            const child = node.childNodes[Math.min(offset, node.childNodes.length - 1)]!;
            if (isElement(child)) return edgeOf(child, offset >= node.childNodes.length) ?? { path: [index], offset: 0 };
        }
        return { path: [index], offset: 0 };
    }

    function edgeOf(element: HTMLElement, end: boolean): { path: number[]; offset: number } | undefined {
        const holders = [...element.querySelectorAll<HTMLElement>("[data-holder]")];
        if (element.dataset.holder !== undefined) holders.unshift(element);
        const top = topOf(element) ?? element;
        const index = [...root.children].indexOf(top);
        const holder = end ? holders[holders.length - 1] : holders[0];
        if (!holder) return { path: [index], offset: 0 };
        const inner = holder.dataset.holder ? holder.dataset.holder.split(",").map(Number) : [];
        return { path: [index, ...inner], offset: end ? units(holder) : 0 };
    }

    function toPoint(position: { path: number[]; offset: number }): { node: Node; offset: number } {
        const holder = holderAt(position.path);
        if (holder) return pointIn(holder, position.offset);
        const top = root.children[position.path[0]!];
        if (top) return { node: root, offset: [...root.children].indexOf(top) };
        return { node: root, offset: root.childNodes.length };
    }

    function readSelection(): Selection | undefined {
        const selection = document.getSelection();
        if (!selection?.anchorNode || !selection.focusNode || !root.contains(selection.anchorNode)) return undefined;
        const anchor = toPosition(selection.anchorNode, selection.anchorOffset);
        const focus = toPosition(selection.focusNode, selection.focusOffset);
        return anchor && focus ? { anchor, focus } : undefined;
    }

    function placeSelection() {
        if (document.activeElement !== root && !root.contains(document.activeElement)) return;
        const selection = document.getSelection();
        if (!selection) return;
        const anchor = toPoint(editor.state.selection.anchor);
        const focus = toPoint(editor.state.selection.focus);
        if (selection.anchorNode === anchor.node && selection.anchorOffset === anchor.offset && selection.focusNode === focus.node && selection.focusOffset === focus.offset) return;
        selection.setBaseAndExtent(anchor.node, anchor.offset, focus.node, focus.offset);
    }

    function rect(): DOMRect | null {
        const selection = document.getSelection();
        if (!selection?.rangeCount || !root.contains(selection.anchorNode)) return null;
        const range = selection.getRangeAt(0);
        const box = range.getBoundingClientRect();
        if (box.width || box.height) return box;
        const first = range.getClientRects()[0];
        if (first) return first;
        const holder = holderAt(editor.state.selection.focus.path);
        return holder?.getBoundingClientRect() ?? null;
    }

    function announce() {
        const { state } = editor;
        emit("select", { selection: state.selection, marks: activeMarks(state), block: activeBlock(state.doc, state.selection.focus.path), rect: rect() });
    }

    /** Puts a new editor in place: draws what changed, puts the cursor back, tells the listeners. */
    function commit(next: Editor, outcome?: Outcome) {
        const changed = next.state.doc !== editor.state.doc;
        editor = next;
        if (changed) render();
        markHere();
        placeSelection();
        if (changed) emit("change", { doc: editor.state.doc });
        announce();
        if (outcome && "state" in outcome && outcome.slash) emit("slash", { selection: editor.state.selection, rect: rect() });
    }

    function send(input: Input): boolean {
        const { editor: next, outcome } = step(editor, input, Date.now(), { symbols });
        if (!outcome) return false;
        if ("action" in outcome && outcome.action === "link") {
            emit("link", { selection: editor.state.selection, rect: rect() });
            return true;
        }
        commit(next, outcome);
        return true;
    }

    function syncSelection() {
        const selection = readSelection();
        if (!selection) return;
        const same = JSON.stringify(selection) === JSON.stringify(editor.state.selection);
        if (same) return;
        // the cursor moved by hand: waiting marks are forgotten and typing starts a new undo step
        editor = apply(editor, { state: { doc: editor.state.doc, selection }, kind: "move" }, Date.now());
        markHere();
        announce();
    }

    // ---- events ----

    /** True for an event from a field inside the document, such as a picture's alt text, which is the field's own. */
    const fromField = (event: Event) => event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement;

    function onKeyDown(event: KeyboardEvent) {
        if (fromField(event)) return;
        // Safari sends key 229 for keys that belong to a composition
        if (composing || event.isComposing || (event as { keyCode?: number }).keyCode === 229) return;
        const mod = MAC ? event.metaKey : event.ctrlKey;
        // Ctrl+Shift+V pastes, through the paste event, without formatting
        if (mod && event.shiftKey && event.code === "KeyV") plainNext = true;
        let key = event.key;
        if (mod && /^Key[A-Z]$/.test(event.code)) key = event.code.slice(3).toLowerCase();
        if (mod && /^Digit[0-9]$/.test(event.code)) key = event.code.slice(5);
        if (!mod && !["Enter", "Backspace", "Delete", "Tab"].includes(key)) return;
        if (MAC && event.ctrlKey && !mod) return;
        syncSelection();
        const word = (key === "Backspace" || key === "Delete") && (MAC ? event.altKey : event.ctrlKey);
        if (send({ type: "key", key, shift: event.shiftKey, mod: mod && !word, alt: event.altKey && !word, word })) event.preventDefault();
    }

    function selectTargetRange(event: InputEvent) {
        const range = event.getTargetRanges?.()[0];
        if (!range) return;
        const anchor = toPosition(range.startContainer, range.startOffset);
        const focus = toPosition(range.endContainer, range.endOffset);
        if (anchor && focus) editor = { ...editor, state: { doc: editor.state.doc, selection: { anchor, focus } } };
    }

    function onBeforeInput(event: InputEvent) {
        if (fromField(event)) return;
        if (composing || event.isComposing || event.inputType === "insertCompositionText" || event.inputType === "deleteCompositionText" || event.inputType === "insertFromComposition") return;
        event.preventDefault();
        syncSelection();
        const type = event.inputType;
        const text = event.data ?? event.dataTransfer?.getData("text/plain") ?? "";
        switch (type) {
            case "insertText":
            case "insertReplacementText": {
                const range = event.getTargetRanges?.()[0];
                if (type === "insertReplacementText" || (range && !range.collapsed)) selectTargetRange(event);
                send({ type: "text", text });
                return;
            }
            case "insertParagraph":
                send({ type: "key", key: "Enter" });
                return;
            case "insertLineBreak":
                send({ type: "key", key: "Enter", shift: true });
                return;
            case "deleteContentBackward":
                send({ type: "key", key: "Backspace" });
                return;
            case "deleteContentForward":
                send({ type: "key", key: "Delete" });
                return;
            case "deleteWordBackward":
                send({ type: "key", key: "Backspace", word: true });
                return;
            case "deleteWordForward":
                send({ type: "key", key: "Delete", word: true });
                return;
            case "deleteSoftLineBackward":
            case "deleteHardLineBackward":
            case "deleteSoftLineForward":
            case "deleteHardLineForward":
            case "deleteContent":
            case "deleteEntireSoftLine":
                selectTargetRange(event);
                if (!collapsed(editor.state.selection)) send({ type: "key", key: "Backspace" });
                return;
            case "historyUndo":
                undo();
                return;
            case "historyRedo":
                redo();
                return;
            case "formatBold":
                send({ type: "key", key: "b", mod: true });
                return;
            case "formatItalic":
                send({ type: "key", key: "i", mod: true });
                return;
            case "formatUnderline":
                send({ type: "key", key: "u", mod: true });
                return;
            case "formatStrikeThrough":
                send({ type: "key", key: "x", mod: true, shift: true });
                return;
        }
        // paste, drop and cut come through their own events; anything else is not let through
    }

    function onCompositionStart() {
        syncSelection();
        // what is selected goes first, so the composed text replaces it
        if (!collapsed(editor.state.selection)) send({ type: "key", key: "Backspace" });
        composing = true;
        composedAt = editor.state.selection;
    }

    function onCompositionEnd(event: CompositionEvent) {
        composing = false;
        const at = composedAt ?? editor.state.selection;
        composedAt = undefined;
        // the browser wrote the composed text into the block itself: that block is drawn again from the model
        const top = editor.state.doc.blocks[at.focus.path[0]!];
        if (top) drawn.delete(top);
        render();
        editor = { ...editor, state: { ...editor.state, selection: at } };
        if (event.data) send({ type: "text", text: event.data });
        else commit(editor);
    }

    function onInput(event: Event) {
        if (composing || fromField(event)) return;
        // the browser changed the page by some way not cancelled: everything is drawn again from the model
        drawn = new WeakMap();
        root.replaceChildren();
        render();
        placeSelection();
    }

    function onSelectionChange() {
        if (composing || document.activeElement instanceof HTMLInputElement || document.activeElement instanceof HTMLTextAreaElement) return;
        syncSelection();
    }

    /** The model path a control inside a drawn block stands for, from the inner path it carries. */
    function pathOf(element: HTMLElement, inner: string | undefined): number[] {
        return [[...root.children].indexOf(topOf(element)!), ...(inner ? inner.split(",").map(Number) : [])];
    }

    function onMouseDown(event: MouseEvent) {
        const target = event.target as HTMLElement;
        // laid-out maths: pressing it puts the cursor at the end of its source, which then shows
        const shown = target.closest?.("[data-shown]") as HTMLElement | null;
        if (shown && root.contains(shown)) {
            event.preventDefault();
            const at = toPosition(shown.parentNode!, [...shown.parentNode!.childNodes].indexOf(shown));
            root.focus({ preventScroll: true });
            if (at) commit(apply(editor, { state: { doc: editor.state.doc, selection: { anchor: at, focus: at } }, kind: "move" }, Date.now()));
            return;
        }
        // a callout's label steps to the next kind; a folding section's button sets whether it starts open
        const kind = target.closest?.("[data-callout-kind]") as HTMLElement | null;
        if (kind && root.contains(kind)) {
            event.preventDefault();
            const path = pathOf(kind, kind.dataset.calloutKind);
            const block = blockAt(editor.state.doc, path);
            if (block?.kind !== "quote" || block.callout === undefined) return;
            const next = CALLOUTS[(CALLOUTS.indexOf(block.callout.toUpperCase()) + 1) % CALLOUTS.length]!;
            run((doc) => setBox(doc, path, { callout: next }));
            return;
        }
        const fold = target.closest?.("[data-fold]") as HTMLElement | null;
        if (fold && root.contains(fold)) {
            event.preventDefault();
            const path = pathOf(fold, fold.dataset.fold);
            const block = blockAt(editor.state.doc, path);
            if (block?.kind === "quote" && block.details) run((doc) => setBox(doc, path, { details: { ...block.details!, open: !block.details!.open } }));
            return;
        }
        const box = target.closest?.("[data-box]") as HTMLElement | null;
        if (!box || !root.contains(box)) return;
        event.preventDefault();
        const path = pathOf(box, box.dataset.box);
        run((doc) => toggleTask(doc, path));
    }

    function looksLikeMarkdown(text: string): boolean {
        return /^(#{1,6} |[-*+] |\d{1,9}[.)] |> |```|\|.*\|$)/m.test(text) || /\*\*[^*\n]+\*\*|\[[^\]\n]+\]\([^)\n]+\)|`[^`\n]+`/.test(text);
    }

    async function takeData(data: DataTransfer | null) {
        if (!data) return;
        const files = [...data.files].filter((file) => file.type.startsWith("image/"));
        if (files.length && options.onImage) {
            for (const file of files) {
                // a store that cannot keep the picture says why, and nothing is put in the text
                const address = await options.onImage(file).catch(() => undefined);
                if (!address) continue;
                insertBlocks([imageBlock(address, file.name.replace(/\.[^.]+$/, ""))]);
            }
            return;
        }
        const html = data.getData("text/html");
        const text = data.getData("text/plain");
        // Ctrl+Shift+V: the text alone, nothing read from it
        if (plainNext) {
            plainNext = false;
            return insertPlain(text);
        }
        const kind = blockAt(editor.state.doc, editor.state.selection.focus.path)?.kind;
        if (kind === "code" || kind === "raw") return insertBlocks([paragraph(text)]);
        const fromHtml = html ? readHtml(html) : [];
        if (fromHtml.length) return insertBlocks(fromHtml);
        if (!text) return;
        if (looksLikeMarkdown(text)) return insertBlocks(read(text.replace(/\r\n?/g, "\n"), { mdx: editor.state.doc.mdx }).blocks);
        insertBlocks(
            text
                .split(/\r?\n/)
                .filter((line) => line.trim() !== "")
                .map((line) => paragraph(line)),
        );
    }

    /** Pasting without formatting: each line of the text a paragraph, in a code block the text as it is. */
    let plainNext = false;
    function insertPlain(text: string) {
        const kind = blockAt(editor.state.doc, editor.state.selection.focus.path)?.kind;
        if (kind === "code" || kind === "raw") return insertBlocks([paragraph(text)]);
        insertBlocks(
            text
                .split(/\r?\n/)
                .filter((line) => line.trim() !== "")
                .map((line) => paragraph(line)),
        );
    }

    function insertBlocks(blocks: Block[]) {
        if (blocks.length === 0) return;
        // a Markdown file cannot keep a typeface or a highlight, so what is pasted into one comes without them
        commit(apply(editor, { state: paste(editor.state, editor.state.doc.quire ? blocks : markdownOnly(blocks)), kind: "paste" }, Date.now()));
    }

    function onPaste(event: ClipboardEvent) {
        if (fromField(event)) return;
        event.preventDefault();
        syncSelection();
        void takeData(event.clipboardData);
    }

    function copyTo(event: ClipboardEvent): boolean {
        syncSelection();
        if (collapsed(editor.state.selection) || !event.clipboardData) return false;
        event.preventDefault();
        const blocks = fragment(editor.state.doc, editor.state.selection);
        event.clipboardData.setData("text/plain", write(documentOf(blocks, { mdx: editor.state.doc.mdx })));
        event.clipboardData.setData("text/html", writeHtml(blocks));
        return true;
    }

    function onCopy(event: ClipboardEvent) {
        copyTo(event);
    }

    function onCut(event: ClipboardEvent) {
        if (copyTo(event)) send({ type: "key", key: "Backspace" });
    }

    function onDragOver(event: DragEvent) {
        event.preventDefault();
    }

    function onDrop(event: DragEvent) {
        event.preventDefault();
        const place = (document as unknown as { caretPositionFromPoint?: (x: number, y: number) => { offsetNode: Node; offset: number } | null }).caretPositionFromPoint?.(event.clientX, event.clientY);
        // older Safari has only the older name
        const range = place ? undefined : (document as unknown as { caretRangeFromPoint?: (x: number, y: number) => globalThis.Range | null }).caretRangeFromPoint?.(event.clientX, event.clientY);
        const node = place?.offsetNode ?? range?.startContainer;
        const at = node && toPosition(node, place?.offset ?? range?.startOffset ?? 0);
        if (at) editor = apply(editor, { state: { doc: editor.state.doc, selection: { anchor: at, focus: at } }, kind: "move" }, Date.now());
        void takeData(event.dataTransfer);
    }

    function onDragStart(event: DragEvent) {
        // moving text by dragging it inside the document is not done; the model would not see it
        event.preventDefault();
    }

    const handlers: [EventTarget, string, EventListener][] = [
        [root, "keydown", onKeyDown as EventListener],
        [root, "beforeinput", onBeforeInput as EventListener],
        [root, "input", onInput],
        [root, "compositionstart", onCompositionStart],
        [root, "compositionend", onCompositionEnd as EventListener],
        [root, "mousedown", onMouseDown as EventListener],
        [root, "paste", onPaste as EventListener],
        [root, "copy", onCopy as EventListener],
        [root, "cut", onCut as EventListener],
        [root, "dragover", onDragOver as EventListener],
        [root, "drop", onDrop as EventListener],
        [root, "dragstart", onDragStart as EventListener],
        [root, "change", onAltChange],
        [document, "selectionchange", onSelectionChange],
    ];
    for (const [target, name, handler] of handlers) target.addEventListener(name, handler);

    // ---- the interface ----

    function run(operation: Operation, kind: ChangeKind = "format") {
        const result = operation(editor.state.doc, editor.state.selection);
        const state: State = "blocks" in result ? { doc: result, selection: fit(result, editor.state.selection) } : result;
        commit(apply(editor, { state, kind }, Date.now()));
    }

    /** A field inside the document was changed: a picture's alt text, a code block's language, a folding section's summary, or a component's property. */
    function onAltChange(event: Event) {
        const field = event.target as HTMLInputElement;
        if (field.matches?.("[data-alt]")) {
            const path = pathOf(field, field.dataset.alt);
            run((doc) => setImageAlt(doc, path, field.value));
        } else if (field.matches?.("[data-lang]")) {
            const path = pathOf(field, field.dataset.lang);
            run((doc) => changeKind(doc, path, { kind: "code", language: field.value.trim() }));
        } else if (field.matches?.("[data-summary]")) {
            const path = pathOf(field, field.dataset.summary);
            const block = blockAt(editor.state.doc, path);
            if (block?.kind === "quote" && block.details) run((doc) => setBox(doc, path, { details: { ...block.details!, summary: field.value } }));
        } else if (field.matches?.("[data-prop]")) {
            const card = field.closest<HTMLElement>("[data-card]")!;
            const path = pathOf(card, card.dataset.card);
            const block = blockAt(editor.state.doc, path);
            if (block?.kind === "raw") run((doc) => setRaw(doc, path, setProp(block.text, field.dataset.prop!, field.type === "checkbox" ? field.checked : field.value)));
        }
    }

    /** Keeps a selection where it is if it still points somewhere, or moves it to the first text. */
    function fit(doc: Document, selection: Selection): Selection {
        const valid = (path: number[]) => blockAt(doc, path) !== undefined || (path.length >= 3 && blockAt(doc, path.slice(0, -2))?.kind === "table");
        return valid(selection.anchor.path) && valid(selection.focus.path) ? selection : caret(firstText(doc), 0);
    }

    function undo() {
        const back = undoStep(editor.history);
        if (back) commit({ state: back.state, history: back.history });
    }

    function redo() {
        const again = redoStep(editor.history);
        if (again) commit({ state: again.state, history: again.history });
    }

    render();

    return {
        getDocument: () => editor.state.doc,
        setDocument(doc) {
            const next = ensure(doc);
            drawn = new WeakMap();
            editor = { state: { doc: next, selection: caret(firstText(next), 0) }, history: createHistory() };
            root.replaceChildren();
            render();
            placeSelection();
            emit("change", { doc: next });
            announce();
        },
        getSelection: () => editor.state.selection,
        element: root,
        elementAt(path) {
            return holderAt(path) ?? (root.children[path[0]!] as HTMLElement | undefined);
        },
        rangeOf(start, end) {
            if (!holderAt(start.path) || !holderAt(end.path)) return undefined;
            const range = document.createRange();
            const from = toPoint(start);
            const to = toPoint(end);
            range.setStart(from.node, from.offset);
            range.setEnd(to.node, to.offset);
            return range;
        },
        setSelection(selection) {
            commit(apply(editor, { state: { doc: editor.state.doc, selection: fit(editor.state.doc, selection) }, kind: "move" }, Date.now()));
        },
        run,
        undo,
        redo,
        focus() {
            root.focus({ preventScroll: true });
            placeSelection();
            // the bars learn where the cursor is as soon as there is one
            announce();
        },
        on(name, listener) {
            const set = listeners.get(name) ?? new Set();
            set.add(listener as (detail: never) => void);
            listeners.set(name, set);
            return () => set.delete(listener as (detail: never) => void);
        },
        setSymbols(on) {
            if (on === symbols) return;
            symbols = on;
            // the joined signs are drawn or not, so the document is drawn again
            drawn = new WeakMap();
            root.replaceChildren();
            render();
            markHere();
            placeSelection();
        },
        symbols: () => symbols,
        pasteText(text) {
            syncSelection();
            insertPlain(text);
        },
        destroy() {
            for (const [target, name, handler] of handlers) target.removeEventListener(name, handler);
            root.contentEditable = "false";
        },
    };
}
