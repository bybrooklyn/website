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
    // a centred picture grows on both sides, so the corner moves half as far as the width changes
    const wanted = room * 0.51;
    await tab.drag(from, { x: from.x + (wanted - before.width) / 2, y: from.y }, 12);
    await tab.wait(100);
    expect(await page!.md()).toContain(`<img src="${picture}" alt="A wide picture" width="50%" />`);
    const after = await tab.run<{ width: number; height: number }>("q.box('.quire-image img')");
    expect(Math.abs(after.width - room / 2)).toBeLessThan(2);
    expect(Math.abs(after.width / after.height - 2)).toBeLessThan(0.05);
    await tab.run("q.surface.undo()");
    expect(await page!.md()).toContain(`![A wide picture](${picture})`);
});

test("the strip puts the picture to the right, and back in the centre", async () => {
    if (skip()) return;
    const { tab } = page!;
    await start();
    await page!.press(".quire-image img");
    await tab.wait(400);
    await page!.press(".quire-picture-strip button", "Picture to the right");
    expect(await page!.md()).toContain(`<div align="right">\n\n![A wide picture](${picture})\n\n</div>`);
    await page!.press(".quire-picture-strip button", "Picture in the centre");
    expect(await page!.md()).toBe(`One line.\n\n![A wide picture](${picture})\n\nAnother line.\n`);
});

test("a caption is written in place under a picked picture and kept as a <figure>", async () => {
    if (skip()) return;
    const { tab } = page!;
    await start();
    await page!.press(".quire-image img");
    await tab.wait(400);
    await page!.press(".quire-caption");
    await tab.type("Two colours");
    await tab.press("Enter");
    await tab.wait(30);
    expect(await page!.md()).toContain(`<figure><img src="${picture}" alt="A wide picture" /><figcaption>Two colours</figcaption></figure>`);
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
