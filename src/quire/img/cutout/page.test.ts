// What the cut-out's page is held to: its right-click menu holds Paste and Choose a picture when empty,
// and Copy, Save, Paste, Keep and Remove with a cut-out; and in Chromium with the real Quick model
// (Hugging Face answered from the trial copies, ONNX Runtime from the site's build, the model in its
// own worker), a picture pasted is cut out once she has said to fetch the model (nothing is fetched
// before), at its full size, the figure kept and the ground gone; a drop, a file chosen and Paste from
// the right-click menu each bring a new picture and cut it with no dialog; Copy gives the clipboard the
// full-size PNG; Save gives a PNG named from the file; Keep paints the ground back in; a color or the
// blurred picture fills what was clear; and the only requests are the page's own, ONNX Runtime's and
// the model's one file, each a GET with no body.

import { expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { corePage, quire } from "../../../../scripts/core-page";
import { CUT_TIERS } from "../parts/models";
import { cutMenuLines, cutName } from "./page";
import { packageAt } from "../../../../scripts/lib";
import { readZip } from "../../core/zip";

const TRIALS = `${homedir()}/.cache/quire-model-trials/parts/`;
const ORT = `${packageAt("onnxruntime-web", "dist")}/`;

test("the right-click menu holds Paste and Choose a picture when empty, and Copy, Save, Paste, Keep and Remove with a cut-out", () => {
    const run = { copy() {}, save() {}, paste() {}, choose() {}, brush() {} };
    expect(cutMenuLines({ cut: false }, run).map((each) => each.label)).toEqual(["Paste", "Choose a picture"]);
    const lines = cutMenuLines({ cut: true, brush: "keep" }, run);
    expect(lines.map((each) => each.label || "-")).toEqual(["Copy", "Save", "Paste", "-", "Keep", "Remove"]);
    expect(lines.find((each) => each.label === "Keep")!.pressed).toBe(true);
    expect(cutName("Harbour at dusk.jpg")).toBe("Harbour-at-dusk-cut-out.png");
    expect(cutName(undefined)).toBe("picture-cut-out.png");
});

test("in Chromium, the four ways in each cut a picture out at full size, Copy, Save, Keep and the backgrounds work, and nothing is fetched but the model, only once told", async () => {
    const quick = CUT_TIERS.find((tier) => tier.id === "cut-quick")!;
    if (!(await Bun.file(`${TRIALS}${quick.files[0]!.repo}/${quick.files[0]!.path}`).exists())) return console.warn("cut-out page test skipped: the models are not in ~/.cache/quire-model-trials/parts/");
    const built = await Bun.build({ entrypoints: [`${import.meta.dir}/../parts/finder.ts`], target: "browser" });
    const worker = await built.outputs[0]!.text();
    const folder = await mkdtemp(join(tmpdir(), "quire-cut-page-"));
    const page = await corePage(
        `
        import { createCutoutPage } from "${quire}/img/cutout/page.ts";
        window.copied = [];
        navigator.clipboard.write = async (items) => { for (const item of items) { const blob = await item.getType("image/png"); const bitmap = await createImageBitmap(blob); window.copied.push({ width: bitmap.width, height: bitmap.height }); } };
        window.downloads = {};
        HTMLAnchorElement.prototype.click = function () { const name = this.download; if (name) fetch(this.href).then((answer) => answer.arrayBuffer()).then((buffer) => (window.downloads[name] = name.endsWith(".zip") ? [...new Uint8Array(buffer)] : buffer.byteLength)); };
        // a figure on green, at a size
        window.scene = async (width, height, name) => {
            const canvas = new OffscreenCanvas(width, height);
            const c = canvas.getContext("2d");
            c.scale(width / 1200, height / 800);
            c.fillStyle = "#3f9a3c"; c.fillRect(0, 0, 1200, 800);
            c.fillStyle = "#b8452e"; c.beginPath(); c.moveTo(450, 800); c.lineTo(500, 470); c.lineTo(700, 470); c.lineTo(750, 800); c.fill();
            c.fillStyle = "#e0b090"; c.beginPath(); c.arc(600, 360, 95, 0, 7); c.fill();
            return new File([await canvas.convertToBlob({ type: "image/png" })], name, { type: "image/png" });
        };
        window.clipboardPicture = undefined;
        navigator.clipboard.read = async () => [{ types: ["image/png"], getType: async () => window.clipboardPicture }];
        window.cutout = createCutoutPage(document.querySelector("#host"), { colors: [{ name: "White", value: "#ffffff" }, { name: "Violet", value: "#b48cff" }] });
        // what the cut-out shows: its size, and its alpha at the figure's head and on the ground, and a pixel's color
        window.seen = () => { const r = window.cutout.result(); if (!r) return undefined; const at = (x, y) => [...r.data.slice((Math.round(y * r.height / 800) * r.width + Math.round(x * r.width / 1200)) * 4, (Math.round(y * r.height / 800) * r.width + Math.round(x * r.width / 1200)) * 4 + 4)]; return { width: r.width, height: r.height, head: at(600, 360), ground: at(100, 100) }; };
    `,
        {
            args: ["--enable-unsafe-webgpu"],
            files: async (path) => {
                if (path === "/finder.ts") return new Response(worker, { headers: { "Content-Type": "text/javascript" } });
                if (path.startsWith("/ort/") && !path.includes("..")) {
                    const file = Bun.file(ORT + path.slice(5));
                    if (await file.exists()) return new Response(file, { headers: { "Content-Type": path.endsWith(".wasm") ? "application/wasm" : "text/javascript" } });
                }
                return undefined;
            },
        },
    );
    if (!page) return;
    const { tab } = page;
    const until = async (expression: string, ms = 60_000) => {
        const started = Date.now();
        while (Date.now() - started < ms) {
            if (await tab.run<boolean>(`!!(${expression})`)) return;
            await tab.wait(100);
        }
        throw new Error(`waited for ${expression}`);
    };
    const menuLines = () => tab.run<string[]>("[...document.querySelectorAll('.quire-menu:popover-open .quire-menu-items button')].map((each) => each.textContent.trim())");
    try {
        await tab.serve(["https://huggingface.co/"], async (url) => {
            const match = /^https:\/\/huggingface\.co\/([^/]+\/[^/]+)\/resolve\/[0-9a-f]{40}\/(.+)$/.exec(url);
            if (!match) return undefined;
            const file = Bun.file(`${TRIALS}${match[1]}/${decodeURIComponent(match[2]!)}`);
            return (await file.exists()) ? { body: new Uint8Array(await file.arrayBuffer()) } : undefined;
        });
        await tab.wait(300);
        expect(await tab.run<string>("document.querySelector('.quire-cut-line').textContent")).toContain("background comes off");
        // a right-click on the empty page: Paste and Choose a picture
        await tab.run("document.querySelector('.quire-cut-room').dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 600, clientY: 300 }))");
        await until("document.querySelector('.quire-menu:popover-open')");
        expect(await menuLines()).toEqual(["PasteCtrl+V", "Choose a picture"].map((each) => expect.stringContaining(each.replace("Ctrl+V", ""))) as unknown as string[]);
        await tab.press("Escape");
        // 1. a file chosen by a press on Choose a picture: the dialog first, nothing fetched until told
        const png = await tab.run<number[]>("window.scene(1200, 800, 'field.png').then(async (file) => [...new Uint8Array(await file.arrayBuffer())])");
        await Bun.write(`${folder}/field.png`, new Uint8Array(png));
        await tab.files([`${folder}/field.png`]);
        const chooseAt = await tab.run<{ x: number; y: number }>("(() => { const b = document.querySelector('.quire-cut-empty .quire-dialog-action').getBoundingClientRect(); return { x: b.x + b.width / 2, y: b.y + b.height / 2 }; })()");
        await tab.click(chooseAt.x, chooseAt.y);
        await until("document.querySelector('.quire-cut-dialog')");
        expect(await tab.run<string>("document.querySelector('.quire-cut-dialog').textContent")).toContain("the picture never leaves it");
        expect(tab.requests.filter((each) => each.url.includes("huggingface"))).toEqual([]);
        await tab.run("document.querySelector('.quire-cut-dialog .quire-dialog-action').click()");
        await until("document.querySelectorAll('.quire-cut-dialog .quire-img-read-card').length >= 2");
        await tab.run("document.querySelector('.quire-cut-dialog .quire-img-read-card[data-tier=\"cut-quick\"]').click()");
        expect(tab.requests.filter((each) => each.url.includes("huggingface"))).toEqual([]);
        await tab.run("document.querySelector('.quire-cut-download').click()");
        await until("window.seen()", 90_000);
        let seen = await tab.run<{ width: number; height: number; head: number[]; ground: number[] }>("window.seen()");
        expect([seen.width, seen.height]).toEqual([1200, 800]);
        expect(seen.head[3]).toBeGreaterThan(200);
        expect(seen.ground[3]).toBeLessThan(20);
        // the right-click menu on the cut-out
        await tab.run("document.querySelector('.quire-cut-view').dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 600, clientY: 300 }))");
        await until("document.querySelector('.quire-menu:popover-open')");
        expect((await menuLines()).map((each) => each.replace(/Ctrl\+.$/, ""))).toEqual(["Copy", "Save", "Paste", "Keep", "Remove"]);
        // Copy from the menu: the full-size PNG on the clipboard
        await tab.run("[...document.querySelectorAll('.quire-menu:popover-open .quire-menu-items button')].find((each) => each.textContent.startsWith('Copy')).click()");
        await until("window.copied.length === 1");
        expect(await tab.run("window.copied[0]")).toEqual({ width: 1200, height: 800 });
        // Save: a PNG named from the file
        await tab.run("document.querySelector('.quire-cut-bar .quire-dialog-dismiss').click()");
        await until("window.downloads['field-cut-out.png'] > 1000");
        // 2. a drop: cut with no dialog
        await tab.run("window.scene(1500, 1000, 'dropped.png').then((file) => { const data = new DataTransfer(); data.items.add(file); document.querySelector('.quire-cut-room').dispatchEvent(new DragEvent('drop', { dataTransfer: data, bubbles: true, cancelable: true })); })");
        await until("window.seen()?.width === 1500", 60_000);
        expect(await tab.run("!!document.querySelector('.quire-cut-dialog[open]')")).toBe(false);
        // 3. Ctrl+V: a pasted picture, cut with no dialog
        await tab.run("window.scene(900, 600, 'image.png').then((file) => { const data = new DataTransfer(); data.items.add(file); document.dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true })); })");
        await until("window.seen()?.width === 900", 60_000);
        // 4. Paste from the right-click menu: the clipboard read through the browser
        await tab.run("window.scene(1000, 700, 'clip.png').then((file) => (window.clipboardPicture = file))");
        await tab.run("document.querySelector('.quire-cut-view').dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 600, clientY: 300 }))");
        await until("document.querySelector('.quire-menu:popover-open')");
        await tab.run("[...document.querySelectorAll('.quire-menu:popover-open .quire-menu-items button')].find((each) => each.textContent.startsWith('Paste')).click()");
        await until("window.seen()?.width === 1000", 60_000);
        // Keep painted on the ground brings it back
        await tab.run("[...document.querySelectorAll('.quire-cut-bar button')].find((each) => each.textContent === 'Keep').click()");
        const box = await tab.run<{ x: number; y: number; width: number; height: number }>("(() => { const b = document.querySelector('.quire-cut-canvas').getBoundingClientRect(); return { x: b.x, y: b.y, width: b.width, height: b.height }; })()");
        await tab.drag({ x: box.x + box.width * 0.07, y: box.y + box.height * 0.12 }, { x: box.x + box.width * 0.1, y: box.y + box.height * 0.13 }, 6);
        await until("window.cutout.cut()?.strokes?.length === 1");
        await until("window.seen()?.ground[3] > 200");
        // a color behind it, then the old picture blurred: nothing clear is left
        await tab.run("[...document.querySelectorAll('.quire-cut-bar button')].find((each) => each.textContent === 'Color').click()");
        await until("window.seen() && window.seen().head[3] === 255 && window.cutout.cut().background === 'color'");
        seen = await tab.run("window.seen()");
        await tab.run("[...document.querySelectorAll('.quire-cut-bar button')].find((each) => each.textContent === 'Blur').click()");
        await until("window.cutout.cut()?.background === 'blur'");
        await tab.run("[...document.querySelectorAll('.quire-cut-bar button')].find((each) => each.textContent === 'Clear').click()");
        // many pictures at once: a strip of small pictures, each cut out in turn, and all saved as one zip under their own names
        await tab.run("Promise.all([window.scene(800, 600, 'walk.png'), window.scene(600, 800, 'walk.jpg'), window.scene(700, 500, 'shore.png')]).then((files) => { const data = new DataTransfer(); for (const file of files) data.items.add(file); document.dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true })); })");
        await until("window.cutout.many().count === 3 && window.cutout.many().cut === 3", 120_000);
        expect(await tab.run("document.querySelectorAll('.quire-img-thumb').length")).toBe(3);
        expect(await tab.run("document.querySelector('.quire-img-thumb.current').getAttribute('aria-label')")).toBe("1 of 3, walk.png");
        await tab.press("PageDown");
        await until("window.cutout.many().at === 1 && window.seen()?.width === 600");
        await tab.run("window.showSaveFilePicker = undefined");
        await tab.run("[...document.querySelectorAll('.quire-cut-group-all button')].find((each) => each.textContent.includes('zip')).click()");
        await until("window.downloads['cut-outs.zip']", 60_000);
        const zip = await readZip(new Uint8Array(await tab.run<number[]>("window.downloads['cut-outs.zip']")));
        expect([...zip.keys()]).toEqual(["walk.png", "walk (1).png", "shore.png"]);
        // each at its own full size, as a PNG (its width and height read from its header)
        const size = (bytes: Uint8Array) => [new DataView(bytes.buffer, bytes.byteOffset).getUint32(16), new DataView(bytes.buffer, bytes.byteOffset).getUint32(20)];
        expect([...zip.values()].map(size)).toEqual([
            [800, 600],
            [600, 800],
            [700, 500],
        ]);
        // the only requests: the page's own, ONNX Runtime's and the model's one file, each a GET with no body
        const outside = tab.requests.filter((each) => !each.url.startsWith("http://localhost:"));
        expect(outside.map((each) => each.url.replace(/resolve\/[0-9a-f]{40}/, "resolve/C"))).toEqual(["https://huggingface.co/Xenova/modnet/resolve/C/onnx/model_fp16.onnx"]);
        for (const each of tab.requests) expect([each.url, each.method, each.body]).toEqual([each.url, "GET", false]);
    } finally {
        await page.close();
        await rm(folder, { recursive: true, force: true });
    }
}, 300_000);
