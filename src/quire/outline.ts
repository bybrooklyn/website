// The outline: the document's headings down the side of the editor, the one the cursor (or, while
// the page is scrolled, the reader) is under marked, and a click on one goes there. On a narrow
// screen it is a panel that flows in from the side when asked for and goes back the same way.
//
// Which heading is current is pure and tested; the list is DOM.

import { outline, type Document, type OutlineEntry, type Position } from "./document";
import { caret } from "./keys";
import type { Surface } from "./surface";
import { control, icon, make, still } from "./ui";

const before = (a: number[], b: number[]) => {
    for (let index = 0; index < Math.min(a.length, b.length); index++) if (a[index] !== b[index]) return a[index]! < b[index]!;
    return a.length <= b.length;
};

/** The heading the cursor is under: the last one at or before it in reading order, or -1 above the first. */
export function headingAtCursor(entries: OutlineEntry[], at: Position): number {
    let found = -1;
    entries.forEach((entry, index) => {
        if (before(entry.path, at.path)) found = index;
    });
    return found;
}

/** The heading a reader is under: the last whose top has passed `line` on screen, or the first if none has. */
export function headingAtScroll(tops: number[], line: number): number {
    let found = tops.length ? 0 : -1;
    tops.forEach((top, index) => {
        if (top <= line) found = index;
    });
    return found;
}

/** Builds the outline for a surface. `top` is how far down the window the bar reaches. */
export function createOutline(surface: Surface, top: () => number = () => 0): { element: HTMLElement; open(): void; close(): void; isOpen(): boolean } {
    const nav = make("nav", "quire-outline");
    nav.setAttribute("aria-label", "Outline");
    const head = make("div", "quire-outline-head");
    head.append(make("span", "quire-outline-title", "Outline"));
    const closer = control("Close the outline", icon("close"), () => panel.close());
    closer.classList.add("quire-outline-close");
    head.append(closer);
    const list = make("ol", "quire-outline-list");
    const empty = make("p", "quire-outline-empty", "Headings will show here.");
    nav.append(head, list, empty);

    let entries: OutlineEntry[] = [];
    let current = -1;
    let scrolling = false;

    function draw(doc: Document) {
        entries = outline(doc);
        const keys = entries.map((entry) => `${entry.level} ${entry.text} ${entry.path.join(",")}`).join("\n");
        if (list.dataset.keys === keys) return;
        list.dataset.keys = keys;
        list.replaceChildren(
            ...entries.map((entry, index) => {
                const item = make("li", `quire-outline-item level-${entry.level}`);
                const go = make("button", "quire-outline-link", entry.text || "Untitled heading");
                go.type = "button";
                go.addEventListener("click", () => {
                    surface.setSelection(caret(entry.path, 0));
                    surface.elementAt(entry.path)?.scrollIntoView({ behavior: still() ? "auto" : "smooth", block: "start" });
                    surface.focus();
                    mark(index);
                    if (panelled()) panel.close();
                });
                item.append(go);
                return item;
            }),
        );
        empty.classList.toggle("shown", entries.length === 0);
        mark(current);
    }

    function mark(index: number) {
        current = index;
        list.querySelectorAll(".quire-outline-link").forEach((link, at) => {
            link.classList.toggle("current", at === index);
            if (at === index) link.setAttribute("aria-current", "location");
            else link.removeAttribute("aria-current");
        });
    }

    draw(surface.getDocument());
    surface.on("change", ({ doc }) => draw(doc));
    surface.on("select", ({ selection }) => {
        if (!scrolling) mark(headingAtCursor(entries, selection.focus));
    });
    // when the reader scrolls, the heading they are reading under is the current one; typing puts it back to the cursor's
    let settle: ReturnType<typeof setTimeout> | undefined;
    addEventListener(
        "scroll",
        () => {
            scrolling = true;
            clearTimeout(settle);
            settle = setTimeout(() => (scrolling = false), 400);
            const tops = entries.map((entry) => surface.elementAt(entry.path)?.getBoundingClientRect().top ?? Infinity);
            mark(headingAtScroll(tops, top() + 24));
        },
        { passive: true },
    );

    /** True when the outline is a panel over the page rather than a column beside it. */
    const panelled = () => getComputedStyle(nav).position === "fixed";
    const outside = (event: PointerEvent) => {
        if (!nav.contains(event.target as Node)) panel.close();
    };
    const keys = (event: KeyboardEvent) => {
        if (event.key === "Escape") panel.close();
    };
    const panel = {
        element: nav,
        open() {
            // a column beside the sheet opens by no longer being closed; a panel over the page by being open
            nav.classList.remove("closed");
            if (panelled()) {
                nav.classList.add("open");
                setTimeout(() => document.addEventListener("pointerdown", outside, true));
                document.addEventListener("keydown", keys);
                (list.querySelector<HTMLElement>(".current") ?? list.querySelector<HTMLElement>("button") ?? closer).focus({ preventScroll: true });
            }
        },
        close() {
            nav.classList.remove("open");
            if (!panelled()) nav.classList.add("closed");
            document.removeEventListener("pointerdown", outside, true);
            document.removeEventListener("keydown", keys);
        },
        isOpen: () => (panelled() ? nav.classList.contains("open") : !nav.classList.contains("closed")),
    };
    return panel;
}
