// The QR code maker, by hand, after ISO/IEC 18004 (QR Code Model 2): text in, a square of dark and light
// modules out. The text is split into runs of numeric, alphanumeric and byte mode, chosen together to
// make the fewest bits (a search over every character, as the standard's annex suggests); text that is
// all Latin-1 is written in Latin-1, the standard's own reading of byte mode, and any other in UTF-8.
// The smallest version that holds it at the level asked is used, and the level is raised while it still
// fits in that version. The bytes are split into blocks, each given its Reed-Solomon check bytes
// (`galois.ts`), interleaved, and laid in the standard's zigzag; each of the eight masks is tried and the
// one with the least penalty by the standard's four rules is kept. Each module's part (a finder, timing,
// alignment, format or version information, or data) is given too, so a drawing can style them apart.
//
//   const code = encode("https://example.com", { level: "M" });
//   code.modules[y * code.side + x] // 1 dark, 0 light

import { checkBytes } from "./galois";
import { alignmentPlaces, blocksOf, dataBytes, formatBits, LEVELS, sideOf, versionBits, type Level } from "./tables";

/** The ways a run of text is written. */
export type Mode = "numeric" | "alphanumeric" | "byte";

/** The 45 characters of alphanumeric mode, in the order of their values. */
export const ALPHANUMERIC = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ $%*+-./:";

const MODE_BITS: Record<Mode, number> = { numeric: 1, alphanumeric: 2, byte: 4 };

/** The bits a run's length is written in, by mode and version. */
export function countBits(mode: Mode, version: number): number {
    const group = version <= 9 ? 0 : version <= 26 ? 1 : 2;
    return { numeric: [10, 12, 14], alphanumeric: [9, 11, 13], byte: [8, 16, 16] }[mode][group]!;
}

/** A run of the text in one mode: its characters, and for byte mode its bytes. */
export interface Segment {
    mode: Mode;
    text: string;
    bytes: Uint8Array;
}

/** What each module is part of, so that a drawing can style them apart. */
export const PART = { data: 0, finder: 1, separator: 2, timing: 3, alignment: 4, format: 5, version: 6, dark: 7 } as const;

/** A QR code made: its version, level and mask, its side in modules, and each module's color and part, row by row. */
export interface Code {
    version: number;
    level: Level;
    mask: number;
    side: number;
    modules: Uint8Array;
    parts: Uint8Array;
    segments: Segment[];
    /** The bits of data before the terminator and padding, and how many the version and level held. */
    bits: number;
    room: number;
}

/** What `encode` may be told: the least level, whether to raise it while it fits, the least version, and a mask to use instead of choosing one. */
export interface EncodeOptions {
    level?: Level;
    raise?: boolean;
    minVersion?: number;
    mask?: number;
}

/** Why a text could not be made into a code: it is too long for version 40 at the level asked. */
export class TooLong extends Error {
    constructor(
        readonly bits: number,
        readonly room: number,
    ) {
        super(`too long for a QR code: ${Math.ceil(bits / 8)} bytes where ${Math.floor(room / 8)} fit`);
    }
}

/** True when every character of the text is in Latin-1, the standard's own reading of byte mode. */
export const isLatin1 = (text: string): boolean => [...text].every((each) => each.codePointAt(0)! <= 0xff);

/** The bytes a text is written in in byte mode: Latin-1 when it all fits, else UTF-8. */
export function textBytes(text: string, latin1 = isLatin1(text)): Uint8Array {
    return latin1 ? Uint8Array.from([...text], (each) => each.codePointAt(0)!) : new TextEncoder().encode(text);
}

const isDigit = (c: string) => c >= "0" && c <= "9";
const isAlphanumeric = (c: string) => ALPHANUMERIC.includes(c);

/**
 * The runs that write a text in the fewest bits for versions in the same group as `version`: each
 * character's cost in each mode counted in sixths of a bit (a digit is 10/3 bits, an alphanumeric
 * character 11/2, a byte 8), a run's header when the mode changes, and the cheapest path kept.
 */
export function segmentsFor(text: string, version: number): Segment[] {
    const chars = [...text];
    if (chars.length === 0) return [];
    const latin1 = isLatin1(text);
    const modes: Mode[] = ["numeric", "alphanumeric", "byte"];
    const head = modes.map((mode) => (4 + countBits(mode, version)) * 6);
    let costs = head.slice();
    const came: (Mode | undefined)[][] = [];
    for (const c of chars) {
        const now = [Infinity, Infinity, Infinity];
        const from: (Mode | undefined)[] = [undefined, undefined, undefined];
        now[2] = costs[2]! + textBytes(c, latin1).length * 48;
        from[2] = "byte";
        if (isAlphanumeric(c)) {
            now[1] = costs[1]! + 33;
            from[1] = "alphanumeric";
        }
        if (isDigit(c)) {
            now[0] = costs[0]! + 20;
            from[0] = "numeric";
        }
        // a run may end after this character and the next begin in another mode, paying its header
        for (let next = 0; next < 3; next++) {
            for (let was = 0; was < 3; was++) {
                if (from[was] === undefined) continue;
                const cost = Math.ceil(now[was]! / 6) * 6 + head[next]!;
                if (from[next] === undefined || cost < now[next]!) {
                    now[next] = cost;
                    from[next] = modes[was];
                }
            }
        }
        costs = now;
        came.push(from);
    }
    // back from the cheapest end, the mode each character is written in
    let mode = modes[costs.indexOf(Math.min(...costs))]!;
    const each: Mode[] = new Array(chars.length);
    for (let at = chars.length - 1; at >= 0; at--) {
        mode = came[at]![modes.indexOf(mode)]!;
        each[at] = mode;
    }
    const segments: Segment[] = [];
    for (let at = 0; at < chars.length; ) {
        let end = at;
        while (end < chars.length && each[end] === each[at]) end++;
        const part = chars.slice(at, end).join("");
        segments.push({ mode: each[at]!, text: part, bytes: each[at] === "byte" ? textBytes(part, latin1) : new Uint8Array() });
        at = end;
    }
    return segments;
}

/** The bits a run takes in a version, its header and length included. */
export function segmentBits(segment: Segment, version: number): number {
    const length = segment.mode === "byte" ? segment.bytes.length : segment.text.length;
    const body = segment.mode === "numeric" ? Math.floor(length / 3) * 10 + [0, 4, 7][length % 3]! : segment.mode === "alphanumeric" ? Math.floor(length / 2) * 11 + (length % 2) * 6 : length * 8;
    return 4 + countBits(segment.mode, version) + body;
}

/** A list of bits being written. */
class Bits {
    readonly list: number[] = [];
    put(value: number, count: number) {
        for (let bit = count - 1; bit >= 0; bit--) this.list.push((value >>> bit) & 1);
    }
}

function writeSegment(bits: Bits, segment: Segment, version: number) {
    bits.put(MODE_BITS[segment.mode], 4);
    const text = segment.text;
    if (segment.mode === "numeric") {
        bits.put(text.length, countBits("numeric", version));
        for (let at = 0; at < text.length; at += 3) {
            const group = text.slice(at, at + 3);
            bits.put(Number(group), [0, 4, 7, 10][group.length]!);
        }
    } else if (segment.mode === "alphanumeric") {
        bits.put(text.length, countBits("alphanumeric", version));
        for (let at = 0; at < text.length; at += 2) {
            if (at + 1 < text.length) bits.put(ALPHANUMERIC.indexOf(text[at]!) * 45 + ALPHANUMERIC.indexOf(text[at + 1]!), 11);
            else bits.put(ALPHANUMERIC.indexOf(text[at]!), 6);
        }
    } else {
        bits.put(segment.bytes.length, countBits("byte", version));
        for (const byte of segment.bytes) bits.put(byte, 8);
    }
}

/** The smallest version from `minVersion` that holds a text at a level, with its runs and bits; undefined when none does. */
export function fit(text: string, level: Level, minVersion = 1): { version: number; segments: Segment[]; bits: number } | undefined {
    const byGroup = new Map<number, Segment[]>();
    for (let version = Math.max(1, minVersion); version <= 40; version++) {
        const group = version <= 9 ? 1 : version <= 26 ? 10 : 27;
        if (!byGroup.has(group)) byGroup.set(group, segmentsFor(text, group));
        const segments = byGroup.get(group)!;
        const bits = segments.reduce((sum, each) => sum + segmentBits(each, version), 0);
        if (bits <= dataBytes(version, level) * 8) return { version, segments, bits };
    }
    return undefined;
}

/** The data bytes of a code: the runs, the terminator, padding to a whole byte, and the two padding bytes in turn. */
export function dataCodewords(segments: Segment[], version: number, level: Level): Uint8Array {
    const room = dataBytes(version, level) * 8;
    const bits = new Bits();
    for (const segment of segments) writeSegment(bits, segment, version);
    bits.put(0, Math.min(4, room - bits.list.length));
    bits.put(0, (8 - (bits.list.length % 8)) % 8);
    for (let pad = 0xec; bits.list.length < room; pad ^= 0xec ^ 0x11) bits.put(pad, 8);
    const bytes = new Uint8Array(room / 8);
    bits.list.forEach((bit, at) => (bytes[at >>> 3]! |= bit << (7 - (at & 7))));
    return bytes;
}

/** The data bytes split into blocks, each with its check bytes, interleaved as they are laid in the code. */
export function interleave(data: Uint8Array, version: number, level: Level): Uint8Array {
    const { count, check, short, shortCount, total } = blocksOf(version, level);
    const blocks: Uint8Array[] = [];
    const checks: Uint8Array[] = [];
    for (let block = 0, at = 0; block < count; block++) {
        const length = short + (block < shortCount ? 0 : 1);
        blocks.push(data.subarray(at, at + length));
        checks.push(checkBytes(data.subarray(at, at + length), check));
        at += length;
    }
    const out = new Uint8Array(total);
    let put = 0;
    for (let i = 0; i <= short; i++) for (const block of blocks) if (i < block.length) out[put++] = block[i]!;
    for (let i = 0; i < check; i++) for (const each of checks) out[put++] = each[i]!;
    return out;
}

/** True where the mask flips a module, by the standard's eight formulas (x across, y down). */
export function masked(mask: number, x: number, y: number): boolean {
    switch (mask) {
        case 0:
            return (x + y) % 2 === 0;
        case 1:
            return y % 2 === 0;
        case 2:
            return x % 3 === 0;
        case 3:
            return (x + y) % 3 === 0;
        case 4:
            return (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0;
        case 5:
            return ((x * y) % 2) + ((x * y) % 3) === 0;
        case 6:
            return (((x * y) % 2) + ((x * y) % 3)) % 2 === 0;
        default:
            return (((x + y) % 2) + ((x * y) % 3)) % 2 === 0;
    }
}

/** A version's patterns drawn, and every module that is not data marked with its part. */
export function patterns(version: number): { side: number; modules: Uint8Array; parts: Uint8Array } {
    const side = sideOf(version);
    const modules = new Uint8Array(side * side);
    const parts = new Uint8Array(side * side).fill(255);
    const set = (x: number, y: number, dark: boolean, part: number) => {
        if (x < 0 || y < 0 || x >= side || y >= side) return;
        modules[y * side + x] = dark ? 1 : 0;
        parts[y * side + x] = part;
    };
    for (let i = 0; i < side; i++) {
        set(6, i, i % 2 === 0, PART.timing);
        set(i, 6, i % 2 === 0, PART.timing);
    }
    for (const [cx, cy] of [
        [3, 3],
        [side - 4, 3],
        [3, side - 4],
    ] as const) {
        for (let dy = -4; dy <= 4; dy++) {
            for (let dx = -4; dx <= 4; dx++) {
                const ring = Math.max(Math.abs(dx), Math.abs(dy));
                set(cx + dx, cy + dy, ring !== 2 && ring !== 4, ring === 4 ? PART.separator : PART.finder);
            }
        }
    }
    const places = alignmentPlaces(version);
    for (const ax of places) {
        for (const ay of places) {
            // none where a finder is
            if ((ax === 6 && ay === 6) || (ax === 6 && ay === side - 7) || (ax === side - 7 && ay === 6)) continue;
            for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) set(ax + dx, ay + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1, PART.alignment);
        }
    }
    // the format information's places, filled in later for each mask, and the one module always dark
    for (let i = 0; i < 9; i++) {
        if (i !== 6) {
            set(8, i, false, PART.format);
            set(i, 8, false, PART.format);
        }
    }
    for (let i = 0; i < 8; i++) {
        set(side - 1 - i, 8, false, PART.format);
        set(8, side - 1 - i, false, PART.format);
    }
    set(8, side - 8, true, PART.dark);
    if (version >= 7) {
        const bits = versionBits(version);
        for (let i = 0; i < 18; i++) {
            const dark = ((bits >>> i) & 1) === 1;
            const a = side - 11 + (i % 3);
            const b = Math.floor(i / 3);
            set(a, b, dark, PART.version);
            set(b, a, dark, PART.version);
        }
    }
    for (let i = 0; i < parts.length; i++) if (parts[i] === 255) parts[i] = PART.data;
    return { side, modules, parts };
}

/** The places of the data modules in the order bits are laid in them: up and down two columns at a time from the right, skipping the vertical timing column. */
export function dataOrder(side: number, parts: Uint8Array): Uint32Array {
    const order: number[] = [];
    for (let right = side - 1; right >= 1; right -= 2) {
        if (right === 6) right = 5;
        const upward = ((right + 1) & 2) === 0;
        for (let step = 0; step < side; step++) {
            const y = upward ? side - 1 - step : step;
            for (let j = 0; j < 2; j++) {
                const x = right - j;
                if (parts[y * side + x] === PART.data) order.push(y * side + x);
            }
        }
    }
    return Uint32Array.from(order);
}

/** Writes the format information for a level and mask in both of its places. */
export function putFormat(modules: Uint8Array, side: number, level: Level, mask: number) {
    const bits = formatBits(level, mask);
    const bit = (i: number) => (bits >>> i) & 1;
    for (let i = 0; i <= 5; i++) modules[i * side + 8] = bit(i);
    modules[7 * side + 8] = bit(6);
    modules[8 * side + 8] = bit(7);
    modules[8 * side + 7] = bit(8);
    for (let i = 9; i < 15; i++) modules[8 * side + 14 - i] = bit(i);
    for (let i = 0; i < 8; i++) modules[8 * side + side - 1 - i] = bit(i);
    for (let i = 8; i < 15; i++) modules[(side - 15 + i) * side + 8] = bit(i);
}

/** The standard's penalty for a code's look: long runs, 2 by 2 blocks, things that look like a finder, and dark and light out of balance. */
export function penalty(modules: Uint8Array, side: number): number {
    let score = 0;
    const line = new Uint8Array(side);
    for (let across = 0; across < 2; across++) {
        for (let i = 0; i < side; i++) {
            for (let j = 0; j < side; j++) line[j] = across ? modules[j * side + i]! : modules[i * side + j]!;
            // runs of one color within the code
            const lengths: number[] = [];
            const colors: number[] = [];
            for (let j = 0; j < side; j++) {
                if (j > 0 && line[j] === line[j - 1]) lengths[lengths.length - 1]!++;
                else {
                    lengths.push(1);
                    colors.push(line[j]!);
                }
            }
            for (const length of lengths) if (length >= 5) score += 3 + length - 5;
            // for the finder-like rule, the light outside the code joins the light runs at each edge
            if (colors[0] === 0) lengths[0] = Infinity;
            else {
                lengths.unshift(Infinity);
                colors.unshift(0);
            }
            if (colors[colors.length - 1] === 0) lengths[lengths.length - 1] = Infinity;
            else {
                lengths.push(Infinity);
                colors.push(0);
            }
            for (let r = 3; r < lengths.length - 3; r++) {
                if (colors[r] !== 1) continue;
                const n = lengths[r - 2]!;
                if (lengths[r] !== 3 * n || lengths[r - 1] !== n || lengths[r + 1] !== n || lengths[r + 2] !== n) continue;
                if (lengths[r - 3]! >= 4 * n) score += 40;
                if (lengths[r + 3]! >= 4 * n) score += 40;
            }
        }
    }
    for (let y = 0; y < side - 1; y++) {
        for (let x = 0; x < side - 1; x++) {
            const c = modules[y * side + x];
            if (c === modules[y * side + x + 1] && c === modules[(y + 1) * side + x] && c === modules[(y + 1) * side + x + 1]) score += 3;
        }
    }
    let dark = 0;
    for (const each of modules) dark += each;
    const total = side * side;
    score += (Math.ceil(Math.abs(dark * 20 - total * 10) / total) - 1) * 10;
    return score;
}

/** Lays the bytes in the code and lays a mask over the data, giving a fresh copy. */
export function laid(base: Uint8Array, side: number, order: Uint32Array, bytes: Uint8Array, mask: number, level: Level): Uint8Array {
    const modules = base.slice();
    for (let i = 0; i < order.length; i++) {
        const place = order[i]!;
        const bit = i < bytes.length * 8 ? (bytes[i >>> 3]! >>> (7 - (i & 7))) & 1 : 0;
        const x = place % side;
        const y = (place - x) / side;
        modules[place] = bit ^ (masked(mask, x, y) ? 1 : 0);
    }
    putFormat(modules, side, level, mask);
    return modules;
}

/** Makes a text into a QR code, or throws `TooLong`. */
export function encode(text: string, options: EncodeOptions = {}): Code {
    let level = options.level ?? "M";
    const found = fit(text, level, options.minVersion);
    if (!found) {
        const segments = segmentsFor(text, 27);
        throw new TooLong(
            segments.reduce((sum, each) => sum + segmentBits(each, 40), 0),
            dataBytes(40, level) * 8,
        );
    }
    const { version, segments, bits } = found;
    if (options.raise !== false) for (const higher of LEVELS.slice(LEVELS.indexOf(level) + 1)) if (bits <= dataBytes(version, higher) * 8) level = higher;
    const bytes = interleave(dataCodewords(segments, version, level), version, level);
    const { side, modules: base, parts } = patterns(version);
    const order = dataOrder(side, parts);
    let best: { mask: number; modules: Uint8Array; score: number } | undefined;
    for (const mask of options.mask === undefined ? [0, 1, 2, 3, 4, 5, 6, 7] : [options.mask]) {
        const modules = laid(base, side, order, bytes, mask, level);
        const score = options.mask === undefined ? penalty(modules, side) : 0;
        if (!best || score < best.score) best = { mask, modules, score };
    }
    return { version, level, mask: best!.mask, side, modules: best!.modules, parts, segments, bits, room: dataBytes(version, level) * 8 };
}
