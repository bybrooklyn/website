// The writer's own notes on her text, as the model holds them. There are no accounts: a note is
// hers, to remind herself of something. What a note says is in the document's `comments`; which
// words it is on is marked on the runs of text themselves, by the note's id (TextRun.comments), so
// that every edit carries the mark with the words: typing inside them, splitting the line, undo.
// Marking or unmarking words keeps the block's source, so a note never changes the Markdown, which
// never holds them.
//
// A note whose words have all been deleted is kept, with the words it was on, and shown as such
// until it is deleted; undo brings the words and the mark back.
//
// How notes are kept:
//   - in a `.quire` document, in notes.json inside the zip, beside style.json. Each note's words
//     are anchored as styling is (styling.ts): the block's number and a hash of its text, the
//     words and a few characters before them, so they are found again when document.md was edited
//     elsewhere. A note whose words cannot be found is kept as one whose words are gone.
//   - for a plain Markdown file, in this browser only, under the document's place and name
//     (comment-margin.ts), in the same form; the file itself is never touched.

import { blockAt, blockPaths, runsText, sliceRuns, tidyRuns, type Block, type Comment, type Document, type Position, type Range, type Run } from "./document";
import { hash } from "./styling";

/** A stretch of a note's words: in which block, and from where to where in its text. */
export interface Span {
    path: number[];
    from: number;
    to: number;
}

/** A new note's id: short, and unlike any other in the document. */
export function newId(doc: Document, now = Date.now()): string {
    const taken = new Set((doc.comments ?? []).map((each) => each.id));
    let id = `n${now.toString(36)}`;
    for (let more = 1; taken.has(id); more++) id = `n${now.toString(36)}${more}`;
    return id;
}

/** Changes the block at a path without forgetting its source, as a note does not change the Markdown. */
function keepAt(blocks: Block[], path: number[], change: (block: Block) => Block): Block[] {
    const [index, ...rest] = path;
    const block = blocks[index!];
    if (!block) return blocks;
    let next: Block = block;
    if (rest.length === 0) next = change(block);
    else if (block.kind === "list") {
        const [item, ...inner] = rest;
        next = { ...block, items: block.items.map((each, k) => (k === item ? { ...each, blocks: keepAt(each.blocks, inner, change) } : each)) };
    } else if (block.kind === "quote" || block.kind === "footnote") next = { ...block, blocks: keepAt(block.blocks, rest, change) };
    return next === block ? blocks : blocks.map((each, k) => (k === index ? next : each));
}

/** Runs with a note's id added to (or taken off) the text between two offsets. */
function markRuns(runs: Run[], from: number, to: number, id: string, on: boolean): Run[] {
    const change = (list: Run[]): Run[] =>
        list.map((run): Run => {
            if (run.kind === "link") return { ...run, runs: change(run.runs) as typeof run.runs };
            if (run.kind !== "text") return run;
            const kept = (run.comments ?? []).filter((each) => each !== id);
            const ids = on ? [...kept, id] : kept;
            const next = { ...run };
            if (ids.length) next.comments = ids;
            else delete next.comments;
            return next;
        });
    return tidyRuns([...sliceRuns(runs, 0, from), ...change(sliceRuns(runs, from, to)), ...sliceRuns(runs, to)]);
}

const textual = (block: Block | undefined): block is Extract<Block, { kind: "paragraph" | "heading" }> => block?.kind === "paragraph" || block?.kind === "heading";

/** The paragraphs and headings a range covers, each with the part of its text inside it. */
function covered(doc: Document, range: Range): Span[] {
    const paths = blockPaths(doc);
    const key = (path: number[]) => path.join(",");
    const startKey = key(range.start.path);
    const endKey = key(range.end.path);
    const first = paths.findIndex((path) => key(path) === startKey);
    const last = paths.findIndex((path) => key(path) === endKey);
    if (first < 0 || last < first) return [];
    const out: Span[] = [];
    for (let index = first; index <= last; index++) {
        const path = paths[index]!;
        const block = blockAt(doc, path);
        if (!textual(block)) continue;
        const length = runsText(block.runs).length;
        const from = index === first ? range.start.offset : 0;
        const to = index === last ? range.end.offset : length;
        if (to > from) out.push({ path, from, to });
    }
    return out;
}

/** Marks the words of a range with a note's id, keeping every block's source. */
function mark(doc: Document, spans: Span[], id: string, on: boolean): Document {
    let blocks = doc.blocks;
    for (const span of spans) blocks = keepAt(blocks, span.path, (block) => (textual(block) ? { ...block, runs: markRuns(block.runs, span.from, span.to, id, on) } : block));
    return blocks === doc.blocks ? doc : { ...doc, blocks };
}

/** Adds a note on the words of a range (only paragraphs and headings take notes). Nothing changes if the range covers no words. */
export function addComment(doc: Document, range: Range, text: string, now = Date.now()): { doc: Document; id?: string } {
    const spans = covered(doc, range);
    if (spans.length === 0 || !text.trim()) return { doc };
    const id = newId(doc, now);
    const quote = spans.map((span) => runsText((blockAt(doc, span.path) as { runs: Run[] }).runs).slice(span.from, span.to)).join(" ");
    const comment: Comment = { id, text: text.trim(), created: now, quote };
    return { doc: { ...mark(doc, spans, id, true), comments: [...(doc.comments ?? []), comment] }, id };
}

/** Changes what a note says, or whether it is resolved. */
export function changeComment(doc: Document, id: string, change: { text?: string; resolved?: boolean }): Document {
    const list = doc.comments ?? [];
    const found = list.find((each) => each.id === id);
    if (!found) return doc;
    const next: Comment = { ...found };
    if (change.text !== undefined && change.text.trim()) next.text = change.text.trim();
    if (change.resolved !== undefined) {
        if (change.resolved) next.resolved = true;
        else delete next.resolved;
    }
    if (next.text === found.text && next.resolved === found.resolved) return doc;
    return { ...doc, comments: list.map((each) => (each.id === id ? next : each)) };
}

/** Deletes a note and its mark on the words. */
export function deleteComment(doc: Document, id: string): Document {
    if (!(doc.comments ?? []).some((each) => each.id === id)) return doc;
    const marked = mark(doc, spansOf(doc).get(id) ?? [], id, false);
    const comments = (doc.comments ?? []).filter((each) => each.id !== id);
    const next: Document = { ...marked, comments };
    if (comments.length === 0) delete next.comments;
    return next;
}

/** Where each note's words are, by id, in reading order. A note whose words are gone has none. */
export function spansOf(doc: Document): Map<string, Span[]> {
    const found = new Map<string, Span[]>();
    if (!doc.comments?.length) return found;
    for (const path of blockPaths(doc)) {
        const block = blockAt(doc, path);
        if (!textual(block)) continue;
        let at = 0;
        const walk = (runs: Run[]) => {
            for (const run of runs) {
                if (run.kind === "link") {
                    walk(run.runs);
                    continue;
                }
                const length = run.kind === "text" ? run.text.length : 1;
                if (run.kind === "text")
                    for (const id of run.comments ?? []) {
                        const list = found.get(id) ?? found.set(id, []).get(id)!;
                        const last = list[list.length - 1];
                        if (last && last.to === at && last.path.join(",") === path.join(",")) last.to += length;
                        else list.push({ path, from: at, to: at + length });
                    }
                at += length;
            }
        };
        walk(block.runs);
    }
    return found;
}

/** The note whose words a position is in, if any; the most recent when notes overlap. */
export function commentAt(doc: Document, at: Position, spans = spansOf(doc)): string | undefined {
    const ids = (doc.comments ?? []).filter((each) => !each.resolved).map((each) => each.id).reverse();
    const here = at.path.join(",");
    return ids.find((id) => spans.get(id)?.some((span) => span.path.join(",") === here && span.from <= at.offset && at.offset <= span.to));
}

/** The open notes in the order their words come in the text, those whose words are gone last. */
export function inOrder(doc: Document, spans = spansOf(doc)): Comment[] {
    const position = (comment: Comment) => {
        const first = spans.get(comment.id)?.[0];
        return first ? [...first.path, first.from] : [Infinity];
    };
    const compare = (a: number[], b: number[]) => {
        for (let index = 0; index < Math.max(a.length, b.length); index++) {
            const diff = (a[index] ?? -1) - (b[index] ?? -1);
            if (diff) return diff;
        }
        return 0;
    };
    return [...(doc.comments ?? [])].sort((a, b) => compare(position(a), position(b)));
}

/** The note after (1) or before (-1) the one given among the open ones, round again at the ends. */
export function nextComment(doc: Document, from: string | undefined, by: 1 | -1, spans = spansOf(doc)): string | undefined {
    const open = inOrder(doc, spans).filter((each) => !each.resolved && spans.has(each.id));
    if (open.length === 0) return undefined;
    const at = open.findIndex((each) => each.id === from);
    if (at < 0) return (by === 1 ? open[0] : open[open.length - 1])!.id;
    return open[(at + by + open.length) % open.length]!.id;
}

// ---- keeping notes ----

/** A stretch of words as kept: the block's number among the blocks that hold no others, a hash of its text, the words and what comes before them. */
interface KeptPart {
    block: number;
    hash: string;
    from: number;
    to: number;
    quote: string;
    before: string;
}

/** A note as kept in notes.json. */
interface KeptComment extends Comment {
    parts: KeptPart[];
}

/** The notes of a document as notes.json keeps them, with whatever else was in the file kept as it was. */
export function notesData(doc: Document, was: unknown = null): Record<string, unknown> {
    const kept = was && typeof was === "object" && !Array.isArray(was) ? { ...(was as Record<string, unknown>) } : {};
    const paths = blockPaths(doc);
    const numbers = new Map(paths.map((path, number) => [path.join(","), number]));
    const spans = spansOf(doc);
    const comments: KeptComment[] = (doc.comments ?? []).map((comment) => {
        const parts = (spans.get(comment.id) ?? []).map((span): KeptPart => {
            const whole = runsText((blockAt(doc, span.path) as { runs: Run[] }).runs);
            return { block: numbers.get(span.path.join(","))!, hash: hash(whole), from: span.from, to: span.to, quote: whole.slice(span.from, span.to), before: whole.slice(Math.max(0, span.from - 12), span.from) };
        });
        // the words kept with the note are what it is on now, if they are still there
        const quote = parts.length ? parts.map((part) => part.quote).join(" ") : comment.quote;
        return { ...comment, quote, parts };
    });
    return { quire: 1, ...kept, comments };
}

/** Reads the notes kept in notes.json (or in the browser) back onto a document read from its Markdown: each note's words are found again and marked. A note whose words cannot be found is kept, its words gone; what cannot be read at all is left out. */
export function withNotes(doc: Document, data: unknown): { doc: Document; lost: number } {
    const list = data && typeof data === "object" && Array.isArray((data as { comments?: unknown }).comments) ? ((data as { comments: unknown[] }).comments as Partial<KeptComment>[]) : [];
    const sound = list.filter((each) => each && typeof each.id === "string" && typeof each.text === "string" && each.text.trim() !== "");
    if (sound.length === 0) return { doc, lost: 0 };
    const paths = blockPaths(doc);
    const texts = paths.map((path) => {
        const block = blockAt(doc, path);
        return textual(block) ? runsText(block.runs) : undefined;
    });
    const hashes = texts.map((text) => (text === undefined ? undefined : hash(text)));
    let next = doc;
    let lost = 0;
    const comments: Comment[] = [];
    for (const each of sound) {
        const comment: Comment = { id: each.id!, text: each.text!.trim(), created: typeof each.created === "number" ? each.created : 0, quote: typeof each.quote === "string" ? each.quote : "" };
        if (each.resolved === true) comment.resolved = true;
        if (comments.some((other) => other.id === comment.id)) continue;
        let found = 0;
        for (const part of Array.isArray(each.parts) ? each.parts : []) {
            const place = findPart(texts, hashes, part);
            if (!place) continue;
            next = mark(next, [{ path: paths[place.number]!, from: place.from, to: place.to }], comment.id, true);
            found++;
        }
        if (found === 0) lost++;
        comments.push(comment);
    }
    return { doc: { ...next, comments }, lost };
}

/** Where a kept stretch of words is now: in its block if that is unchanged, else the likeliest place the words are found. */
function findPart(texts: (string | undefined)[], hashes: (string | undefined)[], part: Partial<KeptPart>): { number: number; from: number; to: number } | undefined {
    if (typeof part.quote !== "string" || !part.quote || typeof part.block !== "number") return undefined;
    const quote = part.quote;
    const before = typeof part.before === "string" ? part.before : "";
    // the block itself, unchanged, found by its hash nearest to where it was
    const same = hashes.map((each, number) => (each === part.hash ? number : -1)).filter((number) => number >= 0);
    const nearest = same.sort((a, b) => Math.abs(a - part.block!) - Math.abs(b - part.block!))[0];
    if (nearest !== undefined && typeof part.from === "number" && texts[nearest]!.slice(part.from, part.from + quote.length) === quote) return { number: nearest, from: part.from, to: part.from + quote.length };
    // else the words wherever they are, nearest first, preferring the place with the same characters before them
    const order = texts.map((_, index) => index).sort((a, b) => Math.abs(a - part.block!) - Math.abs(b - part.block!));
    let loose: { number: number; from: number; to: number } | undefined;
    for (const number of order) {
        const text = texts[number];
        if (text === undefined) continue;
        for (let at = text.indexOf(quote); at >= 0; at = text.indexOf(quote, at + 1)) {
            // words found whole, not inside a longer word ("is" in "This"), unless the characters before them say where they are
            const whole = wholeWords(text, at, quote);
            if (text.slice(0, at).endsWith(before) && (before !== "" || whole)) return { number, from: at, to: at + quote.length };
            if (whole) loose ??= { number, from: at, to: at + quote.length };
        }
    }
    return loose && quote.trim().length >= 4 ? loose : undefined;
}

/** True when words found at `at` in a text are not part of a longer word on either side. */
function wholeWords(text: string, at: number, quote: string): boolean {
    const letter = /[\p{L}\p{N}_]/u;
    const startsWord = letter.test(quote[0] ?? "");
    const endsWord = letter.test(quote[quote.length - 1] ?? "");
    return !(startsWord && letter.test(text[at - 1] ?? "")) && !(endsWord && letter.test(text[at + quote.length] ?? ""));
}
