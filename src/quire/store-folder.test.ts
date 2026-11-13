// What the folder store is held to, over handles kept in memory as the browser's are: it lists a
// folder's Markdown files a few folders deep, saves straight back unless the file changed
// elsewhere, writes pictures beside the document, and moves a file taken away into a trash folder.
// Run with `bun test src/quire`.

import { expect, test } from "bun:test";
import { packQuire, unpackQuire } from "./quire-file";
import { canOpen, folderStore, memoryFolder, oneFileStore, type FileHandle } from "./store-folder";
import { copyDocument, createSaver } from "./store";

/** A clock that moves on a millisecond each time it is read, as a disk's would between writes. */
const ticking = () => {
    let time = 1000;
    return () => time++;
};

test("a folder's Markdown files are listed by path, skipping hidden folders and other kinds of file", async () => {
    const store = folderStore(memoryFolder("site", { "a.md": "a", "posts/b.mdx": "b", "posts/deep/c.markdown": "c", "notes.txt": "n", "picture.png": "x", ".git/d.md": "d", "node_modules/e.md": "e" }));
    expect((await store.list()).map((entry) => entry.id)).toEqual(["a.md", "notes.txt", "posts/b.mdx", "posts/deep/c.markdown"]);
    expect(store.label).toBe("site");
});

test("a file is saved straight back on its mark, and refused when it changed elsewhere", async () => {
    const root = memoryFolder("site", { "posts/b.md": "before" }, ticking());
    const store = folderStore(root);
    const opened = await store.open("posts/b.md");
    expect(opened.text).toBe("before");
    const saved = await store.save("posts/b.md", "after", opened.mark);
    expect(saved.ok).toBe(true);
    expect((await store.open("posts/b.md")).text).toBe("after");
    // someone else writes it
    const posts = await root.getDirectoryHandle("posts");
    const handle = await posts.getFileHandle("b.md");
    const writable = await handle.createWritable();
    await writable.write("elsewhere, longer");
    await writable.close();
    const refused = await store.save("posts/b.md", "mine", saved.ok ? saved.mark : "");
    expect(refused).toMatchObject({ ok: false, changed: true, theirs: { text: "elsewhere, longer" } });
});

test("new files get plain free names, renaming moves the file, and pictures go beside the document", async () => {
    const root = memoryFolder("site", { "posts/old.md": "words" }, ticking());
    const store = folderStore(root);
    const made = await store.create("A New Post", "hello");
    expect(made.id).toBe("a-new-post.md");
    expect((await store.create("A New Post", "again")).id).toBe("a-new-post-2.md");
    const moved = await store.rename("posts/old.md", "Better Name");
    expect(moved).toBe("posts/better-name.md");
    expect((await store.open(moved)).text).toBe("words");
    expect((await store.list()).map((entry) => entry.id)).not.toContain("posts/old.md");
    expect(await store.savePicture(moved, new Blob(["png"]), "my cat.png")).toBe("./my-cat.png");
    expect(await store.savePicture(moved, new Blob(["png"]), "my cat.png")).toBe("./my-cat-2.png");
    expect((await (await (await root.getDirectoryHandle("posts")).getFileHandle("my-cat.png")).getFile()).size).toBe(3);
});

test("after a rename the file's mark is given at its new place, and saving goes on there with no conflict", async () => {
    const store = folderStore(memoryFolder("site", { "posts/old.md": "words" }, ticking()));
    await store.open("posts/old.md");
    const moved = await store.rename("posts/old.md", "Better Name");
    const mark = await store.markOf!(moved);
    const saver = createSaver(store, moved, mark, { wait: (run) => (run(), () => {}) });
    saver.changed("words, and more");
    await saver.settled();
    expect(saver.status().state).toBe("saved");
    expect((await store.open(moved)).text).toBe("words, and more");
});

test("a file taken away is moved into the trash folder beside it, not lost", async () => {
    const root = memoryFolder("site", { "posts/gone.md": "keep me" }, ticking());
    const store = folderStore(root);
    await store.remove("posts/gone.md");
    expect((await store.list()).map((entry) => entry.id)).toEqual([]);
    const trash = await (await root.getDirectoryHandle("posts")).getDirectoryHandle(".quire-trash");
    expect(await (await (await trash.getFileHandle("gone.md")).getFile()).text()).toBe("keep me");
});

test("one file on its own can be written, and says plainly what it cannot do", async () => {
    const folder = memoryFolder("x", { "only.md": "one" }, ticking());
    const handle = (await folder.getFileHandle("only.md")) as FileHandle;
    const store = oneFileStore(handle);
    const opened = await store.open("only.md");
    expect((await store.save("only.md", "two", opened.mark)).ok).toBe(true);
    expect(store.can.pictures).toBe(false);
    expect(await store.create("x", "").then(() => "", (error) => String(error))).toContain("open a folder");
});

test("a .quire file in a folder is listed, opened, and written back in place as a zip with its pictures inside", async () => {
    const bytes = await packQuire({ markdown: "Old.\n", parts: { style: '{"quire":1}', notes: "{}" }, pictures: new Map([["a.png", new Blob(["a"])]]) });
    const root = memoryFolder("site", { "letters/to-sam.quire": new Blob([bytes as BlobPart]) }, ticking());
    const store = folderStore(root);
    expect((await store.list()).map((entry) => entry.id)).toEqual(["letters/to-sam.quire"]);
    const opened = await store.open("letters/to-sam.quire");
    expect(opened).toMatchObject({ text: "Old.\n", quire: { style: '{"quire":1}' } });
    expect(await store.savePicture("letters/to-sam.quire", new Blob(["b"]), "b.png")).toBe("pictures/b.png");
    const saved = await store.save("letters/to-sam.quire", "New.\n\n![b](pictures/b.png)\n", opened.mark, { style: '{"quire":1,"count":2}', notes: "{}" });
    expect(saved.ok).toBe(true);
    const file = await (await (await root.getDirectoryHandle("letters")).getFileHandle("to-sam.quire")).getFile();
    const back = await unpackQuire(new Uint8Array(await file.arrayBuffer()));
    expect(back.markdown).toBe("New.\n\n![b](pictures/b.png)\n");
    expect(back.parts.style).toBe('{"quire":1,"count":2}');
    expect([...back.pictures.keys()]).toEqual(["a.png", "b.png"]);
    // nothing was written beside it
    expect((await store.list()).length).toBe(1);
    expect(await store.rename("letters/to-sam.quire", "To Alex.md")).toBe("letters/to-alex.quire");
    expect(await store.create("Fresh", "x", { style: "", notes: "" }).then((made) => made.id)).toBe("fresh.quire");
});

test("a .quire file duplicated in a folder keeps its pictures on disk, and after it is opened again", async () => {
    const bytes = await packQuire({ markdown: "![A cat](pictures/cat.png)\n", parts: { style: '{"quire":1}', notes: "{}" }, pictures: new Map([["cat.png", new Blob(["meow"])]]) });
    const root = memoryFolder("site", { "letter.quire": new Blob([bytes as BlobPart]) }, ticking());
    const store = folderStore(root);
    const copy = await copyDocument(store, "letter.quire", "Letter copy");
    const file = await (await root.getFileHandle(copy.id)).getFile();
    const onDisk = await unpackQuire(new Uint8Array(await file.arrayBuffer()));
    expect([...onDisk.pictures.keys()]).toEqual(["cat.png"]);
    expect(await onDisk.pictures.get("cat.png")!.text()).toBe("meow");
    // a fresh store, as after a reload, finds them too
    const again = folderStore(root);
    await again.open(copy.id);
    expect([...(await again.pictures!(copy.id)).keys()]).toEqual(["cat.png"]);
    // and the copy's mark is the one now on disk, so it can be saved
    expect((await again.save(copy.id, "More.\n", copy.mark)).ok).toBe(true);
});

test("one .quire file on its own keeps its pictures inside it", async () => {
    const bytes = await packQuire({ markdown: "Hi.\n", parts: { style: "", notes: "" }, pictures: new Map() });
    const folder = memoryFolder("x", { "only.quire": new Blob([bytes as BlobPart]) }, ticking());
    const store = oneFileStore((await folder.getFileHandle("only.quire")) as FileHandle);
    const opened = await store.open("only.quire");
    expect(store.can.pictures).toBe(true);
    await store.savePicture("only.quire", new Blob(["c"]), "c.png");
    expect((await store.save("only.quire", "Hi.\n", opened.mark)).ok).toBe(true);
    const file = await ((await folder.getFileHandle("only.quire")) as FileHandle).getFile();
    expect([...(await unpackQuire(new Uint8Array(await file.arrayBuffer()))).pictures.keys()]).toEqual(["c.png"]);
});

test("without the API in this place, neither choice is offered", () => {
    expect(canOpen()).toEqual({ file: false, folder: false });
});

test("the folder store says whether an address in a document leads to a file or folder", async () => {
    const store = folderStore(memoryFolder("notes", { "posts/one.md": "# One", "posts/pics/cat.png": "png", "two.md": "# Two" }));
    expect(await store.exists!("posts/one.md", "pics/cat.png")).toBe(true);
    expect(await store.exists!("posts/one.md", "../two.md")).toBe(true);
    expect(await store.exists!("posts/one.md", "pics")).toBe(true);
    expect(await store.exists!("posts/one.md", "pics/dog.png")).toBe(false);
    expect(await store.exists!("posts/one.md", "nowhere/dog.png")).toBe(false);
    expect(await store.exists!("posts/one.md", "../../out.md")).toBeUndefined();
    expect(await store.exists!("posts/one.md", "https://example.com/")).toBeUndefined();
});
