// The second half of the reader: a square of modules, as read off a picture, made back into text. The
// format information is read from whichever of its two copies is nearer a true one (up to three bits
// wrong), the version from the side and, from version 7, from its own information; the mask is taken
// off, the bytes are read in the zigzag the maker laid them in, split back into blocks, each mended by
// its check bytes (`galois.ts`), and the bits read as runs of numeric, alphanumeric, byte and kanji
// mode, with ECI saying how bytes are to be read. Bytes with no ECI are read as UTF-8 when they are
// valid UTF-8 with some character beyond ASCII, else as Latin-1, the standard's own reading.
//
//   const read = decodeGrid(modules, side); // { text, version, level, ... } or undefined

import { dataOrder, masked, patterns, ALPHANUMERIC, type Mode } from "./encode";
import { repair } from "./galois";
import { blocksOf, formatBits, LEVELS, sideOf, versionBits, versionOfSide, type Level } from "./tables";

/** A code read: its text, version, level and mask, how many bytes its check bytes mended, and the modes its text was written in. */
export interface Read {
    text: string;
    version: number;
    level: Level;
    mask: number;
    mended: number;
    modes: (Mode | "kanji")[];
    /** The bytes of its data, as they were written, for a test to hold against what was made. */
    bytes: Uint8Array;
}

const bitsApart = (a: number, b: number) => {
    let x = a ^ b;
    let count = 0;
    while (x) {
        count += x & 1;
        x >>>= 1;
    }
    return count;
};

/** The level and mask nearest some 15 bits of format information, and how many bits were wrong; undefined past three. */
export function nearestFormat(bits: number): { level: Level; mask: number; wrong: number } | undefined {
    let best: { level: Level; mask: number; wrong: number } | undefined;
    for (const level of LEVELS) {
        for (let mask = 0; mask < 8; mask++) {
            const wrong = bitsApart(bits, formatBits(level, mask));
            if (!best || wrong < best.wrong) best = { level, mask, wrong };
        }
    }
    return best && best.wrong <= 3 ? best : undefined;
}

/** The version nearest 18 bits of version information, from 7 up; undefined past three bits wrong. */
export function nearestVersion(bits: number): number | undefined {
    let best = { version: 0, wrong: 99 };
    for (let version = 7; version <= 40; version++) {
        const wrong = bitsApart(bits, versionBits(version));
        if (wrong < best.wrong) best = { version, wrong };
    }
    return best.wrong <= 3 ? best.version : undefined;
}

/** The two copies of the format information, as read from a square of modules. */
export function formatCopies(modules: ArrayLike<number>, side: number): [number, number] {
    const at = (x: number, y: number) => modules[y * side + x]! & 1;
    let first = 0;
    for (let i = 0; i <= 5; i++) first |= at(8, i) << i;
    first |= at(8, 7) << 6;
    first |= at(8, 8) << 7;
    first |= at(7, 8) << 8;
    for (let i = 9; i < 15; i++) first |= at(14 - i, 8) << i;
    let second = 0;
    for (let i = 0; i < 8; i++) second |= at(side - 1 - i, 8) << i;
    for (let i = 8; i < 15; i++) second |= at(8, side - 15 + i) << i;
    return [first, second];
}

/** The two copies of the version information, as read from a square of modules of version 7 or more. */
export function versionCopies(modules: ArrayLike<number>, side: number): [number, number] {
    let right = 0;
    let below = 0;
    for (let i = 0; i < 18; i++) {
        const a = side - 11 + (i % 3);
        const b = Math.floor(i / 3);
        right |= (modules[b * side + a]! & 1) << i;
        below |= (modules[a * side + b]! & 1) << i;
    }
    return [right, below];
}

/** The format information of a square of modules: the nearer of its two copies. */
export function readFormat(modules: ArrayLike<number>, side: number): { level: Level; mask: number; wrong: number } | undefined {
    const found = formatCopies(modules, side).map(nearestFormat).filter((each) => each !== undefined);
    return found.sort((a, b) => a.wrong - b.wrong)[0];
}

/** The text a run of bytes stands for under an ECI assignment number, or with none. */
export function bytesToText(bytes: Uint8Array, eci?: number): string {
    const label = eci === undefined ? undefined : eciLabel(eci);
    if (label) {
        try {
            return new TextDecoder(label, { fatal: false }).decode(bytes);
        } catch {
            // a label this browser does not know falls to the guess below
        }
    }
    if (bytes.some((each) => each >= 0x80)) {
        try {
            return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
        } catch {
            // not UTF-8: Latin-1, the standard's own reading
        }
    }
    let text = "";
    for (const each of bytes) text += String.fromCharCode(each);
    return text;
}

/** The text encoding an ECI assignment number names. */
export function eciLabel(eci: number): string | undefined {
    if (eci === 0 || eci === 2) return "cp437";
    if (eci === 1 || eci === 3) return "iso-8859-1";
    if (eci >= 4 && eci <= 18 && eci !== 14) return `iso-8859-${eci - 2}`;
    return { 20: "shift_jis", 21: "windows-1250", 22: "windows-1251", 23: "windows-1252", 24: "windows-1256", 25: "utf-16be", 26: "utf-8", 27: "us-ascii", 28: "big5", 29: "gb18030", 30: "euc-kr" }[eci];
}

/** Reads the runs of a code's data bytes into text, or undefined when the bits make no sense. */
export function readBits(data: Uint8Array, version: number): { text: string; modes: (Mode | "kanji")[] } | undefined {
    let at = 0;
    const total = data.length * 8;
    const take = (count: number): number => {
        if (at + count > total) throw new RangeError("past the end");
        let value = 0;
        for (let i = 0; i < count; i++, at++) value = (value << 1) | ((data[at >>> 3]! >>> (7 - (at & 7))) & 1);
        return value;
    };
    const group = version <= 9 ? 0 : version <= 26 ? 1 : 2;
    let text = "";
    const modes: (Mode | "kanji")[] = [];
    let eci: number | undefined;
    // bytes are gathered across runs, so a character split between two byte runs is still read whole
    let pending: number[] = [];
    const flush = () => {
        if (pending.length) text += bytesToText(Uint8Array.from(pending), eci);
        pending = [];
    };
    try {
        while (total - at >= 4) {
            const mode = take(4);
            if (mode === 0) break;
            if (mode === 1) {
                flush();
                modes.push("numeric");
                let count = take([10, 12, 14][group]!);
                while (count >= 3) {
                    const value = take(10);
                    if (value > 999) return undefined;
                    text += String(value).padStart(3, "0");
                    count -= 3;
                }
                if (count === 2) {
                    const value = take(7);
                    if (value > 99) return undefined;
                    text += String(value).padStart(2, "0");
                } else if (count === 1) {
                    const value = take(4);
                    if (value > 9) return undefined;
                    text += String(value);
                }
            } else if (mode === 2) {
                flush();
                modes.push("alphanumeric");
                let count = take([9, 11, 13][group]!);
                while (count >= 2) {
                    const value = take(11);
                    if (value >= 45 * 45) return undefined;
                    text += ALPHANUMERIC[Math.floor(value / 45)]! + ALPHANUMERIC[value % 45]!;
                    count -= 2;
                }
                if (count === 1) {
                    const value = take(6);
                    if (value >= 45) return undefined;
                    text += ALPHANUMERIC[value]!;
                }
            } else if (mode === 4) {
                modes.push("byte");
                const count = take([8, 16, 16][group]!);
                for (let i = 0; i < count; i++) pending.push(take(8));
            } else if (mode === 8) {
                flush();
                modes.push("kanji");
                const count = take([8, 10, 12][group]!);
                const sjis: number[] = [];
                for (let i = 0; i < count; i++) {
                    const value = take(13);
                    const joined = Math.floor(value / 0xc0) * 0x100 + (value % 0xc0);
                    const code = joined + (joined < 0x1f00 ? 0x8140 : 0xc140);
                    sjis.push(code >> 8, code & 0xff);
                }
                text += bytesToText(Uint8Array.from(sjis), 20);
            } else if (mode === 7) {
                flush();
                const first = take(8);
                eci = (first & 0x80) === 0 ? first : (first & 0xc0) === 0x80 ? ((first & 0x3f) << 8) | take(8) : ((first & 0x1f) << 16) | take(16);
            } else if (mode === 3) take(16);
            else if (mode === 5) continue;
            else if (mode === 9) take(8);
            else return undefined;
        }
    } catch {
        return undefined;
    }
    flush();
    return { text, modes };
}

/** Reads a square of modules (1 dark) as a QR code; undefined when it is not one that can be read. */
export function decodeGrid(modules: ArrayLike<number>, side: number): Read | undefined {
    let version = versionOfSide(side);
    if (version === undefined) return undefined;
    if (version >= 7) {
        const found = versionCopies(modules, side).map(nearestVersion).find((each) => each !== undefined);
        if (found === undefined || sideOf(found) !== side) return undefined;
        version = found;
    }
    const format = readFormat(modules, side);
    if (!format) return undefined;
    const { level, mask } = format;
    const { parts } = patterns(version);
    const order = dataOrder(side, parts);
    const layout = blocksOf(version, level);
    const raw = new Uint8Array(layout.total);
    for (let i = 0; i < layout.total * 8; i++) {
        const place = order[i]!;
        const x = place % side;
        const y = (place - x) / side;
        const bit = (modules[place]! & 1) ^ (masked(mask, x, y) ? 1 : 0);
        raw[i >>> 3]! |= bit << (7 - (i & 7));
    }
    // back into blocks: the data bytes went out one from each block in turn, then the check bytes
    const blocks: number[][] = Array.from({ length: layout.count }, () => []);
    let at = 0;
    for (let i = 0; i <= layout.short; i++) {
        for (let block = 0; block < layout.count; block++) {
            const length = layout.short + (block < layout.shortCount ? 0 : 1);
            if (i < length) blocks[block]!.push(raw[at++]!);
        }
    }
    for (let i = 0; i < layout.check; i++) for (const block of blocks) block.push(raw[at++]!);
    const data: number[] = [];
    let mended = 0;
    for (const [index, block] of blocks.entries()) {
        const fixed = repair(block, layout.check);
        if (!fixed) return undefined;
        mended += fixed.errors;
        const length = layout.short + (index < layout.shortCount ? 0 : 1);
        data.push(...fixed.bytes.subarray(0, length));
    }
    const bytes = Uint8Array.from(data);
    const read = readBits(bytes, version);
    if (!read) return undefined;
    return { text: read.text, version, level, mask, mended, modes: read.modes, bytes };
}

/** A square of modules turned about its diagonal, as a code seen in a mirror is. */
export function transposed(modules: ArrayLike<number>, side: number): Uint8Array {
    const out = new Uint8Array(side * side);
    for (let y = 0; y < side; y++) for (let x = 0; x < side; x++) out[x * side + y] = modules[y * side + x]!;
    return out;
}
