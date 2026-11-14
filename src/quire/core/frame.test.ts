// The frame a kind of document is edited in, used in headless Chromium with a kind of two menus and
// no document model at all: the top is made with its places, the name and the status in theirs; the
// menu row is the kind's own words, Alt and a word's letter opens its menu, and a shortcut runs the
// kind's command; the palette lists the kind's commands; full screen folds the top away and Escape
// brings it back; and destroyed, the frame leaves nothing behind. Skipped, with a notice, on a
// machine with no Chromium.

import { afterAll, beforeAll, expect, test } from "bun:test";
import { corePage, quire, type CorePage } from "../../../scripts/core-page";
import { chromium } from "../../../scripts/browser";

const live = !!chromium();
let page: CorePage | undefined;

beforeAll(async () => {
    if (!live) return console.warn("frame browser test skipped: needs a Chromium");
    page = await corePage(`
        import { createFrame } from "${quire}/core/frame.ts";
        const host = document.querySelector("#host");
        host.classList.add("quire-editor");
        const text = document.createElement("textarea");
        host.append(text);
        window.ran = [];
        window.listed = 0;
        const frame = createFrame(host, { name: "A note", onName: () => window.listed++ });
        const stamp = () => window.ran.push("stamp");
        frame.menus(() => [
            { label: "File", items: () => [{ label: "Stamp the date", key: "stamp", hint: "Ctrl+Shift+D", run: stamp }] },
            { label: "Edit", items: () => [{ label: "Tidy the lines", key: "tidy", run: () => window.ran.push("tidy") }] },
        ]);
        frame.keys((event) => (event.ctrlKey && event.shiftKey && event.code === "KeyD" ? stamp : undefined));
        frame.palette({ writing: () => text, back: () => text.focus() });
        frame.onFull(() => text.focus());
        window.frame = frame;
        window.text = text;
        text.focus();
    `);
}, 60_000);

afterAll(async () => {
    await page?.close();
});

const run = <T>(expression: string) => page!.tab.run<T>(expression);
const used = (name: string, body: () => Promise<void>) => test.skipIf(!live)(name, body, 30_000);
const menuLines = () => run<string[]>("[...document.querySelectorAll('.quire-menu.open .quire-menu-label')].map((each) => each.textContent)");

used("a top is made above the editor with the name and the status in their places, and the menu words are the kind's", async () => {
    expect(await run("document.querySelector('#host > .quire-top .quire-name-home .quire-name').textContent")).toBe("A note");
    expect(await run("!!document.querySelector('.quire-status-home .quire-status-line')")).toBe(true);
    expect(await run("[...document.querySelectorAll('.quire-menus-home .quire-row-word')].map((each) => each.textContent)")).toEqual(["File", "Edit"]);
    await run("document.querySelector('.quire-name').click()");
    expect(await run("window.listed")).toBe(1);
});

used("Alt and a word's letter opens its menu, and the kind's shortcut runs its command", async () => {
    await run("window.text.focus()");
    await page!.tab.press("e", { alt: true });
    await page!.tab.wait(400);
    expect(await menuLines()).toEqual(["Tidy the lines"]);
    await page!.tab.press("Escape");
    await page!.tab.wait(300);
    await run("window.text.focus()");
    await page!.tab.press("d", { ctrl: true, shift: true });
    expect(await run("window.ran")).toEqual(["stamp"]);
});

used("two taps of Ctrl open the palette on the kind's commands, and typing finds one", async () => {
    await run("window.text.focus()");
    await page!.tab.press("Control");
    await page!.tab.press("Control");
    await page!.tab.wait(400);
    expect(await run("document.activeElement.classList.contains('quire-palette-field')")).toBe(true);
    expect((await menuLines()).sort()).toEqual(["Stamp the date", "Tidy the lines"]);
    await page!.tab.type("tidy");
    await page!.tab.press("Enter");
    await page!.tab.wait(300);
    expect(await run("window.ran")).toEqual(["stamp", "tidy"]);
    expect(await run("document.activeElement === window.text")).toBe(true);
});

used("full screen folds the top away, Escape brings it back, and the writing keeps the keyboard", async () => {
    await run("window.frame.fullScreen(true)");
    expect(await run("[document.querySelector('.quire-top').classList.contains('folded'), document.querySelector('#host').classList.contains('full'), window.frame.isFull()]")).toEqual([true, true, true]);
    await page!.tab.press("Escape");
    expect(await run("[document.querySelector('.quire-top').classList.contains('folded'), window.frame.isFull(), document.activeElement === window.text]")).toEqual([false, false, true]);
});

used("destroyed, the frame takes its top, its button and its listeners away", async () => {
    await run("window.frame.destroy()");
    expect(await run("[!!document.querySelector('.quire-top'), !!document.querySelector('.quire-palette-button')]")).toEqual([false, false]);
    await run("window.text.focus()");
    await page!.tab.press("d", { ctrl: true, shift: true });
    expect(await run("window.ran")).toEqual(["stamp", "tidy"]);
});
