// What typed signs are held to: each pair becomes its character; a longer run of signs, an escaped
// one, or one inside an open code span or maths stays as typed; and no dash is ever made.

import { expect, test } from "bun:test";
import { SYMBOLS, symbolFor } from "./symbols";

test("each pair typed becomes its character", () => {
    expect(symbolFor("a ->")).toBe("→");
    expect(symbolFor("a <-")).toBe("←");
    expect(symbolFor("x =>")).toBe("⇒");
    expect(symbolFor("a !=")).toBe("≠");
    expect(symbolFor("a <=")).toBe("≤");
    expect(symbolFor("a >=")).toBe("≥");
    expect(symbolFor("->")).toBe("→");
});

test("a longer run of signs, an escape, or an open code span or maths stays as typed", () => {
    for (const before of ["a -->", "a ==>", "a !==", "a <==", "\\->", "`a ->", "$x ->", "a =", "a -", "a >"]) expect({ before, symbol: symbolFor(before) }).toEqual({ before, symbol: undefined });
    // a closed code span or maths before is no hindrance
    expect(symbolFor("`code` then ->")).toBe("→");
    expect(symbolFor("$x$ then ->")).toBe("→");
    expect(symbolFor("costs \\$5 ->")).toBe("→");
});

test("no pair makes a dash, and == and === are left to be drawn joined", () => {
    for (const symbol of Object.values(SYMBOLS)) expect(/[‒-―-]/.test(symbol)).toBe(false);
    expect(symbolFor("a --")).toBeUndefined();
    expect(symbolFor("a ==")).toBeUndefined();
    expect(symbolFor("a ===")).toBeUndefined();
});
