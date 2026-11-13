// Bookmarks, from Insert: a named place in the document that a link can go to. A heading is one
// already, by the id her site gives it (the words in lower case, spaces as hyphens, slug in
// inserts.ts). Anywhere else Markdown has no way to name a place, so a bookmark is the one standard
// form HTML has, an empty anchor, `<a id="name"></a>`, which the site passes through as it is and a
// reader never sees. The editor draws it as a small quiet flag, left out of print. The link field
// (Ctrl+K) offers every heading and bookmark, as a link to `#` and its name.

import { blockPaths, blockAt, insertAtom, outline, runsText, type Document, type Run } from "./document";
import type { State } from "./history";
import { slug } from "./inserts";
import { collapsed, rangeOf } from "./keys";

/** An empty anchor with an id (or the older name), read as one bookmark rather than two tags. */
export const BOOKMARK = /^<a\s+(?:id|name)="([^"<>]*)"\s*><\/a>/i;

/** The name of a bookmark, when inline HTML is one. */
export function bookmarkName(html: string): string | undefined {
    const found = BOOKMARK.exec(html);
    return found && found[0] === html ? found[1] : undefined;
}

/** A place a link can go to: what it is called in the list, and the link. */
export interface Place {
    label: string;
    href: string;
    kind: "heading" | "bookmark";
}

/** Every bookmark's name, in reading order. */
function bookmarks(doc: Document): string[] {
    const names: string[] = [];
    const visit = (runs: Run[]) => {
        for (const run of runs) {
            if (run.kind === "link") visit(run.runs);
            else if (run.kind === "html") {
                const name = bookmarkName(run.html);
                if (name) names.push(name);
            }
        }
    };
    for (const path of blockPaths(doc)) {
        const block = blockAt(doc, path);
        if (block?.kind === "paragraph" || block?.kind === "heading") visit(block.runs);
        else if (block?.kind === "table") [block.header, ...block.rows].forEach((row) => row.forEach(visit));
    }
    return names;
}

/** The places in a document a link can go to: its headings, by the ids the site gives them, then its bookmarks. */
export function places(doc: Document): Place[] {
    const seen = new Map<string, number>();
    const headings = outline(doc)
        .filter((entry) => entry.text)
        .map((entry): Place => ({ label: entry.text, href: `#${slug(entry.text, seen)}`, kind: "heading" }));
    return [...headings, ...bookmarks(doc).map((name): Place => ({ label: name, href: `#${name}`, kind: "bookmark" }))];
}

/** A name for a bookmark made from words: as a heading's id is made, and numbered when a heading or bookmark has it already. */
export function freeName(doc: Document, words: string): string {
    const base = slug(words.slice(0, 40), new Map()).replace(/^-+|-+$/g, "") || "bookmark";
    const taken = new Set(places(doc).map((place) => place.href.slice(1)));
    let name = base;
    for (let count = 2; taken.has(name); count++) name = `${base}-${count}`;
    return name;
}

/** The name the field offers: the selected words, or the first few of the cursor's line. */
export function suggestedName(state: State): string {
    const { start, end } = rangeOf(state.selection);
    const block = blockAt(state.doc, start.path);
    const text = block?.kind === "paragraph" || block?.kind === "heading" ? runsText(block.runs).replace(/￼/g, "") : "";
    const words = !collapsed(state.selection) && start.path.join() === end.path.join() ? text.slice(start.offset, end.offset) : text.split(/\s+/).slice(0, 4).join(" ");
    return freeName(state.doc, words);
}

/** Puts a bookmark with a name at the end of the selection; a name already used is numbered. */
export function addBookmark(words: string): (state: State) => State {
    return (state) => {
        const at = rangeOf(state.selection).end;
        const doc = insertAtom(state.doc, at, { kind: "html", html: `<a id="${freeName(state.doc, words)}"></a>` });
        return doc === state.doc ? state : { doc, selection: { anchor: { ...at, offset: at.offset + 1 }, focus: { ...at, offset: at.offset + 1 } } };
    };
}
