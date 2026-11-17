// What the parts are held to: a brush's size and a feather run finely at their small ends and the
// feather's slider gives back what it set; a part is named by its kind and number; and in Chromium,
// by real drags, Gradient and a drag across the picture make a part, picked, whose own grade darkens
// the top and not the bottom when flattened; its end dragged moves it; its feather and inside out are
// set; Paint and a stroke paint a part, Erase takes from it; each is one undo; Escape goes back to
// the whole picture; a handle pressed picks its part; Delete takes it away; and the document read
// again flattens to the same pixels.

import { afterAll, beforeAll, expect, test } from "bun:test";
import { imgPage, type ImgPage } from "../../../scripts/img-page";
import { brushRadius, featherPixels, featherValue, partName } from "./grade-parts";

test("a brush's size and a feather run finely at their small ends, and the feather's slider gives back what it set", () => {
    expect(brushRadius(0, 4000)).toBe(20);
    expect(brushRadius(100, 4000)).toBe(660);
    expect(brushRadius(50, 4000)).toBe(180);
    expect(featherPixels(0, 4000)).toBe(0);
    expect(featherPixels(100, 4000)).toBe(400);
    for (const value of [0, 10, 33.3, 80, 100]) expect(featherValue(featherPixels(value, 4000), 4000)).toBeCloseTo(value, 0);
    expect(partName("gradient", 2)).toBe("gradient 2");
    expect(partName("paint", 1)).toBe("painted area 1");
});

let page: ImgPage | undefined;
beforeAll(async () => {
    page = await imgPage("img-grade-parts");
    if (!page) console.warn("grade parts browser test skipped: needs a Chromium");
});
afterAll(async () => {
    await page?.close();
});
type Step = { id: string; type: string; kind?: string; from?: { x: number; y: number }; to?: { x: number; y: number }; feather?: number; invert?: boolean; strokes?: { erase?: boolean; points: number[] }[]; grade?: Record<string, unknown> };
const steps = () => page!.tab.run<Step[]>("window.app.editing().steps()");
const typeInto = (key: string, value: string) => page!.tab.run(`(() => { const field = document.querySelector('.quire-img-slider[data-key="${key}"] .quire-img-slider-number'); field.focus(); field.value = '${value}'; field.dispatchEvent(new Event('change')); })()`);
const pixelAt = (x: number, y: number, width: number) => page!.tab.run<number[]>(`(async () => { const flat = await window.app.editing().flatten(); const at = (${y} * ${width} + ${x}) * 4; return [flat.data[at], flat.data[at + 1], flat.data[at + 2]]; })()`);

test("a gradient dragged out is a part of its own: its grade darkens the top, its end moves, its feather and inside out are set, and Escape goes back to the whole picture", async () => {
    if (!page) return;
    await page.paste("photo");
    const before = await pixelAt(2000, 200, 4000);
    await page.tab.press("g");
    await page.until("document.querySelector('.quire-img-grade-panel.open')");
    await page.tab.wait(800);
    await page.tab.run("document.querySelector('.quire-img-make-gradient').click()");
    // what to do is said in the line over the side panel's page, never over the picture
    await page.tab.wait(600);
    expect(await page.tab.run<string>("document.querySelector('.quire-img-doing:not(.away) .quire-img-doing-said')?.textContent ?? ''")).toContain("Drag across the picture");
    const said = await page.boxOf(".quire-img-doing");
    const stage = await page.boxOf(".quire-img-stage");
    expect(said.x).toBeGreaterThanOrEqual(stage.x + stage.width - 1);
    await page.tab.drag(await page.onScreen(2000, 600), await page.onScreen(2000, 1800), 8);
    const made = (await steps()).find((step) => step.type === "part")!;
    expect(made.kind).toBe("gradient");
    expect(made.from!.y).toBeCloseTo(600, -1);
    expect(made.to!.y).toBeCloseTo(1800, -1);
    expect(await page.tab.run("document.querySelector('.quire-img-grade-target').textContent")).toBe("gradient 1");
    await typeInto("light", "-80");
    const part = (await steps()).find((step) => step.type === "part")!;
    expect(part.grade).toEqual({ light: -80 });
    expect((await steps()).some((step) => step.type === "grade")).toBe(false);
    // the top darker, the bottom as it was
    const top = await pixelAt(2000, 200, 4000);
    const bottom = await pixelAt(2000, 2900, 4000);
    expect(top[0]!).toBeLessThan(before[0]! - 20);
    expect(bottom).toEqual(await page.tab.run<number[]>("(async () => { const loaded = window.app.editing().stage.loaded(); const pixels = await loaded.pixels({ x: 2000, y: 2900, width: 1, height: 1 }); return [pixels[0], pixels[1], pixels[2]]; })()"));
    // its end dragged lower
    await page.tab.drag(await page.onScreen(2000, 1800), await page.onScreen(2000, 2400), 6);
    expect((await steps()).find((step) => step.type === "part")!.to!.y).toBeCloseTo(2400, -1);
    // its feather and turned inside out
    await typeInto("feather", "50");
    expect((await steps()).find((step) => step.type === "part")!.feather).toBe(100);
    await page.tab.run("[...document.querySelectorAll('.quire-img-part .quire-bench-tick')].find((each) => each.textContent === 'inside out').click()");
    expect((await steps()).find((step) => step.type === "part")!.invert).toBe(true);
    // Escape: the whole picture again, whose grade is its own
    await page.tab.run("document.querySelector('.quire-img-stage').focus()");
    await page.tab.press("Escape");
    expect(await page.tab.run("document.querySelector('.quire-img-grade-target').textContent")).toBe("whole picture");
    await typeInto("warmth", "20");
    expect((await steps()).find((step) => step.type === "grade")!.grade).toEqual({ warmth: 20 });
    // the gradient's handle pressed picks it again
    const handle = await page.onScreen(2000, 600);
    await page.tab.click(handle.x, handle.y);
    expect(await page.tab.run("document.querySelector('.quire-img-grade-target').textContent")).toBe("gradient 1");
}, 60_000);

test("Paint makes a part a stroke paints and Erase takes from, each one undo; Delete takes the part away; the document read again flattens the same", async () => {
    if (!page) return;
    await page.tab.run("document.querySelector('.quire-img-make-paint').click()");
    expect(await page.tab.run("document.querySelector('.quire-img-grade-target').textContent")).toBe("painted area 1");
    await page.tab.run("document.querySelector('.quire-img-stage').focus()");
    await page.tab.drag(await page.onScreen(800, 1500), await page.onScreen(1600, 1500), 10);
    let painted = (await steps()).find((step) => step.kind === "paint")!;
    expect(painted.strokes).toHaveLength(1);
    expect(painted.strokes![0]!.points.length).toBeGreaterThan(4);
    await page.tab.run("[...document.querySelectorAll('.quire-img-part .quire-bench-tick')].find((each) => each.textContent === 'erase').click()");
    await page.tab.drag(await page.onScreen(1200, 1500), await page.onScreen(1250, 1500), 4);
    painted = (await steps()).find((step) => step.kind === "paint")!;
    expect(painted.strokes).toHaveLength(2);
    expect(painted.strokes![1]!.erase).toBe(true);
    await page.tab.press("z", { ctrl: true });
    expect((await steps()).find((step) => step.kind === "paint")!.strokes).toHaveLength(1);
    await typeInto("color", "-100");
    const flat = await page.tab.run<number>("(async () => { const flat = await window.app.editing().flatten(); let sum = 0; for (let at = 0; at < flat.data.length; at += 997) sum += flat.data[at]; return sum; })()");
    // undo and redo walk the grade back and forth to the same pixels
    await page.tab.press("z", { ctrl: true });
    await page.tab.press("z", { ctrl: true, shift: true });
    const after = await page.tab.run<number>("(async () => { const flat = await window.app.editing().flatten(); let sum = 0; for (let at = 0; at < flat.data.length; at += 997) sum += flat.data[at]; return sum; })()");
    expect(after).toBe(flat);
    // the document read again from its steps.json, the original fetched again from where it is kept: the same pixels
    await page.tab.run("window.app.editing().reopen()");
    await page.until("window.app.editing().stage.loaded()");
    const reopened = await page.tab.run<number>("(async () => { const flat = await window.app.editing().flatten(); let sum = 0; for (let at = 0; at < flat.data.length; at += 997) sum += flat.data[at]; return sum; })()");
    expect(reopened).toBe(flat);
    const painted2 = (await steps()).find((step) => step.kind === "paint")!;
    await page.tab.run(`window.app.editing().grading.isOpen() || document.querySelector('.quire-img-bar [aria-label="Color (G)"]').click()`);
    const anchor = await page.onScreen(painted2.strokes![0]!.points[0]!, painted2.strokes![0]!.points[1]!);
    await page.tab.click(anchor.x, anchor.y);
    expect(await page.tab.run("document.querySelector('.quire-img-grade-target').textContent")).toBe("painted area 1");
    // Delete takes the part away
    await page.tab.run("document.querySelector('.quire-img-stage').focus()");
    await page.tab.press("Delete");
    expect((await steps()).some((step) => step.kind === "paint")).toBe(false);
    expect(await page.tab.run("document.querySelector('.quire-img-grade-target').textContent")).toBe("whole picture");
}, 60_000);
