// What the cut-out's edges are held to, on a figure drawn here with strands of hair finer than the
// mask's pixels against a green ground, its true mask known: the mask found at a quarter size laid over the full-size picture by the guided filter follows the real
// edges more closely than the same mask simply enlarged; and with the old ground's color taken out of
// the edge pixels, their color is the figure's, where the picture's own edge colors are half green (the
// halo a cut-out shows on a new background). The numbers are printed. Also: a box average is the mean
// of its square, and a flat mask gives itself back.

import { expect, test } from "bun:test";
import { applyOne, boxMean, lowOf, readLow } from "./refine";

const W = 480;
const H = 320;
const FIGURE: [number, number, number] = [0.95, 0.82, 0.66];
const GROUND: [number, number, number] = [0.18, 0.62, 0.2];

/** The true mask of the figure: a disc with strands a pixel wide running out of it, each pixel's share found by sixteen samples. */
function trueMask(): Float32Array {
    const mask = new Float32Array(W * H);
    const strands = Array.from({ length: 40 }, (_, at) => {
        const angle = Math.PI * (1.1 + (at / 40) * 0.8);
        return { x0: 240 + Math.cos(angle) * 60, y0: 190 + Math.sin(angle) * 60, x1: 240 + Math.cos(angle) * 140, y1: 190 + Math.sin(angle) * 135 };
    });
    const on = (x: number, y: number) => {
        if (Math.hypot(x - 240, y - 190) < 70) return true;
        return strands.some(({ x0, y0, x1, y1 }) => {
            const dx = x1 - x0;
            const dy = y1 - y0;
            const t = Math.max(0, Math.min(1, ((x - x0) * dx + (y - y0) * dy) / (dx * dx + dy * dy)));
            return Math.hypot(x - x0 - t * dx, y - y0 - t * dy) < 0.6;
        });
    };
    for (let y = 0; y < H; y++)
        for (let x = 0; x < W; x++) {
            let count = 0;
            for (let j = 0; j < 4; j++) for (let i = 0; i < 4; i++) if (on(x + (i + 0.5) / 4, y + (j + 0.5) / 4)) count++;
            mask[y * W + x] = count / 16;
        }
    return mask;
}

/** A plane made a quarter of its size by averaging. */
function quarter(plane: Float32Array, width: number, height: number, channels = 1): Float32Array {
    const out = new Float32Array((width / 4) * (height / 4) * channels);
    for (let y = 0; y < height / 4; y++)
        for (let x = 0; x < width / 4; x++)
            for (let c = 0; c < channels; c++) {
                let sum = 0;
                for (let j = 0; j < 4; j++) for (let i = 0; i < 4; i++) sum += plane[((y * 4 + j) * width + x * 4 + i) * channels + c]!;
                out[(y * (width / 4) + x) * channels + c] = sum / 16;
            }
    return out;
}

test("a box average is the mean of its square, cut at the edges, and a flat mask comes back flat", () => {
    const plane = Float32Array.from([1, 2, 3, 4, 5, 6, 7, 8, 9]);
    const mean = boxMean(plane, 3, 3, 1);
    expect(mean[4]).toBeCloseTo(5, 6);
    expect(mean[0]).toBeCloseTo((1 + 2 + 4 + 5) / 4, 6);
    const flat = new Float32Array(64).fill(1);
    const rgba = new Uint8ClampedArray(64 * 4).fill(128);
    const low = lowOf(flat, rgba, 8, 8);
    const fitted = [0, 1, 2].reduce((sum, c) => sum + readLow(low.a, 8, 8, 0.5, 0.5, 3, c) * 0.5, readLow(low.b, 8, 8, 0.5, 0.5));
    expect(fitted).toBeCloseTo(1, 5);
});

test("on fine strands against a green ground, the guided mask follows the true edges better than the mask enlarged, and with the ground's color taken out the edges carry no green halo", () => {
    const truth = trueMask();
    const picture = new Float32Array(W * H * 3);
    for (let at = 0; at < W * H; at++) for (let c = 0; c < 3; c++) picture[at * 3 + c] = FIGURE[c]! * truth[at]! + GROUND[c]! * (1 - truth[at]!);
    // the model's mask: the true one at a quarter size, each of its pixels the share of the figure in it, as a model at its own size gives
    const small = { width: W / 4, height: H / 4 };
    const found = quarter(truth, W, H);
    const smallPicture = quarter(picture, W, H, 3);
    const rgba = new Uint8ClampedArray(small.width * small.height * 4);
    for (let at = 0; at < small.width * small.height; at++) {
        for (let c = 0; c < 3; c++) rgba[at * 4 + c] = Math.round(smallPicture[at * 3 + c]! * 255);
        rgba[at * 4 + 3] = 255;
    }
    const low = lowOf(found, rgba, small.width, small.height);
    let edges = 0;
    let guidedError = 0;
    let enlargedError = 0;
    let haloCut = 0;
    let haloPlain = 0;
    for (let y = 0; y < H; y++)
        for (let x = 0; x < W; x++) {
            const at = y * W + x;
            const alpha = truth[at]!;
            // the band round the figure's edges and its strands
            if (alpha <= 0.1 || alpha >= 0.95) continue;
            edges++;
            const u = (x + 0.5) / W;
            const v = (y + 0.5) / H;
            const rgb: [number, number, number] = [picture[at * 3]!, picture[at * 3 + 1]!, picture[at * 3 + 2]!];
            const [r, g, b, a] = applyOne(low, rgb, u, v, { kind: "clear" });
            const enlarged = Math.min(1, Math.max(0, readLow(found, small.width, small.height, u, v)));
            guidedError += Math.abs(a - alpha);
            enlargedError += Math.abs(enlarged - alpha);
            // the halo: how far the edge's kept color is from the figure's own, the ground's green left in it
            haloCut += (Math.abs(r - FIGURE[0]) + Math.abs(g - FIGURE[1]) + Math.abs(b - FIGURE[2])) / 3;
            haloPlain += (Math.abs(rgb[0] - FIGURE[0]) + Math.abs(rgb[1] - FIGURE[1]) + Math.abs(rgb[2] - FIGURE[2])) / 3;
        }
    const said = (value: number) => ((value / edges) * 255).toFixed(1);
    console.log(`over ${edges} edge pixels (true share 0.1 to 0.95): the mask's error ${said(guidedError)} of 255 guided, ${said(enlargedError)} enlarged; the halo (the edge color's distance from the figure's) ${said(haloCut)} of 255 with the ground taken out, ${said(haloPlain)} without`);
    expect(guidedError).toBeLessThan(enlargedError * 0.2);
    expect(haloCut).toBeLessThan(haloPlain * 0.4);
    // and no worse than before sharp edges were tightened (15.5 of 255 then)
    expect((haloCut / edges) * 255).toBeLessThan(16);
});

test("across a sharp edge between a red coat and green grass of one lightness, the cut's edge is as sharp as the picture's, where the mask enlarged is several pixels soft", () => {
    const coat: [number, number, number] = [0.72, 0.27, 0.18];
    const grass: [number, number, number] = [0.31, 0.56, 0.29];
    // a straight edge down the picture at x = 240.4: the pixel it crosses part coat, the rest whole
    const truth = new Float32Array(W * H);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) truth[y * W + x] = Math.min(1, Math.max(0, 240.4 - x));
    const picture = new Float32Array(W * H * 3);
    for (let at = 0; at < W * H; at++) for (let c = 0; c < 3; c++) picture[at * 3 + c] = coat[c]! * truth[at]! + grass[c]! * (1 - truth[at]!);
    // the model's mask at a quarter size, softened once more, as a model's edge is: the rim a soft mask leaves on a new background
    const small = { width: W / 4, height: H / 4 };
    const found = boxMean(quarter(truth, W, H), small.width, small.height, 1);
    const smallPicture = quarter(picture, W, H, 3);
    const rgba = new Uint8ClampedArray(small.width * small.height * 4);
    for (let at = 0; at < small.width * small.height; at++) {
        for (let c = 0; c < 3; c++) rgba[at * 4 + c] = Math.round(smallPicture[at * 3 + c]! * 255);
        rgba[at * 4 + 3] = 255;
    }
    const low = lowOf(found, rgba, small.width, small.height);
    // the band of partly clear pixels across the edge (a share from 0.05 to 0.95), its width a row, on average
    let cutBand = 0;
    let enlargedBand = 0;
    for (let y = 40; y < H - 40; y++)
        for (let x = 200; x < 280; x++) {
            const at = y * W + x;
            const u = (x + 0.5) / W;
            const v = (y + 0.5) / H;
            const alpha = applyOne(low, [picture[at * 3]!, picture[at * 3 + 1]!, picture[at * 3 + 2]!], u, v, { kind: "clear" })[3];
            const enlarged = readLow(found, small.width, small.height, u, v);
            if (alpha > 0.05 && alpha < 0.95) cutBand++;
            if (enlarged > 0.05 && enlarged < 0.95) enlargedBand++;
        }
    const rows = H - 80;
    console.log(`across a sharp edge of two colors of one lightness: the band of partly clear pixels is ${(cutBand / rows).toFixed(2)} wide in the cut, ${(enlargedBand / rows).toFixed(2)} in the mask enlarged`);
    // the stated bound: the band of partly clear pixels across a sharp edge at most a pixel and a half wide
    expect(cutBand / rows).toBeLessThanOrEqual(1.5);
    expect(enlargedBand / rows).toBeGreaterThan(4);
});

