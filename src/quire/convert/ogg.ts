// Opus in an Ogg file, written by hand (RFC 3533 for Ogg, RFC 7845 for Opus in it): the identification
// header (OpusHead) alone on the first page, the comment header (OpusTags) on the second, then the
// packets the browser's encoder gives, a page closed about each second or when it fills. Each page's
// granule position is where its last finished packet ends, counted in samples at 48 kHz from the
// encoder's first (its delay, the pre-skip, included), and the last page's is cut to the pre-skip and
// the true length, so that a player drops the padding the encoder added at the end. Pages go out as blobs, so a long sound is not held as one buffer.
//
//   writer = createOggOpus({ channels: 2, preSkip: 312, inputRate: 48000 });
//   writer.add(packet, samples48k); ...; blob = writer.end(totalSamples48k);

import { Bytes } from "./bytes";

/** Ogg's CRC-32: polynomial 0x04c11db7, not reflected, starting from zero. */
const TABLE = (() => {
    const table = new Uint32Array(256);
    for (let byte = 0; byte < 256; byte++) {
        let value = byte << 24;
        for (let bit = 0; bit < 8; bit++) value = value & 0x80000000 ? (value << 1) ^ 0x04c11db7 : value << 1;
        table[byte] = value >>> 0;
    }
    return table;
})();

/** The checksum Ogg puts in each page's header. */
export function oggCrc(bytes: Uint8Array): number {
    let crc = 0;
    for (const byte of bytes) crc = ((crc << 8) ^ TABLE[((crc >>> 24) ^ byte) & 0xff]!) >>> 0;
    return crc;
}

/** One Ogg page holding whole packets (or the start of one too long for a page, which Opus packets never are). */
export function oggPage(options: { serial: number; sequence: number; granule: number; first?: boolean; last?: boolean }, packets: Uint8Array[]): Uint8Array {
    const lacing: number[] = [];
    for (const packet of packets) {
        let left = packet.length;
        while (left >= 255) {
            lacing.push(255);
            left -= 255;
        }
        lacing.push(left);
    }
    if (lacing.length > 255) throw new Error("too many packets for one Ogg page");
    const page = new Bytes();
    page.text("OggS").u8(0).u8((options.first ? 2 : 0) | (options.last ? 4 : 0));
    page.u64(options.granule, true).u32(options.serial, true).u32(options.sequence, true).u32(0, true).u8(lacing.length);
    for (const size of lacing) page.u8(size);
    for (const packet of packets) page.bytes(packet);
    const bytes = page.done();
    new DataView(bytes.buffer).setUint32(22, oggCrc(bytes), true);
    return bytes;
}

/** Opus's identification header: version 1, the channels, the pre-skip, the rate the sound came at, no gain, channel mapping 0. */
export function opusHead(channels: number, preSkip: number, inputRate: number): Uint8Array {
    return new Bytes().text("OpusHead").u8(1).u8(channels).u16(preSkip, true).u32(inputRate, true).u16(0, true).u8(0).done();
}

/** The pre-skip an OpusHead holds, or undefined when the bytes are not one. */
export function preSkipOf(head: Uint8Array | undefined): number | undefined {
    if (!head || head.length < 19 || String.fromCharCode(...head.subarray(0, 8)) !== "OpusHead") return undefined;
    return head[10]! | (head[11]! << 8);
}

/** Opus's comment header: who wrote it, and no comments. */
export function opusTags(vendor = "Quire"): Uint8Array {
    return new Bytes().text("OpusTags").u32(vendor.length, true).text(vendor).u32(0, true).done();
}

/** A writer of Opus in Ogg, packet by packet. */
export function createOggOpus(options: { channels: number; preSkip: number; inputRate: number; serial?: number }) {
    const serial = options.serial ?? 0x51756972;
    const parts: BlobPart[] = [];
    let sequence = 0;
    parts.push(oggPage({ serial, sequence: sequence++, granule: 0, first: true }, [opusHead(options.channels, options.preSkip, options.inputRate)]) as BlobPart);
    parts.push(oggPage({ serial, sequence: sequence++, granule: 0 }, [opusTags()]) as BlobPart);
    let waiting: Uint8Array[] = [];
    let segments = 0;
    // the first sample the encoder gave, its delay included, is at 0
    let granule = 0;
    let since = 0;
    // a full page is held back until the next, so that the last page of sound can be the one marked as the end
    let held: { packets: Uint8Array[]; granule: number } | undefined;
    const write = (page: { packets: Uint8Array[]; granule: number }, last = false) => parts.push(new Blob([oggPage({ serial, sequence: sequence++, granule: page.granule, last }, page.packets) as BlobPart]));
    const flush = () => {
        if (!waiting.length) return;
        if (held) write(held);
        held = { packets: waiting, granule };
        waiting = [];
        segments = 0;
        since = 0;
    };
    return {
        /** Adds one packet and how many samples at 48 kHz it holds. */
        add(packet: Uint8Array, samples: number) {
            const needed = Math.floor(packet.length / 255) + 1;
            if (segments + needed > 255) flush();
            waiting.push(packet);
            segments += needed;
            granule += samples;
            since += samples;
            if (since >= 48000) flush();
        },
        /** Closes the file: the last page marked so, its granule the pre-skip and the true length at 48 kHz. */
        end(total: number): Blob {
            flush();
            if (held) write({ ...held, granule: Math.min(held.granule, options.preSkip + total) }, true);
            else parts.push(oggPage({ serial, sequence: sequence++, granule: options.preSkip, last: true }, []) as BlobPart);
            return new Blob(parts, { type: "audio/ogg" });
        },
    };
}
