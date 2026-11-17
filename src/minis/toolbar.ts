// The marble run's tools, as the page shows them: words to press, each with a short tooltip naming its
// key, in the column beside the scene; small line icons drawn as mdQuire's are (a 24 unit square, round
// ends, the colour of the text) for the scene's own menu; a fold that grows open from the word that
// opened it; and which keys are the scene's wherever the keyboard is in the mini. Only wiring for the
// page; what the words do is in marbles.ts.

import { el } from "../mote/stage";

/** Each icon's lines, in a 24 unit square. */
const PATHS: Record<string, string> = {
    copy: '<rect x="8.5" y="8.5" width="11" height="11" rx="2"/><path d="M15.5 8.5V6a1.5 1.5 0 0 0-1.5-1.5H6A1.5 1.5 0 0 0 4.5 6v8A1.5 1.5 0 0 0 6 15.5h2.5"/>',
    paste: '<rect x="5" y="5.5" width="14" height="15" rx="2"/><path d="M9 5.5V4.5A1 1 0 0 1 10 3.5h4a1 1 0 0 1 1 1v1M9 12h6M9 16h4"/>',
    duplicate: '<rect x="8.5" y="8.5" width="11" height="11" rx="2"/><path d="M15.5 8.5V6a1.5 1.5 0 0 0-1.5-1.5H6A1.5 1.5 0 0 0 4.5 6v8A1.5 1.5 0 0 0 6 15.5h2.5M14 11.5v5M11.5 14h5"/>',
    // two halves either side of an upright dashed line, one filled in outline
    mirror: '<path d="M12 3.5v17" stroke-dasharray="2 2.2"/><path d="M9 7 3.5 17H9zM15 7l5.5 10H15z"/>',
    // a quarter turn about a point
    turn: '<path d="M19 12a7 7 0 1 1-2.05-4.95"/><path d="M17.5 3.5v4h-4"/>',
    remove: '<path d="M4.5 7h15M9.5 7V5a1 1 0 0 1 1-1h3a1 1 0 0 1 1 1v2M6.5 7l.8 12a1.5 1.5 0 0 0 1.5 1.4h6.4a1.5 1.5 0 0 0 1.5-1.4l.8-12M10 11v6M14 11v6"/>',
    // two links of a chain: what is joined to this
    joined: '<path d="M10 14a3.5 3.5 0 0 0 5 0l3-3a3.5 3.5 0 0 0-5-5l-.8.8"/><path d="M14 10a3.5 3.5 0 0 0-5 0l-3 3a3.5 3.5 0 0 0 5 5l.8-.8"/>',
    // a length of track bowed up through two of its points: bend it
    bend: '<path d="M3 17.5c3.5-9.5 14.5-9.5 18 0"/><circle cx="8.2" cy="11.4" r="1.9"/><circle cx="15.8" cy="11.4" r="1.9"/>',
    // the same length laid straight again, the bow it had faint above it
    straighten: '<path d="M3 16h18"/><circle cx="8.2" cy="16" r="1.9"/><circle cx="15.8" cy="16" r="1.9"/><path d="M6 10.5c3.5-3.3 8.5-3.3 12 0" stroke-dasharray="1.6 2"/>',
    // a box with a plus: kept as a piece of one's own
    keep: '<path d="M4.5 8 12 4l7.5 4v8L12 20l-7.5-4z"/><path d="M12 9.5v5M9.5 12h5"/>',
    // a marble going, the air behind it: ride along with it
    ride: '<circle cx="15" cy="12" r="4.5"/><path d="M3.5 9h5M2.5 12h6M3.5 15h5"/>',
    // an arrow up out of an open box: share the run
    share: '<path d="M12 3.5v11M8 7.5l4-4 4 4"/><path d="M5.5 11.5v7a1.5 1.5 0 0 0 1.5 1.5h10a1.5 1.5 0 0 0 1.5-1.5v-7"/>',
    close: '<path d="m7 7 10 10M17 7 7 17"/>',
};

/** One of the run's line icons, in the colour of the text round it. */
export function icon(name: string): SVGSVGElement {
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("viewBox", "0 0 24 24");
    svg.setAttribute("aria-hidden", "true");
    svg.setAttribute("class", "marbles-icon");
    svg.innerHTML = PATHS[name] ?? "";
    return svg;
}

/**
 * A tool: a word to press, its tooltip what it does and its key. One that stays on says so in its words
 * (`stream: on`) and with `aria-pressed`; one that cannot act now is faint and out of reach (`can`).
 */
export function word(words: string, label: string, key: string, press: () => void, stays = false): HTMLButtonElement {
    const button = el("button", { type: "button", class: "marbles-word", textContent: words, title: key ? `${label} (${key})` : label, onclick: press });
    if (key) button.setAttribute("aria-keyshortcuts", key.replace(/ or .*/, "").replace(/Ctrl/g, "Control"));
    if (stays) button.setAttribute("aria-pressed", "false");
    return button;
}

/** A word that can act now, or not: faint and out of reach while it cannot, never hidden. */
export function can(button: HTMLElement, on: boolean): void {
    button.inert = !on;
    button.classList.toggle("faint", !on);
}

/** Where the keyboard is in the mini when a key is pressed: on the scene, on a button (or anything else that is pressed), or in a box of text. */
export type KeyPlace = "canvas" | "button" | "text";

/** Where the keyboard is, from the element that has it: a box of text or number is typed into; anything else but the scene is pressed. */
export function keyPlace(target: EventTarget | null, canvas: HTMLElement): KeyPlace {
    if (target === canvas) return "canvas";
    if (target instanceof HTMLTextAreaElement || (target instanceof HTMLElement && target.isContentEditable)) return "text";
    if (target instanceof HTMLInputElement) return ["button", "checkbox", "radio", "range", "file", "submit", "reset"].includes(target.type) ? "button" : "text";
    return "button";
}

/**
 * Whether a key pressed inside the mini is the scene's, so that pressing a button does not leave the
 * keys dead: every key is, wherever the keyboard is, but for what a box of text keeps to be typed with
 * (all of it), and what a button keeps (Enter and Tab, the keyboard's way to press it and to move on).
 * Space from a button lets a marble go, as it does on the scene, and does not press the button again.
 */
export function keyHeard(key: string, on: KeyPlace): boolean {
    if (on === "text" || key === "Tab") return false;
    return on === "canvas" || key !== "Enter";
}

/**
 * A fold in the column that grows open from the word that opens it and shrinks back into it: its
 * height from none to what it holds, its scale and its fade, from the button's place. Never hidden.
 */
export function fold(name: string, ...inside: (Node | string)[]): { box: HTMLElement; open(from: HTMLElement, open?: boolean): boolean; shown(): boolean } {
    const box = el("div", { class: `marbles-fold ${name}` }, el("div", { class: "marbles-fold-inner" }, ...inside));
    box.setAttribute("aria-hidden", "true");
    box.inert = true;
    let opened = false;
    return {
        box,
        shown: () => opened,
        open(from, open = !opened) {
            opened = open;
            const own = box.getBoundingClientRect();
            const button = from.getBoundingClientRect();
            box.style.setProperty("--from", `${Math.max(0, button.left + button.width / 2 - own.left)}px`);
            box.classList.toggle("open", opened);
            box.setAttribute("aria-hidden", String(!opened));
            box.inert = !opened;
            from.setAttribute("aria-expanded", String(opened));
            return opened;
        },
    };
}
