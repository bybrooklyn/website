// What the MP4 writer and reader are held to between themselves (the browser's own decoders read what is
// written in audio.test.ts and video.test.ts): samples written come back byte for byte with their times,
// lengths and key frames, the movie box comes first, an M4A has its own brand and Opus its dOps box, and
// a file with no movie box is refused in plain words.

import { expect, test } from "bun:test";
import { sourceOf } from "./bytes";
import { box, boxes, createMp4, readMp4 } from "./mp4";
import { opusHead } from "./ogg";

/** A film of samples made in code: video at 30 a second with a key frame every 15, and sound in 20 ms packets. */
function film(seconds: number) {
    const video = Array.from({ length: seconds * 30 }, (_, index) => ({ timestamp: Math.round((index * 1e6) / 30), duration: Math.round(1e6 / 30), key: index % 15 === 0, data: new Uint8Array(200 + (index % 7) * 13).fill(index & 255) }));
    const audio = Array.from({ length: seconds * 50 }, (_, index) => ({ timestamp: index * 20_000, duration: 20_000, key: true, data: new Uint8Array(80 + (index % 5)).fill((index * 3) & 255) }));
    return { video, audio };
}

const avcC = new Uint8Array([1, 0x64, 0, 0x28, 0xff, 0xe1, 0, 4, 0x67, 0x64, 0, 0x28, 1, 0, 4, 0x68, 0xee, 0x3c, 0x80]);
const asc = new Uint8Array([0x11, 0x90]);

test("MP4: samples of a film and its sound come back, byte for byte, with times, lengths and key frames, and the movie box first", async () => {
    const { video, audio } = film(3);
    const writer = createMp4([
        { kind: "video", codec: "avc1.640028", description: avcC, width: 640, height: 360 },
        { kind: "audio", codec: "mp4a.40.2", description: asc, sampleRate: 48000, channels: 2 },
    ]);
    for (let index = 0; index < video.length; index++) {
        writer.add(0, video[index]!.data, video[index]!.timestamp, video[index]!.duration, video[index]!.key);
        for (const sound of audio.filter((each) => each.timestamp >= (index * 1e6) / 30 && each.timestamp < ((index + 1) * 1e6) / 30)) writer.add(1, sound.data, sound.timestamp, sound.duration, true);
    }
    const blob = writer.end();
    const bytes = new Uint8Array(await blob.arrayBuffer());
    expect(boxes(bytes).map((each) => each.type)).toEqual(["ftyp", "moov", "mdat"]);
    const read = await readMp4(sourceOf(blob));
    expect(read.tracks.map((track) => [track.kind, track.codec, track.width ?? track.sampleRate, track.channels])).toEqual([["video", "avc1.640028", 640, undefined], ["audio", "mp4a.40.2", 48000, 2]]);
    expect(read.tracks[0]!.description).toEqual(avcC);
    expect(read.tracks[1]!.description).toEqual(asc);
    expect(read.duration).toBeCloseTo(3, 1);
    const back = [];
    for await (const sample of read.samples()) back.push(sample);
    const videoBack = back.filter((sample) => sample.track === 1);
    const audioBack = back.filter((sample) => sample.track === 2);
    expect(videoBack.map((sample) => sample.data)).toEqual(video.map((sample) => sample.data));
    expect(audioBack.map((sample) => sample.data)).toEqual(audio.map((sample) => sample.data));
    expect(videoBack.map((sample) => sample.key)).toEqual(video.map((sample) => sample.key));
    for (const [index, sample] of videoBack.entries()) expect(Math.abs(sample.timestamp - video[index]!.timestamp)).toBeLessThanOrEqual(12);
    expect(audioBack[7]!.timestamp).toBe(140_000);
    expect(audioBack[7]!.duration).toBe(20_000);
});

test("M4A: a sound alone is written with its own brand, and Opus goes in with a dOps box", async () => {
    const writer = createMp4([{ kind: "audio", codec: "opus", description: opusHead(1, 312, 48000), sampleRate: 48000, channels: 1 }], { audioOnly: true });
    writer.add(0, new Uint8Array([9, 9, 9]), 0, 20_000, true);
    const blob = writer.end();
    const bytes = new Uint8Array(await blob.arrayBuffer());
    expect(String.fromCharCode(...bytes.subarray(8, 12))).toBe("M4A ");
    const read = await readMp4(sourceOf(blob));
    expect(read.tracks[0]!.codec).toBe("opus");
    expect(read.tracks[0]!.description).toEqual(opusHead(1, 312, 48000));
    expect(box("free").length).toBe(8);
});

test("a file with no movie box is refused in plain words", async () => {
    await expect(readMp4(sourceOf(new Blob([box("ftyp", new Uint8Array(8)) as BlobPart, box("mdat", new Uint8Array(100)) as BlobPart])))).rejects.toThrow("This MP4 file has no description of its samples, so it cannot be read. It may be cut short.");
});
