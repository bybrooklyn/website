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
// A picture whose perspective is set (perspective.ts) is straightened by a plane-to-plane map before it is
// turned, and the two are kept as one map each way (`matrix`, `back`). Then the straightened picture is a
// four-sided shape with no right angles, and the largest upright rectangle inside it is searched for
// (`largestInQuad`) where a turn alone has a closed form; everything else here reads the same.
//
//   const turn = turnOf(4, { width: 4000, height: 3000 });
//   const crop = largestInside(turn);              upright, inside, in the level picture's pixels

import type { Point, Rect } from "./steps";
import { apply, depth, invert, multiply, type Matrix } from "./homography";

/** The most a picture is turned, in degrees, either way. */
export const MOST_TURN = 15;

/** A turn: its angle in degrees, its cosine and sine, and the original's size, about whose middle it turns; with a perspective, the whole map from the original to the level picture (`matrix`) and back. */
export interface Turn {
    degrees: number;
    cos: number;
    sin: number;
    width: number;
    height: number;
    matrix?: Matrix;
    back?: Matrix;
}

/** A turn of some degrees (kept within the most either way) for an original of a size, after a perspective's map if there is one. */
export function turnOf(degrees: number, size: { width: number; height: number }, perspective?: Matrix): Turn {
    const kept = Math.max(-MOST_TURN, Math.min(MOST_TURN, degrees || 0));
    const radians = (kept * Math.PI) / 180;
    const turn: Turn = { degrees: kept, cos: Math.cos(radians), sin: Math.sin(radians), width: size.width, height: size.height };
    if (!perspective) return turn;
    const cx = size.width / 2;
    const cy = size.height / 2;
    const turning: Matrix = [turn.cos, -turn.sin, cx - turn.cos * cx + turn.sin * cy, turn.sin, turn.cos, cy - turn.sin * cx - turn.cos * cy, 0, 0, 1];
    const matrix = multiply(turning, perspective);
    let back = invert(matrix);
    if (!back) return turn;
    // the way back's fraction made positive where the picture is, so that a place past where the plane can be seen is known by its sign
    if (depth(back, apply(matrix, { x: cx, y: cy })) < 0) back = back.map((value) => -value) as Matrix;
    return { ...turn, matrix, back };
}

/** True when a turn changes anything: turned, or straightened by a perspective. */
export const bent = (turn: Turn): boolean => !!turn.degrees || !!turn.matrix;

/** The whole map from the level picture back to the original's pixels, as nine numbers. */
export function backMatrix(turn: Turn): Matrix {
    if (turn.back) return turn.back;
    const cx = turn.width / 2;
    const cy = turn.height / 2;
    return [turn.cos, turn.sin, cx - turn.cos * cx - turn.sin * cy, -turn.sin, turn.cos, cy + turn.sin * cx - turn.cos * cy, 0, 0, 1];
}

/** Where a place in the original's pixels falls on the turned picture. */
export function toLevel(point: Point, turn: Turn): Point {
    if (turn.matrix) return apply(turn.matrix, point);
    if (!turn.degrees) return point;
    const dx = point.x - turn.width / 2;
    const dy = point.y - turn.height / 2;
    return { x: turn.cos * dx - turn.sin * dy + turn.width / 2, y: turn.sin * dx + turn.cos * dy + turn.height / 2 };
}

/** Where a place on the turned picture is in the original's pixels. */
export function fromLevel(point: Point, turn: Turn): Point {
    if (turn.back) return apply(turn.back, point);
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
    if (turn.back && depth(turn.back, point) <= 0) return false;
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

const searchedInside = new Map<string, Rect>();

/** The largest upright rectangle inside the turned picture, about its middle, in whole pixels of the level picture. */
export function largestInside(turn: Turn): Rect {
    if (turn.matrix) {
        // searched once for each map, since the picture is drawn many times a second
        const key = `${turn.width},${turn.height},${turn.matrix.join(",")}`;
        const kept = searchedInside.get(key);
        if (kept) return { ...kept };
        const found = largestInQuad(cornersOf({ x: 0, y: 0, width: turn.width, height: turn.height }).map((point) => toLevel(point, turn)));
        // shrunk by a hair before it is made whole pixels, so that rounding never leaves it touching past the edge
        const made = inward({ x: found.x + 1e-4, y: found.y + 1e-4, width: found.width - 2e-4, height: found.height - 2e-4 });
        if (searchedInside.size > 64) searchedInside.clear();
        searchedInside.set(key, made);
        return { ...made };
    }
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

/** How far a rectangle may grow about its middle (a share of its size, at most 1) and stay on a straightened picture, found by halving: the picture is convex, so the shares that fit run from nothing to one most. */
function shareInside(rect: Rect, turn: Turn): number {
    const middle = { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
    if (!onPicture(middle, turn)) return 0;
    const at = (share: number): Rect => ({ x: middle.x - (rect.width * share) / 2, y: middle.y - (rect.height * share) / 2, width: rect.width * share, height: rect.height * share });
    let low = 0;
    let high = 1;
    for (let step = 0; step < 30; step++) {
        const share = (low + high) / 2;
        if (inside(at(share), turn)) low = share;
        else high = share;
    }
    return low;
}

/**
 * The largest upright rectangle inside a convex four-sided shape (the corners in order round it). Across
 * any stretch from x0 to x1 the shape's top edge is highest at one of the two ends and its bottom lowest
 * at one of them (the top is convex, the bottom concave), so the tallest rectangle over the stretch is
 * read from the two ends alone; the best stretch is searched on a grid of 200 by 200, then each end on a
 * finer grid about the best, five times.
 */
export function largestInQuad(quad: Point[]): Rect {
    const xs = quad.map((point) => point.x);
    const left = Math.min(...xs);
    const right = Math.max(...xs);
    // where an upright line at x crosses the shape: its top and bottom
    const span = (x: number): [number, number] => {
        let top = Infinity;
        let bottom = -Infinity;
        for (let at = 0; at < quad.length; at++) {
            const a = quad[at]!;
            const b = quad[(at + 1) % quad.length]!;
            const low = Math.min(a.x, b.x);
            const high = Math.max(a.x, b.x);
            if (x < low - 1e-9 || x > high + 1e-9) continue;
            const y = high - low < 1e-12 ? [a.y, b.y] : [a.y + ((b.y - a.y) * (x - a.x)) / (b.x - a.x)];
            for (const each of y) {
                top = Math.min(top, each);
                bottom = Math.max(bottom, each);
            }
        }
        return [top, bottom];
    };
    const tall = (x0: number, x1: number): [number, number] => {
        const [t0, b0] = span(x0);
        const [t1, b1] = span(x1);
        return [Math.max(t0, t1), Math.min(b0, b1)];
    };
    let best = { x0: left, x1: left, area: 0 };
    const tryAt = (x0: number, x1: number) => {
        if (x1 <= x0 || x0 < left || x1 > right) return;
        const [top, bottom] = tall(x0, x1);
        const area = (x1 - x0) * (bottom - top);
        if (area > best.area) best = { x0, x1, area };
    };
    const steps = 200;
    for (let i = 0; i <= steps; i++) for (let j = i + 1; j <= steps; j++) tryAt(left + ((right - left) * i) / steps, left + ((right - left) * j) / steps);
    // then each end moved on its own finer grid about the best, the grid a fifteenth as wide each time
    let reach = (right - left) / steps;
    for (let round = 0; round < 5; round++) {
        const { x0, x1 } = best;
        for (let i = -30; i <= 30; i++) for (let j = -30; j <= 30; j++) tryAt(x0 + (reach * i) / 30, x1 + (reach * j) / 30);
        reach /= 15;
    }
    const [top, bottom] = tall(best.x0, best.x1);
    return { x: best.x0, y: top, width: best.x1 - best.x0, height: Math.max(0, bottom - top) };
}

/** A crop of her own on the turned picture: kept where it is if it lies on it, else made smaller about its middle, its shape kept, until it does; the largest inside if its middle is off the picture. */
export function fitInside(rect: Rect, turn: Turn): Rect {
    if (!bent(turn) || inside(rect, turn)) return rect;
    const share = turn.matrix ? shareInside(rect, turn) : room(rect, turn);
    if (share <= 0) return largestInside(turn);
    const width = rect.width * share;
    const height = rect.height * share;
    return inward({ x: rect.x + (rect.width - width) / 2, y: rect.y + (rect.height - height) / 2, width, height });
}

/** A crop's frame dragged from `start` toward `wanted`: as far along the way as it stays on the turned picture (found by halving the way twenty times). */
export function keepInside(start: Rect, wanted: Rect, turn: Turn): Rect {
    if (!bent(turn) || inside(wanted, turn)) return wanted;
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
