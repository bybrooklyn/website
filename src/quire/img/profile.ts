// Colour profiles: what a picture's profile says its numbers mean, carried out with an export byte for
// byte, or the numbers converted to sRGB instead. A profile is never trusted: it is checked (its size,
// its signature, its kind, its table of tags) and bounded before it is kept or written anywhere.
//
// Display P3, the space most phone photographs are in, is known here by its published primaries
// (red 0.680 0.320, green 0.265 0.690, blue 0.150 0.060, white D65) and sRGB's curve; its profile is
// written out by hand from those (`displayP3Profile`) for a picture that says it is P3 without carrying
// a profile (a HEIC's nclx), and the conversion to sRGB is worked out from the same numbers. Colors
// outside sRGB are clipped channel by channel in linear light, as browsers clip them on the screen.
//
//   const icc = checkProfile(found);                 the profile, or undefined if it is not one to carry
//   const jpeg = withProfile(file, icc, deflated);   in a JPEG's APP2, a WebP's ICCP or a PNG's iCCP

import { jpegParts, pngParts, webpParts } from "../core/picture-bytes";

/** The largest profile carried: anything larger is taken to be damaged. */
export const MOST_PROFILE = 4 * 1024 * 1024;
/** The most tags a profile carried may list. */
export const MOST_TAGS = 200;

const ascii = (bytes: Uint8Array) => String.fromCharCode(...bytes);

/**
 * A profile fit to carry, cut to the length its header gives, or undefined: one under 132 bytes or over
 * `MOST_PROFILE`, longer in its header than the bytes there are, without its `acsp` signature, not for
 * RGB numbers, or with a tag table or a tag reaching past its end.
 */
export function checkProfile(icc: Uint8Array | undefined): Uint8Array | undefined {
    if (!icc || icc.length < 132 || icc.length > MOST_PROFILE) return undefined;
    const view = new DataView(icc.buffer, icc.byteOffset, icc.byteLength);
    const size = view.getUint32(0);
    if (size < 132 || size > icc.length) return undefined;
    if (ascii(icc.subarray(36, 40)) !== "acsp" || ascii(icc.subarray(16, 20)) !== "RGB ") return undefined;
    const count = view.getUint32(128);
    if (count > MOST_TAGS || 132 + count * 12 > size) return undefined;
    for (let index = 0; index < count; index++) {
        const at = 132 + index * 12;
        const offset = view.getUint32(at + 4);
        const length = view.getUint32(at + 8);
        if (offset < 132 || offset + length > size) return undefined;
    }
    return icc.subarray(0, size);
}

// ---- Display P3, from its published numbers ----

type Matrix = [number, number, number, number, number, number, number, number, number];

const times = (a: Matrix, b: Matrix): Matrix => {
    const out = new Array(9).fill(0) as Matrix;
    for (let row = 0; row < 3; row++) for (let column = 0; column < 3; column++) for (let k = 0; k < 3; k++) out[row * 3 + column] += a[row * 3 + k]! * b[k * 3 + column]!;
    return out;
};
const inverse = (m: Matrix): Matrix => {
    const [a, b, c, d, e, f, g, h, i] = m;
    const det = a * (e * i - f * h) - b * (d * i - f * g) + c * (d * h - e * g);
    return [(e * i - f * h) / det, (c * h - b * i) / det, (b * f - c * e) / det, (f * g - d * i) / det, (a * i - c * g) / det, (c * d - a * f) / det, (d * h - e * g) / det, (b * g - a * h) / det, (a * e - b * d) / det];
};
const apply = (m: Matrix, v: [number, number, number]): [number, number, number] => [m[0] * v[0] + m[1] * v[1] + m[2] * v[2], m[3] * v[0] + m[4] * v[1] + m[5] * v[2], m[6] * v[0] + m[7] * v[1] + m[8] * v[2]];

/** The matrix from linear RGB to XYZ for primaries and a white, each as x and y. */
export function toXyz(red: [number, number], green: [number, number], blue: [number, number], white: [number, number]): Matrix {
    const column = ([x, y]: [number, number]): [number, number, number] => [x / y, 1, (1 - x - y) / y];
    const [r, g, b] = [column(red), column(green), column(blue)];
    const primaries: Matrix = [r[0], g[0], b[0], r[1], g[1], b[1], r[2], g[2], b[2]];
    const scale = apply(inverse(primaries), column(white));
    return [r[0] * scale[0], g[0] * scale[1], b[0] * scale[2], r[1] * scale[0], g[1] * scale[1], b[1] * scale[2], r[2] * scale[0], g[2] * scale[1], b[2] * scale[2]];
}

const D65: [number, number] = [0.3127, 0.329];
const P3_XYZ = toXyz([0.68, 0.32], [0.265, 0.69], [0.15, 0.06], D65);
const SRGB_XYZ = toXyz([0.64, 0.33], [0.3, 0.6], [0.15, 0.06], D65);

/** Linear Display P3 to linear sRGB, both with a D65 white. */
export const P3_TO_SRGB: Matrix = times(inverse(SRGB_XYZ), P3_XYZ);

/** Bradford's adaptation from D65 to D50, the white profiles keep their numbers against. */
export function bradford(): Matrix {
    const cone: Matrix = [0.8951, 0.2664, -0.1614, -0.7502, 1.7135, 0.0367, 0.0389, -0.0685, 1.0296];
    const d65 = apply(cone, [0.95047, 1, 1.08883]);
    const d50 = apply(cone, [0.96422, 1, 0.82521]);
    return times(inverse(cone), times([d50[0] / d65[0], 0, 0, 0, d50[1] / d65[1], 0, 0, 0, d50[2] / d65[2]], cone));
}

/** sRGB's curve, from an encoded number to linear light. */
export const decode1 = (v: number): number => (v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4));
/** sRGB's curve, from linear light to an encoded number. */
export const encode1 = (x: number): number => (x <= 0.0031308 ? 12.92 * x : 1.055 * Math.pow(x, 1 / 2.4) - 0.055);

/** One color from Display P3 to sRGB, each channel from 0 to 1: through linear light, clipped channel by channel. */
export function p3ToSrgb(r: number, g: number, b: number): [number, number, number] {
    const [x, y, z] = apply(P3_TO_SRGB, [decode1(r), decode1(g), decode1(b)]);
    return [encode1(Math.min(1, Math.max(0, x))), encode1(Math.min(1, Math.max(0, y))), encode1(Math.min(1, Math.max(0, z)))];
}

/** Pixels (RGBA, 8 bits) from Display P3 to sRGB, as the shaders do it, for tests and for the processor. */
export function pixelsToSrgb(pixels: Uint8ClampedArray): Uint8ClampedArray {
    const out = new Uint8ClampedArray(pixels.length);
    for (let at = 0; at < pixels.length; at += 4) {
        const [r, g, b] = p3ToSrgb(pixels[at]! / 255, pixels[at + 1]! / 255, pixels[at + 2]! / 255);
        out[at] = Math.round(r * 255);
        out[at + 1] = Math.round(g * 255);
        out[at + 2] = Math.round(b * 255);
        out[at + 3] = pixels[at + 3]!;
    }
    return out;
}

/**
 * A Display P3 profile (ICC version 4.3, a matrix and curves), written here from the published
 * primaries and sRGB's curve: the primaries made D50 by Bradford's adaptation, the curve as a
 * parametric one of type 3, and the adaptation kept in its `chad` tag. 556 bytes.
 */
export function displayP3Profile(): Uint8Array {
    const fixed = (value: number) => {
        const out = new Uint8Array(4);
        new DataView(out.buffer).setInt32(0, Math.round(value * 65536));
        return out;
    };
    const join = (parts: Uint8Array[]) => {
        const out = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
        parts.reduce((at, part) => (out.set(part, at), at + part.length), 0);
        return out;
    };
    const text = (value: string) => Uint8Array.from(value, (char) => char.charCodeAt(0));
    const u32 = (value: number) => Uint8Array.of(value >>> 24, (value >>> 16) & 255, (value >>> 8) & 255, value & 255);
    const pad = (bytes: Uint8Array) => join([bytes, new Uint8Array((4 - (bytes.length % 4)) % 4)]);
    const xyz = (values: number[]) => join([text("XYZ "), new Uint8Array(4), ...values.map(fixed)]);
    const mluc = (words: string) => {
        const utf16 = new Uint8Array(words.length * 2);
        [...words].forEach((char, at) => (utf16[at * 2 + 1] = char.charCodeAt(0)));
        return pad(join([text("mluc"), new Uint8Array(4), u32(1), u32(12), text("enUS"), u32(utf16.length), u32(28), utf16]));
    };
    const adapt = bradford();
    const d50 = times(adapt, P3_XYZ);
    const curve = join([text("para"), new Uint8Array(4), Uint8Array.of(0, 3, 0, 0), ...[2.4, 1 / 1.055, 0.055 / 1.055, 1 / 12.92, 0.04045].map(fixed)]);
    const tags: [string, Uint8Array][] = [
        ["desc", mluc("Display P3")],
        ["cprt", mluc("No copyright, use freely")],
        ["wtpt", xyz([0.9642, 1, 0.8249])],
        ["rXYZ", xyz([d50[0], d50[3], d50[6]])],
        ["gXYZ", xyz([d50[1], d50[4], d50[7]])],
        ["bXYZ", xyz([d50[2], d50[5], d50[8]])],
        ["rTRC", curve],
        ["gTRC", curve],
        ["bTRC", curve],
        ["chad", join([text("sf32"), new Uint8Array(4), ...adapt.map(fixed)])],
    ];
    // the three curves share one copy of their bytes, as profiles may
    const table: Uint8Array[] = [];
    const bodies: Uint8Array[] = [];
    let offset = 132 + tags.length * 12;
    const placed = new Map<Uint8Array, number>();
    for (const [name, body] of tags) {
        let at = placed.get(body);
        if (at === undefined) {
            at = offset;
            placed.set(body, at);
            bodies.push(body);
            offset += body.length;
        }
        table.push(join([text(name), u32(at), u32(body.length)]));
    }
    const size = offset;
    const header = join([u32(size), new Uint8Array(4), Uint8Array.of(4, 0x30, 0, 0), text("mntrRGB XYZ "), Uint8Array.of(0x07, 0xea, 0, 11, 0, 14, 0, 0, 0, 0, 0, 0), text("acsp"), new Uint8Array(24), new Uint8Array(4), fixed(0.9642), fixed(1), fixed(0.8249), new Uint8Array(48)]);
    return join([header, u32(tags.length), ...table, ...bodies]);
}

// ---- where a profile goes in a file ----

const be32 = (value: number) => [(value >>> 24) & 255, (value >>> 16) & 255, (value >>> 8) & 255, value & 255];
const le32 = (value: number) => [value & 255, (value >>> 8) & 255, (value >>> 16) & 255, (value >>> 24) & 255];
const joined = (parts: Uint8Array[]) => {
    const out = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
    parts.reduce((offset, part) => (out.set(part, offset), offset + part.length), 0);
    return out;
};
const word = (text: string) => new TextEncoder().encode(text);

/** The bytes of a profile deflated (zlib's form, which a PNG's iCCP wants), by the browser's own `CompressionStream`. */
export async function deflated(bytes: Uint8Array): Promise<Uint8Array> {
    const stream = new Blob([bytes as BlobPart]).stream().pipeThrough(new CompressionStream("deflate"));
    return new Uint8Array(await new Response(stream).arrayBuffer());
}

/** Inflated bytes, read only as far as `MOST_PROFILE` and refused past it, by the browser's own `DecompressionStream`. */
export async function inflated(bytes: Uint8Array): Promise<Uint8Array | undefined> {
    try {
        const reader = new Blob([bytes as BlobPart]).stream().pipeThrough(new DecompressionStream("deflate")).getReader();
        const parts: Uint8Array[] = [];
        let total = 0;
        for (;;) {
            const { done, value } = await reader.read();
            if (done) break;
            total += value.length;
            if (total > MOST_PROFILE) {
                void reader.cancel();
                return undefined;
            }
            parts.push(value);
        }
        return joined(parts);
    } catch {
        return undefined;
    }
}

/** A PNG's profile, from its iCCP chunk inflated, checked; undefined where it has none or it is not one to carry. */
export async function pngProfile(bytes: Uint8Array): Promise<Uint8Array | undefined> {
    const chunk = pngParts(bytes).find((part) => part.name === "iCCP");
    if (!chunk) return undefined;
    const zero = chunk.body.indexOf(0);
    if (zero < 1 || zero > 79 || chunk.body[zero + 1] !== 0) return undefined;
    return checkProfile(await inflated(chunk.body.subarray(zero + 2)));
}

/**
 * A file with a profile put in where its format keeps one: a JPEG's APP2 segments (65,519 bytes of it
 * to a segment, up to 255), a WebP's ICCP chunk (just after its extended header, made where there was
 * none), a PNG's iCCP chunk (the profile deflated, given as `squeezed`). A file that already has one, or
 * of another kind, is given back as it was. `crc` is zip.ts's CRC-32, for a PNG's chunk.
 */
export function withProfile(file: Uint8Array, icc: Uint8Array, crc: (bytes: Uint8Array) => number, size: { width: number; height: number }, squeezed?: Uint8Array): Uint8Array {
    if (file[0] === 0xff && file[1] === 0xd8) {
        const parts = jpegParts(file);
        if (parts.some((part) => part.name === "ffe2" && ascii(part.body.subarray(0, 12)) === "ICC_PROFILE\0")) return file;
        const piece = 65_519;
        const count = Math.ceil(icc.length / piece);
        if (count > 255) return file;
        const segments: Uint8Array[] = [];
        for (let index = 0; index < count; index++) {
            const body = icc.subarray(index * piece, (index + 1) * piece);
            segments.push(joined([Uint8Array.of(0xff, 0xe2, (body.length + 16) >> 8, (body.length + 16) & 255), word("ICC_PROFILE\0"), Uint8Array.of(index + 1, count), body]));
        }
        // after the start, a JFIF header and Exif, before everything else
        let after = 2;
        for (const part of parts.slice(1)) {
            if (part.name === "ffe0" || part.name === "ffe1") after = part.end;
            else break;
        }
        return joined([file.subarray(0, after), ...segments, file.subarray(after)]);
    }
    if (file[0] === 0x89) {
        if (!squeezed) return file;
        const parts = pngParts(file);
        if (parts.some((part) => part.name === "iCCP" || part.name === "sRGB")) return file;
        const body = joined([word("Display profile\0\0"), squeezed]);
        const chunk = new Uint8Array(12 + body.length);
        chunk.set(be32(body.length), 0);
        chunk.set(word("iCCP"), 4);
        chunk.set(body, 8);
        chunk.set(be32(crc(chunk.subarray(4, 8 + body.length))), 8 + body.length);
        // straight after the header, before any image data, as the format asks
        const header = parts.find((part) => part.name === "IHDR");
        if (!header) return file;
        return joined([file.subarray(0, header.end), chunk, file.subarray(header.end)]);
    }
    if (ascii(file.subarray(0, 4)) === "RIFF" && ascii(file.subarray(8, 12)) === "WEBP") {
        const parts = webpParts(file);
        if (parts.some((part) => part.name === "ICCP")) return file;
        const chunk = (type: string, body: Uint8Array) => joined([word(type), new Uint8Array(le32(body.length)), body, new Uint8Array(body.length & 1)]);
        let head = parts.find((part) => part.name === "VP8X") ? undefined : (() => {
            const alpha = parts.some((part) => part.name === "VP8L" && part.body.length > 4 && (part.body[4]! & 0x10) !== 0);
            const body = new Uint8Array(10);
            body[0] = alpha ? 0x10 : 0;
            body.set(le32(size.width - 1).slice(0, 3), 4);
            body.set(le32(size.height - 1).slice(0, 3), 7);
            return chunk("VP8X", body);
        })();
        const rest: Uint8Array[] = [];
        for (const part of parts) {
            const bytes = file.slice(part.start, part.end);
            if (part.name === "VP8X") {
                bytes[8] = bytes[8]! | 0x20;
                rest.push(bytes, chunk("ICCP", icc));
            } else rest.push(bytes);
        }
        if (head) {
            head = head.slice();
            head[8] = head[8]! | 0x20;
            rest.unshift(head, chunk("ICCP", icc));
        }
        const body = joined(rest);
        return joined([word("RIFF"), new Uint8Array(le32(body.length + 4)), word("WEBP"), body]);
    }
    return file;
}
