// Two things both kinds of physics are held to: the same scene run twice ends exactly the same (so
// nothing in a step depends on chance, or on the order things happen to be stored in), and a step with
// a hundred bodies is done well inside the 1/120 s it stands for. Run with `bun run test`.

import { expect, test } from "bun:test";
import { Flat } from "./flat";
import { cube } from "./solids";
import { Space } from "./space";

const TICK = 1 / 120;
/** Numbers that look random and are the same every time. */
const dealer = (seed: number) => () => (seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 2 ** 32;

/** A hundred blocks and balls dropped into a box. */
function pile(): Flat {
    const flat = new Flat();
    const next = dealer(11);
    flat.wall([[0, 0], [0, 900], [700, 900], [700, 0]]);
    for (let i = 0; i < 100; i++) {
        const [x, y] = [60 + next() * 580, 800 - i * 45];
        if (i % 4 === 0) flat.ball(x, y, 18, { bounce: 0.3 });
        else flat.box(x, y, 36, 36, { angle: next() * 3 });
    }
    return flat;
}

/** Thirty cubes dropped onto a floor, each turning its own way. */
function heap(): Space {
    const space = new Space();
    const next = dealer(5);
    space.slab([0, -1, 0], [30, 1, 30]);
    for (let i = 0; i < 30; i++) {
        const solid = space.solid(cube(), [next() * 6 - 3, 2 + i * 2.4, next() * 6 - 3], { bounce: 0.3 });
        solid.w = [next() * 8 - 4, next() * 8 - 4, next() * 8 - 4];
    }
    return space;
}

/** How long a step takes, in milliseconds: the middle one of many, so that one slow moment does not count. */
function middle(step: () => void, steps: number): number {
    const times: number[] = [];
    for (let i = 0; i < steps; i++) {
        const before = performance.now();
        step();
        times.push(performance.now() - before);
    }
    return times.sort((a, b) => a - b)[steps >> 1]!;
}

test("the same pile of a hundred, run twice, ends the same to the last digit", () => {
    const end = () => {
        const flat = pile();
        for (let i = 0; i < 480; i++) flat.step(TICK);
        return flat.bodies.map((body) => [body.x, body.y, body.a, body.vx, body.vy, body.w]);
    };
    expect(end()).toEqual(end());
});

test("the same heap of thirty solids, run twice, ends the same to the last digit", () => {
    const end = () => {
        const space = heap();
        for (let i = 0; i < 480; i++) space.step(TICK);
        return space.solids.map((solid) => [...solid.p, ...solid.q, ...solid.v, ...solid.w]);
    };
    expect(end()).toEqual(end());
});

test("a step with a hundred bodies in a pile takes less than the time it stands for", () => {
    const flat = pile();
    expect(middle(() => flat.step(TICK), 600)).toBeLessThan(TICK * 1000);
});

test("a step with thirty solids in a heap takes less than the time it stands for", () => {
    const space = heap();
    expect(middle(() => space.step(TICK), 600)).toBeLessThan(TICK * 1000);
});
