// A page holding one mdQuire editor, bundled with the site's styles and opened in headless
// Chromium, for the browser tests of the editor's pictures, notes, inserts and downloads. The page
// gives the test `window.q`: the editor, its surface, a way to start from some Markdown, and the
// Markdown written now. Downloads are caught as they are given, so a test can read them back.
//
//   const page = await editorPage();      // undefined on a machine with no Chromium
//   await page.tab.run("q.md()");  ...  await page.close();

import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { browser, chromium, type Browser } from "./browser";
import { withoutSpeech } from "./dictation-stubs";

const quire = `${import.meta.dir}/../src/quire`;
const styles = `${import.meta.dir}/../src/styles`;

const page = `
import { createEditor } from "${quire}/editor.ts";
import { read } from "${quire}/read.ts";
import { write } from "${quire}/write.ts";
import { closeOthers } from "${quire}/ui.ts";
import { memoryStorage } from "${quire}/versions.ts";
import { opened } from "${quire}/quire-file.ts";
const host = document.querySelector("#host");
const editor = createEditor(host, read(""), { name: "Test", onImage: async () => "/picture.png", versions: memoryStorage() });
const surface = editor.surface;
// what the editor gives as a download is kept here instead of saved
const given = [];
const click = HTMLAnchorElement.prototype.click;
HTMLAnchorElement.prototype.click = function () {
    if (!this.download) return click.call(this);
    const href = this.href;
    given.push(fetch(href).then((answer) => answer.arrayBuffer()).then((bytes) => ({ name: this.download, bytes: [...new Uint8Array(bytes)] })));
};
window.q = {
    editor,
    surface,
    reset(markdown, mdx) { closeOthers(); surface.setDocument(read(markdown, { mdx })); surface.focus(); },
    resetQuire(markdown, style = "", notes = "") { closeOthers(); surface.setDocument(opened(markdown, { style, notes })); surface.focus(); },
    select(anchor, from, focus = anchor, to = from) { surface.setSelection({ anchor: { path: anchor, offset: from }, focus: { path: focus, offset: to } }); },
    md: () => write(surface.getDocument()),
    doc: () => surface.getDocument(),
    async downloads() { return Promise.all(given); },
    forget() { given.length = 0; },
    /** The middle of the first element matching, whose text or label includes the words if given, or what covers it. */
    at(selector, words) {
        const found = [...document.querySelectorAll(selector)].find((each) => !words || each.textContent.includes(words) || each.getAttribute("aria-label")?.startsWith(words));
        if (!found) return null;
        const box = found.getBoundingClientRect();
        const point = { x: box.left + box.width / 2, y: box.top + box.height / 2 };
        const top = document.elementFromPoint(point.x, point.y);
        if (!top || !(found === top || found.contains(top))) return { covered: top ? top.tagName + "." + top.className : "nothing on screen there" };
        return point;
    },
    box(selector) { const box = document.querySelector(selector)?.getBoundingClientRect(); return box ? { x: box.left, y: box.top, width: box.width, height: box.height } : null; },
};
`;

/** The page and ways to press on it. */
export interface EditorPage {
    tab: Browser;
    /** Clicks the middle of the first element matching, whose text includes the words if given. */
    press(selector: string, words?: string): Promise<void>;
    /** Opens a menu of the row of menu words and chooses a line of it. */
    menuLine(word: string, line: string): Promise<void>;
    reset(markdown: string, anchor?: number[], from?: number, focus?: number[], to?: number): Promise<void>;
    md(): Promise<string>;
    close(): Promise<void>;
}

/** Builds the page and opens it, or gives undefined where there is no Chromium. */
export async function editorPage(width = 1300, height = 900): Promise<EditorPage | undefined> {
    if (!chromium()) return undefined;
    const folder = await mkdtemp(join(tmpdir(), "quire-page-"));
    await Bun.write(`${folder}/page.ts`, page);
    const built = await Bun.build({ entrypoints: [`${folder}/page.ts`], target: "browser", plugins: [withoutSpeech] });
    if (!built.success) throw new Error(built.logs.join("\n"));
    const theme = ":root{--ground:oklch(0.16 0.035 300);--surface:oklch(0.21 0.045 300);--rule:oklch(0.32 0.055 300);--ink:oklch(0.93 0.02 300);--muted:oklch(0.73 0.045 300);--accent:oklch(0.77 0.16 300)} body{max-width:none;display:block;padding:1rem}";
    const css = (await Promise.all(["tokens.css", "base.css", "prose.css", "quire.css", "quire-extras.css"].map((name) => Bun.file(`${styles}/${name}`).text()))).join("\n");
    await Bun.write(`${folder}/page.html`, `<!doctype html><meta charset="utf-8"><style>${css}${theme}</style><div id="host"></div><script type="module">${await built.outputs[0]!.text()}</script>`);
    // a picture 400 by 200, drawn in two colours, for the picture tests
    await Bun.write(`${folder}/wide.svg`, '<svg xmlns="http://www.w3.org/2000/svg" width="400" height="200"><rect width="400" height="200" fill="#6a4c93"/><circle cx="200" cy="100" r="60" fill="#f4a261"/></svg>');
    const tab = await browser({ width, height });
    await tab.open(`file://${folder}/page.html`, 300);
    const press = async (selector: string, words?: string) => {
        const point = await tab.run<{ x: number; y: number; covered?: string } | null>(`q.at(${JSON.stringify(selector)}, ${JSON.stringify(words ?? "")})`);
        if (!point) throw new Error(`nothing to press: ${selector} ${words ?? ""}`);
        if (point.covered) throw new Error(`${selector} ${words ?? ""} is covered by ${point.covered}`);
        await tab.click(point.x, point.y);
        await tab.wait(40);
    };
    return {
        tab,
        press,
        async menuLine(word, line) {
            await press(".quire-menu-row .quire-row-word", word);
            await tab.wait(650);
            await press(".quire-menu.open .quire-menu-line", line);
            await tab.wait(60);
        },
        async reset(markdown, anchor = [0], from = 0, focus = anchor, to = from) {
            await tab.run(`q.reset(${JSON.stringify(markdown)})`);
            await tab.run(`q.select(${JSON.stringify(anchor)}, ${from}, ${JSON.stringify(focus)}, ${to})`);
            await tab.wait(30);
        },
        md: () => tab.run<string>("q.md()"),
        async close() {
            await tab.close();
            await rm(folder, { recursive: true, force: true });
        },
    };
}

/** The folder the page's own files are in, for a picture to point at: `wide.svg` is there. */
export const pictureNear = (tab: Browser) => tab.run<string>("location.href.replace(/page\\.html$/, 'wide.svg')");
