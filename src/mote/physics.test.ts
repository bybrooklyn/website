// What "correct" means for Mote's physics, measured. Run with `bun test`.

import { expect, test } from "bun:test";
import { SLACK, World, ball, rect, shape, wake, type Body } from "./physics";

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
    const world = Object.assign(new World(), { gravity: 1400, grip: 12, passes: 20, parts: 4, air: 0.8 });
    const nail = ball(0, 0, 3, { fixed: true });
    world.add(nail);
    const beads: Body[] = [];
    let above = nail;
    for (let index = 0; index < 14; index++) {
        const last = index === 13;
        const bead = ball(0, (index + 1) * 15, last ? 20 : 4.5, { density: last ? 1 : 8 });
        world.add(bead);
        world.join(above, bead, [0, 0], [0, 0], last ? 31 : 15);
        beads.push(bead);
        above = bead;
    }
    const weight = beads.at(-1)!;
    run(world, 1);
    world.grab([weight.x, weight.y]);
    let stretched = 0, fastest = 0, slackest = 1;
    run(world, 3, (time) => {
        // swept round and well out of reach
        world.drag([900 * Math.cos(time * 3), 900 * Math.sin(time * 3)]);
        let from = nail;
        beads.forEach((bead, index) => {
            stretched = Math.max(stretched, Math.hypot(bead.x - from.x, bead.y - from.y) / (index === 13 ? 31 : 15));
            slackest = Math.min(slackest, Math.hypot(bead.x - from.x, bead.y - from.y) / (index === 13 ? 31 : 15));
            fastest = Math.max(fastest, speed(bead));
            from = bead;
        });
    });
    expect(stretched).toBeLessThan(1.2);
    // and it never goes slack either: every link stays its length
    expect(slackest).toBeGreaterThan(0.85);
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

/** The six-block pile the Blocks mini starts with, on a floor, already at rest. */
function pile(): { world: World; blocks: Body[] } {
    const world = Object.assign(new World(), { gravity: 2600 });
    world.add(rect(0, 520, 2000, 40, { fixed: true }));
    const blocks = ([[-1, 0], [0, 0], [1, 0], [-0.5, 1], [0.5, 1], [0, 2]] as const).map(([column, row]) => {
        const block = rect(column * 40, 480 - row * 40, 40, 40);
        block.asleep = true;
        return block;
    });
    world.add(...blocks);
    return { world, blocks };
}

test("waking a settled pile does not move it", () => {
    const { world, blocks } = pile();
    const before = blocks.map((block) => [block.x, block.y, block.a] as const);
    for (const block of blocks) wake(block);
    let furthest = 0;
    run(world, 4, () => {
        blocks.forEach((block, index) => {
            furthest = Math.max(furthest, Math.hypot(block.x - before[index]![0], block.y - before[index]![1]), Math.abs(block.a - before[index]![2]) * 20);
        });
    });
    expect(furthest).toBeLessThan(0.3);
    expect(blocks.every((block) => block.asleep)).toBe(true);
});

test("blocks at rest overlap by no more than the slack", () => {
    const world = Object.assign(new World(), { gravity: 2600 });
    world.add(rect(0, 520, 2000, 40, { fixed: true }));
    // dropped one after another from a little above where each will land
    const stack = Array.from({ length: 6 }, (_, index) => rect(0, 440 - index * 60, 40, 40));
    world.add(...stack);
    run(world, 6);
    const sorted = stack.toSorted((a, b) => b.y - a.y);
    // the lowest sits on the floor, whose top is at 500; each of the others on the one below
    expect(500 - (sorted[0]!.y + 20)).toBeGreaterThan(-SLACK - 0.05);
    for (let index = 1; index < sorted.length; index++) expect(sorted[index - 1]!.y - sorted[index]!.y).toBeGreaterThan(40 - SLACK - 0.05);
});

test("a block pushed into a rounded corner rests against the curve", () => {
    const world = Object.assign(new World(), { gravity: 0, air: 3 });
    const round = 30;
    // two walls meeting at the origin, and the corner's curve as three slivers, as the Blocks mini builds it
    world.add(rect(-100, 300, 200, 1000, { fixed: true }), rect(300, -100, 1000, 200, { fixed: true }));
    for (const part of [0, 1, 2]) {
        const on = (step: number): [number, number] => [round * (1 - Math.sin((step / 3) * (Math.PI / 2))), round * (1 - Math.cos((step / 3) * (Math.PI / 2)))];
        const [a, b] = [on(part), on(part + 1)];
        const middle = [(a[0] + b[0]) / 3, (a[1] + b[1]) / 3] as const;
        world.add(shape(middle[0], middle[1], [[-middle[0], -middle[1]], [a[0] - middle[0], a[1] - middle[1]], [b[0] - middle[0], b[1] - middle[1]]], { fixed: true }));
    }
    const pushed = ball(120, 120, 20);
    world.add(pushed);
    run(world, 3, () => {
        // shoved steadily toward the corner
        pushed.vx -= 30;
        pushed.vy -= 30;
    });
    // A ball of 20 in a corner rounded to 30 sits with its middle on the diagonal, 30 - (30 - 20) / sqrt(2) from each wall.
    const ideal = round - (round - 20) / Math.SQRT2;
    expect(Math.abs(pushed.x - ideal)).toBeLessThan(2.5);
    expect(Math.abs(pushed.y - ideal)).toBeLessThan(2.5);
});

test("pressing a tool down on the ground lifts the body that holds it", () => {
    const world = new World();
    world.add(rect(0, 520, 2000, 40, { fixed: true }));
    const body = rect(0, 483, 34, 34);
    body.ii = 0;
    const tool = ball(60, 440, 10, { density: 2.5 });
    world.add(body, tool);
    const arm = world.drive(body, tool, (2.6 * world.gravity) / body.im);
    // held out to the side: nothing moves
    arm.to = [60, -40];
    run(world, 1);
    expect(Math.abs(body.y - 483)).toBeLessThan(1);
    expect(Math.abs(tool.x - body.x - 60)).toBeLessThan(6);
    // pushed straight down past the floor: the body goes up instead
    arm.to = [0, 110];
    run(world, 1.5);
    expect(body.y).toBeLessThan(440);
});
