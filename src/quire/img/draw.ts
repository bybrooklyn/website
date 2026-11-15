// Drawing the picture, the same way whichever of the graphics card's two ways the browser has:
// WebGPU first (gpu.ts), WebGL2 where it is missing (gl.ts), both written here by hand behind one
// small interface, `Backend`. This file is what the two share: the original decoded once and kept
// as textures, drawn on the screen at any zoom (`Picture.draw`), and flattened at full size for
// export (`Picture.flatten`).
//
// On the screen a picture of up to 4096 pixels a side is one texture; a larger one is a smaller copy
// for seeing it whole, and pieces of 2048 at full size made only when zoomed in far enough to need
// them, so that 50 megapixels never sit on the card at once. Zoomed in past one to one it is drawn
// with nearest pixels, zoomed out with the smaller copies the card keeps.
//
// Flattening goes piece by piece: for each piece of the result, the part of the original it needs
// is cut out, the covers are painted into it on the card (so nothing of what they hide is ever read
// again), and it is resampled to its size in two passes, across and then down, by the filter the
// resize names. The plan for the pieces is worked out here (`plan`), and tested; the marks are drawn
// last, by the browser's 2D canvas, the same for both ways (marks.ts).
//
// A turned picture (the horizon, turn.ts) is drawn on the screen as its pieces turned, each a four
// cornered shape; when flattening, each piece of the result first reads the part of the original under
// it, the covers painted in as before, and turns it upright by a pass of its own (a Lanczos filter of
// six by six at one to one), before the two passes of the resize. A picture that is not turned is drawn
// and flattened exactly as before.
//
// A grade is drawn by the card too, as a few more sums in the same programs: on the screen each pixel
// is graded as it is drawn, and when flattening it is graded in the pass down, before the result is
// rounded to 8 bits (grade-shader.ts). The grades' numbers and the parts' masks are handed to the
// backend when they change (`Backend.grading`), so dragging a slider sends a few kilobytes and draws.

import { webgl2 } from "./gl";
import { webgpu } from "./gpu";
import { drawMarks } from "./marks";
import type { Filter, Look, Rect } from "./steps";
import { pack, type Packed, type PackedGrade } from "./grade-shader";
import { stackFor } from "./masks";
import { isNeutral, prepare, space, type Grade, type Prepared, type Space, type SpaceNumbers } from "./grade";
import { cornersOf, fromLevel, toLevel, turnOf, type Turn } from "./turn";

/** The card's best way on a canvas: WebGPU where the browser has it, else WebGL2 (or WebGL2 when asked, for comparing the two). */
export async function backendFor(canvas: HTMLCanvasElement | OffscreenCanvas, only?: Backend["name"]): Promise<Backend | undefined> {
    if (only !== "WebGL2") {
        const found = await webgpu(canvas).catch(() => undefined);
        if (found || only === "WebGPU") return found;
    }
    return webgl2(canvas);
}

/** The largest texture made for the screen. */
export const WHOLE = 4096;
/** The side of a piece, on the screen and when flattening. */
export const PIECE = 2048;

/** One pass of the resampling, along one axis: where the result's first pixel samples from, how far apart the samples are, the range they may read, and the filter. All in the piece's own pixels. */
export interface Pass {
    start: number;
    step: number;
    low: number;
    high: number;
    support: number;
    scale: number;
    filter: Filter;
}

/** One piece of a flattening: the part of the result it makes, the part of the original it reads, and its two passes. */
export interface Piece {
    out: Rect;
    source: Rect;
    across: Pass;
    down: Pass;
}

/** How far a filter reaches, in pixels of the original, at a step between samples (above one when shrinking). */
export const reach = (filter: Filter, step: number): number => (filter === "lanczos" ? 3 : filter === "bilinear" ? 1 : 0.5) * Math.max(1, filter === "nearest" ? 1 : step);

/** The filters' weights, as both shaders work them out, for testing them against. */
export function weight(filter: Filter, x: number): number {
    x = Math.abs(x);
    if (filter === "bilinear") return Math.max(0, 1 - x);
    if (filter === "nearest") return x <= 0.5 ? 1 : 0;
    if (x < 1e-5) return 1;
    if (x >= 3) return 0;
    const p = Math.PI * x;
    return (3 * Math.sin(p) * Math.sin(p / 3)) / (p * p);
}

/**
 * The pieces a picture is flattened in. Each reads at most `most` pixels of the original a side (with
 * the filter's reach round it), so that a piece fits on any card however much the picture shrinks.
 */
export function plan(look: Look, most = PIECE): Piece[] {
    const { crop, width, height, filter } = look;
    const stepX = crop.width / width;
    const stepY = crop.height / height;
    const reachX = reach(filter, stepX);
    const reachY = reach(filter, stepY);
    // how many result pixels a piece makes each way, so that what it reads stays within `most`
    const outX = Math.max(1, Math.floor((most - 2 * Math.ceil(reachX) - 2) / stepX));
    const outY = Math.max(1, Math.floor((most - 2 * Math.ceil(reachY) - 2) / stepY));
    const pieces: Piece[] = [];
    for (let oy = 0; oy < height; oy += outY)
        for (let ox = 0; ox < width; ox += outX) {
            const out = { x: ox, y: oy, width: Math.min(outX, width - ox), height: Math.min(outY, height - oy) };
            const along = (start: number, count: number, step: number, reached: number, low: number, size: number) => {
                const first = low + (start + 0.5) * step - 0.5;
                const last = low + (start + count - 0.5) * step - 0.5;
                const from = Math.max(low, Math.floor(first - reached));
                const to = Math.min(low + size, Math.ceil(last + reached) + 1);
                return { from, to, first };
            };
            const x = along(ox, out.width, stepX, reachX, crop.x, crop.width);
            const y = along(oy, out.height, stepY, reachY, crop.y, crop.height);
            const source = { x: x.from, y: y.from, width: x.to - x.from, height: y.to - y.from };
            const pass = (first: number, step: number, from: number, to: number, low: number, size: number, reached: number): Pass => ({
                start: first - from,
                step,
                // samples past the crop's edge read its edge, never what lies beyond it
                low: Math.max(0, low - from),
                high: Math.min(to, low + size) - 1 - from,
                support: reached,
                scale: filter === "nearest" ? 1 : 1 / Math.max(1, step),
                filter,
            });
            pieces.push({ out, source, across: pass(x.first, stepX, x.from, x.to, crop.x, crop.width, reachX), down: pass(y.first, stepY, y.from, y.to, crop.y, crop.height, reachY) });
        }
    return pieces;
}

/** A color as the card takes it: red, green, blue and alpha from 0 to 1. */
export type Color = [number, number, number, number];

/** `#rrggbb` as a color for the card. */
export const rgba = (hex: string, alpha = 1): Color => [parseInt(hex.slice(1, 3), 16) / 255, parseInt(hex.slice(3, 5), 16) / 255, parseInt(hex.slice(5, 7), 16) / 255, alpha];

/** A texture on the card, as a backend keeps it. */
export type Texture = { width: number; height: number };

/** Four corners on the canvas, as eight numbers: the top left, top right, bottom left and bottom right of what is drawn there. */
export type Quad = [number, number, number, number, number, number, number, number];

/** One image drawn on the screen: a texture, the rectangle of the canvas it fills (or, turned, the four corners it fills, `quad`), and whether its pixels are drawn as squares (zoomed in) or smoothed. */
export interface Drawn {
    texture: Texture;
    to: Rect;
    quad?: Quad;
    sharp: boolean;
}

/** A solid shape drawn over the images: a rectangle of the canvas, or four corners (`quad`), its color, and whether the grade reaches it (a cover does). A `dim` shape only darkens what is drawn under it and leaves the rest of the canvas clear, as the outside of the crop is dimmed while nothing is drawn round a turned picture. */
export interface Fill {
    rect: Rect;
    quad?: Quad;
    color: Color;
    graded?: boolean;
    dim?: boolean;
}

/** A cover as a piece being flattened takes it: in the piece's own pixels, with its own turn if it has one. */
export interface PieceCover {
    rect: Rect;
    color: Color;
    angle?: number;
}

/** The pass that turns a piece of the original upright, when the picture is turned: the turn's cosine and sine; where the piece's first pixel is on the level picture, less the original's middle; the original's middle less the part read's corner and half a pixel; and the size of the level piece made. */
export interface TurnPass {
    cos: number;
    sin: number;
    from: [number, number];
    back: [number, number];
    width: number;
    height: number;
}

/** The parts' masks as the card takes them: layers of one size, each its values from 0 to 1 row by row, the size fitted to the original's shape. */
export interface MaskStack {
    width: number;
    height: number;
    layers: Float32Array[];
}

/** What the card grades with: the grades packed, the space's numbers, the original's size (which the masks are laid over), and the masks of the parts; whether the result is made sRGB from Display P3 after the grades; and the picture's turn (its cosine, its sine and the middle it turns about), by which a place on the turned picture is taken back to the original's pixels for the masks. */
export interface Grading {
    packed: Packed;
    numbers: SpaceNumbers;
    picture: { width: number; height: number };
    masks?: MaskStack;
    convert?: boolean;
    turn?: [number, number, number, number];
}

/** On the screen, where a canvas pixel is in the original (`x + canvas * across`, the same down) and where the split between the original and the graded falls, in canvas pixels from the left; pixels left of it are drawn as they were. */
export interface ScreenGrade {
    toOriginal: [number, number, number, number];
    split: number;
}

/** What each of the card's two ways does: the little that differs between them. */
export interface Backend {
    name: "WebGPU" | "WebGL2";
    /** Settles if the card lets the drawing go (WebGPU can lose its device), so that the picture is drawn again the other way. */
    lost?: Promise<void>;
    /** The largest texture it takes. */
    most: number;
    /** Puts an image on the card, with its smaller copies for drawing it small. */
    texture(image: ImageBitmap): Texture;
    free(texture: Texture): void;
    /** Draws the canvas: its ground, the images, clipped to `clip` if given, then solid rectangles over them. Rectangles are in the canvas's pixels. With `graded`, the images and the fills marked graded are graded as they are drawn, by what `grading` was last given. */
    draw(images: Drawn[], fills: Fill[], clip?: Rect, graded?: ScreenGrade): void;
    /** Resamples one piece: the part of the original given, covers painted into it (a cover with its own turn as its four corners, grown by half a pixel's diagonal so that no pixel it touches keeps what it hid), turned upright first when `turned`, then the two passes, giving the result's pixels, RGBA, row by row from the top. With `graded` (where a result pixel of the piece is on the level picture: `x + column * across`, the same down), the pass down grades each pixel before it is rounded. */
    resample(part: ImageBitmap, covers: PieceCover[], piece: Piece, graded?: [number, number, number, number], turned?: TurnPass): Promise<Uint8Array>;
    /** Says which space the canvas's numbers are in, sRGB or Display P3, so that the browser shows them right on the screen; false when the canvas cannot take that space (the picture is then made sRGB as it is drawn). */
    colors(space: "srgb" | "display-p3"): boolean;
    /** Hands the card the grades and masks to grade with; nothing to stop grading. Masks are sent again only when their stack is another. */
    grading(given: Grading | undefined): void;
    destroy(): void;
}

/** Where the picture is on the screen: canvas pixels per pixel of the original, and where the original's corner falls, in canvas pixels. */
export interface View {
    scale: number;
    x: number;
    y: number;
}

/** How the picture is shown: as it looks, or whole with the crop's frame on it and the outside dimmed. */
export interface Scene {
    look: Look;
    view: View;
    cropping?: Rect;
    /** The grades to draw it with, and where the split to the original falls (in canvas pixels; none, all graded). */
    grading?: Grading;
    split?: number;
    /** The canvas's size in its own pixels. */
    canvas: { width: number; height: number };
}

/** Where a look's pixels fall in the result: the result's pixels per pixel of the original each way, where the level picture's corner falls, and the picture's turn about the original's middle. */
export const resultPlace = (look: Look, size: { width: number; height: number }) => {
    const across = look.width / look.crop.width;
    const down = look.height / look.crop.height;
    return { across, down, x: -look.crop.x * across, y: -look.crop.y * down, ...(look.turn ? { turn: { degrees: look.turn, x: size.width / 2, y: size.height / 2 } } : {}) };
};

/** The four corners of a rectangle in the original's pixels (turned on its own by `angle`), on the canvas, as the card takes them. */
export function quadOn(rect: Rect, angle: number | undefined, turn: Turn, place: (point: { x: number; y: number }) => { x: number; y: number }): Quad {
    const [a, b, c, d] = cornersOf(rect, angle).map((point) => place(toLevel(point, turn)));
    return [a!.x, a!.y, b!.x, b!.y, d!.x, d!.y, c!.x, c!.y];
}

/** A cover turned on its own, as the corners painted into a piece: grown by half a pixel's diagonal each way, so that every pixel it touches is painted. */
export function grownQuad(cover: PieceCover): Quad {
    const grow = Math.SQRT1_2;
    const [a, b, c, d] = cornersOf({ x: cover.rect.x - grow, y: cover.rect.y - grow, width: cover.rect.width + 2 * grow, height: cover.rect.height + 2 * grow }, cover.angle);
    return [a!.x, a!.y, b!.x, b!.y, d!.x, d!.y, c!.x, c!.y];
}

/** The upright box round four corners. */
export const quadBox = (quad: Quad): Rect => {
    const xs = [quad[0], quad[2], quad[4], quad[6]];
    const ys = [quad[1], quad[3], quad[5], quad[7]];
    const x = Math.min(...xs);
    const y = Math.min(...ys);
    return { x, y, width: Math.max(...xs) - x, height: Math.max(...ys) - y };
};

/** The original, decoded once by the browser and kept on the card, drawn and flattened through a backend. */
export async function loadPicture(backend: Backend, blob: Blob) {
    const full = await createImageBitmap(blob, { colorSpaceConversion: "none", premultiplyAlpha: "none" });
    const size = { width: full.width, height: full.height };
    const long = Math.max(size.width, size.height);
    const limit = Math.min(WHOLE, backend.most);
    // whole at full size where it fits; else a smaller copy to see it whole, and full-size pieces made when needed
    const whole = long <= limit ? full : await createImageBitmap(full, { resizeWidth: Math.max(1, Math.round((size.width * limit) / long)), resizeHeight: Math.max(1, Math.round((size.height * limit) / long)), resizeQuality: "high" });
    const overview = backend.texture(whole);
    const tiles = new Map<string, { texture: Texture; used: number }>();
    let clock = 0;
    const tile = (column: number, row: number) => {
        const key = `${column},${row}`;
        const found = tiles.get(key);
        if (found) return ((found.used = ++clock), found.texture);
        return undefined;
    };
    const making = new Set<string>();
    let drawAgain: (() => void) | undefined;
    const makeTile = async (column: number, row: number) => {
        const key = `${column},${row}`;
        if (making.has(key)) return;
        making.add(key);
        const x = column * PIECE;
        const y = row * PIECE;
        const part = await createImageBitmap(full, x, y, Math.min(PIECE, size.width - x), Math.min(PIECE, size.height - y), { colorSpaceConversion: "none", premultiplyAlpha: "none" });
        tiles.set(key, { texture: backend.texture(part), used: ++clock });
        part.close();
        making.delete(key);
        // no more than twelve pieces kept, the least lately drawn let go first
        while (tiles.size > 12) {
            const [oldest] = [...tiles].sort((a, b) => a[1].used - b[1].used)[0]!;
            backend.free(tiles.get(oldest)!.texture);
            tiles.delete(oldest);
        }
        drawAgain?.();
    };

    return {
        size,
        backend: backend.name,
        /** Puts the canvas in a space: true when it took it. */
        colors: (space: "srgb" | "display-p3") => backend.colors(space),
        /** Draws the picture on the canvas as the scene says. */
        draw(scene: Scene, again?: () => void) {
            drawAgain = again;
            const { look, view } = scene;
            const shown = scene.cropping ?? look.crop;
            const turn = turnOf(look.turn ?? 0, size);
            // canvas pixels per pixel of the original: a resize is seen as the picture drawn larger or smaller
            const across = scene.cropping ? view.scale : (view.scale * look.width) / look.crop.width;
            const down = scene.cropping ? view.scale : (view.scale * look.height) / look.crop.height;
            const place = (rect: Rect): Rect => ({ x: view.x + (rect.x - shown.x) * across, y: view.y + (rect.y - shown.y) * down, width: rect.width * across, height: rect.height * down });
            const point = (at: { x: number; y: number }) => ({ x: view.x + (at.x - shown.x) * across, y: view.y + (at.y - shown.y) * down });
            // a part of the original on the canvas: a rectangle, or turned, four corners and the box round them
            const onCanvas = (rect: Rect, angle?: number): { to: Rect; quad?: Quad } => {
                if (!turn.degrees && !angle) return { to: place(rect) };
                const quad = quadOn(rect, angle, turn, point);
                return { to: quadBox(quad), quad };
            };
            const sharp = across >= 1 - 1e-6 && !turn.degrees;
            const images: Drawn[] = [{ texture: overview, ...onCanvas({ x: 0, y: 0, ...size }), sharp: sharp && whole === full }];
            // zoomed in beyond the smaller copy: the full-size pieces in sight, drawn over it
            if (whole !== full && across > (whole.width / size.width) * 1.05) {
                for (let row = 0; row * PIECE < size.height; row++)
                    for (let column = 0; column * PIECE < size.width; column++) {
                        const drawnAt = onCanvas({ x: column * PIECE, y: row * PIECE, width: Math.min(PIECE, size.width - column * PIECE), height: Math.min(PIECE, size.height - row * PIECE) });
                        const to = drawnAt.to;
                        if (to.x > scene.canvas.width || to.y > scene.canvas.height || to.x + to.width < 0 || to.y + to.height < 0) continue;
                        const texture = tile(column, row);
                        if (texture) images.push({ texture, ...drawnAt, sharp });
                        else void makeTile(column, row);
                    }
            }
            const fills: Fill[] = look.covers.map((cover) => {
                const drawnAt = onCanvas(cover.rect, cover.angle);
                return { rect: drawnAt.to, ...(drawnAt.quad ? { quad: drawnAt.quad } : {}), color: rgba(cover.color), graded: true };
            });
            if (scene.cropping) {
                // the outside of the crop dimmed, so the frame shows what is kept
                const inside = place(look.crop);
                const all = place(scene.cropping);
                const dim: Color = [0, 0, 0, 0.55];
                fills.push(
                    { rect: { x: all.x, y: all.y, width: all.width, height: inside.y - all.y }, color: dim, dim: true },
                    { rect: { x: all.x, y: inside.y + inside.height, width: all.width, height: all.y + all.height - inside.y - inside.height }, color: dim, dim: true },
                    { rect: { x: all.x, y: inside.y, width: inside.x - all.x, height: inside.height }, color: dim, dim: true },
                    { rect: { x: inside.x + inside.width, y: inside.y, width: all.x + all.width - inside.x - inside.width, height: inside.height }, color: dim, dim: true },
                );
            }
            backend.grading(scene.grading);
            // a canvas pixel's place in the original, for the grade's masks
            const graded: ScreenGrade | undefined = scene.grading ? { toOriginal: [shown.x - view.x / across, shown.y - view.y / down, 1 / across, 1 / down], split: scene.split ?? -1 } : undefined;
            backend.draw(images, fills, scene.cropping ? undefined : place(look.crop), graded);
        },
        /** The picture as it looks, at full size: its pixels, the covers painted in before resampling so that nothing they hide is read, and the marks drawn over. */
        async flatten(look: Look, most = PIECE, grading?: Grading): Promise<ImageData> {
            const result = new ImageData(look.width, look.height);
            backend.grading(grading);
            const stepX = look.crop.width / look.width;
            const stepY = look.crop.height / look.height;
            const turn = turnOf(look.turn ?? 0, size);
            // a turned piece reads a part of the original as wide as the piece turned, so each piece is made smaller to fit the card
            const wider = turn.degrees ? Math.abs(turn.cos) + Math.abs(turn.sin) : 1;
            const limit = Math.min(most, backend.most);
            for (const piece of plan(look, turn.degrees ? Math.max(16, Math.floor((limit - 10) / wider)) : limit)) {
                // the part of the original the piece reads: its own place, or turned, the box round it in the original and a filter's reach more
                let read = piece.source;
                if (turn.degrees) {
                    const corners = cornersOf(piece.source).map((corner) => fromLevel(corner, turn));
                    const left = Math.max(0, Math.floor(Math.min(...corners.map((corner) => corner.x))) - 4);
                    const top = Math.max(0, Math.floor(Math.min(...corners.map((corner) => corner.y))) - 4);
                    const right = Math.min(size.width, Math.ceil(Math.max(...corners.map((corner) => corner.x))) + 4);
                    const bottom = Math.min(size.height, Math.ceil(Math.max(...corners.map((corner) => corner.y))) + 4);
                    read = { x: left, y: top, width: Math.max(1, right - left), height: Math.max(1, bottom - top) };
                }
                const part = await createImageBitmap(full, read.x, read.y, read.width, read.height, { colorSpaceConversion: "none", premultiplyAlpha: "none" });
                const covers: PieceCover[] = look.covers.map((cover) => ({ rect: { x: cover.rect.x - read.x, y: cover.rect.y - read.y, width: cover.rect.width, height: cover.rect.height }, color: rgba(cover.color), ...(cover.angle ? { angle: cover.angle } : {}) }));
                const graded: [number, number, number, number] | undefined = grading ? [look.crop.x + piece.out.x * stepX, look.crop.y + piece.out.y * stepY, stepX, stepY] : undefined;
                const turned: TurnPass | undefined = turn.degrees ? { cos: turn.cos, sin: turn.sin, from: [piece.source.x - size.width / 2, piece.source.y - size.height / 2], back: [size.width / 2 - read.x - 0.5, size.height / 2 - read.y - 0.5], width: piece.source.width, height: piece.source.height } : undefined;
                const pixels = await backend.resample(part, covers, piece, graded, turned);
                part.close();
                for (let row = 0; row < piece.out.height; row++) result.data.set(pixels.subarray(row * piece.out.width * 4, (row + 1) * piece.out.width * 4), ((piece.out.y + row) * look.width + piece.out.x) * 4);
            }
            if (look.marks.length) {
                const canvas = new OffscreenCanvas(look.width, look.height);
                const context = canvas.getContext("2d")!;
                context.putImageData(result, 0, 0);
                drawMarks(context, look.marks, resultPlace(look, size));
                return context.getImageData(0, 0, look.width, look.height);
            }
            return result;
        },
        /** The whole original made small, its longer side at most `long`, as pixels: for the histogram and the fixes, which are worked out on the processor. */
        async small(long = 256): Promise<ImageData> {
            const scale = Math.min(1, long / Math.max(size.width, size.height));
            const width = Math.max(1, Math.round(size.width * scale));
            const height = Math.max(1, Math.round(size.height * scale));
            const made = await createImageBitmap(full, { resizeWidth: width, resizeHeight: height, resizeQuality: "medium", colorSpaceConversion: "none", premultiplyAlpha: "none" });
            const canvas = new OffscreenCanvas(width, height);
            const context = canvas.getContext("2d")!;
            context.drawImage(made, 0, 0);
            made.close();
            return context.getImageData(0, 0, width, height);
        },
        /** A copy of the original's pixels as a bitmap, to hand to the text reader's worker. */
        bitmap: (): Promise<ImageBitmap> => createImageBitmap(full),
        /** The pixels of a part of the original, for choosing a cover's color. */
        async pixels(rect: Rect): Promise<Uint8ClampedArray> {
            const canvas = new OffscreenCanvas(rect.width, rect.height);
            const context = canvas.getContext("2d")!;
            context.drawImage(full, rect.x, rect.y, rect.width, rect.height, 0, 0, rect.width, rect.height);
            return context.getImageData(0, 0, rect.width, rect.height).data;
        },
        destroy() {
            for (const each of tiles.values()) backend.free(each.texture);
            backend.free(overview);
            if (whole !== full) whole.close();
            full.close();
        },
    };
}

/** A picture kept on the card. */
export type Loaded = Awaited<ReturnType<typeof loadPicture>>;

// a grade's numbers, worked out once for each grade and space, so that a frame drawn again reads them once
const readied = new WeakMap<Grade, Map<Space, Prepared>>();
/** A grade made into numbers for a space, kept for as long as the grade is. */
export function prepared(grade: Grade, name: Space): Prepared {
    let found = readied.get(grade);
    if (!found) readied.set(grade, (found = new Map()));
    let ready = found.get(name);
    if (!ready) found.set(name, (ready = prepare(grade, name)));
    return ready;
}

/**
 * What the card grades a look with, or nothing when its grades change nothing. Worked out again only
 * when the look's grades or the masks are others than last time, so drawing a frame again packs nothing.
 */
export function gradingFor(look: Look, name: Space, picture: { width: number; height: number }, masks?: MaskStack, layers: (id: string) => { layer?: number; invert?: boolean } = () => ({}), convert = false): Grading | undefined {
    const live = look.grades.filter((each) => !isNeutral(each.grade));
    if (!live.length && !convert) return undefined;
    const last = lastGrading;
    const turn = turnNumbers(look.turn ?? 0, picture);
    if (last && last.name === name && last.convert === convert && JSON.stringify(last.grading.turn) === JSON.stringify(turn) && last.masks === masks && last.grading.picture.width === picture.width && last.grading.picture.height === picture.height && last.grades.length === live.length && last.grades.every((each, at) => each.grade === live[at]!.grade && each.id === live[at]!.id && JSON.stringify(last.layers[at]) === JSON.stringify(layers(each.id)))) return last.grading;
    const list: PackedGrade[] = live.map((each) => ({ ready: prepared(each.grade, name), ...layers(each.id) }));
    const grading: Grading = { packed: pack(list), numbers: space(name), picture, ...(masks ? { masks } : {}), ...(convert ? { convert } : {}), ...(turn ? { turn } : {}) };
    lastGrading = { name, convert, masks, grades: live, layers: live.map((each) => layers(each.id)), grading };
    return grading;
}
/** What the card grades a look with, its parts' masks drawn and stacked (masks.ts), made sRGB after if `convert`; nothing when nothing would change. */
export function gradingWith(look: Look, name: Space, picture: { width: number; height: number }, convert = false): Grading | undefined {
    const stacked = stackFor(look.grades, picture);
    return gradingFor(look, name, picture, stacked.stack, stacked.layers, convert);
}
let lastGrading: { name: Space; convert: boolean; masks?: MaskStack; grades: Look["grades"]; layers: { layer?: number; invert?: boolean }[]; grading: Grading } | undefined;

/** A turn in degrees as the card takes it: its cosine, its sine and the original's middle, which it turns about; nothing for no turn. */
export function turnNumbers(degrees: number, picture: { width: number; height: number }): [number, number, number, number] | undefined {
    if (!degrees) return undefined;
    const radians = (degrees * Math.PI) / 180;
    return [Math.cos(radians), Math.sin(radians), picture.width / 2, picture.height / 2];
}
