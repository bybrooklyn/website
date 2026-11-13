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
};

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
    document.addEventListener("pointerover", (event) => {
        if (event.pointerType === "touch") return;
        const found = (event.target as Element | null)?.closest?.<HTMLElement>(".quire-button[title], .quire-size-field[title], .quire-status[title]");
        if (found === over) return;
        hide();
        if (!found || !found.title || found.classList.contains("open")) return;
        over = found;
        found.dataset.tip = found.title;
        found.removeAttribute("title");
        // moving along a row of controls, the next one's label comes at once
        const warm = performance.now() - shownAt < 400;
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
    });
    for (const name of ["pointerdown", "scroll", "keydown"]) addEventListener(name, hide, { capture: true, passive: true });
    // the pointer leaving the window, or the window going out of sight, takes the label away too, and gives the control its title back
    document.addEventListener("pointerout", (event) => !event.relatedTarget && hide());
    document.addEventListener("visibilitychange", hide);
}

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
export function linkForm(current: string | undefined, done: { set(href: string): void; remove(): void; cancel(): void }): HTMLElement {
    const form = make("div", "quire-link");
    const field = make("input", "quire-link-field");
    field.type = "url";
    field.value = current ?? "";
    field.placeholder = "Paste or type an address";
    field.setAttribute("aria-label", "Link address");
    field.spellcheck = false;
    const set = () => (field.value.trim() ? done.set(field.value.trim()) : current ? done.remove() : done.cancel());
    field.addEventListener("keydown", (event) => {
        event.stopPropagation();
        if (composing(event)) return;
        if (event.key === "Enter") {
            event.preventDefault();
            set();
        } else if (event.key === "Escape") {
            event.preventDefault();
            done.cancel();
        }
    });
    form.append(field, control("Set the link", "Set", set, "quire-button quire-link-set"));
    if (current) form.append(control("Remove the link", icon("trash"), () => done.remove()));
    return form;
}

/** "About mdQuire": what it is and who made it, in the project page's own words, with the way to her site and to the project, for a menu to hold. */
export function aboutPanel(): HTMLElement {
    const panel = make("div", "quire-about");
    const name = make("p", "quire-about-name", "mdQuire");
    const said = make("p", "quire-about-text", "A word processor for Markdown files, in the browser. Charlotte made it.");
    const links = make("p", "quire-about-links");
    const link = (href: string, words: string) => {
        const anchor = make("a", "", words);
        anchor.href = href;
        return anchor;
    };
    links.append(link("/", "Her site"), link("/projects/mdquire/", "The project"));
    panel.append(name, said, links);
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
    run: () => void;
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
const mac = () => typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);

/**
 * A shortcut written as words ("Ctrl+Shift+Z") drawn as the keys' symbols ("⌃⇧Z", or "⌘⇧Z" on a
 * Mac), with the same said in words for its tooltip. A hint that is not a shortcut (".md", "›") is
 * given back as it is, with no words.
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
    };
    // signs are drawn as themselves and said by name
    const signs: Record<string, string> = { ".": "Full stop", ",": "Comma", "/": "Slash", "\\": "Backslash", "[": "Left bracket", "]": "Right bracket", "=": "Equals", "-": "Minus" };
    const isKey = (part: string, last: boolean) => (last ? part in named || part in signs || /^[A-Z0-9]$/i.test(part) : part in named);
    if (parts.length < 2 && !(hint in named)) return { shown: hint, words: "" };
    if (!parts.every((part, index) => isKey(part, index === parts.length - 1))) return { shown: hint, words: "" };
    return { shown: parts.map((part) => named[part]?.[0] ?? part.toUpperCase()).join(""), words: parts.map((part) => named[part]?.[1] ?? signs[part] ?? part.toUpperCase()).join(" ") };
}

/** A menu that grows out from under the control that opened it. */
export interface Menu {
    box: HTMLElement;
    open(trigger: HTMLElement, items: MenuItem[] | HTMLElement, focusFirst?: boolean): void;
    close(returnFocus?: boolean): void;
    isOpen(): boolean;
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

/** Closes every open menu but one. */
export function closeOthers(keep?: Menu) {
    for (const open of document.querySelectorAll<HTMLElement>(".quire-menu:popover-open")) if (open !== keep?.box) open.hidePopover();
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
 */
export function flowMenu(label: string, options: { align?: "left" | "right"; className?: string; onClose?: () => void; onSide?: (by: -1 | 1) => void } = {}): Menu {
    holdButtons();
    const name = `--quire-menu-${++menus}`;
    const box = make("div", `quire-menu ${options.className ?? ""}`.trim());
    box.popover = "auto";
    box.style.setProperty("position-anchor", name);
    const items = make("div", "quire-menu-items");
    box.append(items);
    box.setAttribute("aria-label", label);
    items.inert = true;
    let trigger: HTMLElement | undefined;
    /** Where the keyboard was when the menu opened, if not on its control: a shortcut typed in the text opens a menu, and closing it goes back there. */
    let came: HTMLElement | undefined;
    let opened = false;
    let giveFocus = false;
    /** The menu's size as it ends, and whether it went above its control. */
    let final: (Box & { up: boolean }) | undefined;
    /** The copy of the box that is seen going back into the control after the browser has put the menu away. */
    let leaving: HTMLElement | undefined;
    const moving: Animation[] = [];

    const lines = () => [...items.querySelectorAll<HTMLElement>("button, input, a[href]")];
    const boxOf = (element: Element): Box => {
        const { left, top, width, height } = element.getBoundingClientRect();
        return { left, top, width, height };
    };
    /** The control's edge the menu grows from and goes back to: a line as wide as the control, at its bottom (or its top, for a menu above it). */
    const edgeOf = (control: Box, up: boolean): Box => ({ left: control.left, top: up ? control.top - 4 : control.top + control.height + 4, width: control.width, height: 0 });
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

    let typed = "";
    let typedTimer: ReturnType<typeof setTimeout> | undefined;
    function onKey(event: KeyboardEvent) {
        const all = lines();
        const at = all.indexOf(document.activeElement as HTMLElement);
        if (event.key === "Escape") {
            event.preventDefault();
            event.stopPropagation();
            menu.close(true);
            return;
        }
        if (event.key === "Tab") {
            menu.close(false);
            return;
        }
        if (document.activeElement instanceof HTMLInputElement && (event.key === "ArrowLeft" || event.key === "ArrowRight" || event.key === "Home" || event.key === "End")) return;
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
        const next = moveIndex(at, event.key, all.length, true);
        if (next !== undefined) {
            event.preventDefault();
            all[next]?.focus();
        }
    }
    box.addEventListener("keydown", onKey);
    // however the menu is put away (a press outside, Escape, another menu opening, or close()), it is told here while it is still drawn
    box.addEventListener("beforetoggle", (event) => {
        if ((event as ToggleEvent).newState === "closed") closed();
    });

    /** Fills the menu with its lines, or with an element of its own (a form, the about panel). */
    function fill(content: MenuItem[] | HTMLElement) {
        items.replaceChildren();
        items.removeAttribute("role");
        items.removeAttribute("aria-label");
        if (content instanceof HTMLElement) {
            items.append(content);
            return;
        }
        items.setAttribute("role", "menu");
        // the name goes on the element that is the menu, so that it is said with the menu
        items.setAttribute("aria-label", label);
        const apple = mac();
        content.forEach((item) => {
            if (item.note) {
                items.append(make("p", "quire-menu-note", item.label));
                return;
            }
            const line = make("button", "quire-menu-line");
            line.type = "button";
            // a line that is on or off is said to be so: one of a group is a radio, one alone a checkbox
            line.setAttribute("role", item.pressed === undefined ? "menuitem" : item.group ? "menuitemradio" : "menuitemcheckbox");
            if (item.pressed !== undefined) line.setAttribute("aria-checked", String(item.pressed));
            if (item.pressed) line.classList.add("pressed");
            if (item.group) line.dataset.group = item.group;
            if (item.icon) line.append(typeof item.icon === "string" ? icon(item.icon) : item.icon);
            line.append(make("span", "quire-menu-label", item.label));
            if (item.hint) {
                // a shortcut is drawn as its keys' symbols, and said in words when pointed at and to a screen reader
                const { shown, words } = keySymbols(item.hint, apple);
                const hint = make("span", "quire-menu-hint", shown);
                if (words) {
                    hint.title = words;
                    hint.setAttribute("aria-label", words);
                }
                line.append(hint);
            }
            line.addEventListener("mousedown", (event) => event.preventDefault());
            line.addEventListener("click", () => {
                if (item.group)
                    for (const other of items.querySelectorAll<HTMLElement>(`[data-group="${item.group}"]`)) {
                        other.classList.toggle("pressed", other === line);
                        if (other.hasAttribute("aria-checked")) other.setAttribute("aria-checked", String(other === line));
                    }
                else menu.close(false);
                item.run();
            });
            items.append(line);
        });
    }

    /** The box grows from `from` (the control's edge, or where it was drawn when sliding over from a neighbour) to its own size; its place is the browser's, and only its size and, sliding, its offset move. */
    function grow(from: Box, sliding: boolean) {
        const at = final!;
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
        if (!control?.isConnected || !at || still() || !was.width) return;
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
            box.append(items);
            copy.remove();
            leaving = undefined;
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
                box.append(items);
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
                came = now instanceof HTMLElement && now !== from && now !== document.body && !box.contains(now) ? now : undefined;
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
        close(returnFocus = false) {
            if (!opened) return;
            giveFocus = returnFocus;
            if (box.matches(":popover-open")) box.hidePopover();
            else closed();
        },
        isOpen: () => opened,
    };
    return menu;
}
