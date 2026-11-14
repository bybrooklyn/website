// What the stage is held to: a mark's thickness follows the pen and the picture's size; and in
// headless Chromium, by real keys and drags, the crop's frame is nudged by the arrows (ten pixels with
// Shift), held to a square from the strip, and set with Enter; zooming by the keys goes to one to one
// and back to fitted; a mark picked is moved by the arrows and removed with Delete, and undo brings
// it back; Escape leaves the tool. Skipped, with a notice, on a machine with no Chromium.

import { afterAll, beforeAll, expect, test } from "bun:test";
import { imgPage, type ImgPage } from "../../../scripts/img-page";
import { placeWords, runCovers, runText, thickness } from "./stage";

/** Two lines of words, each word 40 wide and 20 high, the second line 60 below the first. */
const LINES = [0, 1].map((row) => ({ text: "", sure: 1, box: { at: { x: 0, y: row * 60 }, along: { x: 1, y: 0 }, length: 300, height: 30 }, words: ["one", "two", "three"].map((text, at) => ({ text: `${text}${row}`, sure: 1, line: row, box: { at: { x: 10 + at * 60, y: 5 + row * 60 }, along: { x: 1, y: 0 }, length: 40, height: 20 } })) }));

test("a word's cover is its box grown by a tenth of its line's height, a run's covers are one a line round its words, and a run's text keeps its lines", () => {
    const words = placeWords(LINES);
    expect(words).toHaveLength(6);
    // a tenth of 30 is 3
    expect(words[0]!.cover).toEqual({ x: 7, y: 2, width: 46, height: 26 });
    expect(runCovers(words, [0, 1])).toEqual([{ x: 7, y: 2, width: 106, height: 26 }]);
    expect(runCovers(words, [1, 2, 3])).toEqual([{ x: 67, y: 2, width: 106, height: 26 }, { x: 7, y: 62, width: 46, height: 26 }]);
    expect(runCovers(words, [0, 2])).toHaveLength(2);
    expect(runText(words, 4, 1)).toBe("two0 three0\none1 two1");
});

test("a mark's thickness follows the pen and the picture's longer side, never thinner than two pixels", () => {
    expect(thickness({ color: "#000000", weight: 0.005 }, { width: 4000, height: 3000 })).toBe(20);
    expect(thickness({ color: "#000000", weight: 0.003 }, { width: 300, height: 200 })).toBe(2);
});

let page: ImgPage | undefined;
beforeAll(async () => {
    page = await imgPage("img-stage");
    if (!page) console.warn("stage browser test skipped: needs a Chromium");
});
afterAll(async () => {
    await page?.close();
});
const frameOf = () => page!.tab.run<{ x: number; y: number; width: number; height: number }>("window.app.editing().stage.frame()");
const stepsOf = () => page!.tab.run<{ type: string; id: string; from?: { x: number }; rect?: { x: number; width: number; height: number } }[]>("window.app.editing().steps()");

test("the crop's frame is nudged by the arrows, held to a square from the strip, and set with Enter", async () => {
    if (!page) return;
    await page.paste("screenshot");
    expect(await frameOf()).toEqual({ x: 0, y: 0, width: 1200, height: 700 });
    // a corner dragged in first, so that the frame has room to move
    const corner = await page.onScreen(1200, 700);
    const to = await page.onScreen(900, 500);
    await page.tab.drag(corner, to, 6);
    await page.tab.press("ArrowRight");
    await page.tab.press("ArrowDown", { shift: true });
    const nudged = await frameOf();
    expect([nudged.x, nudged.y]).toEqual([1, 10]);
    const square = await page.tab.run<{ x: number; y: number }>("(() => { const box = document.querySelector('.quire-img-strip [aria-label=\"Square shape\"]').getBoundingClientRect(); return { x: box.x + box.width / 2, y: box.y + box.height / 2 }; })()");
    await page.tab.click(square.x, square.y);
    const held = await frameOf();
    expect(held.width).toBe(held.height);
    await page.tab.run("document.querySelector('.quire-img-stage').focus()");
    await page.tab.press("Enter");
    const steps = await stepsOf();
    expect(steps.map((step) => step.type)).toEqual(["crop"]);
    expect(steps[0]!.rect!.width).toBe(held.width);
    expect(await page.tab.run("window.app.editing().stage.tool()")).toBe("none");
}, 30_000);

test("Ctrl+1 shows the picture at one to one and Ctrl+0 fits it again", async () => {
    if (!page) return;
    await page.tab.press("1", { ctrl: true });
    expect(await page.tab.run("window.app.editing().stage.scale()")).toBe(1);
    await page.tab.press("0", { ctrl: true });
    expect(await page.tab.run<number>("window.app.editing().stage.scale()")).toBeLessThanOrEqual(1);
});

test("a mark picked moves with the arrows and goes with Delete, undo brings it back, and Escape leaves the tool", async () => {
    if (!page) return;
    await page.paste("screenshot");
    await page.tab.press("a");
    await page.tab.drag(await page.onScreen(600, 400), await page.onScreen(300, 300), 6);
    const made = await stepsOf();
    expect(made.map((step) => step.type)).toEqual(["arrow"]);
    await page.tab.press("ArrowLeft", { shift: true });
    expect((await stepsOf())[0]!.from!.x).toBeCloseTo(made[0]!.from!.x - 10, 5);
    await page.tab.press("Delete");
    expect(await stepsOf()).toEqual([]);
    await page.tab.press("z", { ctrl: true });
    expect((await stepsOf()).map((step) => step.type)).toEqual(["arrow"]);
    await page.tab.press("Escape");
    await page.tab.press("Escape");
    expect(await page.tab.run("window.app.editing().stage.tool()")).toBe("none");
}, 30_000);
