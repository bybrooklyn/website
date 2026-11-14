// Checking, used for real in headless Chromium: the whole editor bundled with the site's styles and
// served over http with the dictionary, then the built /mdquire/ page (`bun run build`). Held true:
// a writer who never set checking sees misspellings underlined at once, and nothing else; whoever
// switched it off keeps it off, and nothing of it loads until Tools, Checking; the underlines are
// drawn, the count is right, a click opens the popover from the word, a fix is one undo step, a
// right-click on a misspelling puts its spellings first in the text's menu, ignoring and adding to
// the dictionary take the underline away, Personal dictionary lists her words, removes one and adds
// a text file's, the list jumps to its findings, F8 goes to the next, the settings switch a kind off,
// a word still being typed is not underlined, a key typed in a 5,000-line document with checking on
// is painted in under 16 ms, and a dictionary that does not load leaves spelling to the browser and
// says so. Skipped, with a notice, on a machine with no Chromium.

import { afterAll, beforeAll, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { withoutSpeech } from "../../../scripts/dictation-stubs";
import { browser, chromium, type Browser } from "../../../scripts/browser";

const here = import.meta.dir;
const root = `${here}/../../..`;
const dist = `${root}/dist`;
const live = !!chromium();
const built = live && existsSync(`${dist}/mdquire/index.html`);

const page = `
import { createEditor } from "${here}/../editor.ts";
import { read } from "${here}/../read.ts";
import { write } from "${here}/../write.ts";
import { closeOthers } from "${here}/../ui.ts";
const editor = createEditor(document.querySelector("#host"), read(""), { name: "Test" });
const surface = editor.surface;
window.q = {
    editor,
    surface,
    reset(markdown) { closeOthers(); surface.setDocument(read(markdown)); surface.focus(); },
    select(path, from, to = from) { surface.setSelection({ anchor: { path, offset: from }, focus: { path, offset: to } }); },
    md: () => write(surface.getDocument()),
    /** The middle of the nth place the words are drawn in the text. */
    word(words, nth = 0) {
        const walker = document.createTreeWalker(surface.element, NodeFilter.SHOW_TEXT);
        let seen = 0;
        for (let node = walker.nextNode(); node; node = walker.nextNode()) {
            let at = node.data.indexOf(words);
            while (at >= 0) {
                if (seen++ === nth) {
                    const range = document.createRange();
                    range.setStart(node, at + 1);
                    range.setEnd(node, at + words.length - 1);
                    const box = range.getBoundingClientRect();
                    return { x: box.left + box.width / 2, y: box.top + box.height / 2 };
                }
                at = node.data.indexOf(words, at + 1);
            }
        }
        return null;
    },
    marked: () => Object.fromEntries(["spelling", "markdown", "link", "prose"].map((kind) => [kind, CSS.highlights.get("quire-check-" + kind)?.size ?? 0])),
    loaded: () => performance.getEntriesByType("resource").map((entry) => entry.name).filter((name) => name.includes("words-en")),
};
`;

let folder = "";
let tab: Browser;
let server: ReturnType<typeof Bun.serve> | undefined;
/** Set to make the dictionary fail to load, as on a first visit offline. */
let dictionaryFails = false;

beforeAll(async () => {
    if (!live) return;
    folder = await mkdtemp(join(tmpdir(), "quire-check-"));
    await Bun.write(`${folder}/page.ts`, page);
    const bundle = await Bun.build({ entrypoints: [`${folder}/page.ts`], target: "browser", plugins: [withoutSpeech], splitting: true, outdir: `${folder}/out` });
    if (!bundle.success) throw new Error(bundle.logs.join("\n"));
    const theme = ":root{--ground:oklch(0.16 0.035 300);--surface:oklch(0.21 0.045 300);--rule:oklch(0.32 0.055 300);--ink:oklch(0.93 0.02 300);--muted:oklch(0.73 0.045 300);--accent:oklch(0.77 0.16 300)} body{max-width:none;display:block;padding:1rem}";
    const css = (await Promise.all(["tokens.css", "base.css", "prose.css", "quire.css", "quire-markdown.css", "quire-extras.css"].map((name) => Bun.file(`${root}/src/styles/${name}`).text()))).join("\n");
    await Bun.write(`${folder}/out/index.html`, `<!doctype html><meta charset="utf-8"><style>${css}${theme}</style><div id="host"></div><script type="module" src="/page.js"></script>`);
    server = Bun.serve({
        port: 0,
        async fetch(request) {
            let path = new URL(request.url).pathname;
            if (path === "/quire/words-en.dat") return dictionaryFails ? new Response("gone", { status: 404 }) : new Response(Bun.file(`${root}/public/quire/words-en.dat`));
            if (path.startsWith("/site/")) {
                path = path.slice(5);
                if (path.endsWith("/")) path += "index.html";
                const file = Bun.file(dist + path);
                return (await file.exists()) ? new Response(file) : new Response("missing", { status: 404 });
            }
            if (path === "/") path = "/index.html";
            const file = Bun.file(`${folder}/out${path}`);
            if (await file.exists()) return new Response(file);
            // the built site's own files, which its pages ask for from the top
            const site = Bun.file(dist + path);
            return (await site.exists()) ? new Response(site) : new Response("missing", { status: 404 });
        },
    });
    tab = await browser({ width: 1300, height: 900 });
    await tab.open(`http://localhost:${server.port}/`, 300);
}, 60_000);

afterAll(async () => {
    if (!live) return;
    await tab?.close();
    server?.stop();
    await rm(folder, { recursive: true, force: true });
});

const used = (name: string, run: () => Promise<void>, ms = 40_000) => test.skipIf(!live)(name, run, ms);

/** Clicks the middle of the first element matching whose text or label starts with the words. */
async function press(selector: string, words = "") {
    const point = await tab.run<{ x: number; y: number } | null>(`(() => {
        const found = [...document.querySelectorAll(${JSON.stringify(selector)})].find((each) => !${JSON.stringify(words)} || each.textContent.includes(${JSON.stringify(words)}) || (each.getAttribute("aria-label") ?? "").startsWith(${JSON.stringify(words)}));
        if (!found) return null;
        const box = found.getBoundingClientRect();
        return { x: box.left + box.width / 2, y: box.top + box.height / 2 };
    })()`);
    if (!point) throw new Error(`nothing to press: ${selector} ${words}`);
    await tab.click(point.x, point.y);
    await tab.wait(60);
}

/** Waits until an expression in the page is true. */
async function until(expression: string, ms = 5000) {
    const end = Date.now() + ms;
    while (Date.now() < end) {
        if (await tab.run<boolean>(expression)) return;
        await tab.wait(40);
    }
    throw new Error(`waited in vain for ${expression}`);
}

const md = () => tab.run<string>("q.md()");
const marked = () => tab.run<Record<string, number>>("q.marked()");
const counted = () => tab.run<string>("document.querySelector('.quire-check-count')?.textContent ?? ''");
const popped = () => tab.run<string>("document.querySelector('.quire-check-pop.open')?.textContent ?? ''");

/** Clicks the middle of a word in the text. */
async function clickWord(words: string, nth = 0) {
    const point = await tab.run<{ x: number; y: number } | null>(`q.word(${JSON.stringify(words)}, ${nth})`);
    if (!point) throw new Error(`no ${words} in the text`);
    await tab.click(point.x, point.y);
    await tab.wait(80);
}

const TEXT = "Teh cat sat on teh mat. It was the the best.\n\nA [link](#nowhere) here.\n";

used("a writer who never set checking sees misspellings underlined from the first document, in American, and nothing else", async () => {
    await tab.run(`q.reset(${JSON.stringify(TEXT + "\nThe colour of it.\n")})`);
    await until("q.marked().spelling === 3");
    expect(await tab.run<string[]>("q.loaded()")).toHaveLength(1);
    expect(await marked()).toEqual({ spelling: 3, markdown: 0, link: 0, prose: 0 });
    expect(await counted()).toBe("3");
    // the browser's own spelling marks are off while these are on
    expect(await tab.run("q.surface.element.spellcheck")).toBe(false);
});

used("whoever switched checking off keeps it off: nothing of it loads until Tools, Checking", async () => {
    await tab.run("localStorage.setItem('quire-check', JSON.stringify({ on: false, settings: { kinds: { spelling: true, prose: true, markdown: true, link: true } } }))");
    await tab.open(`http://localhost:${server!.port}/`, 300);
    await tab.run(`q.reset(${JSON.stringify(TEXT)})`);
    await tab.wait(400);
    expect(await tab.run("q.loaded()")).toEqual([]);
    expect(await tab.run("document.querySelector('.quire-check-count') === null")).toBe(true);
    expect(await tab.run("q.surface.element.spellcheck")).toBe(true);
    await press(".quire-row-word", "Tools");
    await tab.wait(650);
    await press(".quire-menu.open .quire-menu-line", "Checking");
    await until("q.marked().spelling === 2");
    expect(await tab.run<string[]>("q.loaded()")).toHaveLength(1);
    expect(await marked()).toEqual({ spelling: 2, markdown: 0, link: 1, prose: 1 });
    expect(await counted()).toBe("4");
    expect(await tab.run("q.surface.element.spellcheck")).toBe(false);
    // what was found opened with it, from Tools, as Docs' Spelling and grammar does
    await until("!!document.querySelector('.quire-check-list.open')");
    await tab.press("Escape");
    await tab.wait(300);
});

used("a click opens the popover from the word, and a fix is one undo step", async () => {
    await clickWord("teh", 0);
    await until("!!document.querySelector('.quire-check-pop.open')");
    expect(await popped()).toContain("\"teh\" is not in the dictionary.");
    await tab.wait(500);
    await press(".quire-check-pop.open .quire-check-fix", "the");
    expect(await md()).toBe("Teh cat sat on the mat. It was the the best.\n\nA [link](#nowhere) here.\n");
    await until("q.marked().spelling === 1");
    await tab.run("q.surface.undo()");
    expect(await md()).toBe(TEXT);
    await tab.run("q.surface.redo()");
    expect(await md()).toBe("Teh cat sat on the mat. It was the the best.\n\nA [link](#nowhere) here.\n");
});

/** Right-clicks the middle of a word in the text, as the browser would send it. */
async function rightClick(words: string) {
    const point = await tab.run<{ x: number; y: number }>(`q.word(${JSON.stringify(words)})`);
    await tab.run(`q.surface.element.dispatchEvent(new MouseEvent("contextmenu", { clientX: ${point.x}, clientY: ${point.y}, bubbles: true, cancelable: true }))`);
}
/** The lines of the text's menu as drawn: their words, and whether each is strong or parted from the line before. */
const menuLines = () => tab.run<string[]>("[...document.querySelectorAll('.quire-text-menu.open .quire-menu-items > *')].map((line) => (line.classList.contains('quire-menu-strong') ? '*' : '') + (line.classList.contains('quire-menu-parted') ? '| ' : '') + (line.querySelector('.quire-menu-label')?.textContent ?? line.textContent))");

used("a right-click on a misspelled word puts its spellings first in the text's menu, then Add to dictionary and Ignore, then the rest", async () => {
    await rightClick("Teh");
    await until("!!document.querySelector('.quire-text-menu.open')");
    await tab.wait(400);
    const lines = await menuLines();
    expect(lines[0]!.startsWith("*")).toBe(true);
    expect(lines).toContain("*The");
    const at = lines.indexOf("Add to dictionary");
    expect(at).toBeGreaterThan(0);
    expect(lines.slice(at, at + 3)).toEqual(["Add to dictionary", "Ignore in this document", "| Cut"]);
    expect(lines.slice(0, at).every((line) => line.startsWith("*"))).toBe(true);
    expect(await tab.run("!!document.querySelector('.quire-check-pop.open')")).toBe(false);
    await tab.press("Escape");
    await tab.wait(300);
    // a spelling chosen there is put in, as one undo step
    await rightClick("Teh");
    await until("!!document.querySelector('.quire-text-menu.open')");
    await tab.wait(400);
    await press(".quire-text-menu.open .quire-menu-line", "The");
    expect(await md()).toBe("The cat sat on the mat. It was the the best.\n\nA [link](#nowhere) here.\n");
    await tab.run("q.surface.undo()");
    expect(await md()).toBe("Teh cat sat on the mat. It was the the best.\n\nA [link](#nowhere) here.\n");
    // a finding that is not a misspelling opens its popover
    await until("q.marked().spelling === 1");
    await rightClick("the the");
    await until("!!document.querySelector('.quire-check-pop.open')");
    expect(await popped()).toContain("twice");
    await tab.press("Escape");
    await tab.wait(300);
    // and a word with nothing found is the text's own menu, Cut first
    await rightClick("cat");
    await until("!!document.querySelector('.quire-text-menu.open')");
    expect((await menuLines())[0]).toBe("Cut");
    await tab.press("Escape");
    await tab.wait(300);
});

used("ignoring and adding to the dictionary take the underline away", async () => {
    await clickWord("Teh");
    await until("!!document.querySelector('.quire-check-pop.open')");
    await tab.wait(500);
    await press(".quire-check-pop.open .quire-check-action", "Ignore in this document");
    await until("q.marked().spelling === 0");
    expect(await tab.run("JSON.parse(localStorage.getItem('quire-check-ignore:name:Test')).words")).toEqual(["Teh"]);
    await tab.run(`q.reset("Iroh is a wrod.\\n")`);
    await until("q.marked().spelling === 2");
    await clickWord("Iroh");
    await until("!!document.querySelector('.quire-check-pop.open')");
    await tab.wait(500);
    await press(".quire-check-pop.open .quire-check-action", "Add to dictionary");
    await until("q.marked().spelling === 1");
    expect(await tab.run("JSON.parse(localStorage.getItem('quire-check-words')).words")).toEqual(["Iroh"]);
});

used("Personal dictionary lists her words: one removed is marked again, and a text file's words are added", async () => {
    await tab.run(`q.reset("Iroh and wgpu are a wrod.\\n")`);
    await until("q.marked().spelling === 2");
    await tab.run(`q.editor.commands.tools().find((item) => item.label === "Personal dictionary").run()`);
    await until("!!document.querySelector('dialog.quire-own-dialog[open]')");
    await tab.wait(500);
    const words = () => tab.run<string[]>("[...document.querySelectorAll('dialog.quire-own-dialog[open] .quire-own-text')].map((word) => word.textContent)");
    expect(await words()).toEqual(["Iroh"]);
    expect(await tab.run<string[]>("[...document.querySelectorAll('dialog.quire-own-dialog[open] .quire-dialog-actions button')].map((b) => b.textContent)")).toEqual(["Download as text", "Add from a text file", "Done"]);
    await press("dialog.quire-own-dialog[open] .quire-own-remove");
    expect(await words()).toEqual([]);
    expect(await tab.run<string>("document.querySelector('dialog.quire-own-dialog[open] .quire-own-none').textContent")).toBe("No words yet. Right-click a word marked as misspelled and choose Add to dictionary.");
    expect(await tab.run("JSON.parse(localStorage.getItem('quire-check-words')).words")).toEqual([]);
    await until("q.marked().spelling === 3");
    // a file of words, one to a line, is added to the list
    await Bun.write(`${folder}/words.txt`, "wgpu\nIroh\n\nnot a word\n");
    await tab.files([`${folder}/words.txt`]);
    await press("dialog.quire-own-dialog[open] .quire-dialog-actions button", "Add from a text file");
    await until("document.querySelectorAll('dialog.quire-own-dialog[open] .quire-own-text').length === 2");
    expect(await words()).toEqual(["Iroh", "wgpu"]);
    expect(await tab.run<string>("document.querySelector('dialog.quire-own-dialog[open] .quire-own-count').textContent")).toBe("2 words added.");
    await press("dialog.quire-own-dialog[open] .quire-dialog-actions button", "Done");
    await until("!document.querySelector('dialog.quire-own-dialog[open]')");
    await until("q.marked().spelling === 1");
    await tab.files([]);
});

used("the count opens the list of everything, which jumps to a finding; F8 goes to the next", async () => {
    await tab.run(`q.reset(${JSON.stringify("A wrod here.\n\nIt was the the best.\n\nAnother wrdo.\n")})`);
    await until("q.marked().spelling === 2 && q.marked().prose === 1");
    await press(".quire-check-count");
    await until("!!document.querySelector('.quire-check-list.open')");
    await tab.wait(600);
    const list = await tab.run<string>("document.querySelector('.quire-check-list.open').textContent");
    expect(list).toContain("3 things to look at");
    expect(list).toContain("Reading ease");
    expect(list).toContain("Spelling 2");
    expect(list).toContain("Writing 1");
    // each misspelling is a line of its own, as these two differ
    await press(".quire-check-list.open .quire-check-line", "wrdo");
    await until("!!document.querySelector('.quire-check-pop.open')");
    expect(await tab.run("q.surface.getSelection().focus")).toEqual({ path: [2], offset: 12 });
    expect(await popped()).toContain("\"wrdo\" is not in the dictionary.");
    await tab.press("Escape");
    await tab.run("q.select([0], 0)");
    await tab.press("F8");
    await until("document.querySelector('.quire-check-pop.open')?.textContent.includes('wrod')");
    await tab.press("Escape");
    await tab.wait(100);
    await tab.press("F8");
    await until("document.querySelector('.quire-check-pop.open')?.textContent.includes('twice')");
    await tab.press("Escape");
});

used("a word still being typed is not underlined until the cursor leaves it", async () => {
    await tab.run(`q.reset("Fine words.\\n")`);
    await tab.run("q.select([0], 10)");
    await tab.type(" and wrdo");
    await tab.wait(900);
    expect((await marked()).spelling).toBe(0);
    await tab.type(" ");
    await until("q.marked().spelling === 1");
});

used("the settings switch a kind off, and it stays off", async () => {
    await tab.run(`q.reset("It was the the best wrod.\\n")`);
    await until("q.marked().spelling === 1 && q.marked().prose === 1");
    await press(".quire-check-count");
    await tab.wait(600);
    await press(".quire-check-list.open .quire-check-action", "Settings");
    // the settings are a dialog
    await until("!!document.querySelector('dialog.quire-check-settings[open]')");
    await tab.wait(600);
    await press("dialog.quire-check-settings[open] .quire-check-switch", "All of writing");
    await until("q.marked().prose === 0");
    expect((await marked()).spelling).toBe(1);
    expect(await tab.run("JSON.parse(localStorage.getItem('quire-check')).settings.kinds.prose")).toBe(false);
    await press("dialog.quire-check-settings[open] .quire-check-switch", "All of writing");
    await until("q.marked().prose === 1");
    await tab.press("Escape");
    await until("!document.querySelector('dialog.quire-check-settings')");
});

used("with checking on, a 5,000-line document is checked in idle time and a key typed in its middle is painted in under 16 ms", async () => {
    const opened = await tab.run<{ start: number }>(`(() => {
        const parts = [];
        for (let index = 0; parts.length < 5000; index++) {
            parts.push("## Section " + index, "", "A paragraph of ordinary length, with **bold**, *italic* and a [link](https://example.com) in it, long enough to wrap onto a second line. Number " + index + " has a wrod.", "", "- one point", "- another point", "", "\\u0060\\u0060\\u0060js", "let n = " + index + ";", "\\u0060\\u0060\\u0060", "", "| a | b |", "| - | - |", "| 1 | 2 |", "");
        }
        window.startedAt = performance.now();
        q.reset(parts.slice(0, 5000).join("\\n") + "\\n");
        return { start: window.startedAt };
    })()`);
    expect(opened.start).toBeGreaterThan(0);
    await until("q.marked().spelling > 300", 20_000);
    const first = await tab.run<number>("performance.now() - window.startedAt");
    await tab.run(`(() => {
        const blocks = q.surface.getDocument().blocks;
        const middle = blocks.findIndex((block, index) => index > blocks.length / 2 && block.kind === "paragraph");
        q.select([middle], 10);
        window.keys = [];
        q.surface.element.addEventListener("keydown", () => (window.started = performance.now()), true);
        q.surface.element.addEventListener("beforeinput", () => (window.started ??= performance.now()), true);
        q.surface.on("change", () => {
            document.body.offsetHeight;
            window.keys.push(performance.now() - window.started);
            window.started = undefined;
        });
    })()`);
    await tab.wait(300);
    await tab.type("typing in the middle");
    await tab.wait(1500);
    const keys = await tab.run<number[]>("window.keys");
    expect(keys.length).toBe(20);
    const sorted = [...keys].sort((a, b) => a - b);
    const median = sorted[Math.floor(sorted.length / 2)]!;
    const worst = sorted[sorted.length - 1]!;
    console.log(`checking on, 5,000 lines: first full check ${first.toFixed(0)} ms; a key in the middle: median ${median.toFixed(1)} ms, slowest ${worst.toFixed(1)} ms`);
    expect(median).toBeLessThan(16);
    expect(worst).toBeLessThan(16);
    // checked again after typing, the underlines are still there
    expect((await marked()).spelling).toBeGreaterThan(300);
}, 60_000);

used("when the dictionary does not load, the browser's own spelling is switched back on and the list says spelling is unavailable", async () => {
    dictionaryFails = true;
    try {
        await tab.run("localStorage.setItem('quire-check', JSON.stringify({ on: true, settings: { kinds: { spelling: true, prose: true, markdown: true, link: true } } }))");
        await tab.open(`http://localhost:${server!.port}/`, 300);
        await tab.run("q.reset('A wrod here.\\n')");
        await until("!!document.querySelector('.quire-check-count.shown')");
        await until("q.surface.element.spellcheck === true");
        await press(".quire-check-count");
        await until("!!document.querySelector('.quire-check-list.open')");
        expect(await tab.run<string>("document.querySelector('.quire-check-list.open .quire-check-unavailable')?.textContent ?? ''")).toBe("Spelling is unavailable: the dictionary did not load, so the browser's own spelling is on.");
        await tab.press("Escape");
    } finally {
        dictionaryFails = false;
    }
});

test.skipIf(!built)("in the built page, the dictionary is fetched at once for a writer who never set checking, and only when checking is first used for one who switched it off", async () => {
    await tab.open(`http://localhost:${server!.port}/site/mdquire/`, 800);
    await tab.run("localStorage.clear()");
    await tab.open(`http://localhost:${server!.port}/site/mdquire/`, 1200);
    await until("performance.getEntriesByType('resource').some((entry) => entry.name.includes('words-en'))", 8000);
    await tab.run("localStorage.setItem('quire-check', JSON.stringify({ on: false }))");
    await tab.open(`http://localhost:${server!.port}/site/mdquire/`, 1200);
    const before = await tab.run<string[]>("performance.getEntriesByType('resource').map((entry) => entry.name)");
    expect(before.filter((name) => name.includes("words-en"))).toEqual([]);
    await until("!!document.querySelector('.quire-shelf-word')");
    await press(".quire-shelf-word", "blank");
    await tab.wait(900);
    await press(".quire-row-word", "Tools");
    await tab.wait(650);
    await press(".quire-menu.open .quire-menu-line", "Checking");
    await until("performance.getEntriesByType('resource').some((entry) => entry.name.includes('words-en'))", 8000);
    const after = await tab.run<string[]>("performance.getEntriesByType('resource').map((entry) => entry.name)");
    const scripts = after.filter((name) => !before.includes(name) && name.endsWith(".js"));
    expect(scripts.length).toBeGreaterThan(0);
    await until("!!document.querySelector('.quire-check-count.shown')");
    expect(tab.errors).toEqual([]);
}, 40_000);

if (!live) console.warn("view.test.ts: no Chromium on this machine, so checking was not used.");
