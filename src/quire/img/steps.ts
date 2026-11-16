// The picture document, imgQuire's own: the original as it came, never changed, and a list of steps
// done to it, each a small plain record. Applying the steps in order gives the picture as it now
// looks (`look`): the part of the original kept, the size it is drawn at, the covers and the marks.
// Every place and size is in the original's pixels, so that a mark or a cover stays where it was put
// when an earlier crop is changed. The `.quire` keeps the steps as steps.json (`writeSteps`), read
// back by `readSteps`, which takes nothing on trust: a damaged or hostile file gives what can be
// read of it and never more work than a few thousand small steps.
//
//   const picture = readSteps(text) ?? fresh({ name: "pictures/cat.png", width, height, type, bytes });
//   const shown = look(picture);           { crop, width, height, filter, covers, marks }
//   const next = add(picture.steps, { type: "cover", rect, color: "#ffffff" });

import type { Edits } from "./metadata";
import { readGrade, trimGrade, type Grade, type KeptGrade } from "./grade";
import { decodeRuns, MOST_STROKES, type Shape, type Stroke } from "./masks";
import { fitInside, largestInside, levelBox, MOST_TURN, turnOf } from "./turn";
import { MOST_KEYSTONE, perspectiveMap, type Corners, type Perspective } from "./perspective";
import type { Matrix } from "./homography";
import type { Cut } from "./cutout/cut";

/** A rectangle in the original's pixels. */
export interface Rect {
    x: number;
    y: number;
    width: number;
    height: number;
}

/** A place in the original's pixels. */
export interface Point {
    x: number;
    y: number;
}

/** How a picture is resampled when its size changes: Lanczos for photographs and screenshots, bilinear for speed, nearest for pixel art. */
export type Filter = "lanczos" | "bilinear" | "nearest";

/** How a text's lines lie against its place: left (where none is kept), about it, or ending at it. */
export type Align = "left" | "center" | "right";

/**
 * The marks, drawn over the picture: an arrow, a box, text (its lines, an outline round its letters and how its
 * lines are aligned), a numbered step (a filled circle with a number, counted by itself unless `value` was set by
 * hand), a highlighter's stroke, a magnifier (a round lens at `at` showing the picture round `from` enlarged
 * `zoom` times) and a spotlight's shape (a rectangle, or an ellipse when `round`, left bright while all round it
 * is dimmed by `dim`). A box, a text, a number or a spotlight made on a turned picture keeps the turn that makes it
 * upright there (`angle`, in degrees, about its middle or its place), so that it turns with the picture after.
 */
export type Mark =
    | { type: "arrow"; from: Point; to: Point; color: string; thickness: number }
    | { type: "box"; rect: Rect; color: string; thickness: number; angle?: number }
    | { type: "text"; at: Point; text: string; color: string; size: number; angle?: number; outline?: string; outlineWidth?: number; align?: "center" | "right" }
    | { type: "number"; at: Point; color: string; size: number; value?: number; angle?: number }
    | { type: "highlight"; from: Point; to: Point; color: string; thickness: number }
    | { type: "magnifier"; at: Point; from: Point; radius: number; zoom: number; color: string; thickness: number }
    | { type: "spotlight"; rect: Rect; round?: true; dim: number; angle?: number };

/** The kinds of mark. */
export type MarkKind = Mark["type"];

/** Every kind of mark, in the order the tools offer them. */
export const MARK_KINDS: MarkKind[] = ["arrow", "box", "text", "number", "highlight", "magnifier", "spotlight"];

/** True when a step is a mark. */
export const isMark = <T extends { type: string }>(step: T): step is T & Mark => (MARK_KINDS as string[]).includes(step.type);

/** The most a number set by hand may be. */
export const MOST_NUMBER = 9_999;

/** How little and how much a magnifier may enlarge. */
export const ZOOMS = { least: 1.25, most: 8 };

/** A cover as the picture has it: its rectangle, its color, and its turn about its middle if it was made on a turned picture. */
export type Cover = { rect: Rect; color: string; angle?: number };

/** The whole picture's grade, as steps.json keeps it: only what is away from its zero (grade.ts). */
export type GradeStep = { type: "grade"; grade: KeptGrade };

/** A part of the picture with a grade of its own: its shape (a gradient, strokes, a found mask; masks.ts) and its grade. */
export type PartStep = { type: "part"; grade: KeptGrade } & Shape;

/** The picture cut out of its background (cutout/cut.ts): the mask a model found, the brush's strokes, the subject pressed, and what it is laid on. */
export type CutStep = { type: "cutout" } & Cut;

/** The picture straightened by a perspective (perspective.ts): the keystone dials, and corners set by hand with their rectangle's proportions. */
export type PerspectiveStep = { type: "perspective" } & Perspective;

/**
 * A JPEG's repair: by hand (deblock.ts), or with a restoring model (`model`), whose result is kept in the
 * document beside the original (`made`, `pictures/name`) so that it is not made again each time the document
 * opens.
 */
export type RepairStep = { type: "repair"; model?: string; made?: string };

/** One thing done to the picture. A resize with no height keeps the crop's shape. A turn levels the picture (degrees, clockwise), the crop then upright on the turned picture; a perspective straightens it before it is turned. A repair takes a JPEG's blocks and ringing out of the original's pixels before anything else. A resize that enlarges may name a model to enlarge with (`model`); its filter is used where the model is not. A cut-out takes the background away first, before anything else is drawn. */
export type Step = { type: "crop"; rect: Rect } | { type: "resize"; width: number; height?: number; filter: Filter; model?: string } | { type: "turn"; angle: number } | PerspectiveStep | RepairStep | ({ type: "cover" } & Cover) | GradeStep | PartStep | CutStep | Mark;

/** A step as the document keeps it: with an id of its own, and switched off if it is. */
export type Kept = Step & { id: string; off?: boolean };

/** The original picture: where it is in the `.quire` (`pictures/name`), its size, its type and its weight in bytes. */
export interface Original {
    name: string;
    width: number;
    height: number;
    type: string;
    bytes: number;
}

/** A picture document: its original and its steps, in order. */
export interface Picture {
    original: Original;
    steps: Kept[];
    /** What she wrote in the facts for the picture's metadata (metadata.ts), kept with the steps and written into an export that keeps metadata. */
    edits?: Edits;
}

/** The picture as the steps make it look. */
export interface Look {
    crop: Rect;
    width: number;
    height: number;
    filter: Filter;
    covers: Cover[];
    marks: Mark[];
    /** The grades, in the order they are applied: the whole picture's, and each part's with its shape. */
    grades: { id: string; grade: Grade; part?: Shape }[];
    /** How far the picture is turned to level it, in degrees, clockwise; none when level. */
    turn?: number;
    /** The map that straightens the picture's perspective before it is turned (homography.ts), from the original's pixels; none when it has none. */
    perspective?: Matrix;
    /** The picture cut out of its background, if it is. */
    cutout?: Cut;
    /** Whether a JPEG's blocks and ringing are taken out of the original's pixels first. */
    repair?: true;
    /** The model that repairs it, and where its result is kept, when a model does. */
    repairModel?: string;
    repairMade?: string;
    /** The model that enlarges the picture, when the resize names one and enlarges it. */
    enlarge?: string;
}

/** The largest side a picture may be made, and the most steps a file is read with: beyond these a file is taken to be damaged. */
export const LIMITS = { side: 16_384, steps: 4_000, text: 400, file: 4 * 1024 * 1024 };

/** A new document for an original, with no steps yet. */
export const fresh = (original: Original): Picture => ({ original, steps: [] });

const clamp = (value: number, low: number, high: number) => Math.min(high, Math.max(low, value));

/** A rectangle with its corners in either order, kept inside the original and at least a pixel each way, in whole pixels. */
export function within(rect: Rect, original: { width: number; height: number }): Rect {
    const left = clamp(Math.round(Math.min(rect.x, rect.x + rect.width)), 0, original.width - 1);
    const top = clamp(Math.round(Math.min(rect.y, rect.y + rect.height)), 0, original.height - 1);
    const right = clamp(Math.round(Math.max(rect.x, rect.x + rect.width)), left + 1, original.width);
    const bottom = clamp(Math.round(Math.max(rect.y, rect.y + rect.height)), top + 1, original.height);
    return { x: left, y: top, width: right - left, height: bottom - top };
}

/** Applies the steps that are on, in order, to give the picture as it looks. A later crop takes the place of an earlier one, and a resize keeps the width it was given when the crop under it changes, its height following the crop's shape unless it was given one too. */
export function look(picture: Picture): Look {
    const { original } = picture;
    // the turn first, wherever it is in the list, since the crop is upright on the turned picture
    const turning = picture.steps.find((step) => step.type === "turn" && !step.off) as { angle: number } | undefined;
    const straightening = picture.steps.find((step) => step.type === "perspective" && !step.off) as PerspectiveStep | undefined;
    const perspective = straightening && perspectiveMap(straightening, original);
    const turn = turnOf(turning?.angle ?? 0, original, perspective);
    // a crop of her own is held to the original's box, or on a straightened picture, which may spread past it, to the box round the picture
    const room = perspective ? levelBox(turn) : original;
    let crop: Rect = largestInside(turn);
    let across = 1;
    let down = 1;
    let filter: Filter = "lanczos";
    const covers: Look["covers"] = [];
    const marks: Mark[] = [];
    const grades: Look["grades"] = [];
    let cutout: Cut | undefined;
    let repair: RepairStep | undefined;
    let enlarge: string | undefined;
    const numbers = numbersOf(picture.steps);
    for (const step of picture.steps) {
        if (step.off) continue;
        if (step.type === "grade") grades.push({ id: step.id, grade: gradeOf(step) });
        else if (step.type === "part") grades.push({ id: step.id, grade: gradeOf(step), part: shapeOf(step) });
        else if (step.type === "crop") crop = fitInside(perspective ? inBox(step.rect, room as Rect) : within(step.rect, original), turn);
        else if (step.type === "resize") {
            across = step.width / crop.width;
            down = step.height ? step.height / crop.height : across;
            filter = step.filter;
            enlarge = step.model;
        } else if (step.type === "cover") covers.push({ rect: step.angle ? step.rect : within(step.rect, original), color: step.color, ...(step.angle ? { angle: step.angle } : {}) });
        else if (step.type === "cutout") cutout = cutOf(step);
        else if (step.type === "repair") repair = step;
        else if (step.type === "number") marks.push({ ...(withoutId(step) as Extract<Mark, { type: "number" }>), value: numbers.get(step.id) ?? 1 });
        else if (step.type !== "turn" && step.type !== "perspective") marks.push(withoutId(step) as Mark);
    }
    const width = clamp(Math.round(crop.width * across), 1, LIMITS.side);
    const height = clamp(Math.round(crop.height * down), 1, LIMITS.side);
    return { crop, width, height, filter, covers, marks, grades, ...(turn.degrees ? { turn: turn.degrees } : {}), ...(perspective ? { perspective } : {}), ...(cutout ? { cutout } : {}), ...(repair ? { repair: true as const, ...(repair.model ? { repairModel: repair.model } : {}), ...(repair.made ? { repairMade: repair.made } : {}) } : {}), ...(enlarge && (width > crop.width || height > crop.height) ? { enlarge } : {}) };
}

/**
 * The number each numbered step shows, by its id: counted in the order the steps were made (their ids), not
 * the order they are drawn in, so that bringing one forward never renumbers them. A number set by hand is kept,
 * and the count goes on from it; taking one away renumbers the ones counted by themselves after it.
 */
export function numbersOf(steps: Kept[]): Map<string, number> {
    const order = (id: string) => Number(/^s(\d+)$/.exec(id)?.[1] ?? 0);
    const counted = steps.filter((step) => step.type === "number" && !step.off).sort((a, b) => order(a.id) - order(b.id)) as (Kept & { type: "number"; value?: number })[];
    const shown = new Map<string, number>();
    let count = 0;
    for (const step of counted) {
        count = step.value ?? count + 1;
        shown.set(step.id, count);
    }
    return shown;
}

/** A rectangle with its corners in either order, kept inside a box and at least a pixel each way, in whole pixels. */
function inBox(rect: Rect, box: Rect): Rect {
    const left = Math.ceil(box.x);
    const top = Math.ceil(box.y);
    const moved = within({ x: rect.x - left, y: rect.y - top, width: rect.width, height: rect.height }, { width: Math.max(1, Math.floor(box.x + box.width) - left), height: Math.max(1, Math.floor(box.y + box.height) - top) });
    return { ...moved, x: moved.x + left, y: moved.y + top };
}

// a grade step's whole grade, worked out once for each step as kept, so that drawing many times a second reads it once
const gradesRead = new WeakMap<object, Grade>();
/** A part step's shape alone, without its grade or the document's fields. */
export function shapeOf(step: PartStep): Shape {
    const { kind, from, to, found, strokes, feather, invert } = step;
    return { kind, ...(from ? { from } : {}), ...(to ? { to } : {}), ...(found ? { found } : {}), ...(strokes ? { strokes } : {}), feather, ...(invert ? { invert } : {}) };
}

/** The whole grade of a grade or part step, with every field it leaves out at its zero. */
export function gradeOf(step: GradeStep | PartStep): Grade {
    let found = gradesRead.get(step.grade);
    if (!found) gradesRead.set(step.grade, (found = readGrade(step.grade)));
    return found;
}

/** A cut-out step's cut alone, without the document's fields. */
export function cutOf(step: CutStep): Cut {
    const { found, strokes, pick, background, color } = step;
    return { found, ...(strokes ? { strokes } : {}), ...(pick ? { pick } : {}), background, ...(color ? { color } : {}) };
}

/** A step without the document's own fields. */
function withoutId(step: Kept): Step {
    const { id: _id, off: _off, ...plain } = step;
    return plain as unknown as Step;
}

/** True when a step is on, so that the original cannot be given out as it is. */
export const edited = (picture: Picture): boolean => picture.steps.some((step) => !step.off);

// ---- changing the list: each gives a new list and leaves the one it was given alone ----

/** An id not used by any of the steps. */
function freeId(steps: Kept[]): string {
    let most = 0;
    for (const step of steps) most = Math.max(most, Number(/^s(\d+)$/.exec(step.id)?.[1] ?? 0));
    return `s${most + 1}`;
}

/** The list with a step added at its end. */
export function add(steps: Kept[], step: Step): Kept[] {
    return [...steps, { ...step, id: freeId(steps) } as Kept];
}

/** The list with one step changed. */
export function change(steps: Kept[], id: string, to: Partial<Step>): Kept[] {
    return steps.map((step) => (step.id === id ? ({ ...step, ...to } as Kept) : step));
}

/** The list without one step. */
export function remove(steps: Kept[], id: string): Kept[] {
    return steps.filter((step) => step.id !== id);
}

/** The list with one step moved to another place in it. */
export function move(steps: Kept[], id: string, to: number): Kept[] {
    const at = steps.findIndex((step) => step.id === id);
    if (at < 0) return steps;
    const rest = steps.filter((step) => step.id !== id);
    rest.splice(clamp(to, 0, rest.length), 0, steps[at]!);
    return rest;
}

/** The list with one step switched off, or on again. */
export function toggle(steps: Kept[], id: string): Kept[] {
    return steps.map((step) => (step.id === id ? ({ ...step, off: !step.off || undefined } as Kept) : step));
}

/** The list with the picture's one crop (or one resize, or its whole grade) set: the step changed where there is one, added where there is not. */
export function setOnly(steps: Kept[], step: Extract<Step, { type: "crop" | "resize" | "grade" | "turn" | "perspective" | "repair" | "cutout" }>): Kept[] {
    const there = steps.find((each) => each.type === step.type);
    return there ? change(steps, there.id, step) : add(steps, step);
}

/** Undo and redo over the list: each change keeps the list before it. */
export function createHistory(first: Kept[]) {
    let now = first;
    const past: Kept[][] = [];
    let future: Kept[][] = [];
    return {
        now: () => now,
        /** A change: the list before it can be had back. */
        set(next: Kept[]) {
            if (next === now) return;
            past.push(now);
            if (past.length > 500) past.shift();
            future = [];
            now = next;
        },
        /** Puts another list in place with nothing to undo, as when a version is loaded. */
        reset(next: Kept[]) {
            now = next;
            past.length = 0;
            future = [];
        },
        undo(): boolean {
            const back = past.pop();
            if (!back) return false;
            future.push(now);
            now = back;
            return true;
        },
        redo(): boolean {
            const on = future.pop();
            if (!on) return false;
            past.push(now);
            now = on;
            return true;
        },
        canUndo: () => past.length > 0,
        canRedo: () => future.length > 0,
    };
}

// ---- steps.json ----

/** steps.json for a picture: its original and its steps, one step to a line. */
export function writeSteps(picture: Picture): string {
    const steps = picture.steps.map((step) => `    ${JSON.stringify(step)}`).join(",\n");
    const edits = picture.edits && Object.values(picture.edits).some((value) => value !== undefined) ? `,\n  "edits": ${JSON.stringify(picture.edits)}` : "";
    return `{\n  "quire": 1,\n  "original": ${JSON.stringify(picture.original)},\n  "steps": [${steps ? `\n${steps}\n  ` : ""}]${edits}\n}\n`;
}

const isNumber = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);
const COLOR = /^#[0-9a-f]{6}$/i;
const FAR = LIMITS.side * 4;

/** A number from a file, kept to a sane range, or undefined. */
const number = (value: unknown, low = -FAR, high = FAR) => (isNumber(value) ? clamp(value, low, high) : undefined);

function readPoint(value: unknown): Point | undefined {
    const point = value as Partial<Point> | null;
    const x = number(point?.x);
    const y = number(point?.y);
    return x === undefined || y === undefined ? undefined : { x, y };
}

function readRect(value: unknown): Rect | undefined {
    const rect = value as Partial<Rect> | null;
    const x = number(rect?.x);
    const y = number(rect?.y);
    const width = number(rect?.width);
    const height = number(rect?.height);
    return x === undefined || y === undefined || width === undefined || height === undefined ? undefined : { x, y, width, height };
}

/** A model's name as a step keeps it: small letters, digits and dashes. */
const modelName = (value: unknown) => (typeof value === "string" && /^[a-z0-9-]{1,40}$/.test(value) ? value : undefined);
/** Where a model's result may be kept: one of the document's own pictures, by a plain name. */
const MADE = /^pictures\/[\w.-]{1,120}$/;

/** One step from a file, checked field by field, or undefined if it is not one. */
function readStep(value: unknown): Step | undefined {
    const step = value as Record<string, unknown> | null;
    if (!step || typeof step !== "object") return undefined;
    const color = typeof step.color === "string" && COLOR.test(step.color) ? step.color.toLowerCase() : undefined;
    const thickness = number(step.thickness, 0.5, 2_000);
    if (step.type === "crop") {
        const rect = readRect(step.rect);
        return rect && { type: "crop", rect };
    }
    if (step.type === "resize") {
        const width = number(step.width, 1, LIMITS.side);
        const height = step.height === undefined ? undefined : number(step.height, 1, LIMITS.side);
        const filter = step.filter === "bilinear" || step.filter === "nearest" ? step.filter : "lanczos";
        const model = modelName(step.model);
        return width === undefined ? undefined : { type: "resize", width: Math.round(width), ...(height ? { height: Math.round(height) } : {}), filter, ...(model ? { model } : {}) };
    }
    if (step.type === "grade") return { type: "grade", grade: trimGrade(readGrade(step.grade)) };
    if (step.type === "turn") {
        const angle = number(step.angle, -MOST_TURN, MOST_TURN);
        return angle === undefined ? undefined : { type: "turn", angle: Math.round(angle * 100) / 100 };
    }
    if (step.type === "perspective") return readPerspective(step);
    if (step.type === "repair") {
        const model = modelName(step.model);
        // a result kept beside the original: one of the document's own pictures, by a plain name, and nowhere else
        const made = model && typeof step.made === "string" && MADE.test(step.made) ? step.made : undefined;
        return { type: "repair", ...(model ? { model } : {}), ...(made ? { made } : {}) };
    }
    // a box's, a text's or a cover's own turn, if it has one
    const angle = number(step.angle, -MOST_TURN, MOST_TURN);
    const turned = angle ? { angle } : {};
    if (step.type === "part") return readPart(step);
    if (step.type === "cutout") return readCut(step);
    if (step.type === "cover") {
        const rect = readRect(step.rect);
        return rect && color ? { type: "cover", rect, color, ...turned } : undefined;
    }
    if (step.type === "arrow") {
        const from = readPoint(step.from);
        const to = readPoint(step.to);
        return from && to && color && thickness ? { type: "arrow", from, to, color, thickness } : undefined;
    }
    if (step.type === "box") {
        const rect = readRect(step.rect);
        return rect && color && thickness ? { type: "box", rect, color, thickness, ...turned } : undefined;
    }
    if (step.type === "text") {
        const at = readPoint(step.at);
        const size = number(step.size, 1, 4_000);
        const text = typeof step.text === "string" ? step.text.slice(0, LIMITS.text) : undefined;
        // an outline needs its color and its width; a text from before has neither, and is drawn as it was
        const outline = typeof step.outline === "string" && COLOR.test(step.outline) ? step.outline.toLowerCase() : undefined;
        const outlineWidth = number(step.outlineWidth, 0.25, 1_000);
        const align = step.align === "center" || step.align === "right" ? step.align : undefined;
        return at && size && text && color ? { type: "text", at, text, color, size, ...turned, ...(outline && outlineWidth ? { outline, outlineWidth } : {}), ...(align ? { align } : {}) } : undefined;
    }
    if (step.type === "number") {
        const at = readPoint(step.at);
        const size = number(step.size, 1, 4_000);
        const value = number(step.value, 0, MOST_NUMBER);
        return at && size && color ? { type: "number", at, color, size, ...(value !== undefined ? { value: Math.round(value) } : {}), ...turned } : undefined;
    }
    if (step.type === "highlight") {
        const from = readPoint(step.from);
        const to = readPoint(step.to);
        const wide = number(step.thickness, 0.5, 4_000);
        return from && to && color && wide ? { type: "highlight", from, to, color, thickness: wide } : undefined;
    }
    if (step.type === "magnifier") {
        const at = readPoint(step.at);
        const from = readPoint(step.from);
        const radius = number(step.radius, 1, LIMITS.side);
        const zoom = number(step.zoom, ZOOMS.least, ZOOMS.most);
        return at && from && radius && zoom && color && thickness ? { type: "magnifier", at, from, radius, zoom: Math.round(zoom * 100) / 100, color, thickness } : undefined;
    }
    if (step.type === "spotlight") {
        const rect = readRect(step.rect);
        const dim = number(step.dim, 0.05, 0.95) ?? 0.55;
        return rect ? { type: "spotlight", rect, ...(step.round === true ? { round: true as const } : {}), dim: Math.round(dim * 100) / 100, ...turned } : undefined;
    }
    return undefined;
}

/** A perspective step from a file: the dials within their range in hundredths, and corners only as four places with a ratio from a twentieth to twenty; nothing when it holds nothing. */
function readPerspective(step: Record<string, unknown>): PerspectiveStep | undefined {
    const dial = (value: unknown) => {
        const read = number(value, -MOST_KEYSTONE, MOST_KEYSTONE);
        return read ? Math.round(read * 100) / 100 : undefined;
    };
    const vertical = dial(step.vertical);
    const horizontal = dial(step.horizontal);
    const given = Array.isArray(step.corners) && step.corners.length === 4 ? step.corners.map(readPoint) : undefined;
    const ratio = number(step.ratio, 0.05, 20);
    const corners = given?.every((point) => point) && ratio ? (given as Corners) : undefined;
    if (!vertical && !horizontal && !corners) return undefined;
    return { type: "perspective", ...(vertical ? { vertical } : {}), ...(horizontal ? { horizontal } : {}), ...(corners ? { corners, ratio } : {}) };
}

/** A found mask from a file, checked: whole sizes up to 2048 a side, and runs that read to exactly its size. */
function readFound(value: unknown): { width: number; height: number; runs: string } | undefined {
    const given = value as { width?: unknown; height?: unknown; runs?: unknown } | undefined;
    const width = number(given?.width, 1, 2_048);
    const height = number(given?.height, 1, 2_048);
    return given && width && height && Number.isInteger(width) && Number.isInteger(height) && typeof given.runs === "string" && given.runs.length <= LIMITS.file && decodeRuns(given.runs, width * height) ? { width, height, runs: given.runs } : undefined;
}

/** The brush's strokes from a file, each checked and bounded. */
function readStrokes(value: unknown): Stroke[] | undefined {
    if (!Array.isArray(value)) return undefined;
    const strokes = value
        .slice(0, MOST_STROKES.strokes)
        .map((each: Record<string, unknown> | null): Stroke | undefined => {
            const size = number(each?.size, 0.5, 4_000);
            const points = Array.isArray(each?.points) ? (each.points as unknown[]).slice(0, MOST_STROKES.points * 2) : [];
            if (size === undefined || points.length < 2 || points.length % 2 || !points.every(isNumber)) return undefined;
            return { size, soft: number(each?.soft, 0, 1) ?? 0.5, ...(each?.erase === true ? { erase: true } : {}), points: (points as number[]).map((point) => clamp(point, -FAR, FAR)) };
        })
        .filter((each): each is Stroke => !!each);
    return strokes.length ? strokes : undefined;
}

/** A cut-out step from a file: its mask checked, its strokes and the subject pressed bounded, its background one of the three. */
function readCut(step: Record<string, unknown>): CutStep | undefined {
    const found = readFound(step.found);
    if (!found) return undefined;
    const pick = readFound(step.pick);
    const strokes = readStrokes(step.strokes);
    const background = step.background === "color" || step.background === "blur" ? step.background : "clear";
    const color = typeof step.color === "string" && COLOR.test(step.color) ? step.color.toLowerCase() : undefined;
    return { type: "cutout", found, ...(strokes ? { strokes } : {}), ...(pick ? { pick } : {}), background, ...(color ? { color } : {}) };
}

/** A part step from a file: its kind, gradient, strokes and found mask checked and bounded, its grade read as any grade is. */
function readPart(step: Record<string, unknown>): PartStep | undefined {
    const kind = step.kind === "gradient" || step.kind === "paint" || step.kind === "found" ? step.kind : undefined;
    if (!kind) return undefined;
    const from = readPoint(step.from);
    const to = readPoint(step.to);
    if (kind === "gradient" && (!from || !to)) return undefined;
    const strokes = Array.isArray(step.strokes)
        ? step.strokes
              .slice(0, MOST_STROKES.strokes)
              .map((each: Record<string, unknown> | null): Stroke | undefined => {
                  const size = number(each?.size, 0.5, 4_000);
                  const points = Array.isArray(each?.points) ? (each.points as unknown[]).slice(0, MOST_STROKES.points * 2) : [];
                  if (size === undefined || points.length < 2 || points.length % 2 || !points.every(isNumber)) return undefined;
                  return { size, soft: number(each?.soft, 0, 1) ?? 0.5, ...(each?.erase === true ? { erase: true } : {}), points: (points as number[]).map((value) => clamp(value, -FAR, FAR)) };
              })
              .filter((each): each is Stroke => !!each)
        : undefined;
    const given = step.found as { width?: unknown; height?: unknown; runs?: unknown } | undefined;
    const width = number(given?.width, 1, 2_048);
    const height = number(given?.height, 1, 2_048);
    const found = given && width && height && Number.isInteger(width) && Number.isInteger(height) && typeof given.runs === "string" && decodeRuns(given.runs, width * height) ? { width, height, runs: given.runs } : undefined;
    if (kind === "found" && !found) return undefined;
    return {
        type: "part",
        kind,
        ...(from && kind === "gradient" ? { from } : {}),
        ...(to && kind === "gradient" ? { to } : {}),
        ...(found ? { found } : {}),
        ...(strokes?.length ? { strokes } : {}),
        feather: number(step.feather, 0, 2_000) ?? 0,
        ...(step.invert === true ? { invert: true } : {}),
        grade: trimGrade(readGrade(step.grade)),
    };
}

/**
 * Reads steps.json. Gives undefined when it is not a picture's steps at all (not JSON, another
 * version, no usable original); otherwise the picture with every step that reads as one, those that
 * do not left out, and how many were.
 */
export function readSteps(text: string): (Picture & { dropped: number }) | undefined {
    if (text.length > LIMITS.file) return undefined;
    let raw: { quire?: unknown; original?: Record<string, unknown>; steps?: unknown };
    try {
        raw = JSON.parse(text);
    } catch {
        return undefined;
    }
    if (!raw || typeof raw !== "object" || raw.quire !== 1) return undefined;
    const given = raw.original;
    const width = isNumber(given?.width) && given.width >= 1 ? number(given.width, 1, 100_000) : undefined;
    const height = isNumber(given?.height) && given.height >= 1 ? number(given.height, 1, 100_000) : undefined;
    const name = typeof given?.name === "string" ? given.name.slice(0, 300) : undefined;
    if (!width || !height || !name) return undefined;
    const original: Original = { name, width: Math.round(width), height: Math.round(height), type: typeof given?.type === "string" ? given.type.slice(0, 60) : "", bytes: Math.round(number(given?.bytes, 0, 2 ** 40) ?? 0) };
    const list = Array.isArray(raw.steps) ? raw.steps.slice(0, LIMITS.steps) : [];
    const read = list.map((each) => ({ step: readStep(each), each: each as { id?: unknown; off?: unknown } })).filter((found) => found.step);
    // ids as written where they are good and not taken twice; the rest numbered after the highest
    const ids = new Set<string>();
    let most = 0;
    for (const { each } of read) if (typeof each.id === "string" && /^s\d{1,9}$/.test(each.id)) most = Math.max(most, Number(each.id.slice(1)));
    const steps = read.map(({ step, each }): Kept => {
        const id = typeof each.id === "string" && /^s\d{1,9}$/.test(each.id) && !ids.has(each.id) ? each.id : `s${++most}`;
        ids.add(id);
        return { ...step!, id, ...(each.off === true ? { off: true } : {}) } as Kept;
    });
    const dropped = (Array.isArray(raw.steps) ? raw.steps.length : 0) - steps.length;
    // what she wrote for the metadata: the five fields, each text and not too long
    const wrote = (raw as { edits?: Record<string, unknown> }).edits;
    const edits: Edits = {};
    for (const key of ["caption", "alt", "author", "copyright", "date"] as const) if (typeof wrote?.[key] === "string") edits[key] = (wrote[key] as string).slice(0, 2000);
    return { original, steps, dropped, ...(Object.keys(edits).length ? { edits } : {}) };
}
