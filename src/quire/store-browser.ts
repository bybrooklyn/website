// Documents kept in this browser, in IndexedDB: several documents with names, each with its version
// history, and pictures kept as blobs beside them. A document taken away goes to a trash it can be
// brought back from. Nothing leaves the browser.
//
// The store is written over Tables, three small tables of records by id, so that its workings are
// tested with tables in memory; indexedTables gives the real ones.

import { freeName, StoreError, type Entry, type Store } from "./store";
import type { VersionInfo, VersionStorage } from "./versions";

/** A record in a table: anything with an id. */
export interface Row {
    id: string;
}

/** Three tables of records by id: documents, versions and pictures. */
export interface Tables {
    get<T extends Row>(table: string, id: string): Promise<T | undefined>;
    put<T extends Row>(table: string, row: T): Promise<void>;
    remove(table: string, id: string): Promise<void>;
    all<T extends Row>(table: string): Promise<T[]>;
}

const TABLES = ["documents", "versions", "pictures"];

/** Tables kept in memory, for tests. */
export function memoryTables(): Tables {
    const tables = new Map<string, Map<string, Row>>(TABLES.map((name) => [name, new Map()]));
    const table = (name: string) => tables.get(name)!;
    return {
        async get<T extends Row>(name: string, id: string) {
            return table(name).get(id) as T | undefined;
        },
        async put(name, row) {
            table(name).set(row.id, structuredClone(row));
        },
        async remove(name, id) {
            table(name).delete(id);
        },
        async all<T extends Row>(name: string) {
            return [...table(name).values()] as T[];
        },
    };
}

/** The browser's own tables, in an IndexedDB database. */
export function indexedTables(name = "quire"): Promise<Tables> {
    return new Promise((done, failed) => {
        const opening = indexedDB.open(name, 1);
        opening.onupgradeneeded = () => {
            for (const table of TABLES) if (!opening.result.objectStoreNames.contains(table)) opening.result.createObjectStore(table, { keyPath: "id" });
        };
        opening.onerror = () => failed(new StoreError("This browser would not keep documents."));
        opening.onsuccess = () => {
            const database = opening.result;
            const ask = <T>(table: string, mode: IDBTransactionMode, run: (store: IDBObjectStore) => IDBRequest<T>) =>
                new Promise<T>((answer, refuse) => {
                    const request = run(database.transaction(table, mode).objectStore(table));
                    request.onsuccess = () => answer(request.result);
                    request.onerror = () => refuse(new StoreError(request.error?.name === "QuotaExceededError" ? "this browser has no more room" : "this browser would not keep it"));
                });
            done({
                get: (table, id) => ask(table, "readonly", (store) => store.get(id)),
                put: async (table, row) => void (await ask(table, "readwrite", (store) => store.put(row))),
                remove: async (table, id) => void (await ask(table, "readwrite", (store) => store.delete(id))),
                all: (table) => ask(table, "readonly", (store) => store.getAll()),
            } as Tables);
        };
    });
}

interface Kept extends Row {
    name: string;
    text: string;
    mark: number;
    modified: number;
    /** When it was taken away, if it was: it is then in the trash. */
    gone?: number;
}

interface Picture extends Row {
    document: string;
    name: string;
    blob: Blob;
}

interface VersionRow extends Row, Omit<VersionInfo, "id"> {
    name: string;
    text: string;
}

/** Version history kept in the same tables, by document. */
export function tableVersions(tables: Tables): VersionStorage {
    return {
        async save(name, text, info) {
            const row: VersionRow = { ...info, id: `${name}:${info.time}:${Math.random().toString(36).slice(2, 8)}`, name, text };
            await tables.put("versions", row);
            const { text: _text, name: _name, ...shown } = row;
            return shown;
        },
        async list(name) {
            const rows = (await tables.all<VersionRow>("versions")).filter((row) => row.name === name);
            return rows.sort((a, b) => b.time - a.time).map(({ text: _text, name: _name, ...shown }) => shown);
        },
        async load(id) {
            return (await tables.get<VersionRow>("versions", id))?.text ?? "";
        },
        async remove(id) {
            await tables.remove("versions", id);
        },
    };
}

/** The browser store, over the given tables. Its extra powers: the trash, and putting a document back from it. */
export function browserStore(tables: Tables, now: () => number = Date.now): Store & { trash(): Promise<Entry[]>; restore(id: string): Promise<void>; versions: VersionStorage } {
    let made = 0;
    const find = async (id: string) => {
        const kept = await tables.get<Kept>("documents", id);
        if (!kept || kept.gone) throw new StoreError("this document is no longer kept here");
        return kept;
    };
    const names = async () => (await tables.all<Kept>("documents")).filter((each) => !each.gone).map((each) => each.name);
    const urls = new Map<string, string>();
    return {
        label: "This browser",
        can: { list: true, create: true, rename: true, remove: true, pictures: true, save: true },
        renameAsTyped: true,
        versions: tableVersions(tables),
        async list() {
            const kept = (await tables.all<Kept>("documents")).filter((each) => !each.gone);
            return kept.sort((a, b) => b.modified - a.modified).map((each) => ({ id: each.id, name: each.name, modified: each.modified }));
        },
        async open(id) {
            const kept = await find(id);
            return { text: kept.text, mark: String(kept.mark) };
        },
        async save(id, text, mark) {
            const kept = await find(id);
            if (String(kept.mark) !== mark) return { ok: false, changed: true, theirs: { text: kept.text, mark: String(kept.mark) } };
            const next = { ...kept, text, mark: kept.mark + 1, modified: now() };
            await tables.put("documents", next);
            return { ok: true, mark: String(next.mark) };
        },
        async create(name, text) {
            const id = `${now().toString(36)}-${(++made).toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
            await tables.put("documents", { id, name: freeName(name.trim() || "Untitled", await names()), text, mark: 1, modified: now() } as Kept);
            return { id, mark: "1" };
        },
        async rename(id, name) {
            const kept = await find(id);
            const taken = (await names()).filter((each) => each !== kept.name);
            await tables.put("documents", { ...kept, name: freeName(name.trim() || kept.name, taken) });
            return id;
        },
        async remove(id) {
            const kept = await find(id);
            await tables.put("documents", { ...kept, gone: now() });
        },
        async trash() {
            const gone = (await tables.all<Kept>("documents")).filter((each) => each.gone);
            return gone.sort((a, b) => b.gone! - a.gone!).map((each) => ({ id: each.id, name: each.name, modified: each.gone }));
        },
        async restore(id) {
            const kept = await tables.get<Kept>("documents", id);
            if (!kept) throw new StoreError("this document is no longer kept here");
            const { gone: _gone, ...back } = kept;
            await tables.put("documents", { ...back, name: freeName(kept.name, await names()) });
        },
        async savePicture(id, picture, name) {
            await find(id);
            const taken = (await tables.all<Picture>("pictures")).filter((each) => each.document === id).map((each) => each.name);
            const free = freeName(name.replace(/[^\w.-]+/g, "-") || "picture.png", taken);
            await tables.put("pictures", { id: `${id}/${free}`, document: id, name: free, blob: picture } as Picture);
            return `pictures/${free}`;
        },
        async show(id, address) {
            const match = /^(?:\.\/)?pictures\/([^/]+)$/.exec(address);
            if (!match) return undefined;
            const key = `${id}/${match[1]}`;
            if (urls.has(key)) return urls.get(key);
            const picture = await tables.get<Picture>("pictures", key);
            if (!picture || typeof URL.createObjectURL !== "function") return undefined;
            const url = URL.createObjectURL(picture.blob);
            urls.set(key, url);
            return url;
        },
    };
}
