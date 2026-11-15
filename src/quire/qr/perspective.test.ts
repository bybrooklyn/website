// What the reader's perspective arithmetic is held to: four places go where they were told, a place
// between them lands where a true perspective puts it, and places on a line give no map.

import { expect, test } from "bun:test";
import { mapFour, solve, through } from "./perspective";

test("a system of equations is solved, and one with no single answer is refused", () => {
    expect(solve([[2, 1], [1, 3]], [5, 10])!.map((each) => Math.round(each * 1e9) / 1e9)).toEqual([1, 3]);
    expect(solve([[1, 2], [2, 4]], [1, 2])).toBeUndefined();
});

test("the four places go where they were told, and the middle of a square lands on the crossing of the seen quad's diagonals", () => {
    const from = [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }];
    const to = [{ x: 100, y: 50 }, { x: 300, y: 80 }, { x: 280, y: 260 }, { x: 90, y: 210 }];
    const map = mapFour(from, to)!;
    from.forEach((place, i) => {
        const seen = through(map, place.x, place.y);
        expect(seen.x).toBeCloseTo(to[i]!.x, 6);
        expect(seen.y).toBeCloseTo(to[i]!.y, 6);
    });
    // the diagonals of the seen quad cross where the square's middle is seen
    const middle = through(map, 5, 5);
    const [a, b, c, d] = to as [{ x: number; y: number }, { x: number; y: number }, { x: number; y: number }, { x: number; y: number }];
    const cross = (p: typeof a, q: typeof a, r: typeof a, s: typeof a) => (q.x - p.x) * (s.y - r.y) - (q.y - p.y) * (s.x - r.x);
    const t = cross(a, d, d, b) / cross(a, c, d, b);
    expect(middle.x).toBeCloseTo(a.x + t * (c.x - a.x), 6);
    expect(middle.y).toBeCloseTo(a.y + t * (c.y - a.y), 6);
    expect(mapFour(from, [{ x: 0, y: 0 }, { x: 1, y: 1 }, { x: 2, y: 2 }, { x: 3, y: 3 }])).toBeUndefined();
});
