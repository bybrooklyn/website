// What looks are held to: a name already taken gets a number after it; a look read back from the
// database is checked as a file would be; and in Chromium, a grade saved as a look is listed, given
// to another picture by a press and the same grade there, and forgotten; a .cube file chosen is read
// into the grade (and a hostile one refused with its reason), and the grade written as a .cube is a
// table of 33 a side.

import { afterAll, beforeAll, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { imgPage, type ImgPage } from "../../../scripts/img-page";
import { freeName, readLook } from "./looks";

test("a name already taken gets a number after it, and an empty one is called Look", () => {
    expect(freeName([], "Warm")).toBe("Warm");
    expect(freeName(["Warm", "Warm (2)"], "Warm")).toBe("Warm (3)");
    expect(freeName(["Look"], "  ")).toBe("Look (2)");
    expect(freeName([], "x".repeat(200))).toHaveLength(80);
});

test("a look read back is checked as a file is: its grade field by field, a name of text", () => {
    expect(readLook({ name: "Warm", grade: { light: 1e9, warmth: 20, evil: true }, saved: 5 })).toEqual({ name: "Warm", grade: { light: 100, warmth: 20 }, saved: 5 });
    expect(readLook({ name: 3 })).toBeUndefined();
    expect(readLook(null)).toBeUndefined();
    expect(readLook({ name: "x", grade: "no", saved: "never" })).toEqual({ name: "x", grade: {}, saved: 0 });
});

let page: ImgPage | undefined;
let folder = "";
beforeAll(async () => {
    page = await imgPage("img-looks");
    if (!page) console.warn("looks browser test skipped: needs a Chromium");
    folder = await mkdtemp(join(tmpdir(), "quire-looks-"));
});
afterAll(async () => {
    await page?.close();
    await rm(folder, { recursive: true, force: true });
});
const gradeOf = () => page!.tab.run<Record<string, any> | undefined>("window.app.editing().steps().find((step) => step.type === 'grade')?.grade");

test("a grade saved as a look is listed, given to another picture and forgotten; a .cube is read in and a hostile one refused; the grade is written as a .cube", async () => {
    if (!page) return;
    await page.paste("photo");
    await page.tab.press("g");
    await page.until("document.querySelector('.quire-img-grade-panel.open')");
    await page.tab.run("(() => { const field = document.querySelector('.quire-img-slider[data-key=\"warmth\"] .quire-img-slider-number'); field.focus(); field.value = '30'; field.dispatchEvent(new Event('change')); })()");
    expect((await gradeOf())?.warmth).toBe(30);
    await page.tab.run("document.querySelector('.quire-img-grade-looks summary').click()");
    await page.tab.run("(() => { const field = document.querySelector('.quire-img-look-name'); field.value = 'Warm evening'; })()");
    await page.tab.run("[...document.querySelectorAll('.quire-img-looks button')].find((each) => each.textContent === 'save look').click()");
    await page.until("[...document.querySelectorAll('.quire-img-look-apply')].some((each) => each.textContent === 'Warm evening')");
    // another picture, and the look given to it
    // with Grade open a new picture opens with Grade still open, so the crop's frame the page waits for is not on it
    await page.tab.run("window.paste('screenshot')");
    await page.until("window.app.editing().stage?.loaded()?.size.width === 1200");
    await page.until("document.querySelector('.quire-img-grade-panel.open')");
    expect(await gradeOf()).toBeUndefined();
    await page.tab.run("[...document.querySelectorAll('.quire-img-look-apply')].find((each) => each.textContent === 'Warm evening').click()");
    expect((await gradeOf())?.warmth).toBe(30);
    // a real press with the mouse: Chromium opens a file chooser only within a few seconds of a real input, and a press made from
    // script left the chooser shut whenever the machine was slow
    const pressReal = async (words: string) => {
        const at = await page.tab.run<{ x: number; y: number }>(`(() => { const button = [...document.querySelectorAll('.quire-img-looks button')].find((each) => each.textContent === ${JSON.stringify(words)}); button.scrollIntoView({ block: "center", behavior: "instant" }); const box = button.getBoundingClientRect(); return { x: box.x + box.width / 2, y: box.y + box.height / 2 }; })()`);
        await page.tab.click(at.x, at.y);
    };
    // a .cube read in: a table that swaps red and blue
    const lines = ["TITLE \"Swap\"", "LUT_3D_SIZE 2"];
    for (let b = 0; b < 2; b++) for (let g = 0; g < 2; g++) for (let r = 0; r < 2; r++) lines.push(`${b} ${g} ${r}`);
    await Bun.write(`${folder}/swap.cube`, lines.join("\n"));
    await page.tab.files([`${folder}/swap.cube`]);
    await pressReal("read .cube");
    await page.until("window.app.editing().steps().find((step) => step.type === 'grade')?.grade.lut?.name === 'Swap'");
    expect((await gradeOf())?.warmth).toBe(30);
    // a hostile one is refused, and the grade keeps what it had
    await Bun.write(`${folder}/bad.cube`, "LUT_3D_SIZE 9999\n");
    await page.tab.files([`${folder}/bad.cube`]);
    await pressReal("read .cube");
    await page.until("document.querySelector('.quire-status')?.textContent?.includes('Not read') || document.body.textContent.includes('could not be read')");
    expect((await gradeOf())?.lut?.name).toBe("Swap");
    // written as a .cube: 33 a side
    await page.tab.run("[...document.querySelectorAll('.quire-img-looks button')].find((each) => each.textContent === 'write .cube').click()");
    await page.until("Object.keys(window.downloads).some((name) => name.endsWith('.cube'))");
    const text = await page.tab.run<string>("new TextDecoder().decode(new Uint8Array(window.downloads[Object.keys(window.downloads).find((name) => name.endsWith('.cube'))]))");
    expect(text).toContain("LUT_3D_SIZE 33");
    expect(text.trim().split("\n").filter((line) => /^[\d.]/.test(line))).toHaveLength(33 ** 3);
    // forgotten
    await page.tab.run("document.querySelector('.quire-img-look [aria-label=\"Forget the look Warm evening\"]').click()");
    await page.until("![...document.querySelectorAll('.quire-img-look-apply')].some((each) => each.textContent === 'Warm evening')");
}, 90_000);
