// Getting many results out at once: as one zip, or written straight into a folder she picks where the
// browser allows it (Chromium's showDirectoryPicker). The zip is made of the results' own blobs with
// small headers between them, each stored as it is (pictures, sounds and films are squeezed already),
// so that a zip of films is never held in memory whole: only each file's checksum is worked out, by
// reading it through once. A folder keeps what is in it: a name already there gets the next number in
// brackets, as two results of one name do, and nothing is overwritten.
//
//   const zip = await zipOf([{ name: "photo.webp", blob }]);
//   const written = await intoFolder(await pickFolder(), [{ name: "photo.webp", blob }]);

import { outName } from "./names";

/** One result to give out: the name it leaves with and its bytes. */
export interface Result {
    name: string;
    blob: Blob;
}

/** A folder to write into: what showDirectoryPicker gives, or the browser's own private folder in a test. */
export interface Folder {
    values(): AsyncIterable<{ kind: string; name: string }>;
    getFileHandle(name: string, options?: { create?: boolean }): Promise<{ createWritable(): Promise<WritableStream & { close(): Promise<void> }> }>;
}

/** The biggest a zip may be: the old zip format counts in 32 bits, and zip64 is not written. */
export const ZIP_MOST = 0xfffffffe;

const TABLE = (() => {
    const table = new Uint32Array(256);
    for (let byte = 0; byte < 256; byte++) {
        let value = byte;
        for (let bit = 0; bit < 8; bit++) value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
        table[byte] = value >>> 0;
    }
    return table;
})();

/** The CRC-32 of a blob, read through in pieces so that a large one is never held whole. */
export async function crcOf(blob: Blob): Promise<number> {
    let crc = 0xffffffff;
    const reader = blob.stream().getReader();
    for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        for (let index = 0; index < value.length; index++) crc = TABLE[(crc ^ value[index]!) & 0xff]! ^ (crc >>> 8);
    }
    return (crc ^ 0xffffffff) >>> 0;
}

/** A date and time as zip files keep them, in the old two-second DOS form. */
function dosTime(date: Date): { time: number; day: number } {
    const year = Math.max(1980, date.getFullYear());
    return { time: (date.getHours() << 11) | (date.getMinutes() << 5) | (date.getSeconds() >> 1), day: ((year - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate() };
}

/** Results as one zip, each stored as it is, in the order given. Over 4 GB in all is refused, in words for the page. */
export async function zipOf(results: Result[], date = new Date(), told: (done: number) => void = () => {}): Promise<Blob> {
    const encoder = new TextEncoder();
    const { time, day } = dosTime(date);
    const parts: BlobPart[] = [];
    const centrals: Uint8Array[] = [];
    let offset = 0;
    for (const [index, result] of results.entries()) {
        const name = encoder.encode(result.name);
        const size = result.blob.size;
        if (offset + 30 + name.length + size > ZIP_MOST) throw new Error("Together these are over 4 GB, more than a zip holds. Save them into a folder instead, or a few at a time.");
        const crc = await crcOf(result.blob);
        const local = new Uint8Array(30 + name.length);
        const view = new DataView(local.buffer);
        view.setUint32(0, 0x04034b50, true);
        view.setUint16(4, 20, true);
        view.setUint16(6, 0x0800, true); // the name is UTF-8
        view.setUint16(8, 0, true); // stored
        view.setUint16(10, time, true);
        view.setUint16(12, day, true);
        view.setUint32(14, crc, true);
        view.setUint32(18, size, true);
        view.setUint32(22, size, true);
        view.setUint16(26, name.length, true);
        local.set(name, 30);
        parts.push(local as BlobPart, result.blob);
        const central = new Uint8Array(46 + name.length);
        const line = new DataView(central.buffer);
        line.setUint32(0, 0x02014b50, true);
        line.setUint16(4, (3 << 8) | 20, true);
        line.setUint16(6, 20, true);
        line.setUint16(8, 0x0800, true);
        line.setUint16(12, time, true);
        line.setUint16(14, day, true);
        line.setUint32(16, crc, true);
        line.setUint32(20, size, true);
        line.setUint32(24, size, true);
        line.setUint16(28, name.length, true);
        line.setUint32(38, (0o100644 << 16) >>> 0, true);
        line.setUint32(42, offset, true);
        central.set(name, 46);
        centrals.push(central);
        offset += local.length + size;
        told(index + 1);
    }
    const directory = centrals.reduce((sum, part) => sum + part.length, 0);
    const end = new Uint8Array(22);
    const tail = new DataView(end.buffer);
    tail.setUint32(0, 0x06054b50, true);
    tail.setUint16(8, results.length, true);
    tail.setUint16(10, results.length, true);
    tail.setUint32(12, directory, true);
    tail.setUint32(16, offset, true);
    return new Blob([...parts, ...(centrals as BlobPart[]), end as BlobPart], { type: "application/zip" });
}

/** Whether this browser lets a page write files into a folder she picks. */
export function foldersAllowed(): boolean {
    return typeof (globalThis as { showDirectoryPicker?: unknown }).showDirectoryPicker === "function";
}

/** Asks her for a folder to write into; undefined when she closes the picker. */
export async function pickFolder(): Promise<Folder | undefined> {
    const picker = (globalThis as unknown as { showDirectoryPicker?: (options: object) => Promise<Folder> }).showDirectoryPicker;
    if (!picker) return undefined;
    try {
        return await picker({ mode: "readwrite", id: "quire-convert" });
    } catch {
        return undefined;
    }
}

/** Writes results into a folder, each under its own name or the next free one there, and gives back the names written, in order. */
export async function intoFolder(folder: Folder, results: Result[], told: (done: number) => void = () => {}): Promise<string[]> {
    const taken = new Set<string>();
    for await (const entry of folder.values()) taken.add(entry.name.toLowerCase());
    const written: string[] = [];
    for (const [index, result] of results.entries()) {
        const dot = result.name.lastIndexOf(".");
        const name = outName(result.name, dot > 0 ? result.name.slice(dot) : "", taken);
        const handle = await folder.getFileHandle(name, { create: true });
        const writable = await handle.createWritable();
        await result.blob.stream().pipeTo(writable);
        written.push(name);
        told(index + 1);
    }
    return written;
}

/** Gives one result to the browser to save, as a download. */
export function download(result: Result): void {
    const link = document.createElement("a");
    link.href = URL.createObjectURL(result.blob);
    link.download = result.name;
    link.click();
    setTimeout(() => URL.revokeObjectURL(link.href), 60_000);
}
