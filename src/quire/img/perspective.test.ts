// What a perspective step is held to: corners set by hand go to a rectangle of their proportions, their
// own size and middle; the dials keep the picture's middle where it was; a map that throws the picture
// behind the camera or spreads it far past itself is no map; and on a picture straightened by a
// perspective (and turned too), the largest upright rectangle inside is inside, touches the edge, matches
// the closed form where there is only a turn and a search over many shapes where there is a perspective,
// and a crop of her own is kept, made smaller to fit, or stopped at the edge as on a turned picture.

import { expect, test } from "bun:test";
import { apply } from "./homography";
import { areaOf, perspectiveMap, rectangleOf, rectCorners, type Corners } from "./perspective";
import { fitInside, fromLevel, inside, keepInside, largestInQuad, largestInside, largestSize, levelBox, toLevel, turnOf } from "./turn";

const size = { width: 4000, height: 3000 };
const page: Corners = [{ x: 1200, y: 700 }, { x: 2900, y: 820 }, { x: 3100, y: 2500 }, { x: 1000, y: 2300 }];

test("corners set by hand go to a rectangle of their proportions, their own size and their middle", () => {
    const map = perspectiveMap({ corners: page, ratio: 210 / 297 }, size)!;
    const target = rectCorners(rectangleOf(page, 210 / 297));
    page.forEach((corner, at) => {
        const there = apply(map, corner);
        expect(Math.hypot(there.x - target[at]!.x, there.y - target[at]!.y)).toBeLessThan(1e-6);
    });
    const rect = rectangleOf(page, 210 / 297);
    expect(rect.width / rect.height).toBeCloseTo(210 / 297, 9);
    expect(rect.width * rect.height).toBeCloseTo(areaOf(page), 6);
});

test("the dials keep the picture's middle, and a map that cannot be seen whole is none", () => {
    const map = perspectiveMap({ vertical: 10, horizontal: -6 }, size)!;
    const middle = apply(map, { x: 2000, y: 1500 });
    expect(Math.hypot(middle.x - 2000, middle.y - 1500)).toBeLessThan(1e-6);
    expect(perspectiveMap({}, size)).toBeUndefined();
    expect(perspectiveMap({ vertical: 0, horizontal: 0 }, size)).toBeUndefined();
    // a sliver of a quad at the picture's foot would throw the top of the picture past the horizon
    expect(perspectiveMap({ corners: [{ x: 1900, y: 2900 }, { x: 2100, y: 2900 }, { x: 3900, y: 2990 }, { x: 100, y: 2990 }], ratio: 1 }, size)).toBeUndefined();
    // corners bent inward are no shape
    expect(perspectiveMap({ corners: [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 30, y: 30 }, { x: 0, y: 100 }], ratio: 1 }, size)).toBeUndefined();
});

test("with only a turn, the search for the largest rectangle matches the closed form", () => {
    for (const degrees of [3, 8, 15]) {
        const turn = turnOf(degrees, size);
        const corners = rectCorners({ x: 0, y: 0, ...size }).map((point) => toLevel(point, turn));
        const found = largestInQuad(corners);
        const closed = largestSize(size.width, size.height, degrees);
        expect(Math.abs((found.width * found.height) / (closed.width * closed.height) - 1)).toBeLessThan(0.002);
    }
});

/** The largest area of an upright rectangle on the straightened picture, by trying 150 lefts and rights and the tallest that fits over each, halving. */
function searched(turn: ReturnType<typeof turnOf>): number {
    const box = levelBox(turn);
    let best = 0;
    const steps = 150;
    for (let i = 0; i < steps; i++)
        for (let j = i + 1; j <= steps; j++) {
            const x0 = box.x + (box.width * i) / steps;
            const x1 = box.x + (box.width * j) / steps;
            // the tallest rectangle over the stretch about each of a few middles
            for (let k = 1; k < 8; k++) {
                const middle = box.y + (box.height * k) / 8;
                let low = 0;
                let high = box.height;
                for (let round = 0; round < 20; round++) {
                    const h = (low + high) / 2;
                    if (inside({ x: x0, y: middle - h / 2, width: x1 - x0, height: h }, turn)) low = h;
                    else high = h;
                }
                best = Math.max(best, (x1 - x0) * low);
            }
        }
    return best;
}

test("on a straightened and turned picture the largest rectangle inside is inside, touches, and is as large as a search finds", () => {
    for (const [step, degrees] of [[{ vertical: 9 }, 0], [{ vertical: -6, horizontal: 8 }, 2.5], [{ corners: page, ratio: 0.7 }, 0]] as const) {
        const turn = turnOf(degrees, size, perspectiveMap(step, size));
        const crop = largestInside(turn);
        expect(inside(crop, turn)).toBe(true);
        // a pixel more on any side leaves the picture somewhere
        const grown = [{ ...crop, x: crop.x - 1, width: crop.width + 1 }, { ...crop, width: crop.width + 1 }, { ...crop, y: crop.y - 1, height: crop.height + 1 }, { ...crop, height: crop.height + 1 }];
        expect(grown.some((rect) => !inside(rect, turn))).toBe(true);
        expect((crop.width * crop.height) / searched(turn)).toBeGreaterThan(0.995);
        // a place there and back is where it was
        const back = fromLevel(toLevel({ x: 123, y: 2345 }, turn), turn);
        expect(Math.hypot(back.x - 123, back.y - 2345)).toBeLessThan(1e-6);
    }
}, 60_000);

test("a crop of her own on a straightened picture is kept, made smaller to fit, and stopped at the edge", () => {
    const turn = turnOf(0, size, perspectiveMap({ vertical: 12 }, size));
    const crop = largestInside(turn);
    const small = { x: crop.x + 100, y: crop.y + 100, width: 400, height: 300 };
    expect(fitInside(small, turn)).toEqual(small);
    const big = { x: -200, y: -200, width: 4400, height: 3400 };
    const fitted = fitInside(big, turn);
    expect(inside(fitted, turn)).toBe(true);
    expect(fitted.width / fitted.height).toBeCloseTo(4400 / 3400, 2);
    const moved = keepInside(small, { ...small, x: -5000 }, turn);
    expect(inside(moved, turn)).toBe(true);
    expect(moved.x).toBeLessThan(small.x);
});
