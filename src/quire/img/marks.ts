// The marks drawn over a picture: an arrow, a box and a line of text, all in the original's pixels.
// They are drawn by the browser's 2D canvas, on the screen over the picture and into the result when
// it is flattened, so that both of the card's ways give the same marks. Which mark is under the
// pointer, and how far a mark reaches, are worked out here for choosing and moving one.

import type { Mark, Point, Rect } from "./steps";

/** Where the original's pixels fall on what is drawn: pixels per pixel each way, and where its corner falls. */
export interface Place {
    across: number;
    down: number;
    x: number;
    y: number;
}

/** The typeface marks' text is drawn in. */
export const FACE = "600 1px system-ui, sans-serif";

/** How long an arrow's head is, for a line of a thickness. */
export const headOf = (thickness: number): number => Math.max(10, thickness * 4.5);

/** Draws the marks, in order, onto a 2D canvas. */
export function drawMarks(context: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D, marks: Mark[], place: Place) {
    context.save();
    context.setTransform(place.across, 0, 0, place.down, place.x, place.y);
    context.lineCap = "round";
    context.lineJoin = "round";
    for (const mark of marks) {
        context.strokeStyle = context.fillStyle = mark.color;
        if (mark.type === "box") {
            context.lineWidth = mark.thickness;
            context.strokeRect(mark.rect.x, mark.rect.y, mark.rect.width, mark.rect.height);
        } else if (mark.type === "arrow") {
            const length = Math.hypot(mark.to.x - mark.from.x, mark.to.y - mark.from.y);
            if (length < 0.5) continue;
            const head = Math.min(headOf(mark.thickness), length);
            const along = { x: (mark.to.x - mark.from.x) / length, y: (mark.to.y - mark.from.y) / length };
            const base = { x: mark.to.x - along.x * head, y: mark.to.y - along.y * head };
            context.lineWidth = mark.thickness;
            context.beginPath();
            context.moveTo(mark.from.x, mark.from.y);
            context.lineTo(base.x + along.x * head * 0.3, base.y + along.y * head * 0.3);
            context.stroke();
            const side = head * 0.55;
            context.beginPath();
            context.moveTo(mark.to.x, mark.to.y);
            context.lineTo(base.x - along.y * side, base.y + along.x * side);
            context.lineTo(base.x + along.y * side, base.y - along.x * side);
            context.closePath();
            context.fill();
        } else {
            context.font = FACE.replace("1px", `${mark.size}px`);
            context.textBaseline = "top";
            context.fillText(mark.text, mark.at.x, mark.at.y);
        }
    }
    context.restore();
}

/** How far a mark reaches, in the original's pixels. A text's width is a close guess from its length, enough to pick it by. */
export function markBox(mark: Mark): Rect {
    if (mark.type === "box") {
        const half = mark.thickness / 2;
        return { x: Math.min(mark.rect.x, mark.rect.x + mark.rect.width) - half, y: Math.min(mark.rect.y, mark.rect.y + mark.rect.height) - half, width: Math.abs(mark.rect.width) + mark.thickness, height: Math.abs(mark.rect.height) + mark.thickness };
    }
    if (mark.type === "arrow") {
        const pad = headOf(mark.thickness) * 0.6;
        const x = Math.min(mark.from.x, mark.to.x) - pad;
        const y = Math.min(mark.from.y, mark.to.y) - pad;
        return { x, y, width: Math.abs(mark.to.x - mark.from.x) + 2 * pad, height: Math.abs(mark.to.y - mark.from.y) + 2 * pad };
    }
    return { x: mark.at.x, y: mark.at.y, width: Math.max(mark.size * 0.6, mark.text.length * mark.size * 0.56), height: mark.size * 1.2 };
}

/** The distance from a point to a line segment. */
function toSegment(point: Point, from: Point, to: Point): number {
    const dx = to.x - from.x;
    const dy = to.y - from.y;
    const length = dx * dx + dy * dy;
    const t = length ? Math.max(0, Math.min(1, ((point.x - from.x) * dx + (point.y - from.y) * dy) / length)) : 0;
    return Math.hypot(point.x - from.x - t * dx, point.y - from.y - t * dy);
}

/** The last drawn mark under a point (within `slack` pixels of the original), as its place in the list, or -1. A box is taken by its edge, not its middle, so what is inside it can still be reached. */
export function markAt(marks: Mark[], point: Point, slack: number): number {
    for (let at = marks.length - 1; at >= 0; at--) {
        const mark = marks[at]!;
        if (mark.type === "arrow" && toSegment(point, mark.from, mark.to) <= mark.thickness / 2 + slack) return at;
        if (mark.type === "box") {
            const { x, y, width, height } = markBox(mark);
            const corners = [{ x, y }, { x: x + width, y }, { x: x + width, y: y + height }, { x, y: y + height }];
            if (corners.some((corner, index) => toSegment(point, corner, corners[(index + 1) % 4]!) <= mark.thickness / 2 + slack)) return at;
        }
        if (mark.type === "text") {
            const box = markBox(mark);
            if (point.x >= box.x - slack && point.x <= box.x + box.width + slack && point.y >= box.y - slack && point.y <= box.y + box.height + slack) return at;
        }
    }
    return -1;
}

/** A mark moved by an amount, in the original's pixels. */
export function moved(mark: Mark, by: Point): Mark {
    if (mark.type === "arrow") return { ...mark, from: { x: mark.from.x + by.x, y: mark.from.y + by.y }, to: { x: mark.to.x + by.x, y: mark.to.y + by.y } };
    if (mark.type === "box") return { ...mark, rect: { ...mark.rect, x: mark.rect.x + by.x, y: mark.rect.y + by.y } };
    return { ...mark, at: { x: mark.at.x + by.x, y: mark.at.y + by.y } };
}
