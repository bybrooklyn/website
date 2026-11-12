// The caret, drawn: the browser's own is one thin pixel in whatever colour the page gives it, too
// faint on the sheet. This one is a bar of the line's height, a little thicker, kept where the
// browser's caret is (which is made clear and still does the work). It is solid while the cursor
// moves or text is typed, as carets are, and blinks once things are still; each time it blinks
// back on it takes the next of its colours. With less motion asked for it does not blink.

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
    const colour = () => element.style.setProperty("--caret", still() ? "var(--accent)" : blinkColour(colours, blinks));

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
