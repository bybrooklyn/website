// The broad phase changes nothing: each mini's scene, run for several hundred steps with the grid and
// again with the loop over every pair that came before it, ends with every body in the same place
// and turned the same way, to the last bit. Run with `bun run test`.

import { expect, test } from "bun:test";
import { TICK } from "./stage";
import { Flat, send, type Body, type P } from "./flat";
import type { Pairs } from "./grid";
import { Space as SpaceWorld, angled, type Space } from "./space";
import { cube, diamond, pyramid, ten, twelve, twenty, type V3 } from "./solids";
import { DEFAULTS, drop } from "../minis/board";
import { throwDice, type Sides } from "../minis/tower";

/** The loop over every pair, as the physics did it before the grid: each body against every one after it. */
class Every implements Pairs {
    low = new Float64Array(0);
    high = new Float64Array(0);
    moves = new Uint8Array(0);
    start = new Int32Array(1);
    other = new Int32Array(0);
    ready(count: number): void {
        this.low = new Float64Array(count * 3);
        this.high = new Float64Array(count * 3);
        this.moves = new Uint8Array(count);
    }
    find(count: number): void {
        this.start = new Int32Array(count + 1);
        this.other = new Int32Array((count * (count - 1)) / 2);
        let at = 0;
        for (let i = 0; i < count; i++) {
            this.start[i] = at;
            for (let j = i + 1; j < count; j++) this.other[at++] = j;
        }
        this.start[count] = at;
    }
}

/** Numbers that look random and are the same every time. */
const dealer = (seed: number) => () => (seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 2 ** 32;

/** Two lists of numbers are the same to the bit. */
function same(one: number[], two: number[]): void {
    expect(one.length).toBe(two.length);
    const differ = one.findIndex((value, index) => !Object.is(value, two[index]));
    expect(differ).toBe(-1);
}

/**
 * Blocks as `src/minis/blocks.ts` builds it, in a box 600 by 400 with rounded upper corners: the six
 * blocks it starts with, a piece dropped every half second, the oldest taken away past twenty, and a
 * block picked up, dragged across and thrown.
 */
function blocks(every: boolean): number[] {
    const flat = new Flat(2600);
    if (every) flat.pairs = new Every();
    const next = dealer(21);
    const [w, h, r, size] = [600, 394, 16, 40];
    const arc = (cx: number, cy: number, from: number): P[] => Array.from({ length: 7 }, (_, step): P => [cx + Math.cos(from + (step / 6) * (Math.PI / 2)) * r, cy + Math.sin(from + (step / 6) * (Math.PI / 2)) * r]);
    flat.wall([...arc(r, r, Math.PI), ...arc(w - r, r, -Math.PI / 2), [w, h], [0, h]], true);
    const pile: Body[] = [];
    for (const [column, row] of [[-1, 0], [0, 0], [1, 0], [-0.5, 1], [0.5, 1], [0, 2]] as const) pile.push(flat.box(w / 2 + column * size, h - size / 2 - row * size, size, size));
    for (let step = 0; step < 900; step++) {
        if (step % 60 === 30) {
            const pick = next();
            const [x, half] = [w * (0.2 + next() * 0.6), size / 2];
            const block = pick < 0.7 ? flat.box(x, size, size, size) : pick < 0.85 ? flat.ball(x, size, half, { bounce: 0.35 }) : flat.shape(x, size, [[0, -half], [half * 1.15, half], [-half * 1.15, half]]);
            send(block, 0, 0, (next() - 0.5) * 1.2);
            pile.push(block);
            if (pile.length > 20) flat.remove(pile.shift()!);
        }
        // a drag: the top block of the start taken up, carried to the left and let go
        if (step === 200) flat.hand.take(w / 2, h - size * 2.5);
        if (step > 200 && step < 260) flat.hand.move(w / 2 - (step - 200) * 4, h - size * 2.5 - (step - 200) * 2);
        if (step === 260) flat.hand.drop();
        flat.step(TICK);
    }
    return flat.bodies.flatMap((body) => [body.x, body.y, body.a]);
}

/** Plinko's board as `src/minis/board.ts` builds it, with sixteen balls, run until all have landed. */
function plinko(every: boolean): number[] {
    const [pick, chance] = [dealer(8), dealer(9)];
    const board = drop(DEFAULTS, (below) => Math.floor(pick() * below), chance);
    if (every) board.flat.pairs = new Every();
    let positions: number[] = [];
    for (let step = 0; step < 1800 && !board.done(); step++) {
        board.step(TICK);
        // the balls are taken away once they land, so their places are kept as they go
        if (step % 100 === 0) positions = positions.concat(board.flat.bodies.flatMap((body) => [body.x, body.y, body.a]));
    }
    return positions.concat(board.flat.bodies.flatMap((body) => [body.x, body.y, body.a]), [board.landings.length], board.landings.map((landing) => landing.bin));
}

/** The dice tower as `src/minis/tower.ts` builds it, with one of each die, for ten seconds. */
function dice(every: boolean, use: (space: Space) => void = () => {}): number[] {
    const kinds: Sides[] = [4, 6, 8, 10, 12, 20, 6, 6];
    const thrown = throwDice(kinds, dealer(31));
    if (every) thrown.space.pairs = new Every();
    use(thrown.space);
    for (let step = 0; step < 1200; step++) thrown.step(TICK);
    return thrown.dice.flatMap((die) => [...die.body.p, ...die.body.q]).concat(thrown.values());
}

/** Three hundred blocks, balls and bars dropped in a heap into a box, some fast, for two seconds. */
function crowdFlat(every: boolean): number[] {
    const flat = new Flat();
    if (every) flat.pairs = new Every();
    const next = dealer(41);
    flat.wall([[0, 0], [500, 0], [500, 700], [0, 700]], true);
    for (let i = 0; i < 300; i++) {
        const [x, y, pick] = [30 + next() * 440, 680 - i * 6, next()];
        const body = pick < 0.4 ? flat.ball(x, y, 6 + next() * 8, { bounce: 0.4 }) : pick < 0.8 ? flat.box(x, y, 10 + next() * 14, 10 + next() * 14, { angle: next() * 3 }) : flat.bar(x, y, 30, 6, { angle: next() * 3 });
        send(body, (next() - 0.5) * 2000, (next() - 0.5) * 2000, (next() - 0.5) * 20);
    }
    for (let step = 0; step < 240; step++) flat.step(TICK);
    return flat.bodies.flatMap((body) => [body.x, body.y, body.a]);
}

/** A hundred and twenty dice of every kind thrown into a walled tray, falling asleep as they settle, for three seconds. */
function crowdSpace(every: boolean): number[] {
    const space = new SpaceWorld();
    if (every) space.pairs = new Every();
    space.sleeps = true;
    const next = dealer(43);
    space.slab([0, -1, 0], [6, 1, 6]);
    for (const [x, z, hx, hz] of [[-5, 0, 0.3, 5], [5, 0, 0.3, 5], [0, -5, 5, 0.3], [0, 5, 5, 0.3]] as const) space.slab([x, 2, z], [hx, 2, hz], angled(0, 0.2, 0));
    const shapes = [pyramid(), cube(), diamond(), ten(), twelve(), twenty()];
    for (let i = 0; i < 120; i++) {
        const shape = shapes[i % shapes.length]!;
        const solid = space.solid({ faces: shape.faces, points: shape.points.map(([x, y, z]): V3 => [x * 0.3, y * 0.3, z * 0.3]) }, [(next() - 0.5) * 8, 1 + i * 0.12, (next() - 0.5) * 8], { bounce: 0.3 }, angled(next() * 6, next() * 6, next() * 6));
        solid.v = [(next() - 0.5) * 16, (next() - 0.5) * 4, (next() - 0.5) * 16];
        solid.w = [(next() - 0.5) * 30, (next() - 0.5) * 30, (next() - 0.5) * 30];
    }
    for (let step = 0; step < 360; step++) space.step(TICK);
    return space.solids.flatMap((solid) => [...solid.p, ...solid.q]);
}

test("a crowded 2D heap steps to the same place to the bit with the grid as with every pair", () => {
    same(crowdFlat(true), crowdFlat(false));
});

test("a crowded 3D tray of dice steps to the same place to the bit with the grid as with every pair", () => {
    same(crowdSpace(true), crowdSpace(false));
}, 60_000);

test("Blocks steps to the same place to the bit with the grid as with every pair", () => {
    same(blocks(true), blocks(false));
});

test("Plinko's board steps to the same place to the bit with the grid as with every pair", () => {
    same(plinko(true), plinko(false));
});

test("the dice tower steps to the same place to the bit with the grid as with every pair", () => {
    same(dice(true), dice(false));
});

/** A short name for a list of numbers, from every bit of each: two lists with the same name are the same to the bit. */
function print(values: number[]): string {
    const bits = new Uint32Array(new Float64Array(values).buffer);
    let [one, two] = [0x811c9dc5, 0x01000193];
    for (const word of bits) {
        one = Math.imul(one ^ word, 0x01000193) >>> 0;
        two = Math.imul(two ^ word, 0x5bd1e995) >>> 0;
    }
    return `${values.length}:${one.toString(16)}${two.toString(16)}`;
}

// What each scene ended at before Mote's 3D side gained balls, track and islands that sleep (13 Nov
// 2026), with the grid. Those were added beside what was there, so the old scenes end where they did.
const BEFORE = {
    blocks: "108:7bc988431ae2ddd3",
    plinko: "3518:c44eeaad3da60d25",
    dice: "64:cc59416212cd59c0",
    crowdFlat: "912:dda840c1e8b8608",
    crowdSpace: "875:f886ceecaf361992",
    heap: "403:d23560e1d84fc28f",
};

/** Thirty cubes and long bars dropped onto a floor, bouncing, with no sleep, for four seconds. */
function heap(): number[] {
    const space = new SpaceWorld();
    const next = dealer(5);
    space.slab([0, -1, 0], [30, 1, 30], angled(0.02, 0, 0.01), { friction: 0.6 });
    for (let i = 0; i < 30; i++) {
        const solid = space.solid(i % 3 ? cube() : { faces: cube().faces, points: cube().points.map(([x, y, z]): V3 => [x * 0.3, y * 0.5, z * 2]) }, [next() * 6 - 3, 2 + i * 2.4, next() * 6 - 3], { bounce: 0.3 });
        solid.w = [next() * 8 - 4, next() * 8 - 4, next() * 8 - 4];
    }
    for (let step = 0; step < 480; step++) space.step(TICK);
    return space.solids.flatMap((solid) => [...solid.p, ...solid.q, ...solid.v, ...solid.w]);
}

test("Blocks, Plinko, the dice tower and three heaps end exactly where they ended before balls and track came to 3D", () => {
    const now = { blocks: print(blocks(false)), plinko: print(plinko(false)), dice: print(dice(false)), crowdFlat: print(crowdFlat(false)), crowdSpace: print(crowdSpace(false)), heap: print(heap()) };
    expect(now).toEqual(BEFORE);
}, 60_000);
