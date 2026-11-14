// Getting a picture out: the formats it can be written in, each one entry in a table (`FORMATS`); a
// quality, or a weight to come in under that the quality is searched for; the name a saved file gets;
// and the clipboard, which takes PNG only. The encoders are the reference ones built to WebAssembly
// (codecs/build.sh, docs/imgQuire-codecs.md): jpegli for JPEG, libwebp for WebP, libaom for AVIF,
// libjxl for JPEG XL and oxipng for PNG, each fetched only when its format is picked (codec-run.ts);
// should one not arrive, JPEG, WebP and PNG fall back to the browser's own. None of them writes
// metadata, so where, when and with what a photograph was taken never leaves with it; an original
// given out unchanged has those cut out without being encoded again (core/picture-bytes.ts).

import { crc32 } from "../core/zip";
import { withoutMetadata } from "../core/picture-bytes";
import { fileName } from "../core/store";
import { encodeWith } from "./codec-run";
import { withMetadata } from "./metadata";

/** A format a picture can be written in, and how. `lossy` says whether a quality and a weight to aim for mean anything; `short` is its button's word, `tip` what it is good for. */
export interface Format {
    key: string;
    label: string;
    short: string;
    tip: string;
    type: string;
    ending: string;
    lossy: boolean;
    encode(pixels: ImageData, quality: number, meta?: Meta): Promise<Blob>;
}

/** The metadata that goes out with a picture, as metadata.ts makes it: an Exif block, an XMP packet, IPTC records. */
export type Meta = { exif?: Uint8Array; xmp?: string; iptc?: Uint8Array };

/** Pixels laid on white, for a format with no transparency, so that what was clear is white rather than black. */
export function onWhite(pixels: Uint8ClampedArray): Uint8ClampedArray<ArrayBuffer> {
    const flat = new Uint8ClampedArray(pixels);
    for (let at = 0; at < flat.length; at += 4) {
        const alpha = flat[at + 3]! / 255;
        if (alpha === 1) continue;
        for (let channel = 0; channel < 3; channel++) flat[at + channel] = Math.round(flat[at + channel]! * alpha + 255 * (1 - alpha));
        flat[at + 3] = 255;
    }
    return flat;
}

/** Writes pixels with one of the encoders built to WebAssembly, at its speed and with its options (0 = lossless), and with the browser's own encoder if that one cannot be had. */
const coded =
    (name: string, type: string, speed: number, options: Record<number, number> = {}, solid = false, otherwise?: (pixels: ImageData, quality: number) => Promise<Blob>) =>
    async (pixels: ImageData, quality: number, meta: Meta = {}): Promise<Blob> => {
        const given = solid ? new ImageData(onWhite(pixels.data), pixels.width, pixels.height) : pixels;
        // AVIF's encoder writes the metadata into its file itself; the others' files take it afterwards
        const itself = name === "avif" ? { exif: meta.exif, xmp: meta.xmp === undefined ? undefined : new TextEncoder().encode(meta.xmp) } : undefined;
        let made: Blob;
        try {
            made = await encodeWith(name, given, Math.round(quality * 100), speed, options, type, itself);
        } catch (error) {
            if (!otherwise) throw error;
            made = await otherwise(given, quality);
        }
        if (itself || (!meta.exif && !meta.xmp && !meta.iptc)) return made;
        return new Blob([withMetadata(new Uint8Array(await made.arrayBuffer()), meta, crc32, pixels) as BlobPart], { type });
    };

/** Writes pixels through the browser's own encoder, for when one built to WebAssembly cannot be had. */
const browser =
    (type: string) =>
    async (pixels: ImageData, quality: number): Promise<Blob> => {
        const canvas = new OffscreenCanvas(pixels.width, pixels.height);
        canvas.getContext("2d")!.putImageData(pixels, 0, 0);
        return canvas.convertToBlob({ type, quality });
    };

/**
 * The formats, the lossy ones first, in the order they are offered. Speeds are the codec notes'
 * defaults for one thread: WebP method 4, AVIF speed 8, JPEG XL effort 3, oxipng level 2, WebP
 * lossless preset 6.
 */
export const FORMATS: Format[] = [
    { key: "jpeg", label: "JPEG", short: "JPEG", tip: "Photographs, opened by anything", type: "image/jpeg", ending: ".jpg", lossy: true, encode: coded("jpegli", "image/jpeg", 0, {}, true, browser("image/jpeg")) },
    { key: "webp", label: "WebP", short: "WebP", tip: "Photographs on the web, smaller than JPEG", type: "image/webp", ending: ".webp", lossy: true, encode: coded("webp", "image/webp", 4, {}, false, browser("image/webp")) },
    { key: "avif", label: "AVIF", short: "AVIF", tip: "The smallest photographs, slower to make", type: "image/avif", ending: ".avif", lossy: true, encode: coded("avif", "image/avif", 8) },
    { key: "jxl", label: "JPEG XL", short: "JXL", tip: "Small and sharp; not every browser shows it", type: "image/jxl", ending: ".jxl", lossy: true, encode: coded("jxl", "image/jxl", 3) },
    { key: "png", label: "PNG", short: "PNG", tip: "Screenshots, every pixel kept, opened by anything", type: "image/png", ending: ".png", lossy: false, encode: coded("oxipng", "image/png", 2, {}, false, browser("image/png")) },
    { key: "webp-lossless", label: "WebP lossless", short: "WebP", tip: "Screenshots, every pixel kept, smaller than PNG", type: "image/webp", ending: ".webp", lossy: false, encode: coded("webp", "image/webp", 6, { 0: 1 }) },
    { key: "jxl-lossless", label: "JPEG XL lossless", short: "JXL", tip: "Every pixel kept, the smallest; not every browser shows it", type: "image/jxl", ending: ".jxl", lossy: false, encode: coded("jxl", "image/jxl", 3, { 0: 1 }) },
];

/** A format by its key, PNG if there is no such one. */
export const formatOf = (key: string): Format => FORMATS.find((format) => format.key === key) ?? FORMATS.find((format) => format.key === "png")!;

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

/** Exports pixels as the settings say: at the quality given, or searched for under the weight set, with the metadata given. */
export async function encodeAs(pixels: ImageData, settings: Settings, meta: Meta = {}): Promise<{ blob: Blob; quality: number; over: boolean }> {
    const format = formatOf(settings.format);
    if (format.lossy && settings.target) return underWeight((quality) => format.encode(pixels, quality, meta), settings.target);
    const blob = await format.encode(pixels, settings.quality, meta);
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
