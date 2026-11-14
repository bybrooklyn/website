// What "correct" means for Mote's 3D physics, measured. Run with `bun run test`.

import { expect, test } from "bun:test";
import { TICK } from "./stage";
import { Space, angled, inertia, inside, turn, type Quat, type Solid } from "./space";
import { apply, ball, block, cube, diamond, pyramid, rod, ten, twelve, twenty, type Mesh, type V3 } from "./solids";

const run = (space: Space, seconds: number, each?: (time: number) => void) => {
    for (let time = 0; time < seconds - 1e-9; time += TICK) {
        space.step(TICK);
        each?.(time);
    }
};
const half = (mesh: Mesh, by = 0.5): Mesh => ({ faces: mesh.faces, points: mesh.points.map(([x, y, z]): V3 => [x * by, y * by, z * by]) });
/** A cube one unit across. */
const box = () => half(cube());

test("a cube set on the floor stays exactly where it is", () => {
    const space = new Space();
    const floor = space.slab([0, -1, 0], [20, 1, 20]);
    const one = space.solid(box(), [0, 0.5, 0]);
    let fastest = 0;
    run(space, 5, (time) => {
        if (time > 0.5) fastest = Math.max(fastest, Math.hypot(...one.v) + Math.hypot(...one.w));
    });
    expect(Math.hypot(one.p[0], one.p[2])).toBeLessThan(0.001);
    expect(Math.abs(one.p[1] - 0.5)).toBeLessThan(0.003);
    expect(inside(floor, one)).toBeLessThan(0.003);
    expect(fastest).toBeLessThan(0.01);
    expect(space.still()).toBe(true);
});

/** A cube on a long ramp tilted by `angle`, both with this much friction. Returns how far it slid in two seconds. */
function slide(angle: number, friction: number): number {
    const space = new Space();
    const [c, s] = [Math.cos(angle), Math.sin(angle)];
    space.slab([0, 0, 0], [60, 0.5, 4], angled(0, 0, angle), { friction });
    // sitting on the ramp's upper face
    const one = space.solid(box(), [-s, c, 0], { friction }, angled(0, 0, angle));
    const from: V3 = [...one.p];
    run(space, 2);
    return Math.hypot(one.p[0] - from[0], one.p[1] - from[1], one.p[2] - from[2]);
}

test("a cube stays on a ramp just under its friction angle, and slides on one just over", () => {
    for (const friction of [0.3, 0.6]) {
        const angle = Math.atan(friction);
        expect(slide(angle - 0.03, friction)).toBeLessThan(0.02);
        expect(slide(angle + 0.03, friction)).toBeGreaterThan(0.5);
    }
});

test("a dropped cube lands, settles on a face and is not in the floor", () => {
    const space = new Space();
    const floor = space.slab([0, -1, 0], [20, 1, 20]);
    const one = space.solid(box(), [0, 4, 0], { bounce: 0.3 }, angled(0.4, 0.9, 0.2));
    one.w = [3, -2, 5];
    let deepest = 0;
    run(space, 6, () => {
        deepest = Math.max(deepest, inside(floor, one));
    });
    expect(deepest).toBeLessThan(0.02);
    expect(space.still()).toBe(true);
    // flat on a face: its middle is half a unit up
    expect(Math.abs(one.p[1] - 0.5)).toBeLessThan(0.004);
});

test("a stack of three cubes stands", () => {
    const space = new Space();
    space.slab([0, -1, 0], [20, 1, 20]);
    const stack = [0, 1, 2].map((index) => space.solid(box(), [0, 0.5 + index, 0]));
    run(space, 6);
    stack.forEach((one, index) => {
        expect(Math.hypot(one.p[0], one.p[2])).toBeLessThan(0.01);
        expect(Math.abs(one.p[1] - (0.5 + index))).toBeLessThan(0.01);
    });
    expect(inside(stack[0]!, stack[1]!)).toBeLessThan(0.01);
    expect(space.still()).toBe(true);
});

test("two solids thrown at each other do not end up inside each other", () => {
    const space = new Space();
    space.slab([0, -1, 0], [20, 1, 20]);
    const [left, right] = [space.solid(half(twenty(), 0.42), [-3, 0.7, 0], { bounce: 0.3 }), space.solid(box(), [3, 0.7, 0.2], { bounce: 0.3 }, angled(0.3, 0.5, 0.1))];
    left.v = [9, 0, 0];
    right.v = [-9, 0, 0];
    let deepest = 0;
    run(space, 4, () => {
        deepest = Math.max(deepest, inside(left, right), inside(right, left));
    });
    expect(deepest).toBeLessThan(0.03);
    expect(space.still()).toBe(true);
});

test("a cube thrown hard at a thin wall does not get through it", () => {
    for (const fast of [10, 40, 90]) {
        const space = new Space();
        space.slab([0, -1, 0], [20, 1, 20]);
        const wall = space.slab([6, 2, 0], [0.08, 4, 6]);
        const one = space.solid(box(), [0, 1, 0], {}, angled(0.3, 0.2, 0.5));
        one.v = [fast, 2, 0];
        one.w = [4, 9, -3];
        let deepest = 0;
        run(space, 3, () => {
            deepest = Math.max(deepest, inside(wall, one));
        });
        expect(one.p[0]).toBeLessThan(6);
        expect(deepest).toBeLessThan(0.03);
    }
});

test("a ball of twenty faces bounces as high as its bounce says", () => {
    const space = new Space();
    space.slab([0, -1, 0], [20, 1, 20]);
    const ball = space.solid(half(twenty(), 0.42), [0, 5, 0], { bounce: 0.5 });
    const rest = ball.far;
    let [high, down] = [0, false];
    run(space, 2.5, () => {
        if (ball.p[1] < rest + 0.05) down = true;
        if (down) high = Math.max(high, ball.p[1]);
    });
    // half the speed back is about a quarter of the height (it lands on a corner or an edge, so only about)
    expect(high - rest).toBeGreaterThan(0.5);
    expect(high - rest).toBeLessThan(1.6);
});

test("solids that have settled go to sleep, cost nothing, and wake when something lands on them", () => {
    const space = new Space();
    space.sleeps = true;
    space.slab([0, -1, 0], [20, 1, 20]);
    const lying = space.solid(cube(), [0, 1.01, 0]);
    for (let i = 0; i < 240; i++) space.step(1 / 120);
    expect(lying.rest).toBeDefined();
    expect(space.still()).toBe(true);
    const [x, y, z] = lying.p;
    // another dropped on its edge knocks it awake and moves it
    const falling = space.solid(cube(), [1.2, 6, 0]);
    let woke = false;
    for (let i = 0; i < 360; i++) {
        space.step(1 / 120);
        woke ||= !lying.rest;
    }
    expect(woke).toBe(true);
    expect(Math.hypot(lying.p[0] - x!, lying.p[1] - y!, lying.p[2] - z!)).toBeGreaterThan(0.01);
    // and both end at rest on the floor or on each other, not inside it
    expect(lying.p[1]).toBeGreaterThan(0.9);
    expect(falling.p[1]).toBeGreaterThan(0.9);
    expect(space.still()).toBe(true);
});

test("a step of no number or of minus a second is ignored, one of forever is kept to a second, and the steps after work", () => {
    for (const bad of [Number.NaN, -1, Infinity, 1e12]) {
        const space = new Space();
        const die = space.solid(cube(), [0, 4, 0]);
        space.step(bad);
        const after = die.p[1];
        space.step(TICK);
        expect(Number.isFinite(after)).toBe(true);
        expect(die.p[1]).toBeLessThan(after);
    }
});

test("a held solid stays held when something falls onto it, until it is let go", () => {
    const space = new Space();
    space.slab([0, -0.5, 0], [10, 0.5, 10]);
    const held = space.solid(cube(), [0, 4, 0]);
    space.hold(held);
    space.solid(cube(), [0, 7, 0]);
    for (let i = 0; i < 120; i++) space.step(TICK);
    expect(held.p[1]).toBeCloseTo(4, 5);
    space.wake(held);
    for (let i = 0; i < 120; i++) space.step(TICK);
    expect(held.p[1]).toBeLessThan(2);
});

// ---- how hard a solid is to turn: its inertia tensor ----

const energy = (s: Solid) => {
    const r = turn(s);
    const own = [0, 1, 2].map((j) => r[0][j]! * s.w[0] + r[1][j]! * s.w[1] + r[2][j]! * s.w[2]) as V3;
    const held = [0, 1, 2].map((i) => s.inertia![i * 3]! * own[0] + s.inertia![i * 3 + 1]! * own[1] + s.inertia![i * 3 + 2]! * own[2]) as V3;
    // the angular momentum in the world, and the energy of the spin
    const momentum = [0, 1, 2].map((i) => r[i]![0] * held[0] + r[i]![1] * held[1] + r[i]![2] * held[2]) as V3;
    return { momentum, energy: (own[0] * held[0] + own[1] * held[1] + own[2] * held[2]) / 2 };
};

/** Where a solid's long axis (its own z) points in the world. */
const axis = (s: Solid, which: 0 | 1 | 2): V3 => [turn(s)[0][which]!, turn(s)[1][which]!, turn(s)[2][which]!];

test("the inertia tensor of a box, a rod and a ball is what the formulas for them say, and turning a shape turns its tensor", () => {
    const [x, y, z] = [0.5, 1, 2];
    const mass = 8 * x * y * z;
    const boxed = inertia(block([x, y, z]).points, block([x, y, z]).faces);
    [mass * (y * y + z * z) / 3, 0, 0, 0, mass * (x * x + z * z) / 3, 0, 0, 0, mass * (x * x + y * y) / 3].forEach((value, i) => expect(boxed[i]!).toBeCloseTo(value, 10));
    // a rod of many sides and a ball of many faces, against a cylinder and a sphere: near, as their faces are flat
    const [r, long] = [0.3, 4];
    const rodded = inertia(rod(r, long, 64).points, rod(r, long, 64).faces);
    const rodMass = Math.PI * r * r * long;
    expect(Math.abs(rodded[8]! / (rodMass * r * r / 2) - 1)).toBeLessThan(0.01);
    expect(Math.abs(rodded[0]! / (rodMass * (3 * r * r + long * long) / 12) - 1)).toBeLessThan(0.01);
    const balled = inertia(ball(1, 64, 32).points, ball(1, 64, 32).faces);
    expect(Math.abs(balled[0]! / ((2 / 5) * (4 / 3) * Math.PI) - 1)).toBeLessThan(0.01);
    expect(balled[4]! / balled[0]!).toBeCloseTo(1, 2);
    // a lopsided solid turned: its tensor is the first one turned, q I q'
    const q = angled(0.3, 1.1, -0.7);
    const lopsided = wedge();
    const turned = inertia(lopsided.points.map((point) => apply(turn({ q }), point)), lopsided.faces);
    const first = inertia(lopsided.points, lopsided.faces);
    const t = turn({ q });
    for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) {
        let sum = 0;
        for (let k = 0; k < 3; k++) for (let l = 0; l < 3; l++) sum += t[i]![k]! * first[k * 3 + l]! * t[j]![l]!;
        expect(turned[i * 3 + j]!).toBeCloseTo(sum, 10);
    }
});

test("every die but the ten is equally hard to turn every way, and so keeps the one number it always had", () => {
    for (const [shape, even] of [[cube(), true], [pyramid(), true], [diamond(), true], [twelve(), true], [twenty(), true], [ten(), false]] as const) {
        const solid = new Space().solid(shape, [0, 0, 0]);
        expect(solid.inertia === undefined).toBe(even);
    }
});

/** A lopsided solid: a wedge with no two sides alike, its corners anywhere but square. */
function wedge(): Mesh {
    const points: V3[] = [[0, 0, 0], [1.6, 0, 0.2], [0.3, 0.9, 0], [0.2, 0.1, 0.5]];
    return { points, faces: [[0, 2, 1], [0, 1, 3], [0, 3, 2], [1, 2, 3]] };
}

test("a box spinning free keeps its angular momentum and its energy over ten thousand steps", () => {
    const space = new Space();
    space.gravity = [0, 0, 0];
    const box = space.solid(block([0.2, 0.5, 1]), [0, 0, 0], {}, angled(0.4, 0.2, 0.9));
    box.w = [3, -5, 7];
    const start = energy(box);
    let [worstMomentum, worstEnergy, early] = [0, 0, 0];
    for (let step = 0; step < 10_000; step++) {
        space.step(1 / space.rate);
        const now = energy(box);
        worstMomentum = Math.max(worstMomentum, Math.hypot(now.momentum[0] - start.momentum[0], now.momentum[1] - start.momentum[1], now.momentum[2] - start.momentum[2]) / Math.hypot(...start.momentum));
        worstEnergy = Math.max(worstEnergy, Math.abs(now.energy - start.energy) / start.energy);
        if (step === 2_500) early = worstMomentum;
    }
    // The energy and the size of the momentum are kept exactly. Its direction wobbles a little, by a
    // share that halves each time the steps are halved, and the wobble does not grow.
    expect(worstEnergy).toBeLessThan(1e-9);
    expect(worstMomentum).toBeLessThan(0.015);
    expect(worstMomentum).toBeLessThan(early * 1.05);
});

test("a bar spun about its middle axis tumbles end over end, and one spun about its long or short axis stays steady", () => {
    /** Spins a bar about one of its own axes, nudged a hair off it, and returns how far that axis wanders over five seconds, in degrees. */
    const wander = (which: 0 | 1 | 2) => {
        const space = new Space();
        space.gravity = [0, 0, 0];
        // thin across x, wider across y, long along z
        const bar = space.solid(block([0.05, 0.15, 0.6]), [0, 0, 0]);
        const spin: V3 = [0, 0, 0];
        spin[which] = 8;
        spin[(which + 1) % 3] = 0.01;
        bar.w = spin;
        const from = axis(bar, which);
        let most = 0;
        let flips = 0;
        let last = 1;
        for (let step = 0; step < 5 * space.rate; step++) {
            space.step(1 / space.rate);
            const now = axis(bar, which);
            const along = now[0] * from[0] + now[1] * from[1] + now[2] * from[2];
            most = Math.max(most, (Math.acos(Math.max(-1, Math.min(1, along))) * 180) / Math.PI);
            if (Math.sign(along) !== Math.sign(last)) flips++;
            last = along;
        }
        return { most, flips };
    };
    // z is long (turns most easily), x thin (hardest), y between
    const [long, middle, short] = [wander(2), wander(1), wander(0)];
    expect(long.most).toBeLessThan(5);
    expect(short.most).toBeLessThan(5);
    // turned right over, more than once
    expect(middle.most).toBeGreaterThan(170);
    expect(middle.flips).toBeGreaterThan(1);
});

test("a lopsided solid dropped on a corner turns about it the way its mass says", () => {
    // About the corner it lands on, the floor's push has no lever, so the angular momentum about that
    // corner is the same just after it lands as just before. With the corner held by friction, the
    // spin after is that momentum against the solid's tensor about the corner.
    const space = new Space();
    space.slab([0, -1, 0], [10, 1, 10], undefined, { friction: 3 });
    const shape: Mesh = { faces: wedge().faces, points: wedge().points.map(([x, y, z]): V3 => [x * 0.5, y * 0.5, z * 0.5]) };
    // turned so that its sharpest corner points down, leaning a quarter of a right angle, the other corners well above it
    const sharp = new Space().solid(shape, [0, 0, 0]).points.reduce((far, point) => (Math.hypot(...point) > Math.hypot(...far) ? point : far));
    const from = sharp.map((value) => value / Math.hypot(...sharp)) as V3;
    const to: V3 = [Math.sin(0.4), -Math.cos(0.4), 0.1];
    const toLength = Math.hypot(...to);
    const [tx, ty, tz] = to.map((value) => value / toLength) as V3;
    const half: V3 = [from[0] + tx, from[1] + ty, from[2] + tz];
    const halfLength = Math.hypot(...half);
    const [hx, hy, hz] = half.map((value) => value / halfLength) as V3;
    // the turn taking `from` to `to`: about their cross, by the angle between, as a quaternion from the half way direction
    const q: Quat = [from[1] * hz - from[2] * hy, from[2] * hx - from[0] * hz, from[0] * hy - from[1] * hx, from[0] * hx + from[1] * hy + from[2] * hz];
    const solid = space.solid(shape, [0, 0.8, 0], { friction: 3 }, q);
    const corners = () => solid.points.map((point) => apply(turn(solid), point).map((value, i) => value + solid.p[i]!) as V3);
    const lowest = () => corners().reduce((low, corner) => (corner[1] < low[1] ? corner : low));
    let before = { p: [...solid.p] as V3, v: [...solid.v] as V3, corner: lowest() };
    let steps = 0;
    while (solid.v[1] <= before.v[1] + 1e-9 && steps++ < 2000) {
        before = { p: [...solid.p] as V3, v: [...solid.v] as V3, corner: lowest() };
        space.step(1 / space.rate);
    }
    // two steps more, for the landing to be over, and not so many that gravity has turned it further
    space.step(1 / space.rate);
    space.step(1 / space.rate);
    // the momentum about the corner before, m d x v, with d from the corner to the middle; it was not turning
    const d = before.p.map((value, i) => value - before.corner[i]!) as V3;
    const m = solid.mass;
    const momentum: V3 = [m * (d[1] * before.v[2] - d[2] * before.v[1]), m * (d[2] * before.v[0] - d[0] * before.v[2]), m * (d[0] * before.v[1] - d[1] * before.v[0])];
    /** The spin that momentum gives about the corner, for a tensor about the middle (in the world). */
    const spinFor = (middle: number[]) => {
        const dd = d[0] * d[0] + d[1] * d[1] + d[2] * d[2];
        const corner = middle.map((value, k) => value + m * ((k % 4 === 0 ? dd : 0) - d[Math.floor(k / 3)]! * d[k % 3]!));
        const [a, b, c, e, f, g, h, i, j] = corner as [number, number, number, number, number, number, number, number, number];
        const det = a * (f * j - g * i) - b * (e * j - g * h) + c * (e * i - f * h);
        const inv = [f * j - g * i, c * i - b * j, b * g - c * f, g * h - e * j, a * j - c * h, c * e - a * g, e * i - f * h, b * h - a * i, a * f - b * e].map((value) => value / det);
        return [0, 1, 2].map((r) => inv[r * 3]! * momentum[0] + inv[r * 3 + 1]! * momentum[1] + inv[r * 3 + 2]! * momentum[2]) as V3;
    };
    const t = turn(solid);
    const own = solid.inertia!;
    const world = [0, 1, 2].flatMap((r) => [0, 1, 2].map((c) => {
        let sum = 0;
        for (let k = 0; k < 3; k++) for (let l = 0; l < 3; l++) sum += t[r]![k]! * own[k * 3 + l]! * t[c]![l]!;
        return sum;
    }));
    const mean = (own[0]! + own[4]! + own[8]!) / 3;
    const [right, rough] = [spinFor(world), spinFor([mean, 0, 0, 0, mean, 0, 0, 0, mean])];
    const angle = (a: V3, b: V3) => (Math.acos(Math.min(1, (a[0] * b[0] + a[1] * b[1] + a[2] * b[2]) / (Math.hypot(...a) * Math.hypot(...b)))) * 180) / Math.PI;
    // the momentum about the corner after, with gravity's lever about it over the three steps added to the one before
    const after = solid.p.map((value, i) => value - before.corner[i]!) as V3;
    const held = (tensor: number[]) => [0, 1, 2].map((r) => tensor[r * 3]! * solid.w[0] + tensor[r * 3 + 1]! * solid.w[1] + tensor[r * 3 + 2]! * solid.w[2]) as V3;
    const about = (tensor: number[]) => {
        const spun = held(tensor);
        return [spun[0] + m * (after[1] * solid.v[2] - after[2] * solid.v[1]), spun[1] + m * (after[2] * solid.v[0] - after[0] * solid.v[2]), spun[2] + m * (after[0] * solid.v[1] - after[1] * solid.v[0])] as V3;
    };
    const g = space.gravity;
    const lever: V3 = [m * (d[1] * g[2] - d[2] * g[1]), m * (d[2] * g[0] - d[0] * g[2]), m * (d[0] * g[1] - d[1] * g[0])];
    const expected = momentum.map((value, i) => value + lever[i]! * (3 / space.rate)) as V3;
    const off = (a: V3) => Math.hypot(a[0] - expected[0], a[1] - expected[1], a[2] - expected[2]) / Math.hypot(...expected);
    // It turns the way the tensor says, much nearer to that than one number for all three axes would
    // put it; and its momentum about the corner is what it was, but for gravity.
    expect(angle(solid.w, right)).toBeLessThan(angle(right, rough) / 4);
    expect(off(about(world))).toBeLessThan(0.05);
});
