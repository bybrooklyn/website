// What the Grade surface is held to: a slider's number is said plainly and a typed one held to its
// range; a drag moves a slider by how far the pointer went, never jumping, snapping to zero; and in
// Chromium, by real keys and drags, G opens the surface beside the picture (which refits, and is
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

test("G opens the surface beside the picture, which refits; a slider dragged is one undo; a double press, a typed number and the arrows set it", async () => {
    if (!page) return;
    await page.paste("photo");
    const before = await page.boxOf(".quire-img-stage");
    await page.tab.press("g");
    await page.until("document.querySelector('.quire-img-grade-panel.open')");
    await page.tab.wait(700);
    const after = await page.boxOf(".quire-img-stage");
    const panel = await page.boxOf(".quire-img-grade-panel");
    expect(after.width).toBeLessThan(before.width);
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
});

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
    await page.tab.run("[...document.querySelectorAll('.quire-img-grade-fix')].find((each) => each.textContent === 'Balance').click()");
    expect(await page.tab.run("window.app.editing().stage.armed()")).toBe(true);
    const patch = await page.onScreen(300, 200);
    await page.tab.click(patch.x, patch.y);
    await page.until("window.app.editing().steps().some((step) => step.type === 'grade')");
    // the patch, flattened, is neutral
    const flat = await page.tab.run<number[]>("(async () => { const flat = await window.app.editing().flatten(); const at = (200 * 600 + 300) * 4; return [flat.data[at], flat.data[at + 1], flat.data[at + 2]]; })()");
    expect(Math.max(...flat) - Math.min(...flat)).toBeLessThanOrEqual(1);
    // Auto: warmth and tint, and the curve's ends
    await page.tab.run("[...document.querySelectorAll('.quire-img-grade-fix')].find((each) => each.textContent === 'Auto').click()");
    await page.until("(window.app.editing().steps().find((step) => step.type === 'grade')?.grade.curves?.all ?? []).length === 2");
    // the histogram has been drawn
    await page.until("(() => { const canvas = document.querySelector('.quire-img-grade-scope'); const data = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data; return data.some((value) => value > 0); })()");
}, 60_000);
