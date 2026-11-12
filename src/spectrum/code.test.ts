// What share codes are held to: eight characters for nine sliders of seventeen positions, read back
// exactly; the six-character codes of nine positions and the old app's seven-character codes still
// opening, each value v at position 2v - 1. The seven-character codes here were made by the old
// app's own share.ts. Run with `bun run test`.

import { expect, test } from "bun:test";
import { decode, encode, LENGTH } from "./code";

test("a code is eight characters of base 62, and every slider in the middle is 01QCSXtB", () => {
    expect(LENGTH).toBe(8);
    expect(encode([9, 9, 9, 9, 9, 9, 9, 9, 9])).toBe("01QCSXtB");
    expect(encode([17, 17, 17, 17, 17, 17, 17, 17, 17])).toBe("03uw7mN1");
    expect(encode([13, 5, 0, 11, 3, 17, 7, 1, 15])).toBe("02zJNevP");
    expect(encode([1, 2, 3, 4, 5, 6, 7, 8, 10])).toBe("00du6sSy");
});

test("every slider unset is all zeros, and missing or bad values are written as unset", () => {
    expect(encode([0, 0, 0, 0, 0, 0, 0, 0, 0])).toBe("00000000");
    expect(encode([])).toBe("00000000");
    expect(encode([18, -1, 4.5, Number.NaN, 0, 0, 0, 0, 1])).toBe("00000001");
});

test("a code reads back to the values it was made from, the in-between positions included", () => {
    const tries = [
        [9, 9, 9, 9, 9, 9, 9, 9, 9],
        [17, 17, 17, 17, 17, 17, 17, 17, 17],
        [0, 0, 0, 0, 0, 0, 0, 0, 0],
        [1, 0, 0, 0, 0, 0, 0, 0, 0],
        [0, 0, 0, 0, 0, 0, 0, 0, 1],
        [2, 4, 6, 8, 10, 12, 14, 16, 0],
    ];
    for (let seed = 1; seed < 300; seed++) tries.push(Array.from({ length: 9 }, (_, index) => (seed * 7 + index * 13 + seed * index) % 18));
    for (const values of tries) {
        const code = encode(values);
        expect(code).toMatch(/^[0-9a-zA-Z]{8}$/);
        expect(decode(code)).toEqual(values);
    }
});

test("a six-character code of nine positions opens with each value v at 2v - 1", () => {
    expect(decode("0BB3nt")).toEqual([9, 9, 9, 9, 9, 9, 9, 9, 9]); // 555555555
    expect(decode("15FTGf")).toEqual([17, 17, 17, 17, 17, 17, 17, 17, 17]); // 999999999
    expect(decode("00PNFQ")).toEqual([0, 1, 3, 5, 7, 9, 11, 13, 15]); // 012345678
    expect(decode("0NrE5s")).toEqual([13, 5, 0, 11, 3, 17, 7, 1, 15]); // 730629418
    expect(decode("000007")).toEqual([0, 0, 0, 0, 0, 0, 0, 0, 13]);
    expect(decode("000000")).toEqual([0, 0, 0, 0, 0, 0, 0, 0, 0]);
});

test("an old eleven-slider code opens at the same places as before, the two sliders taken out dropped", () => {
    // each made by the old app from the eleven values beside it; the positions are the nine it gave before, as 2v - 1
    expect(decode("0YDLrRF")).toEqual([9, 9, 9, 9, 9, 9, 9, 9, 9]); // 55555555555
    expect(decode("01ly7vk")).toEqual([0, 1, 3, 5, 7, 9, 11, 13, 15]); // 01234567890
    expect(decode("1L9zO9N")).toEqual([17, 17, 17, 17, 17, 17, 17, 17, 17]); // 99999999999
    expect(decode("0aUKYOA")).toEqual([1, 0, 0, 0, 0, 0, 0, 0, 0]); // 10000000000
    expect(decode("1hKAEO1")).toEqual([13, 5, 0, 11, 3, 17, 7, 1, 15]); // 73062941853
    expect(decode("00000cT")).toEqual([0, 0, 0, 0, 0, 0, 0, 0, 13]); // 00000000799
    expect(decode("0000000")).toEqual([0, 0, 0, 0, 0, 0, 0, 0, 0]);
});

test("all three kinds of code for the same places give the same new code", () => {
    expect(encode(decode("1hKAEO1")!)).toBe("02zJNevP");
    expect(encode(decode("0NrE5s")!)).toBe("02zJNevP");
    expect(encode(decode("02zJNevP")!)).toBe("02zJNevP");
    expect(encode(decode("0YDLrRF")!)).toBe("01QCSXtB");
});

test("what is not a code is turned away", () => {
    for (const code of ["", "wbWN", "1234", "12345", "abcdefghi", "ab!def", "ab-defg", "0BB3n ", "zzzzzz", "zzzzzzz", "16FTGf", "zzzzzzzz", "03uw7mN2", "01QCSXt!"]) expect(decode(code)).toBeUndefined();
});
