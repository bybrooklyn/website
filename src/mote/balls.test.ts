// Balls in Mote's 3D physics, held to the arithmetic of a ball: rolling down a slope at 5/7 of what
// sliding would give, sliding where friction cannot hold the roll, slowing by its rolling cost and
// coming to rest, bouncing, and meeting solids of faces exactly at a face, an edge or a corner. In
// centimetres under real gravity, as a marble run is. Run with `bun run test`.

import { expect, test } from "bun:test";
import { MARBLE, Space, angled, marbleSpace, nearestOn, type Solid } from "./space";
import { cube, twenty, type V3 } from "./solids";

const G = 981;
const R = 0.8;
const size = (a: V3) => Math.sqrt(a[0] * a[0] + a[1] * a[1] + a[2] * a[2]);
const run = (space: Space, seconds: number, each?: () => void) => {
    for (let step = 0; step < Math.round(seconds * space.rate); step++) {
        space.step(1 / space.rate);
        each?.();
    }
};

/** A ball let go on a long slab tilted `degrees`, both with this friction: how far it went along in `seconds`, and its spin against its speed at the end. */
function slope(degrees: number, friction: number, seconds = 1, roll = 0) {
    const space = marbleSpace();
    space.sleeps = false;
    const angle = (degrees * Math.PI) / 180;
    space.slab([0, 0, 0], [600, 1, 20], angled(0, 0, -angle), { friction });
    // just on the slab's upper face, over its middle
    const ball = space.ball(R, [-(1 + R) * Math.sin(angle) * 0, (1 + R) / Math.cos(angle), 0], { friction, roll });
    const from: V3 = [...ball.p];
    run(space, seconds);
    return { along: size([ball.p[0] - from[0], ball.p[1] - from[1], ball.p[2] - from[2]]), spin: (size(ball.w) * R) / size(ball.v), ball, space };
}

test("a ball on a slope rolls without slipping, speeding up at 5/7 of g sin(slope), to within a percent", () => {
    for (const degrees of [3, 10, 20, 30]) {
        const { along, spin } = slope(degrees, 0.5);
        const rate = (2 * along) / (G * Math.sin((degrees * Math.PI) / 180));
        expect(Math.abs(rate / (5 / 7) - 1)).toBeLessThan(0.01);
        // turning as fast as it goes: the point that touches is still
        expect(Math.abs(spin - 1)).toBeLessThan(0.01);
    }
});

test("on a slope steeper than friction can hold the roll, a ball slides at g (sin - friction cos), spinning up as friction says", () => {
    // it rolls while tan(slope) is less than 7/2 of friction; past that it slides
    for (const [degrees, friction] of [[45, 0.2], [60, 0.2], [70, 0.5]] as const) {
        const angle = (degrees * Math.PI) / 180;
        expect(Math.tan(angle)).toBeGreaterThan(3.5 * friction);
        const { along, ball } = slope(degrees, friction, 0.5);
        const expected = G * (Math.sin(angle) - friction * Math.cos(angle));
        expect(Math.abs((2 * along) / 0.25 / expected - 1)).toBeLessThan(0.01);
        // friction's turning push alone spins it: 5/2 friction g cos / r, for half a second
        expect(Math.abs(size(ball.w) / (((5 / 2) * friction * G * Math.cos(angle)) / R) / 0.5 - 1)).toBeLessThan(0.02);
    }
});

test("a rolling ball slows by 5/7 of its rolling cost times g and comes to rest on the flat", () => {
    const space = marbleSpace();
    space.slab([0, -1, 0], [2000, 1, 50]);
    const roll = 0.01;
    const ball = space.ball(R, [0, R, 0], { friction: 0.5, roll });
    ball.v = [60, 0, 0];
    ball.w = [0, 0, -60 / R];
    run(space, 1);
    // after a second it has lost 5/7 roll g of its speed
    expect(Math.abs((60 - ball.v[0]) / ((5 / 7) * roll * G) - 1)).toBeLessThan(0.02);
    run(space, 12);
    expect(size(ball.v)).toBeLessThan(0.01);
    // and where theory says: v^2 / (2 a)
    expect(Math.abs(ball.p[0] / (60 * 60 / (2 * (5 / 7) * roll * G)) - 1)).toBeLessThan(0.02);
    expect(ball.rest).toBeDefined();
});

test("a ball stays put on a slope gentler than its rolling cost, and rolls down one steeper", () => {
    const roll = 0.03;
    const held = slope((Math.atan(roll * 0.7) * 180) / Math.PI, 0.5, 2, roll);
    expect(held.along).toBeLessThan(0.05);
    const going = slope((Math.atan(roll * 1.4) * 180) / Math.PI, 0.5, 2, roll);
    expect(going.along).toBeGreaterThan(5);
});

test("a ball spinning on the spot slows its spin at 5/2 of its spinning cost times g over r", () => {
    const space = marbleSpace();
    space.sleeps = false;
    space.slab([0, -1, 0], [50, 1, 50]);
    const twist = 0.02;
    const ball = space.ball(R, [0, R, 0], { friction: 0.5, twist });
    ball.w = [0, 100, 0];
    run(space, 0.5);
    const slowed = (100 - ball.w[1]) / 0.5;
    expect(Math.abs(slowed / (((5 / 2) * twist * G) / R) - 1)).toBeLessThan(0.02);
    // and it does not wander
    expect(Math.hypot(ball.p[0], ball.p[2])).toBeLessThan(1e-6);
});

test("a dropped ball bounces to its bounce squared of the height it fell, and is heard", () => {
    for (const bounce of [0.5, 0.7, 0.9]) {
        const space = marbleSpace();
        space.sleeps = false;
        space.slab([0, -1, 0], [50, 1, 50]);
        const ball = space.ball(R, [0, R + 10, 0], { bounce, friction: 0.5 });
        let heard = 0;
        space.hit = (_a, _b, speed) => (heard = Math.max(heard, speed));
        let [down, high] = [false, 0];
        run(space, 0.7, () => {
            if (ball.v[1] > 0) down = true;
            if (down) high = Math.max(high, ball.p[1] - R);
        });
        expect(Math.abs(high / (10 * bounce * bounce) - 1)).toBeLessThan(0.03);
        // it struck at about the speed of a fall of 10
        expect(Math.abs(heard / Math.sqrt(2 * G * 10) - 1)).toBeLessThan(0.03);
    }
});

test("two equal balls meeting head on, smooth and fully springy, swap their speeds", () => {
    const space = marbleSpace();
    space.gravity = [0, 0, 0];
    space.sleeps = false;
    const [left, right] = [space.ball(R, [-5, 0, 0], { bounce: 1, friction: 0 }), space.ball(R, [5, 0, 0], { bounce: 1, friction: 0 })];
    left.v = [100, 0, 0];
    right.v = [-40, 0, 0];
    run(space, 0.2);
    expect(left.v[0]).toBeCloseTo(-40, 0);
    expect(right.v[0]).toBeCloseTo(100, 0);
    expect(right.p[0] - left.p[0]).toBeGreaterThan(2 * R);
});

test("the nearest point of a solid of faces to a ball's middle is found exactly, on a face, an edge or a corner", () => {
    const space = new Space();
    const shapes: Solid[] = [space.slab([0, 0, 0], [1, 2, 3], angled(0.3, 0.7, 0.1)), space.solid(twenty(), [0, 0, 0], {}, angled(1, 2, 3))];
    let seed = 9;
    const next = () => (seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 2 ** 32;
    for (const solid of shapes) {
        // the surface, finely: points of each face, near enough to find the nearest to within a hair
        const surface: V3[] = [];
        solid.faces.forEach((face) => {
            const corners = face.map((i) => solid.wp[i]!);
            for (let i = 1; i + 1 < corners.length; i++) {
                for (let a = 0; a <= 40; a++) for (let b = 0; a + b <= 40; b++) {
                    const [u, v] = [a / 40, b / 40];
                    surface.push([0, 1, 2].map((k) => corners[0]![k]! * (1 - u - v) + corners[i]![k]! * u + corners[i + 1]![k]! * v) as V3);
                }
            }
        });
        for (let n = 0; n < 60; n++) {
            const c: V3 = [(next() - 0.5) * 9, (next() - 0.5) * 9, (next() - 0.5) * 9];
            const found = nearestOn(solid, c);
            if (found.d <= 0) continue;
            const best = Math.min(...surface.map((p) => size([p[0] - c[0], p[1] - c[1], p[2] - c[2]])));
            expect(found.d).toBeLessThanOrEqual(best + 1e-9);
            expect(found.d).toBeGreaterThan(best - 0.06);
            // the point found is on the surface and the way from it reaches c
            expect(size([found.q[0] + found.n[0] * found.d - c[0], found.q[1] + found.n[1] * found.d - c[1], found.q[2] + found.n[2] * found.d - c[2]])).toBeLessThan(1e-9);
        }
    }
    void cube;
});

test("a ball is as hard to turn as 2/5 of its mass times its radius squared, which the solver takes as it takes a cube", () => {
    const ball = new Space().ball(2, [0, 0, 0], { density: 3 });
    const mass = (4 / 3) * Math.PI * 8 * 3;
    expect(ball.mass).toBeCloseTo(mass, 9);
    expect(1 / ball.ii).toBeCloseTo((2 / 5) * mass * 4, 9);
    expect(ball.inertia).toBeUndefined();
});

test("balls and a block dropped on each other and on a floor are never more than a hair inside one another", () => {
    const space = marbleSpace();
    space.sleeps = false;
    const floor = space.slab([0, -1, 0], [50, 1, 50]);
    const balls = [-1, 0, 1].map((x) => space.ball(R, [x * 1.7, R, 0], MARBLE));
    const block = space.solid({ faces: cube().faces, points: cube().points.map(([x, y, z]): V3 => [x * 2, y * 0.5, z * 1.5]) }, [0, 2 * R + 0.6, 0], { density: 2.5 });
    balls.push(space.ball(R, [0.3, 6, 0.2], MARBLE), space.ball(R, [-0.5, 9, -0.4], MARBLE));
    let deepest = 0;
    run(space, 3, () => {
        for (const ball of balls) {
            deepest = Math.max(deepest, R - nearestOn(floor, ball.p).d, R - nearestOn(block, ball.p).d);
            for (const other of balls) if (other !== ball) deepest = Math.max(deepest, 2 * R - size([ball.p[0] - other.p[0], ball.p[1] - other.p[1], ball.p[2] - other.p[2]]));
        }
    });
    // Ball against ball is exact; ball against a solid of faces is soft, as solid against solid is, and a
    // block five times a ball's weight lying on three of them sinks in by up to a twelfth of a ball's radius.
    expect(deepest).toBeLessThan(R / 12);
});
