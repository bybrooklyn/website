// What the history is held to: typing gathers into one step until a pause, a moved cursor or a
// different kind of change; undo and redo walk the steps both ways; a new change clears redo; and
// no more steps are kept than the cap. Run with `bun test src/quire`.

import { expect, test } from "bun:test";
import { documentOf, insertText, paragraph, textAt } from "./document";
import { createHistory, PAUSE, record, redo, seal, undo, type State } from "./history";
import { caret } from "./keys";
import { read } from "./read";

const start = (): State => ({ doc: documentOf([paragraph()]), selection: caret([0], 0) });

/** Types one letter at the cursor of a state, as a keystroke would. */
function letter(state: State, value: string): State {
    const { path, offset } = state.selection.focus;
    return { doc: insertText(state.doc, { path, offset }, value), selection: caret(path, offset + value.length) };
}

function typed(text: string, at = 0, pause = 100) {
    let state: State = { doc: read("x\n"), selection: caret([0], 1) };
    let history = createHistory();
    let time = at;
    for (const value of text) {
        const next = letter(state, value);
        history = record(history, state, next, "type", time);
        state = next;
        time += pause;
    }
    return { state, history, time };
}

test("typing in one run is a single step, and one undo takes all of it back", () => {
    const { state, history } = typed("hello");
    expect(textAt(state.doc, [0])).toBe("xhello");
    expect(history.done.length).toBe(1);
    const back = undo(history)!;
    expect(textAt(back.state.doc, [0])).toBe("x");
    expect(back.state.selection).toEqual(caret([0], 1));
});

test("a pause in typing starts a new step", () => {
    const { history } = typed("ab", 0, PAUSE + 1);
    expect(history.done.length).toBe(2);
});

test("moving the cursor between letters starts a new step", () => {
    let { state, history, time } = typed("ab");
    state = { ...state, selection: caret([0], 0) };
    const next = letter(state, "z");
    history = record(history, state, next, "type", time);
    expect(history.done.length).toBe(2);
    expect(textAt(next.doc, [0])).toBe("zxab");
});

test("a different kind of change, or a seal, starts a new step", () => {
    let { state, history, time } = typed("ab");
    const deleted: State = { ...state, doc: read("xa\n") };
    history = record(history, state, deleted, "delete", time);
    expect(history.done.length).toBe(2);
    const sealed = seal(history);
    const more = letter(deleted, "c");
    expect(record(sealed, deleted, more, "delete", time + 10).done.length).toBe(3);
});

test("redo puts back what undo took, and a new change clears redo", () => {
    let { state, history } = typed("ab");
    const back = undo(history)!;
    expect(textAt(back.state.doc, [0])).toBe("x");
    const again = redo(back.history)!;
    expect(textAt(again.state.doc, [0])).toBe("xab");
    expect(again.state).toBe(state);

    history = back.history;
    const other = letter(back.state, "q");
    history = record(history, back.state, other, "type", 99999);
    expect(history.undone.length).toBe(0);
    expect(redo(history)).toBeUndefined();
});

test("nothing to undo or redo gives undefined, and a change that changes nothing is not kept", () => {
    const history = createHistory();
    expect(undo(history)).toBeUndefined();
    expect(redo(history)).toBeUndefined();
    const state = start();
    expect(record(history, state, { ...state, selection: caret([0], 0) }, "type", 0)).toBe(history);
});

test("no more steps are kept than the cap, the oldest going first", () => {
    let history = createHistory(5);
    let state = start();
    for (let index = 0; index < 12; index++) {
        const next = letter(state, String(index % 10));
        history = record(history, state, next, "format", index * 10);
        state = next;
    }
    expect(history.done.length).toBe(5);
    let back = undo(history);
    let undone = 0;
    while (back) {
        undone++;
        state = back.state;
        back = undo(back.history);
    }
    expect(undone).toBe(5);
    expect(textAt(state.doc, [0])).toBe("0123456");
});
