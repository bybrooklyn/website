// How long a step takes with many bodies: 100, 500, 1,000 and 5,000, as balls loose in a box and
// as a pile, in both kinds of physics; and marbles, rolling down a long spiral gutter, circling a
// funnel, heaped in a tray awake and asleep. It prints its numbers, so that a change can be measured,
// and holds a step only to a generous bound, since the machine it runs on may be busy. `docs/mote.md`
// keeps the numbers it gave.

import { expect, test } from "bun:test";
import { TICK } from "./stage";
import { Flat } from "./flat";
import { cube, twenty, type Mesh, type V3 } from "./solids";
import { MARBLE, Space, marbleSpace } from "./space";
import { gutter, helix, sweep, turned } from "./track";

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

/** Marbles spaced along a long spiral gutter, sixteen turns, all rolling down it. */
function gutters(count: number): Space {
    const space = marbleSpace();
    const spiral = helix([0, 200, 0], 30, -9, 16);
    const piece = sweep(spiral, gutter(1.6, Math.PI * 1.1, 0.2), { level: true, bank: -0.25 });
    space.track(piece);
    for (let i = 0; i < count; i++) {
        const f = piece.frame((spiral.end * (i + 0.5)) / count);
        const ball = space.ball(0.8, [f.p[0] - f.up[0] * 0.6, f.p[1] - f.up[1] * 0.6, f.p[2] - f.up[2] * 0.6], MARBLE);
        ball.v = [f.along[0] * 60, f.along[1] * 60, f.along[2] * 60];
    }
    return space;
}

/** Marbles sent circling round a wide funnel, in three layers, so that they jostle. */
function funnelled(count: number): Space {
    const space = marbleSpace();
    const next = dealer(7);
    space.track(turned([0, 0, 0], [[3, 0], [15, 6], [35, 16], [60, 34]], 0.3));
    for (let i = 0; i < count; i++) {
        const [out, angle] = [12 + next() * 40, next() * 2 * Math.PI];
        const high = out < 15 ? (out - 3) * 0.5 : out < 35 ? 6 + (out - 15) * 0.5 : 16 + (out - 35) * 0.72;
        const ball = space.ball(0.8, [out * Math.cos(angle), high + 1.5 + (i % 3) * 1.7, out * Math.sin(angle)], MARBLE);
        const speed = Math.sqrt(981 * out * 0.55) * 0.9;
        ball.v = [-Math.sin(angle) * speed, 0, Math.cos(angle) * speed];
    }
    return space;
}

/** Marbles in layers over a walled tray, let fall into a heap. */
function heaped(count: number): Space {
    const space = marbleSpace();
    const next = dealer(9);
    const wide = Math.ceil(Math.sqrt(count * 2.6) / 2) + 1;
    space.slab([0, -1, 0], [wide + 1, 1, wide + 1]);
    for (const [x, z, hx, hz] of [[-wide - 0.5, 0, 0.5, wide + 1], [wide + 0.5, 0, 0.5, wide + 1], [0, -wide - 0.5, wide + 1, 0.5], [0, wide + 0.5, wide + 1, 0.5]] as const) space.slab([x, 40, z], [hx, 40, hz]);
    const across = Math.floor((2 * wide - 2) / 1.8);
    for (let i = 0; i < count; i++) {
        const [x, z, y] = [i % across, Math.floor(i / across) % across, Math.floor(i / (across * across))];
        space.ball(0.8, [-wide + 1.5 + x * 1.8 + next() * 0.1, 1 + y * 1.8, -wide + 1.5 + z * 1.8 + next() * 0.1], MARBLE);
    }
    return space;
}

test("a step of 1/120 s with many marbles, rolling in a gutter, circling a funnel, heaped awake and asleep: printed, and held to a generous bound", () => {
    const lines: string[] = [];
    let worst200 = 0;
    for (const count of [100, 200, 400, 800]) {
        const [g, f, h] = [gutters(count), funnelled(count), heaped(count)];
        const times = [timed(() => g.step(TICK), 30, 30), timed(() => f.step(TICK), 30, 30), timed(() => h.step(TICK), 30, 30)];
        for (let i = 0; i < 120 * 8; i++) h.step(TICK);
        const asleep = timed(() => h.step(TICK), 5, 60);
        if (count === 200) worst200 = Math.max(...times);
        lines.push(`marbles ${String(count).padStart(4)}  gutter ${times[0]!.toFixed(2).padStart(6)} ms  funnel ${times[1]!.toFixed(2).padStart(6)} ms  heap ${times[2]!.toFixed(2).padStart(6)} ms  heap asleep ${asleep.toFixed(3)} ms`);
    }
    console.log(lines.join("\n"));
    expect(worst200).toBeLessThan(100);
}, 600_000);
