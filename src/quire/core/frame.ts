// The frame every kind of document is edited in: the top's two lines with their places (the name at
// the end of the trail, the menu words, how saving stands, the bar of tools), the name and the status
// already in theirs, and what the core runs for any kind: the menu row built from the kind's own
// headings, the keys that open those menus and run the kind's shortcuts, the command palette, and
// full screen. A kind's editor makes one frame on its element and fills it (mdQuire's editor.ts).
//
//   const frame = createFrame(host, { top, name: "Untitled", onName });
//   frame.place("bar").append(myBar);
//   const row = frame.menus(() => headings);       the row, in the top's first line
//   frame.keys((event) => commandFor(event));      Alt and a letter, F10, and the kind's shortcuts
//   frame.palette({ writing: () => text });        the palette, from the corner and two taps of Ctrl
//
// The page that mounts the core gives the top (the site's trail, with its name and flags); without
// one, a top of the same shape is made above the editor.

import { createMenuRow, menuFor, type Heading } from "./menu-row";
import { createPalette, type PaletteOptions } from "./palette";
import { nameButton, statusLine } from "./status";
import { altGraph, make } from "./ui";

/** The places in the top a kind fills: the document's name, the menu words, how saving stands, the bar. */
export type Place = "name" | "menus" | "status" | "bar";

/** What the frame is given. */
export interface FrameOptions {
    /** The page's top, with places marked for the name, the menu words, how saving stands and the tools. Made above the editor if not given. */
    top?: HTMLElement;
    /** The document's name to start with. */
    name: string;
    /** Opens the documents list from the name. */
    onName?: (from: HTMLElement) => void;
}

/** True on a Mac, where Cmd does what Ctrl does elsewhere. */
const MAC = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform);

/** Builds the frame on an element. */
export function createFrame(host: HTMLElement, options: FrameOptions) {
    const top = options.top ?? makeTop();
    if (!options.top) host.prepend(top);
    else host.classList.add("bar-away");
    const place = (name: Place) => top.querySelector<HTMLElement>(`.quire-${name}-home`)!;
    const name = nameButton(options.name, (pressed) => options.onName?.(pressed));
    const status = statusLine();
    place("name").append(name);
    place("status").append(status.element);

    // what the frame listens to on the page and the host, let go when it is destroyed
    const watchers: ResizeObserver[] = [];
    const watch = (element: Element, run: () => void) => {
        if (typeof ResizeObserver === "undefined") return;
        const watcher = new ResizeObserver(run);
        watcher.observe(element);
        watchers.push(watcher);
    };
    // side panels start below the top's two lines (--quire-below-bar in quire.css), wherever they end on this window
    const topEnd = () => document.documentElement.style.setProperty("--quire-top-bottom", `${Math.max(0, Math.round(top.getBoundingClientRect().bottom))}px`);
    watch(top, topEnd);
    topEnd();

    let row: ReturnType<typeof createMenuRow> | undefined;
    let palette: ReturnType<typeof createPalette> | undefined;
    let keyListener: ((event: KeyboardEvent) => void) | undefined;

    // ---- full screen: the top folds away and leaves the page; Escape ends it, and the pointer at
    // the window's top edge opens the top again for as long as it stays up there ----
    let full = false;
    let unfolding: ReturnType<typeof setTimeout> | undefined;
    let back: () => void = () => {};
    const peek = (on: boolean) => {
        top.classList.toggle("peek", on);
        top.inert = full && !on;
    };
    const fullScreen = (on: boolean) => {
        if (on === full) return;
        full = on;
        clearTimeout(unfolding);
        top.classList.toggle("folded", on);
        host.classList.toggle("full", on);
        peek(false);
        // opening again, what is in the top stays cut at its edge until the row has its height
        top.classList.toggle("unfolding", !on);
        if (!on) unfolding = setTimeout(() => top.classList.remove("unfolding"), 450);
        back();
    };
    const fullKeys = (event: KeyboardEvent) => {
        // an Escape meant for a dialog or a menu is theirs
        if (!full || event.key !== "Escape" || event.defaultPrevented || (event.target instanceof Element && event.target.closest("dialog, [popover]"))) return;
        fullScreen(false);
    };
    const fullPointer = (event: PointerEvent) => {
        if (!full) return;
        if (event.clientY <= 4) peek(true);
        else if (top.classList.contains("peek") && event.clientY > top.getBoundingClientRect().bottom + 24 && !row?.menu.isOpen() && !top.contains(document.activeElement)) peek(false);
    };
    addEventListener("keydown", fullKeys);
    addEventListener("pointermove", fullPointer);

    return {
        top,
        place,
        /** The document's name in the trail. */
        name,
        /** How saving stands, with the kind's count beside it. */
        status,
        /** Watches an element's size for as long as the frame stands. */
        watch,
        /** Builds the menu row over the kind's headings, in the top's first line. */
        menus(headings: () => Heading[]) {
            row = createMenuRow(headings);
            place("menus").append(row.element);
            return row;
        },
        /**
         * Listens for the keys on the editor: Alt and a menu word's letter or F10 open that menu holding
         * the keyboard, and anything else is offered to `command`, the kind's shortcuts, which gives what to
         * run (the event is then taken) or nothing; Alt+/ left over opens the palette.
         */
        keys(command: (event: KeyboardEvent) => (() => void) | undefined) {
            keyListener = (event: KeyboardEvent) => {
                // AltGr types a character (@ # { [ | on many layouts): it is never a shortcut
                if (event.defaultPrevented || event.isComposing || altGraph(event)) return;
                const word = row ? menuFor(event, MAC, row.labels) : undefined;
                if (word !== undefined) return (event.preventDefault(), row!.open(word, true));
                // Alt+/ opens the palette for every kind, unless the kind's own table takes it first
                const run = command(event) ?? (palette && event.altKey && !event.ctrlKey && !event.metaKey && !event.shiftKey && (event.code === "Slash" || event.key === "/") ? () => palette!.open() : undefined);
                if (!run) return;
                event.preventDefault();
                run();
            };
            host.addEventListener("keydown", keyListener);
        },
        /** Builds the command palette over the menu row's lines, its button in the editor's corner. */
        palette(given: Omit<PaletteOptions, "menus" | "reveal" | "corner">) {
            palette = createPalette({ ...given, menus: () => row?.headings() ?? [], reveal: (path) => row?.reveal(path), corner: host });
            return palette;
        },
        /** Folds the top away for writing alone, or brings it back; `then` gives the keyboard back to the writing. */
        fullScreen,
        isFull: () => full,
        /** Where the keyboard goes when full screen starts or ends. */
        onFull(run: () => void) {
            back = run;
        },
        destroy() {
            removeEventListener("keydown", fullKeys);
            removeEventListener("pointermove", fullPointer);
            if (keyListener) host.removeEventListener("keydown", keyListener);
            clearTimeout(unfolding);
            for (const watcher of watchers) watcher.disconnect();
            palette?.destroy();
            row?.menu.box.remove();
            status.destroy();
            if (!options.top) top.remove();
            else {
                // a page's own top stays for the next editor, emptied of what this one put in it
                for (const each of ["name", "menus", "status", "bar"] as const) place(each).replaceChildren();
                top.classList.remove("folded", "peek", "unfolding");
                top.inert = false;
                host.classList.remove("bar-away", "full");
            }
        },
    };
}

/** The frame, as a kind's editor holds it. */
export type Frame = ReturnType<typeof createFrame>;

/** The top's two lines, for an editor on a page without one of its own: the places the page would mark, in the same shape. */
function makeTop(): HTMLElement {
    const top = make("div", "quire-top quire-top-own");
    const inner = make("div", "quire-top-in");
    const line = make("div", "quire-top-line");
    line.append(make("span", "quire-name-home"), make("div", "quire-menus-home"), make("div", "quire-status-home"));
    inner.append(line, make("div", "quire-bar-home"));
    top.append(inner);
    return top;
}
