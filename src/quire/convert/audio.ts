// Sounds through the converter, with the browser's own codecs. A sound is read whole by the browser's
// own decoder (decodeAudioData, the plain way to read a whole sound: whatever this browser reads, WAV,
// FLAC, MP3, Ogg, Opus, AAC in M4A, the sound of a WebM), at the rate chosen or the rate it came at,
// which is read from the file's own header; its channels are mixed to those chosen by the browser's
// own mixing. Then it is written: WAV and FLAC by hand (wav.ts, flac.ts), Opus by the browser's
// AudioEncoder into a WebM or an Ogg file, and AAC by it into an M4A, where this browser encodes AAC.
// What the browser cannot encode is found by asking it (isConfigSupported). MP3 is read and never
// written: there is no encoder for it with a free license, and browsers do not write it.

import { sourceOf, textOf, viewOf } from "./bytes";
import { createFlacEncoder } from "./flac";
import { createMp4, readMp4 } from "./mp4";
import { createOggOpus, preSkipOf } from "./ogg";
import { wavHeader, wavSamples } from "./wav";
import { createWebm, readWebm } from "./webm";

/** The formats a sound is written in. */
export type AudioFormat = "wav" | "flac" | "opus-webm" | "opus-ogg" | "aac-m4a";

/** Each format: its words, its ending, whether a bitrate means anything, and the encoder it needs from the browser. */
export const AUDIO_FORMATS: { key: AudioFormat; label: string; short: string; ending: string; lossy: boolean; tip: string }[] = [
    { key: "wav", label: "WAV", short: "WAV", ending: ".wav", lossy: false, tip: "Every sample kept, opened by anything, large" },
    { key: "flac", label: "FLAC", short: "FLAC", ending: ".flac", lossy: false, tip: "Every sample kept, about half the size of WAV" },
    { key: "opus-webm", label: "Opus in WebM", short: "Opus WebM", ending: ".webm", lossy: true, tip: "Small and clear, played by browsers" },
    { key: "opus-ogg", label: "Opus in Ogg", short: "Opus Ogg", ending: ".opus", lossy: true, tip: "Small and clear, the usual Opus file" },
    { key: "aac-m4a", label: "AAC in M4A", short: "AAC M4A", ending: ".m4a", lossy: true, tip: "Played by nearly everything, Apple's devices too" },
];

/** What a sound becomes. `rate` and `channels` of 0 keep what it came with. */
export interface AudioChoice {
    format: AudioFormat;
    rate: number;
    channels: number;
    bitrate: number;
    bits: 16 | 24 | 32;
}

/** What a sound becomes when nothing has been chosen: FLAC, as it came, 16 bits. */
export const AUDIO_DEFAULT: AudioChoice = { format: "flac", rate: 0, channels: 0, bitrate: 128_000, bits: 16 };

/** The largest sound file read whole: its decoded samples must fit in the page's memory. */
export const AUDIO_MOST = 512 * 1024 * 1024;

/** What MP3 is told, where it matters. */
export const NO_MP3 = "MP3 is read and not written: no MP3 encoder has a free license, and browsers do not write MP3.";

/** Which of the lossy encoders this browser has, found by asking it. */
export async function audioAbilities(): Promise<{ opus: boolean; aac: boolean }> {
    const ask = async (codec: string, sampleRate: number) => {
        try {
            return typeof AudioEncoder !== "undefined" && !!(await AudioEncoder.isConfigSupported({ codec, sampleRate, numberOfChannels: 2, bitrate: 128_000 })).supported;
        } catch {
            return false;
        }
    };
    return { opus: await ask("opus", 48_000), aac: await ask("mp4a.40.2", 48_000) };
}

/** The rate a sound file came at and its channels, read from its own header where it says them; undefined where it cannot be told. */
export async function soundFacts(file: Blob): Promise<{ rate?: number; channels?: number; duration?: number; codec?: string } | undefined> {
    const head = new Uint8Array(await file.slice(0, 64 * 1024).arrayBuffer());
    const view = viewOf(head);
    const tag = textOf(head, 0, 4);
    if (tag === "RIFF" && textOf(head, 8, 12) === "WAVE") {
        // the format chunk is nearly always first; its rate and channels, and the data's length
        let at = 12;
        let facts: { rate?: number; channels?: number; duration?: number } = {};
        let perSecond = 0;
        while (at + 8 <= head.length) {
            const id = textOf(head, at, at + 4);
            const size = view.getUint32(at + 4, true);
            if (id === "fmt ") {
                facts = { channels: view.getUint16(at + 10, true), rate: view.getUint32(at + 12, true) };
                perSecond = view.getUint32(at + 16, true);
            } else if (id === "data") {
                if (perSecond) facts.duration = Math.min(size, file.size - at - 8) / perSecond;
                break;
            }
            at += 8 + size + (size & 1);
        }
        return { ...facts, codec: "pcm" };
    }
    if (tag === "fLaC") {
        // the stream info: rate in 20 bits, channels less one in 3, bits, then the samples in 36
        const rate = (head[18]! << 12) | (head[19]! << 4) | (head[20]! >> 4);
        const channels = ((head[20]! >> 1) & 7) + 1;
        const samples = (head[21]! & 15) * 2 ** 32 + view.getUint32(22);
        return { rate, channels, duration: samples ? samples / rate : undefined, codec: "flac" };
    }
    if (tag === "OggS") {
        const packet = 27 + head[26]!;
        if (textOf(head, packet, packet + 8) === "OpusHead") return { rate: 48_000, channels: head[packet + 9], codec: "opus" };
        if (textOf(head, packet + 1, packet + 7) === "vorbis") return { rate: view.getUint32(packet + 12, true), channels: head[packet + 11], codec: "vorbis" };
        if (textOf(head, packet, packet + 5) === "\x7fFLAC") return { rate: (head[packet + 27]! << 12) | (head[packet + 28]! << 4) | (head[packet + 29]! >> 4), channels: ((head[packet + 29]! >> 1) & 7) + 1, codec: "flac" };
        return undefined;
    }
    if (tag === "FORM" && (textOf(head, 8, 12) === "AIFF" || textOf(head, 8, 12) === "AIFC")) {
        let at = 12;
        while (at + 8 <= head.length) {
            const size = view.getUint32(at + 4);
            if (textOf(head, at, at + 4) === "COMM") {
                const channels = view.getUint16(at + 8);
                const frames = view.getUint32(at + 10);
                // the rate is an 80-bit float: a sign and exponent in 16 bits, then a 64-bit mantissa
                const exponent = (view.getUint16(at + 16) & 0x7fff) - 16383;
                const rate = Math.round(Number(view.getBigUint64(at + 18)) * 2 ** (exponent - 63));
                return { rate, channels, duration: frames / rate, codec: "pcm" };
            }
            at += 8 + size + (size & 1);
        }
        return undefined;
    }
    if (tag === "\x1aE\xdf\xa3" || textOf(head, 4, 8) === "ftyp") {
        try {
            const read = tag === "\x1aE\xdf\xa3" ? await readWebm(sourceOf(file)) : await readMp4(sourceOf(file));
            const track = read.tracks.find((each) => each.kind === "audio");
            return track ? { rate: track.sampleRate, channels: track.channels, duration: track.duration || read.duration, codec: track.label } : undefined;
        } catch {
            return undefined;
        }
    }
    // MP3: past an ID3 tag, the first frame's header gives its rate and channel mode
    let at = 0;
    if (tag.startsWith("ID3")) at = 10 + (((head[6]! & 0x7f) << 21) | ((head[7]! & 0x7f) << 14) | ((head[8]! & 0x7f) << 7) | (head[9]! & 0x7f));
    const near = at + 4 <= head.length ? head : new Uint8Array(await file.slice(at, at + 8192).arrayBuffer());
    const from = near === head ? at : 0;
    for (let place = from; place + 4 <= near.length; place++) {
        if (near[place] !== 0xff || (near[place + 1]! & 0xe0) !== 0xe0) continue;
        const version = (near[place + 1]! >> 3) & 3;
        const layer = (near[place + 1]! >> 1) & 3;
        const index = (near[place + 2]! >> 2) & 3;
        if (layer === 0 || index === 3 || version === 1) continue;
        if (layer === 0 && version === 0) continue;
        const base = [44100, 48000, 32000][index]!;
        const rate = version === 3 ? base : version === 2 ? base / 2 : base / 4;
        return { rate, channels: (near[place + 3]! >> 6) === 3 ? 1 : 2, codec: "mp3" };
    }
    return undefined;
}

/** Throws when the work was stopped. */
function check(signal: AbortSignal) {
    if (signal.aborted) throw new DOMException("stopped", "AbortError");
}

/** Lets the page breathe between pieces of long work, so that it stays usable and can be stopped. */
const breathe = () => new Promise((done) => setTimeout(done, 0));

/** Reads a whole sound with the browser's own decoder, at a rate and with channels mixed to those asked (0 keeps them). */
export async function decodeSound(file: Blob, rate: number, channels: number, signal: AbortSignal): Promise<AudioBuffer> {
    if (file.size > AUDIO_MOST) throw new Error("This sound is too large to read whole in a page. Cut it into parts, or convert it as a film.");
    const bytes = await file.arrayBuffer();
    check(signal);
    let decoded: AudioBuffer;
    try {
        decoded = await new OfflineAudioContext(1, 1, rate).decodeAudioData(bytes);
    } catch {
        throw new Error("This browser cannot read this sound.");
    }
    check(signal);
    if (!channels || channels === decoded.numberOfChannels) return decoded;
    // the browser's own mixing, by the speakers' rules: stereo to mono is the average, mono to stereo both sides
    const mixer = new OfflineAudioContext(channels, decoded.length, rate);
    const source = mixer.createBufferSource();
    source.buffer = decoded;
    source.connect(mixer.destination);
    source.start();
    return mixer.startRendering();
}

/** A sound's samples as their channels, a piece at a time. */
function piece(buffer: AudioBuffer, from: number, to: number): Float32Array[] {
    return Array.from({ length: buffer.numberOfChannels }, (_, channel) => buffer.getChannelData(channel).subarray(from, to));
}

/** Writes a sound read whole into a format, telling the share done as it goes. */
export async function encodeSound(buffer: AudioBuffer, choice: AudioChoice, signal: AbortSignal, told: (share: number) => void): Promise<Blob> {
    const rate = buffer.sampleRate;
    const channels = buffer.numberOfChannels;
    const frames = buffer.length;
    const step = rate;
    if (choice.format === "wav") {
        const bits = choice.bits;
        const parts: BlobPart[] = [wavHeader({ sampleRate: rate, channels, bits, float: bits === 32, frames }) as BlobPart];
        for (let at = 0; at < frames; at += step * 10) {
            check(signal);
            parts.push(new Blob([wavSamples(piece(buffer, at, Math.min(frames, at + step * 10)), bits, bits === 32) as BlobPart]));
            told(Math.min(1, (at + step * 10) / frames));
            await breathe();
        }
        return new Blob(parts, { type: "audio/wav" });
    }
    if (choice.format === "flac") {
        const encoder = createFlacEncoder({ sampleRate: rate, channels, bits: choice.bits === 16 ? 16 : 24 });
        const parts: BlobPart[] = [];
        for (let at = 0; at < frames; at += step) {
            check(signal);
            for (const frame of encoder.push(piece(buffer, at, Math.min(frames, at + step)))) parts.push(frame as BlobPart);
            told(Math.min(1, (at + step) / frames));
            await breathe();
        }
        const end = encoder.end();
        return new Blob([end.head as BlobPart, ...parts, ...(end.frames as BlobPart[])], { type: "audio/flac" });
    }
    // the browser's encoder: Opus or AAC
    const aac = choice.format === "aac-m4a";
    const codec = aac ? "mp4a.40.2" : "opus";
    const config: AudioEncoderConfig = { codec, sampleRate: rate, numberOfChannels: channels, bitrate: choice.bitrate };
    const supported = await AudioEncoder.isConfigSupported(config).catch(() => ({ supported: false }));
    if (!supported.supported) throw new Error(aac ? "This browser cannot write AAC." : `This browser cannot write Opus at ${rate / 1000} kHz with ${channels} channels.`);
    const chunks: { data: Uint8Array; timestamp: number; duration: number }[] = [];
    let description: Uint8Array | undefined;
    let failure: unknown;
    const encoder = new AudioEncoder({
        output: (chunk, metadata) => {
            const data = new Uint8Array(chunk.byteLength);
            chunk.copyTo(data);
            chunks.push({ data, timestamp: chunk.timestamp, duration: chunk.duration ?? 0 });
            if (metadata?.decoderConfig?.description && !description) description = new Uint8Array(metadata.decoderConfig.description instanceof ArrayBuffer ? metadata.decoderConfig.description : (metadata.decoderConfig.description as ArrayBufferView).buffer.slice(0));
        },
        error: (error) => (failure = error),
    });
    encoder.configure(config);
    try {
        for (let at = 0; at < frames; at += step) {
            check(signal);
            if (failure) throw failure;
            const end = Math.min(frames, at + step);
            const planar = new Float32Array((end - at) * channels);
            for (let channel = 0; channel < channels; channel++) planar.set(buffer.getChannelData(channel).subarray(at, end), channel * (end - at));
            const data = new AudioData({ format: "f32-planar", sampleRate: rate, numberOfFrames: end - at, numberOfChannels: channels, timestamp: Math.round((at / rate) * 1e6), data: planar });
            encoder.encode(data);
            data.close();
            // the encoder is let catch up before more is given, so its queue stays short
            while (encoder.encodeQueueSize > 4) await new Promise((done) => setTimeout(done, 5));
            told(Math.min(0.99, end / frames));
        }
        await encoder.flush();
        if (failure) throw failure;
    } finally {
        if (encoder.state !== "closed") encoder.close();
    }
    check(signal);
    if (aac) {
        const writer = createMp4([{ kind: "audio", codec, description, sampleRate: rate, channels }], { audioOnly: true });
        for (const chunk of chunks) writer.add(0, chunk.data, chunk.timestamp, chunk.duration, true);
        told(1);
        return writer.end();
    }
    if (choice.format === "opus-ogg") {
        const writer = createOggOpus({ channels, preSkip: preSkipOf(description) ?? 312, inputRate: rate });
        for (const chunk of chunks) writer.add(chunk.data, Math.round((chunk.duration * 48_000) / 1e6));
        told(1);
        return writer.end(Math.round((frames * 48_000) / rate));
    }
    const writer = createWebm([{ kind: "audio", codec: "opus", description, sampleRate: rate, channels }]);
    // the padding the encoder added after the end, dropped by the player from the last packet
    const made = chunks.reduce((sum, chunk) => sum + Math.round((chunk.duration * 48_000) / 1e6), 0);
    const padding = Math.max(0, made - (preSkipOf(description) ?? 312) - Math.round((frames * 48_000) / rate));
    for (const [index, chunk] of chunks.entries()) writer.add(0, chunk.data, chunk.timestamp, chunk.duration, true, index === chunks.length - 1 ? Math.min(padding, Math.round((chunk.duration * 48_000) / 1e6)) * (1e9 / 48_000) : 0);
    told(1);
    return writer.end();
}
