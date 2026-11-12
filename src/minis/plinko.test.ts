// What the Plinko board is held to: the password is the length asked for, every ball is accounted
// for, and every character comes up as often as chance says, though the bins do not. Run with `bun run test`.

import { expect, test } from "bun:test";
import { alphabet, BINS, DEFAULTS, drop, fair, strength, type Settings } from "./board";

/** Drops the balls and runs the board to its end. */
function play(settings: Partial<Settings>) {
    // the balls are let go much faster than on the page, so that thousands can be dropped
    const board = drop({ ...DEFAULTS, ...settings }, undefined, undefined, 0.05);
    for (let step = 0; step < 120 * 60 && !board.done(); step++) board.step(1 / 120);
    return board;
}

test("the password is exactly as long as asked for, at any length and on any board", () => {
    for (const settings of [{ length: 4, rows: 5 }, { length: 16 }, { length: 64, rows: 11, bounce: 0.8, gravity: 0.5 }, { length: 64, rows: 5, bounce: 0.2, gravity: 1.6 }]) {
        const board = play(settings);
        expect(board.done()).toBe(true);
        expect(board.password()).toHaveLength(settings.length);
        expect([...board.password()].every((character) => alphabet(DEFAULTS).includes(character))).toBe(true);
    }
});

test("every character comes up as often as chance says, on every kind of board, though the bins do not", () => {
    const settings = { length: 64, upper: false, symbols: false };
    const letters = alphabet({ ...DEFAULTS, ...settings });
    const counts = new Map<string, number>();
    const bins = Array.from({ length: BINS }, () => 0);
    let late = 0;
    const boards = [{ rows: 8 }, { rows: 5, bounce: 0.8 }, { rows: 11, gravity: 1.6 }, { rows: 7, bounce: 0.2, gravity: 0.5 }];
    for (let round = 0; round < 100; round++) {
        const board = play({ ...settings, ...boards[round % boards.length] });
        late += board.late;
        for (const landing of board.landings) {
            counts.set(landing.character, (counts.get(landing.character) ?? 0) + 1);
            bins[landing.bin]!++;
        }
    }
    // how far the counts are from even, as chi-squared: for 36 characters chance alone passes 95 about once in ten million runs
    const uneven = (seen: number[], total: number) => seen.reduce((sum, count) => sum + (count - total / seen.length) ** 2 / (total / seen.length), 0);
    expect(uneven(letters.split("").map((letter) => counts.get(letter) ?? 0), 6400)).toBeLessThan(95);
    // the board itself is nowhere near even: this is why it is not left to choose
    expect(uneven(bins, 6400)).toBeGreaterThan(200);
    // and nearly every ball reaches a bin by itself
    expect(late).toBeLessThan(20);
}, 120_000);

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

test("on the page a short password takes its time and a long one does not take all day", () => {
    for (const [length, least, most] of [[16, 6, 16], [64, 10, 24]] as const) {
        const board = drop({ ...DEFAULTS, length });
        while (!board.done() && board.time < 60) board.step(1 / 120);
        expect(board.time).toBeGreaterThan(least);
        expect(board.time).toBeLessThan(most);
    }
});
