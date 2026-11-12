// The caret, drawn: the browser's own is one thin pixel in whatever colour the page gives it, too
// faint on the sheet. This one is a bar of the line's height, a little thicker, kept where the
// browser's caret is (which is made clear and still does the work). It is solid while the cursor
// moves or text is typed, as carets are, and blinks once things are still; each time it blinks
// back on it takes the next of its colours, the lesbian flag's in the editor. With less motion
// asked for it does not blink, and stays the accent.
//
// Not every colour of the flag stands out on a dark sheet: its darkest, #A30262, is about 2 : 1
// against it, and no dark sheet can bring it to 3 : 1 (on black it is 2.7 : 1) while the flag's
// white needs a dark one. So a colour that is under 3 : 1 against the sheet is drawn with a hairline
// of the text's ink around it, and the flag's colours are left as they are.

/** The lesbian flag, from the top: the caret's colours, one for each time it blinks back on. */
export const FLAG = ["#D52D00", "#FF9A56", "#FFFFFF", "#D362A4", "#A30262"] as const;

/** A colour's red, green and blue, 0 to 255, from `#rrggbb`. */
export function hexRgb(hex: string): [number, number, number] {
    const value = parseInt(hex.replace(/^#/, ""), 16);
    return [(value >> 16) & 255, (value >> 8) & 255, value & 255];
}

/** How light a colour is to the eye, as WCAG measures it: 0 for black, 1 for white. */
export function luminance([r, g, b]: [number, number, number]): number {
    const linear = (channel: number) => {
        const c = channel / 255;
        return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
    };
    return 0.2126 * linear(r) + 0.7152 * linear(g) + 0.0722 * linear(b);
}

/** The contrast between two colours, from 1 (the same) to 21 (black and white). */
export function contrast(a: [number, number, number], b: [number, number, number]): number {
    const [light, dark] = [luminance(a), luminance(b)].sort((x, y) => y - x);
    return (light! + 0.05) / (dark! + 0.05);
}

/** True when a colour needs an edge to be seen on the sheet: under 3 : 1, the least asked of a mark that is not text. */
export const needsEdge = (colour: [number, number, number], sheet: [number, number, number]) => contrast(colour, sheet) < 3;

/** Where a collapsed selection's caret is drawn, in the frame's coordinates, or null when it is not in `root`. */
export function caretBox(root: HTMLElement, frame: HTMLElement): { left: number; top: number; height: number } | null {
    const selection = getSelection();
    if (!selection || selection.rangeCount === 0 || !selection.isCollapsed) return null;
    const range = selection.getRangeAt(0);
    if (!root.contains(range.startContainer)) return null;
    let rect: DOMRect | undefined = [...range.getClientRects()].find((box) => box.height > 0);
    if (!rect) {
        // an empty line has no box of its own: the caret stands at the start of its block, a line tall
        const node = range.startContainer;
        const element = (node.nodeType === Node.ELEMENT_NODE ? (node as Element) : node.parentElement)!;
        const child = element.childNodes[range.startOffset];
        const box = (child instanceof Element ? child : element).getBoundingClientRect();
        const style = getComputedStyle(child instanceof Element ? child : element);
        const line = parseFloat(style.lineHeight) || box.height;
        rect = new DOMRect(box.left + (parseFloat(style.paddingLeft) || 0), box.top + (parseFloat(style.paddingTop) || 0), 0, Math.min(line, box.height || line));
    }
    const origin = frame.getBoundingClientRect();
    return { left: rect.left - origin.left - frame.clientLeft, top: rect.top - origin.top - frame.clientTop, height: rect.height };
}

/** The colour shown after `index` blinks, going round the list. */
export function blinkColour(colours: readonly string[], index: number): string {
    return colours[((index % colours.length) + colours.length) % colours.length];
}

/** Draws the caret for `root` inside `frame` (a positioned box holding it). */
export function createCaret(root: HTMLElement, frame: HTMLElement, colours: readonly string[] = ["var(--accent)"]): { element: HTMLElement; place(): void; destroy(): void } {
    const element = document.createElement("div");
    element.className = "quire-caret";
    element.setAttribute("aria-hidden", "true");
    frame.append(element);
    let blinks = 0;
    let rest: ReturnType<typeof setTimeout> | undefined;
    let ticking: ReturnType<typeof setInterval> | undefined;
    const still = () => matchMedia("(prefers-reduced-motion: reduce)").matches;
    // the sheet's colour, read once it is drawn, by painting it on a canvas, which understands every way a colour can be written
    let sheet: [number, number, number] | undefined;
    const sheetColour = () => {
        if (sheet) return sheet;
        const paint = document.createElement("canvas").getContext("2d", { willReadFrequently: true });
        if (!paint) return undefined;
        paint.fillStyle = getComputedStyle(frame).backgroundColor;
        paint.fillRect(0, 0, 1, 1);
        const [r, g, b, a] = paint.getImageData(0, 0, 1, 1).data;
        if (a === 0) return undefined;
        sheet = [r!, g!, b!];
        return sheet;
    };
    const colour = () => {
        const now = still() ? "var(--accent)" : blinkColour(colours, blinks);
        element.style.setProperty("--caret", now);
        const ground = /^#[0-9a-f]{6}$/i.test(now) ? sheetColour() : undefined;
        element.classList.toggle("edged", !!ground && needsEdge(hexRgb(now), ground));
    };

    /** Puts the caret where the cursor is now; true when it is shown. */
    const move = () => {
        const box = document.activeElement === root || root.contains(document.activeElement) ? caretBox(root, frame) : null;
        element.classList.toggle("shown", !!box);
        if (!box) return false;
        element.style.translate = `${box.left}px ${box.top}px`;
        element.style.height = `${box.height}px`;
        return true;
    };
    const place = () => {
        clearTimeout(rest);
        clearInterval(ticking);
        element.classList.remove("off");
        if (!move()) return;
        colour();
        if (still()) return;
        // still for a moment, it starts to blink: off, then on in the next colour
        rest = setTimeout(() => {
            ticking = setInterval(() => {
                const backOn = !element.classList.toggle("off");
                if (backOn) {
                    blinks++;
                    colour();
                }
            }, 530);
        }, 600);
    };
    // after a change it follows for a moment, as what is above the cursor grows or shrinks over time
    let waiting = false;
    let until = 0;
    // the cursor moving or text typed starts the blink over; the page moving under it only carries it along
    let fresh = false;
    const follow = () => {
        if (fresh) {
            fresh = false;
            place();
        } else move();
        if (performance.now() > until) {
            waiting = false;
            return;
        }
        requestAnimationFrame(follow);
    };
    const soon = (restart: boolean) => {
        until = performance.now() + 700;
        if (restart) fresh = true;
        if (waiting) return;
        waiting = true;
        requestAnimationFrame(follow);
    };
    const moved = () => soon(true);
    const carried = () => soon(false);
    document.addEventListener("selectionchange", moved);
    root.addEventListener("input", moved);
    root.addEventListener("focus", moved);
    root.addEventListener("blur", moved);
    addEventListener("resize", carried);
    const watcher = new ResizeObserver(carried);
    watcher.observe(root);
    watcher.observe(frame);
    return {
        element,
        place,
        destroy() {
            clearTimeout(rest);
            clearInterval(ticking);
            document.removeEventListener("selectionchange", moved);
            removeEventListener("resize", carried);
            watcher.disconnect();
            element.remove();
        },
    };
}
