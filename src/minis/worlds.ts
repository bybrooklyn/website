// A sand world as text, for a link or a file: every cell's material, and for pride sand its stripe,
// in runs of the same, squeezed by the browser's own deflate (`CompressionStream`) where it has one,
// written in the letters an address may carry. Temperatures and shades are not kept: an opened world
// is made as the brush makes it, each material at its own temperature with a shade by chance.
//
// The bytes, before squeezing: 1 (the version), the width and height in two bytes each, low first,
// the number of the striped material (0 for none), then runs to the last cell, each a token and how
// many cells it covers in the seven bits a byte way (LEB128). A token under 64 is a material; 64 and
// over is the striped material in stripe (token - 64). The text is "z" and the squeezed bytes, or "p"
// and the bytes as they are where the browser cannot squeeze, in base64 with - and _ (RFC 4648 §5).
//
// What is opened is checked before anything is believed: a world larger than the engine is asked
// for, runs that do not cover it exactly, a token with no meaning, text or squeezed bytes past a
// bound, all are refused quietly with undefined. Unsqueezing stops at the bound, so a few bytes that
// would grow to gigabytes cost no more than the bound.

/** A world read from its text: its size, the striped material's number, and a token for every cell, row after row. */
export interface Opened {
    width: number;
    height: number;
    striped: number;
    tokens: Uint8Array;
}

/** The most cells a world may have to be opened: the engine's largest world, 1024 by 576. */
export const MOST_CELLS = 1024 * 576;
/** The longest text that is read at all, from an address or a file. */
export const MOST_TEXT = 4_000_000;
/** The longest a link may be before the world is saved as a file instead. */
export const LINK_MOST = 16_000;
/** Where the stripes begin among the tokens. */
const STRIPED = 64;
/** The most bytes a world can take before squeezing: the head, and at most four bytes a cell. */
const MOST_BYTES = 6 + 4 * MOST_CELLS;

/**
 * The tokens of a world kept as the engine keeps it, `stride` cells of four bytes to a row with
 * `border` cells of frame around it: each cell's material, or for one of material `striped`, its
 * stripe (its shade over 4) past 64. A material of 64 or more, which no world has, becomes air.
 */
export function tokensOf(bytes: Uint8Array, stride: number, border: number, width: number, height: number, striped: number): Uint8Array {
    const tokens = new Uint8Array(width * height);
    for (let y = 0; y < height; y++) {
        const row = ((y + border) * stride + border) * 4;
        for (let x = 0; x < width; x++) {
            const material = bytes[row + x * 4]!;
            tokens[y * width + x] = striped && material === striped ? STRIPED + (bytes[row + x * 4 + 1]! >> 2) : material < STRIPED ? material : 0;
        }
    }
    return tokens;
}

/** Writes opened tokens into a world kept as the engine keeps it, material and stripe only; the engine is then told (`rewritten`). */
export function writeTokens(opened: Opened, bytes: Uint8Array, stride: number, border: number): void {
    for (let y = 0; y < opened.height; y++) {
        const row = ((y + border) * stride + border) * 4;
        for (let x = 0; x < opened.width; x++) {
            const token = opened.tokens[y * opened.width + x]!;
            const at = row + x * 4;
            bytes[at] = token >= STRIPED ? opened.striped : token;
            bytes[at + 1] = token >= STRIPED ? (token - STRIPED) << 2 : 0;
            bytes[at + 2] = 0;
            bytes[at + 3] = 0;
        }
    }
}

/** The bytes of a world, before squeezing: its head, then its runs. */
export function encode(tokens: Uint8Array, width: number, height: number, striped: number): Uint8Array {
    const out: number[] = [1, width & 255, width >> 8, height & 255, height >> 8, striped];
    let at = 0;
    while (at < tokens.length) {
        const token = tokens[at]!;
        let run = 1;
        while (at + run < tokens.length && tokens[at + run] === token) run++;
        out.push(token);
        for (let left = run; ; left >>= 7) {
            if (left < 128) {
                out.push(left);
                break;
            }
            out.push((left & 127) | 128);
        }
        at += run;
    }
    return Uint8Array.from(out);
}

/** A world's bytes read back, or undefined for anything that is not one the engine can be given. */
export function decode(bytes: Uint8Array): Opened | undefined {
    if (bytes.length < 6 || bytes.length > MOST_BYTES || bytes[0] !== 1) return undefined;
    const width = bytes[1]! | (bytes[2]! << 8);
    const height = bytes[3]! | (bytes[4]! << 8);
    const striped = bytes[5]!;
    if (width < 1 || height < 1 || width * height > MOST_CELLS || striped >= STRIPED) return undefined;
    const tokens = new Uint8Array(width * height);
    let [at, filled] = [6, 0];
    while (at < bytes.length) {
        const token = bytes[at++]!;
        if (token >= STRIPED * 2 || (token >= STRIPED && !striped)) return undefined;
        let run = 0;
        for (let shift = 0; ; shift += 7) {
            // a run is at most three bytes long: no world has more cells than that counts
            if (at >= bytes.length || shift > 14) return undefined;
            const byte = bytes[at++]!;
            run |= (byte & 127) << shift;
            if (byte < 128) break;
        }
        if (run === 0 || filled + run > tokens.length) return undefined;
        tokens.fill(token, filled, filled + run);
        filled += run;
    }
    return filled === tokens.length ? { width, height, striped, tokens } : undefined;
}

/** Bytes in base64 with - and _, and no = at the end: letters an address carries as they are. */
export function toText(bytes: Uint8Array): string {
    let binary = "";
    for (let at = 0; at < bytes.length; at += 0x8000) binary += String.fromCharCode(...bytes.subarray(at, at + 0x8000));
    return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** Text in base64 with - and _ read back to bytes, or undefined if it is not that. */
export function fromText(text: string): Uint8Array | undefined {
    if (!/^[\w-]*$/.test(text) || text.length % 4 === 1) return undefined;
    try {
        const binary = atob(text.replace(/-/g, "+").replace(/_/g, "/"));
        return Uint8Array.from(binary, (char) => char.charCodeAt(0));
    } catch {
        return undefined;
    }
}

/** Whether this browser can squeeze and unsqueeze bytes itself. Every current browser can. */
export const canSqueeze = (): boolean => typeof CompressionStream === "function" && typeof DecompressionStream === "function";

/** Bytes put through a stream, stopping and giving undefined once more than `most` come out, or if the stream fails. */
async function through(bytes: Uint8Array, stream: CompressionStream | DecompressionStream, most: number): Promise<Uint8Array | undefined> {
    const writer = stream.writable.getWriter();
    writer.write(bytes as Uint8Array<ArrayBuffer>).catch(() => {});
    writer.close().catch(() => {});
    const reader = stream.readable.getReader();
    const parts: Uint8Array[] = [];
    let total = 0;
    try {
        for (;;) {
            const { done, value } = await reader.read();
            if (done) break;
            total += value.length;
            if (total > most) {
                await reader.cancel().catch(() => {});
                return undefined;
            }
            parts.push(value);
        }
    } catch {
        return undefined;
    }
    const out = new Uint8Array(total);
    let at = 0;
    for (const part of parts) {
        out.set(part, at);
        at += part.length;
    }
    return out;
}

/** A world as text: "z" and its bytes squeezed, where the browser can squeeze them (or `squeeze` is false: "p" and the bytes as they are). */
export async function pack(tokens: Uint8Array, width: number, height: number, striped: number, squeeze = canSqueeze()): Promise<string> {
    const bytes = encode(tokens, width, height, striped);
    const squeezed = squeeze ? await through(bytes, new CompressionStream("deflate-raw"), MOST_BYTES) : undefined;
    return squeezed ? `z${toText(squeezed)}` : `p${toText(bytes)}`;
}

/** A world read back from its text, or undefined for anything that is not one, quietly. */
export async function unpack(text: string): Promise<Opened | undefined> {
    if (text.length < 2 || text.length > MOST_TEXT) return undefined;
    const bytes = fromText(text.slice(1));
    if (!bytes) return undefined;
    if (text[0] === "p") return decode(bytes);
    if (text[0] !== "z" || !canSqueeze()) return undefined;
    const opened = await through(bytes, new DecompressionStream("deflate-raw"), MOST_BYTES);
    return opened && decode(opened);
}
