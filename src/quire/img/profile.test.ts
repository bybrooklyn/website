// What colour profiles are held to: the Display P3 profile written here carries the published primaries
// (Apple's own profile's numbers, to four places) and passes its own check; hostile profiles (cut short,
// longer than they are, unsigned, for other numbers, a tag table or a tag reaching past the end, too
// many tags, too large) are refused quickly; the conversion to sRGB keeps white white and a gray gray
// and clips the saturated red to sRGB's red; and a profile put into a JPEG, a WebP and a PNG reads back
// out of each byte for byte, in the place the format keeps it.

import { expect, test } from "bun:test";
import { corePage, quire } from "../../../scripts/core-page";
import { crc32 } from "../core/zip";
import { jpegParts, pngParts, webpParts } from "../core/picture-bytes";
import { blocksOf, spaceOf } from "./metadata";
import { checkProfile, deflated, displayP3Profile, MOST_PROFILE, p3ToSrgb, P3_TO_SRGB, pixelsToSrgb, pngProfile, withProfile } from "./profile";

const profile = displayP3Profile();

test("the Display P3 profile written from the published numbers has Apple's primaries and white, and passes its own check", () => {
    expect(checkProfile(profile)).toEqual(profile);
    expect(profile.length).toBeLessThan(700);
    const view = new DataView(profile.buffer);
    const tag = (name: string) => {
        for (let index = 0; index < view.getUint32(128); index++) if (String.fromCharCode(...profile.subarray(132 + index * 12, 136 + index * 12)) === name) return view.getUint32(136 + index * 12);
        throw new Error(name);
    };
    const xyz = (name: string) => [0, 1, 2].map((at) => view.getInt32(tag(name) + 8 + at * 4) / 65536);
    // Apple's Display P3 profile's red, green and blue (D50)
    const apple = { rXYZ: [0.515121, 0.241196, -0.001053], gXYZ: [0.291977, 0.692245, 0.041885], bXYZ: [0.157104, 0.066574, 0.784073] };
    for (const [name, values] of Object.entries(apple)) xyz(name).forEach((value, at) => expect(Math.abs(value - values[at]!)).toBeLessThan(0.0005));
    expect(spaceOf(withProfile(jpegOf(), profile, crc32, { width: 1, height: 1 })).space).toBe("p3");
});

test("hostile profiles are refused, each at once", () => {
    const changed = (at: number, value: number) => {
        const copy = profile.slice();
        new DataView(copy.buffer).setUint32(at, value);
        return copy;
    };
    const started = performance.now();
    expect(checkProfile(undefined)).toBeUndefined();
    expect(checkProfile(profile.subarray(0, 131))).toBeUndefined();
    expect(checkProfile(profile.subarray(0, profile.length - 1))).toBeUndefined();
    expect(checkProfile(changed(0, 0xffffffff))).toBeUndefined();
    expect(checkProfile(changed(36, 0x41414141))).toBeUndefined();
    expect(checkProfile(changed(16, 0x434d594b))).toBeUndefined();
    expect(checkProfile(changed(128, 100000))).toBeUndefined();
    expect(checkProfile(changed(128, 201))).toBeUndefined();
    expect(checkProfile(changed(136, 0xfffffff0))).toBeUndefined();
    expect(checkProfile(changed(140, 0x7fffffff))).toBeUndefined();
    expect(checkProfile(changed(136, 4))).toBeUndefined();
    const huge = new Uint8Array(MOST_PROFILE + 1);
    huge.set(profile);
    new DataView(huge.buffer).setUint32(0, huge.length);
    expect(checkProfile(huge)).toBeUndefined();
    // a profile longer than its header says is cut to the header's length
    const longer = new Uint8Array(profile.length + 40);
    longer.set(profile);
    expect(checkProfile(longer)).toEqual(profile);
    expect(performance.now() - started).toBeLessThan(50);
});

test("Display P3 to sRGB keeps white white and grays gray, and clips P3's red to sRGB's red", () => {
    const sum = (row: number) => P3_TO_SRGB[row * 3]! + P3_TO_SRGB[row * 3 + 1]! + P3_TO_SRGB[row * 3 + 2]!;
    for (const row of [0, 1, 2]) expect(Math.abs(sum(row) - 1)).toBeLessThan(1e-6);
    expect(P3_TO_SRGB[0]).toBeCloseTo(1.2249, 3);
    expect(P3_TO_SRGB[3]).toBeCloseTo(-0.0421, 3);
    expect(P3_TO_SRGB[8]).toBeCloseTo(1.0983, 3);
    const gray = p3ToSrgb(0.5, 0.5, 0.5);
    for (const value of gray) expect(Math.abs(value - 0.5)).toBeLessThan(1e-6);
    expect([...pixelsToSrgb(Uint8ClampedArray.of(255, 0, 0, 255))]).toEqual([255, 0, 0, 255]);
    // a P3 green beyond sRGB: its green clipped to the top, red and blue to nothing
    expect([...pixelsToSrgb(Uint8ClampedArray.of(0, 255, 0, 200))]).toEqual([0, 255, 0, 200]);
    // a color inside sRGB keeps its look: P3 (200, 60, 50) is sRGB (217, 49, 39) or so
    const [r, g, b] = pixelsToSrgb(Uint8ClampedArray.of(200, 60, 50, 255));
    expect(r).toBeGreaterThan(210);
    expect(g).toBeLessThan(60);
    expect(b).toBeLessThan(50);
});

/** The smallest JPEG the walkers read: a start, a JFIF header, a scan's start and the end. */
function jpegOf(): Uint8Array {
    return Uint8Array.of(0xff, 0xd8, 0xff, 0xe0, 0, 16, 0x4a, 0x46, 0x49, 0x46, 0, 1, 1, 0, 0, 1, 0, 1, 0, 0, 0xff, 0xda, 0, 2, 0xff, 0xd9);
}
/** A PNG of one pixel's chunks: its header, a data chunk and the end. */
function pngOf(): Uint8Array {
    const chunk = (type: string, body: number[]) => {
        const out = new Uint8Array(12 + body.length);
        new DataView(out.buffer).setUint32(0, body.length);
        out.set(new TextEncoder().encode(type), 4);
        out.set(body, 8);
        new DataView(out.buffer).setUint32(8 + body.length, crc32(out.subarray(4, 8 + body.length)));
        return out;
    };
    const parts = [Uint8Array.of(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a), chunk("IHDR", [0, 0, 0, 1, 0, 0, 0, 1, 8, 6, 0, 0, 0]), chunk("IDAT", [1, 2, 3]), chunk("IEND", [])];
    const out = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
    parts.reduce((at, part) => (out.set(part, at), at + part.length), 0);
    return out;
}
/** A simple lossy WebP's chunks: RIFF, WEBP and one VP8 chunk. */
function webpOf(): Uint8Array {
    const body = [0x56, 0x50, 0x38, 0x20, 4, 0, 0, 0, 1, 2, 3, 4];
    return Uint8Array.of(0x52, 0x49, 0x46, 0x46, body.length + 4, 0, 0, 0, 0x57, 0x45, 0x42, 0x50, ...body);
}

test("a profile put into a JPEG, a WebP and a PNG reads back out of each byte for byte, where the format keeps it", async () => {
    const size = { width: 1, height: 1 };
    const jpeg = withProfile(jpegOf(), profile, crc32, size);
    expect(jpegParts(jpeg).map((part) => part.name).slice(0, 3)).toEqual(["ffd8", "ffe0", "ffe2"]);
    expect(blocksOf(jpeg).icc).toEqual(profile);
    // a profile too large for one segment goes in several, in order
    const big = new Uint8Array(150_000);
    big.set(profile);
    new DataView(big.buffer).setUint32(0, big.length);
    expect(blocksOf(withProfile(jpegOf(), big, crc32, size)).icc).toEqual(big);
    expect(withProfile(jpeg, profile, crc32, size)).toBe(jpeg);
    const webp = withProfile(webpOf(), profile, crc32, size);
    expect(webpParts(webp).map((part) => part.name)).toEqual(["VP8X", "ICCP", "VP8 "]);
    expect(webp[20]! & 0x20).toBe(0x20);
    expect(new DataView(webp.buffer).getUint32(4, true)).toBe(webp.length - 8);
    expect(blocksOf(webp).icc).toEqual(profile);
    const png = withProfile(pngOf(), profile, crc32, size, await deflated(profile));
    expect(pngParts(png).map((part) => part.name)).toEqual(["IHDR", "iCCP", "IDAT", "IEND"]);
    expect(await pngProfile(png)).toEqual(profile);
    // a PNG whose profile inflates past the bound, or is not a profile, gives none
    const bomb = withProfile(pngOf(), profile, crc32, size, await deflated(new Uint8Array(MOST_PROFILE + 10)));
    expect(await pngProfile(bomb)).toBeUndefined();
    const junk = withProfile(pngOf(), profile, crc32, size, Uint8Array.of(1, 2, 3, 4));
    expect(await pngProfile(junk)).toBeUndefined();
});

/** The encoders' worker and modules, for a page served over HTTP: the worker built from codec-run.ts, the modules from the site's own folder. */
async function codecFiles(path: string): Promise<Response | undefined> {
    if (path === "/codec-run.ts") {
        const built = await Bun.build({ entrypoints: [`${import.meta.dir}/codec-run.ts`], target: "browser" });
        return new Response(await built.outputs[0]!.text(), { headers: { "Content-Type": "text/javascript" } });
    }
    if (path.startsWith("/quire/codecs/") && /^[\w.-]+\.wasm$/.test(path.slice(14))) return new Response(Bun.file(`${import.meta.dir}/../../../public${path}`), { headers: { "Content-Type": "application/wasm" } });
    return undefined;
}

test("in Chromium, a Display P3 photograph that was only cropped goes out in each of the seven formats with its profile and its numbers, made sRGB its red is sRGB's red, a mark on it is the red picked either way, and the screen is handed its P3 numbers in a P3 canvas", async () => {
    const page = await corePage(
        `
        import { backendFor, gradingWith, loadPicture } from "${quire}/img/draw.ts";
        import { FORMATS } from "${quire}/img/export.ts";
        import { displayP3Profile, pngProfile, pixelsToSrgb } from "${quire}/img/profile.ts";
        import { blocksOf } from "${quire}/img/metadata.ts";
        import { look } from "${quire}/img/steps.ts";
        const icc = displayP3Profile();
        // the fixture: a canvas in Display P3, P3's own red on the left and a green inside sRGB on the right, given out as a PNG with the profile
        const drawn = new OffscreenCanvas(64, 48);
        const pen = drawn.getContext("2d", { colorSpace: "display-p3" });
        pen.fillStyle = "color(display-p3 1 0 0)";
        pen.fillRect(0, 0, 32, 48);
        pen.fillStyle = "color(display-p3 0.3 0.6 0.2)";
        pen.fillRect(32, 0, 32, 48);
        const numbers = pen.getImageData(0, 0, 64, 48, { colorSpace: "display-p3" }).data;
        const fixture = await FORMATS.find((each) => each.key === "png").encode(new ImageData(new Uint8ClampedArray(numbers), 64, 48), 1, { icc });
        const at = (data, x, y, width) => [...data.slice((y * width + x) * 4, (y * width + x) * 4 + 3)];
        // a file's numbers as they are, and as the browser shows them through its profile in a P3 canvas
        const raw = async (blob) => {
            const bitmap = await createImageBitmap(blob, { colorSpaceConversion: "none" });
            const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
            const context = canvas.getContext("2d");
            context.drawImage(bitmap, 0, 0);
            const data = context.getImageData(0, 0, bitmap.width, bitmap.height).data;
            return [at(data, 10, 20, bitmap.width), at(data, 50, 20, bitmap.width)];
        };
        const shown = async (blob) => {
            const bitmap = await createImageBitmap(blob).catch(() => undefined);
            if (!bitmap) return undefined;
            const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
            const context = canvas.getContext("2d", { colorSpace: "display-p3" });
            context.drawImage(bitmap, 0, 0);
            const data = context.getImageData(0, 0, bitmap.width, bitmap.height, { colorSpace: "display-p3" }).data;
            return [at(data, 10, 20, bitmap.width), at(data, 50, 20, bitmap.width)];
        };
        window.fixture = { numbers: [at(numbers, 10, 20, 64), at(numbers, 50, 20, 64)], icc: [...icc], fixtureIcc: [...((await pngProfile(new Uint8Array(await fixture.arrayBuffer()))) ?? [])] };
        window.formats = async (only) => {
            const backend = await backendFor(document.createElement("canvas"), only);
            if (!backend) return undefined;
            const picture = await loadPicture(backend, fixture);
            const steps = look({ original: { name: "pictures/p.png", width: 64, height: 48, type: "image/png", bytes: 1 }, steps: [{ id: "s1", type: "crop", rect: { x: 0, y: 0, width: 62, height: 46 } }] });
            const pixels = await picture.flatten(steps);
            const out = {};
            for (const format of FORMATS) {
                const blob = await format.encode(pixels, 0.95, { icc });
                const bytes = new Uint8Array(await blob.arrayBuffer());
                const found = format.type === "image/png" ? await pngProfile(bytes) : blocksOf(bytes).icc;
                out[format.key] = { icc: found ? [...found] : undefined, raw: await raw(blob), shown: await shown(blob) };
            }
            const converted = await picture.flatten(steps, undefined, gradingWith(steps, "p3", picture.size, true));
            const png = await FORMATS.find((each) => each.key === "png").encode(converted, 1, {});
            out.converted = { raw: await raw(png), expected: [at(pixelsToSrgb(numbers), 10, 20, 64), at(pixelsToSrgb(numbers), 50, 20, 64)], icc: (await pngProfile(new Uint8Array(await png.arrayBuffer()))) ? 1 : 0 };
            picture.destroy();
            return { name: backend.name, out };
        };
        // the screen: the picture drawn in a canvas put in Display P3, and drawn made sRGB as for a canvas that has none
        // a red arrow drawn on the P3 photograph: in the export's P3 numbers it is the red picked, and made sRGB too
        window.marked = async () => {
            const backend = await backendFor(document.createElement("canvas"), "WebGL2");
            const picture = await loadPicture(backend, fixture);
            const steps = look({ original: { name: "pictures/p.png", width: 64, height: 48, type: "image/png", bytes: 1 }, steps: [{ id: "s1", type: "arrow", from: { x: 2, y: 24 }, to: { x: 60, y: 24 }, color: "#ff3b30", thickness: 8 }] });
            const p3 = await picture.flatten(steps, undefined, undefined, "p3");
            const srgb = await picture.flatten(steps, undefined, gradingWith(steps, "p3", picture.size, true), "p3");
            picture.destroy();
            return { p3: at(p3.data, 20, 24, 64), back: at(pixelsToSrgb(p3.data), 20, 24, 64), srgb: at(srgb.data, 20, 24, 64) };
        };
        window.screen = async () => {
            const canvas = document.createElement("canvas");
            canvas.width = 64;
            canvas.height = 48;
            const backend = await backendFor(canvas, "WebGL2");
            const picture = await loadPicture(backend, fixture);
            const steps = look({ original: { name: "pictures/p.png", width: 64, height: 48, type: "image/png", bytes: 1 }, steps: [] });
            const read = (space) => {
                const copy = new OffscreenCanvas(64, 48).getContext("2d", { colorSpace: space });
                copy.drawImage(canvas, 0, 0);
                const data = copy.getImageData(0, 0, 64, 48, { colorSpace: space }).data;
                return [at(data, 10, 20, 64), at(data, 50, 20, 64)];
            };
            const took = picture.colors("display-p3");
            picture.draw({ look: steps, view: { scale: 1, x: 0, y: 0 }, canvas: { width: 64, height: 48 } });
            const p3 = read("display-p3");
            picture.colors("srgb");
            picture.draw({ look: steps, view: { scale: 1, x: 0, y: 0 }, canvas: { width: 64, height: 48 }, grading: gradingWith(steps, "p3", picture.size, true) });
            const srgb = read("srgb");
            return { took, p3, srgb, expected: [at(pixelsToSrgb(numbers), 10, 20, 64), at(pixelsToSrgb(numbers), 50, 20, 64)] };
        };
    `,
        { args: ["--enable-unsafe-webgpu"], files: codecFiles },
    );
    if (!page) return;
    try {
        const fixture = await page.tab.run<{ numbers: number[][]; icc: number[]; fixtureIcc: number[] }>("window.fixture");
        expect(fixture.numbers[0]).toEqual([255, 0, 0]);
        expect(fixture.fixtureIcc).toEqual(fixture.icc);
        const near = (a: number[], b: number[], within: number) => a.every((value, index) => Math.abs(value - b[index]!) <= within);
        for (const only of ["WebGL2", "WebGPU"]) {
            const made = await page.tab.run<{ name: string; out: Record<string, { icc?: number[]; raw: number[][]; shown?: number[][]; expected?: number[][] }> } | undefined>(`window.formats(${JSON.stringify(only)})`);
            if (!made) {
                console.log(`${only}: not in this browser`);
                continue;
            }
            for (const [key, found] of Object.entries(made.out)) {
                if (key === "converted") continue;
                const lossless = key === "png" || key.endsWith("lossless");
                // the numbers are the photograph's, to the bit where nothing is lost
                found.raw.forEach((pixel, index) => expect([key, near(pixel, fixture.numbers[index]!, lossless ? 0 : 6)]).toEqual([key, true]));
                // the profile is there byte for byte (a JPEG XL keeps it inside its codestream, where only a decoder reads it)
                if (!key.startsWith("jxl")) expect([key, found.icc]).toEqual([key, fixture.icc]);
                // and the browser shows the picture through it: in a P3 canvas, its own numbers
                if (found.shown) found.shown.forEach((pixel, index) => expect([key, pixel, near(pixel, fixture.numbers[index]!, lossless ? 1 : 6)]).toEqual([key, pixel, true]));
                else console.log(`${key}: this browser does not show it, so its profile was not read back`);
            }
            const converted = made.out.converted!;
            converted.raw.forEach((pixel, index) => expect(near(pixel, converted.expected![index]!, 1)).toBe(true));
            expect(converted.raw[0]).toEqual([255, 0, 0]);
            expect(converted.icc as unknown).toBe(0);
        }
        const marked = await page.tab.run<{ p3: number[]; back: number[]; srgb: number[] }>("window.marked()");
        // the mark's red is #ff3b30 whichever way the export goes; in P3's numbers it is less red than 255
        expect(near(marked.back, [255, 59, 48], 2)).toBe(true);
        expect(near(marked.srgb, [255, 59, 48], 2)).toBe(true);
        expect(marked.p3[0]).toBeLessThan(245);
        const screen = await page.tab.run<{ took: boolean; p3: number[][]; srgb: number[][]; expected: number[][] }>("window.screen()");
        if (screen.took) screen.p3.forEach((pixel, index) => expect(near(pixel, fixture.numbers[index]!, 1)).toBe(true));
        else console.log("this browser's WebGL2 canvas has no Display P3");
        screen.srgb.forEach((pixel, index) => expect(near(pixel, screen.expected[index]!, 1)).toBe(true));
    } finally {
        await page.close();
    }
}, 120_000);
