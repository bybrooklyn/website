// The dice tower, held to being a fair way to get a number. Run with `bun test`.

import { expect, test } from "bun:test";
import { SIDES, TOWER, TRAY, roll, throwDice } from "./tower";

/** The same numbers every run, so a failure can be repeated. */
function seeded(seed: number): () => number {
    return () => (seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 2 ** 32;
}

test("every die comes to rest in the tray, well inside twenty seconds", () => {
    const random = seeded(11);
    let longest = 0;
    for (let turn = 0; turn < 40; turn++) {
        const thrown = throwDice([4, 6, 8, 10, 12, 20], random);
        let seconds = 0;
        while (!thrown.done()) {
            thrown.step(1 / 60);
            seconds += 1 / 60;
        }
        longest = Math.max(longest, seconds);
        thrown.values().forEach((value, index) => {
            const die = thrown.dice[index]!;
            // out of the tower, inside the tray, and down on the floor
            expect(die.body.position.x).toBeGreaterThan(TOWER.right);
            expect(die.body.position.x).toBeLessThan(TRAY.right);
            expect(Math.abs(die.body.position.z)).toBeLessThan(TRAY.deep);
            expect(die.body.position.y).toBeLessThan(1.3);
            expect(die.body.position.y).toBeGreaterThan(0);
            expect(value).toBeGreaterThanOrEqual(1);
            expect(value).toBeLessThanOrEqual(die.sides);
        });
    }
    expect(longest).toBeLessThan(14);
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
