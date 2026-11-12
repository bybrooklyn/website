// Real files, written in place, through the browser's File System Access API: one file, or a
// folder whose Markdown files are listed. Saving writes straight back to the file; its version mark
// is when it was last changed and how long it is, so a change made elsewhere is noticed. Pictures
// are written into the document's own folder. A file taken away is moved into a `.quire-trash`
// folder beside it, from where it can be brought back by hand. A `.quire` file is read and written
// whole as a zip, its pictures inside it rather than beside it.
//
// Browsers without the API (Firefox and Safari, as this is written) have no such choice; `canOpen`
// says which way it is. The store works over the shapes of the API's handles, so it is tested with
// handles kept in memory.

import { isQuire, packQuire, pictureShelf, unpackQuire, type Parts } from "./quire-file";
import { fileName, freeName, StoreError, type Opened, type Store } from "./store";
import { openable } from "./store-files";

/** The part of a file handle the store uses. */
export interface FileHandle {
    kind: "file";
    name: string;
    getFile(): Promise<{ text(): Promise<string>; lastModified: number; size: number; type?: string } & Blob>;
    createWritable(): Promise<{ write(data: string | Blob): Promise<void>; close(): Promise<void> }>;
    requestPermission?(options: { mode: "readwrite" }): Promise<string>;
}

/** The part of a folder handle the store uses. */
export interface FolderHandle {
    kind: "directory";
    name: string;
    values(): AsyncIterable<FileHandle | FolderHandle>;
    getFileHandle(name: string, options?: { create?: boolean }): Promise<FileHandle>;
    getDirectoryHandle(name: string, options?: { create?: boolean }): Promise<FolderHandle>;
    removeEntry(name: string): Promise<void>;
    requestPermission?(options: { mode: "readwrite" }): Promise<string>;
}

/** Whether this browser can open real files and folders to write them in place. */
export function canOpen(): { file: boolean; folder: boolean } {
    const window = globalThis as { showOpenFilePicker?: unknown; showDirectoryPicker?: unknown };
    return { file: typeof window.showOpenFilePicker === "function", folder: typeof window.showDirectoryPicker === "function" };
}

const markOf = (file: { lastModified: number; size: number }) => `${file.lastModified}:${file.size}`;
/** Folders not worth looking in for documents. */
const SKIPPED = /^(\.|node_modules$|dist$|build$)/;

/** What a file holds, as a store opens it: a `.quire` file unpacked, its pictures put on the shelf. */
async function readFile(file: Blob & { lastModified: number; size: number }, id: string, shelf: ReturnType<typeof pictureShelf>, keep = true): Promise<Opened> {
    if (!isQuire(id)) return { text: await file.text(), mark: markOf(file) };
    const bundle = await unpackQuire(new Uint8Array(await file.arrayBuffer()));
    if (keep) shelf.set(id, bundle.pictures);
    return { text: bundle.markdown, mark: markOf(file), quire: bundle.parts };
}

/** What is written into a file: the text, or for a `.quire` file the zip of it with its pictures. */
async function fileData(id: string, text: string, quire: Parts | undefined, shelf: ReturnType<typeof pictureShelf>): Promise<string | Blob> {
    if (!isQuire(id)) return text;
    return new Blob([(await packQuire({ markdown: text, parts: quire ?? { style: "", notes: "" }, pictures: shelf.get(id) })) as BlobPart], { type: "application/zip" });
}

async function write(handle: FileHandle, data: string | Blob) {
    if (handle.requestPermission && (await handle.requestPermission({ mode: "readwrite" })) !== "granted") throw new StoreError("permission to write the file was not given");
    const writable = await handle.createWritable();
    await writable.write(data);
    await writable.close();
}

/** A store over a folder: its Markdown files, a few folders deep, by their paths inside it. */
export function folderStore(root: FolderHandle): Store {
    const shelf = pictureShelf();
    // the parts last saved for each `.quire` file, so that a save with the text alone keeps them
    const kept = new Map<string, Parts>();
    const parts = (path: string) => path.split("/").filter(Boolean);
    async function folderOf(path: string, create = false): Promise<FolderHandle> {
        let folder = root;
        for (const part of parts(path).slice(0, -1)) folder = await folder.getDirectoryHandle(part, { create });
        return folder;
    }
    async function fileAt(path: string, create = false): Promise<FileHandle> {
        try {
            return await (await folderOf(path, create)).getFileHandle(parts(path).at(-1)!, { create });
        } catch {
            throw new StoreError(`${path} is not in the folder any more`);
        }
    }
    async function walk(folder: FolderHandle, prefix: string, depth: number, found: { id: string; name: string; modified?: number }[]) {
        for await (const entry of folder.values()) {
            if (entry.kind === "directory") {
                if (depth < 3 && !SKIPPED.test(entry.name)) await walk(entry, `${prefix}${entry.name}/`, depth + 1, found);
            } else if (openable(entry.name)) found.push({ id: `${prefix}${entry.name}`, name: `${prefix}${entry.name}`, modified: (await entry.getFile()).lastModified });
        }
        return found;
    }
    const taken = async (path: string) => {
        const folder = await folderOf(path).catch(() => undefined);
        const names: string[] = [];
        if (folder) for await (const entry of folder.values()) names.push(entry.name);
        return names;
    };
    return {
        label: root.name,
        can: { list: true, create: true, rename: true, remove: true, pictures: true, save: true },
        async list() {
            const found = await walk(root, "", 0, []);
            return found.sort((a, b) => a.id.localeCompare(b.id));
        },
        async open(id) {
            const opened = await readFile(await (await fileAt(id)).getFile(), id, shelf);
            if (opened.quire) kept.set(id, opened.quire);
            return opened;
        },
        async save(id, text, mark, quire) {
            const handle = await fileAt(id);
            const before = await handle.getFile();
            if (markOf(before) !== mark) return { ok: false, changed: true, theirs: await readFile(before, id, shelf, false) };
            if (quire) kept.set(id, quire);
            await write(handle, await fileData(id, text, kept.get(id), shelf));
            return { ok: true, mark: markOf(await handle.getFile()) };
        },
        async create(name, text, quire) {
            const wanted = quire ? fileName(name.replace(/\.(md|mdx|markdown|txt)$/i, ""), ".quire") : fileName(name);
            const path = freeName(wanted, await taken(wanted));
            const handle = await fileAt(path, true);
            if (quire) kept.set(path, quire);
            await write(handle, await fileData(path, text, quire, shelf));
            return { id: path, mark: markOf(await handle.getFile()) };
        },
        async rename(id, name) {
            const old = await fileAt(id);
            const body = await old.getFile();
            const folder = parts(id).slice(0, -1).join("/");
            const wanted = isQuire(id) ? fileName(name.replace(/\.(md|mdx|markdown|txt)$/i, ""), ".quire") : fileName(name, /\.mdx$/i.test(id) ? ".mdx" : ".md");
            const path = freeName(folder ? `${folder}/${wanted}` : wanted, (await taken(id)).map((each) => (folder ? `${folder}/${each}` : each)));
            await write(await fileAt(path, true), body);
            await (await folderOf(id)).removeEntry(parts(id).at(-1)!);
            shelf.move(id, path);
            if (kept.has(id)) kept.set(path, kept.get(id)!);
            return path;
        },
        async remove(id) {
            // it goes into the trash folder first, so that it can be brought back
            const old = await fileAt(id);
            const file = await old.getFile();
            const folder = await folderOf(id);
            const trash = await folder.getDirectoryHandle(".quire-trash", { create: true });
            const names: string[] = [];
            for await (const entry of trash.values()) names.push(entry.name);
            await write(await trash.getFileHandle(freeName(old.name, names), { create: true }), file);
            await folder.removeEntry(old.name);
        },
        async savePicture(id, picture, name) {
            if (isQuire(id)) return shelf.add(id, picture, name);
            const folder = await folderOf(id);
            const names: string[] = [];
            for await (const entry of folder.values()) names.push(entry.name);
            const free = freeName(name.replace(/[^\w.-]+/g, "-") || "picture.png", names);
            await write(await folder.getFileHandle(free, { create: true }), picture);
            return `./${free}`;
        },
        async pictures(id) {
            return shelf.get(id);
        },
        async show(id, address) {
            if (isQuire(id)) return shelf.show(id, address);
            if (!/^\.?\/?[\w.-]+$/.test(address) || /^[a-z]+:/i.test(address)) return undefined;
            const handle = await (await folderOf(id)).getFileHandle(address.replace(/^\.\//, "")).catch(() => undefined);
            return handle && typeof URL.createObjectURL === "function" ? URL.createObjectURL(await handle.getFile()) : undefined;
        },
    };
}

/** A store over one file chosen on its own: it can be written, but there is no folder to keep pictures or other documents in. */
export function oneFileStore(handle: FileHandle): Store {
    const shelf = pictureShelf();
    const id = handle.name;
    let kept: Parts | undefined;
    return {
        label: handle.name,
        // a `.quire` file keeps its pictures inside it; a Markdown file alone has nowhere to put them
        can: { list: true, create: false, rename: false, remove: false, pictures: isQuire(id), save: true },
        async list() {
            return [{ id, name: handle.name }];
        },
        async open() {
            const opened = await readFile(await handle.getFile(), id, shelf);
            kept = opened.quire;
            return opened;
        },
        async save(_id, text, mark, quire) {
            const before = await handle.getFile();
            if (markOf(before) !== mark) return { ok: false, changed: true, theirs: await readFile(before, id, shelf, false) };
            if (quire) kept = quire;
            await write(handle, await fileData(id, text, kept, shelf));
            return { ok: true, mark: markOf(await handle.getFile()) };
        },
        async pictures() {
            return shelf.get(id);
        },
        async show(_id, address) {
            return isQuire(id) ? shelf.show(id, address) : undefined;
        },
        async create() {
            throw new StoreError("open a folder to make new documents in it");
        },
        async rename() {
            throw new StoreError("open its folder to rename a file");
        },
        async remove() {
            throw new StoreError("open its folder to take a file away");
        },
        async savePicture(_id, picture, name) {
            if (isQuire(id)) return shelf.add(id, picture, name);
            throw new StoreError("open the file's folder to keep pictures beside it");
        },
    };
}

/** Handles kept in memory, shaped as the browser's are: for tests, and for trying the store without a disk. */
export function memoryFolder(name: string, files: Record<string, string | Blob> = {}, clock: () => number = Date.now): FolderHandle {
    const folder = (title: string): FolderHandle & { entries: Map<string, FileHandle | FolderHandle> } => {
        const entries = new Map<string, FileHandle | FolderHandle>();
        return {
            kind: "directory",
            name: title,
            entries,
            async *values() {
                yield* entries.values();
            },
            async getFileHandle(file, options) {
                const found = entries.get(file);
                if (found?.kind === "file") return found;
                if (found || !options?.create) throw new Error("NotFoundError");
                const made = fileHandle(file);
                entries.set(file, made);
                return made;
            },
            async getDirectoryHandle(child, options) {
                const found = entries.get(child);
                if (found?.kind === "directory") return found;
                if (found || !options?.create) throw new Error("NotFoundError");
                const made = folder(child);
                entries.set(child, made);
                return made;
            },
            async removeEntry(entry) {
                if (!entries.delete(entry)) throw new Error("NotFoundError");
            },
        };
    };
    const fileHandle = (title: string, body: Blob = new Blob([""])): FileHandle & { body(): Blob } => {
        let content = body;
        let modified = clock();
        return {
            kind: "file",
            name: title,
            body: () => content,
            async getFile() {
                return new File([content], title, { lastModified: modified, type: content.type });
            },
            async createWritable() {
                return {
                    async write(data: string | Blob) {
                        content = typeof data === "string" ? new Blob([data]) : data;
                    },
                    async close() {
                        modified = clock();
                    },
                };
            },
        };
    };
    const root = folder(name);
    for (const [path, text] of Object.entries(files)) {
        const steps = path.split("/");
        let at = root;
        for (const step of steps.slice(0, -1)) {
            if (!at.entries.has(step)) at.entries.set(step, folder(step));
            at = at.entries.get(step) as typeof root;
        }
        at.entries.set(steps.at(-1)!, fileHandle(steps.at(-1)!, typeof text === "string" ? new Blob([text]) : text));
    }
    return root;
}
