// What the browser store is held to, over tables in memory (the browser test runs it over
// IndexedDB): documents are listed newest first, saved only on the mark they were opened with,
// renamed without taking another's name, taken away to a trash and brought back, with pictures and
// version history beside them. Run with `bun test src/quire`.

import { expect, test } from "bun:test";
import { browserStore, memoryTables } from "./store-browser";

test("every document kept in the browser is a .quire one, its style and notes saved beside its text, its pictures given back for a download", async () => {
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
    expect(await store.open(first.id)).toEqual({ text: "one", mark: "1", quire: { style: "", notes: "" } });
    const saved = await store.save(first.id, "one, changed", first.mark);
    expect(saved).toEqual({ ok: true, mark: "2" });
    expect((await store.list())[0]!.id).toBe(first.id);
    // saving again on the old mark is refused, with their text
    expect(await store.save(first.id, "stale", first.mark)).toEqual({ ok: false, changed: true, theirs: { text: "one, changed", mark: "2", quire: { style: "", notes: "" } } });
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
