// What making a kept or linked value safe is held to. Run with `bun run test`.
import { expect, test } from "bun:test";
import { list, oneOf, record, text, whole, wholeText, within } from "./checked";

const odd: unknown[] = [undefined, null, "3", "abc", NaN, Infinity, -Infinity, true, {}, [], [3]];

test("a whole number is rounded down and brought inside its range, and anything that is not a finite number falls back", () => {
    expect(whole(3, 1, 10, 1)).toBe(3);
    expect(whole(3.9, 1, 10, 1)).toBe(3);
    expect(whole(0, 1, 10, 7)).toBe(1);
    expect(whole(-5, 1, 10, 7)).toBe(1);
    expect(whole(1e300, 1, 10, 7)).toBe(10);
    for (const value of odd) expect(whole(value, 1, 10, 7)).toBe(7);
});

test("a number is brought inside its range, and anything that is not a finite number falls back", () => {
    expect(within(0.5, 0, 1, 0.2)).toBe(0.5);
    expect(within(2, 0, 1, 0.2)).toBe(1);
    expect(within(-2, 0, 1, 0.2)).toBe(0);
    for (const value of odd) expect(within(value, 0, 1, 0.2)).toBe(0.2);
});

test("a whole number in the address is digits only: Infinity, exponents, signs and hex fall back", () => {
    expect(wholeText("4", 1, 100, 1)).toBe(4);
    expect(wholeText(" 12 ", 1, 100, 1)).toBe(12);
    expect(wholeText("0", 1, 100, 1)).toBe(1);
    expect(wholeText("999", 1, 100, 1)).toBe(100);
    for (const written of [null, "", "Infinity", "-Infinity", "NaN", "1e9", "-2", "0x10", "2.5", "abc", "9".repeat(400)]) expect(wholeText(written, 1, 100, 1)).toBe(1);
});

test("text longer than allowed, or not text, falls back", () => {
    expect(text("lumen", 40, "x")).toBe("lumen");
    expect(text("a".repeat(41), 40, "x")).toBe("x");
    for (const value of [undefined, null, 3, {}, []]) expect(text(value, 40, "x")).toBe("x");
});

test("a choice is one of those offered, or the fallback", () => {
    expect(oneOf("b", ["a", "b"] as const, "a")).toBe("b");
    expect(oneOf("c", ["a", "b"] as const, "a")).toBe("a");
    expect(oneOf(undefined, [1, 2], 1)).toBe(1);
});

test("only a plain object is read as a record", () => {
    expect(record({ a: 1 })).toEqual({ a: 1 });
    for (const value of [undefined, null, 3, "x", [], [1]]) expect(record(value)).toBeUndefined();
});

test("a list keeps at most so many things, and leaves out the ones that are not sane", () => {
    const numbers = (item: unknown) => (typeof item === "number" ? item : undefined);
    expect(list([1, "x", 2, null, 3], 10, numbers)).toEqual([1, 2, 3]);
    expect(list([1, 2, 3, 4], 2, numbers)).toEqual([1, 2]);
    for (const value of [undefined, null, 3, "abc", { 0: 1, length: 1 }]) expect(list(value, 10, numbers)).toEqual([]);
});
