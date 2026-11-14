// Finding lines from the detector's map: the tiles cover a picture once each and are given whole
// multiples of 32; a map stitched from tiles is the map; the hull and the smallest rectangle are the
// geometry's own; a level patch becomes a level line grown as PaddleOCR grows it, a slanted one keeps
// its slant, a faint one or a speck is left out; and lines come in reading order.

import { expect, test } from "bun:test";
import { asLine, hull, inReadingOrder, linesIn, middleOf, READING, scaleFor, smallestRectangle, stitch, tiles } from "./detect";
import type { Slanted } from "./pixels";

test("a picture is read at its own size up to 4000 pixels a side", () => {
    expect(scaleFor(1920, 1080)).toBe(1);
    expect(scaleFor(4000, 3000)).toBe(1);
    expect(scaleFor(8000, 6000)).toBe(0.5);
});

test("the tiles' kept parts cover the picture once each, and each is given in multiples of 32", () => {
    for (const [width, height] of [[100, 50], [1280, 1280], [1920, 1080], [4000, 3000], [2600, 1300]] as const) {
        const covered = new Uint8Array(width * height);
        for (const tile of tiles(width, height)) {
            expect(tile.inWidth % 32).toBe(0);
            expect(tile.inHeight % 32).toBe(0);
            expect(tile.width).toBeLessThanOrEqual(1280);
            expect(tile.keep.x).toBeGreaterThanOrEqual(tile.x);
            expect(tile.keep.x + tile.keep.width).toBeLessThanOrEqual(tile.x + tile.width);
            for (let y = tile.keep.y; y < tile.keep.y + tile.keep.height; y++) for (let x = tile.keep.x; x < tile.keep.x + tile.keep.width; x++) covered[y * width + x]!++;
        }
        expect(covered.every((count) => count === 1)).toBe(true);
    }
});

test("a map stitched from tiles is the map the whole picture would give", () => {
    const [width, height] = [2600, 1400];
    const whole = (x: number, y: number) => ((x * 7 + y * 13) % 100) / 100;
    const map = new Uint8Array(width * height);
    for (const tile of tiles(width, height)) {
        const answer = new Float32Array(tile.inWidth * tile.inHeight);
        for (let y = 0; y < tile.height; y++) for (let x = 0; x < tile.width; x++) answer[y * tile.inWidth + x] = whole(tile.x + x, tile.y + y);
        stitch(map, width, tile, answer);
    }
    for (const [x, y] of [[0, 0], [1250, 700], [1300, 1250], [2599, 1399]] as const) expect(map[y * width + x]).toBe(Math.round(whole(x, y) * 255));
});

test("the hull of a square's corners and a point inside is the square, and its smallest rectangle is the square", () => {
    const square = hull([{ x: 0, y: 0 }, { x: 4, y: 0 }, { x: 4, y: 4 }, { x: 0, y: 4 }, { x: 2, y: 2 }]);
    expect(square).toHaveLength(4);
    const box = smallestRectangle(square);
    expect(box.length * box.across).toBeCloseTo(16);
    expect(box.middle.x).toBeCloseTo(2);
    expect(box.middle.y).toBeCloseTo(2);
    // a diamond's smallest rectangle is turned, smaller than the box round it
    const diamond = smallestRectangle(hull([{ x: 5, y: 0 }, { x: 10, y: 5 }, { x: 5, y: 10 }, { x: 0, y: 5 }]));
    expect(diamond.length * diamond.across).toBeCloseTo(50);
});

test("a rectangle is laid as a line reads: along its longer side, left to right, or downwards when upright", () => {
    const level = asLine({ x: 50, y: 20 }, { x: -1, y: 0 }, 80, 10);
    expect(level.along).toEqual({ x: 1, y: -0 });
    expect(level.at.x).toBeCloseTo(10);
    expect(level.at.y).toBeCloseTo(15);
    const upright = asLine({ x: 20, y: 50 }, { x: 1, y: 0 }, 10, 80);
    expect(upright.along.y).toBe(1);
    expect(upright.length).toBe(80);
    expect(middleOf(upright).x).toBeCloseTo(20);
    expect(middleOf(upright).y).toBeCloseTo(50);
});

/** A map with patches of certainty drawn in. */
function mapWith(width: number, height: number, draw: (x: number, y: number) => number) {
    const map = new Uint8Array(width * height);
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) map[y * width + x] = Math.round(draw(x, y) * 255);
    return map;
}

test("a level patch becomes a level line, grown by its area times 1.4 over its edge", () => {
    // a patch 100 by 10 from (20, 30)
    const map = mapWith(200, 80, (x, y) => (x >= 20 && x < 120 && y >= 30 && y < 40 ? 0.9 : 0));
    const [line] = linesIn(map, 200, 80, { ...READING, sure: 0.5 });
    const by = (100 * 10 * 1.4) / (2 * 110);
    expect(line!.box.length).toBeCloseTo(100 + 2 * by, 3);
    expect(line!.box.height).toBeCloseTo(10 + 2 * by, 3);
    expect(line!.box.at.x).toBeCloseTo(20 - by, 3);
    expect(line!.box.at.y).toBeCloseTo(30 - by, 3);
    expect(line!.sure).toBeCloseTo(0.9, 1);
});

test("a slanted patch keeps its slant", () => {
    const angle = (20 * Math.PI) / 180;
    const along = { x: Math.cos(angle), y: Math.sin(angle) };
    const map = mapWith(300, 200, (x, y) => {
        const u = (x - 150) * along.x + (y - 100) * along.y;
        const v = -(x - 150) * along.y + (y - 100) * along.x;
        return Math.abs(u) < 80 && Math.abs(v) < 8 ? 1 : 0;
    });
    const [line] = linesIn(map, 300, 200);
    expect(Math.atan2(line!.box.along.y, line!.box.along.x)).toBeCloseTo(angle, 1);
    expect(middleOf(line!.box).x).toBeCloseTo(150, -0.5);
});

test("a faint patch and a speck are left out", () => {
    const map = mapWith(200, 100, (x, y) => (x >= 10 && x < 100 && y >= 10 && y < 20 ? 0.3 : x >= 150 && x < 152 && y >= 50 && y < 52 ? 1 : 0));
    expect(linesIn(map, 200, 100, { ...READING, sure: 0.45 })).toEqual([]);
});

test("lines come top to bottom, and left to right along a row", () => {
    const line = (x: number, y: number): { box: Slanted; name: string } => ({ name: `${x},${y}`, box: { at: { x, y }, along: { x: 1, y: 0 }, length: 50, height: 20 } });
    const order = inReadingOrder([line(300, 102), line(10, 300), line(10, 100), line(120, 98)]).map((each) => each.name);
    expect(order).toEqual(["10,100", "120,98", "300,102", "10,300"]);
});
