// What getting many results out is held to: the zip reads back with the suite's own zip reader, file
// for file and byte for byte, its checksums are the suite's CRC-32, read in pieces; a folder keeps what
// was in it, a name already there getting the next number in brackets; and the 4 GB a zip holds is said.

import { expect, test } from "bun:test";
import { crc32, readZip } from "../core/zip";
import { crcOf, intoFolder, zipOf, type Folder } from "./out";

const random = (length: number, seed: number) => {
    const bytes = new Uint8Array(length);
    let state = seed;
    for (let at = 0; at < length; at++) bytes[at] = (state = (state * 1103515245 + 12345) >>> 0) >>> 24;
    return bytes;
};

test("the checksum read in pieces is the suite's CRC-32", async () => {
    const bytes = random(300_000, 7);
    expect(await crcOf(new Blob([bytes]))).toBe(crc32(bytes));
    expect(await crcOf(new Blob([]))).toBe(0);
});

test("a zip of results reads back file for file and byte for byte, names in UTF-8 kept", async () => {
    const files = [
        { name: "photo.webp", blob: new Blob([random(5000, 1)]) },
        { name: "photo (1).webp", blob: new Blob([random(70_000, 2)]) },
        { name: "café notes.json", blob: new Blob(['{"a": 1}']) },
        { name: "empty.txt", blob: new Blob([]) },
    ];
    let told = 0;
    const zip = await zipOf(files, new Date(2026, 10, 15, 12, 30), (done) => (told = done));
    expect(told).toBe(4);
    const back = await readZip(new Uint8Array(await zip.arrayBuffer()));
    expect([...back.keys()]).toEqual(files.map((file) => file.name));
    for (const file of files) expect(back.get(file.name)).toEqual(new Uint8Array(await file.blob.arrayBuffer()));
});

test("a folder keeps what is in it: a name there already gets the next number, and nothing is overwritten", async () => {
    const kept = new Map<string, Uint8Array>([["photo.webp", new Uint8Array([1])], ["Photo (1).webp", new Uint8Array([2])]]);
    const folder: Folder = {
        async *values() {
            for (const name of kept.keys()) yield { kind: "file", name };
        },
        async getFileHandle(name) {
            return {
                async createWritable() {
                    const parts: Uint8Array[] = [];
                    const stream = new WritableStream<Uint8Array>({
                        write: (chunk) => void parts.push(chunk),
                        close: () => void kept.set(name, new Uint8Array(Buffer.concat(parts))),
                    });
                    return Object.assign(stream, { close: async () => {} });
                },
            };
        },
    };
    const written = await intoFolder(folder, [
        { name: "photo.webp", blob: new Blob([new Uint8Array([3])]) },
        { name: "song.flac", blob: new Blob([new Uint8Array([4])]) },
    ]);
    expect(written).toEqual(["photo (2).webp", "song.flac"]);
    expect(kept.get("photo.webp")).toEqual(new Uint8Array([1]));
    expect(kept.get("photo (2).webp")).toEqual(new Uint8Array([3]));
    expect(kept.get("song.flac")).toEqual(new Uint8Array([4]));
});

test("more than a zip holds is said in plain words", async () => {
    const huge = { size: 0xffffffff, stream: () => new Blob([]).stream() } as unknown as Blob;
    await expect(zipOf([{ name: "film.mp4", blob: huge }])).rejects.toThrow("Together these are over 4 GB, more than a zip holds. Save them into a folder instead, or a few at a time.");
});
