// The home screen: what mdQuire shows with no document open. A row of ways to start something new
// (a blank page, a blog post, notes), and under it the recent documents from every place that is
// connected, each a small picture of its first page drawn from its own first blocks in the site's
// look, with its name, where it lives and when it was last touched. A three-dot menu on each renames,
// duplicates or deletes it. Pressing one opens it: the page grows out of its picture, and leaving
// the document it shrinks back there (`travel`).
//
//   const shelf = createShelf({ templates, cards, make, ... });
//   host.append(shelf.element); await shelf.refresh(); shelf.show();
//
// What is shown and in what order is pure and tested (templates, recent, firstBlocks, copyName);
// app.ts says what each choice does.

import { type Document } from "./document";
import { read } from "./read";
import { createSurface } from "./surface";
import { dots, flowMenu, icon, make, still, type Box, type MenuItem } from "./ui";
import { when } from "./versions";

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
        { key: "blank", label: "Blank", name: "Untitled", text: "", quire: true },
        { key: "post", label: "Blog post", name: "A new post", text: `---\ntitle: A new post\ndate: ${day}\ndescription: What it is about, in a line.\n---\n\nThe first paragraph.\n`, quire: false },
        { key: "notes", label: "Notes", name: "Notes", text: `${said}\n\n## To do\n\n- [ ] Something to do\n\n## Thoughts\n\nA first thought.\n`, quire: true },
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

/** The start of a document, as much as a small picture of its first page can show. */
export function firstBlocks(doc: Document, limit = 10): Document {
    return doc.blocks.length <= limit ? doc : { ...doc, blocks: doc.blocks.slice(0, limit) };
}

/** The name for a copy: " copy" before the ending, if there is one. */
export function copyName(name: string): string {
    const ending = /\.(md|mdx|markdown|txt|quire)$/i.exec(name)?.[0] ?? "";
    return `${name.slice(0, name.length - ending.length)} copy${ending}`;
}

/** A document on the shelf, and what can be done to it. */
export interface Card {
    key: string;
    name: string;
    place: string;
    modified?: number;
    /** The document as it reads now, for its picture; undefined if it cannot be read. */
    preview(): Promise<Document | undefined>;
    /** The address a picture in it is shown from. */
    picture?(address: string): Promise<string | undefined>;
    open(from: HTMLElement): void;
    rename?(name: string): Promise<void>;
    duplicate?(): Promise<void>;
    remove?(): Promise<void>;
}

/** What the shelf shows, and what each choice there does. */
export interface ShelfOptions {
    templates: Template[];
    /** Starts something new from a template; `from` is its picture, for the page to grow out of. */
    start(template: Template, from: HTMLElement): void;
    /** The documents to show, most recent first. */
    cards(): Promise<Card[]>;
    /** Other ways in, quietly under the documents: opening a file, a folder, connecting a repository. */
    ways?: () => { label: string; run: (from: HTMLElement) => void }[];
}

/** The width of the page a picture is drawn at before it is made small, so that it is laid out as the real page is. */
const PAGE_WIDTH = 36;

/** Draws a small picture of a page: the name as its title, and its first blocks, drawn as the editor draws them. */
export function miniature(name: string, doc: Document | undefined, picture?: (address: string) => Promise<string | undefined>): HTMLElement {
    const frame = make("div", "quire-mini");
    frame.setAttribute("aria-hidden", "true");
    const page = make("div", "quire-paper quire-mini-page");
    page.style.width = `${PAGE_WIDTH}rem`;
    const title = make("p", "quire-title", name);
    page.append(title);
    if (doc) {
        const text = make("div", "prose");
        createSurface(text, firstBlocks(doc), picture ? { picture } : {}).destroy();
        text.removeAttribute("role");
        text.removeAttribute("contenteditable");
        text.inert = true;
        page.append(text);
    }
    frame.append(page);
    return frame;
}

/** A blank page, with a faint plus on it. */
function blankPage(): HTMLElement {
    const frame = make("div", "quire-mini quire-mini-blank");
    frame.append(icon("plus"));
    return frame;
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

    // pictures are drawn when they come into sight, so that a long shelf of a repository's documents is not all read at once
    const drawing = typeof IntersectionObserver !== "undefined" ? new IntersectionObserver((seen) => seen.forEach((each) => each.isIntersecting && draw(each.target as HTMLElement)), { rootMargin: "200px" }) : undefined;
    const waiting = new Map<HTMLElement, () => Promise<HTMLElement>>();
    const draw = async (holder: HTMLElement) => {
        const make = waiting.get(holder);
        if (!make) return;
        waiting.delete(holder);
        drawing?.unobserve(holder);
        holder.replaceChildren(await make());
        fit();
        // seen a frame after it is there, so that it fades in
        requestAnimationFrame(() => holder.classList.add("drawn"));
    };
    /** Makes the drawn pages as small as their cards, all being the same width. */
    const fit = () => {
        // each row has its own size of card, so each is fitted on its own
        for (const row of shelf.querySelectorAll<HTMLElement>(".quire-shelf-row")) {
            const page = row.querySelector<HTMLElement>(".quire-mini-page");
            const frame = page?.parentElement;
            if (frame && page?.offsetWidth) row.style.setProperty("--mini-scale", String(frame.clientWidth / page.offsetWidth));
        }
    };
    if (typeof ResizeObserver !== "undefined") new ResizeObserver(fit).observe(shelf);

    /** A card: its picture to press, its name, and below that where it lives and when. */
    const card = (name: string, about: string[], picture: () => Promise<HTMLElement>, press: (from: HTMLElement) => void, menuItems?: () => MenuItem[]) => {
        const item = next(make("li", "quire-card"));
        const open = make("button", "quire-card-open");
        open.type = "button";
        open.setAttribute("aria-label", `Open ${name}`);
        const holder = make("div", "quire-mini-holder");
        holder.append(make("div", "quire-mini"));
        waiting.set(holder, picture);
        if (drawing) drawing.observe(holder);
        else void draw(holder);
        open.append(holder);
        open.addEventListener("click", () => press(holder));
        const words = make("div", "quire-card-words");
        const label = make("span", "quire-card-name", name);
        label.title = name;
        words.append(label);
        for (const line of about) words.append(make("span", "quire-card-about", line));
        item.append(open, words);
        if (menuItems) {
            const more = dots(`More for ${name}`);
            more.addEventListener("click", () => (menu.isOpen() ? menu.close(true) : menu.open(more, menuItems(), document.activeElement === more)));
            item.append(more);
        }
        return item;
    };

    /** Puts a field in place of a card's name, to rename it; Enter keeps the new name, Escape the old. */
    const renaming = (item: HTMLElement, current: string, rename: (name: string) => Promise<void>) => {
        const label = item.querySelector<HTMLElement>(".quire-card-name")!;
        const field = make("input", "quire-link-field quire-card-field");
        field.value = current;
        field.setAttribute("aria-label", `A new name for ${current}`);
        let done = false;
        const finish = async (keep: boolean) => {
            if (done) return;
            done = true;
            const wanted = field.value.trim();
            field.replaceWith(label);
            if (keep && wanted && wanted !== current) await rename(wanted);
        };
        field.addEventListener("keydown", (event) => {
            event.stopPropagation();
            if (event.key === "Enter") void finish(true);
            if (event.key === "Escape") void finish(false);
        });
        field.addEventListener("blur", () => void finish(true));
        label.replaceWith(field);
        field.focus();
        field.select();
    };

    async function refresh() {
        count = 0;
        waiting.clear();
        drawing?.disconnect();
        const head = (words: string) => next(make("h2", "quire-outline-title quire-shelf-head", words));
        const fresh = make("ul", "quire-shelf-row quire-shelf-start");
        for (const template of options.templates) {
            fresh.append(card(template.label, [], async () => (template.text ? miniature(template.name, read(template.text)) : blankPage()), (from) => options.start(template, from)));
        }
        const cards = await options.cards().catch(() => [] as Card[]);
        const list = make("ul", "quire-shelf-row quire-shelf-recent");
        const now = Date.now();
        for (const each of cards) {
            const about = [each.place, each.modified ? when(each.modified, now) : ""].filter(Boolean);
            const item: HTMLElement = card(each.name, about, async () => miniature(shownTitle(each.name), await each.preview().catch(() => undefined), each.picture), (from) => each.open(from), () => [
                { label: "Open", run: () => each.open(item.querySelector<HTMLElement>(".quire-mini-holder")!) },
                ...(each.rename ? [{ label: "Rename", run: () => renaming(item, each.name, each.rename!) }] : []),
                ...(each.duplicate ? [{ label: "Duplicate", run: () => void each.duplicate!().then(refresh) }] : []),
                // deleting asks once more, in the same menu, rather than in a dialog
                ...(each.remove ? [{ label: "Delete", icon: "trash", run: () => menu.open(item.querySelector<HTMLElement>(".quire-dots")!, [{ label: `Delete ${each.name}`, icon: "trash", run: () => void each.remove!().then(refresh) }, { label: "Keep it", run: () => {} }], true) }] : []),
            ]);
            item.dataset.key = each.key;
            list.append(item);
        }
        const parts: HTMLElement[] = [head("Start something new"), fresh, head("Recent")];
        if (cards.length) parts.push(list);
        else parts.push(next(make("p", "quire-shelf-none", "Nothing here yet. What you write is kept in this browser as you type.")));
        const ways = options.ways?.() ?? [];
        if (ways.length) {
            const row = next(make("div", "quire-shelf-ways"));
            for (const way of ways) {
                const button = make("button", "quire-button quire-choice", way.label);
                button.type = "button";
                button.addEventListener("click", (event) => {
                    event.stopPropagation();
                    way.run(button);
                });
                row.append(button);
            }
            parts.push(row);
        }
        inner.replaceChildren(...parts);
        fit();
    }

    return {
        element: shelf,
        refresh,
        /** The picture of a document on the shelf, to grow out of or shrink back to. */
        pictureOf: (key: string) => shelf.querySelector<HTMLElement>(`.quire-card[data-key="${CSS.escape(key)}"] .quire-mini-holder`) ?? undefined,
        /** Draws a picture now, rather than when it comes into sight, so that it is there to shrink back to. */
        drawNow: (holder: HTMLElement) => draw(holder),
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
            drawing?.disconnect();
            menu.box.remove();
            shelf.remove();
        },
    };
}

/** A document's name as the title of its picture: without its folder or ending. */
const shownTitle = (name: string) => name.replace(/^.*\//, "").replace(/\.(md|mdx|markdown|txt|quire)$/i, "");

/** Where an element is in the window. */
export function boxOf(element: Element): Box {
    const { left, top, width, height } = element.getBoundingClientRect();
    return { left, top, width, height };
}

/**
 * Makes the page travel between a small picture and its own place, as a picture on the site
 * travels open in the viewer (src/scripts/opening.ts and viewer.ts, which this copies, as mdQuire
 * imports nothing from outside itself): the page is laid at its own place, then transformed onto
 * the picture and let go, or the other way round. It is scaled evenly by width and cut to the
 * picture's shape, so that a long document arrives as its first page. Under reduced motion it does
 * not move.
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
