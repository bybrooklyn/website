// A table's own controls: while the cursor is in a table, a small strip grows at the table's top
// edge to add and remove a row or a column, to set the column's alignment and to sort the rows by
// the column (numbers by value when the column holds only numbers). A right-click in the table, the
// keyboard's menu key there, or the strip's three dots open the table's menu, which holds all of it
// as Docs' does: a row above or below, a column left or right, removing the row, the column or the
// table, the two sorts and the alignments. What cannot be done where the cursor is (a row above the
// heading row, removing the heading row or the only column) is shown and cannot be pressed. Tab moves
// between cells (keys.ts). What each control does, cursor and all, is pure and tested; the strip and
// the menu are DOM.

import { addColumn, addRow, blockAt, insertBlock, orderRows, paragraph, removeBlock, removeColumn, removeRow, setColumnAlign, sortedRows, type Align, type Document, type Table } from "./document";
import type { State } from "./history";
import { caret, tableOf } from "./keys";
import type { Surface } from "./surface";
import { control, dots, flowMenu, icon, make, type MenuItem } from "./ui";

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

/** Adds a row over the cursor's, the cursor going into it. The heading row has nothing over it, as a table's first row is its heading. */
export const rowAbove = (state: State): State =>
    within(state, ({ path, row, column }) => {
        if (row === 0) return state;
        const doc = addRow(state.doc, path, row - 1);
        return { doc, selection: caret([...path, row, column], 0) };
    });

/** Adds a column to the left of the cursor's, the cursor going into it. */
export const columnLeft = (state: State): State =>
    within(state, ({ path, row, column }) => {
        const doc = addColumn(state.doc, path, column);
        return { doc, selection: caret([...path, row, column], 0) };
    });

/** Removes the whole table, an empty line taking its place with the cursor on it. */
export const removeTableHere = (state: State): State =>
    within(state, ({ path }) => {
        const doc = removeBlock(insertBlock(state.doc, path, paragraph()), path);
        return { doc, selection: caret(path, 0) };
    });

/** Which of the table's commands can do anything where the cursor is: a row above and removing a row not in the heading row, removing a column when there is more than one. */
export function possible(found: { table: Table; row: number }): { rowAbove: boolean; removeRow: boolean; removeColumn: boolean } {
    return { rowAbove: found.row > 0, removeRow: found.row > 0, removeColumn: found.table.header.length > 1 };
}

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

/** Sorts the table's body rows by the cursor's column, A to Z or (descending) Z to A, the cursor going with its row. */
export function sortHere(descending: boolean): (state: State) => State {
    return (state) =>
        within(state, ({ path, table, row, column }) => {
            const order = sortedRows(table, column, descending);
            const doc = orderRows(state.doc, path, order);
            return { doc, selection: row === 0 ? state.selection : caret([...path, order.indexOf(row - 1) + 1, column], state.selection.focus.offset) };
        });
}

/**
 * Builds the table controls for a surface. `top` is how far down the window the editor's own top
 * reaches: the controls stay under it, never drawn over the tools there.
 */
export function createTableTools(surface: Surface, top: () => number = () => 0): { element: HTMLElement; lines(): MenuItem[]; destroy(): void } {
    const root = surface.element;
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
    const removeRowButton = control("Remove this row", withSign(icon("row"), "−"), doing(removeRowHere));
    const removeColumnButton = control("Remove this column", withSign(icon("column"), "−"), doing(removeColumnHere));
    tools.append(control("Add a row below", withSign(icon("row"), "+"), doing(rowBelow)), removeRowButton, control("Add a column to the right", withSign(icon("column"), "+"), doing(columnRight)), removeColumnButton, make("span", "quire-select-rule"));
    for (const [align, label] of ALIGNS) {
        const button = control(label, icon(align === "center" ? "center" : align), doing(alignHere(align)));
        button.setAttribute("aria-pressed", "false");
        aligns.set(align, button);
        tools.append(button);
    }
    // the two sorts go together, onto a line of their own where the window is too narrow for the strip, with the dots that open the whole menu
    const more = dots("More for this table");
    more.addEventListener("click", () => (menu.isOpen() ? menu.close(true) : openMenu(more, true)));
    const sorts = make("span", "quire-table-sorts");
    sorts.append(make("span", "quire-select-rule"), control("Sort the rows by this column, A to Z", "A→Z", doing(sortHere(false)), "quire-button quire-sort"), control("Sort the rows by this column, Z to A", "Z→A", doing(sortHere(true)), "quire-button quire-sort"), more);
    tools.append(sorts);

    // ---- the menu, at the pointer, at the cell for the menu key, or under the strip's dots ----
    const menu = flowMenu("Table", { className: "quire-table-menu" });
    const anchor = make("span", "quire-anchor");
    anchor.setAttribute("aria-hidden", "true");
    /** Every command of the table where the cursor is, those that cannot act there marked so. */
    function menuLines(): MenuItem[] {
        const found = tableAt(surface.getDocument(), surface.getSelection().focus.path);
        if (!found) return [];
        const can = possible(found);
        return [
            { label: "Add a row above", icon: "row", disabled: !can.rowAbove, run: doing(rowAbove) },
            { label: "Add a row below", icon: "row", run: doing(rowBelow) },
            { label: "Add a column to the left", icon: "column", run: doing(columnLeft) },
            { label: "Add a column to the right", icon: "column", run: doing(columnRight) },
            { label: "Remove this row", icon: "trash", disabled: !can.removeRow, run: doing(removeRowHere) },
            { label: "Remove this column", icon: "trash", disabled: !can.removeColumn, run: doing(removeColumnHere) },
            { label: "Remove the table", icon: "trash", run: doing(removeTableHere) },
            { label: "Sort the rows A to Z", run: doing(sortHere(false)) },
            { label: "Sort the rows Z to A", run: doing(sortHere(true)) },
            ...ALIGNS.map(([align, label]): MenuItem => ({ label, icon: align === "center" ? "center" : align, pressed: found.table.align[found.column] === align, run: doing(alignHere(align)) })),
        ];
    }
    /** Opens the menu under a control, or at a point in the window. */
    function openMenu(at: HTMLElement | { x: number; y: number }, keyboard = false) {
        let trigger: HTMLElement;
        if (at instanceof HTMLElement) trigger = at;
        else {
            Object.assign(anchor.style, { left: `${at.x}px`, top: `${at.y}px`, height: "0px" });
            if (!anchor.isConnected) document.body.append(anchor);
            trigger = anchor;
        }
        menu.open(trigger, menuLines(), keyboard);
    }
    /** When the menu was last opened from the keyboard, whose own menu event may follow. */
    let keyedAt = 0;
    /** A right-click in a table opens its menu at the pointer, the cursor first going to the cell pressed; Shift with it leaves the browser's own. */
    function onMenu(event: MouseEvent) {
        const cell = (event.target as HTMLElement).closest?.("td, th");
        if (!cell || !root.contains(cell) || event.shiftKey) return;
        event.preventDefault();
        if (performance.now() - keyedAt < 500) return;
        // the browser has put its cursor where the press was, and the surface takes it, before the menu reads where it is
        requestAnimationFrame(() => openMenu({ x: event.clientX, y: event.clientY }));
    }
    /** The menu key, or Shift+F10, with the cursor in a table opens the menu at the cell, the first line ready for the arrows. */
    function onKey(event: KeyboardEvent) {
        if (!(event.key === "ContextMenu" || (event.key === "F10" && event.shiftKey)) || !shownFor) return;
        const cell = surface.elementAt(surface.getSelection().focus.path)?.getBoundingClientRect();
        if (!cell) return;
        event.preventDefault();
        keyedAt = performance.now();
        openMenu({ x: cell.left + 12, y: cell.bottom }, true);
    }
    root.addEventListener("contextmenu", onMenu);
    root.addEventListener("keydown", onKey, true);

    let shownFor: HTMLElement | undefined;
    const place = () => {
        if (!shownFor) return;
        const box = shownFor.getBoundingClientRect();
        tools.style.left = `${Math.max(8, Math.min(box.right - tools.offsetWidth, innerWidth - tools.offsetWidth - 8))}px`;
        // over the table's top edge; with that scrolled up under the editor's top, just below it, riding
        // up with the table's foot and away under the top once the table has gone (quire.css stacks it lower)
        const above = Math.max(box.top - tools.offsetHeight - 6, top() + 6);
        tools.style.top = `${Math.min(above, box.bottom - tools.offsetHeight)}px`;
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
        // a button that could do nothing here is shown, dimmed, and cannot be pressed
        const can = possible(found);
        removeRowButton.disabled = !can.removeRow;
        removeColumnButton.disabled = !can.removeColumn;
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
    return {
        element: tools,
        /** The table's menu as lines, while the cursor is in a table, for the command palette; those that cannot act here are left out. */
        lines: () => (shownFor ? menuLines().filter((line) => !line.disabled) : []),
        destroy() {
            root.removeEventListener("contextmenu", onMenu);
            root.removeEventListener("keydown", onKey, true);
            removeEventListener("scroll", place);
            removeEventListener("resize", place);
            for (const each of [tools, anchor, menu.box]) each.remove();
        },
    };
}

/** A column's three alignments, with their names. */
const ALIGNS: [Align, string][] = [
    ["left", "Align the column left"],
    ["center", "Centre the column"],
    ["right", "Align the column right"],
];

/** An icon with a small + or minus beside it. */
function withSign(picture: SVGSVGElement, sign: string): HTMLElement {
    const both = make("span", "quire-signed");
    both.append(picture, make("span", "quire-sign", sign));
    return both;
}
