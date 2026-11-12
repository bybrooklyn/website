// The small bar that grows out of the top edge of selected text: bold, italic, strike, code, link,
// and turn the block into a heading, a quote or a list. It follows the selection, never covers it,
// stays inside the window and below the main bar, and shrinks away when the selection collapses.
// Its link button turns the same bar into a field for the address: Enter sets it, Escape goes back,
// and a link already there can be taken off.
//
// When it shows and what it shows pressed is decided by barFor, which is pure and tested; the rest
// is DOM. Its styles are in src/styles/quire.css.

import { blockAt, type Document, type Mark, type Selection } from "./document";
import { currentStyle, link as linkAction, linkAt, pressedAt, setStyleOf, toggle, toggleList, type Action } from "./bar";
import { collapsed, rangeOf, tableOf } from "./keys";
import type { Surface } from "./surface";
import { control, glyph, icon, linkForm, make, placeNear, still } from "./ui";

/** Whether the selection bar shows for a selection, and which of its buttons are pressed. */
export function barFor(doc: Document, selection: Selection, marks: Mark[]): { show: boolean; pressed: Record<string, boolean> } {
    const { start, end } = rangeOf(selection);
    // in code or raw text there is nothing for it to do
    const plain = (path: number[]) => {
        const kind = blockAt(doc, path)?.kind;
        return kind === "paragraph" || kind === "heading" || !!tableOf(doc, path);
    };
    const show = !collapsed(selection) && (plain(start.path) || plain(end.path));
    const now = pressedAt(doc, selection.focus.path, marks);
    const style = currentStyle(doc, selection.focus.path);
    return {
        show,
        pressed: { bold: now.bold, italic: now.italic, strike: now.strike, code: now.code, link: !!linkAt(doc, start), heading: style.startsWith("heading"), quote: style === "quote", list: now.bullet },
    };
}

/** Builds the selection bar for a surface. `top` gives how far down the window the main bar reaches, which it keeps clear of. */
export function createSelectBar(surface: Surface, top: () => number = () => 0): { element: HTMLElement; hide(): void } {
    const bar = make("div", "quire-select-bar");
    bar.setAttribute("role", "toolbar");
    bar.setAttribute("aria-label", "Selected text");
    bar.inert = true;
    const row = make("div", "quire-select-row");
    bar.append(row);
    document.body.append(bar);

    let saved: Selection | undefined;
    let dragging = false;
    let shown = false;

    const doing = (action: Action) => () => {
        surface.run((doc, selection) => action({ doc, selection: saved ?? selection }));
        surface.focus();
    };
    const buttons = new Map<string, HTMLButtonElement>();
    const add = (key: string, label: string, content: Node, run: () => void) => {
        const button = control(label, content, run);
        button.setAttribute("aria-pressed", "false");
        buttons.set(key, button);
        row.append(button);
    };
    add("bold", "Bold", glyph("B", "bold"), doing(toggle("bold")));
    add("italic", "Italic", glyph("I", "italic"), doing(toggle("italic")));
    add("strike", "Strikethrough", glyph("S", "strike"), doing(toggle("strike")));
    add("code", "Inline code", icon("code"), doing(toggle("code")));
    add("link", "Link", icon("link"), () => openLink());
    row.append(make("span", "quire-select-rule"));
    add("heading", "Turn into a heading", icon("heading"), doing((state) => setStyleOf(currentStyle(state.doc, state.selection.focus.path).startsWith("heading") ? "paragraph" : "heading2")(state)));
    add("quote", "Turn into a quote", icon("quote"), doing(setStyleOf("quote")));
    add("list", "Turn into a list", icon("bullet"), doing(toggleList("bullet")));

    /** Flows the bar's width from what it holds now to what it will hold. */
    function swap(content: HTMLElement) {
        const from = bar.offsetWidth;
        bar.replaceChildren(content);
        bar.style.width = "";
        const to = bar.offsetWidth;
        if (still() || !shown) return;
        bar.style.width = `${from}px`;
        void bar.offsetWidth;
        bar.style.width = `${to}px`;
        bar.addEventListener("transitionend", () => (bar.style.width = ""), { once: true });
    }

    function openLink() {
        const selection = saved ?? surface.getSelection();
        saved = selection;
        const current = linkAt(surface.getDocument(), rangeOf(selection).start);
        const back = () => {
            swap(row);
            surface.setSelection(selection);
            surface.focus();
        };
        const form = linkForm(current?.href, {
            set: (href) => {
                surface.run((doc) => linkAction(href)({ doc, selection }).doc);
                back();
            },
            remove: () => {
                surface.run((doc) => linkAction(null)({ doc, selection }).doc);
                back();
            },
            cancel: back,
        });
        swap(form);
        place();
        form.querySelector("input")?.focus({ preventScroll: true });
    }

    function place() {
        const selection = document.getSelection();
        const range = selection?.rangeCount ? selection.getRangeAt(0) : undefined;
        const rect = range && surface.element.contains(range.commonAncestorContainer) ? range.getBoundingClientRect() : undefined;
        if (!rect || (!rect.width && !rect.height)) return;
        const limit = top();
        const at = placeNear({ left: rect.left, top: rect.top - limit, width: rect.width, height: rect.height }, { width: bar.offsetWidth, height: bar.offsetHeight }, { width: innerWidth, height: innerHeight - limit }, "above", 10);
        bar.style.left = `${at.left}px`;
        bar.style.top = `${at.top + limit}px`;
        bar.classList.toggle("below", at.side === "below");
    }

    function show() {
        if (!shown) {
            // it starts where it will be, so that it grows there rather than sliding in
            bar.classList.add("placing");
            place();
            void bar.offsetWidth;
            bar.classList.remove("placing");
        } else place();
        shown = true;
        bar.classList.add("shown");
        bar.inert = false;
    }

    function hide() {
        if (!shown) return;
        shown = false;
        bar.classList.remove("shown");
        bar.inert = true;
        if (!row.isConnected) bar.replaceChildren(row);
    }

    function update(selection: Selection, marks: Mark[]) {
        const doc = surface.getDocument();
        const now = barFor(doc, selection, marks);
        if (!now.show || dragging) {
            if (!bar.contains(document.activeElement)) hide();
            return;
        }
        saved = selection;
        for (const [key, button] of buttons) {
            button.setAttribute("aria-pressed", String(now.pressed[key]));
            button.classList.toggle("pressed", now.pressed[key]!);
        }
        if (row.isConnected) show();
    }

    let last: { selection: Selection; marks: Mark[] } | undefined;
    surface.on("select", ({ selection, marks }) => {
        last = { selection, marks };
        update(selection, marks);
    });
    // while the mouse is selecting, the bar waits; it grows when the button is let go
    surface.element.addEventListener("pointerdown", () => {
        dragging = true;
        hide();
    });
    addEventListener("pointerup", () => {
        if (!dragging) return;
        dragging = false;
        if (last) requestAnimationFrame(() => update(surface.getSelection(), last!.marks));
    });
    addEventListener("scroll", () => shown && place(), { passive: true });
    addEventListener("resize", () => shown && place());
    surface.element.addEventListener("keydown", (event) => {
        if (event.key === "Escape") hide();
    });

    return { element: bar, hide };
}
