// What saving is held to: a document is saved once typing pauses, the status says how it stands,
// a store whose document changed elsewhere is never written over without being asked, and what was
// typed is never lost. And the small helpers for names and addresses. Run with `bun test src/quire`.

import { expect, test } from "bun:test";
import { browserStore, memoryTables } from "./store-browser";
import { besideDocument, copyDocument, createSaver, fileName, freeName, memoryStore, relative, said, type Status } from "./store";

/** A clock for the saver: waiting is done by hand. */
function clock() {
    let pending: (() => void) | undefined;
    return {
        wait: (run: () => void) => {
            pending = run;
            return () => (pending = undefined);
        },
        pass() {
            const run = pending;
            pending = undefined;
            run?.();
        },
    };
}

test("a document is saved once typing pauses, the status going from waiting to saving to saved", async () => {
    const store = memoryStore();
    const { id, mark } = await store.create("note", "first");
    const time = clock();
    const saver = createSaver(store, id, mark, { wait: time.wait });
    const seen: Status["state"][] = [];
    saver.on((status) => seen.push(status.state));
    saver.changed("first, then more");
    saver.changed("first, then more and more");
    expect(store.files.get(id)!.text).toBe("first");
    time.pass();
    await saver.settled();
    expect(store.files.get(id)!.text).toBe("first, then more and more");
    expect(seen).toEqual(["waiting", "waiting", "saving", "saved"]);
    expect(said(saver.status())).toBe("Saved");
    expect(saver.unsaved()).toBeUndefined();
});

test("a document changed elsewhere is not written over, and what was typed is kept", async () => {
    const store = memoryStore();
    const { id, mark } = await store.create("note", "original");
    const time = clock();
    const saver = createSaver(store, id, mark, { wait: time.wait });
    // someone else saves first
    await store.save(id, "theirs", mark);
    saver.changed("mine");
    time.pass();
    await saver.settled();
    expect(saver.status()).toMatchObject({ state: "changed", theirs: { text: "theirs" } });
    expect(said(saver.status())).toBe("Changed elsewhere");
    expect(store.files.get(id)!.text).toBe("theirs");
    expect(saver.unsaved()).toBe("mine");
    // more typing waits for the choice rather than trying again
    saver.changed("mine, and more");
    expect(saver.status().state).toBe("changed");
    // keep mine writes it over theirs, on purpose
    await saver.choose("mine");
    expect(store.files.get(id)!.text).toBe("mine, and more");
    expect(saver.status().state).toBe("saved");
});

test("taking theirs gives their text and their mark, so the next save goes on from it", async () => {
    const store = memoryStore();
    const { id, mark } = await store.create("note", "original");
    const time = clock();
    const saver = createSaver(store, id, mark, { wait: time.wait });
    await store.save(id, "theirs", mark);
    saver.changed("mine");
    time.pass();
    await saver.settled();
    const theirs = await saver.choose("theirs");
    expect(theirs?.text).toBe("theirs");
    expect(saver.status().state).toBe("saved");
    saver.changed("theirs, then mine");
    time.pass();
    await saver.settled();
    expect(store.files.get(id)!.text).toBe("theirs, then mine");
});

test("taking theirs when their version cannot be read keeps what was typed, waiting, and does not say it is saved", async () => {
    const store = memoryStore();
    const { id, mark } = await store.create("note", "original");
    const time = clock();
    const saver = createSaver(store, id, mark, { wait: time.wait });
    // refused with nothing of theirs given, and theirs cannot be read afterwards (GitHub after a 409, the file gone)
    store.save = async () => ({ ok: false, changed: true });
    store.open = async () => {
        throw new Error("not there");
    };
    saver.changed("mine");
    time.pass();
    await saver.settled();
    expect(await saver.choose("theirs")).toBeUndefined();
    expect(saver.status().state).toBe("failed");
    expect(said(saver.status())).not.toBe("Saved");
    expect(saver.unsaved()).toBe("mine");
});

test("a store that fails says why, and the text is still waiting to be saved", async () => {
    const store = memoryStore();
    const { id, mark } = await store.create("note", "x");
    store.save = async () => ({ ok: false, message: "the network is down" });
    const time = clock();
    const saver = createSaver(store, id, mark, { wait: time.wait });
    saver.changed("y");
    time.pass();
    await saver.settled();
    expect(said(saver.status())).toBe("Not saved: the network is down");
    expect(saver.unsaved()).toBe("y");
});

test("typing during a save is saved after it", async () => {
    const store = memoryStore();
    const { id, mark } = await store.create("note", "a");
    const time = clock();
    const saver = createSaver(store, id, mark, { wait: time.wait });
    const save = store.save.bind(store);
    store.save = async (...args) => {
        saver.changed("abc");
        return save(...args);
    };
    saver.changed("ab");
    time.pass();
    await saver.settled();
    expect(saver.status().state).toBe("waiting");
    store.save = save;
    time.pass();
    await saver.settled();
    expect(store.files.get(id)!.text).toBe("abc");
});

test("names become plain file names, and are made free of those already taken", () => {
    expect(fileName("My First Post")).toBe("my-first-post.md");
    expect(fileName("notes.mdx")).toBe("notes.mdx");
    expect(fileName("  a/b: c?  ", ".mdx")).toBe("a-b-c.mdx");
    expect(fileName("")).toBe("untitled.md");
    expect(freeName("a.md", ["a.md", "a-2.md"])).toBe("a-3.md");
    expect(freeName("b.md", ["a.md"])).toBe("b.md");
});

test("a picture's address is written relative to the document's folder", () => {
    expect(relative("src/content/blog/post.mdx", "src/assets/blog/cat.png")).toBe("../../assets/blog/cat.png");
    expect(relative("posts/post.md", "posts/pictures/cat.png")).toBe("./pictures/cat.png");
    expect(relative("post.md", "cat.png")).toBe("./cat.png");
});

test("a document removed from memory is gone from the list but kept, and a name is not used twice", async () => {
    const store = memoryStore();
    const first = await store.create("a.md", "");
    const second = await store.create("a.md", "");
    expect((await store.list()).map((entry) => entry.name)).toEqual(["a.md", "a-2.md"]);
    await store.remove(first.id);
    expect((await store.list()).map((entry) => entry.id)).toEqual([second.id]);
    expect(store.files.get(first.id)?.gone).toBe(true);
});

test("a copy of a .quire document has its text, its styling and its pictures under the same names; a Markdown one has no parts", async () => {
    const store = browserStore(memoryTables());
    const made = await store.create("Letter", "![A dot](pictures/dot.png)\n", { style: '{"quire":1}', notes: "{}" });
    await store.savePicture(made.id, new Blob(["png"]), "dot.png");
    const copy = await copyDocument(store, made.id, "Letter copy");
    expect(await store.open(copy.id)).toMatchObject({ text: "![A dot](pictures/dot.png)\n", quire: { style: '{"quire":1}', notes: "{}" } });
    const pictures = await store.pictures!(copy.id);
    expect([...pictures.keys()]).toEqual(["dot.png"]);
    expect(await pictures.get("dot.png")!.text()).toBe("png");
    const post = await store.create("Post", "Words.\n");
    expect((await store.open((await copyDocument(store, post.id, "Post copy")).id)).quire).toBeUndefined();
});

test("an address in a document is found beside it, and one that leaves the store or the folder is not", () => {
    expect(besideDocument("posts/one.md", "pics/cat.png")).toBe("posts/pics/cat.png");
    expect(besideDocument("posts/one.md", "../two.md")).toBe("two.md");
    expect(besideDocument("posts/one.md", "./three.md")).toBe("posts/three.md");
    expect(besideDocument("one.md", "../out.md")).toBeUndefined();
    expect(besideDocument("one.md", "https://example.com")).toBeUndefined();
    expect(besideDocument("one.md", "/blog/x/")).toBeUndefined();
    expect(besideDocument("one.md", "#top")).toBeUndefined();
});
