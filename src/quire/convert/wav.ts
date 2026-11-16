// WAV files, read and written by hand. Writing is in two parts, so that a long sound is never held
// whole: `wavSamples` turns each block of the sound into bytes as it comes, and `wavHeader`, made once
// the number of frames is known, goes in front. The header is plain PCM or IEEE float for one or two
// channels, and WAVE_FORMAT_EXTENSIBLE (with the usual speaker layout) for more channels or for 24 bits,
// as Microsoft asks. Reading takes 8, 16, 24 and 32 bit PCM and 32 and 64 bit float, extensible or not,
// and refuses any other coding in plain words.
//
//   blocks = [wavSamples(left_and_right, 16)]; ...
//   file = new Blob([wavHeader({ sampleRate: 48000, channels: 2, bits: 16, frames }), ...blocks]);
//   { sampleRate, channels } = readWav(bytes);

/** The most a WAV file can hold: its RIFF size is 32 bits. */
export const WAV_MOST = 0xffffffff;

/** The usual speakers for each number of channels up to eight, as WAVE_FORMAT_EXTENSIBLE's mask writes them. */
const SPEAKERS = [0, 0x4, 0x3, 0x7, 0x33, 0x37, 0x3f, 0x13f, 0x63f];

/**
 * A sample from -1 to 1 as an integer of so many bits: scaled by half the range, rounded to the nearest,
 * and held inside the range. FLAC uses the same, so that the two give the same numbers. A positive 16-bit
 * sample is scaled by 32767, as Chromium's decoder divides it, so that a 16-bit sound read by the browser
 * is written back with exactly the integers it had (its 24-bit samples are divided by 2 to the 23rd both ways).
 */
export function toInteger(value: number, bits: number): number {
    const half = 2 ** (bits - 1);
    if (!(value === value)) return 0;
    const scaled = Math.round(value * (bits === 16 && value > 0 ? half - 1 : half));
    return scaled >= half ? half - 1 : scaled < -half ? -half : scaled + 0;
}

/** The header of a WAV file of so many frames, to go before the samples. A sound too big for WAV is refused in plain words. */
export function wavHeader(options: { sampleRate: number; channels: number; bits: 16 | 24 | 32; float?: boolean; frames: number }): Uint8Array {
    const { sampleRate, channels, bits, frames } = options;
    const float = options.float === true && bits === 32;
    const extensible = channels > 2 || bits === 24;
    const align = channels * (bits / 8);
    const data = frames * align;
    // the format chunk is 16 bytes for PCM, 18 for float (with its fact chunk of 12), 40 for extensible
    const fmt = extensible ? 40 : float ? 18 : 16;
    const fact = float && !extensible ? 12 : 0;
    const head = 12 + 8 + fmt + fact + 8;
    if (head - 8 + data + (data & 1) > WAV_MOST) throw new Error("This sound is too long for a WAV file, which holds at most 4 GB. Choose FLAC, or fewer channels, or a lower rate.");
    const out = new Uint8Array(head);
    const view = new DataView(out.buffer);
    const word = (at: number, text: string) => [...text].forEach((char, index) => (out[at + index] = char.charCodeAt(0)));
    word(0, "RIFF");
    view.setUint32(4, head - 8 + data + (data & 1), true);
    word(8, "WAVE");
    word(12, "fmt ");
    view.setUint32(16, fmt, true);
    view.setUint16(20, extensible ? 0xfffe : float ? 3 : 1, true);
    view.setUint16(22, channels, true);
    view.setUint32(24, sampleRate, true);
    view.setUint32(28, sampleRate * align, true);
    view.setUint16(32, align, true);
    view.setUint16(34, bits, true);
    let at = 36;
    if (extensible) {
        view.setUint16(36, 22, true);
        view.setUint16(38, bits, true);
        view.setUint32(40, SPEAKERS[channels] ?? 0, true);
        // the coding's GUID: 00000001 or 00000003, then 0000-0010-8000-00AA00389B71
        view.setUint16(44, float ? 3 : 1, true);
        out.set([0x00, 0x00, 0x00, 0x00, 0x10, 0x00, 0x80, 0x00, 0x00, 0xaa, 0x00, 0x38, 0x9b, 0x71], 46);
        at = 60;
    } else if (float) {
        view.setUint16(36, 0, true);
        word(38, "fact");
        view.setUint32(42, 4, true);
        view.setUint32(46, frames, true);
        at = 50;
    }
    word(at, "data");
    view.setUint32(at + 4, data, true);
    return out;
}

/** One block of a sound, a Float32Array to each channel, as the interleaved bytes of a WAV file's samples: integers of 16, 24 or 32 bits, or 32 bit float. */
export function wavSamples(planar: Float32Array[], bits: 16 | 24 | 32, float = false): Uint8Array {
    const channels = planar.length;
    const frames = planar[0]?.length ?? 0;
    const size = bits / 8;
    const out = new Uint8Array(frames * channels * size);
    const view = new DataView(out.buffer);
    let at = 0;
    for (let frame = 0; frame < frames; frame++) {
        for (let channel = 0; channel < channels; channel++) {
            const value = planar[channel]![frame]!;
            if (float && bits === 32) view.setFloat32(at, value, true);
            else {
                const whole = toInteger(value, bits);
                if (bits === 16) view.setInt16(at, whole, true);
                else if (bits === 32) view.setInt32(at, whole, true);
                else {
                    out[at] = whole & 255;
                    out[at + 1] = (whole >> 8) & 255;
                    out[at + 2] = (whole >> 16) & 255;
                }
            }
            at += size;
        }
    }
    return out;
}

/** A WAV file read into its rate and a Float32Array of samples from -1 to 1 for each channel. What it cannot read is said in plain words. */
export function readWav(bytes: Uint8Array): { sampleRate: number; channels: Float32Array[] } {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const word = (at: number) => String.fromCharCode(...bytes.subarray(at, at + 4));
    if (bytes.length < 12 || word(0) !== "RIFF" || word(8) !== "WAVE") throw new Error("This is not a WAV file.");
    let format: { coding: number; channels: number; rate: number; align: number; bits: number } | undefined;
    let at = 12;
    while (at + 8 <= bytes.length) {
        const name = word(at);
        const size = view.getUint32(at + 4, true);
        const body = at + 8;
        if (name === "fmt ") {
            if (size < 16 || body + 16 > bytes.length) throw new Error("This WAV file's description of its sound is broken.");
            let coding = view.getUint16(body, true);
            if (coding === 0xfffe && size >= 40) coding = view.getUint16(body + 24, true);
            format = { coding, channels: view.getUint16(body + 2, true), rate: view.getUint32(body + 4, true), align: view.getUint16(body + 12, true), bits: view.getUint16(body + 14, true) };
        } else if (name === "data") {
            if (!format) throw new Error("This WAV file's sound comes before its description.");
            const { coding, channels, rate, align, bits } = format;
            const pcm = coding === 1 && [8, 16, 24, 32].includes(bits);
            const float = coding === 3 && (bits === 32 || bits === 64);
            if (!pcm && !float) throw new Error(coding === 1 || coding === 3 ? `This WAV file holds ${bits} bit samples, which are not read here.` : "This WAV file's sound is compressed in a way that is not read here. Only plain PCM and float samples are.");
            if (!channels || !rate || align < channels * (bits / 8)) throw new Error("This WAV file's description of its sound is broken.");
            // a sound still being written may give its size as nothing or everything: read what is there
            const end = size === 0 || size === 0xffffffff ? bytes.length : Math.min(bytes.length, body + size);
            const frames = Math.floor((end - body) / align);
            const out = Array.from({ length: channels }, () => new Float32Array(frames));
            const step = bits / 8;
            for (let frame = 0; frame < frames; frame++) {
                const start = body + frame * align;
                for (let channel = 0; channel < channels; channel++) {
                    const place = start + channel * step;
                    let value: number;
                    if (float) value = bits === 32 ? view.getFloat32(place, true) : view.getFloat64(place, true);
                    else if (bits === 8) value = (bytes[place]! - 128) / 128;
                    else if (bits === 16) value = view.getInt16(place, true) / 32768;
                    else if (bits === 24) value = ((bytes[place]! | (bytes[place + 1]! << 8) | (bytes[place + 2]! << 16)) << 8 >> 8) / 8388608;
                    else value = view.getInt32(place, true) / 2147483648;
                    out[channel]![frame] = value;
                }
            }
            return { sampleRate: rate, channels: out };
        }
        at = body + size + (size & 1);
    }
    throw new Error(format ? "This WAV file holds no sound." : "This WAV file's description of its sound is missing.");
}
