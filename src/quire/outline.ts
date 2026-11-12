// The outline: the document's headings down the side of the editor, the one the cursor (or, while
// the page is scrolled, the reader) is under marked, and a click on one goes there. It is closed
// until its control in the bar opens it: on a wide screen as a column at the window's left edge,
// on a narrow one as a panel over the page, flowing in from the side and back the same way.
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

/** Builds the outline for a surface, closed. `top` is how far down the window the bar reaches; `onChange` is told when it opens or closes. */
export function createOutline(surface: Surface, top: () => number = () => 0, onChange: (open: boolean) => void = () => {}): { element: HTMLElement; open(): void; close(): void; isOpen(): boolean } {
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
    nav.inert = true;

    let entries: OutlineEntry[] = [];

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
        follow();
    }

    function mark(index: number) {
        list.querySelectorAll(".quire-outline-link").forEach((link, at) => {
            link.classList.toggle("current", at === index);
            if (at === index) link.setAttribute("aria-current", "location");
            else link.removeAttribute("aria-current");
        });
    }

    draw(surface.getDocument());
    // it waits for a pause in a run of typing, but a change after a quiet moment (a document opened) is shown at once
    let drawing: ReturnType<typeof setTimeout> | undefined;
    let drawingWaiting: Document | undefined;
    surface.on("change", ({ doc }) => {
        if (drawing) {
            drawingWaiting = doc;
            return;
        }
        draw(doc);
        const settle = () => {
            drawing = undefined;
            if (drawingWaiting) {
                const next = drawingWaiting;
                drawingWaiting = undefined;
                draw(next);
                drawing = setTimeout(settle, 150);
            }
        };
        drawing = setTimeout(settle, 150);
    });
    // the heading the cursor is under is the current one while the cursor can be seen; once the
    // reader has scrolled it away, the heading they are reading under is
    function follow() {
        const focus = surface.getSelection().focus;
        const cursor = surface.elementAt(focus.path)?.getBoundingClientRect();
        const seen = !!cursor && cursor.bottom > top() && cursor.top < innerHeight;
        if (seen) return mark(headingAtCursor(entries, focus));
        const tops = entries.map((entry) => surface.elementAt(entry.path)?.getBoundingClientRect().top ?? Infinity);
        // a heading in the upper third of the window is the one being read under
        mark(headingAtScroll(tops, top() + (innerHeight - top()) / 3));
    }
    surface.on("select", follow);
    addEventListener("scroll", follow, { passive: true });

    /** True when the outline is a panel over the page rather than a column beside it. */
    const panelled = () => getComputedStyle(nav).position === "fixed";
    // a press outside a panel closes it, but not one on the control that opens and closes it
    const outside = (event: PointerEvent) => {
        const target = event.target as Element;
        if (!nav.contains(target) && !target.closest?.("[data-outline-control]")) panel.close();
    };
    const keys = (event: KeyboardEvent) => {
        if (event.key === "Escape") panel.close();
    };
    const panel = {
        element: nav,
        open() {
            nav.classList.add("open");
            nav.inert = false;
            onChange(true);
            if (panelled()) {
                setTimeout(() => document.addEventListener("pointerdown", outside, true));
                document.addEventListener("keydown", keys);
                (list.querySelector<HTMLElement>(".current") ?? list.querySelector<HTMLElement>("button") ?? closer).focus({ preventScroll: true });
            }
        },
        close() {
            if (nav.contains(document.activeElement)) surface.focus();
            nav.classList.remove("open");
            nav.inert = true;
            onChange(false);
            document.removeEventListener("pointerdown", outside, true);
            document.removeEventListener("keydown", keys);
        },
        isOpen: () => nav.classList.contains("open"),
    };
    return panel;
}
