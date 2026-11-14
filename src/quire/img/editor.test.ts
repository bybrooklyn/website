// What imgQuire's editor is held to in headless Chromium, by real keys and presses: the first Ctrl+C
// asks how to copy and the answer is kept, so the next does not ask; a step switched off in the steps
// list is left out of what is copied; a width typed in the resize box is applied with Enter; a saved
// picture is named from its document and carries no metadata; the menus hold the editor's lines, each
// with an icon; and version history draws a version's steps over the original.

import { afterAll, beforeAll, expect, test } from "bun:test";
import { imgPage, type ImgPage } from "../../../scripts/img-page";
import { MAIN } from "./editor";

test("a picture document keeps its steps in steps.json", () => {
    expect(MAIN).toBe("steps.json");
});

let page: ImgPage | undefined;
beforeAll(async () => {
    page = await imgPage("img-editor");
    if (!page) console.warn("editor browser test skipped: needs a Chromium");
});
afterAll(async () => {
    await page?.close();
});

test("the first Ctrl+C asks how to copy and keeps the answer; the next copies without asking", async () => {
    if (!page) return;
    const before = await page.paste("screenshot");
    await page.tab.press("c", { ctrl: true });
    await page.until("document.querySelector('dialog[open]')");
    expect(await page.tab.run("document.querySelector('dialog[open]').textContent")).toContain("Copy it as it looks, or as the export is set?");
    await page.tab.press("Enter");
    await page.copiedAfter(before);
    expect(await page.tab.run("localStorage.getItem('quire-img-copy')")).toBe("looks");
    await page.tab.press("c", { ctrl: true });
    await page.copiedAfter(before + 1);
    expect(await page.tab.run("!!document.querySelector('dialog[open]')")).toBe(false);
}, 30_000);

test("a step switched off in the steps list is left out of what is copied, and on again it is back", async () => {
    if (!page) return;
    await page.tab.press("r");
    await page.tab.drag(await page.onScreen(56, 188), await page.onScreen(420, 218), 6);
    await page.until("window.app.editing().steps().length === 1");
    const steps = await page.middle(".quire-img-bar [aria-label='Steps']");
    await page.tab.click(steps.x, steps.y);
    await page.until("document.querySelector('.quire-img-steps.open .quire-switch')");
    await page.tab.wait(600);
    expect(await page.tab.run("document.querySelector('.quire-img-steps .quire-switch').textContent")).toBe("Hide");
    const line = await page.middle(".quire-img-steps .quire-switch");
    await page.tab.click(line.x, line.y);
    expect(await page.tab.run("window.app.editing().steps()[0].off")).toBe(true);
    const red = async () => {
        const count = await page!.tab.run<number>("window.copied.length");
        await page!.tab.run("document.querySelector('.quire-img-stage').focus()");
        await page!.tab.press("c", { ctrl: true });
        await page!.until(`window.copied.length > ${count}`);
        return page!.tab.run<number>("(() => { const copied = window.copied.at(-1); let red = 0; for (let y = 188; y < 218; y++) for (let x = 56; x < 420; x++) { const at = (y * copied.width + x) * 4; if (copied.pixels[at] > 120 && copied.pixels[at + 1] < 90) red++; } return red; })()");
    };
    expect(await red()).toBeGreaterThan(100);
    await page.tab.click(line.x, line.y);
    expect(await red()).toBe(0);
    await page.tab.press("Escape");
}, 30_000);

test("a width typed in the resize box is applied with Enter, the height following the shape", async () => {
    if (!page) return;
    const resize = await page.middle(".quire-img-bar [aria-label='Resize']");
    await page.tab.click(resize.x, resize.y);
    await page.until("document.activeElement?.getAttribute('aria-label') === 'Width'");
    await page.tab.type("600");
    await page.tab.press("Enter");
    const steps = await page.tab.run<{ type: string; width?: number }[]>("window.app.editing().steps()");
    expect(steps.find((step) => step.type === "resize")).toMatchObject({ width: 600 });
    expect(await page.tab.run("document.activeElement?.className")).toBe("quire-img-stage");
}, 30_000);

test("a saved picture is named from its document and carries no metadata", async () => {
    if (!page) return;
    await page.tab.press("e");
    await page.until("document.querySelector('.quire-img-export.open')");
    await page.tab.wait(700);
    const png = await page.tab.run<{ x: number; y: number }>("(() => { const box = [...document.querySelectorAll('.quire-img-format')].find((each) => each.textContent === 'PNG').getBoundingClientRect(); return { x: box.x + box.width / 2, y: box.y + box.height / 2 }; })()");
    await page.tab.click(png.x, png.y);
    const save = await page.middle(".quire-img-export .quire-dialog-dismiss");
    await page.tab.click(save.x, save.y);
    await page.until("Object.keys(window.downloads).some((name) => name.endsWith('.png'))");
    const [name, bytes] = await page.tab.run<[string, number[]]>("Object.entries(window.downloads).find(([name]) => name.endsWith('.png'))");
    expect(name).toMatch(/^screenshot-\d+-nov-2026-\d\d-\d\d(-\d)?\.png$/);
    // a PNG of nothing but its picture: no text, time or Exif chunks
    const chunks: string[] = [];
    for (let at = 8; at < bytes.length; ) {
        const length = (bytes[at]! << 24) | (bytes[at + 1]! << 16) | (bytes[at + 2]! << 8) | bytes[at + 3]!;
        chunks.push(String.fromCharCode(...bytes.slice(at + 4, at + 8)));
        at += 12 + length;
    }
    expect(chunks.filter((chunk) => !["IHDR", "IDAT", "IEND", "sRGB", "gAMA", "cHRM", "pHYs"].includes(chunk))).toEqual([]);
    await page.tab.press("Escape");
}, 30_000);

test("every line of the menus has an icon, and the menu words are File, Edit, View, Image, Tools and Help", async () => {
    if (!page) return;
    const words = await page.tab.run<string[]>("[...document.querySelectorAll('.quire-menus-home .quire-row-word')].map((word) => word.textContent)");
    expect(words).toEqual(["File", "Edit", "View", "Image", "Tools", "Help"]);
    await page.tab.run("document.querySelector('.quire-img-stage').focus()");
    await page.tab.press("i", { alt: true });
    await page.until("document.querySelector('.quire-menu:popover-open .quire-menu-line')");
    const lines = await page.tab.run<{ label: string; icon: boolean }[]>("[...document.querySelectorAll('.quire-menu:popover-open .quire-menu-line')].map((line) => ({ label: line.textContent, icon: !!line.querySelector('svg') }))");
    expect(lines.map((line) => line.label).join(" ")).toContain("Resize");
    expect(lines.every((line) => line.icon)).toBe(true);
    await page.tab.press("Escape");
}, 30_000);

test("version history draws a version's steps over the original", async () => {
    if (!page) return;
    await page.tab.run("document.querySelector('.quire-img-stage').focus()");
    await page.tab.press("f", { alt: true });
    await page.until("document.querySelector('.quire-menu:popover-open .quire-menu-line')");
    await page.tab.run("[...document.querySelectorAll('.quire-menu:popover-open .quire-menu-line')].find((line) => line.textContent.includes('Version history')).click()");
    await page.until("document.querySelector('.quire-history.open .quire-history-item')");
    await page.tab.run("document.querySelector('.quire-history-item').click()");
    await page.until("document.querySelector('.quire-history-preview canvas.quire-img-version')?.width > 0");
    expect(await page.tab.run<number>("document.querySelector('.quire-img-version').width")).toBeLessThanOrEqual(360);
    await page.tab.press("Escape");
    await page.tab.press("Escape");
}, 30_000);
