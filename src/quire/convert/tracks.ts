// What the converter's containers say about a track and its samples, the same whichever container holds
// them, and the codec strings the browser's decoders and encoders are asked about (WebCodecs' codec
// registry): each made from the configuration box a container carries (avcC for H.264, vpcC for VP9,
// av1C for AV1, an AudioSpecificConfig for AAC), and the boxes made back from a codec string where an
// encoder gives none.

import { Bytes } from "./bytes";

/** A track as a container describes it, with what a decoder needs: its codec string and configuration bytes. */
export interface Track {
    id: number;
    kind: "video" | "audio";
    codec: string;
    /** The decoder's configuration bytes: avcC, av1C, an AudioSpecificConfig, an OpusHead, a FLAC header. */
    description?: Uint8Array;
    width?: number;
    height?: number;
    sampleRate?: number;
    channels?: number;
    /** Its length in seconds, where the container says it. */
    duration?: number;
    /** Pictures a second, where the container says it. */
    rate?: number;
    /** When its first picture is shown, in microseconds, where the container says it before its samples are read. */
    start?: number;
    /** The words for its codec, for a person: "H.264", "AAC". */
    label: string;
}

/** One encoded sample: which track, when in microseconds, for how long, whether it starts afresh, and its bytes. */
export interface Sample {
    track: number;
    timestamp: number;
    duration: number;
    key: boolean;
    data: Uint8Array;
}

/** A container read: its tracks, its length in seconds, and its samples in the order they are stored. */
export interface Demuxed {
    tracks: Track[];
    duration: number;
    samples(signal?: AbortSignal): AsyncGenerator<Sample>;
}

const hex2 = (value: number) => value.toString(16).padStart(2, "0");
const dec2 = (value: number) => String(value).padStart(2, "0");

/** H.264's codec string from its avcC box: `avc1.` and the profile, constraints and level as hex. */
export function avcCodec(avcC: Uint8Array): string {
    return `avc1.${hex2(avcC[1]!)}${hex2(avcC[2]!)}${hex2(avcC[3]!)}`;
}

/** VP9's codec string from its vpcC box (version 1): `vp09.` profile, level and bit depth. */
export function vp9Codec(vpcC: Uint8Array): string {
    // a full box: version and flags, then profile, level, and bit depth in the high four bits
    return `vp09.${dec2(vpcC[4]!)}.${dec2(vpcC[5]!)}.${dec2(vpcC[6]! >> 4)}`;
}

/** AV1's codec string from its av1C box: `av01.` profile, level with its tier, and bit depth. */
export function av1Codec(av1C: Uint8Array): string {
    const profile = av1C[1]! >> 5;
    const level = av1C[1]! & 31;
    const tier = av1C[2]! >> 7 ? "H" : "M";
    const high = (av1C[2]! >> 6) & 1;
    const twelve = (av1C[2]! >> 5) & 1;
    return `av01.${profile}.${dec2(level)}${tier}.${high ? (twelve ? "12" : "10") : "08"}`;
}

/** AAC's codec string from its AudioSpecificConfig: `mp4a.40.` and the audio object type. */
export function aacCodec(config: Uint8Array | undefined): string {
    if (!config?.length) return "mp4a.40.2";
    let type = config[0]! >> 3;
    if (type === 31 && config.length > 1) type = 32 + (((config[0]! & 7) << 3) | (config[1]! >> 5));
    return `mp4a.40.${type}`;
}

/** A VP9 vpcC box's body (version 1) made from its codec string, for a container that wants one. */
export function vpcCFrom(codec: string): Uint8Array {
    const [, profile = "0", level = "10", depth = "8"] = codec.split(".");
    // full box version 1; profile, level, bit depth and 4:2:0 colour sampling, BT.709 colours, no codec initialization data
    return new Bytes().u8(1).u24(0).u8(Number(profile)).u8(Number(level)).u8((Number(depth) << 4) | (1 << 1)).u8(1).u8(1).u8(1).u16(0).done();
}

/** An av1C box's body made from AV1's codec string, with no configuration units, for an encoder that gives none. */
export function av1CFrom(codec: string): Uint8Array {
    const [, profile = "0", levelTier = "04M", depth = "08"] = codec.split(".");
    const level = Number(levelTier.slice(0, 2));
    const tier = levelTier.endsWith("H") ? 1 : 0;
    const high = Number(depth) > 8 ? 1 : 0;
    const twelve = Number(depth) === 12 ? 1 : 0;
    // marker and version, profile and level, then tier, depth, colour and 4:2:0 colour sampling
    return new Uint8Array([0x81, (Number(profile) << 5) | level, (tier << 7) | (high << 6) | (twelve << 5) | (0 << 4) | (1 << 3) | (1 << 2), 0]);
}

/** The words for a codec string, for a person. */
export function codecLabel(codec: string): string {
    if (codec.startsWith("avc1") || codec.startsWith("avc3")) return "H.264";
    if (codec.startsWith("hvc1") || codec.startsWith("hev1")) return "H.265";
    if (codec.startsWith("vp09")) return "VP9";
    if (codec === "vp8") return "VP8";
    if (codec.startsWith("av01")) return "AV1";
    if (codec.startsWith("mp4a.40")) return "AAC";
    if (codec === "mp3" || codec === "mp4a.6B" || codec === "mp4a.69") return "MP3";
    if (codec === "opus") return "Opus";
    if (codec === "vorbis") return "Vorbis";
    if (codec === "flac") return "FLAC";
    if (codec.startsWith("pcm")) return "PCM";
    return codec;
}
