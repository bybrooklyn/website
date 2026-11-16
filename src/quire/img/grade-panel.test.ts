// What the Grade surface is held to: a slider's number is said plainly and a typed one held to its
// range; a drag moves a slider by how far the pointer went, never jumping, snapping to zero; and in
// Chromium, by real keys and drags, G opens the grade's page in the side panel beside the picture (which keeps its place, and is
// never under it), a slider dragged previews and is one undo when let go, a double press puts it
// back to zero, a typed number and the arrow keys set it, the backslash held shows the original, the
// split goes on and is dragged, Balance on a gray patch makes it neutral, Auto lands as slider and
// curve values, and the histogram follows the grade without holding up the drag.

import { afterAll, beforeAll, expect, test } from "bun:test";
import { imgPage, type ImgPage } from "../../../scripts/img-page";
import { dragged, said, typed } from "./grade-panel";

test("a slider's number is said plainly, and a typed one is held to its range in tenths", () => {
    expect(said(12)).toBe("12");
    expect(said(-3.5)).toBe("-3.5");
    expect(typed("40")).toBe(40);
    expect(typed("+12,34")).toBe(12.3);
    expect(typed("-500")).toBe(-100);
    expect(typed("lots")).toBeUndefined();
    expect(typed("")).toBeUndefined();
    expect(typed("-0")).toBe(0);
});

test("a drag moves a slider by how far the pointer went, the whole track the whole range, and snaps to zero within two", () => {
    expect(dragged(0, 50, 200)).toBe(50);
    expect(dragged(30, -50, 200)).toBe(-20);
    expect(dragged(10, -9, 200)).toBe(0);
    expect(dragged(0, 1, 200)).toBe(0);
    expect(dragged(90, 100, 200)).toBe(100);
    // with Shift, a tenth as far and in tenths, with no snap
    expect(dragged(0, 10, 200, true)).toBe(1);
});

let page: ImgPage | undefined;
beforeAll(async () => {
    page = await imgPage("img-grade");
    if (!page) console.warn("grade browser test skipped: needs a Chromium");
});
afterAll(async () => {
    await page?.close();
});
const gradeOf = () => page!.tab.run<Record<string, unknown> | undefined>("window.app.editing().steps().find((step) => step.type === 'grade')?.grade");

test("G opens the grade's page in the side panel beside the picture, which keeps its place; a slider dragged is one undo; a double press, a typed number and the arrows set it", async () => {
    if (!page) return;
    await page.paste("photo");
    const before = await page.boxOf(".quire-img-stage");
    await page.tab.press("g");
    await page.until("document.querySelector('.quire-img-grade-panel.open')");
    await page.tab.wait(700);
    const after = await page.boxOf(".quire-img-stage");
    const panel = await page.boxOf(".quire-img-grade-panel");
    expect(after).toEqual(before);
    expect(await page.tab.run("[...document.querySelectorAll('.quire-img-bar .quire-img-word.pressed')].map((each) => each.textContent)")).toEqual(["color"]);
    // the picture's room ends before the panel starts
    expect(after.x + after.width).toBeLessThanOrEqual(panel.x + 1);
    expect(await page.tab.run("window.app.editing().stage.tool()")).toBe("grade");
    // a drag on Light from its middle a quarter of the track to the right
    const track = await page.boxOf('.quire-img-slider[data-key="light"] .quire-img-slider-track');
    const from = { x: track.x + track.width / 2 - 30, y: track.y + track.height / 2 };
    await page.tab.drag(from, { x: from.x + track.width / 4, y: from.y }, 8);
    expect((await gradeOf())?.light).toBe(50);
    expect(await page.tab.run("window.app.editing().steps().length")).toBe(1);
    await page.tab.press("z", { ctrl: true });
    expect(await gradeOf()).toBeUndefined();
    await page.tab.press("z", { ctrl: true, shift: true });
    expect((await gradeOf())?.light).toBe(50);
    // a double press puts it back to zero, and with nothing else away from zero the grade step goes
    await page.tab.run("document.querySelector('.quire-img-slider[data-key=\"light\"] .quire-img-slider-track').dispatchEvent(new MouseEvent('dblclick', { bubbles: true }))");
    expect(await gradeOf()).toBeUndefined();
    // a typed number
    await page.tab.run("(() => { const field = document.querySelector('.quire-img-slider[data-key=\"contrast\"] .quire-img-slider-number'); field.focus(); field.value = '25'; })()");
    await page.tab.press("Enter");
    expect((await gradeOf())?.contrast).toBe(25);
    // the arrow keys, Shift for ten, held as one change
    await page.tab.run("document.querySelector('.quire-img-slider[data-key=\"warmth\"] .quire-img-slider-track').focus()");
    await page.tab.press("ArrowRight", { shift: true });
    await page.tab.press("ArrowRight");
    expect((await gradeOf())?.warmth).toBe(11);
}, 60_000);

test("the backslash held shows the original; the split goes on in the middle and is dragged", async () => {
    if (!page) return;
    await page.tab.run("document.querySelector('.quire-img-stage').focus()");
    const key = (type: string) => page!.tab.run(`document.querySelector('.quire-img-stage').dispatchEvent(new KeyboardEvent('${type}', { key: '\\\\', bubbles: true }))`);
    await key("keydown");
    expect(await page.tab.run("window.app.editing().stage.held()")).toBe(true);
    await key("keyup");
    expect(await page.tab.run("window.app.editing().stage.held()")).toBe(false);
    await page.tab.run("document.querySelector('.quire-img-grade-ways [aria-label^=\"Split\"]').click()");
    const stage = await page.boxOf(".quire-img-stage");
    expect(await page.tab.run<number>("window.app.editing().stage.split()")).toBeCloseTo(stage.width / 2, 0);
    await page.tab.wait(450);
    const grip = await page.middle(".quire-img-split-grip");
    await page.tab.drag(grip, { x: grip.x - 200, y: grip.y }, 6);
    expect(await page.tab.run<number>("window.app.editing().stage.split()")).toBeCloseTo(stage.width / 2 - 200, -1);
}, 60_000);

test("Balance on a gray patch makes it neutral, Auto lands as slider and curve values, and the histogram follows", async () => {
    if (!page) return;
    // a warm gray patch on a picture of its own
    await page.tab.run(`(async () => {
        const canvas = new OffscreenCanvas(600, 400);
        const context = canvas.getContext("2d");
        context.fillStyle = "#8a5a3a"; context.fillRect(0, 0, 600, 400);
        context.fillStyle = "rgb(150, 128, 100)"; context.fillRect(200, 120, 200, 160);
        const blob = await canvas.convertToBlob({ type: "image/png" });
        const data = new DataTransfer();
        data.items.add(new File([blob], "warm.png", { type: "image/png" }));
        document.dispatchEvent(new ClipboardEvent("paste", { clipboardData: data, bubbles: true, cancelable: true }));
    })()`);
    await page.until("window.app.editing().stage?.loaded()?.size.width === 600");
    await page.until("document.querySelector('.quire-img-grade-panel.open')");
    await page.tab.run("[...document.querySelectorAll('.quire-img-grade-fix')].find((each) => each.textContent === 'balance').click()");
    expect(await page.tab.run("window.app.editing().stage.armed()")).toBe(true);
    const patch = await page.onScreen(300, 200);
    await page.tab.click(patch.x, patch.y);
    await page.until("window.app.editing().steps().some((step) => step.type === 'grade')");
    // the patch, flattened, is neutral
    const flat = await page.tab.run<number[]>("(async () => { const flat = await window.app.editing().flatten(); const at = (200 * 600 + 300) * 4; return [flat.data[at], flat.data[at + 1], flat.data[at + 2]]; })()");
    expect(Math.max(...flat) - Math.min(...flat)).toBeLessThanOrEqual(1);
    // Auto: warmth and tint, and the curve's ends
    await page.tab.run("[...document.querySelectorAll('.quire-img-grade-fix')].find((each) => each.textContent === 'auto').click()");
    await page.until("(window.app.editing().steps().find((step) => step.type === 'grade')?.grade.curves?.all ?? []).length === 2");
    // the histogram has been drawn
    await page.until("(() => { const canvas = document.querySelector('.quire-img-grade-scope'); const data = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data; return data.some((value) => value > 0); })()");
}, 60_000);

test("as a change is saved the status shows one word at a time, the old gone before the new comes", async () => {
    if (!page) return;
    await page.tab.run("(() => { const f = document.querySelector('.quire-img-slider[data-key=\"highs\"] .quire-img-slider-number'); f.value = '-20'; f.dispatchEvent(new Event('change')); })()");
    // sampled every 20 ms for two seconds: never two words seen at once
    const most = await page.tab.run<number>(`(async () => { let most = 0; for (let i = 0; i < 100; i++) { await new Promise((done) => setTimeout(done, 20)); most = Math.max(most, [...document.querySelectorAll('.quire-status-words')].filter((each) => Number(getComputedStyle(each).opacity) > 0.02).length); } return most; })()`);
    expect(most).toBe(1);
}, 60_000);

test("an idle Grade surface saves nothing, and a slider, a curve point, a wheel and a brush stroke dragged each save as one change when let go, not on every move", async () => {
    if (!page) return;
    // every write to the browser's database is counted, each with the store it went to
    await page.tab.run(`(() => { window.writes = []; for (const name of ["put", "add"]) { const was = IDBObjectStore.prototype[name]; IDBObjectStore.prototype[name] = function (...args) { window.writes.push(this.name); return was.apply(this, args); }; } })()`);
    const settle = async () => {
        // until no write has come for two seconds
        let seen = -1;
        while (seen !== (await page!.tab.run<number>("window.writes.length"))) {
            seen = await page!.tab.run<number>("window.writes.length");
            await page!.tab.wait(2000);
        }
        return seen;
    };
    let before = await settle();
    // idle, with the surface open, its histogram drawn and More open: nothing written
    await page.tab.run("document.querySelector('.quire-img-grade-more summary').click()");
    await page.tab.wait(3000);
    expect(await page.tab.run<number>("window.writes.length")).toBe(before);
    // one change by a typed number: what one save writes
    await page.tab.run("(() => { const field = document.querySelector('.quire-img-slider[data-key=\"shadows\"] .quire-img-slider-number'); field.value = '10'; field.dispatchEvent(new Event('change')); })()");
    const one = (await settle()) - before;
    expect(one).toBeGreaterThan(0);
    const changes = async (drag: () => Promise<void>) => {
        before = await settle();
        const steps = await page!.tab.run<string>("JSON.stringify(window.app.editing().steps())");
        await drag();
        const after = await settle();
        expect(await page!.tab.run<string>("JSON.stringify(window.app.editing().steps())")).not.toBe(steps);
        return after - before;
    };
    // a slider dragged in twenty moves
    await page.tab.run("document.querySelector('.quire-img-slider[data-key=\"light\"]').scrollIntoView({ block: 'center' })");
    const track = await page.boxOf('.quire-img-slider[data-key="light"] .quire-img-slider-track');
    expect(await changes(() => page!.tab.drag({ x: track.x + track.width / 2, y: track.y + track.height / 2 }, { x: track.x + track.width * 0.8, y: track.y + track.height / 2 }, 20))).toBe(one);
    // a curve point dragged in twenty moves
    await page.tab.run("document.querySelector('.quire-img-curve-square').scrollIntoView({ block: 'center' })");
    await page.tab.wait(300);
    const square = await page.boxOf(".quire-img-curve-square");
    const size = square.width - 16;
    expect(await changes(() => page!.tab.drag({ x: square.x + 8 + 0.5 * size, y: square.y + 8 + 0.5 * size }, { x: square.x + 8 + 0.5 * size, y: square.y + 8 + 0.35 * size }, 20))).toBe(one);
    // a wheel dragged in twenty moves
    await page.tab.run("document.querySelector('.quire-img-wheels').scrollIntoView({ block: 'center' })");
    await page.tab.wait(300);
    const wheel = await page.boxOf('.quire-img-wheel[data-key="mids"] canvas');
    expect(await changes(() => page!.tab.drag({ x: wheel.x + wheel.width / 2, y: wheel.y + wheel.width / 2 }, { x: wheel.x + wheel.width * 0.7, y: wheel.y + wheel.width * 0.35 }, 20))).toBe(one);
    // a brush stroke in twenty moves, on a painted area made first
    await page.tab.run("document.querySelector('.quire-img-make-paint').click()");
    await settle();
    expect(await changes(async () => page!.tab.drag(await page!.onScreen(100, 100), await page!.onScreen(500, 300), 20))).toBe(one);
}, 120_000);
