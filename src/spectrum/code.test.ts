// What share codes are held to: six characters for the nine sliders, read back exactly, and the old
// app's seven-character codes still opening with their first nine values. The old codes here were
// made by the old app's own share.ts. Run with `bun run test`.

import { expect, test } from "bun:test";
import { decode, encode, LENGTH } from "./code";

test("a code is six characters of base 62, and every slider in the middle is 0BB3nt", () => {
    expect(encode([5, 5, 5, 5, 5, 5, 5, 5, 5])).toBe("0BB3nt");
    expect(encode([9, 9, 9, 9, 9, 9, 9, 9, 9])).toBe("15FTGf");
    expect(encode([0, 1, 2, 3, 4, 5, 6, 7, 8])).toBe("00PNFQ");
    expect(encode([7, 3, 0, 6, 2, 9, 4, 1, 8])).toBe("0NrE5s");
    expect(LENGTH).toBe(6);
});

test("every slider unset is all zeros, and missing or bad values are written as unset", () => {
    expect(encode([0, 0, 0, 0, 0, 0, 0, 0, 0])).toBe("000000");
    expect(encode([])).toBe("000000");
    expect(encode([10, -1, 4.5, Number.NaN, 0, 0, 0, 0, 7])).toBe("000007");
});

test("a code reads back to the values it was made from", () => {
    const tries = [
        [5, 5, 5, 5, 5, 5, 5, 5, 5],
        [9, 9, 9, 9, 9, 9, 9, 9, 9],
        [0, 0, 0, 0, 0, 0, 0, 0, 0],
        [1, 0, 0, 0, 0, 0, 0, 0, 0],
        [0, 0, 0, 0, 0, 0, 0, 0, 1],
        [7, 3, 0, 6, 2, 9, 4, 1, 8],
    ];
    for (let seed = 1; seed < 200; seed++) tries.push(Array.from({ length: 9 }, (_, index) => (seed * 7 + index * 13 + seed * index) % 10));
    for (const values of tries) {
        const code = encode(values);
        expect(code).toMatch(/^[0-9a-zA-Z]{6}$/);
        expect(decode(code)).toEqual(values);
    }
});

test("an old eleven-slider code opens with its first nine values, the two sliders taken out dropped", () => {
    // each made by the old app from the eleven values beside it
    expect(decode("0YDLrRF")).toEqual([5, 5, 5, 5, 5, 5, 5, 5, 5]); // 55555555555
    expect(decode("01ly7vk")).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8]); // 01234567890
    expect(decode("1L9zO9N")).toEqual([9, 9, 9, 9, 9, 9, 9, 9, 9]); // 99999999999
    expect(decode("0aUKYOA")).toEqual([1, 0, 0, 0, 0, 0, 0, 0, 0]); // 10000000000
    expect(decode("1hKAEO1")).toEqual([7, 3, 0, 6, 2, 9, 4, 1, 8]); // 73062941853
    expect(decode("00000cT")).toEqual([0, 0, 0, 0, 0, 0, 0, 0, 7]); // 00000000799
    expect(decode("0000000")).toEqual([0, 0, 0, 0, 0, 0, 0, 0, 0]);
});

test("an old code and its new one hold the same values", () => {
    expect(encode(decode("1hKAEO1")!)).toBe("0NrE5s");
    expect(encode(decode("0YDLrRF")!)).toBe("0BB3nt");
});

test("what is not a code is turned away", () => {
    for (const code of ["", "wbWN", "1234", "12345", "abcdefgh", "ab!def", "ab-defg", "0BB3n ", "zzzzzz", "zzzzzzz", "16FTGf"]) expect(decode(code)).toBeUndefined();
});
