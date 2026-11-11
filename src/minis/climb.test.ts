// Climb, held to being climbable: a scripted hand on the mouse gets the block to the top.
// Run with `bun run test`.

import { expect, test } from "bun:test";
import { LEDGES, REACH, SIZE, TOP, course, type Course } from "./climb";

const TICK = 1 / 120;

/** A hand on the mouse: moves the hammer to each place over the first half of the time given, as a hand would, and holds it there. */
function hand(c: Course) {
    let was: [number, number] = [0, -70];
    let seconds = 0;
    return {
        get seconds() {
            return seconds;
        },
        to(time: number, aim: () => [number, number]) {
            let now = was;
            for (let t = 0; t < time; t += TICK) {
                const to = aim();
                const part = Math.min(1, t / (time * 0.5));
                now = [was[0] + (to[0] - was[0]) * part, was[1] + (to[1] - was[1]) * part];
                c.aim(now[0], now[1]);
                c.flat.step(TICK);
                seconds += TICK;
            }
            was = now;
        },
    };
}

/** Which way the climber comes at a ledge from (ledges go up by turns on the right and the left), and where its near end and its top are. */
function near(k: number) {
    const [x, y, w, h] = LEDGES[k]!;
    const side = k % 2 === 0 ? -1 : 1;
    return { side, edge: x + (side * w) / 2, top: y - h / 2, x, w };
}

/** Hook the end of ledge `k` from below and beside it, pull up, and step onto it. */
function pullUp(c: Course, mouse: ReturnType<typeof hand>, k: number): void {
    const { side, edge, top } = near(k);
    const { climber } = c;
    // where on the ledge the head goes: a little in from its end
    const on = edge - side * 26;
    mouse.to(0.4, () => [side * 4, -112]); // straight up, short of the ledge above
    mouse.to(0.4, () => [on - climber.x, top - 30 - climber.y]); // over the end of the ledge
    mouse.to(0.4, () => [on - climber.x, top - 4 - climber.y]); // down onto it
    mouse.to(0.7, () => [on - climber.x, 105]); // push down: the block goes straight up
    mouse.to(0.6, () => [0, 105]); // and over the head
    mouse.to(0.6, () => [side * 20, 40]); // down onto the ledge
    mouse.to(0.8, () => [0, -70]); // hammer back up
}

/** Drag the block along whatever it stands on, by planting the head ahead of it and pulling, until it is at `x`. */
function walk(c: Course, mouse: ReturnType<typeof hand>, x: number): void {
    const { climber } = c;
    for (let pull = 0; pull < 12 && Math.abs(climber.x - x) > 6; pull++) {
        const way = Math.sign(x - climber.x);
        // the head cannot come nearer the block than 64, so each pull ends with it 62 ahead
        const far = Math.min(125, Math.abs(x - climber.x) + 62);
        mouse.to(0.3, () => [way * far, -30]); // out ahead
        mouse.to(0.25, () => [way * far, 22]); // down onto the ground, pressing
        mouse.to(0.45, () => [way * 62, 22]); // and pull up to it
    }
    mouse.to(0.3, () => [0, -70]);
}

const feet = (c: Course) => c.climber.y + SIZE / 2;

test("pushing the hammer down lifts the block, and it comes back down where it was", () => {
    const c = course();
    const mouse = hand(c);
    mouse.to(0.5, () => [0, -70]);
    const from = c.climber.x;
    mouse.to(1, () => [0, REACH]);
    expect(c.height()).toBeGreaterThan(80);
    mouse.to(1, () => [0, -70]);
    expect(c.height()).toBeLessThan(1);
    expect(Math.abs(c.climber.x - from)).toBeLessThan(25);
});

test("it can drag itself along the ground, either way", () => {
    const c = course();
    const mouse = hand(c);
    mouse.to(0.5, () => [0, -70]);
    walk(c, mouse, -40);
    expect(Math.abs(c.climber.x + 40)).toBeLessThan(20);
    walk(c, mouse, -260);
    expect(Math.abs(c.climber.x + 260)).toBeLessThan(20);
    expect(c.height()).toBeLessThan(1);
});

test("every ledge can be climbed onto from the one below, with one way of moving the mouse", () => {
    LEDGES.forEach((_, k) => {
        const c = course();
        const { side, edge, top, x, w } = near(k);
        const below = k ? LEDGES[k - 1]![1] - LEDGES[k - 1]![3] / 2 : 0;
        // put down beside the end of the ledge, on whatever is below it
        [c.climber.x, c.climber.y] = [edge + side * 24, below - SIZE / 2 - 1];
        [c.head.x, c.head.y] = [c.climber.x, c.climber.y - 70];
        const mouse = hand(c);
        mouse.to(0.5, () => [0, -70]);
        pullUp(c, mouse, k);
        expect(Math.abs(feet(c) - top)).toBeLessThan(12);
        expect(Math.abs(c.climber.x - x)).toBeLessThan(w / 2);
    });
});

test("a whole climb, from the ground to the top, with nothing put anywhere by hand", () => {
    const c = course();
    const mouse = hand(c);
    mouse.to(0.5, () => [0, -70]);
    LEDGES.forEach((_, k) => {
        const { side, edge, top } = near(k);
        // up to three tries at each: walk to beside its end, then pull up
        for (let attempt = 0; attempt < 3 && Math.abs(feet(c) - top) > 12; attempt++) {
            walk(c, mouse, edge + side * 24);
            pullUp(c, mouse, k);
        }
        expect(Math.abs(feet(c) - top)).toBeLessThan(12);
    });
    expect(c.done()).toBe(true);
    expect(feet(c)).toBeLessThan(TOP + 12);
    // a careful, slow hand: well under two minutes
    expect(mouse.seconds).toBeLessThan(120);
});
