// The numbers of QR Code Model 2 that are looked up, not worked out, from ISO/IEC 18004: for each of the
// 40 versions and four levels of error correction, how many blocks the bytes are split into and how many
// check bytes each block has; and the arithmetic that follows from them (a version's size, its alignment
// patterns' places, how many modules carry data, how many data bytes it holds). The encoder (`encode.ts`)
// and the reader (`decode.ts`) both use them.

/** The four levels of error correction, from the least (about 7 percent of the code can be lost) to the most (about 30 percent). */
export type Level = "L" | "M" | "Q" | "H";

/** The levels from the least to the most. */
export const LEVELS: Level[] = ["L", "M", "Q", "H"];

/** The two bits each level is written as in the format information. */
export const LEVEL_BITS: Record<Level, number> = { L: 1, M: 0, Q: 3, H: 2 };

// by version, from 1 (the first entry is a stand-in for version 0)
const CHECK_PER_BLOCK: Record<Level, number[]> = {
    L: [0, 7, 10, 15, 20, 26, 18, 20, 24, 30, 18, 20, 24, 26, 30, 22, 24, 28, 30, 28, 28, 28, 28, 30, 30, 26, 28, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30],
    M: [0, 10, 16, 26, 18, 24, 16, 18, 22, 22, 26, 30, 22, 22, 24, 24, 28, 28, 26, 26, 26, 26, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28],
    Q: [0, 13, 22, 18, 26, 18, 24, 18, 22, 20, 24, 28, 26, 24, 20, 30, 24, 28, 28, 26, 30, 28, 30, 30, 30, 30, 28, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30],
    H: [0, 17, 28, 22, 16, 22, 28, 26, 26, 24, 28, 24, 28, 22, 24, 24, 30, 28, 28, 26, 28, 30, 24, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30],
};
const BLOCKS: Record<Level, number[]> = {
    L: [0, 1, 1, 1, 1, 1, 2, 2, 2, 2, 4, 4, 4, 4, 4, 6, 6, 6, 6, 7, 8, 8, 9, 9, 10, 12, 12, 12, 13, 14, 15, 16, 17, 18, 19, 19, 20, 21, 22, 24, 25],
    M: [0, 1, 1, 1, 2, 2, 4, 4, 4, 5, 5, 5, 8, 9, 9, 10, 10, 11, 13, 14, 16, 17, 17, 18, 20, 21, 23, 25, 26, 28, 29, 31, 33, 35, 37, 38, 40, 43, 45, 47, 49],
    Q: [0, 1, 1, 2, 2, 4, 4, 6, 6, 8, 8, 8, 10, 12, 16, 12, 17, 16, 18, 21, 20, 23, 23, 25, 27, 29, 34, 34, 35, 38, 40, 43, 45, 48, 51, 53, 56, 59, 62, 65, 68],
    H: [0, 1, 1, 2, 4, 4, 4, 5, 6, 8, 8, 11, 11, 16, 16, 18, 16, 19, 21, 25, 25, 25, 34, 30, 32, 35, 37, 40, 42, 45, 48, 51, 54, 57, 60, 63, 66, 70, 74, 77, 81],
};

/** The modules a side of a version: 21 for version 1, four more for each version after. */
export const sideOf = (version: number): number => version * 4 + 17;

/** The version of a code this many modules a side, or undefined when no version is. */
export const versionOfSide = (side: number): number | undefined => (side >= 21 && side <= 177 && (side - 17) % 4 === 0 ? (side - 17) / 4 : undefined);

/** Where a version's alignment patterns' middles are along each side, in modules: none for version 1. */
export function alignmentPlaces(version: number): number[] {
    if (version === 1) return [];
    const count = Math.floor(version / 7) + 2;
    const step = Math.floor((version * 8 + count * 3 + 5) / (count * 4 - 4)) * 2;
    const places = [6];
    for (let at = sideOf(version) - 7; places.length < count; at -= step) places.splice(1, 0, at);
    return places;
}

/** The modules of a version left for data and check bytes once the patterns, timing, format and version information are drawn. */
export function dataModules(version: number): number {
    let count = (16 * version + 128) * version + 64;
    if (version >= 2) {
        const aligned = Math.floor(version / 7) + 2;
        count -= (25 * aligned - 10) * aligned - 55;
        if (version >= 7) count -= 36;
    }
    return count;
}

/** How a version and level splits its bytes: the blocks, the check bytes of each, and the data bytes of the short blocks and of the long ones (one more). */
export interface Blocks {
    count: number;
    check: number;
    short: number;
    shortCount: number;
    total: number;
    data: number;
}

/** The blocks of a version at a level. */
export function blocksOf(version: number, level: Level): Blocks {
    const count = BLOCKS[level][version]!;
    const check = CHECK_PER_BLOCK[level][version]!;
    const total = Math.floor(dataModules(version) / 8);
    const longCount = total % count;
    const shortCount = count - longCount;
    const short = Math.floor(total / count) - check;
    return { count, check, short, shortCount, total, data: total - check * count };
}

/** The data bytes a version holds at a level. */
export const dataBytes = (version: number, level: Level): number => blocksOf(version, level).data;

/** A BCH code's remainder: `value` shifted up past the generator's degree, divided by the generator. */
function bchRemainder(value: number, generatorPoly: number, degree: number): number {
    let rest = value << degree;
    for (let bit = 31; bit >= degree; bit--) if (rest & (1 << bit)) rest ^= generatorPoly << (bit - degree);
    return rest;
}

/** The 15 bits of format information for a level and a mask, check bits added and the standard's pattern laid over. */
export function formatBits(level: Level, mask: number): number {
    const value = (LEVEL_BITS[level] << 3) | mask;
    return ((value << 10) | bchRemainder(value, 0x537, 10)) ^ 0x5412;
}

/** The 18 bits of version information, for versions 7 and up. */
export function versionBits(version: number): number {
    return (version << 12) | bchRemainder(version, 0x1f25, 12);
}
