// MD5, written by hand from RFC 1321, for the one place the converter needs it: a FLAC file's
// STREAMINFO carries the MD5 of its samples, so that a reader can tell they came back whole. It is fed
// piece by piece, so a long sound is never held at once.
//
//   const sum = createMd5(); sum.update(bytes); sum.update(more); const digest = sum.digest();

/** How far each step turns its word, four to a round. */
const TURNS = [7, 12, 17, 22, 5, 9, 14, 20, 4, 11, 16, 23, 6, 10, 15, 21];

/** The sixty-four constants: the whole part of the sine of each step, scaled to 32 bits. */
const SINES = Int32Array.from({ length: 64 }, (_, step) => Math.floor(Math.abs(Math.sin(step + 1)) * 2 ** 32) | 0);

/** An MD5 being worked out: bytes fed in any pieces, and the 16 byte digest at the end. */
export interface Md5 {
    update(bytes: Uint8Array): void;
    digest(): Uint8Array;
}

/** A fresh MD5, fed with `update` and finished with `digest`. */
export function createMd5(): Md5 {
    const state = Int32Array.of(0x67452301, 0xefcdab89 | 0, 0x98badcfe | 0, 0x10325476);
    const block = new Uint8Array(64);
    const words = new Int32Array(16);
    let held = 0;
    let length = 0;

    /** Mixes one block of 64 bytes into the state. */
    function mix(bytes: Uint8Array, from: number) {
        for (let index = 0; index < 16; index++) {
            const at = from + index * 4;
            words[index] = bytes[at]! | (bytes[at + 1]! << 8) | (bytes[at + 2]! << 16) | (bytes[at + 3]! << 24);
        }
        let a = state[0]!;
        let b = state[1]!;
        let c = state[2]!;
        let d = state[3]!;
        for (let step = 0; step < 64; step++) {
            let f: number;
            let word: number;
            if (step < 16) {
                f = (b & c) | (~b & d);
                word = step;
            } else if (step < 32) {
                f = (d & b) | (~d & c);
                word = (5 * step + 1) & 15;
            } else if (step < 48) {
                f = b ^ c ^ d;
                word = (3 * step + 5) & 15;
            } else {
                f = c ^ (b | ~d);
                word = (7 * step) & 15;
            }
            const turn = TURNS[(step >> 4) * 4 + (step & 3)]!;
            const sum = (a + f + SINES[step]! + words[word]!) | 0;
            a = d;
            d = c;
            c = b;
            b = (b + ((sum << turn) | (sum >>> (32 - turn)))) | 0;
        }
        state[0] = (state[0]! + a) | 0;
        state[1] = (state[1]! + b) | 0;
        state[2] = (state[2]! + c) | 0;
        state[3] = (state[3]! + d) | 0;
    }

    function update(bytes: Uint8Array) {
        length += bytes.length;
        let at = 0;
        if (held) {
            const take = Math.min(64 - held, bytes.length);
            block.set(bytes.subarray(0, take), held);
            held += take;
            at = take;
            if (held < 64) return;
            mix(block, 0);
            held = 0;
        }
        for (; at + 64 <= bytes.length; at += 64) mix(bytes, at);
        block.set(bytes.subarray(at), 0);
        held = bytes.length - at;
    }

    function digest(): Uint8Array {
        const bits = length * 8;
        // a one bit, zeros to 56 bytes of the block, then the length in bits, low byte first
        const tail = new Uint8Array((held < 56 ? 64 : 128) - held);
        tail[0] = 0x80;
        const end = tail.length - 8;
        for (let index = 0; index < 8; index++) tail[end + index] = Math.floor(bits / 2 ** (8 * index)) & 255;
        const counted = length;
        update(tail);
        length = counted;
        const out = new Uint8Array(16);
        for (let index = 0; index < 4; index++) for (let byte = 0; byte < 4; byte++) out[index * 4 + byte] = (state[index]! >>> (8 * byte)) & 255;
        return out;
    }

    return { update, digest };
}
