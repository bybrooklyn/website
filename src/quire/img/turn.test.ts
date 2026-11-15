// What the horizon's arithmetic is held to: a place turned to the level picture and back is where it
// was; the largest upright rectangle inside a turned one is inside it, touches it, and is as large as
// a search over every shape finds, for wide, tall, square and thin pictures at small and large turns;
// a crop of her own is kept, or made smaller about its middle with its shape, and always lies on the
// picture; a frame dragged off the picture stops at its edge; and a line drawn along a tilted horizon
// gives the turn that levels it, from either end, and a line nearer upright makes it plumb.

import { expect, test } from "bun:test";
import { fitInside, fromLevel, inside, keepInside, largestInside, largestSize, levelBox, levelling, toLevel, turnOf } from "./turn";

test("a place turned to the level picture and back is where it was, and the picture's corners are on it", () => {
    const turn = turnOf(7.3, { width: 4000, height: 3000 });
    for (const point of [{ x: 0, y: 0 }, { x: 4000, y: 3000 }, { x: 1234.5, y: 77 }]) {
        const back = fromLevel(toLevel(point, turn), turn);
        expect(Math.abs(back.x - point.x) + Math.abs(back.y - point.y)).toBeLessThan(1e-9);
    }
    // turned clockwise about the middle, the top left corner moves right and up
    const corner = toLevel({ x: 0, y: 0 }, turn);
    expect(corner.x).toBeGreaterThan(0);
    expect(corner.y).toBeLessThan(0);
    const box = levelBox(turn);
    expect(box.width).toBeCloseTo(4000 * Math.cos((7.3 * Math.PI) / 180) + 3000 * Math.sin((7.3 * Math.PI) / 180), 6);
    expect(turnOf(40, { width: 10, height: 10 }).degrees).toBe(15);
});

/** The largest area of an upright rectangle about the middle that lies on the turned picture, found by trying 2,000 widths and halving for each one's height. */
function searched(width: number, height: number, degrees: number): number {
    const turn = turnOf(degrees, { width, height });
    let best = 0;
    const most = levelBox(turn).width;
    for (let step = 1; step <= 2000; step++) {
        const w = (most * step) / 2000;
        let low = 0;
        let high = levelBox(turn).height;
        for (let round = 0; round < 40; round++) {
            const h = (low + high) / 2;
            if (inside({ x: (width - w) / 2, y: (height - h) / 2, width: w, height: h }, turn)) low = h;
            else high = h;
        }
        best = Math.max(best, w * low);
    }
    return best;
}

test("the largest upright rectangle inside the turned picture is as large as a search over every shape finds, lies on it, and touches it", () => {
    for (const [width, height, degrees] of [
        [4000, 3000, 3],
        [4000, 3000, 15],
        [3000, 4000, -9.5],
        [1000, 1000, 12],
        [4000, 300, 6],
        [4000, 300, 14],
    ] as const) {
        const size = largestSize(width, height, degrees);
        const area = size.width * size.height;
        expect(Math.abs(area - searched(width, height, degrees)) / area).toBeLessThan(0.002);
        const turn = turnOf(degrees, { width, height });
        const crop = largestInside(turn);
        expect(inside(crop, turn)).toBe(true);
        // in whole pixels, and no more than a pixel each way short of the exact one
        expect(Number.isInteger(crop.x) && Number.isInteger(crop.width)).toBe(true);
        expect(size.width - crop.width).toBeLessThanOrEqual(2);
        expect(size.height - crop.height).toBeLessThanOrEqual(2);
        expect(inside({ x: crop.x - 1, y: crop.y - 1, width: crop.width + 2, height: crop.height + 2 }, turn)).toBe(false);
    }
    expect(largestInside(turnOf(0, { width: 400, height: 300 }))).toEqual({ x: 0, y: 0, width: 400, height: 300 });
});

test("a crop of her own is kept where it lies on the picture, else made smaller about its middle with its shape, and a dragged frame stops at the edge", () => {
    const turn = turnOf(10, { width: 4000, height: 3000 });
    const small = { x: 1500, y: 1000, width: 800, height: 600 };
    expect(fitInside(small, turn)).toEqual(small);
    const whole = { x: 0, y: 0, width: 4000, height: 3000 };
    const fitted = fitInside(whole, turn);
    expect(inside(fitted, turn)).toBe(true);
    expect(Math.abs(fitted.width / fitted.height - 4 / 3)).toBeLessThan(0.002);
    expect(Math.abs(fitted.x + fitted.width / 2 - 2000)).toBeLessThanOrEqual(1);
    // the frame dragged far off to the right stops where its corner meets the picture's edge
    const moved = keepInside(small, { ...small, x: 3900 }, turn);
    expect(inside(moved, turn)).toBe(true);
    expect(moved.x).toBeGreaterThan(small.x);
    expect(inside({ ...moved, x: moved.x + 2 }, turn)).toBe(false);
});

test("in Chromium, a part painted on the picture is graded where it is on the turned picture, through WebGL2 and WebGPU alike", async () => {
    const { corePage, quire } = await import("../../../scripts/core-page");
    const page = await corePage(
        `
        import { backendFor, gradingWith, loadPicture } from "${quire}/img/draw.ts";
        import { look } from "${quire}/img/steps.ts";
        const canvas = new OffscreenCanvas(600, 400);
        const context = canvas.getContext("2d");
        context.fillStyle = "#606060";
        context.fillRect(0, 0, 600, 400);
        const blob = await canvas.convertToBlob({ type: "image/png" });
        // a hard round part of radius 25 about (150, 150), made much lighter, on the picture turned 12 degrees
        const shown = look({ original: { name: "pictures/p.png", width: 600, height: 400, type: "image/png", bytes: 1 }, steps: [
            { id: "s1", type: "turn", angle: 12 },
            { id: "s2", type: "part", kind: "paint", strokes: [{ size: 25, soft: 0, points: [150, 150] }], feather: 0, grade: { light: 100 } },
        ] });
        window.made = async (only) => {
            const backend = await backendFor(new OffscreenCanvas(1, 1), only);
            if (!backend) return undefined;
            const picture = await loadPicture(backend, blob);
            const pixels = await picture.flatten(shown, 128, gradingWith(shown, "srgb", picture.size));
            picture.destroy();
            return { crop: shown.crop, width: pixels.width, data: [...pixels.data] };
        };
    `,
        { args: ["--enable-unsafe-webgpu"] },
    );
    if (!page) return;
    try {
        const turn = turnOf(12, { width: 600, height: 400 });
        const gl = await page.tab.run<{ crop: { x: number; y: number }; width: number; data: number[] }>(`window.made("WebGL2")`);
        const at = (made: typeof gl, point: { x: number; y: number }) => {
            const x = Math.round(point.x - made.crop.x);
            const y = Math.round(point.y - made.crop.y);
            return made.data[(y * made.width + x) * 4]!;
        };
        // the part's middle, where it is on the turned picture, is lighter; where it would be if the picture were not turned, it is not
        expect(at(gl, toLevel({ x: 150, y: 150 }, turn))).toBeGreaterThan(150);
        expect(at(gl, { x: 150, y: 150 })).toBe(0x60);
        const gpu = await page.tab.run<typeof gl | undefined>(`window.made("WebGPU")`);
        if (!gpu) return console.log("this Chromium has no WebGPU, so it was not compared");
        let most = 0;
        gpu.data.forEach((value, index) => (most = Math.max(most, Math.abs(value - gl.data[index]!))));
        expect(most).toBeLessThanOrEqual(1);
    } finally {
        await page.close();
    }
}, 60_000);

test("a line drawn along a tilted horizon gives the turn that levels it, from either end; a line nearer upright is made plumb", () => {
    const tilted = (degrees: number) => ({ x: 1000 * Math.cos((degrees * Math.PI) / 180), y: 1000 * Math.sin((degrees * Math.PI) / 180) });
    expect(levelling({ x: 0, y: 0 }, tilted(4), 0)).toBe(-4);
    expect(levelling(tilted(4), { x: 0, y: 0 }, 0)).toBe(-4);
    expect(levelling({ x: 0, y: 0 }, tilted(-2.5), 1)).toBe(3.5);
    expect(levelling({ x: 0, y: 0 }, tilted(93), 0)).toBe(-3);
    expect(levelling({ x: 0, y: 0 }, tilted(40), 0)).toBe(-15);
});
