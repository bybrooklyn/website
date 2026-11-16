// What sounds through the converter are held to. Outside a browser: the rate, channels and length are read
// from each kind of header. In Chromium: a sound made in code (a rising sweep in the left ear, a steady tone
// in the right, swelling and fading) goes in as a WAV, is written as WAV and FLAC (the same samples back, to the last bit of 16),
// as Opus in WebM and in Ogg (the same tones back, aligned, well above the noise of the format, and the
// same length), and as AAC where this browser writes it (and said not to be where it does not); each is
// read back by the browser's own decoder. A rate changed keeps the tones' pitch, and stereo mixed to mono
// is the average of the two. Files made by `ffmpeg`, where it is installed, in MP3, AAC, Vorbis and FLAC,
// are read.

import { expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { corePage, quire } from "../../../scripts/core-page";
import { soundFacts } from "./audio";
import { createFlacEncoder } from "./flac";
import { wavHeader, wavSamples } from "./wav";

const tone = (frames: number, rate: number, hertz: number) => Float32Array.from({ length: frames }, (_, at) => 0.5 * Math.sin((2 * Math.PI * hertz * at) / rate));

test("the rate, channels and length are read from a WAV's, a FLAC's, an Ogg's and an MP3's own header", async () => {
    const left = tone(48_000, 48_000, 440);
    const wav = new Blob([wavHeader({ sampleRate: 48_000, channels: 2, bits: 16, frames: 48_000 }) as BlobPart, wavSamples([left, left], 16) as BlobPart]);
    expect(await soundFacts(wav)).toEqual({ rate: 48_000, channels: 2, duration: 1, codec: "pcm" });
    const flac = createFlacEncoder({ sampleRate: 44_100, channels: 1, bits: 16 });
    const frames = flac.push([tone(44_100, 44_100, 440)]);
    const end = flac.end();
    expect(await soundFacts(new Blob([end.head as BlobPart, ...(frames as BlobPart[]), ...(end.frames as BlobPart[])]))).toEqual({ rate: 44_100, channels: 1, duration: 1, codec: "flac" });
    const ogg = new Uint8Array(64);
    ogg.set([..."OggS"].map((c) => c.charCodeAt(0)));
    ogg[26] = 1;
    ogg.set([..."OpusHead"].map((c) => c.charCodeAt(0)), 28);
    ogg[37] = 2;
    expect(await soundFacts(new Blob([ogg]))).toEqual({ rate: 48_000, channels: 2, codec: "opus" });
    // an ID3 tag of 20 bytes, then an MPEG-1 layer III frame at 44.1 kHz in joint stereo
    const mp3 = new Uint8Array([0x49, 0x44, 0x33, 4, 0, 0, 0, 0, 0, 20, ...new Array(20).fill(0), 0xff, 0xfb, 0x90, 0x44, 0, 0, 0, 0]);
    expect(await soundFacts(new Blob([mp3]))).toEqual({ rate: 44_100, channels: 2, codec: "mp3" });
});

test("in Chromium, a sound made in code comes back from each format the same, within what the format loses", async () => {
    const page = await corePage(`
        import { decodeSound, encodeSound, audioAbilities } from "${quire}/convert/audio.ts";
        import { wavHeader, wavSamples } from "${quire}/convert/wav.ts";
        const rate = 48000, frames = rate * 3;
        // a sweep rising from 200 Hz to 3 kHz on the left, so that it lines up in one place only, and 1 kHz on the right, swelling in and fading out
        const swell = (at) => Math.min(1, at / 4800, (frames - at) / 4800);
        const left = Float32Array.from({ length: frames }, (_, at) => { const t = at / rate; return 0.6 * swell(at) * Math.sin(2 * Math.PI * (200 * t + (2800 / 6) * t * t)); });
        const right = Float32Array.from({ length: frames }, (_, at) => 0.4 * swell(at) * Math.sin(2 * Math.PI * 1000 * at / rate));
        window.wav = new Blob([wavHeader({ sampleRate: rate, channels: 2, bits: 16, frames }), wavSamples([left, right], 16)]);
        const signal = new AbortController().signal;
        const back = async (blob) => new OfflineAudioContext(1, 1, rate).decodeAudioData(await blob.arrayBuffer());
        // the best lag within 4000 samples, and the ratio of the signal to what differs from it there, in decibels
        const compare = (made, original) => {
            let best = { lag: 0, score: -Infinity };
            const middle = Math.floor(original.length / 2);
            for (let lag = -4000; lag <= 4000; lag++) {
                let score = 0;
                for (let at = middle; at < middle + 6000; at++) score += original[at] * (made[at + lag] ?? 0);
                if (score > best.score) best = { lag, score };
            }
            let signal = 0, noise = 0;
            for (let at = 4800; at < original.length - 4800; at++) { const was = original[at]; const now = made[at + best.lag] ?? 0; signal += was * was; noise += (now - was) ** 2; }
            return { lag: best.lag, snr: 10 * Math.log10(signal / Math.max(noise, 1e-20)) };
        };
        // the original's samples as 16-bit WAV gives them back, for the lossless formats
        window.original = async () => { const decoded = await back(window.wav); return [decoded.getChannelData(0), decoded.getChannelData(1)]; };
        window.trial = async (format, bits = 16) => {
            const buffer = await decodeSound(window.wav, rate, 0, signal);
            const blob = await encodeSound(buffer, { format, rate: 0, channels: 0, bitrate: 128000, bits }, signal, () => {});
            const decoded = await back(blob);
            const [l, r] = await window.original();
            const most = Math.max(...[0, 1].map((channel) => { const a = decoded.getChannelData(channel), b = [l, r][channel]; let m = 0; for (let at = 0; at < b.length; at++) m = Math.max(m, Math.abs(a[at] - b[at])); return m; }));
            return { size: blob.size, type: blob.type, length: decoded.length, channels: decoded.numberOfChannels, most, left: compare(decoded.getChannelData(0), l), right: compare(decoded.getChannelData(1), r), head: [...new Uint8Array(await blob.slice(0, 4).arrayBuffer())] };
        };
        // the pitch of a channel: crossings of zero going up, a second at a time
        const pitch = (data, at, length) => { let count = 0; for (let index = at + 1; index < at + length; index++) if (data[index - 1] < 0 && data[index] >= 0) count++; return count; };
        window.resampled = async () => {
            const buffer = await decodeSound(window.wav, 44100, 0, signal);
            const mono = await decodeSound(window.wav, 48000, 1, signal);
            return { rate: buffer.sampleRate, length: buffer.length, right: pitch(buffer.getChannelData(1), 22050, 44100), monoChannels: mono.numberOfChannels, monoAt: mono.getChannelData(0)[12000], leftAt: left[12000], rightAt: right[12000] };
        };
        window.abilities = audioAbilities;
        window.decodeSound = decodeSound;
    `);
    if (!page) return console.warn("audio browser test skipped: needs a Chromium");
    try {
        const { tab } = page;
        const abilities = await tab.run<{ opus: boolean; aac: boolean }>("window.abilities()");
        const version = await tab.run<string>("navigator.userAgent");
        console.log(`audio in ${/Chrome\/[\d.]+/.exec(version)?.[0]}: Opus ${abilities.opus ? "written" : "not written"}, AAC ${abilities.aac ? "written" : "not written"}`);
        type Trial = { size: number; type: string; length: number; channels: number; most: number; left: { lag: number; snr: number }; right: { lag: number; snr: number }; head: number[] };
        // WAV and FLAC: every sample the same as the 16-bit original
        for (const format of ["wav", "flac"]) {
            const found = await tab.run<Trial>(`window.trial("${format}")`);
            console.log(`${format}: ${found.size} bytes, largest difference ${found.most}`);
            expect(found.length).toBe(144_000);
            expect(found.most).toBe(0);
        }
        const float = await tab.run<Trial>(`window.trial("wav", 32)`);
        expect(float.most).toBe(0);
        // Opus: the same tones, aligned, well above the format's noise, and the same length within a frame
        for (const format of ["opus-webm", "opus-ogg"]) {
            if (!abilities.opus) break;
            const found = await tab.run<Trial>(`window.trial("${format}")`);
            console.log(`${format}: ${found.size} bytes (${found.type}), ${found.length} samples, lag ${found.left.lag}, ${found.left.snr.toFixed(1)} dB left, ${found.right.snr.toFixed(1)} dB right`);
            expect(found.channels).toBe(2);
            expect(found.length).toBe(144_000);
            expect(Math.abs(found.left.lag)).toBeLessThanOrEqual(2);
            expect(found.left.snr).toBeGreaterThan(18);
            expect(found.right.snr).toBeGreaterThan(18);
        }
        if (abilities.aac) {
            const found = await tab.run<Trial>(`window.trial("aac-m4a")`);
            console.log(`aac-m4a: ${found.size} bytes, lag ${found.left.lag}, ${found.left.snr.toFixed(1)} dB`);
            expect(found.left.snr).toBeGreaterThan(15);
        } else {
            const said = await tab.run<string>(`window.trial("aac-m4a").then(() => "written", (error) => error.message)`);
            expect(said).toBe("This browser cannot write AAC.");
        }
        // a rate changed keeps the pitch; stereo to mono is the average of the two sides
        const resampled = await tab.run<{ rate: number; length: number; right: number; monoChannels: number; monoAt: number; leftAt: number; rightAt: number }>("window.resampled()");
        expect(resampled.rate).toBe(44_100);
        expect(resampled.length).toBe(132_300);
        expect(Math.abs(resampled.right - 1000)).toBeLessThanOrEqual(2);
        expect(resampled.monoChannels).toBe(1);
        expect(Math.abs(resampled.monoAt - (resampled.leftAt + resampled.rightAt) / 2)).toBeLessThan(0.001);
        // files made by `ffmpeg`, where it is installed, in the formats the browser reads and the converter does not write
        const ffmpeg = spawnSync("ffmpeg", ["-version"]).status === 0;
        if (!ffmpeg) console.log("ffmpeg is not installed, so MP3, AAC and Vorbis files made by it are not tried");
        else {
            const folder = await mkdtemp(join(tmpdir(), "quire-audio-"));
            try {
                for (const [name, codec] of [["tone.mp3", "libmp3lame"], ["tone.m4a", "aac"], ["tone.ogg", "libvorbis"], ["tone.flac", "flac"]] as const) {
                    const made = spawnSync("ffmpeg", ["-v", "error", "-f", "lavfi", "-i", "sine=frequency=440:sample_rate=44100:duration=2", "-c:a", codec, "-y", join(folder, name)], { timeout: 60_000 });
                    if (made.status !== 0) {
                        console.log(`ffmpeg could not make ${name}: ${made.stderr}`);
                        continue;
                    }
                    const base64 = Buffer.from(await Bun.file(join(folder, name)).arrayBuffer()).toString("base64");
                    const read = await tab.run<{ rate: number; length: number; crossings: number }>(`(async () => { const bytes = Uint8Array.from(atob("${base64}"), (c) => c.charCodeAt(0)); const b = await window.decodeSound(new Blob([bytes]), 44100, 0, new AbortController().signal); const d = b.getChannelData(0); let c = 0; for (let i = 22051; i < 66150; i++) if (d[i - 1] < 0 && d[i] >= 0) c++; return { rate: b.sampleRate, length: b.length, crossings: c }; })()`);
                    console.log(`${name}: read, ${read.length} samples, ${read.crossings} cycles a second`);
                    expect(Math.abs(read.length - 88_200)).toBeLessThan(3000);
                    expect(Math.abs(read.crossings - 440)).toBeLessThanOrEqual(2);
                }
            } finally {
                await rm(folder, { recursive: true, force: true });
            }
        }
        expect(tab.errors).toEqual([]);
    } finally {
        await page.close();
    }
}, 180_000);
