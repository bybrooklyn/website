// What reading and writing .cube looks is held to: an identity table of any size, 3D or 1D, changes
// no level, to the bit; a grade written and read back grades as the grade itself does, to within a
// level; a 65 a side table is kept at 33; and hostile files (no size, wrong counts, numbers that are
// not numbers, sizes far too large, a file of a hundred megabytes, one long line) are turned down
// quickly with a plain reason, never read into memory beyond their bound.

import { expect, test } from "bun:test";
import { readCube, writeCube } from "./cube";
import { gradeOne, neutral, prepare, space, type Grade } from "./grade";

const srgb = space("srgb");
const byte = (value: number) => Math.round(value * 255);

/** An identity .cube of a size: each entry its own place. */
function identity(size: number, oneD = false): string {
    const lines = [`LUT_${oneD ? "1D" : "3D"}_SIZE ${size}`];
    const last = size - 1;
    if (oneD) for (let at = 0; at < size; at++) lines.push(`${at / last} ${at / last} ${at / last}`);
    else for (let b = 0; b < size; b++) for (let g = 0; g < size; g++) for (let r = 0; r < size; r++) lines.push(`${r / last} ${g / last} ${b / last}`);
    return lines.join("\n");
}

const graded = (grade: Grade, input: number[]) => gradeOne(input, prepare(grade, "srgb"), srgb).map(byte);

test("an identity table of any size, 3D or 1D, changes no level, to the bit", () => {
    for (const [size, oneD] of [[2, false], [17, false], [33, false], [65, false], [2, true], [1024, true]] as const) {
        const lut = readCube(identity(size, oneD));
        const grade = { ...neutral(), lut };
        for (let r = 0; r < 256; r += 3) for (const g of [0, 77, 128, 255]) expect(graded(grade, [r / 255, g / 255, (255 - r) / 255])).toEqual([r, g, 255 - r]);
    }
});

test("a 65 a side table is kept at 33, and a title, a domain and comments are read", () => {
    const lut = readCube(`# made by hand\nTITLE "Warm one"\nDOMAIN_MIN 0 0 0\nDOMAIN_MAX 1 1 1\n${identity(65)}`, "file.cube");
    expect(lut.size).toBe(33);
    expect(lut.name).toBe("Warm one");
    expect(readCube(identity(5), "Night.cube").name).toBe("Night");
    // a domain of 0 to 2 reads an input of 1 at the table's middle
    const wide = readCube(`DOMAIN_MAX 2 2 2\n${identity(3)}`);
    expect(graded({ ...neutral(), lut: wide }, [1, 1, 1])).toEqual([128, 128, 128]);
});

test("a grade written as a .cube and read back grades as the grade does, to within the few levels a 33 table can hold", () => {
    const grade: Grade = { ...neutral(), light: 30, contrast: 25, warmth: 40, color: 30, curves: { ...neutral().curves, all: [{ x: 0, y: 0.05 }, { x: 0.5, y: 0.55 }, { x: 1, y: 0.97 }] } };
    const text = writeCube(grade, "srgb", "Test look");
    expect(text.startsWith('TITLE "Test look"')).toBe(true);
    expect(text.split("\n").filter((line) => /^[\d.]/.test(line))).toHaveLength(33 ** 3);
    const look = prepare({ ...neutral(), lut: readCube(text) }, "srgb");
    const direct = prepare(grade, "srgb");
    let most = 0;
    for (let at = 0; at < 3000; at++) {
        const input = [((at * 37) % 256) / 255, ((at * 91) % 256) / 255, ((at * 13) % 256) / 255];
        const a = gradeOne(input, direct, srgb).map(byte);
        const b = gradeOne(input, look, srgb).map(byte);
        a.forEach((value, channel) => (most = Math.max(most, Math.abs(value - b[channel]!))));
    }
    // a 33 table read between its entries is within a few levels of the grade it samples
    expect(most).toBeLessThanOrEqual(4);
});

test("hostile files are turned down quickly with a plain reason", () => {
    const started = performance.now();
    const cases: [string, RegExp][] = [
        ["0 0 0\n1 1 1", /before its size/],
        ["LUT_3D_SIZE 2\n0 0 0", /1 entries where its size says 8/],
        [`LUT_3D_SIZE 2\n${"0 0 0\n".repeat(9)}`, /more entries/],
        ["LUT_3D_SIZE 2\n0 0 x\n", /could not be read/],
        ["LUT_3D_SIZE 2\n0 0 NaN\n", /could not be read/],
        ["LUT_3D_SIZE 2\n0 0 1e999\n", /could not be read/],
        ["LUT_3D_SIZE 1000", /2 to 65 a side/],
        ["LUT_3D_SIZE 2.5", /whole number/],
        ["LUT_1D_SIZE 99999999", /2 to 4096/],
        ["LUT_3D_SIZE 2\nLUT_3D_SIZE 2", /twice/],
        ["DOMAIN_MIN 1 1 1\nDOMAIN_MAX 0 0 0\nLUT_1D_SIZE 2\n0 0 0\n1 1 1", /lowest is not below/],
        ["<html>hello</html>", /not something a \.cube file says/],
        ["", /no table size/],
        [`LUT_3D_SIZE 2\n${"9".repeat(5000)}`, /too long/],
        ["LUT_3D_SIZE 2\n0 0 0 0", /3 numbers/],
    ];
    for (const [text, reason] of cases) expect(() => readCube(text)).toThrow(reason);
    // a hundred megabytes is refused before it is looked at
    expect(() => readCube("#".repeat(100 * 1024 * 1024))).toThrow(/too large/);
    // a file just under the bound of comments and no table is read through and refused
    expect(() => readCube("# a comment of no use\n".repeat(1_000_000))).toThrow(/no table size/);
    expect(performance.now() - started).toBeLessThan(5000);
});
