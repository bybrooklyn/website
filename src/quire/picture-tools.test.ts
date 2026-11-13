// The picture tools, used for real in headless Chromium: a picture is pressed and its frame grows
// round it; a corner dragged with the mouse resizes it, keeping its shape and drawn to half the
// text's width when near it; the strip sets its alignment; the caption is written in place; the
// picture is dragged to another place; each is one undo step, and the Markdown is checked after
// each. Skipped, with a notice, on a machine with no Chromium.

import { afterAll, beforeAll, expect, test } from "bun:test";
import { editorPage, pictureNear, type EditorPage } from "../../scripts/quire-page";

let page: EditorPage | undefined;
let picture = "";

beforeAll(async () => {
    page = await editorPage();
    if (page) picture = await pictureNear(page.tab);
}, 60_000);

afterAll(async () => {
    await page?.close();
});

const skip = () => {
    if (page) return false;
    console.warn("picture-tools.test.ts: no Chromium on this machine, so the picture tools were not tried");
    return true;
};

/** Starts from a document with the picture between two lines and waits for it to load. */
async function start() {
    const { tab } = page!;
    await page!.reset(`One line.\n\n![A wide picture](${picture})\n\nAnother line.\n`, [0], 0);
    await tab.run("new Promise((done) => { const img = document.querySelector('.quire-image img'); img.complete ? done() : img.onload = done; })");
}

test("pressing a picture picks it: a frame with four handles grows round it", async () => {
    if (skip()) return;
    const { tab } = page!;
    await start();
    expect(await tab.run("!!document.querySelector('.quire-frame')")).toBe(false);
    await page!.press(".quire-image img");
    await tab.wait(30);
    // it is still growing a moment after, and grown once settled
    const early = await tab.run<number>("parseFloat(getComputedStyle(document.querySelector('.quire-frame')).opacity)");
    await tab.wait(400);
    expect(early).toBeLessThan(1);
    expect(await tab.run("document.querySelectorAll('.quire-frame.shown .quire-handle').length")).toBe(4);
    const frame = await tab.run<{ width: number }>("q.box('.quire-frame')");
    const img = await tab.run<{ width: number }>("q.box('.quire-image img')");
    expect(Math.abs(frame.width - img.width)).toBeLessThan(2);
});

test("a corner dragged with the mouse resizes the picture keeping its shape, drawn to half the text's width, as one undo step", async () => {
    if (skip()) return;
    const { tab } = page!;
    await start();
    await page!.press(".quire-image img");
    await tab.wait(300);
    const room = (await tab.run<{ width: number }>("q.box('.quire-image')")).width;
    const before = await tab.run<{ x: number; y: number; width: number; height: number }>("q.box('.quire-image img')");
    const corner = await tab.run<{ x: number; y: number; width: number }>("q.box('.quire-handle[data-corner=\"se\"]')");
    const from = { x: corner.x + corner.width / 2, y: corner.y + corner.width / 2 };
    // a picture at the left grows to the right alone, so the corner moves as far as the width changes
    const wanted = room * 0.51;
    expect(Math.abs(before.x - (await tab.run<{ x: number }>("q.box('.quire-image')")).x)).toBeLessThan(2);
    await tab.drag(from, { x: from.x + (wanted - before.width), y: from.y }, 12);
    await tab.wait(100);
    expect(await page!.md()).toContain(`<img src="${picture}" alt="A wide picture" width="50%" />`);
    const after = await tab.run<{ width: number; height: number }>("q.box('.quire-image img')");
    expect(Math.abs(after.width - room / 2)).toBeLessThan(2);
    expect(Math.abs(after.width / after.height - 2)).toBeLessThan(0.05);
    await tab.run("q.surface.undo()");
    expect(await page!.md()).toContain(`![A wide picture](${picture})`);
});

test("a picture sits at the left until moved; the strip puts it in the centre and back to the left, which is written as nothing", async () => {
    if (skip()) return;
    const { tab } = page!;
    await start();
    await page!.press(".quire-image img");
    await tab.wait(400);
    expect(await tab.run("document.querySelector('.quire-picture-strip [aria-label=\"Picture to the left\"]').getAttribute('aria-pressed')")).toBe("true");
    await page!.press(".quire-picture-strip button", "Picture in the centre");
    expect(await page!.md()).toContain(`<div align="center">\n\n![A wide picture](${picture})\n\n</div>`);
    await page!.press(".quire-picture-strip button", "Picture to the left");
    expect(await page!.md()).toBe(`One line.\n\n![A wide picture](${picture})\n\nAnother line.\n`);
});

/** Right-clicks the picture, as a mouse does, and waits for its menu. */
async function rightClick() {
    const { tab } = page!;
    const box = await tab.run<{ x: number; y: number }>("q.box('.quire-image img')");
    await tab.run(`document.querySelector('.quire-image img').dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, button: 2, clientX: ${box.x + 30}, clientY: ${box.y + 30} }))`);
    await tab.wait(400);
}

test("nothing stands under a picture; its menu opens at the pointer, its panel grows at the right, and a caption written there shows under it as a <figure>", async () => {
    if (skip()) return;
    const { tab } = page!;
    await start();
    expect(await tab.run("document.querySelectorAll('.quire-image input, .quire-image figcaption').length")).toBe(0);
    await rightClick();
    const menu = await tab.run<{ x: number; y: number }>("q.box('.quire-picture-menu')");
    const img = await tab.run<{ x: number; y: number }>("q.box('.quire-image img')");
    expect(Math.abs(menu.x - (img.x + 30))).toBeLessThan(4);
    expect(await tab.run("[...document.querySelectorAll('.quire-picture-menu .quire-menu-label')].map((each) => each.textContent)")).toEqual(["Caption", "Description", "Alignment", "Size", "Wrap text", "Replace", "Remove"]);
    await page!.press(".quire-picture-menu .quire-menu-line", "Caption");
    await tab.wait(30);
    // it is growing a moment after, and stands at the right of the window once settled
    expect(await tab.run<number>("document.querySelector('.quire-picture-skin').getAnimations().length")).toBe(1);
    await tab.wait(500);
    const panel = await tab.run<{ x: number; width: number }>("q.box('.quire-picture-panel')");
    expect(panel.x + panel.width).toBeGreaterThan(1300 - 80);
    expect(panel.x).toBeGreaterThan(1300 / 2);
    expect(await tab.run("document.activeElement.classList.contains('quire-picture-field')")).toBe(true);
    await tab.type("Two colours");
    await tab.press("Enter");
    await tab.wait(30);
    expect(await page!.md()).toContain(`<figure><img src="${picture}" alt="A wide picture" /><figcaption>Two colours</figcaption></figure>`);
    expect(await tab.run("document.querySelector('.quire-image figcaption').textContent")).toBe("Two colours");
    // Escape closes the panel and gives the keyboard back to the picture
    await tab.run("document.querySelector('.quire-picture-panel input').focus()");
    await tab.press("Escape");
    await tab.wait(300);
    expect(await tab.run("document.activeElement.matches('figure.quire-image')")).toBe(true);
    expect(await tab.run("document.querySelector('.quire-picture-panel').classList.contains('open')")).toBe(false);
    await tab.run("q.surface.undo()");
    expect(await page!.md()).toBe(`One line.\n\n![A wide picture](${picture})\n\nAnother line.\n`);
});

test("wrap text from the menu floats the picture with the words beside it, as one undo step, and the panel's sizes set its width", async () => {
    if (skip()) return;
    const { tab } = page!;
    await start();
    await rightClick();
    await page!.press(".quire-picture-menu .quire-menu-line", "Wrap text");
    await tab.wait(60);
    expect(await page!.md()).toContain(`<img src="${picture}" alt="A wide picture" align="left" />`);
    expect(await tab.run("getComputedStyle(document.querySelector('.quire-image')).float")).toBe("left");
    await rightClick();
    await page!.press(".quire-picture-menu .quire-menu-line", "Size");
    await tab.wait(500);
    await page!.press(".quire-picture-panel button", "Half width");
    expect(await page!.md()).toContain(`<img src="${picture}" alt="A wide picture" width="50%" align="left" />`);
    await page!.press(".quire-picture-panel button", "Picture to the right");
    expect(await page!.md()).toContain(`<img src="${picture}" alt="A wide picture" width="50%" align="right" />`);
    await tab.run("q.surface.undo()");
    await tab.run("q.surface.undo()");
    await tab.run("q.surface.undo()");
    expect(await page!.md()).toBe(`One line.\n\n![A wide picture](${picture})\n\nAnother line.\n`);
});

test("a picture dragged into a list lands in its item, the text opening there while it is held, and dragged out again it leaves the list", async () => {
    if (skip()) return;
    const { tab } = page!;
    await page!.reset(`![A wide picture](${picture})\n\n- first item\n- second item\n\nThe end.\n`, [2], 0);
    await tab.run("new Promise((done) => { const img = document.querySelector('.quire-image img'); img.complete ? done() : img.onload = done; })");
    const img = await tab.run<{ x: number; y: number; width: number; height: number }>("q.box('.quire-image img')");
    const item = await tab.run<{ x: number; y: number; width: number; height: number }>("q.box('.quire li:last-child')");
    const start = { x: img.x + 20, y: img.y + 20 };
    // held below the last item, over its words: the text opens under it and the line is drawn there, indented as the item is;
    // coming down to it the text opened above the item first, so the item is a room's height lower than it was
    item.height += 40;
    await tab.run("window.seen = { room: 0, line: 0 }; new MutationObserver(() => { for (const each of document.querySelectorAll('.quire li, .quire li > *')) seen.room = Math.max(seen.room, parseFloat(each.style.marginBottom) || 0); const line = document.querySelector('.quire-drop-line.shown'); if (line) seen.line = line.getBoundingClientRect().left; }).observe(document.body, { subtree: true, attributes: true, attributeFilter: ['style', 'class'] })");
    await tab.drag(start, { x: item.x + 60, y: item.y + item.height + 1 }, 14);
    await tab.wait(300);
    const seen = await tab.run<{ room: number; line: number }>("seen");
    expect(seen.room).toBeGreaterThan(30);
    expect(seen.line).toBeGreaterThan(img.x + 4);
    expect(await page!.md()).toBe(`- first item\n- second item\n\n  ![A wide picture](${picture})\n\nThe end.\n`);
    expect(await tab.run("document.querySelectorAll('.quire [style*=margin]').length")).toBe(0);
    // and out again, below the last line
    const moved = await tab.run<{ x: number; y: number }>("q.box('.quire-image img')");
    const end = await tab.run<{ x: number; y: number; height: number }>("q.box('.quire > :last-child')");
    await tab.drag({ x: moved.x + 20, y: moved.y + 20 }, { x: moved.x + 20, y: end.y + end.height + 60 }, 14);
    await tab.wait(300);
    expect(await page!.md()).toBe(`- first item\n- second item\n\nThe end.\n\n![A wide picture](${picture})\n`);
    await tab.run("q.surface.undo()");
    await tab.run("q.surface.undo()");
    expect(await page!.md()).toBe(`![A wide picture](${picture})\n\n- first item\n- second item\n\nThe end.\n`);
});

test("a picture dragged below the last line lands there, and Delete takes a picked one away", async () => {
    if (skip()) return;
    const { tab } = page!;
    await start();
    const img = await tab.run<{ x: number; y: number; width: number; height: number }>("q.box('.quire-image img')");
    const last = await tab.run<{ y: number; height: number }>("q.box('.quire > :last-child')");
    await tab.drag({ x: img.x + img.width / 2, y: img.y + img.height / 2 }, { x: img.x + img.width / 2, y: last.y + last.height + 2 }, 14);
    await tab.wait(300);
    expect(await page!.md()).toBe(`One line.\n\nAnother line.\n\n![A wide picture](${picture})\n`);
    expect(await tab.run("document.querySelectorAll('.quire-lifted, .quire-drop-line').length")).toBe(0);
    await tab.press("Delete");
    await tab.wait(30);
    expect(await page!.md()).toBe("One line.\n\nAnother line.\n");
});
