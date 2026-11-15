// What finding lines is held to: a drawn building's straight edges are found where they were drawn; lines
// that meet are found to meet where they do, and parallel lines far away; a building photographed with the
// camera tilted up, turned and rolled (drawn here through the camera's own map, with grain) is straightened
// by the turns it was taken at, within a few tenths of a degree, the upright lines then plumb; and a picture
// of soft clouds and grain, or one with a few lines scattered every way, has nothing clear and gets nothing.

import { expect, test } from "bun:test";
import { grey, meeting, segments, straighten, type Segment } from "./lines";
import { apply, assumedFocal, invert, multiply, tilted, type Matrix } from "./homography";

/** A little grain, the same each run. */
function grain(seed: number) {
    let state = seed;
    return () => {
        state = (state * 1664525 + 1013904223) >>> 0;
        return state / 2 ** 32 - 0.5;
    };
}

/** A building's face as it stands: a pale wall with rows of dark windows, sky above and a darker street below, at a place on the level picture. */
function building(x: number, y: number, size: { width: number; height: number }): number {
    const { width, height } = size;
    const left = width * 0.2;
    const right = width * 0.8;
    const top = height * 0.12;
    const foot = height * 0.9;
    if (y > foot) return 0.25;
    if (x < left || x > right || y < top) return 0.8 - (0.3 * y) / height;
    const column = (x - left) / ((right - left) / 6);
    const row = (y - top) / ((foot - top) / 7);
    const inWindow = column % 1 > 0.25 && column % 1 < 0.75 && row % 1 > 0.2 && row % 1 < 0.8;
    return inWindow ? 0.15 : 0.62;
}

/** The building photographed by a camera tilted, turned and rolled by some degrees: each pixel looks up where the straightened picture has it, four samples to a pixel, with grain. */
function photograph(size: { width: number; height: number }, vertical: number, horizontal: number, roll: number): Float32Array {
    const radians = (roll * Math.PI) / 180;
    const c = Math.cos(radians);
    const s = Math.sin(radians);
    const cx = size.width / 2;
    const cy = size.height / 2;
    const rolled: Matrix = [c, -s, cx - c * cx + s * cy, s, c, cy - s * cx - c * cy, 0, 0, 1];
    // the map that straightens: the camera's tilt and turn, then the roll
    const straightening = multiply(rolled, tilted(vertical, horizontal, size, assumedFocal(size)));
    const out = new Float32Array(size.width * size.height);
    const noise = grain(7);
    for (let y = 0; y < size.height; y++)
        for (let x = 0; x < size.width; x++) {
            let sum = 0;
            for (const [dx, dy] of [[0.25, 0.25], [0.75, 0.25], [0.25, 0.75], [0.75, 0.75]] as const) {
                const there = apply(straightening, { x: x + dx, y: y + dy });
                sum += building(there.x, there.y, size);
            }
            out[y * size.width + x] = Math.min(1, Math.max(0, sum / 4 + noise() * 0.04));
        }
    expect(invert(straightening)).toBeDefined();
    return out;
}

test("a drawn building's straight edges are found where they were drawn", () => {
    const size = { width: 600, height: 450 };
    const picture = photograph(size, 0, 0, 0);
    const found = segments(picture, size.width, size.height);
    // the wall's two sides are found as long upright lines at a fifth and four fifths of the way across, down to where the sky fades to the wall's own grey
    const uprights = found.filter((s) => Math.abs(s.x2 - s.x1) < 2 && s.length > 100);
    for (const side of [120, 480]) expect(uprights.some((s) => Math.abs((s.x1 + s.x2) / 2 - side) < 2)).toBe(true);
    // and the window rows as level lines
    expect(found.filter((s) => Math.abs(s.y2 - s.y1) < 2 && s.length > 20).length).toBeGreaterThan(20);
});

test("lines that meet are found to meet where they do, and parallel lines far away", () => {
    const toward = { x: 300, y: -900 };
    const lines: Segment[] = [100, 200, 300, 420, 550].map((x) => {
        const at = 0.8;
        const x2 = x + (toward.x - x) * 0.3;
        const y2 = 400 + (toward.y - 400) * 0.3;
        return { x1: x, y1: 400, x2: x + (x2 - x) * at, y2: 400 + (y2 - 400) * at, length: 0 };
    });
    for (const line of lines) line.length = Math.hypot(line.x2 - line.x1, line.y2 - line.y1);
    const found = meeting(lines)!;
    expect(found.agreeing.length).toBe(5);
    expect(Math.abs(found.meeting[0] / found.meeting[2] - toward.x)).toBeLessThan(0.5);
    expect(Math.abs(found.meeting[1] / found.meeting[2] - toward.y)).toBeLessThan(0.5);
    const parallel = meeting([0, 1, 2].map((at) => ({ x1: at * 50, y1: 0, x2: at * 50, y2: 100, length: 100 })))!;
    expect(Math.abs(parallel.meeting[2])).toBeLessThan(1e-9);
});

test("a building taken with the camera tilted, turned and rolled is straightened by the turns it was taken at", () => {
    const size = { width: 640, height: 480 };
    for (const [vertical, horizontal, roll] of [[8, 0, 0], [-6, 0, 2], [12, 5, -1.5], [4, -9, 0]] as const) {
        const picture = photograph(size, vertical, horizontal, roll);
        const fix = straighten(segments(picture, size.width, size.height), size, size)!;
        expect(fix).toBeDefined();
        expect(Math.abs(fix.vertical - vertical)).toBeLessThan(0.6);
        expect(Math.abs(fix.turn - roll)).toBeLessThan(0.4);
        // the turn left or right is read from the window rows, which are clear here
        expect(fix.level).toBeGreaterThan(0);
        expect(Math.abs(fix.horizontal - horizontal)).toBeLessThan(1);
    }
});

test("a copy read small straightens the original the same way", () => {
    const small = { width: 640, height: 480 };
    const picture = photograph(small, 9, 0, 1);
    // the same picture said to be a 4000 by 3000 original: the turns are the camera's, so they are the same
    const fix = straighten(segments(picture, small.width, small.height), small, small)!;
    const big = straighten(segments(picture, small.width, small.height), small, { width: 4000, height: 3000 })!;
    expect(Math.abs(big.vertical - fix.vertical)).toBeLessThan(0.05);
    expect(Math.abs(big.turn - fix.turn)).toBeLessThan(0.05);
});

test("soft clouds and grain, or a few lines scattered every way, have nothing clear", () => {
    const size = { width: 400, height: 300 };
    const noise = grain(3);
    const clouds = new Float32Array(size.width * size.height);
    for (let y = 0; y < size.height; y++) for (let x = 0; x < size.width; x++) clouds[y * size.width + x] = 0.5 + 0.2 * Math.sin(x / 37) * Math.cos(y / 23) + 0.1 * Math.sin((x + y) / 11) + noise() * 0.08;
    expect(straighten(segments(clouds, size.width, size.height), size, size)).toBeUndefined();
    const scattered = new Float32Array(size.width * size.height).fill(0.5);
    const draw = (x1: number, y1: number, x2: number, y2: number) => {
        for (let t = 0; t <= 1; t += 0.002) for (let w = -1; w <= 1; w++) scattered[Math.round(y1 + (y2 - y1) * t + w) * size.width + Math.round(x1 + (x2 - x1) * t)] = 0.05;
    };
    draw(40, 40, 70, 250);
    draw(300, 30, 380, 120);
    draw(100, 200, 350, 230);
    expect(straighten(segments(scattered, size.width, size.height), size, size)).toBeUndefined();
    // the grey of RGBA bytes is the usual weighted sum
    expect(grey(new Uint8ClampedArray([255, 0, 0, 255]), 1, 1)[0]).toBeCloseTo(0.299, 6);
});
