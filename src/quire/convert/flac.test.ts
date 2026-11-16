// What the FLAC encoder is held to: exact. A sound made in code (sines, a sweep, noise, silence and a
// full-scale square, in turns on each channel) at 44100 and 48000, mono, stereo and six channels, 16
// and 24 bits, fed in blocks of uneven length, is decoded by the reference `flac` tool (where it is
// installed, which checks every CRC and the MD5 too) and by Chromium's own decodeAudioData, and both
// give back the same integers. The frame header's CRC-8 and the frame's CRC-16 match the standard's
// check values, and a stream of no samples is still a FLAC file.

import { expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { corePage, quire } from "../../../scripts/core-page";
import { crc16, crc8, createFlacEncoder } from "./flac";
import { readWav, toInteger } from "./wav";

/** The sound made in code, written once as plain script so that Bun and the browser make the same one: on each channel, half second turns of sines, a sweep, noise, silence and a full-scale square, each channel a turn behind the one before. */
const SOUND = `function sound(rate, channels, seconds) {
    let seed = 12345;
    const noise = () => ((seed = (seed * 1103515245 + 12345) >>> 0) / 2 ** 32) * 2 - 1;
    const frames = Math.round(rate * seconds);
    const turn = Math.round(rate * 0.5);
    return Array.from({ length: channels }, (_, channel) => Float32Array.from({ length: frames }, (_, at) => {
        const t = at / rate;
        const kind = (Math.floor(at / turn) + channel) % 5;
        if (kind === 0) return 0.3 * Math.sin(2 * Math.PI * 220 * t) + 0.2 * Math.sin(2 * Math.PI * 1234.5 * t) + 0.1 * Math.sin(2 * Math.PI * 7040 * t);
        if (kind === 1) return 0.7 * Math.sin(2 * Math.PI * (40 * t + 4000 * t * t));
        if (kind === 2) return 0.5 * noise();
        if (kind === 3) return 0;
        return Math.sin(2 * Math.PI * 100 * t) >= 0 ? 1 : -1;
    }));
}`;
const sound = new Function(`${SOUND}; return sound;`)() as (rate: number, channels: number, seconds: number) => Float32Array[];

/** Encodes a sound fed in blocks of uneven length, and gives the whole file. */
function encoded(planar: Float32Array[], rate: number, bits: 16 | 24): Uint8Array {
    const flac = createFlacEncoder({ sampleRate: rate, channels: planar.length, bits });
    const parts: Uint8Array[] = [];
    const frames = planar[0]!.length;
    for (let at = 0, step = 1000; at < frames; at += step, step = step === 1000 ? 7777 : 1000) parts.push(...flac.push(planar.map((each) => each.subarray(at, Math.min(frames, at + step)))));
    const { head, frames: last } = flac.end();
    const all = [head, ...parts, ...last];
    const out = new Uint8Array(all.reduce((sum, part) => sum + part.length, 0));
    all.reduce((at, part) => (out.set(part, at), at + part.length), 0);
    return out;
}

const CASES: [number, number, 16 | 24][] = [
    [44100, 1, 16],
    [44100, 2, 16],
    [48000, 2, 24],
    [48000, 6, 16],
    [48000, 6, 24],
    [44100, 2, 24],
];

test("the CRCs are the standard's: CRC-8 of 123456789 is 0xF4, CRC-16 of it 0xFEE8", () => {
    const digits = new TextEncoder().encode("123456789");
    expect(crc8(digits)).toBe(0xf4);
    expect(crc16(digits)).toBe(0xfee8);
});

test("a stream of no samples is still a FLAC file of its head alone", () => {
    const { head, frames } = createFlacEncoder({ sampleRate: 48000, channels: 2, bits: 16 }).end();
    expect(frames.length).toBe(0);
    expect(new TextDecoder().decode(head.subarray(0, 4))).toBe("fLaC");
    expect(head.length).toBe(42);
    expect(() => createFlacEncoder({ sampleRate: 48000, channels: 9, bits: 16 })).toThrow("FLAC holds one to eight channels.");
});

const flacTool = Bun.which("flac");
test(flacTool ? "the reference flac tool decodes every sound, passes its CRCs and MD5, and gives back the same integers" : "the reference flac tool is not installed here, so this check did not run", async () => {
    if (!flacTool) return;
    const folder = await mkdtemp(join(tmpdir(), "quire-flac-"));
    try {
        for (const [rate, channels, bits] of CASES) {
            const planar = sound(rate, channels, 2.7);
            const file = encoded(planar, rate, bits);
            await Bun.write(`${folder}/sound.flac`, file);
            const tested = Bun.spawnSync([flacTool, "-t", "-s", `${folder}/sound.flac`]);
            expect(tested.stderr.toString()).toBe("");
            expect(tested.exitCode).toBe(0);
            const decoded = Bun.spawnSync([flacTool, "-d", "-f", "-s", "-o", `${folder}/sound.wav`, `${folder}/sound.flac`]);
            expect(decoded.exitCode).toBe(0);
            const read = readWav(new Uint8Array(await Bun.file(`${folder}/sound.wav`).arrayBuffer()));
            expect(read.sampleRate).toBe(rate);
            expect(read.channels.length).toBe(channels);
            for (let channel = 0; channel < channels; channel++) {
                const got = read.channels[channel]!;
                expect(got.length).toBe(planar[0]!.length);
                let wrong = 0;
                for (let at = 0; at < got.length; at++) if (Math.round(got[at]! * 2 ** (bits - 1)) !== toInteger(planar[channel]![at]!, bits)) wrong++;
                expect(wrong).toBe(0);
            }
        }
    } finally {
        await rm(folder, { recursive: true, force: true });
    }
}, 120_000);

test("in Chromium, decodeAudioData reads every sound and gives back the same integers", async () => {
    const page = await corePage(`
        import { createFlacEncoder } from "${quire}/convert/flac.ts";
        import { toInteger } from "${quire}/convert/wav.ts";
        ${SOUND}
        window.check = async (cases) => {
            const report = [];
            for (const [rate, channels, bits] of cases) {
                const planar = sound(rate, channels, 2.7);
                const flac = createFlacEncoder({ sampleRate: rate, channels, bits });
                const parts = [];
                for (let at = 0; at < planar[0].length; at += 3001) parts.push(...flac.push(planar.map((each) => each.subarray(at, at + 3001))));
                const { head, frames } = flac.end();
                const bytes = await new Blob([head, ...parts, ...frames]).arrayBuffer();
                const decoded = await new OfflineAudioContext(channels, planar[0].length, rate).decodeAudioData(bytes);
                let wrong = 0;
                for (let c = 0; c < channels; c++) {
                    const got = decoded.getChannelData(c);
                    for (let at = 0; at < got.length; at++) {
                        // Chromium scales a positive 16 bit integer by the largest one and a negative by the smallest; 24 bits by 2 to the 23 both ways
                        const whole = got[at] > 0 && bits === 16 ? Math.round(got[at] * 32767) : Math.round(got[at] * 2 ** (bits - 1));
                        if (whole !== toInteger(planar[c][at], bits)) wrong++;
                    }
                }
                report.push({ rate, channels, bits, frames: decoded.length, want: planar[0].length, got: decoded.numberOfChannels, wrong });
            }
            return report;
        };
    `);
    if (!page) return;
    try {
        const report = await page.tab.run<{ channels: number; frames: number; want: number; got: number; wrong: number }[]>(`window.check(${JSON.stringify(CASES)})`);
        expect(report.length).toBe(CASES.length);
        for (const each of report) {
            expect(each.got).toBe(each.channels);
            expect(each.frames).toBe(each.want);
            expect(each.wrong).toBe(0);
        }
    } finally {
        await page.close();
    }
}, 120_000);
