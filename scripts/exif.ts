// Reads the date a picture was taken from its EXIF block. The block itself is
// dropped when the picture is saved, so no location or camera details survive.

export function readExif(block: Uint8Array | undefined): { taken?: string } {
    try {
        if (!block) return {};
        let bytes = Buffer.from(block);
        if (bytes.toString("latin1", 0, 4) === "Exif") bytes = bytes.subarray(6);
        const little = bytes.toString("latin1", 0, 2) === "II";
        const u16 = (at: number) => (little ? bytes.readUInt16LE(at) : bytes.readUInt16BE(at));
        const u32 = (at: number) => (little ? bytes.readUInt32LE(at) : bytes.readUInt32BE(at));

        /** A directory of entries: tag to where its value sits, and how many values there are. */
        const directory = (offset: number) => {
            const entries = new Map<number, { type: number; count: number; at: number }>();
            const total = u16(offset);
            for (let index = 0; index < total; index++) {
                const entry = offset + 2 + index * 12;
                entries.set(u16(entry), { type: u16(entry + 2), count: u32(entry + 4), at: entry + 8 });
            }
            return entries;
        };

        // 0x8769 points at the EXIF directory; 0x9003 in it is the original date, "2026:05:03 19:42:10".
        const pointer = directory(u32(4)).get(0x8769);
        const date = pointer && directory(u32(pointer.at)).get(0x9003);
        if (!date || date.type !== 2 || date.count < 10) return {};
        const written = bytes.toString("latin1", u32(date.at), u32(date.at) + 10);
        return /^\d{4}:\d\d:\d\d$/.test(written) ? { taken: written.replace(/:/g, "-") } : {};
    } catch {
        // A damaged or unusual block just means no date.
        return {};
    }
}
