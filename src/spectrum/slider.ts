// How a Spectrum slider moves, worked out with no page: where along the track each of the
// seventeen positions is, which position is nearest a point on it, where a pointer is along it
// (mirrored when the page runs right to left), and where each key takes it.
// src/scripts/spectrum.ts moves the thumb with these.

import { CURVE } from "../scripts/opening";
import { HIGHEST, LOWEST } from "./axes";

const STEPS = HIGHEST - LOWEST;
/** How far Page Up and Page Down move. */
export const PAGE = 4;

/** How far along the track a position is, from 0 at the start to 1 at the end. */
export const along = (value: number): number => (Math.min(Math.max(value, LOWEST), HIGHEST) - LOWEST) / STEPS;

/** The position nearest a place along the track. */
export const nearest = (place: number): number => LOWEST + Math.round(Math.min(Math.max(place, 0), 1) * STEPS);

/** How far along the track a pointer at `x` is, for a track from `left` and `width` wide. */
export function pointed(x: number, left: number, width: number, rtl = false): number {
    const place = width > 0 ? Math.min(Math.max((x - left) / width, 0), 1) : 0;
    return rtl ? 1 - place : place;
}

/**
 * The site's own easing, `--ease` in tokens.css (CURVE in opening.ts), quick to start and slow to
 * settle. Given how far along in time, gives how far along in distance. The thumb glides with it to
 * the position it settles on.
 */
export function settle(time: number, [x1, y1, x2, y2] = CURVE): number {
    if (time <= 0) return 0;
    if (time >= 1) return 1;
    const curve = (a: number, b: number, s: number) => 3 * a * s * (1 - s) ** 2 + 3 * b * s * s * (1 - s) + s ** 3;
    // the curve's own parameter for this time, found by halving: its x rises steadily along it
    let low = 0;
    let high = 1;
    for (let step = 0; step < 30; step++) {
        const middle = (low + high) / 2;
        if (curve(x1, x2, middle) < time) low = middle;
        else high = middle;
    }
    return curve(y1, y2, (low + high) / 2);
}

/**
 * Where a key takes a slider from `value`, or undefined for a key that does not move it. The arrows
 * move one position, left and right as they look (so mirrored right to left), up and down as up
 * and down; Page Up and Page Down move four; Home and End go to the ends.
 */
export function keyed(value: number, key: string, rtl = false): number | undefined {
    const forward = rtl ? -1 : 1;
    const by: Record<string, number> = { ArrowRight: forward, ArrowLeft: -forward, ArrowUp: 1, ArrowDown: -1, PageUp: PAGE, PageDown: -PAGE };
    if (key === "Home") return LOWEST;
    if (key === "End") return HIGHEST;
    if (!(key in by)) return undefined;
    return Math.min(Math.max(value + by[key]!, LOWEST), HIGHEST);
}
