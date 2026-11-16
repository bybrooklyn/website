// WebM (and Matroska) read and written by hand, for the converter's sounds and films. Writing: the EBML
// header, a Segment of known size holding a SeekHead, Info (timestamps in half milliseconds, so that
// Opus's delay of 6.5 ms is a whole number of them and is not rounded by a player, and the length),
// Tracks, the Clusters, and Cues at the end so that a player can seek. Samples from the tracks are put in
// time order before they are written, and a cluster is closed at a key frame after half a second, after
// five seconds of sound, or before a timestamp would no longer fit its 16 bits. Each finished cluster
// becomes a blob, so a long film is never held as one buffer. Reading walks the file a range at a time:
// the header and tracks first, then the clusters one after another (a cluster of unknown size, as a
// recording browser writes, is read element by element), giving each block's samples, laced or not.
//
//   writer = createWebm([{ kind: "video", codec: "vp09.00.10.08", width: 640, height: 360 }]);
//   writer.add(0, chunkBytes, timestampMicroseconds, durationMicroseconds, isKey); blob = writer.end();
//   film = await readWebm(sourceOf(file)); for await (sample of film.samples()) ...

import { Bytes, joined, viewOf, type Source } from "./bytes";
import { av1CFrom, avcCodec, av1Codec, aacCodec, codecLabel, type Demuxed, type Sample, type Track } from "./tracks";
import { opusHead } from "./ogg";

/** The element IDs used here, as their bytes are written. */
export const ID = {
    EBML: 0x1a45dfa3,
    Segment: 0x18538067,
    SeekHead: 0x114d9b74,
    Seek: 0x4dbb,
    SeekID: 0x53ab,
    SeekPosition: 0x53ac,
    Info: 0x1549a966,
    TimestampScale: 0x2ad7b1,
    Duration: 0x4489,
    MuxingApp: 0x4d80,
    WritingApp: 0x5741,
    Tracks: 0x1654ae6b,
    TrackEntry: 0xae,
    TrackNumber: 0xd7,
    TrackUID: 0x73c5,
    TrackType: 0x83,
    FlagLacing: 0x9c,
    CodecID: 0x86,
    CodecPrivate: 0x63a2,
    CodecDelay: 0x56aa,
    SeekPreRoll: 0x56bb,
    Video: 0xe0,
    PixelWidth: 0xb0,
    PixelHeight: 0xba,
    Audio: 0xe1,
    SamplingFrequency: 0xb5,
    Channels: 0x9f,
    Cluster: 0x1f43b675,
    Timestamp: 0xe7,
    SimpleBlock: 0xa3,
    BlockGroup: 0xa0,
    Block: 0xa1,
    BlockDuration: 0x9b,
    DiscardPadding: 0x75a2,
    ReferenceBlock: 0xfb,
    Cues: 0x1c53bb6b,
    CuePoint: 0xbb,
    CueTime: 0xb3,
    CueTrackPositions: 0xb7,
    CueTrack: 0xf7,
    CueClusterPosition: 0xf1,
    Void: 0xec,
} as const;

// ---- writing ----

/** An element's ID as its bytes: one to four, as many as its value needs. */
function idBytes(id: number): number[] {
    return id > 0xffffff ? [id >>> 24, (id >>> 16) & 255, (id >>> 8) & 255, id & 255] : id > 0xffff ? [id >>> 16, (id >>> 8) & 255, id & 255] : id > 0xff ? [id >>> 8, id & 255] : [id];
}

/** A size as EBML writes it, in `width` bytes (eight unless asked): a marker bit, then the number. */
function sizeBytes(size: number, width = 8): number[] {
    const out: number[] = [];
    let value = BigInt(size);
    for (let at = width - 1; at >= 0; at--) {
        out[at] = Number(value & 0xffn);
        value >>= 8n;
    }
    out[0]! |= 1 << (8 - width);
    return out;
}

/** The fewest bytes a size can be written in. */
function sizeWidth(size: number): number {
    let width = 1;
    while (size >= 2 ** (7 * width) - 1 && width < 8) width++;
    return width;
}

/** The unit of the timestamps written, in nanoseconds: half a millisecond. */
export const UNIT = 500_000;

/** An element: its ID, its size in the fewest bytes, and its body. */
export function element(id: number, body: Uint8Array): Uint8Array {
    const head = [...idBytes(id), ...sizeBytes(body.length, sizeWidth(body.length))];
    const out = new Uint8Array(head.length + body.length);
    out.set(head);
    out.set(body, head.length);
    return out;
}

/** An unsigned whole number as an element, in the fewest bytes (or `width` bytes, for a value filled in later). */
export function uint(id: number, value: number, width?: number): Uint8Array {
    let bytes = width ?? 1;
    if (!width) while (bytes < 8 && value >= 2 ** (8 * bytes)) bytes++;
    const body = new Uint8Array(bytes);
    let rest = BigInt(Math.round(value));
    for (let at = bytes - 1; at >= 0; at--) {
        body[at] = Number(rest & 0xffn);
        rest >>= 8n;
    }
    return element(id, body);
}

const float = (id: number, value: number) => element(id, new Bytes().f64(value).done());
const text = (id: number, value: string) => element(id, new TextEncoder().encode(value));
const master = (id: number, ...children: Uint8Array[]) => element(id, joined(children));

/** What a track to be written is: its kind, its WebCodecs codec string and configuration bytes, and its size or its rate and channels. */
export interface TrackOut {
    kind: "video" | "audio";
    codec: string;
    description?: Uint8Array;
    width?: number;
    height?: number;
    sampleRate?: number;
    channels?: number;
}

/** Matroska's codec ID for a WebCodecs codec string, and the codec private data it needs. */
function codecOf(track: TrackOut): { id: string; private?: Uint8Array } {
    const { codec, description } = track;
    if (codec === "vp8") return { id: "V_VP8" };
    if (codec.startsWith("vp09")) return { id: "V_VP9" };
    if (codec.startsWith("av01")) return { id: "V_AV1", private: description?.length ? description : av1CFrom(codec) };
    if (codec.startsWith("avc1")) return { id: "V_MPEG4/ISO/AVC", private: description };
    if (codec === "opus") return { id: "A_OPUS", private: description?.length ? description : opusHead(track.channels ?? 2, 312, track.sampleRate ?? 48000) };
    if (codec === "vorbis") return { id: "A_VORBIS", private: description };
    if (codec.startsWith("mp4a")) return { id: "A_AAC", private: description };
    throw new Error(`${codecLabel(codec)} cannot be written into WebM here.`);
}

/** A writer of WebM, sample by sample, for up to one video and one audio track. */
export function createWebm(tracks: TrackOut[]) {
    const clusters: BlobPart[] = [];
    const cues: { time: number; track: number; position: number }[] = [];
    let written = 0;
    let cluster: { start: number; blocks: Uint8Array[]; size: number } | undefined;
    let end = 0;
    const queues: { timestamp: number; duration: number; key: boolean; data: Uint8Array; discard?: number }[][] = tracks.map(() => []);
    const finished = tracks.map(() => false);
    const video = tracks.findIndex((track) => track.kind === "video");

    const close = () => {
        if (!cluster) return;
        const body = joined([uint(ID.Timestamp, cluster.start), ...cluster.blocks]);
        const bytes = new Uint8Array([...idBytes(ID.Cluster), ...sizeBytes(body.length), ...body]);
        clusters.push(new Blob([bytes as BlobPart]));
        written += bytes.length;
        cluster = undefined;
    };
    const place = (index: number, sample: { timestamp: number; duration: number; key: boolean; data: Uint8Array; discard?: number }) => {
        const time = Math.round((sample.timestamp * 1000) / UNIT);
        const keyHere = video < 0 ? true : index === video && sample.key;
        const units = (milliseconds: number) => (milliseconds * 1e6) / UNIT;
        // a block's time from its cluster's start must fit in 16 bits
        const long = cluster && (time - cluster.start > 30_000 || cluster.size > 8_000_000 || (video < 0 && time - cluster.start >= units(5000)) || (keyHere && video >= 0 && time - cluster.start >= units(500)));
        if (!cluster || long || time < cluster.start) {
            close();
            cluster = { start: time, blocks: [], size: 0 };
            cues.push({ time, track: (video < 0 ? 0 : video) + 1, position: written });
        }
        // a simple block: the track number, the time from the cluster's start, the key flag, no lacing; or,
        // for the last block of a sound with padding to drop at its end, a block group saying how much
        const head = new Bytes().u8(0x80 | (index + 1)).i16(time - cluster.start).u8(sample.key && !sample.discard ? 0x80 : 0).done();
        const block = sample.discard ? master(ID.BlockGroup, element(ID.Block, joined([head, sample.data])), element(ID.DiscardPadding, new Bytes().u64(sample.discard).done())) : element(ID.SimpleBlock, joined([head, sample.data]));
        cluster.blocks.push(block);
        cluster.size += block.length;
        end = Math.max(end, sample.timestamp + sample.duration);
    };
    /** Writes the waiting samples in time order, as far as every track still giving samples has some waiting. */
    const drain = (all = false) => {
        for (;;) {
            let pick = -1;
            for (let index = 0; index < queues.length; index++) {
                const head = queues[index]![0];
                if (!head) {
                    if (!finished[index] && !all) return;
                    continue;
                }
                if (pick < 0 || head.timestamp < queues[pick]![0]!.timestamp) pick = index;
            }
            if (pick < 0) return;
            place(pick, queues[pick]!.shift()!);
        }
    };

    return {
        /** Adds one encoded sample to a track (numbered from 0, in the order given), its time and length in microseconds, and the nanoseconds at its end a player is to drop, if any. */
        add(index: number, data: Uint8Array, timestamp: number, duration: number, key: boolean, discard = 0) {
            queues[index]!.push({ timestamp, duration, key, data, ...(discard > 0 ? { discard: Math.round(discard) } : {}) });
            drain();
        },
        /** Says a track will give no more samples, so the others need not wait for it. */
        finish(index: number) {
            finished[index] = true;
            drain();
        },
        /** How many bytes are written so far, for the bar. */
        size: () => written + (cluster?.size ?? 0),
        /** Closes the file: the header, the tracks and the length worked out now, and the cues at the end. */
        end(): Blob {
            drain(true);
            close();
            const entries = tracks.map((track, index) => {
                const codec = codecOf(track);
                const parts = [uint(ID.TrackNumber, index + 1), uint(ID.TrackUID, index + 1), uint(ID.TrackType, track.kind === "video" ? 1 : 2), uint(ID.FlagLacing, 0), text(ID.CodecID, codec.id)];
                if (codec.private?.length) parts.push(element(ID.CodecPrivate, codec.private));
                if (track.codec === "opus") parts.push(uint(ID.CodecDelay, Math.round(((codec.private![10]! | (codec.private![11]! << 8)) / 48000) * 1e9)), uint(ID.SeekPreRoll, 80_000_000));
                if (track.kind === "video") parts.push(master(ID.Video, uint(ID.PixelWidth, track.width ?? 0), uint(ID.PixelHeight, track.height ?? 0)));
                else parts.push(master(ID.Audio, float(ID.SamplingFrequency, track.sampleRate ?? 48000), uint(ID.Channels, track.channels ?? 2)));
                return master(ID.TrackEntry, ...parts);
            });
            const info = master(ID.Info, uint(ID.TimestampScale, UNIT), float(ID.Duration, (end * 1000) / UNIT), text(ID.MuxingApp, "Quire"), text(ID.WritingApp, "Quire"));
            const trackList = master(ID.Tracks, ...entries);
            // the seek head's positions are written in eight bytes each, so its size is known before they are
            const seek = (id: number, position: number) => master(ID.Seek, element(ID.SeekID, new Uint8Array(idBytes(id))), uint(ID.SeekPosition, position, 8));
            const seekSize = master(ID.SeekHead, seek(ID.Info, 0), seek(ID.Tracks, 0), seek(ID.Cues, 0)).length;
            const clustersAt = seekSize + info.length + trackList.length;
            const cuesAt = clustersAt + written;
            const seekHead = master(ID.SeekHead, seek(ID.Info, seekSize), seek(ID.Tracks, seekSize + info.length), seek(ID.Cues, cuesAt));
            const cueList = master(ID.Cues, ...cues.map((cue) => master(ID.CuePoint, uint(ID.CueTime, cue.time), master(ID.CueTrackPositions, uint(ID.CueTrack, cue.track), uint(ID.CueClusterPosition, clustersAt + cue.position)))));
            const header = master(ID.EBML, uint(0x4286, 1), uint(0x42f7, 1), uint(0x42f2, 4), uint(0x42f3, 8), text(0x4282, "webm"), uint(0x4287, 4), uint(0x4285, 2));
            const segmentSize = cuesAt + cueList.length;
            const start = new Uint8Array([...header, ...idBytes(ID.Segment), ...sizeBytes(segmentSize), ...seekHead, ...info, ...trackList]);
            return new Blob([start as BlobPart, ...clusters, cueList as BlobPart], { type: video >= 0 ? "video/webm" : "audio/webm" });
        },
    };
}

// ---- reading ----

/** A variable-size integer at a place: its value (undefined for "unknown", all ones) and its width. */
function vint(bytes: Uint8Array, at: number, keepMarker = false): { value: number | undefined; width: number } | undefined {
    const first = bytes[at];
    if (first === undefined || first === 0) return undefined;
    let width = 1;
    while (!(first & (0x80 >> (width - 1)))) width++;
    if (at + width > bytes.length) return undefined;
    let value = keepMarker ? first : first & (0xff >> width);
    let ones = value === (0xff >> width);
    for (let index = 1; index < width; index++) {
        value = value * 256 + bytes[at + index]!;
        if (bytes[at + index] !== 0xff) ones = false;
    }
    return { value: !keepMarker && ones ? undefined : value, width };
}

/** An element's head read at a place in a source: its ID, where its body starts, and its size (undefined when unknown). */
async function headAt(source: Source, at: number): Promise<{ id: number; body: number; size: number | undefined } | undefined> {
    const bytes = await source.read(at, 12);
    const id = vint(bytes, 0, true);
    if (!id) return undefined;
    const size = vint(bytes, id.width);
    if (!size) return undefined;
    return { id: id.value!, body: at + id.width + size.width, size: size.value };
}

/** The children of a master element held in memory: each one's ID and body. */
function children(bytes: Uint8Array): { id: number; body: Uint8Array }[] {
    const out: { id: number; body: Uint8Array }[] = [];
    let at = 0;
    while (at < bytes.length) {
        const id = vint(bytes, at, true);
        if (!id) break;
        const size = vint(bytes, at + id.width);
        if (!size) break;
        const start = at + id.width + size.width;
        const end = size.value === undefined ? bytes.length : Math.min(bytes.length, start + size.value);
        out.push({ id: id.value!, body: bytes.subarray(start, end) });
        at = end;
    }
    return out;
}

const readUint = (bytes: Uint8Array) => bytes.reduce((value, byte) => value * 256 + byte, 0);
const readFloat = (bytes: Uint8Array) => (bytes.length === 4 ? viewOf(bytes).getFloat32(0) : bytes.length === 8 ? viewOf(bytes).getFloat64(0) : 0);
const readText = (bytes: Uint8Array) => new TextDecoder().decode(bytes).replace(/\0+$/, "");

/** The WebCodecs codec string and description for a Matroska track, or undefined when it is not one a browser decodes. */
function decoderOf(codecId: string, priv: Uint8Array | undefined): { codec: string; description?: Uint8Array } | undefined {
    if (codecId === "V_VP8") return { codec: "vp8" };
    if (codecId === "V_VP9") return { codec: "vp09.00.10.08" };
    if (codecId === "V_AV1") return priv && priv.length >= 4 ? { codec: av1Codec(priv), description: priv } : { codec: "av01.0.08M.08" };
    if (codecId === "V_MPEG4/ISO/AVC" && priv) return { codec: avcCodec(priv), description: priv };
    if (codecId === "V_MPEGH/ISO/HEVC") return { codec: "hvc1.1.6.L93.B0", description: priv };
    if (codecId === "A_OPUS") return { codec: "opus", description: priv };
    if (codecId === "A_VORBIS") return { codec: "vorbis", description: priv };
    if (codecId === "A_FLAC") return { codec: "flac", description: priv };
    if (codecId.startsWith("A_AAC")) return { codec: aacCodec(priv), description: priv };
    if (codecId === "A_MPEG/L3") return { codec: "mp3" };
    return undefined;
}

/** The frames of a block's body after its head, split by its lacing (none, Xiph, fixed or EBML). */
export function laced(bytes: Uint8Array, flags: number): Uint8Array[] {
    const lacing = (flags >> 1) & 3;
    if (lacing === 0) return [bytes];
    const count = bytes[0]! + 1;
    let at = 1;
    const sizes: number[] = [];
    if (lacing === 2) {
        for (let index = 0; index < count; index++) sizes.push((bytes.length - 1) / count);
    } else {
        if (lacing === 1) {
            for (let index = 0; index < count - 1; index++) {
                let size = 0;
                while (bytes[at] === 255) {
                    size += 255;
                    at++;
                }
                size += bytes[at++]!;
                sizes.push(size);
            }
        } else {
            const first = vint(bytes, at)!;
            at += first.width;
            sizes.push(first.value!);
            for (let index = 1; index < count - 1; index++) {
                const step = vint(bytes, at)!;
                at += step.width;
                // a signed difference from the size before: the raw value less half its range
                sizes.push(sizes[index - 1]! + step.value! - (2 ** (7 * step.width - 1) - 1));
            }
        }
        sizes.push(bytes.length - at - sizes.reduce((sum, size) => sum + size, 0));
    }
    const frames: Uint8Array[] = [];
    for (const size of sizes) {
        frames.push(bytes.subarray(at, at + size));
        at += size;
    }
    return frames;
}

/** The most of one element read into memory at once; a cluster larger than this is read by its children. */
const ELEMENT_MOST = 64 * 1024 * 1024;

/** Reads a WebM or Matroska file: its tracks and length first, then its samples as they are asked for. */
export async function readWebm(source: Source): Promise<Demuxed> {
    const top = await headAt(source, 0);
    if (!top || top.id !== ID.EBML) throw new Error("This is not a WebM or Matroska file.");
    const segment = await headAt(source, top.body + (top.size ?? 0));
    if (!segment || segment.id !== ID.Segment) throw new Error("This WebM file has no segment.");
    const segmentEnd = segment.size === undefined ? source.size : Math.min(source.size, segment.body + segment.size);
    let scale = 1_000_000;
    let duration = 0;
    const tracks: (Track & { number: number; defaultDuration?: number })[] = [];
    let firstCluster: number | undefined;
    // the elements before the first cluster: Info and Tracks (a seek head, tags and the rest are passed over)
    let at = segment.body;
    while (at < segmentEnd) {
        const head = await headAt(source, at);
        if (!head) break;
        if (head.id === ID.Cluster) {
            firstCluster = at;
            break;
        }
        if (head.size === undefined) break;
        if (head.id === ID.Info || head.id === ID.Tracks) {
            const body = await source.read(head.body, Math.min(head.size, ELEMENT_MOST));
            if (head.id === ID.Info) {
                for (const child of children(body)) {
                    if (child.id === ID.TimestampScale) scale = readUint(child.body);
                    if (child.id === ID.Duration) duration = readFloat(child.body);
                }
            } else {
                for (const entry of children(body).filter((child) => child.id === ID.TrackEntry)) {
                    const fields = children(entry.body);
                    const field = (id: number) => fields.find((child) => child.id === id)?.body;
                    const type = readUint(field(ID.TrackType) ?? new Uint8Array([0]));
                    if (type !== 1 && type !== 2) continue;
                    const video = field(ID.Video) ? children(field(ID.Video)!) : [];
                    const audio = field(ID.Audio) ? children(field(ID.Audio)!) : [];
                    const width = readUint(video.find((child) => child.id === ID.PixelWidth)?.body ?? new Uint8Array());
                    const height = readUint(video.find((child) => child.id === ID.PixelHeight)?.body ?? new Uint8Array());
                    const rate = readFloat(audio.find((child) => child.id === ID.SamplingFrequency)?.body ?? new Uint8Array()) || 8000;
                    const channels = readUint(audio.find((child) => child.id === ID.Channels)?.body ?? new Uint8Array([1])) || 1;
                    const codecId = readText(field(ID.CodecID) ?? new Uint8Array());
                    const decoder = decoderOf(codecId, field(ID.CodecPrivate));
                    const number = readUint(field(ID.TrackNumber) ?? new Uint8Array([0]));
                    const defaultDuration = field(0x23e383) ? readUint(field(0x23e383)!) / 1000 : undefined;
                    tracks.push({
                        id: number,
                        number,
                        kind: type === 1 ? "video" : "audio",
                        codec: decoder?.codec ?? codecId,
                        ...(decoder?.description ? { description: decoder.description.slice() } : {}),
                        ...(type === 1 ? { width, height } : { sampleRate: rate, channels }),
                        label: decoder ? codecLabel(decoder.codec) : codecId.replace(/^[AV]_/, ""),
                        ...(type === 1 && defaultDuration ? { rate: Math.round(1e8 / defaultDuration) / 100 } : {}),
                        defaultDuration,
                    });
                }
            }
        }
        at = head.body + head.size;
    }
    const seconds = (duration * scale) / 1e9;
    for (const track of tracks) track.duration = seconds;
    return {
        tracks,
        duration: seconds,
        async *samples(signal?: AbortSignal): AsyncGenerator<Sample> {
            let place = firstCluster ?? segmentEnd;
            const last = new Map<number, Sample>();
            // a block's length is the time to the next block of its track; the last gets its track's default, or the one before's
            const out = function* (sample: Sample): Generator<Sample> {
                const before = last.get(sample.track);
                if (before) {
                    before.duration = Math.max(0, sample.timestamp - before.timestamp) || before.duration;
                    yield before;
                }
                last.set(sample.track, sample);
            };
            const blocks = function* (body: Uint8Array, clusterTime: number, key?: boolean): Generator<Sample> {
                const head = vint(body, 0)!;
                const track = tracks.find((each) => each.number === head.value);
                if (!track) return;
                const time = clusterTime + viewOf(body).getInt16(head.width);
                const flags = body[head.width + 2]!;
                const frames = laced(body.subarray(head.width + 3), flags);
                const each = track.defaultDuration ?? (track.kind === "audio" ? 20_000 : 33_333);
                for (const [index, data] of frames.entries()) yield* out({ track: track.id, timestamp: Math.round(((time * scale) / 1000) + index * each), duration: each, key: key ?? ((flags & 0x80) !== 0 || track.kind === "audio"), data: data.slice() });
            };
            while (place < segmentEnd) {
                if (signal?.aborted) return;
                const head = await headAt(source, place);
                if (!head) break;
                if (head.id !== ID.Cluster) {
                    if (head.size === undefined) break;
                    place = head.body + head.size;
                    continue;
                }
                let clusterTime = 0;
                if (head.size !== undefined && head.size <= ELEMENT_MOST) {
                    const body = await source.read(head.body, head.size);
                    for (const child of children(body)) {
                        if (child.id === ID.Timestamp) clusterTime = readUint(child.body);
                        else if (child.id === ID.SimpleBlock) yield* blocks(child.body, clusterTime);
                        else if (child.id === ID.BlockGroup) {
                            const parts = children(child.body);
                            const block = parts.find((part) => part.id === ID.Block);
                            if (!block) continue;
                            yield* blocks(block.body, clusterTime, !parts.some((part) => part.id === ID.ReferenceBlock));
                        }
                    }
                    place = head.body + head.size;
                } else {
                    // a cluster of unknown size: its children one by one, until the next cluster or the end
                    let inner = head.body;
                    const end = head.size === undefined ? segmentEnd : head.body + head.size;
                    while (inner < end) {
                        const child = await headAt(source, inner);
                        if (!child || child.size === undefined || child.id === ID.Cluster || child.id === ID.Cues) break;
                        const body = await source.read(child.body, child.size);
                        if (child.id === ID.Timestamp) clusterTime = readUint(body);
                        else if (child.id === ID.SimpleBlock) yield* blocks(body, clusterTime);
                        else if (child.id === ID.BlockGroup) {
                            const parts = children(body);
                            const block = parts.find((part) => part.id === ID.Block);
                            if (block) yield* blocks(block.body, clusterTime, !parts.some((part) => part.id === ID.ReferenceBlock));
                        }
                        inner = child.body + child.size;
                    }
                    place = inner;
                }
            }
            for (const sample of last.values()) yield sample;
        },
    };
}
