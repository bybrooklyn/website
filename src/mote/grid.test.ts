// What the broad phase is held to: it finds every pair whose boxes overlap, and no other, each once,
// in the order a loop over every pair would meet them; and the table of things that never move finds
// every one a box reaches, and no other, once each, in order. Run with `bun run test`.

import { expect, test } from "bun:test";
import { Grid, Kept } from "./grid";

/** Numbers that look random and are the same every time. */
const dealer = (seed: number) => () => (seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 2 ** 32;

/** Every pair whose boxes overlap and of which one moves, found the slow way, in order. */
function every(grid: Grid, count: number): string[] {
    const { low, high, moves, dims: d } = grid;
    const found: string[] = [];
    for (let i = 0; i < count; i++) {
        for (let j = i + 1; j < count; j++) {
            if (!moves[i] && !moves[j]) continue;
            let overlap = low[i * d]! <= high[i * d]! && low[j * d]! <= high[j * d]!;
            for (let axis = 0; axis < d; axis++) overlap &&= low[i * d + axis]! <= high[j * d + axis]! && low[j * d + axis]! <= high[i * d + axis]!;
            if (overlap) found.push(`${i} ${j}`);
        }
    }
    return found;
}

const listed = (grid: Grid, count: number): string[] => {
    const found: string[] = [];
    for (let i = 0; i < count; i++) for (let k = grid.start[i]!; k < grid.start[i + 1]!; k++) found.push(`${i} ${grid.other[k]!}`);
    return found;
};

/** Fills a grid with small boxes, a few large ones, one far away and one empty, some of them still. */
function scatter(grid: Grid, count: number, seed: number): void {
    const next = dealer(seed);
    const d = grid.dims;
    grid.ready(count);
    for (let i = 0; i < count; i++) {
        const large = next() < 0.03;
        for (let axis = 0; axis < d; axis++) {
            const at = (next() - 0.5) * 200;
            const half = large ? 20 + next() * 80 : 0.5 + next() * 4;
            grid.low[i * d + axis] = at - half;
            grid.high[i * d + axis] = at + half;
        }
        grid.moves[i] = next() < 0.8 ? 1 : 0;
    }
    // one with no shape, and one so far off that its cube would not fit in a number
    grid.low[3 * d] = Infinity;
    grid.high[3 * d] = -Infinity;
    for (let axis = 0; axis < d; axis++) [grid.low[5 * d + axis], grid.high[5 * d + axis]] = [1e15, 1e15 + 3];
}

test("the grid finds exactly the pairs whose boxes overlap, in the order of a loop over every pair, in 2D and 3D", () => {
    for (const dims of [2, 3] as const) {
        for (const [count, seed] of [[10, 1], [300, 2], [2000, 3]] as const) {
            const grid = new Grid(dims);
            scatter(grid, count, seed);
            grid.find(count);
            const slow = every(grid, count);
            if (count > 10) expect(slow.length).toBeGreaterThan(count / 10);
            expect(listed(grid, count)).toEqual(slow);
        }
    }
});

test("the grid gives the same answer when used again with fewer bodies, and finds none when nothing moves", () => {
    const grid = new Grid(2);
    scatter(grid, 500, 9);
    grid.find(500);
    scatter(grid, 40, 10);
    grid.find(40);
    expect(listed(grid, 40)).toEqual(every(grid, 40));
    grid.moves.fill(0);
    grid.find(40);
    expect(listed(grid, 40)).toEqual([]);
});

test("once it has grown to a scene, finding the pairs makes no new arrays", () => {
    const grid = new Grid(3);
    scatter(grid, 1000, 4);
    grid.find(1000);
    const arrays = () => [grid.low, grid.high, grid.moves, grid.start, grid.other];
    const before = arrays();
    for (let i = 0; i < 20; i++) {
        scatter(grid, 1000, 4);
        grid.find(1000);
    }
    arrays().forEach((array, index) => expect(array).toBe(before[index]!));
});

test("the table of things that never move finds every one a box reaches, and no other, once each, rising", () => {
    const next = dealer(17);
    const kept = new Kept();
    const boxes: [number[], number[]][] = [];
    // short chunks along a winding line, as track is cut, and a few long ones
    for (let i = 0; i < 400; i++) {
        const [x, y, z] = [Math.cos(i * 0.05) * 60, i * -0.1, Math.sin(i * 0.07) * 40];
        const long = i % 97 === 0 ? 80 : 1.5;
        const box: [number[], number[]] = [[x - long, y - 1, z - 1], [x + long, y + 1, z + 1]];
        boxes.push(box);
        kept.add(box[0], box[1]);
    }
    kept.build();
    for (let n = 0; n < 300; n++) {
        const middle = [(next() - 0.5) * 140, -next() * 45, (next() - 0.5) * 100];
        const half = n % 50 === 0 ? 70 : 0.5 + next() * 3;
        const [low, high] = [middle.map((v) => v - half), middle.map((v) => v + half)];
        const count = kept.find(low, high);
        const found = Array.from(kept.found.slice(0, count));
        const wanted = boxes.flatMap(([l, h], i) => ([0, 1, 2].every((a) => l[a]! <= high[a]! && low[a]! <= h[a]!) ? [i] : []));
        expect(found).toEqual(wanted);
    }
});
