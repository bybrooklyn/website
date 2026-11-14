// Suggested words drawn in the editor. Where they may be shown is pure and tested first; then, in
// headless Chromium, the whole editor learns from a shelf of documents with phrases written again and
// again, and is typed in for real. Held true: the faint words appear right after the caret and are
// not in the document, its Markdown, its word count or its history; typing a letter they start with
// shortens them; Tab takes them as one undo step; Ctrl+Right takes one word and leaves the rest;
// Escape hides them until the next word; none show in code or a table, and at a list item's start
// Tab still indents; and the switch in Tools turns them off and on. Skipped, with a notice, on a
// machine with no Chromium.

import { afterAll, beforeAll, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { withoutSpeech } from "../../scripts/dictation-stubs";
import { browser, chromium, type Browser } from "../../scripts/browser";
import { caret } from "./keys";
import { read } from "./read";
import { nextWord, placeFor } from "./suggest-view";

// ---- where they may be shown ----

test("faint words may be shown only at the end of a paragraph's, heading's or list item's text, never in code, maths or a table", () => {
    const doc = read("Words here\n\n# A heading\n\n- an item\n\n```\ncode\n```\n\n| a | b |\n| - | - |\n| c | d |\n\nSome `code` and $x$ too\n");
    expect(placeFor(doc, caret([0], 10), [])).toBe("Words here");
    expect(placeFor(doc, caret([0], 5), [])).toBeUndefined();
    expect(placeFor(doc, caret([1], 9), [])).toBe("A heading");
    expect(placeFor(doc, caret([2, 0, 0], 7), [])).toBe("an item");
    expect(placeFor(doc, caret([3], 4), [])).toBeUndefined();
    expect(placeFor(doc, caret([4, 1, 1], 1), [])).toBeUndefined();
    expect(placeFor(doc, caret([5], 4), ["code"])).toBeUndefined();
    expect(placeFor(doc, caret([5], 4), ["math"])).toBeUndefined();
    expect(placeFor(doc, { anchor: { path: [0], offset: 0 }, focus: { path: [0], offset: 10 } }, [])).toBeUndefined();
});

test("the next word of a suggestion is what Ctrl+Right takes, with the space before it", () => {
    expect(nextWord("site and how it")).toBe("site");
    expect(nextWord(" and how it")).toBe(" and");
    expect(nextWord("it")).toBe("it");
});

// ---- in the browser ----

const here = import.meta.dir;
const root = `${here}/../..`;
const live = !!chromium();

const phrases = [
    "I am writing a post about my website and how it works.",
    "This is a note about my website and how it grew.",
    "Another post about my website and how it looks.",
    "We went to the river by the old mill.",
];
const page = `
import { createEditor } from "${here}/editor.ts";
import { read } from "${here}/read.ts";
import { write } from "${here}/write.ts";
import { closeOthers } from "${here}/ui.ts";
import { browserStore, memoryTables } from "${here}/store-browser.ts";
import { countWords } from "${here}/document.ts";
const shelf = browserStore(memoryTables());
for (let index = 0; index < 4; index++) await shelf.create("Notes " + index, ${JSON.stringify(phrases.join("\n\n"))} + "\\n");
const editor = createEditor(document.querySelector("#host"), read(""), { name: "Test", learnFrom: () => [shelf] });
const surface = editor.surface;
window.q = {
    editor,
    surface,
    reset(markdown) { closeOthers(); surface.setDocument(read(markdown)); surface.focus(); },
    select(path, from) { surface.setSelection({ anchor: { path, offset: from }, focus: { path, offset: from } }); },
    md: () => write(surface.getDocument()),
    words: () => countWords(surface.getDocument()),
    shown: () => { const ghost = document.querySelector(".quire-suggestion"); return ghost && ghost.classList.contains("shown") ? ghost.textContent : ""; },
    /** The caret's place and the faint words' first letter, on screen. */
    places() {
        const ghost = document.querySelector(".quire-suggestion").getBoundingClientRect();
        const range = getSelection().getRangeAt(0).getClientRects()[0];
        return { ghost: { left: ghost.left, top: ghost.top, height: ghost.height }, caret: { left: range.left, top: range.top, height: range.height } };
    },
};
`;

let folder = "";
let tab: Browser;
let server: ReturnType<typeof Bun.serve> | undefined;

beforeAll(async () => {
    if (!live) return;
    folder = await mkdtemp(join(tmpdir(), "quire-suggest-"));
    await Bun.write(`${folder}/page.ts`, page);
    const bundle = await Bun.build({ entrypoints: [`${folder}/page.ts`], target: "browser", plugins: [withoutSpeech], splitting: true, outdir: `${folder}/out` });
    if (!bundle.success) throw new Error(bundle.logs.join("\n"));
    const theme = ":root{--ground:oklch(0.16 0.035 300);--surface:oklch(0.21 0.045 300);--rule:oklch(0.32 0.055 300);--ink:oklch(0.93 0.02 300);--muted:oklch(0.73 0.045 300);--accent:oklch(0.77 0.16 300)} body{max-width:none;display:block;padding:1rem;background:var(--ground)}";
    const css = (await Promise.all(["tokens.css", "base.css", "prose.css", "quire.css", "quire-markdown.css", "quire-extras.css"].map((name) => Bun.file(`${root}/src/styles/${name}`).text()))).join("\n");
    await Bun.write(`${folder}/out/index.html`, `<!doctype html><meta charset="utf-8"><style>${css}${theme}</style><div id="host"></div><script type="module" src="/page.js"></script>`);
    server = Bun.serve({
        port: 0,
        async fetch(request) {
            let path = new URL(request.url).pathname;
            if (path === "/") path = "/index.html";
            if (path === "/quire/words-en.dat") return new Response(Bun.file(`${root}/public/quire/words-en.dat`));
            const file = Bun.file(`${folder}/out${path}`);
            return (await file.exists()) ? new Response(file) : new Response("missing", { status: 404 });
        },
    });
    tab = await browser({ width: 1300, height: 900 });
    // the learner waits three seconds after opening before it reads the shelf
    await tab.open(`http://localhost:${server.port}/`, 4500);
}, 60_000);

afterAll(async () => {
    if (!live) return;
    await tab?.close();
    server?.stop();
    await rm(folder, { recursive: true, force: true });
});

const used = (name: string, run: () => Promise<void>, ms = 30_000) => test.skipIf(!live)(name, run, ms);

/** A fresh document with the caret at the end of its first line. */
async function fresh(markdown = "") {
    await tab.run(`q.reset(${JSON.stringify(markdown)})`);
    await tab.wait(50);
}

used("the faint words show right after the caret, and the document, its count and its Markdown do not have them", async () => {
    await fresh();
    await tab.type("I am writing a post about my web");
    await tab.wait(80);
    expect(await tab.run("q.shown()")).toBe("site and how it");
    expect(await tab.run("q.md()")).toBe("I am writing a post about my web\n");
    expect(await tab.run("q.words()")).toBe(8);
    expect(await tab.run("q.surface.getSelection().focus.offset")).toBe(32);
    const { ghost, caret } = await tab.run<{ ghost: { left: number; top: number; height: number }; caret: { left: number; top: number; height: number } }>("q.places()");
    expect(Math.abs(ghost.left - caret.left)).toBeLessThan(2);
    expect(Math.abs(ghost.top - caret.top)).toBeLessThan(2);
    expect(Math.abs(ghost.height - caret.height)).toBeLessThan(2);
    expect(await tab.run("q.surface.element.textContent")).not.toContain("site and");
});

used("typing a letter the words start with shortens them, and another letter changes or hides them", async () => {
    await fresh();
    await tab.type("a post about my web");
    await tab.wait(80);
    expect(await tab.run("q.shown()")).toBe("site and how it");
    await tab.type("s");
    await tab.wait(80);
    expect(await tab.run("q.shown()")).toBe("ite and how it");
    await tab.type("x");
    await tab.wait(80);
    expect(await tab.run("q.shown()")).toBe("");
});

used("Tab takes them, as one undo step of their own", async () => {
    await fresh();
    await tab.type("a post about my web");
    await tab.wait(80);
    await tab.press("Tab");
    await tab.wait(80);
    expect(await tab.run("q.md()")).toBe("a post about my website and how it\n");
    expect(await tab.run("q.shown()")).toBe("");
    await tab.press("z", { ctrl: true });
    await tab.wait(80);
    expect(await tab.run("q.md()")).toBe("a post about my web\n");
    await tab.press("z", { ctrl: true });
    await tab.wait(80);
    expect(await tab.run("q.md()")).toBe("");
});

used("Ctrl+Right takes the next word and leaves the rest shown", async () => {
    await fresh();
    await tab.type("a post about my web");
    await tab.wait(80);
    await tab.press("ArrowRight", { ctrl: true });
    await tab.wait(80);
    expect(await tab.run("q.md()")).toBe("a post about my website\n");
    expect(await tab.run("q.shown()")).toBe(" and how it");
    await tab.press("ArrowRight", { ctrl: true });
    await tab.wait(80);
    expect(await tab.run("q.md()")).toBe("a post about my website and\n");
    expect(await tab.run("q.shown()")).toBe(" how it");
});

used("Escape hides them until the next word", async () => {
    await fresh();
    await tab.type("about my web");
    await tab.wait(80);
    expect(await tab.run("q.shown()")).not.toBe("");
    await tab.press("Escape");
    await tab.wait(80);
    expect(await tab.run("q.shown()")).toBe("");
    await tab.type("si");
    await tab.wait(80);
    expect(await tab.run("q.shown()")).toBe("");
    await tab.type("te ");
    await tab.wait(80);
    expect(await tab.run("q.shown()")).toBe("and how it");
    expect(await tab.run("q.md()")).toBe("about my website\n");
});

used("moving the caret away hides them, and none show in code or a table", async () => {
    await fresh("First line\n\n```\ncode\n```\n\n| a | b |\n| - | - |\n| c | d |\n");
    await tab.run("q.select([0], 10)");
    await tab.type(" about my web");
    await tab.wait(80);
    expect(await tab.run("q.shown()")).not.toBe("");
    await tab.press("ArrowLeft");
    await tab.wait(80);
    expect(await tab.run("q.shown()")).toBe("");
    await tab.run("q.select([1], 4)");
    await tab.type(" about my web");
    await tab.wait(80);
    expect(await tab.run("q.shown()")).toBe("");
    await tab.run("q.select([2, 1, 1], 1)");
    await tab.type(" about my web");
    await tab.wait(80);
    expect(await tab.run("q.shown()")).toBe("");
});

used("in a list, Tab at an item's start indents it, and Tab with words showing takes them", async () => {
    await fresh("- first\n- \n");
    await tab.run("q.select([0, 1, 0], 0)");
    await tab.press("Tab");
    await tab.wait(80);
    expect(await tab.run("q.md()")).toMatch(/^- first\n\n? {2,4}-\s*$/);
    await tab.type("about my web");
    await tab.wait(80);
    expect(await tab.run("q.shown()")).toBe("site and how it");
    await tab.press("Tab");
    await tab.wait(80);
    expect(await tab.run("q.md()")).toMatch(/^- first\n\n? {2,4}- about my website and how it\n$/);
});

used("the switch in Tools turns them off and back on, and is kept", async () => {
    await fresh();
    const line = (label: string) => tab.run(`q.editor.commands.tools().find((item) => item.label === ${JSON.stringify(label)})`);
    expect(await line("Suggest words as I type")).toMatchObject({ pressed: true });
    await tab.run(`q.editor.commands.tools().find((item) => item.label === "Suggest words as I type").run()`);
    expect(await tab.run(`localStorage.getItem("quire-suggest")`)).toBe("off");
    await tab.run("q.surface.focus()");
    await tab.type("about my web");
    await tab.wait(80);
    expect(await tab.run("q.shown()")).toBe("");
    expect(await line("Suggest words as I type")).toMatchObject({ pressed: false });
    await tab.run(`q.editor.commands.tools().find((item) => item.label === "Suggest words as I type").run()`);
    // learned again from the shelf, after the wait it takes on opening
    await tab.wait(4200);
    await fresh();
    await tab.type("about my web");
    await tab.wait(80);
    expect(await tab.run("q.shown()")).toBe("site and how it");
}, 40_000);

used("the faint ink is at least 3:1 on its ground and well under the text's own", async () => {
    await fresh();
    await tab.type("about my web");
    await tab.wait(200);
    const ratios = await tab.run<{ faint: number; ink: number }>(`(() => {
        const paint = document.createElement("canvas").getContext("2d", { willReadFrequently: true });
        const rgb = (colour) => { paint.clearRect(0, 0, 1, 1); paint.fillStyle = colour; paint.fillRect(0, 0, 1, 1); return [...paint.getImageData(0, 0, 1, 1).data].slice(0, 3); };
        const light = ([r, g, b]) => { const f = (c) => (c /= 255) <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b); };
        const ratio = (a, b) => { const [x, y] = [light(a), light(b)].sort((m, n) => n - m); return (x + 0.05) / (y + 0.05); };
        const ground = rgb(getComputedStyle(document.body).backgroundColor);
        return { faint: ratio(rgb(getComputedStyle(document.querySelector(".quire-suggestion")).color), ground), ink: ratio(rgb(getComputedStyle(q.surface.element).color), ground) };
    })()`);
    expect(ratios.faint).toBeGreaterThanOrEqual(3);
    expect(ratios.ink / ratios.faint).toBeGreaterThan(1.8);
});
