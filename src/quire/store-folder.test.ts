// What the folder store is held to, over handles kept in memory as the browser's are: it lists a
// folder's Markdown files a few folders deep, saves straight back unless the file changed
// elsewhere, writes pictures beside the document, and moves a file taken away into a trash folder.
// Run with `bun test src/quire`.

import { expect, test } from "bun:test";
import { canOpen, folderStore, memoryFolder, oneFileStore, type FileHandle } from "./store-folder";

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

test("without the API in this place, neither choice is offered", () => {
    expect(canOpen()).toEqual({ file: false, folder: false });
});
