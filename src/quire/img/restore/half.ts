// Half-precision numbers by hand, for the restoring models that take and give their pictures in 16 bits a
// number (`float16`): a number made into its 16 bits, rounded to the nearest, and 16 bits read back.
// ONNX Runtime takes and gives such a tensor as a `Uint16Array` of those bits.

const word = new Float32Array(1);
const bits = new Uint32Array(word.buffer);

/** The 16 bits of the half-precision number nearest a number: rounded to the nearest, ties to even; past the largest, infinity. */
export function toHalf(value: number): number {
    word[0] = value;
    const x = bits[0]!;
    const sign = (x >>> 16) & 0x8000;
    const exponent = (x >>> 23) & 0xff;
    let mantissa = x & 0x7fffff;
    if (exponent === 0xff) return sign | 0x7c00 | (mantissa ? 0x200 : 0);
    const half = exponent - 127 + 15;
    if (half >= 31) return sign | 0x7c00;
    if (half <= 0) {
        // too small for a normal half: a subnormal one, or nothing
        if (half < -10) return sign;
        mantissa |= 0x800000;
        const shift = 14 - half;
        const kept = mantissa >> shift;
        const rest = mantissa & ((1 << shift) - 1);
        const middle = 1 << (shift - 1);
        return sign | (kept + (rest > middle || (rest === middle && kept & 1) ? 1 : 0));
    }
    const kept = (half << 10) | (mantissa >> 13);
    const rest = mantissa & 0x1fff;
    // a carry out of the mantissa goes into the exponent, which is the right next number
    return sign | (kept + (rest > 0x1000 || (rest === 0x1000 && kept & 1) ? 1 : 0));
}

/** The number 16 half-precision bits stand for. */
export function fromHalf(h: number): number {
    const sign = h & 0x8000 ? -1 : 1;
    const exponent = (h >> 10) & 0x1f;
    const mantissa = h & 0x3ff;
    if (exponent === 0) return sign * mantissa * 2 ** -24;
    if (exponent === 31) return mantissa ? NaN : sign * Infinity;
    return sign * (1 + mantissa / 1024) * 2 ** (exponent - 15);
}
