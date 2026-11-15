// What perspective's arithmetic is held to: four places go where they were sent and the map turned back
// brings them home; maps put one after another do both; a tilted camera's map leaves a level camera's
// picture alone and stands converging verticals up straight; the stretch it reads matches a small step
// measured; the true proportions of an A4 page, a screen and a square photographed at a slant by a
// pinhole camera are found within a percent from their four corners alone (with one pair of sides
// parallel, when the camera's focal length is the one taken for a picture); and the card's weights for a
// shape in perspective draw its middle where the map puts it.

import { expect, test } from "bun:test";
import { apply, convex, cornerDepths, invert, keepMiddle, multiply, quadToQuad, ratioOf, squareToQuad, stretch, tilted, type Matrix, type Spot } from "./homography";

const near = (a: Spot, b: Spot, within = 1e-6) => expect(Math.hypot(a.x - b.x, a.y - b.y)).toBeLessThan(within);

test("four places go where they are sent, and the map turned back brings them home", () => {
    const from = [{ x: 120, y: 80 }, { x: 900, y: 140 }, { x: 860, y: 700 }, { x: 60, y: 620 }];
    const to = [{ x: 0, y: 0 }, { x: 800, y: 0 }, { x: 800, y: 600 }, { x: 0, y: 600 }];
    const map = quadToQuad(from, to)!;
    from.forEach((point, at) => near(apply(map, point), to[at]!));
    const back = invert(map)!;
    to.forEach((point, at) => near(apply(back, point), from[at]!));
    // one after the other is the same as doing both
    const both = multiply(back, map);
    near(apply(both, { x: 333, y: 444 }), { x: 333, y: 444 });
    // three on a line fix nothing
    expect(quadToQuad([{ x: 0, y: 0 }, { x: 1, y: 1 }, { x: 2, y: 2 }, { x: 0, y: 5 }], to)).toBeUndefined();
});

test("the unit square's map is a plain one for a parallelogram, and shapes bent inward are not convex", () => {
    const map = squareToQuad([{ x: 10, y: 10 }, { x: 110, y: 20 }, { x: 120, y: 120 }, { x: 20, y: 110 }])!;
    expect(map[6]).toBe(0);
    expect(map[7]).toBe(0);
    near(apply(map, { x: 0.5, y: 0.5 }), { x: 65, y: 65 });
    expect(convex([{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }])).toBe(true);
    expect(convex([{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 3, y: 3 }, { x: 0, y: 10 }])).toBe(false);
    expect(convex([{ x: 0, y: 0 }, { x: 10, y: 10 }, { x: 10, y: 0 }, { x: 0, y: 10 }])).toBe(false);
});

test("a level camera changes nothing, and tilting it stands converging verticals up straight", () => {
    const size = { width: 4000, height: 3000 };
    const level = tilted(0, 0, size);
    near(apply(level, { x: 17, y: 2900 }), { x: 17, y: 2900 });
    // a building seen from below: its sides lean in toward the top, meeting above the picture
    const focal = 4000;
    const up = 12;
    const lean = tilted(-up, 0, size, focal);
    const straight = (x: number) => [apply(lean, { x, y: 300 }), apply(lean, { x, y: 2700 })];
    const left = straight(800);
    const right = straight(3200);
    // tilted back by the same degrees, the leaning sides stand plumb again
    const back = tilted(up, 0, size, focal);
    for (const [top, bottom] of [left, right]) {
        const a = apply(back, top!);
        const b = apply(back, bottom!);
        expect(Math.abs(a.x - b.x)).toBeLessThan(1e-6);
    }
    // and leaning, they did lean in
    expect(left[0]!.x - left[1]!.x).toBeGreaterThan(10);
    expect(right[0]!.x - right[1]!.x).toBeLessThan(-10);
});

test("the stretch read at a place matches a small step measured, and keeping the middle keeps its place and size", () => {
    const map = quadToQuad([{ x: 100, y: 50 }, { x: 900, y: 0 }, { x: 1000, y: 800 }, { x: 0, y: 700 }], [{ x: 0, y: 0 }, { x: 1000, y: 0 }, { x: 1000, y: 800 }, { x: 0, y: 800 }])!;
    const at = { x: 400, y: 300 };
    const read = stretch(map, at);
    const step = 1e-3;
    const a = apply(map, at);
    const b = apply(map, { x: at.x + step, y: at.y });
    const c = apply(map, { x: at.x, y: at.y + step });
    expect(read.across).toBeCloseTo(Math.hypot(b.x - a.x, b.y - a.y) / step, 4);
    expect(read.down).toBeCloseTo(Math.hypot(c.x - a.x, c.y - a.y) / step, 4);
    const size = { width: 1000, height: 800 };
    const kept = keepMiddle(map, size);
    near(apply(kept, { x: 500, y: 400 }), { x: 500, y: 400 }, 1e-6);
    expect(stretch(kept, { x: 500, y: 400 }).area).toBeCloseTo(1, 9);
});

/** A rectangle of a width and height photographed by a pinhole camera of a focal length, turned by some degrees about each axis and set some way off, as the four corners it shows on a picture of a size. */
function photographed(width: number, height: number, focal: number, turns: [number, number, number], distance: number, size: { width: number; height: number }): Spot[] {
    const [a, b, c] = turns.map((degrees) => (degrees * Math.PI) / 180) as [number, number, number];
    const rx: Matrix = [1, 0, 0, 0, Math.cos(a), -Math.sin(a), 0, Math.sin(a), Math.cos(a)];
    const ry: Matrix = [Math.cos(b), 0, Math.sin(b), 0, 1, 0, -Math.sin(b), 0, Math.cos(b)];
    const rz: Matrix = [Math.cos(c), -Math.sin(c), 0, Math.sin(c), Math.cos(c), 0, 0, 0, 1];
    const turn = multiply(rz, multiply(ry, rx));
    return [
        [-width / 2, -height / 2],
        [width / 2, -height / 2],
        [width / 2, height / 2],
        [-width / 2, height / 2],
    ].map(([x, y]) => {
        const p = [turn[0] * x! + turn[1] * y!, turn[3] * x! + turn[4] * y!, turn[6] * x! + turn[7] * y! + distance];
        return { x: size.width / 2 + (focal * p[0]!) / p[2]!, y: size.height / 2 + (focal * p[1]!) / p[2]! };
    });
}

test("the true proportions of a page, a screen and a square seen at a slant are found from their corners within a percent", () => {
    const size = { width: 4032, height: 3024 };
    const cases: [number, number, number, [number, number, number]][] = [
        [210, 297, 3200, [25, -15, 4]],
        [210, 297, 2400, [-35, 10, -8]],
        [160, 90, 4000, [10, 30, 2]],
        // one pair of sides parallel: right when the camera's focal length is the one taken for a picture
        [100, 100, 4032, [40, 0, 0]],
        [100, 100, 4032, [0, -30, 0]],
        [100, 100, 3000, [20, 25, 10]],
    ];
    for (const [width, height, focal, turns] of cases) {
        const corners = photographed(width, height, focal, turns, Math.max(width, height) * 2.2, size);
        expect(convex(corners)).toBe(true);
        const found = ratioOf(corners, size);
        expect(Math.abs(found / (width / height) - 1)).toBeLessThan(0.01);
    }
    // seen straight on, the plain ratio of the sides is the answer
    expect(ratioOf([{ x: 100, y: 100 }, { x: 310, y: 100 }, { x: 310, y: 397 }, { x: 100, y: 397 }], size)).toBeCloseTo(210 / 297, 6);
});

test("the card's weights for a shape in perspective put its middle where the map does", () => {
    const quad: [Spot, Spot, Spot, Spot] = [{ x: 100, y: 100 }, { x: 500, y: 140 }, { x: 60, y: 460 }, { x: 560, y: 420 }];
    const depths = cornerDepths(quad);
    // perspective-correct interpolation: each corner's place over its weight, and one over its weight, are straight-line mixes
    const mix = (u: number, v: number) => {
        const corners = [[0, 0], [1, 0], [0, 1], [1, 1]] as const;
        let x = 0;
        let y = 0;
        let w = 0;
        corners.forEach(([cu, cv], at) => {
            const share = (cu ? u : 1 - u) * (cv ? v : 1 - v);
            // the card mixes the place times its weight and the weight in clip space
            x += share * quad[at]!.x * depths[at]!;
            y += share * quad[at]!.y * depths[at]!;
            w += share * depths[at]!;
        });
        return { x: x / w, y: y / w };
    };
    const map = squareToQuad([quad[0], quad[1], quad[3], quad[2]])!;
    near(mix(0.5, 0.5), apply(map, { x: 0.5, y: 0.5 }), 1e-6);
    near(mix(0.25, 0.8), apply(map, { x: 0.25, y: 0.8 }), 1e-6);
    expect(cornerDepths([{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 0, y: 10 }, { x: 10, y: 10 }])).toEqual([1, 1, 1, 1]);
});
