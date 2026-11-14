// What a picture says about itself, read and written by hand: its Exif (camera, lens, exposure, when,
// where, its orientation), its XMP and IPTC (caption, author, copyright) and its colour profile, out
// of a JPEG, PNG or WebP through the core's walkers (core/picture-bytes.ts) and out of the boxes of an
// AVIF, HEIC or JPEG XL here. Nothing is taken on trust: every count, offset and length is checked
// against the bytes there are, Exif directories that point back at each other are followed once, and
// how much is read is bounded, so a hostile or broken file gives what can be read of it and no more.
//
// Writing puts back what the person chose to keep (all of it, all but the place, or none) and what she
// changed (caption, alt text, author, copyright, date taken), into whichever place each format has:
// the original's Exif block kept byte for byte but for its orientation, set upright since the pixels
// are, and with the place emptied when it is not kept.

import { jpegParts, pngParts, webpParts } from "../core/picture-bytes";

/** What the person may change: the notes decide a date, author and copyright, alt text and a caption. */
export interface Edits {
    caption?: string;
    alt?: string;
    author?: string;
    copyright?: string;
    date?: string;
}

/** What of a picture's metadata goes out with an export. */
export type Keep = "none" | "noplace" | "all";

/** The metadata blocks a file holds: Exif as a TIFF block, XMP as text, IPTC as its records, the colour profile, comments. */
export interface Blocks {
    exif?: Uint8Array;
    xmp?: string;
    iptc?: Uint8Array;
    icc?: Uint8Array;
    comments: string[];
}

/** The most of anything read: bytes of metadata, entries of a directory, directories, values of one entry, boxes. */
export const BOUNDS = { bytes: 16 * 1024 * 1024, entries: 1000, directories: 16, values: 4096, boxes: 2000, text: 64 * 1024 };

const ascii = (bytes: Uint8Array) => new TextDecoder("latin1").decode(bytes);
const utf8 = (bytes: Uint8Array) => new TextDecoder().decode(bytes);
const starts = (bytes: Uint8Array, text: string) => text.length <= bytes.length && [...text].every((char, at) => bytes[at] === char.charCodeAt(0));
const XMP_HEAD = "http://ns.adobe.com/xap/1.0/\0";
const EXIF_HEAD = "Exif\0\0";

/** The boxes of an ISO base media file (AVIF, HEIC, a JPEG XL container) inside a range, bounded in number. */
function boxes(bytes: Uint8Array, from: number, to: number, found: { left: number }): { type: string; start: number; body: number; end: number }[] {
    const out: { type: string; start: number; body: number; end: number }[] = [];
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    let at = from;
    while (at + 8 <= to && found.left-- > 0) {
        let size = view.getUint32(at);
        let body = at + 8;
        if (size === 1) {
            if (at + 16 > to) break;
            size = Number(view.getBigUint64(at + 8));
            body = at + 16;
        } else if (size === 0) size = to - at;
        if (size < body - at || at + size > to) break;
        out.push({ type: ascii(bytes.subarray(at + 4, at + 8)), start: at, body, end: at + size });
        at += size;
    }
    return out;
}

/** The metadata items of an AVIF or HEIC: its meta box's items of type Exif or XMP, found through iinf and iloc. */
function heifBlocks(bytes: Uint8Array, blocks: Blocks) {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const count = { left: BOUNDS.boxes };
    const meta = boxes(bytes, 0, bytes.length, count).find((box) => box.type === "meta");
    if (!meta) return;
    const inside = boxes(bytes, meta.body + 4, meta.end, count);
    const kinds = new Map<number, string>();
    const iinf = inside.find((box) => box.type === "iinf");
    if (iinf) {
        const version = bytes[iinf.body]!;
        for (const infe of boxes(bytes, iinf.body + (version === 0 ? 6 : 8), iinf.end, count)) {
            if (infe.type !== "infe" || bytes[infe.body]! < 2) continue;
            const v = bytes[infe.body]!;
            const id = v === 2 ? view.getUint16(infe.body + 4) : view.getUint32(infe.body + 4);
            const typeAt = infe.body + (v === 2 ? 8 : 10);
            const type = ascii(bytes.subarray(typeAt, typeAt + 4));
            const rest = ascii(bytes.subarray(typeAt + 4, Math.min(infe.end, typeAt + 200)));
            if (type === "Exif") kinds.set(id, "exif");
            else if (type === "mime" && rest.includes("application/rdf+xml")) kinds.set(id, "xmp");
        }
    }
    const iloc = inside.find((box) => box.type === "iloc");
    if (iloc && kinds.size) {
        const version = bytes[iloc.body]!;
        let at = iloc.body + 4;
        const sizes = bytes[at]!;
        const more = bytes[at + 1]!;
        const offsetSize = sizes >> 4;
        const lengthSize = sizes & 15;
        const baseSize = more >> 4;
        const indexSize = version === 1 || version === 2 ? more & 15 : 0;
        at += 2;
        const read = (width: number) => {
            let value = 0;
            for (let index = 0; index < width; index++) value = value * 256 + bytes[at + index]!;
            at += width;
            return value;
        };
        const items = version < 2 ? read(2) : read(4);
        for (let item = 0; item < Math.min(items, BOUNDS.entries) && at < iloc.end; item++) {
            const id = version < 2 ? read(2) : read(4);
            if (version === 1 || version === 2) read(2);
            read(2);
            const base = read(baseSize);
            const extents = read(2);
            const parts: Uint8Array[] = [];
            for (let extent = 0; extent < Math.min(extents, 64); extent++) {
                if (indexSize) read(indexSize);
                const offset = base + read(offsetSize);
                const length = read(lengthSize);
                if (offset + length <= bytes.length && length <= BOUNDS.bytes) parts.push(bytes.subarray(offset, offset + length));
            }
            const kind = kinds.get(id);
            const whole = parts.length === 1 ? parts[0]! : new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
            if (parts.length > 1) parts.reduce((offset, part) => (whole.set(part, offset), offset + part.length), 0);
            if (kind === "exif" && whole.length > 4) {
                // an Exif item starts with how far into it the TIFF block begins
                const skip = new DataView(whole.buffer, whole.byteOffset, whole.byteLength).getUint32(0);
                if (4 + skip < whole.length) blocks.exif ??= whole.subarray(4 + skip);
            } else if (kind === "xmp") blocks.xmp ??= utf8(whole.subarray(0, BOUNDS.bytes));
        }
    }
}

/** Reads the metadata blocks out of a picture's file, whatever its kind; what is broken is left out. */
export function blocksOf(bytes: Uint8Array): Blocks {
    const blocks: Blocks = { comments: [] };
    try {
        if (bytes[0] === 0xff && bytes[1] === 0xd8) {
            const icc: Uint8Array[] = [];
            for (const part of jpegParts(bytes)) {
                const body = part.body;
                if (part.name === "ffe1" && starts(body, EXIF_HEAD)) blocks.exif ??= body.subarray(6);
                else if (part.name === "ffe1" && starts(body, XMP_HEAD)) blocks.xmp ??= utf8(body.subarray(XMP_HEAD.length));
                else if (part.name === "ffed" && starts(body, "Photoshop 3.0\0")) blocks.iptc ??= iimOf(body.subarray(14));
                else if (part.name === "ffe2" && starts(body, "ICC_PROFILE\0")) icc.push(body.subarray(14));
                else if (part.name === "fffe") blocks.comments.push(utf8(body.subarray(0, BOUNDS.text)));
                if (part.name === "ffda") break;
            }
            if (icc.length) blocks.icc = joined(icc);
        } else if (bytes[0] === 0x89 && starts(bytes.subarray(1), "PNG")) {
            for (const part of pngParts(bytes)) {
                if (part.name === "eXIf") blocks.exif ??= part.body;
                else if (part.name === "iTXt" && starts(part.body, "XML:com.adobe.xmp\0") && part.body[18] === 0) {
                    // keyword, then the compression flag, the method, a language and a translated keyword, each ended by a zero
                    let at = 20;
                    for (let zeros = 0; zeros < 2 && at < part.body.length; at++) if (part.body[at] === 0) zeros++;
                    blocks.xmp ??= utf8(part.body.subarray(at));
                } else if (part.name === "tEXt") blocks.comments.push(ascii(part.body.subarray(0, BOUNDS.text)).replace("\0", ": "));
                if (part.name === "IDAT") break;
            }
        } else if (starts(bytes, "RIFF") && starts(bytes.subarray(8), "WEBP")) {
            for (const part of webpParts(bytes)) {
                if (part.name === "EXIF") blocks.exif ??= starts(part.body, EXIF_HEAD) ? part.body.subarray(6) : part.body;
                else if (part.name === "XMP ") blocks.xmp ??= utf8(part.body);
                else if (part.name === "ICCP") blocks.icc ??= part.body;
            }
        } else if (starts(bytes.subarray(4), "JXL ")) {
            for (const box of boxes(bytes, 0, bytes.length, { left: BOUNDS.boxes })) {
                if (box.type === "Exif" && box.end - box.body > 4) blocks.exif ??= bytes.subarray(box.body + 4, box.end);
                else if (box.type === "xml ") blocks.xmp ??= utf8(bytes.subarray(box.body, box.end));
            }
        } else if (starts(bytes.subarray(4), "ftyp")) heifBlocks(bytes, blocks);
    } catch {
        // a file broken part way gives what was read before the break
    }
    return blocks;
}

/** The IPTC records inside a Photoshop resource block (its 8BIM resource 0x0404). */
function iimOf(resources: Uint8Array): Uint8Array | undefined {
    let at = 0;
    for (let count = 0; count < BOUNDS.entries && at + 12 <= resources.length && starts(resources.subarray(at), "8BIM"); count++) {
        const id = (resources[at + 4]! << 8) | resources[at + 5]!;
        const nameLength = resources[at + 6]!;
        const nameEnd = at + 6 + 1 + nameLength + ((1 + nameLength) & 1);
        if (nameEnd + 4 > resources.length) return undefined;
        const size = new DataView(resources.buffer, resources.byteOffset + nameEnd, 4).getUint32(0);
        const body = nameEnd + 4;
        if (body + size > resources.length) return undefined;
        if (id === 0x0404) return resources.subarray(body, body + size);
        at = body + size + (size & 1);
    }
    return undefined;
}

const joined = (parts: Uint8Array[]) => {
    const out = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
    parts.reduce((offset, part) => (out.set(part, offset), offset + part.length), 0);
    return out;
};

// ---- Exif ----

/** One Exif entry: the directory it is in, its tag, its type, where its value lies in the block, and its value. */
export interface Entry {
    ifd: "image" | "exif" | "gps" | "interop" | "thumbnail";
    tag: number;
    type: number;
    count: number;
    at: number;
    value: string | number[];
}

/** The size of one value of each Exif type: byte, ASCII, short, long, rational, signed byte, undefined, signed short, signed long, signed rational, float, double. */
const SIZES: Record<number, number> = { 1: 1, 2: 1, 3: 2, 4: 4, 5: 8, 6: 1, 7: 1, 8: 2, 9: 4, 10: 8, 11: 4, 12: 8 };

/** Reads every entry of an Exif (TIFF) block, following each directory once, bounded in entries, directories and values. */
export function readExif(tiff: Uint8Array): Entry[] {
    if (tiff.length < 8 || tiff.length > BOUNDS.bytes) return [];
    const little = tiff[0] === 0x49 && tiff[1] === 0x49;
    if (!little && !(tiff[0] === 0x4d && tiff[1] === 0x4d)) return [];
    const view = new DataView(tiff.buffer, tiff.byteOffset, tiff.byteLength);
    const entries: Entry[] = [];
    const seen = new Set<number>();
    const queue: [number, Entry["ifd"]][] = [[view.getUint32(4, little), "image"]];
    while (queue.length && seen.size < BOUNDS.directories) {
        const [first, ifd] = queue.shift()!;
        // a directory already read, or one that is not inside the block, is not read (twice)
        if (seen.has(first) || first < 8 || first + 2 > tiff.length) continue;
        seen.add(first);
        const count = view.getUint16(first, little);
        for (let index = 0; index < Math.min(count, BOUNDS.entries); index++) {
            const at = first + 2 + index * 12;
            if (at + 12 > tiff.length) break;
            const tag = view.getUint16(at, little);
            const type = view.getUint16(at + 2, little);
            const many = view.getUint32(at + 4, little);
            const size = SIZES[type];
            if (!size) continue;
            const total = size * many;
            const where = total <= 4 ? at + 8 : view.getUint32(at + 8, little);
            if (where + Math.min(total, BOUNDS.values * 8) > tiff.length) continue;
            const shown = Math.min(many, BOUNDS.values);
            let value: Entry["value"];
            if (type === 2) value = ascii(tiff.subarray(where, where + Math.min(total, BOUNDS.text))).replace(/\0[\s\S]*$/, "");
            else if (type === 7) value = Array.from(tiff.subarray(where, where + Math.min(shown, 64)));
            else
                value = Array.from({ length: shown }, (_, n) => {
                    const p = where + n * size;
                    if (type === 1 || type === 6) return type === 1 ? view.getUint8(p) : view.getInt8(p);
                    if (type === 3) return view.getUint16(p, little);
                    if (type === 8) return view.getInt16(p, little);
                    if (type === 4) return view.getUint32(p, little);
                    if (type === 9) return view.getInt32(p, little);
                    if (type === 11) return view.getFloat32(p, little);
                    if (type === 12) return view.getFloat64(p, little);
                    const top = type === 5 ? view.getUint32(p, little) : view.getInt32(p, little);
                    const bottom = type === 5 ? view.getUint32(p + 4, little) : view.getInt32(p + 4, little);
                    return bottom ? top / bottom : 0;
                });
            entries.push({ ifd, tag, type, count: many, at, value });
            const pointer = Array.isArray(value) ? value[0] : undefined;
            if (pointer !== undefined && (tag === 0x8769 || tag === 0x8825 || tag === 0xa005)) queue.push([pointer, tag === 0x8769 ? "exif" : tag === 0x8825 ? "gps" : "interop"]);
        }
        // the next directory after the first is the thumbnail's
        const next = first + 2 + count * 12;
        if (ifd === "image" && next + 4 <= tiff.length) {
            const following = view.getUint32(next, little);
            if (following) queue.push([following, "thumbnail"]);
        }
    }
    return entries;
}

/** Names for the Exif tags a person may meet. */
export const TAGS: Record<number, string> = {
    0x010e: "Description", 0x010f: "Make", 0x0110: "Model", 0x0112: "Orientation", 0x011a: "X resolution", 0x011b: "Y resolution", 0x0128: "Resolution unit",
    0x0131: "Software", 0x0132: "Date changed", 0x013b: "Artist", 0x8298: "Copyright", 0x8769: "Exif directory", 0x8825: "GPS directory",
    0x0213: "YCbCr positioning", 0x9101: "Components", 0x9102: "Compressed bits per pixel", 0xa000: "Flashpix version", 0xa217: "Sensing method", 0xa300: "File source", 0xa401: "Custom rendering", 0xa404: "Digital zoom", 0xa420: "Unique ID", 0x8830: "Sensitivity type", 0x9290: "Subseconds", 0x9291: "Subseconds taken", 0x9292: "Subseconds digitized",
    0x829a: "Exposure time", 0x829d: "F-number", 0x8822: "Exposure program", 0x8827: "ISO", 0x9000: "Exif version", 0x9003: "Date taken",
    0x9004: "Date digitized", 0x9010: "Time zone", 0x9011: "Time zone taken", 0x9201: "Shutter speed", 0x9202: "Aperture", 0x9204: "Exposure bias",
    0x9207: "Metering mode", 0x9209: "Flash", 0x920a: "Focal length", 0x927c: "Maker note", 0x9286: "User comment", 0xa001: "Color space",
    0xa002: "Pixel width", 0xa003: "Pixel height", 0xa005: "Interoperability directory", 0xa402: "Exposure mode", 0xa403: "White balance",
    0xa405: "Focal length in 35 mm", 0xa406: "Scene type", 0xa430: "Owner", 0xa431: "Body serial number", 0xa433: "Lens make", 0xa434: "Lens model",
    0xa435: "Lens serial number", 0x0000: "GPS version", 0x0001: "Latitude reference", 0x0002: "Latitude", 0x0003: "Longitude reference", 0x0004: "Longitude",
    0x0005: "Altitude reference", 0x0006: "Altitude", 0x0007: "GPS time", 0x001d: "GPS date", 0x0010: "Direction reference", 0x0011: "Direction",
};

/** An entry's name: its own, or its number. */
export const tagName = (entry: Entry) => (entry.ifd === "gps" ? (entry.tag <= 0x1f ? TAGS[entry.tag] : undefined) : entry.tag > 0x1f ? TAGS[entry.tag] : undefined) ?? `Tag 0x${entry.tag.toString(16).padStart(4, "0")}`;

/** What each Exif orientation means, in words. */
export const TURNS: Record<number, string> = {
    1: "upright",
    2: "mirrored",
    3: "upside down",
    4: "upside down and mirrored",
    5: "turned a quarter left and mirrored",
    6: "turned a quarter right",
    7: "turned a quarter right and mirrored",
    8: "turned a quarter left",
};

// ---- XMP and IPTC ----

/** The simple properties of an XMP packet, by their prefixed names, from attributes and elements alike; a list's items joined. Bounded in size and in properties. */
export function readXmp(text: string): Record<string, string> {
    const found: Record<string, string> = {};
    const xml = text.slice(0, BOUNDS.bytes);
    let count = 0;
    const put = (name: string, value: string) => {
        if (count++ > BOUNDS.entries || name.startsWith("rdf:") || name.startsWith("xmlns") || name.startsWith("x:")) return;
        const clean = value.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, "&").trim();
        if (clean) found[name] = found[name] ? `${found[name]}, ${clean}` : clean;
    };
    for (const match of xml.matchAll(/\s([A-Za-z][\w.-]*:[\w.-]+)="([^"]{0,4000})"/g)) if (!match[1]!.startsWith("xml:")) put(match[1]!, match[2]!);
    // each element's own text, or its list's items; elements inside others are met in their turn
    for (const match of xml.matchAll(/<([A-Za-z][\w.-]*:[\w.-]+)(?:\s[^>]{0,2000})?>/g)) {
        if (count > BOUNDS.entries) break;
        const close = xml.indexOf(`</${match[1]}>`, match.index! + match[0].length);
        if (close < 0 || close - match.index! > 20000) continue;
        const inner = xml.slice(match.index! + match[0].length, close);
        if (/^\s*<rdf:(Alt|Seq|Bag)/.test(inner)) for (const item of inner.matchAll(/<rdf:li[^>]{0,500}>([^<]{0,4000})<\/rdf:li>/g)) put(match[1]!, item[1]!);
        else if (!inner.includes("<")) put(match[1]!, inner);
    }
    return found;
}

/** The IPTC datasets the facts show, by record 2's numbers. */
const IPTC: Record<number, string> = { 5: "Title", 25: "Keyword", 55: "Date created", 80: "By-line", 90: "City", 92: "Sublocation", 95: "Province or state", 101: "Country", 116: "Copyright notice", 120: "Caption", 122: "Caption writer" };
/** IPTC's datasets that say where. */
const IPTC_PLACE = new Set([90, 92, 95, 100, 101]);

/** Every dataset of IPTC records, bounded in number. */
export function readIptc(iim: Uint8Array): { record: number; set: number; name: string; value: string; start: number; end: number }[] {
    const out: { record: number; set: number; name: string; value: string; start: number; end: number }[] = [];
    let at = 0;
    while (at + 5 <= iim.length && iim[at] === 0x1c && out.length < BOUNDS.entries) {
        const record = iim[at + 1]!;
        const set = iim[at + 2]!;
        const length = (iim[at + 3]! << 8) | iim[at + 4]!;
        if (length & 0x8000 || at + 5 + length > iim.length) break;
        out.push({ record, set, name: (record === 2 && IPTC[set]) || `IPTC ${record}:${set}`, value: utf8(iim.subarray(at + 5, at + 5 + length)), start: at, end: at + 5 + length });
        at += 5 + length;
    }
    return out;
}

/** The colour profile's own name, from its description tag. */
export function profileName(icc: Uint8Array): string | undefined {
    if (icc.length < 132) return undefined;
    const view = new DataView(icc.buffer, icc.byteOffset, icc.byteLength);
    const count = Math.min(view.getUint32(128), 200);
    for (let index = 0; index < count; index++) {
        const at = 132 + index * 12;
        if (at + 12 > icc.length) return undefined;
        if (ascii(icc.subarray(at, at + 4)) !== "desc") continue;
        const offset = view.getUint32(at + 4);
        const size = view.getUint32(at + 8);
        if (offset + Math.min(size, 12) > icc.length) return undefined;
        const kind = ascii(icc.subarray(offset, offset + 4));
        if (kind === "desc") return ascii(icc.subarray(offset + 12, Math.min(icc.length, offset + 12 + Math.min(view.getUint32(offset + 8), 200)))).replace(/\0.*$/, "");
        if (kind === "mluc" && offset + 28 <= icc.length) {
            const length = view.getUint32(offset + 20);
            const start = offset + view.getUint32(offset + 24);
            if (start + length > icc.length) return undefined;
            return new TextDecoder("utf-16be").decode(icc.subarray(start, start + Math.min(length, 400)));
        }
    }
    return undefined;
}

// ---- the facts ----

/** A picture's facts, as the panel shows them: the plain rows, everything else, what can be changed, the place and the orientation. */
export interface Facts {
    rows: [string, string][];
    everything: [string, string][];
    found: Edits;
    place?: { latitude: number; longitude: number };
    orientation?: number;
}

const number = (value: string | number[] | undefined) => (Array.isArray(value) ? value[0] : undefined);
const round = (value: number, places = 1) => String(Math.round(value * 10 ** places) / 10 ** places);

/** The facts of a picture's file. */
export function factsOf(bytes: Uint8Array): Facts {
    const blocks = blocksOf(bytes);
    const exif = blocks.exif ? readExif(blocks.exif) : [];
    const xmp = blocks.xmp ? readXmp(blocks.xmp) : {};
    const iptc = blocks.iptc ? readIptc(blocks.iptc) : [];
    const find = (tag: number, ifd?: Entry["ifd"]) => exif.find((entry) => entry.tag === tag && (ifd ? entry.ifd === ifd : entry.ifd !== "gps" && entry.ifd !== "thumbnail"))?.value;
    const text = (value: string | number[] | undefined) => (typeof value === "string" ? value.trim() : undefined);
    const ipt = (set: number) => iptc.filter((each) => each.record === 2 && each.set === set).map((each) => each.value).join(", ") || undefined;
    const rows: [string, string][] = [];
    const add = (label: string, value: string | undefined) => value && rows.push([label, value]);
    add("Camera", [text(find(0x010f)), text(find(0x0110))].filter(Boolean).join(" ") || undefined);
    add("Lens", text(find(0xa434)) ?? xmp["aux:Lens"] ?? xmp["exifEX:LensModel"]);
    const time = number(find(0x829a));
    const stop = number(find(0x829d));
    const iso = number(find(0x8827));
    const focal = number(find(0x920a));
    add("Exposure", [time ? (time < 1 ? `1/${Math.round(1 / time)} s` : `${round(time)} s`) : "", stop ? `f/${round(stop)}` : "", iso ? `ISO ${iso}` : "", focal ? `${round(focal)} mm` : ""].filter(Boolean).join(", ") || undefined);
    add("Date taken", text(find(0x9003))?.replace(/^(\d{4}):(\d\d):(\d\d)/, "$1-$2-$3") ?? xmp["exif:DateTimeOriginal"] ?? xmp["xmp:CreateDate"] ?? ipt(55));
    add("Color profile", blocks.icc ? (profileName(blocks.icc) ?? "present") : undefined);
    const orientation = number(find(0x0112));
    if (orientation && orientation >= 1 && orientation <= 8) add("Orientation", `${TURNS[orientation]}${orientation === 1 ? "" : ", shown upright"} (Exif ${orientation})`);
    const angle = (key: number, sign: number) => {
        const value = find(key, "gps");
        return Array.isArray(value) && value.length >= 3 ? sign * (value[0]! + value[1]! / 60 + value[2]! / 3600) : undefined;
    };
    const latitude = angle(0x0002, text(find(0x0001, "gps")) === "S" ? -1 : 1);
    const longitude = angle(0x0004, text(find(0x0003, "gps")) === "W" ? -1 : 1);
    const place = latitude !== undefined && longitude !== undefined && Number.isFinite(latitude) && Number.isFinite(longitude) ? { latitude, longitude } : undefined;
    if (place) add("Place", `${place.latitude.toFixed(5)}, ${place.longitude.toFixed(5)}`);
    const found: Edits = {
        caption: text(find(0x010e)) || xmp["dc:description"] || ipt(120),
        alt: xmp["Iptc4xmpCore:AltTextAccessibility"],
        author: text(find(0x013b)) || xmp["dc:creator"] || ipt(80),
        copyright: text(find(0x8298)) || xmp["dc:rights"] || ipt(116),
        date: text(find(0x9003))?.replace(/^(\d{4}):(\d\d):(\d\d)/, "$1-$2-$3") || xmp["exif:DateTimeOriginal"],
    };
    const shown = (entry: Entry) => (typeof entry.value === "string" ? entry.value : entry.type === 7 ? `${entry.count} bytes` : entry.value.slice(0, 8).map((value) => round(value, 4)).join(" ") + (entry.value.length > 8 ? " …" : ""));
    const everything: [string, string][] = [
        ...exif.filter((entry) => entry.tag !== 0x8769 && entry.tag !== 0x8825 && entry.tag !== 0xa005).map((entry): [string, string] => [`${entry.ifd === "gps" ? "GPS " : entry.ifd === "thumbnail" ? "Thumbnail " : ""}${tagName(entry)}`, shown(entry)]),
        ...Object.entries(xmp).map(([name, value]): [string, string] => [name, value.slice(0, 300)]),
        ...iptc.map((each): [string, string] => [each.name, each.value.slice(0, 300)]),
        ...blocks.comments.map((comment): [string, string] => ["Comment", comment.slice(0, 300)]),
    ];
    return { rows, everything, found, place, orientation };
}

// ---- writing ----

/** An Exif block to go out: the original's, byte for byte, but upright, with its place emptied when it is not kept and the fields she changed emptied so that what she wrote (in XMP) is what is read. */
export function exifOut(tiff: Uint8Array, keep: Keep, edits: Edits): Uint8Array | undefined {
    if (keep === "none") return undefined;
    const out = tiff.slice();
    const entries = readExif(out);
    if (!entries.length) return undefined;
    const little = out[0] === 0x49;
    const view = new DataView(out.buffer);
    const where = (entry: Entry) => (SIZES[entry.type]! * entry.count <= 4 ? entry.at + 8 : view.getUint32(entry.at + 8, little));
    const blank = (entry: Entry) => out.fill(0, where(entry), Math.min(out.length, where(entry) + SIZES[entry.type]! * entry.count));
    const changed: Record<number, string | undefined> = { 0x010e: edits.caption, 0x013b: edits.author, 0x8298: edits.copyright, 0x9003: edits.date, 0x9004: edits.date };
    for (const entry of entries) {
        if (entry.tag === 0x0112 && entry.ifd === "image" && entry.type === 3) view.setUint16(entry.at + 8, 1, little);
        if (keep === "noplace" && entry.ifd === "gps") blank(entry);
        if (entry.ifd !== "gps" && changed[entry.tag] !== undefined && entry.type === 2) blank(entry);
    }
    if (keep === "noplace") {
        // the place's directory is left with no entries at all
        const pointer = entries.find((entry) => entry.tag === 0x8825);
        const first = number(pointer?.value);
        if (first !== undefined && first + 2 <= out.length) {
            const count = view.getUint16(first, little);
            out.fill(0, first, Math.min(out.length, first + 2 + count * 12));
        }
    }
    return out;
}

const xmlText = (value: string) => value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
/** The XMP properties that say where. */
const XMP_PLACE = /^(exif:GPS|Iptc4xmpCore:Location|photoshop:(City|State|Country)|Iptc4xmpExt:Location)/;

/** An XMP packet to go out: the original's, without the place when it is not kept, and with what she changed written in. */
export function xmpOut(original: string | undefined, keep: Keep, edits: Edits): string | undefined {
    if (keep === "none") return undefined;
    let xml = original ?? "";
    const props: [string, string | undefined][] = [
        ["dc:description", edits.caption],
        ["Iptc4xmpCore:AltTextAccessibility", edits.alt],
        ["dc:creator", edits.author],
        ["dc:rights", edits.copyright],
        ["exif:DateTimeOriginal", edits.date],
    ];
    const strip = (pattern: RegExp) => {
        xml = xml.replace(new RegExp(`\\s(${pattern.source}[\\w.-]*)="[^"]*"`, "g"), "");
        xml = xml.replace(new RegExp(`<(${pattern.source}[\\w.-]*)(\\s[^>]*)?>[\\s\\S]*?</\\1>`, "g"), "");
        xml = xml.replace(new RegExp(`<(${pattern.source}[\\w.-]*)(\\s[^>]*)?/>`, "g"), "");
    };
    if (keep === "noplace") strip(XMP_PLACE);
    for (const [name, value] of props) if (value !== undefined) strip(new RegExp(name.replace(".", "\\.")));
    const given = props.filter(([, value]) => value);
    if (!given.length) return original ? xml : undefined;
    const items = given.map(([name, value]) => (name.startsWith("dc:") || name.startsWith("Iptc4xmpCore:") ? `<${name}><rdf:${name === "dc:creator" ? "Seq" : "Alt"}><rdf:li${name === "dc:creator" ? "" : ' xml:lang="x-default"'}>${xmlText(value!)}</rdf:li></rdf:${name === "dc:creator" ? "Seq" : "Alt"}></${name}>` : `<${name}>${xmlText(value!)}</${name}>`)).join("");
    const description = `<rdf:Description rdf:about="" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:exif="http://ns.adobe.com/exif/1.0/" xmlns:Iptc4xmpCore="http://iptc.org/std/Iptc4xmpCore/1.0/xmlns/">${items}</rdf:Description>`;
    if (xml.includes("</rdf:RDF>")) return xml.replace("</rdf:RDF>", `${description}</rdf:RDF>`);
    return `<?xpacket begin="\u{feff}" id="W5M0MpCehiHzreSzNTczkc9d"?><x:xmpmeta xmlns:x="adobe:ns:meta/"><rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">${description}</rdf:RDF></x:xmpmeta><?xpacket end="w"?>`;
}

/** IPTC records to go out: the original's, without where it was when the place is not kept and without the datasets she changed (written in XMP instead). */
export function iptcOut(iim: Uint8Array | undefined, keep: Keep, edits: Edits): Uint8Array | undefined {
    if (keep === "none" || !iim) return undefined;
    const changed = new Set<number>([...(edits.caption !== undefined ? [120] : []), ...(edits.author !== undefined ? [80] : []), ...(edits.copyright !== undefined ? [116] : []), ...(edits.date !== undefined ? [55] : [])]);
    const kept = readIptc(iim).filter((each) => !(each.record === 2 && ((keep === "noplace" && IPTC_PLACE.has(each.set)) || changed.has(each.set))));
    return kept.length ? joined(kept.map((each) => iim.subarray(each.start, each.end))) : undefined;
}

/** What goes out with a picture: its blocks as kept and changed. */
export function blocksOut(original: Uint8Array, keep: Keep, edits: Edits): { exif?: Uint8Array; xmp?: string; iptc?: Uint8Array } {
    if (keep === "none") return {};
    const blocks = blocksOf(original);
    return { exif: blocks.exif && exifOut(blocks.exif, keep, edits), xmp: xmpOut(blocks.xmp, keep, edits), iptc: iptcOut(blocks.iptc, keep, edits) };
}

const word = (text: string) => new TextEncoder().encode(text);
const be32 = (value: number) => [(value >>> 24) & 255, (value >>> 16) & 255, (value >>> 8) & 255, value & 255];
const le32 = (value: number) => [value & 255, (value >>> 8) & 255, (value >>> 16) & 255, (value >>> 24) & 255];

/**
 * A file with the blocks put in, in the place its format has for each: a JPEG's APP1 and APP13
 * segments, a PNG's eXIf and iTXt chunks, a WebP's EXIF and XMP chunks (its extended header made or
 * marked), a JPEG XL's Exif and xml boxes (a bare codestream put in a container first). An AVIF takes
 * them from its encoder; a PNG has no place for IPTC. `crc` is zip.ts's CRC-32.
 */
export function withMetadata(file: Uint8Array, blocks: { exif?: Uint8Array; xmp?: string; iptc?: Uint8Array }, crc: (bytes: Uint8Array) => number, size: { width: number; height: number }): Uint8Array {
    const { exif, xmp, iptc } = blocks;
    if (!exif && !xmp && !iptc) return file;
    if (file[0] === 0xff && file[1] === 0xd8) {
        const segment = (marker: number, body: Uint8Array) => (body.length + 2 > 0xffff ? new Uint8Array() : new Uint8Array([0xff, marker, (body.length + 2) >> 8, (body.length + 2) & 255, ...body]));
        const added: Uint8Array[] = [];
        if (exif) added.push(segment(0xe1, joined([word(EXIF_HEAD), exif])));
        if (xmp) added.push(segment(0xe1, joined([word(XMP_HEAD), word(xmp)])));
        if (iptc) {
            const resource = joined([word("Photoshop 3.0\0"), word("8BIM"), new Uint8Array([0x04, 0x04, 0, 0, ...be32(iptc.length)]), iptc, new Uint8Array(iptc.length & 1)]);
            added.push(segment(0xed, resource));
        }
        // after the start and any JFIF header
        const parts = jpegParts(file);
        const after = parts[1]?.name === "ffe0" ? parts[1].end : 2;
        return joined([file.subarray(0, after), ...added, file.subarray(after)]);
    }
    if (file[0] === 0x89) {
        const chunk = (type: string, body: Uint8Array) => {
            const out = new Uint8Array(12 + body.length);
            out.set(be32(body.length), 0);
            out.set(word(type), 4);
            out.set(body, 8);
            out.set(be32(crc(out.subarray(4, 8 + body.length))), 8 + body.length);
            return out;
        };
        const added: Uint8Array[] = [];
        if (exif) added.push(chunk("eXIf", exif));
        if (xmp) added.push(chunk("iTXt", joined([word("XML:com.adobe.xmp\0\0\0\0\0"), word(xmp)])));
        const idat = pngParts(file).find((part) => part.name === "IDAT")!;
        return joined([file.subarray(0, idat.start), ...added, file.subarray(idat.start)]);
    }
    if (starts(file, "RIFF")) {
        const parts = webpParts(file);
        const chunk = (type: string, body: Uint8Array) => joined([word(type), new Uint8Array(le32(body.length)), body, new Uint8Array(body.length & 1)]);
        const head = parts.find((part) => part.name === "VP8X") ? undefined : (() => {
            // a simple WebP gets the extended header that metadata needs: flags, then the canvas less one, 24 bits each
            const alpha = parts.some((part) => part.name === "VP8L" && part.body.length > 4 && (part.body[4]! & 0x10) !== 0);
            const body = new Uint8Array(10);
            body[0] = alpha ? 0x10 : 0;
            body.set(le32(size.width - 1).slice(0, 3), 4);
            body.set(le32(size.height - 1).slice(0, 3), 7);
            return chunk("VP8X", body);
        })();
        const rest = parts.map((part) => {
            const bytes = file.slice(part.start, part.end);
            if (part.name === "VP8X") bytes[8] = bytes[8]! | (exif ? 0x08 : 0) | (xmp ? 0x04 : 0);
            return bytes;
        });
        if (head) head[8] = head[8]! | (exif ? 0x08 : 0) | (xmp ? 0x04 : 0);
        const body = joined([...(head ? [head] : []), ...rest, ...(exif ? [chunk("EXIF", exif)] : []), ...(xmp ? [chunk("XMP ", word(xmp))] : [])]);
        return joined([word("RIFF"), new Uint8Array(le32(body.length + 4)), word("WEBP"), body]);
    }
    if ((file[0] === 0xff && file[1] === 0x0a) || starts(file.subarray(4), "JXL ")) {
        const box = (type: string, body: Uint8Array) => joined([new Uint8Array(be32(8 + body.length)), word(type), body]);
        const container =
            file[0] === 0xff
                ? joined([new Uint8Array([0, 0, 0, 12, 0x4a, 0x58, 0x4c, 0x20, 0x0d, 0x0a, 0x87, 0x0a]), box("ftyp", joined([word("jxl "), new Uint8Array(4), word("jxl ")])), box("jxlc", file)])
                : file;
        return joined([container, ...(exif ? [box("Exif", joined([new Uint8Array(4), exif]))] : []), ...(xmp ? [box("xml ", word(xmp))] : [])]);
    }
    return file;
}
