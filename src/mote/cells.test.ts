// Mote's grid of cells: placed in whole pixels, and drawn in headless Chromium with its pixels read
// back, so a shader that does not compile, a color read from the wrong byte, or a row sent that
// should not have been, fails here. The drawing is skipped, with a notice, on a machine with no Chromium.

import { expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { browser, chromium } from "../../scripts/browser";
import { cellUnder, fitted, type Place } from "./cells";

test("a grid is placed in the middle with the largest whole cells that fit, and never less than one pixel", () => {
    expect(fitted(1000, 600, 300, 200)).toEqual({ columns: 300, rows: 200, scale: 3, left: 50, top: 0 });
    // a grid larger than its canvas is still in the middle, cut a little at each edge
    expect(fitted(301, 198, 300, 200)).toEqual({ columns: 300, rows: 200, scale: 1, left: 0, top: -1 });
    expect(fitted(100, 100, 300, 200).scale).toBe(1);
});

test("the cell under a point counts the canvas's pixels per CSS pixel and the grid's corner", () => {
    const at = fitted(1000, 600, 300, 200);
    // CSS pixel (25, 0) on a canvas of two pixels to each CSS pixel is pixel 50, the grid's left edge
    expect(cellUnder(25, 0, at, 2)).toEqual([0, 0]);
    expect(cellUnder(26.4, 1.4, at, 2)).toEqual([0, 0]);
    expect(cellUnder(26.6, 1.6, at, 2)).toEqual([1, 1]);
    expect(cellUnder(10, 10, at, 2)[0]).toBeLessThan(0);
});

// What the page does: a grid of 4 by 3 in a frame of one cell, six cells to a row, drawn three pixels
// to a cell; then a cell is changed in a row that is sent, and another in a row that is not.
const here = import.meta.dir;
const scene = `
import { cells, fitted } from "${here}/cells.ts";
const canvas = document.querySelector("canvas");
canvas.width = 20; canvas.height = 11;
const grid = cells(canvas);
const colors = new Uint8Array(2048);
colors.set([255, 0, 0, 255], 4);          // 1 is red
colors.set([0, 0, 255, 255], 8);          // 2 is blue
colors.set([0, 200, 0, 0], 1024 + 8);     // and blue's shade moves green
grid.palette(colors);
const at = fitted(20, 11, 4, 3);
grid.place(at);
const bytes = new Uint8Array(6 * 5 * 4);
const set = (column, row, material, shade) => bytes.set([material, shade, 0, 0], ((row + 1) * 6 + column + 1) * 4);
set(0, 0, 1, 128);
set(3, 2, 2, 0);
set(2, 1, 2, 255);
const g = canvas.getContext("webgl2");
const read = () => {
    const pixels = new Uint8Array(20 * 11 * 4);
    g.readPixels(0, 0, 20, 11, g.RGBA, g.UNSIGNED_BYTE, pixels);
    // as seen, from the top left
    return (x, y) => [...pixels.slice(((10 - y) * 20 + x) * 4, ((10 - y) * 20 + x) * 4 + 4)];
};
grid.draw(bytes, 6, 1, 0, 2);
const first = read();
set(1, 0, 1, 128);
set(1, 2, 1, 128);
grid.draw(bytes, 6, 1, 2, 2);
const second = read();
window.result = {
    at,
    red: first(4, 1), redEdge: first(6, 3), beside: first(7, 2), outside: first(1, 1),
    darkBlue: first(15, 9), lightBlue: first(12, 5),
    notSent: second(7, 1), sent: second(7, 9),
};
`;

test.skipIf(!chromium())("cells are drawn whole, in their colors and shades, and only the rows sent change", async () => {
    const folder = await mkdtemp(join(tmpdir(), "mote-cells-"));
    const tab = await browser({ width: 300, height: 200 });
    try {
        await Bun.write(`${folder}/scene.ts`, scene);
        const built = await Bun.build({ entrypoints: [`${folder}/scene.ts`], target: "browser" });
        await Bun.write(`${folder}/page.html`, `<!doctype html><canvas style="width:20px;height:11px"></canvas><script type="module">${await built.outputs[0]!.text()}</script>`);
        await tab.open(`file://${folder}/page.html`);
        expect(tab.errors).toEqual([]);
        const result = await tab.run<Record<string, number[]> & { at: Place }>("window.result");
        // three pixels a cell, the grid of 12 by 9 in the middle of 20 by 11: four pixels in from the left, one down
        expect(result.at).toEqual({ columns: 4, rows: 3, scale: 3, left: 4, top: 1 });
        // the top left cell is red from its first pixel to its last, and the next cell is empty
        expect(result.red).toEqual([255, 0, 0, 255]);
        expect(result.redEdge).toEqual([255, 0, 0, 255]);
        expect(result.beside).toEqual([0, 0, 0, 0]);
        expect(result.outside).toEqual([0, 0, 0, 0]);
        // shade 0 takes half the range away and 255 adds it: green moves from 0 (clamped) to about 100
        expect(result.darkBlue).toEqual([0, 0, 255, 255]);
        expect(result.lightBlue![1]!).toBeGreaterThan(95);
        expect(result.lightBlue![1]!).toBeLessThan(105);
        // a change in a row that was not sent is not seen; one in a row that was, is
        expect(result.notSent).toEqual([0, 0, 0, 0]);
        expect(result.sent).toEqual([255, 0, 0, 255]);
    } finally {
        await tab.close();
        await rm(folder, { recursive: true, force: true });
    }
}, 30_000);
