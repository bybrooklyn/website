// A table's own controls: while the cursor is in a table, a small strip grows at the table's top
// edge to add and remove a row or a column and to set the column's alignment. Tab moves between
// cells (keys.ts). What each control does, cursor and all, is pure and tested; the strip is DOM.

import { addColumn, addRow, blockAt, removeColumn, removeRow, setColumnAlign, type Align, type Document, type Table } from "./document";
import type { State } from "./history";
import { caret, tableOf } from "./keys";
import type { Surface } from "./surface";
import { control, icon, make } from "./ui";

/** The table the cursor is in, and which row (0 is the heading row) and column. */
export function tableAt(doc: Document, path: number[]): { path: number[]; table: Table; row: number; column: number } | undefined {
    const at = tableOf(doc, path);
    const table = at && blockAt(doc, at);
    if (!at || table?.kind !== "table") return undefined;
    return { path: at, table, row: path[path.length - 2]!, column: path[path.length - 1]! };
}

const within = (state: State, change: (found: NonNullable<ReturnType<typeof tableAt>>) => State): State => {
    const found = tableAt(state.doc, state.selection.focus.path);
    return found ? change(found) : state;
};

/** Adds a row under the cursor's, the cursor going into it. */
export const rowBelow = (state: State): State =>
    within(state, ({ path, row, column }) => {
        const doc = addRow(state.doc, path, row);
        return { doc, selection: caret([...path, row + 1, column], 0) };
    });

/** Removes the cursor's row. The heading row stays, as a table needs one. */
export const removeRowHere = (state: State): State =>
    within(state, ({ path, table, row, column }) => {
        if (row === 0) return state;
        const doc = removeRow(state.doc, path, row - 1);
        return { doc, selection: caret([...path, Math.min(row, table.rows.length - 1), column], 0) };
    });

/** Adds a column to the right of the cursor's, the cursor going into it. */
export const columnRight = (state: State): State =>
    within(state, ({ path, row, column }) => {
        const doc = addColumn(state.doc, path, column + 1);
        return { doc, selection: caret([...path, row, column + 1], 0) };
    });

/** Removes the cursor's column, unless it is the only one. */
export const removeColumnHere = (state: State): State =>
    within(state, ({ path, table, row, column }) => {
        if (table.header.length <= 1) return state;
        const doc = removeColumn(state.doc, path, column);
        return { doc, selection: caret([...path, row, Math.max(0, column - 1)], 0) };
    });

/** Sets the cursor's column to an alignment, or back to none if it already has it. */
export function alignHere(align: Align): (state: State) => State {
    return (state) => within(state, ({ path, table, column }) => ({ ...state, doc: setColumnAlign(state.doc, path, column, table.align[column] === align ? null : align) }));
}

/** Builds the table controls for a surface. */
export function createTableTools(surface: Surface): { element: HTMLElement } {
    const tools = make("div", "quire-table-tools");
    tools.setAttribute("role", "toolbar");
    tools.setAttribute("aria-label", "Table");
    tools.inert = true;
    document.body.append(tools);
    const doing = (action: (state: State) => State) => () => {
        surface.run((doc, selection) => action({ doc, selection }));
        surface.focus();
    };
    const aligns = new Map<Align, HTMLButtonElement>();
    tools.append(
        control("Add a row below", withSign(icon("row"), "+"), doing(rowBelow)),
        control("Remove this row", withSign(icon("row"), "−"), doing(removeRowHere)),
        control("Add a column to the right", withSign(icon("column"), "+"), doing(columnRight)),
        control("Remove this column", withSign(icon("column"), "−"), doing(removeColumnHere)),
        make("span", "quire-select-rule"),
    );
    for (const [align, label] of [
        ["left", "Align the column left"],
        ["center", "Centre the column"],
        ["right", "Align the column right"],
    ] as [Align, string][]) {
        const button = control(label, icon(align === "center" ? "center" : align), doing(alignHere(align)));
        button.setAttribute("aria-pressed", "false");
        aligns.set(align, button);
        tools.append(button);
    }

    let shownFor: HTMLElement | undefined;
    const place = () => {
        if (!shownFor) return;
        const box = shownFor.getBoundingClientRect();
        tools.style.left = `${Math.max(8, Math.min(box.right - tools.offsetWidth, innerWidth - tools.offsetWidth - 8))}px`;
        tools.style.top = `${box.top - tools.offsetHeight - 6}px`;
    };
    const update = () => {
        const focus = surface.getSelection().focus.path;
        const found = tableAt(surface.getDocument(), focus);
        const element = found && surface.elementAt(found.path)?.closest("table");
        // the cell the cursor is in is marked, so that the row and column the controls change are plain
        for (const cell of surface.element.querySelectorAll(".quire-here")) cell.classList.remove("quire-here");
        if (found) surface.elementAt(focus)?.classList.add("quire-here");
        if (!found || !element) {
            shownFor = undefined;
            tools.classList.remove("shown");
            tools.inert = true;
            return;
        }
        for (const [align, button] of aligns) {
            const on = found.table.align[found.column] === align;
            button.setAttribute("aria-pressed", String(on));
            button.classList.toggle("pressed", on);
        }
        const fresh = !tools.classList.contains("shown");
        shownFor = element as HTMLElement;
        if (fresh) tools.classList.add("placing");
        place();
        if (fresh) {
            void tools.offsetWidth;
            tools.classList.remove("placing");
        }
        tools.classList.add("shown");
        tools.inert = false;
    };
    surface.on("select", update);
    surface.on("change", () => requestAnimationFrame(update));
    addEventListener("scroll", place, { passive: true });
    addEventListener("resize", place);
    return { element: tools };
}

/** An icon with a small + or minus beside it. */
function withSign(picture: SVGSVGElement, sign: string): HTMLElement {
    const both = make("span", "quire-signed");
    both.append(picture, make("span", "quire-sign", sign));
    return both;
}
