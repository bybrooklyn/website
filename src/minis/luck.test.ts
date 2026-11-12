// The Dice mini's luck: counting what was rolled, and the verdict on it.
import { expect, test } from "bun:test";
import { fortune, tally, verdict, type Luck } from "./luck";

test("a number shown is counted under its die", () => {
    const luck: Luck = {};
    tally(luck, 6, 1);
    tally(luck, 6, 6);
    tally(luck, 6, 6);
    expect(luck[6]).toEqual([1, 0, 0, 0, 0, 2]);
});

test("a d100 is counted by tens", () => {
    const luck: Luck = {};
    for (const value of [1, 10, 11, 100]) tally(luck, 100, value);
    expect(luck[100]).toEqual([2, 1, 0, 0, 0, 0, 0, 0, 0, 1]);
});

test("a fair spread is about what chance says, and all twenties are blessed", () => {
    const fair: Luck = {};
    for (let round = 0; round < 5; round++) for (let value = 1; value <= 20; value++) tally(fair, 20, value);
    const [told] = fortune(fair);
    expect(told!.line).toBe("d20: 100 rolled, average 10.5, chance says 10.5: about what chance says");
    expect(told!.bars.every((bar) => bar === 1)).toBe(true);
    expect(told!.even).toBe(1);
    expect(verdict(20, 30, 20)).toBe("blessed");
    expect(verdict(20, 30, 1)).toBe("cursed");
    expect(verdict(20, 5, 20)).toBe("too few to say");
});

test("kinds never rolled are left out, and the rest come smallest first", () => {
    const luck: Luck = { 20: Array.from({ length: 20 }, () => 0) };
    tally(luck, 8, 3);
    tally(luck, 4, 2);
    expect(fortune(luck).map((one) => one.sides)).toEqual([4, 8]);
});
