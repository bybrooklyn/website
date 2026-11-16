// What the cut-out is held to as imgQuire's tool, in Chromium with the real Quick model (Hugging Face
// answered from the trial copies, the model in the part models' worker): K asks first and fetches
// nothing until told; then the picture is cut out as a step, the export clear where the ground was and
// whole on the figure, at full size; a JPEG says plainly it has no transparency and offers a color or
// PNG; laid on a color nothing is clear; Keep paints the ground back; the document opened again draws
// the same pixels with no request at all; in a batch, Give to all cuts each other picture out in turn, laid
// on the same color, as one undo step; Take away brings the background back; and the only requests
// are the page's own, ONNX Runtime's and the model's one file.

import { expect, test } from "bun:test";
import { homedir } from "node:os";
import { imgPage } from "../../../../scripts/img-page";
import { CUT_TIERS } from "../parts/models";
import { packageAt } from "../../../../scripts/lib";

const TRIALS = `${homedir()}/.cache/quire-model-trials/parts/`;
const ORT = `${packageAt("onnxruntime-web", "dist")}/`;

test("in imgQuire, Cut out is asked first, makes a step that exports with transparency at full size, offers a color or PNG for a JPEG, and draws the same reopened with no request", async () => {
    const quick = CUT_TIERS.find((tier) => tier.id === "cut-quick")!;
    if (!(await Bun.file(`${TRIALS}${quick.files[0]!.repo}/${quick.files[0]!.path}`).exists())) return console.warn("cut-out tool test skipped: the models are not in ~/.cache/quire-model-trials/parts/");
    const built = await Bun.build({ entrypoints: [`${import.meta.dir}/../parts/finder.ts`], target: "browser" });
    const worker = await built.outputs[0]!.text();
    const page = await imgPage("img-cutout", { width: 1300, height: 820 }, async (path) => {
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
            if (!match) return undefined;
            const file = Bun.file(`${TRIALS}${match[1]}/${decodeURIComponent(match[2]!)}`);
            return (await file.exists()) ? { body: new Uint8Array(await file.arrayBuffer()) } : undefined;
        });
        await tab.run(`(async () => {
            const canvas = new OffscreenCanvas(1200, 800);
            const c = canvas.getContext("2d");
            c.fillStyle = "#3f9a3c"; c.fillRect(0, 0, 1200, 800);
            c.fillStyle = "#b8452e"; c.beginPath(); c.moveTo(450, 800); c.lineTo(500, 470); c.lineTo(700, 470); c.lineTo(750, 800); c.fill();
            c.fillStyle = "#e0b090"; c.beginPath(); c.arc(600, 360, 95, 0, 7); c.fill();
            const blob = await canvas.convertToBlob({ type: "image/png" });
            const data = new DataTransfer();
            data.items.add(new File([blob], "figure.png", { type: "image/png" }));
            document.dispatchEvent(new ClipboardEvent("paste", { clipboardData: data, bubbles: true, cancelable: true }));
        })()`);
        await until("window.app.editing().stage?.loaded()?.size.width === 1200");
        await tab.run("document.querySelector('.quire-img-stage').focus()");
        await tab.press("Escape");
        await tab.press("k");
        await until("document.querySelector('.quire-cut-dialog')");
        expect(tab.requests.filter((each) => each.url.includes("huggingface"))).toEqual([]);
        await tab.run("document.querySelector('.quire-cut-dialog .quire-dialog-action').click()");
        await until("document.querySelector('.quire-cut-dialog .quire-img-read-card[data-tier=\"cut-quick\"]')");
        await tab.run("document.querySelector('.quire-cut-dialog .quire-img-read-card[data-tier=\"cut-quick\"]').click()");
        await tab.run("document.querySelector('.quire-cut-download').click()");
        await until("window.app.editing().steps().some((step) => step.type === 'cutout')", 90_000);
        // the export: clear where the ground was, whole on the figure, at full size
        const alpha = `(async () => { await new Promise((done) => setTimeout(done, 300)); const flat = await window.app.editing().flatten(); const at = (x, y) => flat.data[(y * flat.width + x) * 4 + 3]; return { width: flat.width, ground: at(100, 100), head: at(600, 360), sum: flat.data.reduce((sum, value, index) => (index % 97 ? sum : sum + value), 0) }; })()`;
        await until("window.app.editing().stage.loaded()");
        await tab.wait(800);
        const cut = await tab.run<{ width: number; ground: number; head: number; sum: number }>(alpha);
        expect(cut.width).toBe(1200);
        expect(cut.ground).toBeLessThan(20);
        expect(cut.head).toBeGreaterThan(200);
        // JPEG: said plainly, with a color or PNG offered
        await tab.run("document.querySelector('.quire-img-bar [aria-label=\"Export (E)\"]').click()");
        await until("document.querySelector('.quire-img-export.open')");
        await tab.run("document.querySelector('.quire-img-formats [aria-label^=\"JPEG:\"]').click()");
        await until("!document.querySelector('.quire-img-note').classList.contains('away')");
        expect(await tab.run<string>("document.querySelector('.quire-img-note').textContent")).toContain("JPEG has no transparency");
        await tab.run("document.querySelector('.quire-img-note [aria-label=\"Use PNG\"]').click()");
        await until("document.querySelector('.quire-img-note').classList.contains('away')");
        // the document opened again draws the same, with no request at all
        const asked = tab.requests.length;
        await tab.run("window.app.editing().reopen()");
        await until("window.app.editing().stage.loaded()");
        await tab.wait(1500);
        expect((await tab.run<{ sum: number }>(alpha)).sum).toBe(cut.sum);
        expect(tab.requests.slice(asked).filter((each) => !each.url.startsWith("http://localhost:"))).toEqual([]);
        // Keep painted over the ground brings it back
        await tab.run("document.querySelector('.quire-img-stage').focus()");
        await tab.press("k");
        await until("[...document.querySelectorAll('.quire-img-strip-words')].some((each) => each.textContent === 'Keep')");
        await tab.run("[...document.querySelectorAll('.quire-img-strip-words')].find((each) => each.textContent === 'Keep').click()");
        await tab.drag(await page.onScreen(80, 90), await page.onScreen(130, 110), 6);
        await until("window.app.editing().steps().find((step) => step.type === 'cutout').strokes?.length === 1");
        await until(`(async () => (await window.app.editing().flatten()).data[(100 * 1200 + 100) * 4 + 3] > 200)()`);
        // laid on a color: nothing is clear
        await tab.run("document.querySelector('.quire-img-strip [aria-label=\"Red\"]').click()");
        await until("window.app.editing().steps().find((step) => step.type === 'cutout').background === 'color'");
        // in a batch, the cut-out given to the others: each cut out in turn, laid on the same color, as one undo step
        await tab.run(`(async () => {
            const make = async (name, hue) => {
                const canvas = new OffscreenCanvas(900, 600);
                const c = canvas.getContext("2d");
                c.fillStyle = "hsl(" + hue + " 50% 40%)"; c.fillRect(0, 0, 900, 600);
                c.fillStyle = "#b8452e"; c.beginPath(); c.moveTo(340, 600); c.lineTo(375, 350); c.lineTo(525, 350); c.lineTo(560, 600); c.fill();
                c.fillStyle = "#e0b090"; c.beginPath(); c.arc(450, 270, 70, 0, 7); c.fill();
                return new File([await canvas.convertToBlob({ type: "image/png" })], name, { type: "image/png" });
            };
            await window.app.editing().addPictures([await make("second.png", 120), await make("third.png", 200)]);
        })()`);
        await until("window.app.editing().batch().count === 3");
        expect(await tab.run<string>("[...document.querySelectorAll('.quire-img-strip-words')].find((each) => each.textContent.startsWith('Give to the other'))?.title")).toBe("Cut out the other 2 pictures the same way, one after another");
        await tab.run("window.app.editing().giveAll(['cutout'])");
        const laid = () => tab.run<(string | null)[]>("(async () => { const editor = window.app.editing(); const out = []; for (let at = 1; at < 3; at++) { await editor.stepTo(at); const step = editor.steps().find((each) => each.type === 'cutout'); out.push(step ? step.background + ' ' + step.color : null); } await editor.stepTo(0); return out; })()");
        expect(await laid()).toEqual(["color #ff3b30", "color #ff3b30"]);
        // the second picture, cut out by the model on its own: its ground clear of the figure's color, laid on red
        await tab.run("window.app.editing().stepTo(1)");
        await until("window.app.editing().stage.loaded()?.size.width === 900");
        // (the cut-out's pixels take the original's place on the stage a moment after it is shown)
        await until("window.app.editing().flatten().then((flat) => flat.data[(60 * 900 + 60) * 4] > 200 && flat.data[(60 * 900 + 60) * 4 + 1] < 120)", 30_000);
        await tab.run("window.app.editing().stepTo(0)");
        await until("window.app.editing().stage.loaded()?.size.width === 1200");
        await tab.run("window.app.editing().undo()");
        expect(await laid()).toEqual([null, null]);
        expect(await tab.run("window.app.editing().steps().some((step) => step.type === 'cutout')")).toBe(true);
        // (stepping put the crop's frame back in hand, as on any picture stepped to)
        await tab.run("document.querySelector('.quire-img-stage').focus()");
        await tab.press("k");
        await until("[...document.querySelectorAll('.quire-img-strip-words')].some((each) => each.textContent === 'Take away')");
        // Take away: the background back
        await tab.run("[...document.querySelectorAll('.quire-img-strip-words')].find((each) => each.textContent === 'Take away').click()");
        await until("!window.app.editing().steps().some((step) => step.type === 'cutout')");
        const outside = tab.requests.filter((each) => !each.url.startsWith("http://localhost:"));
        expect(outside.map((each) => each.url.replace(/resolve\/[0-9a-f]{40}/, "resolve/C"))).toEqual(["https://huggingface.co/Xenova/modnet/resolve/C/onnx/model_fp16.onnx"]);
        for (const each of tab.requests) expect([each.url, each.method, each.body]).toEqual([each.url, "GET", false]);
    } finally {
        await page.close();
    }
}, 300_000);
