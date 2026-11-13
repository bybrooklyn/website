// Undo and redo for mdQuire: a list of steps, each the state before a change and the state after
// it. Typing in one run is gathered into a single step, so one undo takes back a word or a
// sentence, not a letter; the run ends at a pause, when the cursor is moved, or when a different
// kind of change comes. Pure: the time is passed in, so the grouping can be tested.

import type { Document, Mark, Selection } from "./document";

/** A document with its selection, and the marks the next typed text will take, if they were set by a shortcut. */
export interface State {
    doc: Document;
    selection: Selection;
    marks?: Mark[];
}

/** What sort of change a step is. Only "type" and "delete" steps gather into one. "symbol" is a typed arrow, sign or emoji, which one Backspace straight after takes back. */
export type ChangeKind = "type" | "delete" | "shortcut" | "symbol" | "format" | "structure" | "paste" | "replace";

interface Step {
    before: State;
    after: State;
    kind: ChangeKind;
    time: number;
}

/** The steps that can be undone, the steps that can be redone, and how many are kept. */
export interface History {
    done: Step[];
    undone: Step[];
    limit: number;
    /** Set when the next change must start a step of its own. */
    sealed: boolean;
}

/** How long a pause in typing, in milliseconds, ends a step. */
export const PAUSE = 1000;

/** A new, empty history that keeps at most `limit` steps. */
export function createHistory(limit = 300): History {
    return { done: [], undone: [], limit, sealed: false };
}

const sameSelection = (a: Selection, b: Selection) => JSON.stringify(a) === JSON.stringify(b);

/** Adds a change. It joins the step before it when both are typing (or both deleting), close in time, with the cursor not moved between. Redo is cleared. */
export function record(history: History, before: State, after: State, kind: ChangeKind, time: number): History {
    if (before.doc === after.doc) return history;
    const last = history.done[history.done.length - 1];
    const gathers = !history.sealed && last && last.kind === kind && (kind === "type" || kind === "delete") && time - last.time < PAUSE && last.after.doc === before.doc && sameSelection(last.after.selection, before.selection);
    if (gathers) return { ...history, done: [...history.done.slice(0, -1), { ...last, after, time }], undone: [] };
    const done = [...history.done, { before, after, kind, time }];
    return { ...history, done: done.slice(Math.max(0, done.length - history.limit)), undone: [], sealed: false };
}

/** Makes the next change start a step of its own, as moving the cursor by hand does. */
export function seal(history: History): History {
    return history.sealed ? history : { ...history, sealed: true };
}

/** Takes back the last step, giving the state to return to, or undefined if there is nothing to undo. */
export function undo(history: History): { history: History; state: State } | undefined {
    const step = history.done[history.done.length - 1];
    if (!step) return undefined;
    return { history: { ...history, done: history.done.slice(0, -1), undone: [...history.undone, step], sealed: true }, state: step.before };
}

/** Puts back the last step undone, or undefined if there is nothing to redo. */
export function redo(history: History): { history: History; state: State } | undefined {
    const step = history.undone[history.undone.length - 1];
    if (!step) return undefined;
    return { history: { ...history, done: [...history.done, step], undone: history.undone.slice(0, -1), sealed: true }, state: step.after };
}
