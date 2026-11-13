// The comet's flight, held to its rules: the same every time, nothing passed through, wormholes that
// keep speed and heading, and an orbit that keeps its energy. Run with `bun test`.

import { expect, test } from "bun:test";
import { AIMS, FASTEST, HIGH, LIMIT, STEP, TURNS, WEAKEST, WIDE, advance, fly, launch, nearest, pull, velocity, type Field } from "./flight";

/** A field made by hand: the start on the left, the hole on the right, nothing else unless given. */
const field = (more: Partial<Field> = {}): Field => ({
    seed: "test",
    level: 1,
    start: { x: 100, y: 320 },
    hole: { x: 900, y: 320, radius: 15, reach: 24, mass: 2.4e7 },
    stars: [],
    gates: [],
    ...more,
});

test("the directions are half a degree apart, each one long, and a quarter of the way round points down the field", () => {
    expect(AIMS).toHaveLength(TURNS);
    for (let i = 0; i < TURNS; i++) {
        const [x, y] = AIMS[i]!;
        const [nx, ny] = AIMS[(i + 1) % TURNS]!;
        expect(Math.hypot(x, y)).toBeCloseTo(1, 12);
        expect(x * nx + y * ny).toBeCloseTo(Math.cos(Math.PI / 360), 12);
    }
    expect(AIMS[180]![0]).toBeCloseTo(0, 10);
    expect(AIMS[180]![1]).toBeCloseTo(1, 10);
    expect(AIMS[360]![0]).toBeCloseTo(-1, 10);
    expect(nearest(0, -5)).toBe(540);
});

test("a launch's strength is held between the weakest and full", () => {
    expect(Math.hypot(...velocity(0, 0))).toBeCloseTo(WEAKEST * FASTEST);
    expect(Math.hypot(...velocity(0, 1000))).toBeCloseTo(FASTEST);
    expect(velocity(-1, 20)).toEqual(velocity(TURNS - 1, 20));
});

test("the same field and launch give the same flight, to the last digit, and the flight below is the one every machine gives", () => {
    const busy = field({ stars: [{ x: 500, y: 250, radius: 24, mass: 300 * 24 ** 3 }, { x: 650, y: 420, radius: 18, mass: -330 * 18 ** 3 }] });
    const run = () => {
        const comet = launch(busy, ...velocity(632, 8));
        const path: number[] = [];
        while (!comet.ended) path.push(advance(busy, comet).x, comet.y);
        return { path, ended: comet.ended };
    };
    const [one, two] = [run(), run()];
    expect(two).toEqual(one);
    // written down once: a change here means flights, and so fields, changed for everyone
    expect(one.ended).toBe("won");
    expect(one.path.length / 2).toBe(351);
    expect(one.path[200]).toBe(210.09902059005185);
});

test("a comet sent straight at the hole is swallowed, and its pull reaches across the field", () => {
    expect(fly(field(), ...velocity(0, 20)).ended).toBe("won");
    // aimed well wide of it, the pull still bends the comet in
    expect(fly(field(), ...velocity(nearest(800, -60), 14)).ended).toBe("won");
    const [ax] = pull(field(), 100, 320);
    expect(ax).toBeGreaterThan(0);
});

test("a comet that leaves the field, touches a star, or flies too long has missed", () => {
    expect(fly(field(), ...velocity(360, 30)).ended).toBe("out");
    expect(fly(field({ stars: [{ x: 500, y: 320, radius: 20, mass: 1 }] }), ...velocity(0, 30)).ended).toBe("struck");
    // a star heavy enough to hold the comet in orbit, and a hole too far and too weak to matter
    const held = field({ hole: { x: 990, y: 10, radius: 5, reach: 5, mass: 1 }, stars: [{ x: 500, y: 320, radius: 20, mass: 4e7 }] });
    const speed = Math.sqrt(4e7 / 200);
    const comet = { ...launch({ ...held, start: { x: 500, y: 120 } }, speed, 0) };
    let steps = 0;
    while (!comet.ended) {
        advance(held, comet);
        steps++;
    }
    expect(comet.ended).toBe("late");
    expect(steps * STEP).toBeCloseTo(LIMIT, 5);
});

test("a fast comet cannot pass through a thin star between one step and the next", () => {
    // at full strength it moves six units a step; the star is three across
    const thin = field({ stars: [{ x: 400, y: 320, radius: 1.5, mass: 1 }] });
    expect(fly(thin, ...velocity(0, 40)).ended).toBe("struck");
});

test("a pusher pushes and a star pulls", () => {
    const [toward] = pull(field({ hole: { x: 0, y: 0, radius: 1, reach: 1, mass: 0 }, stars: [{ x: 600, y: 320, radius: 20, mass: 1e6 }] }), 500, 320);
    const [away] = pull(field({ hole: { x: 0, y: 0, radius: 1, reach: 1, mass: 0 }, stars: [{ x: 600, y: 320, radius: 20, mass: -1e6 }] }), 500, 320);
    expect(toward).toBeGreaterThan(0);
    expect(away).toBeLessThan(0);
});

test("a wormhole sends the comet out of its other mouth at the same speed and heading, from just outside it", () => {
    const gated = field({
        hole: { x: 900, y: 600, radius: 5, reach: 8, mass: 0 },
        gates: [{ x: 400, y: 320, radius: 19, to: 1, pair: 0 }, { x: 600, y: 100, radius: 19, to: 0, pair: 0 }],
    });
    const comet = launch(gated, ...velocity(0, 20));
    let came: typeof comet | undefined;
    while (!comet.ended && !came) {
        const [vx, vy] = [comet.vx, comet.vy];
        advance(gated, comet);
        if (comet.through !== undefined) {
            came = { ...comet };
            // nothing pulls, so the velocity is untouched by the trip
            expect(comet.vx).toBeCloseTo(vx, 9);
            expect(comet.vy).toBeCloseTo(vy, 9);
        }
    }
    expect(came?.through).toBe(1);
    expect(came!.x).toBeCloseTo(600 + 19.5, 6);
    expect(came!.y).toBeCloseTo(100, 6);
    // and it goes on its way, out of the field, without falling back in
    while (!comet.ended) {
        advance(gated, comet);
        expect(comet.through).toBeUndefined();
    }
    expect(comet.ended).toBe("out");
});

test("a comet in orbit keeps its energy to within half a percent over ten seconds", () => {
    const mass = 4e7;
    const lone = field({ hole: { x: 0, y: 0, radius: 1, reach: 1, mass: 0 }, stars: [{ x: 500, y: 320, radius: 10, mass }] });
    const comet = launch({ ...lone, start: { x: 500, y: 170 } }, Math.sqrt(mass / 150) * 0.9, 0);
    const energy = () => {
        const [dx, dy] = [comet.x - 500, comet.y - 320];
        const soft = Math.sqrt(dx * dx + dy * dy + 25);
        return (comet.vx ** 2 + comet.vy ** 2) / 2 - mass / soft;
    };
    const before = energy();
    for (let i = 0; i < 1199; i++) advance(lone, comet);
    expect(comet.ended).toBeUndefined();
    expect(Math.abs(energy() / before - 1)).toBeLessThan(0.005);
    expect(comet.x).toBeGreaterThan(0);
    expect(comet.x).toBeLessThan(WIDE);
    expect(comet.y).toBeLessThan(HIGH);
});
