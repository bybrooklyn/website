// A real-input FFT for power-of-two sizes, with its tables made once. Parakeet's sound features
// take 512 samples at a time, a hundred times a second, so it does no allocation per call: it packs
// the real samples as half as many complex ones, runs one complex FFT of that size, and unpacks.
// The method is the usual radix-2 one; fft.test.ts checks it against a slow DFT.

/** A transform of one size: real samples in, the spectrum from 0 Hz to the top bin out. */
export interface RealFft {
    /** The number of real samples a call takes, a power of two. */
    size: number;
    /** Writes the spectrum of `input` (length `size`) into `re` and `im` (length `size / 2 + 1`). Nothing is allocated. */
    transform(input: Float64Array, re: Float64Array, im: Float64Array): void;
}

/** Makes a real FFT for `size` samples, a power of two of at least 4. */
export function createRealFft(size: number): RealFft {
    if (size < 4 || (size & (size - 1)) !== 0) throw new Error(`FFT size must be a power of two of at least 4, got ${size}`);
    const half = size >> 1;
    const bits = Math.log2(half);
    // Sample pair i is placed at reversed[i] before the butterflies run.
    const reversed = new Uint32Array(half);
    for (let i = 0; i < half; i++) {
        let rest = i;
        let flipped = 0;
        for (let b = 0; b < bits; b++) {
            flipped = (flipped << 1) | (rest & 1);
            rest >>= 1;
        }
        reversed[i] = flipped;
    }
    // Angles of 2 pi / size. The complex FFT of size `half` takes every second one; unpacking uses all.
    const cos = new Float64Array(half);
    const sin = new Float64Array(half);
    for (let i = 0; i < half; i++) {
        cos[i] = Math.cos((-2 * Math.PI * i) / size);
        sin[i] = Math.sin((-2 * Math.PI * i) / size);
    }
    const zr = new Float64Array(half);
    const zi = new Float64Array(half);
    return {
        size,
        transform(input, re, im) {
            for (let i = 0; i < half; i++) {
                const to = reversed[i]!;
                zr[to] = input[2 * i]!;
                zi[to] = input[2 * i + 1]!;
            }
            // Butterflies over runs of length 2, 4, ... half. A run of `length` steps through the
            // table by size / length.
            for (let length = 2; length <= half; length <<= 1) {
                const across = length >> 1;
                const stride = size / length;
                for (let start = 0; start < half; start += length) {
                    for (let k = 0; k < across; k++) {
                        const c = cos[k * stride]!;
                        const s = sin[k * stride]!;
                        const p = start + k;
                        const q = p + across;
                        const tr = zr[q]! * c - zi[q]! * s;
                        const ti = zr[q]! * s + zi[q]! * c;
                        zr[q] = zr[p]! - tr;
                        zi[q] = zi[p]! - ti;
                        zr[p] = zr[p]! + tr;
                        zi[p] = zi[p]! + ti;
                    }
                }
            }
            // Unpack: the spectra of the even-indexed and the odd-indexed samples are recovered from
            // Z[k] and the conjugate of Z[half - k], then joined with the twiddle for this bin.
            for (let k = 0; k <= half; k++) {
                const a = k === half ? 0 : k;
                const b = k === 0 ? 0 : half - k;
                const rk = zr[a]!;
                const ik = zi[a]!;
                const rn = zr[b]!;
                const inn = zi[b]!;
                const evenR = 0.5 * (rk + rn);
                const evenI = 0.5 * (ik - inn);
                const oddR = 0.5 * (ik + inn);
                const oddI = -0.5 * (rk - rn);
                // At k = half the twiddle is -1; the table stops one short of it.
                const c = k === half ? -1 : cos[k]!;
                const s = k === half ? 0 : sin[k]!;
                re[k] = evenR + oddR * c - oddI * s;
                im[k] = evenI + oddR * s + oddI * c;
            }
        },
    };
}
