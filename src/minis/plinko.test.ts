// What the Plinko table is held to: every ball is a fairly chosen character, every ball gets down
// the table, and the password is those characters in the order they arrived. Run with `bun run test`.

import { expect, test } from "bun:test";
import { alphabet, BIN, DEEP, DEFAULTS, WIDE, drop, fair, strength, type Settings } from "./board";

/** Lets the balls go and runs the table until they have all rolled off its foot and come to rest. */
function play(settings: Partial<Settings>) {
    const board = drop({ ...DEFAULTS, ...settings });
    for (let step = 0; step < 120 * 90 && !(board.done() && board.space.still()); step++) board.step(1 / 120);
    return board;
}

test("every ball gets down the table into the bin, and the password is their characters in the order they arrived", () => {
    for (const settings of [{ length: 4, rows: 4 }, { length: 16 }, { length: 64, rows: 11, bounce: 0.8, gravity: 0.7 }, { length: 64, rows: 4, bounce: 0.2, gravity: 1.6 }]) {
        const board = play(settings);
        expect(board.done()).toBe(true);
        expect(board.late).toBe(0);
        expect(board.password()).toHaveLength(settings.length);
        // the same characters the balls were made with, each once, in the table's order
        expect([...board.password()].sort()).toEqual(board.balls.map((ball) => ball.character).sort());
        expect(board.order.map((ball) => ball.place)).toEqual(board.order.map((_, place) => place));
        for (const ball of board.balls) {
            const [x, y, z] = ball.body.p;
            expect(Math.abs(x)).toBeLessThan(WIDE / 2);
            expect(z).toBeGreaterThan(board.line);
            expect(z).toBeLessThan(board.line + BIN);
            expect(y).toBeGreaterThan(-DEEP);
            expect(y).toBeLessThan(0.5);
        }
    }
}, 120_000);

test("every character is as likely as any other", () => {
    const settings = { ...DEFAULTS, length: 64, upper: false, symbols: false };
    const letters = alphabet(settings);
    const counts = new Map<string, number>();
    for (let round = 0; round < 100; round++) for (const ball of drop(settings).balls) counts.set(ball.character, (counts.get(ball.character) ?? 0) + 1);
    // how far the counts are from even, as chi-squared: for 36 characters chance alone passes 95 about once in ten million runs
    const even = 6400 / letters.length;
    expect(letters.split("").reduce((sum, letter) => sum + ((counts.get(letter) ?? 0) - even) ** 2 / even, 0)).toBeLessThan(95);
});

test("a short password takes its time and a long one does not take all day", () => {
    for (const [length, least, most] of [[16, 6, 20], [64, 14, 32]] as const) {
        const board = drop({ ...DEFAULTS, length });
        while (!board.done() && board.time < 60) board.step(1 / 120);
        expect(board.time).toBeGreaterThan(least);
        expect(board.time).toBeLessThan(most);
    }
}, 60_000);

test("a fair number is never out of range, and one from the uneven last stretch is thrown away", () => {
    for (let i = 0; i < 2000; i++) expect(fair(94)).toBeLessThan(94);
    // 2^32 is not a multiple of 94: the top 2^32 % 94 values would favor the small numbers
    const given = [2 ** 32 - 1, 2 ** 32 - 5, 93];
    expect(fair(94, (into) => (into[0] = given.shift()!))).toBe(93);
    expect(given).toHaveLength(0);
});

test("the characters are the kinds chosen, small letters if none are, and strength is counted from them", () => {
    expect(alphabet({ lower: false, upper: false, digits: true, symbols: false })).toBe("0123456789");
    expect(alphabet({ lower: false, upper: false, digits: false, symbols: false })).toBe("abcdefghijklmnopqrstuvwxyz");
    expect(alphabet(DEFAULTS)).toHaveLength(86);
    expect(strength({ ...DEFAULTS, length: 10, lower: false, upper: false, symbols: false })).toBeCloseTo(10 * Math.log2(10));
});
