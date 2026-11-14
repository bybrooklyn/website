// The menu a right-click in the text opens, as Docs has one: cut and copy, then the link, a comment,
// bold, italic and underline, each the menus' own line so it does what that line does, with its
// shortcut. The keyboard's menu key, or Shift+F10, opens it at the caret. A table and a picture have
// menus of their own (tables.ts, picture-tools.ts); Shift with the right-click leaves the browser's.
//
// Which lines it holds is linesFor, which is pure and tested; the rest is DOM.
//
//   const menu = createTextMenu(surface, () => row.headings());   // menu.destroy()

import type { Surface } from "./surface";
import { everyLine, flowMenu, make, type MenuItem } from "./ui";

/** The commands of the text's menu after cut and copy, by their names in the menus' table (menu-row.ts), in its order. */
export const TEXT_COMMANDS = ["link", "comment", "bold", "italic", "underline"];

/** The menus' own lines for the text's menu, found by command among every menu's lines, in TEXT_COMMANDS' order; one the document does not have (a comment in a file that cannot keep one) is left out. */
export function linesFor(menus: { items: () => MenuItem[] }[]): MenuItem[] {
    // bold and the rest are in Format, Text, a menu inside a menu
    const all = menus.flatMap((menu) => everyLine(menu.items()).map((each) => each.item));
    return TEXT_COMMANDS.flatMap((key) => all.find((item) => item.key === key && !item.disabled) ?? []);
}

/** Builds the text's menu for a surface; `menus` gives the menus' lines as they stand now. */
export function createTextMenu(surface: Surface, menus: () => { items: () => MenuItem[] }[]): { destroy(): void } {
    const root = surface.element;
    const menu = flowMenu("Text", { className: "quire-text-menu" });
    const anchor = make("span", "quire-anchor");
    anchor.setAttribute("aria-hidden", "true");
    /** Cut or copy through the surface's own handlers, which write the selection as Markdown and as a web page. */
    const clip = (how: "cut" | "copy") => () => {
        surface.focus();
        document.execCommand(how);
    };
    function open(x: number, y: number, keyboard: boolean) {
        Object.assign(anchor.style, { left: `${x}px`, top: `${y}px`, height: "0px" });
        if (!anchor.isConnected) document.body.append(anchor);
        const selected = (() => {
            const { anchor: from, focus } = surface.getSelection();
            return from.path.join() !== focus.path.join() || from.offset !== focus.offset;
        })();
        const lines: MenuItem[] = [{ label: "Cut", hint: "Ctrl+X", disabled: !selected, run: clip("cut") }, { label: "Copy", hint: "Ctrl+C", disabled: !selected, run: clip("copy") }, ...linesFor(menus())];
        menu.open(anchor, lines, keyboard);
    }
    /** Not in a table, a picture or a control drawn in the text, each of which has its own. */
    const plain = (target: EventTarget | null) => {
        const element = target instanceof Element ? target : null;
        return !!element && root.contains(element) && !element.closest("td, th, figure, input, textarea, button, [contenteditable='false']");
    };
    function onMenu(event: MouseEvent) {
        if (event.shiftKey || event.defaultPrevented || !plain(event.target)) return;
        event.preventDefault();
        if (performance.now() - keyedAt < 500) return;
        // the browser has moved the caret to the press, unless it was inside the selection; the surface takes it before the menu reads it
        requestAnimationFrame(() => open(event.clientX, event.clientY, false));
    }
    /** When the menu was last opened from the keyboard, whose own menu event may follow. */
    let keyedAt = -Infinity;
    function onKey(event: KeyboardEvent) {
        if (!(event.key === "ContextMenu" || (event.key === "F10" && event.shiftKey)) || event.defaultPrevented) return;
        const place = document.getSelection()?.rangeCount ? document.getSelection()!.getRangeAt(0).getBoundingClientRect() : undefined;
        const at = place && (place.width || place.height) ? place : root.getBoundingClientRect();
        event.preventDefault();
        keyedAt = performance.now();
        open(at.left, at.bottom, true);
    }
    // heard on the page, after every handler on the text itself (a spelling popover, a picture's or a table's menu), any of which comes first
    document.addEventListener("contextmenu", onMenu);
    root.addEventListener("keydown", onKey);
    return {
        destroy() {
            document.removeEventListener("contextmenu", onMenu);
            root.removeEventListener("keydown", onKey);
            anchor.remove();
            menu.box.remove();
        },
    };
}
