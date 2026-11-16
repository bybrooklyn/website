// Films through the converter, with the browser's own encoders and decoders (WebCodecs) and containers of our own. A
// film is read a slice at a time (mp4.ts, webm.ts); its pictures go through the browser's VideoDecoder,
// are made smaller if asked, and go into its VideoEncoder (H.264 for MP4; VP9 or AV1 for WebM); its sound
// is carried over untouched where the new container holds it (AAC or Opus into MP4, Opus into WebM), or
// else decoded, mixed to stereo at most, brought to 48 kHz for Opus, and encoded again (AAC for MP4 where
// this browser writes it, Opus otherwise). Each step waits for the one after it to catch up, so that only
// a few pictures are in memory at once, and what is made goes out as blobs: a long film is never held
// whole. What this browser cannot decode or encode is found by asking it, and said in plain words.
//
//   `done = await convertFilm(file, { format: "webm", video: "vp9", height: 720, bitrate: 0 }, signal, told);`

import { sourceOf, textOf } from "./bytes";
import { createMp4, readMp4 } from "./mp4";
import { createResampler } from "./resample";
import { codecLabel, type Demuxed, type Track } from "./tracks";
import { createWebm, readWebm, type TrackOut } from "./webm";

/** The containers a film is written in. */
export type FilmFormat = "mp4" | "webm";

/** What a film becomes: its container, the coding of its pictures in WebM, its height (0 keeps it), and its bitrate in bits a second (0 works it out from the size). */
export interface FilmChoice {
    format: FilmFormat;
    video: "vp9" | "av1";
    height: number;
    bitrate: number;
}

/** What a film becomes when nothing has been chosen: MP4, at its own size, the bitrate worked out from it. */
export const FILM_DEFAULT: FilmChoice = { format: "mp4", video: "vp9", height: 0, bitrate: 0 };

/** The size a film is made: never larger than it came, its shape kept, both sides even as the encoders want them. */
export function filmSize(width: number, height: number, wanted: number): { width: number; height: number } {
    const even = (value: number) => Math.max(2, Math.round(value / 2) * 2);
    if (!wanted || wanted >= height) return { width: even(width), height: even(height) };
    return { width: even((width * wanted) / height), height: even(wanted) };
}

/** A bitrate for a size and rate of pictures, when none is chosen: about a tenth of a bit for each pixel shown with H.264, two thirds of that with VP9 or AV1. */
export function autoBitrate(width: number, height: number, rate: number, codec: "h264" | "vp9" | "av1"): number {
    const perPixel = codec === "h264" ? 0.1 : 0.066;
    return Math.round(Math.min(40_000_000, Math.max(200_000, width * height * Math.min(60, rate || 30) * perPixel)) / 1000) * 1000;
}

/** The codec string asked of the encoder for a coding and a size: a level high enough for the size. */
export function encoderCodec(coding: "h264" | "vp9" | "av1", width: number, height: number): string {
    const pixels = width * height;
    if (coding === "h264") return `avc1.6400${pixels <= 1920 * 1088 ? "28" : pixels <= 2560 * 1600 ? "32" : pixels <= 4096 * 2304 ? "33" : "34"}`;
    if (coding === "vp9") return `vp09.00.${pixels <= 1920 * 1088 ? "40" : pixels <= 4096 * 2176 ? "50" : "60"}.08`;
    return `av01.0.${pixels <= 1920 * 1088 ? "08" : pixels <= 4096 * 2176 ? "12" : "16"}M.08`;
}

/** Which of the film encoders this browser has, and whether it writes AAC and Opus, found by asking it. */
export async function filmAbilities(): Promise<{ h264: boolean; vp9: boolean; av1: boolean; aac: boolean; opus: boolean }> {
    const video = async (coding: "h264" | "vp9" | "av1") => {
        try {
            return typeof VideoEncoder !== "undefined" && !!(await VideoEncoder.isConfigSupported({ codec: encoderCodec(coding, 1280, 720), width: 1280, height: 720, bitrate: 2_000_000, framerate: 30 })).supported;
        } catch {
            return false;
        }
    };
    const audio = async (codec: string) => {
        try {
            return typeof AudioEncoder !== "undefined" && !!(await AudioEncoder.isConfigSupported({ codec, sampleRate: 48_000, numberOfChannels: 2, bitrate: 128_000 })).supported;
        } catch {
            return false;
        }
    };
    return { h264: await video("h264"), vp9: await video("vp9"), av1: await video("av1"), aac: await audio("mp4a.40.2"), opus: await audio("opus") };
}

/** Opens a film by its first bytes: MP4 and QuickTime, or WebM and Matroska. */
export async function openFilm(file: Blob): Promise<Demuxed> {
    const head = new Uint8Array(await file.slice(0, 12).arrayBuffer());
    if (head[0] === 0x1a && head[1] === 0x45 && head[2] === 0xdf && head[3] === 0xa3) return readWebm(sourceOf(file));
    if (textOf(head, 4, 8) === "ftyp" || ["moov", "mdat", "free", "wide"].includes(textOf(head, 4, 8))) return readMp4(sourceOf(file));
    throw new Error("This film's container is not one read here. MP4, MOV, WebM and MKV are.");
}

/** Throws when the work was stopped. */
function check(signal: AbortSignal) {
    if (signal.aborted) throw new DOMException("stopped", "AbortError");
}

/** Waits until a codec's queue is short, or the work has failed or stopped. */
async function room(queue: () => number, most: number, failed: () => unknown, signal: AbortSignal) {
    while (queue() > most) {
        check(signal);
        const failure = failed();
        if (failure) throw failure;
        await new Promise((done) => setTimeout(done, 2));
    }
}

/** A sound's channels mixed to stereo: a 5.1 sound by the usual weights (the centre and each surround at 0.707 into its side), any other by its first two. */
function toStereo(planar: Float32Array[]): Float32Array[] {
    if (planar.length <= 2) return planar;
    if (planar.length === 6) {
        const [l, r, c, , ls, rs] = planar as [Float32Array, Float32Array, Float32Array, Float32Array, Float32Array, Float32Array];
        const scale = 1 / (1 + 0.707 + 0.707);
        return [Float32Array.from(l, (value, at) => (value + 0.707 * c[at]! + 0.707 * ls[at]!) * scale), Float32Array.from(r, (value, at) => (value + 0.707 * c[at]! + 0.707 * rs[at]!) * scale)];
    }
    return planar.slice(0, 2);
}

/** Whether a sound in one codec can go into a container as it is. */
export function carried(codec: string, format: FilmFormat): boolean {
    if (format === "webm") return codec === "opus";
    return codec === "opus" || codec.startsWith("mp4a.40.2") || codec === "mp4a.40.5" || codec === "mp4a.40.29";
}

/** The plain sentence for a film this browser cannot read. */
export const cannotRead = (track: Track) => `This browser cannot read ${track.label} film.`;

/**
 * Converts one film. `told` hears the share done, measured by the time of the last picture written
 * against the film's length, so the bar moves as the film is actually worked through.
 */
export async function convertFilm(file: Blob, choice: FilmChoice, signal: AbortSignal, told: (share: number, words?: string) => void = () => {}): Promise<{ blob: Blob; facts: string; notes: string[] }> {
    const film = await openFilm(file);
    const picture = film.tracks.find((track) => track.kind === "video");
    const sound = film.tracks.find((track) => track.kind === "audio");
    if (!picture) throw new Error("This file holds no pictures. Convert it as a sound.");
    const notes: string[] = [];
    // what this browser reads
    const decoderConfig: VideoDecoderConfig = { codec: picture.codec, codedWidth: picture.width, codedHeight: picture.height, ...(picture.description ? { description: picture.description } : {}) };
    const readable = await VideoDecoder.isConfigSupported(decoderConfig).catch(() => ({ supported: false }));
    if (!readable.supported) throw new Error(cannotRead(picture));
    // what it writes
    const size = filmSize(picture.width ?? 0, picture.height ?? 0, choice.height);
    const coding = choice.format === "mp4" ? "h264" : choice.video;
    const rate = picture.rate && picture.rate > 1 && picture.rate < 241 ? picture.rate : 30;
    const bitrate = choice.bitrate || autoBitrate(size.width, size.height, rate, coding);
    const encoderConfig: VideoEncoderConfig = { codec: encoderCodec(coding, size.width, size.height), width: size.width, height: size.height, bitrate, framerate: rate, ...(coding === "h264" ? { avc: { format: "avc" } } : {}) } as VideoEncoderConfig;
    const writable = await VideoEncoder.isConfigSupported(encoderConfig).catch(() => ({ supported: false }));
    if (!writable.supported) throw new Error(`This browser cannot write ${coding === "h264" ? "H.264" : coding === "vp9" ? "VP9" : "AV1"} film at ${size.width} × ${size.height}.`);
    // the sound: carried over, encoded again, or left out where this browser can do neither
    let soundPlan: { kind: "none" } | { kind: "carry"; out: TrackOut } | { kind: "encode"; codec: string; rate: number; channels: number; decoder: AudioDecoderConfig } = { kind: "none" };
    if (sound) {
        const decoder: AudioDecoderConfig = { codec: sound.codec, sampleRate: sound.sampleRate ?? 48_000, numberOfChannels: sound.channels ?? 2, ...(sound.description ? { description: sound.description } : {}) };
        if (carried(sound.codec, choice.format)) soundPlan = { kind: "carry", out: { kind: "audio", codec: sound.codec.startsWith("mp4a") ? sound.codec : "opus", description: sound.description, sampleRate: sound.sampleRate, channels: sound.channels } };
        else {
            const canRead = (await AudioDecoder.isConfigSupported(decoder).catch(() => ({ supported: false }))).supported;
            const aac = choice.format === "mp4" && (await AudioEncoder.isConfigSupported({ codec: "mp4a.40.2", sampleRate: 48_000, numberOfChannels: 2, bitrate: 128_000 }).catch(() => ({ supported: false }))).supported;
            const codec = aac ? "mp4a.40.2" : "opus";
            const channels = Math.min(2, sound.channels ?? 2);
            const outRate = codec === "opus" ? 48_000 : [44_100, 48_000].includes(sound.sampleRate ?? 0) ? sound.sampleRate! : 48_000;
            const canWrite = (await AudioEncoder.isConfigSupported({ codec, sampleRate: outRate, numberOfChannels: channels, bitrate: 128_000 }).catch(() => ({ supported: false }))).supported;
            if (!canRead) notes.push(`The sound is left out: this browser cannot read ${sound.label} sound.`);
            else if (!canWrite) notes.push("The sound is left out: this browser cannot write sound for this film.");
            else {
                soundPlan = { kind: "encode", codec, rate: outRate, channels, decoder };
                if (choice.format === "mp4" && codec === "opus") notes.push("The sound is written as Opus, as this browser cannot write AAC. Most players read Opus in MP4; some older ones do not.");
            }
        }
    }
    // the tracks the new file holds: the pictures, and the sound if it has one
    const tracksOut: TrackOut[] = [{ kind: "video", codec: encoderConfig.codec, width: size.width, height: size.height }];
    let soundOut: TrackOut | undefined;
    if (soundPlan.kind === "carry") soundOut = soundPlan.out;
    else if (soundPlan.kind === "encode") soundOut = { kind: "audio", codec: soundPlan.codec, sampleRate: soundPlan.rate, channels: soundPlan.channels };
    if (soundOut) tracksOut.push(soundOut);

    let failure: unknown;
    const fail = (error: unknown) => (failure ??= error);
    const failed = () => failure;
    // the film starts where its first picture is shown: every time is counted from there
    const base = picture.start ?? 0;
    let lastKey = -Infinity;
    let written = 0;
    let count = 0;
    // the writers make their headers at the end, so the encoder's configuration (H.264's avcC) may come with its first output
    const writer = choice.format === "mp4" ? createMp4(tracksOut) : createWebm(tracksOut);
    const encoder = new VideoEncoder({
        output: (chunk, metadata) => {
            const data = new Uint8Array(chunk.byteLength);
            chunk.copyTo(data);
            const description = metadata?.decoderConfig?.description;
            if (description && !tracksOut[0]!.description) tracksOut[0]!.description = new Uint8Array(description instanceof ArrayBuffer ? description : (description as ArrayBufferView).buffer.slice(0));
            writer.add(0, data, chunk.timestamp, chunk.duration ?? Math.round(1e6 / rate), chunk.type === "key");
            count++;
            written = Math.max(written, chunk.timestamp);
            told(film.duration ? Math.min(0.99, written / 1e6 / film.duration) : 0, "Writing");
        },
        error: fail,
    });
    encoder.configure(encoderConfig);
    const canvas = size.width !== picture.width || size.height !== picture.height ? new OffscreenCanvas(size.width, size.height) : undefined;
    const context = canvas?.getContext("2d");
    if (context) context.imageSmoothingQuality = "high";
    const decoder = new VideoDecoder({
        output: (frame) => {
            try {
                const timestamp = Math.max(0, frame.timestamp - base);
                let made: VideoFrame = frame;
                if (canvas && context) {
                    context.drawImage(frame, 0, 0, size.width, size.height);
                    made = new VideoFrame(canvas, { timestamp, duration: frame.duration ?? undefined });
                    frame.close();
                } else if (timestamp !== frame.timestamp) {
                    made = new VideoFrame(frame, { timestamp, duration: frame.duration ?? undefined });
                    frame.close();
                }
                // a key frame every two seconds, so that a player can seek
                const key = timestamp - lastKey >= 2_000_000;
                if (key) lastKey = timestamp;
                encoder.encode(made, { keyFrame: key });
                made.close();
            } catch (error) {
                fail(error);
            }
        },
        error: fail,
    });
    decoder.configure(decoderConfig);
    // the sound's own decoder and encoder, when it is encoded again
    let soundDecoder: AudioDecoder | undefined;
    let soundEncoder: AudioEncoder | undefined;
    let resampler: ReturnType<typeof createResampler> | undefined;
    let soundAt = 0;
    if (soundPlan.kind === "encode") {
        const plan = soundPlan;
        soundEncoder = new AudioEncoder({
            output: (chunk, metadata) => {
                const data = new Uint8Array(chunk.byteLength);
                chunk.copyTo(data);
                const description = metadata?.decoderConfig?.description;
                if (description && !soundOut!.description) soundOut!.description = new Uint8Array(description instanceof ArrayBuffer ? description : (description as ArrayBufferView).buffer.slice(0));
                writer.add(1, data, chunk.timestamp, chunk.duration ?? 0, true);
            },
            error: fail,
        });
        soundEncoder.configure({ codec: plan.codec, sampleRate: plan.rate, numberOfChannels: plan.channels, bitrate: 128_000 });
        const give = (planar: Float32Array[]) => {
            const frames = planar[0]?.length ?? 0;
            if (!frames) return;
            const joined = new Float32Array(frames * planar.length);
            planar.forEach((channel, index) => joined.set(channel, index * frames));
            const data = new AudioData({ format: "f32-planar", sampleRate: plan.rate, numberOfFrames: frames, numberOfChannels: planar.length, timestamp: Math.round((soundAt / plan.rate) * 1e6), data: joined });
            soundAt += frames;
            soundEncoder!.encode(data);
            data.close();
        };
        soundDecoder = new AudioDecoder({
            output: (data) => {
                try {
                    const planar = Array.from({ length: data.numberOfChannels }, (_, channel) => {
                        const out = new Float32Array(data.numberOfFrames);
                        data.copyTo(out, { planeIndex: channel, format: "f32-planar" });
                        return out;
                    });
                    const inRate = data.sampleRate;
                    data.close();
                    const stereo = plan.channels === 1 ? [planar.reduce((sum, channel) => sum.map((value, at) => value + channel[at]! / planar.length), new Float32Array(planar[0]!.length))] : toStereo(planar).length === 1 ? [planar[0]!, planar[0]!] : toStereo(planar);
                    if (inRate !== plan.rate) {
                        resampler ??= createResampler(inRate, plan.rate, stereo.length);
                        give(resampler.push(stereo));
                    } else give(stereo);
                } catch (error) {
                    fail(error);
                }
            },
            error: fail,
        });
        soundDecoder.configure(plan.decoder);
    }
    const close = () => {
        for (const codec of [decoder, encoder, soundDecoder, soundEncoder]) if (codec && codec.state !== "closed") codec.close();
    };
    try {
        for await (const sample of film.samples(signal)) {
            check(signal);
            if (failure) throw failure;
            if (sample.track === picture.id) {
                await room(() => decoder.decodeQueueSize + encoder.encodeQueueSize, 6, failed, signal);
                decoder.decode(new EncodedVideoChunk({ type: sample.key ? "key" : "delta", timestamp: sample.timestamp, duration: sample.duration || undefined, data: sample.data }));
            } else if (sound && sample.track === sound.id) {
                if (soundPlan.kind === "carry") {
                    const timestamp = sample.timestamp - base;
                    if (timestamp >= 0) writer.add(1, sample.data, timestamp, sample.duration, true);
                } else if (soundDecoder) {
                    await room(() => soundDecoder!.decodeQueueSize + soundEncoder!.encodeQueueSize, 16, failed, signal);
                    soundDecoder.decode(new EncodedAudioChunk({ type: "key", timestamp: sample.timestamp, duration: sample.duration || undefined, data: sample.data }));
                }
            }
        }
        check(signal);
        told(0.99, "Finishing");
        await decoder.flush();
        await encoder.flush();
        if (soundDecoder && soundEncoder) {
            await soundDecoder.flush();
            if (resampler) {
                const last = resampler.end();
                const frames = last[0]?.length ?? 0;
                if (frames) {
                    const joined = new Float32Array(frames * last.length);
                    last.forEach((channel, index) => joined.set(channel, index * frames));
                    const data = new AudioData({ format: "f32-planar", sampleRate: (soundPlan as { rate: number }).rate, numberOfFrames: frames, numberOfChannels: last.length, timestamp: Math.round((soundAt / (soundPlan as { rate: number }).rate) * 1e6), data: joined });
                    soundEncoder.encode(data);
                    data.close();
                }
            }
            await soundEncoder.flush();
        }
        if (failure) throw failure;
    } catch (error) {
        close();
        if (signal.aborted) throw new DOMException("stopped", "AbortError");
        throw error instanceof Error ? error : new Error(`The film could not be converted: ${String(error)}`);
    }
    close();
    if (!count) throw new Error("No pictures came out of this film.");
    const blob = writer.end();
    told(1);
    const soundWords = soundPlan.kind === "carry" ? `${codecLabel(soundPlan.out.codec)} sound carried over` : soundPlan.kind === "encode" ? `${codecLabel(soundPlan.codec)} sound` : "no sound";
    return { blob, facts: `${size.width} × ${size.height}, ${Math.round(bitrate / 100_000) / 10} Mbps, ${soundWords}`, notes };
}
