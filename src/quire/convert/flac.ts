// A FLAC encoder, written by hand from RFC 9639, exact: what a decoder reads back is the same integers
// bit for bit. Samples arrive in blocks of any length as floats from -1 to 1, turned into 16 or 24 bit
// integers by the same rounding as the WAV writer (`toInteger`), and frames of 4096 samples go out as
// they fill, so a long sound is never held whole. The STREAMINFO block, which needs the smallest and
// largest frame, the count of samples and the MD5 of them all, is made at the end, to go in front.
//
// Each frame tries the four ways of carrying two channels (each alone, left and side, right and side,
// mid and side) and keeps the smallest. Each channel is written as a constant, verbatim, a fixed
// predictor of order 0 to 4, or a linear predictor (a Welch window, the correlation of the sound with itself, Levinson and Durbin,
// coefficients rounded to 14 bits with the error carried on) of order 2, 4, 6, 8 or 12, whichever is
// estimated smallest; the leftover is Rice coded in partitions whose number is searched, with an escape
// to plain bits where that is smaller. Wasted bits are not looked for.
//
//   encoder = createFlacEncoder({ sampleRate: 48000, channels: 2, bits: 16 });
//   frames = [...encoder.push([left, right]), ...]; { head, frames: last } = encoder.end();
//   file = new Blob([head, ...frames, ...last], { type: "audio/flac" });

import { createMd5 } from "./md5";
import { toInteger } from "./wav";

/** How many samples of each channel go in one frame. */
export const FLAC_BLOCK = 4096;

/** A FLAC encoder being fed: blocks of samples in, finished frames out, and the head at the end. */
export interface FlacEncoder {
    /** Takes a block of samples, a Float32Array to each channel, and gives the frames it filled. */
    push(planar: Float32Array[]): Uint8Array[];
    /** Writes the last frame, short, and gives it with the head: `fLaC` and the STREAMINFO block, to go before every frame. */
    end(): { head: Uint8Array; frames: Uint8Array[] };
}

/** Bits written one after another into bytes, most significant first, as FLAC wants. */
class Bits {
    bytes = new Uint8Array(1 << 16);
    length = 0;
    private held = 0;
    private count = 0;

    private room(more: number) {
        if (this.length + more <= this.bytes.length) return;
        const grown = new Uint8Array(Math.max(this.bytes.length * 2, this.length + more + 1024));
        grown.set(this.bytes.subarray(0, this.length));
        this.bytes = grown;
    }

    /** Writes the low `bits` bits of a whole number at least 0, up to 53 bits. */
    put(value: number, bits: number) {
        while (bits > 16) {
            bits -= 16;
            this.small(Math.floor(value / 2 ** bits) & 0xffff, 16);
        }
        if (bits > 0) this.small(value % 2 ** bits, bits);
    }

    private small(value: number, bits: number) {
        this.held = (this.held << bits) | value;
        this.count += bits;
        if (this.count >= 8) {
            this.room(4);
            while (this.count >= 8) {
                this.count -= 8;
                this.bytes[this.length++] = (this.held >>> this.count) & 255;
            }
            this.held &= (1 << this.count) - 1;
        }
    }

    /** Writes a signed number in two's complement of so many bits. */
    signed(value: number, bits: number) {
        this.put(value < 0 ? value + 2 ** bits : value, bits);
    }

    /** Writes so many zeros and then a one. */
    unary(zeros: number) {
        while (zeros >= 16) {
            this.small(0, 16);
            zeros -= 16;
        }
        this.small(1, zeros + 1);
    }

    /** Fills the last byte with zeros. */
    align() {
        if (this.count) this.small(0, 8 - this.count);
    }
}

/** CRC-8 of a FLAC frame header, polynomial x^8 + x^2 + x + 1. */
const CRC8 = Uint8Array.from({ length: 256 }, (_, byte) => {
    let value = byte;
    for (let bit = 0; bit < 8; bit++) value = value & 0x80 ? ((value << 1) ^ 0x07) & 255 : (value << 1) & 255;
    return value;
});

/** CRC-16 of a whole FLAC frame, polynomial x^16 + x^15 + x^2 + 1. */
const CRC16 = Uint16Array.from({ length: 256 }, (_, byte) => {
    let value = byte << 8;
    for (let bit = 0; bit < 8; bit++) value = value & 0x8000 ? ((value << 1) ^ 0x8005) & 0xffff : (value << 1) & 0xffff;
    return value;
});

/** The CRC-8 of some bytes, as a frame header carries it. */
export function crc8(bytes: Uint8Array): number {
    let value = 0;
    for (const byte of bytes) value = CRC8[value ^ byte]!;
    return value;
}

/** The CRC-16 of some bytes, as a frame's last two bytes carry it. */
export function crc16(bytes: Uint8Array): number {
    let value = 0;
    for (const byte of bytes) value = ((value << 8) & 0xffff) ^ CRC16[(value >> 8) ^ byte]!;
    return value;
}

/** The codes for the sample rates a frame header can say itself; any other is read from STREAMINFO. */
const RATES: Record<number, number> = { 88200: 1, 176400: 2, 192000: 3, 8000: 4, 16000: 5, 22050: 6, 24000: 7, 32000: 8, 44100: 9, 48000: 10, 96000: 11 };

/** A way of writing one channel of a frame: how many bits it is estimated to take, and how to write it. */
interface Plan {
    cost: number;
    write(out: Bits): void;
}

/** The largest partition order tried for the leftover. */
const MOST_PARTITIONS = 8;

/** The leftover of a predictor zigzagged into whole numbers at least 0 (0, -1, 1, -2 as 0, 1, 2, 3), the escape bits each partition would need, and the plan for coding it with Rice codes in the best partitions. */
function residualPlan(residual: Float64Array, order: number, n: number): Plan {
    // sums and largest values at the finest partitions, merged upward for each coarser order
    let most = 0;
    while (most < MOST_PARTITIONS && n % (1 << (most + 1)) === 0 && n >> (most + 1) > order) most++;
    const finest = 1 << most;
    const size = n >> most;
    let sums = new Float64Array(finest);
    let tops = new Float64Array(finest);
    for (let part = 0; part < finest; part++) {
        let sum = 0;
        let top = 0;
        const from = part === 0 ? order : part * size;
        for (let at = from; at < (part + 1) * size; at++) {
            const u = residual[at]!;
            sum += u;
            if (u > top) top = u;
        }
        sums[part] = sum;
        tops[part] = top;
    }
    let best: { cost: number; partitions: number; params: number[] } | undefined;
    for (let level = most; level >= 0; level--) {
        const count = 1 << level;
        const params: number[] = [];
        let cost = 2 + 4;
        for (let part = 0; part < count; part++) {
            const samples = (n >> level) - (part === 0 ? order : 0);
            const sum = sums[part]!;
            // the Rice parameter near the mean, and its two neighbors, by the usual estimate of its size
            const mean = samples ? sum / samples : 0;
            const guess = mean > 1 ? Math.min(30, Math.floor(Math.log2(mean))) : 0;
            let k = guess;
            let bits = Infinity;
            for (let tried = Math.max(0, guess - 1); tried <= Math.min(30, guess + 1); tried++) {
                const estimate = samples * (tried + 1) + Math.floor(sum / 2 ** tried);
                if (estimate < bits) {
                    bits = estimate;
                    k = tried;
                }
            }
            // an escape: so many plain bits for each sample, when the codes would be longer
            const raw = Math.max(1, Math.ceil(Math.log2(tops[part]! + 1)));
            if (5 + samples * raw < bits) {
                bits = 5 + samples * raw;
                k = -raw;
            }
            params.push(k);
            cost += 5 + bits;
        }
        if (!best || cost < best.cost) best = { cost, partitions: level, params };
        if (level > 0) {
            const half = count >> 1;
            const nextSums = new Float64Array(half);
            const nextTops = new Float64Array(half);
            for (let part = 0; part < half; part++) {
                nextSums[part] = sums[2 * part]! + sums[2 * part + 1]!;
                nextTops[part] = Math.max(tops[2 * part]!, tops[2 * part + 1]!);
            }
            sums = nextSums;
            tops = nextTops;
        }
    }
    const chosen = best!;
    return {
        cost: chosen.cost,
        write(out: Bits) {
            const wide = chosen.params.some((k) => k > 14);
            out.put(wide ? 1 : 0, 2);
            out.put(chosen.partitions, 4);
            const count = 1 << chosen.partitions;
            const span = n >> chosen.partitions;
            for (let part = 0; part < count; part++) {
                const k = chosen.params[part]!;
                const from = part === 0 ? order : part * span;
                const to = (part + 1) * span;
                if (k < 0) {
                    out.put(wide ? 31 : 15, wide ? 5 : 4);
                    out.put(-k, 5);
                    // the zigzag undone, written as signed numbers of so many bits
                    for (let at = from; at < to; at++) {
                        const u = residual[at]!;
                        out.signed(u % 2 === 0 ? u / 2 : -(u + 1) / 2, -k);
                    }
                } else {
                    out.put(k, wide ? 5 : 4);
                    const scale = 2 ** k;
                    for (let at = from; at < to; at++) {
                        const u = residual[at]!;
                        const high = Math.floor(u / scale);
                        out.unary(high);
                        if (k) out.put(u - high * scale, k);
                    }
                }
            }
        },
    };
}

const zigzag = (value: number) => (value >= 0 ? value * 2 : -value * 2 - 1);

/** The predictions of FLAC's fixed predictors of order 0 to 4, as the differences of so many steps. */
function fixedResidual(samples: Int32Array, n: number, order: number): Float64Array {
    const out = new Float64Array(n);
    for (let at = order; at < n; at++) {
        const x0 = samples[at]!;
        let left: number;
        if (order === 0) left = x0;
        else if (order === 1) left = x0 - samples[at - 1]!;
        else if (order === 2) left = x0 - 2 * samples[at - 1]! + samples[at - 2]!;
        else if (order === 3) left = x0 - 3 * samples[at - 1]! + 3 * samples[at - 2]! - samples[at - 3]!;
        else left = x0 - 4 * samples[at - 1]! + 6 * samples[at - 2]! - 4 * samples[at - 3]! + samples[at - 4]!;
        out[at] = zigzag(left);
    }
    return out;
}

/** The coefficients of linear predictors of every order up to `most`, by autocorrelation of the windowed samples and Levinson and Durbin's recursion. */
function predictors(samples: Int32Array, n: number, most: number): Float64Array[] {
    const windowed = new Float64Array(n);
    // a Welch window: a parabola, zero at the ends
    for (let at = 0; at < n; at++) {
        const x = (2 * at - (n - 1)) / (n + 1);
        windowed[at] = samples[at]! * (1 - x * x);
    }
    const lags = new Float64Array(most + 1);
    for (let lag = 0; lag <= most; lag++) {
        let sum = 0;
        for (let at = lag; at < n; at++) sum += windowed[at]! * windowed[at - lag]!;
        lags[lag] = sum;
    }
    const found: Float64Array[] = [];
    if (lags[0]! === 0) return found;
    // a touch of lag-0 lift keeps the recursion steady on pure tones
    lags[0] = lags[0]! * (1 + 1e-9);
    let error = lags[0]!;
    let coefficients = new Float64Array(0);
    for (let order = 1; order <= most; order++) {
        let sum = lags[order]!;
        for (let index = 0; index < order - 1; index++) sum -= coefficients[index]! * lags[order - 1 - index]!;
        const reflection = sum / error;
        const next = new Float64Array(order);
        for (let index = 0; index < order - 1; index++) next[index] = coefficients[index]! - reflection * coefficients[order - 2 - index]!;
        next[order - 1] = reflection;
        coefficients = next;
        error *= 1 - reflection * reflection;
        found.push(next);
        if (!(error > 0)) break;
    }
    return found;
}

/** The precision of quantized coefficients, in bits with their sign. */
const PRECISION = 14;

/** Coefficients made whole numbers of PRECISION bits with a shift, the rounding error carried from each to the next; undefined when they cannot be. */
function quantize(coefficients: Float64Array): { whole: Int32Array; shift: number } | undefined {
    const top = Math.max(...coefficients.map(Math.abs));
    if (!(top > 0) || !Number.isFinite(top)) return undefined;
    const most = 2 ** (PRECISION - 1) - 1;
    let shift = 15;
    while (shift > 0 && Math.round(top * 2 ** shift) > most) shift--;
    if (Math.round(top * 2 ** shift) > most) return undefined;
    const whole = new Int32Array(coefficients.length);
    let carried = 0;
    for (let index = 0; index < coefficients.length; index++) {
        carried += coefficients[index]! * 2 ** shift;
        const value = Math.max(-most - 1, Math.min(most, Math.round(carried)));
        whole[index] = value;
        carried -= value;
    }
    return { whole, shift };
}

/** The leftover of a quantized linear predictor, or undefined if some of it would not fit 31 bits, as decoders require. */
function lpcResidual(samples: Int32Array, n: number, whole: Int32Array, shift: number): Float64Array | undefined {
    const order = whole.length;
    const out = new Float64Array(n);
    const scale = 2 ** shift;
    for (let at = order; at < n; at++) {
        let sum = 0;
        for (let index = 0; index < order; index++) sum += whole[index]! * samples[at - 1 - index]!;
        const left = samples[at]! - Math.floor(sum / scale);
        if (left >= 2 ** 30 || left < -(2 ** 30)) return undefined;
        out[at] = zigzag(left);
    }
    return out;
}

/** The smallest way found to write one channel of a frame, its samples having `bits` bits. */
function subframe(samples: Int32Array, n: number, bits: number): Plan {
    const first = samples[0]!;
    let constant = true;
    for (let at = 1; at < n; at++) if (samples[at] !== first) {
        constant = false;
        break;
    }
    if (constant)
        return {
            cost: 8 + bits,
            write(out) {
                out.put(0, 8);
                out.signed(first, bits);
            },
        };
    let best: Plan = {
        cost: 8 + n * bits,
        write(out) {
            out.put(1 << 1, 8);
            for (let at = 0; at < n; at++) out.signed(samples[at]!, bits);
        },
    };
    for (let order = 0; order <= 4 && order < n; order++) {
        const plan = residualPlan(fixedResidual(samples, n, order), order, n);
        const cost = 8 + order * bits + plan.cost;
        if (cost < best.cost)
            best = {
                cost,
                write(out) {
                    out.put((8 | order) << 1, 8);
                    for (let at = 0; at < order; at++) out.signed(samples[at]!, bits);
                    plan.write(out);
                },
            };
    }
    const orders = [2, 4, 6, 8, 12].filter((order) => order < n);
    const found = n > 32 ? predictors(samples, n, orders[orders.length - 1] ?? 0) : [];
    for (const order of orders) {
        const coefficients = found[order - 1];
        if (!coefficients) continue;
        const made = quantize(coefficients);
        if (!made) continue;
        const residual = lpcResidual(samples, n, made.whole, made.shift);
        if (!residual) continue;
        const plan = residualPlan(residual, order, n);
        const cost = 8 + order * bits + 4 + 5 + order * PRECISION + plan.cost;
        if (cost < best.cost)
            best = {
                cost,
                write(out) {
                    out.put((32 | (order - 1)) << 1, 8);
                    for (let at = 0; at < order; at++) out.signed(samples[at]!, bits);
                    out.put(PRECISION - 1, 4);
                    out.signed(made.shift, 5);
                    for (const value of made.whole) out.signed(value, PRECISION);
                    plan.write(out);
                },
            };
    }
    return best;
}

/** A frame number in FLAC's form of UTF-8, which runs to 36 bits. */
function frameNumber(value: number): number[] {
    if (value < 0x80) return [value];
    const bytes: number[] = [];
    let left = value;
    let room = 6;
    let count = 1;
    // continuation bytes of six bits each, until what is left fits the lead byte
    while (left >= 2 ** room) {
        bytes.unshift(0x80 | (left & 0x3f));
        left = Math.floor(left / 64);
        count++;
        room = 7 - count;
    }
    const lead = (0xff << (8 - count)) & 0xff;
    return [lead | left, ...bytes];
}

/** A FLAC encoder for a sound of so many channels (one to eight), at a rate, in 16 or 24 bit samples. */
export function createFlacEncoder(options: { sampleRate: number; channels: number; bits: 16 | 24 }): FlacEncoder {
    const { sampleRate, channels, bits } = options;
    if (channels < 1 || channels > 8) throw new Error("FLAC holds one to eight channels.");
    if (!(sampleRate >= 1 && sampleRate <= 655350)) throw new Error("FLAC cannot hold this sample rate.");
    const held = Array.from({ length: channels }, () => new Int32Array(FLAC_BLOCK));
    const side = new Int32Array(FLAC_BLOCK);
    const mid = new Int32Array(FLAC_BLOCK);
    const md5 = createMd5();
    const width = bits / 8;
    let filled = 0;
    let frames = 0;
    let total = 0;
    let smallest = Infinity;
    let largest = 0;

    /** Writes the frame of the `n` samples held. */
    function frame(n: number): Uint8Array {
        // the MD5 is of the samples interleaved, little end first
        const raw = new Uint8Array(n * channels * width);
        let at = 0;
        for (let index = 0; index < n; index++)
            for (let channel = 0; channel < channels; channel++) {
                const value = held[channel]![index]!;
                raw[at++] = value & 255;
                raw[at++] = (value >> 8) & 255;
                if (width === 3) raw[at++] = (value >> 16) & 255;
            }
        md5.update(raw);
        let assignment = channels - 1;
        let plans: Plan[];
        if (channels === 2) {
            const [left, right] = held as [Int32Array, Int32Array];
            for (let index = 0; index < n; index++) {
                side[index] = left[index]! - right[index]!;
                mid[index] = (left[index]! + right[index]!) >> 1;
            }
            const l = subframe(left, n, bits);
            const r = subframe(right, n, bits);
            const s = subframe(side, n, bits + 1);
            const m = subframe(mid, n, bits);
            const ways: [number, Plan[]][] = [
                [1, [l, r]],
                [8, [l, s]],
                [9, [s, r]],
                [10, [m, s]],
            ];
            const best = ways.reduce((a, b) => (b[1][0]!.cost + b[1][1]!.cost < a[1][0]!.cost + a[1][1]!.cost ? b : a));
            assignment = best[0];
            plans = best[1];
        } else plans = held.map((samples) => subframe(samples, n, bits));
        const out = new Bits();
        out.put(0xfff8, 16);
        const sizeCode = n === FLAC_BLOCK ? 12 : n <= 256 ? 6 : 7;
        out.put(sizeCode, 4);
        out.put(RATES[sampleRate] ?? 0, 4);
        out.put(assignment, 4);
        out.put(bits === 16 ? 4 : 6, 3);
        out.put(0, 1);
        for (const byte of frameNumber(frames)) out.put(byte, 8);
        if (sizeCode === 6) out.put(n - 1, 8);
        else if (sizeCode === 7) out.put(n - 1, 16);
        out.put(crc8(out.bytes.subarray(0, out.length)), 8);
        for (const plan of plans) plan.write(out);
        out.align();
        out.put(crc16(out.bytes.subarray(0, out.length)), 16);
        const made = out.bytes.slice(0, out.length);
        frames++;
        total += n;
        smallest = Math.min(smallest, made.length);
        largest = Math.max(largest, made.length);
        return made;
    }

    return {
        push(planar) {
            if (planar.length !== channels) throw new Error(`This encoder was made for ${channels} channels.`);
            const length = planar[0]!.length;
            const made: Uint8Array[] = [];
            for (let at = 0; at < length; ) {
                const take = Math.min(FLAC_BLOCK - filled, length - at);
                for (let channel = 0; channel < channels; channel++) {
                    const from = planar[channel]!;
                    const into = held[channel]!;
                    for (let index = 0; index < take; index++) into[filled + index] = toInteger(from[at + index]!, bits);
                }
                filled += take;
                at += take;
                if (filled === FLAC_BLOCK) {
                    made.push(frame(FLAC_BLOCK));
                    filled = 0;
                }
            }
            return made;
        },
        end() {
            const last = filled ? [frame(filled)] : [];
            filled = 0;
            const head = new Uint8Array(4 + 4 + 34);
            head.set([0x66, 0x4c, 0x61, 0x43], 0);
            // the one metadata block, marked last: STREAMINFO, 34 bytes
            head.set([0x80, 0, 0, 34], 4);
            const info = new Bits();
            info.put(FLAC_BLOCK, 16);
            info.put(FLAC_BLOCK, 16);
            info.put(frames ? smallest : 0, 24);
            info.put(largest, 24);
            info.put(sampleRate, 20);
            info.put(channels - 1, 3);
            info.put(bits - 1, 5);
            info.put(total, 36);
            head.set(info.bytes.subarray(0, info.length), 8);
            head.set(md5.digest(), 26);
            return { head, frames: last };
        },
    };
}
