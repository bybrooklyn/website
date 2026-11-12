// The chart's shapes, worked out with no page: the corners from the sliders, where each lands, the
// lines of the shape, where the corners' names go, and how the shape flows from one set of values
// to the next. The page draws them (src/scripts/spectrum.ts).
//
// The chart is centred on 0,0 with the outer ring at RADIUS. The first corner is straight up and
// the rest follow clockwise. A corner whose sliders are all unset is left out of the shape: the
// line breaks there and is never drawn through the middle.

import { axes, groups, HIGHEST, type Values } from "./axes";

export const RADIUS = 100;
/** The rings drawn behind the shape, at these values: the least, the middle, the most. */
export const RINGS = [1, 5, 9];

export interface Point {
    x: number;
    y: number;
}

/** Each corner's value, the mean of its sliders that are set, or 0 when none is. Not rounded. */
export function corners(values: Values): number[] {
    return groups.map(({ members }) => {
        const set = members.map((axis) => values[axes.indexOf(axis)] ?? 0).filter((value) => value >= 1 && value <= HIGHEST);
        return set.length === 0 ? 0 : set.reduce((sum, value) => sum + value, 0) / set.length;
    });
}

/** Where a value lands on corner `index` of `count`: 0 in the middle, 9 on the outer ring. */
export function place(value: number, index: number, count = groups.length, radius = RADIUS): Point {
    const angle = -Math.PI / 2 + (index * 2 * Math.PI) / count;
    const distance = (radius * Math.min(Math.max(value, 0), HIGHEST)) / HIGHEST;
    return { x: distance * Math.cos(angle), y: distance * Math.sin(angle) };
}

const short = (number: number) => String(Math.round(number * 10) / 10);
const at = (point: Point) => `${short(point.x)},${short(point.y)}`;

/** A ring as the points of an SVG polygon. */
export const ring = (value: number, count = groups.length): string => Array.from({ length: count }, (_, index) => at(place(value, index, count))).join(" ");

/**
 * The shape for these corner values, as SVG path data, and whether it is whole. Whole, every corner
 * is set and the shape is closed and filled. Otherwise each run of neighbouring set corners is its
 * own open line, and a corner on its own is no line at all (its dot still shows it).
 */
export function shape(values: number[]): { d: string; whole: boolean } {
    const count = values.length;
    const set = values.map((value) => value > 0);
    if (set.every(Boolean)) return { d: `M${values.map((value, index) => at(place(value, index, count))).join("L")}Z`, whole: true };
    // Runs start just after an unset corner, and go round past the last corner to the first.
    const runs: number[][] = [];
    const first = set.indexOf(false);
    let run: number[] = [];
    for (let step = 1; step <= count; step++) {
        const index = (first + step) % count;
        if (set[index]) run.push(index);
        else if (run.length > 0) (runs.push(run), (run = []));
    }
    if (run.length > 0) runs.push(run);
    const d = runs
        .filter((indexes) => indexes.length > 1)
        .map((indexes) => `M${indexes.map((index) => at(place(values[index]!, index, count))).join("L")}`)
        .join("");
    return { d, whole: false };
}

/** Where a corner's name goes, a little outside the outer ring, and which way its text runs from there. */
export function label(index: number, count = groups.length, radius = RADIUS): Point & { anchor: "start" | "middle" | "end"; baseline: "auto" | "middle" | "hanging" } {
    const out = place(HIGHEST, index, count, radius * 1.14);
    const across = out.x / radius;
    const down = out.y / radius;
    const anchor = Math.abs(across) < 0.2 ? "middle" : across > 0 ? "start" : "end";
    const baseline = down < -0.6 ? "auto" : down > 0.6 ? "hanging" : "middle";
    return { ...out, anchor, baseline };
}

/**
 * The corner values part of the way from `from` to `to`, with `progress` already eased. An unset
 * corner counts as 0, so a corner coming or going grows out of the middle or shrinks into it, and
 * it is unset partway only if it is unset at both ends.
 */
export function between(from: number[], to: number[], progress: number): number[] {
    if (progress >= 1) return [...to];
    return to.map((end, index) => {
        const begin = from[index] ?? 0;
        if (begin === 0 && end === 0) return 0;
        // kept a hair above 0 while moving, so the corner stays part of the shape until it arrives
        return Math.max(begin + (end - begin) * Math.max(progress, 0), 0.001);
    });
}

/**
 * The site's own easing, `--ease` in tokens.css: cubic-bezier(0.22, 1, 0.36, 1), quick to start and
 * slow to settle. Given how far along in time, gives how far along in distance.
 */
export function settle(time: number, [x1, y1, x2, y2] = [0.22, 1, 0.36, 1]): number {
    if (time <= 0) return 0;
    if (time >= 1) return 1;
    const curve = (a: number, b: number, s: number) => 3 * a * s * (1 - s) ** 2 + 3 * b * s * s * (1 - s) + s ** 3;
    // the curve's own parameter for this time, found by halving: x rises steadily along it
    let low = 0;
    let high = 1;
    for (let step = 0; step < 30; step++) {
        const middle = (low + high) / 2;
        if (curve(x1, x2, middle) < time) low = middle;
        else high = middle;
    }
    return curve(y1, y2, (low + high) / 2);
}

/** A corner's value as shown: one decimal at most, and whole numbers plain. */
export const shown = (value: number): string => short(value);
