// The marble run's camera is held to what it is for: the line through the middle of the picture goes
// to the point looked at; a point of the scene projected into the picture and sent back as a line goes
// through itself; a line meets the ground and enters a box where it should; a view framing a box sees
// all of its corners; the camera stays within its limits; and a pan keeps the point of the table first
// under the pointer exactly under it, and in the views along the table moves the run as far as the
// pointer went, up and down too. Run with `bun run test`.

import { expect, test } from "bun:test";
import { enters, eyeOf, FAR, framing, gripAt, ground, kept, lensed, nearest, pannedTo, project, ray, straightOn, TIP, VIEWS, zoomedAt, type Orbit } from "./orbit";
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

test("the camera stays within its limits", () => {
    const wild = kept({ at: [0, 0, 0], turn: 3, tip: 3, far: 5000 });
    expect(wild.tip).toBe(TIP[1]);
    expect(wild.far).toBe(FAR[1]);
    expect(kept({ ...wild, tip: -1, far: 1 }).tip).toBe(TIP[0]);
});

/** A picture 1288 by 828 pixels, as the tester's was; a point of it in the picture's own terms, and back. */
const [WIDE, HIGH] = [1288, 828];
const toPicture = (x: number, y: number): [number, number] => [(x / WIDE) * 2 - 1, 1 - (y / HIGH) * 2];
const toPixels = (p: { x: number; y: number }) => ({ x: ((p.x + 1) / 2) * WIDE, y: ((1 - p.y) / 2) * HIGH });
/** A drag from one pixel to another in `steps` moves, as the pointer goes, each slid from the view the last left. */
function dragged(start: Orbit, degrees: number, from: [number, number], to: [number, number], steps = 12) {
    const grip = gripAt(start, degrees, WIDE / HIGH, ...toPicture(...from));
    let now = start;
    for (let step = 1; step <= steps; step++) now = pannedTo(now, degrees, WIDE / HIGH, grip, ...toPicture(from[0] + ((to[0] - from[0]) * step) / steps, from[1] + ((to[1] - from[1]) * step) / steps));
    return { grip, now };
}

test("a pan keeps the point of the table first under the pointer exactly under it, wherever in the picture the drag goes", () => {
    const seen: Orbit = { at: [-28, 12.4, -12.3], turn: 0.75, tip: 0.62, far: 145 };
    const [mx, my] = [WIDE / 2, HIGH / 2];
    // the tester's five drags: 150 right and 120 down from the middle, 200 up, 300 right from low left, 250 down at the top right
    const drags: [[number, number], [number, number]][] = [
        [[mx, my], [mx + 150, my]],
        [[mx, my], [mx, my + 120]],
        [[mx, my + 100], [mx, my - 100]],
        [[mx - 200, my + 150], [mx + 100, my + 150]],
        [[mx + 200, my - 150], [mx + 200, my + 100]],
    ];
    for (const [from, to] of drags) {
        const { grip, now } = dragged(seen, 38, from, to);
        expect(grip.at[1]).toBeCloseTo(0, 9);
        const there = toPixels(project(now, 38, WIDE / HIGH, grip.at)!);
        expect(Math.hypot(there.x - to[0], there.y - to[1])).toBeLessThan(1);
        // moved over the table, never up, down, nearer or turned
        expect(now.at[1]).toBe(seen.at[1]);
        expect([now.far, now.turn, now.tip]).toEqual([seen.far, seen.turn, seen.tip]);
    }
});

test("from the front and the side, where the eye is level with the table, a drag down moves the run down as far as the pointer went", () => {
    for (const view of [VIEWS.front, VIEWS.side]) {
        // the narrow lens of the views straight on, as the scene draws them
        const seen = lensed({ at: [-28, 12.4, -12.3], far: 145, ...view }, 38, 5);
        for (const [dx, dy] of [[0, 100], [0, -100], [100, 0]]) {
            const from: [number, number] = [WIDE / 2 - 50, HIGH / 2 + 30];
            const { now } = dragged(seen, 5, from, [from[0] + dx, from[1] + dy]);
            const [before, after] = [toPixels(project(seen, 5, WIDE / HIGH, seen.at)!), toPixels(project(now, 5, WIDE / HIGH, seen.at)!)];
            expect(Math.abs(after.x - before.x - dx)).toBeLessThan(1);
            expect(Math.abs(after.y - before.y - dy)).toBeLessThan(1);
        }
    }
});

test("a pan is left as it is where the pointer goes over the horizon, rather than carrying the view off", () => {
    const low: Orbit = { at: [0, 0, 0], turn: 0, tip: 0.2, far: 100 };
    const grip = gripAt(low, 38, WIDE / HIGH, ...toPicture(WIDE / 2, HIGH * 0.75));
    expect(grip.facing).toEqual([0, 1, 0]);
    expect(pannedTo(low, 38, WIDE / HIGH, grip, ...toPicture(WIDE / 2, 2))).toEqual(low);
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

test("a view nearer than the free camera may come, left by a camera that rode a marble, stays as near at the first touch and may only draw back", () => {
    const close = { ...orbit, far: 6 };
    expect(kept({ ...close, far: 6.5 }, close).far).toBe(6.5);
    expect(kept({ ...close, far: 5 }, close).far).toBe(6);
    expect(kept({ ...close, far: 5 }).far).toBe(FAR[0]);
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

test("the wheel brings the view nearer toward the point of the table under the pointer, which stays under it", () => {
    const seen: Orbit = { at: [-28, 12.4, -12.3], turn: 0.75, tip: 0.62, far: 145 };
    for (const [x, y] of [[40, 40], [WIDE / 2, HIGH / 2], [WIDE - 60, HIGH - 50]] as [number, number][]) {
        const grip = gripAt(seen, 38, WIDE / HIGH, ...toPicture(x, y));
        let now = seen;
        // five notches in, then three out
        for (const by of [0.8, 0.8, 0.8, 0.8, 0.8, 1.25, 1.25, 1.25]) now = zoomedAt(now, 38, WIDE / HIGH, ...toPicture(x, y), now.far * by);
        const there = toPixels(project(now, 38, WIDE / HIGH, grip.at)!);
        expect(Math.hypot(there.x - x, there.y - y)).toBeLessThan(0.5);
        expect(now.far).toBeCloseTo(seen.far * 0.8 ** 5 * 1.25 ** 3, 9);
    }
});
