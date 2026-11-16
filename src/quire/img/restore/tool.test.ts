// What repairing with a model and enlarging with one are held to as imgQuire's tools, in Chromium on the graphics
// card with the real files (Hugging Face answered from the trial copies, the models in their own worker). Repair
// JPEG with… asks first, the instant way first among the cards, and fetches nothing until told (the repair models are
// put in the browser's storage first, as if fetched before: the browser's driver cannot hand over a file of their size as an
// answer, so the fetch itself is held with the enlarging model); Best then repairs a
// JPEG compressed at quality 30 as a step, nearer the clean picture than the instant repair; its result is kept in
// the document, which opened again draws the same pixels with no request at all; a run stopped with Escape leaves
// the steps as they were. Under more, the way of enlarging is chosen in the same family of dialog, and 200% then
// makes the picture twice as large through the model, nearer the picture drawn at that size than the filter is. The
// only request outside the page is the enlarging model's file, a GET with no body.

import { expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { imgPage } from "../../../../scripts/img-page";
import { packageAt } from "../../../../scripts/lib";
import { ENLARGE_MODELS, REPAIR_MODELS, type RestoreModel } from "./models";
import { keptName } from "../read/models";

const TRIALS = `${homedir()}/.cache/quire-model-trials/restore/`;
const ORT = `${packageAt("onnxruntime-web", "dist")}/`;
const FOLDERS: Record<string, string> = { "repair-better": "scunet-color-real-psnr-fp16", "repair-best": "fbcnn-color-fp16", "enlarge-small": "swin2sr-lightweight-x2-fp16" };
const trialOf = (model: RestoreModel) => `${TRIALS}${FOLDERS[model.id]}/${model.path.split("/").pop()}`;
const MODELS = [...REPAIR_MODELS, ...ENLARGE_MODELS];

/** A scene drawn in the page at a size, as pixels' code for the page: soft shading, colored rounds, fine lines, words. */
const scene = (width: number, height: number) => `(() => {
    const canvas = new OffscreenCanvas(${width}, ${height});
    const c = canvas.getContext("2d");
    c.scale(${width} / 640, ${height} / 480);
    const fade = c.createLinearGradient(0, 0, 640, 480); fade.addColorStop(0, "#284b63"); fade.addColorStop(1, "#d9a05b");
    c.fillStyle = fade; c.fillRect(0, 0, 640, 480);
    for (let at = 0; at < 40; at++) { c.fillStyle = "hsl(" + ((at * 47) % 360) + " 60% 55%)"; c.beginPath(); c.arc((at * 97) % 640, (at * 59) % 480, 12 + (at % 5) * 9, 0, 7); c.fill(); }
    c.strokeStyle = "#f4f1ea"; c.lineWidth = 1.5;
    for (let at = 0; at < 24; at++) { c.beginPath(); c.moveTo(20 + at * 25, 300); c.lineTo(40 + at * 25, 460); c.stroke(); }
    c.fillStyle = "#111"; c.font = "26px sans-serif"; c.fillText("Restoring, tile by tile", 40, 60);
    return canvas;
})()`;
const psnr = `(a, b) => { let sum = 0, count = 0; for (let k = 0; k < a.length; k++) { if (k % 4 === 3) continue; sum += (a[k] - b[k]) ** 2; count++; } return 10 * Math.log10(65025 / Math.max(1e-9, sum / count)); }`;

test("Repair JPEG with a model and Enlarge with a model are asked first, make steps, keep the repair in the document and fetch only the models", async () => {
    if (!MODELS.every((each) => existsSync(trialOf(each)))) return console.warn("restoring tool test skipped: the models are not in ~/.cache/quire-model-trials/restore/");
    const built = await Bun.build({ entrypoints: [`${import.meta.dir}/engine.ts`], target: "browser" });
    const worker = await built.outputs[0]!.text();
    const page = await imgPage(
        "img-restore",
        { width: 1300, height: 820 },
        async (path) => {
            if (path === "/engine.ts") return new Response(worker, { headers: { "Content-Type": "text/javascript" } });
            const kept = MODELS.find((each) => path === `/trial/${each.id}`);
            if (kept) return new Response(Bun.file(trialOf(kept)));
            if (path.startsWith("/ort/") && !path.includes("..")) {
                const file = Bun.file(ORT + path.slice(5));
                if (await file.exists()) return new Response(file, { headers: { "Content-Type": path.endsWith(".wasm") ? "application/wasm" : "text/javascript" } });
            }
            return undefined;
        },
        ["--enable-unsafe-webgpu", "--enable-features=Vulkan", "--use-angle=vulkan"],
    );
    if (!page) return;
    const { tab, until } = page;
    try {
        await tab.serve(["https://huggingface.co/"], async (url) => {
            const model = MODELS.find((each) => url === `https://huggingface.co/${each.repo}/resolve/${each.revision}/${each.path}`);
            return model ? { body: new Uint8Array(await Bun.file(trialOf(model)).arrayBuffer()) } : undefined;
        });
        // the repair models put in this browser's private storage as if fetched before, since the browser's driver cannot hand
        // over a file of their size as an answer; the enlarging model, 7.5 MB, is fetched through Hugging Face's address below
        for (const each of REPAIR_MODELS)
            await tab.run(`(async () => {
                const folder = await (await navigator.storage.getDirectory()).getDirectoryHandle("imgquire-restore", { create: true });
                const put = async (name, body) => { const writable = await (await folder.getFileHandle(name, { create: true })).createWritable(); await writable.write(body); await writable.close(); };
                await put(${JSON.stringify(keptName(each))}, await (await fetch("/trial/${each.id}")).arrayBuffer());
                await put(${JSON.stringify(`${keptName(each)}.whole`)}, ${JSON.stringify(each.sha256)});
            })()`);
        // a browser just started gives no graphics adapter for its first moments
        await tab.wait(2500);
        await tab.run(`(async () => {
            window.clean = ${scene(1280, 960)}.getContext("2d").getImageData(0, 0, 1280, 960).data;
            const blob = await ${scene(1280, 960)}.convertToBlob({ type: "image/jpeg", quality: 0.3 });
            const data = new DataTransfer();
            data.items.add(new File([blob], "scene.jpg", { type: "image/jpeg" }));
            document.dispatchEvent(new ClipboardEvent("paste", { clipboardData: data, bubbles: true, cancelable: true }));
        })()`);
        await until("window.app.editing().stage?.loaded()?.size.width === 1280");
        const nearness = `(async () => { await new Promise((done) => setTimeout(done, 300)); const flat = await window.app.editing().flatten(); return { psnr: (${psnr})(flat.data, window.clean), sum: flat.data.reduce((sum, value, index) => (index % 97 ? sum : sum + value), 0) }; })()`;
        const jpeg = await tab.run<{ psnr: number }>(nearness);
        // the instant repair, as Repair JPEG has always made it
        const rightClick = async (x: number, y: number) => tab.run(`(() => { const event = new MouseEvent('contextmenu', { bubbles: true, cancelable: true, button: 2, clientX: ${x}, clientY: ${y} }); document.elementFromPoint(${x}, ${y}).dispatchEvent(event); })()`);
        const line = (label: string) => tab.run(`[...document.querySelectorAll('.quire-img-press-menu:popover-open button')].find((each) => each.textContent.includes(${JSON.stringify(label)})).click()`);
        const middle = await page.middle(".quire-img-stage");
        await rightClick(middle.x, middle.y);
        await until("document.querySelector('.quire-img-press-menu:popover-open')");
        await line("Repair JPEG");
        await until("window.app.editing().steps().some((step) => step.type === 'repair')");
        await tab.wait(1500);
        const instant = await tab.run<{ psnr: number }>(nearness);
        // with a model: asked first, the instant way the first card, nothing fetched until told
        await rightClick(middle.x, middle.y);
        await until("document.querySelector('.quire-img-press-menu:popover-open')");
        await line("Repair JPEG with");
        await until("document.querySelector('.quire-restore-dialog .quire-img-read-card[data-tier=\"repair-best\"]')");
        expect(await tab.run<string[]>("[...document.querySelectorAll('.quire-restore-dialog .quire-img-read-card-name')].map((each) => each.textContent)")).toEqual(["instant", "better", "best"]);
        expect(await tab.run<string>("document.querySelector('.quire-restore-dialog .quire-img-read-card[aria-checked=\"true\"]').dataset.tier")).toBe("plain");
        expect(tab.requests.filter((each) => each.url.includes("huggingface"))).toEqual([]);
        await tab.run("document.querySelector('.quire-restore-dialog .quire-img-read-card[data-tier=\"repair-best\"]').click()");
        // kept already (put there above), so it says so and the button repairs with no download
        expect(await tab.run<string>("document.querySelector('.quire-restore-dialog .quire-img-read-card[data-tier=\"repair-best\"] .quire-img-read-card-size').textContent")).toBe("On this device");
        expect(await tab.run<string>("document.querySelector('.quire-restore-dialog .quire-dialog-action').textContent")).toBe("repair");
        const started = Date.now();
        await tab.run("document.querySelector('.quire-restore-dialog .quire-dialog-action').click()");
        await until("window.app.editing().steps().some((step) => step.type === 'repair' && step.model === 'repair-best' && step.made)", 120_000);
        const took = Date.now() - started;
        await until("window.app.editing().stage.loaded()");
        await tab.wait(1500);
        const best = await tab.run<{ psnr: number; sum: number }>(nearness);
        console.log(`a 1280 by 960 JPEG at quality 30 against the clean scene: as it came ${jpeg.psnr.toFixed(2)} dB, the instant repair ${instant.psnr.toFixed(2)} dB, Best ${best.psnr.toFixed(2)} dB (repaired in ${took} ms, the model kept before)`);
        expect(instant.psnr).toBeGreaterThan(jpeg.psnr);
        expect(best.psnr).toBeGreaterThan(instant.psnr + 1);
        // kept in the document: opened again it draws the same, with no request at all
        const asked = tab.requests.length;
        await tab.run("window.app.editing().reopen()");
        await until("window.app.editing().stage.loaded()");
        await tab.wait(1500);
        expect((await tab.run<{ sum: number }>(nearness)).sum).toBe(best.sum);
        expect(tab.requests.slice(asked).filter((each) => !each.url.startsWith("http://localhost:"))).toEqual([]);
        // Better, stopped with Escape part way: the steps stay as they were
        const before = JSON.stringify(await tab.run("window.app.editing().steps()"));
        await rightClick(middle.x, middle.y);
        await until("document.querySelector('.quire-img-press-menu:popover-open')");
        await line("Repair JPEG with");
        await until("document.querySelector('.quire-restore-dialog .quire-img-read-card[data-tier=\"repair-better\"]')");
        await tab.run("document.querySelector('.quire-restore-dialog .quire-img-read-card[data-tier=\"repair-better\"]').click()");
        await tab.run("document.querySelector('.quire-restore-dialog .quire-dialog-action').click()");
        await until("document.querySelector('.quire-img-doing:not(.away)')", 60_000);
        expect(await tab.run<string>("document.querySelector('.quire-img-doing-said').textContent")).toMatch(/^Repairing \d+%$/);
        await tab.run("document.querySelector('.quire-img-stage').focus()");
        await tab.press("Escape");
        await until("!document.querySelector('.quire-img-doing:not(.away)')", 30_000);
        expect(JSON.stringify(await tab.run("window.app.editing().steps()"))).toBe(before);
        // enlarging: a small scene, its way chosen under more, then 200% in resize
        await tab.run(`(async () => {
            window.clean = ${scene(640, 480)}.getContext("2d").getImageData(0, 0, 640, 480).data;
            const blob = await ${scene(320, 240)}.convertToBlob({ type: "image/png" });
            const data = new DataTransfer();
            data.items.add(new File([blob], "small.png", { type: "image/png" }));
            document.dispatchEvent(new ClipboardEvent("paste", { clipboardData: data, bubbles: true, cancelable: true }));
        })()`);
        await until("window.app.editing().stage?.loaded()?.size.width === 320");
        await tab.run("document.querySelector('.quire-img-bar [aria-label^=\"More\"]').click()");
        await until("document.querySelector('.quire-img-more-page.open')");
        expect(await tab.run<string>("document.querySelector('.quire-img-enlarge-way').textContent")).toBe("enlarge: filter");
        await tab.run("document.querySelector('.quire-img-enlarge-way').click()");
        await until("document.querySelector('.quire-restore-dialog .quire-img-read-card[data-tier=\"enlarge-small\"]')");
        expect(await tab.run<string[]>("[...document.querySelectorAll('.quire-restore-dialog .quire-img-read-card-name')].map((each) => each.textContent)")).toEqual(["filter", "sharp"]);
        await tab.run("document.querySelector('.quire-restore-dialog .quire-img-read-card[data-tier=\"enlarge-small\"]').click()");
        expect(await tab.run<string>("document.querySelector('.quire-restore-dialog .quire-dialog-action').textContent")).toBe("download and enlarge");
        await tab.run("document.querySelector('.quire-restore-dialog .quire-dialog-action').click()");
        await until("!document.querySelector('.quire-restore-dialog') && document.querySelector('.quire-img-enlarge-way').textContent === 'enlarge: sharp'", 60_000);
        await tab.run("document.querySelector('.quire-img-bar [aria-label=\"Resize\"]').click()");
        await until("document.querySelector('.quire-img-resize.open')");
        await tab.run("[...document.querySelectorAll('.quire-img-resize button')].find((each) => each.textContent === '200%').click()");
        await until("window.app.editing().steps().some((step) => step.type === 'resize' && step.width === 640 && step.model === 'enlarge-small')");
        const enlarged = await tab.run<{ psnr: number; width: number }>(`(async () => { const flat = await window.app.editing().flatten(); return { psnr: (${psnr})(flat.data, window.clean), width: flat.width }; })()`);
        // the filter's enlargement of the same, for comparison
        await tab.run("window.app.editing().changeStep(window.app.editing().steps().find((step) => step.type === 'resize').id, { model: undefined })");
        const filtered = await tab.run<{ psnr: number }>(`(async () => { const flat = await window.app.editing().flatten(); return { psnr: (${psnr})(flat.data, window.clean) }; })()`);
        console.log(`a 320 by 240 scene made 640 by 480, against the scene drawn at that size: the filter ${filtered.psnr.toFixed(2)} dB, Sharp ${enlarged.psnr.toFixed(2)} dB`);
        expect(enlarged.width).toBe(640);
        expect(enlarged.psnr).toBeGreaterThan(filtered.psnr + 1);
        const outside = tab.requests.filter((each) => !each.url.startsWith("http://localhost:"));
        expect(outside.map((each) => each.url.replace(/resolve\/[0-9a-f]{40}/, "resolve/C"))).toEqual(["https://huggingface.co/Xenova/swin2SR-lightweight-x2-64/resolve/C/onnx/model_fp16.onnx"]);
        for (const each of tab.requests) expect([each.url, each.method, each.body]).toEqual([each.url, "GET", false]);
    } finally {
        await page.close();
    }
}, 600_000);
