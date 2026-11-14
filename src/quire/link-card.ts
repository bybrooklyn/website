// Links in the writing: the small card that grows from a link when the pointer rests on it or the
// cursor is in it (where it goes, then icons for Open or Go to, Copy, Edit and Remove), and the chip that grows
// from under an address just pasted on its own, offering to show it as words guessed from it or in a
// short form. Both are drawn as the selection bar is (select-bar.ts) so that the three feel like one
// thing, and Alt+Enter with the cursor in a link opens it.
//
// What counts as a web address and the words guessed from one are pure and tested; nothing is
// fetched, as a page on a static site cannot read another site's. The rest is DOM.

import { changeText, setLink, textAt, type Document, type Position, type Range } from "./document";
import type { State } from "./history";
import { linkAt } from "./bar";
import { places } from "./bookmarks";
import { caret, collapsed } from "./keys";
import type { Surface } from "./surface";
import { composing, control, icon, make, placeNear, still } from "./ui";

/** The address, trimmed, when a pasted text is one web address and nothing else: http, https or mailto, never another scheme such as javascript:. */
export function webAddress(text: string): string | undefined {
    const address = text.trim();
    if (!/^(https?:\/\/|mailto:)[^\s<>"`]+$/i.test(address)) return undefined;
    const url = parse(address);
    if (!url) return undefined;
    return url.protocol === "mailto:" ? (/^[^@/]+@[^@/]+\.[^@/]+$/.test(url.pathname) ? address : undefined) : url.hostname ? address : undefined;
}

const parse = (href: string): URL | undefined => {
    try {
        return new URL(href);
    } catch {
        return undefined;
    }
};

const decode = (part: string): string => {
    try {
        return decodeURIComponent(part);
    } catch {
        return part;
    }
};

/** Sites whose names are not written the way their addresses are. */
const SITES: Record<string, string> = { github: "GitHub", gitlab: "GitLab", youtube: "YouTube", youtu: "YouTube", linkedin: "LinkedIn", stackoverflow: "Stack Overflow", npmjs: "npm" };

/** A site's name from its host: the label before the ending (before `co.uk` and the like too), as the site writes it where known. */
function siteName(host: string): string {
    const labels = host.replace(/^www\./, "").split(".");
    const short = labels.length > 2 && labels[labels.length - 2]!.length <= 3 && labels[labels.length - 1]!.length === 2;
    const name = labels[labels.length - (short ? 3 : 2)] ?? labels[0]!;
    return SITES[name] ?? capital(name);
}

const capital = (words: string): string => (words === words.toLowerCase() ? words.charAt(0).toUpperCase() + words.slice(1) : words);

/** A piece of a path as words: no ending such as .html, no id a site adds after the words, dashes and underscores as spaces. Empty when it holds no words. */
function wordsOf(part: string): string {
    const bare = decode(part).replace(/\.(html?|php|aspx?|jsp|md)$/i, "").replace(/-[0-9a-f]{8,}$/i, "");
    if (/^(index|home|default)$/i.test(bare) || /^[\d-]+$/.test(bare)) return "";
    // an id rather than words: long, with letters and digits mixed and nothing between them
    if (bare.length >= 8 && /\d/.test(bare) && /[a-z]/i.test(bare) && !/[-_+ ]/.test(bare)) return "";
    return bare.replace(/[-_+]+/g, " ").replace(/\s+/g, " ").trim();
}

/**
 * The words a link could show, guessed from its address alone: the last part of its path that is
 * words, with sensible capitals; a repository and its issue for GitHub and GitLab; for a bare
 * domain, or a path with no words in it, the site's name. The query and the fragment are left out.
 */
export function wordsFor(href: string): string {
    const url = parse(href);
    if (!url) return href;
    if (url.protocol === "mailto:") return decode(url.pathname);
    const site = siteName(url.hostname);
    const parts = url.pathname.split("/").filter((part) => part && part !== "-");
    if (site === "YouTube") return parts[0] === "watch" || parts[0] === "shorts" || url.hostname.includes("youtu.be") ? "YouTube video" : site;
    if ((site === "GitHub" || site === "GitLab") && parts.length >= 2) {
        const [, repository, kind, number] = parts;
        const what = { issues: "issue", pull: "pull request", merge_requests: "merge request" }[kind ?? ""];
        const name = capital(repository!.replace(/[-_]+/g, " "));
        return what && /^\d+$/.test(number ?? "") ? `${name} ${what} ${number}` : name;
    }
    for (const part of parts.reverse()) {
        const words = wordsOf(part);
        if (words) return capital(words);
    }
    return site;
}

/** A short form of an address: its host and path, with no scheme, www, query or fragment, cut in the middle if long. */
export function shortFor(href: string, most = 40): string {
    const url = parse(href);
    if (!url) return cutMiddle(href, most);
    if (url.protocol === "mailto:") return decode(url.pathname);
    return cutMiddle(url.hostname.replace(/^www\./, "") + decode(url.pathname).replace(/\/+$/, ""), most);
}

/** Text cut to at most `most` characters by taking out its middle, where an ellipsis stands. */
export function cutMiddle(text: string, most: number): string {
    const letters = [...text];
    if (letters.length <= most) return text;
    const keep = most - 1;
    return `${letters.slice(0, Math.ceil(keep / 2)).join("")}…${letters.slice(letters.length - Math.floor(keep / 2)).join("")}`;
}

/** The address pasted at a stretch of the text shown as a link with other words, the cursor after them; if the text there is no longer the address, nothing changes. */
export function showAs(doc: Document, range: Range, href: string, words: string): State {
    if (textAt(doc, range.start.path).slice(range.start.offset, range.end.offset) !== href) return { doc, selection: caret(range.end.path, range.end.offset) };
    // the words go in place of the first piece of the address, should marks have split it
    const written = changeText(doc, range, (_, at) => (at === range.start.offset ? words : ""));
    const end = { path: range.start.path, offset: range.start.offset + words.length };
    return { doc: setLink(written, { start: range.start, end }, href), selection: caret(end.path, end.offset) };
}

/** Builds the card and the chip for a surface. `edit` opens the link field from a control; `top` gives how far down the window the main bar reaches. */
export function createLinkCard(surface: Surface, edit: (from: HTMLElement) => void, top: () => number = () => 0): { element: HTMLElement; hide(): void } {
    const pop = make("div", "quire-select-bar quire-link-card");
    pop.setAttribute("role", "group");
    pop.inert = true;
    document.body.append(pop);

    let shown: { kind: "card" | "chip"; range: Range; href: string; pointer: boolean } | undefined;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let lastDoc = surface.getDocument();
    const later = (run: () => void, ms: number) => {
        clearTimeout(timer);
        timer = setTimeout(run, ms);
    };
    const word = (text: string) => make("span", "quire-link-word", text);
    const back = (at?: Position) => {
        hide();
        if (at) surface.setSelection(caret(at.path, at.offset));
        surface.focus();
    };

    function place() {
        if (!shown) return;
        const boxes = surface.rangeOf(shown.range.start, shown.range.end)?.getClientRects();
        const rect = boxes?.[boxes.length - 1];
        if (!rect) return;
        const limit = top();
        const at = placeNear({ left: rect.left, top: rect.top - limit, width: rect.width, height: rect.height }, { width: pop.offsetWidth, height: pop.offsetHeight }, { width: innerWidth, height: innerHeight - limit }, "below", 6);
        pop.style.left = `${at.left}px`;
        pop.style.top = `${at.top + limit}px`;
        pop.classList.toggle("below", at.side === "below");
        // it grows from under the middle of the link, wherever the window's edge has slid it to
        pop.style.transformOrigin = `${rect.left + rect.width / 2 - at.left}px ${at.side === "below" ? "0" : "100%"}`;
    }

    function show(kind: "card" | "chip", range: Range, href: string, content: HTMLElement, pointer = false) {
        const growing = !shown;
        shown = { kind, range, href, pointer };
        pop.setAttribute("aria-label", kind === "card" ? "Link" : "Show the address as");
        pop.replaceChildren(content);
        // it starts where it will be, so that it grows there rather than sliding in
        if (growing) pop.classList.add("placing");
        place();
        void pop.offsetWidth;
        pop.classList.remove("placing");
        pop.classList.add("shown");
        pop.inert = false;
    }

    function hide() {
        clearTimeout(timer);
        if (!shown) return;
        shown = undefined;
        pop.classList.remove("shown");
        pop.inert = true;
    }

    /** Opens a link: a heading or bookmark of this document is gone to; a web address opens in a new tab. */
    function follow(href: string) {
        if (href.startsWith("#")) {
            const path = places(surface.getDocument()).find((place) => place.href === href)?.path;
            if (!path) return;
            hide();
            surface.setSelection(caret(path, 0));
            surface.elementAt(path)?.scrollIntoView({ behavior: still() ? "auto" : "smooth", block: "center" });
            surface.focus();
        } else if (webAddress(href)) opener(href).click();
    }

    const opener = (href: string) => {
        const open = make("a", "quire-button");
        open.href = href;
        open.target = "_blank";
        open.rel = "noopener noreferrer";
        open.title = "Open (Alt+Enter)";
        open.setAttribute("aria-label", open.title);
        open.append(icon("open"));
        return open;
    };

    /** The card: where the link goes, to read, then a strip of icons, each named in its tooltip. */
    function card(range: Range, href: string, pointer: boolean) {
        const row = make("div", "quire-select-row");
        const where = make("span", "quire-link-where", cutMiddle(href, 40));
        where.title = href;
        row.append(where, make("span", "quire-select-rule"));
        const place = href.startsWith("#") ? places(surface.getDocument()).find((each) => each.href === href) : undefined;
        if (place) row.append(control("Go to (Alt+Enter)", icon("next"), () => follow(href)));
        else if (webAddress(href)) {
            const open = opener(href);
            open.addEventListener("click", () => hide());
            row.append(open);
        }
        row.append(
            control("Copy", icon("copy"), (button) => {
                // copied, its icon becomes a tick and its name says so
                void navigator.clipboard?.writeText(href).then(() => {
                    button.replaceChildren(icon("tick"));
                    button.setAttribute("aria-label", "Copied");
                    button.title = "Copied";
                });
            }),
            control("Edit (Ctrl+K)", icon("pen"), (button) => {
                // the link field works on the link the cursor is in
                surface.setSelection(caret(range.start.path, range.start.offset + 1));
                edit(button);
            }),
            control("Remove", icon("trash"), () => {
                surface.run((doc) => setLink(doc, range, null));
                back();
            }),
        );
        show("card", range, href, row, pointer);
    }

    function chip(range: Range, href: string) {
        const row = make("div", "quire-select-row quire-link-choices");
        const choose = (words: string) => {
            if (words && words !== href) surface.run((doc) => showAs(doc, range, href, words));
            back();
        };
        const field = make("input", "quire-link-field quire-link-words");
        field.value = wordsFor(href);
        field.size = Math.min(24, Math.max(6, [...field.value].length + 1));
        field.spellcheck = false;
        field.setAttribute("aria-label", "Words for the link: Enter shows the address as these");
        field.addEventListener("focus", () => field.select());
        field.addEventListener("keydown", (event) => {
            event.stopPropagation();
            if (composing(event) || (event.key !== "Enter" && event.key !== "Escape")) return;
            // the key is the field's: once the writing has the focus again, it must not make a new line there
            event.preventDefault();
            if (event.key === "Enter") choose(field.value.trim());
            else back(range.end);
        });
        const short = shortFor(href, 32);
        row.append(make("span", "quire-link-where", "Show as"), field);
        if (short !== field.value) row.append(control("Short form", word(short), () => choose(shortFor(href, 200))));
        row.append(control("Keep address", word(cutMiddle(href, 24)), () => back(range.end)));
        show("chip", range, href, row);
        later(hide, 5000);
    }

    /** The link the cursor is in, if it is in one with nothing selected. */
    const here = () => {
        const selection = surface.getSelection();
        return collapsed(selection) ? linkAt(surface.getDocument(), selection.focus) : undefined;
    };

    /** True when the card is up for this very link already. */
    const showing = (link: { range: Range; href: string }) => shown?.kind === "card" && shown.href === link.href && JSON.stringify(shown.range) === JSON.stringify(link.range);

    surface.on("address", ({ href, start, end }) => chip({ start, end }, href));
    surface.on("change", () => shown && !pop.contains(document.activeElement) && hide());
    surface.on("select", () => {
        const doc = surface.getDocument();
        const edited = doc !== lastDoc;
        lastDoc = doc;
        if (shown?.kind === "chip" || pop.contains(document.activeElement) || document.querySelector(".quire-menu:popover-open")) return;
        const found = !edited && document.activeElement === surface.element ? here() : undefined;
        if (!found) return shown?.pointer || hide();
        // a card the pointer brought stays while the cursor is in its link
        if (showing(found)) shown!.pointer = false;
        else later(() => card(found.range, found.href, false), 250);
    });

    // the pointer resting on a link for a moment, and leaving it and the card for a moment
    surface.element.addEventListener("pointerover", (event) => {
        const link = (event.target as Element).closest?.<HTMLAnchorElement>("a[href]");
        const at = link && surface.positionAt(link, 0);
        const found = at && linkAt(surface.getDocument(), { path: at.path, offset: at.offset + 1 });
        if (event.pointerType === "touch" || !found || shown?.kind === "chip") return;
        if (showing(found)) clearTimeout(timer);
        else later(() => card(found.range, found.href, true), 500);
    });
    const leave = (event: PointerEvent) => {
        if (pop.contains(event.relatedTarget as Node) || (event.relatedTarget as Element | null)?.closest?.("a[href]")) return;
        if (!shown) clearTimeout(timer);
        else if (shown.kind === "chip") later(hide, 3000);
        else if (shown.pointer && !pop.contains(document.activeElement)) later(hide, 400);
    };
    surface.element.addEventListener("pointerout", leave);
    pop.addEventListener("pointerout", leave);
    pop.addEventListener("pointerover", () => clearTimeout(timer));
    pop.addEventListener("focusin", () => clearTimeout(timer));
    pop.addEventListener("keydown", (event) => {
        if (event.key === "Escape") back(shown?.kind === "chip" ? shown.range.end : undefined);
    });

    // typing sends it away; with the cursor in a link Alt+Enter opens it, and with the chip up Tab goes into its field
    surface.element.addEventListener(
        "keydown",
        (event) => {
            const plain = !event.ctrlKey && !event.metaKey && !event.shiftKey;
            const link = event.key === "Enter" && event.altKey && plain ? here() : undefined;
            if (link || (event.key === "Tab" && plain && !event.altKey && shown?.kind === "chip")) {
                event.preventDefault();
                event.stopImmediatePropagation();
                if (link) follow(link.href);
                else pop.querySelector("input")?.focus();
                return;
            }
            if (/^(Shift|Control|Alt|Meta|AltGraph|CapsLock)$/.test(event.key) || (shown?.kind === "card" && /^(Arrow|Home|End|Page)/.test(event.key))) return;
            hide();
        },
        true,
    );
    document.addEventListener("pointerdown", (event) => shown && !pop.contains(event.target as Node) && !(event.target as Element).closest?.(".quire-menu") && hide(), true);
    addEventListener("scroll", place, { passive: true });
    addEventListener("resize", place);

    return { element: pop, hide };
}
