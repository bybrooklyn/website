// Links and pictures that lead nowhere: a relative address with no file there, a link to a heading
// of this document (#anchor) that it does not have, and, under `bun run edit`, an address on the
// site itself (/blog/...) that is not one of its pages. Whether a file is there is asked of the
// document's store through the context, which answers from what it has already found and asks
// in the background for the rest; a web address elsewhere is never fetched.

import type { Document } from "../document";
import type { Finding, Rule, Unit } from "./engine";
import { inlines } from "./markdown";

/** A heading's anchor, as the site makes it (the way GitHub does): small letters, punctuation taken out, spaces as hyphens. */
export function slug(words: string): string {
    return words.trim().toLowerCase().replace(/[^\p{L}\p{M}\p{N}\p{Pc} -]/gu, "").replace(/ /g, "-");
}

/** Every anchor the headings of the units make, a repeated one numbered as the site numbers it. */
export function anchors(units: Unit[]): Set<string> {
    const made = new Set<string>();
    const counts = new Map<string, number>();
    for (const unit of units) {
        if (!unit.heading || unit.cell) continue;
        const base = slug(unit.read.text.replace(/￼/g, ""));
        const seen = counts.get(base) ?? 0;
        counts.set(base, seen + 1);
        made.add(seen ? `${base}-${seen}` : base);
    }
    return made;
}

/** What kind of address it is: one this rule looks at, or one it leaves alone. */
export function addressKind(href: string): "anchor" | "site" | "relative" | "elsewhere" {
    if (!href || /^[a-z][\w+.-]*:|^\/\//i.test(href)) return "elsewhere";
    if (href.startsWith("#")) return "anchor";
    if (href.startsWith("/")) return "site";
    return "relative";
}

/** Percent escapes read as letters, or the text as written where one is malformed ("50%", "file%.md"), which must never stop checking. */
export function decoded(text: string, part = false): string {
    try {
        return part ? decodeURIComponent(text) : decodeURI(text);
    } catch {
        return text;
    }
}

/** The address of the file itself, without its query or anchor. */
export const fileOf = (href: string) => decoded(href.replace(/[?#].*$/, ""));

const linkMissing: Rule = {
    id: "link-missing",
    kind: "link",
    severity: "mistake",
    label: "Links and pictures that point at nothing",
    why: "A link to a file that is not there, a heading that is not in the document or a page the site does not have is a dead end for the reader.",
    on: true,
    prepare(unit) {
        if (unit.runs) inlines(unit.runs);
    },
    document(_doc: Document, units: Unit[], context) {
        const out: Finding[] = [];
        let made: Set<string> | undefined;
        for (const unit of units) {
            const found = unit.runs ? inlines(unit.runs) : unit.block.kind === "image" ? [{ kind: "image" as const, from: 0, to: 0, href: unit.block.src, text: unit.block.alt }] : [];
            for (const one of found) {
                if (one.kind === "footnote") continue;
                const kind = addressKind(one.href);
                const what = one.kind === "image" ? "picture" : "link";
                let message: string | undefined;
                if (kind === "anchor") {
                    made ??= anchors(units);
                    const anchor = decoded(one.href.slice(1), true);
                    // a footnote's own anchors and an empty # are the page's, not a heading's
                    if (anchor && !/^(fn|user-content-)/.test(anchor) && !made.has(anchor)) message = `This document has no heading for #${anchor}.`;
                } else if ((kind === "relative" || kind === "site") && context.exists) {
                    const there = context.exists(kind === "site" ? one.href.replace(/[?#].*$/, "") : fileOf(one.href));
                    if (there === false) message = kind === "site" ? `The site has no page at ${fileOf(one.href)}.` : `This ${what} points at ${fileOf(one.href)}, which is not there.`;
                }
                if (message) out.push({ rule: this.id, kind: this.kind, severity: this.severity, range: { start: { path: unit.path, offset: one.from }, end: { path: unit.path, offset: one.to } }, message, fixes: [] });
            }
        }
        return out;
    },
};

/** The rules on links. */
export const LINKS: Rule[] = [linkMissing];
