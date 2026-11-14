// The `.quire` file: a zip of named files, the same for every kind of document. mdQuire's holds the
// document as plain Markdown and what Markdown cannot hold:
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
// Every store carries a `.quire` document as three things, so that a store need not know what is in
// them: its main text, its Parts (other text files by name, each `name.json` in the zip) and its
// pictures, which each store keeps its own way. The main text is `document.md` unless the document
// says another file (`main`): imgQuire's is `steps.json`, its original kept as a picture beside it.
// mdQuire's parts are `style` and `notes`, and it never names a main file, so its documents are
// kept exactly as they were before other kinds came. mdQuire turns a document into these and back
// in md/quire-parts.ts.

import { readZip, writeZip, ZipError } from "./zip";
import { freeName } from "./store";
import { pictureType } from "./picture-bytes";

/** What a `.quire` document carries beside its main text: text files by name, each kept as `name.json` (mdQuire's `style` and `notes`). */
export type Parts = Record<string, string>;

/** The main text's file when a document names none. */
export const MAIN = "document.md";

/** A whole `.quire` file, unpacked: the main text and its file's name if not `document.md`, the parts, and the pictures by name. */
export interface Bundle {
    text: string;
    main?: string;
    parts: Parts;
    pictures: Map<string, Blob>;
}

/** True if a file's name says it is a `.quire` document. */
export const isQuire = (name: string) => /\.quire$/i.test(name);

/** The parts of a document that has no styling yet. */
export const emptyParts = (): Parts => ({ style: "", notes: "" });

/** True when the document's text still shows a picture of this name. */
const shown = (text: string, name: string) => text.includes(`pictures/${name}`) || text.includes(`pictures/${encodeURI(name)}`) || text.includes(`pictures/${encodeURIComponent(name)}`);

/** The name a part may have: plain letters, digits and dashes, so that its file stays at the top of the zip. */
const PART_NAME = /^[\w-]{1,40}$/;

/**
 * Packs a document into the bytes of a `.quire` file. Pictures are stored as they are, being
 * squeezed already, and only those its text still shows: a photograph taken out of the writing
 * does not travel on inside the file given to someone.
 */
export async function packQuire(bundle: Bundle, date?: Date): Promise<Uint8Array> {
    const kept = [...bundle.pictures].filter(([name]) => shown(bundle.text, name));
    const pictures = await Promise.all(kept.map(async ([name, blob]) => ({ name: `pictures/${name}`, data: new Uint8Array(await blob.arrayBuffer()), store: true })));
    const main = bundle.main ?? MAIN;
    // a Markdown document always has its style.json and notes.json, written as an empty object when it has no styling yet, as it always has
    const parts = main === MAIN ? { style: "", notes: "", ...bundle.parts } : bundle.parts;
    return writeZip(
        [
            { name: main, data: bundle.text },
            ...Object.entries(parts)
                .filter(([name]) => PART_NAME.test(name) && `${name}.json` !== main)
                .map(([name, data]) => ({ name: `${name}.json`, data: data || "{}\n" })),
            ...pictures,
        ],
        date,
    );
}

/**
 * Unpacks the bytes of a `.quire` file. Its main text is `document.md`, or the first of `mains` (the
 * main files other kinds name) that it holds; only having none of them is a reason to refuse it.
 */
export async function unpackQuire(bytes: Uint8Array, mains: string[] = []): Promise<Bundle> {
    const files = await readZip(bytes);
    const found = (main: string) => [...files.keys()].filter((name) => name === main || name.endsWith(`/${main}`)).sort((a, b) => a.length - b.length)[0];
    const main = [MAIN, ...mains].find((each) => found(each) !== undefined);
    if (main === undefined) throw new ZipError("this .quire file has no document.md in it");
    const document = found(main)!;
    const folder = document.slice(0, -main.length);
    const text = (name: string) => (files.has(folder + name) ? new TextDecoder().decode(files.get(folder + name)) : "");
    // a Markdown document's parts are its two files, as they always were; another kind's are every JSON file beside its main one
    const parts: Parts = main === MAIN ? { style: text("style.json"), notes: text("notes.json") } : {};
    if (main !== MAIN)
        for (const name of files.keys()) {
            const part = name.startsWith(folder) ? /^([\w-]{1,40})\.json$/.exec(name.slice(folder.length))?.[1] : undefined;
            if (part && `${part}.json` !== main) parts[part] = text(name.slice(folder.length));
        }
    const pictures = new Map<string, Blob>();
    for (const [name, data] of files) {
        const inside = name.startsWith(`${folder}pictures/`) ? name.slice(folder.length + "pictures/".length) : "";
        // only names that stay in their folder: nothing a reader unpacking the file again could take as a way out of it
        if (PICTURE_NAME.test(inside)) pictures.set(inside, new Blob([data as BlobPart], { type: pictureType(data, inside) }));
    }
    return { text: text(main), ...(main === MAIN ? {} : { main }), parts, pictures };
}

/** The names a picture inside a `.quire` file may have: no folder, no backslash, drive or control character, not starting with a dot. */
const PICTURE_NAME = /^[^./\\:\u0000-\u001f\u007f][^/\\:\u0000-\u001f\u007f]*$/;

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
