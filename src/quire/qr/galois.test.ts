// What the field arithmetic and Reed-Solomon code are held to: the field's products and inverses agree,
// the check bytes are those of the standard's worked example, and a block with as many wrong bytes as its
// check bytes can mend comes back whole.

import { expect, test } from "bun:test";
import { checkBytes, generator, inverse, power, repair, times } from "./galois";

test("every number but 0 times its inverse is 1, and 2 has order 255", () => {
    for (let a = 1; a < 256; a++) expect(times(a, inverse(a))).toBe(1);
    expect(power(255)).toBe(1);
    expect(power(8)).toBe(0x1d);
});

test("the generator of 7 check bytes is the standard's", () => {
    // ISO/IEC 18004 Annex A: x^7 + a^87 x^6 + a^229 x^5 + a^146 x^4 + a^149 x^3 + a^238 x^2 + a^102 x + a^21
    expect([...generator(7)]).toEqual([87, 229, 146, 149, 238, 102, 21].map(power));
});

test("the check bytes of the standard's 1-M example of 01234567", () => {
    const data = [0x10, 0x20, 0x0c, 0x56, 0x61, 0x80, 0xec, 0x11, 0xec, 0x11, 0xec, 0x11, 0xec, 0x11, 0xec, 0x11];
    expect([...checkBytes(data, 10)]).toEqual([0xa5, 0x24, 0xd4, 0xc1, 0xed, 0x36, 0xc7, 0x87, 0x2c, 0x55]);
});

test("a block with up to half its check bytes wrong is mended, in random trials", () => {
    let seed = 7;
    const random = () => ((seed = (seed * 1103515245 + 12345) >>> 0) >>> 8) / 16777216;
    for (let trial = 0; trial < 400; trial++) {
        const check = [7, 10, 18, 22, 26, 30][trial % 6]!;
        const data = Array.from({ length: 5 + Math.floor(random() * 120) }, () => Math.floor(random() * 256));
        const whole = [...data, ...checkBytes(data, check)];
        const broken = whole.slice();
        const wrong = Math.floor(random() * (Math.floor(check / 2) + 1));
        const places = new Set<number>();
        while (places.size < wrong) places.add(Math.floor(random() * broken.length));
        for (const at of places) broken[at] ^= 1 + Math.floor(random() * 255);
        const fixed = repair(broken, check);
        expect(fixed?.errors).toBe(wrong);
        expect([...fixed!.bytes]).toEqual(whole);
    }
});

test("a block with too many wrong bytes is refused or mended to a different whole block, never left half mended", () => {
    const data = Array.from({ length: 20 }, (_, i) => (i * 37) & 255);
    const whole = [...data, ...checkBytes(data, 10)];
    const broken = whole.map((each, at) => (at < 8 ? each ^ 0x5a : each));
    const fixed = repair(broken, 10);
    if (fixed) expect(repair(fixed.bytes, 10)?.errors).toBe(0);
});
