// Pictures through the converter: imgQuire's export with no editing. A picture is read by the browser
// (or, for a phone's HEIC photograph, by imgQuire's HEIC reader), made smaller if asked (a largest side
// or a share of its size, never larger than it came), and written by imgQuire's own encoders with the
// quality chosen or the highest quality that comes in under a weight, carrying what was chosen of its
// metadata (all of it, all but the place, or none). The encoders and the metadata writer are imgQuire's,
// handed in by the page script (src/scripts/convert.ts) as an engine, since one kind of the suite never
// imports another.
//
//   `done = await convertPicture(file, engine, { format: "webp", quality: 0.85, size: { by: "side", value: 2048 }, keep: "all" }, signal, told);`

/** A format a picture can be written in, as imgQuire's export table gives it. */
export interface PictureFormat {
    key: string;
    label: string;
    short: string;
    tip: string;
    type: string;
    ending: string;
    lossy: boolean;
}

/** What of a picture's metadata goes with it, as imgQuire's export says it. */
export type Keep = "none" | "noplace" | "all";

/** imgQuire's pieces that do the work, handed in by the page script. */
export interface PictureEngine {
    formats: PictureFormat[];
    /** Writes pixels as the settings say, searching the quality when a weight is set; `tried` is told after each attempt. */
    encode(pixels: ImageData, settings: { format: string; quality: number; target?: number }, meta: { exif?: Uint8Array; xmp?: string; iptc?: Uint8Array }, tried: () => void): Promise<{ blob: Blob; quality: number; over: boolean }>;
    /** The metadata blocks of the original that go out, as kept. */
    metadata(original: Uint8Array, keep: Keep): { exif?: Uint8Array; xmp?: string; iptc?: Uint8Array };
    /** Whether a file's first bytes say it is HEIC. */
    isHeic(head: Uint8Array): boolean;
    /** Reads a HEIC photograph into pixels. */
    decodeHeic(file: Blob): Promise<ImageData>;
}

/** How big the result is: as it came, a largest side in pixels, or a share of its size in percent. */
export type PictureSize = { by: "same" } | { by: "side"; value: number } | { by: "percent"; value: number };

/** What a picture becomes. */
export interface PictureChoice {
    format: string;
    quality: number;
    target?: number;
    size: PictureSize;
    keep: Keep;
}

/** The size a picture is made: never larger than it came, at least one pixel, its shape kept. */
export function sizeFor(width: number, height: number, size: PictureSize): { width: number; height: number } {
    let scale = 1;
    if (size.by === "side") scale = Math.min(1, size.value / Math.max(width, height));
    else if (size.by === "percent") scale = Math.min(1, size.value / 100);
    return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
}

/** How many times the encoder runs for a choice: once, or for a weight the quality search's nine at most. */
export function attemptsFor(choice: Pick<PictureChoice, "target">, lossy: boolean): number {
    return lossy && choice.target ? 9 : 1;
}

/** A plain sentence for a picture this browser could not read. */
export const UNREADABLE = "This browser cannot read this picture.";

/** Throws when the work was stopped, so that the next step is not taken. */
function check(signal: AbortSignal) {
    if (signal.aborted) throw new DOMException("stopped", "AbortError");
}

/**
 * Converts one picture. `told` hears the share done, counted in steps: reading, then each run of the
 * encoder (one, or up to nine when a weight is searched for), so it moves only when a step is done.
 * A run already in the encoder when it is stopped finishes there and its result is thrown away.
 */
export async function convertPicture(file: Blob, engine: PictureEngine, choice: PictureChoice, signal: AbortSignal, told: (share: number) => void = () => {}): Promise<{ blob: Blob; width: number; height: number; from: { width: number; height: number }; quality: number; over: boolean; notes: string[] }> {
    const format = engine.formats.find((each) => each.key === choice.format) ?? engine.formats[0]!;
    const steps = 1 + attemptsFor(choice, format.lossy);
    let done = 0;
    const step = () => told(Math.min(1, ++done / steps));
    const notes: string[] = [];
    const original = new Uint8Array(await file.arrayBuffer());
    check(signal);
    let source: ImageBitmap | ImageData;
    try {
        source = engine.isHeic(original.subarray(0, 16)) ? await engine.decodeHeic(file) : await createImageBitmap(file, { imageOrientation: "from-image" });
    } catch {
        throw new Error(UNREADABLE);
    }
    check(signal);
    const width = source.width;
    const height = source.height;
    const made = sizeFor(width, height, choice.size);
    const bitmap = await createImageBitmap(source, made.width === width && made.height === height ? {} : { resizeWidth: made.width, resizeHeight: made.height, resizeQuality: "high" });
    if (source instanceof ImageBitmap) source.close();
    const canvas = new OffscreenCanvas(made.width, made.height);
    const context = canvas.getContext("2d", { willReadFrequently: true })!;
    context.drawImage(bitmap, 0, 0);
    bitmap.close();
    const pixels = context.getImageData(0, 0, made.width, made.height);
    if (original[0] === 0x47 && original[1] === 0x49 && original[2] === 0x46) notes.push("A moving GIF keeps only its first frame.");
    step();
    check(signal);
    const meta = choice.keep === "none" ? {} : engine.metadata(original, choice.keep);
    const result = await engine.encode(pixels, { format: format.key, quality: choice.quality, ...(format.lossy && choice.target ? { target: choice.target } : {}) }, meta, () => {
        if (!signal.aborted) step();
    });
    check(signal);
    if (result.over) notes.push("Over the weight even at the lowest quality.");
    told(1);
    return { blob: result.blob, width: made.width, height: made.height, from: { width, height }, quality: result.quality, over: result.over, notes };
}
