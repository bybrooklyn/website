// The home screen: what mdQuire shows with no document open. One quiet row of ways to start
// something new (blank, blog post, notes), and under it the recent documents from every place that
// is connected, a row each, as the site lists its posts: the name, where it lives and when it was
// last touched. The three dots at the end of a row open, rename, duplicate or delete it. Pressing a
// row opens it: the page grows out of the row, and leaving the document it shrinks back there
// (`travel`). Something new grows out of the word that was pressed.
//
//   const shelf = createShelf({ templates, documents, start, ... });
//   host.append(shelf.element); await shelf.refresh(); shelf.show();
//
// What is shown and in what order is pure and tested (templates, recent, copyName, shortWhen);
// app.ts says what each choice does.

import { composing, dots, flowMenu, make, still, type Box, type MenuItem } from "./ui";

/** A way to start something new: what it is called, the name and text it starts with, and whether it is a `.quire` document. */
export interface Template {
    key: string;
    label: string;
    name: string;
    text: string;
    quire: boolean;
}

/** The ways to start something new, dated today where they carry a date. */
export function templates(today: Date): Template[] {
    const day = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
    const said = today.toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long", year: "numeric" });
    return [
        { key: "blank", label: "blank", name: "Untitled", text: "", quire: true },
        { key: "post", label: "blog post", name: "A new post", text: `---\ntitle: A new post\ndate: ${day}\ndescription: What it is about, in a line.\n---\n\nThe first paragraph.\n`, quire: false },
        { key: "notes", label: "notes", name: "Notes", text: `${said}\n\n## To do\n\n- [ ] Something to do\n\n## Thoughts\n\nA first thought.\n`, quire: true },
    ];
}

/** A document somewhere, as the shelf lists it. */
export interface Found<S> {
    store: S;
    id: string;
    name: string;
    modified?: number;
}

/** The documents from every place, most recently touched first; those whose time is not known come after, in the order their places gave them. */
export function recent<S>(places: { store: S; entries: { id: string; name: string; modified?: number }[] }[], limit = 24): Found<S>[] {
    const all = places.flatMap((place, at) => place.entries.map((entry, index) => ({ found: { store: place.store, ...entry }, at, index })));
    all.sort((a, b) => (b.found.modified ?? -Infinity) - (a.found.modified ?? -Infinity) || a.at - b.at || a.index - b.index);
    return all.slice(0, limit).map((each) => each.found);
}

/** When a document was last touched, as short as a row can say it: "today 09:04", "yesterday", "3 Nov", or with its year when that is not this one. */
export function shortWhen(time: number, now: number): string {
    const date = new Date(time);
    const today = new Date(now);
    const sameDay = (a: Date, b: Date) => a.toDateString() === b.toDateString();
    if (sameDay(date, today)) return `today ${date.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}`;
    if (sameDay(date, new Date(now - 86_400_000))) return "yesterday";
    return date.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: date.getFullYear() === today.getFullYear() ? undefined : "numeric" });
}

/** The name for a copy: " copy" before the ending, if there is one. */
export function copyName(name: string): string {
    const ending = /\.(md|mdx|markdown|txt|quire)$/i.exec(name)?.[0] ?? "";
    return `${name.slice(0, name.length - ending.length)} copy${ending}`;
}

/** A document on the shelf, and what can be done to it. */
export interface Listed {
    key: string;
    name: string;
    place: string;
    modified?: number;
    /** Opens it; `from` is its row, for the page to grow out of. */
    open(from: HTMLElement): void;
    rename?(name: string): Promise<void>;
    duplicate?(): Promise<void>;
    remove?(): Promise<void>;
}

/** What the shelf shows, and what each choice there does. */
export interface ShelfOptions {
    templates: Template[];
    /** Starts something new from a template; `from` is its word, for the page to grow out of. */
    start(template: Template, from: HTMLElement): void;
    /** The documents to show, most recent first. */
    documents(): Promise<Listed[]>;
    /** Other ways in, quietly under the documents: opening a file, a folder, connecting a repository. */
    ways?: () => { label: string; run: (from: HTMLElement) => void }[];
}

/** Builds the shelf. */
export function createShelf(options: ShelfOptions) {
    const shelf = make("section", "quire-shelf");
    shelf.setAttribute("aria-label", "Documents");
    shelf.inert = true;
    const inner = make("div", "quire-shelf-inner");
    shelf.append(inner);
    const menu = flowMenu("Document", { align: "right" });
    let count = 0;
    /** Gives each thing its turn to arrive, a moment after the one before. */
    const next = <T extends HTMLElement>(element: T) => {
        element.style.setProperty("--line-at", String(Math.min(count++, 16)));
        return element;
    };

    /** A row of words to press, set apart by dots as the site sets apart a post's facts. */
    const words = (className: string, choices: { label: string; run: (from: HTMLElement) => void }[]) => {
        const list = make("ul", `quire-shelf-words ${className}`);
        for (const choice of choices) {
            const item = make("li");
            const button = make("button", "quire-shelf-word", choice.label);
            button.type = "button";
            button.addEventListener("click", (event) => {
                event.stopPropagation();
                choice.run(button);
            });
            item.append(button);
            list.append(item);
        }
        return list;
    };

    /** A document's row: its name, where it lives and when, all one thing to press, then its three dots. */
    const row = (each: Listed, now: number) => {
        const item = next(make("li", "quire-shelf-doc"));
        item.dataset.key = each.key;
        const open = make("button", "quire-shelf-open");
        open.type = "button";
        const name = make("span", "quire-shelf-name", each.name);
        name.title = each.name;
        open.append(name, make("span", "quire-shelf-place", each.place), make("span", "quire-shelf-when", each.modified ? shortWhen(each.modified, now) : ""));
        open.addEventListener("click", () => each.open(item));
        const more = dots(`More for ${each.name}`);
        const items = (): MenuItem[] => [
            { label: "Open", run: () => each.open(item) },
            ...(each.rename ? [{ label: "Rename", run: () => renaming(open, each.name, each.rename!) }] : []),
            ...(each.duplicate ? [{ label: "Duplicate", run: () => void each.duplicate!().then(refresh) }] : []),
            // deleting asks once more, in the same menu, rather than in a dialog
            ...(each.remove ? [{ label: "Delete", icon: "trash", run: () => menu.open(more, [{ label: `Delete ${each.name}`, icon: "trash", run: () => void each.remove!().then(refresh) }, { label: "Keep it", run: () => {} }], true) }] : []),
        ];
        more.addEventListener("click", () => (menu.isOpen() ? menu.close(true) : menu.open(more, items(), document.activeElement === more)));
        item.append(open, more);
        return item;
    };

    /**
     * Puts a field in place of a row's name, to rename it; Enter keeps the new name, Escape the old.
     * A field cannot be inside the button that opens the row, so while it is there the row stands
     * as a plain copy of itself.
     */
    const renaming = (open: HTMLElement, current: string, rename: (name: string) => Promise<void>) => {
        const standing = make("div", "quire-shelf-open quire-shelf-renaming");
        const field = make("input", "quire-link-field quire-shelf-field");
        field.value = current;
        field.setAttribute("aria-label", `A new name for ${current}`);
        standing.append(field, ...[...open.children].slice(1).map((part) => part.cloneNode(true)));
        let done = false;
        const finish = async (keep: boolean) => {
            if (done) return;
            done = true;
            const wanted = field.value.trim();
            const focused = document.activeElement === field;
            standing.replaceWith(open);
            if (focused) open.focus({ preventScroll: true });
            if (keep && wanted && wanted !== current) await rename(wanted);
        };
        field.addEventListener("keydown", (event) => {
            event.stopPropagation();
            if (composing(event) || (event.key !== "Enter" && event.key !== "Escape")) return;
            // the keyboard goes back to the row's button at once, and the key, let be, would press it and open the document
            event.preventDefault();
            void finish(event.key === "Enter");
        });
        field.addEventListener("blur", () => void finish(true));
        open.replaceWith(standing);
        field.focus();
        field.select();
    };

    async function refresh() {
        count = 0;
        const label = (text: string) => make("h2", "label quire-shelf-label", text);
        const fresh = next(make("div", "quire-shelf-new"));
        fresh.append(label("new"), words("quire-shelf-kinds", options.templates.map((template) => ({ label: template.label, run: (from: HTMLElement) => options.start(template, from) }))));
        const listed = await options.documents().catch(() => [] as Listed[]);
        const parts: HTMLElement[] = [fresh, next(label("recent"))];
        if (listed.length) {
            const list = make("ul", "quire-shelf-list");
            const now = Date.now();
            for (const each of listed) list.append(row(each, now));
            parts.push(list);
        } else parts.push(next(make("p", "quire-shelf-none", "Nothing here yet. What you write is kept in this browser as you type.")));
        const ways = options.ways?.() ?? [];
        if (ways.length) parts.push(next(words("quire-shelf-ways", ways)));
        inner.replaceChildren(...parts);
    }

    return {
        element: shelf,
        refresh,
        /** The row of a document on the shelf, to grow out of or shrink back to. */
        rowOf: (key: string) => shelf.querySelector<HTMLElement>(`.quire-shelf-doc[data-key="${CSS.escape(key)}"]`) ?? undefined,
        shown: () => shelf.classList.contains("shown"),
        show() {
            shelf.inert = false;
            void shelf.offsetWidth;
            shelf.classList.add("shown");
        },
        hide() {
            menu.close(false);
            shelf.inert = true;
            shelf.classList.remove("shown");
        },
        destroy() {
            menu.box.remove();
            shelf.remove();
        },
    };
}

/** Where an element is in the window. */
export function boxOf(element: Element): Box {
    const { left, top, width, height } = element.getBoundingClientRect();
    return { left, top, width, height };
}

/**
 * Makes the page travel between a place on the home screen (a document's row, or the word that
 * started it) and its own place, as a picture on the site travels open in the viewer
 * (src/scripts/opening.ts and viewer.ts, which this copies, as mdQuire imports nothing from outside
 * itself): the page is laid at its own place, then transformed onto that place and let go, or the
 * other way round. It is scaled evenly by width and cut to that place's shape, so that it arrives as
 * a strip of its top. Under reduced motion it does not move.
 */
export function travel(page: HTMLElement, picture: Box, opening: boolean, time = opening ? 460 : 380): Promise<void> {
    if (still()) return Promise.resolve();
    const own = boxOf(page);
    const scale = picture.width / own.width;
    // a sheet shown at a zoom (paper.ts) moves in its own pixels, which the zoom makes larger on screen
    const zoom = own.width / (page.offsetWidth || own.width) || 1;
    const cut = Math.max(0, own.height - picture.height / scale) / zoom;
    const radius = parseFloat(getComputedStyle(page).borderTopLeftRadius) || 0;
    const small = { transform: `translate(${(picture.left - own.left) / zoom}px, ${(picture.top - own.top) / zoom}px) scale(${scale})`, clipPath: `inset(0 0 ${cut}px 0 round ${radius / scale}px)` };
    const whole = { transform: "none", clipPath: `inset(0 0 0 0 round ${radius}px)` };
    const frames = opening ? [small, whole] : [whole, small];
    // on its way it passes over the home screen
    page.style.zIndex = "2";
    const run = page.animate(frames.map((frame) => ({ ...frame, transformOrigin: "0 0" })), { duration: time, easing: "cubic-bezier(0.22, 1, 0.36, 1)", fill: opening ? "none" : "forwards" });
    const done = () => {
        page.style.zIndex = "";
        // shrunk back, it stays small until the page behind the home screen is hidden, a moment later
        if (!opening) setTimeout(() => run.cancel(), 50);
    };
    return run.finished.then(done, done);
}
