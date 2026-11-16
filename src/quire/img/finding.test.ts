// What finding a part with a model is held to, in Chromium with the real small models (Hugging Face
// answered from the trial copies, ONNX Runtime from the site's build, the finder in its own worker):
// Find asks first and fetches nothing until told; the two choices are offered as cards; once fetched,
// a press on a figure makes a found part, picked, an Alt-press changes that same part as one more
// change, Subject and Background make parts of their own (the second inside out); the document opened
// again draws the same pixels without the model; and the only requests are the page's own files,
// ONNX Runtime's and the three model files, each a GET with no body.

import { expect, test } from "bun:test";
import { homedir } from "node:os";
import { imgPage } from "../../../scripts/img-page";
import { PART_TIERS } from "./parts/models";
import { packageAt } from "../../../scripts/lib";

const TRIALS = `${homedir()}/.cache/quire-model-trials/parts/`;
const ORT = `${packageAt("onnxruntime-web", "dist")}/`;
const REPOS = new Set(PART_TIERS.flatMap((tier) => tier.files.map((each) => each.repo)));

test("Find asks first, fetches only when told, and presses, Alt-presses, Subject and Background make found parts that draw the same reopened; the only requests are the model's and the runtime's", async () => {
    if (!(await Bun.file(`${TRIALS}Xenova/slimsam-77-uniform/onnx/vision_encoder_quantized.onnx`).exists())) return console.warn("finding test skipped: the part models are not in ~/.cache/quire-model-trials/parts/");
    const built = await Bun.build({ entrypoints: [`${import.meta.dir}/parts/finder.ts`], target: "browser" });
    if (!built.success) throw new Error(built.logs.join("\n"));
    const worker = await built.outputs[0]!.text();
    const page = await imgPage("img-finding", { width: 1300, height: 820 }, async (path) => {
        if (path === "/finder.ts") return new Response(worker, { headers: { "Content-Type": "text/javascript" } });
        if (path.startsWith("/ort/") && !path.includes("..")) {
            const file = Bun.file(ORT + path.slice(5));
            if (await file.exists()) return new Response(file, { headers: { "Content-Type": path.endsWith(".wasm") ? "application/wasm" : "text/javascript" } });
        }
        return undefined;
    });
    if (!page) return;
    const { tab, until } = page;
    try {
        await tab.serve(["https://huggingface.co/"], async (url) => {
            const match = /^https:\/\/huggingface\.co\/([^/]+\/[^/]+)\/resolve\/[0-9a-f]{40}\/(.+)$/.exec(url);
            if (!match || !REPOS.has(match[1]!)) return undefined;
            const file = Bun.file(`${TRIALS}${match[1]}/${decodeURIComponent(match[2]!)}`);
            return (await file.exists()) ? { body: new Uint8Array(await file.arrayBuffer()) } : undefined;
        });
        // a scene: a sky, a ground, a figure in a red coat
        await tab.run(`(async () => {
            const canvas = new OffscreenCanvas(1200, 800);
            const c = canvas.getContext("2d");
            c.fillStyle = "#8fb3d9"; c.fillRect(0, 0, 1200, 460);
            c.fillStyle = "#5d6b35"; c.fillRect(0, 460, 1200, 340);
            c.fillStyle = "#b8452e"; c.fillRect(520, 300, 160, 280);
            c.fillStyle = "#e0b090"; c.beginPath(); c.arc(600, 250, 50, 0, 7); c.fill();
            c.fillStyle = "#2b2b3a"; c.fillRect(535, 580, 55, 180); c.fillRect(610, 580, 55, 180);
            const blob = await canvas.convertToBlob({ type: "image/png" });
            const data = new DataTransfer();
            data.items.add(new File([blob], "field.png", { type: "image/png" }));
            document.dispatchEvent(new ClipboardEvent("paste", { clipboardData: data, bubbles: true, cancelable: true }));
        })()`);
        await until("window.app.editing().stage?.loaded()?.size.width === 1200");
        await tab.run("document.querySelector('.quire-img-stage').focus()");
        await tab.press("g");
        await until("document.querySelector('.quire-img-grade-panel.open')");
        await tab.wait(800);
        await tab.run("document.querySelector('.quire-img-make-find').click()");
        await until("document.querySelector('.quire-img-find-dialog')");
        expect(await tab.run<string>("document.querySelector('.quire-img-find-dialog').textContent")).toContain("the picture never leaves it");
        expect(tab.requests.filter((each) => each.url.includes("huggingface"))).toEqual([]);
        await tab.run("document.querySelector('.quire-img-find-dialog .quire-dialog-action').click()");
        await until("document.querySelectorAll('.quire-img-find-dialog .quire-img-read-card').length === 2");
        expect(await tab.run<string[]>("[...document.querySelectorAll('.quire-img-find-dialog .quire-img-read-card')].map((card) => card.textContent)")).toEqual(["small27 MBQuick, on any machine", "better96 MBCleaner edges, on a fast machine"]);
        expect(tab.requests.filter((each) => each.url.includes("huggingface"))).toEqual([]);
        await tab.run("document.querySelector('.quire-img-find-download').click()");
        await until("/Press a thing/.test(document.querySelector('.quire-img-strip-said')?.textContent ?? '')", 60_000);
        expect(await tab.run<string>("localStorage.getItem('quire-img-parts')")).toBe("small");
        // a press on the coat: a found part, picked
        const coat = await page.onScreen(600, 420);
        await tab.click(coat.x, coat.y);
        await until("window.app.editing().steps().some((step) => step.kind === 'found')", 60_000);
        expect(await tab.run<string>("document.querySelector('.quire-img-grade-target').textContent")).toBe("found 1");
        const first = await tab.run<string>("JSON.stringify(window.app.editing().steps().find((step) => step.kind === 'found').found)");
        // an Alt-press on the head: the same part, changed
        await until("/Press a thing/.test(document.querySelector('.quire-img-strip-said')?.textContent ?? '')");
        const head = await page.onScreen(600, 250);
        await tab.click(head.x, head.y, { alt: true });
        await until(`JSON.stringify(window.app.editing().steps().find((step) => step.kind === 'found').found) !== ${JSON.stringify(first)}`, 30_000);
        expect(await tab.run<number>("window.app.editing().steps().filter((step) => step.kind === 'found').length")).toBe(1);
        // Subject, then Background: parts of their own, the second inside out
        await until("/Press a thing/.test(document.querySelector('.quire-img-strip-said')?.textContent ?? '')");
        await tab.run("[...document.querySelectorAll('.quire-img-strip-words')].find((each) => each.textContent === 'subject').click()");
        await until("window.app.editing().steps().filter((step) => step.kind === 'found').length === 2", 60_000);
        await until("/Press a thing/.test(document.querySelector('.quire-img-strip-said')?.textContent ?? '')");
        await tab.run("[...document.querySelectorAll('.quire-img-strip-words')].find((each) => each.textContent === 'background').click()");
        await until("window.app.editing().steps().filter((step) => step.kind === 'found').length === 3", 60_000);
        expect(await tab.run<boolean>("window.app.editing().steps().filter((step) => step.kind === 'found')[2].invert")).toBe(true);
        // graded and opened again from its steps: the same pixels, with no model asked
        await tab.run("(() => { const field = document.querySelector('.quire-img-slider[data-key=\"color\"] .quire-img-slider-number'); field.value = '-100'; field.dispatchEvent(new Event('change')); })()");
        const sum = "(async () => { const flat = await window.app.editing().flatten(); let sum = 0; for (let at = 0; at < flat.data.length; at += 97) sum += flat.data[at]; return sum; })()";
        const before = await tab.run<number>(sum);
        const asked = tab.requests.length;
        await tab.run("window.app.editing().reopen()");
        await until("window.app.editing().stage.loaded()");
        expect(await tab.run<number>(sum)).toBe(before);
        expect(tab.requests.slice(asked).filter((each) => !each.url.startsWith("http://localhost:"))).toEqual([]);
        // the only requests: the page's own, ONNX Runtime's and the three model files, each a GET with no body
        const outside = tab.requests.filter((each) => !each.url.startsWith("http://localhost:"));
        expect(outside.map((each) => each.url.replace(/resolve\/[0-9a-f]{40}/, "resolve/C")).sort()).toEqual([
            "https://huggingface.co/Xenova/modnet/resolve/C/onnx/model_fp16.onnx",
            "https://huggingface.co/Xenova/slimsam-77-uniform/resolve/C/onnx/prompt_encoder_mask_decoder_quantized.onnx",
            "https://huggingface.co/Xenova/slimsam-77-uniform/resolve/C/onnx/vision_encoder_quantized.onnx",
        ]);
        for (const each of tab.requests) expect([each.url, each.method, each.body]).toEqual([each.url, "GET", false]);
    } finally {
        await page.close();
    }
}, 300_000);
