// Mote's 2D layer, held to what the minis need of it. Run with `bun test`.

import { expect, test } from "bun:test";
import { Flat, speed, where, type Body } from "./flat";

const run = (flat: Flat, seconds: number, each?: (time: number) => void) => {
    for (let time = 0; time < seconds; time += 1 / 120) {
        flat.step(1 / 120);
        each?.(time);
    }
};

test("a pile of blocks comes to rest and stays exactly where it is", () => {
    const flat = new Flat(2600);
    flat.wall([[0, 0], [700, 0], [700, 500], [0, 500]], true);
    const pile: Body[] = [];
    for (const [column, row] of [[-1, 0], [0, 0], [1, 0], [-0.5, 1], [0.5, 1], [0, 2]] as const) pile.push(flat.box(350 + column * 40, 480 - row * 40, 40, 40));
    for (let index = 0; index < 10; index++) {
        pile.push(flat.box(260 + index * 19, 60, 40, 40));
        run(flat, 0.5);
    }
    run(flat, 4);
    expect(flat.still).toBe(true);
    const before = pile.map(where);
    // woken, as a touch does: nothing should move
    for (const block of pile) block.setAwake(true);
    let furthest = 0;
    run(flat, 3, () => {
        pile.forEach((block, index) => {
            furthest = Math.max(furthest, Math.hypot(where(block).x - before[index]!.x, where(block).y - before[index]!.y));
        });
    });
    expect(furthest).toBeLessThan(0.5);
    // and nothing has been pushed into the floor
    for (const block of pile) expect(where(block).y).toBeLessThan(481);
});

test("a held block pressed into the pile does not make the pile jump", () => {
    const flat = new Flat(2600);
    flat.wall([[0, 0], [700, 0], [700, 500], [0, 500]], true);
    const row = [0, 1, 2, 3].map((index) => flat.box(300 + index * 40, 480, 40, 40));
    const held = flat.box(200, 480, 40, 40);
    run(flat, 1);
    flat.hand.take(200, 480, held);
    let fastest = 0;
    run(flat, 2, () => {
        // shoved sideways into the row, well past where it can go
        flat.hand.move(520, 480);
        fastest = Math.max(fastest, ...row.map(speed));
    });
    // The row is pushed along hard, as a hand would; nothing is flung off, and nothing ends up inside anything else.
    expect(fastest).toBeLessThan(4000);
    const xs = [held, ...row].map((block) => where(block).x).sort((a, b) => a - b);
    for (let index = 1; index < xs.length; index++) expect(xs[index]! - xs[index - 1]!).toBeGreaterThan(39);
});

test("a chain pulled far past its reach stays a chain, and hangs straight when let go", () => {
    const flat = new Flat(2200);
    flat.care = [20, 8];
    flat.hand.strength = 12;
    const links: Body[] = [];
    let above = flat.ground;
    for (let index = 0; index < 13; index++) {
        const link = flat.box(372, 26 + (index + 0.5) * 17, 6, 17, { density: 12 });
        link.setAngularDamping(0.6);
        flat.pin(above, link, 372, 26 + index * 17);
        links.push(link);
        above = link;
    }
    const weight = flat.ball(372, 26 + 13 * 17 + 14, 20, { density: 1.2 });
    weight.setLinearDamping(0.6);
    flat.pin(above, weight, 372, 26 + 13 * 17);
    const stretch = () => Math.max(...links.map((link, index) => Math.hypot(where(link).x - (index ? where(links[index - 1]!).x : 372), where(link).y - (index ? where(links[index - 1]!).y : 26)) / (index ? 17 : 8.5)));
    run(flat, 1);
    flat.hand.take(where(weight).x, where(weight).y, weight);
    let most = 0;
    run(flat, 3, (time) => {
        flat.hand.move(372 + Math.cos(time * 3) * 600, 26 + Math.abs(Math.sin(time * 3)) * 600);
        most = Math.max(most, stretch());
    });
    expect(most).toBeLessThan(1.1);
    flat.hand.drop();
    run(flat, 25);
    expect(stretch()).toBeLessThan(1.03);
    // it swings for a good while, as a weight on a chain does, and ends under the nail
    expect(Math.abs(where(weight).x - 372)).toBeLessThan(40);
});

test("pressing a tool down on the ground lifts the body that holds it", () => {
    const flat = new Flat(2000);
    flat.box(0, 540, 2000, 80, { fixed: true });
    const body = flat.box(0, 482, 36, 36, { upright: true });
    const tool = flat.ball(60, 440, 11, { density: 2.5 });
    const arms = flat.motor(body, tool, 3.4);
    // held out to the side: the body stays put and the tool goes where it is sent
    arms.to(70, -40);
    run(flat, 1);
    expect(Math.abs(where(body).y - 482)).toBeLessThan(1.5);
    expect(Math.hypot(where(tool).x - where(body).x - 70, where(tool).y - where(body).y + 40)).toBeLessThan(8);
    // pushed straight down past the floor: the body goes up instead
    arms.to(0, 110);
    run(flat, 1.5);
    expect(where(body).y).toBeLessThan(430);
});
