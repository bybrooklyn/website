// The strip of small pictures under the picture being worked on, when the document is a batch: one small
// picture each, the one on the stage marked, scrolled sideways (by a finger, a touchpad or the wheel) when
// there are many, and the current one brought into view. It takes room of its own at the foot of the
// picture's room, so the picture is fitted into what is left and glides there as the strip grows in from
// where the pictures arrived; its small pictures arrive one after another. A press on one works on it;
// the arrow keys step through them while the strip has the keyboard; a right-click opens its own menu
// (Shift leaves the browser's); pictures dropped on it are added to the batch.
//
//   const strip = batchStrip({ pick, menu, drop });
//   strip.fill(items, current, droppedAt);

import { make, still } from "../core/ui";

/** One small picture of the strip: a key that stays with its picture, what a screen reader says of it, and its pixels as it looks (none while they are made). */
export interface StripItem {
    key: string;
    label: string;
    pixels?: { width: number; height: number; data: Uint8ClampedArray };
}

/** What the strip is given: what a press on a small picture does, what its right-click opens (where, and whether from the keyboard), and pictures dropped on it. */
export interface StripHooks {
    pick(at: number, keyboard: boolean): void;
    menu(at: number, x: number, y: number, keyboard: boolean): void;
    drop(files: File[], place: { x: number; y: number }): void;
}

/** The strip of small pictures. */
export function batchStrip(hooks: StripHooks) {
    const element = make("div", "quire-img-thumbs");
    element.inert = true;
    const row = make("div", "quire-img-thumbs-row");
    row.setAttribute("role", "listbox");
    row.setAttribute("aria-label", "Pictures");
    row.setAttribute("aria-orientation", "horizontal");
    element.append(row);
    // each small picture's button, by its picture's key, and the pixels it was last drawn from
    const shown = new Map<string, { button: HTMLButtonElement; canvas: HTMLCanvasElement; drawn?: StripItem["pixels"] }>();
    let order: string[] = [];
    let current = -1;

    const indexOf = (button: Element | null) => (button ? order.indexOf((button as HTMLElement).dataset.key ?? "") : -1);
    row.addEventListener("click", (event) => {
        const at = indexOf((event.target as Element).closest(".quire-img-thumb"));
        if (at >= 0) hooks.pick(at, false);
    });
    row.addEventListener("contextmenu", (event) => {
        // Shift leaves the browser's own menu
        if (event.shiftKey) return;
        const button = (event.target as Element).closest<HTMLElement>(".quire-img-thumb");
        event.preventDefault();
        event.stopPropagation();
        const at = indexOf(button);
        hooks.menu(at, event.clientX, event.clientY, false);
    });
    row.addEventListener("keydown", (event) => {
        const at = indexOf((event.target as Element).closest(".quire-img-thumb"));
        if (at < 0) return;
        const to = event.key === "ArrowRight" ? at + 1 : event.key === "ArrowLeft" ? at - 1 : event.key === "Home" ? 0 : event.key === "End" ? order.length - 1 : undefined;
        if (event.key === "ContextMenu" || (event.key === "F10" && event.shiftKey)) {
            event.preventDefault();
            event.stopPropagation();
            const box = (event.target as HTMLElement).getBoundingClientRect();
            return hooks.menu(at, box.left + box.width / 2, box.top + box.height / 2, true);
        }
        if (to === undefined || to < 0 || to >= order.length) return;
        event.preventDefault();
        event.stopPropagation();
        hooks.pick(to, true);
        queueMicrotask(() => shown.get(order[to]!)?.button.focus({ preventScroll: true }));
    });
    // the wheel turned up and down scrolls the strip sideways, as a mouse has no wheel for across
    row.addEventListener(
        "wheel",
        (event) => {
            if (Math.abs(event.deltaX) >= Math.abs(event.deltaY) || row.scrollWidth <= row.clientWidth) return;
            event.preventDefault();
            row.scrollLeft += event.deltaY;
        },
        { passive: false },
    );
    // pictures dropped on the strip join the batch, and do not make a new one
    element.addEventListener("dragover", (event) => {
        if (![...(event.dataTransfer?.items ?? [])].some((item) => item.kind === "file")) return;
        event.preventDefault();
        event.stopPropagation();
        element.classList.add("dropping");
    });
    element.addEventListener("dragleave", () => element.classList.remove("dropping"));
    element.addEventListener("drop", (event) => {
        element.classList.remove("dropping");
        const files = [...(event.dataTransfer?.files ?? [])];
        if (!files.length) return;
        event.preventDefault();
        event.stopPropagation();
        hooks.drop(files, { x: event.clientX, y: event.clientY });
    });

    /** Draws a small picture's pixels into its canvas, when they are others than it shows. */
    function draw(entry: { canvas: HTMLCanvasElement; drawn?: StripItem["pixels"] }, pixels: StripItem["pixels"]) {
        if (!pixels || entry.drawn === pixels) return;
        entry.drawn = pixels;
        entry.canvas.width = pixels.width;
        entry.canvas.height = pixels.height;
        entry.canvas.style.aspectRatio = `${pixels.width} / ${pixels.height}`;
        entry.canvas.getContext("2d")!.putImageData(new ImageData(new Uint8ClampedArray(pixels.data), pixels.width, pixels.height), 0, 0);
        entry.canvas.classList.add("drawn");
    }

    /** Brings the current small picture into view, gliding there unless motion is reduced. */
    function reveal(instant = false) {
        const button = shown.get(order[current] ?? "")?.button;
        if (!button) return;
        const left = button.offsetLeft - (row.clientWidth - button.offsetWidth) / 2;
        const goal = Math.max(0, Math.min(row.scrollWidth - row.clientWidth, left));
        if (Math.abs(goal - row.scrollLeft) < 1) return;
        row.scrollTo({ left: goal, behavior: instant || still() ? "instant" : "smooth" });
    }

    // when the strip's width changes (the window, a phone turned) the current picture is brought into view again
    let width = 0;
    const watcher = typeof ResizeObserver === "undefined" ? undefined : new ResizeObserver(() => row.clientWidth !== width && ((width = row.clientWidth), reveal(true)));
    watcher?.observe(row);

    /**
     * Shows the batch's small pictures, the current one marked and brought into view. With fewer than two the
     * strip shrinks away. A small picture new to the strip arrives after the one before it; one taken out
     * shrinks away. `from` is where the pictures arrived in the window, which the strip grows in from.
     */
    function fill(items: StripItem[], at: number, from?: { x: number; y: number }) {
        const opening = items.length > 1 && !element.classList.contains("open");
        if (opening && from) {
            const box = element.getBoundingClientRect();
            element.style.setProperty("--thumbs-from", `${Math.round(from.x - box.left)}px`);
        }
        element.classList.toggle("open", items.length > 1);
        element.inert = items.length < 2;
        const keys = new Set(items.map((item) => item.key));
        for (const [key, entry] of shown)
            if (!keys.has(key)) {
                shown.delete(key);
                if (still()) entry.button.remove();
                else {
                    entry.button.classList.add("leaving");
                    entry.button.addEventListener("animationend", () => entry.button.remove(), { once: true });
                    setTimeout(() => entry.button.remove(), 600);
                }
            }
        let arriving = 0;
        let before: Element | null = null;
        for (const [index, item] of items.entries()) {
            let entry = shown.get(item.key);
            if (!entry) {
                const button = make("button", "quire-img-thumb");
                button.type = "button";
                button.dataset.key = item.key;
                button.setAttribute("role", "option");
                const canvas = make("canvas", "quire-img-thumb-picture");
                canvas.setAttribute("aria-hidden", "true");
                button.append(canvas);
                entry = { button, canvas };
                shown.set(item.key, entry);
                if (!still()) {
                    // each arrives after the one before it, the first at once
                    button.classList.add("arriving");
                    button.style.setProperty("--wait", `${Math.min(arriving++, 24) * 28}ms`);
                    button.addEventListener("animationend", () => button.classList.remove("arriving"), { once: true });
                }
            }
            const { button } = entry;
            // in the batch's order
            const next: Element | null = before ? before.nextElementSibling : row.firstElementChild;
            if (next !== button) row.insertBefore(button, next);
            before = button;
            button.setAttribute("aria-label", item.label);
            button.title = item.label;
            const on = index === at;
            button.setAttribute("aria-selected", String(on));
            button.classList.toggle("current", on);
            button.tabIndex = on ? 0 : -1;
            draw(entry, item.pixels);
        }
        order = items.map((item) => item.key);
        const moved = current !== at;
        current = at;
        if (moved || opening) requestAnimationFrame(() => reveal(opening));
    }

    return {
        element,
        fill,
        /** Gives the keyboard to the current small picture. */
        focus: () => shown.get(order[current] ?? "")?.button.focus({ preventScroll: true }),
        /** The button of a small picture, for a menu to grow from. */
        buttonOf: (at: number) => shown.get(order[at] ?? "")?.button,
        isOpen: () => element.classList.contains("open"),
    };
}
