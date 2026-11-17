// What a batch is held to on the page, in Chromium: pictures pasted at once become one document with a strip of
// small pictures under the picture, the one on the stage marked and the line under it saying which of how many;
// Page Down and Page Up step through them, each picture keeping its own steps and its own undo; Give to all from
// the grade's surface hands the grade to every picture as one undo step and touches no cover; Export all writes
// one zip whose files keep their own names (the second of one name `photo (1)`), each picture flattened away from
// the stage to the stage's own pixels; a folder chosen is never written over; the batch is one row on the shelf
// and opens again as it was left; and a picture can be taken out.

import { afterAll, beforeAll, expect, test } from "bun:test";
import { imgPage, type ImgPage } from "../../../scripts/img-page";
import { readZip } from "../core/zip";

let page: ImgPage | undefined;
beforeAll(async () => {
    page = await imgPage(`img-batch-${Date.now()}`);
    if (!page) console.log("No Chromium here: the batch's browser tests are skipped.");
});
afterAll(async () => page?.close());

/** Pastes pictures made in the page: each a color, a size and a name. */
async function pasteMany(given: { name: string; width: number; height: number; hue: number }[]) {
    await page!.tab.run(`(async () => {
        const data = new DataTransfer();
        for (const each of ${JSON.stringify(given)}) {
            const canvas = new OffscreenCanvas(each.width, each.height);
            const context = canvas.getContext("2d");
            context.fillStyle = "hsl(" + each.hue + " 60% 45%)";
            context.fillRect(0, 0, each.width, each.height);
            context.fillStyle = "#fff";
            context.fillRect(each.width / 4, each.height / 4, each.width / 2, each.height / 8);
            data.items.add(new File([await canvas.convertToBlob({ type: "image/jpeg", quality: 0.92 })], each.name, { type: "image/jpeg" }));
        }
        document.dispatchEvent(new ClipboardEvent("paste", { clipboardData: data, bubbles: true, cancelable: true }));
    })()`);
}
const batch = () => page!.tab.run<{ count: number; at: number; names: string[] }>("window.app.editing().batch()");
const kinds = () => page!.tab.run<string[]>("window.app.editing().steps().map((step) => step.type)");

test("pictures pasted at once are one batch: a strip under the picture, Page Down and Page Up stepping through, each picture its own steps and undo", async () => {
    if (!page) return;
    const { tab, until } = page;
    await pasteMany([
        { name: "photo.jpg", width: 900, height: 600, hue: 10 },
        { name: "photo.png", width: 600, height: 800, hue: 130 },
        { name: "other.jpg", width: 1000, height: 500, hue: 220 },
    ]);
    await until("window.app.editing().batch?.().count === 3 && document.querySelectorAll('.quire-img-thumb-picture.drawn').length === 3", 30_000);
    expect(await tab.run("document.querySelector('.quire-img-thumbs').classList.contains('open')")).toBe(true);
    expect(await tab.run<string>("document.querySelector('.quire-img-facts').textContent")).toStartWith("1 of 3 · 900 × 600 px");
    expect(await tab.run<string>("document.querySelector('.quire-img-thumb.current').getAttribute('aria-label')")).toBe("1 of 3, photo.jpg");
    // the strip takes room of its own: the picture's stage ends above it
    const stage = await page.boxOf(".quire-img-stage");
    const strip = await page.boxOf(".quire-img-thumbs");
    expect(stage.y + stage.height).toBeLessThanOrEqual(strip.y + 1);

    // a cover on the first picture only
    await until("window.app.editing().stage.loaded()");
    await tab.press("r");
    await tab.drag(await page.onScreen(100, 100), await page.onScreen(300, 200), 6);
    await until("window.app.editing().steps().some((step) => step.type === 'cover')");
    await tab.press("PageDown");
    await until("window.app.editing().batch().at === 1 && window.app.editing().stage.loaded()?.size.width === 600");
    expect(await kinds()).toEqual([]);
    expect(await tab.run<string>("document.querySelector('.quire-img-thumb.current').getAttribute('aria-label')")).toBe("2 of 3, photo.png");
    expect(await tab.run<string>("document.querySelector('.quire-img-facts').textContent")).toStartWith("2 of 3 · 600 × 800 px");
    // nothing to undo here: the cover's undo stays with the first picture
    expect(await tab.run("document.querySelector('.quire-img-bar button[aria-label^=Undo]').disabled")).toBe(true);
    await tab.press("PageUp");
    await until("window.app.editing().batch().at === 0 && window.app.editing().stage.loaded()?.size.width === 900");
    expect(await kinds()).toContain("cover");
    await tab.press("z", { ctrl: true });
    expect(await kinds()).not.toContain("cover");
    await tab.press("z", { ctrl: true, shift: true });
    expect(await kinds()).toContain("cover");
    // a press on a small picture steps to it
    const third = await page.middle(".quire-img-thumb:nth-child(3)");
    await tab.click(third.x, third.y);
    await until("window.app.editing().batch().at === 2");
    await tab.press("Home");
    await until("window.app.editing().batch().at === 0 && window.app.editing().stage.loaded()?.size.width === 900");
}, 60_000);

test("Give to all from the grade's surface hands the grade to every picture as one undo step, and never a cover", async () => {
    if (!page) return;
    const { tab, until } = page;
    await tab.press("g");
    await until("document.querySelector('.quire-img-grade-panel.open .quire-img-sliders')");
    for (let step = 0; step < 3; step++) await tab.press("ArrowRight", { shift: true });
    await until("window.app.editing().steps().some((step) => step.type === 'grade' && step.grade.light === 30)");
    const said = await tab.run<string>("document.querySelector('.quire-img-page.open .quire-img-give-said').textContent");
    expect(said).toBe("Give this grade to the other 2 pictures; their crops, marks and hidden areas stay their own");
    await tab.run("document.querySelector('.quire-img-page.open .quire-img-give-button').click()");
    const grades = () => tab.run<(number | null)[]>("(async () => { const out = []; const editor = window.app.editing(); for (let at = 0; at < 3; at++) { await editor.stepTo(at); out.push(editor.steps().find((step) => step.type === 'grade')?.grade.light ?? null); } await editor.stepTo(0); return out; })()");
    expect(await grades()).toEqual([30, 30, 30]);
    const covers = await tab.run<number[]>("(async () => { const out = []; const editor = window.app.editing(); for (let at = 0; at < 3; at++) { await editor.stepTo(at); out.push(editor.steps().filter((step) => step.type === 'cover').length); } await editor.stepTo(0); return out; })()");
    expect(covers).toEqual([1, 0, 0]);
    // one undo takes it back from all, the first keeping the grade it had of its own; redo gives it again
    await tab.run("window.app.editing().undo()");
    expect(await grades()).toEqual([30, null, null]);
    await tab.run("window.app.editing().redo()");
    expect(await grades()).toEqual([30, 30, 30]);
    await tab.press("g");
}, 60_000);

test("Export all writes one zip, each file its own name with the new ending, each picture as the stage flattens it", async () => {
    if (!page) return;
    const { tab, until } = page;
    // PNG for every picture, so the pixels can be held to the stage's own exactly
    await tab.run("document.querySelector('.quire-img-stage').focus()");
    await tab.press("e");
    await until("document.querySelector('.quire-img-export.open .quire-img-all:not(.away)')");
    await tab.run("document.querySelector('.quire-img-export.open .quire-img-formats label[title^=\"PNG:\"]').click()");
    await tab.run("document.querySelector('.quire-img-export.open .quire-img-all .quire-img-give-button').click()");
    await until("window.app.editing().batch().count === 3");
    // no save picker: the zip is handed over when done
    await tab.run("window.showSaveFilePicker = undefined");
    const started = Date.now();
    await tab.run("[...document.querySelectorAll('.quire-img-export.open .quire-img-all-ways button')].find((button) => button.textContent.includes('zip')).click()");
    await until("Object.keys(window.downloads).some((name) => name.endsWith('.zip'))", 60_000);
    const took = Date.now() - started;
    const name = await tab.run<string>("Object.keys(window.downloads).find((name) => name.endsWith('.zip'))");
    const zip = await readZip(new Uint8Array(await tab.run<number[]>(`window.downloads[${JSON.stringify(name)}]`)));
    expect([...zip.keys()]).toEqual(["photo.png", "photo (1).png", "other.png"]);
    // the first picture, flattened away from the stage, is the stage's own flattening
    const same = await tab.run<{ width: number; height: number; most: number }>(`(async () => {
        const bytes = new Uint8Array(${JSON.stringify([...zip.get("photo.png")!])});
        const bitmap = await createImageBitmap(new Blob([bytes], { type: "image/png" }), { colorSpaceConversion: "none", premultiplyAlpha: "none" });
        const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
        const context = canvas.getContext("2d");
        context.drawImage(bitmap, 0, 0);
        const zipped = context.getImageData(0, 0, bitmap.width, bitmap.height).data;
        const flat = await window.app.editing().flatten();
        let most = 0;
        for (let at = 0; at < zipped.length; at++) most = Math.max(most, Math.abs(zipped[at] - flat.data[at]));
        return { width: bitmap.width, height: bitmap.height, most };
    })()`);
    expect([same.width, same.height]).toEqual([900, 600]);
    expect(same.most).toBeLessThanOrEqual(1);
    console.log(`Export all of 3 pictures as PNG: ${took} ms`);
    await tab.press("Escape");
}, 90_000);

test("Export all into a folder writes each file straight into it, never over a file already there", async () => {
    if (!page) return;
    const { tab, until } = page;
    await tab.run(`window.folder = new Map([["photo.png", new Blob(["mine"])]]);
        window.showDirectoryPicker = async () => ({
            kind: "directory",
            name: "Exports",
            async *values() { for (const name of window.folder.keys()) yield { kind: "file", name }; },
            async getFileHandle(name, options) {
                if (!window.folder.has(name) && !options?.create) throw new DOMException("not there", "NotFoundError");
                return { kind: "file", name, createWritable: async () => { let kept; return { write: async (data) => void (kept = data), close: async () => void window.folder.set(name, kept) }; } };
            },
        });`);
    await tab.run("window.app.editing().exportAll('folder')");
    await until("window.folder.size === 4", 60_000);
    expect(await tab.run<string[]>("[...window.folder.keys()]")).toEqual(["photo.png", "photo (1).png", "photo (2).png", "other.png"]);
    expect(await tab.run<string>("window.folder.get('photo.png').text()")).toBe("mine");
}, 90_000);

test("a small picture's right-click opens its own menu, Shift leaving the browser's; with the strip holding the keyboard its arrows step through", async () => {
    if (!page) return;
    const { tab, until } = page;
    const lines = () => tab.run<string[]>("[...document.querySelectorAll('.quire-menu:popover-open .quire-menu-items > *')].map((each) => each.textContent.trim()).filter(Boolean)");
    const second = await page.middle(".quire-img-thumb:nth-child(2)");
    await tab.run(`document.querySelector('.quire-img-thumb:nth-child(2)').dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: ${second.x}, clientY: ${second.y} }))`);
    await until("document.querySelector('.quire-menu:popover-open')");
    const said = await lines();
    expect(said.slice(0, 3)).toEqual(["Save this one", "Copy this one", "Give its changes to the other 2"]);
    expect(said).toEqual(expect.arrayContaining(["Add pictures", expect.stringContaining("Paste"), "Take out of the batch"]));
    // what giving its changes will do is said under it
    expect(said[3]).toBe("the grade, PNG");
    await tab.press("Escape");
    await until("!document.querySelector('.quire-menu:popover-open')");
    // with Shift the page leaves the event to the browser
    const left = await tab.run<boolean>(`!document.querySelector('.quire-img-thumb:nth-child(2)').dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, shiftKey: true, clientX: ${second.x}, clientY: ${second.y} }))`);
    expect(left).toBe(false);
    // the strip's own keys
    await tab.run("window.app.editing().stepTo(0)");
    await until("window.app.editing().batch().at === 0");
    await tab.run("document.querySelector('.quire-img-thumb.current').focus()");
    await tab.press("ArrowRight");
    await until("window.app.editing().batch().at === 1");
    await until("document.activeElement === document.querySelector('.quire-img-thumb.current')");
    await tab.press("End");
    await until("window.app.editing().batch().at === 2");
    await tab.press("ArrowLeft");
    await until("window.app.editing().batch().at === 1");
}, 60_000);

test("the batch is one row on the shelf, opens again as it was left, and a picture can be taken out", async () => {
    if (!page) return;
    const { tab, until } = page;
    await tab.run("window.app.editing().stepTo(1)");
    await until("window.app.editing().batch().at === 1");
    await tab.run("window.app.editing().flush()");
    // home, then the batch's row
    const word = await page.middle(".quire-word");
    await tab.click(word.x, word.y);
    await until("document.querySelector('.quire-host.shelved')");
    const rows = await tab.run<string[]>("[...document.querySelectorAll('.quire-shelf-open')].map((row) => row.textContent)");
    expect(rows.filter((row) => row.includes("Pictures,")).length).toBe(1);
    await tab.run("[...document.querySelectorAll('.quire-shelf-open')].find((row) => row.textContent.includes('Pictures,')).click()");
    await until("window.app.editing().batch?.().count === 3 && window.app.editing().stage.loaded()", 20_000);
    expect((await batch()).at).toBe(1);
    await tab.run("window.app.editing().stepTo(0)");
    await until("window.app.editing().stage.loaded()?.size.width === 900");
    expect(await kinds()).toEqual(expect.arrayContaining(["cover", "grade"]));
    // taken out, the batch is two; the one on the stage keeps its place
    await tab.run("window.app.editing().takeOut(1)");
    await until("window.app.editing().batch().count === 2");
    expect((await batch()).names).toEqual(["photo.jpg", "other.jpg"]);
    expect(await kinds()).toEqual(expect.arrayContaining(["cover", "grade"]));
    await until("document.querySelectorAll('.quire-img-thumb:not(.leaving)').length === 2");
    // taken down to one, it is a picture's document again, written as one always was
    await tab.run("window.app.editing().takeOut(1)");
    await until("window.app.editing().batch().count === 1 && !document.querySelector('.quire-img-thumbs').classList.contains('open')");
    await tab.run("window.app.editing().flush()");
    const id = await tab.run<string>("window.app.editing().current().id");
    const text = await tab.run<string>(`window.app.browser.open(${JSON.stringify(id)}).then((found) => found.text)`);
    expect(text).toStartWith('{\n  "quire": 1,\n  "original": ');
}, 60_000);
