// The commands taken from Docs' menus (more-commands.ts), used for real: a page holding the editor is
// bundled with the site's styles and opened in headless Chromium, its menus pressed with the mouse
// and its keys typed, and the Markdown the document writes checked after each step. Skipped, with a
// notice, on a machine with no Chromium.

import { afterAll, beforeAll, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { withoutSpeech } from "../../../scripts/dictation-stubs";
import { browser, chromium, type Browser } from "../../../scripts/browser";

const here = import.meta.dir;
const styles = `${here}/../../styles`;

const page = `
import { createEditor } from "${here}/editor.ts";
import { read } from "${here}/read.ts";
import { write } from "${here}/write.ts";
import { closeOthers } from "${here}/../ui.ts";
const editor = createEditor(document.querySelector("#host"), read(""), { name: "Test" });
const surface = editor.surface;
window.q = {
    reset(markdown, quire) { closeOthers(); const doc = read(markdown); surface.setDocument(quire ? { ...doc, quire: { page: { size: "A4", orientation: "portrait", margins: 25 }, notes: null } } : doc); surface.focus(); },
    select(anchor, from, focus = anchor, to = from) { surface.setSelection({ anchor: { path: anchor, offset: from }, focus: { path: focus, offset: to } }); },
    md: () => write(surface.getDocument()),
    doc: () => surface.getDocument(),
    selection: () => surface.getSelection(),
    at(selector, words) {
        const found = [...document.querySelectorAll(selector)].find((each) => !words || each.textContent.includes(words) || each.getAttribute("aria-label")?.startsWith(words));
        if (!found) return null;
        found.scrollIntoView({ block: "nearest" });
        const box = found.getBoundingClientRect();
        return { x: box.left + box.width / 2, y: box.top + box.height / 2 };
    },
};
`;

let folder = "";
let tab: Browser;

beforeAll(async () => {
    if (!chromium()) return;
    folder = await mkdtemp(join(tmpdir(), "quire-more-"));
    await Bun.write(`${folder}/page.ts`, page);
    const built = await Bun.build({ entrypoints: [`${folder}/page.ts`], target: "browser", plugins: [withoutSpeech] });
    if (!built.success) throw new Error(built.logs.join("\n"));
    const theme = ":root{--ground:oklch(0.16 0.035 300);--surface:oklch(0.21 0.045 300);--rule:oklch(0.32 0.055 300);--ink:oklch(0.93 0.02 300);--muted:oklch(0.73 0.045 300);--accent:oklch(0.77 0.16 300)} body{max-width:none;display:block;padding:1rem}";
    const css = (await Promise.all(["tokens.css", "base.css", "prose.css", "quire.css", "quire-markdown.css", "quire-extras.css"].map((name) => Bun.file(`${styles}/${name}`).text()))).join("\n");
    await Bun.write(`${folder}/page.html`, `<!doctype html><meta charset="utf-8"><style>${css}${theme}</style><div id="host"></div><script type="module">${await built.outputs[0]!.text()}</script>`);
    tab = await browser({ width: 1300, height: 900 });
    await tab.open(`file://${folder}/page.html`, 300);
}, 60_000);

afterAll(async () => {
    if (!chromium()) return;
    await tab?.close();
    await rm(folder, { recursive: true, force: true });
});

const md = () => tab.run<string>("q.md()");

async function press(selector: string, words?: string) {
    const point = await tab.run<{ x: number; y: number } | null>(`q.at(${JSON.stringify(selector)}, ${JSON.stringify(words ?? "")})`);
    if (!point) throw new Error(`nothing to press: ${selector} ${words ?? ""}, among ${await tab.run<string>("[...document.querySelectorAll('.quire-menu:popover-open .quire-menu-line')].map((each) => each.textContent).join(' / ')")}`);
    await tab.click(point.x, point.y);
    await tab.wait(40);
}

async function reset(markdown: string, anchor: number[] = [0], from = 0, focus = anchor, to = from, quire = false) {
    await tab.run(`q.reset(${JSON.stringify(markdown)}, ${quire})`);
    await tab.run(`q.select(${JSON.stringify(anchor)}, ${from}, ${JSON.stringify(focus)}, ${to})`);
    await tab.wait(30);
}

/** Opens a menu of the row and chooses lines of it, one after another as each opens the next. */
async function menu(word: string, ...lines: string[]) {
    await press(".quire-menu-row .quire-row-word", word);
    for (const line of lines) {
        await tab.wait(650);
        await press(".quire-menu:popover-open .quire-menu-line", line);
    }
    await tab.wait(60);
}

const used = (name: string, run: () => Promise<void>) => test.skipIf(!chromium())(name, run, 30_000);

used("Format, Text, Capitalization changes the selected words, keeping their bold, and one undo takes it back", async () => {
    await reset("a **bold** move here\n", [0], 0, [0], 11);
    await menu("Format", "Text", "Capitalization", "Title Case");
    expect(await md()).toBe("A **Bold** Move here\n");
    await menu("Format", "Text", "Capitalization", "UPPERCASE");
    expect(await md()).toBe("A **BOLD** MOVE here\n");
    await tab.press("z", { ctrl: true });
    expect(await md()).toBe("A **Bold** Move here\n");
    // Escape steps back one menu at a time, to the line each was opened from, and from the first to the text it acts on
    await menu("Format", "Text", "Capitalization");
    await tab.wait(400);
    const focused = () => tab.run<string>("document.activeElement.querySelector('.quire-menu-label')?.textContent ?? document.activeElement.getAttribute('aria-label')");
    await tab.press("Escape");
    await tab.wait(300);
    expect(await focused()).toBe("Capitalization");
    await tab.press("Escape");
    await tab.wait(300);
    expect(await focused()).toBe("Text");
    await tab.press("Escape");
    await tab.wait(300);
    expect(await tab.run<boolean>("!!document.querySelector('.quire-menu:popover-open')")).toBe(false);
    expect(await focused()).toBe("Document");
});

used("Format, Title goes to the title line; Subtitle draws the line as one, in a .quire document and in Markdown, where it is the frontmatter's subtitle", async () => {
    await reset("Some words\n", [0], 2);
    await menu("Format", "Paragraph styles", "Title");
    await tab.wait(300);
    expect(await tab.run<string>("document.activeElement.className")).toBe("quire-title");
    await tab.press("Escape");
    await reset("Some words\n\nUnder the title\n", [1], 2);
    await menu("Format", "Paragraph styles", "Subtitle");
    expect(await tab.run<string>("document.querySelector('.quire > p').className")).toBe("quire-subtitle");
    expect(await tab.run<string>("document.querySelector('.quire > p').textContent")).toBe("Under the title");
    expect(await md()).toBe("---\nsubtitle: Under the title\n---\n\nSome words\n");
    // typed in, the subtitle line changes the frontmatter
    await tab.type("!");
    expect(await md()).toBe("---\nsubtitle: Un!der the title\n---\n\nSome words\n");
    await menu("Format", "Paragraph styles", "Normal text");
    expect(await md()).toBe("Un!der the title\n\nSome words\n");
    await reset("Under the title\n\nThe writing.\n", [0], 2, [0], 2, true);
    await menu("Format", "Paragraph styles", "Subtitle");
    expect(await tab.run<string>("document.querySelector('.quire p').className")).toBe("quire-subtitle");
    expect(await md()).toBe("Under the title\n\nThe writing.\n");
    expect(await tab.run<string>("document.querySelector('.quire-style-label').textContent")).toBe("Subtitle");
});

used("Edit, Select all matching text selects every place the words appear: typing and a Format key change them all, Escape leaves, one undo takes the typing back", async () => {
    await reset("The cat sat. A cat ran.\n\nOne cat.\n", [0], 4, [0], 7);
    await menu("Edit", "Select all matching text");
    await tab.wait(300);
    await tab.type("dog");
    expect(await md()).toBe("The dog sat. A dog ran.\n\nOne dog.\n");
    await tab.press("b", { ctrl: true });
    expect(await md()).toBe("The **dog** sat. A **dog** ran.\n\nOne **dog**.\n");
    await tab.press("Escape");
    await tab.type("s");
    expect(await md()).toBe("The **dogs** sat. A **dog** ran.\n\nOne **dog**.\n");
    await tab.press("z", { ctrl: true });
    await tab.press("z", { ctrl: true });
    await tab.press("z", { ctrl: true });
    expect(await md()).toBe("The cat sat. A cat ran.\n\nOne cat.\n");
});

used("Insert, Bookmark puts a named place drawn as a flag, and the link field offers it and the headings to link to", async () => {
    await reset("## Start here\n\nThe middle part.\n\nSee it.\n", [1], 4);
    await menu("Insert", "Bookmark");
    await tab.wait(300);
    expect(await tab.run<string>("document.activeElement.value")).toBe("the-middle-part");
    await tab.press("Enter");
    expect(await md()).toBe('## Start here\n\nThe <a id="the-middle-part"></a>middle part.\n\nSee it.\n');
    expect(await tab.run<string>("document.querySelector('.quire-bookmark').title")).toBe("Bookmark: the-middle-part");
    await tab.run("q.select([2], 4, [2], 6)");
    await tab.press("k", { ctrl: true });
    await tab.wait(650);
    expect(await tab.run<string[]>("[...document.querySelectorAll('.quire-link-places .quire-menu-label')].map((each) => each.textContent)")).toEqual(["Start here", "the-middle-part"]);
    await press(".quire-link-places .quire-menu-line", "the-middle-part");
    expect(await md()).toBe('## Start here\n\nThe <a id="the-middle-part"></a>middle part.\n\nSee [it](#the-middle-part).\n');
});

used("Format, Bullets and numbering writes a list with another bullet, restarts its numbers and carries on the list before", async () => {
    await reset("- one\n- two\n", [0, 1, 0], 1);
    await menu("Format", "Bullets and numbering", "List options", "Asterisk");
    expect(await md()).toBe("* one\n* two\n");
    await reset("1. a\n2. b\n3. c\n", [0, 2, 0], 1);
    await menu("Format", "Bullets and numbering", "List options", "Restart numbering");
    await tab.wait(400);
    await tab.press("Backspace");
    await tab.type("4");
    await tab.press("Enter");
    expect(await md()).toBe("1. a\n2. b\n\n4) c\n");
    await menu("Format", "Bullets and numbering", "List options", "Continue previous list");
    expect(await md()).toBe("1. a\n2. b\n3. c\n");
});
