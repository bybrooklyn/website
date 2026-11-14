// Where the picture is on the screen and how the crop's frame moves, as plain arithmetic: fitting the
// picture to the room it has, zooming about a point (the pointer, two fingers, or the middle), and
// dragging, nudging and holding the shape of the crop's frame. The stage (stage.ts) calls these with
// what the pointer and the keys did.

import type { View } from "./draw";
import type { Point, Rect } from "./steps";

/** The zooms a picture may be shown at, smallest and largest, in screen pixels per picture pixel. */
export const ZOOM = { least: 0.02, most: 32 };

/** The picture fitted to the room, centred, never larger than one to one unless it is tiny; `pad` keeps a margin round it. */
export function fit(size: { width: number; height: number }, room: { width: number; height: number }, pad = 24): View {
    const scale = Math.min(1, (room.width - pad * 2) / size.width, (room.height - pad * 2) / size.height);
    const shown = Math.max(ZOOM.least, scale);
    return { scale: shown, x: Math.round((room.width - size.width * shown) / 2), y: Math.round((room.height - size.height * shown) / 2) };
}

/** The view zoomed by a factor about a point on the screen, which stays over the same pixel of the picture. */
export function zoomAt(view: View, by: number, at: Point): View {
    const scale = Math.min(ZOOM.most, Math.max(ZOOM.least, view.scale * by));
    const kept = scale / view.scale;
    return { scale, x: at.x - (at.x - view.x) * kept, y: at.y - (at.y - view.y) * kept };
}

/** The view at one screen pixel to a picture pixel, about a point. */
export const oneToOne = (view: View, at: Point): View => zoomAt(view, 1 / view.scale, at);

/** A point on the screen as a point of the picture. */
export const toPicture = (view: View, at: Point): Point => ({ x: (at.x - view.x) / view.scale, y: (at.y - view.y) / view.scale });

/** The parts of the crop's frame that can be held: its four corners, its four sides, or the whole of it. */
export type Handle = "nw" | "n" | "ne" | "e" | "se" | "s" | "sw" | "w" | "move";

/** The handles in the order they are drawn, each with where it sits on the frame (0, a half or 1 of its width and height). */
export const HANDLES: [Handle, number, number][] = [
    ["nw", 0, 0],
    ["n", 0.5, 0],
    ["ne", 1, 0],
    ["e", 1, 0.5],
    ["se", 1, 1],
    ["s", 0.5, 1],
    ["sw", 0, 1],
    ["w", 0, 0.5],
];

/**
 * The crop's frame after a handle is dragged by an amount, in picture pixels: kept inside the picture,
 * at least a pixel each way, in whole pixels, and of the shape `aspect` (width over height) when one
 * is held. A corner dragged past the one opposite it turns the frame over rather than stopping.
 */
export function dragFrame(start: Rect, handle: Handle, by: Point, bounds: { width: number; height: number }, aspect?: number): Rect {
    if (handle === "move") {
        const x = Math.min(bounds.width - start.width, Math.max(0, Math.round(start.x + by.x)));
        const y = Math.min(bounds.height - start.height, Math.max(0, Math.round(start.y + by.y)));
        return { ...start, x, y };
    }
    let left = start.x;
    let top = start.y;
    let right = start.x + start.width;
    let bottom = start.y + start.height;
    if (handle.includes("w")) left += by.x;
    if (handle.includes("e")) right += by.x;
    if (handle.includes("n")) top += by.y;
    if (handle.includes("s")) bottom += by.y;
    [left, right] = [Math.min(left, right), Math.max(left, right)];
    [top, bottom] = [Math.min(top, bottom), Math.max(top, bottom)];
    left = Math.max(0, left);
    top = Math.max(0, top);
    right = Math.min(bounds.width, right);
    bottom = Math.min(bounds.height, bottom);
    let rect = { x: left, y: top, width: right - left, height: bottom - top };
    if (aspect) rect = holdShape(rect, handle, aspect, bounds);
    const x = Math.round(rect.x);
    const y = Math.round(rect.y);
    return { x, y, width: Math.max(1, Math.round(rect.x + rect.width) - x), height: Math.max(1, Math.round(rect.y + rect.height) - y) };
}

/** A frame brought to a shape, keeping the corner or side opposite the handle where it is, and inside the picture. */
function holdShape(rect: Rect, handle: Handle, aspect: number, bounds: { width: number; height: number }): Rect {
    const sideways = handle === "e" || handle === "w";
    const upright = handle === "n" || handle === "s";
    let width = rect.width;
    let height = rect.height;
    if (sideways) height = width / aspect;
    else if (upright) width = height * aspect;
    else if (width / height > aspect) height = width / aspect;
    else width = height * aspect;
    // the corner or side that stays put
    const anchorX = handle.includes("w") ? rect.x + rect.width : handle.includes("e") ? rect.x : rect.x + rect.width / 2;
    const anchorY = handle.includes("n") ? rect.y + rect.height : handle.includes("s") ? rect.y : rect.y + rect.height / 2;
    const room = {
        width: handle.includes("w") ? anchorX : handle.includes("e") ? bounds.width - anchorX : 2 * Math.min(anchorX, bounds.width - anchorX),
        height: handle.includes("n") ? anchorY : handle.includes("s") ? bounds.height - anchorY : 2 * Math.min(anchorY, bounds.height - anchorY),
    };
    const shrink = Math.min(1, room.width / width, room.height / height);
    width *= shrink;
    height *= shrink;
    const x = handle.includes("w") ? anchorX - width : handle.includes("e") ? anchorX : anchorX - width / 2;
    const y = handle.includes("n") ? anchorY - height : handle.includes("s") ? anchorY : anchorY - height / 2;
    return { x, y, width, height };
}

/** The largest frame of a shape that fits the picture, centred on a frame it replaces. */
export function shapeFrame(around: Rect, aspect: number, bounds: { width: number; height: number }): Rect {
    let width = Math.min(bounds.width, around.width);
    let height = width / aspect;
    if (height > bounds.height || height > around.height) {
        height = Math.min(bounds.height, around.height);
        width = height * aspect;
    }
    const x = Math.min(bounds.width - width, Math.max(0, around.x + (around.width - width) / 2));
    const y = Math.min(bounds.height - height, Math.max(0, around.y + (around.height - height) / 2));
    return { x: Math.round(x), y: Math.round(y), width: Math.max(1, Math.round(width)), height: Math.max(1, Math.round(height)) };
}

/** A rectangle from two corners in either order. */
export const spanned = (from: Point, to: Point): Rect => ({ x: Math.min(from.x, to.x), y: Math.min(from.y, to.y), width: Math.abs(to.x - from.x), height: Math.abs(to.y - from.y) });
