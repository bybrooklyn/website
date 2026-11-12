// What a key or a piece of typed text means to a document: a function from the state (document,
// selection, waiting marks) and a description of the input to the new state, or null when the
// input is not mdQuire's and the browser may have it (arrows, Home, a Tab outside a list or table).
// Pure, so every behaviour is tested without a browser; surface.ts turns DOM events into inputs.
//
// Markdown typed as you go turns into what it means as soon as it is complete: `## ` makes a
// heading, `**bold**` makes bold when the last `*` is typed. Such an outcome carries `literal`, the
// state with the characters as typed, so that the history can keep it as a step of its own and one
// undo gives the characters back.

import {
    addRow,
    blockAt,
    blockPaths,
    changeKind,
    comparePositions,
    deleteText,
    divider,
    indent,
    insertAtom,
    insertBlock,
    insertRunsAt,
    insertText,
    joinBlock,
    lengthOf,
    ordered,
    outdent,
    paragraph,
    removeBlock,
    runsLength,
    runsText,
    sliceRuns,
    splitBlock,
    textAt,
    toggleMark,
    toggleTask,
    type Block,
    type Document,
    type Level,
    type ListItem,
    type ListStyle,
    type Mark,
    type Position,
    type Range,
    type Run,
    type Selection,
} from "./document";
import { record, redo, seal, undo, type ChangeKind, type History, type State } from "./history";

/** A piece of input: text typed (or given by the keyboard of a phone), or a named key with its modifiers. `mod` is Ctrl, or Cmd on a Mac. */
export type Input = { type: "text"; text: string } | { type: "key"; key: string; shift?: boolean; mod?: boolean; alt?: boolean; word?: boolean };

/** What an input did: a new state and what kind of change it was, or an action for the surface to take. "move" changes only the selection. */
export type Outcome = { state: State; kind: ChangeKind | "move"; literal?: State; slash?: boolean } | { action: "undo" | "redo" | "link" } | null;

// ---- places ----

/** A selection with nothing selected, at one position. */
export const caret = (path: number[], offset: number): Selection => ({ anchor: { path, offset }, focus: { path, offset } });

/** True if nothing is selected. */
export const collapsed = (selection: Selection) => comparePositions(selection.anchor, selection.focus) === 0;

/** A selection as a range in reading order. */
export const rangeOf = (selection: Selection): Range => ordered({ start: selection.anchor, end: selection.focus });

const samePath = (a: number[], b: number[]) => a.length === b.length && a.every((step, index) => step === b[index]);

/** The table a cell path points into, or undefined if the path is not a cell's. */
function tableOf(doc: Document, path: number[]): number[] | undefined {
    if (path.length < 3 || blockAt(doc, path)) return undefined;
    const table = path.slice(0, -2);
    return blockAt(doc, table)?.kind === "table" ? table : undefined;
}

/** The block a position is in, the table for a cell. */
const leafOf = (doc: Document, path: number[]) => tableOf(doc, path) ?? path;
const indexOf = (doc: Document, path: number[]) => blockPaths(doc).findIndex((each) => samePath(each, leafOf(doc, path)));
const textual = (block?: Block) => block?.kind === "paragraph" || block?.kind === "heading";

/** True if the block at a path sits directly in a list item. */
function inItem(doc: Document, path: number[]): boolean {
    return path.length >= 3 && blockAt(doc, path.slice(0, -2))?.kind === "list";
}

function inQuote(doc: Document, path: number[]): boolean {
    return path.length >= 2 && blockAt(doc, path.slice(0, -1))?.kind === "quote";
}

/** The marks of the character before a position, or after it at the start of a block. */
function marksNear(doc: Document, at: Position): Mark[] {
    const block = blockAt(doc, at.path);
    const runs = textual(block) ? (block as { runs: Run[] }).runs : tableOf(doc, at.path) ? cellRuns(doc, at.path) : undefined;
    if (!runs) return [];
    const piece = at.offset > 0 ? sliceRuns(runs, at.offset - 1, at.offset) : sliceRuns(runs, 0, 1);
    const first = piece[0];
    const leaf = first?.kind === "link" ? first.runs[0] : first;
    return leaf?.kind === "text" ? [...leaf.marks] : [];
}

function cellRuns(doc: Document, path: number[]): Run[] | undefined {
    const table = blockAt(doc, path.slice(0, -2));
    if (table?.kind !== "table") return undefined;
    const row = path[path.length - 2]!;
    return (row === 0 ? table.header : table.rows[row - 1])?.[path[path.length - 1]!];
}

/** The marks the next typed text will take: those waiting from a shortcut, or those of the character before the cursor. */
export function activeMarks(state: State): Mark[] {
    return state.marks ?? marksNear(state.doc, state.selection.focus);
}

/** What kind of block the cursor is in, for a bar to show. */
export function activeBlock(doc: Document, path: number[]): { kind: Block["kind"] | "cell"; level?: Level; list?: ListStyle; quoted: boolean } {
    const quoted = path.some((_, depth) => blockAt(doc, path.slice(0, depth + 1))?.kind === "quote");
    if (tableOf(doc, path)) return { kind: "cell", quoted };
    const block = blockAt(doc, path);
    const owner = inItem(doc, path) ? blockAt(doc, path.slice(0, -2)) : undefined;
    const out: ReturnType<typeof activeBlock> = { kind: block?.kind ?? "paragraph", quoted };
    if (block?.kind === "heading") out.level = block.level;
    if (owner?.kind === "list") out.list = owner.style;
    return out;
}

// ---- small steps ----

/** Deletes what is selected, giving the document and the position the cursor goes to. */
function clear(state: State): { doc: Document; at: Position } {
    if (collapsed(state.selection)) return { doc: state.doc, at: state.selection.focus };
    const { start, end } = rangeOf(state.selection);
    // a selection that ends inside a table cell only clears the text, the table stays
    if (!samePath(start.path, end.path) && (tableOf(state.doc, start.path) || tableOf(state.doc, end.path))) return { doc: state.doc, at: start };
    return { doc: deleteText(state.doc, { start, end }), at: start };
}

const done = (doc: Document, selection: Selection, kind: ChangeKind | "move", marks?: Mark[]): Outcome => ({ state: marks ? { doc, selection, marks } : { doc, selection }, kind });

/** Where the cursor goes when the block it was in moved: the same place in reading order. */
function sameLeaf(before: Document, path: number[], after: Document, shift = 0): number[] {
    const index = indexOf(before, path);
    return blockPaths(after)[Math.max(0, index + shift)] ?? path;
}

// ---- typing ----

function type(state: State, text: string): Outcome {
    const { doc, at } = clear(state);
    const block = blockAt(doc, at.path);
    if (!block && !tableOf(doc, at.path)) return null;
    if (block && !textual(block) && block.kind !== "code" && block.kind !== "raw") {
        // typing on a picture or divider starts a paragraph after it
        const next = insertText(insertBlock(doc, at.path, paragraph()), { path: nextSibling(at.path), offset: 0 }, text);
        return done(next, caret(nextSibling(at.path), text.length), "type");
    }
    const typed = insertText(doc, at, text, state.marks);
    const after: State = { doc: typed, selection: caret(at.path, at.offset + text.length) };
    if (state.marks) after.marks = state.marks;
    const slash = text === "/" && block?.kind === "paragraph" && runsLength(block.runs) === 0;
    const shortcut = textual(block) ? blockShortcut(after, text) ?? inlineShortcut(after, text) : tableOf(doc, at.path) ? inlineShortcut(after, text) : undefined;
    if (shortcut) return { state: shortcut, kind: "shortcut", literal: after };
    return { state: after, kind: "type", slash };
}

const nextSibling = (path: number[]) => [...path.slice(0, -1), path[path.length - 1]! + 1];

/** `# `, `- `, `1. `, `[ ] `, `> ` at the start of a paragraph, three backticks, or `---`. */
function blockShortcut(state: State, typed: string): State | undefined {
    const { doc } = state;
    const at = state.selection.focus;
    const block = blockAt(doc, at.path);
    if (block?.kind !== "paragraph") return undefined;
    const text = runsText(block.runs);
    const before = text.slice(0, at.offset);
    const strip = () => deleteText(doc, { start: { path: at.path, offset: 0 }, end: at });
    const land = (next: Document, offset = 0): State => ({ doc: next, selection: caret(sameLeaf(doc, at.path, next), offset) });

    if (typed === " ") {
        const hashes = /^(#{1,6}) $/.exec(before);
        if (hashes) return land(changeKind(strip(), at.path, { kind: "heading", level: hashes[1]!.length as Level }));
        const box = /^\[([ xX]?)\] $/.exec(before);
        if (box) {
            const ticked = box[1] === "x" || box[1] === "X";
            if (inItem(doc, at.path)) {
                const owner = blockAt(doc, at.path.slice(0, -2));
                if (owner?.kind !== "list") return undefined;
                let next = toggleTask(strip(), at.path);
                if (ticked) next = toggleTask(next, at.path);
                return land(next);
            }
            let next = changeKind(strip(), at.path, { kind: "list", style: "task" });
            if (ticked) next = toggleTask(next, sameLeaf(doc, at.path, next));
            return land(next);
        }
        if (inItem(doc, at.path)) return undefined;
        if (/^[-*+] $/.test(before)) return land(changeKind(strip(), at.path, { kind: "list", style: "bullet" }));
        if (/^\d{1,9}[.)] $/.test(before)) return land(changeKind(strip(), at.path, { kind: "list", style: "number" }));
        if (before === "> " && !inQuote(doc, at.path)) return land(changeKind(strip(), at.path, { kind: "quote" }));
    }
    if (typed === "`" && text === "```") return land(changeKind(strip(), at.path, { kind: "code", language: "" }));
    if (typed === "-" && text === "---") {
        let next = insertBlock(doc, at.path, divider());
        next = insertBlock(next, nextSibling(at.path), paragraph());
        next = removeBlock(next, at.path);
        return { doc: next, selection: caret(sameLeaf(doc, at.path, next, 1), 0) };
    }
    return undefined;
}

const INLINE: [RegExp, Mark, number][] = [
    [/(^|[^*])\*\*([^*\s](?:[^*]*[^*\s])?)\*\*$/, "bold", 2],
    [/(^|[^~])~~([^~\s](?:[^~]*[^~\s])?)~~$/, "strike", 2],
    [/(^|[^*])\*([^*\s](?:[^*]*[^*\s])?)\*$/, "italic", 1],
    [/(^|[^`])`([^`]+)`$/, "code", 1],
];

/** `**bold**`, `*italic*`, `` `code` `` and `~~strike~~`, turned into the mark when the closing mark is typed. */
function inlineShortcut(state: State, typed: string): State | undefined {
    // text committed by an input method may be several characters: the last one is the closing mark
    const last = typed.slice(-1);
    if (!last || !"*`~".includes(last)) return undefined;
    const { doc } = state;
    const at = state.selection.focus;
    const before = textAt(doc, at.path).slice(0, at.offset);
    for (const [pattern, mark, width] of INLINE) {
        const match = pattern.exec(before);
        if (!match) continue;
        const start = match.index + match[1]!.length;
        // the marks must be plain typed characters: no pictures in the stretch, nothing in code
        if (/[￼\n]/.test(before.slice(start))) continue;
        let plain = true;
        for (let offset = start; offset < at.offset; offset++) if (marksNear(doc, { path: at.path, offset: offset + 1 }).includes("code")) plain = false;
        if (!plain) continue;
        let next = deleteText(doc, { start: { path: at.path, offset: at.offset - width }, end: at });
        next = deleteText(next, { start: { path: at.path, offset: start }, end: { path: at.path, offset: start + width } });
        const end = at.offset - width * 2;
        next = toggleMark(next, { start: { path: at.path, offset: start }, end: { path: at.path, offset: end } }, mark, true);
        const marks = marksNear(next, { path: at.path, offset: end }).filter((each) => each !== mark);
        return { doc: next, selection: caret(at.path, end), marks };
    }
    return undefined;
}

// ---- deleting ----

/** How far back (or forward) one character or one word reaches from an offset, counting a surrogate pair as one. */
function reach(text: string, offset: number, back: boolean, word: boolean): number {
    if (!word) {
        if (back) return offset >= 2 && /[\uDC00-\uDFFF]/.test(text[offset - 1]!) && /[\uD800-\uDBFF]/.test(text[offset - 2]!) ? 2 : 1;
        return /[\uD800-\uDBFF]/.test(text[offset] ?? "") && /[\uDC00-\uDFFF]/.test(text[offset + 1] ?? "") ? 2 : 1;
    }
    let index = offset;
    const step = back ? -1 : 1;
    const at = () => text[back ? index - 1 : index] ?? "";
    while (at() && /\s/.test(at())) index += step;
    while (at() && !/\s/.test(at())) index += step;
    return Math.max(1, Math.abs(index - offset));
}

function backspace(state: State, word: boolean): Outcome {
    if (!collapsed(state.selection)) {
        const { doc, at } = clear(state);
        return done(doc, caret(at.path, at.offset), "delete");
    }
    const { doc } = state;
    const at = state.selection.focus;
    const block = blockAt(doc, at.path);
    if (at.offset > 0) {
        const width = reach(textAt(doc, at.path), at.offset, true, word);
        return done(deleteText(doc, { start: { path: at.path, offset: at.offset - width }, end: at }), caret(at.path, at.offset - width), "delete");
    }
    if (tableOf(doc, at.path) || !block) return done(doc, state.selection, "move");
    // at the start of a block: a heading, list item or quote first becomes a plain paragraph
    if (block.kind === "heading") return done(changeKind(doc, at.path, { kind: "paragraph" }), state.selection, "structure");
    if (block.kind === "paragraph" && (inItem(doc, at.path) || inQuote(doc, at.path)) && at.path[at.path.length - 1] === 0) {
        const next = changeKind(doc, at.path, { kind: "paragraph" });
        return done(next, caret(sameLeaf(doc, at.path, next), 0), "structure");
    }
    if (block.kind === "code" && block.code === "") return done(changeKind(doc, at.path, { kind: "paragraph" }), state.selection, "structure");
    const paths = blockPaths(doc);
    const index = indexOf(doc, at.path);
    const previousPath = paths[index - 1];
    if (!previousPath) return done(doc, state.selection, "move");
    const previous = blockAt(doc, previousPath)!;
    if (previous.kind === "divider" || previous.kind === "image") {
        const next = removeBlock(doc, previousPath);
        return done(next, caret(sameLeaf(doc, at.path, next, -1), 0), "delete");
    }
    if (block.kind === "paragraph" && runsLength(block.runs) === 0) {
        const next = removeBlock(doc, at.path);
        return done(next, caret(...endOf(next, sameLeaf(doc, previousPath, next))), "delete");
    }
    if (previous.kind === "table") return done(doc, caret(...endOf(doc, lastCell(previous, previousPath))), "move");
    const length = lengthOf(doc, previousPath);
    const next = joinBlock(doc, at.path);
    if (next === doc) return done(doc, caret(previousPath, length), "move");
    return done(next, caret(sameLeaf(doc, previousPath, next), length), "delete");
}

function lastCell(table: Block, path: number[]): number[] {
    if (table.kind !== "table") return path;
    return [...path, table.rows.length, table.header.length - 1];
}

const endOf = (doc: Document, path: number[]): [number[], number] => [path, lengthOf(doc, path)];

function forwardDelete(state: State, word: boolean): Outcome {
    if (!collapsed(state.selection)) return backspace(state, word);
    const { doc } = state;
    const at = state.selection.focus;
    const block = blockAt(doc, at.path);
    const length = lengthOf(doc, at.path);
    if (at.offset < length) {
        const width = reach(textAt(doc, at.path), at.offset, false, word);
        return done(deleteText(doc, { start: at, end: { path: at.path, offset: at.offset + width } }), state.selection, "delete");
    }
    if (tableOf(doc, at.path) || !block) return done(doc, state.selection, "move");
    const paths = blockPaths(doc);
    const nextPath = paths[indexOf(doc, at.path) + 1];
    if (!nextPath) return done(doc, state.selection, "move");
    const following = blockAt(doc, nextPath)!;
    if (following.kind === "divider" || following.kind === "image") return done(removeBlock(doc, nextPath), state.selection, "delete");
    if (block.kind === "paragraph" && length === 0) {
        const next = removeBlock(doc, at.path);
        return done(next, caret(sameLeaf(doc, nextPath, next), 0), "delete");
    }
    const next = joinBlock(doc, nextPath);
    return next === doc ? done(doc, state.selection, "move") : done(next, caret(sameLeaf(doc, at.path, next), at.offset), "delete");
}

// ---- Enter, Shift+Enter, Tab ----

function enter(state: State): Outcome {
    const { doc, at } = clear(state);
    const table = tableOf(doc, at.path);
    if (table) {
        const found = blockAt(doc, table)!;
        if (found.kind !== "table") return null;
        const row = at.path[at.path.length - 2]!;
        const column = at.path[at.path.length - 1]!;
        const grown = row >= found.rows.length ? addRow(doc, table, found.rows.length) : doc;
        const below = [...table, row + 1, column];
        return done(grown, caret(below, lengthOf(grown, below)), grown === doc ? "move" : "structure");
    }
    const block = blockAt(doc, at.path);
    if (!block) return null;
    if (block.kind === "code") {
        // Enter on an empty last line of code leaves the code block
        if (at.offset === block.code.length && block.code.endsWith("\n")) {
            let next = deleteText(doc, { start: { path: at.path, offset: at.offset - 1 }, end: at });
            next = insertBlock(next, at.path, paragraph());
            return done(next, caret(nextSibling(at.path), 0), "structure");
        }
        return done(insertText(doc, at, "\n"), caret(at.path, at.offset + 1), "type");
    }
    if (block.kind === "raw") return done(insertText(doc, at, "\n"), caret(at.path, at.offset + 1), "type");
    if (!textual(block)) {
        const next = insertBlock(doc, at.path, paragraph());
        return done(next, caret(nextSibling(at.path), 0), "structure");
    }
    const count = blockPaths(doc).length;
    let next = splitBlock(doc, at);
    const grew = blockPaths(next).length > count;
    if (block.kind === "heading" && at.offset === 0 && runsLength(block.runs) > 0) next = changeKind(next, at.path, { kind: "paragraph" });
    return done(next, caret(sameLeaf(doc, at.path, next, grew ? 1 : 0), 0), "structure");
}

function softBreak(state: State): Outcome {
    const { doc, at } = clear(state);
    const block = blockAt(doc, at.path);
    if (block?.kind === "code" || block?.kind === "raw") return done(insertText(doc, at, "\n"), caret(at.path, at.offset + 1), "type");
    if (!textual(block) && !tableOf(doc, at.path)) return null;
    return done(insertAtom(doc, at, { kind: "break" }), caret(at.path, at.offset + 1), "type");
}

function tab(state: State, back: boolean): Outcome {
    const { doc } = state;
    const at = state.selection.focus;
    const table = tableOf(doc, at.path);
    if (table) {
        const found = blockAt(doc, table)!;
        if (found.kind !== "table") return null;
        const columns = found.header.length;
        const row = at.path[at.path.length - 2]!;
        const column = at.path[at.path.length - 1]!;
        const place = row * columns + column + (back ? -1 : 1);
        if (place < 0) return done(doc, state.selection, "move");
        const grown = place >= (found.rows.length + 1) * columns ? addRow(doc, table, found.rows.length) : doc;
        const cell = [...table, Math.floor(place / columns), place % columns];
        return done(grown, caret(cell, lengthOf(grown, cell)), grown === doc ? "move" : "structure");
    }
    const block = blockAt(doc, at.path);
    if (inItem(doc, at.path)) {
        const next = back ? outdent(doc, at.path) : indent(doc, at.path);
        const selection: Selection = { anchor: { path: sameLeaf(doc, state.selection.anchor.path, next), offset: state.selection.anchor.offset }, focus: { path: sameLeaf(doc, at.path, next), offset: at.offset } };
        return done(next, selection, next === doc ? "move" : "structure");
    }
    if (block?.kind === "code" && !back) {
        const { doc: cleared, at: from } = clear(state);
        return done(insertText(cleared, from, "    "), caret(from.path, from.offset + 4), "type");
    }
    return null;
}

// ---- shortcuts ----

const MARK_KEYS: Record<string, Mark> = { b: "bold", i: "italic", u: "underline", e: "code" };

function mark(state: State, which: Mark): Outcome {
    if (collapsed(state.selection)) {
        const now = activeMarks(state);
        const marks = now.includes(which) ? now.filter((each) => each !== which) : [...now, which];
        return { state: { ...state, marks }, kind: "move" };
    }
    return done(toggleMark(state.doc, rangeOf(state.selection), which), state.selection, "format");
}

function blockKind(state: State, level: number): Outcome {
    const at = state.selection.focus;
    const next = changeKind(state.doc, at.path, level === 0 ? { kind: "paragraph" } : { kind: "heading", level: level as Level });
    return done(next, state.selection, "format");
}

// ---- the whole ----

/** What an input means in a state: the new state, an action, or null if the input is not mdQuire's. */
export function handle(state: State, input: Input): Outcome {
    if (input.type === "text") return input.text === "" ? null : type(state, input.text);
    const { key, shift = false, mod = false, alt = false, word = false } = input;
    if (mod) {
        const lower = key.toLowerCase();
        if (lower === "z") return { action: shift ? "redo" : "undo" };
        if (lower === "y" && !shift) return { action: "redo" };
        if (lower === "k") return { action: "link" };
        if (alt && /^[0-6]$/.test(key)) return blockKind(state, Number(key));
        if (shift && lower === "x") return mark(state, "strike");
        if (!shift && !alt && MARK_KEYS[lower]) return mark(state, MARK_KEYS[lower]!);
        if (key === "Backspace") return backspace(state, true);
        if (key === "Delete") return forwardDelete(state, true);
        return null;
    }
    if (key === "Backspace") return backspace(state, word || alt);
    if (key === "Delete") return forwardDelete(state, word || alt);
    if (key === "Enter") return shift ? softBreak(state) : enter(state);
    if (key === "Tab") return tab(state, shift);
    return null;
}

/** What is being edited, and its history. */
export interface Editor {
    state: State;
    history: History;
}

/** Takes an input and keeps the history: a Markdown shortcut is two steps, the characters as typed and then what they became; undo and redo are done here. */
export function step(editor: Editor, input: Input, time: number): { editor: Editor; outcome: Outcome } {
    const outcome = handle(editor.state, input);
    return { editor: apply(editor, outcome, time), outcome };
}

/** Applies an outcome to an editor. */
export function apply(editor: Editor, outcome: Outcome, time: number): Editor {
    if (!outcome) return editor;
    if ("action" in outcome) {
        if (outcome.action === "link") return editor;
        const back = outcome.action === "undo" ? undo(editor.history) : redo(editor.history);
        return back ? { state: back.state, history: back.history } : editor;
    }
    if (outcome.kind === "move") return { state: outcome.state, history: seal(editor.history) };
    let history = editor.history;
    if (outcome.literal) {
        history = record(history, editor.state, outcome.literal, "type", time);
        history = seal(record(history, outcome.literal, outcome.state, outcome.kind, time));
    } else history = record(history, editor.state, outcome.state, outcome.kind, time);
    return { state: outcome.state, history };
}

// ---- pasting and copying ----

const leafCount = (block: Block): number => (block.kind === "list" ? block.items.reduce((sum, item) => sum + item.blocks.reduce((inner, each) => inner + leafCount(each), 0), 0) : block.kind === "quote" || block.kind === "footnote" ? block.blocks.reduce((sum, each) => sum + leafCount(each), 0) : 1);

/** Puts pasted blocks at the cursor, in place of what is selected. A single paragraph goes into the line; more are set between the two halves of the block. */
export function paste(state: State, blocks: Block[]): State {
    const { doc, at } = clear(state);
    if (blocks.length === 0) return { doc, selection: caret(at.path, at.offset) };
    const block = blockAt(doc, at.path);
    const plain = blocks.map((each) => (textual(each) ? runsText((each as { runs: Run[] }).runs) : each.kind === "code" ? each.code : each.kind === "raw" ? each.text : "")).join("\n");
    if (block?.kind === "code" || block?.kind === "raw") return { doc: insertText(doc, at, plain), selection: caret(at.path, at.offset + plain.length) };
    const first = blocks[0]!;
    if (tableOf(doc, at.path) || (blocks.length === 1 && first.kind === "paragraph" && textual(block))) {
        const runs = blocks.length === 1 && textual(first) ? (first as { runs: Run[] }).runs : [{ kind: "text" as const, text: plain.replace(/\n/g, " "), marks: [] }];
        return { doc: insertRunsAt(doc, at, runs), selection: caret(at.path, at.offset + runsLength(runs)) };
    }
    const index = indexOf(doc, at.path);
    const fresh = blocks.map((each) => ({ ...each, source: undefined }));
    if (!textual(block) || (block?.kind === "paragraph" && runsLength(block.runs) === 0)) {
        // after a picture or divider, or in place of an empty paragraph
        let next = doc;
        let path = at.path;
        for (const each of fresh) {
            next = insertBlock(next, path, each);
            path = nextSibling(path);
        }
        if (textual(block)) next = removeBlock(next, at.path);
        const added = fresh.reduce((sum, each) => sum + leafCount(each), 0);
        const last = blockPaths(next)[index + added - (textual(block) ? 1 : 0)] ?? at.path;
        return { doc: next, selection: caret(...endOf(next, last)) };
    }
    let next = splitBlock(doc, at);
    const rest = [...fresh];
    let offset = at.offset;
    if (rest[0]?.kind === "paragraph") {
        const runs = rest.shift()!;
        next = insertRunsAt(next, { path: at.path, offset: at.offset }, (runs as { runs: Run[] }).runs);
        offset += runsLength((runs as { runs: Run[] }).runs);
    }
    let tail: Run[] | undefined;
    if (rest.length && rest[rest.length - 1]!.kind === "paragraph") tail = (rest.pop() as { runs: Run[] }).runs;
    if (tail) next = insertRunsAt(next, { path: blockPaths(next)[index + 1]!, offset: 0 }, tail);
    let path = at.path;
    for (const each of rest) {
        next = insertBlock(next, path, each);
        path = nextSibling(path);
    }
    const added = rest.reduce((sum, each) => sum + leafCount(each), 0);
    if (tail) return { doc: next, selection: caret(blockPaths(next)[index + 1 + added]!, runsLength(tail)) };
    if (added) return { doc: next, selection: caret(...endOf(next, blockPaths(next)[index + added]!)) };
    return { doc: next, selection: caret(at.path, offset) };
}

/** The selected part of a document as blocks of its own, for copying. Blocks inside a list stay in a list of the same kind. */
export function fragment(doc: Document, selection: Selection): Block[] {
    const { start, end } = rangeOf(selection);
    if (samePath(start.path, end.path)) {
        const block = blockAt(doc, start.path);
        if (block?.kind === "code" || block?.kind === "raw") return [{ kind: "paragraph", runs: [{ kind: "text", text: textAt(doc, start.path).slice(start.offset, end.offset), marks: [] }], gap: "" }];
        const runs = textual(block) ? (block as { runs: Run[] }).runs : cellRuns(doc, start.path);
        if (!runs) return block ? [{ ...block, gap: "" }] : [];
        return [{ kind: "paragraph", runs: sliceRuns(runs, start.offset, end.offset), gap: "" }];
    }
    const paths = blockPaths(doc);
    const first = indexOf(doc, start.path);
    const last = indexOf(doc, end.path);
    const out: Block[] = [];
    let open: { list: string; item: number; block: Block & { kind: "list" } } | undefined;
    for (let index = first; index <= last; index++) {
        const path = paths[index]!;
        let block = { ...blockAt(doc, path)!, gap: "" } as Block;
        const from = index === first ? start.offset : 0;
        const to = index === last && !tableOf(doc, end.path) ? end.offset : Infinity;
        if (textual(block)) block = { ...block, runs: sliceRuns((block as { runs: Run[] }).runs, from, to), source: undefined } as Block;
        if (block.kind === "code") block = { ...block, code: block.code.slice(from, to === Infinity ? undefined : to), source: undefined };
        if (inItem(doc, path)) {
            const owner = blockAt(doc, path.slice(0, -2));
            const key = path.slice(0, -2).join(",");
            const item = path[path.length - 2]!;
            if (owner?.kind === "list") {
                const fresh: ListItem = { blocks: [block], gap: "" };
                if (owner.items[item]?.checked !== undefined) fresh.checked = owner.items[item]!.checked;
                if (open && open.list === key && open.item === item) open.block.items[open.block.items.length - 1]!.blocks.push(block);
                else if (open && open.list === key) open.block.items.push(fresh);
                else {
                    open = { list: key, item, block: { ...owner, items: [fresh], source: undefined, gap: "" } };
                    out.push(open.block);
                }
                open.item = item;
                continue;
            }
        }
        open = undefined;
        out.push(block);
    }
    return out;
}
