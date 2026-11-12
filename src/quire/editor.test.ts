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
import { closeOthers } from "${here}/ui.ts";
import { memoryStorage } from "${here}/versions.ts";
const host = document.querySelector("#host");
const storage = memoryStorage();
const editor = createEditor(host, read(""), { name: "Test", colors: [{ name: "Pink", value: "salmon" }], onImage: async () => "/picture.png", storage });
const surface = editor.surface;
window.q = {
    editor,
    reset(markdown, mdx) { closeOthers(); surface.setDocument(read(markdown, { mdx })); surface.focus(); },
    select(anchor, from, focus = anchor, to = from) { surface.setSelection({ anchor: { path: anchor, offset: from }, focus: { path: focus, offset: to } }); },
    md: () => write(surface.getDocument()),
    caret: () => surface.getSelection().focus,
    /** The middle of the first element matching, whose text includes the words if given. */
    at(selector, words) {
        const found = [...document.querySelectorAll(selector)].find((each) => !words || each.textContent.includes(words) || each.getAttribute("aria-label")?.startsWith(words));
        if (!found) return null;
        const box = found.getBoundingClientRect();
        const point = { x: box.left + box.width / 2, y: box.top + box.height / 2 };
        const top = document.elementFromPoint(point.x, point.y);
        if (!top || !(found === top || found.contains(top))) return { covered: top ? top.tagName + "." + top.className : "nothing on screen there" };
        return point;
    },
    /** One property of an element, read on every frame for a while: how it changed over time. */
    watch(selector, property, ms) {
        return new Promise((done) => {
            const seen = [];
            const start = performance.now();
            const look = () => {
                const element = document.querySelector(selector);
                seen.push(!element ? NaN : property === "x" ? element.getBoundingClientRect().left : parseFloat(getComputedStyle(element)[property]));
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
    const point = await tab.run<{ x: number; y: number; covered?: string } | null>(`q.at(${JSON.stringify(selector)}, ${JSON.stringify(words ?? "")})`);
    if (!point) throw new Error(`nothing to press: ${selector} ${words ?? ""}`);
    if (point.covered) throw new Error(`${selector} ${words ?? ""} is covered by ${point.covered}`);
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
    const widths = (await watching).filter((value) => value !== null && !Number.isNaN(value));
    const final = widths[widths.length - 1]!;
    expect(new Set(widths.map(Math.round)).size).toBeGreaterThan(5);
    expect(widths[0]!).toBeLessThan(final - 10);
    expect(Math.max(...widths)).toBeGreaterThan(final + 1);
    await tab.press("Escape");
    await tab.wait(400);

    await tab.media({ "prefers-reduced-motion": "reduce" });
    try {
        const still = tab.run<number[]>("q.watch('.quire-menu.open', 'width', 300)");
        await button("Style");
        // a menu that is not there reads as nothing, which comes back from the page as null
        const stillWidths = (await still).filter((value) => value !== null && !Number.isNaN(value));
        expect(stillWidths.length).toBeGreaterThan(3);
        expect({ widths: stillWidths, distinct: new Set(stillWidths.map(Math.round)).size }).toMatchObject({ distinct: 1 });
        await tab.press("Escape");
    } finally {
        await tab.media({});
        await tab.wait(400);
    }
    expect(tab.errors).toEqual([]);
});

used("the selection bar grows out of a selection over time, marks it, and its link field sets a link", async () => {
    await reset("Some words to select here\n", [0], 5);
    await tab.press("End");
    await reset("Some words to select here\n", [0], 5);
    const watching = tab.run<number[]>("q.watch('.quire-select-bar', 'opacity', 500)");
    for (let index = 0; index < 5; index++) await tab.press("ArrowRight", { shift: true });
    const opacities = await watching;
    expect(opacities[0]).toBe(0);
    expect(opacities[opacities.length - 1]).toBe(1);
    expect(opacities.filter((value) => value > 0 && value < 1).length).toBeGreaterThan(1);
    // it sits above the selection and does not cover it
    const sides = await tab.run<{ bar: number; text: number }>("(() => { const r = getSelection().getRangeAt(0).getBoundingClientRect(); return { bar: document.querySelector('.quire-select-bar').getBoundingClientRect().bottom, text: r.top }; })()");
    expect(sides.bar).toBeLessThanOrEqual(sides.text);

    await press(".quire-select-bar button", "Italic");
    expect(await md()).toBe("Some *words* to select here\n");
    await press(".quire-select-bar button", "Link");
    await tab.wait(300);
    expect(await tab.run("document.activeElement.className")).toBe("quire-link-field");
    await tab.type("https://example.com");
    await tab.press("Enter");
    await tab.wait(100);
    expect(await md()).toBe("Some [*words*](https://example.com) to select here\n");

    // a cursor alone, and the bar shrinks away
    await tab.press("ArrowRight");
    await tab.wait(400);
    expect(await tab.run("getComputedStyle(document.querySelector('.quire-select-bar')).visibility")).toBe("hidden");

    // Escape in the field goes back without a link
    await reset("Some words\n", [0], 0, [0], 4);
    await tab.wait(400);
    await press(".quire-select-bar button", "Link");
    await tab.wait(300);
    await tab.type("nowhere");
    await tab.press("Escape");
    expect(await md()).toBe("Some words\n");
});

used("the slash menu grows at the cursor, narrows as you type, and makes a heading and a table", async () => {
    await reset("Above\n", [0], 5);
    await tab.press("Enter");
    const watching = tab.run<number[]>("q.watch('.quire-slash.open', 'height', 600)");
    await tab.type("/");
    const heights = (await watching).filter((value) => value !== null && !Number.isNaN(value));
    expect(new Set(heights.map(Math.round)).size).toBeGreaterThan(4);
    expect(await tab.run("document.querySelectorAll('.quire-slash.open .quire-menu-line').length")).toBe(11);
    // it opens at the cursor
    const near = await tab.run<{ menu: number; caret: number }>("(() => ({ menu: document.querySelector('.quire-slash').getBoundingClientRect().top, caret: getSelection().getRangeAt(0).getBoundingClientRect().bottom }))()");
    expect(Math.abs(near.menu - near.caret)).toBeLessThan(30);
    await tab.type("head");
    await tab.wait(50);
    expect(await tab.run("[...document.querySelectorAll('.quire-slash.open .quire-menu-line')].map((line) => line.textContent)")).toEqual(["Heading 1H1", "Heading 2H2", "Heading 3H3"]);
    await tab.press("ArrowDown");
    await tab.press("Enter");
    await tab.type("Made");
    expect(await md()).toBe("Above\n\n## Made\n");

    // Escape closes it and leaves the slash as typed
    await tab.press("Enter");
    await tab.type("/ta");
    await tab.press("Escape");
    await tab.wait(50);
    expect(await md()).toBe("Above\n\n## Made\n\n/ta\n");
    expect(await tab.run("!!document.querySelector('.quire-slash.open')")).toBe(false);

    // a table, chosen with the mouse
    await reset("Above\n", [0], 5);
    await tab.press("Enter");
    await tab.type("/tab");
    await tab.wait(650);
    await press(".quire-slash.open .quire-menu-line", "Table");
    await tab.type("x");
    expect(await md()).toBe("Above\n\n| x   |     |     |\n| --- | --- | --- |\n|     |     |     |\n|     |     |     |\n");
});

used("a table's controls grow at its edge with the cursor in it, and add a row and a column and align it", async () => {
    await reset("| a | b |\n| --- | --- |\n| 1 | 2 |\n", [0, 1, 1], 1);
    await tab.press("ArrowLeft");
    await tab.press("ArrowRight");
    await tab.wait(500);
    expect(await tab.run("getComputedStyle(document.querySelector('.quire-table-tools')).opacity")).toBe("1");
    await press(".quire-table-tools button", "Add a row below");
    await tab.type("3");
    expect(await md()).toBe("| a   | b   |\n| --- | --- |\n| 1   | 2   |\n|     | 3   |\n");
    await press(".quire-table-tools button", "Add a column to the right");
    await tab.type("c");
    expect(await md()).toBe("| a   | b   |     |\n| --- | --- | --- |\n| 1   | 2   |     |\n|     | 3   | c   |\n");
    await press(".quire-table-tools button", "Centre the column");
    expect(await md()).toBe("| a   | b   |     |\n| --- | --- | :-: |\n| 1   | 2   |     |\n|     | 3   | c   |\n");
    await press(".quire-table-tools button", "Remove this column");
    await press(".quire-table-tools button", "Remove this row");
    expect(await md()).toBe("| a   | b   |\n| --- | --- |\n| 1   | 2   |\n");
    // Tab goes on to the next cell
    await reset("| a | b |\n| --- | --- |\n| 1 | 2 |\n", [0, 0, 0], 1);
    await tab.press("Tab");
    expect(await caret()).toEqual({ path: [0, 0, 1], offset: 1 });
    // out of the table, the controls shrink away
    await reset("Text\n", [0], 0);
    await tab.wait(400);
    expect(await tab.run("getComputedStyle(document.querySelector('.quire-table-tools')).visibility")).toBe("hidden");
});

used("a picture shows with its alt text written under it, which can be changed in place", async () => {
    await reset("![A tower](/tower.png)\n");
    expect(await tab.run("document.querySelector('.quire-image img').getAttribute('src')")).toBe("/tower.png");
    await press(".quire-alt");
    await tab.run("document.querySelector('.quire-alt').select()");
    await tab.type("A tall tower");
    await tab.press("Enter");
    await tab.run("document.querySelector('.quire-alt').blur()");
    await tab.wait(50);
    expect(await md()).toBe("![A tall tower](/tower.png)\n");
});

used("the outline lists the headings, follows the cursor, goes to a heading when clicked, and closes and opens", async () => {
    await reset("# One\n\nfirst\n\n## Two\n\nsecond\n\n## Three\n\nthird\n", [0], 0);
    await tab.wait(50);
    const links = () => tab.run<string[]>("[...document.querySelectorAll('.quire-outline-link')].map((link) => link.textContent)");
    const current = () => tab.run<string>("document.querySelector('.quire-outline-link.current')?.textContent ?? ''");
    expect(await links()).toEqual(["One", "Two", "Three"]);
    expect(await current()).toBe("One");
    await tab.run("q.select([5], 2)");
    await tab.wait(30);
    expect(await current()).toBe("Three");
    await tab.press("ArrowUp");
    await tab.press("ArrowUp");
    await tab.press("ArrowUp");
    await tab.wait(50);
    expect(await current()).toBe("Two");
    await press(".quire-outline-link", "One");
    expect(await caret()).toEqual({ path: [0], offset: 0 });
    expect(await current()).toBe("One");
    // a heading typed shows in it
    await tab.run("q.select([5], 5)");
    await tab.press("Enter");
    await tab.type("## Four");
    await tab.wait(50);
    expect(await links()).toEqual(["One", "Two", "Three", "Four"]);
    expect(await current()).toBe("Four");
    // closed from the three-dot menu its column flows shut over time, and opens again
    await choose("More", "Hide the outline");
    const places = await tab.run<number[]>("q.watch('.quire-paper', 'x', 600)");
    expect(new Set(places.map(Math.round)).size).toBeGreaterThan(3);
    expect(await tab.run("getComputedStyle(document.querySelector('.quire-outline')).visibility")).toBe("hidden");
    await choose("More", "Show the outline");
    await tab.wait(500);
    expect(await tab.run("getComputedStyle(document.querySelector('.quire-outline')).visibility")).toBe("visible");
});

used("on a narrow screen the outline is a panel that slides in when asked for and closes with Escape", async () => {
    await tab.resize(390, 844);
    await reset("# One\n\ntext\n", [0], 0);
    // the column it was goes away as a panel does, over a moment
    await tab.wait(600);
    expect(await tab.run("getComputedStyle(document.querySelector('.quire-outline')).visibility")).toBe("hidden");
    await choose("More", "Show the outline");
    const moves = await tab.run<number[]>("q.watch('.quire-outline', 'opacity', 400)");
    expect(moves[moves.length - 1]).toBe(1);
    expect(await tab.run("document.activeElement.textContent")).toBe("One");
    await tab.press("Escape");
    await tab.wait(500);
    expect(await tab.run("getComputedStyle(document.querySelector('.quire-outline')).visibility")).toBe("hidden");
    await tab.resize(1300, 900);
    await tab.wait(200);
});

used("a version is kept, listed with what changed, shown as it read, and restored as one undoable step", async () => {
    await reset("First draft.\n", [0], 12);
    await choose("More", "Version history");
    await tab.wait(600);
    expect(await tab.run("getComputedStyle(document.querySelector('.quire-history')).visibility")).toBe("visible");
    const first = await tab.run<number>("document.querySelectorAll('.quire-history-item').length");
    expect(first).toBeGreaterThan(0);
    await tab.press("Escape");
    await tab.wait(500);
    expect(await tab.run("getComputedStyle(document.querySelector('.quire-history')).visibility")).toBe("hidden");

    await tab.run("q.select([0], 12)");
    await tab.press("Enter");
    await tab.type("A second line.");
    expect(await md()).toBe("First draft.\n\nA second line.\n");
    await choose("More", "Version history");
    await tab.wait(600);
    const items = await tab.run<string[]>("[...document.querySelectorAll('.quire-history-item')].map((item) => item.textContent)");
    expect(items.length).toBe(first + 1);
    expect(items[0]).toContain("+2");
    // the one before, shown as it read and restored
    await press(".quire-history-list li:nth-child(2) .quire-history-item");
    await tab.wait(500);
    expect(await tab.run("document.querySelector('.quire-history-text').textContent")).toBe("First draft.");
    expect(await tab.run("document.querySelector('.quire-history-text').isContentEditable")).toBe(false);
    await press(".quire-restore");
    await tab.wait(100);
    expect(await md()).toBe("First draft.\n");
    await tab.press("z", { ctrl: true });
    expect(await md()).toBe("First draft.\n\nA second line.\n");
});

used("the Markdown view flows open beside the text, and what is typed in either shows in the other", async () => {
    await reset("# Title\n\nSome text.\n", [1], 10);
    await choose("More", "Show the Markdown");
    const source = "document.querySelector('.quire-source')";
    const opening = await tab.run<number[]>(`q.watch('.quire-source', 'opacity', 500)`);
    expect(opening[opening.length - 1]).toBe(1);
    expect(new Set(opening).size).toBeGreaterThan(2);
    expect(await tab.run(`${source}.value`)).toBe("# Title\n\nSome text.\n");
    // side by side on a wide screen
    const sides = await tab.run<{ text: number; source: number }>(`({ text: document.querySelector('.quire-paper').getBoundingClientRect().right, source: ${source}.getBoundingClientRect().left })`);
    expect(sides.source).toBeGreaterThan(sides.text);

    // typed in the text, it shows in the Markdown
    await tab.type(" More.");
    expect(await tab.run(`${source}.value`)).toBe("# Title\n\nSome text. More.\n");

    // typed in the Markdown, it shows in the text, the cursor staying where it was typed
    await tab.run(`(() => { const field = ${source}; field.focus(); field.setSelectionRange(7, 7); })()`);
    await tab.type(" here");
    await tab.wait(80);
    expect(await tab.run("document.querySelector('.quire h1').textContent")).toBe("Title here");
    expect(await tab.run(`${source}.selectionStart`)).toBe(12);
    await tab.run(`(() => { const field = ${source}; field.setSelectionRange(field.value.length, field.value.length); })()`);
    await tab.press("Enter");
    await tab.type("- a list item");
    await tab.press("Enter");
    await tab.wait(80);
    expect(await md()).toBe("# Title here\n\nSome text. More.\n\n- a list item\n");
    expect(await tab.run("document.querySelector('.quire ul li').textContent")).toBe("a list item");
    // the untouched heading is still the very element it was
    await tab.run("window.heading = document.querySelector('.quire h1')");
    await tab.type("x");
    await tab.wait(80);
    expect(await tab.run("window.heading === document.querySelector('.quire h1')")).toBe(true);
    await tab.press("Backspace");
    await tab.wait(80);

    // on a narrow screen it takes the text's place, and gives it back
    await tab.resize(390, 844);
    await tab.wait(600);
    expect(await tab.run("getComputedStyle(document.querySelector('.quire-paper')).visibility")).toBe("hidden");
    await choose("More", "Hide the Markdown");
    await tab.wait(600);
    expect(await tab.run("getComputedStyle(document.querySelector('.quire-paper')).visibility")).toBe("visible");
    expect(await tab.run(`getComputedStyle(${source}).visibility`)).toBe("hidden");
    await tab.resize(1300, 900);
    await tab.wait(300);
});

if (!live) console.warn("editor.test.ts: no Chromium on this machine, so the editor was not used.");
