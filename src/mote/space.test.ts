// What "correct" means for Mote's 3D physics, measured. Run with `bun run test`.

import { expect, test } from "bun:test";
import { Space, angled, inside } from "./space";
import { cube, twenty, type Mesh, type V3 } from "./solids";

const TICK = 1 / 120;
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
