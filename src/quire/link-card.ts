// Links in the writing. A web address pasted over selected words links them (surface.ts asks
// webAddress what counts as one), and a chip grows from under an address just pasted on its own,
// offering to show it as words guessed from it or in a short form. It is drawn as the selection bar
// is (select-bar.ts) so that the two feel like one thing.
//
// What counts as a web address and the words guessed from one are pure and tested; nothing is
// fetched, as a page on a static site cannot read another site's. The rest is DOM.

import { changeText, setLink, textAt, type Document, type Position, type Range } from "./document";
import type { State } from "./history";
import { caret } from "./keys";
import type { Surface } from "./surface";
import { composing, control, make, placeNear } from "./ui";

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

/** Builds the chip for a surface. `top` gives how far down the window the main bar reaches. */
export function createLinkCard(surface: Surface, top: () => number = () => 0): { element: HTMLElement; hide(): void } {
    const pop = make("div", "quire-select-bar quire-link-card");
    pop.setAttribute("role", "group");
    pop.inert = true;
    document.body.append(pop);

    let shown: { range: Range; href: string } | undefined;
    let timer: ReturnType<typeof setTimeout> | undefined;
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

    function show(range: Range, href: string, content: HTMLElement) {
        const growing = !shown;
        shown = { range, href };
        pop.setAttribute("aria-label", "Show the address as");
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
        if (short !== field.value) row.append(control(`Show it as ${shortFor(href, 200)}`, word(short), () => choose(shortFor(href, 200))));
        row.append(control("Leave the address as it is", word(cutMiddle(href, 24)), () => back(range.end)));
        show(range, href, row);
        later(hide, 5000);
    }

    surface.on("address", ({ href, start, end }) => chip({ start, end }, href));
    surface.on("change", () => shown && !pop.contains(document.activeElement) && hide());
    // a few seconds without the pointer on it sends it away
    pop.addEventListener("pointerout", (event) => shown && !pop.contains(event.relatedTarget as Node) && later(hide, 3000));
    pop.addEventListener("pointerover", () => clearTimeout(timer));
    pop.addEventListener("focusin", () => clearTimeout(timer));
    pop.addEventListener("keydown", (event) => {
        if (event.key === "Escape") back(shown?.range.end);
    });

    // typing sends it away, and Tab goes into its field
    surface.element.addEventListener(
        "keydown",
        (event) => {
            if (event.key === "Tab" && shown && !event.ctrlKey && !event.metaKey && !event.shiftKey && !event.altKey) {
                event.preventDefault();
                event.stopImmediatePropagation();
                pop.querySelector("input")?.focus();
                return;
            }
            if (!/^(Shift|Control|Alt|Meta|AltGraph|CapsLock)$/.test(event.key)) hide();
        },
        true,
    );
    document.addEventListener("pointerdown", (event) => shown && !pop.contains(event.target as Node) && !(event.target as Element).closest?.(".quire-menu") && hide(), true);
    addEventListener("scroll", place, { passive: true });
    addEventListener("resize", place);

    return { element: pop, hide };
}
