// What the files store is held to: only Markdown and text files open, an opened file is held and
// saved on its mark, and its name stays a plain file name. Run with `bun test src/quire`.

import { expect, test } from "bun:test";
import { packQuire } from "./quire-file";
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
    expect(await store.savePicture(entry.id, new Blob(["x"]), "x.png").then(() => "", (error) => String(error))).toContain("cannot keep pictures");
});

test("a .quire file opens with its Markdown, its parts and its pictures, and keeps new pictures inside it", async () => {
    const store = filesStore();
    const bytes = await packQuire({ markdown: "# Hi\n\n![a](pictures/a.png)\n", parts: { style: '{"quire":1}', notes: "{}" }, pictures: new Map([["a.png", new Blob(["png"])]]) });
    const entry = await store.add(new File([bytes as BlobPart], "Letter.quire"));
    expect(entry.name).toBe("Letter.quire");
    expect(await store.open(entry.id)).toMatchObject({ text: "# Hi\n\n![a](pictures/a.png)\n", quire: { style: '{"quire":1}', notes: "{}" } });
    expect(await store.savePicture(entry.id, new Blob(["b"]), "b.png")).toBe("pictures/b.png");
    expect([...(await store.pictures!(entry.id)).keys()]).toEqual(["a.png", "b.png"]);
    await store.rename(entry.id, "Note to Sam");
    expect((await store.list())[0]!.name).toBe("note-to-sam.quire");
    const made = await store.create("Copy", "Words.\n", { style: "", notes: "" });
    expect((await store.list()).find((each) => each.id === made.id)?.name).toBe("copy.quire");
});

test("a new or renamed file keeps a plain name, never the same as another open one", async () => {
    const store = filesStore();
    await store.add(file("notes.md", ""));
    const made = await store.create("Notes", "");
    expect((await store.list()).map((entry) => entry.name)).toEqual(["notes.md", "notes-2.md"]);
    await store.rename(made.id, "My Plans");
    expect((await store.list()).map((entry) => entry.name)).toEqual(["notes.md", "my-plans.md"]);
});
