// Getting a picture out: the formats it can be written in, each one entry in a table (`FORMATS`), so
// that a later encoder (AVIF, JPEG XL, docs/imgQuire-codecs.md) is a line added here; a quality, or a
// weight to come in under that the quality is searched for; the name a saved file gets; and the
// clipboard, which takes PNG only. What the browser writes carries no metadata at all, so where,
// when and with what a photograph was taken never leaves with it; an original given out unchanged
// has those cut out without being encoded again (core/picture-bytes.ts).

import { crc32 } from "../core/zip";
import { withoutMetadata } from "../core/picture-bytes";
import { fileName } from "../core/store";

/** A format a picture can be written in, and how. `lossy` says whether a quality and a weight to aim for mean anything. */
export interface Format {
    key: string;
    label: string;
    type: string;
    ending: string;
    lossy: boolean;
    encode(pixels: ImageData, quality: number): Promise<Blob>;
}

/** Writes pixels through the browser's own encoder, onto white for a format with no transparency. */
const browser =
    (type: string, solid = false) =>
    async (pixels: ImageData, quality: number): Promise<Blob> => {
        const canvas = new OffscreenCanvas(pixels.width, pixels.height);
        const context = canvas.getContext("2d")!;
        context.putImageData(pixels, 0, 0);
        if (solid) {
            const flat = new OffscreenCanvas(pixels.width, pixels.height);
            const under = flat.getContext("2d")!;
            under.fillStyle = "#ffffff";
            under.fillRect(0, 0, pixels.width, pixels.height);
            under.drawImage(canvas, 0, 0);
            return flat.convertToBlob({ type, quality });
        }
        return canvas.convertToBlob({ type, quality });
    };

/** The formats, in the order they are offered. The browser writes these three; the encoders built later add theirs here. */
export const FORMATS: Format[] = [
    { key: "png", label: "PNG", type: "image/png", ending: ".png", lossy: false, encode: browser("image/png") },
    { key: "jpeg", label: "JPEG", type: "image/jpeg", ending: ".jpg", lossy: true, encode: browser("image/jpeg", true) },
    { key: "webp", label: "WebP", type: "image/webp", ending: ".webp", lossy: true, encode: browser("image/webp") },
];

/** A format by its key, PNG if there is no such one. */
export const formatOf = (key: string): Format => FORMATS.find((format) => format.key === key) ?? FORMATS[0]!;

/** How a picture is to be exported: its format, its quality from 0 to 1, and a weight in bytes to come in under, if one is set. */
export interface Settings {
    format: string;
    quality: number;
    target?: number;
}

/** What a picture is exported as when nothing has been chosen: WebP at 0.85, the site's own format. */
export const SETTINGS: Settings = { format: "webp", quality: 0.85 };

/** Settings from what was kept in the browser, checked, with the default for what is missing or wrong. */
export function readSettings(text: string | null | undefined): Settings {
    try {
        const kept = JSON.parse(text ?? "null") as Partial<Settings> | null;
        const quality = typeof kept?.quality === "number" && kept.quality >= 0.05 && kept.quality <= 1 ? kept.quality : SETTINGS.quality;
        const target = typeof kept?.target === "number" && kept.target >= 1_000 && kept.target <= 100_000_000 ? Math.round(kept.target) : undefined;
        return { format: formatOf(String(kept?.format ?? SETTINGS.format)).key, quality, ...(target ? { target } : {}) };
    } catch {
        return { ...SETTINGS };
    }
}

/**
 * The highest quality whose result comes in under `target` bytes, found by halving the range seven
 * times (to within a hundredth). When even the lowest is heavier, it is given with `over` set, for the
 * panel to say so.
 */
export async function underWeight(encode: (quality: number) => Promise<Blob>, target: number, lowest = 0.05, highest = 0.95): Promise<{ blob: Blob; quality: number; over: boolean }> {
    const best = await encode(highest);
    if (best.size <= target) return { blob: best, quality: highest, over: false };
    let low = lowest;
    let high = highest;
    let found: { blob: Blob; quality: number } | undefined;
    for (let step = 0; step < 7; step++) {
        const middle = (low + high) / 2;
        const blob = await encode(middle);
        if (blob.size <= target) {
            found = { blob, quality: middle };
            low = middle;
        } else high = middle;
    }
    if (found) return { ...found, over: false };
    const blob = await encode(lowest);
    return { blob, quality: lowest, over: blob.size > target };
}

/** Exports pixels as the settings say: at the quality given, or searched for under the weight set. */
export async function encodeAs(pixels: ImageData, settings: Settings): Promise<{ blob: Blob; quality: number; over: boolean }> {
    const format = formatOf(settings.format);
    if (format.lossy && settings.target) return underWeight((quality) => format.encode(pixels, quality), settings.target);
    const blob = await format.encode(pixels, settings.quality);
    return { blob, quality: settings.quality, over: !!settings.target && blob.size > settings.target };
}

/** The original's own bytes with where, when and with what it was taken cut out, nothing else changed, for a picture given out with no steps in its own format. */
export function untouched(bytes: Uint8Array): Uint8Array {
    return withoutMetadata(bytes, crc32);
}

/** The name a saved picture gets: the document's name made a plain file name, with the format's ending. */
export function exportName(name: string, format: Format): string {
    return fileName(name.replace(/\.(quire|md|mdx|markdown|txt|png|jpe?g|webp|gif|avif|bmp)$/i, "").replace(/[,;]/g, ""), format.ending);
}

/** A weight in bytes as a few characters: "940 B", "412 KB", "3.4 MB". */
export function weightSaid(bytes: number): string {
    if (bytes < 1000) return `${bytes} B`;
    if (bytes < 1_000_000) return `${Math.round(bytes / 1000)} KB`;
    return `${(bytes / 1_000_000).toFixed(bytes < 10_000_000 ? 1 : 0)} MB`;
}

/** A weight typed in a field ("200", "200 KB", "1.5 MB") as bytes; a bare number is kilobytes. Undefined when it is not one. */
export function readWeight(text: string): number | undefined {
    const found = /^\s*(\d+(?:\.\d+)?)\s*(b|kb|k|mb|m)?\s*$/i.exec(text);
    if (!found) return undefined;
    const unit = (found[2] ?? "kb").toLowerCase();
    const bytes = Number(found[1]) * (unit === "b" ? 1 : unit.startsWith("m") ? 1_000_000 : 1000);
    return bytes >= 1000 ? Math.round(bytes) : undefined;
}

/** Puts a picture on the clipboard as PNG, the one kind of picture every browser's clipboard takes. */
export async function copyPicture(png: Blob | Promise<Blob>): Promise<void> {
    await navigator.clipboard.write([new ClipboardItem({ "image/png": png })]);
}
