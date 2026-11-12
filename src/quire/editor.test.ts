// The whole editor, used for real: a page holding it is bundled with the site's styles and opened
// in headless Chromium, where its buttons are clicked with the mouse and its keys pressed. After each
// step the Markdown the document writes is checked. Things that appear are watched frame by frame,
// to hold that they grow in over time rather than in one step, and that with less motion asked for
// they do not move. Skipped, with a notice, on a machine with no Chromium.

import { afterAll, beforeAll, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { browser, chromium, type Browser } from "../../scripts/browser";

const here = import.meta.dir;
const styles = `${here}/../styles`;

// What the page does: one editor, and ways for the test to reach into it.
const page = `
import { createEditor } from "${here}/editor.ts";
import { read } from "${here}/read.ts";
import { write } from "${here}/write.ts";
const host = document.querySelector("#host");
const editor = createEditor(host, read(""), { name: "Test", colors: [{ name: "Pink", value: "salmon" }], onImage: async () => "/picture.png" });
const surface = editor.surface;
window.q = {
    editor,
    reset(markdown, mdx) { surface.setDocument(read(markdown, { mdx })); surface.focus(); },
    select(anchor, from, focus = anchor, to = from) { surface.setSelection({ anchor: { path: anchor, offset: from }, focus: { path: focus, offset: to } }); },
    md: () => write(surface.getDocument()),
    caret: () => surface.getSelection().focus,
    /** The middle of the first element matching, whose text includes the words if given. */
    at(selector, words) {
        const found = [...document.querySelectorAll(selector)].find((each) => !words || each.textContent.includes(words) || each.getAttribute("aria-label")?.startsWith(words));
        if (!found) return null;
        const box = found.getBoundingClientRect();
        return { x: box.left + box.width / 2, y: box.top + box.height / 2 };
    },
    /** One property of an element, read on every frame for a while: how it changed over time. */
    watch(selector, property, ms) {
        return new Promise((done) => {
            const seen = [];
            const start = performance.now();
            const look = () => {
                const element = document.querySelector(selector);
                seen.push(element ? parseFloat(getComputedStyle(element)[property]) : NaN);
                if (performance.now() - start < ms) requestAnimationFrame(look);
                else done(seen);
            };
            requestAnimationFrame(look);
        });
    },
};
`;

let folder = "";
let tab: Browser;

beforeAll(async () => {
    if (!chromium()) return;
    folder = await mkdtemp(join(tmpdir(), "quire-editor-"));
    await Bun.write(`${folder}/page.ts`, page);
    const built = await Bun.build({ entrypoints: [`${folder}/page.ts`], target: "browser" });
    if (!built.success) throw new Error(built.logs.join("\n"));
    // the site's own styles, with its theme's colors as the layout would set them
    const theme = ":root{--ground:oklch(0.16 0.035 300);--surface:oklch(0.21 0.045 300);--rule:oklch(0.32 0.055 300);--ink:oklch(0.93 0.02 300);--muted:oklch(0.73 0.045 300);--accent:oklch(0.77 0.16 300)} body{max-width:none;display:block;padding:1rem}";
    const css = (await Promise.all(["tokens.css", "base.css", "prose.css", "quire.css"].map((name) => Bun.file(`${styles}/${name}`).text()))).join("\n");
    await Bun.write(`${folder}/page.html`, `<!doctype html><meta charset="utf-8"><style>${css}${theme}</style><div id="host"></div><script type="module">${await built.outputs[0]!.text()}</script>`);
    // a picture of one pixel, for the file chooser to give
    await Bun.write(`${folder}/tiny.png`, Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64"));
    tab = await browser({ width: 1300, height: 900 });
    await tab.open(`file://${folder}/page.html`, 300);
}, 60_000);

afterAll(async () => {
    if (!chromium()) return;
    await tab?.close();
    await rm(folder, { recursive: true, force: true });
});

const md = () => tab.run<string>("q.md()");
const caret = () => tab.run<{ path: number[]; offset: number }>("q.caret()");

/** Clicks with the mouse in the middle of the element found by q.at. */
async function press(selector: string, words?: string) {
    const point = await tab.run<{ x: number; y: number } | null>(`q.at(${JSON.stringify(selector)}, ${JSON.stringify(words ?? "")})`);
    if (!point) throw new Error(`nothing to press: ${selector} ${words ?? ""}`);
    await tab.click(point.x, point.y);
    await tab.wait(40);
}

/** Presses a bar button by the start of its label. */
const button = (label: string) => press(".quire-bar button", label);

/** Opens a bar menu and chooses a line of it, once the menu has grown far enough to be pressed. */
async function choose(label: string, line: string) {
    await button(label);
    await tab.wait(650);
    await press(".quire-menu.open .quire-menu-line", line);
    await tab.wait(60);
}

async function reset(markdown: string, anchor: number[] = [0], from = 0, focus = anchor, to = from) {
    await tab.run(`q.reset(${JSON.stringify(markdown)})`);
    await tab.run(`q.select(${JSON.stringify(anchor)}, ${from}, ${JSON.stringify(focus)}, ${to})`);
    await tab.wait(30);
}

const live = !!chromium();

/** A test that uses the browser, given the time a browser needs. */
const used = (name: string, run: () => Promise<void>) => test.skipIf(!live)(name, run, 30_000);

used("each mark button on the bar marks the selection", async () => {
    const marks: [string, string][] = [
        ["Bold", "a **word** here\n"],
        ["Italic", "a *word* here\n"],
        ["Underline", "a <u>word</u> here\n"],
        ["Strikethrough", "a ~~word~~ here\n"],
        ["Inline code", "a `word` here\n"],
    ];
    for (const [label, expected] of marks) {
        await reset("a word here\n", [0], 2, [0], 6);
        await button(label);
        expect(await md()).toBe(expected);
        expect(await tab.run(`document.querySelector('.quire-bar button[aria-label^="${label}"]').getAttribute("aria-pressed")`)).toBe("true");
    }
});

used("the list buttons, centre, undo and redo do what they say", async () => {
    for (const [label, expected] of [
        ["Bulleted list", "- Line\n"],
        ["Numbered list", "1. Line\n"],
        ["Checklist", "- [ ] Line\n"],
        ["Centre", '<div align="center">\n\nLine\n\n</div>\n'],
    ]) {
        await reset("Line\n", [0], 2);
        await button(label!);
        expect(await md()).toBe(expected!);
    }
    await button("Undo");
    expect(await md()).toBe("Line\n");
    await button("Redo");
    expect(await md()).toBe('<div align="center">\n\nLine\n\n</div>\n');
});

used("the style picker, + menu, color and size menus flow open and do what their lines say", async () => {
    await reset("Line\n", [0], 2);
    await choose("Style", "Heading 2");
    expect(await md()).toBe("## Line\n");
    expect(await tab.run("document.querySelector('.quire-style-label').textContent")).toBe("Heading 2");
    await choose("Style", "Quote");
    expect(await md()).toBe("> Line\n");

    await reset("Above\n", [0], 5);
    await choose("Add a block", "Table");
    expect(await md()).toBe("Above\n\n|     |     |     |\n| --- | --- | --- |\n|     |     |     |\n|     |     |     |\n");
    await reset("Above\n", [0], 5);
    await choose("Add a block", "Divider");
    expect(await md()).toBe("Above\n\n---\n");
    await reset("Above\n", [0], 5);
    await tab.files([`${folder}/tiny.png`]);
    await choose("Add a block", "Picture");
    await tab.wait(300);
    expect(await md()).toBe("Above\n\n![tiny](/picture.png)\n");

    await reset("a word here\n", [0], 2, [0], 6);
    await choose("Text color", "Pink");
    expect(await md()).toBe('a <span style="color:salmon">word</span> here\n');
    await reset("a word here\n", [0], 2, [0], 6);
    await choose("Text size", "Large");
    expect(await md()).toBe('a <span style="font-size:1.25em">word</span> here\n');
    expect(await tab.run("document.querySelector('.quire-count').textContent")).toBe("3 words");
});

used("the bar is a toolbar: the arrow keys move along it and Escape closes a menu back to its button", async () => {
    await reset("Line\n", [0], 0);
    await tab.run(`document.querySelector('.quire-bar button[aria-label^="Bold"]').focus()`);
    await tab.press("ArrowRight");
    expect(await tab.run("document.activeElement.getAttribute('aria-label')")).toBe("Italic (Ctrl+I)");
    await tab.press("ArrowLeft");
    await tab.press("ArrowLeft");
    expect(await tab.run("document.activeElement.getAttribute('aria-label')")).toBe("Style");
    await tab.press("ArrowDown");
    await tab.wait(100);
    expect(await tab.run("document.activeElement.textContent")).toContain("Paragraph");
    await tab.press("Escape");
    expect(await tab.run("document.activeElement.getAttribute('aria-label')")).toBe("Style");
    expect(await tab.run("[...document.querySelectorAll('.quire-bar button')].filter((b) => b.tabIndex === 0).length")).toBe(1);
});

used("a menu grows open over time, past its size and back, and with less motion asked for it does not", async () => {
    await reset("Line\n", [0], 0);
    const watching = tab.run<number[]>("q.watch('.quire-menu.open', 'width', 700)");
    await button("Style");
    const widths = (await watching).filter((value) => !Number.isNaN(value));
    const final = widths[widths.length - 1]!;
    expect(new Set(widths.map(Math.round)).size).toBeGreaterThan(5);
    expect(widths[0]!).toBeLessThan(final - 10);
    expect(Math.max(...widths)).toBeGreaterThan(final + 1);
    await tab.press("Escape");
    await tab.wait(400);

    await tab.media({ "prefers-reduced-motion": "reduce" });
    const still = tab.run<number[]>("q.watch('.quire-menu.open', 'width', 300)");
    await button("Style");
    const stillWidths = (await still).filter((value) => !Number.isNaN(value));
    expect(new Set(stillWidths.map(Math.round)).size).toBe(1);
    await tab.press("Escape");
    await tab.media({});
    await tab.wait(400);
    expect(tab.errors).toEqual([]);
});

if (!live) console.warn("editor.test.ts: no Chromium on this machine, so the editor was not used.");
