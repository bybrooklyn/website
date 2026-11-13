// What "correct" means for Mote's 2D physics, measured. Run with `bun run test`.

import { expect, test } from "bun:test";
import { Flat, SLOP, inside, speed, wake, type Body } from "./flat";

const TICK = 1 / 120;
const run = (flat: Flat, seconds: number, each?: (time: number) => void) => {
    for (let time = 0; time < seconds - 1e-9; time += TICK) {
        flat.step(TICK);
        each?.(time);
    }
};
const degrees = (value: number) => (value * Math.PI) / 180;

/** A block resting on a long plank tilted by `angle`, both with this much friction. Returns how far it slid in three seconds. */
function slide(angle: number, friction: number): number {
    const flat = new Flat(1800);
    const [c, s] = [Math.cos(angle), Math.sin(angle)];
    flat.box(0, 0, 4000, 40, { fixed: true, angle, friction });
    // sitting on the plank's upper face: 20 for half the plank, 20 for half the block
    const block = flat.box(40 * s, -40 * c, 40, 40, { angle, friction });
    const [x, y] = [block.x, block.y];
    run(flat, 3);
    return Math.hypot(block.x - x, block.y - y);
}

test("a block stays on a slope just under its friction angle, and slides on one just over", () => {
    for (const friction of [0.3, 0.6, 0.9]) {
        const angle = Math.atan(friction);
        expect(slide(angle - degrees(1), friction)).toBeLessThan(1);
        expect(slide(angle + degrees(1), friction)).toBeGreaterThan(30);
    }
});

test("a sliding block stops in the distance its friction says", () => {
    const flat = new Flat(1800);
    flat.box(0, 40, 40000, 40, { fixed: true, friction: 0.5 });
    const block = flat.box(0, 0, 40, 40, { friction: 0.5 });
    run(flat, 1);
    const from = block.x;
    block.vx = 900;
    wake(block);
    run(flat, 4);
    // v squared over twice the friction times gravity
    const expected = (900 * 900) / (2 * 0.5 * 1800);
    expect(Math.abs(block.x - from - expected) / expected).toBeLessThan(0.05);
    expect(Math.abs(block.a)).toBeLessThan(0.01);
});

/** Thirty blocks dropped into a box, and left until they are at rest. */
function pile(): { flat: Flat; blocks: Body[] } {
    const flat = new Flat(2600);
    flat.wall([[0, 0], [700, 0], [700, 500], [0, 500]], true);
    const blocks: Body[] = [];
    for (let index = 0; index < 30; index++) {
        blocks.push(flat.box(120 + ((index * 97) % 460), 60, 40, 40, { angle: index * 0.7 }));
        run(flat, 0.35);
    }
    run(flat, 6);
    return { flat, blocks };
}

/** How far into each other two boxes of 40 are, at most, over every pair. */
function overlap(blocks: Body[]): number {
    let most = 0;
    for (const a of blocks) {
        for (const b of blocks) {
            if (a === b) continue;
            // the deepest any corner of b is inside a
            const [c, s] = [Math.cos(a.a), Math.sin(a.a)];
            for (const [px, py] of b.wp) {
                const [x, y] = [(px - a.x) * c + (py - a.y) * s, -(px - a.x) * s + (py - a.y) * c];
                most = Math.max(most, Math.min(20 - Math.abs(x), 20 - Math.abs(y)));
            }
        }
    }
    return most;
}

test("a pile of thirty comes to rest, does not move after, and nothing is inside anything", () => {
    const { flat, blocks } = pile();
    expect(flat.still).toBe(true);
    expect(overlap(blocks)).toBeLessThan(0.5);
    // inside the box
    for (const block of blocks) for (const [x, y] of block.wp) {
        expect(y).toBeLessThan(500.5);
        expect(x).toBeGreaterThan(-0.5);
        expect(x).toBeLessThan(700.5);
    }
    const before = blocks.map((block) => [block.x, block.y, block.a] as const);
    // woken, as a touch does: nothing should move
    for (const block of blocks) wake(block);
    let furthest = 0;
    run(flat, 10, () => {
        blocks.forEach((block, index) => {
            furthest = Math.max(furthest, Math.hypot(block.x - before[index]![0], block.y - before[index]![1]), Math.abs(block.a - before[index]![2]) * 28);
        });
    });
    expect(furthest).toBeLessThan(0.02);
    expect(flat.still).toBe(true);
});

test("a tower of ten stands for twenty seconds", () => {
    const flat = new Flat(2600);
    flat.box(0, 520, 2000, 40, { fixed: true });
    const blocks = Array.from({ length: 10 }, (_, index) => flat.box(0, 480 - index * 40, 40, 40));
    let fastest = 0;
    run(flat, 20, (time) => {
        if (time > 1) fastest = Math.max(fastest, ...blocks.map(speed));
    });
    blocks.forEach((block, index) => {
        expect(Math.abs(block.x)).toBeLessThan(0.5);
        expect(Math.abs(block.y - (480 - index * 40))).toBeLessThan(10 * SLOP + 0.5);
        expect(Math.abs(block.a)).toBeLessThan(0.005);
    });
    expect(fastest).toBeLessThan(1);
    expect(flat.still).toBe(true);
});

test("blocks at rest overlap by no more than the slop", () => {
    const flat = new Flat(2600);
    flat.box(0, 520, 2000, 40, { fixed: true });
    const stack = Array.from({ length: 6 }, (_, index) => flat.box(0, 440 - index * 60, 40, 40));
    run(flat, 6);
    const sorted = stack.toSorted((a, b) => b.y - a.y);
    expect(500 - (sorted[0]!.y + 20)).toBeGreaterThan(-SLOP - 0.05);
    for (let index = 1; index < sorted.length; index++) expect(sorted[index - 1]!.y - sorted[index]!.y).toBeGreaterThan(40 - SLOP - 0.05);
});

test("blocks that start inside each other part without flying off", () => {
    const flat = new Flat(2600);
    flat.box(0, 520, 2000, 40, { fixed: true });
    const [left, right] = [flat.box(-13, 480, 40, 40), flat.box(13, 480, 40, 40)];
    let fastest = 0;
    run(flat, 2, () => {
        fastest = Math.max(fastest, speed(left), speed(right));
    });
    expect(fastest).toBeLessThan(170);
    expect(right.x - left.x).toBeGreaterThan(40 - SLOP - 0.05);
    expect(right.x - left.x).toBeLessThan(41);
});

test("a held block shoved into a row pushes it, sinks into nothing, and nothing flies off when it is let go", () => {
    const flat = new Flat(2600);
    flat.wall([[0, 0], [700, 0], [700, 500], [0, 500]], true);
    const row = [0, 1, 2, 3].map((index) => flat.box(300 + index * 40, 480, 40, 40));
    const held = flat.box(200, 480, 40, 40);
    run(flat, 1);
    flat.hand.take(200, 480, held);
    let deepest = 0;
    run(flat, 2, () => {
        // shoved sideways into the row, well past where it can go
        flat.hand.move(900, 480);
        deepest = Math.max(deepest, overlap([held, ...row]));
    });
    expect(deepest).toBeLessThan(1);
    // the row is up against the wall, each block against the next
    const xs = [held, ...row].map((block) => block.x).sort((a, b) => a - b);
    for (let index = 1; index < xs.length; index++) expect(xs[index]! - xs[index - 1]!).toBeGreaterThan(39);
    expect(xs.at(-1)!).toBeLessThan(681);
    flat.hand.drop();
    let fastest = 0;
    run(flat, 2, () => {
        fastest = Math.max(fastest, speed(held), ...row.map(speed));
    });
    expect(fastest).toBeLessThan(60);
    expect(flat.still).toBe(true);
});

test("a block thrown hard at a wall does not get through or into it", () => {
    for (const fast of [1500, 5000, 9000]) {
        const flat = new Flat(2600);
        flat.wall([[0, 0], [700, 0], [700, 500], [0, 500]], true);
        const block = flat.box(350, 250, 40, 40, { angle: 0.3 });
        block.vx = fast;
        block.vy = -fast * 0.4;
        block.w = 9;
        let furthest = 0;
        run(flat, 3, () => {
            for (const [x, y] of block.wp) furthest = Math.max(furthest, x - 700, -x, y - 500, -y);
        });
        expect(furthest).toBeLessThan(1.5);
        expect(block.y).toBeLessThan(481);
    }
});

test("a block pushed into a rounded corner follows the curve", () => {
    const flat = new Flat(0);
    const round = 60;
    const arc = (cx: number, cy: number, from: number): [number, number][] => Array.from({ length: 7 }, (_, step): [number, number] => [cx + Math.cos(from + (step / 6) * (Math.PI / 2)) * round, cy + Math.sin(from + (step / 6) * (Math.PI / 2)) * round]);
    flat.wall([...arc(round, round, Math.PI), ...arc(700 - round, round, -Math.PI / 2), ...arc(700 - round, 500 - round, 0), ...arc(round, 500 - round, Math.PI / 2)], true);
    const pushed = flat.ball(120, 120, 20);
    pushed.damping = 3;
    run(flat, 3, () => {
        // shoved steadily toward the corner
        pushed.vx -= 30;
        pushed.vy -= 30;
        wake(pushed);
    });
    // A ball of 20 in a corner rounded to 60 sits with its middle on the diagonal, 60 - (60 - 20) / sqrt(2) from each wall.
    const ideal = round - (round - 20) / Math.SQRT2;
    expect(Math.abs(pushed.x - ideal)).toBeLessThan(1.5);
    expect(Math.abs(pushed.y - ideal)).toBeLessThan(1.5);
});

test("a rolling ball comes to a stop", () => {
    const flat = new Flat(1800);
    flat.box(0, 520, 40000, 40, { fixed: true });
    const rolling = flat.ball(0, 480, 20);
    rolling.vx = 300;
    rolling.w = 300 / 20;
    run(flat, 12);
    expect(speed(rolling)).toBeLessThan(1);
    expect(rolling.x).toBeGreaterThan(150);
});

test("a ball bounces as high as its bounce says, and a block does not bounce", () => {
    const flat = new Flat(1800);
    flat.box(0, 520, 2000, 40, { fixed: true });
    const ball = flat.ball(-100, 280, 20, { bounce: 0.5 });
    const block = flat.box(100, 280, 40, 40);
    let [high, down, blockUp] = [Infinity, false, 0];
    run(flat, 3, () => {
        if (ball.y > 478) down = true;
        if (down) high = Math.min(high, ball.y);
        blockUp = Math.max(blockUp, -block.vy);
    });
    // dropped 200; half the speed back is a quarter of the height
    expect(Math.abs(480 - high - 50)).toBeLessThan(8);
    expect(blockUp).toBeLessThan(15);
});

test("a tall block topples on a slope steeper than its shape allows, and not on a shallower one", () => {
    // 40 wide and 120 tall goes over past atan(40 / 120), about 18 degrees
    const turned = (slope: number) => {
        const angle = degrees(slope);
        const flat = new Flat(1800);
        flat.box(0, 0, 4000, 40, { fixed: true, angle, friction: 1 });
        const tall = flat.box(80 * Math.sin(angle), -80 * Math.cos(angle), 40, 120, { angle, friction: 1 });
        run(flat, 3);
        return Math.abs(tall.a - angle);
    };
    expect(turned(16)).toBeLessThan(0.01);
    expect(turned(21)).toBeGreaterThan(1.4);
});

test("nothing gains energy on its own", () => {
    const flat = new Flat(1800);
    flat.box(0, 520, 2000, 40, { fixed: true });
    const dropped = [flat.ball(-60, 100, 20), flat.box(0, 100, 40, 40, { angle: 0.4 }), flat.box(60, 60, 40, 40, { angle: 1 }), flat.shape(140, 80, [[0, -20], [23, 20], [-23, 20]])];
    const energy = () => dropped.reduce((sum, b) => sum + 0.5 * (b.vx * b.vx + b.vy * b.vy) * b.mass + (0.5 * b.w * b.w) / b.ii + flat.gravity * (500 - b.y) * b.mass, 0);
    const start = energy();
    let most = start;
    run(flat, 5, () => {
        most = Math.max(most, energy());
    });
    expect(most).toBeLessThan(start * 1.005);
});

test("a pendulum swings at the rate its length says it should, and stays on its rod", () => {
    const flat = new Flat(1800);
    const length = 200;
    const bob = flat.ball(length * Math.sin(0.15), length * Math.cos(0.15), 10);
    flat.rod(flat.ground, bob);
    const crossings: number[] = [];
    let before = bob.x;
    let off = 0;
    run(flat, 8, (time) => {
        if (before > 0 && bob.x <= 0) crossings.push(time);
        before = bob.x;
        off = Math.max(off, Math.abs(Math.hypot(bob.x, bob.y) - length));
    });
    const period = (crossings.at(-1)! - crossings[0]!) / (crossings.length - 1);
    const expected = 2 * Math.PI * Math.sqrt(length / flat.gravity);
    expect(crossings.length).toBeGreaterThan(3);
    expect(Math.abs(period - expected) / expected).toBeLessThan(0.02);
    expect(off).toBeLessThan(0.5);
    // and it has not lost much of its swing in eight seconds
    expect(Math.abs(Math.atan2(bob.x, bob.y)) + Math.abs(bob.w)).toBeGreaterThan(0.05);
});

/** A chain: thirteen links pinned end to end from a nail, and a weight. */
function chain(): { flat: Flat; links: Body[]; weight: Body; gap: () => number; reach: () => number } {
    const flat = new Flat(2200);
    flat.parts = 8;
    flat.hand.strength = 12;
    const links: Body[] = [];
    let above = flat.ground;
    for (let index = 0; index < 13; index++) {
        const link = flat.bar(372, 26 + (index + 0.5) * 17, 17 + 6, 6, { angle: Math.PI / 2, density: 6, family: 1 });
        link.spinDamping = 0.6;
        flat.pin(above, link, 372, 26 + index * 17);
        links.push(link);
        above = link;
    }
    const weight = flat.ball(372, 26 + 13 * 17 + 14, 20, { density: 1.2 });
    weight.damping = 0.4;
    flat.pin(above, weight, 372, 26 + 13 * 17);
    const end = (link: Body, side: number): [number, number] => [link.x + Math.cos(link.a) * 8.5 * side, link.y + Math.sin(link.a) * 8.5 * side];
    // the widest any pin has come apart, in pixels
    const gap = () => Math.max(...links.map((link, index) => {
        const [top, hung] = [end(link, -1), index ? end(links[index - 1]!, 1) : ([372, 26] as [number, number])];
        return Math.hypot(top[0] - hung[0], top[1] - hung[1]);
    }));
    // how far the weight is from the nail, against the chain's whole length
    const reach = () => Math.hypot(weight.x - 372, weight.y - 26) / (13 * 17 + 14);
    return { flat, links, weight, gap, reach };
}

test("a chain yanked far past its reach keeps its length, and hangs straight when let go", () => {
    const { flat, links, weight, gap, reach } = chain();
    run(flat, 1);
    expect(gap()).toBeLessThan(0.05);
    flat.hand.take(weight.x, weight.y, weight);
    let [widest, longest, fastest] = [0, 0, 0];
    run(flat, 4, (time) => {
        flat.hand.move(372 + Math.cos(time * 3) * 700, 26 + Math.abs(Math.sin(time * 3)) * 700);
        widest = Math.max(widest, gap());
        longest = Math.max(longest, reach());
        fastest = Math.max(fastest, ...links.map(speed));
    });
    // whipped about at a couple of thousand pixels a second, no pin opens by a pixel and the chain is never 2% longer
    expect(widest).toBeLessThan(1);
    expect(longest).toBeLessThan(1.02);
    expect(fastest).toBeLessThan(6000);
    // held still, far out of reach: pulled nearly straight (it still sags a little under its own weight), and no longer than it is
    run(flat, 2, () => flat.hand.move(372 + 900, 26));
    expect(gap()).toBeLessThan(0.1);
    expect(reach()).toBeGreaterThan(0.97);
    expect(reach()).toBeLessThan(1.002);
    flat.hand.drop();
    // it swings for a good while, as a weight on a chain does
    run(flat, 70);
    expect(gap()).toBeLessThan(0.05);
    // it ends hanging straight down under the nail
    expect(Math.abs(weight.x - 372)).toBeLessThan(3);
    expect(Math.abs(weight.y - (26 + 13 * 17 + 14))).toBeLessThan(0.5);
});

test("a rope lets its ends come together and stops them going further apart", () => {
    const flat = new Flat(1800);
    const bob = flat.ball(0, 50, 10);
    flat.rope(flat.ground, bob, 150);
    let furthest = 0;
    run(flat, 3, () => {
        furthest = Math.max(furthest, Math.hypot(bob.x, bob.y));
    });
    expect(furthest).toBeLessThan(151);
    expect(Math.abs(bob.y - 150)).toBeLessThan(1);
});

test("pressing a tool down on the ground lifts the body that holds it", () => {
    const flat = new Flat(2000);
    flat.box(0, 540, 2000, 80, { fixed: true });
    const body = flat.box(0, 482, 36, 36, { upright: true });
    const tool = flat.ball(60, 440, 11, { density: 2.5 });
    const arms = flat.motor(body, tool, 3);
    // held out to the side: the body stays put and the tool goes where it is sent
    arms.to(70, -40);
    run(flat, 1);
    expect(Math.abs(body.y - 482)).toBeLessThan(1.5);
    expect(Math.hypot(tool.x - body.x - 70, tool.y - body.y + 40)).toBeLessThan(8);
    // pushed straight down past the floor: the body goes up instead
    arms.to(0, 110);
    run(flat, 1.5);
    expect(body.y).toBeLessThan(430);
});

test("the same start gives the same end", () => {
    const [one, two] = [pile(), pile()];
    one.blocks.forEach((block, index) => {
        expect(block.x).toBe(two.blocks[index]!.x);
        expect(block.y).toBe(two.blocks[index]!.y);
    });
});

test("what rested on something fixed falls when that is taken away", () => {
    const flat = new Flat(1800);
    const floor = flat.box(0, 100, 400, 40, { fixed: true });
    flat.box(0, 400, 400, 40, { fixed: true });
    // a pile of two on the floor: the upper one touches only the lower
    const lower = flat.box(0, 60, 40, 40);
    const upper = flat.box(0, 20, 40, 40);
    run(flat, 3);
    expect(lower.asleep && upper.asleep).toBe(true);
    flat.remove(floor);
    run(flat, 1);
    expect(lower.y).toBeGreaterThan(300);
    expect(upper.y).toBeGreaterThan(260);
});

test("a step of no number or of minus a second is ignored, one of forever is kept to a second, and the steps after work", () => {
    for (const bad of [Number.NaN, -1, Infinity, 1e12]) {
        const flat = new Flat(1800);
        const ball = flat.ball(0, 0, 10);
        flat.step(bad);
        const after = ball.y;
        flat.step(TICK);
        expect(Number.isFinite(after)).toBe(true);
        expect(ball.y).toBeGreaterThan(after);
    }
});

test("a point is inside a bar only within its thickness of the line between its ends", () => {
    const flat = new Flat();
    // 110 long and 10 thick: its ends are round, of radius 5, about points 50 from its middle
    const bar = flat.bar(0, 0, 110, 10);
    expect(inside(bar, 0, 4)).toBe(true);
    expect(inside(bar, 54, 0)).toBe(true);
    expect(inside(bar, 54, 4)).toBe(false);
    expect(inside(bar, 200, 0)).toBe(false);
    expect(inside(bar, -56, 0)).toBe(false);
    expect(flat.at(54, 4)).toBeUndefined();
});
