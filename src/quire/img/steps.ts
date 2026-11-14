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

/** The marks, drawn over the picture: an arrow, a box and a line of text. */
export type Mark =
    | { type: "arrow"; from: Point; to: Point; color: string; thickness: number }
    | { type: "box"; rect: Rect; color: string; thickness: number }
    | { type: "text"; at: Point; text: string; color: string; size: number };

/** One thing done to the picture. A resize with no height keeps the crop's shape. */
export type Step = { type: "crop"; rect: Rect } | { type: "resize"; width: number; height?: number; filter: Filter } | { type: "cover"; rect: Rect; color: string } | Mark;

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
}

/** The picture as the steps make it look. */
export interface Look {
    crop: Rect;
    width: number;
    height: number;
    filter: Filter;
    covers: { rect: Rect; color: string }[];
    marks: Mark[];
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
    let crop: Rect = { x: 0, y: 0, width: original.width, height: original.height };
    let across = 1;
    let down = 1;
    let filter: Filter = "lanczos";
    const covers: Look["covers"] = [];
    const marks: Mark[] = [];
    for (const step of picture.steps) {
        if (step.off) continue;
        if (step.type === "crop") crop = within(step.rect, original);
        else if (step.type === "resize") {
            across = step.width / crop.width;
            down = step.height ? step.height / crop.height : across;
            filter = step.filter;
        } else if (step.type === "cover") covers.push({ rect: within(step.rect, original), color: step.color });
        else marks.push(withoutId(step) as Mark);
    }
    const width = clamp(Math.round(crop.width * across), 1, LIMITS.side);
    const height = clamp(Math.round(crop.height * down), 1, LIMITS.side);
    return { crop, width, height, filter, covers, marks };
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

/** The list with the picture's one crop (or one resize) set: the step changed where there is one, added where there is not. */
export function setOnly(steps: Kept[], step: Extract<Step, { type: "crop" | "resize" }>): Kept[] {
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
    return `{\n  "quire": 1,\n  "original": ${JSON.stringify(picture.original)},\n  "steps": [${steps ? `\n${steps}\n  ` : ""}]\n}\n`;
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
        return width === undefined ? undefined : { type: "resize", width: Math.round(width), ...(height ? { height: Math.round(height) } : {}), filter };
    }
    if (step.type === "cover") {
        const rect = readRect(step.rect);
        return rect && color ? { type: "cover", rect, color } : undefined;
    }
    if (step.type === "arrow") {
        const from = readPoint(step.from);
        const to = readPoint(step.to);
        return from && to && color && thickness ? { type: "arrow", from, to, color, thickness } : undefined;
    }
    if (step.type === "box") {
        const rect = readRect(step.rect);
        return rect && color && thickness ? { type: "box", rect, color, thickness } : undefined;
    }
    if (step.type === "text") {
        const at = readPoint(step.at);
        const size = number(step.size, 1, 4_000);
        const text = typeof step.text === "string" ? step.text.slice(0, LIMITS.text) : undefined;
        return at && size && text && color ? { type: "text", at, text, color, size } : undefined;
    }
    return undefined;
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
    return { original, steps, dropped };
}
