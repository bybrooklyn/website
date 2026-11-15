// What running a model tile by tile is held to, with steps written here standing in for a model: the tiles
// cover the picture once, their middles side by side and their margins held to the picture; a step that
// blurs and enlarges twice gives, tile by tile with a margin as wide as its reach, exactly the pixels it
// gives the whole picture, where with no margin the joins show; the share done rises to one; asked to stop,
// it stops between tiles and hands on nothing more; a step that gives back the wrong size is an error; a
// result past the largest side is refused; and a 50 megapixel photograph, read a tile at a time, is run
// through without holding it, the memory used staying small.

import { expect, test } from "bun:test";
import { intoPicture, largestScale, planTiles, runTiles, Stopped, type Pixels } from "./tiles";

/** A busy picture made here: stripes, a gradient and dots, any part of it worked out on its own. */
const pixelAt = (x: number, y: number, channel: number) => (channel === 3 ? 255 : (x * (3 + channel) + y * (5 - channel) + ((x * y) % 7) * 20) % 256);
function partOf(rect: { x: number; y: number; width: number; height: number }): Pixels {
    const data = new Uint8ClampedArray(rect.width * rect.height * 4);
    for (let y = 0; y < rect.height; y++) for (let x = 0; x < rect.width; x++) for (let c = 0; c < 4; c++) data[(y * rect.width + x) * 4 + c] = pixelAt(rect.x + x, rect.y + y, c);
    return { width: rect.width, height: rect.height, data };
}

/** A 3 by 3 box blur, the edges carried on: the reach of one pixel. */
function blur(pixels: Pixels): Pixels {
    const { width, height } = pixels;
    const data = new Uint8ClampedArray(pixels.data.length);
    for (let y = 0; y < height; y++)
        for (let x = 0; x < width; x++)
            for (let c = 0; c < 4; c++) {
                let sum = 0;
                for (let j = -1; j <= 1; j++) for (let i = -1; i <= 1; i++) sum += pixels.data[(Math.min(height - 1, Math.max(0, y + j)) * width + Math.min(width - 1, Math.max(0, x + i))) * 4 + c]!;
                data[(y * width + x) * 4 + c] = Math.round(sum / 9);
            }
    return { width, height, data };
}

/** Twice as large, between pixels by straight lines (pixel middles kept where they fall), the edges carried on: the reach of one pixel more. */
function twice(pixels: Pixels): Pixels {
    const { width, height } = pixels;
    const out = { width: width * 2, height: height * 2, data: new Uint8ClampedArray(width * height * 16) };
    const at = (x: number, y: number, c: number) => pixels.data[(Math.min(height - 1, Math.max(0, y)) * width + Math.min(width - 1, Math.max(0, x))) * 4 + c]!;
    for (let y = 0; y < out.height; y++)
        for (let x = 0; x < out.width; x++) {
            const u = (x + 0.5) / 2 - 0.5;
            const v = (y + 0.5) / 2 - 0.5;
            const x0 = Math.floor(u);
            const y0 = Math.floor(v);
            for (let c = 0; c < 4; c++) {
                const top = at(x0, y0, c) * (1 - (u - x0)) + at(x0 + 1, y0, c) * (u - x0);
                const bottom = at(x0, y0 + 1, c) * (1 - (u - x0)) + at(x0 + 1, y0 + 1, c) * (u - x0);
                out.data[(y * out.width + x) * 4 + c] = Math.round(top * (1 - (v - y0)) + bottom * (v - y0));
            }
        }
    return out;
}

/** The stand-in model: blurred twice, then made twice as large; it reaches three pixels of the input. */
const model = (pixels: Pixels) => twice(blur(blur(pixels)));

test("the tiles cover the picture once, their margins held to it", () => {
    const plan = planTiles({ width: 300, height: 200 }, { tile: 64, margin: 8, scale: 2 })!;
    expect(plan.width).toBe(600);
    expect(plan.tiles).toHaveLength(5 * 4);
    const covered = new Uint8Array(300 * 200);
    for (const tile of plan.tiles) {
        for (let y = tile.keep.y; y < tile.keep.y + tile.keep.height; y++) for (let x = tile.keep.x; x < tile.keep.x + tile.keep.width; x++) covered[y * 300 + x]!++;
        expect(tile.read.x).toBeGreaterThanOrEqual(0);
        expect(tile.read.x + tile.read.width).toBeLessThanOrEqual(300);
        expect(tile.read.x + tile.inside.x).toBe(tile.keep.x);
        expect(tile.out).toEqual({ x: tile.keep.x * 2, y: tile.keep.y * 2, width: tile.keep.width * 2, height: tile.keep.height * 2 });
    }
    expect(covered.every((count) => count === 1)).toBe(true);
});

test("tile by tile with a margin as wide as the step's reach, the result is exactly the whole picture's, and with none the joins show", async () => {
    const size = { width: 300, height: 200 };
    const whole = model(partOf({ x: 0, y: 0, ...size }));
    for (const [margin, same] of [[3, true], [8, true], [0, false]] as const) {
        const plan = planTiles(size, { tile: 64, margin, scale: 2 })!;
        const into = intoPicture(plan);
        await runTiles(plan, partOf, model, into.keep);
        const apart = into.pixels.data.reduce((most, value, at) => Math.max(most, Math.abs(value - whole.data[at]!)), 0);
        expect(apart === 0).toBe(same);
    }
});

test("the share done rises to one; asked to stop it stops between tiles and hands on nothing more; a step of the wrong size is an error", async () => {
    const plan = planTiles({ width: 200, height: 200 }, { tile: 50, margin: 4, scale: 1 })!;
    const shares: number[] = [];
    await runTiles(plan, partOf, blur, () => {}, { progress: (share) => shares.push(share) });
    expect(shares).toHaveLength(16);
    expect(shares.every((share, at) => at === 0 || share > shares[at - 1]!)).toBe(true);
    expect(shares.at(-1)).toBe(1);
    const stop = new AbortController();
    let kept = 0;
    const stopped = runTiles(plan, partOf, blur, () => void (++kept === 3 && stop.abort()), { signal: stop.signal });
    await expect(stopped).rejects.toBeInstanceOf(Stopped);
    expect(kept).toBe(3);
    await expect(runTiles(plan, partOf, (pixels) => ({ ...pixels, width: pixels.width + 1 }), () => {})).rejects.toThrow("the step gave");
});

test("a result past the largest side is refused, and the largest scale that fits is known", () => {
    const fifty = { width: 8660, height: 5774 };
    expect(planTiles(fifty, { tile: 1024, margin: 32, scale: 2 })).toBeUndefined();
    expect(largestScale(fifty)).toBe(1);
    expect(largestScale({ width: 4000, height: 3000 })).toBe(4);
    expect(planTiles({ width: 4000, height: 3000 }, { tile: 512, margin: 32, scale: 4 })!.width).toBe(16_000);
    expect(planTiles({ width: 10, height: 10 }, { tile: 0, margin: 0, scale: 1 })).toBeUndefined();
});

test("a 50 megapixel photograph is run through a tile at a time without being held, the memory used staying small", async () => {
    const size = { width: 8660, height: 5774 };
    const plan = planTiles(size, { tile: 1024, margin: 8, scale: 1 })!;
    Bun.gc(true);
    const before = process.memoryUsage().rss;
    let most = before;
    let sum = 0;
    const started = performance.now();
    await runTiles(plan, partOf, blur, (out, part) => {
        for (let at = 0; at < part.data.length; at += 997) sum = (sum + part.data[at]!) % 1_000_003;
        // what is held, not what waits to be collected: among two hundred other test files the garbage of a few tiles came to more than the bound
        Bun.gc(true);
        most = Math.max(most, process.memoryUsage().rss);
    });
    const grown = (most - before) / 1e6;
    console.log(`50 megapixels in ${plan.tiles.length} tiles through a 3 by 3 blur in ${((performance.now() - started) / 1000).toFixed(1)} s; memory grew by ${grown.toFixed(0)} MB at most, against ${((size.width * size.height * 4) / 1e6).toFixed(0)} MB for the picture held whole`);
    expect(sum).toBeGreaterThan(0);
    expect(grown).toBeLessThan(120);
}, 120_000);
