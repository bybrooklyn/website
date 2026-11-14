// The marble run's camera is held to what it is for: the line through the middle of the picture goes
// to the point looked at; a point of the scene projected into the picture and sent back as a line goes
// through itself; a line meets the ground and enters a box where it should; a view framing a box sees
// all of its corners; and the camera stays within its limits. Run with `bun run test`.

import { expect, test } from "bun:test";
import { enters, eyeOf, FAR, framing, ground, kept, panned, project, ray, TIP, type Orbit } from "./orbit";
import type { V3 } from "../mote/solids";

const orbit: Orbit = { at: [10, 5, -20], turn: 0.7, tip: 0.6, far: 120 };

test("the middle of the picture looks at the point the camera circles", () => {
    const line = ray(orbit, 40, 1.6, 0, 0);
    const eye = eyeOf(orbit);
    expect(Math.hypot(...eye.map((value, axis) => value - orbit.at[axis]!))).toBeCloseTo(120, 9);
    const there = line.from.map((value, axis) => value + line.way[axis]! * 120) as V3;
    there.forEach((value, axis) => expect(value).toBeCloseTo(orbit.at[axis]!, 9));
});

test("a point of the scene, found in the picture and sent back as a line, is on that line", () => {
    for (const p of [[0, 0, 0], [30, 12, -40], [-25, 3, 10]] as V3[]) {
        const seen = project(orbit, 40, 1.6, p)!;
        const line = ray(orbit, 40, 1.6, seen.x, seen.y);
        const along = (p[0] - line.from[0]) * line.way[0] + (p[1] - line.from[1]) * line.way[1] + (p[2] - line.from[2]) * line.way[2];
        const off = p.map((value, axis) => value - line.from[axis]! - line.way[axis]! * along);
        expect(Math.hypot(...off)).toBeLessThan(1e-9);
    }
});

test("a line meets the ground where it comes down, and enters a box on its near face", () => {
    expect(ground({ from: [0, 10, 0], way: [0.6, -0.8, 0] }, 2)).toEqual([6, 2, 0]);
    expect(ground({ from: [0, 10, 0], way: [0.6, 0.8, 0] }, 2)).toBeUndefined();
    expect(enters({ from: [-10, 0, 0], way: [1, 0, 0] }, [0, 0, 0], [2, 2, 2])).toBeCloseTo(8, 12);
    expect(enters({ from: [-10, 5, 0], way: [1, 0, 0] }, [0, 0, 0], [2, 2, 2])).toBeUndefined();
});

test("a view framing a box sees every corner of it, in the picture", () => {
    const [low, high]: [V3, V3] = [[-100, 0, -60], [40, 70, 30]];
    for (const aspect of [1.6, 0.5]) {
        const framed = framing(orbit, 40, aspect, low, high);
        for (const x of [low[0], high[0]]) for (const y of [low[1], high[1]]) for (const z of [low[2], high[2]]) {
            const seen = project(framed, 40, aspect, [x, y, z])!;
            expect(Math.abs(seen.x)).toBeLessThan(1);
            expect(Math.abs(seen.y)).toBeLessThan(1);
        }
    }
});

test("the camera stays within its limits, and panning keeps its height and how far it is", () => {
    const wild = kept({ at: [0, 0, 0], turn: 3, tip: 3, far: 5000 });
    expect(wild.tip).toBe(TIP[1]);
    expect(wild.far).toBe(FAR[1]);
    expect(kept({ ...wild, tip: -1, far: 1 }).tip).toBe(TIP[0]);
    const moved = panned(orbit, 40, 0.1, 0.2);
    expect(moved.at[1]).toBe(orbit.at[1]);
    expect(moved.far).toBe(orbit.far);
    expect(moved.at[0] !== orbit.at[0] || moved.at[2] !== orbit.at[2]).toBe(true);
});
