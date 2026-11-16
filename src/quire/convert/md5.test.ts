// What the hand-written MD5 is held to: RFC 1321's own test suite, and the same digest as Bun's MD5 for
// random bytes fed in random pieces.

import { expect, test } from "bun:test";
import { createMd5 } from "./md5";

const hex = (bytes: Uint8Array) => [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
const of = (text: string) => {
    const sum = createMd5();
    sum.update(new TextEncoder().encode(text));
    return hex(sum.digest());
};

test("the digests of RFC 1321's test suite come out as the RFC gives them", () => {
    expect(of("")).toBe("d41d8cd98f00b204e9800998ecf8427e");
    expect(of("a")).toBe("0cc175b9c0f1b6a831c399e269772661");
    expect(of("abc")).toBe("900150983cd24fb0d6963f7d28e17f72");
    expect(of("message digest")).toBe("f96b697d7cb7938d525a2f31aaf161d0");
    expect(of("abcdefghijklmnopqrstuvwxyz")).toBe("c3fcd3d76192e4007dfb496cca67e13b");
    expect(of("ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789")).toBe("d174ab98d277d9f5a5611c2c9f419d9f");
    expect(of("12345678901234567890123456789012345678901234567890123456789012345678901234567890")).toBe("57edf4a22be3c955ac49da2e2107b67a");
});

test("random bytes fed in random pieces give the same digest as Bun's own MD5", () => {
    for (const size of [0, 1, 55, 56, 63, 64, 65, 119, 120, 1000, 100_003]) {
        const bytes = new Uint8Array(size).map(() => Math.floor(Math.random() * 256));
        const sum = createMd5();
        for (let at = 0; at < size; ) {
            const step = Math.min(size - at, 1 + Math.floor(Math.random() * 200));
            sum.update(bytes.subarray(at, at + step));
            at += step;
        }
        expect(hex(sum.digest())).toBe(new Bun.CryptoHasher("md5").update(bytes).digest("hex"));
    }
});
