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

/**
 * The same flag for the light paper. Its white cannot be seen on paper (1.1 : 1), so at that step
 * the caret is the paper's own ink, oklch(0.24 0.04 300), which is 14.9 : 1 there. The rest stay the
 * flag's: on the paper the orange is 1.9 : 1 and is drawn with the ink's hairline, as any colour
 * under 3 : 1 is; the red, pink and rose are 4.5, 3.1 and 6.9 : 1.
 */
export const FLAG_ON_PAPER = ["#D52D00", "#FF9A56", "#221B2F", "#D362A4", "#A30262"] as const;

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
        if (child instanceof HTMLBRElement && box.height > 0) {
            // the `<br>` holding the line open is an inline box already the text's height and at its place on
            // the line, where the browser draws its caret; centring it in the line again put the caret low
            rect = new DOMRect(box.left, box.top, 0, box.height);
        } else {
            const style = getComputedStyle(child instanceof Element ? child : element);
            const line = parseFloat(style.lineHeight) || box.height;
            // as tall as the text would be there, as the browser's caret is, in the middle of the line
            const text = Math.min(line, box.height || line, (parseFloat(style.fontSize) || line) * 1.25);
            rect = new DOMRect(box.left + (parseFloat(style.paddingLeft) || 0), box.top + (parseFloat(style.paddingTop) || 0) + (line - text) / 2, 0, text);
        }
    }
    const origin = frame.getBoundingClientRect();
    // a sheet shown nearer or further (paper.ts) is measured on screen at its zoom, and placed inside at its own size
    const zoom = origin.width / (frame.offsetWidth || origin.width) || 1;
    return { left: (rect.left - origin.left) / zoom - frame.clientLeft, top: (rect.top - origin.top) / zoom - frame.clientTop, height: rect.height / zoom };
}

/** The colour shown after `index` blinks, going round the list. */
export function blinkColour(colours: readonly string[], index: number): string {
    return colours[((index % colours.length) + colours.length) % colours.length];
}

/** Draws the caret for `root` inside `frame` (a positioned box holding it). */
export function createCaret(root: HTMLElement, frame: HTMLElement, first: readonly string[] = ["var(--accent)"]): { element: HTMLElement; place(): void; setColours(next: readonly string[]): void; destroy(): void } {
    const element = document.createElement("div");
    element.className = "quire-caret";
    element.setAttribute("aria-hidden", "true");
    frame.append(element);
    let colours = first;
    let blinks = 0;
    let rest: ReturnType<typeof setTimeout> | undefined;
    let ticking: ReturnType<typeof setInterval> | undefined;
    const still = () => matchMedia("(prefers-reduced-motion: reduce)").matches;
    // what the caret is drawn over, read once it is drawn, by painting it on a canvas, which
    // understands every way a colour can be written: the page's own ground, or in page view the
    // pages behind the text, or where the page has none (A) the ground round it
    let sheet: [number, number, number] | undefined;
    const sheetColour = () => {
        if (sheet) return sheet;
        const paint = document.createElement("canvas").getContext("2d", { willReadFrequently: true });
        if (!paint) return undefined;
        const page = frame.querySelector<HTMLElement>(".quire-page");
        for (let at: HTMLElement | null = frame, step = 0; at; at = step++ === 0 && page ? page : at === page ? frame.parentElement : at.parentElement) {
            paint.clearRect(0, 0, 1, 1);
            paint.fillStyle = getComputedStyle(at).backgroundColor;
            paint.fillRect(0, 0, 1, 1);
            const [r, g, b, a] = paint.getImageData(0, 0, 1, 1).data;
            if (a! > 200) return (sheet = [r!, g!, b!]);
        }
        return undefined;
    };
    const colour = () => {
        const now = still() ? "var(--accent)" : blinkColour(colours, blinks);
        element.style.setProperty("--caret", now);
        const ground = /^#[0-9a-f]{6}$/i.test(now) ? sheetColour() : undefined;
        element.classList.toggle("edged", !!ground && needsEdge(hexRgb(now), ground));
    };

    /** Where it was last put, to tell a short move from a long one. */
    let last: { left: number; top: number; height: number } | undefined;
    /**
     * Puts the caret where the cursor is now. Typed text puts it there `atOnce`, in the same frame as the
     * letter; a cursor moved by a key or a press slides it the short way, for 50 ms (quire.css), and a move
     * to another line or a long way along one is at once too. `whole` brings it back blinked off without
     * fading in. True when it is shown.
     */
    const move = (whole = false, atOnce = false) => {
        // a field inside the document (a code block's language, a picture's alt text) has its own caret; the text's is not drawn beside it
        const field = document.activeElement instanceof HTMLInputElement || document.activeElement instanceof HTMLTextAreaElement;
        const box = !field && (document.activeElement === root || root.contains(document.activeElement)) ? caretBox(root, frame) : null;
        const was = element.classList.contains("shown");
        element.classList.toggle("shown", !!box);
        if (!box) return false;
        // as tall as the text, as the browser's own caret is
        const tall = box.height;
        const top = box.top + (box.height - tall) / 2;
        const far = !last || Math.abs(last.top - top) > tall / 2 || Math.abs(last.left - box.left) > tall * 2;
        last = { left: box.left, top, height: tall };
        if (!was || atOnce || far) element.style.transition = "none";
        else if (whole) element.style.transitionProperty = "translate, height";
        // a hair after the letter before, in proportion to the text, so that it never lies on a letter that reaches its edge (a heading's w)
        element.style.translate = `${box.left + tall * 0.05}px ${top}px`;
        element.style.height = `${tall}px`;
        if (!was || whole || atOnce || far) {
            void element.offsetWidth;
            element.style.transition = "";
        }
        return true;
    };
    const place = (atOnce = false) => {
        clearTimeout(rest);
        clearInterval(ticking);
        // blinked off when a key is pressed, it is back at once and whole, not faded in
        const blinkedOff = element.classList.contains("off");
        element.classList.remove("off");
        if (!move(blinkedOff, atOnce)) return;
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
        // following, it is only carried along with what moves under it; it was put in place when the change came
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
    // The caret is put in its place in the same instant the text changes or the cursor moves, not a frame
    // later: waiting for the next frame left it a letter behind the words while typing. Typed text takes it
    // there at once; the cursor moved by a key or a press slides it the short way. Then it is followed for a
    // moment, as what is above it settles.
    let typedAt = -Infinity;
    const typed = () => {
        typedAt = performance.now();
        place(true);
        soon(false);
    };
    const moved = () => {
        // the cursor's own move that follows a keystroke is part of the typing
        place(performance.now() - typedAt < 100);
        soon(false);
    };
    const carried = () => soon(false);
    document.addEventListener("selectionchange", moved);
    root.addEventListener("input", typed);
    // The editor writes the text itself, and the browser reports the cursor's move a frame or two later. A
    // change to the text is heard here straight after it is made, before anything is drawn, so the caret is
    // drawn with the letter and not after it.
    const written = new MutationObserver(typed);
    written.observe(root, { childList: true, subtree: true, characterData: true });
    root.addEventListener("focus", moved);
    root.addEventListener("blur", moved);
    addEventListener("resize", carried);
    const watcher = new ResizeObserver(carried);
    watcher.observe(root);
    watcher.observe(frame);
    return {
        element,
        place,
        /** Takes other colours, as the look changes; what it is drawn over is read again once the page has eased into its new ground. */
        setColours(next) {
            colours = next;
            sheet = undefined;
            setTimeout(() => {
                sheet = undefined;
                if (element.classList.contains("shown")) colour();
            }, 500);
        },
        destroy() {
            clearTimeout(rest);
            clearInterval(ticking);
            document.removeEventListener("selectionchange", moved);
            removeEventListener("resize", carried);
            watcher.disconnect();
            written.disconnect();
            element.remove();
        },
    };
}
