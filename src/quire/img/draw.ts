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

import { webgl2 } from "./gl";
import { webgpu } from "./gpu";
import { drawMarks } from "./marks";
import type { Filter, Look, Rect } from "./steps";

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

/** One image drawn on the screen: a texture, the rectangle of the canvas it fills, and whether its pixels are drawn as squares (zoomed in) or smoothed. */
export interface Drawn {
    texture: Texture;
    to: Rect;
    sharp: boolean;
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
    /** Draws the canvas: its ground, the images, clipped to `clip` if given, then solid rectangles over them. Rectangles are in the canvas's pixels. */
    draw(images: Drawn[], fills: { rect: Rect; color: Color }[], clip?: Rect): void;
    /** Resamples one piece: the part of the original given, covers painted into it, then the two passes, giving the result's pixels, RGBA, row by row from the top. */
    resample(part: ImageBitmap, covers: { rect: Rect; color: Color }[], piece: Piece): Promise<Uint8Array>;
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
    /** The canvas's size in its own pixels. */
    canvas: { width: number; height: number };
}

/** Where a look's pixels fall in the result: the result's pixels per pixel of the original each way, and where the original's corner falls. */
export const resultPlace = (look: Look) => {
    const across = look.width / look.crop.width;
    const down = look.height / look.crop.height;
    return { across, down, x: -look.crop.x * across, y: -look.crop.y * down };
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
        /** Draws the picture on the canvas as the scene says. */
        draw(scene: Scene, again?: () => void) {
            drawAgain = again;
            const { look, view } = scene;
            const shown = scene.cropping ?? look.crop;
            // canvas pixels per pixel of the original: a resize is seen as the picture drawn larger or smaller
            const across = scene.cropping ? view.scale : (view.scale * look.width) / look.crop.width;
            const down = scene.cropping ? view.scale : (view.scale * look.height) / look.crop.height;
            const place = (rect: Rect): Rect => ({ x: view.x + (rect.x - shown.x) * across, y: view.y + (rect.y - shown.y) * down, width: rect.width * across, height: rect.height * down });
            const sharp = across >= 1 - 1e-6;
            const images: Drawn[] = [{ texture: overview, to: place({ x: 0, y: 0, ...size }), sharp: sharp && whole === full }];
            // zoomed in beyond the smaller copy: the full-size pieces in sight, drawn over it
            if (whole !== full && across > (whole.width / size.width) * 1.05) {
                for (let row = 0; row * PIECE < size.height; row++)
                    for (let column = 0; column * PIECE < size.width; column++) {
                        const to = place({ x: column * PIECE, y: row * PIECE, width: Math.min(PIECE, size.width - column * PIECE), height: Math.min(PIECE, size.height - row * PIECE) });
                        if (to.x > scene.canvas.width || to.y > scene.canvas.height || to.x + to.width < 0 || to.y + to.height < 0) continue;
                        const texture = tile(column, row);
                        if (texture) images.push({ texture, to, sharp });
                        else void makeTile(column, row);
                    }
            }
            const fills = look.covers.map((cover) => ({ rect: place(cover.rect), color: rgba(cover.color) }));
            if (scene.cropping) {
                // the outside of the crop dimmed, so the frame shows what is kept
                const inside = place(look.crop);
                const all = place({ x: 0, y: 0, ...size });
                const dim: Color = [0, 0, 0, 0.55];
                fills.push(
                    { rect: { x: all.x, y: all.y, width: all.width, height: inside.y - all.y }, color: dim },
                    { rect: { x: all.x, y: inside.y + inside.height, width: all.width, height: all.y + all.height - inside.y - inside.height }, color: dim },
                    { rect: { x: all.x, y: inside.y, width: inside.x - all.x, height: inside.height }, color: dim },
                    { rect: { x: inside.x + inside.width, y: inside.y, width: all.x + all.width - inside.x - inside.width, height: inside.height }, color: dim },
                );
            }
            backend.draw(images, fills, scene.cropping ? undefined : place(look.crop));
        },
        /** The picture as it looks, at full size: its pixels, the covers painted in before resampling so that nothing they hide is read, and the marks drawn over. */
        async flatten(look: Look, most = PIECE): Promise<ImageData> {
            const result = new ImageData(look.width, look.height);
            for (const piece of plan(look, Math.min(most, backend.most))) {
                const part = await createImageBitmap(full, piece.source.x, piece.source.y, piece.source.width, piece.source.height, { colorSpaceConversion: "none", premultiplyAlpha: "none" });
                const covers = look.covers.map((cover) => ({ rect: { x: cover.rect.x - piece.source.x, y: cover.rect.y - piece.source.y, width: cover.rect.width, height: cover.rect.height }, color: rgba(cover.color) }));
                const pixels = await backend.resample(part, covers, piece);
                part.close();
                for (let row = 0; row < piece.out.height; row++) result.data.set(pixels.subarray(row * piece.out.width * 4, (row + 1) * piece.out.width * 4), ((piece.out.y + row) * look.width + piece.out.x) * 4);
            }
            if (look.marks.length) {
                const canvas = new OffscreenCanvas(look.width, look.height);
                const context = canvas.getContext("2d")!;
                context.putImageData(result, 0, 0);
                drawMarks(context, look.marks, resultPlace(look));
                return context.getImageData(0, 0, look.width, look.height);
            }
            return result;
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
