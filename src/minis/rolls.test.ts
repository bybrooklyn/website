import { expect, test } from "bun:test";
import { read, total, type Roll } from "./rolls";

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
    expect(typeof read("40d6")).toBe("string");
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
