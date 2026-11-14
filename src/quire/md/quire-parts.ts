// An mdQuire document as a `.quire` file's parts and back: the Markdown and style.json and notes.json
// as text (core/quire-file.ts packs them into the zip, and every store carries them as they are).
// `written` makes them from a document for a store to save, `opened` reads a document from them, and
// `asQuire` turns a Markdown document into a `.quire` one.

import { dropField, type Document } from "./document";
import { read } from "./read";
import { collect, PAGE, readStyle, restore, type StyleFile } from "./styling";
import { notesData, withNotes } from "./comments";
import type { Parts } from "../core/quire-file";

/** style.json as text, one style to a line, so that it reads plainly and changes show line by line. */
export function styleText(style: StyleFile): string {
    const lines = (items: object[]) => (items.length ? `[\n${items.map((item) => `    ${JSON.stringify(item)}`).join(",\n")}\n  ]` : "[]");
    return `{\n  "quire": 1,\n  "page": ${JSON.stringify(style.page)},\n  "count": ${style.count},\n  "blocks": ${lines(style.blocks)},\n  "runs": ${lines(style.runs)}\n}\n`;
}

/** A document as a store saves it: plain text for a Markdown file, and for a `.quire` one its Markdown and its parts. */
export function written(doc: Document, plain: (doc: Document) => string): { text: string; quire?: Parts } {
    if (!doc.quire) return { text: plain(doc) };
    const { markdown, style } = collect(doc);
    return { text: markdown, quire: { style: styleText(style), notes: notesText(notesData(doc, doc.quire.notes)) } };
}

/** A Markdown document as a `.quire` one: the same words, with a subtitle kept in style.json and no longer in the frontmatter. */
export function asQuire(doc: Document): Document {
    const moved = doc.blocks.some((block) => block.kind === "paragraph" && block.subtitle);
    return { ...(moved ? dropField(doc, "subtitle") : doc), mdx: false, quire: { page: PAGE, notes: null } };
}

/** A document as opened from a store: read from its text, and with its parts put back if it is a `.quire` one. */
export function opened(text: string, quire: Parts | undefined, options: { mdx?: boolean } = {}): Document {
    const doc = read(text, { mdx: !quire && !!options.mdx, quire: !!quire });
    if (!quire) return doc;
    let notes: unknown = null;
    try {
        notes = JSON.parse(quire.notes || "null");
    } catch {
        notes = null;
    }
    const styled = restore({ ...doc, quire: { page: readStyle(quire.style).page, notes } }, readStyle(quire.style));
    // the writer's notes are marked on their words again (comments.ts)
    return withNotes(styled, notes).doc;
}

/** notes.json as text, one note to a line, so that it reads plainly and changes show line by line. */
export function notesText(data: Record<string, unknown>): string {
    const { comments, ...rest } = data;
    const list = Array.isArray(comments) && comments.length ? `[\n${comments.map((each) => `    ${JSON.stringify(each)}`).join(",\n")}\n  ]` : "[]";
    const head = Object.entries(rest).map(([key, value]) => `  ${JSON.stringify(key)}: ${JSON.stringify(value)},\n`).join("");
    return `{\n${head}  "comments": ${list}\n}\n`;
}
