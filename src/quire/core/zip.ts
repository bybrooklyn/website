// Zip files, read and written: the container a `.quire` document is kept in. Only what a document
// needs is here: entries stored as they are or squeezed with deflate, names in UTF-8, one file to a
// disk and no zip64, so nothing over 4 GB. Deflate itself is the browser's own (CompressionStream and
// DecompressionStream with "deflate-raw"); the checksum, CRC-32, is worked out here from a table.
//
//   const bytes = await writeZip([{ name: "document.md", data: text }]);
//   const files = await readZip(bytes);   // Map of name to bytes

/** One file to put in a zip. Text is written as UTF-8. `store` keeps it as it is, as for a picture that is squeezed already. */
export interface ZipInput {
    name: string;
    data: Uint8Array | string;
    store?: boolean;
}

/** A zip that cannot be read, said in plain words. */
export class ZipError extends Error {}

/** The CRC-32 table: for each byte, what it does to the checksum. */
const TABLE = (() => {
    const table = new Uint32Array(256);
    for (let byte = 0; byte < 256; byte++) {
        let value = byte;
        for (let bit = 0; bit < 8; bit++) value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
        table[byte] = value >>> 0;
    }
    return table;
})();

/** The CRC-32 checksum of some bytes, as zip files carry it. */
export function crc32(bytes: Uint8Array): number {
    let crc = 0xffffffff;
    for (let index = 0; index < bytes.length; index++) crc = TABLE[(crc ^ bytes[index]!) & 0xff]! ^ (crc >>> 8);
    return (crc ^ 0xffffffff) >>> 0;
}

/** Bytes run through one of the browser's compression streams. */
async function through(bytes: Uint8Array, stream: CompressionStream | DecompressionStream): Promise<Uint8Array> {
    const out = new Blob([bytes as BlobPart]).stream().pipeThrough(stream as unknown as TransformStream<Uint8Array, Uint8Array>);
    return new Uint8Array(await new Response(out).arrayBuffer());
}

/** A date and time as zip files keep them, in the old two-second DOS form. */
function dosTime(date: Date): { time: number; day: number } {
    const year = Math.max(1980, date.getFullYear());
    return {
        time: (date.getHours() << 11) | (date.getMinutes() << 5) | (date.getSeconds() >> 1),
        day: ((year - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate(),
    };
}

/** Writes files into a zip. Each is squeezed unless asked not to be or squeezing would not make it smaller. */
export async function writeZip(files: ZipInput[], date = new Date()): Promise<Uint8Array> {
    const encoder = new TextEncoder();
    const { time, day } = dosTime(date);
    const locals: Uint8Array[] = [];
    const centrals: Uint8Array[] = [];
    let offset = 0;
    for (const file of files) {
        const name = encoder.encode(file.name);
        const data = typeof file.data === "string" ? encoder.encode(file.data) : file.data;
        const squeezed = file.store ? undefined : await through(data, new CompressionStream("deflate-raw"));
        const deflated = !!squeezed && squeezed.length < data.length;
        const body = deflated ? squeezed! : data;
        const crc = crc32(data);
        if (data.length > 0xfffffffe || offset > 0xfffffffe) throw new ZipError("this document is too big to keep in a zip");

        // the local header, then the data
        const local = new Uint8Array(30 + name.length);
        const view = new DataView(local.buffer);
        view.setUint32(0, 0x04034b50, true);
        view.setUint16(4, 20, true);
        view.setUint16(6, 0x0800, true); // the name is UTF-8
        view.setUint16(8, deflated ? 8 : 0, true);
        view.setUint16(10, time, true);
        view.setUint16(12, day, true);
        view.setUint32(14, crc, true);
        view.setUint32(18, body.length, true);
        view.setUint32(22, data.length, true);
        view.setUint16(26, name.length, true);
        view.setUint16(28, 0, true);
        local.set(name, 30);
        locals.push(local, body);

        // its line in the directory at the end
        const central = new Uint8Array(46 + name.length);
        const line = new DataView(central.buffer);
        line.setUint32(0, 0x02014b50, true);
        line.setUint16(4, (3 << 8) | 20, true); // made on a Unix-like system, so permissions below are read
        line.setUint16(6, 20, true);
        line.setUint16(8, 0x0800, true);
        line.setUint16(10, deflated ? 8 : 0, true);
        line.setUint16(12, time, true);
        line.setUint16(14, day, true);
        line.setUint32(16, crc, true);
        line.setUint32(20, body.length, true);
        line.setUint32(24, data.length, true);
        line.setUint16(28, name.length, true);
        line.setUint32(38, (0o100644 << 16) >>> 0, true); // an ordinary file anyone may read
        line.setUint32(42, offset, true);
        central.set(name, 46);
        centrals.push(central);
        offset += local.length + body.length;
    }
    const size = centrals.reduce((sum, part) => sum + part.length, 0);
    const end = new Uint8Array(22);
    const tail = new DataView(end.buffer);
    tail.setUint32(0, 0x06054b50, true);
    tail.setUint16(8, files.length, true);
    tail.setUint16(10, files.length, true);
    tail.setUint32(12, size, true);
    tail.setUint32(16, offset, true);
    const parts = [...locals, ...centrals, end];
    const out = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
    let at = 0;
    for (const part of parts) {
        out.set(part, at);
        at += part.length;
    }
    return out;
}

/**
 * The most a zip may hold when it is read, so that a small hostile file cannot unpack to fill the
 * memory (a zip bomb): far more than any real document needs (a long book with hundreds of
 * photographs is well under it), and far less than a tab can hold.
 */
export const LIMITS = { entries: 2_000, entry: 128 * 1024 * 1024, total: 256 * 1024 * 1024 };

/** Squeezed bytes unpacked, stopping as soon as they come to more than the zip said they would, so that the size it gives is the most ever held. */
async function inflate(body: Uint8Array, size: number, name: string): Promise<Uint8Array> {
    const out = new Uint8Array(size);
    let at = 0;
    const reader = new Blob([body as BlobPart]).stream().pipeThrough(new DecompressionStream("deflate-raw") as unknown as TransformStream<Uint8Array, Uint8Array>).getReader();
    try {
        for (;;) {
            const { done, value } = await reader.read();
            if (done) break;
            if (at + value.length > size) throw new ZipError(`${name} is damaged`);
            out.set(value, at);
            at += value.length;
        }
    } catch (error) {
        await reader.cancel().catch(() => undefined);
        // a stream cut short or not deflate at all is a damaged file, said plainly
        throw error instanceof ZipError ? error : new ZipError(`${name} is damaged`);
    }
    if (at !== size) throw new ZipError(`${name} is damaged`);
    return out;
}

/** True for a name that stays inside the zip when it is unpacked: no folder above it, no root, no drive, no backslash, no control character. */
function inside(name: string): boolean {
    if (!name || /^[/\\]|^[a-z]:|\\|[\u0000-\u001f\u007f]/i.test(name)) return false;
    return !name.split("/").some((step) => step === ".." || step === ".");
}

/**
 * Reads a zip into its files by name. Folders are left out. A file that is damaged, cut short,
 * locked, packed some other way, larger than LIMITS, or that names a place outside itself is
 * refused, said in plain words.
 */
export async function readZip(bytes: Uint8Array): Promise<Map<string, Uint8Array>> {
    try {
        return await readEntries(bytes);
    } catch (error) {
        // reading past the end of a damaged file is a damaged file
        throw error instanceof ZipError ? error : new ZipError("this zip is damaged");
    }
}

async function readEntries(bytes: Uint8Array): Promise<Map<string, Uint8Array>> {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    // the directory's end is in the last 22 bytes, or further back by the length of a comment; its comment must reach the end exactly,
    // so that a signature hidden in a comment cannot make this read a different zip from the one another reader sees
    let end = -1;
    for (let at = bytes.length - 22; at >= Math.max(0, bytes.length - 22 - 0xffff); at--) {
        if (view.getUint32(at, true) === 0x06054b50 && at + 22 + view.getUint16(at + 20, true) === bytes.length) {
            end = at;
            break;
        }
    }
    if (end < 0) throw new ZipError("this is not a zip file, or it was cut short");
    const count = view.getUint16(end + 10, true);
    const directory = view.getUint32(end + 12, true);
    let at = view.getUint32(end + 16, true);
    if (count === 0xffff || at === 0xffffffff) throw new ZipError("this zip is too big to open here");
    if (count > LIMITS.entries) throw new ZipError(`this zip holds more than ${LIMITS.entries} files, more than a document has`);
    if (at + directory > end) throw new ZipError("this zip is damaged");
    const decoder = new TextDecoder();
    // the whole directory is read and checked first, so that nothing is unpacked from a zip that would come to too much
    const entries: { name: string; method: number; crc: number; packed: number; size: number; local: number }[] = [];
    const names = new Set<string>();
    let total = 0;
    for (let index = 0; index < count; index++) {
        if (at + 46 > end || view.getUint32(at, true) !== 0x02014b50) throw new ZipError("this zip is damaged");
        const flags = view.getUint16(at + 8, true);
        const method = view.getUint16(at + 10, true);
        const crc = view.getUint32(at + 16, true);
        const packed = view.getUint32(at + 20, true);
        const size = view.getUint32(at + 24, true);
        const nameLength = view.getUint16(at + 28, true);
        const extra = view.getUint16(at + 30, true);
        const comment = view.getUint16(at + 32, true);
        const local = view.getUint32(at + 42, true);
        if (at + 46 + nameLength > end) throw new ZipError("this zip is damaged");
        const name = decoder.decode(bytes.subarray(at + 46, at + 46 + nameLength));
        at += 46 + nameLength + extra + comment;
        if (!inside(name.replace(/\/$/, ""))) throw new ZipError(`this zip names a file outside itself (${JSON.stringify(name.slice(0, 80))}), so it is not opened`);
        if (name.endsWith("/")) continue;
        if (names.has(name)) throw new ZipError(`this zip holds two files named ${name}`);
        names.add(name);
        if (flags & 0x41) throw new ZipError(`${name} is locked with a password`);
        if (method !== 0 && method !== 8) throw new ZipError(`${name} is packed in a way this cannot open`);
        if (size > LIMITS.entry) throw new ZipError(`${name} is too big to open here`);
        total += size;
        if (total > LIMITS.total) throw new ZipError("this zip unpacks to more than can be opened here");
        entries.push({ name, method, crc, packed, size, local });
    }
    const files = new Map<string, Uint8Array>();
    for (const { name, method, crc, packed, size, local } of entries) {
        if (local + 30 > end || view.getUint32(local, true) !== 0x04034b50) throw new ZipError("this zip is damaged");
        const start = local + 30 + view.getUint16(local + 26, true) + view.getUint16(local + 28, true);
        if (start + packed > end) throw new ZipError(`${name} is cut short`);
        const body = bytes.subarray(start, start + packed);
        let data: Uint8Array;
        if (method === 0) {
            if (packed !== size) throw new ZipError(`${name} is damaged`);
            data = body.slice();
        } else data = await inflate(body, size, name);
        if (crc32(data) !== crc) throw new ZipError(`${name} is damaged`);
        files.set(name, data);
    }
    return files;
}
