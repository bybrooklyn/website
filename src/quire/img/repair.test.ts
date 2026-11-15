// Repairing a JPEG as the editor offers it: the worker's answer is the repair for a JPEG worth repairing
// and nothing for a PNG, a JPEG made at a high quality or pixels of another size; a repairer whose worker
// cannot be made does the work on the page; and in headless Chromium a hard-compressed JPEG pasted offers
// Repair JPEG in its right-click menu, which makes it a step, puts the repaired pixels on the stage and in
// the export, nearer the clean picture than the JPEG, and one undo takes it away. A PNG is not offered it.

import { afterAll, beforeAll, expect, test } from "bun:test";
import sharp from "sharp";
import { imgPage, type ImgPage } from "../../../scripts/img-page";
import { createRepair, serve } from "./repair";

/** A clean picture made here: soft colour, a sharp edge and fine lines, as a photograph of a sign might have. */
async function clean(width = 256, height = 192): Promise<Buffer> {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><defs><radialGradient id="g"><stop offset="0" stop-color="#e8c07a"/><stop offset="1" stop-color="#3b5d7a"/></radialGradient></defs><rect width="${width}" height="${height}" fill="url(#g)"/><rect x="40" y="50" width="170" height="70" fill="#f6f2e8" stroke="#202020" stroke-width="3"/><text x="52" y="98" font-family="sans-serif" font-size="30" fill="#b02020">OPEN</text>${[0, 1, 2, 3, 4, 5, 6].map((at) => `<line x1="${20 + at * 30}" y1="150" x2="${30 + at * 30}" y2="185" stroke="#111" stroke-width="2"/>`).join("")}</svg>`;
    return sharp(Buffer.from(svg)).removeAlpha().raw().toBuffer();
}

test("the worker repairs a JPEG worth repairing and nothing else; with no worker the page does it", async () => {
    const raw = await clean();
    const jpeg = new Uint8Array(await sharp(raw, { raw: { width: 256, height: 192, channels: 3 } }).jpeg({ quality: 15 }).toBuffer());
    const decoded = new Uint8ClampedArray(await sharp(jpeg).ensureAlpha().raw().toBuffer());
    const answer = serve({ id: 1, bytes: jpeg, width: 256, height: 192, data: decoded });
    expect(answer.id).toBe(1);
    expect(answer.data).toBeDefined();
    expect(answer.data!.some((value, at) => value !== decoded[at])).toBe(true);
    // a high quality, a PNG, or pixels of another size: nothing
    const fine = new Uint8Array(await sharp(raw, { raw: { width: 256, height: 192, channels: 3 } }).jpeg({ quality: 96 }).toBuffer());
    expect(serve({ id: 2, bytes: fine, width: 256, height: 192, data: decoded }).data).toBeUndefined();
    const png = new Uint8Array(await sharp(raw, { raw: { width: 256, height: 192, channels: 3 } }).png().toBuffer());
    expect(serve({ id: 3, bytes: png, width: 256, height: 192, data: decoded }).data).toBeUndefined();
    expect(serve({ id: 4, bytes: jpeg, width: 128, height: 96, data: decoded.subarray(0, 128 * 96 * 4) }).data).toBeUndefined();
    // a worker that cannot be made: the page repairs it itself (Bun has no ImageData, so a plain one stands in)
    const shim = globalThis as unknown as { ImageData?: unknown };
    shim.ImageData ??= class {
        constructor(
            public data: Uint8ClampedArray,
            public width: number,
            public height: number,
        ) {}
    };
    const repairer = createRepair(() => {
        throw new Error("no workers here");
    });
    const made = await repairer.run(jpeg, new ImageData(decoded, 256, 192));
    expect(made?.data).toEqual(answer.data);
});

let page: ImgPage | undefined;
beforeAll(async () => {
    page = await imgPage("img-repair");
    if (!page) console.warn("repair browser test skipped: needs a Chromium");
}, 60_000);
afterAll(async () => {
    await page?.close();
});

/** Pastes bytes made here as a file of a type, and waits for the picture with the keyboard on it. */
async function pasteBytes(bytes: Uint8Array, type: string) {
    const was = await page!.tab.run<string>("window.app.editing().current().id ?? ''");
    await page!.tab.run(`(async () => { const bytes = Uint8Array.from(atob(${JSON.stringify(Buffer.from(bytes).toString("base64"))}), (c) => c.charCodeAt(0)); const data = new DataTransfer(); data.items.add(new File([bytes], "image", { type: ${JSON.stringify(type)} })); document.dispatchEvent(new ClipboardEvent("paste", { clipboardData: data, bubbles: true, cancelable: true })); })()`);
    await page!.until(`window.app.editing().current().id !== ${JSON.stringify(was)} && window.app.editing().stage?.loaded() && document.querySelector(".quire-img-frame.shown")`);
}
const rightClick = (x: number, y: number) => page!.tab.run(`(() => { const event = new MouseEvent('contextmenu', { bubbles: true, cancelable: true, button: 2, clientX: ${x}, clientY: ${y} }); document.elementFromPoint(${x}, ${y}).dispatchEvent(event); })()`);
const lines = () => page!.tab.run<string[]>("[...document.querySelectorAll('.quire-img-press-menu:popover-open .quire-menu-label')].map((each) => each.textContent)");

test("a hard-compressed JPEG offers Repair JPEG in its right-click menu; the repaired pixels are a step, on the stage and in the export, nearer the clean picture", async () => {
    if (!page) return;
    const width = 768;
    const height = 576;
    const raw = await clean(width, height);
    const jpeg = new Uint8Array(await sharp(raw, { raw: { width, height, channels: 3 } }).jpeg({ quality: 15 }).toBuffer());
    await pasteBytes(jpeg, "image/jpeg");
    // the PSNR of what the editor exports against the clean picture, worked out in the page
    await page.tab.run(`window.clean = Uint8Array.from(atob(${JSON.stringify(raw.toString("base64"))}), (c) => c.charCodeAt(0))`);
    const score = "(async () => { const flat = await window.app.editing().flatten(); let sum = 0; for (let k = 0; k < flat.width * flat.height; k++) for (let c = 0; c < 3; c++) sum += (flat.data[k * 4 + c] - window.clean[k * 3 + c]) ** 2; return 10 * Math.log10(255 * 255 / (sum / (flat.width * flat.height * 3))); })()";
    const before = await page.tab.run<number>(score);
    const at = await page.onScreen(300, 300);
    await page.tab.press("Escape");
    await rightClick(at.x, at.y);
    await page.until("document.querySelector('.quire-img-press-menu:popover-open')");
    expect(await lines()).toContain("Repair JPEG");
    await page.tab.run("[...document.querySelectorAll('.quire-img-press-menu:popover-open button')].find((each) => each.textContent.includes('Repair JPEG')).click()");
    await page.until("window.app.editing().steps().some((step) => step.type === 'repair')");
    await page.until("document.querySelector('.quire-status-home')?.textContent.includes('Repaired')", 30_000);
    await page.tab.wait(300);
    const after = await page.tab.run<number>(score);
    console.log(`in the editor, a ${width} by ${height} JPEG at quality 15: ${before.toFixed(2)} dB as it came, ${after.toFixed(2)} dB repaired; ${await page.tab.run<string>("document.querySelector('.quire-status-home').textContent")}`);
    expect(after).toBeGreaterThan(before + 0.1);
    // one undo takes it away, and the pixels are the JPEG's again
    await page.tab.run("document.querySelector('.quire-img-stage').focus()");
    await page.tab.press("z", { ctrl: true });
    await page.until("!window.app.editing().steps().some((step) => step.type === 'repair')");
    await page.tab.wait(500);
    expect(Math.abs((await page.tab.run<number>(score)) - before)).toBeLessThan(0.01);
}, 90_000);

test("a PNG is not offered the repair", async () => {
    if (!page) return;
    const raw = await clean();
    await pasteBytes(new Uint8Array(await sharp(raw, { raw: { width: 256, height: 192, channels: 3 } }).png().toBuffer()), "image/png");
    const at = await page.onScreen(100, 100);
    await page.tab.press("Escape");
    await rightClick(at.x, at.y);
    await page.until("document.querySelector('.quire-img-press-menu:popover-open')");
    expect(await lines()).not.toContain("Repair JPEG");
}, 60_000);
