// What Comet shows besides the game itself, worked out without a canvas: the first stretch of the
// flight a pull would give, the planets' colors, the stars behind the field, and which way the
// comet's tail streams. comet.ts draws them.
//
// The path ahead is the flight's own first steps, run by `advance` from flight.ts, so the dots are
// exactly where the comet goes. The colors and the stars follow from the seed alone, so a field
// looks the same every time it is opened.

import { hash, numbers } from "./fields";
import { STEP, advance, launch, type Field } from "./flight";

/** How much of the flight the dots show while aiming, in seconds. */
export const AHEAD = 1;

/** The first `seconds` of the flight a launch would give, x and y one after the other, from the start; shorter if it ends sooner. */
export function ahead(field: Field, vx: number, vy: number, seconds = AHEAD): number[] {
    const comet = launch(field, vx, vy);
    const points = [comet.x, comet.y];
    const steps = Math.round(seconds / STEP);
    while (!comet.ended && comet.step < steps) {
        advance(field, comet);
        points.push(comet.x, comet.y);
    }
    return points;
}

/**
 * Places every `spacing` along a path, measured along it, the first one `spacing` from its start.
 * Each is x, y and how far along the whole path it is, from 0 to 1, one after the other. The comet
 * moves in a straight line within a step, so a place between two points is on its way.
 */
export function along(points: number[], spacing: number): number[] {
    const count = points.length / 2;
    let total = 0;
    for (let i = 1; i < count; i++) total += Math.hypot(points[i * 2]! - points[i * 2 - 2]!, points[i * 2 + 1]! - points[i * 2 - 1]!);
    const placed: number[] = [];
    if (total <= 0 || spacing <= 0) return placed;
    let next = spacing;
    let gone = 0;
    for (let i = 1; i < count; i++) {
        const [x0, y0, x1, y1] = [points[i * 2 - 2]!, points[i * 2 - 1]!, points[i * 2]!, points[i * 2 + 1]!];
        const long = Math.hypot(x1 - x0, y1 - y0);
        while (long > 0 && next <= gone + long) {
            const t = (next - gone) / long;
            placed.push(x0 + (x1 - x0) * t, y0 + (y1 - y0) * t, next / total);
            next += spacing;
        }
        gone += long;
    }
    return placed;
}

/** A color in OKLCH: lightness from 0 to 1, chroma, and hue in degrees. */
export interface Tint {
    l: number;
    c: number;
    h: number;
}

/**
 * The colors planets are made in: stone, sand and gas, each soft and with its own lightness, and none
 * near the violet of the hole's ring. Evenly spread hues would give a chart's red, green and blue.
 */
const STONES: readonly Tint[] = [
    { l: 0.66, c: 0.11, h: 40 }, // terracotta
    { l: 0.75, c: 0.1, h: 75 }, // ochre
    { l: 0.79, c: 0.045, h: 88 }, // sand
    { l: 0.7, c: 0.065, h: 145 }, // sage
    { l: 0.68, c: 0.085, h: 192 }, // teal
    { l: 0.8, c: 0.04, h: 222 }, // ice
    { l: 0.65, c: 0.09, h: 248 }, // slate blue
    { l: 0.68, c: 0.09, h: 355 }, // rose
];

/** How far apart two hues are round the circle, in degrees. */
const between = (a: number, b: number) => {
    const apart = Math.abs(a - b) % 360;
    return Math.min(apart, 360 - apart);
};

/**
 * A color for each planet of a field, from its seed and level only: taken from `STONES` in an order
 * the seed shuffles, passing over any too near in hue to one already taken, so no two planets of a
 * field look alike; then each nudged a little, so that a color is never quite the same twice.
 */
export function tints(seed: string, level: number, count: number): Tint[] {
    const random = numbers(hash(`${seed}:${level}:tint`));
    const order = [...STONES];
    for (let i = order.length - 1; i > 0; i--) {
        const j = Math.floor(random() * (i + 1));
        [order[i], order[j]] = [order[j]!, order[i]!];
    }
    const taken: Tint[] = [];
    for (const stone of order) if (taken.length < count && taken.every((other) => between(other.h, stone.h) >= 35)) taken.push(stone);
    // more planets than colors far enough apart: the rest in the order shuffled
    for (const stone of order) if (taken.length < count && !taken.includes(stone)) taken.push(stone);
    return taken.slice(0, count).map((stone) => ({
        l: stone.l + (random() - 0.5) * 0.06,
        c: stone.c * (0.85 + random() * 0.3),
        h: Math.round((((stone.h + (random() - 0.5) * 12) % 360) + 360) % 360 * 10) / 10,
    }));
}

/** A tint as a canvas color, a little lighter or darker, with an opacity. */
export function css(tint: Tint, lighter = 0, alpha = 1): string {
    const l = Math.min(0.98, Math.max(0.05, tint.l + lighter));
    return `oklch(${l.toFixed(3)} ${tint.c.toFixed(3)} ${tint.h.toFixed(1)} / ${alpha.toFixed(3)})`;
}

/** A star: where it is, as a part of the sky's width and height; how bright, from 0 to 1; and how near, from 0 to 1, which is how far it drifts. */
export interface Star {
    x: number;
    y: number;
    bright: number;
    near: number;
}

/** The stars of a sky: faint and still, a few of them brighter and nearer. From the seed alone. */
export function stars(seed: string, count: number): Star[] {
    const random = numbers(hash(`${seed}:stars`));
    return Array.from({ length: count }, () => {
        const [x, y, chance] = [random(), random(), random()];
        const brighter = chance > 0.94;
        return { x, y, bright: brighter ? 0.55 + random() * 0.45 : 0.12 + random() * 0.3, near: brighter ? 0.6 + random() * 0.4 : random() * 0.5 };
    });
}

/**
 * Which way the comet's tail streams at (x, y): away from the planets, each counted by its size over
 * its distance squared, so the nearest has the most say and the tail turns smoothly from one to the
 * next. Gives the direction and how near the planets are, from 0 to 1, which the tail's length
 * follows. With no planet near enough to count, the tail lies along `otherwise`.
 */
export function tailward(field: Field, x: number, y: number, otherwise: readonly [number, number]): [number, number, number] {
    let [sx, sy] = [0, 0];
    for (const planet of field.planets) {
        const [dx, dy] = [x - planet.x, y - planet.y];
        const near = dx * dx + dy * dy;
        if (near <= 0) continue;
        const by = (planet.r * planet.r) / (near * Math.sqrt(near));
        sx += dx * by;
        sy += dy * by;
    }
    const felt = Math.hypot(sx, sy);
    if (felt < 1e-6) {
        const long = Math.hypot(otherwise[0], otherwise[1]) || 1;
        return [otherwise[0] / long, otherwise[1] / long, 0];
    }
    return [sx / felt, sy / felt, Math.min(1, felt * 4)];
}
