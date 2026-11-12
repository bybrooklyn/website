// The paper the sheet is drawn as, and how near it is seen. Page setup chooses the paper (A4,
// Letter or A5, portrait or landscape) and its margins, which a `.quire` document keeps in its
// style.json; the sheet on screen is that paper at its real size, and print is given the same
// size and margins through an @page rule. Zoom then shows the sheet nearer or further, from half
// to twice its size, or as wide as there is room for; it eases from one to the next about the
// middle of what is in view, and holds still under reduced motion. On a narrow window the sheet is
// the window's width with the text at its own size, as it was before there was paper.
//
//   const zoom = createZoom(paper, room, space, () => page);   // the sheet, what scrolls round it, the width it may fill
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

/** The @page rule that gives print the page's paper and margins. */
export function pageRule(page: Page): string {
    return `@page { size: ${page.size} ${page.orientation}; margin: ${page.margins}mm; }`;
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

/** How many CSS pixels a millimetre is. */
const MM = 96 / 25.4;

/** Shows the sheet as its paper, near or far. `room` scrolls sideways when the sheet is wider than it; `space` is the width the sheet may fill. */
export function createZoom(paper: HTMLElement, room: HTMLElement, space: () => number, page: () => Page, onChange?: (zoom: number) => void) {
    // "fit" fills the room; "auto", the usual, is the paper's own size unless the room is smaller
    let mode: number | "fit" | "auto" = "auto";
    let shown = 1;
    const narrow = () => typeof matchMedia !== "undefined" && matchMedia("(max-width: 40rem)").matches;
    const wanted = () => {
        if (narrow()) return 1;
        const fit = fitZoom(space(), paperSize(page()).width * MM);
        return mode === "fit" ? fit : mode === "auto" ? Math.min(USUAL, fit) : mode;
    };

    /** Shows the zoom asked for; when it changes, the sheet eases from its old size about the middle of the window. */
    function apply(animate: boolean) {
        const { width, height } = paperSize(page());
        paper.style.setProperty("--paper-w", String(width));
        paper.style.setProperty("--paper-h", String(height));
        paper.style.setProperty("--margin", String(page().margins));
        const next = wanted();
        if (next === shown) return onChange?.(next);
        const before = paper.getBoundingClientRect();
        // the point of the sheet in the middle of the window, in the sheet's own pixels
        const middle = { x: (Math.min(innerWidth, before.right) + Math.max(0, before.left)) / 2, y: innerHeight / 2 };
        const local = { x: (middle.x - before.left) / shown, y: (middle.y - before.top) / shown };
        const was = shown;
        shown = next;
        paper.style.setProperty("--zoom", String(next));
        // the window is scrolled so that the same point is in the middle again
        const after = paper.getBoundingClientRect();
        // (at the very top of the page it stays at the top: the sheet grows downward from under the bar)
        if (scrollY > 0) scrollBy({ top: after.top + local.y * next - middle.y, behavior: "instant" });
        if (room.scrollWidth > room.clientWidth) room.scrollLeft += after.left + local.x * next - middle.x;
        onChange?.(next);
        if (!animate || still()) return;
        // then drawn at its old size about that point, and let go to its new one
        paper.animate([{ transform: `scale(${was / next})`, transformOrigin: `${local.x}px ${local.y}px` }, { transform: "none", transformOrigin: `${local.x}px ${local.y}px` }], { duration: 320, easing: "cubic-bezier(0.22, 1, 0.36, 1)" });
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
            ...[0.5, 0.75, 1, 1.25, 1.5, 2].map((each) => ({ label: percent(each), pressed: mode === each, run: () => set(each) })),
            { label: "Fit the width", pressed: mode === "fit", run: () => set("fit") },
        ],
    };
}

/** What the zoom is, as the page sees it. */
export type Zoom = ReturnType<typeof createZoom>;

/** The page setup's lines for a menu: the paper, which way up, and the margins, each line pressed when it is what the page has. */
export function setupItems(page: Page, choose: (change: Partial<Page>) => void): MenuItem[] {
    const line = (label: string, on: boolean, change: Partial<Page>, group: string): MenuItem => ({ label, pressed: on, group, run: () => choose(change) });
    return [
        { label: "Paper", note: true, run: () => {} },
        ...(Object.keys(PAPERS) as Page["size"][]).map((size) => line(size, page.size === size, { size }, "size")),
        { label: "Which way up", note: true, run: () => {} },
        line("Portrait", page.orientation === "portrait", { orientation: "portrait" }, "orientation"),
        line("Landscape", page.orientation === "landscape", { orientation: "landscape" }, "orientation"),
        { label: "Margins", note: true, run: () => {} },
        ...MARGINS.map(([label, margins]) => line(label, Math.abs(page.margins - margins) < 0.5, { margins }, "margins")),
    ];
}
