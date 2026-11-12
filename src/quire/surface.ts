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

import { blockAt, blockPaths, documentOf, image as imageBlock, paragraph, setImageAlt, toggleTask, type Block, type Document, type Leaf, type Mark, type Run, type Selection } from "./document";
import { createHistory, redo as redoStep, undo as undoStep, type ChangeKind, type State } from "./history";
import { readHtml, writeHtml } from "./html";
import { activeBlock, activeMarks, apply, caret, collapsed, fragment, paste, step, type Editor, type Input, type Outcome } from "./keys";
import { read } from "./read";
import { write } from "./write";

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
    undo(): void;
    redo(): void;
    focus(): void;
    on<K extends keyof SurfaceEvents>(name: K, listener: (detail: SurfaceEvents[K]) => void): () => void;
    destroy(): void;
}

const MAC = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform);
const TAGS: [Mark, string][] = [
    ["bold", "strong"],
    ["italic", "em"],
    ["underline", "u"],
    ["strike", "s"],
    ["code", "code"],
];

// ---- drawing ----

/** Draws one leaf of text: the text inside an element for each of its marks. */
function drawLeaf(leaf: Leaf): Node {
    if (leaf.kind === "break") return document.createElement("br");
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
    let node: Node = document.createTextNode(leaf.text);
    for (const [mark, tag] of [...TAGS].reverse()) {
        if (!leaf.marks.includes(mark)) continue;
        const wrap = document.createElement(tag);
        wrap.append(node);
        node = wrap;
    }
    if (leaf.color || leaf.size) {
        const span = document.createElement("span");
        if (leaf.color) span.style.color = leaf.color;
        if (leaf.size) span.style.fontSize = leaf.size;
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

function fillRuns(holder: HTMLElement, runs: Run[]) {
    for (const run of runs) {
        if (run.kind !== "link") {
            holder.append(drawLeaf(run));
            continue;
        }
        const link = document.createElement("a");
        link.href = run.href;
        if (run.title) link.title = run.title;
        for (const leaf of run.runs) link.append(drawLeaf(leaf));
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

/** Draws a block, `inner` being its path inside the top-level block it belongs to. */
function draw(block: Block, inner: number[]): HTMLElement {
    switch (block.kind) {
        case "paragraph":
        case "heading": {
            const element = holderOf(document.createElement(block.kind === "paragraph" ? "p" : `h${block.level}`), inner);
            if (block.align) element.style.textAlign = block.align;
            fillRuns(element, block.runs);
            return element;
        }
        case "list": {
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
                item.blocks.forEach((child, j) => li.append(draw(child, [...inner, k, j])));
                element.append(li);
            });
            return element;
        }
        case "quote":
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
            block.blocks.forEach((child, j) => element.append(draw(child, [...inner, j])));
            return element;
        }
        case "code":
        case "raw": {
            const pre = document.createElement("pre");
            pre.className = block.kind === "code" ? "quire-code" : "quire-raw";
            pre.dataset.label = block.kind === "code" ? block.language : "raw";
            const holder = holderOf(document.createElement("code"), inner);
            fillText(holder, block.kind === "code" ? block.code : block.text);
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
                fillRuns(element, runs);
                row.append(element);
            };
            block.header.forEach((runs, c) => cell(head, runs, 0, c, "th"));
            block.rows.forEach((cells, r) => {
                const row = body.insertRow();
                cells.forEach((runs, c) => cell(row, runs, r + 1, c, "td"));
            });
            return table;
        }
        case "image": {
            const figure = document.createElement("figure");
            figure.className = "quire-image";
            figure.contentEditable = "false";
            if (block.align) figure.style.textAlign = block.align;
            const picture = document.createElement("img");
            picture.src = block.src;
            picture.alt = block.alt;
            // the alt text sits under the picture, written in place; it is kept when the field is left
            const alt = document.createElement("input");
            alt.className = "quire-alt";
            alt.value = block.alt;
            alt.placeholder = "Describe the picture";
            alt.setAttribute("aria-label", "What the picture shows");
            alt.dataset.alt = inner.join(",");
            figure.append(picture, alt);
            return figure;
        }
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
    if ("filler" in node.dataset) return 0;
    if (isAtom(node)) return 1;
    let sum = 0;
    for (const child of node.childNodes) sum += units(child);
    return sum;
}

/** The offset in a holder's text of a DOM point inside it. */
function offsetIn(holder: HTMLElement, node: Node, offset: number): number {
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
        return blockPaths(doc).find((path) => ["paragraph", "heading", "code", "raw"].includes(blockAt(doc, path)?.kind ?? "")) ?? [0];
    }

    function emit<K extends keyof SurfaceEvents>(name: K, detail: SurfaceEvents[K]) {
        for (const listener of listeners.get(name) ?? []) (listener as (detail: SurfaceEvents[K]) => void)(detail);
    }

    // ---- drawing the document ----

    function render() {
        const fresh: HTMLElement[] = [];
        const wanted = editor.state.doc.blocks.map((block) => {
            let element = drawn.get(block);
            if (!element) {
                element = draw(block, []);
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
        placeSelection();
        if (changed) emit("change", { doc: editor.state.doc });
        announce();
        if (outcome && "state" in outcome && outcome.slash) emit("slash", { selection: editor.state.selection, rect: rect() });
    }

    function send(input: Input): boolean {
        const { editor: next, outcome } = step(editor, input, Date.now());
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

    function onMouseDown(event: MouseEvent) {
        const box = (event.target as HTMLElement).closest?.("[data-box]") as HTMLElement | null;
        if (!box || !root.contains(box)) return;
        event.preventDefault();
        const top = topOf(box);
        const path = [[...root.children].indexOf(top!), ...box.dataset.box!.split(",").map(Number)];
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

    function insertBlocks(blocks: Block[]) {
        if (blocks.length === 0) return;
        commit(apply(editor, { state: paste(editor.state, blocks), kind: "paste" }, Date.now()));
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

    function onAltChange(event: Event) {
        const field = event.target as HTMLInputElement;
        if (!field.matches?.("[data-alt]")) return;
        const top = topOf(field);
        const path = [[...root.children].indexOf(top!), ...(field.dataset.alt ? field.dataset.alt.split(",").map(Number) : [])];
        run((doc) => setImageAlt(doc, path, field.value));
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
        destroy() {
            for (const [target, name, handler] of handlers) target.removeEventListener(name, handler);
            root.contentEditable = "false";
        },
    };
}
