// The points a piece is bent by are held to what a finger needs: they keep one size on the screen near
// and far; a pointer on one takes it, a fingertip from it still, and further away nothing; a point
// stays under the pointer, or moves along the one way the view sees, and snaps each way on its own.
// Run with `bun run test`.

import { expect, test } from "bun:test";
import { ARROW, across, dragged, freedomOf, pixelsOf, pointOf, pointsLayout, snapped, stripPlace, which, type Rect } from "./handles";
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

test("the strip by what is chosen sits above it, under it, or beside it, wholly on the screen, never over it; and nowhere while it is off the screen", () => {
    const strip = { w: 300, h: 50 };
    const overlaps = (a: { x: number; y: number }, b: Rect) => a.x < b.right && a.x + strip.w > b.left && a.y < b.bottom && a.y + strip.h > b.top;
    const middle: Rect = { left: 400, right: 600, top: 300, bottom: 400 };
    expect(stripPlace(middle, undefined, strip, width, height)).toEqual({ x: 350, y: 240, below: false });
    // no room above: under it
    expect(stripPlace({ ...middle, top: 20 }, undefined, strip, width, height)?.below).toBe(true);
    // the handles are kept clear too
    expect(stripPlace(middle, { left: 450, right: 550, top: 200, bottom: 500 }, strip, width, height)?.y).toBe(140);
    // filling the screen up and down: beside it, or nowhere
    const tall: Rect = { left: 100, right: 400, top: -50, bottom: 760 };
    const beside = stripPlace(tall, undefined, strip, width, height)!;
    expect(beside.x).toBe(410);
    expect(stripPlace({ left: -10, right: 1010, top: -10, bottom: 710 }, undefined, strip, width, height)).toBeUndefined();
    // off the screen to the lower left, as it was seen floating over the empty table: nowhere
    expect(stripPlace({ left: -500, right: -100, top: 800, bottom: 900 }, undefined, strip, width, height)).toBeUndefined();
    expect(stripPlace({ left: -500, right: 10, top: 300, bottom: 400 }, undefined, strip, width, height)).toBeUndefined();
    // and wherever it goes, it is on the screen and not over what is chosen
    for (let i = 0; i < 2000; i++) {
        const [x, y, w, h] = [Math.random() * 1400 - 200, Math.random() * 1000 - 150, Math.random() * 600, Math.random() * 500];
        const chosen: Rect = { left: x, right: x + w, top: y, bottom: y + h };
        const place = stripPlace(chosen, undefined, strip, width, height);
        if (!place) continue;
        expect(place.x).toBeGreaterThanOrEqual(8);
        expect(place.x + strip.w).toBeLessThanOrEqual(width - 8);
        expect(place.y).toBeGreaterThanOrEqual(8);
        expect(place.y + strip.h).toBeLessThanOrEqual(height - 8);
        expect(overlaps(place, chosen)).toBe(false);
    }
});
