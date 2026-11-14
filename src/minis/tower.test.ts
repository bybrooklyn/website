// The dice tower, held to being a fair way to get a number. Run with `bun test`.

import { expect, test } from "bun:test";
import { inside } from "../mote/space";
import { SIDES, TOWER, TRAY, roll, throwDice } from "./tower";

/** The same numbers every run, so a failure can be repeated. */
function seeded(seed: number): () => number {
    return () => (seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 2 ** 32;
}

test("every die comes to rest in the tray, all but one roll in forty inside six seconds, and is never inside anything on the way", () => {
    const random = seeded(11);
    let [slow, deepest, deepestInDie] = [0, 0, 0];
    for (let turn = 0; turn < 40; turn++) {
        const thrown = throwDice([4, 6, 8, 10, 12, 20], random);
        const bodies = thrown.dice.map((die) => die.body);
        let seconds = 0;
        while (!thrown.done()) {
            thrown.step(1 / 120);
            seconds += 1 / 120;
            // how far any corner of a die is inside the tower or the tray, and inside another die
            for (const die of bodies) {
                for (const other of thrown.space.solids) {
                    if (other === die) continue;
                    if (other.im) deepestInDie = Math.max(deepestInDie, inside(other, die));
                    else deepest = Math.max(deepest, inside(other, die));
                }
            }
        }
        if (seconds >= 6) slow++;
        thrown.values().forEach((value, index) => {
            const die = thrown.dice[index]!;
            // out of the tower, inside the tray, and down on the floor
            expect(die.body.p[0]).toBeGreaterThan(TOWER.right);
            expect(die.body.p[0]).toBeLessThan(TRAY.right);
            expect(Math.abs(die.body.p[2])).toBeLessThan(TRAY.deep);
            expect(die.body.p[1]).toBeLessThan(1.3);
            expect(die.body.p[1]).toBeGreaterThan(0);
            expect(value).toBeGreaterThanOrEqual(1);
            expect(value).toBeLessThanOrEqual(die.sides);
        });
    }
    // Now and then a die comes to lean on another and the two keep trembling, until the roll is called
    // after nine seconds all the same. Over 900 rolls that was about one in two hundred, as often before
    // the inertia tensor as after; these forty meet one since the ten-sided die now takes another path.
    expect(slow).toBeLessThanOrEqual(1);
    // A die is about 0.8 across, corner to corner. Into the tower or the tray: never more than about an eighteenth of that, 0.045
    // (once a thirtieth, before the dice were made to spin three times as fast and ridges were put across the ramps).
    expect(deepest).toBeLessThan(0.045);
    // Into another die: two that meet spinning fast can overlap by an eighth of that for a frame or two.
    // (it was a sixteenth while the dice fell as one stack; let in one after another, a die now lands on
    // the one before it at full speed)
    expect(deepestInDie).toBeLessThan(0.1);
}, 120_000);

/** The largest chi-squared a fair die gives one time in a thousand, by how many faces it has. */
const LIMIT: Record<number, number> = { 4: 16.27, 6: 20.52, 8: 24.32, 10: 27.88, 12: 31.26, 20: 43.82 };

for (const sides of SIDES) {
    test(`a d${sides} lands on every face about as often as any other`, () => {
        const random = seeded(sides * 97);
        const rolls = sides * 80;
        const counts = new Array<number>(sides).fill(0);
        // four at a time, as they would be rolled
        for (let turn = 0; turn < rolls / 4; turn++) for (const value of roll([sides, sides, sides, sides], random)) counts[value - 1]!++;
        const even = rolls / sides;
        // The usual test of a die: how far the counts are from even, against what chance alone allows.
        const off = counts.reduce((sum, count) => sum + (count - even) ** 2 / even, 0);
        expect(off).toBeLessThan(LIMIT[sides]!);
        expect(Math.min(...counts)).toBeGreaterThan(0);
    }, 180_000);
}

test("a die that stays near the top of the tower does not keep the rest of the roll out for ever", () => {
    const thrown = throwDice([6, 6, 6], seeded(5));
    let pinned = false;
    for (let step = 0; step < 120 * 40 && !thrown.done(); step++) {
        thrown.step(1 / 120);
        // the first die, once in, is held fast just under where every later die is let in
        const [first] = thrown.dice;
        if (!pinned && first && !first.waiting) {
            first.body.p = [-2.4, TOWER.top + 0.6, 0];
            thrown.space.hold(first.body);
            pinned = true;
        }
    }
    expect(thrown.dice.every((die) => !die.waiting)).toBe(true);
    expect(thrown.done()).toBe(true);
});
