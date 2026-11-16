// MP4 (and M4A, and QuickTime's .mov, which shares its boxes) read and written by hand, for the
// converter's sounds and films (ISO/IEC 14496-12 and -14, with the codec boxes of 14496-15 for H.264,
// the VP9 and AV1 bindings, and Opus in ISOBMFF). Writing gathers each sample's place and length while
// the samples go out as blobs, then puts the movie box first (so a player can start before the whole
// file has come), each sample its own chunk with 64-bit offsets, so its size is known before the
// offsets are. Reading walks the top-level boxes a header at a time, reads only the movie box whole,
// builds each track's table of samples (where, how long, when, which are key frames) and then reads
// the samples in the order they are stored, each a slice of the file.
//
//   writer = createMp4([{ kind: "video", codec: "avc1.640028", description: avcC, width: 1280, height: 720 }]);
//   writer.add(0, bytes, timestampMicroseconds, durationMicroseconds, isKey); blob = writer.end();
//   film = await readMp4(sourceOf(file)); for await (sample of film.samples()) ...

import { Bytes, joined, textOf, viewOf, type Source } from "./bytes";
import { opusHead } from "./ogg";
import { aacCodec, av1CFrom, av1Codec, avcCodec, codecLabel, vp9Codec, vpcCFrom, type Demuxed, type Sample, type Track } from "./tracks";
import type { TrackOut } from "./webm";

// ---- writing ----

/** A box: its size, its type, its body. */
export function box(type: string, ...body: Uint8Array[]): Uint8Array {
    const inside = joined(body);
    const out = new Bytes().u32(8 + inside.length).text(type).bytes(inside);
    return out.done();
}

/** A full box: a box whose body starts with a version and flags. */
export function fullBox(type: string, version: number, flags: number, ...body: Uint8Array[]): Uint8Array {
    return box(type, new Bytes().u8(version).u24(flags).done(), ...body);
}

/** The identity matrix of a track or movie header, in 16.16 and 2.30 fixed point. */
const MATRIX = new Bytes().u32(0x00010000).u32(0).u32(0).u32(0).u32(0x00010000).u32(0).u32(0).u32(0).u32(0x40000000).done();

/** An MPEG-4 descriptor: its tag, its size in four bytes of seven bits each, its body. */
function descriptor(tag: number, ...body: Uint8Array[]): Uint8Array {
    const inside = joined(body);
    const size = inside.length;
    return new Bytes().u8(tag).u8(0x80 | ((size >> 21) & 0x7f)).u8(0x80 | ((size >> 14) & 0x7f)).u8(0x80 | ((size >> 7) & 0x7f)).u8(size & 0x7f).bytes(inside).done();
}

/** The esds box of AAC: the elementary stream descriptor holding the AudioSpecificConfig. */
function esds(config: Uint8Array, bitrate: number): Uint8Array {
    const decoderConfig = descriptor(0x04, new Bytes().u8(0x40).u8(0x15).u24(0).u32(bitrate).u32(bitrate).done(), descriptor(0x05, config));
    return fullBox("esds", 0, 0, descriptor(0x03, new Bytes().u16(1).u8(0).done(), decoderConfig, descriptor(0x06, new Uint8Array([2]))));
}

/** The dOps box of Opus in MP4, made from an OpusHead (its numbers turned big-endian, as the binding says). */
export function dOpsFrom(head: Uint8Array): Uint8Array {
    const view = viewOf(head);
    return box("dOps", new Bytes().u8(0).u8(head[9]!).u16(view.getUint16(10, true)).u32(view.getUint32(12, true)).i16(view.getInt16(16, true)).u8(head[18] ?? 0).done());
}

/** An OpusHead made from a dOps box's body, for the browser's decoder. */
export function opusHeadFrom(dOps: Uint8Array): Uint8Array {
    const view = viewOf(dOps);
    return new Bytes().text("OpusHead").u8(1).u8(dOps[1]!).u16(view.getUint16(2), true).u32(view.getUint32(4), true).u16(view.getUint16(8), true).u8(dOps[10] ?? 0).done();
}

/** The sample entry of a track: what codec its samples are in, and the codec's own box. */
function sampleEntry(track: TrackOut, bitrate: number): Uint8Array {
    const { codec, description } = track;
    if (track.kind === "video") {
        const visual = (type: string, config: Uint8Array) =>
            box(type, new Bytes().u32(0).u16(0).u16(1).u16(0).u16(0).u32(0).u32(0).u32(0).u16(track.width ?? 0).u16(track.height ?? 0).u32(0x00480000).u32(0x00480000).u32(0).u16(1).bytes(new Uint8Array(32)).u16(0x0018).i16(-1).done(), config);
        if (codec.startsWith("avc1")) {
            if (!description) throw new Error("H.264 needs its configuration to be written into MP4.");
            return visual("avc1", box("avcC", description));
        }
        if (codec.startsWith("vp09")) return visual("vp09", box("vpcC", vpcCFrom(codec)));
        if (codec.startsWith("av01")) return visual("av01", box("av1C", description?.length ? description : av1CFrom(codec)));
        throw new Error(`${codecLabel(codec)} cannot be written into MP4 here.`);
    }
    const rate = track.sampleRate ?? 48000;
    const audio = (type: string, config: Uint8Array) => box(type, new Bytes().u32(0).u16(0).u16(1).u32(0).u32(0).u16(track.channels ?? 2).u16(16).u16(0).u16(0).u32((rate >= 65536 ? 0 : rate) * 65536).done(), config);
    if (codec.startsWith("mp4a")) {
        if (!description) throw new Error("AAC needs its configuration to be written into MP4.");
        return audio("mp4a", esds(description, bitrate));
    }
    if (codec === "opus") return audio("Opus", dOpsFrom(description?.length ? description : opusHead(track.channels ?? 2, 312, rate)));
    throw new Error(`${codecLabel(codec)} cannot be written into MP4 here.`);
}

/** Runs of equal values, as stts and ctts keep them: each a count and the value. */
function runs(values: number[]): [number, number][] {
    const out: [number, number][] = [];
    for (const value of values) {
        const last = out.at(-1);
        if (last && last[1] === value) last[0]++;
        else out.push([1, value]);
    }
    return out;
}

/** A writer of MP4, sample by sample, for up to one video and one audio track; `audioOnly` makes an M4A. */
export function createMp4(tracks: TrackOut[], options: { audioOnly?: boolean } = {}) {
    const parts: BlobPart[] = [];
    let mdatSize = 0;
    // video in 90 kHz ticks, as is usual; sound in its own samples
    const scales = tracks.map((track) => (track.kind === "video" ? 90_000 : (track.sampleRate ?? 48000)));
    const tables = tracks.map(() => ({ offsets: [] as number[], sizes: [] as number[], times: [] as number[], durations: [] as number[], keys: [] as boolean[], composition: [] as number[] }));
    const bitrates = tracks.map(() => 0);
    return {
        /** Adds one encoded sample to a track (numbered from 0), its time and length in microseconds. */
        add(index: number, data: Uint8Array, timestamp: number, duration: number, key: boolean) {
            const table = tables[index]!;
            table.offsets.push(mdatSize);
            table.sizes.push(data.length);
            table.times.push(Math.round((timestamp * scales[index]!) / 1e6));
            table.durations.push(Math.max(0, Math.round((duration * scales[index]!) / 1e6)));
            table.keys.push(key);
            parts.push(new Blob([data as BlobPart]));
            mdatSize += data.length;
        },
        /** How many bytes are written so far, for the bar. */
        size: () => mdatSize,
        /** Closes the file: the movie box made now and put first, then the samples. */
        end(): Blob {
            const ftyp = options.audioOnly ? box("ftyp", new Bytes().text("M4A ").u32(0x200).text("M4A ").text("isom").text("iso2").done()) : box("ftyp", new Bytes().text("isom").u32(0x200).text("isom").text("iso2").text("avc1").text("mp41").done());
            const durationOf = (index: number) => {
                const table = tables[index]!;
                if (!table.times.length) return 0;
                const last = table.times.length - 1;
                return table.times[last]! + (table.durations[last] || 0) - table.times[0]!;
            };
            const movieDuration = Math.max(0, ...tracks.map((_, index) => (durationOf(index) / scales[index]!) * 1000));
            const traks = (offset: number) =>
                tracks.map((track, index) => {
                    const table = tables[index]!;
                    const scale = scales[index]!;
                    // each sample lasts until the next one starts; the last keeps its own length
                    const durations = table.times.map((time, at) => (at + 1 < table.times.length ? Math.max(0, table.times[at + 1]! - time) : table.durations[at] || (at ? table.times[at]! - table.times[at - 1]! : 0)));
                    const seconds = durationOf(index) / scale;
                    bitrates[index] = seconds ? Math.round((table.sizes.reduce((sum, size) => sum + size, 0) * 8) / seconds) : 0;
                    const stts = runs(durations);
                    const sttsBody = new Bytes().u32(stts.length);
                    for (const [count, delta] of stts) sttsBody.u32(count).u32(delta);
                    const stszBody = new Bytes().u32(0).u32(table.sizes.length);
                    for (const size of table.sizes) stszBody.u32(size);
                    const co64Body = new Bytes().u32(table.offsets.length);
                    for (const at of table.offsets) co64Body.u64(offset + at);
                    const stbl = [fullBox("stsd", 0, 0, new Bytes().u32(1).done(), sampleEntry(track, bitrates[index]!)), fullBox("stts", 0, 0, sttsBody.done()), fullBox("stsc", 0, 0, new Bytes().u32(1).u32(1).u32(1).u32(1).done()), fullBox("stsz", 0, 0, stszBody.done()), fullBox("co64", 0, 0, co64Body.done())];
                    if (table.keys.some((key) => !key)) {
                        const keys = table.keys.flatMap((key, at) => (key ? [at + 1] : []));
                        const stss = new Bytes().u32(keys.length);
                        for (const at of keys) stss.u32(at);
                        stbl.splice(2, 0, fullBox("stss", 0, 0, stss.done()));
                    }
                    const video = track.kind === "video";
                    const header = fullBox("mdhd", 0, 0, new Bytes().u32(0).u32(0).u32(scale).u32(durationOf(index)).u16(0x55c4).u16(0).done());
                    const handler = fullBox("hdlr", 0, 0, new Bytes().u32(0).text(video ? "vide" : "soun").u32(0).u32(0).u32(0).text(video ? "Video" : "Sound").u8(0).done());
                    const media = video ? fullBox("vmhd", 0, 1, new Bytes().u16(0).u16(0).u16(0).u16(0).done()) : fullBox("smhd", 0, 0, new Bytes().u16(0).u16(0).done());
                    const dinf = box("dinf", fullBox("dref", 0, 0, new Bytes().u32(1).done(), fullBox("url ", 0, 1)));
                    const tkhd = fullBox("tkhd", 0, 3, new Bytes().u32(0).u32(0).u32(index + 1).u32(0).u32(Math.round((durationOf(index) / scale) * 1000)).u32(0).u32(0).u16(0).u16(video ? 0 : 1).u16(video ? 0 : 0x0100).u16(0).bytes(MATRIX).u32((track.width ?? 0) * 65536).u32((track.height ?? 0) * 65536).done());
                    return box("trak", tkhd, box("mdia", header, handler, box("minf", media, dinf, box("stbl", ...stbl))));
                });
            const mvhd = fullBox("mvhd", 0, 0, new Bytes().u32(0).u32(0).u32(1000).u32(Math.round(movieDuration)).u32(0x00010000).u16(0x0100).u16(0).u32(0).u32(0).bytes(MATRIX).bytes(new Uint8Array(24)).u32(tracks.length + 1).done());
            // the movie box's size does not hang on the offsets (each is eight bytes), so it is made once to be measured and again with them
            const moovSize = box("moov", mvhd, ...traks(0)).length;
            const mdatHead = new Bytes().u32(1).text("mdat").u64(16 + mdatSize).done();
            const moov = box("moov", mvhd, ...traks(ftyp.length + moovSize + mdatHead.length));
            return new Blob([ftyp as BlobPart, moov as BlobPart, mdatHead as BlobPart, ...parts], { type: options.audioOnly ? "audio/mp4" : "video/mp4" });
        },
    };
}

// ---- reading ----

/** The boxes inside some bytes held in memory: each one's type and body. */
export function boxes(bytes: Uint8Array): { type: string; body: Uint8Array }[] {
    const out: { type: string; body: Uint8Array }[] = [];
    const view = viewOf(bytes);
    let at = 0;
    while (at + 8 <= bytes.length) {
        let size = view.getUint32(at);
        let head = 8;
        if (size === 1) {
            if (at + 16 > bytes.length) break;
            size = Number(view.getBigUint64(at + 8));
            head = 16;
        } else if (size === 0) size = bytes.length - at;
        if (size < head || at + size > bytes.length) break;
        out.push({ type: textOf(bytes, at + 4, at + 8), body: bytes.subarray(at + head, at + size) });
        at += size;
    }
    return out;
}

const child = (bytes: Uint8Array | undefined, type: string) => (bytes ? boxes(bytes).find((each) => each.type === type)?.body : undefined);
const path = (bytes: Uint8Array | undefined, ...types: string[]) => types.reduce<Uint8Array | undefined>((at, type) => child(at, type), bytes);

/** The AudioSpecificConfig inside an esds box's body, and the object type it was declared with. */
function esdsConfig(esds: Uint8Array): { object: number; config?: Uint8Array } {
    let at = 4;
    let object = 0x40;
    let config: Uint8Array | undefined;
    const sizeAt = () => {
        let size = 0;
        for (let index = 0; index < 4; index++) {
            const byte = esds[at++]!;
            size = (size << 7) | (byte & 0x7f);
            if (!(byte & 0x80)) break;
        }
        return size;
    };
    while (at < esds.length) {
        const tag = esds[at++]!;
        const size = sizeAt();
        if (tag === 0x03) {
            const flags = esds[at + 2]!;
            at += 3 + (flags & 0x80 ? 2 : 0) + (flags & 0x40 ? 1 + esds[at + 3]! : 0) + (flags & 0x20 ? 2 : 0);
        } else if (tag === 0x04) {
            object = esds[at]!;
            at += 13;
        } else if (tag === 0x05) {
            config = esds.slice(at, at + size);
            at += size;
        } else at += size;
    }
    return { object, config };
}

/** One track's samples as its tables say: where each is, how long it is, when it is, and whether it is key. */
interface Table {
    track: Track;
    scale: number;
    offsets: number[];
    sizes: number[];
    times: number[];
    durations: number[];
    keys: Set<number> | undefined;
}

/** Reads an MP4, M4A or QuickTime file: its tracks and length first, then its samples as they are asked for. */
export async function readMp4(source: Source): Promise<Demuxed> {
    // the top-level boxes, a header at a time, to find the movie box wherever it is
    let moov: Uint8Array | undefined;
    let at = 0;
    while (at + 8 <= source.size) {
        const head = await source.read(at, 16);
        const view = viewOf(head);
        let size = view.getUint32(0);
        const type = textOf(head, 4, 8);
        let start = 8;
        if (size === 1) {
            size = Number(view.getBigUint64(8));
            start = 16;
        } else if (size === 0) size = source.size - at;
        if (size < 8) break;
        if (type === "moov") {
            if (size > 512 * 1024 * 1024) throw new Error("This file's description of its samples is too large to read.");
            moov = await source.read(at + start, size - start);
            break;
        }
        at += size;
    }
    if (!moov) throw new Error("This MP4 file has no description of its samples, so it cannot be read. It may be cut short.");
    const tables: Table[] = [];
    for (const trak of boxes(moov).filter((each) => each.type === "trak")) {
        const mdia = child(trak.body, "mdia");
        const handler = textOf(path(mdia, "hdlr") ?? new Uint8Array(12), 8, 12);
        if (handler !== "vide" && handler !== "soun") continue;
        const mdhd = path(mdia, "mdhd")!;
        const mdhdView = viewOf(mdhd);
        const scale = mdhd[0] === 1 ? mdhdView.getUint32(20) : mdhdView.getUint32(12);
        const mediaDuration = mdhd[0] === 1 ? Number(mdhdView.getBigUint64(24)) : mdhdView.getUint32(16);
        const tkhd = path(trak.body, "tkhd")!;
        const id = viewOf(tkhd).getUint32(tkhd[0] === 1 ? 20 : 12);
        const stbl = path(mdia, "minf", "stbl");
        const stsd = path(stbl, "stsd");
        if (!stbl || !stsd) continue;
        const entry = boxes(stsd.subarray(8))[0];
        if (!entry) continue;
        let track: Track;
        if (handler === "vide") {
            const width = viewOf(entry.body).getUint16(24);
            const height = viewOf(entry.body).getUint16(26);
            const inner = entry.body.subarray(78);
            let codec = entry.type;
            let description: Uint8Array | undefined;
            if (entry.type === "avc1" || entry.type === "avc3") {
                description = child(inner, "avcC")?.slice();
                codec = description ? avcCodec(description) : "avc1.42001f";
            } else if (entry.type === "vp09") {
                const vpcC = child(inner, "vpcC");
                codec = vpcC ? vp9Codec(vpcC) : "vp09.00.10.08";
            } else if (entry.type === "av01") {
                description = child(inner, "av1C")?.slice();
                codec = description ? av1Codec(description) : "av01.0.08M.08";
            } else if (entry.type === "hvc1" || entry.type === "hev1") {
                description = child(inner, "hvcC")?.slice();
                codec = `${entry.type}.1.6.L93.B0`;
            }
            track = { id, kind: "video", codec, ...(description ? { description } : {}), width, height, duration: mediaDuration / scale, label: codecLabel(codec) };
        } else {
            const view = viewOf(entry.body);
            const version = view.getUint16(8);
            const channels = view.getUint16(16);
            const rate = view.getUint32(24) >>> 16 || scale;
            // QuickTime's sound entries of version 1 and 2 carry more fields before their boxes
            const inner = entry.body.subarray(28 + (version === 1 ? 16 : version === 2 ? 36 : 0));
            let codec = entry.type;
            let description: Uint8Array | undefined;
            if (entry.type === "mp4a") {
                const found = esdsConfig(child(inner, "esds") ?? new Uint8Array());
                if (found.object === 0x6b || found.object === 0x69) codec = "mp3";
                else {
                    description = found.config;
                    codec = aacCodec(found.config);
                }
            } else if (entry.type === "Opus") {
                const dOps = child(inner, "dOps");
                codec = "opus";
                if (dOps) description = opusHeadFrom(dOps);
            } else if (entry.type === "fLaC") {
                const dfLa = child(inner, "dfLa");
                codec = "flac";
                if (dfLa) description = joined([new TextEncoder().encode("fLaC"), dfLa.subarray(4)]);
            } else if (entry.type === ".mp3") codec = "mp3";
            else if (entry.type === "ulaw") codec = "ulaw";
            else if (entry.type === "alaw") codec = "alaw";
            track = { id, kind: "audio", codec, ...(description ? { description } : {}), sampleRate: rate, channels, duration: mediaDuration / scale, label: codecLabel(codec) };
        }
        // the sample table: sizes, chunks and their offsets, times, key frames, composition offsets
        const stsz = viewOf(path(stbl, "stsz") ?? new Uint8Array(12));
        const count = stsz.getUint32(8);
        const fixed = stsz.getUint32(4);
        const sizes = Array.from({ length: count }, (_, index) => fixed || stsz.getUint32(12 + index * 4));
        const stco = path(stbl, "stco");
        const co64 = path(stbl, "co64");
        const chunkOffsets: number[] = stco ? Array.from({ length: viewOf(stco).getUint32(4) }, (_, index) => viewOf(stco).getUint32(8 + index * 4)) : co64 ? Array.from({ length: viewOf(co64).getUint32(4) }, (_, index) => Number(viewOf(co64).getBigUint64(8 + index * 8))) : [];
        const stsc = viewOf(path(stbl, "stsc") ?? new Uint8Array(8));
        const runsOf = Array.from({ length: stsc.getUint32(4) }, (_, index) => ({ first: stsc.getUint32(8 + index * 12), per: stsc.getUint32(12 + index * 12) }));
        const offsets: number[] = [];
        let sample = 0;
        for (let chunk = 0; chunk < chunkOffsets.length && sample < count; chunk++) {
            const run = [...runsOf].reverse().find((each) => each.first <= chunk + 1);
            let place = chunkOffsets[chunk]!;
            for (let index = 0; index < (run?.per ?? 1) && sample < count; index++) {
                offsets.push(place);
                place += sizes[sample]!;
                sample++;
            }
        }
        const stts = viewOf(path(stbl, "stts") ?? new Uint8Array(8));
        const times: number[] = [];
        const durations: number[] = [];
        let time = 0;
        for (let index = 0; index < stts.getUint32(4); index++) {
            const runCount = stts.getUint32(8 + index * 8);
            const delta = stts.getUint32(12 + index * 8);
            for (let each = 0; each < runCount && times.length < count; each++) {
                times.push(time);
                durations.push(delta);
                time += delta;
            }
        }
        const ctts = path(stbl, "ctts");
        if (ctts) {
            const view = viewOf(ctts);
            let index = 0;
            for (let entryAt = 0; entryAt < view.getUint32(4); entryAt++) {
                const runCount = view.getUint32(8 + entryAt * 8);
                const shift = ctts[0] === 1 ? view.getInt32(12 + entryAt * 8) : view.getUint32(12 + entryAt * 8);
                for (let each = 0; each < runCount && index < times.length; each++) times[index++]! += shift;
            }
        }
        const stss = path(stbl, "stss");
        const keys = stss ? new Set(Array.from({ length: viewOf(stss).getUint32(4) }, (_, index) => viewOf(stss).getUint32(8 + index * 4) - 1)) : undefined;
        tables.push({ track, scale, offsets, sizes, times: times.slice(0, offsets.length), durations, keys });
    }
    const duration = Math.max(0, ...tables.map((table) => table.track.duration ?? 0));
    return {
        tracks: tables.map((table) => table.track),
        duration,
        async *samples(signal?: AbortSignal): AsyncGenerator<Sample> {
            // every sample of every track in the order it is stored, read a stretch at a time
            const all: { table: Table; index: number; offset: number }[] = [];
            for (const table of tables) for (let index = 0; index < table.offsets.length; index++) all.push({ table, index, offset: table.offsets[index]! });
            all.sort((a, b) => a.offset - b.offset);
            let window: { from: number; bytes: Uint8Array } = { from: 0, bytes: new Uint8Array() };
            for (const { table, index, offset } of all) {
                if (signal?.aborted) return;
                const size = table.sizes[index]!;
                if (offset < window.from || offset + size > window.from + window.bytes.length) window = { from: offset, bytes: await source.read(offset, Math.max(size, 4 * 1024 * 1024)) };
                const data = window.bytes.slice(offset - window.from, offset - window.from + size);
                yield { track: table.track.id, timestamp: Math.round((table.times[index]! * 1e6) / table.scale), duration: Math.round(((table.durations[index] ?? 0) * 1e6) / table.scale), key: table.keys ? table.keys.has(index) : true, data };
            }
        },
    };
}
