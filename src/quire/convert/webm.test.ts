// What the WebM writer and reader are held to between themselves (the browser's own decoders read what
// is written in audio.test.ts and video.test.ts): samples written come back in time order, byte for
// byte, with their times, lengths and key frames, and the tracks' kinds of coding, sizes, rates and configuration;
// clusters close at key frames; laced blocks are split; and a WebM of unknown sizes, as a recording
// browser writes, is read.

import { expect, test } from "bun:test";
import { sourceOf } from "./bytes";
import { opusHead } from "./ogg";
import { createWebm, element, ID, laced, readWebm, uint } from "./webm";

/** A film of samples made in code: video at 30 a second with a key frame every 15, and sound in 20 ms packets. */
function film(seconds: number) {
    const video = Array.from({ length: seconds * 30 }, (_, index) => ({ timestamp: Math.round((index * 1e6) / 30), duration: Math.round(1e6 / 30), key: index % 15 === 0, data: new Uint8Array(200 + (index % 7) * 13).fill(index & 255) }));
    const audio = Array.from({ length: seconds * 50 }, (_, index) => ({ timestamp: index * 20_000, duration: 20_000, key: true, data: new Uint8Array(80 + (index % 5)).fill((index * 3) & 255) }));
    return { video, audio };
}

test("WebM: samples of a film and its sound come back in time order, byte for byte, with times, lengths and key frames", async () => {
    const { video, audio } = film(4);
    const writer = createWebm([
        { kind: "video", codec: "vp09.00.10.08", width: 320, height: 240 },
        { kind: "audio", codec: "opus", description: opusHead(2, 312, 48000), sampleRate: 48000, channels: 2 },
    ]);
    // given as encoders give them: the sound running a little ahead
    for (let index = 0; index < video.length; index++) {
        for (const sound of audio.filter((each) => each.timestamp >= (index * 1e6) / 30 && each.timestamp < ((index + 1) * 1e6) / 30)) writer.add(1, sound.data, sound.timestamp, sound.duration, true);
        writer.add(0, video[index]!.data, video[index]!.timestamp, video[index]!.duration, video[index]!.key);
    }
    writer.finish(1);
    const blob = writer.end();
    const read = await readWebm(sourceOf(blob));
    expect(read.tracks.map((track) => [track.kind, track.codec, track.width ?? track.sampleRate])).toEqual([["video", "vp09.00.10.08", 320], ["audio", "opus", 48000]]);
    expect(read.tracks[1]!.description).toEqual(opusHead(2, 312, 48000));
    expect(read.duration).toBeCloseTo(4, 1);
    const back = [];
    for await (const sample of read.samples()) back.push(sample);
    const videoBack = back.filter((sample) => sample.track === 1);
    const audioBack = back.filter((sample) => sample.track === 2);
    expect(videoBack.length).toBe(video.length);
    expect(audioBack.length).toBe(audio.length);
    for (const [index, sample] of videoBack.entries()) {
        expect(sample.data).toEqual(video[index]!.data);
        expect(Math.abs(sample.timestamp - video[index]!.timestamp)).toBeLessThanOrEqual(1000);
        expect(sample.key).toBe(video[index]!.key);
    }
    for (const [index, sample] of audioBack.entries()) expect(sample.data).toEqual(audio[index]!.data);
    expect(Math.abs(videoBack[10]!.duration - 33_333)).toBeLessThan(1500);
});

test("WebM: a cluster closes at a key frame after half a second, and the cues point at each cluster", async () => {
    const { video } = film(3);
    const writer = createWebm([{ kind: "video", codec: "vp8", width: 64, height: 64 }]);
    for (const sample of video) writer.add(0, sample.data, sample.timestamp, sample.duration, sample.key);
    const bytes = new Uint8Array(await writer.end().arrayBuffer());
    let clusters = 0;
    for (let at = 0; at + 4 < bytes.length; at++) if (bytes[at] === 0x1f && bytes[at + 1] === 0x43 && bytes[at + 2] === 0xb6 && bytes[at + 3] === 0x75) clusters++;
    // a key frame every half second, so one cluster each
    expect(clusters).toBe(6);
});

test("WebM: Xiph, fixed and EBML lacing are split into their frames", () => {
    const frames = [new Uint8Array(300).fill(1), new Uint8Array(20).fill(2), new Uint8Array(5).fill(3)];
    const xiph = new Uint8Array([2, 255, 45, 20, ...frames[0]!, ...frames[1]!, ...frames[2]!]);
    expect(laced(xiph, 0b010)).toEqual(frames);
    const fixed = new Uint8Array([2, ...new Uint8Array(9).fill(7)]);
    expect(laced(fixed, 0b100).map((frame) => frame.length)).toEqual([3, 3, 3]);
    // EBML: the first size as a number, the next as a signed difference (20 - 300 = -280, stored as -280 + 8191 in two bytes)
    const difference = -280 + 8191;
    const ebml = new Uint8Array([2, 0x41, 0x2c, 0x40 | (difference >> 8), difference & 255, ...frames[0]!, ...frames[1]!, ...frames[2]!]);
    expect(laced(ebml, 0b110)).toEqual(frames);
});

test("WebM: a recording of unknown sizes, as a browser writes it, is read", async () => {
    const unknown = (id: number, ...parts: Uint8Array[]) => new Uint8Array([...[id >>> 24, (id >>> 16) & 255, (id >>> 8) & 255, id & 255], 0x01, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, ...parts.flatMap((part) => [...part])]);
    const header = element(ID.EBML, new Uint8Array([...element(0x4282, new TextEncoder().encode("webm"))]));
    const tracks = element(ID.Tracks, element(ID.TrackEntry, new Uint8Array([...uint(ID.TrackNumber, 1), ...uint(ID.TrackType, 2), ...element(ID.CodecID, new TextEncoder().encode("A_OPUS")), ...element(ID.CodecPrivate, opusHead(1, 312, 48000)), ...element(ID.Audio, new Uint8Array([...element(ID.Channels, new Uint8Array([1]))]))])));
    const block = (time: number, fill: number) => element(ID.SimpleBlock, new Uint8Array([0x81, 0, time, 0x80, fill, fill]));
    const clusterOne = unknown(ID.Cluster, uint(ID.Timestamp, 0), block(0, 1), block(20, 2));
    const clusterTwo = unknown(ID.Cluster, uint(ID.Timestamp, 40), block(0, 3));
    const file = new Uint8Array([...header, ...unknown(ID.Segment, element(ID.Info, uint(ID.TimestampScale, 1_000_000)), tracks, clusterOne, clusterTwo)]);
    const read = await readWebm(sourceOf(new Blob([file])));
    expect(read.tracks[0]!.codec).toBe("opus");
    const back = [];
    for await (const sample of read.samples()) back.push([sample.timestamp, sample.data[0]]);
    expect(back).toEqual([[0, 1], [20_000, 2], [40_000, 3]]);
});
