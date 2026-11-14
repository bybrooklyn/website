// The comet's flight, held to its rules: the same every time, nothing passed through, each thing's
// pull felt only within its reach, the hole's grip, clouds, rings, walls and sparks each doing their
// one thing, wormholes that keep speed and heading, things that move by the flight's clock, and an
// orbit that keeps its energy. Run with `bun test`.

import { expect, test } from "bun:test";
import { AIMS, BOOST, CLOUD_DRAG, FASTEST, HIGH, LIMIT, STEP, TURNS, WEAKEST, WIDE, advance, fly, launch, nearest, pull, strength, velocity, where, type Field } from "./flight";

/** A field made by hand: the start on the left, the hole on the right, nothing else unless given. */
const field = (more: Partial<Field> = {}): Field => ({
    seed: "test",
    level: 1,
    idea: "bend",
    start: { x: 200, y: 500 },
    hole: { x: 1300, y: 500, radius: 18, mouth: 24, reach: 220, grip: 90, mass: 3e7 },
    bodies: [],
    gates: [],
    clouds: [],
    rings: [],
    walls: [],
    sparks: [],
    ...more,
});
/** A hole that does nothing, far away, for fields about something else. */
const none = { x: 1590, y: 10, radius: 1, mouth: 1, reach: 1, grip: 1, mass: 0 };

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
    const busy = field({
        bodies: [
            { x: 700, y: 420, radius: 30, mass: 4000 * 900, reach: 135 },
            { x: 950, y: 620, radius: 24, mass: -4000 * 576, reach: 96 },
            { x: 0, y: 0, radius: 18, mass: 0, reach: 0, path: { kind: "line", ax: 1000, ay: 200, bx: 1000, by: 800, period: 600, from: 0.3 } },
        ],
        clouds: [{ x: 500, y: 520, radius: 80 }],
    });
    const run = () => {
        const comet = launch(busy, ...velocity(nearest(1100, 0) + 6, 24));
        const path: number[] = [];
        while (!comet.ended) path.push(advance(busy, comet).x, comet.y);
        return { path, ended: comet.ended };
    };
    const [one, two] = [run(), run()];
    expect(two).toEqual(one);
    // Written down once: a change here means flights, and so fields, changed for everyone. Last
    // changed when the pull was given a reach, the hole a grip and the comet a slower speed.
    expect(one.ended).toBe("won");
    expect(one.path.length / 2).toBe(FLIGHT.steps);
    expect(one.path[200]).toBe(FLIGHT.x100);
});
const FLIGHT = { steps: 592, x100: 492.2777166096309 };

test("a thing's pull is felt only within its reach, fading to nothing at its edge", () => {
    expect(strength(1e6, 100, 5, 99.9 * 99.9)).toBeGreaterThan(0);
    expect(strength(1e6, 100, 5, 99.99 * 99.99)).toBeLessThan(strength(1e6, 100, 5, 99.9 * 99.9));
    expect(strength(1e6, 100, 5, 100 * 100)).toBe(0);
    expect(strength(1e6, 100, 5, 300 * 300)).toBe(0);
    // the hole: nothing at all past its reach, and steep inside it
    const [far] = pull(field(), 1300 - 230, 500);
    const [edge] = pull(field(), 1300 - 200, 500);
    const [near] = pull(field(), 1300 - 60, 500);
    expect(far).toBe(0);
    expect(edge).toBeGreaterThan(0);
    expect(near).toBeGreaterThan(edge * 40);
});

test("the hole grabs a comet that comes near and barely bends one that passes wide", () => {
    // aimed a little off the hole, it is pulled in; aimed well off, it passes by almost as it was
    const near = fly(field({ start: { x: 200, y: 570 } }), 360, 0);
    expect(near.ended).toBe("won");
    const wide = launch(field({ start: { x: 200, y: 740 } }), 360, 0);
    while (!wide.ended) advance(field({ start: { x: 200, y: 740 } }), wide);
    expect(wide.ended).toBe("out");
    expect(Math.abs(Math.atan2(wide.vy, wide.vx))).toBeLessThan(0.05);
});

test("a comet that comes close goes round the hole as it falls, losing speed to its grip, and is swallowed", () => {
    const one = field({ start: { x: 200, y: 590 } });
    const comet = launch(one, 480, 0);
    let turned = 0;
    let last = Math.atan2(comet.y - 500, comet.x - 1300);
    while (!comet.ended) {
        advance(one, comet);
        const now = Math.atan2(comet.y - 500, comet.x - 1300);
        turned += Math.abs(((now - last + 3 * Math.PI) % (2 * Math.PI)) - Math.PI);
        last = now;
    }
    expect(comet.ended).toBe("won");
    // more than half way round the hole before it is taken
    expect(turned).toBeGreaterThan(Math.PI);
});

test("a comet that leaves the field, touches a star, or flies too long has missed", () => {
    expect(fly(field(), ...velocity(360, 30)).ended).toBe("out");
    expect(fly(field({ bodies: [{ x: 600, y: 500, radius: 20, mass: 1, reach: 40 }] }), ...velocity(0, 30)).ended).toBe("struck");
    // a rock pulls nothing and stops the comet all the same
    expect(pull(field({ hole: none, bodies: [{ x: 600, y: 500, radius: 20, mass: 0, reach: 0 }] }), 590, 470).map(Math.abs)).toEqual([0, 0]);
    expect(fly(field({ bodies: [{ x: 600, y: 500, radius: 20, mass: 0, reach: 0 }] }), ...velocity(0, 30)).ended).toBe("struck");
    // a star heavy enough to hold the comet in orbit, and no hole
    const held = field({ hole: none, start: { x: 800, y: 300 }, bodies: [{ x: 800, y: 500, radius: 20, mass: 4e7, reach: 1e6 }] });
    const flight = fly(held, Math.sqrt(4e7 / 200), 0);
    expect(flight.ended).toBe("late");
    expect(flight.steps * STEP).toBeCloseTo(LIMIT, 5);
});

test("a fast comet cannot pass through a thin star between one step and the next", () => {
    // at full strength it moves five units a step; the star is three across
    const thin = field({ bodies: [{ x: 600, y: 500, radius: 1.5, mass: 1, reach: 3 }] });
    expect(fly(thin, ...velocity(0, 40)).ended).toBe("struck");
});

test("a pusher pushes and a star pulls", () => {
    const [toward] = pull(field({ hole: none, bodies: [{ x: 600, y: 500, radius: 20, mass: 1e6, reach: 200 }] }), 500, 500);
    const [away] = pull(field({ hole: none, bodies: [{ x: 600, y: 500, radius: 20, mass: -1e6, reach: 200 }] }), 500, 500);
    expect(toward).toBeGreaterThan(0);
    expect(away).toBeLessThan(0);
});

test("a cloud slows the comet only while it is inside, and a ring speeds it up each time it goes in", () => {
    const speed = (one: Field, steps: number) => {
        const comet = launch(one, 400, 0);
        for (let i = 0; i < steps; i++) advance(one, comet);
        return { speed: Math.hypot(comet.vx, comet.vy), braked: comet.braked };
    };
    const clouded = field({ hole: none, clouds: [{ x: 500, y: 500, radius: 100 }] });
    expect(speed(clouded, 60).speed).toBeCloseTo(400, 6);
    const inside = speed(clouded, 90);
    expect(inside.braked).toBe(true);
    expect(inside.speed).toBeLessThan(400);
    // once out of it, it keeps the speed it was left with: about what the cloud takes for each unit crossed
    const after = speed(clouded, 300);
    expect(after.braked).toBe(false);
    expect(after.speed).toBeCloseTo(400 - CLOUD_DRAG * 200, -1);
    expect(speed(clouded, 350).speed).toBeCloseTo(after.speed, 6);

    const ringed = field({ hole: none, rings: [{ x: 500, y: 500, radius: 26 }, { x: 800, y: 500, radius: 26 }] });
    expect(speed(ringed, 100).speed).toBeCloseTo(400 * BOOST, 6);
    expect(speed(ringed, 200).speed).toBeCloseTo(400 * BOOST * BOOST, 6);
});

test("a wall bounces the comet as a mirror would, and it does not slip through", () => {
    // a wall straight across the way: the comet comes back the way it went
    const walled = field({ hole: none, walls: [{ ax: 600, ay: 300, bx: 600, by: 700 }] });
    const comet = launch(walled, 400, 100);
    let bounced = false;
    while (!comet.ended) {
        advance(walled, comet);
        if (comet.bounced !== undefined) {
            bounced = true;
            expect(comet.vx).toBeCloseTo(-400, 6);
            expect(comet.vy).toBeCloseTo(100, 6);
        }
        // never on the far side of the wall within its length
        if (comet.y > 300 && comet.y < 700) expect(comet.x).toBeLessThan(600);
    }
    expect(bounced).toBe(true);
    expect(comet.ended).toBe("out");
    // at full speed against a slanted wall too
    const slanted = field({ hole: none, walls: [{ ax: 500, ay: 300, bx: 700, by: 700 }] });
    const fast = launch(slanted, FASTEST, 0);
    while (!fast.ended) {
        advance(slanted, fast);
        if (fast.y > 400 && fast.y < 600) expect(fast.x).toBeLessThan(500 + (fast.y - 300) / 2 + 1);
    }
});

test("sparks are picked up on the way and change nothing about the flight", () => {
    const bare = field();
    const sparked = field({ sparks: [{ x: 500, y: 500 }, { x: 800, y: 510 }, { x: 800, y: 900 }] });
    const one = fly(bare, ...velocity(0, 24));
    const two = fly(sparked, ...velocity(0, 24));
    expect(two.ended).toBe(one.ended);
    expect(two.steps).toBe(one.steps);
    expect(two.sparks).toBe(0b011);
});

test("a wormhole sends the comet out of its other mouth at the same speed and heading, from just outside it", () => {
    const gated = field({
        hole: none,
        gates: [{ x: 600, y: 500, radius: 22, to: 1, pair: 0 }, { x: 900, y: 200, radius: 22, to: 0, pair: 0 }],
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
    expect(came!.x).toBeCloseTo(900 + 22.5, 6);
    expect(came!.y).toBeCloseTo(200, 6);
    // and it goes on its way, out of the field, without falling back in
    while (!comet.ended) {
        advance(gated, comet);
        expect(comet.through).toBeUndefined();
    }
    expect(comet.ended).toBe("out");
});

test("things that move are where their path says at every step, the same each time, and a moving rock is met where it is", () => {
    const round = { x: 0, y: 0, path: { kind: "circle" as const, x: 800, y: 500, r: 150, from: 0, rate: 0.5 } };
    // a quarter of the way round after 360 steps, and always on its circle
    expect(where(round, 0)).toEqual({ x: 950, y: 500 });
    const quarter = { ...where(round, 360) };
    expect(quarter.x).toBeCloseTo(800, 9);
    expect(quarter.y).toBeCloseTo(650, 9);
    for (let step = 0; step < 2000; step += 37) {
        const at = where(round, step);
        expect(Math.hypot(at.x - 800, at.y - 500)).toBeCloseTo(150, 9);
    }
    // to and fro along a line: at one end, at the other half a period on, and back
    const drift = { x: 0, y: 0, path: { kind: "line" as const, ax: 100, ay: 100, bx: 500, by: 100, period: 400, from: 0 } };
    expect(where(drift, 0).x).toBe(100);
    expect(where(drift, 200).x).toBe(500);
    expect(where(drift, 400).x).toBe(100);
    expect(where(drift, 100).x).toBe(300);
    // a rock swinging across the way: launched at once it is missed, and a little later it is met
    const crossing = (from: number) => field({ hole: none, bodies: [{ x: 0, y: 0, radius: 20, mass: 0, reach: 0, path: { kind: "line", ax: 700, ay: 200, bx: 700, by: 800, period: 480, from } }] });
    const outcomes = Array.from({ length: 40 }, (_, i) => i / 40).map((from) => fly(crossing(from), 400, 0).ended);
    expect(outcomes).toContain("struck");
    expect(outcomes).toContain("out");
});

test("a comet in orbit keeps its energy to within half a percent over ten seconds", () => {
    const mass = 4e7;
    const lone = field({ hole: none, bodies: [{ x: 800, y: 500, radius: 10, mass, reach: 1e7 }] });
    const comet = launch({ ...lone, start: { x: 800, y: 350 } }, Math.sqrt(mass / 150) * 0.9, 0);
    const energy = () => {
        const [dx, dy] = [comet.x - 800, comet.y - 500];
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
