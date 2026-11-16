// What the maker is held to: the standard's worked example comes out byte for byte; the modes are chosen
// for the fewest bits; capacities are the standard's; every version from 1 to 40 at every level is made
// and read back by the reader's own grid decoder; a code with modules spoiled still reads; and, where
// qrencode and zbarimg are on this machine, qrencode's codes read back here, ours match qrencode's module
// for module with the same mask, and zbarimg reads ours.

import { expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { decodeGrid } from "./decode";
import { dataCodewords, encode, fit, interleave, penalty, PART, segmentsFor, TooLong } from "./encode";
import { formatBits, LEVELS, sideOf, type Level } from "./tables";

const which = (name: string) => Bun.spawnSync(["which", name]).success;

test("the standard's example, 01234567 at 1-M, comes out byte for byte", () => {
    const segments = segmentsFor("01234567", 1);
    expect(segments.map((each) => each.mode)).toEqual(["numeric"]);
    const bytes = interleave(dataCodewords(segments, 1, "M"), 1, "M");
    expect([...bytes]).toEqual([0x10, 0x20, 0x0c, 0x56, 0x61, 0x80, 0xec, 0x11, 0xec, 0x11, 0xec, 0x11, 0xec, 0x11, 0xec, 0x11, 0xa5, 0x24, 0xd4, 0xc1, 0xed, 0x36, 0xc7, 0x87, 0x2c, 0x55]);
});

test("HELLO WORLD at 1-Q is the well-known 13 data bytes", () => {
    const bytes = dataCodewords(segmentsFor("HELLO WORLD", 1), 1, "Q");
    expect([...bytes]).toEqual([32, 91, 11, 120, 209, 114, 220, 77, 67, 64, 236, 17, 236]);
});

test("the modes are chosen for the fewest bits", () => {
    expect(segmentsFor("12345", 1).map((each) => each.mode)).toEqual(["numeric"]);
    expect(segmentsFor("HELLO WORLD", 1).map((each) => each.mode)).toEqual(["alphanumeric"]);
    expect(segmentsFor("hello", 1).map((each) => each.mode)).toEqual(["byte"]);
    // a long run of digits inside lowercase text is worth a numeric run of its own
    expect(segmentsFor("abc0123456789012345678def", 1).map((each) => each.mode)).toEqual(["byte", "numeric", "byte"]);
    // a short run of digits is not
    expect(segmentsFor("abc12def", 1).map((each) => each.mode)).toEqual(["byte"]);
    // Latin-1 text is one byte a character; anything beyond it is UTF-8
    expect(segmentsFor("café", 1)[0]!.bytes.length).toBe(4);
    expect(segmentsFor("café ✓", 1)[0]!.bytes.length).toBe(9);
});

test("capacities are the standard's: the most that fits at version 40-L and at version 1", () => {
    expect(fit("1".repeat(7089), "L")?.version).toBe(40);
    expect(fit("1".repeat(7090), "L")).toBeUndefined();
    expect(fit("A".repeat(4296), "L")?.version).toBe(40);
    expect(fit("A".repeat(4297), "L")).toBeUndefined();
    expect(fit("a".repeat(2953), "L")?.version).toBe(40);
    expect(fit("a".repeat(2954), "L")).toBeUndefined();
    expect(fit("1".repeat(41), "L")?.version).toBe(1);
    expect(fit("1".repeat(42), "L")?.version).toBe(2);
    expect(fit("a".repeat(7), "H")?.version).toBe(1);
    expect(fit("a".repeat(8), "H")?.version).toBe(2);
    expect(fit("A".repeat(10), "H")?.version).toBe(1);
    expect(() => encode("a".repeat(1300), { level: "H" })).toThrow(TooLong);
});

test("the level is raised while the code stays the same size, unless told not to", () => {
    expect(encode("1", { level: "L" }).level).toBe("H");
    expect(encode("1", { level: "L", raise: false }).level).toBe("L");
});

test("every version from 1 to 40 at every level is made and read back, in each mode", () => {
    const made: string[] = [];
    for (let version = 1; version <= 40; version++) {
        for (const level of LEVELS) {
            // a text that needs exactly this version: the most of one kind that fits in it
            const kind = ["digits", "letters", "bytes", "mixed"][(version + LEVELS.indexOf(level)) % 4]!;
            const unit = (count: number) => (kind === "digits" ? "8675309".repeat(count).slice(0, count) : kind === "letters" ? "QR CODE $%*+-./:".repeat(count).slice(0, count) : kind === "bytes" ? "a quire, é ✓ ".repeat(count).slice(0, count) : "Mixed 0123456789 TEXT ".repeat(count).slice(0, count));
            let count = 1;
            let step = 1024;
            while (step >= 1) {
                const tried = fit(unit(count + step), level);
                if (tried && tried.version <= version) count += step;
                else step >>= 1;
            }
            const text = unit(count);
            const code = encode(text, { level, raise: false });
            expect(code.version).toBe(version);
            expect(code.side).toBe(sideOf(version));
            const read = decodeGrid(code.modules, code.side);
            expect(read?.text).toBe(text);
            expect([read?.version, read?.level, read?.mask, read?.mended]).toEqual([version, level, code.mask, 0]);
            made.push(`${version}-${level}`);
        }
    }
    expect(made.length).toBe(160);
}, 120_000);

test("a code with a block of modules spoiled still reads, up to what its level can mend", () => {
    const code = encode("https://example.com/a/longer/address?with=some&things=in&it", { level: "H", raise: false });
    const spoiled = code.modules.slice();
    // a square in the middle, about a fifth of the side, painted dark
    const from = Math.floor(code.side * 0.4);
    const size = Math.floor(code.side * 0.2);
    for (let y = from; y < from + size; y++) for (let x = from; x < from + size; x++) if (code.parts[y * code.side + x] === PART.data) spoiled[y * code.side + x] = 1;
    const read = decodeGrid(spoiled, code.side);
    expect(read?.text).toBe("https://example.com/a/longer/address?with=some&things=in&it");
    expect(read!.mended).toBeGreaterThan(0);
});

test("the mask chosen has the least penalty of the eight", () => {
    const text = "Penalty check 2024";
    const chosen = encode(text, { level: "Q", raise: false });
    for (let mask = 0; mask < 8; mask++) expect(penalty(chosen.modules, chosen.side)).toBeLessThanOrEqual(penalty(encode(text, { level: "Q", raise: false, mask }).modules, chosen.side));
});

test("the penalty counts a run of five, a 2 by 2 block, a finder-like run and the balance by the standard's rules", () => {
    // all light, 21 a side: each row and column is one run of 21 (3 + 16 points each, 42 lines), 400 blocks of
    // 2 by 2, no finder-like runs, and all light (the balance is out by 50 percent: 9 steps of 10)
    expect(penalty(new Uint8Array(21 * 21), 21)).toBe(42 * 19 + 400 * 3 + 90);
    // a checkerboard has none of the first three, and is in balance
    const board = Uint8Array.from({ length: 21 * 21 }, (_, i) => ((i % 21) + Math.floor(i / 21)) % 2);
    expect(penalty(board, 21)).toBe(0);
});

/** qrencode's matrix for a text, with no margin, rows of 1 dark. */
function qrencode(text: string, level: Level, extra: string[] = []): Uint8Array[] {
    const out = Bun.spawnSync(["qrencode", "-t", "ASCII", "-m", "0", "-l", level, ...extra, text]).stdout.toString();
    return out.split("\n").filter((line) => line.length).map((line) => Uint8Array.from(line.match(/../g)!, (pair) => (pair === "##" ? 1 : 0)));
}

test("qrencode's codes read back here, and ours match them module for module with the same mask (where qrencode is installed)", () => {
    if (!which("qrencode")) return console.warn("qrencode is not on this machine: its cross-check skipped");
    const texts = ["01234567", "HELLO WORLD", "https://example.com/some/path?x=1", "Hello, world!", "a".repeat(300), "1234567890".repeat(40), "WIFI:T:WPA;S:home;P:pass\\;word;;", "x".repeat(1200)];
    let matched = 0;
    for (const text of texts) {
        for (const level of LEVELS) {
            const rows = qrencode(text, level, ["-8"]);
            const side = rows.length;
            const flat = new Uint8Array(side * side);
            rows.forEach((row, y) => flat.set(row, y * side));
            expect(decodeGrid(flat, side)?.text).toBe(text);
            // their mask, read from their format information
            let bits = 0;
            for (let i = 0; i < 8; i++) bits |= rows[8]![side - 1 - i]! << i;
            for (let i = 8; i < 15; i++) bits |= rows[side - 15 + i]![8]! << i;
            const mask = [0, 1, 2, 3, 4, 5, 6, 7].find((each) => formatBits(level, each) === bits)!;
            // with byte mode alone (-8), the same bits: ours with their mask is theirs
            const ours = encode(text, { level, raise: false, mask });
            const allBytes = ours.segments.every((each) => each.mode === "byte");
            if (allBytes) {
                expect(ours.side).toBe(side);
                expect([...ours.modules]).toEqual([...flat]);
                matched++;
            }
        }
    }
    expect(matched).toBeGreaterThanOrEqual(12);
}, 60_000);

test("zbarimg reads the codes made here, at every level and in sizes up to version 40 (where zbarimg is installed)", async () => {
    if (!which("zbarimg")) return console.warn("zbarimg is not on this machine: its cross-check skipped");
    const folder = await mkdtemp(join(tmpdir(), "quire-qr-zbar-"));
    try {
        const texts: [string, Level][] = [
            ["01234567", "M"],
            ["https://example.com/a?b=c", "L"],
            ["Grüße aus Köln ✓", "Q"],
            ["WIFI:T:WPA;S:My network;P:secret\\;pass;;", "H"],
            ["0123456789".repeat(200), "L"],
            ["Q".repeat(1000), "M"],
            ["z".repeat(2900), "L"],
        ];
        for (const [index, [text, level]] of texts.entries()) {
            const code = encode(text, { level });
            // a plain graymap, four pixels a module and a margin of four modules
            const scale = 4;
            const width = (code.side + 8) * scale;
            const pixels = new Uint8Array(width * width).fill(255);
            for (let y = 0; y < code.side; y++) for (let x = 0; x < code.side; x++) if (code.modules[y * code.side + x]) for (let dy = 0; dy < scale; dy++) pixels.fill(0, ((y + 4) * scale + dy) * width + (x + 4) * scale, ((y + 4) * scale + dy) * width + (x + 5) * scale);
            const path = `${folder}/code-${index}.pgm`;
            await Bun.write(path, new Uint8Array([...new TextEncoder().encode(`P5\n${width} ${width}\n255\n`), ...pixels]));
            const out = Bun.spawnSync(["zbarimg", "--raw", "-q", "-Sbinary", path]);
            expect(new TextDecoder().decode(out.stdout).replace(/\n$/, "")).toBe(text);
        }
    } finally {
        await rm(folder, { recursive: true, force: true });
    }
}, 60_000);
