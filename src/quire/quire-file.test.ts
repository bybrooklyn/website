// What the `.quire` file is held to: it is a zip of document.md, style.json, notes.json and
// pictures/ that the system's unzip opens to a plain Markdown document; it unpacks to what was
// packed; a document saved through it comes back with its styling; and one that is not quite as
// made (zipped from a folder, missing its JSON) still opens. Run with `bun test src/quire/quire-file.test.ts`.

import { expect, test } from "bun:test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { blockAt, setStyle, type Paragraph } from "./document";
import { opened, packQuire, pictureShelf, unpackQuire, written } from "./quire-file";
import { read } from "./read";
import { write } from "./write";
import { writeZip } from "./zip";

const parts = { style: '{"quire":1}\n', notes: '{"quire":1}\n' };

test("a .quire file unzipped by the system is a plain Markdown document with its pictures beside it", async () => {
    const where = mkdtempSync(join(tmpdir(), "quire-file-"));
    const path = join(where, "letter.quire");
    writeFileSync(path, await packQuire({ markdown: "# Letter\n\n![Sea](pictures/sea.png)\n", parts, pictures: new Map([["sea.png", new Blob([new Uint8Array([137, 80, 78, 71])])]]) }));
    const listed = Bun.spawnSync(["unzip", "-Z1", path]).stdout.toString().trim().split("\n");
    expect(listed).toEqual(["document.md", "style.json", "notes.json", "pictures/sea.png"]);
    expect(Bun.spawnSync(["unzip", "-p", path, "document.md"]).stdout.toString()).toBe("# Letter\n\n![Sea](pictures/sea.png)\n");
});

test("what is packed unpacks the same, pictures with a type they can be shown with", async () => {
    const webp = "RIFF\u0000\u0000\u0000\u0000WEBPVP8 ";
    const bundle = await unpackQuire(await packQuire({ markdown: "Words.\n", parts, pictures: new Map([["a.webp", new Blob([webp])]]) }));
    expect(bundle.markdown).toBe("Words.\n");
    expect(bundle.parts).toEqual(parts);
    expect(bundle.pictures.get("a.webp")?.type).toBe("image/webp");
    expect(await bundle.pictures.get("a.webp")?.text()).toBe(webp);
});

test("a picture inside is given the type its bytes say, so an HTML page or SVG named as a photograph is never shown as a page", async () => {
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0]);
    const bundle = await unpackQuire(
        await writeZip([
            { name: "document.md", data: "Hi.\n" },
            { name: "pictures/real.jpg", data: png },
            { name: "pictures/page.png", data: "<html><script>alert(1)</script></html>" },
            { name: "pictures/drawing.png", data: '<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"/>' },
            { name: "pictures/drawing.svg", data: '<?xml version="1.0"?>\n<svg xmlns="http://www.w3.org/2000/svg"></svg>' },
        ]),
    );
    expect(bundle.pictures.get("real.jpg")?.type).toBe("image/png");
    expect(bundle.pictures.get("page.png")?.type).toBe("application/octet-stream");
    expect(bundle.pictures.get("drawing.png")?.type).toBe("application/octet-stream");
    expect(bundle.pictures.get("drawing.svg")?.type).toBe("image/svg+xml");
});

test("only pictures whose names stay in their folder are taken from a .quire file, and a broken escape in an address does not throw", async () => {
    const bundle = await unpackQuire(await writeZip([{ name: "document.md", data: "Hi.\n" }, { name: "pictures/..-evil.png", data: "a" }, { name: "pictures/c:evil.png", data: "e" }, { name: "pictures/ok-1.png", data: "b" }, { name: "pictures/.hidden.png", data: "c" }, { name: "pictures/a b.png", data: "d" }]));
    expect([...bundle.pictures.keys()]).toEqual(["ok-1.png", "a b.png"]);
    const shelf = pictureShelf();
    expect(() => shelf.show("a.quire", "pictures/%zz.png")).not.toThrow();
});

test("style.json and notes.json cannot change what every object has, whatever keys they hold", async () => {
    const hostile = '{"__proto__": {"polluted": "yes"}, "constructor": {"prototype": {"polluted": "yes"}}, "quire": 1, "blocks": [{"__proto__": {"polluted": "yes"}, "path": [0]}], "runs": [{"path": [0], "from": 0, "to": 1, "__proto__": {"polluted": "yes"}, "color": "red"}]}';
    const notes = '{"__proto__": {"polluted": "yes"}, "comments": [{"__proto__": {"polluted": "yes"}, "id": "a", "path": [0], "from": 0, "to": 2, "quote": "Hi", "text": "x"}]}';
    const bundle = await unpackQuire(await writeZip([{ name: "document.md", data: "Hi there.\n" }, { name: "style.json", data: hostile }, { name: "notes.json", data: notes }]));
    const doc = opened(bundle.markdown, bundle.parts);
    written(doc, write);
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
    expect((Object.prototype as Record<string, unknown>).polluted).toBeUndefined();
});

test("a .quire zipped from a folder, or without its JSON files, still opens; one without document.md is refused", async () => {
    const nested = await unpackQuire(await writeZip([{ name: "letter/document.md", data: "Hi.\n" }, { name: "letter/pictures/b.png", data: "b" }]));
    expect(nested.markdown).toBe("Hi.\n");
    expect(nested.parts).toEqual({ style: "", notes: "" });
    expect([...nested.pictures.keys()]).toEqual(["b.png"]);
    expect(opened(nested.markdown, nested.parts).quire?.page.size).toBe("A4");
    expect(unpackQuire(await writeZip([{ name: "readme.txt", data: "no" }]))).rejects.toThrow("no document.md");
});

test("a styled document written for a store and opened again is the same document", () => {
    let doc = opened("Plain words here.\n", { style: "", notes: "" });
    doc = setStyle(doc, { start: { path: [0], offset: 6 }, end: { path: [0], offset: 11 } }, { color: "#a30262", font: "mono" });
    const saving = written(doc, write);
    expect(saving.text).toBe("Plain words here.\n");
    const back = opened(saving.text, saving.quire);
    expect((blockAt(back, [0]) as Paragraph).runs[1]).toMatchObject({ text: "words", color: "#a30262", font: "mono" });
    expect(back.quire).toBeDefined();
    // a plain Markdown document is written as it always was
    expect(written(read('A <span style="color:red">red</span> word.\n'), write)).toEqual({ text: 'A <span style="color:red">red</span> word.\n' });
});

test("pictures on the shelf get free names, are shown by their address and follow a rename", () => {
    const shelf = pictureShelf();
    expect(shelf.add("a.quire", new Blob(["1"]), "my picture.png")).toBe("pictures/my-picture.png");
    expect(shelf.add("a.quire", new Blob(["2"]), "my picture.png")).toBe("pictures/my-picture-2.png");
    shelf.move("a.quire", "b.quire");
    expect([...shelf.get("b.quire").keys()]).toEqual(["my-picture.png", "my-picture-2.png"]);
    expect(shelf.show("b.quire", "https://example.com/x.png")).toBeUndefined();
});

test("a picture taken out of the writing is not packed into the file", async () => {
    const pictures = new Map([["kept.png", new Blob(["k"])], ["gone.png", new Blob(["g"])], ["my cat.png", new Blob(["c"])]]);
    const bundle = await unpackQuire(await packQuire({ markdown: "![Kept](pictures/kept.png)\n\n![Cat](pictures/my%20cat.png)\n", parts, pictures }));
    expect([...bundle.pictures.keys()].sort()).toEqual(["kept.png", "my cat.png"]);
});
