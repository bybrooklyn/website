// The restoring models, the real files, on the site's own ONNX Runtime build in Chromium, each where the table
// says it runs: the repair models on the graphics card (where Chromium gives one) take a JPEG of a scene drawn in
// the page, compressed at quality 30, nearer the clean scene than the JPEG is; the enlarging model, on
// WebAssembly, makes a scene drawn at half size twice as large nearer the scene drawn at full size than the
// browser's own smooth enlargement does, and four times by running twice; run tile by tile it gives what it gives
// the whole picture within a small bound. Times are printed. The files are read from where they were fetched for
// trials (~/.cache/quire-model-trials/restore/); without them, or without a Chromium, this is skipped with a
// notice, and nothing is fetched.

import { expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { corePage, quire } from "../../../../scripts/core-page";
import { packageAt } from "../../../../scripts/lib";
import { ENLARGE_MODELS, REPAIR_MODELS, type RestoreModel } from "./models";

const ORT = `${packageAt("onnxruntime-web", "dist")}/`;
const TRIALS = `${homedir()}/.cache/quire-model-trials/restore/`;
/** Where each model's trial copy is, in its own folder. */
const FOLDERS: Record<string, string> = { "repair-better": "scunet-color-real-psnr-fp16", "repair-best": "fbcnn-color-fp16", "enlarge-small": "swin2sr-lightweight-x2-fp16" };
const trialOf = (model: RestoreModel) => `${TRIALS}${FOLDERS[model.id]}/${model.path.split("/").pop()}`;
const MODELS = [...REPAIR_MODELS, ...ENLARGE_MODELS];
const there = MODELS.every((each) => existsSync(trialOf(each)));

/** The worker each trial page runs the engine in, as the editor does: the models on a shelf in memory, scenes drawn here, each run's tiles laid into one picture. */
const workerScript = `
    import { serve } from "${quire}/img/restore/engine.ts";
    import { REPAIR_MODELS, ENLARGE_MODELS } from "${quire}/img/restore/models.ts";
    import { keptName } from "${quire}/img/read/models.ts";
    import { graphicsCard } from "${quire}/core/onnx.ts";
    const files = new Map();
    const shelf = { write: async (name, bytes) => files.set(name, bytes), read: async (name) => files.get(name), size: async (name) => files.get(name)?.length ?? -1, mark: async (name, said) => files.set(name + ".whole", said), marked: async (name) => files.get(name + ".whole") };
    const ready = (async () => { for (const each of [...REPAIR_MODELS, ...ENLARGE_MODELS]) { const bytes = new Uint8Array(await (await fetch("/m/" + each.id)).arrayBuffer()); files.set(keptName(each), bytes); files.set(keptName(each) + ".whole", each.sha256); } })();
    // a scene with flat colours, soft shading, fine lines and words, at any size
    const scene = (width, height) => {
        const canvas = new OffscreenCanvas(width, height);
        const c = canvas.getContext("2d");
        c.scale(width / 640, height / 480);
        const fade = c.createLinearGradient(0, 0, 640, 480); fade.addColorStop(0, "#284b63"); fade.addColorStop(1, "#d9a05b");
        c.fillStyle = fade; c.fillRect(0, 0, 640, 480);
        for (let at = 0; at < 40; at++) { c.fillStyle = "hsl(" + ((at * 47) % 360) + " 60% 55%)"; c.beginPath(); c.arc((at * 97) % 640, (at * 59) % 480, 12 + (at % 5) * 9, 0, 7); c.fill(); }
        c.strokeStyle = "#f4f1ea"; c.lineWidth = 1.5;
        for (let at = 0; at < 24; at++) { c.beginPath(); c.moveTo(20 + at * 25, 300); c.lineTo(40 + at * 25, 460); c.stroke(); }
        c.fillStyle = "#111"; c.font = "26px sans-serif"; c.fillText("Restoring, tile by tile", 40, 60);
        return canvas;
    };
    const pixelsOf = (canvas) => canvas.getContext("2d").getImageData(0, 0, canvas.width, canvas.height).data;
    const psnr = (a, b) => { let sum = 0, count = 0; for (let k = 0; k < a.length; k++) { if (k % 4 === 3) continue; sum += (a[k] - b[k]) ** 2; count++; } return 10 * Math.log10(65025 / Math.max(1e-9, sum / count)); };
    const runOnce = async (model, picture, prefer, quality, tile) => {
        let result, said;
        await serve({ type: "run", id: 1, model, picture, prefer, quality, tile }, { shelf: async () => shelf, say: (answer) => {
            if (answer.type === "tile") { result ??= new Uint8ClampedArray(0); tiles.push(answer); }
            else if (answer.type !== "share") said = answer;
        } });
        return said;
    };
    let tiles = [];
    const laid = (finished) => { const data = new Uint8ClampedArray(finished.width * finished.height * 4); for (const each of tiles) for (let row = 0; row < each.out.height; row++) data.set(each.data.subarray(row * each.out.width * 4, (row + 1) * each.out.width * 4), ((each.out.y + row) * finished.width + each.out.x) * 4); tiles = []; return data; };
    self.onmessage = async (event) => {
        if (event.data === "card") return self.postMessage({ card: await graphicsCard() });
        await ready;
        const [kind, model, prefer] = event.data;
        try {
            if (kind === "repair") {
                const clean = scene(1280, 960);
                const jpeg = await createImageBitmap(await clean.convertToBlob({ type: "image/jpeg", quality: 0.3 }));
                const drawn = new OffscreenCanvas(1280, 960); drawn.getContext("2d").drawImage(jpeg, 0, 0);
                const started = performance.now();
                const said = await runOnce(model, jpeg, prefer, 30);
                if (said.type !== "finished") return self.postMessage({ message: said.message });
                const made = laid(said);
                return self.postMessage({ ms: Math.round(performance.now() - started), place: said.place, before: psnr(pixelsOf(drawn), pixelsOf(clean)), after: psnr(made, pixelsOf(clean)) });
            }
            // enlarging: the scene drawn at half size, made twice as large; the browser's own smooth enlargement beside it
            const big = scene(640, 480);
            const small = scene(320, 240);
            const smooth = new OffscreenCanvas(640, 480); const s = smooth.getContext("2d"); s.imageSmoothingQuality = "high"; s.drawImage(small, 0, 0, 640, 480);
            const started = performance.now();
            const said = await runOnce(model, small.transferToImageBitmap ? await createImageBitmap(small) : small, prefer);
            if (said.type !== "finished") return self.postMessage({ message: said.message });
            const made = laid(said);
            const ms = Math.round(performance.now() - started);
            // the same picture in one tile, to hold the joins to the whole picture's answer
            const whole = await runOnce(model, await createImageBitmap(small), prefer, undefined, 4096);
            const wholeMade = laid(whole);
            // and twice over, four times as large, from a quarter size
            const quarter = scene(160, 120);
            const once = await runOnce(model, await createImageBitmap(quarter), prefer);
            const half = laid(once);
            const twice = await runOnce(model, await createImageBitmap(new ImageData(half, once.width, once.height)), prefer);
            const four = laid(twice);
            const smoothFour = new OffscreenCanvas(640, 480); const f = smoothFour.getContext("2d"); f.imageSmoothingQuality = "high"; f.drawImage(quarter, 0, 0, 640, 480);
            self.postMessage({ ms, place: said.place, before: psnr(pixelsOf(smooth), pixelsOf(big)), after: psnr(made, pixelsOf(big)), joins: psnr(made, wholeMade), fourBefore: psnr(pixelsOf(smoothFour), pixelsOf(big)), fourAfter: psnr(four, pixelsOf(big)) });
        } catch (error) {
            self.postMessage({ message: String(error) });
        }
    };
`;

const pageFor = async () => {
    const folder = await mkdtemp(join(tmpdir(), "quire-restore-"));
    await Bun.write(`${folder}/worker.ts`, workerScript);
    const built = await Bun.build({ entrypoints: [`${folder}/worker.ts`], target: "browser" });
    const script = await built.outputs[0]!.text();
    await rm(folder, { recursive: true, force: true });
    return corePage(
        `
        const worker = new Worker("/worker.js", { type: "module" });
        worker.onmessage = (event) => (window.done = event.data);
        window.go = (given) => { window.done = undefined; worker.postMessage(given); };
    `,
        {
            args: ["--enable-unsafe-webgpu", "--enable-features=Vulkan", "--use-angle=vulkan"],
            files: async (path) => {
                if (path === "/worker.js") return new Response(script, { headers: { "Content-Type": "text/javascript" } });
                if (path.startsWith("/ort/")) return new Response(Bun.file(ORT + path.slice(5)), { headers: { "Content-Type": path.endsWith(".mjs") ? "text/javascript" : "application/wasm" } });
                const model = MODELS.find((each) => path === `/m/${each.id}`);
                if (model) return new Response(Bun.file(trialOf(model)));
                return undefined;
            },
        },
    );
};

test("each restoring model runs where the table says, and comes nearer the clean picture than the JPEG or the smooth enlargement", async () => {
    if (!there) return console.warn("restoring models skipped: they are not in ~/.cache/quire-model-trials/restore/");
    const page = await pageFor();
    if (!page) return;
    try {
        const wait = async (limit: number) => {
            const began = Date.now();
            while (!(await page.tab.run<boolean>("!!window.done")) && Date.now() - began < limit) await page.tab.wait(250);
            return page.tab.run<Record<string, number | string | boolean> | undefined>("window.done");
        };
        // a browser just started gives no graphics adapter for its first moments, so the card is asked for after a little while
        await page.tab.wait(2500);
        await page.tab.run(`window.go("card")`);
        const card = (await wait(30_000))?.card === true;
        for (const model of REPAIR_MODELS) {
            if (!card) {
                console.log(`${model.name} not tried: there is no graphics card here, and it runs only on one`);
                continue;
            }
            await page.tab.run(`window.go(["repair", ${JSON.stringify(model.id)}, "webgpu"])`);
            const done = await wait(300_000);
            expect(done?.message).toBeUndefined();
            console.log(`${model.name} (${model.credit}) on ${done!.place}: 1.2 MP in ${done!.ms} ms, the JPEG ${(done!.before as number).toFixed(2)} dB, repaired ${(done!.after as number).toFixed(2)} dB`);
            expect(done!.place).toBe("webgpu");
            expect(done!.after as number).toBeGreaterThan((done!.before as number) + 0.3);
        }
        for (const model of ENLARGE_MODELS) {
            await page.tab.run(`window.go(["enlarge", ${JSON.stringify(model.id)}])`);
            const done = await wait(900_000);
            expect(done?.message).toBeUndefined();
            console.log(`${model.name} (${model.credit}) on ${done!.place}: 320 by 240 to twice in ${done!.ms} ms, the smooth enlargement ${(done!.before as number).toFixed(2)} dB, the model ${(done!.after as number).toFixed(2)} dB, tiles against the whole ${(done!.joins as number).toFixed(1)} dB; four times by twice over ${(done!.fourAfter as number).toFixed(2)} dB against ${(done!.fourBefore as number).toFixed(2)}`);
            expect(done!.place).toBe("wasm");
            expect(done!.after as number).toBeGreaterThan((done!.before as number) + 1);
            expect(done!.fourAfter as number).toBeGreaterThan(done!.fourBefore as number);
            expect(done!.joins as number).toBeGreaterThan(40);
        }
    } finally {
        await page.close();
    }
}, 1_800_000);
