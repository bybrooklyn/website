// What the Ogg writer is held to: Ogg's checksum is the standard's (the value of a known page), a packet
// longer than 255 bytes is laced in 255s and a remainder, the headers sit on pages of their own with the
// first marked as the start, pages close about each second of sound, and the last page is marked as the
// end with its granule cut to the pre-skip and the true length.

import { expect, test } from "bun:test";
import { viewOf } from "./bytes";
import { createOggOpus, oggCrc, oggPage, opusHead, preSkipOf } from "./ogg";

/** The pages of an Ogg file: their flags, granules, sequence numbers and packet sizes, each checksum checked. */
function pagesOf(bytes: Uint8Array) {
    const pages: { flags: number; granule: number; sequence: number; lacing: number[] }[] = [];
    let at = 0;
    while (at < bytes.length) {
        expect(String.fromCharCode(...bytes.subarray(at, at + 4))).toBe("OggS");
        const view = viewOf(bytes.subarray(at));
        const count = bytes[at + 26]!;
        const lacing = [...bytes.subarray(at + 27, at + 27 + count)];
        const size = 27 + count + lacing.reduce((sum, each) => sum + each, 0);
        const page = bytes.slice(at, at + size);
        const crc = viewOf(page).getUint32(22, true);
        page.fill(0, 22, 26);
        expect(oggCrc(page)).toBe(crc);
        pages.push({ flags: bytes[at + 5]!, granule: Number(view.getBigUint64(6, true)), sequence: view.getUint32(18, true), lacing });
        at += size;
    }
    return pages;
}

test("the checksum is Ogg's own: the CRC-32 of 123456789 with polynomial 04c11db7, unreflected, from zero", () => {
    expect(oggCrc(new TextEncoder().encode("123456789"))).toBe(0x89a1897f);
});

test("a long packet is laced in 255s and a remainder, and a page's checksum reads back", () => {
    const page = oggPage({ serial: 1, sequence: 0, granule: 960 }, [new Uint8Array(600), new Uint8Array(10)]);
    expect(pagesOf(page)[0]!.lacing).toEqual([255, 255, 90, 10]);
});

test("Opus in Ogg: headers on pages of their own, pages about a second long, the last marked with the true length", async () => {
    const writer = createOggOpus({ channels: 2, preSkip: 312, inputRate: 44100 });
    for (let index = 0; index < 150; index++) writer.add(new Uint8Array(120).fill(index), 960);
    const bytes = new Uint8Array(await writer.end(150 * 960 - 500).arrayBuffer());
    const pages = pagesOf(bytes);
    expect(pages[0]!.flags).toBe(2);
    expect(pages[0]!.lacing).toEqual([19]);
    expect(pages[1]!.granule).toBe(0);
    expect(pages.map((page) => page.sequence)).toEqual(pages.map((_, index) => index));
    // 50 packets of 20 ms make a second, so three pages of sound
    expect(pages.slice(2).map((page) => page.lacing.length)).toEqual([50, 50, 50]);
    expect(pages[2]!.granule).toBe(48000);
    expect(pages.at(-1)!.flags).toBe(4);
    expect(pages.at(-1)!.granule).toBe(312 + 150 * 960 - 500);
    expect(preSkipOf(opusHead(2, 312, 48000))).toBe(312);
    expect(preSkipOf(new Uint8Array(4))).toBeUndefined();
});
