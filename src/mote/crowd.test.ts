// How long a step takes with many bodies: 100, 500, 1,000 and 5,000, as balls loose in a box and
// as a pile, in both kinds of physics. It prints its numbers, so that a change to how pairs are
// found can be measured, and holds a step only to a generous bound, since the machine it runs on
// may be busy. `docs/mote.md` keeps the numbers it gave before and after the broad phase.

import { expect, test } from "bun:test";
import { TICK } from "./stage";
import { Flat } from "./flat";
import { cube, twenty, type Mesh, type V3 } from "./solids";
import { Space } from "./space";

/** Numbers that look random and are the same every time. */
const dealer = (seed: number) => () => (seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 2 ** 32;
const sized = (mesh: Mesh, by: number): Mesh => ({ faces: mesh.faces, points: mesh.points.map(([x, y, z]): V3 => [x * by, y * by, z * by]) });

/** Balls of radius 6 spread through a box a quarter full of them, each thrown its own way. */
function looseFlat(count: number): Flat {
    const flat = new Flat();
    const next = dealer(3);
    const across = Math.ceil(Math.sqrt(count));
    const room = 24;
    flat.wall([[0, 0], [across * room, 0], [across * room, across * room], [0, across * room]], true);
    for (let i = 0; i < count; i++) {
        const ball = flat.ball(room / 2 + (i % across) * room, room / 2 + Math.floor(i / across) * room, 6, { bounce: 0.3 });
        ball.vx = (next() - 0.5) * 400;
        ball.vy = (next() - 0.5) * 400;
    }
    return flat;
}

/** Blocks 12 across stacked in rows on a floor, each just clear of the next, so that every one is touching from the start. */
function pileFlat(count: number): Flat {
    const flat = new Flat();
    const across = Math.ceil(Math.sqrt(count) * 2);
    const wide = across * 12.5;
    flat.wall([[0, -4000], [wide, -4000], [wide, 1000], [0, 1000]], true);
    for (let i = 0; i < count; i++) flat.box(6.25 + (i % across) * 12.5, 1000 - 6.05 - Math.floor(i / across) * 12.1, 12, 12);
    return flat;
}

/** The walls of a box: a floor and four sides. */
function walled(space: Space, wide: number, high: number): void {
    space.slab([0, -1, 0], [wide + 1, 1, wide + 1]);
    space.slab([-wide - 1, high, 0], [1, high, wide + 1]);
    space.slab([wide + 1, high, 0], [1, high, wide + 1]);
    space.slab([0, high, -wide - 1], [wide + 1, high, 1]);
    space.slab([0, high, wide + 1], [wide + 1, high, 1]);
}

/** Small round solids of twenty faces spread through a box, each thrown its own way. */
function looseSpace(count: number): Space {
    const space = new Space();
    const next = dealer(7);
    const across = Math.ceil(Math.cbrt(count));
    const room = 0.5;
    walled(space, (across * room) / 2, across * room);
    const shape = sized(twenty(), 0.12);
    for (let i = 0; i < count; i++) {
        const [x, y, z] = [i % across, Math.floor(i / across) % across, Math.floor(i / (across * across))];
        const solid = space.solid(shape, [(x - across / 2 + 0.5) * room, 0.3 + y * room, (z - across / 2 + 0.5) * room], { bounce: 0.3 });
        solid.v = [(next() - 0.5) * 4, (next() - 0.5) * 4, (next() - 0.5) * 4];
    }
    return space;
}

/** Cubes a fifth of a unit across in layers on a floor, each just clear of the next. */
function pileSpace(count: number): Space {
    const space = new Space();
    const across = Math.ceil(Math.sqrt(count / 4));
    walled(space, (across * 0.21) / 2, 4);
    const shape = sized(cube(), 0.1);
    for (let i = 0; i < count; i++) {
        const [x, z, y] = [i % across, Math.floor(i / across) % across, Math.floor(i / (across * across))];
        space.solid(shape, [(x - across / 2 + 0.5) * 0.21, 0.1005 + y * 0.201, (z - across / 2 + 0.5) * 0.21]);
    }
    return space;
}

/** The middle time of a few steps, in milliseconds, after a few to warm up. */
function timed(step: () => void, warm: number, steps: number): number {
    for (let i = 0; i < warm; i++) step();
    const times: number[] = [];
    for (let i = 0; i < steps; i++) {
        const before = performance.now();
        step();
        times.push(performance.now() - before);
    }
    return times.sort((a, b) => a - b)[steps >> 1]!;
}

const COUNTS = [100, 500, 1000, 5000];
const rounds = (count: number) => (count >= 5000 ? [2, 3] : [10, 15]);

test("a step with many bodies in 2D: printed, and held to a generous bound", () => {
    const lines: string[] = [];
    let thousand = 0;
    for (const count of COUNTS) {
        const [warm, steps] = rounds(count);
        const loose = looseFlat(count);
        const pile = pileFlat(count);
        const [a, b] = [timed(() => loose.step(TICK), warm, steps), timed(() => pile.step(TICK), warm, steps)];
        if (count === 1000) thousand = Math.max(a, b);
        lines.push(`flat ${String(count).padStart(5)}  loose ${a.toFixed(2).padStart(8)} ms  pile ${b.toFixed(2).padStart(8)} ms`);
    }
    console.log(lines.join("\n"));
    expect(thousand).toBeLessThan(80);
}, 600_000);

test("a step with many solids in 3D: printed, and held to a generous bound", () => {
    const lines: string[] = [];
    let [loose1000, pile1000] = [0, 0];
    for (const count of COUNTS) {
        const [warm, steps] = rounds(count);
        const loose = looseSpace(count);
        const pile = pileSpace(count);
        const [a, b] = [timed(() => loose.step(TICK), warm, steps), timed(() => pile.step(TICK), warm, steps)];
        if (count === 1000) [loose1000, pile1000] = [a, b];
        lines.push(`space ${String(count).padStart(5)}  loose ${a.toFixed(2).padStart(8)} ms  pile ${b.toFixed(2).padStart(8)} ms`);
    }
    console.log(lines.join("\n"));
    // The pile is held to more: there it is the work on each touching pair that counts, not finding them.
    expect(loose1000).toBeLessThan(400);
    expect(pile1000).toBeLessThan(2500);
}, 600_000);
