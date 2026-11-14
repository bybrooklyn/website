// The handles are held to what a finger needs: they keep one size on the screen near and far; a drag
// along an arrow moves by what the pointer moved along that axis, to the centimetre; a drag round the
// ring counts quarter turns the way a piece turns; a pointer on an arrow, the ring or the knob takes
// that one, a fingertip's width from it and no further; their shapes face outward, to be lit and not
// culled; on a small selection they stand off from it; a point a piece is bent by stays under the
// pointer, or moves along the one way the view sees, and snaps each way on its own. Run with `bun run test`.

import { expect, test } from "bun:test";
import { ARROW, GAP, REACH, across, along, arrowMesh, dragged, freedomOf, layout, pixelsOf, pointOf, pointsLayout, ringMesh, snapped, standOff, toSegment, turnedBy, which } from "./handles";
import { project, type Orbit } from "./orbit";
import { normals, type V3 } from "../mote/solids";

const orbit: Orbit = { at: [10, 5, -20], turn: 0.7, tip: 0.6, far: 160 };
const [width, height] = [1000, 700];
const middle: V3 = [12, 6, -18];
const picture = (p: V3): [number, number] => {
    const seen = project(orbit, 38, width / height, p)!;
    return [seen.x, seen.y];
};

test("a handle is the same size on the screen near and far", () => {
    for (const far of [40, 160, 600]) {
        const near = { ...orbit, far };
        const size = across(near, 38, height, middle);
        const shown = layout(near, 38, width, height, middle);
        const arrow = shown.arrows.y!;
        // the upright arrow, seen a little from above, is a little shorter than its length on the screen
        expect(Math.hypot(arrow.to.x - shown.middle!.x, arrow.to.y - shown.middle!.y)).toBeGreaterThan(ARROW * 0.7);
        expect(Math.hypot(arrow.to.x - shown.middle!.x, arrow.to.y - shown.middle!.y)).toBeLessThan(ARROW * 1.05);
        expect(size).toBeGreaterThan(0);
    }
});

test("a drag along an arrow moves by what the pointer moved along that axis", () => {
    for (const [axis, by] of [[[1, 0, 0], 16], [[0, 0, 1], -24], [[0, 1, 0], 6]] as [V3, number][]) {
        const to: V3 = [middle[0] + axis[0] * by, middle[1] + axis[1] * by, middle[2] + axis[2] * by];
        expect(along(orbit, 38, width / height, middle, axis, picture(middle), picture(to))).toBeCloseTo(by, 6);
    }
    // a pointer off the axis counts only what it moved along it
    const off: V3 = [middle[0] + 8, middle[1] + 3, middle[2]];
    const going = along(orbit, 38, width / height, middle, [1, 0, 0], picture(middle), picture(off));
    expect(Math.abs(going - 8)).toBeLessThan(4);
});

test("a drag round the ring counts quarter turns, the way the clock goes on the screen being a piece's own way", () => {
    const m = { x: 100, y: 100 };
    expect(turnedBy(m, { x: 150, y: 100 }, { x: 100, y: 150 })).toBe(1);
    expect(turnedBy(m, { x: 150, y: 100 }, { x: 100, y: 50 })).toBe(-1);
    expect(turnedBy(m, { x: 150, y: 100 }, { x: 140, y: 112 })).toBe(0);
    expect(Math.abs(turnedBy(m, { x: 150, y: 100 }, { x: 50, y: 101 }))).toBe(2);
});

test("a pointer on a handle takes it, a fingertip from it still, and further away nothing", () => {
    const knob: V3 = [middle[0] + 40, middle[1], middle[2] + 30];
    const shown = layout(orbit, 38, width, height, middle, knob);
    for (const name of ["x", "y", "z"] as const) {
        const arrow = shown.arrows[name]!;
        const mid = { x: (arrow.from.x + arrow.to.x) / 2, y: (arrow.from.y + arrow.to.y) / 2 };
        expect(which(shown, mid.x, mid.y, "mouse")).toBe(name);
        // across the arrow, a little less than a fingertip's half width away
        const [dx, dy] = [arrow.to.x - arrow.from.x, arrow.to.y - arrow.from.y];
        const long = Math.hypot(dx, dy);
        const side = { x: mid.x - (dy / long) * (REACH.touch - 3), y: mid.y + (dx / long) * (REACH.touch - 3) };
        expect([name, "ring", undefined]).toContain(which(shown, side.x, side.y, "touch"));
    }
    expect(which(shown, shown.knob!.x + 5, shown.knob!.y, "touch")).toBe("knob");
    // the point of the ring furthest from every arrow
    const clear = (q: { x: number; y: number }) => Math.min(...Object.values(shown.arrows).map((arrow) => toSegment(q, arrow.from, arrow.to)));
    const point = [...shown.ring].sort((a, b) => clear(b) - clear(a))[0]!;
    expect(which(shown, point.x, point.y, "touch")).toBe("ring");
    expect(which(shown, shown.middle!.x + 300, shown.middle!.y + 300, "touch")).toBeUndefined();
    // an arrow's part near the middle is left to the pieces under it
    const near = shown.arrows.y!;
    expect(which(shown, near.from.x + (near.to.x - near.from.x) * 0.1, near.from.y + (near.to.y - near.from.y) * 0.1, "touch")).not.toBe("y");
});

test("the handles' shapes face outward", () => {
    const outward = (mesh: ReturnType<typeof ringMesh>, from: (m: V3) => V3) => {
        const out = normals(mesh);
        return mesh.faces.filter((face, i) => {
            const m = face.reduce((sum, at) => [sum[0] + mesh.points[at]![0] / face.length, sum[1] + mesh.points[at]![1] / face.length, sum[2] + mesh.points[at]![2] / face.length] as V3, [0, 0, 0] as V3);
            const away = from(m);
            const n = out[i]!;
            return n[0] * away[0] + n[1] * away[1] + n[2] * away[2] > 0;
        }).length / mesh.faces.length;
    };
    // the shaft's and the head's sides (28 of the 70 faces) face away from the arrow's own line; the
    // rest face along it, the ends and the back of the head, and are checked by the arrow's length below
    const axes = { x: 0, y: 1, z: 2 } as const;
    for (const [name, axis] of Object.entries(axes) as ["x" | "y" | "z", number][]) {
        expect(outward(arrowMesh(name), (m) => m.map((value, i) => (i === axis ? 0 : value)) as V3)).toBeCloseTo(0.4, 9);
        const along = normals(arrowMesh(name)).filter((n) => Math.abs(n[axis]!) > 0.99);
        // the start's end and the back of the head face back, the tip's end forward
        expect(along.filter((n) => n[axis]! < 0).length).toBe(28);
        expect(along.filter((n) => n[axis]! > 0).length).toBe(14);
    }
    // the ring's band faces away from the circle through its middle
    const r = 54 / 74;
    expect(outward(ringMesh(), (m) => {
        const long = Math.hypot(m[0], m[2]);
        return [m[0] - (m[0] / long) * r, m[1], m[2] - (m[2] / long) * r];
    })).toBe(1);
});

test("a point dragged where the view sees both its ways stays under the pointer exactly; seen from above it moves only aside, from the side only up", () => {
    const at: V3 = [12, 6, -18];
    const [up, aside]: V3[] = [[0, 1, 0], [0.8, 0, -0.6]];
    expect(freedomOf(orbit, 38, width / height, at, up, aside)).toBe("both");
    for (const [u, a] of [[2.5, -1.2], [-3, 4], [0.4, 0.1]] as [number, number][]) {
        const goal: V3 = [at[0] + aside[0] * a, at[1] + u, at[2] + aside[2] * a];
        const moved = dragged(orbit, 38, width / height, at, up, aside, "both", picture(at), picture(goal));
        expect(moved.up).toBeCloseTo(u, 9);
        expect(moved.aside).toBeCloseTo(a, 9);
    }
    // from straight above, up is seen end on
    const above: Orbit = { ...orbit, tip: Math.PI / 2 - 0.002 };
    expect(freedomOf(above, 38, width / height, at, up, aside)).toBe("aside");
    // looking along the way aside, it is seen end on
    const side: Orbit = { ...orbit, tip: 0.1, turn: Math.atan2(aside[0], aside[2]) };
    expect(freedomOf(side, 38, width / height, at, up, aside)).toBe("up");
    // held to one way, the other does not move however the pointer goes
    const only = dragged(above, 38, width / height, at, up, aside, "aside", [0, 0], [0.1, 0.2]);
    expect(only.up).toBe(0);
});

test("a point's numbers snap each way on their own, to the nearest snap within reach on the screen", () => {
    const snaps = { up: [{ at: 0, why: "straight" }, { at: 20, why: "level" }], aside: [{ at: 0, why: "straight" }, { at: -35, why: "like its partner" }] };
    // 4 pixels a millimetre: a snap 2 mm off is 8 pixels off, within 10
    expect(snapped({ up: 18, aside: 7 }, snaps, { up: 4, aside: 4 }, 10)).toEqual({ up: 20, aside: 7, why: ["level"] });
    expect(snapped({ up: 9, aside: -33 }, snaps, { up: 4, aside: 4 }, 10)).toEqual({ up: 9, aside: -35, why: ["like its partner"] });
    expect(snapped({ up: 1, aside: 1 }, snaps, { up: 4, aside: 4 }, 10).why).toEqual(["straight", "straight"]);
    // a way not seen does not snap
    expect(snapped({ up: 1, aside: 1 }, snaps, { up: 0, aside: 4 }, 10)).toEqual({ up: 1, aside: 0, why: ["straight"] });
    // the pixels a millimetre is: a centimetre up is about as many pixels as the handles' scale says
    const pixels = pixelsOf(orbit, 38, width, height, middle, [0, 1, 0], [1, 0, 0]);
    expect(pixels.up * 10).toBeGreaterThan((1 / across(orbit, 38, height, middle)) * 0.6);
    expect(pixels.up * 10).toBeLessThan((1 / across(orbit, 38, height, middle)) * 1.05);
});

test("while a piece is bent, its points are its only handles: the nearest point within a fingertip is taken", () => {
    const shown = pointsLayout(orbit, 38, width, height, [middle, [middle[0] + 10, middle[1], middle[2]]]);
    const [a, b] = shown.points!;
    expect(which(shown, a!.x + 3, a!.y, "touch")).toBe("point0");
    expect(which(shown, b!.x, b!.y - 4, "mouse")).toBe("point1");
    expect(which(shown, a!.x + 200, a!.y, "touch")).toBeUndefined();
    expect(pointOf("point1")).toBe(1);
    expect(pointOf("ring")).toBeUndefined();
});

test("on a small selection the handles stand off from it: every arrow starts and the ring runs outside what it reaches, and a large one is stood off from no further than a fifth of the picture", () => {
    const at = picture(middle);
    const centre = { x: ((at[0] + 1) / 2) * width, y: ((1 - at[1]) / 2) * height };
    const most = Math.min(width, height) * 0.2;
    for (const reach of [0, 20, 60, 110]) {
        const stand = standOff(reach, width, height);
        const shown = layout(orbit, 38, width, height, middle, undefined, stand);
        expect(stand).toBeLessThanOrEqual(most);
        if (reach + 10 - GAP > most) continue;
        // an arrow seen at a slant is shorter on the screen, so its nearest point is measured
        for (const arrow of Object.values(shown.arrows)) {
            const nearest = Math.min(...[0, 0.25, 0.5, 0.75, 1].map((t) => Math.hypot(arrow.from.x + (arrow.to.x - arrow.from.x) * t - centre.x, arrow.from.y + (arrow.to.y - arrow.from.y) * t - centre.y)));
            expect(nearest).toBeGreaterThan(Math.min(reach, GAP) * 0.55);
        }
        const xs = shown.ring.map((point) => point.x);
        expect((Math.max(...xs) - Math.min(...xs)) / 2).toBeGreaterThan(reach);
    }
    expect(standOff(0, width, height)).toBe(0);
    expect(standOff(10000, width, height)).toBe(most);
});
