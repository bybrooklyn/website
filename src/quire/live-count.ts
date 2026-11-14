// The word count while typing (View, Word count while typing): a small counter at the window's
// lower left that keeps the number of words as they are written, or of the words selected when
// there is a selection. A press grows it open to the characters and, in page view, the pages. It
// is shown or not as the writer last chose, in this browser.
//
//   const counter = createLiveCount(() => ({ whole, part, pages }));
//   counter.show(true); counter.update();
//
// The words it says are made by `countLines`, which is pure and tested; the counting is the word
// count's own (countRows in export.ts).

import { countRows } from "./md/export";
import { make } from "./ui";

/** What the counter counts: the whole text, the selected text if any, and the pages in page view. */
export interface Counted {
    whole: string;
    part?: string;
    pages?: number;
}

const plural = (count: number, one: string, many: string) => `${count.toLocaleString("en")} ${count === 1 ? one : many}`;

/** The counter's lines: the words first, then the characters and the pages it grows open to. With a selection, "12 of 340 words". */
export function countLines(counted: Counted): string[] {
    const [words, characters] = countRows(counted.whole, counted.part);
    const line = ([, whole, part]: [string, number, number | undefined], one: string, many: string) => (part === undefined ? plural(whole, one, many) : `${part.toLocaleString("en")} of ${plural(whole, one, many)}`);
    const lines = [line(words!, "word", "words"), line(characters!, "character", "characters")];
    if (counted.pages !== undefined) lines.push(plural(counted.pages, "page", "pages"));
    return lines;
}

/** Where the counter being shown is kept. */
const KEY = "quire-live-count";

/** Builds the counter; it is not shown until asked, or until this browser remembers it was. */
export function createLiveCount(count: () => Counted) {
    const button = make("button", "quire-live-count");
    button.type = "button";
    button.setAttribute("aria-expanded", "false");
    button.title = "Word count";
    const first = make("span", "quire-live-words");
    const more = make("span", "quire-live-more");
    const inner = make("span", "quire-live-more-in");
    more.append(inner);
    button.append(first, more);
    button.inert = true;
    button.addEventListener("mousedown", (event) => event.preventDefault());
    button.addEventListener("click", () => {
        const open = !button.classList.contains("open");
        button.classList.toggle("open", open);
        button.setAttribute("aria-expanded", String(open));
    });
    let shown = false;
    try {
        shown = localStorage.getItem(KEY) === "on";
    } catch {
        // a browser keeping nothing starts without it
    }
    let waiting: ReturnType<typeof setTimeout> | undefined;
    const draw = () => {
        const [words, ...rest] = countLines(count());
        first.textContent = words!;
        inner.replaceChildren(...rest.map((each) => make("span", "", each)));
    };
    const counter = {
        element: button,
        shown: () => shown,
        /** Shows or hides it, and remembers which in this browser. */
        show(on: boolean) {
            shown = on;
            button.classList.toggle("shown", on);
            button.inert = !on;
            if (on) draw();
            try {
                localStorage.setItem(KEY, on ? "on" : "off");
            } catch {
                // kept for this visit only
            }
        },
        /** Counts again a moment after typing pauses, so that a long document does not slow the keys. */
        update() {
            if (!shown) return;
            clearTimeout(waiting);
            waiting = setTimeout(draw, 150);
        },
        destroy() {
            clearTimeout(waiting);
            button.remove();
        },
    };
    // shown as it was last time, once it is in the page so that it grows in
    if (shown) requestAnimationFrame(() => counter.show(true));
    return counter;
}
