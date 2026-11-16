// What films through the converter are held to. Outside a browser: a film is made smaller only, its shape
// kept and its sides even; a rate of bits and an encoder's level follow from the size; and only the sound a
// container holds is carried over. In Chromium: a short film made in code (each picture showing its own
// number in black and white blocks, with a tone for its sound) goes in as MP4 (H.264 with Opus) and as
// WebM (VP9 with Opus), comes out as the other, smaller and at a lower rate of bits, and as AV1 in WebM where
// this browser writes it; every picture is read back by the browser's decoder, in order, each showing its
// own number; the sound is there for the film's length; and the browser's own video player opens each
// file made, knows its length and size, and shows the right picture when sent to the middle. A film made
// by `ffmpeg`, where it is installed, in H.264 with pictures out of order and AAC at 44.1 kHz, as a camera
// or a phone writes them, becomes WebM with its sound encoded again as Opus at 48 kHz.

import { expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { corePage, quire } from "../../../scripts/core-page";
import { autoBitrate, carried, encoderCodec, filmSize } from "./video";

test("a film is made smaller only, its shape kept and both sides even", () => {
    expect(filmSize(1920, 1080, 0)).toEqual({ width: 1920, height: 1080 });
    expect(filmSize(1920, 1080, 720)).toEqual({ width: 1280, height: 720 });
    expect(filmSize(1280, 720, 1080)).toEqual({ width: 1280, height: 720 });
    expect(filmSize(1080, 1920, 480)).toEqual({ width: 270, height: 480 });
    expect(filmSize(641, 359, 0)).toEqual({ width: 642, height: 360 });
});

test("a bitrate and an encoder's level follow from the size", () => {
    expect(autoBitrate(1280, 720, 30, "h264")).toBe(2_765_000);
    expect(autoBitrate(1280, 720, 30, "vp9")).toBeLessThan(autoBitrate(1280, 720, 30, "h264"));
    expect(autoBitrate(64, 64, 30, "h264")).toBe(200_000);
    expect(encoderCodec("h264", 1920, 1080)).toBe("avc1.640028");
    expect(encoderCodec("h264", 3840, 2160)).toBe("avc1.640033");
    expect(encoderCodec("vp9", 1280, 720)).toBe("vp09.00.40.08");
    expect(encoderCodec("av1", 3840, 2160)).toBe("av01.0.12M.08");
});

test("only the sound a container holds is carried over as it is", () => {
    expect(carried("opus", "webm")).toBe(true);
    expect(carried("mp4a.40.2", "webm")).toBe(false);
    expect(carried("mp4a.40.2", "mp4")).toBe(true);
    expect(carried("opus", "mp4")).toBe(true);
    expect(carried("vorbis", "mp4")).toBe(false);
});

test("in Chromium, a short film made in code goes in as MP4 and as WebM, comes out as the other with every picture read back in order, and the browser's player opens it", async () => {
    const page = await corePage(`
        import { createMp4, readMp4 } from "${quire}/convert/mp4.ts";
        import { createWebm, readWebm } from "${quire}/convert/webm.ts";
        import { sourceOf } from "${quire}/convert/bytes.ts";
        import { convertFilm, filmAbilities } from "${quire}/convert/video.ts";
        const W = 320, H = 240, FPS = 30, SECONDS = 3, COUNT = FPS * SECONDS;
        // a picture showing its own number: eight blocks across the top, white for a one, and a square that moves
        const draw = (context, index, width, height) => {
            context.fillStyle = "#406080"; context.fillRect(0, 0, width, height);
            for (let bit = 0; bit < 8; bit++) { context.fillStyle = (index >> bit) & 1 ? "#ffffff" : "#000000"; context.fillRect(bit * width / 8, 0, width / 8, height / 3); }
            context.fillStyle = "#e04060"; context.fillRect((index * 3) % (width - 40), height / 2, 40, 40);
        };
        // the number a picture shows, read from the middle of each block
        const numberOf = (frame) => {
            const canvas = new OffscreenCanvas(frame.displayWidth, frame.displayHeight);
            const context = canvas.getContext("2d", { willReadFrequently: true });
            context.drawImage(frame, 0, 0);
            let index = 0;
            for (let bit = 0; bit < 8; bit++) { const p = context.getImageData(Math.floor((bit + 0.5) * canvas.width / 8), Math.floor(canvas.height / 6), 1, 1).data; if (p[0] + p[1] + p[2] > 384) index |= 1 << bit; }
            return index;
        };
        window.film = async (container) => {
            const canvas = new OffscreenCanvas(W, H);
            const context = canvas.getContext("2d");
            const videoChunks = [];
            let videoDescription;
            const codec = container === "mp4" ? "avc1.42001f" : "vp09.00.10.08";
            const encoder = new VideoEncoder({ output: (chunk, meta) => { const data = new Uint8Array(chunk.byteLength); chunk.copyTo(data); videoChunks.push({ data, timestamp: chunk.timestamp, duration: chunk.duration, key: chunk.type === "key" }); if (meta?.decoderConfig?.description) videoDescription = new Uint8Array(meta.decoderConfig.description); }, error: (e) => { throw e; } });
            encoder.configure({ codec, width: W, height: H, bitrate: 1_000_000, framerate: FPS, ...(container === "mp4" ? { avc: { format: "avc" } } : {}) });
            for (let index = 0; index < COUNT; index++) {
                draw(context, index, W, H);
                const frame = new VideoFrame(canvas, { timestamp: Math.round(index * 1e6 / FPS), duration: Math.round(1e6 / FPS) });
                encoder.encode(frame, { keyFrame: index % 30 === 0 });
                frame.close();
            }
            await encoder.flush();
            const audioChunks = [];
            let audioDescription;
            const audioEncoder = new AudioEncoder({ output: (chunk, meta) => { const data = new Uint8Array(chunk.byteLength); chunk.copyTo(data); audioChunks.push({ data, timestamp: chunk.timestamp, duration: chunk.duration }); if (meta?.decoderConfig?.description) audioDescription = new Uint8Array(meta.decoderConfig.description); }, error: (e) => { throw e; } });
            audioEncoder.configure({ codec: "opus", sampleRate: 48000, numberOfChannels: 2, bitrate: 96000 });
            const frames = 48000 * SECONDS;
            const tone = Float32Array.from({ length: frames * 2 }, (_, at) => 0.4 * Math.sin(2 * Math.PI * 440 * (at % frames) / 48000));
            audioEncoder.encode(new AudioData({ format: "f32-planar", sampleRate: 48000, numberOfFrames: frames, numberOfChannels: 2, timestamp: 0, data: tone }));
            await audioEncoder.flush();
            const tracks = [{ kind: "video", codec, description: videoDescription, width: W, height: H }, { kind: "audio", codec: "opus", description: audioDescription, sampleRate: 48000, channels: 2 }];
            const writer = container === "mp4" ? createMp4(tracks) : createWebm(tracks);
            for (const chunk of videoChunks) writer.add(0, chunk.data, chunk.timestamp, chunk.duration, chunk.key);
            for (const chunk of audioChunks) writer.add(1, chunk.data, chunk.timestamp, chunk.duration, true);
            return new File([writer.end()], "film." + container);
        };
        // every picture of a film read back by the browser's decoder, the number each shows, and the sound's length
        window.readBack = async (blob, container) => {
            const film = container === "mp4" ? await readMp4(sourceOf(blob)) : await readWebm(sourceOf(blob));
            const picture = film.tracks.find((track) => track.kind === "video");
            const sound = film.tracks.find((track) => track.kind === "audio");
            const numbers = [];
            const decoder = new VideoDecoder({ output: (frame) => { numbers.push(numberOf(frame)); frame.close(); }, error: (e) => numbers.push(String(e)) });
            decoder.configure({ codec: picture.codec, codedWidth: picture.width, codedHeight: picture.height, ...(picture.description ? { description: picture.description } : {}) });
            let soundSeconds = 0, keys = 0;
            for await (const sample of film.samples()) {
                if (sample.track === picture.id) { decoder.decode(new EncodedVideoChunk({ type: sample.key ? "key" : "delta", timestamp: sample.timestamp, data: sample.data })); if (sample.key) keys++; }
                else if (sound && sample.track === sound.id) soundSeconds += sample.duration / 1e6;
            }
            await decoder.flush();
            return { codec: picture.codec, width: picture.width, height: picture.height, numbers, keys, sound: sound?.codec, soundSeconds, duration: film.duration };
        };
        // the browser's own player: its length and size, and the picture it shows in the middle
        window.play = async (blob) => {
            const video = document.createElement("video");
            video.muted = true;
            video.src = URL.createObjectURL(blob);
            await new Promise((done, fail) => { video.onloadedmetadata = done; video.onerror = () => fail(new Error("the player could not open it: " + video.error?.message)); });
            const said = { duration: video.duration, width: video.videoWidth, height: video.videoHeight };
            video.currentTime = 1.5;
            await new Promise((done) => (video.onseeked = done));
            const canvas = new OffscreenCanvas(video.videoWidth, video.videoHeight);
            canvas.getContext("2d").drawImage(video, 0, 0);
            const frame = new VideoFrame(canvas, { timestamp: 0 });
            said.middle = numberOf(frame);
            frame.close();
            return said;
        };
        window.convertFilm = convertFilm;
        window.fromBase64 = (text, name) => new File([Uint8Array.from(atob(text), (c) => c.charCodeAt(0))], name);
        window.abilities = filmAbilities;
    `);
    if (!page) return console.warn("film browser test skipped: needs a Chromium");
    try {
        const { tab } = page;
        const abilities = await tab.run<{ h264: boolean; vp9: boolean; av1: boolean; aac: boolean; opus: boolean }>("window.abilities()");
        console.log(`films in ${/Chrome\/[\d.]+/.exec(await tab.run<string>("navigator.userAgent"))?.[0]}: ${JSON.stringify(abilities)}`);
        expect(abilities.h264 && abilities.vp9 && abilities.opus).toBe(true);
        const every = Array.from({ length: 90 }, (_, index) => index);
        type Back = { codec: string; width: number; height: number; numbers: number[]; keys: number; sound?: string; soundSeconds: number; duration: number };
        type Played = { duration: number; width: number; height: number; middle: number };
        // the films made in code read back as made
        for (const container of ["mp4", "webm"]) {
            const back = await tab.run<Back>(`window.film("${container}").then((file) => window.readBack(file, "${container}"))`);
            expect(back.numbers).toEqual(every);
        }
        const trials: [string, string, string, number, number][] = [
            ["mp4", "webm", "vp9", 120, 300_000],
            ["webm", "mp4", "vp9", 180, 400_000],
            ...(abilities.av1 ? ([["mp4", "webm", "av1", 120, 200_000]] as [string, string, string, number, number][]) : []),
        ];
        for (const [from, to, video, height, bitrate] of trials) {
            const started = Date.now();
            const made = await tab.run<{ size: number; facts: string; notes: string[]; type: string; index: number }>(`(async () => {
                window.made = [];
                const file = await window.film("${from}");
                const done = await window.convertFilm(file, { format: "${to}", video: "${video}", height: ${height}, bitrate: ${bitrate} }, new AbortController().signal);
                window.made.push(done.blob);
                return { size: done.blob.size, facts: done.facts, notes: done.notes, type: done.blob.type, index: 0 };
            })()`);
            const back = await tab.run<Back>(`window.readBack(window.made[0], "${to}")`);
            const played = await tab.run<Played>("window.play(window.made[0])");
            console.log(`${from} to ${to} (${back.codec}): ${made.size} bytes in ${Date.now() - started} ms, ${made.facts}; ${back.numbers.length} pictures read back, ${back.keys} key frames, ${back.soundSeconds.toFixed(2)} s of ${back.sound}; the player says ${played.duration.toFixed(2)} s at ${played.width} × ${played.height}, showing picture ${played.middle} at 1.5 s`);
            expect(back.numbers).toEqual(every);
            expect(back.height).toBe(height);
            expect(back.width).toBe((320 * height) / 240);
            expect(back.sound).toBe("opus");
            expect(Math.abs(back.soundSeconds - 3)).toBeLessThan(0.1);
            expect(Math.abs(played.duration - 3)).toBeLessThan(0.15);
            expect([played.width, played.height]).toEqual([back.width, back.height]);
            expect(Math.abs(played.middle - 45)).toBeLessThanOrEqual(1);
            // smaller than it came, at about the rate of bits asked for
            expect(made.size).toBeLessThan((bitrate * 3 * 1.6) / 8 + 60_000);
        }
        // a film as a camera writes it: H.264 with pictures out of order, and AAC at 44.1 kHz
        if (spawnSync("ffmpeg", ["-version"]).status !== 0) console.log("ffmpeg is not installed, so a film made by it is not tried");
        else {
            const folder = await mkdtemp(join(tmpdir(), "quire-film-"));
            try {
                const path = join(folder, "camera.mp4");
                const made = spawnSync("ffmpeg", ["-v", "error", "-f", "lavfi", "-i", "testsrc=size=320x240:rate=30:duration=3", "-f", "lavfi", "-i", "sine=frequency=440:sample_rate=44100:duration=3", "-c:v", "libx264", "-bf", "2", "-pix_fmt", "yuv420p", "-c:a", "aac", "-shortest", "-y", path], { timeout: 120_000 });
                if (made.status !== 0) console.log(`ffmpeg could not make the film: ${made.stderr}`);
                else {
                    const base64 = Buffer.from(await Bun.file(path).arrayBuffer()).toString("base64");
                    const done = await tab.run<{ size: number; facts: string; notes: string[] }>(`(async () => { const done = await window.convertFilm(window.fromBase64("${base64}", "camera.mp4"), { format: "webm", video: "vp9", height: 0, bitrate: 0 }, new AbortController().signal); window.made = [done.blob]; return { size: done.blob.size, facts: done.facts, notes: done.notes }; })()`);
                    const back = await tab.run<Back>(`window.readBack(window.made[0], "webm")`);
                    const played = await tab.run<Played>("window.play(window.made[0])");
                    console.log(`camera.mp4 to webm: ${done.size} bytes, ${done.facts}; ${back.numbers.length} pictures, ${back.soundSeconds.toFixed(2)} s of ${back.sound}; the player says ${played.duration.toFixed(2)} s`);
                    expect(back.numbers.length).toBe(90);
                    expect(back.sound).toBe("opus");
                    expect(done.facts).toContain("Opus sound");
                    expect(Math.abs(back.soundSeconds - 3)).toBeLessThan(0.1);
                    expect(Math.abs(played.duration - 3)).toBeLessThan(0.15);
                }
            } finally {
                await rm(folder, { recursive: true, force: true });
            }
        }
        expect(tab.errors).toEqual([]);
    } finally {
        await page.close();
    }
}, 300_000);
