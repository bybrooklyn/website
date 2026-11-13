// The commands taken from Docs' menus (more-commands.ts), used for real: a page holding the editor is
// bundled with the site's styles and opened in headless Chromium, its menus pressed with the mouse
// and its keys typed, and the Markdown the document writes checked after each step. Skipped, with a
// notice, on a machine with no Chromium.

import { afterAll, beforeAll, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { withoutSpeech } from "../../scripts/dictation-stubs";
import { browser, chromium, type Browser } from "../../scripts/browser";

const here = import.meta.dir;
const styles = `${here}/../styles`;

const page = `
import { createEditor } from "${here}/editor.ts";
import { read } from "${here}/read.ts";
import { write } from "${here}/write.ts";
import { closeOthers } from "${here}/ui.ts";
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

used("Format, Capitalisation changes the selected words, keeping their bold, and one undo takes it back", async () => {
    await reset("a **bold** move here\n", [0], 0, [0], 11);
    await menu("Format", "Capitalisation", "Title Case");
    expect(await md()).toBe("A **Bold** Move here\n");
    await menu("Format", "Capitalisation", "UPPERCASE");
    expect(await md()).toBe("A **BOLD** MOVE here\n");
    await tab.press("z", { ctrl: true });
    expect(await md()).toBe("A **Bold** Move here\n");
    // Escape in the small menu closes it and gives the focus back to where it was, the text it acts on
    await menu("Format", "Capitalisation");
    await tab.wait(400);
    await tab.press("Escape");
    await tab.wait(300);
    expect(await tab.run<boolean>("!!document.querySelector('.quire-menu:popover-open')")).toBe(false);
    expect(await tab.run<string>("document.activeElement.getAttribute('aria-label')")).toBe("Document");
});

used("Format, Bullets and numbering writes a list with another bullet, restarts its numbers and carries on the list before", async () => {
    await reset("- one\n- two\n", [0, 1, 0], 1);
    await menu("Format", "Bullets and numbering", "Written with a star");
    expect(await md()).toBe("* one\n* two\n");
    await tab.press("Escape");
    await reset("1. a\n2. b\n3. c\n", [0, 2, 0], 1);
    await menu("Format", "Bullets and numbering", "Restart numbering");
    await tab.wait(400);
    await tab.press("Backspace");
    await tab.type("4");
    await tab.press("Enter");
    expect(await md()).toBe("1. a\n2. b\n\n4) c\n");
    await menu("Format", "Bullets and numbering", "Continue previous list");
    expect(await md()).toBe("1. a\n2. b\n3. c\n");
});
