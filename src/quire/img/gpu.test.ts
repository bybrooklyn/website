// What drawing through WebGPU is held to: it flattens a picture to the same pixels as WebGL2 does,
// to within rounding, through crops, covers, every filter and sizes up and down (gl.test.ts holds
// WebGL2 to the arithmetic itself). Headless Chromium has WebGPU only when asked for it, and loses
// the device the moment a WebGPU canvas is shown, so its drawing on the screen is not tried here; the
// editor draws with WebGL2 again when that happens (`lost` in draw.ts).

import { expect, test } from "bun:test";
import { corePage, quire } from "../../../scripts/core-page";
import { look } from "./steps";

const original = { name: "pictures/a.png", width: 300, height: 200, type: "image/png", bytes: 1 };
const looks = [
    look({ original, steps: [{ id: "s1", type: "cover", rect: { x: 40, y: 40, width: 60, height: 30 }, color: "#10f0a0" }] }),
    look({ original, steps: [{ id: "s1", type: "crop", rect: { x: 13, y: 7, width: 251, height: 170 } }, { id: "s2", type: "resize", width: 97, filter: "lanczos" }, { id: "s3", type: "cover", rect: { x: 40, y: 40, width: 60, height: 30 }, color: "#10f0a0" }] }),
    look({ original, steps: [{ id: "s1", type: "resize", width: 523, filter: "bilinear" }] }),
    look({ original, steps: [{ id: "s1", type: "resize", width: 140, height: 33, filter: "nearest" }] }),
];

test("in Chromium with WebGPU, a picture flattens to the same pixels as through WebGL2, to within rounding", async () => {
    const page = await corePage(
        `
        import { backendFor, loadPicture } from "${quire}/img/draw.ts";
        const canvas = new OffscreenCanvas(300, 200);
        const context = canvas.getContext("2d");
        for (let x = 0; x < 300; x++) for (let y = 0; y < 200; y += 50) { context.fillStyle = "rgb(" + ((x * 7) % 256) + "," + ((y * 3 + x) % 256) + "," + (x % 2 ? 250 : 20) + ")"; context.fillRect(x, y, 1, 50); }
        const blob = await canvas.convertToBlob({ type: "image/png" });
        window.made = async (only, looks) => {
            const backend = await backendFor(new OffscreenCanvas(1, 1), only);
            if (!backend) return null;
            const picture = await loadPicture(backend, blob);
            const out = [];
            for (const each of looks) out.push([...(await picture.flatten(each, 64)).data]);
            picture.destroy();
            backend.destroy();
            return out;
        };
    `,
        { args: ["--enable-unsafe-webgpu"] },
    );
    if (!page) return;
    try {
        const gpu = await page.tab.run<number[][] | null>(`window.made("WebGPU", ${JSON.stringify(looks)})`);
        if (!gpu) return console.log("this Chromium has no WebGPU, so it was not compared");
        const gl = await page.tab.run<number[][]>(`window.made("WebGL2", ${JSON.stringify(looks)})`);
        looks.forEach((_, index) => {
            let most = 0;
            gpu[index]!.forEach((value, at) => (most = Math.max(most, Math.abs(value - gl[index]![at]!))));
            expect(most).toBeLessThanOrEqual(1);
        });
    } finally {
        await page.close();
    }
}, 60_000);
