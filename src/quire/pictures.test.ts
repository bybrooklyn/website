// What is held true of how a resized or captioned picture is kept: a picture nobody touched is
// written as it was; one with a width or caption is written as the one line of HTML the site's
// Markdown passes through, and read back from exactly that; in a `.quire` document the Markdown
// stays plain and both go to style.json. Run with `bun test src/quire`.

import { expect, test } from "bun:test";
import { setAlign, setImage, type Image } from "./document";
import { read } from "./read";
import sharp from "sharp";
import { moveTo, pictureHtml, readPicture, snapWidth, withoutMetadata } from "./pictures";
import { crc32 } from "./zip";
import { collect, readStyle, restore } from "./styling";
import { write } from "./write";

const POST = "# A post\n\n![A cat asleep](pictures/cat.png)\n\nThe end.\n";

test("a picture nobody resized is written exactly as it was, title and odd spacing and all", () => {
    const text = "Words.\n\n![A cat](<pictures/a cat.png> 'hers')\n\nMore.\n";
    expect(write(read(text))).toBe(text);
    expect(write(read(POST))).toBe(POST);
});

test("a picture given a width is written as an <img> with the width as a share of the text, and read back as the same picture", () => {
    const doc = setImage(read(POST), [1], { width: 50 });
    const out = write(doc);
    expect(out).toBe('# A post\n\n<img src="pictures/cat.png" alt="A cat asleep" width="50%" />\n\nThe end.\n');
    const again = read(out);
    expect(again.blocks[1]).toMatchObject({ kind: "image", src: "pictures/cat.png", alt: "A cat asleep", width: 50 });
    // and the file read back goes out byte for byte
    expect(write(again)).toBe(out);
});

test("a caption makes a <figure> with a <figcaption>, and centring wraps it in the writer's <div align>", () => {
    let doc = setImage(read(POST), [1], { width: 33, caption: 'Our cat, "Moss" {asleep} & <dreaming>' });
    doc = setAlign(doc, [1], "center");
    const out = write(doc);
    expect(out).toContain('<div align="center">\n\n<figure><img src="pictures/cat.png" alt="A cat asleep" width="33%" /><figcaption>Our cat, &quot;Moss&quot; &#123;asleep&#125; &amp; &lt;dreaming&gt;</figcaption></figure>\n\n</div>');
    const back = read(out).blocks[1] as Image;
    expect(back).toMatchObject({ kind: "image", width: 33, align: "center", caption: 'Our cat, "Moss" {asleep} & <dreaming>' });
    expect(write(read(out, { mdx: true }))).toBe(out);
});

test("a caption with no width is kept too, and taking both away gives back plain Markdown", () => {
    const captioned = setImage(read(POST), [1], { caption: "Moss" });
    expect(write(captioned)).toContain('<figure><img src="pictures/cat.png" alt="A cat asleep" /><figcaption>Moss</figcaption></figure>');
    const plain = setImage(read(write(captioned)), [1], { width: undefined, caption: undefined });
    expect(write(plain)).toBe(POST);
});

test("only the exact forms are read as pictures: other HTML stays raw, as its text", () => {
    expect(readPicture('<img src="a.png" alt="b" />')).toBeUndefined();
    expect(readPicture('<img src="a.png" alt="b" width="480" />')).toBeUndefined();
    expect(readPicture('<img class="x" src="a.png" alt="b" width="50%" />')).toBeUndefined();
    expect(readPicture('<img src="a.png" alt="b" width="0%" />')).toBeUndefined();
    for (const text of ['<img src="a.png" alt="b" width="480">\n', '<figure class="figure"><img src="a.png" alt="b" /></figure>\n']) {
        expect(read(text).blocks[0]!.kind).toBe("raw");
        expect(write(read(text))).toBe(text);
    }
});

test("pictureHtml and readPicture agree on every field, the title included", () => {
    const block: Image = { kind: "image", src: "pictures/x y.png", alt: 'a "b"', title: "t", width: 75, caption: "c", gap: "" };
    expect(readPicture(pictureHtml(block))).toEqual({ ...block, gap: "" });
});

test("a width being dragged is drawn to the whole, half and a third of the text when near them, and kept within a tenth and the whole", () => {
    expect(snapWidth(98)).toEqual({ width: 100, snap: "Full width" });
    expect(snapWidth(140)).toEqual({ width: 100, snap: "Full width" });
    expect(snapWidth(52.4)).toEqual({ width: 50, snap: "Half" });
    expect(snapWidth(31)).toEqual({ width: 33, snap: "A third" });
    expect(snapWidth(42.4)).toEqual({ width: 42 });
    expect(snapWidth(2)).toEqual({ width: 10 });
});

test("a picture moved to another place stands there, the other blocks written as they were", () => {
    const text = "One.\n\n![Moss](m.png)\n\nTwo.\n\nThree.\n";
    expect(write(moveTo(read(text), 1, 4))).toBe("One.\n\nTwo.\n\nThree.\n\n![Moss](m.png)\n");
    expect(write(moveTo(read(text), 1, 0))).toBe("![Moss](m.png)\n\nOne.\n\nTwo.\n\nThree.\n");
    expect(write(moveTo(read(text), 1, 3))).toBe("One.\n\nTwo.\n\n![Moss](m.png)\n\nThree.\n");
    // to where it already is, nothing changes
    expect(moveTo(read(text), 1, 2)).toEqual(read(text));
});

test("in a .quire document the Markdown stays plain and the width and caption go to style.json, and come back", () => {
    const doc = setImage({ ...read(POST), quire: { page: { size: "A4", orientation: "portrait", margins: 25 }, notes: null } }, [1], { width: 50, caption: "Moss" });
    const { markdown, style } = collect(doc);
    expect(markdown).toBe(POST);
    expect(style.blocks).toEqual([{ block: 1, hash: expect.any(String), width: 50, caption: "Moss" }]);
    const back = restore(read(markdown), readStyle(JSON.stringify(style)));
    expect(back.blocks[1]).toMatchObject({ kind: "image", width: 50, caption: "Moss" });
    // restored, the picture is still as it was read, so it is written back byte for byte
    expect(write(back)).toBe(POST);
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
