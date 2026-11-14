// What an mdQuire document's `.quire` parts are held to: a document saved through them comes back
// with its styling, hostile JSON changes nothing every object has, a zip without its JSON opens on
// the page's defaults, and a subtitle moves between the frontmatter and style.json.

import { expect, test } from "bun:test";
import { blockAt, setStyle, type Paragraph } from "./document";
import { asQuire, opened, written } from "./quire-parts";
import { markdownFor } from "./export";
import { read } from "./read";
import { write } from "./write";
import { unpackQuire } from "../core/quire-file";
import { writeZip } from "../core/zip";

test("style.json and notes.json cannot change what every object has, whatever keys they hold", async () => {
    const hostile = '{"__proto__": {"polluted": "yes"}, "constructor": {"prototype": {"polluted": "yes"}}, "quire": 1, "blocks": [{"__proto__": {"polluted": "yes"}, "path": [0]}], "runs": [{"path": [0], "from": 0, "to": 1, "__proto__": {"polluted": "yes"}, "color": "red"}]}';
    const notes = '{"__proto__": {"polluted": "yes"}, "comments": [{"__proto__": {"polluted": "yes"}, "id": "a", "path": [0], "from": 0, "to": 2, "quote": "Hi", "text": "x"}]}';
    const bundle = await unpackQuire(await writeZip([{ name: "document.md", data: "Hi there.\n" }, { name: "style.json", data: hostile }, { name: "notes.json", data: notes }]));
    const doc = opened(bundle.markdown, bundle.parts);
    written(doc, write);
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
    expect((Object.prototype as Record<string, unknown>).polluted).toBeUndefined();
});

test("a .quire zipped from a folder without its JSON files opens on the page's defaults", async () => {
    const nested = await unpackQuire(await writeZip([{ name: "letter/document.md", data: "Hi.\n" }]));
    expect(opened(nested.markdown, nested.parts).quire?.page.size).toBe("A4");
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

test("a Markdown document's subtitle becomes a .quire document's, in style.json and out of the frontmatter, and goes back into the frontmatter when downloaded as Markdown", () => {
    const doc = read("---\ntitle: A post\nsubtitle: Under it\n---\n\nThe text.\n");
    const saved = written(asQuire(doc), write);
    expect(saved.text).toBe("---\ntitle: A post\n---\n\nUnder it\n\nThe text.\n");
    const back = opened(saved.text, saved.quire);
    expect((back.blocks[0] as Paragraph).subtitle).toBe(true);
    expect(markdownFor(back)).toBe("---\ntitle: A post\nsubtitle: Under it\n---\n\nThe text.\n");
});
