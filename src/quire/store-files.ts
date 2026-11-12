// Files opened from the computer with a file input and saved by downloading them again: the way
// that works in every browser. An opened file is held in this tab while it is written; the status
// says so, and Download gives it back with its own name. Pictures cannot go beside a file that
// lives nowhere yet, so this store does not keep them.

import { fileName, freeName, StoreError, type Entry, type Store } from "./store";

/** The kinds of file that can be opened as documents. */
export const OPENABLE = ".md,.mdx,.markdown,.txt,text/markdown,text/plain";

/** True if a file's name says it is a document mdQuire can open. */
export const openable = (name: string) => /\.(md|mdx|markdown|txt)$/i.test(name);

/** The files store. `add` takes a file the visitor chose and gives the entry to open. */
export function filesStore(): Store & { add(file: Blob & { name: string }): Promise<Entry> } {
    const held = new Map<string, { name: string; text: string; mark: number }>();
    let count = 0;
    const find = (id: string) => {
        const file = held.get(id);
        if (!file) throw new StoreError("this file is no longer open here");
        return file;
    };
    const names = () => [...held.values()].map((file) => file.name);
    return {
        label: "Files on this computer",
        note: "Download it to keep it.",
        can: { list: true, create: true, rename: true, remove: true, pictures: false, save: true },
        async add(file) {
            if (!openable(file.name)) throw new StoreError("only Markdown and text files can be opened");
            const id = `file-${++count}`;
            held.set(id, { name: freeName(file.name, names()), text: await file.text(), mark: 1 });
            return { id, name: held.get(id)!.name };
        },
        async list() {
            return [...held.entries()].map(([id, file]) => ({ id, name: file.name }));
        },
        async open(id) {
            const file = find(id);
            return { text: file.text, mark: String(file.mark) };
        },
        async save(id, text, mark) {
            const file = find(id);
            if (String(file.mark) !== mark) return { ok: false, changed: true, theirs: { text: file.text, mark: String(file.mark) } };
            file.text = text;
            file.mark++;
            return { ok: true, mark: String(file.mark) };
        },
        async create(name, text) {
            const id = `file-${++count}`;
            held.set(id, { name: freeName(fileName(name), names()), text, mark: 1 });
            return { id, mark: "1" };
        },
        async rename(id, name) {
            const file = find(id);
            file.name = freeName(fileName(name, /\.mdx$/i.test(file.name) ? ".mdx" : ".md"), names().filter((each) => each !== file.name));
            return id;
        },
        async remove(id) {
            held.delete(id);
        },
        async savePicture() {
            throw new StoreError("a file opened from the computer cannot keep pictures beside it; open its folder instead");
        },
    };
}
