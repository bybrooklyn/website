// What the plain note is held to: its names, its two commands (the date put in at the caret, the
// spaces at the ends of lines taken away) and the count its status shows; and, in headless Chromium,
// the core taking two kinds of document on one shelf. One of each is started from the same shelf,
// each shows its own menus, palette and bar and none of the other's, each is listed on the shelf
// with its own row, and each opens again from the shelf and from the documents list. Skipped, with a
// notice, on a machine with no Chromium.

import { afterAll, beforeAll, expect, test } from "bun:test";
import { corePage, quire, type CorePage } from "../../../scripts/core-page";
import { chromium } from "../../../scripts/browser";
import { linesIn, note, noteName, stamp, tidy } from "./note";

test("a note is a file ending .note, and starts as one", () => {
    expect([noteName("Today.note"), noteName("TODAY.NOTE"), noteName("post.md"), noteName("Untitled")]).toEqual([true, true, false, false]);
    expect(note().starts(new Date()).map((each) => each.name)).toEqual(["Untitled.note"]);
});

test("Insert the date puts the day in at the caret and moves the caret past it", () => {
    const done = stamp("Met on . Fine.", 7, new Date(2026, 10, 14));
    expect(done).toEqual({ text: "Met on November 14, 2026. Fine.", at: 24 });
});

test("Tidy the lines takes away the spaces and tabs at the end of each line, and nothing else", () => {
    expect(tidy("one  \ntwo\t\n  three \n\nfour")).toBe("one\ntwo\n  three\n\nfour");
});

test("the status counts the lines, a last empty line not counted", () => {
    expect([linesIn(""), linesIn("one"), linesIn("one\n"), linesIn("one\ntwo\n")]).toEqual(["0 lines", "1 line", "1 line", "2 lines"]);
});

// ---- two kinds on one shelf ----

const live = !!chromium();
let page: CorePage | undefined;
const TOP = '<header class="quire-top"><div class="quire-top-in"><div class="quire-top-line"><nav class="quire-trail"><a class="quire-word" href="/mdquire-kinds/">Quire</a><span class="quire-stroke quire-name-stroke">/</span><span class="quire-name-home"></span></nav><div class="quire-menus-home"></div><div class="quire-status-home"></div></div><div class="quire-bar-home"></div></div></header>';

beforeAll(async () => {
    if (!live) return console.warn("two kinds browser test skipped: needs a Chromium");
    page = await corePage(
        `
        import { startApp } from "${quire}/core/app.ts";
        import { markdown } from "${quire}/md/kind.ts";
        import { note } from "${quire}/note/note.ts";
        startApp(document.querySelector("#host"), { kinds: [markdown(), note()], database: "quire-kinds-test-${Date.now()}", top: document.querySelector(".quire-top") }).then((app) => (window.app = app));
        `,
        { body: `${TOP}<main id="main"><div id="host" class="quire-host"></div></main>` },
    );
    for (let tries = 0; tries < 100 && !(await page!.tab.run("!!window.app")); tries++) await page!.tab.wait(50);
}, 60_000);

afterAll(async () => {
    await page?.close();
});

const run = <T>(expression: string) => page!.tab.run<T>(expression);
const used = (name: string, body: () => Promise<void>) => test.skipIf(!live)(name, body, 40_000);
/** Presses the first element matching a selector whose words are these, as the mouse would. */
async function press(selector: string, words = "") {
    const point = await run<{ x: number; y: number } | null>(`(() => { const found = [...document.querySelectorAll(${JSON.stringify(selector)})].find((each) => !${JSON.stringify(words)} || each.textContent.trim() === ${JSON.stringify(words)}); if (!found) return null; const box = found.getBoundingClientRect(); return { x: box.x + box.width / 2, y: box.y + box.height / 2 }; })()`);
    if (!point) throw new Error(`nothing to press: ${selector} ${words}`);
    await page!.tab.click(point.x, point.y);
    await page!.tab.wait(700);
}
const words = () => run<string[]>("[...document.querySelectorAll('.quire-menus-home .quire-row-word')].map((each) => each.textContent)");
/** Every line of every menu of the row, the menus beside lines opened out. */
const menuLines = () => words().then(async ({ length: count }) => {
    const all: string[] = [];
    for (let index = 0; index < count; index++) {
        await run(`document.querySelectorAll('.quire-menus-home .quire-row-word')[${index}].click()`);
        await page!.tab.wait(350);
        all.push(...(await run<string[]>("[...document.querySelectorAll('.quire-menu.open .quire-menu-label')].map((each) => each.textContent)")));
        await page!.tab.press("Escape");
        await page!.tab.wait(250);
    }
    return all;
});
/** The palette's lines for what is typed. */
async function palette(typed: string) {
    await page!.tab.press("/", { alt: true });
    await page!.tab.wait(400);
    await run(`(() => { const field = document.querySelector('.quire-palette-field'); field.value = ${JSON.stringify(typed)}; field.dispatchEvent(new Event('input')); })()`);
    const found = await run<string[]>("[...document.querySelectorAll('.quire-palette-list .quire-menu-label')].map((each) => each.textContent)");
    await page!.tab.press("Escape");
    await page!.tab.wait(300);
    return found;
}

used("one shelf offers both kinds' ways to start, and a note started there has its own menus, palette and bar and none of mdQuire's", async () => {
    expect(await run("[...document.querySelectorAll('.quire-shelf-kinds .quire-shelf-word')].map((word) => word.textContent)")).toEqual(["blank", "blog post", "notes", "meeting notes", "changelog entry", "project page", "note"]);
    await press(".quire-shelf-kinds .quire-shelf-word", "note");
    expect(await run("document.activeElement.classList.contains('quire-note-text')")).toBe(true);
    expect(await words()).toEqual(["File", "Edit"]);
    const lines = await menuLines();
    expect(lines).toContain("Insert the date");
    expect(lines).toContain("Tidy the lines");
    for (const theirs of ["Version history", "Page setup", "Word count", "Text"]) expect(lines).not.toContain(theirs);
    expect(await palette("tidy")).toEqual(["Tidy the lines"]);
    expect(await palette("bold")).toEqual([]);
    expect(await run("[...document.querySelectorAll('.quire-bar-home button')].map((each) => each.getAttribute('aria-label'))")).toEqual(["Insert the date (Ctrl+Shift+D)", "Tidy the lines"]);
    // its own key, and its words saved to the browser
    await run("document.querySelector('.quire-note-text').focus()");
    await page!.tab.type("Buy bread   ");
    await press(".quire-bar-home button", "");
    await run("window.app.editing().flush()");
    expect(await run("document.querySelector('.quire-note-text').value")).toMatch(/^Buy bread {3}\w+ \d+, \d{4}$/);
    await run("[...document.querySelectorAll('.quire-bar-home button')][1].click()");
    expect(await run("document.querySelector('.quire-status-home .quire-count').textContent")).toBe("1 line");
});

used("an mdQuire document started from the same shelf has mdQuire's menus, palette and bar, and none of the note's", async () => {
    await run("document.querySelector('.quire-word').click()");
    await page!.tab.wait(1200);
    await press(".quire-shelf-kinds .quire-shelf-word", "blank");
    expect(await words()).toEqual(["File", "Edit", "View", "Insert", "Format", "Tools", "Help"]);
    const lines = await menuLines();
    expect(lines).toContain("Version history");
    expect(lines).toContain("Word count");
    for (const theirs of ["Insert the date", "Tidy the lines"]) expect(lines).not.toContain(theirs);
    expect(await palette("bold")).toContain("Bold");
    expect(await palette("tidy")).toEqual([]);
    expect(await run("!!document.querySelector('.quire-bar-home .quire-bar-strip') && !document.querySelector('.quire-note-text')")).toBe(true);
    await run("window.app.editing().editor.surface.pasteText('An mdQuire page')");
    await run("window.app.editing().flush()");
});

used("both are on the shelf, each with its own row, and each opens again from the shelf and from the documents list", async () => {
    await run("document.querySelector('.quire-word').click()");
    await page!.tab.wait(1200);
    const rows = await run<string[][]>("[...document.querySelectorAll('.quire-shelf-list .quire-shelf-open')].map((row) => [...row.children].slice(0, 2).map((part) => part.textContent))");
    expect(rows).toEqual([
        ["Untitled", "this browser"],
        ["Untitled.note", "note, this browser"],
    ]);
    await press(".quire-shelf-list .quire-shelf-open", "");
    expect(await words()).toHaveLength(7);
    // from the documents list, out of the name in the trail, the note opens in its own editor
    await press(".quire-name-home .quire-name");
    await press(".quire-documents-menu .quire-documents-item .quire-menu-line", "Untitled.note");
    expect(await words()).toEqual(["File", "Edit"]);
    expect(await run("document.querySelector('.quire-note-text').value")).toMatch(/^Buy bread {3}\w+ \d+, \d{4}$/);
    // and back to mdQuire's document the same way
    await press(".quire-name-home .quire-name");
    await press(".quire-documents-menu .quire-documents-item .quire-menu-line", "Untitled");
    expect(await words()).toHaveLength(7);
    expect(await run("window.app.editing().editor.surface.element.textContent")).toContain("An mdQuire page");
});
