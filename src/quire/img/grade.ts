// Color grading, the arithmetic: what a grade is (the six sliders, the tint, curves, three wheels,
// a color's own hue, and a look read from a .cube file), how it is kept in steps.json, and how one
// pixel is graded. This file is the reference: the shaders in grade-shader.ts do exactly these sums,
// in the same order, on the card, and the tests hold the two to within one.
//
// The working space. A picture's numbers are taken as they are encoded, sRGB's curve on sRGB's or
// Display P3's primaries (the two share the curve), and every step works where it is even:
//
//   white balance (Warmth, Tint) and Light   in linear light, on the picture's own primaries
//   Contrast, Shadows, Highlights, wheels     on the encoded numbers, where equal steps look equal
//   curves, a color's own, a look             on the encoded numbers, as every editor draws them
//   Color (saturation)                        in linear light, about the luminance of the primaries
//
// Nothing passes through 8 bits between the steps: the sums are in floating point from the pixel as
// read to the pixel as written, and only the result is rounded. Each step at its zero is skipped, so
// a grade at zero, an identity curve, wheel or look leaves every pixel as it was, to the bit.
//
//   const ready = prepare(grade, "srgb");
//   const [r, g, b] = gradeOne([0.5, 0.4, 0.3], ready, space("srgb"));

import type { Point } from "./steps";

/** A color wheel's puck, inside the unit circle: its direction is the hue it pushes toward, its distance how far. */
export interface Wheel {
    x: number;
    y: number;
}

/** A color picked in the picture and shifted on its own: the hue picked (degrees, red 0, green 120, blue 240), and how far its hue, saturation and lightness move (each -100 to 100). */
export interface OwnColor {
    hue: number;
    shift: number;
    saturation: number;
    lightness: number;
}

/** A look read from a .cube file: a 3D table (or a 1D one per channel), its size, the domain its input spans, and its numbers as base64 of 16-bit values from -0.5 to 1.5. */
export interface Lut {
    kind: "3d" | "1d";
    size: number;
    low: [number, number, number];
    high: [number, number, number];
    data: string;
    name?: string;
}

/** The four curves: all three channels together, then each on its own. Points from 0 to 1, sorted by x. */
export interface Curves {
    all: Point[];
    red: Point[];
    green: Point[];
    blue: Point[];
}

/** One grade: the sliders (each -100 to 100, zero doing nothing), the curves, the wheels, colors shifted on their own, and a look. */
export interface Grade {
    light: number;
    contrast: number;
    shadows: number;
    highs: number;
    warmth: number;
    tint: number;
    color: number;
    curves: Curves;
    wheels: { shadows: Wheel; mids: Wheel; highs: Wheel };
    colors: OwnColor[];
    lut?: Lut;
}

/** The sliders, in the order the surface shows them, each with its word. Tint is under More. */
export const SLIDERS: { key: "light" | "contrast" | "shadows" | "highs" | "warmth" | "color" | "tint"; label: string; tip: string }[] = [
    { key: "light", label: "Light", tip: "Brighter or darker, in stops of light; highlights roll off rather than clip" },
    { key: "contrast", label: "Contrast", tip: "Darks darker and lights lighter about middle gray, or the other way" },
    { key: "shadows", label: "Shadows", tip: "Lifts or deepens the dark tones only" },
    { key: "highs", label: "Highlights", tip: "Brings back or brightens the light tones only" },
    { key: "warmth", label: "Warmth", tip: "Warmer toward yellow, or cooler toward blue" },
    { key: "color", label: "Color", tip: "More color or less; strong colors are held back before they clip" },
    { key: "tint", label: "Tint", tip: "Toward magenta, or toward green" },
];

/** A curve that changes nothing. */
export const STRAIGHT: Point[] = [
    { x: 0, y: 0 },
    { x: 1, y: 1 },
];

/** A grade that changes nothing. */
export function neutral(): Grade {
    return { light: 0, contrast: 0, shadows: 0, highs: 0, warmth: 0, tint: 0, color: 0, curves: { all: STRAIGHT, red: STRAIGHT, green: STRAIGHT, blue: STRAIGHT }, wheels: { shadows: { x: 0, y: 0 }, mids: { x: 0, y: 0 }, highs: { x: 0, y: 0 } }, colors: [] };
}

/** The most colors shifted on their own in one grade, and the most points on a curve. */
export const MOST = { colors: 3, points: 16 };

const clamp = (value: number, low: number, high: number) => Math.min(high, Math.max(low, value));
const straight = (points: Point[]) => points.length === 2 && points[0]!.x === 0 && points[0]!.y === 0 && points[1]!.x === 1 && points[1]!.y === 1;

/** Whether a grade changes nothing at all. */
export function isNeutral(grade: Grade): boolean {
    const { curves, wheels } = grade;
    return SLIDERS.every((slider) => grade[slider.key] === 0) && straight(curves.all) && straight(curves.red) && straight(curves.green) && straight(curves.blue) && Object.values(wheels).every((wheel) => wheel.x === 0 && wheel.y === 0) && grade.colors.every((each) => !each.shift && !each.saturation && !each.lightness) && !grade.lut;
}

// ---- kept in steps.json: only what is not at its zero, read back checked field by field ----

/** A grade as steps.json keeps it: only the fields away from their zero. */
export function trimGrade(grade: Grade): Partial<Grade> {
    const out: Record<string, unknown> = {};
    for (const slider of SLIDERS) if (grade[slider.key]) out[slider.key] = grade[slider.key];
    const curves: Partial<Curves> = {};
    for (const key of ["all", "red", "green", "blue"] as const) if (!straight(grade.curves[key])) curves[key] = grade.curves[key];
    if (Object.keys(curves).length) out.curves = curves;
    const wheels: Record<string, Wheel> = {};
    for (const [key, wheel] of Object.entries(grade.wheels)) if (wheel.x || wheel.y) wheels[key] = wheel;
    if (Object.keys(wheels).length) out.wheels = wheels;
    if (grade.colors.length) out.colors = grade.colors;
    if (grade.lut) out.lut = grade.lut;
    return out as Partial<Grade>;
}

const isNumber = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);
const numberIn = (value: unknown, low: number, high: number, otherwise = 0) => (isNumber(value) ? clamp(value, low, high) : otherwise);

/** A curve's points from a file: two to sixteen, inside the square, sorted, no two at one x. */
function readCurve(value: unknown): Point[] {
    if (!Array.isArray(value)) return STRAIGHT;
    const points = value
        .slice(0, MOST.points)
        .map((each: { x?: unknown; y?: unknown } | null) => (isNumber(each?.x) && isNumber(each?.y) ? { x: clamp(each.x, 0, 1), y: clamp(each.y, 0, 1) } : undefined))
        .filter((each): each is Point => !!each)
        .sort((a, b) => a.x - b.x);
    const kept = points.filter((each, at) => at === 0 || each.x - points[at - 1]!.x > 1e-4);
    return kept.length >= 2 ? kept : STRAIGHT;
}

const BASE64 = /^[A-Za-z0-9+/]*={0,2}$/;

/** A look from a file: its kind, a size it may have, its domain, and data of exactly the length its size needs. */
function readLut(value: unknown): Lut | undefined {
    const lut = value as Partial<Lut> | null;
    if (!lut || typeof lut !== "object" || (lut.kind !== "3d" && lut.kind !== "1d") || !isNumber(lut.size) || typeof lut.data !== "string" || !BASE64.test(lut.data)) return undefined;
    const size = Math.round(lut.size);
    if (lut.kind === "3d" ? size < 2 || size > KEEP_3D : size < 2 || size > MOST_1D) return undefined;
    const count = (lut.kind === "3d" ? size ** 3 : size) * 3;
    if (Math.floor((lut.data.length * 3) / 4) - (lut.data.endsWith("==") ? 2 : lut.data.endsWith("=") ? 1 : 0) !== count * 2) return undefined;
    const triple = (each: unknown, otherwise: number): [number, number, number] => (Array.isArray(each) && each.length === 3 && each.every(isNumber) ? (each.map((one) => clamp(one, -1e6, 1e6)) as [number, number, number]) : [otherwise, otherwise, otherwise]);
    const low = triple(lut.low, 0);
    const high = triple(lut.high, 1);
    if (low.some((each, at) => !(high[at]! > each))) return undefined;
    return { kind: lut.kind, size, low, high, data: lut.data, ...(typeof lut.name === "string" ? { name: lut.name.slice(0, 120) } : {}) };
}

/** A grade from a file, checked field by field: what is missing or out of range is at its zero or held to its range. */
export function readGrade(value: unknown): Grade {
    const given = (value && typeof value === "object" ? value : {}) as Record<string, unknown>;
    const grade = neutral();
    for (const slider of SLIDERS) grade[slider.key] = Math.round(numberIn(given[slider.key], -100, 100) * 10) / 10;
    const curves = (given.curves ?? {}) as Record<string, unknown>;
    for (const key of ["all", "red", "green", "blue"] as const) grade.curves[key] = readCurve(curves[key]);
    const wheels = (given.wheels ?? {}) as Record<string, { x?: unknown; y?: unknown } | undefined>;
    for (const key of ["shadows", "mids", "highs"] as const) {
        let x = numberIn(wheels[key]?.x, -1, 1);
        let y = numberIn(wheels[key]?.y, -1, 1);
        const far = Math.hypot(x, y);
        if (far > 1) [x, y] = [x / far, y / far];
        grade.wheels[key] = { x, y };
    }
    grade.colors = (Array.isArray(given.colors) ? given.colors.slice(0, MOST.colors) : []).map((each: Record<string, unknown> | null) => ({
        hue: ((numberIn(each?.hue, -1e4, 1e4) % 360) + 360) % 360,
        shift: numberIn(each?.shift, -100, 100),
        saturation: numberIn(each?.saturation, -100, 100),
        lightness: numberIn(each?.lightness, -100, 100),
    }));
    const lut = readLut(given.lut);
    if (lut) grade.lut = lut;
    return grade;
}

// ---- the picture's color space ----

/** The color spaces a picture's numbers are graded in: sRGB, and Display P3, which shares sRGB's curve and white but has wider primaries. Any other profile is graded as sRGB, and the surface says so. */
export type Space = "srgb" | "p3";

/** What the arithmetic needs of a space: the luminance of each primary, and the matrix that takes a color from luminance and two color axes back to red, green and blue. */
export interface SpaceNumbers {
    luma: [number, number, number];
    back: number[];
}

const LUMA: Record<Space, [number, number, number]> = {
    // the Y row of each space's matrix to XYZ, D65 white
    srgb: [0.2126729, 0.7151522, 0.072175],
    p3: [0.2289746, 0.6917385, 0.0792869],
};

const ROOT3 = Math.sqrt(3) / 2;

/** The numbers of a space: its primaries' luminance, and the inverse of the matrix taking red, green and blue to luminance and the two color axes (red against the others, green against blue). */
export function space(name: Space): SpaceNumbers {
    const [a, b, c] = LUMA[name];
    // rows: Y = a r + b g + c b; x = r - (g + b) / 2; y = (g - b) * sqrt(3) / 2
    const m = [a, b, c, 1, -0.5, -0.5, 0, ROOT3, -ROOT3];
    const det = m[0]! * (m[4]! * m[8]! - m[5]! * m[7]!) - m[1]! * (m[3]! * m[8]! - m[5]! * m[6]!) + m[2]! * (m[3]! * m[7]! - m[4]! * m[6]!);
    const back = [
        (m[4]! * m[8]! - m[5]! * m[7]!) / det,
        (m[2]! * m[7]! - m[1]! * m[8]!) / det,
        (m[1]! * m[5]! - m[2]! * m[4]!) / det,
        (m[5]! * m[6]! - m[3]! * m[8]!) / det,
        (m[0]! * m[8]! - m[2]! * m[6]!) / det,
        (m[2]! * m[3]! - m[0]! * m[5]!) / det,
        (m[3]! * m[7]! - m[4]! * m[6]!) / det,
        (m[1]! * m[6]! - m[0]! * m[7]!) / det,
        (m[0]! * m[4]! - m[1]! * m[3]!) / det,
    ];
    return { luma: [a, b, c], back: Array.from(new Float32Array(back)) };
}

/** sRGB's curve from linear light to the encoded number (Display P3 uses the same). */
export const encode = (x: number): number => (x <= 0.0031308 ? 12.92 * x : 1.055 * Math.pow(x, 1 / 2.4) - 0.055);
/** sRGB's curve from the encoded number back to linear light. */
export const decode = (v: number): number => (v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4));

// ---- a grade made into the numbers the sums use ----

/** How many entries a baked curve has. */
export const CURVE = 1024;
/** The largest 3D look kept in a document, a side; larger ones read are sampled down to this. */
export const KEEP_3D = 33;
/** The largest 1D look kept. */
export const MOST_1D = 4096;
/** Middle gray (18 percent linear) encoded: the pivot of Contrast. */
export const PIVOT = encode(0.18);
/** How far each slider reaches at 100: Light in stops, Warmth (red against blue) and Tint (green against the others) in stops, Shadows and Highlights in encoded steps at their peak, a wheel's push and a color's lightness in encoded steps, a color's hue in radians. */
export const REACH = { light: 2, warmth: 2, tint: 1, lift: 0.2, deepen: 0.1, wheel: 0.1, lightness: 0.2, shift: Math.PI / 3 };

/** A grade as numbers, ready for the sums here and on the card. Each part at its zero is at its identity, and is skipped. */
export interface Prepared {
    gains: [number, number, number];
    exposure: number;
    contrast: number;
    shadows: number;
    highs: number;
    saturation: number;
    wheels: [number, number, number, number, number, number, number, number, number];
    colors: { hue: number; shift: number; saturation: number; lightness: number }[];
    /** The four curves baked into one table of red, green and blue, `CURVE` entries, or none when all are straight. */
    curve?: Float32Array;
    lut?: { kind: "3d" | "1d"; size: number; low: [number, number, number]; high: [number, number, number]; table: Float32Array };
}

/** The gains of white balance for Warmth and Tint: red against blue in stops, green against the two, made to keep a gray's luminance. */
export function gainsOf(warmth: number, tint: number, luma: [number, number, number]): [number, number, number] {
    const u = (warmth / 100) * REACH.warmth;
    const v = (-tint / 100) * REACH.tint;
    const raw = [Math.pow(2, u / 2 - v / 3), Math.pow(2, (2 * v) / 3), Math.pow(2, -u / 2 - v / 3)];
    const kept = luma[0] * raw[0]! + luma[1] * raw[1]! + luma[2] * raw[2]!;
    return raw.map((each) => each / kept) as [number, number, number];
}

/** A monotone curve through its points (Fritsch and Carlson's cubic), level beyond its ends. */
export function curveAt(points: Point[], x: number, slopes = tangents(points)): number {
    const n = points.length;
    if (x <= points[0]!.x) return points[0]!.y;
    if (x >= points[n - 1]!.x) return points[n - 1]!.y;
    let at = 0;
    while (points[at + 1]!.x < x) at++;
    const a = points[at]!;
    const b = points[at + 1]!;
    const h = b.x - a.x;
    const t = (x - a.x) / h;
    const t2 = t * t;
    const t3 = t2 * t;
    return clamp((2 * t3 - 3 * t2 + 1) * a.y + (t3 - 2 * t2 + t) * h * slopes[at]! + (-2 * t3 + 3 * t2) * b.y + (t3 - t2) * h * slopes[at + 1]!, 0, 1);
}

/** The tangents of a monotone cubic through points, by Fritsch and Carlson's rule. */
function tangents(points: Point[]): number[] {
    const n = points.length;
    const delta: number[] = [];
    for (let at = 0; at < n - 1; at++) delta.push((points[at + 1]!.y - points[at]!.y) / (points[at + 1]!.x - points[at]!.x));
    const m: number[] = [delta[0]!];
    for (let at = 1; at < n - 1; at++) m.push(delta[at - 1]! * delta[at]! <= 0 ? 0 : (delta[at - 1]! + delta[at]!) / 2);
    m.push(delta[n - 2]!);
    for (let at = 0; at < n - 1; at++) {
        if (delta[at] === 0) {
            m[at] = m[at + 1] = 0;
            continue;
        }
        const a = m[at]! / delta[at]!;
        const b = m[at + 1]! / delta[at]!;
        const far = a * a + b * b;
        if (far > 9) {
            const tau = 3 / Math.sqrt(far);
            m[at] = tau * a * delta[at]!;
            m[at + 1] = tau * b * delta[at]!;
        }
    }
    return m;
}

/** The four curves baked into one table: each channel's own curve after the curve of all three. */
export function bakeCurves(curves: Curves): Float32Array {
    const table = new Float32Array(CURVE * 4);
    const own = [curves.red, curves.green, curves.blue];
    const slopes = own.map(tangents);
    const allSlopes = tangents(curves.all);
    for (let at = 0; at < CURVE; at++) {
        const x = at / (CURVE - 1);
        const all = straight(curves.all) ? x : curveAt(curves.all, x, allSlopes);
        for (let channel = 0; channel < 3; channel++) table[at * 4 + channel] = straight(own[channel]!) ? all : curveAt(own[channel]!, all, slopes[channel]);
    }
    return table;
}

/** A look's numbers out of its base64: red, green and blue for each entry, as floats. */
export function lutTable(lut: Lut): Float32Array {
    const bytes = Uint8Array.from(atob(lut.data), (char) => char.charCodeAt(0));
    const words = new Uint16Array(bytes.buffer, 0, bytes.length >> 1);
    const count = words.length / 3;
    const table = new Float32Array(count * 4);
    for (let at = 0; at < count; at++) for (let channel = 0; channel < 3; channel++) table[at * 4 + channel] = (words[at * 3 + channel]! / 65535) * 2 - 0.5;
    return table;
}

/** Numbers (red, green, blue for each entry) made into a look's base64, each held to -0.5 to 1.5 and kept in 16 bits. */
export function lutData(values: ArrayLike<number>): string {
    const words = new Uint16Array(values.length);
    for (let at = 0; at < values.length; at++) words[at] = Math.round(((clamp(values[at]!, -0.5, 1.5) + 0.5) / 2) * 65535);
    const bytes = new Uint8Array(words.buffer);
    let text = "";
    for (let at = 0; at < bytes.length; at += 0x8000) text += String.fromCharCode(...bytes.subarray(at, at + 0x8000));
    return btoa(text);
}

const f32 = Math.fround;

/** A grade made into numbers for a space. Every number is the float the card will hold. */
export function prepare(grade: Grade, name: Space): Prepared {
    const { luma } = space(name);
    const gains = grade.warmth || grade.tint ? (gainsOf(grade.warmth, grade.tint, luma).map(f32) as [number, number, number]) : ([1, 1, 1] as [number, number, number]);
    const wheel = (each: Wheel): [number, number, number] => {
        const far = Math.hypot(each.x, each.y);
        if (!far) return [0, 0, 0];
        const angle = Math.atan2(each.y, each.x);
        return [0, 1, 2].map((channel) => f32(far * REACH.wheel * Math.cos(angle - (channel * 2 * Math.PI) / 3))) as [number, number, number];
    };
    const { curves } = grade;
    const curved = !(straight(curves.all) && straight(curves.red) && straight(curves.green) && straight(curves.blue));
    return {
        gains,
        exposure: f32(Math.pow(2, (grade.light / 100) * REACH.light)),
        contrast: f32(Math.pow(2, grade.contrast / 100)),
        shadows: f32(grade.shadows > 0 ? (grade.shadows / 100) * REACH.lift : (grade.shadows / 100) * REACH.deepen),
        highs: f32(grade.highs < 0 ? (-grade.highs / 100) * REACH.lift : (-grade.highs / 100) * REACH.deepen),
        saturation: f32(grade.color / 100),
        wheels: [...wheel(grade.wheels.shadows), ...wheel(grade.wheels.mids), ...wheel(grade.wheels.highs)] as Prepared["wheels"],
        colors: grade.colors.filter((each) => each.shift || each.saturation || each.lightness).map((each) => ({ hue: f32((each.hue * Math.PI) / 180), shift: f32((each.shift / 100) * REACH.shift), saturation: f32(each.saturation / 100), lightness: f32((each.lightness / 100) * REACH.lightness) })),
        ...(curved ? { curve: bakeCurves(curves) } : {}),
        ...(grade.lut ? { lut: { kind: grade.lut.kind, size: grade.lut.size, low: grade.lut.low.map(f32) as [number, number, number], high: grade.lut.high.map(f32) as [number, number, number], table: lutTable(grade.lut) } } : {}),
    };
}

// ---- one pixel ----

/** The bump Shadows and Highlights push by: none at black and white, its peak of one at a quarter. */
export const bump = (p: number): number => (p * (1 - p) * (1 - p) * (1 - p)) / 0.10546875;

const mix = (a: number, b: number, t: number) => a + (b - a) * t;
const smooth = (low: number, high: number, x: number) => {
    const t = clamp((x - low) / (high - low), 0, 1);
    return t * t * (3 - 2 * t);
};
const power = (x: number, y: number) => (x <= 0 ? 0 : Math.pow(x, y));

/** A baked table read between its entries, as the card reads it: two entries and a straight line between. */
function lookup(table: Float32Array, value: number, channel: number): number {
    const t = clamp(value, 0, 1) * (CURVE - 1);
    const at = Math.min(CURVE - 2, Math.floor(t));
    return mix(table[at * 4 + channel]!, table[(at + 1) * 4 + channel]!, t - at);
}

/** A look applied to an encoded color: the 3D table read between its eight nearest entries, or the 1D one per channel. */
function applyLut(lut: NonNullable<Prepared["lut"]>, color: number[]): number[] {
    const n = lut.size;
    const place = color.map((value, channel) => clamp((value - lut.low[channel]!) / (lut.high[channel]! - lut.low[channel]!), 0, 1) * (n - 1));
    const entry = (at: number, channel: number) => lut.table[at * 4 + channel]!;
    if (lut.kind === "1d") {
        return place.map((t, channel) => {
            const at = Math.min(n - 2, Math.floor(t));
            return mix(entry(at, channel), entry(at + 1, channel), t - at);
        });
    }
    const low = place.map((t) => Math.min(n - 2, Math.floor(t)));
    const part = place.map((t, channel) => t - low[channel]!);
    const out = [0, 0, 0];
    for (let corner = 0; corner < 8; corner++) {
        const r = low[0]! + (corner & 1);
        const g = low[1]! + ((corner >> 1) & 1);
        const b = low[2]! + ((corner >> 2) & 1);
        const weight = (corner & 1 ? part[0]! : 1 - part[0]!) * ((corner >> 1) & 1 ? part[1]! : 1 - part[1]!) * ((corner >> 2) & 1 ? part[2]! : 1 - part[2]!);
        const at = r + n * (g + n * b);
        for (let channel = 0; channel < 3; channel++) out[channel]! += weight * entry(at, channel);
    }
    return out;
}

/** How much of a color a picked color's shift takes: all within 30 degrees of its hue, falling away to none at 60, and none for colors near gray. */
export function colorWeight(hue: number, chroma: number, picked: number): number {
    let distance = Math.abs(hue - picked) % (2 * Math.PI);
    if (distance > Math.PI) distance = 2 * Math.PI - distance;
    const near = distance < Math.PI / 6 ? 1 : distance < Math.PI / 3 ? 0.5 + 0.5 * Math.cos((distance - Math.PI / 6) * 6) : 0;
    return near * smooth(0.02, 0.1, chroma);
}

/** The hue (radians) and chroma of an encoded color, on the axes a color's own shift turns about. */
export function hueOf(color: number[]): { hue: number; chroma: number } {
    const x = color[0]! - (color[1]! + color[2]!) / 2;
    const y = ROOT3 * (color[1]! - color[2]!);
    return { hue: Math.atan2(y, x), chroma: Math.hypot(x, y) };
}

/** Grades one encoded color (red, green and blue from 0 to 1) by a prepared grade, up to a stage if asked (to find a color's hue as the shift will see it). */
export function gradeOne(input: number[], ready: Prepared, numbers: SpaceNumbers, upTo: "colors" | "all" = "all"): number[] {
    const { luma } = numbers;
    let c = input.slice(0, 3);
    // white balance and Light, in linear light
    const [gr, gg, gb] = ready.gains;
    if (gr !== 1 || gg !== 1 || gb !== 1 || ready.exposure !== 1) {
        let lin = c.map(decode);
        if (gr !== 1 || gg !== 1 || gb !== 1) lin = lin.map((value, channel) => clamp(value * ready.gains[channel]!, 0, 1));
        const g = ready.exposure;
        if (g > 1) lin = lin.map((value) => 1 - power(1 - clamp(value, 0, 1), g));
        else if (g < 1) lin = lin.map((value) => value * g);
        c = lin.map(encode);
    }
    // Contrast about middle gray, keeping black and white
    const a = ready.contrast;
    if (a !== 1) c = c.map((p) => (p < PIVOT ? PIVOT * power(clamp(p, 0, 1) / PIVOT, a) : 1 - (1 - PIVOT) * power(clamp(1 - p, 0, 1) / (1 - PIVOT), a)));
    if (ready.shadows !== 0) c = c.map((p) => p + ready.shadows * bump(clamp(p, 0, 1)));
    if (ready.highs !== 0) c = c.map((p) => 1 - (1 - p + ready.highs * bump(clamp(1 - p, 0, 1))));
    // the wheels, each pushing the tones it holds
    const w = ready.wheels;
    if (w.some((each) => each !== 0)) {
        const y = clamp(luma[0] * c[0]! + luma[1] * c[1]! + luma[2] * c[2]!, 0, 1);
        const low = (1 - y) * (1 - y);
        const high = y * y;
        const middle = 1 - low - high;
        c = c.map((p, channel) => p + low * w[channel]! + middle * w[3 + channel]! + high * w[6 + channel]!);
    }
    c = c.map((p) => clamp(p, 0, 1));
    if (ready.curve) c = c.map((p, channel) => lookup(ready.curve!, p, channel));
    // Color, about the luminance in linear light, held back before a channel would leave the range
    const v = ready.saturation;
    if (v !== 0) {
        const lin = c.map(decode);
        const y = luma[0] * lin[0]! + luma[1] * lin[1]! + luma[2] * lin[2]!;
        let k = 1 + v;
        if (v > 0) {
            let most = Infinity;
            for (const value of lin) {
                if (value > y + 1e-7) most = Math.min(most, (1 - y) / (value - y));
                else if (value < y - 1e-7) most = Math.min(most, y / (y - value));
            }
            const room = most - 1;
            k = room > 1e4 ? 1 + v : room <= 0 ? 1 : 1 + room * (1 - Math.exp(-v / room));
        }
        c = lin.map((value) => encode(clamp(y + (value - y) * k, 0, 1)));
    }
    if (upTo === "colors") return c;
    // a color's own hue, saturation and lightness
    if (ready.colors.length) {
        const y = luma[0] * c[0]! + luma[1] * c[1]! + luma[2] * c[2]!;
        const { hue, chroma } = hueOf(c);
        let turn = 0;
        let scale = 1;
        let lift = 0;
        for (const each of ready.colors) {
            const weight = colorWeight(hue, chroma, each.hue);
            turn += each.shift * weight;
            scale *= 1 + each.saturation * weight;
            lift += each.lightness * weight;
        }
        // a color no picked hue reaches is left exactly as it was
        if (turn === 0 && scale === 1 && lift === 0) return finish(c, ready);
        const now = hue + turn;
        const x = chroma * scale * Math.cos(now);
        const z = chroma * scale * Math.sin(now);
        const ny = y + lift;
        const back = numbers.back;
        c = [0, 1, 2].map((row) => back[row * 3]! * ny + back[row * 3 + 1]! * x + back[row * 3 + 2]! * z);
    }
    return finish(c, ready);
}

/** The last of a grade: the look, and the color held to the range. */
function finish(c: number[], ready: Prepared): number[] {
    if (ready.lut) c = applyLut(ready.lut, c.map((p) => clamp(p, 0, 1)));
    return c.map((p) => clamp(p, 0, 1));
}
