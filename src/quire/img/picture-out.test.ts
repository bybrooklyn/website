// What writing one picture out is held to, the same for the picture on the stage and for every picture of a
// batch: with no steps in its own format it is its original (byte for byte when all is kept, with its
// metadata cut out when none is), and with any step it is flattened, made sRGB only when that was chosen
// for a Display P3 picture. That a picture flattened away from the stage gives the stage's own pixels is
// held in the browser (`batch-strip.test.ts`).

import { expect, test } from "bun:test";
import { crc32 } from "../core/zip";
import { converts, writeOut } from "./picture-out";
import { add } from "./steps";

/** A PNG of one pixel with a text chunk in it, which cutting the metadata out takes away. */
function png(): Uint8Array {
    const chunk = (type: string, data: number[]) => {
        const body = new Uint8Array([...new TextEncoder().encode(type), ...data]);
        const crc = crc32(body);
        return [...[data.length >>> 24, (data.length >> 16) & 255, (data.length >> 8) & 255, data.length & 255], ...body, crc >>> 24, (crc >> 16) & 255, (crc >> 8) & 255, crc & 255];
    };
    const header = [0, 0, 0, 1, 0, 0, 0, 1, 8, 6, 0, 0, 0];
    const text = [...new TextEncoder().encode("Comment"), 0, ...new TextEncoder().encode("secret")];
    const pixels = [0x78, 0xda, 0x63, 0xf8, 0xcf, 0xc0, 0xf0, 0x1f, 0x00, 0x05, 0x00, 0x02, 0x01];
    return new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, ...chunk("IHDR", header), ...chunk("tEXt", text), ...chunk("IDAT", pixels), ...chunk("IEND", [])]);
}
const original = { name: "pictures/a.png", width: 1, height: 1, type: "image/png", bytes: 0 };

test("a picture with no steps in its own format is its original: byte for byte when all is kept, its metadata cut out when none is", async () => {
    const bytes = png();
    const never = async (): Promise<ImageData> => {
        throw new Error("not flattened");
    };
    const all = await writeOut({ picture: { original, steps: [] }, bytes, space: "srgb", settings: { format: "png", quality: 1 }, keeping: "all", flatten: never });
    expect([...new Uint8Array(await all.blob.arrayBuffer())]).toEqual([...bytes]);
    const none = await writeOut({ picture: { original, steps: [] }, bytes, space: "srgb", settings: { format: "png", quality: 1 }, keeping: "none", flatten: never });
    const cut = new Uint8Array(await none.blob.arrayBuffer());
    expect(cut.length).toBeLessThan(bytes.length);
    expect(new TextDecoder().decode(cut)).not.toContain("secret");
});

test("a picture with a step is flattened, made sRGB only when chosen for a Display P3 picture", async () => {
    const seen: boolean[] = [];
    const stop = async (convert: boolean): Promise<ImageData> => {
        seen.push(convert);
        throw new Error("stopped here");
    };
    const picture = { original, steps: add([], { type: "crop", rect: { x: 0, y: 0, width: 1, height: 1 } }) };
    for (const [space, srgb] of [["p3", true], ["p3", false], ["srgb", true]] as const) await expect(writeOut({ picture, bytes: png(), space, settings: { format: "png", quality: 1, srgb }, keeping: "none", flatten: stop })).rejects.toThrow("stopped here");
    expect(seen).toEqual([true, false, false]);
    expect(converts({ format: "png", quality: 1, srgb: true }, "p3")).toBe(true);
    expect(converts({ format: "png", quality: 1 }, "p3")).toBe(false);
    // another format than the original's is never the original
    await expect(writeOut({ picture: { original, steps: [] }, bytes: png(), space: "srgb", settings: { format: "webp", quality: 0.8 }, keeping: "none", flatten: stop })).rejects.toThrow("stopped here");
});
