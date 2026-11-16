// What the grid reader is held to: format and version information read through up to three wrong bits,
// either copy of the format information enough, bytes read as UTF-8 or Latin-1 as they were written,
// ECI and kanji runs read, a code seen in a mirror read once turned back, and nonsense refused.

import { expect, test } from "bun:test";
import { bytesToText, decodeGrid, formatCopies, nearestFormat, nearestVersion, readBits, transposed } from "./decode";
import { encode } from "./encode";
import { formatBits, versionBits } from "./tables";

test("format and version information are read through up to three wrong bits, and refused past that", () => {
    expect(nearestFormat(formatBits("Q", 5) ^ 0b101000000000001)).toEqual({ level: "Q", mask: 5, wrong: 3 });
    expect(nearestVersion(versionBits(23) ^ 0b100000000000100001)).toBe(23);
    expect(nearestVersion(0)).toBeUndefined();
});

test("a code with one copy of its format information spoiled is still read", () => {
    const code = encode("one copy is enough", { level: "M" });
    const spoiled = code.modules.slice();
    for (let i = 0; i <= 5; i++) spoiled[i * code.side + 8] ^= 1;
    for (let i = 0; i <= 5; i++) spoiled[8 * code.side + i] ^= 1;
    expect(formatCopies(spoiled, code.side)[0]).not.toBe(formatCopies(code.modules, code.side)[0]);
    expect(decodeGrid(spoiled, code.side)?.text).toBe("one copy is enough");
});

test("bytes are read as UTF-8 when they are UTF-8, as Latin-1 when not, and as an ECI says", () => {
    expect(bytesToText(new TextEncoder().encode("✓ Grüße"))).toBe("✓ Grüße");
    expect(bytesToText(Uint8Array.from([0x63, 0x61, 0x66, 0xe9]))).toBe("café");
    expect(bytesToText(Uint8Array.from([0xc0, 0xe0]), 22)).toBe("Аа");
    for (const text of ["café crème", "日本語 ✓", "plain"]) expect(decodeGrid(encode(text).modules, encode(text).side)?.text).toBe(text);
});

test("an ECI run and a kanji run are read", () => {
    // ECI 26 (UTF-8), then 4 bytes in byte mode: "Ω!" in UTF-8 is CE A9 21, then a terminator
    const bits = "0111" + "00011010" + "0100" + "00000011" + "11001110" + "10101001" + "00100001" + "0000";
    const bytes = new Uint8Array(Math.ceil(bits.length / 8) + 2);
    for (let i = 0; i < bits.length; i++) if (bits[i] === "1") bytes[i >>> 3]! |= 1 << (7 - (i & 7));
    expect(readBits(bytes, 1)?.text).toBe("Ω!");
    // kanji mode, the standard's example: the character 点 (Shift JIS 93 5F) is 0x0D9F in 13 bits
    const kanji = "1000" + "00000001" + (0x0d9f).toString(2).padStart(13, "0") + "0000";
    const kanjiBytes = new Uint8Array(8);
    for (let i = 0; i < kanji.length; i++) if (kanji[i] === "1") kanjiBytes[i >>> 3]! |= 1 << (7 - (i & 7));
    expect(readBits(kanjiBytes, 1)?.text).toBe("点");
});

test("a code seen in a mirror reads once turned back, and a square of noise is refused", () => {
    const code = encode("in a mirror", { level: "L" });
    const mirrored = transposed(code.modules, code.side);
    expect(decodeGrid(transposed(mirrored, code.side), code.side)?.text).toBe("in a mirror");
    let seed = 3;
    const noise = Uint8Array.from({ length: 25 * 25 }, () => ((seed = (seed * 69069 + 1) >>> 0) >>> 31) & 1);
    expect(decodeGrid(noise, 25)).toBeUndefined();
});
