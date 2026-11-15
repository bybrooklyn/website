// What the looked-up numbers of QR Code are held to: the standard's own figures for sizes, alignment
// places, data modules and capacities, and the known format and version information words.

import { expect, test } from "bun:test";
import { alignmentPlaces, blocksOf, dataBytes, dataModules, formatBits, sideOf, versionBits, versionOfSide } from "./tables";

test("sides run from 21 to 177, and a side gives its version back", () => {
    expect(sideOf(1)).toBe(21);
    expect(sideOf(40)).toBe(177);
    for (let version = 1; version <= 40; version++) expect(versionOfSide(sideOf(version))).toBe(version);
    expect(versionOfSide(22)).toBeUndefined();
});

test("alignment patterns are where the standard's table puts them", () => {
    expect(alignmentPlaces(1)).toEqual([]);
    expect(alignmentPlaces(2)).toEqual([6, 18]);
    expect(alignmentPlaces(7)).toEqual([6, 22, 38]);
    expect(alignmentPlaces(14)).toEqual([6, 26, 46, 66]);
    expect(alignmentPlaces(32)).toEqual([6, 34, 60, 86, 112, 138]);
    expect(alignmentPlaces(36)).toEqual([6, 24, 50, 76, 102, 128, 154]);
    expect(alignmentPlaces(40)).toEqual([6, 30, 58, 86, 114, 142, 170]);
});

test("the data modules and bytes match the standard's table", () => {
    expect(dataModules(1)).toBe(208);
    expect(dataModules(7)).toBe(1568);
    expect(dataModules(40)).toBe(29648);
    expect(dataBytes(1, "M")).toBe(16);
    expect(dataBytes(1, "H")).toBe(9);
    expect(dataBytes(40, "L")).toBe(2956);
    expect(dataBytes(40, "H")).toBe(1276);
    expect(dataBytes(5, "Q")).toBe(62);
    // version 5 at Q: two blocks of 15 data bytes and two of 16, each with 18 check bytes
    expect(blocksOf(5, "Q")).toEqual({ count: 4, check: 18, short: 15, shortCount: 2, total: 134, data: 62 });
});

test("format and version information are the standard's words", () => {
    expect(formatBits("M", 0)).toBe(0x5412);
    expect(formatBits("L", 0)).toBe(0x77c4);
    expect(formatBits("H", 7)).toBe(0b000100000111011);
    expect(versionBits(7)).toBe(0x07c94);
    expect(versionBits(40)).toBe(0x28c69);
});
