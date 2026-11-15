// The Grade surface's histogram and waveform, worked out in a worker of their own from a small copy
// of the picture, so that a slider dragged never waits for them. The copy and the parts' masks are
// sent once; each grade after that is a few numbers, graded here by the reference arithmetic (fix.ts)
// and counted. Only the newest grade asked for is worked out: one that arrives while another is being
// counted takes its place. This file is both sides, as read/engine.ts is: `serve` in the worker,
// `createMeasure` on the page.
//
//   const measure = createMeasure();
//   measure.picture(await loaded.small(200), loaded.size);
//   measure.grade(layers, crop, "srgb", (counts) => draw(counts));

import { gradeImage, histogram, waveform, type Layer } from "./fix";
import type { Prepared, Space } from "./grade";
import { maskReader, type PackedGrade } from "./grade-shader";
import type { Rect } from "./steps";

/** The waveform's size: columns across, levels up. */
export const WAVE = { columns: 120, rows: 64 };

/** What the page sends: the small copy, the masks, or a grade to count. */
export type Ask =
    | { type: "picture"; small: { width: number; height: number; data: Uint8ClampedArray }; size: { width: number; height: number } }
    | { type: "masks"; masks?: { width: number; height: number; layers: Float32Array[] } }
    | { type: "grade"; id: number; layers: PackedGrade[]; crop: Rect; space: Space };

/** What the worker answers: the counts for a grade. */
export interface Counts {
    id: number;
    red: Uint32Array;
    green: Uint32Array;
    blue: Uint32Array;
    luma: Uint32Array;
    wave: Uint32Array;
}

/** What the worker keeps between messages. */
export interface Kept {
    small?: { width: number; height: number; data: Uint8ClampedArray };
    size?: { width: number; height: number };
    masks?: { width: number; height: number; layers: Float32Array[] };
}

/** The counts of a grade: the small copy's part inside the crop, graded by the layers, its histogram and waveform. */
export function countsOf(kept: Kept, ask: Extract<Ask, { type: "grade" }>): Counts | undefined {
    const { small, size } = kept;
    if (!small || !size) return undefined;
    // the part of the small copy inside the crop
    const sx = small.width / size.width;
    const sy = small.height / size.height;
    const left = Math.max(0, Math.floor(ask.crop.x * sx));
    const top = Math.max(0, Math.floor(ask.crop.y * sy));
    const width = Math.max(1, Math.min(small.width - left, Math.ceil((ask.crop.x + ask.crop.width) * sx) - left));
    const height = Math.max(1, Math.min(small.height - top, Math.ceil((ask.crop.y + ask.crop.height) * sy) - top));
    const part = new Uint8ClampedArray(width * height * 4);
    for (let row = 0; row < height; row++) part.set(small.data.subarray(((top + row) * small.width + left) * 4, ((top + row) * small.width + left + width) * 4), row * width * 4);
    const masks = kept.masks;
    const layers: Layer[] = ask.layers.map((each) => {
        const layer = each.layer !== undefined && masks?.layers[each.layer];
        if (!layer) return { ready: each.ready as Prepared };
        const read = maskReader(layer, masks!, size);
        return { ready: each.ready as Prepared, mask: each.invert ? (x, y) => 1 - read(x, y) : read };
    });
    const graded = gradeImage({ width, height, data: part }, layers, ask.space, (x, y) => ({ x: (left + x + 0.5) / sx, y: (top + y + 0.5) / sy }));
    const counts = histogram(graded.data, ask.space);
    return { id: ask.id, ...counts, wave: waveform(graded, WAVE.columns, WAVE.rows, ask.space) };
}

/** Answers one message, in the worker: keeps the copy or the masks, or counts a grade. */
export function serve(kept: Kept, ask: Ask): Counts | undefined {
    if (ask.type === "picture") {
        kept.small = ask.small;
        kept.size = ask.size;
        return undefined;
    }
    if (ask.type === "masks") {
        kept.masks = ask.masks;
        return undefined;
    }
    return countsOf(kept, ask);
}

const inWorker = typeof self !== "undefined" && typeof (self as { importScripts?: unknown }).importScripts === "function";
if (inWorker) {
    const kept: Kept = {};
    let waiting: Extract<Ask, { type: "grade" }> | undefined;
    let busy = false;
    // the newest grade waits while one is counted; older ones are dropped, so the counts follow a drag without falling behind
    const next = () => {
        if (busy || !waiting) return;
        const ask = waiting;
        waiting = undefined;
        busy = true;
        setTimeout(() => {
            const counts = serve(kept, ask);
            if (counts) (self as unknown as Worker).postMessage(counts);
            busy = false;
            next();
        });
    };
    self.onmessage = (event: MessageEvent<Ask>) => {
        if (event.data.type === "grade") {
            waiting = event.data;
            next();
        } else serve(kept, event.data);
    };
}

/**
 * The page's side: the worker made the first time it is wanted; each grade sent, and the counts of the
 * newest handed back. Where no worker can be made (a page that cannot load one), the same work is done
 * here, the newest grade only, between frames.
 */
export function createMeasure(make: () => Worker = () => new Worker(new URL("./measure.ts", import.meta.url), { type: "module" })) {
    let worker: Worker | undefined;
    let id = 0;
    let told: ((counts: Counts) => void) | undefined;
    // the work done on this side when there is no worker: what was sent, kept, and the newest grade waiting
    let here: Kept | undefined;
    const sent: Ask[] = [];
    let waiting: Extract<Ask, { type: "grade" }> | undefined;
    const byHand = () => {
        if (!here) {
            here = {};
            for (const ask of sent) serve(here, ask);
        }
        setTimeout(() => {
            const ask = waiting;
            waiting = undefined;
            const counts = ask && serve(here!, ask);
            if (counts && counts.id === id) told?.(counts);
        });
    };
    const send = (ask: Ask, transfer: Transferable[] = []) => {
        if (ask.type !== "grade") sent.splice(ask.type === "picture" ? 0 : sent.length, ask.type === "picture" ? sent.length : 0, ask);
        if (here) {
            if (ask.type === "grade") {
                const first = !waiting;
                waiting = ask;
                if (first) byHand();
            } else serve(here, ask);
            return;
        }
        try {
            if (!worker) {
                worker = make();
                worker.onmessage = (event: MessageEvent<Counts>) => {
                    if (event.data.id === id) told?.(event.data);
                };
                worker.onerror = () => {
                    worker?.terminate();
                    worker = undefined;
                    if (!here) byHand();
                };
            }
            worker.postMessage(ask, ask.type === "picture" ? [] : transfer);
            if (ask.type === "grade") waiting = ask;
        } catch {
            worker = undefined;
            if (ask.type === "grade") waiting = ask;
            byHand();
        }
    };
    return {
        /** Sends the small copy of the picture and the original's size. */
        picture(small: ImageData, size: { width: number; height: number }) {
            send({ type: "picture", small: { width: small.width, height: small.height, data: new Uint8ClampedArray(small.data) }, size });
        },
        /** Sends the parts' masks, or none. */
        masks(masks: { width: number; height: number; layers: Float32Array[] } | undefined) {
            send({ type: "masks", masks });
        },
        /** Counts a grade; `then` is told the counts of the newest grade asked for. */
        grade(layers: PackedGrade[], crop: Rect, space: Space, then: (counts: Counts) => void) {
            told = then;
            send({ type: "grade", id: ++id, layers, crop, space });
        },
        destroy() {
            worker?.terminate();
            worker = undefined;
        },
    };
}

/** The measuring, as the editor holds it. */
export type Measure = ReturnType<typeof createMeasure>;
