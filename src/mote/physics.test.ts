// What "correct" means for Mote's physics, measured. Run with `bun test`.

import { expect, test } from "bun:test";
import { World, ball, rect, type Body } from "./physics";

const TICK = 1 / 120;
const run = (world: World, seconds: number, each?: (time: number) => void) => {
    for (let time = 0; time < seconds; time += TICK) {
        world.step(TICK);
        each?.(time);
    }
};
const speed = (b: Body) => Math.hypot(b.vx, b.vy);

/** A block resting on a long plank tilted by `angle`, both with this much friction. Returns how far it slid in three seconds. */
function slide(angle: number, friction: number): number {
    const world = new World();
    const c = Math.cos(angle), s = Math.sin(angle);
    world.add(rect(0, 0, 4000, 40, { fixed: true, angle, friction }));
    // sitting on the plank's upper face, 37 above its middle line (20 for the plank, 17 for half the block)
    const block = rect(37 * s, -37 * c, 34, 34, { angle, friction });
    world.add(block);
    const [x, y] = [block.x, block.y];
    run(world, 3);
    return Math.hypot(block.x - x, block.y - y);
}

test("a block stays on a slope shallower than its friction allows", () => {
    // friction 0.6 holds up to atan(0.6), about 31 degrees
    expect(slide((20 * Math.PI) / 180, 0.6)).toBeLessThan(3);
});

test("a block slides down a slope steeper than its friction allows", () => {
    expect(slide((40 * Math.PI) / 180, 0.6)).toBeGreaterThan(300);
});

test("a tower of ten blocks stands still", () => {
    const world = new World();
    world.add(rect(0, 520, 2000, 40, { fixed: true }));
    const blocks = Array.from({ length: 10 }, (_, index) => rect(0, 483 - index * 34, 34, 34));
    world.add(...blocks);
    let fastest = 0;
    run(world, 10, (time) => {
        if (time > 1) fastest = Math.max(fastest, ...blocks.map(speed));
    });
    blocks.forEach((block, index) => {
        expect(Math.abs(block.x)).toBeLessThan(1.5);
        expect(Math.abs(block.y - (483 - index * 34))).toBeLessThan(2.5);
        expect(Math.abs(block.a)).toBeLessThan(0.02);
    });
    // nothing twitches once it has settled
    expect(fastest).toBeLessThan(12);
    expect(blocks.every((block) => block.asleep)).toBe(true);
});

test("blocks pushed into each other part without flying off", () => {
    const world = new World();
    world.add(rect(0, 520, 2000, 40, { fixed: true }));
    // two blocks overlapping by a third of their width
    const [left, right] = [rect(-11, 483, 34, 34), rect(11, 483, 34, 34)];
    world.add(left, right);
    let fastest = 0;
    run(world, 2, () => {
        fastest = Math.max(fastest, speed(left), speed(right));
    });
    expect(fastest).toBeLessThan(30);
    expect(right.x - left.x).toBeGreaterThan(32);
    expect(right.x - left.x).toBeLessThan(36);
});

test("nothing gains energy on its own", () => {
    const world = new World();
    world.add(rect(0, 520, 2000, 40, { fixed: true }));
    const dropped = [ball(-60, 100, 17), rect(0, 100, 34, 34, { angle: 0.4 }), rect(60, 60, 34, 34, { angle: 1 })];
    world.add(...dropped);
    const energy = () => dropped.reduce((sum, b) => sum + (0.5 * (b.vx * b.vx + b.vy * b.vy)) / b.im + (0.5 * b.w * b.w) / b.ii + (world.gravity * (500 - b.y)) / b.im, 0);
    const start = energy();
    let most = start;
    run(world, 5, () => {
        most = Math.max(most, energy());
    });
    expect(most).toBeLessThan(start * 1.01);
});

test("a pendulum swings at the rate its length says it should", () => {
    const world = new World();
    world.air = 0;
    const length = 200;
    const nail = ball(0, 0, 2, { fixed: true });
    const bob = ball(length * Math.sin(0.15), length * Math.cos(0.15), 10);
    world.add(nail, bob);
    world.join(nail, bob, [0, 0], [0, 0], length);
    const crossings: number[] = [];
    let before = bob.x;
    run(world, 8, (time) => {
        if (before > 0 && bob.x <= 0) crossings.push(time);
        before = bob.x;
    });
    const period = (crossings.at(-1)! - crossings[0]!) / (crossings.length - 1);
    const expected = 2 * Math.PI * Math.sqrt(length / world.gravity);
    expect(crossings.length).toBeGreaterThan(3);
    expect(Math.abs(period - expected) / expected).toBeLessThan(0.04);
    // and it stays on its rod
    expect(Math.abs(Math.hypot(bob.x, bob.y) - length)).toBeLessThan(2);
});

test("a chain dragged far past its reach stays a chain", () => {
    // Set up as the Chain mini is: a gentler hand and more work per step than the defaults, as anything jointed wants.
    const world = Object.assign(new World(), { gravity: 1400, grip: 10, passes: 16, parts: 4, air: 0.5 });
    const nail = ball(0, 0, 3, { fixed: true });
    world.add(nail);
    const beads: Body[] = [];
    let above = nail;
    for (let index = 0; index < 14; index++) {
        const last = index === 13;
        const bead = ball(0, (index + 1) * 15, last ? 20 : 4.5, { density: last ? 1 : 8 });
        world.add(bead);
        world.join(above, bead, [0, 0], [0, 0], last ? 31 : 15, true);
        beads.push(bead);
        above = bead;
    }
    const weight = beads.at(-1)!;
    run(world, 1);
    world.grab([weight.x, weight.y]);
    let stretched = 0, fastest = 0;
    run(world, 3, (time) => {
        // swept round and well out of reach
        world.drag([900 * Math.cos(time * 3), 900 * Math.sin(time * 3)]);
        let from = nail;
        beads.forEach((bead, index) => {
            stretched = Math.max(stretched, Math.hypot(bead.x - from.x, bead.y - from.y) / (index === 13 ? 31 : 15));
            fastest = Math.max(fastest, speed(bead));
            from = bead;
        });
    });
    expect(stretched).toBeLessThan(1.2);
    expect(fastest).toBeLessThan(4000);
    world.release();
    run(world, 12);
    // let go, it swings down to hang under the nail
    expect(Math.abs(weight.x)).toBeLessThan(12);
    expect(speed(weight)).toBeLessThan(40);
});

test("a rolling ball comes to a stop", () => {
    const world = new World();
    world.add(rect(0, 520, 40000, 40, { fixed: true }));
    const rolling = ball(0, 483, 17);
    rolling.vx = 300;
    rolling.w = 300 / 17;
    world.add(rolling);
    run(world, 12);
    expect(speed(rolling)).toBeLessThan(5);
});

test("a tall block topples on a slope steeper than its shape allows, and not on a shallower one", () => {
    // 34 wide and 102 tall goes over past atan(34 / 102), about 18 degrees
    const turned = (degrees: number) => {
        const angle = (degrees * Math.PI) / 180;
        const world = new World();
        world.add(rect(0, 0, 4000, 40, { fixed: true, angle, friction: 1 }));
        const tall = rect(71 * Math.sin(angle), -71 * Math.cos(angle), 34, 102, { angle, friction: 1 });
        world.add(tall);
        run(world, 3);
        return Math.abs(tall.a - angle);
    };
    expect(turned(15)).toBeLessThan(0.02);
    expect(turned(22)).toBeGreaterThan(1.4);
});

test("a dropped block comes to rest and sleeps", () => {
    const world = new World();
    world.add(rect(0, 520, 2000, 40, { fixed: true }));
    const block = rect(0, 200, 34, 34, { angle: 0.3 });
    world.add(block);
    run(world, 4);
    expect(block.asleep).toBe(true);
    expect(block.y).toBeGreaterThan(480);
});
