// What imgQuire is held to as a kind on the core's app, in headless Chromium, with mdQuire beside it
// on one shelf: each of the four fast jobs done from a pasted picture to the clipboard by real drags
// and keys, timed (crop and copy; shrink and convert; hide something; mark up); a hidden place holds
// none of what was there in what is copied; a picture document is on the shelf with its own row and
// opens again in imgQuire; and a saved `.quire` opened again, an earlier step changed, exports again.
// Skipped, with a notice, on a machine with no Chromium.

import { afterAll, beforeAll, expect, test } from "bun:test";
import { imgPage, type ImgPage } from "../../../scripts/img-page";
import { unpackQuire } from "../core/quire-file";
import { img } from "./kind";
import { readSteps } from "./steps";

test("imgQuire's documents are told by their steps file, never by their names, and it takes pictures", () => {
    const kind = img();
    expect([kind.main, kind.opens("cat.quire"), kind.opens("cat.png"), kind.row]).toEqual(["steps.json", false, false, "picture"]);
    expect([kind.takes!({ name: "a.png", type: "image/png" }), kind.takes!({ name: "a.md", type: "text/markdown" })]).toEqual([true, false]);
});

let page: ImgPage | undefined;
beforeAll(async () => {
    page = await imgPage("img-test");
    if (!page) console.warn("imgQuire browser test skipped: needs a Chromium");
});
afterAll(async () => {
    await page?.close();
});
const until = (expression: string, ms?: number) => page!.until(expression, ms);
const boxOf = (selector: string) => page!.boxOf(selector);
const middle = (box: { x: number; y: number; width: number; height: number }) => ({ x: box.x + box.width / 2, y: box.y + box.height / 2 });
const paste = (kind: "screenshot" | "photo") => page!.paste(kind);
const copiedAfter = (before: number) => page!.copiedAfter(before);
const onScreen = (x: number, y: number) => page!.onScreen(x, y);
const timings: string[] = [];

test("crop and copy: a pasted screenshot, its frame's corners dragged in, Enter, and Ctrl+C asks the first time and copies the part kept", async () => {
    if (!page) return;
    const before = await paste("screenshot");
    const frame = await boxOf(".quire-img-frame");
    await page.tab.drag({ x: frame.x, y: frame.y }, { x: frame.x + frame.width * 0.04, y: frame.y + frame.height * 0.08 }, 8);
    await page.tab.drag({ x: frame.x + frame.width, y: frame.y + frame.height }, { x: frame.x + frame.width * 0.5, y: frame.y + frame.height * 0.5 }, 8);
    await page.tab.press("Enter");
    await page.tab.press("c", { ctrl: true });
    await until("document.querySelector('dialog[open]')");
    await page.tab.press("Enter");
    const took = await copiedAfter(before);
    const copied = await page.tab.run<{ width: number; height: number }>("(({ width, height }) => ({ width, height }))(window.copied.at(-1))");
    expect(copied.width).toBeGreaterThan(500);
    expect(copied.width).toBeLessThan(600);
    expect(copied.height).toBeLessThan(330);
    timings.push(`crop and copy: ${took} ms from paste to copied (the first time, with the question)`);
    expect(took).toBeLessThan(10_000);
}, 30_000);

test("shrink and convert: a pasted 12 megapixel photograph halved, WebP under 200 KB, copied from the export panel", async () => {
    if (!page) return;
    const before = await paste("photo");
    await page.tab.click(middle(await boxOf(".quire-img-bar [aria-label='Resize']")).x, middle(await boxOf(".quire-img-bar [aria-label='Resize']")).y);
    await until("document.querySelector('.quire-img-resize.open')");
    const half = await page.tab.run<{ x: number; y: number }>("(() => { const button = [...document.querySelectorAll('.quire-img-sizes button')].find((each) => each.textContent === '50%').getBoundingClientRect(); return { x: button.x + button.width / 2, y: button.y + button.height / 2 }; })()");
    await page.tab.click(half.x, half.y);
    await page.tab.press("e");
    await until("document.querySelector('.quire-img-export.open')");
    // the panel has slid in before anything on it is pressed
    await page.tab.wait(700);
    const webp = await page.tab.run<{ x: number; y: number }>("(() => { const button = [...document.querySelectorAll('.quire-img-format')].find((each) => each.textContent === 'WebP').getBoundingClientRect(); return { x: button.x + button.width / 2, y: button.y + button.height / 2 }; })()");
    await page.tab.click(webp.x, webp.y);
    const under = middle(await boxOf(".quire-img-under"));
    await page.tab.click(under.x, under.y);
    await page.tab.type("200");
    await page.tab.press("Enter");
    await until("/KB WebP/.test(document.querySelector('.quire-img-result')?.textContent ?? '')", 30_000);
    const copy = middle(await boxOf(".quire-img-export .quire-dialog-action"));
    await page.tab.click(copy.x, copy.y);
    const took = await copiedAfter(before);
    const result = await page.tab.run<string>("document.querySelector('.quire-img-result').textContent");
    const copied = await page.tab.run<{ width: number; height: number }>("(({ width, height }) => ({ width, height }))(window.copied.at(-1))");
    expect(copied).toMatchObject({ width: 2000, height: 1500 });
    expect(Number(/(\d+) KB/.exec(result)?.[1])).toBeLessThanOrEqual(200);
    timings.push(`shrink and convert: ${took} ms from paste to copied (${result})`);
    expect(took).toBeLessThan(10_000);
    await page.tab.press("Escape");
}, 60_000);

test("hide something: R, a drag over the token, and what is copied holds none of the token's red where it was", async () => {
    if (!page) return;
    const before = await paste("screenshot");
    await page.tab.press("r");
    const from = await onScreen(56, 188);
    const to = await onScreen(420, 218);
    await page.tab.drag(from, to, 8);
    await until("window.app.editing().current && document.querySelector('.quire-img-stage')");
    await page.tab.wait(150);
    await page.tab.press("c", { ctrl: true });
    const took = await copiedAfter(before);
    const found = await page.tab.run<{ red: number; ground: number; width: number }>(`(() => {
        const copied = window.copied.at(-1);
        let red = 0, ground = 0;
        for (let y = 188; y < 218; y++) for (let x = 56; x < 420; x++) {
            const at = (y * copied.width + x) * 4;
            const [r, g, b] = [copied.pixels[at], copied.pixels[at + 1], copied.pixels[at + 2]];
            if (r > 120 && g < 90 && b < 110) red++;
            if (r === 244 && g === 244 && b === 246) ground++;
        }
        return { red, ground, width: copied.width };
    })()`);
    expect(found.width).toBe(1200);
    expect(found.red).toBe(0);
    // covered in the page's own color, taken from round it
    expect(found.ground).toBe(364 * 30);
    timings.push(`hide something: ${took} ms from paste to copied`);
    expect(took).toBeLessThan(10_000);
}, 30_000);

test("mark up: an arrow and a box dragged out, a line of text typed, each a step, and the copy carries them", async () => {
    if (!page) return;
    const before = await paste("screenshot");
    await page.tab.press("a");
    await page.tab.drag(await onScreen(700, 400), await onScreen(330, 290), 8);
    await page.tab.press("b");
    await page.tab.drag(await onScreen(50, 255), await onScreen(250, 315), 8);
    await page.tab.press("t");
    const at = await onScreen(720, 420);
    await page.tab.click(at.x, at.y);
    await page.tab.type("Press here");
    await page.tab.press("Enter");
    await page.tab.press("c", { ctrl: true });
    const took = await copiedAfter(before);
    const kinds = await page.tab.run<string[]>("window.app.editing().steps?.().map((step) => step.type) ?? []");
    expect(kinds).toEqual(["arrow", "box", "text"]);
    const marked = await page.tab.run<number>(`(() => { const copied = window.copied.at(-1); let red = 0; for (let at = 0; at < copied.pixels.length; at += 4) if (copied.pixels[at] > 230 && copied.pixels[at + 1] < 90 && copied.pixels[at + 2] < 80) red++; return red; })()`);
    expect(marked).toBeGreaterThan(500);
    timings.push(`mark up: ${took} ms from paste to copied`);
    expect(took).toBeLessThan(10_000);
}, 30_000);

test("a picture document is on the shelf with its own row, beside mdQuire's, and its .quire opened again with an earlier step changed exports again", async () => {
    if (!page) return;
    console.log(timings.join("\n"));
    // the last document's .quire, as File, Download gives it
    await page.tab.run("window.app.editing().downloadQuire?.()");
    await until("Object.keys(window.downloads).some((name) => name.endsWith('.quire'))");
    const bytes = await page.tab.run<number[]>("Object.entries(window.downloads).find(([name]) => name.endsWith('.quire'))[1]");
    const bundle = await unpackQuire(Uint8Array.from(bytes), ["steps.json"]);
    expect(bundle.main).toBe("steps.json");
    const read = readSteps(bundle.text)!;
    expect(read.steps.map((step) => step.type)).toEqual(["arrow", "box", "text"]);
    expect([...bundle.pictures.keys()]).toHaveLength(1);
    // opened again as a file chosen from the computer, the box made thicker, and copied again
    await page.tab.run(`(async () => {
        const file = new File([new Uint8Array(${JSON.stringify(bytes)})], "marked.quire", { type: "application/zip" });
        const entry = await window.app.files.add(file);
        await window.app.editing().open(window.app.files, entry);
    })()`);
    await until("window.app.editing().steps?.().length === 3 && window.app.editing().stage.loaded()");
    await page.tab.run("window.app.editing().changeStep?.('s2', { thickness: 30 })");
    const before = await page.tab.run<number>("window.copied.length");
    await page.tab.run("document.querySelector('.quire-img-stage').focus()");
    await page.tab.press("c", { ctrl: true });
    await until(`window.copied.length > ${before}`);
    // the box's edge, thirty pixels wide now, is red where it was not before
    const thick = await page.tab.run<number>(`(() => { const copied = window.copied.at(-1); const at = (285 * copied.width + 40) * 4; return copied.pixels[at]; })()`);
    expect(thick).toBeGreaterThan(200);
    // the shelf lists the pictures with their own row, "picture", and the file opened from the computer as one too
    await page.tab.run("window.app.shelf.refresh()");
    const rows = await page.tab.run<string[]>("[...document.querySelectorAll('.quire-shelf-doc')].map((row) => row.textContent)");
    expect(rows.filter((row) => row.includes("picture, this browser"))).toHaveLength(4);
    expect(rows.some((row) => row.includes("picture, this computer"))).toBe(true);
}, 60_000);
