// What the grade's arithmetic is held to, against values known by hand: a grade at zero changes
// nothing, to the bit, at every level; a gray stays gray under every slider that is not about color;
// Contrast keeps black, white and middle gray where they are; Light is stops of light that never
// clip; white balance keeps a gray's luminance; Color never pushes a channel out of range; a straight
// curve with points on it, a wheel at its middle and a color shifted by nothing change nothing; the
// curve passes through its points and never turns back; and a grade read from a file takes nothing on
// trust.

import { expect, test } from "bun:test";
import { bakeCurves, colorWeight, curveAt, decode, encode, gainsOf, gradeOne, hueOf, isNeutral, lutData, lutTable, neutral, PIVOT, prepare, readGrade, space, trimGrade, type Grade } from "./grade";

const levels = Array.from({ length: 256 }, (_, at) => at / 255);
const byte = (value: number) => Math.round(value * 255);
const srgb = space("srgb");
const with_ = (change: Partial<Grade>): Grade => ({ ...neutral(), ...change });

test("a grade at zero, a straight curve with points on it, a wheel at its middle and a color shifted by nothing leave every level as it was, to the bit", () => {
    const grades = [neutral(), with_({ curves: { ...neutral().curves, all: [{ x: 0, y: 0 }, { x: 0.3, y: 0.3 }, { x: 0.71, y: 0.71 }, { x: 1, y: 1 }] } }), with_({ wheels: { shadows: { x: 0, y: 0 }, mids: { x: 0, y: 0 }, highs: { x: 0, y: 0 } } }), with_({ colors: [{ hue: 30, shift: 0, saturation: 0, lightness: 0 }] })];
    for (const grade of grades) {
        const ready = prepare(grade, "srgb");
        for (const r of levels) for (const g of [0, 0.2, 0.5, 1]) {
            const out = gradeOne([r, g, 1 - r], ready, srgb);
            expect(out.map(byte)).toEqual([r, g, 1 - r].map(byte));
        }
    }
    expect(isNeutral(neutral())).toBe(true);
    expect(isNeutral(with_({ light: 1 }))).toBe(false);
});

test("a gray stays gray under Light, Contrast, Shadows, Highlights, Color and the curve of all three", () => {
    for (const change of [{ light: 60 }, { light: -80 }, { contrast: 70 }, { contrast: -50 }, { shadows: 100 }, { shadows: -100 }, { highs: -100 }, { highs: 100 }, { color: 100 }, { color: -100 }, { curves: { ...neutral().curves, all: [{ x: 0, y: 0.1 }, { x: 0.4, y: 0.6 }, { x: 1, y: 0.9 }] } }] as Partial<Grade>[]) {
        const ready = prepare(with_(change), "srgb");
        for (const level of levels) {
            const [r, g, b] = gradeOne([level, level, level], ready, srgb);
            expect(Math.abs(r! - g!)).toBeLessThan(1e-6);
            expect(Math.abs(g! - b!)).toBeLessThan(1e-6);
        }
    }
});

test("Contrast keeps black, white and middle gray, and steepens or flattens about it", () => {
    for (const contrast of [100, -100, 40]) {
        const ready = prepare(with_({ contrast }), "srgb");
        expect(gradeOne([0, 0, 0], ready, srgb)[0]).toBe(0);
        expect(gradeOne([1, 1, 1], ready, srgb)[0]).toBe(1);
        expect(gradeOne([PIVOT, PIVOT, PIVOT], ready, srgb)[0]).toBeCloseTo(PIVOT, 6);
        const slope = (gradeOne([PIVOT + 1e-4, 0, 0], ready, srgb)[0]! - gradeOne([PIVOT - 1e-4, 0, 0], ready, srgb)[0]!) / 2e-4;
        expect(slope).toBeCloseTo(2 ** (contrast / 100), 2);
    }
    expect(PIVOT).toBeCloseTo(0.4614, 3);
});

test("Light is stops of light: plus 50 doubles a dark tone's light, minus 100 quarters it, and nothing ever clips", () => {
    const one = prepare(with_({ light: 50 }), "srgb");
    const dark = 0.002;
    expect(decode(gradeOne([encode(dark), 0, 0], one, srgb)[0]!)).toBeCloseTo(dark * 2, 4);
    const down = prepare(with_({ light: -100 }), "srgb");
    expect(decode(gradeOne([encode(0.5), 0, 0], down, srgb)[0]!)).toBeCloseTo(0.125, 5);
    const up = prepare(with_({ light: 100 }), "srgb");
    // white stays white and nearly white stays below it: highlights roll off rather than clip
    expect(gradeOne([1, 1, 1], up, srgb)[0]).toBeCloseTo(1, 12);
    expect(byte(gradeOne([0.7, 0.7, 0.7], up, srgb)[0]!)).toBeLessThan(250);
    let last = -1;
    for (const level of levels) {
        const now = gradeOne([level, level, level], up, srgb)[0]!;
        expect(now).toBeGreaterThanOrEqual(last);
        last = now;
    }
});

test("Shadows lifts the darks and leaves black and white; Highlights brings back the lights and leaves them too; each never turns a tone back", () => {
    for (const change of [{ shadows: 100 }, { shadows: -100 }, { highs: 100 }, { highs: -100 }] as Partial<Grade>[]) {
        const ready = prepare(with_(change), "srgb");
        expect(gradeOne([0, 0, 0], ready, srgb)[0]).toBe(0);
        expect(gradeOne([1, 1, 1], ready, srgb)[0]).toBe(1);
        let last = -1;
        for (let level = 0; level <= 1000; level++) {
            const now = gradeOne([level / 1000, 0, 0], ready, srgb)[0]!;
            expect(now).toBeGreaterThanOrEqual(last);
            last = now;
        }
    }
    expect(gradeOne([0.25, 0, 0], prepare(with_({ shadows: 100 }), "srgb"), srgb)[0]).toBeCloseTo(0.45, 5);
    expect(gradeOne([0.75, 0, 0], prepare(with_({ highs: -100 }), "srgb"), srgb)[0]).toBeCloseTo(0.55, 5);
});

test("white balance keeps a gray's luminance, warmer is redder and bluer is cooler, and Tint is green against magenta", () => {
    for (const name of ["srgb", "p3"] as const) {
        const { luma } = space(name);
        for (const [warmth, tint] of [[50, 0], [-80, 20], [0, -100], [100, 100]]) {
            const gains = gainsOf(warmth!, tint!, luma);
            expect(luma[0] * gains[0] + luma[1] * gains[1] + luma[2] * gains[2]).toBeCloseTo(1, 9);
        }
        const warm = gainsOf(50, 0, luma);
        expect(warm[0]).toBeGreaterThan(warm[2]);
        expect(Math.log2(warm[0] / warm[2])).toBeCloseTo(1, 9);
        const magenta = gainsOf(0, 100, luma);
        expect(magenta[1]).toBeLessThan(magenta[0]);
        expect(magenta[0]).toBeCloseTo(magenta[2], 9);
    }
    // P3's primaries carry different shares of luminance than sRGB's
    expect(space("p3").luma[0]).toBeGreaterThan(space("srgb").luma[0]);
});

test("Color at 100 never pushes a channel out of range, holds strong colors back, and at -100 leaves the luminance in gray", () => {
    const more = prepare(with_({ color: 100 }), "srgb");
    for (let at = 0; at < 2000; at++) {
        const input = [((at * 37) % 256) / 255, ((at * 91) % 256) / 255, ((at * 13) % 256) / 255];
        const out = gradeOne(input, more, srgb);
        for (const value of out) expect(value >= 0 && value <= 1).toBe(true);
        // a channel already at an end is never pushed past it, and no channel new to an end arrives there by clipping
        const span = (each: number[]) => Math.max(...each) - Math.min(...each);
        expect(span(out)).toBeGreaterThanOrEqual(span(input) - 1e-9);
    }
    const none = prepare(with_({ color: -100 }), "srgb");
    const [r, g, b] = gradeOne([0.8, 0.3, 0.1], none, srgb);
    expect(Math.abs(r! - g!)).toBeLessThan(1e-9);
    const y = 0.2126729 * decode(0.8) + 0.7151522 * decode(0.3) + 0.072175 * decode(0.1);
    expect(decode(r!)).toBeCloseTo(y, 6);
});

test("a wheel pushes the tones it holds toward its hue, the shadows' wheel moving darks more than lights", () => {
    const red = prepare(with_({ wheels: { shadows: { x: 1, y: 0 }, mids: { x: 0, y: 0 }, highs: { x: 0, y: 0 } } }), "srgb");
    const dark = gradeOne([0.1, 0.1, 0.1], red, srgb);
    const light = gradeOne([0.9, 0.9, 0.9], red, srgb);
    expect(dark[0]! - dark[1]!).toBeGreaterThan(light[0]! - light[1]!);
    expect(dark[0]).toBeGreaterThan(0.1);
    expect(dark[1]).toBeCloseTo(dark[2]!, 9);
});

test("a color's own shift moves its hue and leaves grays and far hues alone", () => {
    expect(colorWeight(0, 0.3, 0)).toBe(1);
    expect(colorWeight(Math.PI, 0.3, 0)).toBe(0);
    expect(colorWeight(0, 0, 0)).toBe(0);
    expect(colorWeight(Math.PI / 4, 0.3, 0)).toBeCloseTo(0.5, 9);
    const turned = prepare(with_({ colors: [{ hue: 0, shift: 50, saturation: 0, lightness: 0 }] }), "srgb");
    const red = [0.6, 0.35, 0.35];
    const out = gradeOne(red, turned, srgb);
    expect((hueOf(out).hue * 180) / Math.PI).toBeCloseTo(30, 3);
    expect(hueOf(out).chroma).toBeCloseTo(hueOf(red).chroma, 6);
    expect(gradeOne([0.5, 0.5, 0.5], turned, srgb).map(byte)).toEqual([128, 128, 128]);
    expect(gradeOne([0.2, 0.2, 0.8], turned, srgb).map(byte)).toEqual([51, 51, 204]);
});

test("a curve passes through its points and never turns back between them; the four bake into one table", () => {
    const points = [{ x: 0, y: 0.05 }, { x: 0.25, y: 0.4 }, { x: 0.5, y: 0.45 }, { x: 1, y: 1 }];
    for (const point of points) expect(curveAt(points, point.x)).toBeCloseTo(point.y, 9);
    let last = -1;
    for (let at = 0; at <= 1000; at++) {
        const now = curveAt(points, at / 1000);
        expect(now).toBeGreaterThanOrEqual(last - 1e-12);
        last = now;
    }
    const table = bakeCurves({ all: points, red: [{ x: 0, y: 1 }, { x: 1, y: 0 }], green: [{ x: 0, y: 0 }, { x: 1, y: 1 }], blue: [{ x: 0, y: 0 }, { x: 1, y: 1 }] });
    expect(table[0 * 4 + 1]).toBeCloseTo(0.05, 6);
    expect(table[0 * 4 + 0]).toBeCloseTo(0.95, 6);
});

test("a look's numbers go into base64 and come back within a 16-bit step", () => {
    const values = [0, 1, 0.5, -0.2, 1.3, 0.123456];
    const back = lutTable({ kind: "1d", size: 2, low: [0, 0, 0], high: [1, 1, 1], data: lutData(values) });
    expect([...back].filter((_, at) => at % 4 !== 3).every((value, at) => Math.abs(value - values[at]!) < 2 / 65535)).toBe(true);
});

test("a grade read from a file takes nothing on trust, and trimmed and read back is the same grade", () => {
    const hostile = readGrade({ light: 1e9, contrast: "x", warmth: -500, curves: { all: [{ x: 2, y: -1 }, { x: 0.5 }, "no"], red: Array.from({ length: 999 }, (_, at) => ({ x: at / 999, y: 0.5 })) }, wheels: { mids: { x: 3, y: 4 } }, colors: Array.from({ length: 50 }, () => ({ hue: 725, shift: 1e9 })), lut: { kind: "3d", size: 1e9, data: "AAAA" } });
    expect(hostile.light).toBe(100);
    expect(hostile.contrast).toBe(0);
    expect(hostile.warmth).toBe(-100);
    expect(hostile.curves.all).toEqual([{ x: 0, y: 0 }, { x: 1, y: 1 }]);
    expect(hostile.curves.red.length).toBe(16);
    expect(Math.hypot(hostile.wheels.mids.x, hostile.wheels.mids.y)).toBeCloseTo(1, 9);
    expect(hostile.colors).toHaveLength(3);
    expect(hostile.colors[0]!.hue).toBe(5);
    expect(hostile.colors[0]!.shift).toBe(100);
    expect(hostile.lut).toBeUndefined();
    expect(readGrade(null)).toEqual(neutral());
    const grade = with_({ light: 12.5, tint: -3, curves: { ...neutral().curves, blue: [{ x: 0, y: 0 }, { x: 0.5, y: 0.6 }, { x: 1, y: 1 }] }, colors: [{ hue: 200, shift: -10, saturation: 20, lightness: 0 }] });
    expect(trimGrade(grade)).toEqual({ light: 12.5, tint: -3, curves: { blue: grade.curves.blue }, colors: grade.colors });
    expect(readGrade(JSON.parse(JSON.stringify(trimGrade(grade))))).toEqual(grade);
});
