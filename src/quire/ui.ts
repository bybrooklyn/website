// The pieces mdQuire's controls are made of: buttons with their icons, the keys that move along a
// toolbar, where a floating thing goes so that it stays in the window, and the one kind of menu
// every control opens, as the lab chose it (src/pages/mdquire-lab.astro): it drops below what was
// pressed and covers nothing, growing out from under it on a slight spring, its lines arriving one
// after another; closing, it draws back onto the control plainly. Nothing here simply appears.
//
// The functions that only count (moveIndex, placeNear, keySymbols) are pure and tested. Their styles are in
// src/styles/quire.css.

/** True when the visitor has asked for less motion. */
export const still = (): boolean => typeof matchMedia !== "undefined" && matchMedia("(prefers-reduced-motion: reduce)").matches;

/** Makes an element with a class and some text. */
export function make<K extends keyof HTMLElementTagNameMap>(tag: K, className = "", text = ""): HTMLElementTagNameMap[K] {
    const made = document.createElement(tag);
    if (className) made.className = className;
    if (text) made.textContent = text;
    return made;
}

const PATHS: Record<string, string> = {
    link: '<path d="M10 14a4 4 0 0 0 5.66 0l3-3a4 4 0 0 0-5.66-5.66l-1 1"/><path d="M14 10a4 4 0 0 0-5.66 0l-3 3a4 4 0 0 0 5.66 5.66l1-1"/>',
    bullet: '<circle cx="5" cy="7" r="1.2" fill="currentColor"/><circle cx="5" cy="12" r="1.2" fill="currentColor"/><circle cx="5" cy="17" r="1.2" fill="currentColor"/><path d="M9.5 7h10M9.5 12h10M9.5 17h10"/>',
    number: '<path d="M4 5.5h1.5V10M4 10h3M4 14.5c0-1 .7-1.5 1.5-1.5s1.5.5 1.5 1.3c0 1.2-3 2.2-3 3.7h3"/><path d="M10.5 7h9M10.5 12h9M10.5 17h9"/>',
    task: '<rect x="3.5" y="4.5" width="5" height="5" rx="1.2"/><path d="m4.6 16 1.4 1.4 2.6-2.8"/><path d="M11.5 7h8M11.5 16h8"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    minus: '<path d="M5 12h14"/>',
    code: '<path d="m9 8-4 4 4 4M15 8l4 4-4 4"/>',
    center: '<path d="M5 6h14M8 10h8M5 14h14M8 18h8"/>',
    undo: '<path d="M9 7 5 11l4 4"/><path d="M5 11h9a5 5 0 0 1 0 10h-2"/>',
    redo: '<path d="m15 7 4 4-4 4"/><path d="M19 11h-9a5 5 0 0 0 0 10h2"/>',
    chevron: '<path d="m7 10 5 5 5-5"/>',
    heading: '<path d="M6 5v14M16 5v14M6 12h10"/>',
    quote: '<path d="M7 7h4v4c0 3-2 5-4 6M14 7h4v4c0 3-2 5-4 6"/>',
    table: '<rect x="4" y="5" width="16" height="14" rx="2"/><path d="M4 10h16M4 14.5h16M10 5v14"/>',
    image: '<rect x="4" y="5" width="16" height="14" rx="2"/><circle cx="9" cy="10" r="1.5"/><path d="m5 18 5-5 3 3 2-2 4 4"/>',
    divider: '<path d="M4 12h16"/><path d="M8 7h8M8 17h8" opacity=".45"/>',
    footnote: '<path d="M5 17h9M5 13h9M16 4v6M14 6l2-2"/>',
    row: '<path d="M4 9h16M4 15h16M12 3v4"/>',
    column: '<path d="M9 4v16M15 4v16M3 12h4"/>',
    left: '<path d="M5 6h14M5 10h9M5 14h14M5 18h9"/>',
    right: '<path d="M5 6h14M10 10h9M5 14h14M10 18h9"/>',
    trash: '<path d="M5 7h14M10 7V5h4v2M7 7l1 12h8l1-12"/>',
    wrap: '<rect x="4" y="5" width="7" height="7" rx="1.2"/><path d="M14 6h6M14 11h6M4 16h16M4 20h11"/>',
    close: '<path d="m7 7 10 10M17 7 7 17"/>',
    outline: '<path d="M5 6h14M8 10h11M8 14h11M5 18h14"/>',
    highlight: '<path d="m14.5 4.5 5 5L11 18H6v-5z"/><path d="M4 21h16" opacity=".55"/>',
    justify: '<path d="M5 6h14M5 10h14M5 14h14M5 18h14"/>',
    spacing: '<path d="M11 6h9M11 12h9M11 18h9"/><path d="m4 8 2-3 2 3M4 16l2 3 2-3M6 5v14"/>',
    shelf: '<rect x="4" y="4" width="6.5" height="8" rx="1.2"/><rect x="13.5" y="4" width="6.5" height="8" rx="1.2"/><path d="M4 16h16M4 20h10"/>',
    search: '<circle cx="10.5" cy="10.5" r="5.5"/><path d="m15 15 4.5 4.5"/>',
    pagebreak: '<path d="M6 3.5v5h12v-5M6 20.5v-5h12v5"/><path d="M3.5 12h3M10.5 12h3M17.5 12h3"/>',
    file: '<path d="M7 3.5h7l4 4V20a.5.5 0 0 1-.5.5h-10.5A.5.5 0 0 1 6.5 20V4a.5.5 0 0 1 .5-.5z"/><path d="M14 3.5V8h4"/>',
    print: '<path d="M7 9V4h10v5"/><rect x="4" y="9" width="16" height="7" rx="1.5"/><path d="M7 14h10v6H7z"/>',
    spelling: '<path d="M3.5 14 7 5l3.5 9M4.8 11h4.4"/><path d="m12.5 15 3 3 5.5-6.5"/>',
    paint: '<rect x="5" y="3.5" width="12" height="5" rx="1.2"/><path d="M17 6h2v5h-7v3"/><rect x="10.5" y="14" width="3" height="6.5" rx="1"/>',
    indent: '<path d="M5 5h14M11 10h8M11 14h8M5 19h14"/><path d="m5 9.5 3 2.5-3 2.5"/>',
    outdent: '<path d="M5 5h14M11 10h8M11 14h8M5 19h14"/><path d="M8 9.5 5 12l3 2.5"/>',
    clear: '<path d="M6 5h11M11.5 5 9 15"/><path d="m14 14 5 5M19 14l-5 5"/>',
    find: '<circle cx="10" cy="10" r="5"/><path d="m14 14 5 5"/><path d="M8 10h4" opacity=".6"/>',
    // a prompt, for the command palette: a chevron and a short line after it
    command: '<path d="m5.5 7.5 4.5 4.5-4.5 4.5"/><path d="M12.5 17h6"/>',
    // the menus' own: one for each line, in the same weight as the rest
    tick: '<path d="m5 12.5 4.5 4.5L19 7.5"/>',
    next: '<path d="m10 7 5 5-5 5"/>',
    folder: '<path d="M3.5 7.5a2 2 0 0 1 2-2h4l2 2h7a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2z"/>',
    copy: '<rect x="8.5" y="8.5" width="11" height="11" rx="2"/><path d="M15.5 8.5v-2a2 2 0 0 0-2-2h-7a2 2 0 0 0-2 2v7a2 2 0 0 0 2 2h2"/>',
    cut: '<circle cx="7" cy="17" r="2.5"/><circle cx="17" cy="17" r="2.5"/><path d="M8.8 15.2 17 4.5M15.2 15.2 7 4.5"/>',
    paste: '<rect x="5" y="5" width="14" height="15.5" rx="2"/><path d="M9 5V3.5h6V5M9 11h6M9 15h4"/>',
    plain: '<rect x="5" y="5" width="14" height="15.5" rx="2"/><path d="M9 5V3.5h6V5M9 10h6M12 10v6.5"/>',
    select: '<rect x="4" y="4" width="16" height="16" rx="2" stroke-dasharray="3 3"/>',
    matching: '<rect x="3.5" y="5.5" width="7" height="5" rx="1"/><rect x="13.5" y="13.5" width="7" height="5" rx="1"/><path d="M13.5 8h7M3.5 16h7"/>',
    download: '<path d="M12 4v11M7.5 10.5 12 15l4.5-4.5M5 19.5h14"/>',
    rename: '<rect x="3.5" y="7" width="17" height="10" rx="2"/><path d="M13 4.5v15M11 4.5h4M11 19.5h4"/>',
    history: '<path d="M4.5 12a7.5 7.5 0 1 0 2.2-5.3"/><path d="M4.5 4.5v3h3M12 8v4l3 2"/>',
    info: '<circle cx="12" cy="12" r="8"/><path d="M12 11v5"/><circle cx="12" cy="8" r=".6" fill="currentColor"/>',
    page: '<rect x="5.5" y="3.5" width="13" height="17" rx="1.5"/><path d="M8.5 7.5h7v9h-7z" stroke-dasharray="2 2"/>',
    markdown: '<rect x="2.5" y="6" width="19" height="12" rx="2"/><path d="M6 15V9l2.5 3L11 9v6M16.5 9v6M14.5 13l2 2 2-2"/>',
    globe: '<circle cx="12" cy="12" r="8"/><path d="M4 12h16M12 4c2.5 2.5 2.5 13.5 0 16M12 4c-2.5 2.5-2.5 13.5 0 16"/>',
    text: '<path d="M6 5.5h12M12 5.5v13M9.5 18.5h5"/>',
    word: '<path d="M7 3.5h7l4 4V20a.5.5 0 0 1-.5.5h-10.5A.5.5 0 0 1 6.5 20V4a.5.5 0 0 1 .5-.5z"/><path d="m9 11 1.2 5 1.8-4 1.8 4 1.2-5"/>',
    pen: '<path d="m15 5 4 4L9 19H5v-4z"/><path d="m13 7 4 4"/>',
    mode: '<rect x="4" y="3.5" width="11" height="14" rx="1.5"/><path d="M9 20.5h9.5a1.5 1.5 0 0 0 1.5-1.5V8"/>',
    paper: '<circle cx="12" cy="12" r="8"/><path d="M12 4a8 8 0 0 1 0 16z" fill="currentColor"/>',
    zoom: '<circle cx="10.5" cy="10.5" r="5.5"/><path d="m15 15 4.5 4.5M8.5 10.5h4M10.5 8.5v4"/>',
    fit: '<path d="M4 12h16M7 9l-3 3 3 3M17 9l3 3-3 3"/>',
    full: '<path d="M4 9V5.5A1.5 1.5 0 0 1 5.5 4H9M15 4h3.5A1.5 1.5 0 0 1 20 5.5V9M20 15v3.5a1.5 1.5 0 0 1-1.5 1.5H15M9 20H5.5A1.5 1.5 0 0 1 4 18.5V15"/>',
    omega: '<path d="M5 19h4v-2.5A6.5 6.5 0 1 1 15 16.5V19h4"/>',
    date: '<rect x="4" y="5.5" width="16" height="14" rx="2"/><path d="M4 10h16M8.5 3.5v4M15.5 3.5v4"/>',
    bookmark: '<path d="M7 4h10v16l-5-4-5 4z"/>',
    contents: '<path d="M5 6h9M5 11h9M5 16h9M17 6h2M17 11h2M17 16h2"/>',
    header: '<rect x="5" y="3.5" width="14" height="17" rx="1.5"/><path d="M8 7h8M8 17h3M14.5 17h1.5"/>',
    comment: '<path d="M5 5.5h14a1 1 0 0 1 1 1V15a1 1 0 0 1-1 1h-9l-4 3.5V16H5a1 1 0 0 1-1-1V6.5a1 1 0 0 1 1-1z"/>',
    block: '<rect x="3.5" y="4.5" width="17" height="15" rx="2"/><path d="m10 10-2 2 2 2M14 10l2 2-2 2"/>',
    callout: '<rect x="4" y="5" width="16" height="14" rx="2"/><path d="M8 9v6M11.5 10h5M11.5 14h4"/>',
    fold: '<path d="m4.5 7 2.5 2.5L9.5 7M13 8h7M8 13h12M8 17h12"/>',
    terms: '<path d="M4 6h9M8 10.5h12M4 14.5h9M8 19h12"/>',
    maths: '<path d="M5 6.5h4M7 4.5v4M14.5 6.5H19M5 16l4 4M9 16l-4 4M14.5 16.5H19M14.5 19.5H19"/>',
    diagram: '<rect x="9" y="3.5" width="6" height="5" rx="1"/><rect x="3.5" y="15.5" width="6" height="5" rx="1"/><rect x="14.5" y="15.5" width="6" height="5" rx="1"/><path d="M12 8.5V12M6.5 15.5V12h11v3.5"/>',
    component: '<path d="M12 3.5 19.5 8v8L12 20.5 4.5 16V8z"/><path d="M4.5 8 12 12.5 19.5 8M12 12.5v8"/>',
    terminal: '<rect x="3.5" y="5" width="17" height="14" rx="2"/><path d="m7.5 10 2.5 2-2.5 2M12 15h4"/>',
    timeline: '<path d="M6 4v16"/><circle cx="6" cy="8" r="1.5"/><circle cx="6" cy="16" r="1.5"/><path d="M10 8h9M10 16h9"/>',
    play: '<path d="M8 5.5v13l10-6.5z"/>',
    bold: '<path d="M7 5h6a3.5 3.5 0 0 1 0 7H7zM7 12h7a3.5 3.5 0 0 1 0 7H7z"/>',
    italic: '<path d="M10 5h8M6 19h8M14 5l-4 14"/>',
    underline: '<path d="M7 4.5v6a5 5 0 0 0 10 0v-6M5.5 20h13"/>',
    strike: '<path d="M16.5 7.5c-.8-1.8-2.5-2.8-4.5-2.8-2.6 0-4.5 1.5-4.5 3.6 0 4.4 9.5 2.9 9.5 7.6 0 2.2-2 3.6-4.8 3.6-2.2 0-4-1-4.8-2.8M4.5 12h15"/>',
    sup: '<path d="m4 8 8 10M12 8l-8 10M15.5 5.5c0-1 .8-1.5 1.7-1.5s1.6.6 1.6 1.4c0 1.4-3.3 2.2-3.3 4.1H19"/>',
    sub: '<path d="m4 6 8 10M12 6l-8 10M15.5 15.5c0-1 .8-1.5 1.7-1.5s1.6.6 1.6 1.4c0 1.4-3.3 2.2-3.3 4.1H19"/>',
    size: '<path d="M3.5 18 8 6l4.5 12M5 14h6M14 18l3-8 3 8M15 15.5h4"/>',
    capitals: '<path d="M3.5 17 7.5 7l4 10M5 13.5h5M18.5 11v6M18.5 13.2a2.3 2.3 0 1 0 0 1.6"/>',
    font: '<path d="M5 19 11 5h2l6 14M7.5 14h9"/>',
    color: '<path d="M6.5 16 12 4l5.5 12M8.5 12h7"/><path d="M4 20h16" stroke-width="2.6"/>',
    marked: '<rect x="3.5" y="8" width="17" height="8" rx="1.5"/><path d="M7 12h10"/>',
    spoiler: '<path d="M3 12s3.5-6 9-6 9 6 9 6-3.5 6-9 6-9-6-9-6z"/><path d="M4 4l16 16"/>',
    subtext: '<path d="M4 7h16"/><path d="M4 13h10M4 17h7" stroke-width="1.2"/>',
    styles: '<path d="M4 6h10M9 6v12M14 12h6M17 12v6"/>',
    paragraph: '<path d="M11 19V5h7M15 5v14M11 5a4 4 0 0 0 0 8"/>',
    title: '<path d="M5 5.5h14M12 5.5V19"/>',
    subtitle: '<path d="M7 8h10M12 8v10"/>',
    settings: '<path d="M4 7h10M18 7h2M4 17h4M12 17h8"/><circle cx="16" cy="7" r="2"/><circle cx="10" cy="17" r="2"/>',
    continue: '<path d="M4 7h9M4 12h9M4 17h5M17.5 8v9.5M15 15l2.5 2.5L20 15"/>',
    count: '<path d="M4 9h16M4 15h16M10 4 8 20M16 4l-2 16"/>',
    typing: '<path d="M3.5 17 7.5 7l4 10M5 13.5h5M14 12h6M17 9l3 3-3 3"/>',
    forget: '<path d="m14 5 5 5-8.5 8.5H6L4 16.5zM9.5 9.5l5 5M10.5 18.5H20"/>',
    help: '<circle cx="12" cy="12" r="8"/><path d="M9.8 9.5a2.3 2.3 0 1 1 3.2 2.1c-.6.3-1 .8-1 1.5v.4"/><circle cx="12" cy="16.5" r=".6" fill="currentColor"/>',
    keyboard: '<rect x="2.5" y="6" width="19" height="12" rx="2"/><path d="M6 10h.01M10 10h.01M14 10h.01M18 10h.01M7 14h10"/>',
};

// the six heading levels: the heading sign with its number beside it
for (let level = 1; level <= 6; level++) PATHS[`heading${level}`] = `<path d="M4 6v12M12 6v12M4 12h8"/><text x="14.5" y="19" font-size="9" font-weight="700" fill="currentColor" stroke="none" font-family="system-ui, sans-serif">${level}</text>`;

/** One of mdQuire's small line icons, drawn in the color of the text around it. */
export function icon(name: string): SVGSVGElement {
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("viewBox", "0 0 24 24");
    svg.setAttribute("aria-hidden", "true");
    svg.setAttribute("class", "quire-icon");
    svg.innerHTML = PATHS[name] ?? "";
    return svg;
}

/** A letter drawn the way its button's mark looks: B bold, I italic, and so on. */
export function glyph(letter: string, look: string): HTMLElement {
    return make("span", `quire-glyph quire-glyph-${look}`, letter);
}

/** A press: where in the window, and when. */
export interface Press {
    x: number;
    y: number;
    at: number;
}

/**
 * Where something opening now grows from, as a transform-origin inside its own box: the point
 * that was just pressed (within half a second), so that it flows out of what was pressed; or,
 * opened from the keyboard, `otherwise`.
 */
export function originAt(box: Box, press: Press | undefined, now: number, otherwise: string): string {
    if (!press || now - press.at > 500) return otherwise;
    return `${Math.round(press.x - box.left)}px ${Math.round(press.y - box.top)}px`;
}

let lastPress: Press | undefined;
if (typeof document !== "undefined") document.addEventListener("pointerdown", (event) => (lastPress = { x: event.clientX, y: event.clientY, at: performance.now() }), true);

/** Where something opening now in `box` grows from (originAt, with the last press on the page). */
export const originFor = (box: Box, otherwise: string): string => originAt(box, lastPress, performance.now(), otherwise);

/**
 * The controls' tooltips, drawn by mdQuire rather than the browser so that they grow out of the
 * control and go back into it: a small label under the control (above it at the window's foot),
 * tied to it by anchor positioning, after the pointer has rested on it for half a second, or at
 * once while moving along from one that was just shown. The control's `title` is what it says;
 * it is taken off while the label is up so that the browser's own does not show as well. Touch
 * has no resting pointer and no tooltip.
 */
let tipping = false;
function tips() {
    if (tipping || typeof document === "undefined") return;
    tipping = true;
    const tip = make("div", "quire-tip");
    tip.popover = "manual";
    tip.setAttribute("aria-hidden", "true");
    let over: HTMLElement | undefined;
    let waiting: ReturnType<typeof setTimeout> | undefined;
    let shownAt = 0;
    const hide = () => {
        clearTimeout(waiting);
        if (over) {
            if (over.dataset.tip !== undefined) over.title = over.dataset.tip;
            delete over.dataset.tip;
            over.style.removeProperty("anchor-name");
            over = undefined;
        }
        if (!tip.matches(":popover-open")) return;
        shownAt = performance.now();
        if (still()) return tip.hidePopover();
        const gone = () => tip.matches(":popover-open") && !over && tip.hidePopover();
        tip.animate([{ opacity: 1, scale: 1 }, { opacity: 0, scale: 0.7 }], { duration: 110, easing: EASE, fill: "forwards" }).finished.then(gone, gone);
    };
    /** Shows the label of the control under the pointer: after a rest, at once when moving along from one just shown, and at once when `now` (a control that has just opened under a pointer that did not move). */
    const point = (target: EventTarget | null, now: boolean) => {
        // one whose label is up has lent its title to it (data-tip), and is still the same control
        const found = (target as Element | null)?.closest?.<HTMLElement>(":is(.quire-button, .quire-size-field, .quire-status):is([title], [data-tip])");
        if (found === over) return;
        hide();
        if (!found || !found.title || found.classList.contains("open")) return;
        over = found;
        found.dataset.tip = found.title;
        found.removeAttribute("title");
        // moving along a row of controls, the next one's label comes at once
        const warm = now || performance.now() - shownAt < 400;
        waiting = setTimeout(() => {
            if (over !== found || !found.isConnected) return;
            tip.textContent = found.dataset.tip ?? "";
            if (!tip.isConnected) document.body.append(tip);
            found.style.setProperty("anchor-name", "--quire-tip");
            for (const each of tip.getAnimations()) each.cancel();
            tip.showPopover();
            const up = tip.getBoundingClientRect().top < found.getBoundingClientRect().top;
            if (!still()) tip.animate([{ opacity: 0, scale: 0.7, transformOrigin: up ? "50% 100%" : "50% 0" }, { opacity: 1, scale: 1, transformOrigin: up ? "50% 100%" : "50% 0" }], { duration: 180, easing: springCurve(MOTION.bounce) });
        }, warm ? 60 : 500);
    };
    document.addEventListener("pointerover", (event) => event.pointerType !== "touch" && point(event.target, false));
    // a control that opened under a resting pointer asks for its label itself, since no pointer moved onto it (tipNow)
    document.addEventListener("quire-tip", (event) => point(event.target, true));
    for (const name of ["pointerdown", "scroll", "keydown"]) addEventListener(name, hide, { capture: true, passive: true });
    // the pointer leaving the window, or the window going out of sight, takes the label away too, and gives the control its title back
    document.addEventListener("pointerout", (event) => !event.relatedTarget && hide());
    document.addEventListener("visibilitychange", hide);
}

/** Shows a control's tooltip at once, for one that has just opened under a pointer already resting there. */
export const tipNow = (control: HTMLElement) => void control.dispatchEvent(new Event("quire-tip", { bubbles: true }));

/** A button with a label for screen readers (shown as its tooltip too) that leaves the document's selection where it is when pressed. */
export function control(label: string, content: string | Node, press: (button: HTMLButtonElement) => void, className = "quire-button"): HTMLButtonElement {
    tips();
    const button = make("button", className);
    button.type = "button";
    button.setAttribute("aria-label", label);
    button.title = label;
    if (typeof content === "string") button.append(make("span", "quire-glyph", content));
    else button.append(content);
    // pressing a control must not take the selection out of the text it is about to change
    button.addEventListener("mousedown", (event) => event.preventDefault());
    button.addEventListener("click", () => press(button));
    return button;
}

/** Three dots that run together into a cross while their menu is open, as the viewer's do. */
export function dots(label: string): HTMLButtonElement {
    tips();
    const button = make("button", "quire-button quire-dots");
    button.type = "button";
    button.setAttribute("aria-label", label);
    button.title = label;
    button.append(make("i"), make("i"), make("i"));
    button.addEventListener("mousedown", (event) => event.preventDefault());
    return button;
}

/** Where focus goes in a row of `count` controls when a key is pressed at `index`, or undefined if the key does not move it. */
export function moveIndex(index: number, key: string, count: number, vertical = false): number | undefined {
    if (count === 0) return undefined;
    const next = vertical ? "ArrowDown" : "ArrowRight";
    const back = vertical ? "ArrowUp" : "ArrowLeft";
    if (key === next) return (index + 1) % count;
    if (key === back) return (index - 1 + count) % count;
    if (key === "Home") return 0;
    if (key === "End") return count - 1;
    return undefined;
}

/** The line a typed letter goes to in a menu: the next one after `index` whose words start with what has been typed, round again from the top. */
export function typeAhead(labels: string[], index: number, typed: string): number | undefined {
    const wanted = typed.toLowerCase();
    if (!wanted) return undefined;
    // a letter typed again steps through the lines that start with it
    const start = wanted.length === 1 ? index + 1 : index;
    for (let step = 0; step < labels.length; step++) {
        const at = (((start + step) % labels.length) + labels.length) % labels.length;
        if (labels[at]!.trim().toLowerCase().startsWith(wanted)) return at;
    }
    return undefined;
}

/** A box on screen. */
export interface Box {
    left: number;
    top: number;
    width: number;
    height: number;
}

/**
 * Where a floating thing of `size` goes beside `target` so that it stays inside the window and does
 * not cover the target: on the side asked for if there is room, else on the other, centred on the
 * target and slid along to keep `margin` from the window's edges.
 */
export function placeNear(target: Box, size: { width: number; height: number }, window: { width: number; height: number }, side: "above" | "below" = "above", gap = 8, margin = 8): { left: number; top: number; side: "above" | "below" } {
    const roomAbove = target.top - gap - margin >= size.height;
    const roomBelow = window.height - (target.top + target.height) - gap - margin >= size.height;
    const chosen = side === "above" ? (roomAbove || !roomBelow ? "above" : "below") : roomBelow || !roomAbove ? "below" : "above";
    const top = chosen === "above" ? target.top - gap - size.height : target.top + target.height + gap;
    const centre = target.left + target.width / 2 - size.width / 2;
    const left = Math.min(Math.max(margin, centre), Math.max(margin, window.width - margin - size.width));
    return { left: Math.round(left), top: Math.round(top), side: chosen };
}

/**
 * Whether a key belongs to an input method's composition: the Enter that picks a word in Chinese,
 * Japanese or Korean, or the Escape that gives it up, is the input method's and not the field's.
 * Safari ends the composition before that key arrives, so it is known there by its key code, 229.
 */
export function composing(event: KeyboardEvent): boolean {
    return event.isComposing || event.keyCode === 229;
}

/** A field for a link's address, with a button to set it and, for a link already there, one to take it off. Enter sets, Escape cancels. */
export function linkForm(current: string | undefined, done: { set(href: string): void; remove(): void; cancel(): void }, places: { label: string; href: string; kind: string }[] = []): HTMLElement {
    const form = fieldForm({ value: current, label: "Link address", placeholder: "Paste or type an address", type: "url", button: "Set", said: "Set the link" }, { set: (href) => (href ? done.set(href) : current ? done.remove() : done.cancel()), cancel: done.cancel });
    if (current) form.append(control("Remove the link", icon("trash"), () => done.remove()));
    if (!places.length) return form;
    // the document's own headings and bookmarks, to link to by their names
    const list = make("div", "quire-link-places");
    list.setAttribute("role", "group");
    list.setAttribute("aria-label", "In this document");
    list.append(make("p", "quire-link-places-head", "In this document"));
    for (const place of places) {
        const line = control(`Link to ${place.label}`, make("span", "quire-menu-label", place.label), () => done.set(place.href), "quire-menu-line");
        line.append(make("span", "quire-menu-hint", place.kind === "bookmark" ? "Bookmark" : "Heading"));
        list.append(line);
    }
    const whole = make("div", "quire-link-whole");
    whole.append(form, list);
    return whole;
}

/** A field and its button, for a menu to hold: Enter or the button gives what was typed, trimmed, and Escape cancels, or with nothing to cancel is left to the menu holding it, which steps back. */
export function fieldForm(options: { value?: string; label: string; placeholder?: string; type?: string; button: string; said?: string }, done: { set(value: string): void; cancel?(): void }): HTMLElement {
    const form = make("div", "quire-link");
    const field = make("input", "quire-link-field");
    field.type = options.type ?? "text";
    field.value = options.value ?? "";
    field.placeholder = options.placeholder ?? "";
    field.setAttribute("aria-label", options.label);
    field.spellcheck = false;
    const set = () => done.set(field.value.trim());
    field.addEventListener("keydown", (event) => {
        if (event.key === "Escape" && !done.cancel && !composing(event)) return;
        event.stopPropagation();
        if (composing(event)) return;
        if (event.key === "Enter") {
            event.preventDefault();
            set();
        } else if (event.key === "Escape") {
            event.preventDefault();
            done.cancel?.();
        }
    });
    form.append(field, control(options.said ?? options.button, options.button, set, "quire-button quire-link-set"));
    return form;
}

/** "About mdQuire": what it is and who made it, in the project page's own words, with the way to her site and to the project, for its dialog to hold (the dialog's title is the name). */
export function aboutPanel(): HTMLElement {
    const panel = make("div", "quire-about");
    const said = make("p", "quire-about-text", "A word processor for Markdown files, in the browser. Charlotte made it.");
    const links = make("p", "quire-about-links");
    const link = (href: string, words: string) => {
        const anchor = make("a", "", words);
        anchor.href = href;
        return anchor;
    };
    links.append(link("/", "Her site"), link("/projects/mdquire/", "The project"));
    panel.append(said, links);
    return panel;
}

/** A line of a menu: what it says, an icon or a sample of what it makes, and what it does. */
export interface MenuItem {
    label: string;
    icon?: string | Node;
    hint?: string;
    pressed?: boolean;
    /** A line that tells something and does nothing, such as the word count. */
    note?: boolean;
    /** A choice among the lines of the same group: pressing it leaves the menu open, pressed in place of the one that was. */
    group?: string;
    /** Pressing it leaves the menu open, as More in the slash menu does. */
    stays?: boolean;
    /** Drawn quieter than the lines around it. */
    quiet?: boolean;
    /** Can do nothing where the cursor is now: shown dimmed, passed over by the arrow keys, and not pressed. */
    disabled?: boolean;
    /** The command the line runs, by its name in the menus' table (menu-row.ts), for the command palette to count and to rank by where the cursor is. */
    key?: string;
    /** The lines of the menu it opens beside itself. */
    items?: () => MenuItem[];
    /** Or a small form it opens beside itself, as a field to fill in. */
    form?: () => HTMLElement;
    /** Not a line but the rule between two groups of lines. */
    rule?: boolean;
    /** Other names it is found by in the command palette: what it was called before, or what a writer may call it. */
    words?: string[];
    run: () => void;
}

/** The rule drawn between two groups of a menu's lines. */
export const RULE: MenuItem = { label: "", rule: true, run: () => {} };

/** Groups of lines with a rule between each two, leaving out the groups that are empty. */
export function ruled(...groups: MenuItem[][]): MenuItem[] {
    return groups.filter((group) => group.length).flatMap((group, index) => (index ? [RULE, ...group] : group));
}

/** Every line that does something, with the lines of each menu inside opened out, and the names of the menus each is inside. */
export function everyLine(items: MenuItem[], within: string[] = []): { item: MenuItem; within: string[] }[] {
    return items.flatMap((item) => (item.rule || item.note ? [] : item.items ? everyLine(item.items(), [...within, item.label]) : [{ item, within }]));
}

/** How a menu moves, the lab's starting values, which she kept: it opens in 200 ms on a slight spring and closes in 140 ms on the site's easing, its lines arriving 14 ms apart. */
export const MOTION = { open: 200, close: 140, stagger: 14, bounce: 0.14 };

/** The site's own easing, --ease in tokens.css. */
export const EASE = "cubic-bezier(0.22, 1, 0.36, 1)";

/** A spring that settles within its time, as a CSS linear() curve: no bounce at 0, a drop's bounce near 0.3. */
export function springCurve(bounce: number, points = 48): string {
    const damping = Math.max(0.25, 1 - bounce);
    const values: string[] = [];
    for (let step = 0; step <= points; step++) {
        const t = step / points;
        let x: number;
        if (damping >= 0.999) {
            const w = 9.23;
            x = 1 - (1 + w * t) * Math.exp(-w * t);
        } else {
            const w = 6.9 / damping;
            const wd = w * Math.sqrt(1 - damping * damping);
            x = 1 - Math.exp(-damping * w * t) * (Math.cos(wd * t) + ((damping * w) / wd) * Math.sin(wd * t));
        }
        values.push((step === points ? 1 : x).toFixed(4));
    }
    return `linear(${values.join(", ")})`;
}

/** True on a Mac, where Ctrl in a shortcut is pressed as Command. */
export const mac = () => typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);

/**
 * A shortcut as it is shown: on Linux and Windows written as words, as Docs writes it there
 * ("Ctrl+Shift+Z"), and on a Mac as the keys' symbols ("⌘⇧Z"), with the same said in words for a
 * screen reader. A hint that is not a shortcut (".md", "›") is given back as it is, with no words.
 */
export function keySymbols(hint: string, onMac = false): { shown: string; words: string } {
    const parts = hint.split("+");
    const named: Record<string, [string, string]> = {
        Ctrl: onMac ? ["⌘", "Command"] : ["⌃", "Control"],
        Cmd: ["⌘", "Command"],
        Shift: ["⇧", "Shift"],
        Alt: onMac ? ["⌥", "Option"] : ["⌥", "Alt"],
        Enter: ["↵", "Enter"],
        Tab: ["⇥", "Tab"],
        Backspace: ["⌫", "Backspace"],
        Delete: ["⌦", "Delete"],
    };
    // signs are drawn as themselves and said by name
    const signs: Record<string, string> = { ".": "Full stop", ",": "Comma", "/": "Slash", "\\": "Backslash", "[": "Left bracket", "]": "Right bracket", "=": "Equals", "-": "Minus" };
    const isKey = (part: string, last: boolean) => (last ? part in named || part in signs || /^[A-Z0-9]$/i.test(part) : part in named);
    if (parts.length < 2 && !(hint in named)) return { shown: hint, words: "" };
    if (!parts.every((part, index) => isKey(part, index === parts.length - 1))) return { shown: hint, words: "" };
    const words = parts.map((part) => named[part]?.[1] ?? signs[part] ?? part.toUpperCase()).join(" ");
    return { shown: onMac ? parts.map((part) => named[part]?.[0] ?? part.toUpperCase()).join("") : hint, words };
}

/**
 * A line of a menu drawn as a button: its icon, its words, and its shortcut (as words, or a Mac's
 * symbols), said in words when pointed at and to a screen reader. A line that can be on has a tick
 * in its icon's place while it is on, never a colour alone; a line that opens a menu beside it ends
 * in an arrow. What pressing it does is the caller's.
 */
export function menuLine(item: MenuItem, apple = mac()): HTMLButtonElement {
    const line = make("button", "quire-menu-line");
    line.type = "button";
    // a line that is on or off is said to be so: one of a group is a radio, one alone a checkbox
    line.setAttribute("role", item.pressed === undefined ? "menuitem" : item.group ? "menuitemradio" : "menuitemcheckbox");
    if (item.pressed !== undefined) line.setAttribute("aria-checked", String(item.pressed));
    if (item.pressed) line.classList.add("pressed");
    if (item.quiet) line.classList.add("quiet");
    if (item.disabled) line.disabled = true;
    if (item.group) line.dataset.group = item.group;
    const own = item.icon ? (typeof item.icon === "string" ? icon(item.icon) : item.icon) : undefined;
    if (item.pressed !== undefined) {
        const mark = make("span", "quire-menu-mark");
        const tick = icon("tick");
        tick.classList.add("quire-tick");
        mark.append(tick, ...(own ? [own] : []));
        line.append(mark);
    } else if (own) line.append(own);
    line.append(make("span", "quire-menu-label", item.label));
    if (item.items || item.form) {
        line.setAttribute("aria-haspopup", "menu");
        line.setAttribute("aria-expanded", "false");
        const arrow = icon("next");
        arrow.classList.add("quire-menu-more");
        line.append(arrow);
    }
    if (item.hint) {
        const { shown, words } = keySymbols(item.hint, apple);
        const hint = make("span", "quire-menu-hint", shown);
        if (words) {
            hint.title = words;
            hint.setAttribute("aria-label", words);
        }
        line.append(hint);
    }
    return line;
}

/** A menu that grows out from under the control that opened it. */
export interface Menu {
    box: HTMLElement;
    open(trigger: HTMLElement, items: MenuItem[] | HTMLElement, focusFirst?: boolean): void;
    /** Fills the open menu with more lines than it had, the last line it had (the one that asked for more) giving way: the box grows to hold them, the lines before staying still and the new ones arriving one after another. */
    more(items: MenuItem[]): void;
    close(returnFocus?: boolean): void;
    isOpen(): boolean;
    /** Opens the menu beside the line of this name, the keyboard in it, and gives it; undefined when there is no such line. */
    sub(label: string): Menu | undefined;
    /** Closes this menu and every menu it was opened from. */
    closeAll(): void;
}

let optionCount = 0;

/**
 * Marks the active line of a list the arrow keys move through while the focus stays in the text
 * (the slash menu, the emoji list): drawn lit, and said by a screen reader, the list being a listbox
 * and the text pointing at its active option with aria-activedescendant.
 */
export function markActive(menu: Menu, owner: HTMLElement, active: number) {
    const items = menu.box.querySelector<HTMLElement>(".quire-menu-items");
    if (items) {
        items.setAttribute("role", "listbox");
        items.id ||= `quire-options-${++optionCount}`;
        owner.setAttribute("aria-controls", items.id);
    }
    menu.box.querySelectorAll<HTMLElement>(".quire-menu-line").forEach((line, index) => {
        line.id ||= `quire-option-${++optionCount}`;
        line.setAttribute("role", "option");
        line.classList.toggle("active", index === active);
        line.setAttribute("aria-selected", String(index === active));
        if (index === active) owner.setAttribute("aria-activedescendant", line.id);
    });
}

/** Takes away what markActive told the text, once its list is closed. */
export function unmarkActive(owner: HTMLElement) {
    owner.removeAttribute("aria-activedescendant");
    owner.removeAttribute("aria-controls");
}

/** Closes every open menu but one and those it was opened from, which hold it. */
export function closeOthers(keep?: Menu) {
    for (const open of document.querySelectorAll<HTMLElement>(".quire-menu:popover-open")) if (!keep || !open.contains(keep.box)) open.hidePopover();
}

/** Every motion of a menu stopped, keeping where it was drawn. */
const halt = (animations: Animation[]) => {
    for (const each of animations) each.cancel();
    animations.length = 0;
};

/**
 * A press on the control whose menu is open must not count as a press outside it, which would close
 * the menu only for the press to open it again. The browser leaves a press on a popover's own button
 * alone, so the control is made that button while its menu is open; the button's own opening and
 * closing is held back here, as each control says itself what its press does.
 */
let held = false;
function holdButtons() {
    if (held || typeof document === "undefined") return;
    held = true;
    const hold = (event: Event) => {
        const button = (event.target as Element | null)?.closest?.("button");
        if (button?.popoverTargetElement?.classList.contains("quire-menu")) event.preventDefault();
    };
    // looked at first, for a menu already open, and last, for one the press itself has just opened
    document.addEventListener("click", hold, true);
    addEventListener("click", hold);
}

let menus = 0;

/**
 * Makes a menu, the one kind every menu in mdQuire is, as the lab chose it: it drops below the
 * control pressed and covers nothing, the control staying in its row, lit. The browser does the
 * keeping: the menu is a popover, so it is drawn over everything, a press outside it or Escape
 * closes it, and opening one closes the others; and it is tied to its control by CSS anchor
 * positioning, which puts it under the control (or to the left where there is no room; above or
 * below is chosen here) and keeps it there as the page scrolls. What the browser does not do is the motion: the box grows
 * out of the control's bottom edge, as wide as the control at first, to the menu's size, its corner
 * held on the control so that what is inside stays still while the edges pass over it. It opens in
 * 200 ms on a slight spring, its lines arriving one after another, and closes back onto the
 * control's edge in 140 ms on the site's easing. Opened from another control while open (the menu
 * words, as the pointer moves along them), it slides across and becomes that one's menu. Under
 * reduced motion it is simply open or shut. Its look is the lab's "raised" (quire.css).
 *
 * A line with an arrow opens a menu of its own beside it, made the same way (`parent` is the menu
 * it is in): it grows sideways out of the line, to the right where there is room, else to the left,
 * else under the line on a phone. The pointer resting on such a line opens it, and Right or Enter
 * does too, the keyboard going in; Left or Escape closes it and gives the keyboard back to its line.
 * Choosing a line closes every menu up to the first. A menu too tall for its room scrolls, and fades
 * at the edge where there is more.
 */
export function flowMenu(label: string, options: { align?: "left" | "right"; className?: string; onClose?: () => void; onSide?: (by: -1 | 1) => void; parent?: Menu } = {}): Menu {
    holdButtons();
    const name = `--quire-menu-${++menus}`;
    const box = make("div", `quire-menu ${options.className ?? ""}`.trim());
    box.popover = "auto";
    box.style.setProperty("position-anchor", name);
    const items = make("div", "quire-menu-items");
    // the menu itself can hold the keyboard before any line does, as a menu opened by a press does
    items.tabIndex = -1;
    box.append(items);
    box.setAttribute("aria-label", label);
    items.inert = true;
    const nested = !!options.parent;
    /** The menu beside one of its lines, the line it is open from, and the pointer's wait before it opens or closes. */
    let child: Menu | undefined;
    let childFrom: HTMLElement | undefined;
    let resting: ReturnType<typeof setTimeout> | undefined;
    const subs = new Map<HTMLElement, MenuItem>();
    let trigger: HTMLElement | undefined;
    /** Where the keyboard was when the menu opened, if not on its control: a shortcut typed in the text opens a menu, and closing it goes back there. */
    let came: HTMLElement | undefined;
    let opened = false;
    let giveFocus = false;
    /** The menu's size as it ends, whether it went above its control, and for a menu beside a line, which side of it. */
    let final: (Box & { up: boolean; beside?: "right" | "left" }) | undefined;
    /** The copy of the box that is seen going back into the control after the browser has put the menu away. */
    let leaving: HTMLElement | undefined;
    const moving: Animation[] = [];

    const lines = () => [...items.querySelectorAll<HTMLElement>("button:not(:disabled), input, a[href]")];
    const boxOf = (element: Element): Box => {
        const { left, top, width, height } = element.getBoundingClientRect();
        return { left, top, width, height };
    };
    /** The control's edge the menu grows from and goes back to: a line as wide as the control, at its bottom (or its top, for a menu above it); for a menu beside a line, the line's side, as tall as the line. */
    const edgeOf = (control: Box, up: boolean): Box =>
        final?.beside
            ? { left: final.beside === "right" ? control.left + control.width : control.left, top: control.top, width: 0, height: control.height }
            : { left: control.left, top: up ? control.top - 4 : control.top + control.height + 4, width: control.width, height: 0 };
    const frame = (at: Box) => ({ left: `${at.left}px`, top: `${at.top}px`, width: `${at.width}px`, height: `${at.height}px` });
    /** Ties the menu to a control, or unties it, by the control's anchor name (a control can hold several menus' names). */
    const tie = (control: HTMLElement, on: boolean) => {
        const names = control.style.getPropertyValue("anchor-name").split(",").map((each) => each.trim()).filter((each) => each && each !== name);
        if (on) names.push(name);
        if (names.length) control.style.setProperty("anchor-name", names.join(", "));
        else control.style.removeProperty("anchor-name");
        if (control instanceof HTMLButtonElement) control.popoverTargetElement = on ? box : null;
    };

    /**
     * Lets the browser choose where the menu goes, then holds it there: the side it chose is fixed
     * while the menu is open, so that it does not jump to the other side as it grows or as the page
     * scrolls. The inside keeps its own width, at least the control's.
     */
    function place(): Box & { up: boolean } {
        const control = boxOf(trigger!);
        if (nested) return placeBeside(control);
        items.style.minWidth = "";
        if (control.width > (parseFloat(getComputedStyle(items).minWidth) || 0)) items.style.minWidth = `${control.width}px`;
        // above or below is chosen here, as the browser would take the side with more room even for a menu that fits below:
        // it goes above only when it does not fit below and there is more room above
        const below = innerHeight - control.top - control.height;
        const up = items.scrollHeight + 12 > below && control.top > below;
        const block = up ? "top" : "bottom";
        box.style.setProperty("position-area", `${block} ${options.align === "right" ? "span-left" : "span-right"}`);
        box.style.setProperty("position-try-fallbacks", `flip-inline, ${block}`);
        box.classList.remove("up", "left", "middle");
        const at = boxOf(box);
        const side = Math.abs(at.left - control.left) < 1 ? "span-right" : Math.abs(at.left + at.width - control.left - control.width) < 1 ? "span-left" : "center";
        box.style.setProperty("position-area", side === "center" ? (up ? "top" : "bottom") : `${up ? "top" : "bottom"} ${side}`);
        box.style.setProperty("position-try-fallbacks", "none");
        box.classList.toggle("up", up);
        box.classList.toggle("left", side === "span-left");
        box.classList.toggle("middle", side === "center");
        final = { ...at, up };
        return final;
    }

    /**
     * A menu beside a line: to its right with its top on the line's top, or to its left, or above
     * the line's bottom where it does not fit below; on a window too narrow for either side, under
     * the line. The side is fixed while it is open, as above.
     */
    function placeBeside(line: Box): Box & { up: boolean } {
        const width = boxOf(box).width;
        const tall = items.scrollHeight + 12;
        const beside = width <= innerWidth - line.left - line.width - 8 ? "right" : width <= line.left - 8 ? "left" : undefined;
        const below = innerHeight - (beside ? line.top : line.top + line.height);
        const up = tall > below && (beside ? line.top + line.height : line.top) > below;
        const across = beside ?? (line.left + line.width / 2 > innerWidth / 2 ? "span-left" : "span-right");
        box.style.setProperty("position-area", beside ? `${beside} ${up ? "span-top" : "span-bottom"}` : `${up ? "top" : "bottom"} ${across}`);
        box.style.setProperty("position-try-fallbacks", "none");
        box.classList.toggle("up", up);
        box.classList.toggle("left", beside === "left" || across === "span-left");
        box.classList.remove("middle");
        final = { ...boxOf(box), up, beside };
        return final;
    }

    /** Fades the edge of a menu too tall for its room where there is more to scroll to. */
    const edges = () => {
        items.classList.toggle("more-above", items.scrollTop > 1);
        items.classList.toggle("more-below", items.scrollTop + items.clientHeight < items.scrollHeight - 1);
    };
    items.addEventListener("scroll", edges, { passive: true });

    /** Opens the menu beside a line, from the keyboard with the keyboard in it. */
    function openChild(line: HTMLElement, item: MenuItem, focus: boolean) {
        clearTimeout(resting);
        if (child?.isOpen() && childFrom === line) {
            if (focus) child.box.querySelector<HTMLElement>(".quire-menu-items button:not(:disabled), .quire-menu-items input")?.focus({ preventScroll: true });
            return;
        }
        if (!child) {
            child = flowMenu(item.label, { className: options.className, onSide: options.onSide, parent: menu });
            child.box.classList.add("beside");
            // the pointer reaching the menu beside keeps it open
            child.box.addEventListener("pointerenter", () => clearTimeout(resting));
        }
        // held inside this menu's box, so that the browser counts it as opened from this one and leaves this one open
        if (child.box.parentElement !== box) box.append(child.box);
        childFrom = line;
        child.box.setAttribute("aria-label", item.label);
        const form = item.form?.();
        child.open(line, form ?? item.items?.() ?? [], focus || !!form);
    }

    let typed = "";
    let typedTimer: ReturnType<typeof setTimeout> | undefined;
    function onKey(event: KeyboardEvent) {
        // a key in the menu beside this one is that menu's
        if (!items.contains(event.target as Node)) return;
        const all = lines();
        const at = all.indexOf(document.activeElement as HTMLElement);
        // Escape steps back one menu: the one open beside a line, or this one, to the line it came from
        if (event.key === "Escape" || (nested && event.key === "ArrowLeft" && !(document.activeElement instanceof HTMLInputElement))) {
            event.preventDefault();
            event.stopPropagation();
            if (event.key === "Escape" && child?.isOpen()) {
                child.close(false);
                childFrom?.focus({ preventScroll: true });
            } else menu.close(true);
            return;
        }
        if (event.key === "Tab") {
            menu.closeAll();
            return;
        }
        if (document.activeElement instanceof HTMLInputElement && (event.key === "ArrowLeft" || event.key === "ArrowRight" || event.key === "Home" || event.key === "End")) return;
        // Right on a line with an arrow goes into its menu
        const here = all[at];
        if (here && event.key === "ArrowRight" && subs.has(here)) {
            event.preventDefault();
            openChild(here, subs.get(here)!, true);
            return;
        }
        // a menu in a row of them goes on to its neighbour with the side arrows
        if (options.onSide && (event.key === "ArrowLeft" || event.key === "ArrowRight")) {
            event.preventDefault();
            options.onSide(event.key === "ArrowLeft" ? -1 : 1);
            return;
        }
        // a letter goes to the next line that starts with it; letters typed quickly one after another spell out more of it
        if (event.key.length === 1 && /\S/.test(event.key) && !event.ctrlKey && !event.metaKey && !event.altKey && !(document.activeElement instanceof HTMLInputElement)) {
            clearTimeout(typedTimer);
            typed += event.key;
            typedTimer = setTimeout(() => (typed = ""), 700);
            const found = typeAhead(all.map((line) => line.querySelector(".quire-menu-label")?.textContent ?? line.textContent ?? ""), at, typed);
            if (found !== undefined) {
                event.preventDefault();
                all[found]?.focus();
            }
            return;
        }
        // from the menu itself, before any line has the keyboard, Up goes to the last line
        const next = at < 0 && event.key === "ArrowUp" ? all.length - 1 : moveIndex(at, event.key, all.length, true);
        if (next !== undefined) {
            event.preventDefault();
            all[next]?.focus();
        }
    }
    box.addEventListener("keydown", onKey);
    // however the menu is put away (a press outside, Escape, another menu opening, or close()), it is told here while it is still drawn
    box.addEventListener("beforetoggle", (event) => {
        if (event.target === box && (event as ToggleEvent).newState === "closed") closed();
    });

    /** Fills the menu with its lines, or with an element of its own (a form, the about panel). */
    function fill(content: MenuItem[] | HTMLElement) {
        child?.close(false);
        clearTimeout(resting);
        subs.clear();
        items.replaceChildren();
        items.removeAttribute("role");
        items.removeAttribute("aria-label");
        if (content instanceof HTMLElement) {
            items.append(content);
            return;
        }
        items.setAttribute("role", "menu");
        // the name goes on the element that is the menu, so that it is said with the menu
        items.setAttribute("aria-label", box.getAttribute("aria-label") ?? label);
        const apple = mac();
        content.forEach((item) => {
            if (item.note) {
                items.append(make("p", "quire-menu-note", item.label));
                return;
            }
            if (item.rule) {
                const rule = make("hr", "quire-menu-rule");
                rule.setAttribute("role", "separator");
                items.append(rule);
                return;
            }
            const line = menuLine(item, apple);
            line.addEventListener("mousedown", (event) => event.preventDefault());
            const opens = !!(item.items || item.form);
            if (opens) subs.set(line, item);
            // the pointer moving onto a line opens its menu beside it, or closes the one open beside another, and the keyboard follows it;
            // a menu opening under a pointer that is still takes nothing from the keyboard
            line.addEventListener("pointermove", (event) => {
                const now = document.activeElement;
                if (event.pointerType === "touch" || now === line) return;
                // (while the keyboard is in this menu or one it was opened from, and not typing in a field)
                if (now && (box.contains(now) || now.closest(".quire-menu")?.contains(box)) && !(now instanceof HTMLInputElement)) line.focus({ preventScroll: true });
                clearTimeout(resting);
                if (opens) resting = setTimeout(() => openChild(line, item, false), 120);
                else if (child?.isOpen()) resting = setTimeout(() => child?.close(false), 250);
            });
            line.addEventListener("click", (event) => {
                // a click made by Enter or Space takes the keyboard into the menu beside; one made by a press leaves it on the line
                if (opens) {
                    // pressed, the line holds the keyboard, so that Escape from the menu beside comes back to it
                    if (box.contains(document.activeElement) || document.activeElement?.closest(".quire-menu")?.contains(box)) line.focus({ preventScroll: true });
                    return openChild(line, item, event.detail === 0);
                }
                if (item.group)
                    for (const other of items.querySelectorAll<HTMLElement>(`[data-group="${item.group}"]`)) {
                        other.classList.toggle("pressed", other === line);
                        if (other.hasAttribute("aria-checked")) other.setAttribute("aria-checked", String(other === line));
                    }
                else if (!item.stays) menu.closeAll();
                item.run();
            });
            items.append(line);
        });
    }

    /** The box grows from `from` (the control's edge, or where it was drawn when sliding over from a neighbour) to its own size; its place is the browser's, and only its size and, sliding, its offset move. */
    function grow(from: Box, sliding: boolean) {
        const at = final!;
        requestAnimationFrame(edges);
        if (still()) return;
        const time = MOTION.open;
        const curve = sliding ? EASE : springCurve(MOTION.bounce);
        // the inside is laid out at its full height while the box is smaller, so that the lines stay still
        items.style.height = `${items.offsetHeight}px`;
        items.style.flexShrink = "0";
        moving.push(box.animate([{ width: `${from.width}px`, height: `${from.height}px`, translate: sliding ? `${from.left - at.left}px ${from.top - at.top}px` : "0 0" }, { width: `${at.width}px`, height: `${at.height}px`, translate: "0 0" }], { duration: time, easing: curve, fill: "both" }));
        const shown = [...items.children] as HTMLElement[];
        // sliding to a neighbour's menu, its lines come in together as the box moves across
        if (sliding) moving.push(items.animate([{ opacity: 0 }, { opacity: 1 }], { duration: time * 0.75, easing: EASE, fill: "both" }));
        // each line arrives a moment after the one before, from the control's side
        else
            shown.forEach((line, index) => {
                const order = at.up ? shown.length - 1 - index : index;
                moving.push(line.animate([{ opacity: 0, translate: `0 ${at.up ? 4 : -4}px` }, { opacity: 1, translate: "0 0" }], { duration: Math.max(time * 0.75, 90), delay: time * 0.2 + order * MOTION.stagger, easing: EASE, fill: "both" }));
            });
        // once it has all arrived the motions are let go, and the box is as large as what is in it
        void Promise.all(moving.map((each) => each.finished)).then(
            () => {
                if (!opened) return;
                halt(moving);
                items.style.height = items.style.flexShrink = "";
                edges();
            },
            () => {},
        );
    }

    /** The menu has been put away: the control is let go, and a copy of the box, holding what was inside, draws back onto the control's edge. */
    function closed() {
        if (!opened) return;
        opened = false;
        const was = boxOf(box);
        const scrolled = items.scrollTop;
        const inside = box.contains(document.activeElement);
        halt(moving);
        items.style.height = items.style.flexShrink = "";
        box.classList.remove("open", "sliding");
        items.inert = true;
        const control = trigger;
        if (control) {
            control.setAttribute("aria-expanded", "false");
            control.classList.remove("open");
            if (control instanceof HTMLButtonElement) control.popoverTargetElement = null;
        }
        const returnTo = came?.isConnected ? came : control;
        came = undefined;
        if (returnTo?.isConnected && (giveFocus || inside)) returnTo.focus({ preventScroll: true });
        giveFocus = false;
        options.onClose?.();
        const at = final;
        // a menu beside a line keeps none of its lines once it is put away, so that none is found inside the menu that holds it
        const empty = () => nested && items.replaceChildren();
        if (!control?.isConnected || !at || still() || !was.width) return empty();
        leaving?.remove();
        const copy = box.cloneNode(false) as HTMLElement;
        copy.removeAttribute("popover");
        copy.removeAttribute("aria-label");
        copy.classList.add("closing");
        copy.inert = true;
        copy.append(items);
        document.body.append(copy);
        items.scrollTop = scrolled;
        leaving = copy;
        const back = edgeOf(boxOf(control), at.up);
        const shrink = copy.animate([frame(was), frame(back)], { duration: MOTION.close, easing: EASE, fill: "both" });
        items.animate([{ opacity: 1 }, { opacity: 0 }], { duration: MOTION.close, easing: EASE, fill: "both" });
        const gone = () => {
            if (leaving !== copy) return;
            for (const each of items.getAnimations()) each.cancel();
            box.prepend(items);
            copy.remove();
            leaving = undefined;
            empty();
        };
        void shrink.finished.then(gone, gone);
    }

    const menu: Menu = {
        box,
        open(from, content, focusFirst = false) {
            if (!box.isConnected) document.body.append(box);
            closeOthers(menu);
            // the copy still going back into its control gives back what it holds
            if (leaving) {
                leaving.remove();
                leaving = undefined;
                for (const each of items.getAnimations()) each.cancel();
                box.prepend(items);
            }
            // opened from another control while open, it slides across from where it is drawn now
            const sliding = opened && !!trigger && trigger !== from && !still();
            // filled again from the same control while open (a switch turned, a line asking again), it stays where it is
            const again = opened && trigger === from;
            const was = boxOf(box);
            halt(moving);
            items.style.height = items.style.flexShrink = "";
            if (trigger && trigger !== from) {
                trigger.setAttribute("aria-expanded", "false");
                trigger.classList.remove("open");
                tie(trigger, false);
            }
            trigger = from;
            tie(from, true);
            fill(content);
            box.classList.add("open");
            box.classList.toggle("sliding", sliding);
            if (!opened) {
                const now = document.activeElement;
                // a menu beside a line always gives the keyboard back to its line
                came = !nested && now instanceof HTMLElement && now !== from && now !== document.body && !box.contains(now) ? now : undefined;
                opened = true;
                box.showPopover();
            }
            const at = place();
            if (!again) grow(sliding ? was : edgeOf(boxOf(from), at.up), sliding);
            items.inert = false;
            from.setAttribute("aria-expanded", "true");
            from.classList.add("open");
            if (focusFirst) lines()[0]?.focus({ preventScroll: true });
        },
        more(content) {
            if (!opened || !final) return;
            const was = boxOf(box);
            const kept = items.children.length - 1;
            halt(moving);
            items.style.height = items.style.flexShrink = "";
            fill(content);
            // it grows on the side it opened on, from the size it was
            const at = boxOf(box);
            final = { ...at, up: final.up };
            if (still()) return;
            items.style.height = `${items.offsetHeight}px`;
            items.style.flexShrink = "0";
            moving.push(box.animate([{ width: `${was.width}px`, height: `${was.height}px` }, { width: `${at.width}px`, height: `${at.height}px` }], { duration: MOTION.open, easing: springCurve(MOTION.bounce), fill: "both" }));
            [...items.children].slice(kept).forEach((line, index) => moving.push(line.animate([{ opacity: 0, translate: `0 ${final!.up ? 4 : -4}px` }, { opacity: 1, translate: "0 0" }], { duration: Math.max(MOTION.open * 0.75, 90), delay: MOTION.open * 0.2 + index * MOTION.stagger, easing: EASE, fill: "both" })));
            void Promise.all(moving.map((each) => each.finished)).then(
                () => {
                    if (!opened) return;
                    halt(moving);
                    items.style.height = items.style.flexShrink = "";
                },
                () => {},
            );
        },
        close(returnFocus = false) {
            if (!opened) return;
            giveFocus = returnFocus;
            if (box.matches(":popover-open")) box.hidePopover();
            else closed();
        },
        isOpen: () => opened,
        sub(wanted) {
            const found = [...subs].find(([, item]) => item.label === wanted);
            if (!found) return undefined;
            openChild(found[0], found[1], true);
            return child;
        },
        closeAll: () => (options.parent ? options.parent.closeAll() : menu.close(false)),
    };
    return menu;
}
