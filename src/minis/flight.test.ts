// Comet's flight, held to its rules: the same every time, to the last digit; a straight shot into an
// empty field arrives; a planet stops what touches it and bends what passes, more the closer and the
// bigger, and leaves the far side of the field alone; a pass keeps its speed; and a flight ends when
// it leaves the field or runs out of time. Run with `bun test`.

import { expect, test } from "bun:test";
import { AIMS, CATCH, FASTEST, HIGH, LIMIT, MARGIN, REACH, STEP, TURNS, WEAKEST, WIDE, advance, aimed, fly, launch, meets, nearest, pull, velocity, type Field } from "./flight";

/** A field made by hand: the start on the left, the hole on the right, and the planets given. */
const field = (planets: Field["planets"] = [], hole = { x: 1300, y: 500 }): Field => ({ seed: "test", level: 1, start: { x: 200, y: 500 }, hole, planets });
/** A hole far off in a corner, for flights about something else. */
const away = { x: WIDE - 5, y: 5 };
/** The heading of a velocity, in degrees. */
const heading = (vx: number, vy: number) => (Math.atan2(vy, vx) * 180) / Math.PI;

test("the directions are half a degree apart, each one long, and a quarter of the way round points down the field", () => {
    expect(AIMS).toHaveLength(TURNS);
    for (let i = 0; i < TURNS; i++) {
        const [x, y] = AIMS[i]!;
        const [nx, ny] = aimed(i + 1);
        expect(Math.hypot(x, y)).toBeCloseTo(1, 12);
        expect(x * nx + y * ny).toBeCloseTo(Math.cos(Math.PI / 360), 12);
    }
    expect(aimed(180)[1]).toBeCloseTo(1, 10);
    expect(aimed(-1)).toBe(AIMS[TURNS - 1]!);
    expect(nearest(0, -5)).toBe(540);
});

test("a launch's strength is held between the weakest and full", () => {
    expect(Math.hypot(...velocity(0, 0))).toBeCloseTo(WEAKEST * FASTEST);
    expect(Math.hypot(...velocity(0, 7))).toBeCloseTo(FASTEST);
});

test("the same field and launch give the same flight to the last digit, and it is the flight every machine gives", () => {
    const busy = field([
        { x: 640, y: 430, r: 60 },
        { x: 980, y: 610, r: 40 },
    ]);
    const run = () => {
        const comet = launch(busy, ...velocity(nearest(1100, 0) - 60, 0.5));
        const path: number[] = [];
        while (!comet.ended) path.push(advance(busy, comet).x, comet.y);
        return { path, ended: comet.ended };
    };
    const [one, two] = [run(), run()];
    expect(two.path).toEqual(one.path);
    expect(one.ended).toBe(two.ended);
    // the end of this flight, round the first planet and into the hole, written down once: a change to the flight's arithmetic changes it
    expect([one.ended, one.path.length / 2, one.path.at(-2)!.toFixed(6), one.path.at(-1)!.toFixed(6)]).toEqual(["won", 509, "1280.133518", "456.304200"]);
});

test("in an empty field a straight shot arrives, and one aimed away leaves the field", () => {
    const empty = field();
    expect(fly(empty, ...velocity(0, 0.5)).ended).toBe("won");
    expect(fly(empty, ...velocity(360, 0.5)).ended).toBe("out");
});

test("a planet stops a comet that touches it, at its edge, and the arrival is at the ring", () => {
    const blocked = field([{ x: 700, y: 500, r: 50 }]);
    const comet = launch(blocked, ...velocity(0, 1));
    while (!comet.ended) advance(blocked, comet);
    expect(comet.ended).toBe("struck");
    expect(Math.hypot(comet.x - 700, comet.y - 500)).toBeCloseTo(50, 6);
    const open = field();
    const arriving = launch(open, ...velocity(0, 1));
    while (!arriving.ended) advance(open, arriving);
    expect(Math.hypot(arriving.x - 1300, arriving.y - 500)).toBeCloseTo(CATCH, 6);
});

test("a planet pulls by its size: four times as hard for twice the radius, and not at all past its reach", () => {
    const into = { ax: 0, ay: 0 };
    const small = field([{ x: 800, y: 500, r: 30 }], away);
    const big = field([{ x: 800, y: 500, r: 60 }], away);
    pull(small, 800 - 150, 500, into);
    const weak = into.ax;
    pull(big, 800 - 150, 500, into);
    // at the same distance the bigger pulls by the square of its size, less what each one's fading takes
    expect(into.ax / weak).toBeGreaterThan(3.5);
    expect(weak).toBeGreaterThan(0);
    pull(small, 800 - REACH * 30 - 1, 500, into);
    expect(into.ax).toBe(0);
    expect(into.ay).toBe(0);
});

test("passing a planet bends the path, a close pass far more than a wide one, and a planet across the field changes nothing", () => {
    const bend = (across: number) => {
        const one = field([{ x: 800, y: 500 + across, r: 55 }], away);
        const comet = launch(one, ...velocity(0, 0.8));
        while (!comet.ended && comet.x < 1300) advance(one, comet);
        return Math.abs(heading(comet.vx, comet.vy));
    };
    expect(bend(90)).toBeGreaterThan(25);
    expect(bend(200)).toBeGreaterThan(3);
    expect(bend(200)).toBeLessThan(bend(90) / 2);
    expect(bend(450)).toBe(0);
});

test("a comet that swings past a planet leaves it at the speed it came, as the leapfrog step keeps it", () => {
    const one = field([{ x: 800, y: 680, r: 60 }], away);
    const comet = launch(one, ...velocity(0, 0.7));
    while (!comet.ended && Math.hypot(comet.x - 800, comet.y - 680) < REACH * 60 + 40) advance(one, comet);
    expect(comet.ended).toBeUndefined();
    expect(Math.hypot(comet.vx, comet.vy) / (0.7 * FASTEST)).toBeCloseTo(1, 4);
});

test("the edge of the field is a little past where it is drawn, and a flight still going after the time allowed is late", () => {
    const empty = field([], away);
    const comet = launch(empty, ...velocity(360, 1));
    while (!comet.ended) advance(empty, comet);
    expect(comet.x).toBeLessThan(-MARGIN);
    expect(comet.x).toBeGreaterThan(-MARGIN - (FASTEST * STEP + 1));
    // going round a planet on a circle, with the pull and speed matched, never ends but by the clock
    const round = field([{ x: 800, y: 500, r: 60 }], away);
    const into = { ax: 0, ay: 0 };
    pull(round, 800, 650, into);
    const speed = Math.sqrt(Math.abs(into.ay) * 150);
    const orbit = { ...round, start: { x: 800, y: 650 } };
    const flight = fly(orbit, speed, 0);
    expect(flight.ended).toBe("late");
    expect(flight.steps).toBe(Math.round(LIMIT / STEP));
});

test("a move is checked along its whole length, so even a long one cannot pass through a planet", () => {
    expect(meets(0, 0, 1000, 0, 500, 0, 10)).toBeCloseTo(0.49, 6);
    expect(meets(0, 0, 1000, 0, 500, 30, 10)).toBe(2);
    expect(meets(0, 0, -1000, 0, 500, 0, 10)).toBe(2);
    expect(HIGH).toBeLessThan(WIDE);
});
