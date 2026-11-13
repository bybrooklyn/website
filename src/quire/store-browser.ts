// Documents kept in this browser, in IndexedDB: several documents with names, each with its version
// history, and pictures kept as blobs beside them. A document taken away goes to a trash it can be
// brought back from. Nothing leaves the browser. A document made here is a `.quire` one, its
// style.json and notes.json kept beside its text, so it can be given every kind of styling, unless
// it was made as plain Markdown (a blog post, which the site needs as Markdown); either is written
// out as itself when it is downloaded.
//
// The store is written over Tables, three small tables of records by id, so that its workings are
// tested with tables in memory; indexedTables gives the real ones.

import { emptyParts, type Parts } from "./quire-file";
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

/** What went wrong in the browser's storage, in plain words. */
const refusal = (error: unknown) => new StoreError((error as DOMException | null)?.name === "QuotaExceededError" ? "this browser has no more room" : "this browser would not keep it");

/**
 * The browser's own tables, in an IndexedDB database. A write is done only once its transaction has
 * committed: a request can succeed and its transaction still fail at the end (no more room, the
 * storage cleared), and that is a failure. A connection the browser closes is opened again.
 * `factory` is the browser's IndexedDB, given so that a test can stand in for it.
 */
export async function indexedTables(name = "quire", factory: IDBFactory = globalThis.indexedDB): Promise<Tables> {
    const connect = () =>
        new Promise<IDBDatabase>((done, failed) => {
            let opening: IDBOpenDBRequest;
            try {
                opening = factory.open(name, 1);
            } catch {
                return failed(new StoreError("This browser would not keep documents."));
            }
            opening.onupgradeneeded = () => {
                for (const table of TABLES) if (!opening.result.objectStoreNames.contains(table)) opening.result.createObjectStore(table, { keyPath: "id" });
            };
            opening.onerror = () => failed(new StoreError("This browser would not keep documents."));
            opening.onsuccess = () => {
                const made = opening.result;
                // another tab upgrading the database, or the browser closing it: this connection goes, and the next call opens a new one
                made.onversionchange = () => {
                    made.close();
                    stale = true;
                };
                made.onclose = () => (stale = true);
                done(made);
            };
        });
    let stale = false;
    let database: Promise<IDBDatabase> = connect();
    await database;
    const reconnect = () => {
        stale = false;
        database = connect();
    };
    /** Runs some work in one transaction and gives what it gave once the transaction has committed. */
    async function within<T>(table: string, mode: IDBTransactionMode, work: (store: IDBObjectStore, give: (value: T) => void, fail: (error: unknown) => void) => void, again = true): Promise<T> {
        let connection: IDBDatabase;
        let transaction: IDBTransaction;
        try {
            if (stale) reconnect();
            connection = await database;
            transaction = connection.transaction(table, mode);
        } catch (error) {
            // a closed connection is opened again, once
            if (!again) throw refusal(error);
            reconnect();
            return within(table, mode, work, false);
        }
        return new Promise<T>((done, failed) => {
            let value: T;
            let thrown: unknown;
            transaction.oncomplete = () => done(value);
            transaction.onabort = () => failed(thrown ?? refusal(transaction.error));
            const fail = (error: unknown) => {
                thrown = error;
                try {
                    transaction.abort();
                } catch {
                    // already finished: it is failed below in any case
                }
            };
            try {
                work(transaction.objectStore(table), (given) => (value = given), fail);
            } catch (error) {
                fail(error);
            }
        });
    }
    /** Runs one request and gives its result, once the transaction has committed. */
    const ask = <T>(table: string, mode: IDBTransactionMode, run: (store: IDBObjectStore) => IDBRequest<T>) =>
        within<T>(table, mode, (store, give) => {
            const request = run(store);
            request.onsuccess = () => give(request.result);
        });
    return {
        get: (table, id) => ask(table, "readonly", (store) => store.get(id)),
        put: async (table, row) => void (await ask(table, "readwrite", (store) => store.put(row))),
        remove: async (table, id) => void (await ask(table, "readwrite", (store) => store.delete(id))),
        all: (table) => ask(table, "readonly", (store) => store.getAll()),
    } as Tables;
}

interface Kept extends Row {
    name: string;
    text: string;
    mark: number;
    modified: number;
    /** Its style.json and notes.json; a document kept before there were any has none yet. */
    quire?: Parts;
    /** True for a document made as plain Markdown, which has no parts and is not given any. */
    markdown?: boolean;
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

/** A kept document's parts: none for one made as Markdown, empty ones for a `.quire` document kept before there were any. */
const partsOf = (kept: Kept): Parts | undefined => (kept.markdown ? undefined : (kept.quire ?? emptyParts()));

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
        quire: true,
        can: { list: true, create: true, rename: true, remove: true, pictures: true, save: true },
        renameAsTyped: true,
        versions: tableVersions(tables),
        async list() {
            const kept = (await tables.all<Kept>("documents")).filter((each) => !each.gone);
            return kept.sort((a, b) => b.modified - a.modified).map((each) => ({ id: each.id, name: each.name, modified: each.modified }));
        },
        async open(id) {
            const kept = await find(id);
            return { text: kept.text, mark: String(kept.mark), quire: partsOf(kept) };
        },
        async save(id, text, mark, quire) {
            const kept = await find(id);
            if (String(kept.mark) !== mark) return { ok: false, changed: true, theirs: { text: kept.text, mark: String(kept.mark), quire: partsOf(kept) } };
            const next = { ...kept, text, mark: kept.mark + 1, modified: now(), quire: kept.markdown ? undefined : (quire ?? kept.quire) };
            await tables.put("documents", next);
            return { ok: true, mark: String(next.mark) };
        },
        // made without parts, a document is plain Markdown and stays so
        async create(name, text, quire) {
            const id = `${now().toString(36)}-${(++made).toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
            await tables.put("documents", { id, name: freeName(name.trim() || "Untitled", await names()), text, mark: 1, modified: now(), ...(quire ? { quire } : { markdown: true }) } as Kept);
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
        async pictures(id) {
            const kept = (await tables.all<Picture>("pictures")).filter((each) => each.document === id);
            return new Map(kept.map((each) => [each.name, each.blob]));
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
