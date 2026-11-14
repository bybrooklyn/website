// What reading and writing a picture's metadata is held to. A phone's photograph (made by sharp, with
// its camera, lens, exposure, when, where and orientation) gives its facts in plain words in each of
// JPEG, PNG and WebP. Kept whole, its Exif goes out byte for byte but upright; kept without the place,
// nothing of where remains; kept none, nothing. What she changes is written in and read back, by this
// reader and by another (sharp's), from JPEG, PNG, WebP and JPEG XL. A hostile, cut short, looping or
// huge file is read quickly to what can be read of it, and never throws.

import { expect, test } from "bun:test";
import sharp from "sharp";
import { crc32 } from "../core/zip";
import { browser, chromium } from "../../../scripts/browser";
import { blocksOf, blocksOut, BOUNDS, exifOut, factsOf, readExif, readIptc, readXmp, withMetadata } from "./metadata";

/** A photograph as a phone gives one, in a format. */
async function photograph(format: "jpeg" | "png" | "webp") {
    const made = sharp({ create: { width: 12, height: 8, channels: 3, background: { r: 200, g: 40, b: 90 } } })
        .withMetadata({ orientation: 6 })
        .withExifMerge({
            IFD0: { Make: "PhoneMaker", Model: "Pocket 9", Artist: "Someone Old", Copyright: "Old rights" },
            IFD2: { DateTimeOriginal: "2026:05:01 09:30:00", ExposureTime: "1/120", FNumber: "18/10", ISOSpeedRatings: "100", FocalLength: "47/10", LensModel: "Pocket wide" },
            IFD3: { GPSLatitudeRef: "N", GPSLatitude: "51/1 30/1 1234/100", GPSLongitudeRef: "W", GPSLongitude: "0/1 7/1 3999/100" },
        });
    return new Uint8Array(await (format === "jpeg" ? made.jpeg() : format === "png" ? made.png() : made.webp({ lossless: true })).toBuffer());
}
const has = (bytes: Uint8Array, words: string) => Buffer.from(bytes).includes(words);

for (const format of ["jpeg", "png", "webp"] as const) {
    test(`a ${format.toUpperCase()} photograph's facts are read in plain words: camera, lens, exposure, date, orientation and place as numbers`, async () => {
        const facts = factsOf(await photograph(format));
        const row = (label: string) => facts.rows.find(([name]) => name === label)?.[1];
        expect(row("Camera")).toBe("PhoneMaker Pocket 9");
        expect(row("Lens")).toBe("Pocket wide");
        expect(row("Exposure")).toBe("1/120 s, f/1.8, ISO 100, 4.7 mm");
        expect(row("Date taken")).toBe("2026-05-01 09:30:00");
        expect(row("Orientation")).toBe("turned a quarter right, shown upright (Exif 6)");
        expect(facts.place!.latitude).toBeCloseTo(51.50343, 4);
        expect(facts.place!.longitude).toBeCloseTo(-0.12778, 4);
        expect(facts.found).toMatchObject({ author: "Someone Old", copyright: "Old rights", date: "2026-05-01 09:30:00" });
        expect(facts.everything.some(([name]) => name === "GPS Latitude")).toBe(true);
    });
}

test("kept whole, the Exif goes out byte for byte but for its orientation, set upright; without the place, the place's bytes are gone; kept none, nothing", async () => {
    const tiff = blocksOf(await photograph("jpeg")).exif!;
    const whole = exifOut(tiff, "all", {})!;
    const differ = [...whole].map((byte, at) => (byte === tiff[at] ? -1 : at)).filter((at) => at >= 0);
    expect(differ.length).toBeLessThanOrEqual(2);
    expect(readExif(whole).find((entry) => entry.tag === 0x0112)!.value).toEqual([1]);
    const noplace = exifOut(tiff, "noplace", {})!;
    expect(readExif(noplace).filter((entry) => entry.ifd === "gps")).toEqual([]);
    expect(readExif(noplace).find((entry) => entry.tag === 0x010f)!.value).toBe("PhoneMaker");
    // the latitude's numbers, 51 30 12.34, are nowhere in it
    expect(Buffer.from(noplace).includes(Buffer.from([0, 0, 0, 51, 0, 0, 0, 1]))).toBe(false);
    expect(exifOut(tiff, "none", {})).toBeUndefined();
});

test("what she changes is written into JPEG, PNG, WebP and JPEG XL, read back by this reader and by sharp's, and the rest kept as chosen", async () => {
    const edits = { caption: "A cat on a wall", alt: "A grey cat asleep", author: "Someone New", copyright: "CC BY 4.0", date: "2026-06-02 10:00:00" };
    for (const format of ["jpeg", "png", "webp"] as const) {
        const original = await photograph(format);
        const blocks = blocksOut(original, "noplace", edits);
        // a fresh file of the same picture, with nothing in it, as an encoder writes one
        const bare = new Uint8Array(await sharp(original).rotate()[format]().toBuffer());
        const written = withMetadata(bare, blocks, crc32, { width: 8, height: 12 });
        const facts = factsOf(written);
        expect(facts.found).toMatchObject({ caption: "A cat on a wall", alt: "A grey cat asleep", author: "Someone New", copyright: "CC BY 4.0" });
        expect(facts.rows.find(([name]) => name === "Camera")?.[1]).toBe("PhoneMaker Pocket 9");
        expect(facts.place).toBeUndefined();
        expect(has(written, "Someone Old")).toBe(false);
        const theirs = await sharp(written).metadata();
        expect(theirs.orientation).toBe(1);
        expect(Buffer.from(theirs.xmp!).toString()).toContain("A cat on a wall");
        expect([theirs.width, theirs.height]).toEqual([8, 12]);
    }
    // a bare JPEG XL codestream is put in a container with its Exif and XMP boxes
    const codestream = new Uint8Array([0xff, 0x0a, 1, 2, 3]);
    const jxl = withMetadata(codestream, blocksOut(await photograph("jpeg"), "all", edits), crc32, { width: 8, height: 12 });
    expect(factsOf(jxl).found.caption).toBe("A cat on a wall");
    expect(factsOf(jxl).place).toBeDefined();
});

test("XMP and IPTC are read for their simple properties and records", () => {
    expect(readXmp('<x:xmpmeta><rdf:Description dc:format="image/jpeg" xmp:Rating="3"><dc:title><rdf:Alt><rdf:li xml:lang="x-default">A &amp; B</rdf:li></rdf:Alt></dc:title></rdf:Description></x:xmpmeta>')).toEqual({ "dc:format": "image/jpeg", "xmp:Rating": "3", "dc:title": "A & B" });
    const iim = new Uint8Array([0x1c, 2, 120, 0, 3, 0x48, 0x69, 0x21, 0x1c, 2, 90, 0, 2, 0x4f, 0x78]);
    expect(readIptc(iim).map((each) => [each.name, each.value])).toEqual([["Caption", "Hi!"], ["City", "Ox"]]);
});

test("a hostile file is read quickly to what can be read of it and never throws: directories that point at each other, counts and offsets past the end, a huge count, garbage", () => {
    // a TIFF whose first directory says it has 65535 entries and whose next points back at itself
    const looping = new Uint8Array(64);
    looping.set([0x4d, 0x4d, 0, 42, 0, 0, 0, 8, 0xff, 0xff]);
    // one real entry pointing to an Exif directory at 8, the same directory again
    looping.set([0x87, 0x69, 0, 4, 0, 0, 0, 1, 0, 0, 0, 8], 10);
    const started = performance.now();
    expect(() => readExif(looping)).not.toThrow();
    expect(readExif(looping).length).toBeLessThan(10);
    const entries = new Uint8Array(20_000);
    entries.set([0x49, 0x49, 42, 0, 8, 0, 0, 0, 0xff, 0xff]);
    for (let at = 10; at + 12 < entries.length; at += 12) entries.set([0x0f, 0x01, 2, 0, 0xff, 0xff, 0xff, 0x7f, 0xf0, 0xff, 0xff, 0x7f], at);
    expect(readExif(entries).length).toBe(0);
    for (const garbage of [new Uint8Array([0xff, 0xd8, 0xff, 0xe1, 0xff, 0xff, 0x45]), new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0, 0, 0, 0, 0xff, 0xff, 0xff, 0xff]), new Uint8Array([0, 0, 0, 1, 0x66, 0x74, 0x79, 0x70]), new Uint8Array(3)]) {
        expect(() => factsOf(garbage)).not.toThrow();
    }
    // an AVIF-shaped file whose boxes claim more than there is
    const boxes = new Uint8Array([0, 0, 0, 16, 0x66, 0x74, 0x79, 0x70, 0x61, 0x76, 0x69, 0x66, 0, 0, 0, 0, 0xff, 0xff, 0xff, 0xff, 0x6d, 0x65, 0x74, 0x61]);
    expect(factsOf(boxes).rows).toEqual([]);
    expect(performance.now() - started).toBeLessThan(500);
    expect(BOUNDS.directories).toBeLessThan(100);
});

test("on the built /imgquire/ page, a phone's photograph shows upright with its facts beside it; a caption written there goes out in JPEG, WebP, PNG, AVIF and JPEG XL as chosen, and none of it unless chosen", async () => {
    const dist = `${import.meta.dir}/../../../dist`;
    if (!chromium() || !(await Bun.file(`${dist}/imgquire/index.html`).exists())) return console.warn("built page test skipped: needs a Chromium and `bun run build`");
    const server = Bun.serve({
        port: 0,
        async fetch(request) {
            let path = new URL(request.url).pathname;
            if (path.endsWith("/")) path += "index.html";
            const file = Bun.file(dist + path);
            return (await file.exists()) ? new Response(file) : new Response("missing", { status: 404 });
        },
    });
    const tab = await browser({ width: 1300, height: 820 });
    const until = async (expression: string, ms = 30_000) => {
        for (const started = Date.now(); Date.now() - started < ms; await tab.wait(100)) if (await tab.run<boolean>(`!!(${expression})`)) return;
        throw new Error(`waited for ${expression}`);
    };
    try {
        await tab.open(`http://localhost:${server.port}/imgquire/`, 1000);
        await tab.click(1296, 400);
        const photo = Buffer.from(await photograph("jpeg")).toString("base64");
        await tab.run(`(() => {
            window.saved = {};
            HTMLAnchorElement.prototype.click = function () { if (!this.download) return; const name = this.download; fetch(this.href).then((answer) => answer.arrayBuffer()).then((buffer) => (window.saved[name] = btoa(String.fromCharCode(...new Uint8Array(buffer))))); };
            const bytes = Uint8Array.from(atob(${JSON.stringify(photo)}), (c) => c.charCodeAt(0));
            const data = new DataTransfer();
            data.items.add(new File([bytes], "IMG_0002.JPG", { type: "image/jpeg" }));
            document.dispatchEvent(new ClipboardEvent("paste", { clipboardData: data, bubbles: true, cancelable: true }));
        })()`);
        // shown upright: the 12 by 8 picture turned a quarter is 8 by 12
        await until("/8 × 12 px/.test(document.querySelector('.quire-img-facts')?.textContent ?? '')");
        await tab.run("document.querySelector('.quire-img-stage').focus()");
        await tab.press("i");
        await until("document.querySelector('.quire-img-facts-panel.open')");
        const rows = await tab.run<string>("document.querySelector('.quire-img-fact-rows').textContent");
        expect(rows).toContain("PhoneMaker Pocket 9");
        expect(rows).toContain("turned a quarter right, shown upright (Exif 6)");
        expect(rows).toContain("51.50343, -0.12777");
        expect(await tab.run("document.querySelector('.quire-img-room').classList.contains('beside')")).toBe(true);
        await tab.run("const caption = document.querySelector('.quire-img-fields input'); caption.value = 'A cat on a wall'; caption.dispatchEvent(new Event('change'))");
        const saved: Record<string, Uint8Array> = {};
        for (const [label, keep] of [["JPEG", "None"], ["JPEG", "No place"], ["WebP", "No place"], ["PNG", "No place"], ["AVIF", "All"], ["JXL", "All"]] as const) {
            await tab.run("document.querySelector('.quire-img-stage').focus()");
            if (!(await tab.run<boolean>("!!document.querySelector('.quire-img-export.open:not(.quire-img-facts-panel)')"))) await tab.press("e");
            await until("document.querySelector('.quire-img-export.open:not(.quire-img-facts-panel)')");
            await tab.run(`[...document.querySelectorAll('.quire-img-format')].find((each) => each.textContent === ${JSON.stringify(keep)}).click()`);
            await tab.run(`[...document.querySelectorAll('.quire-img-format')].find((each) => each.textContent === ${JSON.stringify(label)}).click()`);
            await tab.wait(300);
            const before = await tab.run<number>("Object.keys(window.saved).length");
            await tab.run("[...document.querySelectorAll('.quire-img-export .quire-dialog-dismiss')].find((each) => each.textContent === 'Save').click()");
            await until(`Object.keys(window.saved).length > ${before}`);
            const [name, base64] = await tab.run<[string, string]>("Object.entries(window.saved).at(-1)");
            saved[`${label} ${keep}`] = Uint8Array.from(Buffer.from(base64, "base64"));
            await tab.run("delete window.saved[" + JSON.stringify(name) + "]");
        }
        const none = factsOf(saved["JPEG None"]!);
        // a picture with no steps going out in its own format is its original with where, when and with what cut out: only how it is turned and its colour profile, which change how it looks, stay
        expect(none.rows.map(([name]) => name).filter((name) => name !== "Color profile" && name !== "Orientation")).toEqual([]);
        expect(none.found.caption).toBeUndefined();
        for (const key of ["JPEG No place", "WebP No place", "PNG No place"]) {
            const read = factsOf(saved[key]!);
            expect({ key, caption: read.found.caption, place: read.place, camera: read.rows.find(([name]) => name === "Camera")?.[1] }).toEqual({ key, caption: "A cat on a wall", place: undefined, camera: "PhoneMaker Pocket 9" });
            const theirs = await sharp(saved[key]!).metadata();
            expect([theirs.width, theirs.height, theirs.orientation ?? 1]).toEqual([8, 12, 1]);
        }
        for (const key of ["AVIF All", "JXL All"]) {
            const read = factsOf(saved[key]!);
            expect({ key, caption: read.found.caption, place: !!read.place }).toEqual({ key, caption: "A cat on a wall", place: true });
        }
        expect(tab.errors).toEqual([]);
    } finally {
        await tab.close();
        server.stop(true);
    }
}, 180_000);
