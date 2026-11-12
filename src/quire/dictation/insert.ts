// Writing a settled phrase into the document: the steps from spoken.ts done to an editor state, so
// that the whole phrase (its text, its breaks, a heading or list it makes) is one change, and one
// step to undo. Pure, on the editor's own State, so that it is tested on real documents.

import { blockAt, changeKind, deleteText, insertText, type Level, type ListStyle } from "../document";
import type { State } from "../history";
import { caret, collapsed, handle, sameLeaf } from "../keys";
import type { Command, Step } from "./spoken";

/** What waits for the next phrase: a heading to make of it. */
export interface Pending {
    heading?: Level;
}

/** What doing a phrase's steps gave. */
export interface Written {
    state: State;
    pending: Pending;
    /** The commands that are for the dictation and not the text, in the order said. */
    commands: Command[];
}

/** The text of the block before the cursor, which decides the spacing and the capital of what comes next. */
export function textBefore(state: State, textOf: (path: number[]) => string): string {
    const at = state.selection.focus;
    return textOf(at.path).slice(0, at.offset);
}

const writable = (state: State) => {
    const block = blockAt(state.doc, state.selection.focus.path);
    return block?.kind === "paragraph" || block?.kind === "heading" || block?.kind === "code" || block?.kind === "raw";
};

/** Presses a key as the editor would. */
function key(state: State, name: string): State {
    const outcome = handle(state, { type: "key", key: name });
    return outcome && "state" in outcome ? outcome.state : state;
}

/** Does the steps of one phrase to a state. */
export function write(start: State, steps: Step[], waiting: Pending = {}): Written {
    let state = start;
    let pending = waiting;
    const commands: Command[] = [];
    for (const step of steps) {
        if (step.kind === "line" || step.kind === "paragraph") {
            state = key(state, "Enter");
        } else if (step.kind === "command") {
            const command = step.command;
            if (command === "heading1" || command === "heading2" || command === "heading3") pending = { heading: Number(command.slice(-1)) as Level };
            else if (command === "bullet" || command === "numbered") state = toList(state, command === "bullet" ? "bullet" : "number");
            else commands.push(command);
        } else {
            if (!collapsed(state.selection)) state = key(state, "Backspace");
            if (!writable(state)) continue;
            const focus = state.selection.focus;
            let doc = state.doc;
            let offset = focus.offset;
            if (step.erase) {
                doc = deleteText(doc, { start: { path: focus.path, offset: offset - step.erase }, end: focus });
                offset -= step.erase;
            }
            doc = insertText(doc, { path: focus.path, offset }, step.text);
            state = { doc, selection: caret(focus.path, offset + step.text.length) };
            if (pending.heading && blockAt(doc, focus.path)?.kind === "paragraph") {
                const heading = changeKind(doc, focus.path, { kind: "heading", level: pending.heading });
                state = { doc: heading, selection: caret(sameLeaf(doc, focus.path, heading), offset + step.text.length) };
                // what is said after a heading is a paragraph
                state = key(state, "Enter");
                pending = {};
            }
        }
    }
    return { state, pending, commands };
}

/** Makes the block at the cursor a list item of a style, if it is not one already. */
function toList(state: State, style: ListStyle): State {
    const focus = state.selection.focus;
    const block = blockAt(state.doc, focus.path);
    if (block?.kind !== "paragraph" && block?.kind !== "heading") return state;
    const doc = changeKind(state.doc, focus.path, { kind: "list", style });
    return { doc, selection: caret(sameLeaf(state.doc, focus.path, doc), focus.offset) };
}
