// What Comet shows besides the game, held to what it promises: the dots while aiming are the
// flight's own first second, on its way and evenly spaced along it; the planets' colors and the stars
// follow from the seed alone, and no two planets of a field share a hue; and the tail streams away
// from the planets. Run with `bun test`.

import { expect, test } from "bun:test";
import { make } from "./fields";
import { STEP, advance, launch, velocity, type Field } from "./flight";
import { AHEAD, ahead, along, stars, tailward, tints } from "./sky";

const field: Field = {
    seed: "test",
    level: 1,
    start: { x: 200, y: 500 },
    hole: { x: 1300, y: 500 },
    planets: [
        { x: 640, y: 430, r: 60 },
        { x: 980, y: 610, r: 40 },
    ],
};

test("the path ahead is the flight's own first second, point for point", () => {
    for (const [aim, power] of [
        [0, 0.5],
        [-30, 1],
        [12, 0.18],
        [700, 0.8],
    ] as const) {
        const [vx, vy] = velocity(aim, power);
        const shown = ahead(field, vx, vy);
        // the flight as the game flies it: launched, then one step at a time, each place kept
        const comet = launch(field, vx, vy);
        const flown = [comet.x, comet.y];
        while (!comet.ended && comet.step < Math.round(AHEAD / STEP)) flown.push(advance(field, comet).x, comet.y);
        expect(shown).toEqual(flown);
    }
});

test("the path ahead stops where the flight ends, at the planet it strikes", () => {
    const blocked: Field = { ...field, planets: [{ x: 320, y: 500, r: 50 }] };
    const shown = ahead(blocked, ...velocity(0, 1));
    expect(shown.length / 2).toBeLessThan(Math.round(AHEAD / STEP) + 1);
    expect(shown.at(-2)!).toBeCloseTo(270, 6);
    expect(shown.at(-1)!).toBeCloseTo(500, 6);
});

test("on a field that is played, the path ahead of its winning launch begins the winning flight", () => {
    const made = make("lumen", 6);
    const [vx, vy] = velocity(made.solution.aim, made.solution.power);
    const comet = launch(made.field, vx, vy);
    const shown = ahead(made.field, vx, vy);
    for (let i = 1; i < shown.length / 2; i++) {
        advance(made.field, comet);
        expect([shown[i * 2], shown[i * 2 + 1]]).toEqual([comet.x, comet.y]);
    }
});

test("the dots lie on the path, evenly spaced along it, fading from its start to its end", () => {
    const path = ahead(field, ...velocity(-20, 0.9));
    const spacing = 17;
    const dots = along(path, spacing);
    expect(dots.length / 3).toBeGreaterThan(10);
    /** How far a place is from the path: from the nearest of its straight pieces. */
    const off = (x: number, y: number) => {
        let least = Infinity;
        for (let i = 1; i < path.length / 2; i++) {
            const [x0, y0, x1, y1] = [path[i * 2 - 2]!, path[i * 2 - 1]!, path[i * 2]!, path[i * 2 + 1]!];
            const [dx, dy] = [x1 - x0, y1 - y0];
            const t = Math.max(0, Math.min(1, ((x - x0) * dx + (y - y0) * dy) / (dx * dx + dy * dy)));
            least = Math.min(least, Math.hypot(x0 + dx * t - x, y0 + dy * t - y));
        }
        return least;
    };
    let last = 0;
    for (let i = 0; i < dots.length; i += 3) {
        expect(off(dots[i]!, dots[i + 1]!)).toBeLessThan(1e-9);
        expect(dots[i + 2]!).toBeGreaterThan(last);
        expect(dots[i + 2]!).toBeLessThanOrEqual(1);
        last = dots[i + 2]!;
        // a dot is never further from the one before than the spacing, which is measured along a curve
        if (i > 0) expect(Math.hypot(dots[i]! - dots[i - 3]!, dots[i + 1]! - dots[i - 2]!)).toBeLessThanOrEqual(spacing + 1e-9);
    }
    expect(along([1, 1], spacing)).toEqual([]);
});

test("a planet's color depends on the seed and level alone, and no two planets of a field share a hue", () => {
    expect(tints("lumen", 6, 3)).toEqual(tints("lumen", 6, 3));
    expect(tints("lumen", 6, 3)).not.toEqual(tints("tide", 6, 3));
    expect(tints("lumen", 6, 3)).not.toEqual(tints("lumen", 7, 3));
    for (const seed of ["lumen", "orchard", "tide", "bakulo", "ferro", "quill"]) {
        for (let level = 1; level <= 30; level++) {
            const colors = tints(seed, level, 4);
            for (const tint of colors) {
                expect(tint.h).toBeGreaterThanOrEqual(0);
                expect(tint.h).toBeLessThan(360);
                expect(tint.l).toBeGreaterThan(0.6);
                expect(tint.l).toBeLessThan(0.83);
            }
            for (let a = 0; a < colors.length; a++) {
                for (let b = a + 1; b < colors.length; b++) {
                    const apart = Math.abs(colors[a]!.h - colors[b]!.h) % 360;
                    expect(Math.min(apart, 360 - apart)).toBeGreaterThan(20);
                }
            }
        }
    }
});

test("the stars follow from the seed alone, fill the sky, and a few of them are brighter", () => {
    expect(stars("lumen", 300)).toEqual(stars("lumen", 300));
    expect(stars("lumen", 300)).not.toEqual(stars("tide", 300));
    const sky = stars("lumen", 900);
    for (const star of sky) {
        for (const n of [star.x, star.y, star.bright, star.near]) {
            expect(n).toBeGreaterThanOrEqual(0);
            expect(n).toBeLessThanOrEqual(1);
        }
    }
    const brighter = sky.filter((star) => star.bright > 0.5).length / sky.length;
    expect(brighter).toBeGreaterThan(0.02);
    expect(brighter).toBeLessThan(0.12);
});

test("the tail streams away from the planets, longer near them, and along the way given when there are none", () => {
    const one: Field = { ...field, planets: [{ x: 500, y: 500, r: 50 }] };
    const [tx, ty, near] = tailward(one, 600, 500, [0, 1]);
    expect(tx).toBeCloseTo(1, 9);
    expect(ty).toBeCloseTo(0, 9);
    expect(tailward(one, 500, 400, [0, 1])[1]).toBeCloseTo(-1, 9);
    expect(tailward(one, 1100, 500, [0, 1])[2]).toBeLessThan(near);
    expect(tailward({ ...field, planets: [] }, 600, 500, [3, 4])).toEqual([0.6, 0.8, 0]);
});
