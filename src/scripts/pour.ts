// A picture that has just arrived is poured in: its place, which was holding one calm color taken
// from the picture, opens in a few blobs that swell from different points, wobble and run together
// until the whole picture shows. The blobs are worked out here, frame by frame, and the same picture
// always pours the same way. Nothing is drawn for a picture that was already there, or for anyone
// who has asked for less motion.
//
//   pour(img)                 pours a picture that has arrived, over its own color
//   watchPictures(document)   pours each marked picture (`data-pour`) as it arrives

import { still } from "./opening";

/** How a pour goes: how long it takes in milliseconds, and how many blobs there are. */
export interface Pouring {
    time: number;
    blobs: number;
}

const USUAL: Pouring = { time: 620, blobs: 5 };
const SVG = "http://www.w3.org/2000/svg";
let made = 0;

/** A number from a picture's address, so that each picture has its own blobs and always the same ones. */
export function seedOf(text: string): number {
    let hash = 2166136261;
    for (let at = 0; at < text.length; at++) hash = Math.imul(hash ^ text.charCodeAt(at), 16777619);
    return hash >>> 0;
}

/** Numbers from 0 to 1 that follow from a seed, the same every time. */
export function numbers(seed: number): () => number {
    let state = seed || 1;
    return () => {
        state = (state + 0x6d2b79f5) | 0;
        let mixed = Math.imul(state ^ (state >>> 15), 1 | state);
        mixed = (mixed + Math.imul(mixed ^ (mixed >>> 7), 61 | mixed)) ^ mixed;
        return ((mixed ^ (mixed >>> 14)) >>> 0) / 4294967296;
    };
}

/** One blob: where it swells from (as shares of the frame), when it starts (a share of the whole time), and the waves round its edge. */
export interface Blob {
    x: number;
    y: number;
    starts: number;
    waves: { count: number; size: number; phase: number; turns: number }[];
}

/** The blobs of a pour: spread over the frame, one to each part of it, so that no corner waits for a blob from the far side. */
export function blobsFor(seed: number, count: number): Blob[] {
    const next = numbers(seed);
    const across = Math.ceil(Math.sqrt(count * 1.5));
    const down = Math.ceil(count / across);
    const cells = Array.from({ length: across * down }, (_, at) => at);
    // the cells are taken in an order of chance, so that with fewer blobs than cells the empty cell is not always the same one
    for (let at = cells.length - 1; at > 0; at--) {
        const other = Math.floor(next() * (at + 1));
        [cells[at], cells[other]] = [cells[other]!, cells[at]!];
    }
    return cells.slice(0, count).map((cell, order) => ({
        x: ((cell % across) + 0.25 + next() * 0.5) / across,
        y: (Math.floor(cell / across) + 0.25 + next() * 0.5) / down,
        starts: (order / count) * 0.22,
        waves: [2, 3, 5].map((waves) => ({ count: waves, size: (0.2 + next() * 0.16) / waves, phase: next() * Math.PI * 2, turns: (next() - 0.5) * 3 })),
    }));
}

/** Slow to start, quick through the middle, slow to rest. */
const eased = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);

/**
 * The outline of one blob at a moment of the pour (0 to 1), in the frame's pixels, as an SVG path.
 * Its reach grows until it passes the frame's far corner; its waves are large while it is small and
 * are gone by the end, so that the last frame is the whole frame and nothing else.
 */
export function outline(blob: Blob, at: number, width: number, height: number): string {
    const local = Math.min(1, Math.max(0, (at - blob.starts) / (1 - blob.starts)));
    if (local <= 0) return "";
    const cx = blob.x * width;
    const cy = blob.y * height;
    const far = Math.hypot(Math.max(cx, width - cx), Math.max(cy, height - cy)) * 1.12;
    const reach = far * eased(local);
    const lively = 1 - local;
    const points = 40;
    let path = "";
    for (let point = 0; point < points; point++) {
        const angle = (point / points) * Math.PI * 2;
        let wobble = 1;
        for (const wave of blob.waves) wobble += wave.size * lively * Math.sin(wave.count * angle + wave.phase + wave.turns * local * Math.PI * 2);
        const x = cx + Math.cos(angle) * reach * wobble;
        const y = cy + Math.sin(angle) * reach * wobble;
        path += `${point ? "L" : "M"}${x.toFixed(1)} ${y.toFixed(1)}`;
    }
    return `${path}Z`;
}

/** The rounding an element's corners have, its own or that of what clips it, for the cover laid over it. */
function roundingOf(img: HTMLElement): string {
    for (let element: HTMLElement | null = img; element && element !== img.offsetParent; element = element.parentElement) {
        const style = getComputedStyle(element);
        if (style.borderRadius !== "0px" && (element === img || style.overflow !== "visible")) return style.borderRadius;
    }
    return "0px";
}

/**
 * Pours a picture in over its own color: a cover of that color is laid on it, with a hole for each
 * blob, and the holes grow until nothing of the cover is left. Resolves when the picture is whole.
 */
export function pour(img: HTMLImageElement, how: Partial<Pouring> = {}): Promise<void> {
    const { time, blobs: count } = { ...USUAL, ...how };
    const width = img.offsetWidth;
    const height = img.offsetHeight;
    const home = img.offsetParent ?? img.parentElement;
    if (still.matches || !home || width < 2 || height < 2) return Promise.resolve();
    const color = img.dataset.pour || getComputedStyle(img).backgroundColor;
    const id = `pour-${++made}`;
    const cover = document.createElementNS(SVG, "svg");
    cover.setAttribute("viewBox", `0 0 ${width} ${height}`);
    cover.setAttribute("aria-hidden", "true");
    Object.assign(cover.style, { position: "absolute", left: `${img.offsetLeft}px`, top: `${img.offsetTop}px`, width: `${width}px`, height: `${height}px`, pointerEvents: "none", borderRadius: roundingOf(img), overflow: "hidden" });
    const mask = document.createElementNS(SVG, "mask");
    mask.id = id;
    mask.setAttribute("maskUnits", "userSpaceOnUse");
    const whole = document.createElementNS(SVG, "rect");
    whole.setAttribute("width", String(width));
    whole.setAttribute("height", String(height));
    whole.setAttribute("fill", "#fff");
    mask.append(whole);
    const shapes = blobsFor(seedOf(img.currentSrc || img.src), count);
    const holes = shapes.map(() => {
        const hole = document.createElementNS(SVG, "path");
        hole.setAttribute("fill", "#000");
        mask.append(hole);
        return hole;
    });
    const ground = document.createElementNS(SVG, "rect");
    ground.setAttribute("width", String(width));
    ground.setAttribute("height", String(height));
    ground.setAttribute("fill", color);
    ground.setAttribute("mask", `url(#${id})`);
    cover.append(mask, ground);
    img.after(cover);
    return new Promise((done) => {
        const started = performance.now();
        const frame = (now: number) => {
            const at = Math.min(1, (now - started) / time);
            shapes.forEach((shape, index) => holes[index]!.setAttribute("d", outline(shape, at, width, height)));
            if (at < 1 && cover.isConnected) return void requestAnimationFrame(frame);
            cover.remove();
            done();
        };
        requestAnimationFrame(frame);
    });
}

/**
 * Pours each marked picture under `root` as it arrives. One that is already there when this is
 * called, or that came out of the browser's own keeping without being fetched, simply shows.
 */
export function watchPictures(root: Document | HTMLElement = document): void {
    if (still.matches) return;
    root.addEventListener(
        "load",
        (event) => {
            const img = event.target;
            if (!(img instanceof HTMLImageElement) || img.dataset.pour === undefined || img.dataset.poured !== undefined) return;
            img.dataset.poured = "";
            const fetched = performance.getEntriesByName(img.currentSrc || img.src).at(-1) as PerformanceResourceTiming | undefined;
            if (fetched && fetched.transferSize === 0 && fetched.decodedBodySize > 0) return;
            void pour(img);
        },
        // (a picture's arriving does not bubble, so it is listened for on the way down)
        true,
    );
    for (const img of root.querySelectorAll<HTMLImageElement>("img[data-pour]")) if (img.complete && img.naturalWidth) img.dataset.poured = "";
}
