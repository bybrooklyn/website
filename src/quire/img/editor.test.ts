// What imgQuire's editor is held to in headless Chromium, by real keys and presses: the first Ctrl+C
// asks how to copy and the answer is kept, so the next does not ask; pressed again where marks lie
// on one another, the one beneath is picked, Edit brings it forward and Delete takes it away; a width typed in the resize box is applied with Enter; a saved
// picture is named from its document and carries no metadata; the menus hold the editor's lines, each
// with an icon; and version history draws a version's steps over the original.

import { afterAll, beforeAll, expect, test } from "bun:test";
import { imgPage, type ImgPage } from "../../../scripts/img-page";
import { MAIN, readPen } from "./editor";

test("a picture document keeps its steps in steps.json", () => {
    expect(MAIN).toBe("steps.json");
});

test("the pen kept in this browser is read field by field, what is missing or wrong taken from the start, a pen from before reading as it did", () => {
    expect(readPen(null)).toEqual({ color: "#ff3b30", weight: 0.005, outlineWeight: 0.08, align: "left", zoom: 2, dim: 0.55, mark: "arrow" });
    expect(readPen('{"color":"#0a84ff","weight":0.009}')).toMatchObject({ color: "#0a84ff", weight: 0.009, mark: "arrow" });
    expect(readPen('{"color":"red","weight":7,"outline":"#000000","align":"center","zoom":4,"dim":0.75,"round":true,"mark":"spotlight"}')).toEqual({ color: "#ff3b30", weight: 0.005, outline: "#000000", outlineWeight: 0.08, align: "center", zoom: 4, dim: 0.75, round: true, mark: "spotlight" });
    expect(readPen('{"zoom":40,"mark":"explode","align":"justify","outline":"#123456"}')).toEqual(readPen(null));
    expect(readPen("not json")).toEqual(readPen(null));
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

test("a picture opens with no tool on and nothing over it, the side panel showing the export; each tool is a word on the bar, and Escape leaves it, from the picture or from the panel, the export showing again", async () => {
    if (!page) return;
    await page.paste("screenshot");
    const state = () => page!.tab.run<[string, string, string[], boolean]>("[window.app.editing().stage.tool(), document.querySelector('.quire-img-side').dataset.page, [...document.querySelectorAll('.quire-img-bar .quire-img-word.pressed')].map((each) => each.textContent), !!document.querySelector('.quire-img-frame.shown')]");
    expect(await state()).toEqual(["none", "export", ["export"], false]);
    expect(await page.tab.run("[...document.querySelectorAll('.quire-img-bar .quire-img-word')].map((each) => each.textContent)")).toEqual(["crop", "resize", "mark up", "cut out", "color", "export", "more"]);
    // the side panel is always there, at the right of the picture
    const stage = await page.boxOf(".quire-img-stage");
    const side = await page.boxOf(".quire-img-side");
    expect(stage.x + stage.width).toBeLessThanOrEqual(side.x + 1);
    // a key picks a tool and the panel shows its page; Escape from the picture leaves it
    await page.tab.press("c");
    await page.until("document.querySelector('.quire-img-frame.shown')");
    expect(await state()).toEqual(["crop", "crop", ["crop"], true]);
    await page.tab.press("Escape");
    await page.until("!document.querySelector('.quire-img-frame.shown')");
    expect(await state()).toEqual(["none", "export", ["export"], false]);
    // a word picks it too, and Escape from a control of its page leaves it and gives the keyboard back to the picture
    await page.tab.run("document.querySelector('.quire-img-bar [aria-label^=\"Mark up\"]').click()");
    expect((await state()).slice(1, 3)).toEqual(["mark-up", ["mark up"]]);
    await page.tab.run("document.querySelector('.quire-img-page.open .quire-img-mark-kinds input:checked').focus()");
    await page.tab.press("Escape");
    expect(await state()).toEqual(["none", "export", ["export"], false]);
    expect(await page.tab.run("document.activeElement?.className")).toBe("quire-img-stage");
    // more, and Escape from it
    await page.tab.run("document.querySelector('.quire-img-bar [aria-label^=More]').click()");
    expect((await state()).slice(1, 3)).toEqual(["more", ["more"]]);
    await page.tab.press("Escape");
    expect(await state()).toEqual(["none", "export", ["export"], false]);
    // the picture never moved
    expect(await page.boxOf(".quire-img-stage")).toEqual(stage);
}, 30_000);

test("pressed again in the same place, the one beneath is picked; it comes forward from Edit, and Delete takes it away, undo bringing it back", async () => {
    if (!page) return;
    await page.tab.press("r");
    await page.tab.drag(await page.onScreen(56, 188), await page.onScreen(420, 218), 6);
    await page.tab.press("b");
    await page.tab.drag(await page.onScreen(40, 192), await page.onScreen(440, 232), 6);
    await page.until("window.app.editing().steps().length === 2");
    await page.tab.press("Escape");
    await page.tab.press("Escape");
    const kinds = () => page!.tab.run<string[]>("window.app.editing().steps().map((step) => step.type)");
    const picked = () => page!.tab.run<string>("window.app.editing().steps().find((step) => step.id === window.app.editing().stage.picked())?.type ?? ''");
    const on = await page.onScreen(200, 192);
    await page.tab.click(on.x, on.y);
    expect(await picked()).toBe("box");
    await page.tab.click(on.x, on.y);
    expect(await picked()).toBe("cover");
    await page.tab.click(on.x, on.y);
    expect(await picked()).toBe("box");
    await page.tab.click(on.x, on.y);
    // Edit, Bring forward puts the cover over the box
    await page.tab.press("e", { alt: true });
    await page.until("document.querySelector('.quire-menu:popover-open .quire-menu-line')");
    await page.tab.run("[...document.querySelectorAll('.quire-menu:popover-open .quire-menu-line')].find((line) => line.textContent.includes('Bring forward')).click()");
    expect(await kinds()).toEqual(["box", "cover"]);
    const red = async () => {
        const count = await page!.tab.run<number>("window.copied.length");
        await page!.tab.run("document.querySelector('.quire-img-stage').focus()");
        await page!.tab.press("c", { ctrl: true });
        await page!.until(`window.copied.length > ${count}`);
        return page!.tab.run<number>("(() => { const copied = window.copied.at(-1); let red = 0; for (let y = 196; y < 214; y++) for (let x = 60; x < 400; x++) { const at = (y * copied.width + x) * 4; if (copied.pixels[at] > 120 && copied.pixels[at + 1] < 90 && copied.pixels[at + 2] < 110) red++; } return red; })()");
    };
    expect(await red()).toBe(0);
    await page.tab.press("Delete");
    expect(await kinds()).toEqual(["box"]);
    expect(await red()).toBeGreaterThan(100);
    await page.tab.press("z", { ctrl: true });
    expect(await kinds()).toEqual(["box", "cover"]);
    expect(await red()).toBe(0);
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
    const png = await page.tab.run<{ x: number; y: number }>("(() => { const box = [...document.querySelectorAll('.quire-img-export.open .quire-img-formats label')].find((each) => each.textContent === 'PNG').getBoundingClientRect(); return { x: box.x + box.width / 2, y: box.y + box.height / 2 }; })()");
    await page.tab.click(png.x, png.y);
    const save = await page.middle(".quire-img-export .quire-img-actions .quire-img-save");
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

test("version history draws a version's steps over the original in the side panel, and never lies over the picture, which keeps its place as it opens and closes", async () => {
    if (!page) return;
    await page.tab.run("document.querySelector('.quire-img-stage').focus()");
    // the room as it is with the export in the side panel
    await page.tab.wait(700);
    const wide = await page.boxOf(".quire-img-stage");
    await page.tab.press("f", { alt: true });
    await page.until("document.querySelector('.quire-menu:popover-open .quire-menu-line')");
    await page.tab.run("[...document.querySelectorAll('.quire-menu:popover-open .quire-menu-line')].find((line) => line.textContent.includes('Version history')).click()");
    await page.until("document.querySelector('.quire-history.open .quire-history-item')");
    // the panel is a page of the side panel, beside the picture, and the picture has not moved
    await page.tab.wait(900);
    expect(await page.tab.run("document.querySelector('.quire-img-side').contains(document.querySelector('.quire-history'))")).toBe(true);
    const panel = await page.boxOf(".quire-history");
    const stage = await page.boxOf(".quire-img-stage");
    expect(stage).toEqual(wide);
    expect(stage.x + stage.width).toBeLessThanOrEqual(panel.x);
    const right = await page.tab.run<number>("(() => { const s = window.app.editing().stage; const size = s.loaded().size; return Math.max(...[[0, 0], [size.width, 0], [size.width, size.height], [0, size.height]].map(([x, y]) => s.toScreen({ x, y }).x)) + document.querySelector('.quire-img-stage').getBoundingClientRect().x; })()");
    expect(right).toBeLessThanOrEqual(panel.x);
    await page.tab.run("document.querySelector('.quire-history-item').click()");
    await page.until("document.querySelector('.quire-history-preview canvas.quire-img-version')?.width > 0");
    expect(await page.tab.run<number>("document.querySelector('.quire-img-version').width")).toBeLessThanOrEqual(360);
    await page.tab.press("Escape");
    await page.tab.press("Escape");
    // closed, the export shows again in its place, and the room is as it was
    await page.tab.wait(900);
    expect(await page.boxOf(".quire-img-stage")).toEqual(wide);
    expect(await page.tab.run("document.querySelector('.quire-img-side').dataset.page")).toBe("export");
}, 30_000);
