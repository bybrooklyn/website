// Markdown tidiness: what a reader of the file, or the page it becomes, trips over. Headings that
// skip a level or come twice, links and pictures with nothing in them, addresses left bare, spaces
// at a line's end or doubled, a list that changes its bullet halfway, a star or backtick the reader
// had to take as a plain letter, footnotes with no text or text with no footnote, a table with rows
// of different lengths. Each has a fix where one is safe.

import { changeKind, runsLength, setLink, textAt, type Block, type Document, type List, type Range, type Run } from "../document";
import { replaceWith, type Finding, type Fix, type Rule, type Unit } from "./engine";
import { addresses } from "./text";

/** A link, picture or footnote reference in a unit's runs, with where it is. */
export interface Inline {
    kind: "link" | "image" | "footnote";
    from: number;
    to: number;
    href: string;
    /** A link's words, or a picture's alt text. */
    text: string;
    /** For a link: true when it holds a picture that has words of its own. */
    pictured?: boolean;
}

/** The inlines of each list of runs, found once while the runs are unchanged: three rules on the whole document ask for them. */
const inlinesOf = new WeakMap<Run[], Inline[]>();

/** The links, pictures and footnote references in runs, in order. */
export function inlines(runs: Run[]): Inline[] {
    let out = inlinesOf.get(runs);
    if (!out) inlinesOf.set(runs, (out = findInlines(runs)));
    return out;
}

function findInlines(runs: Run[]): Inline[] {
    const out: Inline[] = [];
    let at = 0;
    const leafLength = (run: Run) => (run.kind === "text" ? run.text.length : run.kind === "link" ? 0 : 1);
    for (const run of runs) {
        if (run.kind === "link") {
            const start = at;
            let words = "";
            let pictured = false;
            for (const leaf of run.runs) {
                if (leaf.kind === "text") words += leaf.text;
                if (leaf.kind === "image") {
                    out.push({ kind: "image", from: at, to: at + 1, href: leaf.src, text: leaf.alt });
                    if (leaf.alt.trim()) pictured = true;
                }
                at += leafLength(leaf);
            }
            out.push({ kind: "link", from: start, to: at, href: run.href, text: words, pictured });
            continue;
        }
        if (run.kind === "image") out.push({ kind: "image", from: at, to: at + 1, href: run.src, text: run.alt });
        if (run.kind === "footnote") out.push({ kind: "footnote", from: at, to: at + 1, href: run.label, text: "" });
        at += leafLength(run);
    }
    return out;
}

/** The text of a unit, for a heading's words. */
const plain = (unit: Unit) => unit.read.text.replace(/￼/g, "").trim();

/** A fix that makes a heading another level. */
const level = (to: number): Fix => ({ label: `Make it heading ${to}`, edit: (doc, range) => changeKind(doc, range.start.path, { kind: "heading", level: to as 1 }) });

/** A finding over a unit's whole text. */
const whole = (rule: Rule, unit: Unit, message: string, fixes: Fix[] = []): Finding => ({ rule: rule.id, kind: rule.kind, severity: rule.severity, range: { start: { path: unit.path, offset: 0 }, end: { path: unit.path, offset: unit.read.text.length } }, message, fixes });

const headingSkip: Rule = {
    id: "heading-skip",
    kind: "markdown",
    severity: "mistake",
    label: "Heading levels that skip",
    why: "A heading two levels below the one before leaves a gap in the outline that readers and screen readers follow.",
    on: true,
    document(_doc, units) {
        const out: Finding[] = [];
        let last = 0;
        for (const unit of units) {
            if (!unit.heading || unit.cell) continue;
            if (last && unit.heading > last + 1) out.push(whole(this, unit, `This heading jumps from level ${last} to ${unit.heading}.`, [level(last + 1)]));
            last = unit.heading;
        }
        return out;
    },
};

const headingTop: Rule = {
    id: "heading-top",
    kind: "markdown",
    severity: "mistake",
    label: "More than one top heading",
    why: "A page has one title; a second top-level heading, or one under a title already in the frontmatter, makes two.",
    on: true,
    document(doc, units) {
        const titled = !!doc.frontmatter && /^title\s*:/m.test(doc.frontmatter);
        const tops = units.filter((unit) => unit.heading === 1 && !unit.cell);
        return tops.slice(titled ? 0 : 1).map((unit) => whole(this, unit, titled ? "The title in the frontmatter is already the top heading; this makes a second." : "There is already a top heading; this makes a second.", [level(2)]));
    },
};

const headingDuplicate: Rule = {
    id: "heading-duplicate",
    kind: "markdown",
    severity: "advice",
    label: "Headings that repeat",
    why: "Two headings with the same words look the same in the outline, and a link to the second needs a number added.",
    on: true,
    document(_doc, units) {
        const seen = new Set<string>();
        const out: Finding[] = [];
        for (const unit of units) {
            if (!unit.heading || unit.cell) continue;
            const words = plain(unit).toLowerCase();
            if (!words) continue;
            if (seen.has(words)) out.push(whole(this, unit, "A heading above has the same words."));
            seen.add(words);
        }
        return out;
    },
};

const takeOff: Fix = { label: "Take the link off", edit: (doc, range) => setLink(doc, range, null) };

const linkEmpty: Rule = {
    id: "link-empty",
    kind: "markdown",
    severity: "mistake",
    label: "Links that go nowhere",
    why: "A link with no address looks pressable and does nothing.",
    on: true,
    unit(unit) {
        return unit.runs ? inlines(unit.runs).filter((one) => one.kind === "link" && !one.href.trim() && one.to > one.from).map((one) => ({ from: one.from, to: one.to, message: "This link has no address.", fixes: [takeOff] })) : [];
    },
};

const linkText: Rule = {
    id: "link-no-text",
    kind: "markdown",
    severity: "mistake",
    label: "Links with no words",
    why: "A link with nothing to read cannot be seen or pressed, and a screen reader says only its address.",
    on: true,
    unit(unit) {
        if (!unit.runs) return [];
        const message = "This link has no words to press.";
        const hits = inlines(unit.runs).filter((one) => one.kind === "link" && !one.text.trim() && !one.pictured).map((one) => ({ from: one.from, to: Math.max(one.to, one.from), message }));
        // a link with nothing in its brackets is dropped by the reader, so it is found in the block's source
        if (!hits.length && /(?<!!)\[\s*\]\([^)]*\)/.test(sourceOf(unit))) hits.push({ from: 0, to: unit.read.text.length, message: "A link in this paragraph has no words to press." });
        return hits;
    },
};

const imageAlt: Rule = {
    id: "image-alt",
    kind: "markdown",
    severity: "mistake",
    label: "Pictures with no alt text",
    why: "Alt text is what someone who cannot see the picture is told instead.",
    on: true,
    unit(unit) {
        const message = "This picture says nothing to someone who cannot see it.";
        if (unit.block.kind === "image") return unit.block.alt.trim() ? [] : [{ from: 0, to: 0, message }];
        return unit.runs ? inlines(unit.runs).filter((one) => one.kind === "image" && !one.text.trim()).map((one) => ({ from: one.from, to: one.to, message })) : [];
    },
};

const bareUrl: Rule = {
    id: "bare-url",
    kind: "markdown",
    severity: "advice",
    label: "Bare web addresses",
    why: "An address written out is long to read; a link on a few words says where it goes.",
    on: true,
    unit(unit) {
        if (!unit.runs) return [];
        const linked = inlines(unit.runs).filter((one) => one.kind === "link");
        return addresses(unit.read.text)
            .filter((address) => !address.word.includes("@") || /^https?:/.test(address.word))
            .filter((address) => !linked.some((link) => link.from <= address.from && link.to >= address.to))
            .filter((address) => !isCode(unit, address.from))
            .map((address) => ({ from: address.from, to: address.to, message: "This address is written out bare.", fixes: [{ label: "Make it a link", edit: (doc: Document, range: Range) => setLink(doc, range, /^www\./.test(address.word) ? `https://${address.word}` : address.word) }] }));
    },
};

/** True when the letter at an offset is in code or maths, by its runs. */
function isCode(unit: Unit, offset: number): boolean {
    let at = 0;
    const walk = (runs: Run[]): boolean | undefined => {
        for (const run of runs) {
            if (run.kind === "link") {
                const inner = walk(run.runs);
                if (inner !== undefined) return inner;
                continue;
            }
            const length = run.kind === "text" ? run.text.length : 1;
            if (offset < at + length) return run.kind === "text" && (run.marks.includes("code") || run.marks.includes("math"));
            at += length;
        }
        return undefined;
    };
    return !!unit.runs && !!walk(unit.runs);
}

/** The block's source as the file had it, while the block is unchanged; empty once it has been edited. */
const sourceOf = (unit: Unit) => (unit.cell ? "" : ((unit.block as { source?: string }).source ?? ""));

/** A fix that writes the block again from what it says, which drops what only the source had. */
const tidy = (label: string): Fix => ({
    label,
    edit: (doc, range) => {
        const at = Math.max(0, range.end.offset - 1);
        const letter = textAt(doc, range.start.path).slice(at, at + 1);
        return letter ? replaceWith(label, letter).edit(doc, { start: { ...range.start, offset: at }, end: { ...range.end, offset: at + 1 } }) : doc;
    },
});

const trailing: Rule = {
    id: "trailing-space",
    kind: "markdown",
    severity: "advice",
    label: "Spaces at the end of a line",
    why: "Spaces nobody can see at a line's end change nothing, or turn into a line break nobody meant.",
    on: true,
    unit(unit) {
        if (unit.code || !unit.runs) return [];
        // the reader drops them, so they are in the source alone; two spaces are a line break, and meant
        const source = sourceOf(unit).split(/\r?\n/);
        const lines = unit.read.text.split("\n");
        const hits = [];
        let at = 0;
        for (const [index, line] of lines.entries()) {
            const spaces = /[ \t]+$/.exec(source[index] ?? "")?.[0] ?? "";
            if (spaces && spaces !== "  " && line.length) hits.push({ from: at + line.length - 1, to: at + line.length, message: "Spaces at the end of this line.", fixes: [tidy("Remove them")] });
            at += line.length + 1;
        }
        return hits;
    },
};

const doubled: Rule = {
    id: "double-space",
    kind: "markdown",
    severity: "advice",
    label: "Doubled spaces",
    why: "Two spaces between words show as one on the page but sit in the file as a slip.",
    on: true,
    unit(unit) {
        if (unit.code) return [];
        // after a full stop it is the prose rule's to say
        return [...unit.read.text.matchAll(/(?<=[^\s.!?])  +(?=\S)/g)].filter((match) => !isCode(unit, match.index)).map((match) => ({ from: match.index, to: match.index + match[0].length, message: "Two spaces where one is meant.", fixes: [replaceWith("Use one space", " ")] }));
    },
};

/** The lists of a document, with the blocks before them, at every depth. */
function listPairs(blocks: Block[], prefix: number[], out: { path: number[]; first: List; second: List }[]) {
    blocks.forEach((block, index) => {
        const before = blocks[index - 1];
        if (block.kind === "list" && before?.kind === "list" && before.style === block.style && (block.style === "number" ? before.delimiter !== block.delimiter : before.marker !== block.marker)) out.push({ path: [...prefix, index], first: before, second: block });
        if (block.kind === "list") block.items.forEach((item, k) => listPairs(item.blocks, [...prefix, index, k], out));
        if (block.kind === "quote" || block.kind === "footnote") listPairs(block.blocks, [...prefix, index], out);
    });
}

const listMarker: Rule = {
    id: "list-marker",
    kind: "markdown",
    severity: "mistake",
    label: "A list that changes its bullet",
    why: "Changing the bullet (- to *, or 1. to 1)) ends one list and starts another, with a gap between them.",
    on: true,
    document(doc) {
        const pairs: { path: number[]; first: List; second: List }[] = [];
        listPairs(doc.blocks, [], pairs);
        return pairs.map(({ path, first, second }) => {
            const was = first.style === "number" ? first.delimiter : first.marker;
            const now = second.style === "number" ? second.delimiter : second.marker;
            const start = [...path, 0, 0];
            // the two become one list with the first one's bullet
            const fix: Fix = {
                label: `Make it one list with ${was}`,
                edit: (next) => {
                    const index = path[0]!;
                    const [one, two] = [next.blocks[index - 1], next.blocks[index]];
                    if (path.length !== 1 || one?.kind !== "list" || two?.kind !== "list") return next;
                    const items = [...one.items.slice(0, -1), { ...one.items[one.items.length - 1]!, gap: one.loose ? one.items[0]!.gap || "\n" : "\n" }, ...two.items.map((item) => ({ ...item, source: undefined }))];
                    return { ...next, blocks: [...next.blocks.slice(0, index - 1), { ...one, items, gap: two.gap, source: undefined }, ...next.blocks.slice(index + 1)] };
                },
            };
            // a list right after with the first one's bullet would be joined to the one made, which is more than the fix says
            const after = path.length === 1 ? doc.blocks[path[0]! + 1] : undefined;
            const joins = after?.kind === "list" && after.style === first.style && (first.style === "number" ? after.delimiter === first.delimiter : after.marker === first.marker);
            return { rule: this.id, kind: this.kind, severity: this.severity, range: { start: { path: start, offset: 0 }, end: { path: start, offset: 1 } }, message: `This list changes from ${was} to ${now}, which starts a new list.`, fixes: path.length === 1 && !joins ? [fix] : [] };
        });
    },
};

const strayMark: Rule = {
    id: "stray-mark",
    kind: "markdown",
    severity: "mistake",
    label: "Emphasis or code left open",
    why: "A star, underscore or backtick that never closes shows as itself, and the reader had to guess what was meant.",
    on: true,
    unit(unit) {
        if (!unit.runs || unit.code) return [];
        const source = (unit.block as { source?: string }).source ?? "";
        const text = unit.read.text;
        const hits = [];
        for (const match of text.matchAll(/\*{1,3}|_{1,3}|`+/g)) {
            const from = match.index;
            const to = from + match[0].length;
            if (isCode(unit, from) || unit.read.quiet[from]) continue;
            // written with a backslash in the file, it was meant as itself
            if (source.includes(`\\${match[0][0]}`)) continue;
            const before = text[from - 1] ?? " ";
            const after = text[to] ?? " ";
            const word = /[\p{L}\p{N}]/u;
            const opens = !/\s/.test(after) && (/\s|^$/.test(before) || !word.test(before));
            const closes = !/\s/.test(before) && (/\s|^$/.test(after) || !word.test(after));
            // an underscore inside a word (snake_case) is a letter; a star between spaces is a sum
            if (match[0][0] === "_" && word.test(before) && word.test(after)) continue;
            if (match[0][0] !== "`" && !opens && !closes) continue;
            if (match[0][0] !== "`" && word.test(before) && word.test(after)) continue;
            hits.push({ from, to, message: match[0][0] === "`" ? "This backtick opens code that never closes." : "This opens emphasis that never closes, so it shows as itself.", fixes: [replaceWith("Remove it", "")] });
        }
        return hits;
    },
};

const footnotes: Rule = {
    id: "footnote-missing",
    kind: "markdown",
    severity: "mistake",
    label: "Footnotes with no text",
    why: "A footnote reference with no definition shows its label as plain text.",
    on: true,
    prepare(unit) {
        if (unit.runs) inlines(unit.runs);
    },
    document(doc, units) {
        const defined = new Set<string>();
        const walk = (blocks: Block[]) => blocks.forEach((block) => {
            if (block.kind === "footnote") defined.add(block.label.toLowerCase());
            if (block.kind === "quote" || block.kind === "footnote") walk(block.blocks);
            if (block.kind === "list") block.items.forEach((item) => walk(item.blocks));
        });
        walk(doc.blocks);
        const out: Finding[] = [];
        for (const unit of units) {
            if (!unit.runs) continue;
            for (const one of inlines(unit.runs)) if (one.kind === "footnote" && !defined.has(one.href.toLowerCase())) out.push({ rule: this.id, kind: this.kind, severity: this.severity, range: { start: { path: unit.path, offset: one.from }, end: { path: unit.path, offset: one.to } }, message: `The footnote [^${one.href}] has no text anywhere.`, fixes: [] });
        }
        return out;
    },
};

const footnoteUnused: Rule = {
    id: "footnote-unused",
    kind: "markdown",
    severity: "advice",
    label: "Footnote text never used",
    why: "A footnote's text with nothing pointing to it is not shown at all.",
    on: true,
    prepare(unit) {
        if (unit.runs) inlines(unit.runs);
    },
    document(doc, units) {
        const used = new Set<string>();
        for (const unit of units) if (unit.runs) for (const one of inlines(unit.runs)) if (one.kind === "footnote") used.add(one.href.toLowerCase());
        const out: Finding[] = [];
        doc.blocks.forEach((block, index) => {
            if (block.kind !== "footnote" || used.has(block.label.toLowerCase())) return;
            const first = units.find((unit) => unit.path[0] === index);
            const path = first?.path ?? [index];
            out.push({ rule: this.id, kind: this.kind, severity: this.severity, range: { start: { path, offset: 0 }, end: { path, offset: first?.read.text.length ?? 0 } }, message: `Nothing in the text points to the footnote [^${block.label}].`, fixes: [] });
        });
        return out;
    },
};

/** How many cells a table row of the source has, splitting on pipes that are not escaped. */
export function cellCount(line: string): number {
    const inner = line.trim().replace(/^\|/, "").replace(/(?<!\\)\|$/, "");
    return inner.split(/(?<!\\)\|/).length;
}

const ragged: Rule = {
    id: "table-ragged",
    kind: "markdown",
    severity: "mistake",
    label: "Tables with ragged rows",
    why: "A row with more or fewer cells than the heading row loses cells or shows empty ones.",
    on: true,
    document(_doc, units) {
        const out: Finding[] = [];
        const seen = new Set<Block>();
        for (const unit of units) {
            if (!unit.cell || seen.has(unit.block) || unit.block.kind !== "table") continue;
            seen.add(unit.block);
            const table = unit.block;
            // the reader evens out the rows, so their lengths are counted in the source
            const lines = (table.source ?? "").split(/\r?\n/).filter((line) => line.trim());
            const base = unit.path.slice(0, -2);
            lines.slice(2).forEach((line, r) => {
                const count = cellCount(line);
                if (count === table.header.length || !table.rows[r]) return;
                const path = [...base, r + 1, 0];
                const first = table.rows[r]![0];
                out.push({ rule: this.id, kind: this.kind, severity: this.severity, range: { start: { path, offset: 0 }, end: { path, offset: first ? runsLength(first) : 0 } }, message: `This row has ${count} cells; the heading row has ${table.header.length}.`, fixes: [] });
            });
        }
        return out;
    },
};

/** The Markdown rules. */
export const MARKDOWN: Rule[] = [headingSkip, headingTop, headingDuplicate, linkEmpty, linkText, imageAlt, bareUrl, trailing, doubled, listMarker, strayMark, footnotes, footnoteUnused, ragged];
