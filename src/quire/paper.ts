// The paper, and how near the sheet is seen. Page setup chooses the paper (A4, Letter or A5,
// portrait or landscape) and its margins, which a `.quire` document keeps in its style.json; print
// is always given that size and those margins through an @page rule. On screen the page is shown in
// one of two looks (no page, or light paper, editor.ts), where the zoom makes the writing larger
// and the page with it, as a pageless editor's does; or in page view (pages.ts), where the page is
// the paper at its real size and the zoom shows it nearer or further, from half to twice its size,
// or as wide as there is room for. Either way it eases from one zoom to the next about the middle of
// what is in view, and holds still under reduced motion. On a narrow window there is no zoom.
//
//   const zoom = createZoom(paper, room, space, () => page, paged);   // the sheet, what scrolls round it, the width it may fill, and the view
//   zoom.set(1.5); zoom.step(1); zoom.fit(); zoom.reset(); zoom.items()
//
// The sums (paper sizes, the @page rule, the zoom steps and fitting) are pure and tested.

import type { Document, Page } from "./document";
import { still, type MenuItem } from "./ui";

/** Each paper's width and height in millimetres, standing upright. */
export const PAPERS: Record<Page["size"], [number, number]> = {
    A4: [210, 297],
    Letter: [215.9, 279.4],
    A5: [148, 210],
};

/** The margins offered, by name, in millimetres. */
export const MARGINS: [string, number][] = [
    ["Narrow", 12.7],
    ["Normal", 25],
    ["Wide", 38],
];

/** A page's width and height in millimetres, turned for landscape. */
export function paperSize(page: Page): { width: number; height: number } {
    const [short, long] = PAPERS[page.size] ?? PAPERS.A4;
    return page.orientation === "landscape" ? { width: long, height: short } : { width: short, height: long };
}

/** Text as a CSS string, safe inside `content:`. */
const quoted = (text: string) => `"${text.replace(/[\\"]/g, (found) => `\\${found}`).replace(/\s+/g, " ")}"`;

/**
 * The @page rule that gives print the page's paper and margins, and its header, footer and page
 * number in the page's margin boxes (which Chromium prints and Firefox, for now, leaves out).
 */
export function pageRule(page: Page): string {
    const boxes = [
        page.header ? `@top-center { content: ${quoted(page.header)}; font-size: 9pt; color: dimgray; }` : "",
        page.footer ? `@bottom-center { content: ${quoted(page.footer)}; font-size: 9pt; color: dimgray; }` : "",
        page.numbers ? "@bottom-right { content: counter(page); font-size: 9pt; color: dimgray; }" : "",
    ].filter(Boolean);
    return `@page { size: ${page.size} ${page.orientation}; margin: ${page.margins}mm; ${boxes.length ? `${boxes.join(" ")} ` : ""}}`;
}

/** The document with another page setup; a Markdown file has none to keep, and is given back as it was. */
export function setPage(doc: Document, page: Page): Document {
    if (!doc.quire) return doc;
    return { ...doc, quire: { ...doc.quire, page } };
}

/** The zoom steps, from half to twice the paper's size. */
export const ZOOMS = [0.5, 0.67, 0.75, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2];

/** The next zoom step in a direction from where it is now, kept between the first and last. */
export function stepZoom(now: number, by: 1 | -1): number {
    if (by > 0) return ZOOMS.find((each) => each > now + 0.001) ?? ZOOMS[ZOOMS.length - 1]!;
    return [...ZOOMS].reverse().find((each) => each < now - 0.001) ?? ZOOMS[0]!;
}

/** The zoom at which a sheet `paper` pixels wide fills `room` pixels, held between 0.25 and 2. */
export function fitZoom(room: number, paper: number): number {
    if (!(room > 0) || !(paper > 0)) return 1;
    return Math.min(2, Math.max(0.25, Math.floor((room / paper) * 1000) / 1000));
}

/** A zoom said as a percentage. */
export const percent = (zoom: number): string => `${Math.round(zoom * 100)}%`;

/** How large the sheet is shown when nothing else is asked for: a good deal bigger than the paper's own size, so that the page fills more of the window and the writing is easy to read. Less where the room is narrower. */
export const USUAL = 1;

/**
 * The zoom wanted. In page view "fit" fills the room and the usual is the paper's own size unless the
 * room is smaller; in either look the page is sized to the window already, so the usual is the text
 * at its own size and there is no fitting.
 */
export function wantedZoom(mode: number | "fit" | "auto", fit: number, paged: boolean): number {
    if (typeof mode === "number") return mode;
    if (!paged) return USUAL;
    return mode === "fit" ? fit : Math.min(USUAL, fit);
}

/** How many CSS pixels a millimetre is. */
const MM = 96 / 25.4;

/**
 * Shows the page near or far. `room` scrolls sideways when the page is wider than it; `space` is the
 * width the page may fill in page view; `paged` says whether it is shown as pages of its paper. The
 * zoom is set on the editor round the page, which makes its column as wide as the page zoomed.
 */
export function createZoom(paper: HTMLElement, room: HTMLElement, space: () => number, page: () => Page, paged: () => boolean, onChange?: (zoom: number) => void) {
    let mode: number | "fit" | "auto" = "auto";
    let shown = 1;
    const narrow = () => typeof matchMedia !== "undefined" && matchMedia("(max-width: 40rem)").matches;
    const wanted = () => {
        if (narrow()) return 1;
        return wantedZoom(mode, fitZoom(space(), paperSize(page()).width * MM), paged());
    };
    /** Where the zoom and the paper's size are set: the editor round the page, whose column follows them, or the page itself. */
    const scope = (): HTMLElement => paper.closest<HTMLElement>(".quire-editor") ?? paper;

    /** Shows the zoom asked for; when it changes, the sheet eases from its old size about the middle of the window. */
    function apply(animate: boolean) {
        const { width, height } = paperSize(page());
        scope().style.setProperty("--paper-w", String(width));
        scope().style.setProperty("--paper-h", String(height));
        scope().style.setProperty("--margin-mm", String(page().margins));
        const next = wanted();
        // only a sheet wider than its room scrolls; otherwise the Markdown sliding in from the side could be scrolled to
        // (in a look the sheet's own width is read: zoomed past the window's room on a small window, it scrolls rather than the page)
        const own = paper.getBoundingClientRect().width / (shown || 1);
        room.classList.toggle("wide", !narrow() && (paged() ? next * width * MM > space() + 1 : next > 1.25 || next * own > space() + 1));
        if (next === shown) return onChange?.(next);
        // the whole page grows, the caret on it too
        const targets = [paper];
        const middle = { x: innerWidth / 2, y: innerHeight / 2 };
        // the point of each in the middle of the window, in its own pixels
        const locals = targets.map((target) => {
            const box = target.getBoundingClientRect();
            return { x: (Math.min(box.right, Math.max(box.left, middle.x)) - box.left) / shown, y: (middle.y - box.top) / shown };
        });
        const was = shown;
        shown = next;
        scope().style.setProperty("--zoom", String(next));
        // the window is scrolled so that the same point of the last (the text) is in the middle again
        const last = targets.length - 1;
        const after = targets[last]!.getBoundingClientRect();
        // (at the very top of the page it stays at the top: the sheet grows downward from under the bar)
        if (scrollY > 0) scrollBy({ top: after.top + locals[last]!.y * next - middle.y, behavior: "instant" });
        if (room.scrollWidth > room.clientWidth) room.scrollLeft += after.left + locals[last]!.x * next - middle.x;
        onChange?.(next);
        if (!animate || still()) return;
        // then each is drawn at its old size about that point, and let go to its new one
        targets.forEach((target, index) => {
            const origin = `${locals[index]!.x}px ${locals[index]!.y}px`;
            target.animate([{ transform: `scale(${was / next})`, transformOrigin: origin }, { transform: "none", transformOrigin: origin }], { duration: 320, easing: "cubic-bezier(0.22, 1, 0.36, 1)" });
        });
    }

    const set = (next: number | "fit" | "auto") => {
        mode = typeof next === "number" ? Math.min(2, Math.max(0.5, next)) : next;
        apply(true);
    };
    if (typeof ResizeObserver !== "undefined") new ResizeObserver(() => apply(false)).observe(room);
    apply(false);

    return {
        set,
        /** Zooms one step in or out. */
        step: (by: 1 | -1) => set(stepZoom(shown, by)),
        fit: () => set("fit"),
        /** Back to the usual: the paper's own size, or the room's width if that is smaller. */
        reset: () => set("auto"),
        /** Shows the page as it is set up now, after a change to it or to the room it has. */
        refresh: (animate = true) => apply(animate),
        now: () => shown,
        /** The zoom's lines for a menu: in, out, the steps, and fitting the width. */
        items: (): MenuItem[] => [
            { label: "Zoom in", icon: "plus", hint: "Ctrl+=", run: () => set(stepZoom(shown, 1)) },
            { label: "Zoom out", icon: "minus", hint: "Ctrl+-", run: () => set(stepZoom(shown, -1)) },
            { label: paged() ? "Usual size (100%, or less to fit)" : "Usual size (100%)", pressed: mode === "auto" || (!paged() && mode === "fit"), hint: "Ctrl+0", run: () => set("auto") },
            ...[0.5, 0.75, 1, 1.25, 1.5, 2].map((each) => ({ label: percent(each), pressed: mode === each, run: () => set(each) })),
            ...(paged() ? [{ label: "Fit the width", pressed: mode === "fit", run: () => set("fit") }] : []),
        ],
    };
}

/** What the zoom is, as the page sees it. */
export type Zoom = ReturnType<typeof createZoom>;

/** One choice in page setup: what it says, a note under it (a margin's size), what it changes, and whether the page has it now. */
export interface SetupChoice {
    label: string;
    note?: string;
    change: Partial<Page>;
    on: boolean;
}

/** Page setup's three groups, as its dialog shows them: the paper, its orientation and the margins, each choice on when it is what the page has. */
export function setupChoices(page: Page): { label: string; choices: SetupChoice[] }[] {
    return [
        { label: "Paper", choices: (Object.keys(PAPERS) as Page["size"][]).map((size) => ({ label: size, change: { size }, on: page.size === size })) },
        {
            label: "Orientation",
            choices: [
                { label: "Portrait", change: { orientation: "portrait" }, on: page.orientation === "portrait" },
                { label: "Landscape", change: { orientation: "landscape" }, on: page.orientation === "landscape" },
            ],
        },
        { label: "Margins", choices: MARGINS.map(([label, margins]) => ({ label, note: `${margins} mm`, change: { margins }, on: Math.abs(page.margins - margins) < 0.5 })) },
    ];
}

/**
 * Page setup's form, for its dialog: each group a row of buttons of which one is pressed, as a
 * choice of a few is everywhere in mdQuire, the arrow keys moving along a row. Nothing changes the
 * page until the dialog is answered: `page()` is what has been chosen so far.
 */
export function setupForm(start: Page): { element: HTMLElement; page(): Page } {
    let chosen: Page = { ...start };
    const form = document.createElement("div");
    form.className = "quire-setup";
    const draw = (focusIn?: string) => {
        form.replaceChildren();
        for (const group of setupChoices(chosen)) {
            const label = document.createElement("p");
            label.className = "quire-setup-label";
            label.id = `quire-setup-${group.label.toLowerCase()}`;
            label.textContent = group.label;
            const row = document.createElement("div");
            row.className = "quire-setup-row";
            row.setAttribute("role", "radiogroup");
            row.setAttribute("aria-labelledby", label.id);
            const buttons = group.choices.map((choice) => {
                const button = document.createElement("button");
                button.type = "button";
                button.className = `quire-setup-choice${choice.on ? " on" : ""}`;
                button.setAttribute("role", "radio");
                button.setAttribute("aria-checked", String(choice.on));
                button.tabIndex = choice.on ? 0 : -1;
                const words = document.createElement("span");
                words.textContent = choice.label;
                button.append(words);
                if (choice.note) {
                    const note = document.createElement("span");
                    note.className = "quire-setup-note";
                    note.textContent = choice.note;
                    button.append(note);
                }
                button.addEventListener("click", () => {
                    chosen = { ...chosen, ...choice.change };
                    draw(group.label);
                });
                return button;
            });
            // the arrows go along a row and choose as they go, as a row of radio buttons does
            row.addEventListener("keydown", (event) => {
                const by = event.key === "ArrowRight" || event.key === "ArrowDown" ? 1 : event.key === "ArrowLeft" || event.key === "ArrowUp" ? -1 : 0;
                if (!by) return;
                event.preventDefault();
                const at = buttons.findIndex((button) => button === document.activeElement);
                buttons[(at + by + buttons.length) % buttons.length]!.click();
            });
            row.append(...buttons);
            form.append(label, row);
            if (focusIn === group.label) buttons.find((button) => button.getAttribute("aria-checked") === "true")?.focus();
        }
    };
    draw();
    return { element: form, page: () => chosen };
}
