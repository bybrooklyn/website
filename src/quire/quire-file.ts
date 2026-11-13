// The `.quire` file: a zip holding the document as plain Markdown and what Markdown cannot hold.
//
//   name.quire
//     document.md     the words, plain Markdown, readable alone by anything
//     style.json      the look of text and blocks, and the page (styling.ts says how it is addressed)
//     notes.json      the writer's own notes on her text (comments.ts), one to a line
//     pictures/       the pictures the document shows, written in it as `pictures/name.png`
//
// Unzipped, the folder is an ordinary Markdown document with its pictures beside it. A zip whose
// document.md sits inside one folder (as zipping a folder gives) opens too.
//
// Stores carry a `.quire` document as its Markdown text and its Parts, the two JSON files as text,
// so that a store need not know what is in them; pictures each store keeps its own way. The editor
// turns a document into those and back with `written` and `opened`.

import { type Document } from "./document";
import { read } from "./read";
import { collect, readStyle, restore, type StyleFile } from "./styling";
import { notesData, withNotes } from "./comments";
import { readZip, writeZip, ZipError } from "./zip";
import { freeName } from "./store";
import { pictureType } from "./pictures";

/** What a `.quire` document carries beside its Markdown: style.json and notes.json, as text. */
export interface Parts {
    style: string;
    notes: string;
}

/** A whole `.quire` file, unpacked: the Markdown, the two JSON files and the pictures by name. */
export interface Bundle {
    markdown: string;
    parts: Parts;
    pictures: Map<string, Blob>;
}

/** True if a file's name says it is a `.quire` document. */
export const isQuire = (name: string) => /\.quire$/i.test(name);

/** The parts of a document that has no styling yet. */
export const emptyParts = (): Parts => ({ style: "", notes: "" });

/** Packs a document into the bytes of a `.quire` file. Pictures are stored as they are, being squeezed already. */
export async function packQuire(bundle: Bundle, date?: Date): Promise<Uint8Array> {
    const pictures = await Promise.all([...bundle.pictures].map(async ([name, blob]) => ({ name: `pictures/${name}`, data: new Uint8Array(await blob.arrayBuffer()), store: true })));
    return writeZip(
        [
            { name: "document.md", data: bundle.markdown },
            { name: "style.json", data: bundle.parts.style || "{}\n" },
            { name: "notes.json", data: bundle.parts.notes || "{}\n" },
            ...pictures,
        ],
        date,
    );
}

/** Unpacks the bytes of a `.quire` file. Only a missing document.md is a reason to refuse it. */
export async function unpackQuire(bytes: Uint8Array): Promise<Bundle> {
    const files = await readZip(bytes);
    const document = [...files.keys()].filter((name) => /(^|\/)document\.md$/.test(name)).sort((a, b) => a.length - b.length)[0];
    if (document === undefined) throw new ZipError("this .quire file has no document.md in it");
    const folder = document.slice(0, -"document.md".length);
    const text = (name: string) => (files.has(folder + name) ? new TextDecoder().decode(files.get(folder + name)) : "");
    const pictures = new Map<string, Blob>();
    for (const [name, data] of files) {
        const inside = name.startsWith(`${folder}pictures/`) ? name.slice(folder.length + "pictures/".length) : "";
        // only names that stay in their folder: nothing a reader unpacking the file again could take as a way out of it
        if (PICTURE_NAME.test(inside)) pictures.set(inside, new Blob([data as BlobPart], { type: pictureType(data, inside) }));
    }
    return { markdown: text("document.md"), parts: { style: text("style.json"), notes: text("notes.json") }, pictures };
}

/** The names a picture inside a `.quire` file may have: no folder, no backslash, drive or control character, not starting with a dot. */
const PICTURE_NAME = /^[^./\\:\u0000-\u001f\u007f][^/\\:\u0000-\u001f\u007f]*$/;

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

/** A document as opened from a store: read from its text, and with its parts put back if it is a `.quire` one. */
export function opened(text: string, quire: Parts | undefined, options: { mdx?: boolean } = {}): Document {
    const doc = read(text, { mdx: !quire && !!options.mdx });
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

/** Pictures kept for `.quire` documents held open by a store that writes them as zip files, until they are saved into one. */
export function pictureShelf() {
    const shelves = new Map<string, Map<string, Blob>>();
    const urls = new Map<string, string>();
    const shelf = (id: string) => shelves.get(id) ?? shelves.set(id, new Map()).get(id)!;
    return {
        /** The pictures of a document. */
        get: (id: string) => shelf(id),
        /** Puts a document's pictures on the shelf, as they came out of its file. */
        set(id: string, pictures: Map<string, Blob>) {
            shelves.set(id, new Map(pictures));
        },
        /** Keeps a new picture and gives the address to write in the document. */
        add(id: string, picture: Blob, name: string) {
            const free = freeName(name.replace(/[^\w.-]+/g, "-") || "picture.png", [...shelf(id).keys()]);
            shelf(id).set(free, picture);
            return `pictures/${free}`;
        },
        /** The address a picture written as `pictures/name` can be shown from. */
        show(id: string, address: string) {
            const name = /^(?:\.\/)?pictures\/([^/]+)$/.exec(address)?.[1];
            let plain = name;
            try {
                plain = name && decodeURIComponent(name);
            } catch {
                // an address with a broken escape in it is looked up as it is written
            }
            const picture = name ? (shelf(id).get(plain!) ?? shelf(id).get(name)) : undefined;
            if (!picture || typeof URL.createObjectURL !== "function") return undefined;
            const key = `${id}/${name}`;
            if (!urls.has(key)) urls.set(key, URL.createObjectURL(picture));
            return urls.get(key);
        },
        /** Follows a document that was renamed. */
        move(from: string, to: string) {
            if (from === to) return;
            shelves.set(to, shelf(from));
            shelves.delete(from);
        },
    };
}
