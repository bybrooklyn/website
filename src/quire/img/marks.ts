// The marks drawn over a picture, all in the original's pixels: an arrow, a box, text with an outline and its
// lines aligned, a numbered step, a highlighter's stroke, a magnifier and a spotlight. They are drawn by the
// browser's 2D canvas, on the screen over the picture and into the result when it is flattened, by this one
// file, so that both of the card's ways give the same marks. Which mark is under the pointer, and how far a mark
// reaches, are worked out here for choosing and moving one.
//
// A highlighter's stroke multiplies what is under it (as ink on paper darkens and leaves the words readable), so
// on the screen it needs the picture under it on the same canvas; the stage copies it there first. A magnifier's
// lens shows the picture as it looks, which only the card can draw: it is handed in drawn (`Lenses`), the part of
// the level picture it shows given by `lensRegion`. The spotlights are drawn as one shade with every spotlight's
// shape cut out of it, at the place of the first, so that two shapes that overlap leave their overlap bright.
//
// On a picture whose perspective is set, the 2D canvas cannot draw through a plane-to-plane map, so a box's
// corners, a rectangle's, and an arrow's and a highlighter's ends are each put where the map puts them and drawn
// straight between (which is exact, since the map keeps straight lines straight), and the rest (text, a number,
// an ellipse, an arrow's head) are drawn by the map's nearest straight-line likeness at their place.

import type { Mark, Point, Rect } from "./steps";
import { apply, type Matrix } from "./homography";

type Context = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

/** Where the original's pixels fall on what is drawn: pixels per pixel each way, and where its corner falls, on the level picture; and, for a turned picture, its turn (degrees, clockwise) about the original's middle, made before the rest. */
export interface Place {
    across: number;
    down: number;
    x: number;
    y: number;
    turn?: { degrees: number; x: number; y: number };
    /** With a perspective, the whole map from the original's pixels to the level picture, the turn in it, in place of `turn`. */
    perspective?: Matrix;
}

/** The pictures the magnifiers' lenses show, by each magnifier's place in the list of marks: the square of the level picture `lensRegion` gives, drawn. */
export type Lenses = (index: number) => CanvasImageSource | undefined;

/** The nearest straight-line likeness of a map at a place, as a 2D canvas's six numbers, after the level picture's place. */
function likeness(map: Matrix, at: Point, place: Place): [number, number, number, number, number, number] {
    const w = map[6] * at.x + map[7] * at.y + map[8];
    const there = apply(map, at);
    const a = (map[0] - there.x * map[6]) / w;
    const b = (map[3] - there.y * map[6]) / w;
    const c = (map[1] - there.x * map[7]) / w;
    const d = (map[4] - there.y * map[7]) / w;
    const e = there.x - a * at.x - c * at.y;
    const f = there.y - b * at.x - d * at.y;
    return [a * place.across, b * place.down, c * place.across, d * place.down, e * place.across + place.x, f * place.down + place.y];
}

/** How much the map's likeness at a place enlarges, one way with another. */
function scaleAt(map: Matrix, at: Point, place: Place): number {
    const [a, b, c, d] = likeness(map, at, place);
    return Math.sqrt(Math.abs(a * d - b * c));
}

/** A place in the original's pixels on the level picture: turned with the picture, or put where its perspective's map puts it. */
export function levelOf(place: Place, point: Point): Point {
    if (place.perspective) return apply(place.perspective, point);
    if (place.turn?.degrees) return turnedAbout(point, place.turn, place.turn.degrees);
    return point;
}

/** A place in the original's pixels on what is drawn. */
export function canvasOf(place: Place, point: Point): Point {
    const level = levelOf(place, point);
    return { x: level.x * place.across + place.x, y: level.y * place.down + place.y };
}

/** Sets a canvas to draw in an item's own frame: its anchor at the origin, turned by its own angle, through the picture's place (by the map's likeness at the anchor, with a perspective). */
function frameAt(context: Context, place: Place, anchor: Point, angle = 0) {
    if (place.perspective) context.setTransform(...likeness(place.perspective, anchor, place));
    else placeOn(context, place);
    context.translate(anchor.x, anchor.y);
    if (angle) context.rotate((angle * Math.PI) / 180);
}

/** Draws an arrow or a box through a perspective's map: its lines between places put where the map puts them, its head by the map's likeness at the tip. */
function drawBent(context: Context, mark: Extract<Mark, { type: "arrow" | "box" }>, place: Place, map: Matrix) {
    const angle = mark.type === "arrow" ? 0 : (mark.angle ?? 0);
    const own = (point: Point): Point => (angle ? turnedAbout(point, pivotOf(mark), angle) : point);
    const onCanvas = (point: Point): Point => canvasOf(place, own(point));
    context.strokeStyle = context.fillStyle = mark.color;
    if (mark.type === "box") {
        const corners = cornersOfRect(mark.rect).map(onCanvas);
        context.setTransform(1, 0, 0, 1, 0, 0);
        context.lineWidth = mark.thickness * scaleAt(map, pivotOf(mark), place);
        context.beginPath();
        corners.forEach((corner, at) => (at ? context.lineTo(corner.x, corner.y) : context.moveTo(corner.x, corner.y)));
        context.closePath();
        context.stroke();
        return;
    }
    // the line between places put by the map; the head drawn by the likeness at the tip
    const length = Math.hypot(mark.to.x - mark.from.x, mark.to.y - mark.from.y);
    if (length < 0.5) return;
    const head = Math.min(headOf(mark.thickness), length);
    const along = { x: (mark.to.x - mark.from.x) / length, y: (mark.to.y - mark.from.y) / length };
    const base = { x: mark.to.x - along.x * head, y: mark.to.y - along.y * head };
    const from = onCanvas(mark.from);
    const stop = onCanvas({ x: base.x + along.x * head * 0.3, y: base.y + along.y * head * 0.3 });
    context.setTransform(1, 0, 0, 1, 0, 0);
    context.lineWidth = mark.thickness * scaleAt(map, mark.to, place);
    context.beginPath();
    context.moveTo(from.x, from.y);
    context.lineTo(stop.x, stop.y);
    context.stroke();
    context.setTransform(...likeness(map, mark.to, place));
    const side = head * 0.55;
    context.beginPath();
    context.moveTo(mark.to.x, mark.to.y);
    context.lineTo(base.x - along.y * side, base.y + along.x * side);
    context.lineTo(base.x + along.y * side, base.y - along.x * side);
    context.closePath();
    context.fill();
}

/** The four corners of a rectangle: top left, top right, bottom right, bottom left. */
const cornersOfRect = ({ x, y, width, height }: Rect): Point[] => [
    { x, y },
    { x: x + width, y },
    { x: x + width, y: y + height },
    { x, y: y + height },
];

/** A place turned by some degrees about a pivot. */
function turnedAbout(point: Point, pivot: Point, degrees: number): Point {
    const radians = (degrees * Math.PI) / 180;
    const dx = point.x - pivot.x;
    const dy = point.y - pivot.y;
    return { x: pivot.x + Math.cos(radians) * dx - Math.sin(radians) * dy, y: pivot.y + Math.sin(radians) * dx + Math.cos(radians) * dy };
}

/** An arrow drawn in the canvas's present frame: its line, stopped short of its tip, and its head. */
function drawArrow(context: Context, mark: Extract<Mark, { type: "arrow" }>) {
    const length = Math.hypot(mark.to.x - mark.from.x, mark.to.y - mark.from.y);
    if (length < 0.5) return;
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
}

/** Text drawn in its own frame: each line under the one before, aligned on the frame's origin, its outline first so that the letters lie over it. */
function drawText(context: Context, mark: Extract<Mark, { type: "text" }>) {
    context.font = fontOf(mark.size);
    context.textBaseline = "top";
    context.textAlign = mark.align ?? "left";
    const lines = mark.text.split("\n");
    const step = mark.size * LINE;
    if (mark.outline && mark.outlineWidth) {
        // a stroke lies half outside the letters, so it is drawn twice as wide as the outline is to show
        context.strokeStyle = mark.outline;
        context.lineWidth = mark.outlineWidth * 2;
        context.lineJoin = "round";
        lines.forEach((line, at) => context.strokeText(line, 0, at * step));
    }
    context.fillStyle = mark.color;
    lines.forEach((line, at) => context.fillText(line, 0, at * step));
}

/** A numbered step drawn in its own frame: the circle round the origin, and its number in the ink that reads on it. */
function drawNumber(context: Context, mark: Extract<Mark, { type: "number" }>) {
    const said = String(mark.value ?? 1);
    context.fillStyle = mark.color;
    context.beginPath();
    context.arc(0, 0, mark.size / 2, 0, Math.PI * 2);
    context.fill();
    // one or two figures at the same size; more are made smaller to stay inside the circle
    const size = mark.size * (said.length <= 2 ? 0.56 : 1.25 / said.length);
    context.font = `700 ${size}px system-ui, sans-serif`;
    context.textAlign = "center";
    context.textBaseline = "middle";
    context.fillStyle = inkOn(mark.color);
    context.fillText(said, 0, mark.size * 0.03);
}

/** Black or white, whichever reads on a color. */
export function inkOn(color: string): string {
    const channel = (at: number) => {
        const value = parseInt(color.slice(at, at + 2), 16) / 255;
        return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
    };
    const light = 0.2126 * channel(1) + 0.7152 * channel(3) + 0.0722 * channel(5);
    return light > 0.36 ? "#000000" : "#ffffff";
}

/** A highlighter's stroke: straight, square at its ends, multiplying what is under it. */
function drawHighlight(context: Context, mark: Extract<Mark, { type: "highlight" }>, place: Place) {
    context.globalCompositeOperation = "multiply";
    context.strokeStyle = mark.color;
    context.lineCap = "butt";
    context.beginPath();
    if (place.perspective) {
        const from = canvasOf(place, mark.from);
        const to = canvasOf(place, mark.to);
        context.setTransform(1, 0, 0, 1, 0, 0);
        context.lineWidth = mark.thickness * scaleAt(place.perspective, middleOf(mark.from, mark.to), place);
        context.moveTo(from.x, from.y);
        context.lineTo(to.x, to.y);
    } else {
        context.lineWidth = mark.thickness;
        context.moveTo(mark.from.x, mark.from.y);
        context.lineTo(mark.to.x, mark.to.y);
    }
    context.stroke();
}

const middleOf = (a: Point, b: Point): Point => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });

/**
 * The part of the level picture a magnifier's lens shows, and how many pixels across its picture is drawn at
 * where it is put: the square round the place it looks at, as wide as the lens over its enlargement, drawn as
 * many pixels across as the lens is on what is drawn (so sharply, from the original's own pixels).
 */
export function lensRegion(mark: Extract<Mark, { type: "magnifier" }>, place: Place): { crop: Rect; pixels: number } {
    const middle = levelOf(place, mark.from);
    const side = (2 * mark.radius) / mark.zoom;
    const pixels = Math.max(1, Math.min(4096, Math.round(2 * mark.radius * place.across)));
    return { crop: { x: middle.x - side / 2, y: middle.y - side / 2, width: side, height: side }, pixels };
}

/** A magnifier: a fine ring round the place it looks at and a line from there to the lens, then the lens, its picture inside a ring. */
function drawLens(context: Context, mark: Extract<Mark, { type: "magnifier" }>, place: Place, picture: CanvasImageSource | undefined) {
    const middle = canvasOf(place, mark.at);
    const radius = mark.radius * place.across;
    const source = canvasOf(place, mark.from);
    const near = radius / mark.zoom;
    const line = mark.thickness * place.across;
    context.setTransform(1, 0, 0, 1, 0, 0);
    context.strokeStyle = mark.color;
    context.lineWidth = line * 0.6;
    context.beginPath();
    context.arc(source.x, source.y, near, 0, Math.PI * 2);
    const apart = Math.hypot(middle.x - source.x, middle.y - source.y);
    if (apart > radius + near) {
        const along = { x: (middle.x - source.x) / apart, y: (middle.y - source.y) / apart };
        context.moveTo(source.x + along.x * near, source.y + along.y * near);
        context.lineTo(middle.x - along.x * radius, middle.y - along.y * radius);
    }
    context.stroke();
    context.save();
    context.beginPath();
    context.arc(middle.x, middle.y, radius, 0, Math.PI * 2);
    context.clip();
    // a quiet gray where the lens looks past the picture's edge, or until its picture is drawn
    context.fillStyle = "#7f7f7f";
    context.fillRect(middle.x - radius, middle.y - radius, radius * 2, radius * 2);
    if (picture) context.drawImage(picture, middle.x - radius, middle.y - radius, radius * 2, radius * 2);
    context.restore();
    context.lineWidth = line;
    context.beginPath();
    context.arc(middle.x, middle.y, radius, 0, Math.PI * 2);
    context.stroke();
}

/** The spotlights, as one shade over everything drawn so far with each spotlight's shape cut out of it, as dark as the first says. */
function drawSpotlights(context: Context, spots: Extract<Mark, { type: "spotlight" }>[], place: Place) {
    const { width, height } = context.canvas;
    const layer = new OffscreenCanvas(width, height);
    const shade = layer.getContext("2d")!;
    shade.fillStyle = `rgba(0, 0, 0, ${spots[0]!.dim})`;
    shade.fillRect(0, 0, width, height);
    shade.globalCompositeOperation = "destination-out";
    shade.fillStyle = "#000000";
    for (const spot of spots) {
        shade.save();
        shade.beginPath();
        const middle = pivotOf(spot);
        if (place.perspective && !spot.round) {
            // a rectangle's corners where the map puts them, drawn straight between
            const corners = cornersOfRect(spot.rect).map((corner) => canvasOf(place, spot.angle ? turnedAbout(corner, middle, spot.angle) : corner));
            corners.forEach((corner, at) => (at ? shade.lineTo(corner.x, corner.y) : shade.moveTo(corner.x, corner.y)));
            shade.closePath();
        } else {
            frameAt(shade, place, middle, spot.angle);
            const half = { x: Math.abs(spot.rect.width) / 2, y: Math.abs(spot.rect.height) / 2 };
            if (spot.round) shade.ellipse(0, 0, half.x, half.y, 0, 0, Math.PI * 2);
            else shade.rect(-half.x, -half.y, half.x * 2, half.y * 2);
        }
        shade.fill();
        shade.restore();
    }
    context.setTransform(1, 0, 0, 1, 0, 0);
    context.drawImage(layer, 0, 0);
}

/** Sets a 2D canvas to draw in the original's pixels: placed, then turned about the original's middle if the picture is (with a perspective, by the map's likeness at the original's middle, which is close enough for a tint or a stroke being painted). */
export function placeOn(context: Context, place: Place, middle?: Point) {
    if (place.perspective) return context.setTransform(...likeness(place.perspective, middle ?? { x: place.turn?.x ?? 0, y: place.turn?.y ?? 0 }, place));
    context.setTransform(place.across, 0, 0, place.down, place.x, place.y);
    if (!place.turn?.degrees) return;
    context.translate(place.turn.x, place.turn.y);
    context.rotate((place.turn.degrees * Math.PI) / 180);
    context.translate(-place.turn.x, -place.turn.y);
}

/** Where a mark or a cover turns about when it has a turn of its own, and where its ring is turned about: a box's, a cover's or a spotlight's middle, a text's or a number's place, a highlighter's middle, a lens's middle. */
export function pivotOf(item: Mark | { type: "cover"; rect: Rect }): Point {
    if (item.type === "text" || item.type === "number" || item.type === "magnifier") return item.at;
    if (item.type === "box" || item.type === "cover" || item.type === "spotlight") return { x: item.rect.x + item.rect.width / 2, y: item.rect.y + item.rect.height / 2 };
    if (item.type === "highlight") return middleOf(item.from, item.to);
    return item.from;
}

/** A point taken into an item's own upright frame, where the item has a turn of its own. */
function intoItem(item: Mark | { type: "cover"; rect: Rect; angle?: number }, point: Point): Point {
    const angle = "angle" in item ? item.angle : undefined;
    if (!angle) return point;
    return turnedAbout(point, pivotOf(item), -angle);
}

/** The typeface marks' text is drawn in. */
export const FACE = "600 1px system-ui, sans-serif";

/** The typeface at a size in pixels. */
const fontOf = (size: number) => FACE.replace("1px", `${size}px`);

/** How far apart a text's lines are, as a share of its size. */
export const LINE = 1.2;

/** How long an arrow's head is, for a line of a thickness. */
export const headOf = (thickness: number): number => Math.max(10, thickness * 4.5);

/** Draws the marks, in order, onto a 2D canvas; a magnifier's lens shows its picture from `lenses` if it has one yet. */
export function drawMarks(context: Context, marks: Mark[], place: Place, lenses?: Lenses) {
    context.save();
    placeOn(context, place);
    context.lineCap = "round";
    context.lineJoin = "round";
    const spots = marks.filter((mark): mark is Extract<Mark, { type: "spotlight" }> => mark.type === "spotlight");
    const firstSpot = marks.findIndex((mark) => mark.type === "spotlight");
    marks.forEach((mark, index) => {
        context.save();
        if (mark.type === "spotlight") {
            if (index === firstSpot) drawSpotlights(context, spots, place);
        } else if (mark.type === "magnifier") drawLens(context, mark, place, lenses?.(index));
        else if (mark.type === "highlight") drawHighlight(context, mark, place);
        else if (mark.type === "text") {
            frameAt(context, place, mark.at, mark.angle);
            drawText(context, mark);
        } else if (mark.type === "number") {
            frameAt(context, place, mark.at, mark.angle);
            drawNumber(context, mark);
        } else if (place.perspective) drawBent(context, mark, place, place.perspective);
        else {
            // a box made on a turned picture turns by its own angle about its middle
            const angle = mark.type === "box" ? (mark.angle ?? 0) : 0;
            if (angle) {
                const pivot = pivotOf(mark);
                context.translate(pivot.x, pivot.y);
                context.rotate((angle * Math.PI) / 180);
                context.translate(-pivot.x, -pivot.y);
            }
            context.strokeStyle = context.fillStyle = mark.color;
            if (mark.type === "box") {
                context.lineWidth = mark.thickness;
                context.strokeRect(mark.rect.x, mark.rect.y, mark.rect.width, mark.rect.height);
            } else drawArrow(context, mark);
        }
        context.restore();
    });
    context.restore();
}

// measuring text where the browser can; elsewhere (the tests run without a canvas) a close guess from its length
let measuring: OffscreenCanvasRenderingContext2D | null | undefined;
/** How wide a line of text is drawn at a size, at least a little so that a short one can be pressed. */
function lineWidth(line: string, size: number): number {
    if (measuring === undefined) measuring = typeof OffscreenCanvas === "undefined" ? null : new OffscreenCanvas(1, 1).getContext("2d");
    if (!measuring) return Math.max(size * 0.6, line.length * size * 0.56);
    measuring.font = fontOf(size);
    return Math.max(size * 0.6, measuring.measureText(line).width);
}

/** How wide a text's longest line is drawn. */
export const textWidth = (mark: Extract<Mark, { type: "text" }>): number => Math.max(...mark.text.split("\n").map((line) => lineWidth(line, mark.size)));

/** How far along its own line a text's lines start from its place, as a share of its width: none for left, half for the middle, all for right. */
export const alignShare = (align: "left" | "center" | "right" | undefined): number => (align === "center" ? 0.5 : align === "right" ? 1 : 0);

/** How far a mark reaches, in the original's pixels, in its own frame before its own turn. */
export function markBox(mark: Mark): Rect {
    if (mark.type === "box") {
        const half = mark.thickness / 2;
        return { x: Math.min(mark.rect.x, mark.rect.x + mark.rect.width) - half, y: Math.min(mark.rect.y, mark.rect.y + mark.rect.height) - half, width: Math.abs(mark.rect.width) + mark.thickness, height: Math.abs(mark.rect.height) + mark.thickness };
    }
    if (mark.type === "spotlight") return { x: Math.min(mark.rect.x, mark.rect.x + mark.rect.width), y: Math.min(mark.rect.y, mark.rect.y + mark.rect.height), width: Math.abs(mark.rect.width), height: Math.abs(mark.rect.height) };
    if (mark.type === "arrow" || mark.type === "highlight") {
        const pad = mark.type === "arrow" ? headOf(mark.thickness) * 0.6 : mark.thickness / 2;
        const x = Math.min(mark.from.x, mark.to.x) - pad;
        const y = Math.min(mark.from.y, mark.to.y) - pad;
        return { x, y, width: Math.abs(mark.to.x - mark.from.x) + 2 * pad, height: Math.abs(mark.to.y - mark.from.y) + 2 * pad };
    }
    if (mark.type === "number") return { x: mark.at.x - mark.size / 2, y: mark.at.y - mark.size / 2, width: mark.size, height: mark.size };
    if (mark.type === "magnifier") return { x: mark.at.x - mark.radius, y: mark.at.y - mark.radius, width: mark.radius * 2, height: mark.radius * 2 };
    const width = textWidth(mark);
    const grow = mark.outline ? (mark.outlineWidth ?? 0) : 0;
    return { x: mark.at.x - width * alignShare(mark.align) - grow, y: mark.at.y - grow, width: width + 2 * grow, height: mark.text.split("\n").length * mark.size * LINE + 2 * grow };
}

/** The ring drawn round a mark that is picked, lying exactly on it: a rectangle turned about a pivot, or a circle. A magnifier has two, its lens and the place it looks at. */
export type Ring = { rect: Rect; angle: number; pivot: Point } | { middle: Point; radius: number };

/** The rings round a mark that is picked, in the original's pixels. */
export function ringsOf(mark: Mark): Ring[] {
    if (mark.type === "number") return [{ middle: mark.at, radius: mark.size / 2 }];
    if (mark.type === "magnifier") return [{ middle: mark.at, radius: mark.radius }, { middle: mark.from, radius: mark.radius / mark.zoom }];
    if (mark.type === "highlight") {
        // a rectangle along the stroke, as long as it and as thick
        const middle = middleOf(mark.from, mark.to);
        const length = Math.hypot(mark.to.x - mark.from.x, mark.to.y - mark.from.y);
        const angle = (Math.atan2(mark.to.y - mark.from.y, mark.to.x - mark.from.x) * 180) / Math.PI;
        return [{ rect: { x: middle.x - length / 2, y: middle.y - mark.thickness / 2, width: length, height: mark.thickness }, angle, pivot: middle }];
    }
    const angle = mark.type === "arrow" ? 0 : (mark.angle ?? 0);
    return [{ rect: markBox(mark), angle, pivot: pivotOf(mark) }];
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
    return allAt(marks, point, slack)[0] ?? -1;
}

/** A cover, as picking sees it: taken anywhere inside, its own turn taken into account. */
type Cover = { type: "cover"; rect: Rect; angle?: number };

/** Which part of a magnifier is under a point: its lens, else the ring round the place it looks at, or neither. */
export function partOf(mark: Extract<Mark, { type: "magnifier" }>, point: Point, slack: number): "lens" | "source" | undefined {
    if (Math.hypot(point.x - mark.at.x, point.y - mark.at.y) <= mark.radius + slack) return "lens";
    if (Math.hypot(point.x - mark.from.x, point.y - mark.from.y) <= mark.radius / mark.zoom + slack) return "source";
    return undefined;
}

/** True when a point is on a mark (within `slack`), or inside a cover; a point is first taken into the frame of an item turned on its own. A box and a spotlight are taken by their edge, so that what is inside them can still be reached. */
export function touches(item: Mark | Cover, given: Point, slack: number): boolean {
    const point = intoItem(item, given);
    const inside = (box: Rect, pad: number) => point.x >= box.x - pad && point.x <= box.x + box.width + pad && point.y >= box.y - pad && point.y <= box.y + box.height + pad;
    if (item.type === "cover") return inside(item.rect, 0);
    if (item.type === "arrow" || item.type === "highlight") return toSegment(point, item.from, item.to) <= item.thickness / 2 + slack;
    if (item.type === "text") return inside(markBox(item), slack);
    if (item.type === "number") return Math.hypot(point.x - item.at.x, point.y - item.at.y) <= item.size / 2 + slack;
    if (item.type === "magnifier") return partOf(item, point, slack) !== undefined;
    if (item.type === "spotlight" && item.round) {
        // the ellipse's edge: how far out along its own radius the point is, as pixels at its narrower side
        const box = markBox(item);
        const half = { x: Math.max(0.5, box.width / 2), y: Math.max(0.5, box.height / 2) };
        const out = Math.hypot((point.x - box.x - half.x) / half.x, (point.y - box.y - half.y) / half.y);
        return Math.abs(out - 1) * Math.min(half.x, half.y) <= slack;
    }
    const { x, y, width, height } = markBox(item);
    const corners = [{ x, y }, { x: x + width, y }, { x: x + width, y: y + height }, { x, y: y + height }];
    const edge = item.type === "box" ? item.thickness / 2 : 0;
    return corners.some((corner, index) => toSegment(point, corner, corners[(index + 1) % 4]!) <= edge + slack);
}

/** Every mark or cover under a point, as places in the list, the last drawn (the one on top) first. */
export function allAt(items: (Mark | Cover)[], point: Point, slack: number): number[] {
    const found: number[] = [];
    for (let at = items.length - 1; at >= 0; at--) if (touches(items[at]!, point, slack)) found.push(at);
    return found;
}

/** A mark moved by an amount, in the original's pixels: a magnifier's lens alone, or the place it looks at alone, when `part` says which. */
export function moved(mark: Mark, by: Point, part?: "lens" | "source"): Mark {
    const shift = (point: Point): Point => ({ x: point.x + by.x, y: point.y + by.y });
    if (mark.type === "arrow" || mark.type === "highlight") return { ...mark, from: shift(mark.from), to: shift(mark.to) };
    if (mark.type === "box" || mark.type === "spotlight") return { ...mark, rect: { ...mark.rect, x: mark.rect.x + by.x, y: mark.rect.y + by.y } };
    if (mark.type === "magnifier") return { ...mark, ...(part !== "source" ? { at: shift(mark.at) } : {}), ...(part !== "lens" ? { from: shift(mark.from) } : {}) };
    return { ...mark, at: shift(mark.at) };
}
