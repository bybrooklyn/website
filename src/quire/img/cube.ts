// Looks as .cube files, the plain text format of 3D and 1D color tables (Adobe's Cube LUT
// specification 1.0, with the input-range lines DaVinci Resolve writes). Reading takes nothing on
// trust: the file's length is bounded before it is split, the size line must say a size from 2 to
// 65 (a 3D table) or 2 to 4096 (a 1D one), every number must be finite, and there must be exactly as
// many entries as the size says. A 3D table larger than 33 a side is sampled down to 33 to be kept in
// the document. Writing gives a 33 a side table of a grade, the whole picture's, with no parts.
//
//   const lut = readCube(await file.text(), file.name);   // throws an Error saying what is wrong
//   const text = writeCube(grade, "srgb", "Warm evening");

import { gradeOne, KEEP_3D, lutData, MOST_1D, prepare, space, type Grade, type Lut, type Space } from "./grade";

/** The largest .cube file read: a 65 a side table written with long numbers is about 12 MB. */
export const MOST_BYTES = 24 * 1024 * 1024;
/** The sizes read, a side for a 3D table. */
export const SIZES_3D = { low: 2, high: 65 };
/** The size written. */
export const WRITTEN = 33;

/** A look read from a .cube file's text, or an Error saying plainly what is wrong with it. */
export function readCube(text: string, name?: string): Lut {
    if (text.length > MOST_BYTES) throw new Error("the file is too large to be a look");
    let kind: "3d" | "1d" | undefined;
    let size = 0;
    let low: [number, number, number] = [0, 0, 0];
    let high: [number, number, number] = [1, 1, 1];
    let title: string | undefined;
    let values: Float32Array | undefined;
    let count = 0;
    let at = 0;
    let line = 0;
    const fail = (why: string): never => {
        throw new Error(`line ${line}: ${why}`);
    };
    const numbers = (words: string[], want: number): number[] => {
        if (words.length !== want) fail(`${want} numbers were expected`);
        const out = words.map(Number);
        if (out.some((each) => !Number.isFinite(each))) fail("a number could not be read");
        return out;
    };
    while (at < text.length) {
        let end = text.indexOf("\n", at);
        if (end < 0) end = text.length;
        const raw = text.slice(at, end).replace(/\r$/, "");
        at = end + 1;
        line++;
        if (raw.length > 4096) fail("the line is too long");
        const trimmed = raw.trim();
        if (!trimmed || trimmed.startsWith("#")) continue;
        const words = trimmed.split(/\s+/);
        const head = words[0]!;
        if (/^[-+.\d]/.test(head)) {
            if (!values) fail("the table starts before its size is given");
            if (count >= values!.length / 3) fail("there are more entries than the size says");
            const triple = numbers(words, 3);
            values!.set(triple, count * 3);
            count++;
            continue;
        }
        if (values && count) fail(`${head} comes after the table has started`);
        const key = head.toUpperCase();
        if (key === "TITLE") title = trimmed.slice(5).trim().replace(/^"|"$/g, "").slice(0, 120);
        else if (key === "LUT_3D_SIZE" || key === "LUT_1D_SIZE") {
            if (kind) fail("the size is given twice");
            kind = key === "LUT_3D_SIZE" ? "3d" : "1d";
            [size] = numbers(words.slice(1), 1) as [number];
            if (!Number.isInteger(size)) fail("the size is not a whole number");
            if (kind === "3d" && (size < SIZES_3D.low || size > SIZES_3D.high)) fail(`a 3D table from ${SIZES_3D.low} to ${SIZES_3D.high} a side can be read, not ${size}`);
            if (kind === "1d" && (size < 2 || size > MOST_1D)) fail(`a 1D table from 2 to ${MOST_1D} entries can be read, not ${size}`);
            values = new Float32Array((kind === "3d" ? size ** 3 : size) * 3);
        } else if (key === "DOMAIN_MIN") low = numbers(words.slice(1), 3) as [number, number, number];
        else if (key === "DOMAIN_MAX") high = numbers(words.slice(1), 3) as [number, number, number];
        else if (key === "LUT_3D_INPUT_RANGE" || key === "LUT_1D_INPUT_RANGE") {
            const [from, to] = numbers(words.slice(1), 2) as [number, number];
            low = [from, from, from];
            high = [to, to, to];
        } else fail(`${head.slice(0, 40)} is not something a .cube file says`);
    }
    if (!kind || !values) throw new Error("the file gives no table size, so it is not a .cube look");
    if (count !== values.length / 3) throw new Error(`the table has ${count} entries where its size says ${values.length / 3}`);
    if (low.some((each, channel) => !(high[channel]! > each)) || low.some((each) => Math.abs(each) > 1e6) || high.some((each) => Math.abs(each) > 1e6)) throw new Error("the domain's lowest is not below its highest");
    if (kind === "3d" && size > KEEP_3D) {
        values = resample(values, size, KEEP_3D);
        size = KEEP_3D;
    }
    const label = title || name?.replace(/\.cube$/i, "").slice(0, 120);
    return { kind, size, low, high, data: lutData(values), ...(label ? { name: label } : {}) };
}

/** A 3D table sampled at the entries of a smaller one, between its own by straight lines in all three directions. */
export function resample(values: Float32Array, from: number, to: number): Float32Array {
    const out = new Float32Array(to ** 3 * 3);
    const step = (from - 1) / (to - 1);
    for (let b = 0; b < to; b++)
        for (let g = 0; g < to; g++)
            for (let r = 0; r < to; r++) {
                const place = [r * step, g * step, b * step];
                const low = place.map((t) => Math.min(from - 2, Math.floor(t)));
                const part = place.map((t, axis) => t - low[axis]!);
                for (let corner = 0; corner < 8; corner++) {
                    const weight = (corner & 1 ? part[0]! : 1 - part[0]!) * ((corner >> 1) & 1 ? part[1]! : 1 - part[1]!) * ((corner >> 2) & 1 ? part[2]! : 1 - part[2]!);
                    if (!weight) continue;
                    const at = low[0]! + (corner & 1) + from * (low[1]! + ((corner >> 1) & 1) + from * (low[2]! + ((corner >> 2) & 1)));
                    for (let channel = 0; channel < 3; channel++) out[(r + to * (g + to * b)) * 3 + channel]! += weight * values[at * 3 + channel]!;
                }
            }
    return out;
}

/** A grade written as a .cube file: a 33 a side table of the grade applied to each entry, red changing fastest, as the specification orders it. */
export function writeCube(grade: Grade, name: Space, title: string): string {
    const ready = prepare(grade, name);
    const numbers = space(name);
    const lines = [`TITLE "${title.replace(/["\n\r]/g, "").slice(0, 120) || "imgQuire look"}"`, "# Written by imgQuire", `LUT_3D_SIZE ${WRITTEN}`, "DOMAIN_MIN 0 0 0", "DOMAIN_MAX 1 1 1"];
    const last = WRITTEN - 1;
    for (let b = 0; b < WRITTEN; b++) for (let g = 0; g < WRITTEN; g++) for (let r = 0; r < WRITTEN; r++) lines.push(gradeOne([r / last, g / last, b / last], ready, numbers).map((value) => value.toFixed(6)).join(" "));
    return `${lines.join("\n")}\n`;
}
