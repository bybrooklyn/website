// Bytes written and read for the converter's containers (Ogg, WebM, MP4): a growing buffer that numbers
// are written into big-endian or little-endian, and a file read a range at a time through Blob.slice, so
// that a long film is never held whole: only the part being read is in memory.
//
//   out = new Bytes(); out.u32(8); out.text("ftyp"); out.done()
//   file = sourceOf(blob); head = await file.read(0, 16);

/** A buffer that grows as numbers, text and bytes are written into it. */
export class Bytes {
    private buffer = new Uint8Array(256);
    private view = new DataView(this.buffer.buffer);
    /** How many bytes are written. */
    length = 0;

    private room(more: number) {
        if (this.length + more <= this.buffer.length) return;
        let size = this.buffer.length * 2;
        while (size < this.length + more) size *= 2;
        const bigger = new Uint8Array(size);
        bigger.set(this.buffer.subarray(0, this.length));
        this.buffer = bigger;
        this.view = new DataView(bigger.buffer);
    }

    /** One byte. */
    u8(value: number) {
        this.room(1);
        this.buffer[this.length++] = value & 0xff;
        return this;
    }

    /** Two bytes, big-endian unless asked. */
    u16(value: number, little = false) {
        this.room(2);
        this.view.setUint16(this.length, value, little);
        this.length += 2;
        return this;
    }

    /** Three bytes, big-endian. */
    u24(value: number) {
        return this.u8(value >>> 16).u8(value >>> 8).u8(value);
    }

    /** Four bytes, big-endian unless asked. */
    u32(value: number, little = false) {
        this.room(4);
        this.view.setUint32(this.length, value >>> 0, little);
        this.length += 4;
        return this;
    }

    /** Eight bytes, big-endian unless asked, for a whole number up to 2 to the 53rd. */
    u64(value: number, little = false) {
        this.room(8);
        this.view.setBigUint64(this.length, BigInt(Math.max(0, Math.round(value))), little);
        this.length += 8;
        return this;
    }

    /** A signed number in two bytes, big-endian. */
    i16(value: number) {
        this.room(2);
        this.view.setInt16(this.length, value);
        this.length += 2;
        return this;
    }

    /** A 64-bit float, big-endian. */
    f64(value: number) {
        this.room(8);
        this.view.setFloat64(this.length, value);
        this.length += 8;
        return this;
    }

    /** Text in single bytes, as box names and Ogg's marks are. */
    text(value: string) {
        for (let at = 0; at < value.length; at++) this.u8(value.charCodeAt(at));
        return this;
    }

    /** Bytes as they are. */
    bytes(value: Uint8Array) {
        this.room(value.length);
        this.buffer.set(value, this.length);
        this.length += value.length;
        return this;
    }

    /** Puts a 32-bit big-endian number at a place already written, as a size known only afterwards. */
    put32(at: number, value: number) {
        this.view.setUint32(at, value >>> 0);
    }

    /** What has been written, as its own bytes. */
    done(): Uint8Array {
        return this.buffer.slice(0, this.length);
    }
}

/** A file read a range at a time. */
export interface Source {
    size: number;
    read(at: number, length: number): Promise<Uint8Array>;
}

/** A blob as a source: each read is a slice, so only what is read is in memory. */
export function sourceOf(blob: Blob): Source {
    return {
        size: blob.size,
        async read(at, length) {
            const end = Math.min(blob.size, at + length);
            if (end <= at) return new Uint8Array();
            return new Uint8Array(await blob.slice(at, end).arrayBuffer());
        },
    };
}

/** A view for reading numbers out of bytes. */
export const viewOf = (bytes: Uint8Array) => new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

/** Text out of single bytes. */
export const textOf = (bytes: Uint8Array, from = 0, to = bytes.length) => String.fromCharCode(...bytes.subarray(from, to));

/** Bytes joined into one. */
export function joined(parts: Uint8Array[]): Uint8Array {
    const out = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
    let at = 0;
    for (const part of parts) {
        out.set(part, at);
        at += part.length;
    }
    return out;
}
