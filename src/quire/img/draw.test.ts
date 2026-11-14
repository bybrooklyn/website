// What drawing and flattening are held to. The plan for flattening covers the result exactly, piece
// by piece, each reading no more of the original than a card takes and nothing past the crop; the
// filters weigh as they should; and in Chromium a 12 megapixel photograph is drawn with its crop
// moving at screen speed, and a 50 megapixel one drawn and flattened without falling over. That the
// two ways flatten alike is held in gl.test.ts and gpu.test.ts. Run with `bun test src/quire/img`.

import { expect, test } from "bun:test";
import { corePage, quire } from "../../../scripts/core-page";
import { plan, reach, weight } from "./draw";
import { look } from "./steps";

const original = { name: "pictures/a.png", width: 900, height: 600, type: "image/png", bytes: 1 };

test("the pieces of a flattening cover the result exactly once, each reading at most what a card takes, and only inside the crop", () => {
    for (const shown of [
        look({ original, steps: [] }),
        look({ original, steps: [{ id: "s1", type: "crop", rect: { x: 100, y: 50, width: 701, height: 333 } }, { id: "s2", type: "resize", width: 97, filter: "lanczos" }] }),
        look({ original, steps: [{ id: "s1", type: "resize", width: 2000, filter: "bilinear" }] }),
    ]) {
        const pieces = plan(shown, 256);
        const counted = new Uint8Array(shown.width * shown.height);
        for (const piece of pieces) {
            for (let y = piece.out.y; y < piece.out.y + piece.out.height; y++) for (let x = piece.out.x; x < piece.out.x + piece.out.width; x++) counted[y * shown.width + x]!++;
            expect(piece.source.width).toBeLessThanOrEqual(256);
            expect(piece.source.height).toBeLessThanOrEqual(256);
            expect(piece.source.x).toBeGreaterThanOrEqual(shown.crop.x);
            expect(piece.source.x + piece.source.width).toBeLessThanOrEqual(shown.crop.x + shown.crop.width);
            // every sample the passes may read is inside the part cut out for them
            expect(piece.across.low).toBeGreaterThanOrEqual(0);
            expect(Math.ceil(piece.across.start + (piece.out.width - 1) * piece.across.step + piece.across.support)).toBeLessThanOrEqual(piece.source.width + piece.across.support);
        }
        expect(counted.every((count) => count === 1)).toBe(true);
    }
});

test("the filters weigh as they should: one at the middle, nothing at whole steps away, and a reach that grows when shrinking", () => {
    expect(weight("lanczos", 0)).toBe(1);
    expect(Math.abs(weight("lanczos", 1))).toBeLessThan(1e-12);
    expect(Math.abs(weight("lanczos", 2))).toBeLessThan(1e-12);
    expect(weight("lanczos", 3.2)).toBe(0);
    expect(weight("bilinear", 0.25)).toBe(0.75);
    expect(reach("lanczos", 4)).toBe(12);
    expect(reach("lanczos", 0.5)).toBe(3);
    expect(reach("nearest", 9)).toBe(0.5);
});

test("in Chromium, a 12 megapixel photograph is drawn with its crop moving at screen speed, and a 50 megapixel one is drawn whole, at full size and flattened without falling over", async () => {
    const page = await corePage(`
        import { backendFor, loadPicture } from "${quire}/img/draw.ts";
        import { look } from "${quire}/img/steps.ts";
        const photograph = async (width, height) => {
            const canvas = new OffscreenCanvas(width, height);
            const context = canvas.getContext("2d");
            const fade = context.createLinearGradient(0, 0, width, height);
            fade.addColorStop(0, "#203040");
            fade.addColorStop(1, "#e0a060");
            context.fillStyle = fade;
            context.fillRect(0, 0, width, height);
            for (let at = 0; at < 400; at++) {
                context.fillStyle = "hsl(" + ((at * 37) % 360) + " 60% 50%)";
                context.fillRect((at * 7919) % width, (at * 104729) % height, 90, 60);
            }
            return canvas.convertToBlob({ type: "image/jpeg", quality: 0.9 });
        };
        const frame = () => new Promise((done) => requestAnimationFrame(done));
        // headless Chromium loses a WebGPU device the moment it shows a canvas, so WebGPU is measured flattening only
        window.measure = async (width, height, only) => {
            const canvas = document.createElement("canvas");
            canvas.width = 1300;
            canvas.height = 800;
            document.body.append(canvas);
            const backend = await backendFor(only === "WebGPU" ? new OffscreenCanvas(1, 1) : canvas, only);
            const blob = await photograph(width, height);
            let started = performance.now();
            const picture = await loadPicture(backend, blob);
            const loaded = performance.now() - started;
            const original = { name: "pictures/p.jpg", width, height, type: "image/jpeg", bytes: blob.size };
            let perSecond = 0;
            if (only === "WebGL2") {
                const scale = Math.min(1300 / width, 800 / height);
                await frame();
                started = performance.now();
                for (let at = 0; at < 60; at++) {
                    const crop = { x: at * 10, y: at * 5, width: width - at * 30, height: height - at * 20 };
                    picture.draw({ look: look({ original, steps: [{ id: "s1", type: "crop", rect: crop }] }), view: { scale, x: 0, y: 0 }, cropping: crop, canvas });
                    await frame();
                }
                perSecond = 60 / ((performance.now() - started) / 1000);
                // at full size, where a large picture needs its pieces
                const whole = { look: look({ original, steps: [] }), view: { scale: 1, x: -width / 2, y: -height / 2 }, canvas };
                picture.draw(whole, () => {});
                await new Promise((done) => setTimeout(done, 500));
                picture.draw(whole);
            }
            started = performance.now();
            const flat = await picture.flatten(look({ original, steps: [{ id: "s1", type: "resize", width: 2000, filter: "lanczos" }, { id: "s2", type: "cover", rect: { x: 10, y: 10, width: 500, height: 300 }, color: "#000000" }] }));
            const flattened = performance.now() - started;
            picture.destroy();
            canvas.remove();
            return { backend: backend.name, loaded: Math.round(loaded), perSecond: Math.round(perSecond), flattened: Math.round(flattened), size: [flat.width, flat.height] };
        };
    `, { args: ["--enable-unsafe-webgpu"] });
    if (!page) return;
    try {
        for (const only of ["WebGL2", "WebGPU"]) {
            for (const [width, height] of [[4000, 3000], [8660, 5773]]) {
                const found = await page.tab.run<{ backend: string; loaded: number; perSecond: number; flattened: number; size: number[] }>(`window.measure(${width}, ${height}, "${only}")`);
                const megapixels = Math.round((width! * height!) / 1e6);
                console.log(`${megapixels} megapixels, ${found.backend}: decoded and on the card in ${found.loaded} ms;${found.perSecond ? ` crop dragged at ${found.perSecond} frames a second;` : ""} flattened to 2000 wide in ${found.flattened} ms`);
                expect(found.size).toEqual([2000, Math.round((2000 * height!) / width!)]);
                if (only === "WebGL2" && megapixels === 12) expect(found.perSecond).toBeGreaterThan(30);
            }
        }
    } finally {
        await page.close();
    }
}, 240_000);
