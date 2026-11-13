// How a picture that has been resized or given a caption is kept, and the counting behind resizing
// and moving one. The tools a person uses on a picture are in picture-tools.ts.
//
// In a Markdown file a picture nobody resized is written as it was, `![alt](address)`. One with a
// width or a caption has no Markdown form, so it is written as the HTML the site's own Markdown
// already passes through, on one line, which reads the same in a `.md` and an `.mdx` file:
//
//   <img src="pictures/cat.png" alt="A cat asleep" width="50%" />
//   <figure><img src="pictures/cat.png" alt="A cat asleep" width="50%" /><figcaption>Our cat</figcaption></figure>
//
// The width is a share of the text's width, so the picture keeps its place in the column on any
// screen. Its alignment is the `<div align>` the writer puts round any block. The reader takes back
// only exactly these forms; any other HTML stays raw, as its text. In a `.quire` document the
// Markdown stays plain and the width and caption go to style.json with the alignment (styling.ts).

import { insertBlock, moveBlock, removeBlock, type Document, type Image } from "./document";

/** The widths a picture being resized is drawn to when it comes near them, as shares of the text's width, with their names. */
export const SNAPS: [number, string][] = [
    [100, "Full width"],
    [50, "Half"],
    [33, "A third"],
];

/** How near, in percent of the text's width, a width must come to one of the snaps to be drawn to it. */
const PULL = 3;

/** A width being dragged, kept between a tenth and the whole of the text's width, drawn to the snaps when near one. */
export function snapWidth(percent: number): { width: number; snap?: string } {
    const kept = Math.min(100, Math.max(10, percent));
    for (const [width, name] of SNAPS) if (Math.abs(kept - width) <= PULL) return { width, snap: name };
    return { width: Math.round(kept) };
}

/**
 * A picture's real kind, read from its first bytes rather than its name: PNG, JPEG, GIF, WebP, AVIF
 * or BMP. A file named `.svg` that is an SVG is one too, shown only ever as a picture. Anything else
 * (an HTML page or a script with a picture's name) is plain bytes, which a browser never draws as a
 * page.
 */
export function pictureType(bytes: Uint8Array, name = ""): string {
    const at = (offset: number, text: string) => [...text].every((char, index) => bytes[offset + index] === char.charCodeAt(0));
    if (bytes[0] === 0x89 && at(1, "PNG\r\n")) return "image/png";
    if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
    if (at(0, "GIF87a") || at(0, "GIF89a")) return "image/gif";
    if (at(0, "RIFF") && at(8, "WEBP")) return "image/webp";
    if (at(4, "ftypavif") || at(4, "ftypavis")) return "image/avif";
    if (at(0, "BM") && bytes.length > 26) return "image/bmp";
    if (/\.svg$/i.test(name) && /^(\ufeff)?\s*(<\?xml[^>]*>\s*)?(<!--[\s\S]*?-->\s*)*(<!DOCTYPE svg[^>]*>\s*)?<svg[\s>]/i.test(new TextDecoder().decode(bytes.subarray(0, 2048)))) return "image/svg+xml";
    return "application/octet-stream";
}

// ---- what a photograph says about where it was taken ----
//
// A photograph from a phone carries metadata: where it was taken (GPS), when, with what, and often a
// small copy of itself. None of it is needed to show it, and a document can be published, so it is
// taken out when a picture comes into a document. Only the bytes that hold it are cut out: the
// picture itself is not decoded or encoded again, so not one pixel changes. The one tag that
// changes how it is shown, its orientation, is kept, written back alone.

/** Reads a TIFF block (what an Exif segment holds) for its orientation tag, 1 to 8, if it has one. */
function orientationIn(tiff: Uint8Array): number | undefined {
    if (tiff.length < 8) return undefined;
    const view = new DataView(tiff.buffer, tiff.byteOffset, tiff.byteLength);
    const little = tiff[0] === 0x49 && tiff[1] === 0x49;
    if (!little && !(tiff[0] === 0x4d && tiff[1] === 0x4d)) return undefined;
    const first = view.getUint32(4, little);
    if (first + 2 > tiff.length) return undefined;
    const count = view.getUint16(first, little);
    for (let index = 0; index < count; index++) {
        const at = first + 2 + index * 12;
        if (at + 12 > tiff.length) return undefined;
        if (view.getUint16(at, little) === 0x0112 && view.getUint16(at + 2, little) === 3) {
            const value = view.getUint16(at + 8, little);
            return value >= 1 && value <= 8 ? value : undefined;
        }
    }
    return undefined;
}

/** A TIFF block holding the orientation and nothing else. */
function orientationOnly(orientation: number): Uint8Array {
    // big-endian: "MM", 42, the first directory at 8, one entry (tag 0x0112, a SHORT, one of them, the value), no next directory
    return new Uint8Array([0x4d, 0x4d, 0, 42, 0, 0, 0, 8, 0, 1, 0x01, 0x12, 0, 3, 0, 0, 0, 1, 0, orientation, 0, 0, 0, 0, 0, 0]);
}

const EXIF_HEAD = [0x45, 0x78, 0x69, 0x66, 0, 0];
const startsWith = (bytes: Uint8Array, head: number[] | string, at = 0) => [...(typeof head === "string" ? [...head].map((char) => char.charCodeAt(0)) : head)].every((byte, index) => bytes[at + index] === byte);
const joined = (parts: Uint8Array[]) => {
    const out = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
    let at = 0;
    for (const part of parts) {
        out.set(part, at);
        at += part.length;
    }
    return out;
};

/** A JPEG without its metadata segments: Exif, XMP, IPTC, comments, thumbnails, and whatever follows its end. Colour profile, JFIF and Adobe segments, which change how it looks, stay. */
function cleanJpeg(bytes: Uint8Array): Uint8Array {
    const kept: Uint8Array[] = [bytes.subarray(0, 2)];
    let orientation: number | undefined;
    let at = 2;
    let afterJfif = 1;
    const segment = (start: number, end: number, keep: boolean) => {
        if (keep) kept.push(bytes.subarray(start, end));
    };
    while (at + 1 < bytes.length) {
        if (bytes[at] !== 0xff) throw new Error("not a JPEG marker");
        const marker = bytes[at + 1]!;
        if (marker === 0xff) {
            at++;
            continue;
        }
        if (marker === 0xd9) {
            kept.push(bytes.subarray(at, at + 2));
            break;
        }
        if ((marker >= 0xd0 && marker <= 0xd7) || marker === 0x01) {
            kept.push(bytes.subarray(at, at + 2));
            at += 2;
            continue;
        }
        if (at + 4 > bytes.length) throw new Error("a JPEG cut short");
        const end = at + 2 + ((bytes[at + 2]! << 8) | bytes[at + 3]!);
        if (end > bytes.length) throw new Error("a JPEG cut short");
        const body = bytes.subarray(at + 4, end);
        if (marker === 0xda) {
            // a scan: its header, then the compressed picture up to the next marker that is not part of it
            let next = end;
            while (next + 1 < bytes.length && !(bytes[next] === 0xff && bytes[next + 1] !== 0 && !(bytes[next + 1]! >= 0xd0 && bytes[next + 1]! <= 0xd7))) next++;
            kept.push(bytes.subarray(at, next));
            at = next;
            continue;
        }
        if (marker === 0xe1 && startsWith(body, EXIF_HEAD)) orientation ??= orientationIn(body.subarray(6));
        const app = marker >= 0xe0 && marker <= 0xef;
        const keep = (!app && marker !== 0xfe) || (marker === 0xe0 && startsWith(body, "JFIF\0")) || (marker === 0xe2 && startsWith(body, "ICC_PROFILE\0")) || (marker === 0xee && startsWith(body, "Adobe"));
        segment(at, end, keep);
        if (marker === 0xe0 && keep) afterJfif = kept.length;
        at = end;
    }
    if (orientation && orientation !== 1) {
        const tiff = orientationOnly(orientation);
        const length = 2 + EXIF_HEAD.length + tiff.length;
        kept.splice(afterJfif, 0, new Uint8Array([0xff, 0xe1, length >> 8, length & 0xff, ...EXIF_HEAD, ...tiff]));
    }
    return joined(kept);
}

/** A PNG without its text, time and Exif chunks, the orientation kept in an Exif chunk of its own. */
function cleanPng(bytes: Uint8Array, crc: (bytes: Uint8Array) => number): Uint8Array {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const kept: Uint8Array[] = [bytes.subarray(0, 8)];
    let orientation: number | undefined;
    let at = 8;
    while (at + 12 <= bytes.length) {
        const length = view.getUint32(at);
        const end = at + 12 + length;
        if (end > bytes.length) throw new Error("a PNG cut short");
        const type = String.fromCharCode(...bytes.subarray(at + 4, at + 8));
        if (type === "eXIf") orientation ??= orientationIn(bytes.subarray(at + 8, at + 8 + length));
        if (type === "IDAT" && orientation && orientation !== 1) {
            // the Exif chunk must come before the picture's data
            const chunk = new Uint8Array(12 + 26);
            const out = new DataView(chunk.buffer);
            out.setUint32(0, 26);
            chunk.set([0x65, 0x58, 0x49, 0x66], 4);
            chunk.set(orientationOnly(orientation), 8);
            out.setUint32(34, crc(chunk.subarray(4, 34)));
            kept.push(chunk);
            orientation = undefined;
        }
        if (!["tEXt", "zTXt", "iTXt", "eXIf", "tIME"].includes(type)) kept.push(bytes.subarray(at, end));
        at = end;
        if (type === "IEND") break;
    }
    return joined(kept);
}

/** A WebP without its Exif and XMP chunks, the orientation kept in an Exif chunk of its own. */
function cleanWebp(bytes: Uint8Array): Uint8Array {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const chunks: Uint8Array[] = [];
    let orientation: number | undefined;
    let flags: Uint8Array | undefined;
    let at = 12;
    while (at + 8 <= bytes.length) {
        const type = String.fromCharCode(...bytes.subarray(at, at + 4));
        const size = view.getUint32(at + 4, true);
        const end = at + 8 + size + (size & 1);
        if (at + 8 + size > bytes.length) throw new Error("a WebP cut short");
        const body = bytes.subarray(at + 8, at + 8 + size);
        if (type === "EXIF") orientation ??= orientationIn(startsWith(body, EXIF_HEAD) ? body.subarray(6) : body);
        else if (type !== "XMP ") {
            const chunk = bytes.slice(at, Math.min(end, bytes.length));
            if (type === "VP8X") flags = chunk;
            chunks.push(chunk);
        }
        at = end;
    }
    const keepTurn = !!orientation && orientation !== 1;
    // the extended header says which of these chunks there are
    if (flags) flags[8] = (flags[8]! & ~0x0c) | (keepTurn ? 0x08 : 0);
    if (keepTurn && flags) {
        const tiff = orientationOnly(orientation!);
        const chunk = new Uint8Array(8 + tiff.length);
        chunk.set([0x45, 0x58, 0x49, 0x46], 0);
        new DataView(chunk.buffer).setUint32(4, tiff.length, true);
        chunk.set(tiff, 8);
        chunks.push(chunk);
    }
    const body = joined(chunks);
    const head = new Uint8Array(12);
    head.set(bytes.subarray(0, 4));
    new DataView(head.buffer).setUint32(4, body.length + 4, true);
    head.set(bytes.subarray(8, 12), 8);
    return joined([head, body]);
}

/**
 * A picture's bytes with what it says about where, when and with what it was taken cut out, and
 * nothing else changed: a JPEG's Exif, XMP, IPTC and comment segments, a PNG's text, time and Exif
 * chunks, a WebP's Exif and XMP chunks. Its orientation is kept, written back as the only tag. Other
 * kinds (GIF, BMP, AVIF, SVG) are given back as they are; one of the three that cannot be read
 * through is refused, with the reason.
 * `crc` is zip.ts's CRC-32, which a PNG chunk carries too.
 */
export function withoutMetadata(bytes: Uint8Array, crc: (bytes: Uint8Array) => number): Uint8Array {
    const kind = pictureType(bytes);
    try {
        if (kind === "image/jpeg") return cleanJpeg(bytes);
        if (kind === "image/png") return cleanPng(bytes, crc);
        if (kind === "image/webp") return cleanWebp(bytes);
    } catch {
        // a photograph that cannot be read through might still say where it was taken, so it is not kept
        throw new Error("it could not be read through to take out where and when it was taken");
    }
    return bytes;
}

/** Text made safe inside an HTML attribute or element; braces too, which MDX would read as code. */
function escape(text: string): string {
    return text.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/\{/g, "&#123;").replace(/\}/g, "&#125;");
}

/** The characters `escape` writes, back. */
function unescape(text: string): string {
    return text.replace(/&(amp|quot|lt|gt|#123|#125);/g, (_, name: string) => ({ amp: "&", quot: '"', lt: "<", gt: ">", "#123": "{", "#125": "}" })[name]!);
}

/** True for a picture that has no Markdown form: one with a width or a caption. */
export const sized = (block: Image): boolean => block.width !== undefined || !!block.caption;

/** A picture with a width or a caption, as the one line of HTML that keeps it. */
export function pictureHtml(block: Image): string {
    const title = block.title !== undefined ? ` title="${escape(block.title)}"` : "";
    const width = block.width !== undefined ? ` width="${block.width}%"` : "";
    const picture = `<img src="${escape(block.src)}" alt="${escape(block.alt)}"${title}${width} />`;
    return block.caption ? `<figure>${picture}<figcaption>${escape(block.caption)}</figcaption></figure>` : picture;
}

const PICTURE = /<img src="([^"]*)" alt="([^"]*)"(?: title="([^"]*)")?(?: width="(\d{1,3})%")? \/>/;
const ALONE = new RegExp(`^${PICTURE.source}$`);
const FIGURE = new RegExp(`^<figure>${PICTURE.source}<figcaption>([^<]*)</figcaption></figure>$`);

/** A picture written in one of the forms `pictureHtml` gives, read back; anything else is not one. */
export function readPicture(text: string): Image | undefined {
    const figure = FIGURE.exec(text);
    const alone = figure ? undefined : ALONE.exec(text);
    const found = figure ?? alone;
    // a lone <img> with no width is ordinary HTML, left as it was written
    if (!found || (alone && found[4] === undefined)) return undefined;
    const block: Image = { kind: "image", src: unescape(found[1]!), alt: unescape(found[2]!), gap: "" };
    if (found[3] !== undefined) block.title = unescape(found[3]);
    if (found[4] !== undefined) {
        const width = Number(found[4]);
        if (width < 1 || width > 100) return undefined;
        block.width = width;
    }
    if (figure && figure[5]) block.caption = unescape(figure[5]);
    return block;
}

/** A raw block that is one of the picture forms, as the picture it is, keeping its text as its source; any other block as it was. */
export function asPicture<T extends { kind: string; text?: string }>(block: T): T | Image {
    if (block.kind !== "raw" || block.text === undefined) return block;
    return readPicture(block.text) ?? block;
}

/** Moves the top-level block at `from` so that it stands before the block now at `to` (the end when `to` is the number of blocks). */
export function moveTo(doc: Document, from: number, to: number): Document {
    const block = doc.blocks[from];
    if (!block || to === from || to === from + 1 || to < 0 || to > doc.blocks.length) return doc;
    let next = removeBlock(doc, [from]);
    const place = to > from ? to - 1 : to;
    if (place === 0) {
        next = insertBlock(next, [0], block);
        return moveBlock(next, [1], -1);
    }
    return insertBlock(next, [place - 1], block);
}
