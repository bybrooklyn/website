// The marble run's camera is held to what it is for: the line through the middle of the picture goes
// to the point looked at; a point of the scene projected into the picture and sent back as a line goes
// through itself; a line meets the ground and enters a box where it should; a view framing a box sees
// all of its corners; and the camera stays within its limits. Run with `bun run test`.

import { expect, test } from "bun:test";
import { enters, eyeOf, FAR, framing, ground, kept, lensed, nearest, panned, project, ray, straightOn, TIP, VIEWS, type Orbit } from "./orbit";
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

test("a view straight on stays where it is put, and the first drag from it does not jump to the free camera's limit", () => {
    const top = { ...orbit, ...VIEWS.top };
    expect(kept(top, top).tip).toBe(VIEWS.top.tip);
    // a little lower, by a drag, it stays a little lower; the free camera alone would jump to 1.45
    expect(kept({ ...top, tip: top.tip - 0.01 }, top).tip).toBeCloseTo(VIEWS.top.tip - 0.01, 12);
    expect(kept({ ...top, tip: top.tip - 0.01 }).tip).toBe(TIP[1]);
    // and it never tips further than it was
    expect(kept({ ...orbit, tip: 1.5 }, { ...orbit, tip: 1.47 }).tip).toBe(1.47);
    const front = kept({ ...orbit, ...VIEWS.front }, { ...orbit, ...VIEWS.front });
    expect(front.tip).toBe(0);
    expect(straightOn(front)).toBe("front");
    expect(straightOn({ ...orbit, ...VIEWS.side, turn: VIEWS.side.turn - 4 * Math.PI })).toBe("side");
    expect(straightOn(orbit)).toBeUndefined();
});

test("from above, the far side is up the picture; from the front and the side, the upright is up and the ground is level", () => {
    const at: V3 = [0, 0, 0];
    const top = project({ at, far: 100, ...VIEWS.top }, 40, 1, [0, 0, -10])!;
    expect(top.y).toBeGreaterThan(0.05);
    expect(Math.abs(top.x)).toBeLessThan(1e-3);
    for (const view of [VIEWS.front, VIEWS.side]) {
        const up = project({ at, far: 100, ...view }, 40, 1, [0, 10, 0])!;
        expect(up.y).toBeGreaterThan(0.05);
        expect(Math.abs(up.x)).toBeLessThan(1e-9);
        const level = [project({ at, far: 100, ...view }, 40, 1, [10, 0, 10])!, project({ at, far: 100, ...view }, 40, 1, [-10, 0, -10])!];
        for (const p of level) expect(Math.abs(p.y)).toBeLessThan(1e-9);
    }
});

test("turning to a view goes the short way round, and the narrow lens keeps what is looked at the same size", () => {
    expect(nearest(6.1, 0)).toBeCloseTo(2 * Math.PI, 12);
    expect(nearest(-3.3, Math.PI / 2)).toBeCloseTo(Math.PI / 2 - 2 * Math.PI, 12);
    const narrow = lensed(orbit, 38, 5);
    const near = project(orbit, 38, 1.5, [orbit.at[0] + 10, orbit.at[1], orbit.at[2]])!;
    const far = project(narrow, 5, 1.5, [orbit.at[0] + 10, orbit.at[1], orbit.at[2]])!;
    // the same to within a twentieth: what is off the point looked at is nearer or further, and only perspective tells
    expect(Math.abs(far.x / near.x - 1)).toBeLessThan(0.05);
    expect(lensed(narrow, 5, 38).far).toBeCloseTo(orbit.far, 9);
});
