// Perspective as a step: what the document keeps and the map it makes. A perspective step holds the two
// keystone dials (the camera tilted up or down, `vertical`, and turned left or right, `horizontal`, in
// degrees) and, when four corners were set by hand, the corners of something that should be a rectangle
// (in the original's pixels, round it from the top left) and that rectangle's width over its height. The
// corners' map takes them to that rectangle, the same size as they are and about the same middle; the
// dials' map is the camera's turn about the picture's middle, laid back so that the middle stays where it
// is (homography.ts). The two are done in that order, and the horizon's turn after them (turn.ts).
//
// A map that would throw part of the picture past where the plane can be seen (behind the camera), or
// spread it over more than three times its longer side, is no map: the step then draws as none, and the
// tools that make one refuse it before it is made.
//
//   const map = perspectiveMap({ vertical: 6 }, { width: 4000, height: 3000 });

import { apply, convex, depth, keepMiddle, multiply, normal, quadToQuad, tilted, type Matrix } from "./homography";
import type { Point, Rect } from "./steps";

/** Four places round a shape from its top left, in the original's pixels. */
export type Corners = [Point, Point, Point, Point];

/** What a perspective step holds: the dials, and the corners set by hand with their rectangle's proportions. */
export interface Perspective {
    vertical?: number;
    horizontal?: number;
    corners?: Corners;
    ratio?: number;
}

/** The most either keystone dial turns the camera, in degrees, either way. */
export const MOST_KEYSTONE = 30;

/** How far past the picture a straightened picture may spread, as a share of its longer side each way. */
const MOST_SPREAD = 3;

/** The area inside four places, by the shoelace sum. */
export function areaOf(corners: Point[]): number {
    let sum = 0;
    for (let at = 0; at < corners.length; at++) {
        const a = corners[at]!;
        const b = corners[(at + 1) % corners.length]!;
        sum += a.x * b.y - b.x * a.y;
    }
    return Math.abs(sum) / 2;
}

/** The rectangle corners set by hand become, before the dials: as wide over high as their ratio, with their area, about their average place. */
export function rectangleOf(corners: Corners, ratio: number): Rect {
    const area = areaOf(corners);
    const width = Math.sqrt(area * ratio);
    const height = Math.sqrt(area / ratio);
    const x = corners.reduce((sum, point) => sum + point.x, 0) / 4;
    const y = corners.reduce((sum, point) => sum + point.y, 0) / 4;
    return { x: x - width / 2, y: y - height / 2, width, height };
}

/** The four corners of an upright rectangle, round it from its top left. */
export const rectCorners = (rect: Rect): Corners => [
    { x: rect.x, y: rect.y },
    { x: rect.x + rect.width, y: rect.y },
    { x: rect.x + rect.width, y: rect.y + rect.height },
    { x: rect.x, y: rect.y + rect.height },
];

/** True when a map keeps the whole of a picture of a size in front of the camera and spreads it no more than three times its longer side past it. */
export function seeable(map: Matrix, size: { width: number; height: number }): boolean {
    const corners = rectCorners({ x: 0, y: 0, ...size });
    if (!corners.every((corner) => depth(map, corner) > 1e-9)) return false;
    const placed = corners.map((corner) => apply(map, corner));
    if (!convex(placed)) return false;
    const reach = MOST_SPREAD * Math.max(size.width, size.height);
    return placed.every((point) => point.x > -reach && point.y > -reach && point.x < size.width + reach && point.y < size.height + reach);
}

/** The map a perspective step makes, from the original's pixels to the straightened picture's, before the horizon's turn: none when it changes nothing or cannot be seen whole. */
export function perspectiveMap(step: Perspective, size: { width: number; height: number }): Matrix | undefined {
    let map: Matrix | undefined;
    if (step.corners && step.ratio && convex(step.corners)) {
        const target = rectCorners(rectangleOf(step.corners, step.ratio));
        map = quadToQuad(step.corners, target);
        if (!map) return undefined;
    }
    const vertical = Math.max(-MOST_KEYSTONE, Math.min(MOST_KEYSTONE, step.vertical ?? 0));
    const horizontal = Math.max(-MOST_KEYSTONE, Math.min(MOST_KEYSTONE, step.horizontal ?? 0));
    if (vertical || horizontal) {
        const dials = keepMiddle(tilted(vertical, horizontal, size), size);
        map = map ? normal(multiply(dials, map)) : dials;
    }
    if (!map) return undefined;
    // the bottom of the fraction made positive in the picture's middle, which changes nothing the map does
    if (depth(map, { x: size.width / 2, y: size.height / 2 }) < 0) map = map.map((value) => -value) as Matrix;
    return seeable(map, size) ? map : undefined;
}
