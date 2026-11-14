// The marble run's tools, as the page shows them: small line icons drawn as mdQuire's are (a 24 unit
// square, round ends, the colour of the text), buttons that carry one with a short tooltip naming the
// key, and a fold that grows open from the button that opened it. Only wiring for the page; what the
// buttons do is in marbles.ts.

import { el } from "../mote/stage";

/** Each icon's lines, in a 24 unit square. */
const PATHS: Record<string, string> = {
    // a box drawn with a dashed line, and a pointer in its corner
    select: '<path d="M4 9V5.5A1.5 1.5 0 0 1 5.5 4H9M15 4h3.5A1.5 1.5 0 0 1 20 5.5V9M4 15v3.5A1.5 1.5 0 0 0 5.5 20H9" stroke-dasharray="2.2 2.4"/><path d="m13 13 7.5 2.6-3.2 1.3-1.3 3.2z"/>',
    undo: '<path d="M8.5 5 4.5 9l4 4"/><path d="M4.5 9h9.5a5.5 5.5 0 0 1 0 11H10"/>',
    redo: '<path d="m15.5 5 4 4-4 4"/><path d="M19.5 9H10a5.5 5.5 0 0 0 0 11h4"/>',
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
    // a box with a plus: kept as a piece of one's own
    keep: '<path d="M4.5 8 12 4l7.5 4v8L12 20l-7.5-4z"/><path d="M12 9.5v5M9.5 12h5"/>',
    // a marble with a line under it, going
    go: '<circle cx="12" cy="9" r="4.5"/><path d="M5 18.5h14M9 15.5l3 3 3-3" />',
    // three marbles, one after another
    stream: '<circle cx="5.5" cy="15" r="2.5"/><circle cx="12" cy="12" r="2.5"/><circle cx="18.5" cy="9" r="2.5"/>',
    pause: '<path d="M8.5 5.5v13M15.5 5.5v13"/>',
    play: '<path d="M8 5.5v13l10-6.5z"/>',
    // the marbles taken away: a marble and a turn back
    reset: '<path d="M4.5 12a7.5 7.5 0 1 0 2.2-5.3"/><path d="M4.5 4v4h4"/><circle cx="12" cy="12" r="2.2"/>',
    // four corners round the run
    fit: '<path d="M4 9V5.5A1.5 1.5 0 0 1 5.5 4H9M15 4h3.5A1.5 1.5 0 0 1 20 5.5V9M20 15v3.5a1.5 1.5 0 0 1-1.5 1.5H15M9 20H5.5A1.5 1.5 0 0 1 4 18.5V15"/>',
    // the same corners round a smaller box: what is chosen
    "fit-chosen": '<path d="M4 9V5.5A1.5 1.5 0 0 1 5.5 4H9M15 4h3.5A1.5 1.5 0 0 1 20 5.5V9M20 15v3.5a1.5 1.5 0 0 1-1.5 1.5H15M9 20H5.5A1.5 1.5 0 0 1 4 18.5V15"/><rect x="9" y="9" width="6" height="6" rx="1"/>',
    sound: '<path d="M4.5 9.5h3l4.5-4v13l-4.5-4h-3z"/><path d="M15.5 9a4 4 0 0 1 0 6M18 6.5a7.5 7.5 0 0 1 0 11"/>',
    quiet: '<path d="M4.5 9.5h3l4.5-4v13l-4.5-4h-3z"/><path d="m15.5 9.5 5 5M20.5 9.5l-5 5"/>',
    keys: '<rect x="2.5" y="6" width="19" height="12" rx="2"/><path d="M6 10h.01M10 10h.01M14 10h.01M18 10h.01M7 14h10"/>',
    // runs to start from: a list
    runs: '<path d="M8.5 6.5h11M8.5 12h11M8.5 17.5h11"/><circle cx="4.75" cy="6.5" r=".9" fill="currentColor"/><circle cx="4.75" cy="12" r=".9" fill="currentColor"/><circle cx="4.75" cy="17.5" r=".9" fill="currentColor"/>',
    close: '<path d="m7 7 10 10M17 7 7 17"/>',
    done: '<path d="m5 12.5 4.5 4.5L19 7.5"/>',
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

/** A tool: an icon button, its tooltip what it does and its key. A button that stays on says so with `aria-pressed`. */
export function tool(name: string, label: string, key: string, press: () => void, stays = false): HTMLButtonElement {
    const button = el("button", { type: "button", class: "marbles-tool", title: key ? `${label} (${key})` : label, onclick: press });
    button.setAttribute("aria-label", label);
    if (key) button.setAttribute("aria-keyshortcuts", key.replace(/ or .*/, "").replace(/Ctrl/g, "Control"));
    if (stays) button.setAttribute("aria-pressed", "false");
    button.append(icon(name));
    return button;
}

/** Shows the icon given in a tool, in place of the one it had: pause and play, sound and quiet. */
export function swap(button: HTMLButtonElement, name: string, label: string, key: string) {
    button.replaceChildren(icon(name));
    button.title = key ? `${label} (${key})` : label;
    button.setAttribute("aria-label", label);
}

/**
 * Keeps a bar of groups in one row while they fit there, and otherwise stacks them, one group to a row,
 * by the class `stacked`: a row that wraps would start with the rule that parts it from the group
 * before, left hanging. Measured, not guessed from the page's width, since the room the panel has
 * depends on the page round it. The width one row needs is read with the bar laid out in one row for
 * a moment (the class `measuring`), within the same frame, so nothing is seen of it.
 */
export function stacking(bar: HTMLElement): void {
    const fit = () => {
        const parent = bar.parentElement;
        if (!parent) return;
        const style = getComputedStyle(parent);
        const room = parent.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight);
        if (room <= 0) return;
        bar.classList.add("measuring");
        bar.classList.remove("stacked");
        const needed = bar.getBoundingClientRect().width;
        bar.classList.remove("measuring");
        bar.classList.toggle("stacked", needed > room + 0.5);
    };
    if (bar.parentElement) new ResizeObserver(fit).observe(bar.parentElement);
    fit();
}

/**
 * A fold under the bar that grows open from the button that opens it and shrinks back into it: its
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
