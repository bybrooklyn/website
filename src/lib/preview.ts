// A tiny blurred copy of a picture, small enough to sit in the page itself.
// It is painted behind the real image, so on a slow connection there is
// something to see where the picture will be.

import type { ImageMetadata } from "astro";
import sharp from "sharp";

const made = new Map<string, Promise<string>>();

/** A CSS `background` value: the picture at 24 px wide, as a data URI. Empty if it cannot be read. */
export function preview(image: ImageMetadata): Promise<string> {
    const path = (image as ImageMetadata & { fsPath?: string }).fsPath;
    if (!path) return Promise.resolve("");
    let result = made.get(path);
    if (!result) {
        result = sharp(path)
            .resize({ width: 24 })
            .webp({ quality: 40 })
            .toBuffer()
            .then(
                (bytes) => `url(data:image/webp;base64,${bytes.toString("base64")}) center / cover no-repeat`,
                () => "",
            );
        made.set(path, result);
    }
    return result;
}
