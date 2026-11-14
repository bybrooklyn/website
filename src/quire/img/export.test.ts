// What getting a picture out is held to: the search for a weight finds the highest quality under it
// in a few tries and says when even the lowest is over; settings kept in the browser are read back
// checked; a weight is read from what is typed and said in a few characters; a saved picture is named
// from its document; and an original given out unchanged loses where it was taken and keeps its pixels.
// That the browser's encoders carry no metadata is held in the editor's browser test.

import { expect, test } from "bun:test";
import { exportName, formatOf, FORMATS, readSettings, readWeight, underWeight, untouched, weightSaid } from "./export";

/** An encoder whose result weighs what a quality says, counting how often it is asked. */
function pretend(weigh: (quality: number) => number) {
    const asked: number[] = [];
    return { asked, encode: async (quality: number) => (asked.push(quality), new Blob([new Uint8Array(Math.round(weigh(quality)))])) };
}

test("the highest quality under a weight is found in a few tries, to within a hundredth", async () => {
    const encoder = pretend((quality) => 100_000 + quality * 400_000);
    const found = await underWeight(encoder.encode, 200_000);
    expect(found.over).toBe(false);
    expect(found.blob.size).toBeLessThanOrEqual(200_000);
    expect(found.quality).toBeGreaterThan(0.24);
    expect(found.quality).toBeLessThanOrEqual(0.25);
    expect(encoder.asked.length).toBeLessThanOrEqual(8);
});

test("a picture already under the weight at the best quality takes that, and one over it even at the lowest says so", async () => {
    expect(await underWeight(pretend(() => 10).encode, 1000).then((found) => found.quality)).toBe(0.95);
    const heavy = await underWeight(pretend(() => 5000).encode, 1000);
    expect(heavy).toMatchObject({ quality: 0.05, over: true });
});

test("settings kept in the browser are read back checked, with the defaults for what is missing or wrong", () => {
    expect(readSettings(null)).toEqual({ format: "webp", quality: 0.85 });
    expect(readSettings('{"format":"jpeg","quality":0.7,"target":200000}')).toEqual({ format: "jpeg", quality: 0.7, target: 200_000 });
    expect(readSettings('{"format":"exe","quality":9,"target":-1}')).toEqual({ format: "png", quality: 0.85 });
    expect(readSettings("{broken")).toEqual({ format: "webp", quality: 0.85 });
});

test("a weight is read from what is typed, a bare number being kilobytes, and said in a few characters", () => {
    expect(readWeight("200")).toBe(200_000);
    expect(readWeight("1.5 MB")).toBe(1_500_000);
    expect(readWeight("900b")).toBeUndefined();
    expect(readWeight("lots")).toBeUndefined();
    expect(weightSaid(940)).toBe("940 B");
    expect(weightSaid(412_300)).toBe("412 KB");
    expect(weightSaid(3_420_000)).toBe("3.4 MB");
    expect(weightSaid(23_400_000)).toBe("23 MB");
});

test("a saved picture is named from its document, with the format's ending, and every format is one line of the table", () => {
    expect(exportName("Screenshot, 14 Nov 2026 01:30", formatOf("webp"))).toBe("screenshot-14-nov-2026-01-30.webp");
    expect(exportName("cat.png", formatOf("jpeg"))).toBe("cat.jpg");
    expect(FORMATS.map((format) => format.key)).toEqual(["png", "jpeg", "webp"]);
});

test("an original given out unchanged has where it was taken cut out and keeps every pixel's bytes", () => {
    // a JPEG of nothing but its start, an Exif segment saying where, and its end
    const where = new TextEncoder().encode("Exif\0\0GPS 51.5N 0.1W");
    const jpeg = Uint8Array.from([0xff, 0xd8, 0xff, 0xe1, 0, where.length + 2, ...where, 0xff, 0xda, 0, 2, 1, 2, 3, 0xff, 0xd9]);
    const clean = untouched(jpeg);
    expect(new TextDecoder().decode(clean)).not.toContain("GPS");
    expect([...clean.slice(-9)]).toEqual([0xff, 0xda, 0, 2, 1, 2, 3, 0xff, 0xd9]);
});
