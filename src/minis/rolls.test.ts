// What reading a typed roll, adding it up and lining its numbers up are held to. Run with `bun run test`.
import { expect, test } from "bun:test";
import { lineUp, numbers, read, row, total, type Roll } from "./rolls";

const ok = (text: string) => read(text) as Roll;

test("a typed roll is read into dice and a number", () => {
    expect(ok("2d6+3").dice).toEqual([6, 6]);
    expect(ok("2d6+3").plus).toBe(3);
    expect(ok("d20").dice).toEqual([20]);
    expect(ok("1d8 + 2d6 - 1").dice).toEqual([8, 6, 6]);
    expect(ok("d100").dice).toEqual([10, 10]);
    expect(ok("d20 adv").dice).toEqual([20, 20]);
    expect(ok("4d6 drop lowest").groups[0]!.drop).toBe(1);
});

test("what cannot be rolled is said plainly", () => {
    expect(typeof read("")).toBe("string");
    expect(typeof read("2d7")).toBe("string");
    expect(typeof read("hello")).toBe("string");
    expect(typeof read("61d6")).toBe("string");
    expect(typeof read("2d6 drop lowest 2")).toBe("string");
});

test("a roll is added up from what the dice showed", () => {
    expect(total(ok("2d6+3"), [4, 5]).total).toBe(12);
    expect(total(ok("4d6 drop lowest"), [1, 6, 3, 4]).total).toBe(13);
    expect(total(ok("d20 adv"), [7, 15]).total).toBe(15);
    expect(total(ok("d20 dis"), [7, 15]).total).toBe(7);
    expect(total(ok("d20 adv + 5"), [7, 15]).total).toBe(20);
    expect(total(ok("1d8 - 1d4"), [8, 3]).total).toBe(5);
    // a d100: tens then ones, a 10 on either die standing for 0
    expect(total(ok("d100"), [3, 7]).total).toBe(37);
    expect(total(ok("d100"), [10, 4]).total).toBe(4);
    expect(total(ok("d100"), [10, 10]).total).toBe(100);
    expect(total(ok("4d6 drop lowest"), [1, 6, 3, 4]).said).toContain("(1)");
});

test("landed dice line up by kind, most sides first, then by number, highest first", () => {
    const dice = [
        { sides: 6, value: 2 },
        { sides: 20, value: 4 },
        { sides: 4, value: 3 },
        { sides: 6, value: 6 },
        { sides: 20, value: 17 },
    ] as const;
    expect(lineUp([...dice]).map((index) => `d${dice[index]!.sides}:${dice[index]!.value}`)).toEqual(["d20:17", "d20:4", "d6:6", "d6:2", "d4:3"]);
});

test("a row of any number up to sixty stays inside the picture, wide or narrow, without overlapping", () => {
    for (const shape of [0.6, 1, 1.65]) {
        for (let count = 1; count <= 60; count++) {
            const { size, at } = row(count, shape);
            const places = Array.from({ length: count }, (_, place) => at(place));
            for (const [x, y] of places) {
                expect(Math.abs(x) + size * 0.6).toBeLessThanOrEqual(shape);
                expect(Math.abs(y) + size * 0.75).toBeLessThanOrEqual(1);
            }
            for (const a of places) for (const b of places) if (a !== b) expect(Math.max(Math.abs(a[0] - b[0]), Math.abs(a[1] - b[1]))).toBeGreaterThanOrEqual(size * 1.19);
        }
    }
});

test("a d100 is one number in the row, made by two dice, and it leads the row", () => {
    const rolled = numbers(ok("d100 + 2d6"), [7, 3, 5, 2]);
    expect(rolled).toEqual([
        { sides: 100, value: 73, dice: [0, 1], dropped: false, sign: 1 },
        { sides: 6, value: 5, dice: [2], dropped: false, sign: 1 },
        { sides: 6, value: 2, dice: [3], dropped: false, sign: 1 },
    ]);
    expect(numbers(ok("d100"), [10, 10])[0]!.value).toBe(100);
    expect(lineUp(rolled)).toEqual([0, 1, 2]);
});

test("the numbers left out of a roll's sum are marked, and what is not marked adds up to the sum", () => {
    const roll = ok("4d6 drop lowest + 2");
    const shown = [5, 1, 5, 4];
    const rolled = numbers(roll, shown);
    expect(rolled.map((one) => one.dropped)).toEqual([false, true, false, false]);
    expect(rolled.filter((one) => !one.dropped).reduce((sum, one) => sum + one.sign * one.value, 0) + roll.plus).toBe(total(roll, shown).total);
    const less = ok("d20 - d4");
    expect(numbers(less, [12, 3]).map((one) => one.sign)).toEqual([1, -1]);
});
