// What drawing through WebGL2 is held to: flattening gives the same pixels as the same arithmetic
// done here on the processor (the same plan, the same filters, rounding between the passes as the
// card's 8-bit textures do), to within rounding, through crops, every filter and sizes up and down,
// piece by piece; and a covered place holds none of the original's pixels, through any resize.

import { expect, test } from "bun:test";
import { corePage, quire } from "../../../scripts/core-page";
import { plan, weight, type Pass } from "./draw";
import { look, type Look } from "./steps";

const original = { name: "pictures/a.png", width: 300, height: 200, type: "image/png", bytes: 1 };

/** The flattening done on the processor with the same plan and the same arithmetic as the shaders, rounding between the passes as the card's 8-bit textures do. */
function flattenHere(pixels: Uint8ClampedArray, width: number, shown: Look, most: number): Uint8ClampedArray {
    const covered = pixels.slice();
    for (const cover of shown.covers) {
        const [red, green, blue] = [1, 3, 5].map((at) => parseInt(cover.color.slice(at, at + 2), 16));
        for (let y = cover.rect.y; y < cover.rect.y + cover.rect.height; y++) for (let x = cover.rect.x; x < cover.rect.x + cover.rect.width; x++) covered.set([red!, green!, blue!, 255], (y * width + x) * 4);
    }
    const result = new Uint8ClampedArray(shown.width * shown.height * 4);
    const one = (pass: Pass, center: number, read: (at: number) => number[]) => {
        if (pass.filter === "nearest") return read(Math.min(pass.high, Math.max(pass.low, Math.floor(center + 0.501))));
        const sum = [0, 0, 0, 0];
        let total = 0;
        for (let t = Math.ceil(center - pass.support); t <= center + pass.support; t++) {
            const w = weight(pass.filter, (t - center) * pass.scale);
            const value = read(Math.min(pass.high, Math.max(pass.low, t)));
            for (let channel = 0; channel < 4; channel++) sum[channel]! += w * value[channel]!;
            total += w;
        }
        return sum.map((value) => Math.round(Math.min(255, Math.max(0, value / total))));
    };
    for (const piece of plan(shown, most)) {
        const at = (x: number, y: number) => [...covered.subarray(((piece.source.y + y) * width + piece.source.x + x) * 4, ((piece.source.y + y) * width + piece.source.x + x) * 4 + 4)];
        const across: number[][][] = [];
        for (let y = 0; y < piece.source.height; y++) {
            across.push([]);
            for (let x = 0; x < piece.out.width; x++) across[y]!.push(one(piece.across, piece.across.start + x * piece.across.step, (t) => at(t, y)));
        }
        for (let y = 0; y < piece.out.height; y++) for (let x = 0; x < piece.out.width; x++) result.set(one(piece.down, piece.down.start + y * piece.down.step, (t) => across[t]![x]!), ((piece.out.y + y) * shown.width + piece.out.x + x) * 4);
    }
    return result;
}

const looks: Look[] = [
    look({ original, steps: [{ id: "s1", type: "cover", rect: { x: 40, y: 40, width: 60, height: 30 }, color: "#10f0a0" }] }),
    look({ original, steps: [{ id: "s1", type: "crop", rect: { x: 13, y: 7, width: 251, height: 170 } }, { id: "s2", type: "resize", width: 97, filter: "lanczos" }, { id: "s3", type: "cover", rect: { x: 40, y: 40, width: 60, height: 30 }, color: "#10f0a0" }] }),
    look({ original, steps: [{ id: "s1", type: "resize", width: 523, filter: "bilinear" }] }),
    look({ original, steps: [{ id: "s1", type: "resize", width: 140, height: 33, filter: "nearest" }] }),
];

test("in Chromium, WebGL2 flattens to the same pixels as the same arithmetic here, to within rounding, and covered places hold none of the original", async () => {
    const page = await corePage(`
        import { backendFor, loadPicture } from "${quire}/img/draw.ts";
        // a busy picture: stripes and a gradient, and a block of magenta that the covers sit on
        const canvas = new OffscreenCanvas(300, 200);
        const context = canvas.getContext("2d");
        for (let x = 0; x < 300; x++) for (let y = 0; y < 200; y += 50) { context.fillStyle = "rgb(" + ((x * 7) % 256) + "," + ((y * 3 + x) % 256) + "," + (x % 2 ? 250 : 20) + ")"; context.fillRect(x, y, 1, 50); }
        context.fillStyle = "#ff00ff";
        context.fillRect(45, 45, 50, 20);
        const pixels = context.getImageData(0, 0, 300, 200).data;
        const blob = await canvas.convertToBlob({ type: "image/png" });
        window.made = async (only, looks) => {
            const backend = await backendFor(document.createElement("canvas"), only);
            if (!backend) return undefined;
            const picture = await loadPicture(backend, blob);
            const out = [];
            for (const each of looks) out.push([...(await picture.flatten(each, 64)).data]);
            picture.destroy();
            return { name: backend.name, out };
        };
        window.pixels = [...pixels];
    `);
    if (!page) return;
    try {
        const pixels = Uint8ClampedArray.from(await page.tab.run<number[]>("window.pixels"));
        const gl = await page.tab.run<{ name: string; out: number[][] }>(`window.made("WebGL2", ${JSON.stringify(looks)})`);
        expect(gl.name).toBe("WebGL2");
        looks.forEach((shown, index) => {
            const here = flattenHere(pixels, 300, shown, 64);
            let most = 0;
            gl.out[index]!.forEach((value, at) => (most = Math.max(most, Math.abs(value - here[at]!))));
            expect(most).toBeLessThanOrEqual(1);
            // nothing of the magenta under a cover is left, through any resize
            if (shown.covers.length) for (let at = 0; at < gl.out[index]!.length; at += 4) expect(gl.out[index]![at] === 255 && gl.out[index]![at + 1]! < 40 && gl.out[index]![at + 2] === 255).toBe(false);
        });
    } finally {
        await page.close();
    }
}, 60_000);

