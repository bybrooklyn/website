// The pieces mdQuire's controls are made of: buttons with their icons, the keys that move along a
// toolbar, where a floating thing goes so that it stays in the window, and the menu that flows out
// of the control that was pressed, as the picture viewer's does (src/styles/viewer.css): from the
// control's own size it grows to the menu's, a little past and back, each line arriving a moment
// after the one above; closing, it draws back in plainly. Nothing here simply appears.
//
// The functions that only count (moveIndex, placeNear) are pure and tested. Their styles are in
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
    close: '<path d="m7 7 10 10M17 7 7 17"/>',
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

/** A button with a label for screen readers (shown as its tooltip too) that leaves the document's selection where it is when pressed. */
export function control(label: string, content: string | Node, press: (button: HTMLButtonElement) => void, className = "quire-button"): HTMLButtonElement {
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

/** A line of a menu: what it says, an icon or a sample of what it makes, and what it does. */
export interface MenuItem {
    label: string;
    icon?: string | Node;
    hint?: string;
    pressed?: boolean;
    /** A line that tells something and does nothing, such as the word count. */
    note?: boolean;
    run: () => void;
}

/** A menu that flows out of the control that opened it. */
export interface Menu {
    box: HTMLElement;
    open(trigger: HTMLElement, items: MenuItem[] | HTMLElement, focusFirst?: boolean): void;
    close(returnFocus?: boolean): void;
    isOpen(): boolean;
    /** Puts the menu again where its control is, as the page scrolls. */
    follow(): void;
}

const openMenus = new Set<Menu>();

/** Closes every open menu but one. */
export function closeOthers(keep?: Menu) {
    for (const menu of openMenus) if (menu !== keep) menu.close(false);
}

/**
 * Makes a menu. It is one box, fixed to the window: it starts at the size of the control pressed,
 * just under it, and its width and height ease out to the size of what is in it.
 */
export function flowMenu(label: string, options: { align?: "left" | "right"; className?: string; onClose?: () => void } = {}): Menu {
    const box = make("div", `quire-menu ${options.className ?? ""}`.trim());
    const items = make("div", "quire-menu-items");
    box.append(items);
    box.setAttribute("aria-label", label);
    items.inert = true;
    let trigger: HTMLElement | undefined;
    let opened = false;

    const lines = () => [...items.querySelectorAll<HTMLElement>("button, input, a[href]")];

    function place() {
        if (!trigger) return;
        const rect = trigger.getBoundingClientRect();
        box.style.setProperty("--from-w", `${rect.width}px`);
        box.style.setProperty("--from-h", `${rect.height}px`);
        items.style.maxHeight = "";
        const wide = items.offsetWidth;
        const natural = items.offsetHeight;
        // it grows from the control's left edge, or its right one when there is no room to the right;
        // and when there is room on neither side it is slid along to stay inside the window
        let right = options.align === "right" || rect.left + wide > window.innerWidth - 8;
        if (right && rect.right - wide < 8) right = false;
        box.style.left = right ? "" : `${Math.max(8, Math.min(rect.left, window.innerWidth - 8 - wide))}px`;
        box.style.right = right ? `${Math.max(8, window.innerWidth - rect.right)}px` : "";
        box.classList.toggle("from-right", right);
        // under the control if it fits, over it if not, and on whichever side has more room if neither
        const roomBelow = window.innerHeight - rect.bottom - 14;
        const roomAbove = rect.top - 14;
        const below = natural <= roomBelow || roomBelow >= Math.min(natural, 240) || roomBelow >= roomAbove;
        // a menu taller than its room scrolls inside itself
        const high = Math.min(natural, below ? roomBelow : roomAbove);
        if (high < natural) items.style.maxHeight = `${high}px`;
        box.style.setProperty("--wide", `${wide}px`);
        box.style.setProperty("--high", `${high}px`);
        box.style.top = below ? `${rect.bottom + 6}px` : "";
        box.style.bottom = below ? "" : `${window.innerHeight - rect.top + 6}px`;
    }

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
        const next = moveIndex(at, event.key, all.length, true);
        if (next !== undefined) {
            event.preventDefault();
            all[next]?.focus();
        }
    }
    box.addEventListener("keydown", onKey);
    // what is in the menu may grow or shrink while it is open (a message under a form, say): the box follows
    if (typeof ResizeObserver !== "undefined") new ResizeObserver(() => opened && place()).observe(items);

    // a menu opened with the mouse leaves focus in the text, and Escape there must still close it
    function escape(event: KeyboardEvent) {
        if (event.key === "Escape" && opened && !box.contains(document.activeElement)) menu.close(document.activeElement === trigger);
    }

    function outside(event: PointerEvent) {
        if (!opened) return;
        const target = event.target as Node;
        if (box.contains(target) || trigger?.contains(target)) return;
        menu.close(false);
    }

    const menu: Menu = {
        box,
        open(from, content, focusFirst = false) {
            if (!box.isConnected) document.body.append(box);
            closeOthers(menu);
            trigger = from;
            items.replaceChildren();
            if (content instanceof HTMLElement) items.append(content);
            else {
                items.setAttribute("role", "menu");
                content.forEach((item, index) => {
                    if (item.note) {
                        const note = make("p", "quire-menu-note", item.label);
                        note.style.setProperty("--line-at", String(index));
                        items.append(note);
                        return;
                    }
                    const line = make("button", "quire-menu-line");
                    line.type = "button";
                    line.setAttribute("role", "menuitem");
                    line.style.setProperty("--line-at", String(index));
                    if (item.pressed) line.classList.add("pressed");
                    if (item.icon) line.append(typeof item.icon === "string" ? icon(item.icon) : item.icon);
                    line.append(make("span", "quire-menu-label", item.label));
                    if (item.hint) line.append(make("span", "quire-menu-hint", item.hint));
                    line.addEventListener("mousedown", (event) => event.preventDefault());
                    line.addEventListener("click", () => {
                        menu.close(false);
                        item.run();
                    });
                    items.append(line);
                });
            }
            place();
            // the box is drawn at its starting size first, so that it has somewhere to grow from
            void box.offsetWidth;
            box.classList.add("open");
            items.inert = false;
            opened = true;
            openMenus.add(menu);
            from.setAttribute("aria-expanded", "true");
            from.classList.add("open");
            document.addEventListener("pointerdown", outside, true);
            document.addEventListener("keydown", escape, true);
            if (focusFirst) lines()[0]?.focus({ preventScroll: true });
        },
        close(returnFocus = false) {
            if (!opened) return;
            opened = false;
            openMenus.delete(menu);
            box.classList.remove("open");
            items.inert = true;
            trigger?.setAttribute("aria-expanded", "false");
            trigger?.classList.remove("open");
            document.removeEventListener("pointerdown", outside, true);
            document.removeEventListener("keydown", escape, true);
            if (returnFocus) trigger?.focus({ preventScroll: true });
            options.onClose?.();
        },
        isOpen: () => opened,
        follow() {
            if (opened) place();
        },
    };
    return menu;
}
