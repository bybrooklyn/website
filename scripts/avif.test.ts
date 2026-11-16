// Progressive AVIF as the site makes it: where `avifenc` is installed, a picture comes out as an AVIF
// that says it can be drawn progressively and opens as the same picture; where it is not, nothing is
// made and the caller is told so by an undefined answer. Skipped, with a notice, without the tool.

import { expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import sharp from "sharp";
import { canWriteProgressive, isProgressive, progressiveAvif } from "./avif";

test("a picture is written as a progressive AVIF that opens as the same picture", async () => {
    if (!(await canWriteProgressive())) return console.warn("avif.test.ts: no avifenc with --progressive on this machine, so nothing was tried");
    // a picture with something in it: bands of color and a slope of light
    const [width, height] = [320, 200];
    const pixels = Buffer.alloc(width * height * 3);
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) pixels.set([(x * 255) / width, y < 100 ? 200 : 60, ((x + y) * 255) / (width + height)], (y * width + x) * 3);
    const png = await sharp(pixels, { raw: { width, height, channels: 3 } }).png().toBuffer();
    const bytes = (await progressiveAvif(png, 60))!;
    expect(bytes.subarray(4, 12).toString("latin1")).toBe("ftypavif");
    const folder = await mkdtemp(join(tmpdir(), "site-avif-test-"));
    try {
        await Bun.write(join(folder, "made.avif"), bytes);
        expect(await isProgressive(join(folder, "made.avif"))).not.toBe(false);
        const back = await sharp(bytes).raw().toBuffer({ resolveWithObject: true });
        expect([back.info.width, back.info.height]).toEqual([width, height]);
        // every seventeenth pixel, each of its three colors, comes back within a few of what went in on average
        let [apart, counted] = [0, 0];
        for (let pixel = 0; pixel < width * height; pixel += 17) for (let color = 0; color < 3; color++, counted++) apart += Math.abs(back.data[pixel * back.info.channels + color]! - pixels[pixel * 3 + color]!);
        expect(apart / counted).toBeLessThan(8);
    } finally {
        await rm(folder, { recursive: true, force: true });
    }
}, 30_000);
