// A picture as bytes, whatever document it is in: what kind of picture it really is, read from its
// first bytes rather than its name, and the same picture with where, when and with what it was taken
// cut out of it (Exif, XMP, IPTC, comments), its orientation kept and not one pixel changed. The
// `.quire` zip and Google Drive's store read a picture's kind here; mdQuire cleans each picture that
// comes into a document; imgQuire is to read and strip metadata the same way.

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
