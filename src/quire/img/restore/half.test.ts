// Half precision by hand is held to the standard's numbers: every one of the 65,536 halves goes to a number
// and back to itself; every pixel value from 0 to 255, made a share of one, comes back within half a step of
// the half's own spacing; ties round to even, and what is past the largest half is infinity.

import { expect, test } from "bun:test";
import { fromHalf, toHalf } from "./half";

test("every half goes to its number and back, and numbers round to the nearest half", () => {
    for (let h = 0; h < 0x10000; h++) {
        const value = fromHalf(h);
        if (Number.isNaN(value)) continue;
        expect(toHalf(value)).toBe(h);
    }
    expect(fromHalf(0x3c00)).toBe(1);
    expect(fromHalf(0x7bff)).toBe(65504);
    expect(fromHalf(0x0001)).toBe(2 ** -24);
    expect(toHalf(1e6)).toBe(0x7c00);
    expect(toHalf(-1e6)).toBe(0xfc00);
    // halfway between 1 and the next half up (1 + 2^-10) is a tie, which goes to the even one, 1
    expect(toHalf(1 + 2 ** -11)).toBe(0x3c00);
    expect(toHalf(1 + 3 * 2 ** -11)).toBe(0x3c02);
    for (let value = 0; value <= 255; value++) {
        const share = value / 255;
        expect(Math.abs(fromHalf(toHalf(share)) - share)).toBeLessThanOrEqual(2 ** -12);
        expect(Math.round(fromHalf(toHalf(share)) * 255)).toBe(value);
    }
});
