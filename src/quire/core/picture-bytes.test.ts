// What a picture's bytes are held to: its kind is read from what it holds, not its name, and a
// photograph loses where, when and with what it was taken, keeps its orientation, and not one pixel
// changes. Run with `bun test src/quire/core`.

import { expect, test } from "bun:test";
import sharp from "sharp";
import { pictureType, withoutMetadata } from "./picture-bytes";
import { crc32 } from "./zip";

test("a picture's kind comes from its first bytes, and a page or a script with a picture's name is plain bytes", () => {
    const bytes = (text: string) => new TextEncoder().encode(text);
    expect(pictureType(new Uint8Array([0x89, ...bytes("PNG\r\n\u001a\n")]))).toBe("image/png");
    expect(pictureType(bytes("GIF89a and the rest"), "cat.png")).toBe("image/gif");
    expect(pictureType(bytes("<html><script>alert(1)</script>"), "cat.png")).toBe("application/octet-stream");
});

// ---- where a photograph was taken, cut out of it ----

/** A small photograph as a phone gives one: turned (orientation), with the maker, where it was taken (GPS) and when, and a comment, in its own format. */
async function photograph(format: "jpeg" | "png" | "webp", orientation = 6) {
    const made = sharp({ create: { width: 9, height: 7, channels: 3, background: { r: 200, g: 40, b: 90 } } })
        // a little pattern, so that equal pixels mean something
        .composite([{ input: Buffer.from([0, 0, 0, 255, 255, 255, 30, 60, 90, 250, 0, 120]), raw: { width: 2, height: 2, channels: 3 }, left: 3, top: 2 }])
        .withMetadata({ orientation })
        .withExifMerge({ IFD0: { Make: "PhoneMaker", Model: "Pocket 9" }, IFD2: { DateTimeOriginal: "2026:05:01 09:30:00" }, IFD3: { GPSLatitudeRef: "N", GPSLatitude: "51/1 30/1 1234/100", GPSLongitudeRef: "W", GPSLongitude: "0/1 7/1 3999/100" } });
    const bytes = new Uint8Array(await (format === "jpeg" ? made.jpeg({ quality: 90 }) : format === "png" ? made.png() : made.webp({ lossless: true })).toBuffer());
    return bytes;
}

/** A segment or chunk added by hand, as some cameras and editors add them: a JPEG comment, a PNG text chunk. */
function withComment(bytes: Uint8Array, words: string): Uint8Array {
    const text = new TextEncoder().encode(words);
    if (bytes[0] === 0xff) return new Uint8Array([0xff, 0xd8, 0xff, 0xfe, (text.length + 2) >> 8, (text.length + 2) & 0xff, ...text, ...bytes.subarray(2)]);
    const chunk = new Uint8Array(12 + 9 + text.length);
    new DataView(chunk.buffer).setUint32(0, 9 + text.length);
    chunk.set(new TextEncoder().encode("tEXtLocation\0"), 4);
    chunk.set(text, 17);
    new DataView(chunk.buffer).setUint32(chunk.length - 4, crc32(chunk.subarray(4, chunk.length - 4)));
    return new Uint8Array([...bytes.subarray(0, 33), ...chunk, ...bytes.subarray(33)]);
}

const has = (bytes: Uint8Array, words: string) => Buffer.from(bytes).includes(words);
const pixels = async (bytes: Uint8Array) => new Uint8Array(await sharp(bytes).raw().toBuffer());

for (const format of ["jpeg", "png", "webp"] as const) {
    test(`a ${format.toUpperCase()} photograph loses where, when and with what it was taken, keeps its orientation, and not one pixel changes`, async () => {
        const original = format === "webp" ? await photograph(format) : withComment(await photograph(format), "12 Home Street");
        const before = await sharp(original).metadata();
        expect(before.orientation).toBe(6);
        expect(has(original, "PhoneMaker")).toBe(true);
        // the GPS directory's tag, 0x8825, is in the original's Exif
        expect(Buffer.from(before.exif!).includes(Buffer.from([0x88, 0x25])) || Buffer.from(before.exif!).includes(Buffer.from([0x25, 0x88]))).toBe(true);

        const cleaned = withoutMetadata(original, crc32);
        for (const words of ["PhoneMaker", "Pocket 9", "2026:05:01", "12 Home Street"]) expect({ words, kept: has(cleaned, words) }).toEqual({ words, kept: false });
        const after = await sharp(cleaned).metadata();
        expect(after.orientation).toBe(6);
        // the Exif left is the orientation alone: one entry, no GPS directory
        const exif = Buffer.from(after.exif!);
        expect(exif.includes(Buffer.from([0x88, 0x25]))).toBe(false);
        expect(exif.includes(Buffer.from([0x25, 0x88]))).toBe(false);
        expect(exif.length).toBeLessThanOrEqual(6 + 26);
        expect([after.width, after.height, after.format]).toEqual([before.width, before.height, before.format]);
        expect(await pixels(cleaned)).toEqual(await pixels(original));
        // the bytes of the picture itself are untouched: a cleaned file is the original with segments taken out
        expect(cleaned.length).toBeLessThan(original.length);
    });
}

test("a photograph that was not turned is left with no Exif at all, and one that is not a photograph is given back as it was", async () => {
    const upright = withoutMetadata(await photograph("jpeg", 1), crc32);
    expect((await sharp(upright).metadata()).exif).toBeUndefined();
    const gif = new TextEncoder().encode("GIF89a and the rest");
    expect(withoutMetadata(gif, crc32)).toBe(gif);
    // a JPEG that cannot be read through is refused rather than kept with what it says
    expect(() => withoutMetadata(new Uint8Array([0xff, 0xd8, 0xff, 0xe1, 0x40, 0x00, 1, 2, 3]), crc32)).toThrow("where and when it was taken");
});
