// What the things that open out of the page share: the picture viewer (viewer.ts) and a terminal
// opened to the whole window (terminal.ts). Each is one thing travelling from where it sits on the
// page to its open place and back, over a shade, with Tab kept inside it while it is open.

/** The numbers of the site's own easing, `--ease` in tokens.css, for code that works the curve out itself. */
export const CURVE: [number, number, number, number] = [0.22, 1, 0.36, 1];
/** The site's own easing, `--ease` in tokens.css. */
export const EASE = `cubic-bezier(${CURVE.join(", ")})`;
/** Whether the visitor has asked for less motion. (Where there is no window, as under test, they have not.) */
export const still: { readonly matches: boolean } = typeof matchMedia === "function" ? matchMedia("(prefers-reduced-motion: reduce)") : { matches: false };

/** A place and size in the window. */
export interface Box {
    left: number;
    top: number;
    width: number;
    height: number;
}

/** Where an element is in the window. */
export function boxOf(element: Element): Box {
    const { left, top, width, height } = element.getBoundingClientRect();
    return { left, top, width, height };
}

/** The transform that lays something drawn at `to` over `from`. */
export const over = (from: Box, to: Box) => `translate(${from.left - to.left}px, ${from.top - to.top}px) scale(${from.width / to.width}, ${from.height / to.height})`;

/**
 * Makes an element that has just been moved or resized travel there from where it was. Under
 * reduced motion it fades in where it now is.
 */
export function travel(element: HTMLElement, from: Box, time: number): Animation {
    if (still.matches) return element.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 150 });
    return element.animate([{ transform: over(from, boxOf(element)), transformOrigin: "0 0" }, { transform: "none", transformOrigin: "0 0" }], { duration: time, easing: EASE });
}

/**
 * A shade over the page, faded in. `lift()` fades it out and takes it away. It is put just before
 * `under`, the thing it lies under, so that the two are stacked against each other wherever on the
 * page that is; with nothing given it goes at the end of the page.
 */
export function shade(name: string, under?: Element): { lift(): void } {
    const cover = document.createElement("div");
    cover.className = name;
    if (under) under.before(cover);
    else document.body.append(cover);
    cover.animate([{ opacity: 0 }, { opacity: 1 }], { duration: still.matches ? 150 : 320, easing: "ease-out" });
    return {
        lift() {
            const gone = () => cover.remove();
            cover.animate([{ opacity: 1 }, { opacity: 0 }], { duration: still.matches ? 120 : 300, easing: "ease-in", fill: "forwards" }).finished.then(gone, gone);
        },
    };
}

/** Runs `then` when the page is being left: before the browser takes its picture for the change to the next page, and when it is put away. */
export function leaving(then: () => void): void {
    for (const event of ["pageswap", "pagehide"]) addEventListener(event, then);
}

/** Tab goes round these stops and nowhere else. */
export function round(event: KeyboardEvent, stops: HTMLElement[]): void {
    event.preventDefault();
    const at = stops.indexOf(document.activeElement as HTMLElement);
    stops[(at + (event.shiftKey ? -1 : 1) + stops.length) % stops.length]?.focus({ preventScroll: true });
}
