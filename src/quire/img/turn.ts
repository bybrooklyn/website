// The horizon: the arithmetic of a picture turned to level it. The picture is turned about its middle
// by a small angle (at most 15 degrees either way, clockwise counted positive, as it looks on the
// screen); a place in the original's pixels has a place on the turned, level picture
// (`toLevel`, `fromLevel`), and the crop is a rectangle upright on the level picture. With no crop of
// her own, the picture is cut to the largest upright rectangle inside the turned one (`largestInside`,
// the closed form of the largest rectangle in a turned one); a crop of her own keeps its middle and
// shape and is made smaller until it fits (`fitInside`); a crop's frame dragged stops where it would
// leave the picture (`keepInside`). A line drawn along the horizon gives the turn that makes it level,
// or plumb when it is nearer upright (`levelling`).
//
//   const turn = turnOf(4, { width: 4000, height: 3000 });
//   const crop = largestInside(turn);              upright, inside, in the level picture's pixels

import type { Point, Rect } from "./steps";

/** The most a picture is turned, in degrees, either way. */
export const MOST_TURN = 15;

/** A turn: its angle in degrees, its cosine and sine, and the original's size, about whose middle it turns. */
export interface Turn {
    degrees: number;
    cos: number;
    sin: number;
    width: number;
    height: number;
}

/** A turn of some degrees (kept within the most either way) for an original of a size. */
export function turnOf(degrees: number, size: { width: number; height: number }): Turn {
    const kept = Math.max(-MOST_TURN, Math.min(MOST_TURN, degrees || 0));
    const radians = (kept * Math.PI) / 180;
    return { degrees: kept, cos: Math.cos(radians), sin: Math.sin(radians), width: size.width, height: size.height };
}

/** Where a place in the original's pixels falls on the turned picture. */
export function toLevel(point: Point, turn: Turn): Point {
    if (!turn.degrees) return point;
    const dx = point.x - turn.width / 2;
    const dy = point.y - turn.height / 2;
    return { x: turn.cos * dx - turn.sin * dy + turn.width / 2, y: turn.sin * dx + turn.cos * dy + turn.height / 2 };
}

/** Where a place on the turned picture is in the original's pixels. */
export function fromLevel(point: Point, turn: Turn): Point {
    if (!turn.degrees) return point;
    const dx = point.x - turn.width / 2;
    const dy = point.y - turn.height / 2;
    return { x: turn.cos * dx + turn.sin * dy + turn.width / 2, y: -turn.sin * dx + turn.cos * dy + turn.height / 2 };
}

/** The four corners of a rectangle turned by some degrees about its middle (none: upright), in order round it from its top left. */
export function cornersOf(rect: Rect, degrees = 0): Point[] {
    const middle = { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
    const radians = (degrees * Math.PI) / 180;
    const cos = Math.cos(radians);
    const sin = Math.sin(radians);
    return [
        [-1, -1],
        [1, -1],
        [1, 1],
        [-1, 1],
    ].map(([a, b]) => {
        const x = (a! * rect.width) / 2;
        const y = (b! * rect.height) / 2;
        return { x: middle.x + cos * x - sin * y, y: middle.y + sin * x + cos * y };
    });
}

/** The upright box round the turned picture, on the level picture: where the whole of it is seen while cropping. */
export function levelBox(turn: Turn): Rect {
    const points = cornersOf({ x: 0, y: 0, width: turn.width, height: turn.height }).map((point) => toLevel(point, turn));
    const left = Math.min(...points.map((point) => point.x));
    const top = Math.min(...points.map((point) => point.y));
    return { x: left, y: top, width: Math.max(...points.map((point) => point.x)) - left, height: Math.max(...points.map((point) => point.y)) - top };
}

const EDGE = 1e-6;

/** True when a place on the level picture lies on the turned picture. */
export function onPicture(point: Point, turn: Turn): boolean {
    const back = fromLevel(point, turn);
    return back.x >= -EDGE && back.y >= -EDGE && back.x <= turn.width + EDGE && back.y <= turn.height + EDGE;
}

/** True when the whole of an upright rectangle on the level picture lies on the turned picture. */
export const inside = (rect: Rect, turn: Turn): boolean => cornersOf(rect).every((corner) => onPicture(corner, turn));

/** A rectangle made whole pixels by moving each edge inward, so that it never grows past where it was. */
function inward(rect: Rect): Rect {
    const left = Math.ceil(rect.x - EDGE);
    const top = Math.ceil(rect.y - EDGE);
    const right = Math.floor(rect.x + rect.width + EDGE);
    const bottom = Math.floor(rect.y + rect.height + EDGE);
    return { x: left, y: top, width: Math.max(1, right - left), height: Math.max(1, bottom - top) };
}

/**
 * The size of the largest upright rectangle inside a rectangle of a size turned by an angle: when the
 * shorter side is short enough against the longer (or the turn is 45 degrees) it touches two corners
 * and its half-shorter side sets it; otherwise it touches all four sides, and the two sides solve
 * `w cos + h sin = width`, `w sin + h cos = height`.
 */
export function largestSize(width: number, height: number, degrees: number): { width: number; height: number } {
    const radians = (Math.abs(degrees) * Math.PI) / 180;
    const sin = Math.sin(radians);
    const cos = Math.cos(radians);
    if (!sin) return { width, height };
    const wide = width >= height;
    const long = wide ? width : height;
    const short = wide ? height : width;
    if (short <= 2 * sin * cos * long || Math.abs(sin - cos) < 1e-10) {
        const half = short / 2;
        return wide ? { width: half / sin, height: half / cos } : { width: half / cos, height: half / sin };
    }
    const cos2 = cos * cos - sin * sin;
    return { width: (width * cos - height * sin) / cos2, height: (height * cos - width * sin) / cos2 };
}

/** The largest upright rectangle inside the turned picture, about its middle, in whole pixels of the level picture. */
export function largestInside(turn: Turn): Rect {
    if (!turn.degrees) return { x: 0, y: 0, width: turn.width, height: turn.height };
    const size = largestSize(turn.width, turn.height, turn.degrees);
    return inward({ x: (turn.width - size.width) / 2, y: (turn.height - size.height) / 2, ...size });
}

/** How far a rectangle may grow about its middle (a share of its size, at most 1) and stay on the turned picture: each corner's place in the original is a straight line in the share, held to the original's edges. */
function room(rect: Rect, turn: Turn): number {
    const middle = { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
    const centre = fromLevel(middle, turn);
    if (centre.x < 0 || centre.y < 0 || centre.x > turn.width || centre.y > turn.height) return 0;
    let most = 1;
    for (const [a, b] of [[-1, -1], [1, -1], [1, 1], [-1, 1]] as const) {
        // the corner's place in the original at the full size, less the middle's: how it moves as the share grows
        const corner = fromLevel({ x: middle.x + (a * rect.width) / 2, y: middle.y + (b * rect.height) / 2 }, turn);
        const along = { x: corner.x - centre.x, y: corner.y - centre.y };
        for (const [start, step, limit] of [[centre.x, along.x, turn.width], [centre.y, along.y, turn.height]] as const) {
            if (step > EDGE) most = Math.min(most, (limit - start) / step);
            else if (step < -EDGE) most = Math.min(most, -start / step);
        }
    }
    return Math.max(0, most);
}

/** A crop of her own on the turned picture: kept where it is if it lies on it, else made smaller about its middle, its shape kept, until it does; the largest inside if its middle is off the picture. */
export function fitInside(rect: Rect, turn: Turn): Rect {
    if (!turn.degrees || inside(rect, turn)) return rect;
    const share = room(rect, turn);
    if (share <= 0) return largestInside(turn);
    const width = rect.width * share;
    const height = rect.height * share;
    return inward({ x: rect.x + (rect.width - width) / 2, y: rect.y + (rect.height - height) / 2, width, height });
}

/** A crop's frame dragged from `start` toward `wanted`: as far along the way as it stays on the turned picture (found by halving the way twenty times). */
export function keepInside(start: Rect, wanted: Rect, turn: Turn): Rect {
    if (!turn.degrees || inside(wanted, turn)) return wanted;
    if (!inside(start, turn)) return fitInside(wanted, turn);
    let low = 0;
    let high = 1;
    const at = (share: number): Rect => ({ x: start.x + (wanted.x - start.x) * share, y: start.y + (wanted.y - start.y) * share, width: start.width + (wanted.width - start.width) * share, height: start.height + (wanted.height - start.height) * share });
    for (let step = 0; step < 20; step++) {
        const middle = (low + high) / 2;
        if (inside(at(middle), turn)) low = middle;
        else high = middle;
    }
    return inward(at(low));
}

/**
 * The turn that makes a line drawn on the picture level: the line's slope on the screen taken off the
 * turn it was drawn at, or, for a line nearer upright than flat, the turn that makes it plumb; kept
 * within the most either way, in tenths of a degree.
 */
export function levelling(from: Point, to: Point, now: number): number {
    let slope = (Math.atan2(to.y - from.y, to.x - from.x) * 180) / Math.PI;
    // the line's direction does not matter: a slope is folded into -90 to 90, then nearer upright measured from upright
    if (slope > 90) slope -= 180;
    if (slope < -90) slope += 180;
    if (slope > 45) slope -= 90;
    if (slope < -45) slope += 90;
    const wanted = now - slope;
    return Math.round(Math.max(-MOST_TURN, Math.min(MOST_TURN, wanted)) * 10) / 10;
}
