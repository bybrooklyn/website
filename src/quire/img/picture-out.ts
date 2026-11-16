// One picture written out as its export is set: the same rules for the editor's own export of the picture
// on the stage and for every picture of a batch exported together. A picture with no steps given in its own
// format is its original (with where, when and with what it was taken cut out, unless all is kept); any
// other is flattened, its metadata and colour profile put in as chosen, and encoded.
//
// A picture of a batch that is not on the stage is flattened away from it (`flattenAway`): decoded, repaired
// and cut out as its steps say, put on a card of its own, flattened, and let go, so that only the pictures
// being exported are ever decoded.
//
//   const done = await writeOut({ picture, bytes, profile, space, settings, keeping, flatten });

import { decodeHeic, heicIn } from "./codec-run";
import { encodeAs, formatOf, untouched, type Settings } from "./export";
import { blocksOut, factsOf, profileOf, type Keep } from "./metadata";
import { gradingWith, loadPicture, type Backend } from "./draw";
import { jpegFacts, worthRepairing } from "./deblock";
import { cutOut } from "./cutout/cut";
import { edited, look, type Look, type Picture } from "./steps";
import type { Space } from "./grade";

/** A picture the browser can draw: a HEIC photograph (which browsers do not read) read by the HEIC module and made a PNG kept only in memory; any other as it is. The original stays as it came. */
export async function displayable(file: Blob): Promise<Blob> {
    if (!heicIn(new Uint8Array(await file.slice(0, 16).arrayBuffer()))) return file;
    const pixels = await decodeHeic(file);
    const canvas = new OffscreenCanvas(pixels.width, pixels.height);
    canvas.getContext("2d")!.putImageData(pixels, 0, 0);
    return canvas.convertToBlob({ type: "image/png" });
}

/** What an original says that its export needs: its bytes, its colour space and profile, and whether it is a JPEG worth repairing, kept upright as stored. */
export async function readOriginal(original: Blob) {
    const bytes = new Uint8Array(await original.arrayBuffer());
    const said = factsOf(bytes);
    const colored = await profileOf(bytes);
    return { bytes, said, space: colored.space, profile: colored.icc, repairable: worthRepairing(jpegFacts(bytes)) && (!said.orientation || said.orientation === 1) };
}

/** What writing one picture out is given: the picture and its original's bytes, its profile and space, the settings and what metadata goes, and how to flatten it (made sRGB when `convert`). */
export interface OutJob {
    picture: Picture;
    bytes: Uint8Array;
    profile?: Uint8Array;
    space: Space;
    settings: Settings;
    keeping: Keep;
    flatten(convert: boolean): Promise<ImageData>;
}

/** Whether the export is made sRGB: when it was chosen and the picture is in Display P3. */
export const converts = (settings: Settings, space: Space) => settings.srgb === true && space === "p3";

/** One picture written out as its export is set: its original when nothing changed it, else flattened and encoded, with the metadata and profile asked for. */
export async function writeOut(job: OutJob): Promise<{ blob: Blob; quality: number; over: boolean; pixels?: ImageData }> {
    const { picture, settings, keeping } = job;
    const format = formatOf(settings.format);
    const convert = converts(settings, job.space);
    // a picture with no steps given in its own format keeping all it says, and nothing changed in it, is its original byte for byte
    const changedNothing = !picture.edits || Object.values(picture.edits).every((value) => value === undefined);
    if (!edited(picture) && !settings.target && !convert && format.type === picture.original.type && (keeping === "none" || (keeping === "all" && changedNothing))) {
        try {
            return { blob: new Blob([(keeping === "all" ? job.bytes : untouched(job.bytes)) as BlobPart], { type: format.type }), quality: settings.quality, over: false };
        } catch {
            // one that cannot be read through is written again, which leaves everything out
        }
    }
    const pixels = await job.flatten(convert);
    const meta = keeping === "none" ? {} : blocksOut(job.bytes, keeping, picture.edits ?? {});
    // the colour profile goes out with the numbers it describes, unless they were made sRGB
    const icc = convert ? undefined : job.profile;
    return { ...(await encodeAs(pixels, settings, { ...meta, ...(icc ? { icc } : {}) })), pixels };
}

/** What flattening a picture away from the stage needs beyond its steps: its pixels as the browser draws them, its JPEG's bytes for a repair, a model's repair kept with it, and ways to repair and to enlarge. */
export interface AwayJob {
    backend: Backend;
    picture: Picture;
    source: Blob;
    bytes: Uint8Array;
    repairable: boolean;
    space: Space;
    convert: boolean;
    /** A model's repair, kept in the document beside the original, when the repair step names one. */
    made?: Blob;
    repair(bytes: Uint8Array, pixels: ImageData): Promise<ImageData | undefined>;
    /** The picture enlarged by its resize's model, when it names one; nothing to use the filter. */
    enlarge?(look: Look, flatten: (look: Look) => Promise<ImageData>): Promise<ImageData | undefined>;
}

/**
 * The side of the pieces a picture away from the stage is flattened in: smaller than the stage's own, since the card's
 * answer for each piece is waited for on the page's thread, and on a machine drawing without a graphics card a piece
 * of 2048 a side kept the page from answering for seconds while a batch was exported.
 */
export const AWAY_PIECE = 1024;

/** A picture flattened away from the stage: its pixels repaired and cut out as its steps say, put on a card of its own, flattened, and let go. */
export async function flattenAway(job: AwayJob): Promise<ImageData> {
    const shown = look(job.picture);
    const raw = { colorSpaceConversion: "none", premultiplyAlpha: "none" } as const;
    let base: Blob | ImageBitmap = job.source;
    if (shown.repair && job.repairable) {
        if (shown.repairModel && job.made) base = job.made;
        else {
            const bitmap = await createImageBitmap(job.source, raw);
            const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
            const context = canvas.getContext("2d")!;
            context.drawImage(bitmap, 0, 0);
            bitmap.close();
            const repaired = await job.repair(job.bytes, context.getImageData(0, 0, canvas.width, canvas.height));
            if (repaired) base = await createImageBitmap(repaired, raw);
        }
    }
    if (shown.cutout) {
        const bitmap = base instanceof ImageBitmap ? base : await createImageBitmap(base, raw);
        const cut = await cutOut(bitmap, shown.cutout);
        if (cut) {
            if (bitmap !== base) bitmap.close();
            base = await createImageBitmap(cut, raw);
        } else base = bitmap;
    }
    const loaded = await loadPicture(job.backend, base);
    if (base instanceof ImageBitmap) base.close();
    try {
        const flatten = (each: Look) => loaded.flatten(each, AWAY_PIECE, gradingWith(each, job.space, loaded.size, job.convert && job.space === "p3"), job.space);
        const made = shown.enlarge && job.enlarge ? await job.enlarge(shown, flatten) : undefined;
        return await loaded.flatten(shown, AWAY_PIECE, gradingWith(shown, job.space, loaded.size, job.convert && job.space === "p3"), job.space, made);
    } finally {
        loaded.destroy();
    }
}
