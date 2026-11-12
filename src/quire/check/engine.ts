// The checking engine: a document in, findings out. `check(doc, context)` runs every rule that is
// switched on and gives back what each found: the rule, its kind, how much it matters, where it is
// (a block path and offsets, as the surface counts them), a short plain sentence, and fixes, each a
// label and an edit the editor applies as one undo step.
//
// Rules are small objects in one table (RULES). A rule looks either at one stretch of text at a time
// (a paragraph, a heading, a table cell: `unit`) or at the whole document (`document`), which it
// does cheaply from what the units already worked out. A checker made by createChecker keeps each
// unit's findings by the unit's own object and by a hash of its text, so after an edit only the
// blocks that changed are looked at again; `start` gives a job that does the work in slices, so
// that the page can run it in idle time and typing never waits for it.

import { deleteText, insertText, type Block, type Document, type Level, type Range, type Run } from "../document";
import { readRuns, readText, sentences, words, type Read, type Span, type Word } from "./text";

/** What a finding is about. */
export type Kind = "spelling" | "prose" | "markdown" | "link";

/** Every kind, in the order the list shows them. */
export const KINDS: Kind[] = ["spelling", "markdown", "link", "prose"];

/** How much a finding matters: a mistake, or something to think about. */
export type Severity = "mistake" | "advice";

/** A way to put a finding right: what it is called, and the edit, given the document and the finding's range. */
export interface Fix {
    label: string;
    edit(doc: Document, range: Range): Document;
}

/** One thing found. `word` is set for a spelling, so that it can be added to the dictionary or ignored. */
export interface Finding {
    rule: string;
    kind: Kind;
    severity: Severity;
    range: Range;
    message: string;
    fixes: Fix[];
    word?: string;
    /** More fixes, worked out only when asked for: a spelling's suggestions. */
    suggest?: () => Fix[];
}

/** A stretch of text checked on its own: a paragraph, a heading, a table cell, or a block of code. */
export interface Unit {
    path: number[];
    block: Block;
    /** The runs, for text with marks and links; absent for code and raw blocks. */
    runs?: Run[];
    read: Read;
    /** True for code and raw blocks, whose words are never checked. */
    code: boolean;
    heading?: Level;
    /** True when the unit is a cell of a table, or inside a list item. */
    cell: boolean;
    listed: boolean;
    /** True inside a quotation block: someone else's words, whose capitals are theirs. */
    quoted: boolean;
    words: Word[];
    sentences: Span[];
}

/** What a unit rule gives back: a finding without its path, which the engine adds. */
export interface Hit {
    from: number;
    to: number;
    message: string;
    fixes?: Fix[];
    word?: string;
    suggest?: () => Fix[];
    /** Set when one rule reports under a narrower id of its own, as the writing rules do. */
    rule?: string;
}

/** What she can change about checking, kept in the browser. */
export interface Settings {
    kinds: Record<Kind, boolean>;
    /** Rules switched away from how they start. */
    rules: Record<string, boolean>;
    /** Words in a sentence, and in a paragraph, before it is called long. */
    sentence: number;
    paragraph: number;
    dialect: "us" | "gb";
}

/** The settings checking starts with. */
export const DEFAULTS: Settings = { kinds: { spelling: true, prose: true, markdown: true, link: true }, rules: {}, sentence: 35, paragraph: 160, dialect: "us" };

/** Answers spelling questions; spelling.ts makes one from the dictionary. */
export interface Speller {
    /** True if the word is spelled right, as written (capitals and all). */
    known(word: string): boolean;
    /** Words that may have been meant, best first. */
    suggest(word: string): string[];
    /** The other country's spelling of a word, if it has one ("colour" for "color"), for the rule on mixed spellings. */
    variant(word: string): string | undefined;
}

/** What the rules may ask about besides the document. */
export interface Context {
    settings: Settings;
    speller?: Speller;
    /** Whether an address in a link or picture leads somewhere: true, false, or undefined when it is not known (yet). */
    exists?: (address: string) => boolean | undefined;
}

/** A rule. It has a `unit` part, a `document` part, or both. */
export interface Rule {
    id: string;
    kind: Kind;
    severity: Severity;
    /** A few words naming it, for the settings and the list. */
    label: string;
    /** Why it matters, in a sentence. */
    why: string;
    /** Whether it starts switched on. */
    on: boolean;
    unit?(unit: Unit, context: Context): Hit[];
    document?(doc: Document, units: Unit[], context: Context): Finding[];
}

/** True if a rule is switched on in these settings. */
export function ruleOn(rule: Rule, settings: Settings): boolean {
    return settings.kinds[rule.kind] && (settings.rules[rule.id] ?? rule.on);
}

/** A finding at one place in a unit. */
export function found(rule: Rule, path: number[], hit: Hit): Finding {
    return { rule: hit.rule ?? rule.id, kind: rule.kind, severity: rule.severity, range: { start: { path, offset: hit.from }, end: { path, offset: hit.to } }, message: hit.message, fixes: hit.fixes ?? [], word: hit.word, suggest: hit.suggest };
}

// ---- units ----

/** Where a unit's text is, and the object that stands for it: the block, or a table cell's runs. */
interface Place {
    path: number[];
    block: Block;
    key: object;
    runs?: Run[];
    cell: boolean;
    listed: boolean;
    quoted: boolean;
}

function places(blocks: Block[], prefix: number[], out: Place[], listed = false, quoted = false) {
    blocks.forEach((block, index) => {
        const path = [...prefix, index];
        if (block.kind === "list") block.items.forEach((item, k) => places(item.blocks, [...path, k], out, true, quoted));
        else if (block.kind === "quote" || block.kind === "footnote") places(block.blocks, path, out, listed, quoted || block.kind === "quote");
        else if (block.kind === "table") [block.header, ...block.rows].forEach((row, r) => row.forEach((cell, c) => out.push({ path: [...path, r, c], block, key: cell, runs: cell, cell: true, listed, quoted })));
        else if (block.kind === "paragraph" || block.kind === "heading") out.push({ path, block, key: block, runs: block.runs, cell: false, listed, quoted });
        else if (block.kind === "code" || block.kind === "raw" || block.kind === "image") out.push({ path, block, key: block, cell: false, listed, quoted });
    });
}

function makeUnit(place: Place): Unit {
    const { block } = place;
    const read = place.runs ? readRuns(place.runs) : readText(block.kind === "code" ? block.code : block.kind === "raw" ? block.text : "");
    const code = !place.runs;
    return { path: place.path, block, runs: place.runs, read, code, heading: block.kind === "heading" ? block.level : undefined, cell: place.cell, listed: place.listed, quoted: place.quoted, words: code ? [] : words(read), sentences: code ? [] : sentences(read) };
}

/** A unit's text and what it is, as one string: equal strings check the same. */
function hashOf(place: Place): string {
    const { block } = place;
    const what = `${place.cell ? "cell" : block.kind === "heading" ? `h${block.level}` : block.kind}${place.listed ? "-listed" : ""}${place.quoted ? "-quoted" : ""}`;
    if (place.runs) return `${what}\u0000${JSON.stringify(place.runs)}`;
    return `${what}\u0000${block.kind === "code" ? block.code : block.kind === "raw" ? block.text : JSON.stringify(block)}`;
}

// ---- checking ----

interface Kept {
    unit: Unit;
    hash: string;
    hits: { rule: Rule; hit: Hit }[];
}

function checkUnit(place: Place, rules: Rule[], context: Context, hash: string): Kept {
    const unit = makeUnit(place);
    const hits: Kept["hits"] = [];
    for (const rule of rules) if (rule.unit) for (const hit of rule.unit(unit, context)) hits.push({ rule, hit });
    return { unit, hash, hits };
}

/** Puts findings in reading order. */
export function inOrder(findings: Finding[]): Finding[] {
    const compare = (a: number[], b: number[]) => {
        for (let index = 0; index < Math.min(a.length, b.length); index++) if (a[index] !== b[index]) return a[index]! - b[index]!;
        return a.length - b.length;
    };
    return findings.sort((a, b) => compare(a.range.start.path, b.range.start.path) || a.range.start.offset - b.range.start.offset || a.range.end.offset - b.range.end.offset);
}

/** Checks a whole document at once, with nothing kept from before. */
export function check(doc: Document, context: Context, rules: Rule[]): Finding[] {
    const checker = createChecker(rules);
    const job = checker.start(doc, context);
    let done: Finding[] | undefined;
    while (!(done = job.run(() => Infinity)));
    return done;
}

/** A piece of checking under way: `run` works while `left()` says there is time, and gives the findings when it is finished. */
export interface Job {
    run(left: () => number): Finding[] | undefined;
}

/** A checker that keeps what it found in each unit, so that checking again after an edit looks only at what changed. */
export function createChecker(rules: Rule[]) {
    let byObject = new WeakMap<object, Kept>();
    let byHash = new Map<string, Kept>();
    let units: Unit[] = [];
    return {
        /** Forgets everything found, for when the settings, the dictionary or the words known change. */
        forget() {
            byObject = new WeakMap();
            byHash = new Map();
        },
        /** The units of the last finished check. */
        units: () => units,
        start(doc: Document, context: Context): Job {
            const live = rules.filter((rule) => ruleOn(rule, context.settings));
            const all: Place[] = [];
            places(doc.blocks, [], all);
            const kept: Kept[] = [];
            const nextHash = new Map<string, Kept>();
            let index = 0;
            return {
                run(left) {
                    for (; index < all.length; index++) {
                        if (index % 8 === 0 && left() <= 1) return undefined;
                        const place = all[index]!;
                        let entry = byObject.get(place.key);
                        if (!entry) {
                            const hash = hashOf(place);
                            entry = byHash.get(hash) ?? checkUnit(place, live, context, hash);
                            byObject.set(place.key, entry);
                        }
                        if (entry.unit.block !== place.block || entry.unit.path.join() !== place.path.join()) {
                            // the same text somewhere else: the unit is the same, at its new place
                            entry = { ...entry, unit: { ...entry.unit, path: place.path, block: place.block } };
                            byObject.set(place.key, entry);
                        }
                        nextHash.set(entry.hash, entry);
                        kept.push(entry);
                    }
                    // only units still in the document are kept by their hash, so the map does not grow without end
                    byHash = nextHash;
                    units = kept.map((entry) => entry.unit);
                    const findings: Finding[] = [];
                    for (const entry of kept) for (const { rule, hit } of entry.hits) findings.push(found(rule, entry.unit.path, hit));
                    for (const rule of live) if (rule.document) findings.push(...rule.document(doc, units, context));
                    return inOrder(findings);
                },
            };
        },
    };
}

// ---- fixes ----

/** A fix that puts other text in the finding's place, keeping the marks of its first letter. */
export function replaceWith(label: string, value: string): Fix {
    return {
        label,
        edit(doc, range) {
            const { path } = range.start;
            const from = range.start.offset;
            const to = range.end.offset;
            const at = (offset: number) => ({ path, offset });
            if (!value) return deleteText(doc, { start: at(from), end: at(to) });
            if (from === to) return insertText(doc, at(from), value);
            // typed in just after the first letter, the new text takes that letter's marks; then the old goes from round it
            let next = insertText(doc, at(from + 1), value);
            next = deleteText(next, { start: at(from + 1 + value.length), end: at(to + value.length) });
            return deleteText(next, { start: at(from), end: at(from + 1) });
        },
    };
}
