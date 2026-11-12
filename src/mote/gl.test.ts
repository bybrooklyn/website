// Mote's 3D drawing, looked at: a small scene is drawn in headless Chromium and its pixels are read
// back. A shader that does not compile, or one that draws nothing, fails here and not on the site.
// Skipped, with a notice, on a machine with no Chromium.

import { expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { browser, chromium } from "../../scripts/browser";

const here = import.meta.dir;

// What the page does: a red cube in the middle and a white sign beside it, drawn four ways.
const scene = `
import { gl } from "${here}/gl.ts";
import { cube } from "${here}/solids.ts";
const canvas = document.querySelector("canvas");
const view = gl(canvas);
view.size(400, 300);
view.look([0, 2, 9], [0, 0, 0], 30);
view.light([4, 9, 6], [-3, -2, -3], [3, 2, 3]);
view.add(cube(), { color: [0.9, 0.2, 0.2] });
const sign = view.sign("17", [1, 1, 1]);
sign.at = [-2.6, 0, 0];
sign.turn = view.facing();
const g = canvas.getContext("webgl2");
const read = () => {
    view.draw();
    const pixels = new Uint8Array(canvas.width * canvas.height * 4);
    g.readPixels(0, 0, canvas.width, canvas.height, g.RGBA, g.UNSIGNED_BYTE, pixels);
    const at = (x, y) => [...pixels.slice((y * canvas.width + x) * 4, (y * canvas.width + x) * 4 + 4)];
    let seen = 0;
    for (let i = 0; i < pixels.length; i += 4) if (pixels[i] + pixels[i + 1] + pixels[i + 2] > 0) seen++;
    return { middle: at(canvas.width >> 1, canvas.height >> 1), corner: at(2, 2), seen };
};
const plain = read();
sign.emit = 1;
const shining = read();
view.shade = 0.5;
const shaded = read();
window.result = { plain, shining, shaded, wide: canvas.width };
`;

test.skipIf(!chromium())("a cube is drawn, what shines bleeds light, and the shade darkens", async () => {
    const folder = await mkdtemp(join(tmpdir(), "mote-gl-"));
    const tab = await browser({ width: 500, height: 400 });
    try {
        await Bun.write(`${folder}/scene.ts`, scene);
        const built = await Bun.build({ entrypoints: [`${folder}/scene.ts`], target: "browser" });
        await Bun.write(`${folder}/page.html`, `<!doctype html><canvas style="width:400px;height:300px"></canvas><script type="module">${await built.outputs[0]!.text()}</script>`);
        await tab.open(`file://${folder}/page.html`);
        expect(tab.errors).toEqual([]);
        const { plain, shining, shaded } = await tab.run<Record<"plain" | "shining" | "shaded", { middle: number[]; corner: number[]; seen: number }>>("window.result");

        // the cube is there, solid and red, and nothing is drawn where nothing is
        expect(plain.middle[3]).toBe(255);
        expect(plain.middle[0]!).toBeGreaterThan(plain.middle[1]! * 2);
        expect(plain.corner[3]).toBe(0);
        // a sign that shines lights up pixels around itself that were empty
        expect(shining.seen).toBeGreaterThan(plain.seen + 400);
        // the shade darkens the cube and the empty corner alike
        expect(shaded.corner[3]!).toBeGreaterThan(110);
        expect(shaded.corner[3]!).toBeLessThan(145);
        expect(shaded.middle[0]!).toBeLessThan(shining.middle[0]!);
    } finally {
        await tab.close();
        await rm(folder, { recursive: true, force: true });
    }
}, 30_000);

if (!chromium()) console.warn("gl.test.ts: no Chromium on this machine, so the drawing was not looked at.");
