// Repairing what JPEG took, by hand and with nothing fetched: the blocks and the ringing round edges that a
// JPEG's compression leaves. A JPEG keeps each 8 by 8 block of each channel as 64 waves (its DCT), each
// rounded to a step its quantization table sets; the rounding is what made the blocks and the ringing. The
// file says what the steps were (`jpegFacts`, read from its DQT and frame segments), so the repair knows
// how strong to be and never invents beyond them.
//
// The repair is "re-application of JPEG" (Nosratinia, 2001): the picture is cut into blocks again on the
// grid moved by some places, each block's waves rounded by the file's own steps and put back, and the
// pictures from every moved grid averaged. A real edge survives every grid; a block's edge and the ringing
// round a real edge differ from grid to grid and average away. Then the result is held to what the file
// says (`consistent`): on the file's own grid, each wave is kept within half a step of what was decoded,
// so the repair can only choose among pictures that would have made the same file. Luminance is repaired
// at full size. Colour, which most JPEGs keep at half size, can be repaired at the size it was kept and the
// change brought back up, but it is left alone unless asked, since measured it sometimes made things worse.
//
//   const facts = jpegFacts(bytes);                    the tables, the sampling, an estimate of the quality
//   const repaired = repair(pixels, width, height, facts!, { shifts: 16 });

import { jpegParts } from "../core/picture-bytes";

/** The 64 places of a block in the order a JPEG writes them (zigzag), as places in rows of eight. */
const ZIGZAG = [0, 1, 8, 16, 9, 2, 3, 10, 17, 24, 32, 25, 18, 11, 4, 5, 12, 19, 26, 33, 40, 48, 41, 34, 27, 20, 13, 6, 7, 14, 21, 28, 35, 42, 49, 56, 57, 50, 43, 36, 29, 22, 15, 23, 30, 37, 44, 51, 58, 59, 52, 45, 38, 31, 39, 46, 53, 60, 61, 54, 47, 55, 62, 63];

/** The standard's luminance table (Annex K), from which libjpeg scales a quality's table. */
const STANDARD_LUMA = [16, 11, 10, 16, 24, 40, 51, 61, 12, 12, 14, 19, 26, 58, 60, 55, 14, 13, 16, 24, 40, 57, 69, 56, 14, 17, 22, 29, 51, 87, 80, 62, 18, 22, 37, 56, 68, 109, 103, 77, 24, 35, 55, 64, 81, 104, 113, 92, 49, 64, 78, 87, 103, 121, 120, 101, 72, 92, 95, 98, 112, 100, 103, 99];

/** What a JPEG's own bytes say about how it was compressed: its size, its quantization tables (in rows of eight), which table each of its channels used and how much each was made smaller, and the quality its luminance table is nearest. */
export interface JpegFacts {
    width: number;
    height: number;
    tables: (Uint16Array | undefined)[];
    channels: { id: number; across: number; down: number; table: number }[];
    quality: number;
}

/** The quality from 1 to 100 that libjpeg's scaling of the standard table comes nearest to a luminance table: the one whose table differs least, summed over the 64 steps. */
export function qualityOf(table: Uint16Array): number {
    let best = 50;
    let least = Infinity;
    for (let quality = 1; quality <= 100; quality++) {
        const scale = quality < 50 ? 5000 / quality : 200 - quality * 2;
        let apart = 0;
        for (let at = 0; at < 64; at++) apart += Math.abs(Math.min(255, Math.max(1, Math.floor((STANDARD_LUMA[at]! * scale + 50) / 100))) - table[at]!);
        if (apart < least) [least, best] = [apart, quality];
    }
    return best;
}

/** A JPEG's tables and frame, read from its bytes; undefined for a file that is not a JPEG, is cut short, or keeps no tables (a lossless or arithmetic one is read the same, its tables only). */
export function jpegFacts(bytes: Uint8Array): JpegFacts | undefined {
    let parts;
    try {
        parts = jpegParts(bytes);
    } catch {
        return undefined;
    }
    const tables: (Uint16Array | undefined)[] = [];
    let frame: Omit<JpegFacts, "tables" | "quality"> | undefined;
    for (const part of parts) {
        const body = part.body;
        if (part.name === "ffdb") {
            let at = 0;
            while (at < body.length) {
                const wide = body[at]! >> 4;
                const id = body[at]! & 15;
                at++;
                if (id > 3 || at + 64 * (wide ? 2 : 1) > body.length) return undefined;
                const table = new Uint16Array(64);
                for (let k = 0; k < 64; k++) table[ZIGZAG[k]!] = wide ? (body[at + 2 * k]! << 8) | body[at + 2 * k + 1]! : body[at + k]!;
                if (table.some((step) => step === 0)) return undefined;
                tables[id] = table;
                at += 64 * (wide ? 2 : 1);
            }
        } else if (/^ffc[0-3567]$/.test(part.name) || /^ffc[9abdef]$/.test(part.name)) {
            if (body.length < 6) return undefined;
            const height = (body[1]! << 8) | body[2]!;
            const width = (body[3]! << 8) | body[4]!;
            const count = body[5]!;
            if (body.length < 6 + count * 3 || !count) return undefined;
            const channels = [];
            for (let c = 0; c < count; c++) channels.push({ id: body[6 + c * 3]!, across: body[7 + c * 3]! >> 4, down: body[7 + c * 3]! & 15, table: body[8 + c * 3]! & 3 });
            const most = { across: Math.max(...channels.map((each) => each.across)), down: Math.max(...channels.map((each) => each.down)) };
            // each channel's sampling said as how many times smaller than the largest it is kept
            frame = { width, height, channels: channels.map((each) => ({ ...each, across: most.across / Math.max(1, each.across), down: most.down / Math.max(1, each.down) })) };
        }
    }
    if (!frame || !frame.channels.every((each) => tables[each.table])) return undefined;
    return { ...frame, tables, quality: qualityOf(tables[frame.channels[0]!.table]!) };
}

// the DCT's eight by eight cosines, scaled so that the waves are orthonormal
const BASIS = new Float32Array(64);
for (let u = 0; u < 8; u++) for (let x = 0; x < 8; x++) BASIS[u * 8 + x] = (u === 0 ? Math.SQRT1_2 : 1) * 0.5 * Math.cos(((2 * x + 1) * u * Math.PI) / 16);

/** One block's waves from its pixels, in place: rows then columns. */
function forward(block: Float32Array, scratch: Float32Array) {
    for (let y = 0; y < 8; y++)
        for (let u = 0; u < 8; u++) {
            let sum = 0;
            for (let x = 0; x < 8; x++) sum += BASIS[u * 8 + x]! * block[y * 8 + x]!;
            scratch[y * 8 + u] = sum;
        }
    for (let u = 0; u < 8; u++)
        for (let v = 0; v < 8; v++) {
            let sum = 0;
            for (let y = 0; y < 8; y++) sum += BASIS[v * 8 + y]! * scratch[y * 8 + u]!;
            block[v * 8 + u] = sum;
        }
}

/** One block's pixels from its waves, in place. */
function inverse(block: Float32Array, scratch: Float32Array) {
    for (let v = 0; v < 8; v++)
        for (let x = 0; x < 8; x++) {
            let sum = 0;
            for (let u = 0; u < 8; u++) sum += BASIS[u * 8 + x]! * block[v * 8 + u]!;
            scratch[v * 8 + x] = sum;
        }
    for (let x = 0; x < 8; x++)
        for (let y = 0; y < 8; y++) {
            let sum = 0;
            for (let v = 0; v < 8; v++) sum += BASIS[v * 8 + y]! * scratch[v * 8 + x]!;
            block[y * 8 + x] = sum;
        }
}

/** The grids moved by every pair of `step`, `2 step` and so on below eight: 64 grids at one, 16 at two, 4 at four. */
export function shiftsOf(count: 1 | 4 | 16 | 64): [number, number][] {
    const step = count === 64 ? 1 : count === 16 ? 2 : count === 4 ? 4 : 8;
    const out: [number, number][] = [];
    for (let y = 0; y < 8; y += step) for (let x = 0; x < 8; x += step) out.push([x, y]);
    return out;
}

/** A channel's pixels read with its edges carried on, so that a block hanging past the picture reads the pixels at its edge. */
const at = (plane: Float32Array, width: number, height: number, x: number, y: number) => plane[Math.min(height - 1, Math.max(0, y)) * width + Math.min(width - 1, Math.max(0, x))]!;

/**
 * One channel repaired: the average, over the grids moved by `shifts`, of the channel with each block's
 * waves rounded to the table's steps and put back. Each moved grid's blocks cover the whole channel, those
 * at its edges reading the edge carried on. Values are from 0 to 255.
 */
export function reapply(plane: Float32Array, width: number, height: number, table: Uint16Array, shifts: [number, number][]): Float32Array {
    const sum = new Float32Array(width * height);
    const block = new Float32Array(64);
    const scratch = new Float32Array(64);
    for (const [sx, sy] of shifts) {
        for (let by = -sy; by < height; by += 8)
            for (let bx = -sx; bx < width; bx += 8) {
                for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) block[y * 8 + x] = at(plane, width, height, bx + x, by + y) - 128;
                forward(block, scratch);
                for (let k = 0; k < 64; k++) block[k] = Math.round(block[k]! / table[k]!) * table[k]!;
                inverse(block, scratch);
                for (let y = 0; y < 8; y++) {
                    const py = by + y;
                    if (py < 0 || py >= height) continue;
                    for (let x = 0; x < 8; x++) {
                        const px = bx + x;
                        if (px >= 0 && px < width) sum[py * width + px]! += block[y * 8 + x]! + 128;
                    }
                }
            }
    }
    for (let k = 0; k < sum.length; k++) sum[k] = sum[k]! / shifts.length;
    return sum;
}

/**
 * A repaired channel held to what the file says: on the file's own grid, each wave of each block of the
 * repair kept within half a step (a share `slack` of it) of the wave decoded, which is the only range the
 * file allows; the rest of the repair is kept.
 */
export function consistent(repaired: Float32Array, decoded: Float32Array, width: number, height: number, table: Uint16Array, slack = 0.5): Float32Array {
    const out = repaired.slice();
    const block = new Float32Array(64);
    const was = new Float32Array(64);
    const scratch = new Float32Array(64);
    for (let by = 0; by < height; by += 8)
        for (let bx = 0; bx < width; bx += 8) {
            for (let y = 0; y < 8; y++)
                for (let x = 0; x < 8; x++) {
                    block[y * 8 + x] = at(repaired, width, height, bx + x, by + y) - 128;
                    was[y * 8 + x] = at(decoded, width, height, bx + x, by + y) - 128;
                }
            forward(block, scratch);
            forward(was, scratch);
            for (let k = 0; k < 64; k++) {
                const step = table[k]!;
                const middle = Math.round(was[k]! / step) * step;
                block[k] = Math.min(middle + slack * step, Math.max(middle - slack * step, block[k]!));
            }
            inverse(block, scratch);
            for (let y = 0; y < 8 && by + y < height; y++) for (let x = 0; x < 8 && bx + x < width; x++) out[(by + y) * width + bx + x] = block[y * 8 + x]! + 128;
        }
    return out;
}

/** How a repair is done: how many moved grids (more is better and slower; 16 to start), whether it is held to what the file says (it is to start), and whether the colour is repaired too (it is not to start: measured, it helped photographs at low qualities but cost up to 0.1 dB on screenshots and drawings with strong colour edges, where luminance alone never did). */
export interface RepairHow {
    shifts?: 1 | 4 | 16 | 64;
    hold?: boolean;
    colour?: boolean;
}

/** A channel made smaller by a whole number each way, by averaging, as a JPEG keeps its colour. */
function shrink(plane: Float32Array, width: number, height: number, across: number, down: number): { plane: Float32Array; width: number; height: number } {
    const w = Math.ceil(width / across);
    const h = Math.ceil(height / down);
    const out = new Float32Array(w * h);
    for (let y = 0; y < h; y++)
        for (let x = 0; x < w; x++) {
            let sum = 0;
            let count = 0;
            for (let j = 0; j < down; j++) for (let i = 0; i < across; i++) if (y * down + j < height && x * across + i < width) ((sum += plane[(y * down + j) * width + x * across + i]!), count++);
            out[y * w + x] = sum / count;
        }
    return { plane: out, width: w, height: h };
}

/** A small channel's change brought back up to full size, between its places by straight lines, each small pixel's middle over the middle of the pixels it stood for. */
function grow(change: Float32Array, w: number, h: number, width: number, height: number, across: number, down: number): Float32Array {
    const out = new Float32Array(width * height);
    for (let y = 0; y < height; y++) {
        const v = Math.min(h - 1, Math.max(0, (y + 0.5) / down - 0.5));
        const y0 = Math.floor(v);
        const y1 = Math.min(h - 1, y0 + 1);
        const fy = v - y0;
        for (let x = 0; x < width; x++) {
            const u = Math.min(w - 1, Math.max(0, (x + 0.5) / across - 0.5));
            const x0 = Math.floor(u);
            const x1 = Math.min(w - 1, x0 + 1);
            const fx = u - x0;
            const top = change[y0 * w + x0]! + (change[y0 * w + x1]! - change[y0 * w + x0]!) * fx;
            const bottom = change[y1 * w + x0]! + (change[y1 * w + x1]! - change[y1 * w + x0]!) * fx;
            out[y * width + x] = top + (bottom - top) * fy;
        }
    }
    return out;
}

/** One channel repaired at the size the file kept it, and held to the file if asked; the change, brought back to full size, added to it. */
function repairChannel(plane: Float32Array, width: number, height: number, table: Uint16Array, across: number, down: number, how: RepairHow): Float32Array {
    const shifts = shiftsOf(how.shifts ?? 16);
    if (across === 1 && down === 1) {
        const made = reapply(plane, width, height, table, shifts);
        return how.hold === false ? made : consistent(made, plane, width, height, table);
    }
    const small = shrink(plane, width, height, across, down);
    let made = reapply(small.plane, small.width, small.height, table, shifts);
    if (how.hold !== false) made = consistent(made, small.plane, small.width, small.height, table);
    for (let k = 0; k < made.length; k++) made[k] = made[k]! - small.plane[k]!;
    const change = grow(made, small.width, small.height, width, height, across, down);
    for (let k = 0; k < change.length; k++) change[k] = plane[k]! + change[k]!;
    return change;
}

/**
 * A decoded JPEG's pixels (RGBA, row by row) repaired with what its file says: taken to luminance and two
 * colours as JPEG keeps them (JFIF's full-range YCbCr), each channel repaired with its own table at the
 * size it was kept, and back to RGBA, its alpha as it was. A grey JPEG (one channel) is repaired as one.
 */
export function repair(pixels: Uint8ClampedArray | Uint8Array, width: number, height: number, facts: JpegFacts, how: RepairHow = {}): Uint8ClampedArray {
    const count = width * height;
    const out = new Uint8ClampedArray(pixels.length);
    const y = new Float32Array(count);
    const cb = new Float32Array(count);
    const cr = new Float32Array(count);
    for (let k = 0; k < count; k++) {
        const r = pixels[k * 4]!;
        const g = pixels[k * 4 + 1]!;
        const b = pixels[k * 4 + 2]!;
        y[k] = 0.299 * r + 0.587 * g + 0.114 * b;
        cb[k] = 128 - 0.168736 * r - 0.331264 * g + 0.5 * b;
        cr[k] = 128 + 0.5 * r - 0.418688 * g - 0.081312 * b;
    }
    const [luma, blue, red] = facts.channels;
    const tableOf = (channel: JpegFacts["channels"][number]) => facts.tables[channel.table]!;
    const Y = repairChannel(y, width, height, tableOf(luma!), luma!.across, luma!.down, how);
    if (!blue || !red) {
        for (let k = 0; k < count; k++) out.set([Y[k]!, Y[k]!, Y[k]!, pixels[k * 4 + 3]!], k * 4);
        return out;
    }
    const B = how.colour ? repairChannel(cb, width, height, tableOf(blue), blue.across, blue.down, how) : cb;
    const R = how.colour ? repairChannel(cr, width, height, tableOf(red), red.across, red.down, how) : cr;
    for (let k = 0; k < count; k++) {
        const l = Y[k]!;
        const u = B[k]! - 128;
        const v = R[k]! - 128;
        out[k * 4] = l + 1.402 * v;
        out[k * 4 + 1] = l - 0.344136 * u - 0.714136 * v;
        out[k * 4 + 2] = l + 1.772 * u;
        out[k * 4 + 3] = pixels[k * 4 + 3]!;
    }
    return out;
}

/** The highest quality at which the repair was measured to do better than leaving the picture alone, on photographs, screenshots and drawings alike (deblock.test.ts); above it the repair is not offered. */
export const MOST_QUALITY = 90;

/** Whether a JPEG is worth repairing: its luminance table says it was compressed at or below the quality where the repair was measured to help. */
export const worthRepairing = (facts: JpegFacts | undefined): boolean => !!facts && facts.quality <= MOST_QUALITY && facts.channels.length > 0;
