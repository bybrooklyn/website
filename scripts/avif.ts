// Progressive AVIF, by the `avifenc` tool of libavif where it is installed. An ordinary AVIF shows
// nothing until the whole file has arrived. A progressive one holds a first, rougher layer near its
// start, and Chromium draws the whole picture from that, slightly soft, once about a tenth of the file
// is there, then sharpens it when the rest comes; Firefox and Safari show it once it has all arrived,
// as they do an ordinary one. sharp cannot write these, so the tool is run on a PNG of the pixels.
// The files come out about four in a hundred larger and take about three times as long to make.
// Where the tool is missing, or too old to know `--progressive`, nothing is made here and the caller
// writes an ordinary AVIF as before.
//
//   const bytes = await progressiveAvif(png, 58);   // undefined where it cannot be made

import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Sharp } from "sharp";

/**
 * An ordinary AVIF smaller than this is kept as it is: it is there in one round trip, so there is nothing to show early, and measured
 * on the site's own covers and screenshots the progressive file was 15 to 40 in a hundred larger for it.
 */
export const WORTH = 48 * 1024;
/** How much larger than the ordinary file the progressive one may be and still be used (on photographs it was about 4 in a hundred). */
export const ROOM = 1.12;

/** Runs a program and gives what it printed, or undefined if it could not be run or failed. */
const run = (program: string, args: string[]) =>
    new Promise<string | undefined>((done) => {
        execFile(program, args, { maxBuffer: 16 * 1024 * 1024 }, (error, out, err) => done(error ? undefined : `${out}${err}`));
    });

let able: Promise<boolean> | undefined;
/** Whether this machine has an `avifenc` that writes progressive AVIF; found out once. */
export function canWriteProgressive(): Promise<boolean> {
    able ??= run("avifenc", ["--help"]).then((help) => !!help && help.includes("--progressive"));
    return able;
}

/**
 * A PNG's pixels as a progressive AVIF at a quality from 0 to 100 (as sharp counts it) and a speed
 * from 0, the slowest and smallest, to 10; undefined where it cannot be made.
 */
export async function progressiveAvif(png: Uint8Array, quality: number, speed = 6): Promise<Buffer | undefined> {
    if (!(await canWriteProgressive())) return undefined;
    const folder = await mkdtemp(join(tmpdir(), "site-avif-"));
    try {
        await writeFile(join(folder, "in.png"), png);
        const said = await run("avifenc", ["--progressive", "-q", String(Math.round(quality)), "-s", String(speed), join(folder, "in.png"), join(folder, "out.avif")]);
        return said === undefined ? undefined : await readFile(join(folder, "out.avif"));
    } catch {
        return undefined;
    } finally {
        await rm(folder, { recursive: true, force: true });
    }
}

/** Whether an AVIF file says it can be drawn progressively, as `avifdec --info` reads it; undefined where that tool is missing. */
export async function isProgressive(path: string): Promise<boolean | undefined> {
    const said = await run("avifdec", ["--info", path]);
    return said === undefined ? undefined : /Progressive\s*:\s*Available/.test(said);
}

/**
 * A picture as an AVIF at a quality, progressive where that is worth it: the ordinary one is made
 * first (at sharp's `effort`), and kept unless it is large and the progressive one is not much larger.
 * Gives the bytes, the picture's size, and which it is.
 */
export async function avifOf(picture: Sharp, quality: number, effort?: number): Promise<{ data: Buffer; width: number; height: number; progressive: boolean }> {
    const plain = await picture
        .clone()
        .avif({ quality, ...(effort === undefined ? {} : { effort }) })
        .toBuffer({ resolveWithObject: true });
    const ordinary = { data: plain.data, width: plain.info.width, height: plain.info.height, progressive: false };
    if (plain.data.length < WORTH || !(await canWriteProgressive())) return ordinary;
    const made = await progressiveAvif(await picture.clone().png().toBuffer(), quality);
    return made && made.length <= plain.data.length * ROOM ? { ...ordinary, data: made, progressive: true } : ordinary;
}
