// The points a piece is bent by are held to what a finger needs: they keep one size on the screen near
// and far; a pointer on one takes it, a fingertip from it still, and further away nothing; a point
// stays under the pointer, or moves along the one way the view sees, and snaps each way on its own.
// Run with `bun run test`.

import { expect, test } from "bun:test";
import { ARROW, across, boxed, dragged, freedomOf, pixelsOf, pointOf, pointsLayout, snapped, which } from "./handles";
import { project, type Orbit } from "./orbit";
import type { V3 } from "../mote/solids";

const orbit: Orbit = { at: [10, 5, -20], turn: 0.7, tip: 0.6, far: 160 };
const [width, height] = [1000, 700];
const middle: V3 = [12, 6, -18];
const picture = (p: V3): [number, number] => {
    const seen = project(orbit, 38, width / height, p)!;
    return [seen.x, seen.y];
};

test("a point is the same size on the screen near and far", () => {
    for (const far of [40, 160, 600]) {
        const near = { ...orbit, far };
        // a point drawn `across` times ARROW centimetres wide is ARROW pixels wide, wherever it is
        const size = across(near, 38, height, middle) * ARROW;
        const shown = pointsLayout(near, 38, width, height, [middle, [middle[0] + size, middle[1], middle[2]]]);
        const [a, b] = shown.points;
        expect(Math.hypot(b!.x - a!.x, b!.y - a!.y)).toBeGreaterThan(ARROW * 0.6);
        expect(Math.hypot(b!.x - a!.x, b!.y - a!.y)).toBeLessThan(ARROW * 1.05);
    }
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
    // the pixels a millimetre is: a centimetre up is about as many pixels as a point's scale says
    const pixels = pixelsOf(orbit, 38, width, height, middle, [0, 1, 0], [1, 0, 0]);
    expect(pixels.up * 10).toBeGreaterThan((1 / across(orbit, 38, height, middle)) * 0.6);
    expect(pixels.up * 10).toBeLessThan((1 / across(orbit, 38, height, middle)) * 1.05);
});

test("while a piece is bent, its points are its only handles: the nearest point within a fingertip is taken", () => {
    const shown = pointsLayout(orbit, 38, width, height, [middle, [middle[0] + 10, middle[1], middle[2]]]);
    const [a, b] = shown.points;
    expect(which(shown, a!.x + 3, a!.y, "touch")).toBe("point0");
    expect(which(shown, b!.x, b!.y - 4, "mouse")).toBe("point1");
    expect(which(shown, a!.x + 200, a!.y, "touch")).toBeUndefined();
    expect(pointOf("point1")).toBe(1);
});

test("a box drawn on the screen takes the pieces whose middles are inside it, drawn either way", () => {
    const middles = new Map<number, { x: number; y: number } | undefined>([[1, { x: 10, y: 10 }], [2, { x: 50, y: 40 }], [3, { x: 200, y: 10 }], [4, undefined]]);
    expect(boxed({ x: 0, y: 0 }, { x: 60, y: 50 }, middles)).toEqual([1, 2]);
    expect(boxed({ x: 60, y: 50 }, { x: 0, y: 0 }, middles)).toEqual([1, 2]);
    expect(boxed({ x: 100, y: 0 }, { x: 300, y: 20 }, middles)).toEqual([3]);
    expect(boxed({ x: 0, y: 0 }, { x: 1, y: 1 }, middles)).toEqual([]);
});
