// Page view, chosen from View: the sheet shown as pages of the paper page setup chose, one under another with a gap
// between, each with the header and footer of a `.quire` document and its number. The text is one
// flow down the sheet as before; a piece of it that would cross the foot of a page, or follow a page
// break, is moved down to the top of the next page by a margin of its own, which only the screen
// sees: print lays out its own pages from the @page rule (paper.ts) and the page breaks.
//
// A piece is a block of the text, or for a list or a quote each of its items, so that a long list
// runs on from page to page. A piece taller than a page stays where it is and crosses the gap.
//
//   const pages = createPages(paper, surface, { page, rich });
//   pages.edit(from)     opens the header, footer and page numbers, growing from `from`
//   pages.now()          how many pages there are
//
// Where each piece goes is worked out by `paginate`, which is pure and tested; the rest measures
// the pieces once, puts the margins on those that move, and draws the sheets behind the text.

import type { Page } from "./document";
import { paperSize, setPage } from "./paper";
import type { Surface } from "./surface";
import { composing, flowMenu, make } from "./ui";

/** A piece of the text that goes to the next page whole: where it is laid out, top and bottom, before any piece is moved; and whether it is a page break. */
export interface Piece {
    top: number;
    bottom: number;
    breaks?: boolean;
}

/** A page's height, the gap under it and the margin kept clear above and below its text, in the sheet's own pixels. */
export interface Sheet {
    height: number;
    gap: number;
    margin: number;
}

/**
 * How far each piece is moved down so that none crosses the foot of a page and each after a page
 * break starts a page, and how many pages that makes. A piece taller than a page's text is left
 * where it falls, as is a page break itself.
 */
export function paginate(pieces: Piece[], sheet: Sheet): { pushes: number[]; pages: number } {
    const step = sheet.height + sheet.gap;
    const room = sheet.height - 2 * sheet.margin;
    const head = (page: number) => page * step + sheet.margin;
    const foot = (page: number) => page * step + sheet.height - sheet.margin;
    const pushes: number[] = [];
    let shift = 0;
    let end = 0;
    // the page a page break was on, so that the piece after it starts the next one
    let broken: number | undefined;
    for (const piece of pieces) {
        const top = piece.top + shift;
        const height = piece.bottom - piece.top;
        const page = Math.floor(top / step);
        let to = top;
        if (broken !== undefined) to = Math.max(top, head(broken + 1));
        else if (top > foot(page)) to = head(page + 1);
        else if (page > 0 && top < head(page)) to = head(page);
        else if (top + height > foot(page) + 0.5 && height <= room && top > head(page) + 0.5) to = head(page + 1);
        const push = piece.breaks ? 0 : Math.max(0, Math.round((to - top) * 2) / 2);
        pushes.push(push);
        shift += push;
        end = Math.max(end, piece.bottom + shift);
        broken = piece.breaks ? page : undefined;
    }
    return { pushes, pages: pageCount(end, sheet) };
}

/** How many pages it takes for the text to end at `end`, with a page's margin under it. */
export function pageCount(end: number, sheet: Sheet): number {
    return Math.max(1, Math.floor(Math.max(0, end + sheet.margin + sheet.gap - 1) / (sheet.height + sheet.gap)) + 1);
}

/** The gap between pages on screen, in the sheet's own pixels. */
const GAP = 24;

/** Up to how many blocks a document is laid out whole, rather than near the window alone. */
const WHOLE = 300;

/** What the pages need from the editor: the page set up, and whether the document can keep a header and footer. */
export interface PagesOptions {
    page: () => Page;
    rich: () => boolean;
}

/** Shows a sheet as pages, behind the text the surface draws. */
export function createPages(paper: HTMLElement, surface: Surface, options: PagesOptions) {
    const root = surface.element;
    const layer = make("div", "quire-pages");
    paper.append(layer);
    // page view is chosen from View; in writing view the sheet is the window's width and has no pages
    let on = false;
    /** How far each moved piece was moved down, beyond its own gap above. */
    const pushed = new WeakMap<HTMLElement, number>();
    const sheets: { sheet: HTMLElement; head: HTMLElement; foot: HTMLElement; text: HTMLElement; number: HTMLElement }[] = [];
    let count = 0;
    let waiting = 0;

    /** The pieces of some blocks in reading order: each block, or each item of a list or quote of more than one. */
    function pieces(blocks: HTMLElement[]): HTMLElement[] {
        return blocks.flatMap((block) => (/^(UL|OL|BLOCKQUOTE)$/.test(block.tagName) && block.children.length > 1 ? ([...block.children] as HTMLElement[]) : [block]));
    }

    /** How far an element's top is below the sheet's, in the sheet's own pixels. */
    function topOf(element: HTMLElement): number {
        let top = 0;
        for (let at: HTMLElement | null = element; at && at !== paper; at = at.offsetParent as HTMLElement | null) top += at.offsetTop;
        return top;
    }

    /**
     * Lays out the pages near the window: from a page above it to a page below. Only those pieces
     * are measured, since measuring a piece out of sight makes the browser lay out what it had
     * skipped; the rest keep where they were put until the window comes near them. The pieces before
     * the first one looked at stay as they are, and it goes on from where they leave it. A short
     * document, quick to measure whole, is laid out whole.
     */
    function lay() {
        waiting = 0;
        // while printing, the browser lays out its own pages
        if (!on || !paper.isConnected || !paper.offsetWidth || matchMedia("print").matches) return;
        const { width, height } = paperSize(options.page());
        const margin = parseFloat(getComputedStyle(paper).paddingTop) || 0;
        const sheet: Sheet = { height: (paper.offsetWidth * height) / width, gap: GAP, margin };
        const blocks = [...root.children] as HTMLElement[];
        // the window in the sheet's own pixels, which a zoom makes larger on screen
        const box = paper.getBoundingClientRect();
        const scale = box.width / paper.offsetWidth || 1;
        const whole = blocks.length <= WHOLE;
        const from = whole ? -Infinity : -box.top / scale - sheet.height;
        const to = whole ? Infinity : (innerHeight - box.top) / scale + sheet.height;
        // the first block that reaches down into the window, found by halves
        let low = 0;
        let high = blocks.length;
        while (low < high) {
            const middle = (low + high) >> 1;
            if (topOf(blocks[middle]!) + blocks[middle]!.offsetHeight < from) low = middle + 1;
            else high = middle;
        }
        let end = low;
        while (end < blocks.length && topOf(blocks[end]!) < to) end++;
        const before = blocks[low - 1];
        let last = before ? topOf(before) + before.offsetHeight : topOf(root);
        const elements = pieces(blocks.slice(low, end));
        const found: Piece[] = [];
        const gaps: number[] = [];
        let shift = 0;
        // one read of each piece, no writes between, so the page is laid out once
        for (const element of elements) {
            const top = topOf(element);
            const own = pushed.get(element) ?? 0;
            gaps.push(top - last - own);
            shift += own;
            found.push({ top: top - shift, bottom: top - shift + element.offsetHeight, breaks: element.classList.contains("quire-break") });
            last = top + element.offsetHeight;
        }
        const { pushes } = paginate(found, sheet);
        const tail = blocks[blocks.length - 1];
        const pages = pageCount(tail ? topOf(tail) + tail.offsetHeight + (pushes.reduce((sum, push, index) => sum + push - (pushed.get(elements[index]!) ?? 0), 0)) : 0, sheet);
        elements.forEach((element, index) => {
            const push = pushes[index]!;
            if (push === (pushed.get(element) ?? 0)) return;
            if (push > 0) {
                pushed.set(element, push);
                element.style.setProperty("--push", `${gaps[index]! + push}px`);
                element.dataset.push = "";
            } else {
                pushed.delete(element);
                element.style.removeProperty("--push");
                delete element.dataset.push;
            }
        });
        paper.style.setProperty("--page-h", `${sheet.height}px`);
        paper.style.setProperty("--page-gap", `${GAP}px`);
        paper.style.setProperty("--page-margin", `${margin}px`);
        show(pages);
    }

    /** Draws as many sheets as there are pages: a new one grows in, one no longer needed fades away. */
    function show(pages: number) {
        if (pages === count) return;
        paper.style.setProperty("--pages", String(pages));
        while (sheets.length < pages) {
            const at = sheets.length;
            const sheet = make("div", "quire-page");
            const head = make("div", "quire-page-head");
            const foot = make("div", "quire-page-foot");
            const text = make("span");
            const number = make("span", "quire-page-number");
            foot.append(text, number);
            for (const part of [sheet, head, foot]) part.style.setProperty("--at", String(at));
            head.dataset.empty = "Header";
            text.dataset.empty = "Footer";
            layer.append(sheet, head, foot);
            sheets.push({ sheet, head, foot, text, number });
        }
        // the new sheets are drawn faded first, so that they have something to grow in from
        requestAnimationFrame(() => requestAnimationFrame(() => sheets.forEach((each) => each.sheet.classList.add("shown"))));
        while (sheets.length > pages) {
            const gone = sheets.pop()!;
            gone.sheet.classList.remove("shown");
            gone.head.remove();
            gone.foot.remove();
            // taken away once it has faded
            setTimeout(() => gone.sheet.remove(), 400);
        }
        count = pages;
        mark();
    }

    /** Writes the header, footer and number on every page, for a document that can keep them. */
    let marked = "";
    function mark() {
        const page = options.page();
        const rich = options.rich();
        // looked at on every change, and written only when the words or the number of pages changed
        const now = JSON.stringify([rich, page.header, page.footer, page.numbers, count]);
        if (now === marked) return;
        marked = now;
        paper.classList.toggle("marked", rich);
        sheets.forEach((each, index) => {
            each.head.textContent = rich ? (page.header ?? "") : "";
            each.text.textContent = rich ? (page.footer ?? "") : "";
            each.number.textContent = rich && page.numbers ? String(index + 1) : "";
        });
    }

    const soon = () => {
        if (!waiting) waiting = requestAnimationFrame(lay);
    };
    surface.on("change", soon);
    // the pages coming into the window are laid out as they come
    addEventListener("scroll", soon, { passive: true, capture: true });
    const watcher = typeof ResizeObserver !== "undefined" ? new ResizeObserver(soon) : undefined;
    watcher?.observe(root);
    watcher?.observe(paper);
    soon();

    // ---- the header, footer and page numbers: a small form flowing out of what was pressed ----
    const menu = flowMenu("Header and footer");
    /** Changes the page set up, as one undo step; a run of typing in a field is gathered into one. */
    const change = (part: Partial<Page>, kind: "type" | "format" = "format") => {
        const next: Page = { ...options.page(), ...part };
        for (const key of ["header", "footer"] as const) if (!next[key]?.trim()) delete next[key];
        if (!next.numbers) delete next.numbers;
        surface.run((doc) => setPage(doc, next), kind);
    };
    function edit(from: HTMLElement) {
        if (!options.rich()) return;
        const form = make("div", "quire-page-form");
        const field = (label: string, key: "header" | "footer") => {
            const input = make("input", "quire-link-field");
            input.value = options.page()[key] ?? "";
            input.placeholder = label;
            input.setAttribute("aria-label", label);
            input.addEventListener("input", () => change({ [key]: input.value }, "type"));
            // what is typed in each field is a step of its own
            input.addEventListener("focus", () => surface.setSelection(surface.getSelection()));
            input.addEventListener("keydown", (event) => {
                if (composing(event)) return event.stopPropagation();
                if (event.key === "Enter") {
                    event.preventDefault();
                    menu.close(false);
                    surface.focus();
                }
                // Tab goes on to the next field, rather than closing the menu
                if (event.key !== "Escape" && event.key !== "ArrowUp" && event.key !== "ArrowDown") event.stopPropagation();
            });
            return input;
        };
        const numbers = make("button", "quire-menu-line");
        numbers.type = "button";
        numbers.append(make("span", "quire-menu-label", "Page numbers"));
        numbers.classList.toggle("pressed", !!options.page().numbers);
        numbers.setAttribute("aria-pressed", String(!!options.page().numbers));
        numbers.addEventListener("click", () => {
            change({ numbers: !options.page().numbers });
            numbers.classList.toggle("pressed", !!options.page().numbers);
            numbers.setAttribute("aria-pressed", String(!!options.page().numbers));
        });
        form.append(field("Header, on every page", "header"), field("Footer, on every page", "footer"), numbers);
        menu.open(from, form);
        form.querySelector("input")?.focus({ preventScroll: true });
    }
    // a header or footer is edited by double-clicking it on any page
    layer.addEventListener("dblclick", (event) => {
        const part = (event.target as HTMLElement).closest<HTMLElement>(".quire-page-head, .quire-page-foot");
        if (part) edit(part);
    });
    surface.on("change", mark);

    return {
        edit,
        menu,
        now: () => count,
        /** Lays the pages out again at once, as a test or a change of paper wants. */
        lay,
        /** True in page view. */
        paged: () => on,
        /** Shows the pages, or takes them away for writing view: every piece goes back to its place and the sheets fade. */
        set(next: boolean) {
            if (next === on) return;
            on = next;
            paper.classList.toggle("paged", on);
            if (on) return soon();
            for (const element of root.querySelectorAll<HTMLElement>("[data-push]")) {
                pushed.delete(element);
                element.style.removeProperty("--push");
                delete element.dataset.push;
            }
            show(0);
        },
        destroy() {
            watcher?.disconnect();
            removeEventListener("scroll", soon, { capture: true });
            cancelAnimationFrame(waiting);
            menu.box.remove();
            layer.remove();
        },
    };
}
