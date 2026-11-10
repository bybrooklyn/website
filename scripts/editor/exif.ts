// Reads the few things the photo page shows (date taken and exposure) out of
// a picture's EXIF block. Nothing else is read, and the block itself is thrown
// away when the picture is saved, so no location or camera details survive.

export interface Shot {
    taken?: string;
    focal?: number;
    aperture?: number;
    shutter?: string;
    iso?: number;
}

export function readExif(block: Uint8Array | undefined): Shot {
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

        const pointer = directory(u32(4)).get(0x8769);
        if (!pointer) return {};
        const exif = directory(u32(pointer.at));

        const fraction = (tag: number): [number, number] | undefined => {
            const entry = exif.get(tag);
            if (!entry || entry.type !== 5) return undefined;
            const at = u32(entry.at);
            const bottom = u32(at + 4);
            return bottom ? [u32(at), bottom] : undefined;
        };
        const whole = (tag: number): number | undefined => {
            const entry = exif.get(tag);
            if (!entry) return undefined;
            return entry.type === 3 ? u16(entry.at) : entry.type === 4 ? u32(entry.at) : undefined;
        };

        const shot: Shot = {};
        const date = exif.get(0x9003);
        if (date && date.type === 2 && date.count >= 10) {
            const written = bytes.toString("latin1", u32(date.at), u32(date.at) + 10);
            if (/^\d{4}:\d\d:\d\d$/.test(written)) shot.taken = written.replace(/:/g, "-");
        }
        const time = fraction(0x829a);
        if (time && time[0] > 0) shot.shutter = time[0] >= time[1] ? String(Math.round((time[0] / time[1]) * 10) / 10) : `1/${Math.round(time[1] / time[0])}`;
        const stop = fraction(0x829d);
        if (stop) shot.aperture = Math.round((stop[0] / stop[1]) * 10) / 10;
        const length = fraction(0x920a);
        if (length) shot.focal = Math.round(length[0] / length[1]);
        const iso = whole(0x8827);
        if (iso) shot.iso = iso;
        return shot;
    } catch {
        // A damaged or unusual block just means no details.
        return {};
    }
}
