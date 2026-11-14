// What the browser store is held to, over tables in memory (the browser test runs it over
// IndexedDB): documents are listed newest first, saved only on the mark they were opened with,
// renamed without taking another's name, taken away to a trash and brought back, with pictures and
// version history beside them. Run with `bun test src/quire`.

import { expect, test } from "bun:test";
import { browserStore, indexedTables, memoryTables } from "./store-browser";
import { createSaver } from "./store";

test("a document made in the browser with parts is a .quire one, its style and notes saved beside its text, its pictures given back for a download", async () => {
    const store = browserStore(memoryTables());
    const made = await store.create("Styled", "Words.\n", { style: '{"quire":1}', notes: "{}" });
    const saved = await store.save(made.id, "Words, more.\n", made.mark, { style: '{"quire":1,"count":1}', notes: "{}" });
    expect(saved.ok).toBe(true);
    expect((await store.open(made.id)).quire).toEqual({ style: '{"quire":1,"count":1}', notes: "{}" });
    // saving the text alone keeps the parts it had
    await store.save(made.id, "Words again.\n", saved.ok ? saved.mark : "");
    expect((await store.open(made.id)).quire?.style).toBe('{"quire":1,"count":1}');
    await store.savePicture(made.id, new Blob(["png"]), "a.png");
    expect([...(await store.pictures!(made.id)).keys()]).toEqual(["a.png"]);
});

test("documents are made, listed newest first, opened and saved on their mark", async () => {
    let time = 1;
    const store = browserStore(memoryTables(), () => time++);
    const first = await store.create("First", "one");
    const second = await store.create("Second", "two");
    expect((await store.list()).map((entry) => entry.name)).toEqual(["Second", "First"]);
    expect(await store.open(first.id)).toEqual({ text: "one", mark: "1", quire: undefined });
    const saved = await store.save(first.id, "one, changed", first.mark);
    expect(saved).toEqual({ ok: true, mark: "2" });
    expect((await store.list())[0]!.id).toBe(first.id);
    // saving again on the old mark is refused, with their text
    expect(await store.save(first.id, "stale", first.mark)).toEqual({ ok: false, changed: true, theirs: { text: "one, changed", mark: "2", quire: undefined } });
    expect((await store.open(second.id)).text).toBe("two");
});

test("a name is never taken twice, and renaming keeps it free", async () => {
    const store = browserStore(memoryTables());
    await store.create("Notes", "");
    const other = await store.create("Notes", "");
    expect((await store.list()).map((entry) => entry.name).sort()).toEqual(["Notes", "Notes-2"]);
    await store.rename(other.id, "Notes");
    expect((await store.list()).map((entry) => entry.name).sort()).toEqual(["Notes", "Notes-2"]);
    await store.rename(other.id, "Plans");
    expect((await store.list()).map((entry) => entry.name).sort()).toEqual(["Notes", "Plans"]);
});

test("a document taken away goes to the trash and can be brought back", async () => {
    const store = browserStore(memoryTables());
    const kept = await store.create("Draft", "words");
    await store.remove(kept.id);
    expect(await store.list()).toEqual([]);
    expect((await store.trash()).map((entry) => entry.name)).toEqual(["Draft"]);
    expect(await store.open(kept.id).then(() => "", (error) => String(error))).toContain("no longer kept");
    await store.restore(kept.id);
    expect((await store.open(kept.id)).text).toBe("words");
    expect(await store.trash()).toEqual([]);
});

test("pictures are kept beside their document with an address relative to it, never two with one name", async () => {
    const store = browserStore(memoryTables());
    const kept = await store.create("Post", "");
    const picture = new Blob(["png"], { type: "image/png" });
    expect(await store.savePicture(kept.id, picture, "a cat.png")).toBe("pictures/a-cat.png");
    expect(await store.savePicture(kept.id, picture, "a cat.png")).toBe("pictures/a-cat-2.png");
});

test("version history is kept in the same tables, by document, newest first", async () => {
    const store = browserStore(memoryTables());
    await store.versions.save("doc-a", "one", { time: 1, added: 1, removed: 0 });
    const second = await store.versions.save("doc-a", "two", { time: 2, added: 1, removed: 1 });
    await store.versions.save("doc-b", "x", { time: 3, added: 1, removed: 0 });
    expect((await store.versions.list("doc-a")).map((each) => each.time)).toEqual([2, 1]);
    expect(await store.versions.load(second.id)).toBe("two");
    await store.versions.remove(second.id);
    expect((await store.versions.list("doc-a")).length).toBe(1);
});

test("a document made without parts is plain Markdown and stays so when saved; one kept before there were parts opens as a .quire document", async () => {
    const tables = memoryTables();
    const store = browserStore(tables);
    const post = await store.create("A new post", "---\ntitle: A new post\n---\n");
    const saved = await store.save(post.id, "---\ntitle: Changed\n---\n", post.mark, { style: "{}", notes: "{}" });
    expect(saved.ok).toBe(true);
    expect((await store.open(post.id)).quire).toBeUndefined();
    await tables.put("documents", { id: "old", name: "Old", text: "x", mark: 1, modified: 1 });
    expect((await store.open("old")).quire).toEqual({ style: "", notes: "" });
});

/**
 * A stand-in for the browser's IndexedDB, just enough for the store: requests succeed a moment after
 * they are made, and the transaction commits a moment after its last request, or, when asked,
 * fails at that point as a full disk makes a real one fail after its requests have succeeded.
 */
function standInIndexedDB() {
    const tables = new Map<string, Map<string, unknown>>();
    const state = { failAtCommit: false };
    const soon = (run: () => void) => setTimeout(run, 0);
    // as in a real database, a transaction that writes waits for the one before it to finish
    let turn: Promise<void> = Promise.resolve();
    const database = {
        objectStoreNames: { contains: (name: string) => tables.has(name) },
        createObjectStore: (name: string) => tables.set(name, new Map()),
        close() {},
        transaction(name: string, mode = "readonly") {
            const table = tables.get(name)!;
            const writes: [string, unknown][] = [];
            let waiting = 0;
            let finished = false;
            let release = () => {};
            const gate = mode === "readwrite" ? turn : Promise.resolve();
            if (mode === "readwrite") turn = new Promise((done) => (release = done));
            const transaction: Record<string, unknown> & { oncomplete?: () => void; onabort?: () => void; error: unknown } = {
                error: null,
                abort() {
                    if (finished) throw new Error("InvalidStateError");
                    finished = true;
                    release();
                    transaction.error = { name: "AbortError" };
                    soon(() => transaction.onabort?.());
                },
                objectStore: () => store,
            };
            const settle = () =>
                soon(() => {
                    if (finished || waiting > 0) return;
                    finished = true;
                    release();
                    if (state.failAtCommit && writes.length) {
                        transaction.error = { name: "QuotaExceededError" };
                        return transaction.onabort?.();
                    }
                    for (const [key, value] of writes) value === undefined ? table.delete(key) : table.set(key, structuredClone(value));
                    transaction.oncomplete?.();
                });
            const request = (answer: () => unknown) => {
                const made: { result?: unknown; onsuccess?: () => void } = {};
                waiting++;
                void gate.then(() =>
                    soon(() => {
                        made.result = answer();
                        waiting--;
                        made.onsuccess?.();
                        settle();
                    }),
                );
                return made;
            };
            const store = {
                get: (id: string) => request(() => writes.findLast(([key]) => key === id)?.[1] ?? table.get(id)),
                getAll: () => request(() => [...table.values()]),
                put: (row: { id: string }) => request(() => (writes.push([row.id, row]), row.id)),
                delete: (id: string) => request(() => writes.push([id, undefined])),
            };
            return transaction;
        },
    };
    const factory = {
        open() {
            const opening: { result?: unknown; onupgradeneeded?: () => void; onsuccess?: () => void } = {};
            soon(() => {
                opening.result = database;
                opening.onupgradeneeded?.();
                opening.onsuccess?.();
            });
            return opening;
        },
    };
    return { factory: factory as unknown as IDBFactory, state, tables };
}

test("a write to the browser's storage is done only when its transaction commits; one that fails at the end is a failure, not saved", async () => {
    const stand = standInIndexedDB();
    const store = browserStore(await indexedTables("quire", stand.factory));
    const made = await store.create("Draft", "first");
    expect((await store.open(made.id)).text).toBe("first");
    stand.state.failAtCommit = true;
    await expect(store.save(made.id, "second", made.mark)).rejects.toThrow("this browser has no more room");
    stand.state.failAtCommit = false;
    expect((await store.open(made.id)).text).toBe("first");
    // and the saver says so, keeping the words waiting
    stand.state.failAtCommit = true;
    const saver = createSaver(store, made.id, made.mark, { wait: (run) => (run(), () => {}) });
    saver.changed("second");
    await saver.settled();
    expect(saver.status()).toEqual({ state: "failed", message: "this browser has no more room" });
    expect(saver.unsaved()).toBe("second");
});

test("two tabs saving one document on the same mark: the second is refused as changed elsewhere, never silently written over the first", async () => {
    const tables = memoryTables();
    const first = browserStore(tables);
    const second = browserStore(tables);
    const made = await first.create("Shared", "original");
    const [one, two] = await Promise.all([first.save(made.id, "from the first tab", made.mark), second.save(made.id, "from the second tab", made.mark)]);
    expect([one.ok, two.ok]).toEqual([true, false]);
    expect(two).toMatchObject({ changed: true, theirs: { text: "from the first tab" } });
    expect((await first.open(made.id)).text).toBe("from the first tab");
    // over the browser's own database too, with one transaction for the check and the write
    const stand = standInIndexedDB();
    const tabA = browserStore(await indexedTables("quire", stand.factory));
    const tabB = browserStore(await indexedTables("quire", stand.factory));
    const doc = await tabA.create("Shared", "original");
    const results = await Promise.all([tabA.save(doc.id, "A", doc.mark), tabB.save(doc.id, "B", doc.mark)]);
    expect(results.filter((each) => each.ok).length).toBe(1);
    expect(results.filter((each) => !each.ok && each.changed).length).toBe(1);
});

test("a rename made while a save is on its way keeps the saved text", async () => {
    const store = browserStore(memoryTables());
    const made = await store.create("Draft", "before");
    await Promise.all([store.rename(made.id, "Renamed"), store.save(made.id, "after", made.mark)]);
    expect(await store.open(made.id)).toMatchObject({ text: "after", mark: "2" });
    expect((await store.list())[0]!.name).toBe("Renamed");
});

test("a request the browser refuses at once is said in plain words too, and a store's own reason as it is", async () => {
    const stand = standInIndexedDB();
    const store = browserStore(await indexedTables("quire", stand.factory));
    const made = await store.create("Draft", "first");
    const real = stand.factory.open;
    // the database's put refuses at once, as Chrome does when there is no room
    const tables = await indexedTables("quire", {
        open() {
            const opening = real.call(stand.factory, "quire") as unknown as { onsuccess?: () => void; result?: { transaction: (name: string, mode: string) => { objectStore: () => Record<string, unknown> } } };
            const done = () => {
                const database = opening.result!;
                const transaction = database.transaction.bind(database);
                database.transaction = (name: string, mode: string) => {
                    const made = transaction(name, mode);
                    const store = made.objectStore();
                    made.objectStore = () => ({ ...store, put: () => { throw Object.assign(new Error("full"), { name: "QuotaExceededError" }); } });
                    return made;
                };
            };
            const wrapped = { set onsuccess(run: () => void) { opening.onsuccess = () => (done(), run()); }, get result() { return opening.result; }, set onupgradeneeded(run: () => void) { (opening as { onupgradeneeded?: () => void }).onupgradeneeded = run; }, set onerror(_run: () => void) {} };
            return wrapped;
        },
    } as unknown as IDBFactory);
    await expect(browserStore(tables).save(made.id, "second", made.mark)).rejects.toThrow("this browser has no more room");
    await expect(browserStore(tables).save("nothing", "x", "1")).rejects.toThrow("this document is no longer kept here");
});

test("a document kept before other kinds came opens as it did, and saving it writes the same row, naming no main file", async () => {
    const tables = memoryTables();
    const row = { id: "old-1", name: "Letter", text: "Dear all,\n", mark: 3, modified: 5, quire: { style: "{\"quire\":1}", notes: "{}" } };
    await tables.put("documents", row);
    await tables.put("documents", { id: "old-2", name: "Post", text: "Words.\n", mark: 1, modified: 4, markdown: true });
    const store = browserStore(tables, () => 9);
    expect(await store.list()).toEqual([{ id: "old-1", name: "Letter", modified: 5 }, { id: "old-2", name: "Post", modified: 4 }]);
    expect(await store.open("old-1")).toEqual({ text: "Dear all,\n", mark: "3", quire: row.quire });
    expect(await store.open("old-2")).toEqual({ text: "Words.\n", mark: "1", quire: undefined });
    await store.save("old-1", "Dear all, again.\n", "3", { style: "{}", notes: "{}" });
    expect(await tables.get("documents", "old-1")).toEqual({ id: "old-1", name: "Letter", text: "Dear all, again.\n", mark: 4, modified: 9, quire: { style: "{}", notes: "{}" } });
    const made = await store.create("New", "x", { style: "", notes: "" });
    expect(Object.keys((await tables.get("documents", made.id))!).sort()).toEqual(["id", "mark", "modified", "name", "quire", "text"]);
});

test("a document of a kind whose text is kept in another file says that file in the list and when opened, and keeps it through saves", async () => {
    const store = browserStore(memoryTables());
    const made = await store.create("Screenshot", "{\"steps\":[]}", {}, "steps.json");
    expect((await store.list())[0]).toMatchObject({ name: "Screenshot", main: "steps.json" });
    const saved = await store.save(made.id, "{\"steps\":[1]}", made.mark);
    expect(await store.open(made.id)).toEqual({ text: "{\"steps\":[1]}", mark: saved.ok ? saved.mark : "", quire: {}, main: "steps.json" });
    // a document made without parts is plain text, and names no main file even when given one
    const plain = await store.create("Plain", "x", undefined, "steps.json");
    expect((await store.open(plain.id)).main).toBeUndefined();
});
