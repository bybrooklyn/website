// When a document changed somewhere else while it was being written here, saving stops and this
// panel says so. What was typed is kept. Three ways on: keep mine (write it over theirs), take
// theirs (mine is kept in the version history first), or see both side by side, the lines that
// differ marked. It comes by itself, so it is a side panel below the bar, as everything to consult
// while writing is, and not a dialog: it does not take the keyboard from the text, so that a key
// typed as it arrives cannot choose for the writer; it is said aloud, and reached with Tab. Its
// buttons are in the order every dialog's are, keeping mine filled at the right. The side-by-side
// reading is pure and tested; the panel is DOM.

import { filledButton, switchButton } from "./dialog";
import { control, icon, make } from "./ui";

/** One row of the side-by-side view: a line of mine, a line of theirs, or the same line in both. */
export interface Row {
    mine?: string;
    theirs?: string;
    same: boolean;
}

/** Mine and theirs side by side, line against line, the lines they share kept level. */
export function sideBySide(mine: string, theirs: string): Row[] {
    const a = mine.replace(/\r?\n$/, "").split(/\r?\n/);
    const b = theirs.replace(/\r?\n$/, "").split(/\r?\n/);
    // the longest run of lines both share, found from the end so the rows can be read off from the start
    // too long to compare line against line: the table would not fit, so it is not made
    if (a.length * b.length > 4_000_000) return [...a.map((line) => ({ mine: line, same: false })), ...b.map((line) => ({ theirs: line, same: false }))];
    const shared: number[][] = Array.from({ length: a.length + 1 }, () => new Array<number>(b.length + 1).fill(0));
    for (let i = a.length - 1; i >= 0; i--) for (let j = b.length - 1; j >= 0; j--) shared[i]![j] = a[i] === b[j] ? shared[i + 1]![j + 1]! + 1 : Math.max(shared[i + 1]![j]!, shared[i]![j + 1]!);
    const rows: Row[] = [];
    let i = 0;
    let j = 0;
    while (i < a.length || j < b.length) {
        if (i < a.length && j < b.length && a[i] === b[j]) {
            rows.push({ mine: a[i], theirs: b[j], same: true });
            i++;
            j++;
        } else if (j < b.length && (i >= a.length || shared[i]![j + 1]! >= shared[i + 1]![j]!)) rows.push({ theirs: b[j++], same: false });
        else rows.push({ mine: a[i++], same: false });
    }
    return rows;
}

/** Builds the panel. `choose` is told which way the writer went. */
export function createConflict(choose: (choice: "mine" | "theirs") => void, back: () => void = () => {}) {
    const panel = make("aside", "quire-conflict");
    panel.setAttribute("aria-labelledby", "quire-conflict-title");
    panel.inert = true;
    const head = make("div", "quire-conflict-head");
    const title = make("p", "quire-conflict-title", "This document changed somewhere else");
    title.id = "quire-conflict-title";
    // said aloud as it comes, the focus staying in the text
    title.setAttribute("role", "alert");
    head.append(title);
    const closer = control("Not now", icon("close"), () => close());
    head.append(closer);
    const said = make("p", "quire-conflict-said", "It was saved there after you opened it here. What you typed is kept and nothing has been written over.");
    const choices = make("div", "quire-conflict-choices");
    const both = switchButton("See both", false, (on) => panel.classList.toggle("both", on));
    both.classList.add("far");
    const theirs = make("button", "quire-dialog-dismiss", "Take theirs");
    theirs.type = "button";
    theirs.addEventListener("click", () => {
        close();
        choose("theirs");
    });
    const mine = filledButton("Keep mine", () => {
        close();
        choose("mine");
    });
    choices.append(both, theirs, mine);
    const note = make("p", "quire-conflict-note", "Taking theirs keeps yours in the version history.");
    const view = make("div", "quire-conflict-both");
    panel.append(head, said, choices, note, view);
    document.body.append(panel);

    function open(mineText: string, theirsText: string | undefined) {
        view.replaceChildren();
        const columns = make("div", "quire-conflict-columns");
        const left = make("div", "quire-conflict-side");
        const right = make("div", "quire-conflict-side");
        left.append(make("p", "quire-outline-title", "Yours"));
        right.append(make("p", "quire-outline-title", "Theirs"));
        const leftLines = make("pre");
        const rightLines = make("pre");
        for (const row of sideBySide(mineText, theirsText ?? "")) {
            const one = make("span", row.same ? "" : row.mine === undefined ? "gap" : "changed", row.mine ?? "");
            const two = make("span", row.same ? "" : row.theirs === undefined ? "gap" : "changed", row.theirs ?? "");
            leftLines.append(one, "\n");
            rightLines.append(two, "\n");
        }
        left.append(leftLines);
        right.append(rightLines);
        columns.append(left, right);
        view.append(columns);
        panel.classList.remove("both");
        both.set(false);
        panel.classList.add("open");
        panel.inert = false;
    }

    function close() {
        // focus that was in the panel goes back to the text rather than nowhere
        if (panel.contains(document.activeElement)) back();
        panel.classList.remove("open");
        panel.inert = true;
    }

    return { element: panel, open, close, isOpen: () => panel.classList.contains("open") };
}
