// Perspective as the editor offers it, in headless Chromium: P opens its dials in the crop's page; Auto
// stands a building photographed with the camera tilted up straight, as one change, undone by one undo; a
// dial's arrow keys make a step; the corners, dragged by the pointer and nudged by the keys, square the
// shape they mark and crop to it; Escape stops the corners, then closes the dials; the export has no
// empty corners and the document opened again draws the same pixels; and a picture with no clear lines
// is left as it was, the status saying so.

import { afterAll, beforeAll, expect, test } from "bun:test";
import sharp from "sharp";
import { imgPage, type ImgPage } from "../../../scripts/img-page";
import { apply, multiply, tilted, type Matrix } from "./homography";

/** A building's face, as in lines.test.ts, photographed by a camera tilted and rolled: grey pixels, four samples to each. */
function building(size: { width: number; height: number }, vertical: number, roll: number): Uint8Array {
    const radians = (roll * Math.PI) / 180;
    const c = Math.cos(radians);
    const s = Math.sin(radians);
    const cx = size.width / 2;
    const cy = size.height / 2;
    const rolled: Matrix = [c, -s, cx - c * cx + s * cy, s, c, cy - s * cx - c * cy, 0, 0, 1];
    const map = multiply(rolled, tilted(vertical, 0, size));
    const face = (x: number, y: number) => {
        if (y > size.height * 0.9) return 0.25;
        if (x < size.width * 0.2 || x > size.width * 0.8 || y < size.height * 0.12) return 0.8 - (0.3 * y) / size.height;
        const column = (x - size.width * 0.2) / ((size.width * 0.6) / 6);
        const row = (y - size.height * 0.12) / ((size.height * 0.78) / 7);
        return column % 1 > 0.25 && column % 1 < 0.75 && row % 1 > 0.2 && row % 1 < 0.8 ? 0.15 : 0.62;
    };
    const out = new Uint8Array(size.width * size.height * 3);
    for (let y = 0; y < size.height; y++)
        for (let x = 0; x < size.width; x++) {
            let sum = 0;
            for (const [dx, dy] of [[0.25, 0.25], [0.75, 0.25], [0.25, 0.75], [0.75, 0.75]] as const) {
                const there = apply(map, { x: x + dx, y: y + dy });
                sum += face(there.x, there.y);
            }
            out.fill(Math.round((sum / 4) * 255), (y * size.width + x) * 3, (y * size.width + x) * 3 + 3);
        }
    return out;
}

let page: ImgPage | undefined;
beforeAll(async () => {
    page = await imgPage("img-perspective");
    if (!page) console.warn("perspective browser test skipped: needs a Chromium");
}, 60_000);
afterAll(async () => {
    await page?.close();
});

/** Pastes a PNG made here, and waits for it to be shown with the keyboard on it. */
async function pastePng(png: Buffer) {
    const was = await page!.tab.run<string>("window.app.editing().current().id ?? ''");
    await page!.tab.run(`(async () => { const bytes = Uint8Array.from(atob(${JSON.stringify(png.toString("base64"))}), (c) => c.charCodeAt(0)); const data = new DataTransfer(); data.items.add(new File([bytes], "image.png", { type: "image/png" })); document.dispatchEvent(new ClipboardEvent("paste", { clipboardData: data, bubbles: true, cancelable: true })); })()`);
    await page!.until(`window.app.editing().current().id !== ${JSON.stringify(was)} && window.app.editing().stage?.loaded() && document.activeElement === document.querySelector(".quire-img-stage")`);
}
const perspective = () => page!.tab.run<{ vertical?: number; horizontal?: number; corners?: { x: number; y: number }[]; ratio?: number } | null>("window.app.editing().steps().find((step) => step.type === 'perspective') ?? null");
const turn = () => page!.tab.run<number>("window.app.editing().steps().find((step) => step.type === 'turn')?.angle ?? 0");
const status = () => page!.tab.run<string>("document.querySelector('.quire-status-home')?.textContent ?? ''");
const pressButton = (label: string) => page!.tab.run(`[...document.querySelectorAll('.quire-img-crop-page.open button, .quire-img-crop-page.open label')].find((each) => each.textContent.trim() === ${JSON.stringify(label)} || each.title.startsWith(${JSON.stringify(label)})).click()`);

test("Auto stands a tilted building straight as one change; a dial's keys make a step; the corners square what they mark and crop to it", async () => {
    if (!page) return;
    const size = { width: 900, height: 675 };
    const png = await sharp(Buffer.from(building(size, 10, 1)), { raw: { ...size, channels: 3 } }).png().toBuffer();
    await pastePng(png);
    await page.tab.press("p");
    await page.until("document.querySelector('.quire-img-crop-page.open .quire-img-keystones:not(.away)')");
    const started = performance.now();
    await pressButton("auto");
    await page.until("window.app.editing().steps().some((step) => step.type === 'perspective')");
    const autoTook = performance.now() - started;
    const auto = (await perspective())!;
    console.log(`Auto: vertical ${auto.vertical}, horizontal ${auto.horizontal ?? 0}, turn ${await turn()}, in ${Math.round(autoTook)} ms; ${await status()}`);
    expect(Math.abs(auto.vertical! - 10)).toBeLessThan(1);
    expect(Math.abs((await turn()) - 1)).toBeLessThan(0.5);
    // one undo takes the whole fix away
    await page.tab.run("document.querySelector('.quire-img-stage').focus()");
    await page.tab.press("z", { ctrl: true });
    await page.until("!window.app.editing().steps().some((step) => step.type === 'perspective' || step.type === 'turn')");
    // the vertical dial's arrow keys: five tenths, each a step
    await page.tab.run("document.querySelector('.quire-img-crop-page .quire-img-dial[aria-label=Vertical]').focus()");
    for (let at = 0; at < 5; at++) await page.tab.press("ArrowRight");
    await page.until("window.app.editing().steps().find((step) => step.type === 'perspective')?.vertical === 0.5");
    // the corners: on, the original shown as it came with four handles; the top left dragged in
    await pressButton("Corners");
    await page.until("window.app.editing().stage.cornering() && document.querySelectorAll('.quire-img-corner.shown').length === 4");
    const startCorner = await page.tab.run<{ x: number; y: number }>("window.app.editing().stage.corners()[0]");
    const handle = await page.onScreen(startCorner.x, startCorner.y);
    await page.tab.drag(handle, { x: handle.x + 30, y: handle.y + 20 }, 8);
    await page.until("window.app.editing().steps().find((step) => step.type === 'perspective')?.corners");
    const set = (await perspective())!;
    expect(set.vertical).toBeUndefined();
    expect(set.corners![0]!.x).toBeGreaterThan(startCorner.x + 10);
    expect(set.ratio).toBeGreaterThan(0.5);
    // with the corners set and cropped to, the original is still drawn whole under the handles: its far corner is picture, not the empty stage
    const far = await page.onScreen(size.width * 0.97, size.height * 0.97);
    const drawn = await sharp(await page.tab.picture({ x: Math.round(far.x) - 3, y: Math.round(far.y) - 3, width: 6, height: 6 })).removeAlpha().raw().toBuffer();
    expect(drawn.reduce((sum, value) => sum + value, 0) / drawn.length).toBeGreaterThan(40);
    // the arrow keys nudge the handle with the keyboard, a pixel each
    await page.tab.run("document.querySelectorAll('.quire-img-corner')[1].focus()");
    const before = set.corners![1]!.x;
    await page.tab.press("ArrowLeft");
    await page.until(`window.app.editing().steps().find((step) => step.type === 'perspective').corners[1].x === ${before - 1}`);
    // the crop is the rectangle the corners make, and nothing of it is empty
    const crop = await page.tab.run<{ width: number; height: number }>("window.app.editing().steps().find((step) => step.type === 'crop').rect");
    expect(Math.abs(crop.width / crop.height - (await perspective())!.ratio!)).toBeLessThan(0.01);
    await page.tab.press("Escape");
    await page.until("!window.app.editing().stage.cornering()");
    await page.tab.run("document.querySelector('.quire-img-stage').focus()");
    await page.tab.press("Escape");
    await page.until("document.querySelector('.quire-img-crop-page.open .quire-img-keystones.away')");
    const flat = await page.tab.run<{ width: number; height: number; clear: number }>("(async () => { const flat = await window.app.editing().flatten(); let clear = 0; for (let at = 3; at < flat.data.length; at += 4) if (flat.data[at] < 255) clear++; return { width: flat.width, height: flat.height, clear }; })()");
    expect(flat.clear).toBe(0);
    expect(flat.width).toBe(crop.width);
    // opened again from its steps.json, the document draws the same pixels
    const sum = "(async () => { const flat = await window.app.editing().flatten(); let sum = 0; for (let at = 0; at < flat.data.length; at += 7) sum = (sum * 31 + flat.data[at]) % 1000000007; return sum; })()";
    const first = await page.tab.run<number>(sum);
    await page.tab.run("window.app.editing().reopen()");
    await page.until("window.app.editing().stage.loaded()");
    await page.tab.wait(300);
    expect(await page.tab.run<number>(sum)).toBe(first);
}, 90_000);

test("a picture with no clear lines is left as it was, and the status says so", async () => {
    if (!page) return;
    await page.paste("photo");
    await page.tab.press("p");
    await page.until("document.querySelector('.quire-img-crop-page.open .quire-img-keystones:not(.away)')");
    await pressButton("auto");
    await page.until("document.querySelector('.quire-status-home')?.textContent.includes('No clear lines')");
    expect(await perspective()).toBeNull();
}, 60_000);
