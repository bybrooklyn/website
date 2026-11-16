// What the WAV reader and writer are held to: a sound written at 16, 24 and 32 bits and as float reads
// back within the step of its bits; 8 bit and 64 bit float files read; other kinds of coding, and a sound too big
// for WAV, refused in plain words; and in Chromium, the browser's own decodeAudioData reads what was
// written, mono, stereo and six channels, giving the same integers (it scales positive 16 bit samples by
// the largest integer and negative ones by the smallest, so they are turned back the same way).

import { expect, test } from "bun:test";
import { corePage, quire } from "../../../scripts/core-page";
import { readWav, toInteger, wavHeader, wavSamples } from "./wav";

const tone = (frames: number, channel: number) => Float32Array.from({ length: frames }, (_, at) => 0.8 * Math.sin((at * (channel + 1) * 2 * Math.PI * 440) / 48000) + (at % 97 === 0 ? 0.3 : 0));
const fileOf = (planar: Float32Array[], bits: 16 | 24 | 32, float = false) => {
    const header = wavHeader({ sampleRate: 48000, channels: planar.length, bits, float, frames: planar[0]!.length });
    // written in two blocks, as the page writes a long sound
    const half = Math.floor(planar[0]!.length / 2);
    const first = wavSamples(planar.map((each) => each.subarray(0, half)), bits, float);
    const second = wavSamples(planar.map((each) => each.subarray(half)), bits, float);
    const out = new Uint8Array(header.length + first.length + second.length);
    out.set(header, 0);
    out.set(first, header.length);
    out.set(second, header.length + first.length);
    return out;
};

test("a sound written at 16, 24 and 32 bits and as float reads back exactly (32 bit integers within what a Float32Array holds), in mono, stereo and six channels", () => {
    for (const channels of [1, 2, 6]) {
        const planar = Array.from({ length: channels }, (_, channel) => tone(4801, channel));
        for (const [bits, float] of [[16, false], [24, false], [32, false], [32, true]] as const) {
            const read = readWav(fileOf(planar, bits, float));
            expect(read.sampleRate).toBe(48000);
            expect(read.channels.length).toBe(channels);
            for (let channel = 0; channel < channels; channel++) {
                expect(read.channels[channel]!.length).toBe(4801);
                for (let at = 0; at < 4801; at++) {
                    const want = planar[channel]![at]!;
                    if (float) expect(read.channels[channel]![at]).toBe(want);
                    // 32 bit integers come back as Float32Array samples, which hold 24 bits of them
                    else if (bits === 32) expect(Math.abs(read.channels[channel]![at]! * 2 ** 31 - toInteger(want, 32))).toBeLessThanOrEqual(128);
                    else expect(Math.round(read.channels[channel]![at]! * 2 ** (bits - 1))).toBe(toInteger(want, bits));
                }
            }
        }
    }
});

test("the rounding holds samples inside the range: full scale up is the largest integer, down the smallest", () => {
    expect(toInteger(1, 16)).toBe(32767);
    expect(toInteger(-1, 16)).toBe(-32768);
    expect(toInteger(2, 24)).toBe(8388607);
    expect(toInteger(Number.NaN, 16)).toBe(0);
    expect(toInteger(0.5, 16)).toBe(16384);
});

test("8 bit and 64 bit float files are read, and other codings are refused in plain words", () => {
    const made = (coding: number, bits: number, body: number[]) => {
        const align = bits / 8;
        const out = new Uint8Array(44 + body.length);
        const view = new DataView(out.buffer);
        out.set(new TextEncoder().encode("RIFF"), 0);
        view.setUint32(4, 36 + body.length, true);
        out.set(new TextEncoder().encode("WAVEfmt "), 8);
        view.setUint32(16, 16, true);
        view.setUint16(20, coding, true);
        view.setUint16(22, 1, true);
        view.setUint32(24, 8000, true);
        view.setUint32(28, 8000 * align, true);
        view.setUint16(32, align, true);
        view.setUint16(34, bits, true);
        out.set(new TextEncoder().encode("data"), 36);
        view.setUint32(40, body.length, true);
        out.set(body, 44);
        return out;
    };
    expect([...readWav(made(1, 8, [0, 128, 255])).channels[0]!]).toEqual([-1, 0, 127 / 128]);
    const doubles = new Uint8Array(new Float64Array([0.25, -0.5]).buffer);
    expect([...readWav(made(3, 64, [...doubles])).channels[0]!]).toEqual([0.25, -0.5]);
    expect(() => readWav(made(2, 4, [0, 0]))).toThrow("This WAV file's sound is compressed in a way that is not read here. Only plain PCM and float samples are.");
    expect(() => readWav(made(1, 12, [0, 0]))).toThrow("This WAV file holds 12 bit samples, which are not read here.");
    expect(() => readWav(new TextEncoder().encode("hello, this is text"))).toThrow("This is not a WAV file.");
    expect(() => wavHeader({ sampleRate: 192000, channels: 8, bits: 32, frames: 192000 * 3600 })).toThrow("This sound is too long for a WAV file, which holds at most 4 GB. Choose FLAC, or fewer channels, or a lower rate.");
});

test("in Chromium, decodeAudioData reads the WAV files written here and gives the same integers", async () => {
    const page = await corePage(`
        import { wavHeader, wavSamples, toInteger } from "${quire}/convert/wav.ts";
        window.check = async () => {
            const report = [];
            for (const [channels, bits, float] of [[1, 16, false], [2, 16, false], [2, 24, false], [6, 24, false], [2, 32, true], [6, 16, false]]) {
                const frames = 9001;
                const planar = Array.from({ length: channels }, (_, c) => Float32Array.from({ length: frames }, (_, at) => 0.9 * Math.sin(at * (c + 1) * 0.0571) * (at % 1000 < 500 ? 1 : 0.2)));
                const head = wavHeader({ sampleRate: 48000, channels, bits, float, frames });
                const body = wavSamples(planar, bits, float);
                const bytes = new Uint8Array(head.length + body.length);
                bytes.set(head); bytes.set(body, head.length);
                const context = new OfflineAudioContext(channels, frames, 48000);
                const sound = await context.decodeAudioData(bytes.buffer);
                let worst = 0;
                for (let c = 0; c < channels; c++) {
                    const got = sound.getChannelData(c);
                    for (let at = 0; at < frames; at++) {
                        // Chromium scales a positive 16 bit integer by the largest one and a negative by the smallest, so it is turned back the same way; 24 bits by 2 to the 23 both ways
                        const whole = got[at] > 0 && bits === 16 ? Math.round(got[at] * (2 ** (bits - 1) - 1)) : Math.round(got[at] * 2 ** (bits - 1));
                        const off = float ? Math.abs(got[at] - planar[c][at]) : Math.abs(whole - toInteger(planar[c][at], bits));
                        if (off > worst) worst = off;
                    }
                }
                report.push({ channels, bits, float, frames: sound.length, rate: sound.sampleRate, got: sound.numberOfChannels, worst });
            }
            return report;
        };
    `);
    if (!page) return;
    try {
        const report = await page.tab.run<{ channels: number; frames: number; rate: number; got: number; worst: number }[]>("window.check()");
        expect(report.length).toBe(6);
        for (const each of report) {
            expect(each.got).toBe(each.channels);
            expect(each.frames).toBe(9001);
            expect(each.rate).toBe(48000);
            expect(each.worst).toBe(0);
        }
    } finally {
        await page.close();
    }
}, 60_000);
