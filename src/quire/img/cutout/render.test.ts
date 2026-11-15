// What making the cut-out at full size on the card is held to: through WebGL2 it gives the same pixels
// as the processor's arithmetic (refine.ts's applyOne), within one, laid on nothing, on a color and on
// the old picture blurred, across the pieces it is drawn in; and a 12 megapixel picture is cut at its
// full size, its time printed.

import { expect, test } from "bun:test";
import { corePage, quire } from "../../../../scripts/core-page";

test("in Chromium, the cut-out made on the card is the processor's within one on every background, in pieces, and a 12 megapixel picture comes out whole", async () => {
    const page = await corePage(`
        import { renderCut, cutHere } from "${quire}/img/cutout/render.ts";
        import { behindOf, lowFor } from "${quire}/img/cutout/cut.ts";
        import { encodeRuns } from "${quire}/img/masks.ts";
        // a figure on green, and its mask at a quarter size, soft at its edge
        const draw = (width, height) => {
            const canvas = new OffscreenCanvas(width, height);
            const c = canvas.getContext("2d");
            c.fillStyle = "#3f9a3c"; c.fillRect(0, 0, width, height);
            c.fillStyle = "#e8c49a"; c.beginPath(); c.arc(width / 2, height / 2, height / 3, 0, 7); c.fill();
            return canvas.transferToImageBitmap();
        };
        const maskFor = (width, height) => {
            const w = Math.round(width / 4), h = Math.round(height / 4);
            const bytes = new Uint8Array(w * h);
            for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) bytes[y * w + x] = Math.round(255 * Math.min(1, Math.max(0, h / 3 - Math.hypot(x + 0.5 - w / 2, y + 0.5 - h / 2) + 0.5)));
            return { width: w, height: h, runs: encodeRuns(bytes) };
        };
        window.compare = async () => {
            const bitmap = draw(2300, 1500);
            const cut = { found: maskFor(2300, 1500), background: "clear" };
            const low = await lowFor(bitmap, cut);
            const behind = await behindOf(bitmap);
            const out = [];
            for (const background of [{ kind: "clear" }, { kind: "color" }, { kind: "blur" }]) {
                const card = await renderCut(bitmap, low, background, "#2050c0", behind);
                const here = await cutHere(bitmap, low, background, "#2050c0", behind);
                let most = 0;
                for (let at = 0; at < card.data.length; at++) most = Math.max(most, Math.abs(card.data[at] - here.data[at]));
                out.push(most);
            }
            return out;
        };
        window.big = async () => {
            const bitmap = draw(4243, 2828);
            const cut = { found: maskFor(1024 * 4, 683 * 4), background: "clear" };
            const started = performance.now();
            const low = await lowFor(bitmap, cut);
            const pixels = await renderCut(bitmap, low, { kind: "clear" });
            return { width: pixels.width, height: pixels.height, ms: Math.round(performance.now() - started), middle: pixels.data[(1414 * 4243 + 2121) * 4 + 3], corner: pixels.data[3] };
        };
    `);
    if (!page) return;
    try {
        const most = await page.tab.run<number[]>("window.compare()");
        console.log(`the card against the processor, clear, on a color and on the blurred picture: at most ${most.join(", ")} apart`);
        for (const each of most) expect(each).toBeLessThanOrEqual(1);
        const big = await page.tab.run<{ width: number; height: number; ms: number; middle: number; corner: number }>("window.big()");
        console.log(`a 12 megapixel picture cut at full size (the edges worked out and laid on the card, headless, software drawing): ${big.ms} ms`);
        expect([big.width, big.height]).toEqual([4243, 2828]);
        expect(big.middle).toBe(255);
        expect(big.corner).toBe(0);
    } finally {
        await page.close();
    }
}, 120_000);
