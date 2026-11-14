// Reading text in the editor, in Chromium, with the real tiny model (from the trial copies on this
// machine, answered in place of Hugging Face so that nothing is fetched from the network) on the
// site's ONNX Runtime, in the reader's own worker. Held true:
//
// - nothing is fetched until text is asked for; then a dialog grown from the button says what will
//   be fetched, from where and how big, as three cards, and fetches only when told;
// - the only requests are the page's own files, ONNX Runtime's and the model's, each a GET with no
//   body: nothing of the picture is sent anywhere;
// - the reading is shown quietly in the tool's strip, and what looks private is offered there;
// - pressing a word makes a cover exactly over its box and the stated margin, in the color round it;
//   pressing it again picks that cover; a drag across words makes one cover over the run; Hide all
//   covers everything that looks private as one step, and undo takes it back;
// - with no tool, a drag across words selects them and Ctrl+C copies them as text, not the picture;
// - the size chosen is remembered, and the model is kept: the next picture is read with no dialog;
// - something that looks private of several words (a phone number) is hidden by one cover, edge to
//   edge, whether by Hide all or by pressing any one of its words; and a word that is not part of one
//   is hidden alone.
//
// Skipped, with a notice, without a Chromium or without the models in ~/.cache/quire-model-trials/ocr/.

import { expect, test } from "bun:test";
import { homedir } from "node:os";
import { imgPage, type ImgPage } from "../../../scripts/img-page";
import { coverFor } from "./read/words";

const TRIALS = `${homedir()}/.cache/quire-model-trials/ocr`;
const ORT = `${import.meta.dir}/../../../node_modules/onnxruntime-web/dist/`;

/** The editor's page, served with the reader's worker and ONNX Runtime, and Hugging Face answered from the trial copies. */
async function readingPage(database: string, size = { width: 1300, height: 820 }): Promise<ImgPage | undefined> {
    if (!(await Bun.file(`${TRIALS}/PP-OCRv6_tiny_det_onnx/inference.onnx`).exists())) return void console.warn("reading test skipped: the text models are not in ~/.cache/quire-model-trials/ocr/");
    const built = await Bun.build({ entrypoints: [`${import.meta.dir}/read/engine.ts`], target: "browser" });
    if (!built.success) throw new Error(built.logs.join("\n"));
    const worker = await built.outputs[0]!.text();
    const page = await imgPage(database, size, async (path) => {
        if (path === "/engine.ts") return new Response(worker, { headers: { "Content-Type": "text/javascript" } });
        if (path.startsWith("/ort/") && !path.includes("..")) {
            const file = Bun.file(ORT + path.slice(5));
            if (await file.exists()) return new Response(file, { headers: { "Content-Type": path.endsWith(".wasm") ? "application/wasm" : "text/javascript" } });
        }
        return undefined;
    });
    if (!page) return void console.warn("reading test skipped: no Chromium");
    await page.tab.serve(["https://huggingface.co/"], async (url) => {
        const match = /^https:\/\/huggingface\.co\/PaddlePaddle\/([^/]+)\/resolve\/[0-9a-f]{40}\/(.+)$/.exec(url);
        const file = match && Bun.file(`${TRIALS}/${match[1]}/${decodeURIComponent(match[2]!)}`);
        return file && (await file.exists()) ? { body: new Uint8Array(await file.arrayBuffer()) } : undefined;
    });
    // the clipboard's text is watched, as its pictures are
    await page.tab.run("window.copiedText = []; navigator.clipboard.writeText = async (text) => void window.copiedText.push(text);");
    return page;
}

/** The words the stage holds, with their covers. */
const wordsOf = (page: ImgPage) => page.tab.run<{ text: string; cover: { x: number; y: number; width: number; height: number }; line: number }[]>("window.app.editing().stage.words().map(({ text, cover, line }) => ({ text, cover, line }))");
const covers = (page: ImgPage) => page.tab.run<{ id: string; rect: { x: number; y: number; width: number; height: number }; color: string }[]>("window.app.editing().steps().filter((step) => step.type === 'cover')");

test("reading text: asked first, fetched only when told, shown on the picture, a word pressed is covered exactly, a run dragged is one cover, Hide all is one step, and text is copied", async () => {
    const page = await readingPage("img-read-flow");
    if (!page) return;
    const { tab, until } = page;
    try {
        await page.paste("screenshot");
        await tab.press("w");
        await until("document.querySelector('.quire-img-read-dialog')");
        const said = await tab.run<string>("document.querySelector('.quire-img-read-dialog').textContent");
        expect(said).toContain("downloaded once from Hugging Face");
        expect(said).toContain("the picture never leaves it");
        expect(tab.requests.filter((each) => each.url.includes("huggingface"))).toEqual([]);
        await tab.run("document.querySelector('.quire-img-read-dialog .quire-dialog-action').click()");
        await until("document.querySelectorAll('.quire-img-read-card').length === 3");
        expect(await tab.run<string[]>("[...document.querySelectorAll('.quire-img-read-card')].map((card) => card.textContent)")).toEqual(["Tiny6 MBClear screenshots, on any machine", "Small38 MBPhotographs and turned lines", "Large152 MBHard pictures, on a fast machine"]);
        expect(await tab.run<string>("document.querySelector('.quire-img-read-card[aria-checked=true]').dataset.tier")).toBe("tiny");
        expect(await tab.run<string>("document.querySelector('.quire-img-read-where').textContent")).toBe("From huggingface.co: PaddlePaddle's PP-OCRv6, Apache-2.0.");
        expect(tab.requests.filter((each) => each.url.includes("huggingface"))).toEqual([]);
        const started = Date.now();
        await tab.run("document.querySelector('.quire-img-read-download').click()");
        await until("/look private/.test(document.querySelector('.quire-img-strip-said')?.textContent ?? '')", 90_000);
        console.log(`fetched the tiny model and read the screenshot in ${Date.now() - started} ms; the strip says "${await tab.run<string>("document.querySelector('.quire-img-strip-said').textContent")}"`);
        expect(await tab.run<boolean>("!document.querySelector('.quire-img-read-dialog')")).toBe(true);

        // the only requests: the page's own, ONNX Runtime's and the model's, each a GET with no body
        const outside = tab.requests.filter((each) => !each.url.startsWith(`http://localhost:`));
        expect(outside.length).toBe(3);
        for (const each of outside) expect(each.url).toMatch(/^https:\/\/huggingface\.co\/PaddlePaddle\/PP-OCRv6_tiny_(det|rec)_onnx\/resolve\/[0-9a-f]{40}\/inference\.(onnx|yml)$/);
        for (const each of tab.requests) expect([each.url, each.method, each.body]).toEqual([each.url, "GET", false]);
        expect(tab.requests.some((each) => each.url.endsWith("/ort/ort-wasm-simd-threaded.wasm") || each.url.endsWith("/ort/ort-wasm-simd-threaded.jsep.wasm"))).toBe(true);

        const words = await wordsOf(page);
        expect(words.map((word) => word.text)).toEqual(["Account", "settings", "Email:", "someone@example.com", "Token:", "ghp_9f8a7c6b5d4e3f2a1b0c"]);
        expect(await tab.run<string>("document.querySelector('.quire-img-strip-said').textContent")).toBe("6 words, 2 look private");
        expect(await tab.run<string>("localStorage.getItem('quire-img-read')")).toBe("tiny");

        // a word pressed: a cover exactly over its box and margin, in the page's color round it
        const email = words.find((word) => word.text === "someone@example.com")!;
        const middle = await page.onScreen(email.cover.x + email.cover.width / 2, email.cover.y + email.cover.height / 2);
        await tab.click(middle.x, middle.y);
        await until("window.app.editing().steps().length === 1");
        const [cover] = await covers(page);
        expect(cover!.rect).toEqual(email.cover);
        expect(cover!.color).toBe("#f4f4f6");
        // and the cover is what a word's box gives, as coverFor says
        const box = await tab.run<{ at: { x: number; y: number }; along: { x: number; y: number }; length: number; height: number }>("window.app.editing().stage.words()[3].box");
        const line = await tab.run<number>("window.app.editing().reading.found().lines[1].box.height");
        expect(coverFor({ box }, line)).toEqual(email.cover);
        // pressed again, it is the cover that is picked, and nothing more is made
        await tab.click(middle.x, middle.y);
        await tab.wait(100);
        expect(await tab.run<string>("window.app.editing().stage.picked()")).toBe(cover!.id);
        expect(await tab.run<number>("window.app.editing().steps().length")).toBe(1);
        await tab.press("Escape");

        // a drag across the first line's two words: one cover over the run
        const [account, settings] = words;
        const from = await page.onScreen(account!.cover.x + 4, account!.cover.y + account!.cover.height / 2);
        const to = await page.onScreen(settings!.cover.x + settings!.cover.width - 4, settings!.cover.y + settings!.cover.height / 2);
        await tab.drag(from, to, 8);
        await until("window.app.editing().steps().length === 2");
        const run = (await covers(page))[1]!.rect;
        expect(run.x).toBe(account!.cover.x);
        expect(run.x + run.width).toBe(settings!.cover.x + settings!.cover.width);
        expect(run.y).toBe(Math.min(account!.cover.y, settings!.cover.y));

        // Hide all covers what is left that looks private, as one step
        expect(await tab.run<string>("document.querySelector('.quire-img-strip-said').textContent")).toBe("6 words, 1 looks private");
        await tab.run("[...document.querySelectorAll('.quire-img-strip-words')].find((button) => button.textContent === 'Hide all').click()");
        await until("window.app.editing().steps().length === 3");
        expect(await tab.run<string>("document.querySelector('.quire-img-strip-said').textContent")).toBe("6 words");
        await tab.press("z", { ctrl: true });
        await until("window.app.editing().steps().length === 2");
        await tab.press("z", { ctrl: true });
        await tab.press("z", { ctrl: true });
        await until("window.app.editing().steps().length === 0");

        // with no tool, a drag across words selects them, and Ctrl+C copies them as text and not the picture
        await tab.press("w");
        await until("window.app.editing().stage.tool() === 'none'");
        const token = words[5]!;
        await tab.drag(await page.onScreen(words[2]!.cover.x + 3, words[2]!.cover.y + 6), await page.onScreen(token.cover.x + token.cover.width - 3, token.cover.y + 6), 8);
        expect(await tab.run<string>("window.app.editing().stage.selected()")).toBe("Email: someone@example.com\nToken: ghp_9f8a7c6b5d4e3f2a1b0c");
        const pictures = await tab.run<number>("window.copied.length");
        await tab.press("c", { ctrl: true });
        await until("window.copiedText.length === 1");
        expect(await tab.run<string>("window.copiedText[0]")).toBe("Email: someone@example.com\nToken: ghp_9f8a7c6b5d4e3f2a1b0c");
        expect(await tab.run<number>("window.copied.length")).toBe(pictures);
        await tab.press("Escape");
        expect(await tab.run<string>("window.app.editing().stage.selected()")).toBe("");

        // the next picture is read with no dialog: the model is kept and the size remembered
        await page.paste("screenshot");
        await tab.press("w");
        await until("/look private/.test(document.querySelector('.quire-img-strip-said')?.textContent ?? '')", 60_000);
        expect(await tab.run<boolean>("!document.querySelector('.quire-img-read-dialog')")).toBe(true);
        expect(tab.requests.filter((each) => each.url.includes("huggingface")).length).toBe(3);
        expect(tab.errors.filter((error) => !/onnxruntime|W:onnx/.test(error))).toEqual([]);
    } finally {
        await page.close();
    }
}, 240_000);

test("a phone number is hidden by one cover edge to edge, by Hide all or by pressing any of its words; and a word apart is hidden alone", async () => {
    const page = await readingPage("img-read-phone");
    if (!page) return;
    const { tab, until } = page;
    try {
        await tab.run(`(async () => {
            const canvas = new OffscreenCanvas(1200, 500);
            const c = canvas.getContext("2d");
            c.fillStyle = "#f4f4f6"; c.fillRect(0, 0, 1200, 500); c.fillStyle = "#1d1d1f"; c.font = "26px sans-serif";
            c.fillText("Phone: +1 415 555 0132", 80, 140); c.fillText("Signed in as Jordan Example", 80, 260);
            const blob = await canvas.convertToBlob({ type: "image/png" });
            const data = new DataTransfer(); data.items.add(new File([blob], "image.png", { type: "image/png" }));
            document.dispatchEvent(new ClipboardEvent("paste", { clipboardData: data, bubbles: true, cancelable: true }));
        })()`);
        await until("window.app.editing().stage?.loaded() && document.querySelector('.quire-img-frame.shown')");
        await tab.run("document.querySelector('.quire-img-stage').focus()");
        await tab.press("w");
        await until("document.querySelector('.quire-img-read-dialog .quire-dialog-action')");
        await tab.run("document.querySelector('.quire-img-read-dialog .quire-dialog-action').click()");
        await until("document.querySelector('.quire-img-read-download')");
        await tab.run("document.querySelector('.quire-img-read-download').click()");
        await until("/look/.test(document.querySelector('.quire-img-strip-said')?.textContent ?? '')", 90_000);
        const words = await wordsOf(page);
        const at = (text: string) => words.findIndex((word) => word.text === text);
        const [plus, group, last, jordan] = [at("+1"), at("555"), at("0132"), at("Jordan")];
        expect(Math.min(plus, group, last, jordan)).toBeGreaterThanOrEqual(0);
        const phone = { x: words[plus]!.cover.x, right: words[last]!.cover.x + words[last]!.cover.width };
        const middleOf = (index: number) => page.onScreen(words[index]!.cover.x + words[index]!.cover.width / 2, words[index]!.cover.y + words[index]!.cover.height / 2);
        expect(await tab.run<string>("document.querySelector('.quire-img-strip-said').textContent")).toContain("1 looks private");

        // Hide all: one cover, from the first group's edge to the last's
        await tab.run("[...document.querySelectorAll('.quire-img-strip-words')].find((button) => button.textContent === 'Hide all').click()");
        await until("window.app.editing().steps().length === 1");
        const [all] = await covers(page);
        expect([all!.rect.x, all!.rect.x + all!.rect.width]).toEqual([phone.x, phone.right]);
        await tab.press("z", { ctrl: true });
        await until("window.app.editing().steps().length === 0");

        // pressing one group of the number hides the whole of it, the same cover
        const press = await middleOf(group);
        await tab.click(press.x, press.y);
        await until("window.app.editing().steps().length === 1");
        expect((await covers(page))[0]!.rect).toEqual(all!.rect);
        // pressing a word that is not part of anything private hides that word alone
        const alone = await middleOf(jordan);
        await tab.click(alone.x, alone.y);
        await until("window.app.editing().steps().length === 2");
        expect((await covers(page))[1]!.rect).toEqual(words[jordan]!.cover);
        expect(tab.errors.filter((error) => !/onnxruntime|W:onnx/.test(error))).toEqual([]);
    } finally {
        await page.close();
    }
}, 240_000);
