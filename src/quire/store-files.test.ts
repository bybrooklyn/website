// What the files store is held to: only Markdown and text files open, an opened file is held and
// saved on its mark, and its name stays a plain file name. Run with `bun test src/quire`.

import { expect, test } from "bun:test";
import { filesStore, openable } from "./store-files";

const file = (name: string, text: string) => new File([text], name, { type: "text/markdown" });

test("a Markdown file opens with its text, and other kinds of file are refused", async () => {
    const store = filesStore();
    const entry = await store.add(file("post.mdx", "# Post\n"));
    expect(entry.name).toBe("post.mdx");
    expect(await store.open(entry.id)).toEqual({ text: "# Post\n", mark: "1" });
    expect(await store.add(file("picture.png", "x")).then(() => "", (error) => String(error))).toContain("only Markdown");
    expect(openable("notes.txt")).toBe(true);
    expect(openable("notes.TXT")).toBe(true);
    expect(openable("notes.docx")).toBe(false);
});

test("an opened file is saved on its mark, and the status says to download it", async () => {
    const store = filesStore();
    const entry = await store.add(file("a.md", "one"));
    expect(await store.save(entry.id, "two", "1")).toEqual({ ok: true, mark: "2" });
    expect((await store.save(entry.id, "stale", "1")).ok).toBe(false);
    expect(store.note).toContain("Download");
    expect(store.can.pictures).toBe(false);
    expect(await store.savePicture(entry.id, new Blob(["x"]), "x.png").then(() => "", (error) => String(error))).toContain("cannot keep pictures");
});

test("a new or renamed file keeps a plain name, never the same as another open one", async () => {
    const store = filesStore();
    await store.add(file("notes.md", ""));
    const made = await store.create("Notes", "");
    expect((await store.list()).map((entry) => entry.name)).toEqual(["notes.md", "notes-2.md"]);
    await store.rename(made.id, "My Plans");
    expect((await store.list()).map((entry) => entry.name)).toEqual(["notes.md", "my-plans.md"]);
});
