// The pillars that hold a run up are held to what they are for: none under track on the ground, one
// under each joint off it (one shared where two pieces meet), each up to the underside of the block it
// holds; and none where it would stand in another piece or the room a marble rolls in above one.
// Run with `bun run test`.

import { expect, test } from "bun:test";
import { DEEP, LEVEL } from "./pieces";
import { pillars } from "./supports";
import type { Placed } from "./run";

const straight = (id: number, x: number, z: number, y: number, turn = 0): Placed => ({ id, kind: { family: "s", sizes: [1], mirror: false }, place: { x, z, y, turn } });

test("track on the ground needs no pillar; raised, one under each joint, up to the block's underside", () => {
    expect(pillars([straight(1, 0, 0, 1)])).toEqual([]);
    const raised = pillars([straight(1, 0, 0, 6)]);
    expect(raised).toEqual([
        { x: 0, z: 4, top: 6 * LEVEL - DEEP },
        { x: 8, z: 4, top: 6 * LEVEL - DEEP },
    ]);
});

test("two pieces that meet share the pillar under their joint", () => {
    expect(pillars([straight(1, 0, 0, 6), straight(2, 1, 0, 6)]).length).toBe(3);
});

test("a pillar that would stand in a piece below, or in the room above it, is not made", () => {
    // a straight along the same row under the far joint of a raised one, its room up to below the raised block
    const made = pillars([straight(1, 0, 0, 7), straight(2, 1, 0, 3)]);
    expect(made.some((pillar) => pillar.x === 8 && pillar.z === 4 && pillar.top === 7 * LEVEL - DEEP)).toBe(false);
    expect(made.some((pillar) => pillar.x === 0 && pillar.z === 4)).toBe(true);
    // the lower one has its own, short, under the same joint
    expect(made.some((pillar) => pillar.x === 8 && pillar.z === 4 && pillar.top === 3 * LEVEL - DEEP)).toBe(true);
});

test("the spiral stands on its post, the funnel on its legs, and the tray on four feet when raised", () => {
    const spiral = pillars([{ id: 1, kind: { family: "x", sizes: [2, 6], mirror: false }, place: { x: 0, z: 0, y: 20, turn: 0 } }]);
    expect(spiral.some((pillar) => pillar.x === 12 && pillar.z === 12)).toBe(true);
    const funnel = pillars([{ id: 1, kind: { family: "f", sizes: [], mirror: false }, place: { x: 0, z: 0, y: 12, turn: 0 } }]);
    expect(funnel.filter((pillar) => Math.abs(Math.hypot(pillar.x - 12, pillar.z - 12) - 8.5) < 1e-9).length).toBe(4);
    // on the ground, only its joint is held up; raised, its four feet as well
    expect(pillars([{ id: 1, kind: { family: "t", sizes: [], mirror: false }, place: { x: 0, z: 0, y: 4, turn: 0 } }]).length).toBe(1);
    expect(pillars([{ id: 1, kind: { family: "t", sizes: [], mirror: false }, place: { x: 0, z: 0, y: 7, turn: 0 } }]).length).toBe(5);
});
