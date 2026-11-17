// Mote's grid of cells: placed in whole pixels, and drawn in headless Chromium with its pixels read
// back, so a shader that does not compile, a color read from the wrong byte, or a row sent that
// should not have been, fails here. The drawing is skipped, with a notice, on a machine with no Chromium.

import { expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { browser, chromium } from "../../scripts/browser";
import { blurred, cellUnder, fitted, keptCell, seenCell, type Place } from "./cells";

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

test("the blur's weights add up to one, and each pair of texels is read once between them", () => {
    const { offsets, weights } = blurred(6, 2.6);
    expect(offsets.length).toBe(4);
    expect(weights[0]! + 2 * weights.slice(1).reduce((sum, one) => sum + one, 0)).toBeCloseTo(1, 6);
    // a pair's sample lies between its two texels, nearer the heavier
    expect(offsets[1]!).toBeGreaterThan(1);
    expect(offsets[1]!).toBeLessThan(1.5);
    expect(offsets[3]!).toBeGreaterThan(5);
});

// A grid of 256 by 256, a pixel a cell: a striped cell taking its color from the third row, a block of
// hot cells that give light, and far from it, past where the halo reaches, a cold one of the same kind.
const lit = `
import { cells, fitted, STRIPED, LIGHT } from "${here}/cells.ts";
const N = 256;
const canvas = document.querySelector("canvas");
canvas.width = N; canvas.height = N;
const grid = cells(canvas);
const colors = new Uint8Array(3072);
colors.set([10, 10, 10, 255], 4);           // 1 is striped
colors.set([0, 0, 0, STRIPED], 1024 + 4);
colors.set([0, 200, 100, 255], 2048 + 5 * 4); // stripe 5 is green
colors.set([255, 160, 40, 255], 8);         // 2 gives light
colors.set([0, 0, 0, LIGHT], 1024 + 8);
grid.palette(colors);
grid.place(fitted(N, N, N, N));
const bytes = new Uint8Array(N * N * 4);
const set = (column, row, material, shade, third) => bytes.set([material, shade, third, 0], (row * N + column) * 4);
set(0, N - 1, 1, 5 * 4 + 1, 0);
for (let y = 5; y <= 8; y++) for (let x = 5; x <= 8; x++) set(x, y, 2, 128, 250);
set(228, 228, 2, 128, 40);
grid.draw(bytes, N, 0, 0, N - 1);
const g = canvas.getContext("webgl2");
const pixels = new Uint8Array(N * N * 4);
g.readPixels(0, 0, N, N, g.RGBA, g.UNSIGNED_BYTE, pixels);
const at = (x, y) => [...pixels.slice(((N - 1 - y) * N + x) * 4, ((N - 1 - y) * N + x) * 4 + 4)];
window.result = { striped: at(0, N - 1), hot: at(6, 6), near: at(11, 6), halo: at(36, 6), coldBeside: at(227, 228), corner: at(N - 1, 0) };
`;

test.skipIf(!chromium())("a striped cell takes its stripe's color, and a hot cell lights the air around it while a cold one does not", async () => {
    const folder = await mkdtemp(join(tmpdir(), "mote-cells-"));
    const tab = await browser({ width: 300, height: 200 });
    try {
        await Bun.write(`${folder}/scene.ts`, lit);
        const built = await Bun.build({ entrypoints: [`${folder}/scene.ts`], target: "browser" });
        await Bun.write(`${folder}/page.html`, `<!doctype html><canvas style="width:256px;height:256px"></canvas><script type="module">${await built.outputs[0]!.text()}</script>`);
        await tab.open(`file://${folder}/page.html`);
        expect(tab.errors).toEqual([]);
        const result = await tab.run<Record<string, number[]>>("window.result");
        // the stripe's green, the slight shade moving it by nothing as the second row's range is 0: not the material's own grey
        expect(result.striped!.slice(0, 3)).toEqual([0, 200, 100]);
        // the hot cells are drawn whole; the air three cells from them is lit, warm, and as opaque as it is bright
        expect(result.hot![3]).toBe(255);
        expect(result.near![0]!).toBeGreaterThan(8);
        expect(result.near![0]!).toBeGreaterThan(result.near![2]!);
        expect(result.near![3]!).toBe(Math.max(...result.near!.slice(0, 3)));
        // thirty cells from them, past the near glow, the air still has their halo, fainter and as warm
        expect(result.halo![0]!).toBeGreaterThan(0);
        expect(result.halo![0]!).toBeLessThan(result.near![0]!);
        expect(result.halo![0]!).toBeGreaterThanOrEqual(result.halo![2]!);
        // the cold one gives none, and the far corner has none of the hot ones'
        expect(result.coldBeside).toEqual([0, 0, 0, 0]);
        expect(result.corner).toEqual([0, 0, 0, 0]);
    } finally {
        await tab.close();
        await rm(folder, { recursive: true, force: true });
    }
}, 30_000);

// A grid of 64 by 64 seen through a canvas of 32 by 32: nearer, two pixels a cell from its cell (32, 0),
// and farther, half a pixel a cell with the whole of it in view and room left under it.
const viewed = `
import { cells } from "${here}/cells.ts";
const canvas = document.querySelector("canvas");
canvas.width = 32; canvas.height = 32;
const grid = cells(canvas);
const colors = new Uint8Array(3072);
colors.set([200, 0, 0, 255], 4);            // 1 is red
colors.set([0, 0, 200, 255], 8);            // 2 is blue
grid.palette(colors);
const bytes = new Uint8Array(64 * 64 * 4);
const set = (column, row, material) => bytes.set([material, 128, 0, 0], (row * 64 + column) * 4);
set(40, 10, 1);
set(0, 0, 2); set(1, 1, 2);
const g = canvas.getContext("webgl2");
const pixels = new Uint8Array(32 * 32 * 4);
const at = (x, y) => [...pixels.slice(((31 - y) * 32 + x) * 4, ((31 - y) * 32 + x) * 4 + 4)];
const seen = () => g.readPixels(0, 0, 32, 32, g.RGBA, g.UNSIGNED_BYTE, pixels);
grid.place({ columns: 64, rows: 64, scale: 2, left: -64, top: 0 });
grid.draw(bytes, 64, 0, 0, 63);
seen();
const near = { cell: at(16, 20), cellEnd: at(17, 21), beside: at(18, 20), above: at(16, 19) };
grid.place({ columns: 64, rows: 64, scale: 0.5, left: 0, top: 0 });
grid.draw(bytes, 64, 0, 0, -1);
seen();
window.result = { near, far: { two: at(0, 0), red: at(20, 5), empty: at(10, 10), past: at(5, 32 - 1) } };
`;

test.skipIf(!chromium())("a grid larger than its canvas is seen in part, each cell as many pixels as the view says, and far out the cells a pixel covers are drawn together", async () => {
    const folder = await mkdtemp(join(tmpdir(), "mote-cells-"));
    const tab = await browser({ width: 300, height: 200 });
    try {
        await Bun.write(`${folder}/scene.ts`, viewed);
        const built = await Bun.build({ entrypoints: [`${folder}/scene.ts`], target: "browser" });
        await Bun.write(`${folder}/page.html`, `<!doctype html><canvas style="width:32px;height:32px"></canvas><script type="module">${await built.outputs[0]!.text()}</script>`);
        await tab.open(`file://${folder}/page.html`);
        expect(tab.errors).toEqual([]);
        const { near, far } = await tab.run<Record<string, Record<string, number[]>>>("window.result");
        // nearer: cell (40, 10) is the two by two pixels from (16, 20), and nothing beside or above it
        expect(near!.cell).toEqual([200, 0, 0, 255]);
        expect(near!.cellEnd).toEqual([200, 0, 0, 255]);
        expect(near!.beside).toEqual([0, 0, 0, 0]);
        expect(near!.above).toEqual([0, 0, 0, 0]);
        // farther: a pixel is four cells; two of the first four are blue, so it is half blue, half clear
        expect(far!.two![2]).toBeGreaterThan(90);
        expect(far!.two![2]).toBeLessThan(110);
        expect(far!.two![3]).toBeGreaterThan(120);
        expect(far!.two![3]).toBeLessThan(135);
        // one red cell of four: a quarter of it
        expect(far!.red![0]).toBeGreaterThan(40);
        expect(far!.red![0]).toBeLessThan(60);
        expect(far!.empty).toEqual([0, 0, 0, 0]);
        // and past the grid's last row, which ends halfway down the canvas, nothing is drawn
        expect(far!.past).toEqual([0, 0, 0, 0]);
    } finally {
        await tab.close();
        await rm(folder, { recursive: true, force: true });
    }
}, 30_000);

// A grid seen 64 by 32 whose cells are kept a quarter turned, 32 by 64: a cell kept at (5, 53) is seen
// at (10, 5), and one kept at (0, 0) in the top right corner.
const turned = `
import { cells, keptCell } from "${here}/cells.ts";
const canvas = document.querySelector("canvas");
canvas.width = 64; canvas.height = 32;
const grid = cells(canvas);
const colors = new Uint8Array(3072);
colors.set([200, 0, 0, 255], 4);
colors.set([0, 0, 200, 255], 8);
grid.palette(colors);
const bytes = new Uint8Array(32 * 64 * 4);
const set = ([column, row], material) => bytes.set([material, 128, 0, 0], (row * 32 + column) * 4);
set(keptCell([10, 5], 1, 64, 32), 1);
set([0, 0], 2);
grid.place({ columns: 64, rows: 32, scale: 1, left: 0, top: 0, turn: 1 });
grid.draw(bytes, 32, 0, 0, 63);
const g = canvas.getContext("webgl2");
const pixels = new Uint8Array(64 * 32 * 4);
g.readPixels(0, 0, 64, 32, g.RGBA, g.UNSIGNED_BYTE, pixels);
const at = (x, y) => [...pixels.slice(((31 - y) * 64 + x) * 4, ((31 - y) * 64 + x) * 4 + 4)];
window.result = { red: at(10, 5), beside: at(11, 5), corner: at(63, 0), other: at(0, 0), where: keptCell([10, 5], 1, 64, 32) };
`;

test("a cell seen is kept a quarter, a half or three quarters turned, and four turns bring it back", () => {
    expect(keptCell([10, 5], 0, 64, 32)).toEqual([10, 5]);
    expect(keptCell([10, 5], 1, 64, 32)).toEqual([5, 53]);
    expect(keptCell([10, 5], 2, 64, 32)).toEqual([53, 26]);
    expect(keptCell([10, 5], 3, 64, 32)).toEqual([26, 10]);
    // a turn of the grid as it is kept, (x, y) to (y, wide - 1 - x), is one more turn here
    const once = keptCell([10, 5], 1, 64, 32);
    expect(keptCell([10, 5], 2, 64, 32)).toEqual([once[1], 32 - 1 - once[0]]);
    // and where a kept cell is seen undoes it, for every turn
    for (const turn of [0, 1, 2, 3]) expect(seenCell(keptCell([10, 5], turn, 64, 32), turn, 64, 32)).toEqual([10, 5]);
});

test.skipIf(!chromium())("a grid whose cells are kept turned is seen as it was", async () => {
    const folder = await mkdtemp(join(tmpdir(), "mote-cells-"));
    const tab = await browser({ width: 300, height: 200 });
    try {
        await Bun.write(`${folder}/scene.ts`, turned);
        const built = await Bun.build({ entrypoints: [`${folder}/scene.ts`], target: "browser" });
        await Bun.write(`${folder}/page.html`, `<!doctype html><canvas style="width:64px;height:32px"></canvas><script type="module">${await built.outputs[0]!.text()}</script>`);
        await tab.open(`file://${folder}/page.html`);
        expect(tab.errors).toEqual([]);
        const result = await tab.run<Record<string, number[]>>("window.result");
        expect(result.where).toEqual([5, 53]);
        expect(result.red).toEqual([200, 0, 0, 255]);
        expect(result.beside).toEqual([0, 0, 0, 0]);
        expect(result.corner).toEqual([0, 0, 200, 255]);
        expect(result.other).toEqual([0, 0, 0, 0]);
    } finally {
        await tab.close();
        await rm(folder, { recursive: true, force: true });
    }
}, 30_000);
