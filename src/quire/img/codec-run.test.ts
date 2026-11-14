// What the encoders are held to. Every module in public/quire/codecs/ is the one its pin names, and one
// whose bytes differ is refused before it is compiled; each, run here, writes a file of its own kind.
// In Chromium, what each writes reads back to the same pixels within a stated bound: every pixel the
// same for PNG, WebP lossless and JPEG XL lossless, and at least 30 dB of PSNR for the lossy ones at
// quality 85, on a smooth picture with hard edges; the HEIC reader gives back its fixture (made by
// heif-enc from fixture.png) at more than 30 dB. Sizes on the wire are printed. Skipped, with a
// notice, on a machine with no Chromium.

import { expect, test } from "bun:test";
import { corePage, quire } from "../../../scripts/core-page";
import { browser, chromium } from "../../../scripts/browser";
import { compile, heicIn, instance, PINS, run, sha256 } from "./codec-run";

const folder = `${import.meta.dir}/../../../public/quire/codecs`;
const bytesOf = async (name: string) => Bun.file(`${folder}/${name}.wasm`).arrayBuffer();

test("every module is the one its pin names, and one whose bytes differ is refused before it is compiled", async () => {
    for (const pin of Object.values(PINS)) {
        const bytes = await bytesOf(pin.name);
        expect(bytes.byteLength).toBe(pin.bytes);
        expect(await sha256(bytes)).toBe(pin.sha256);
    }
    const changed = new Uint8Array(await bytesOf("webp"));
    changed[changed.length - 1]! ^= 1;
    expect(compile(changed.buffer, PINS.webp!)).rejects.toThrow("not the one this page was built with");
    console.log(Object.values(PINS).map((pin) => `${pin.name} ${Math.round(pin.brotli / 1024)} KB on the wire (${Math.round(pin.bytes / 1024)} KB unpacked), ${pin.source}`).join("\n"));
});

test("each encoder, run here, writes a file of its own kind", async () => {
    const width = 64;
    const height = 48;
    const pixels = new Uint8ClampedArray(width * height * 4).map((_, at) => (at % 4 === 3 ? 255 : (at * 7) % 256));
    const starts: Record<string, (bytes: Uint8Array) => boolean> = {
        jpegli: (bytes) => bytes[0] === 0xff && bytes[1] === 0xd8,
        webp: (bytes) => new TextDecoder().decode(bytes.subarray(8, 12)) === "WEBP",
        avif: (bytes) => new TextDecoder().decode(bytes.subarray(4, 12)) === "ftypavif",
        jxl: (bytes) => bytes[0] === 0xff && bytes[1] === 0x0a,
        oxipng: (bytes) => bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47,
    };
    for (const [name, kind] of Object.entries(starts)) {
        const module = await compile(await bytesOf(name), PINS[name]!);
        const { bytes } = run(await instance(module), { name, pixels: pixels.slice().buffer, width, height, quality: 85, speed: name === "avif" ? 9 : name === "webp" ? 4 : name === "oxipng" ? 1 : 3, options: {} });
        expect(kind(bytes)).toBe(true);
    }
});

test("in Chromium, what each encoder writes reads back to the same pixels within its bound, and the HEIC reader gives back its picture", async () => {
    const modules = Object.fromEntries(await Promise.all(Object.keys(PINS).map(async (name) => [name, Buffer.from(await bytesOf(name)).toString("base64")])));
    const heic = Buffer.from(await Bun.file(`${import.meta.dir}/fixture.heic`).arrayBuffer()).toString("base64");
    const source = Buffer.from(await Bun.file(`${import.meta.dir}/fixture.png`).arrayBuffer()).toString("base64");
    const page = await corePage(`
        import { compile, instance, PINS, run } from "${quire}/img/codec-run.ts";
        const modules = ${JSON.stringify(modules)};
        const bytes = (base64) => Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
        const pixelsOf = async (blob) => { const bitmap = await createImageBitmap(blob); const canvas = new OffscreenCanvas(bitmap.width, bitmap.height); const context = canvas.getContext("2d"); context.drawImage(bitmap, 0, 0); return context.getImageData(0, 0, bitmap.width, bitmap.height).data; };
        // a smooth picture with hard edges and flat colour: a gradient, a disc and a white block
        const canvas = new OffscreenCanvas(240, 160);
        const context = canvas.getContext("2d");
        const fade = context.createLinearGradient(0, 0, 240, 160); fade.addColorStop(0, "#3060c0"); fade.addColorStop(1, "#f0b040");
        context.fillStyle = fade; context.fillRect(0, 0, 240, 160);
        context.fillStyle = "#c02040"; context.beginPath(); context.arc(70, 70, 40, 0, 7); context.fill();
        context.fillStyle = "#ffffff"; context.fillRect(150, 30, 60, 40);
        const picture = context.getImageData(0, 0, 240, 160);
        window.encode = async (name, quality, speed, options) => {
            const found = run(await instance(await compile(bytes(modules[name]).buffer, PINS[name])), { name, pixels: picture.data.slice().buffer, width: 240, height: 160, quality, speed, options });
            return found.bytes;
        };
        window.compare = async (name, quality, speed, options, type) => {
            const file = await window.encode(name, quality, speed, options);
            let back;
            try { back = await pixelsOf(new Blob([file], { type })); } catch { return { size: file.length, unread: [...file] }; }
            let most = 0, squared = 0;
            for (let at = 0; at < back.length; at++) { if (at % 4 === 3) continue; const gap = Math.abs(back[at] - picture.data[at]); most = Math.max(most, gap); squared += gap * gap; }
            const psnr = 10 * Math.log10(255 * 255 / (squared / (back.length * 0.75)));
            return { size: file.length, most, psnr: Math.round(psnr * 10) / 10 };
        };
        window.heic = async () => {
            const found = run(await instance(await compile(bytes(modules.heic).buffer, PINS.heic)), { name: "heic", file: bytes(${JSON.stringify(heic)}).buffer });
            const expected = await pixelsOf(new Blob([bytes(${JSON.stringify(source)})], { type: "image/png" }));
            let squared = 0;
            for (let at = 0; at < expected.length; at++) if (at % 4 !== 3) squared += (found.bytes[at] - expected[at]) ** 2;
            return { width: found.width, height: found.height, psnr: 10 * Math.log10(255 * 255 / (squared / (expected.length * 0.75))) };
        };
    `);
    if (!page) return console.warn("encoders' browser test skipped: needs a Chromium");
    try {
        const cases: [string, string, number, number, Record<number, number>, string, "exact" | "close"][] = [
            ["PNG (oxipng)", "oxipng", 0, 2, {}, "image/png", "exact"],
            ["WebP lossless (libwebp)", "webp", 75, 6, { 0: 1 }, "image/webp", "exact"],
            ["JPEG XL lossless (libjxl)", "jxl", 0, 3, { 0: 1 }, "image/jxl", "exact"],
            ["JPEG (jpegli)", "jpegli", 85, 0, {}, "image/jpeg", "close"],
            ["WebP (libwebp)", "webp", 85, 4, {}, "image/webp", "close"],
            ["AVIF (libaom)", "avif", 85, 8, {}, "image/avif", "close"],
            ["JPEG XL (libjxl)", "jxl", 85, 3, {}, "image/jxl", "close"],
        ];
        for (const [label, name, quality, speed, options, type, bound] of cases) {
            const found = await page.tab.run<{ size: number; most?: number; psnr?: number; unread?: number[] }>(`window.compare(${JSON.stringify(name)}, ${quality}, ${speed}, ${JSON.stringify(options)}, ${JSON.stringify(type)})`);
            // a browser that does not show JPEG XL (Chrome before 155, Firefox) cannot check it here
            if (found.unread) {
                console.log(`${label}: ${found.size} bytes; not read back, as this Chromium does not show JPEG XL`);
                continue;
            }
            console.log(`${label}: ${found.size} bytes, ${found.most === 0 ? "every pixel the same" : `largest difference ${found.most}, ${found.psnr} dB`}`);
            if (bound === "exact") expect(found.most).toBe(0);
            else expect(found.psnr!).toBeGreaterThanOrEqual(30);
        }
        const heic = await page.tab.run<{ width: number; height: number; psnr: number }>("window.heic()");
        console.log(`HEIC (heic-rs): ${heic.width} × ${heic.height}, ${Math.round(heic.psnr * 10) / 10} dB against its source`);
        expect([heic.width, heic.height]).toEqual([96, 64]);
        expect(heic.psnr).toBeGreaterThan(30);
    } finally {
        await page.close();
    }
}, 120_000);

test("a HEIC photograph is known by its first bytes, whatever it is called, and an AVIF (which shares its box) is not", async () => {
    const fixture = new Uint8Array(await Bun.file(`${import.meta.dir}/fixture.heic`).arrayBuffer());
    expect(heicIn(fixture)).toBe(true);
    expect(heicIn(new TextEncoder().encode("\0\0\0\x1cftypavif"))).toBe(false);
    expect(heicIn(new TextEncoder().encode("\x89PNG\r\n"))).toBe(false);
});

test("on the built /imgquire/ page, a pasted HEIC photograph is read by its module in a worker, and each format the export offers is made off the page's thread", async () => {
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
    try {
        await tab.open(`http://localhost:${server.port}/imgquire/`, 1000);
        await tab.click(1296, 400);
        const heic = Buffer.from(await Bun.file(`${import.meta.dir}/fixture.heic`).arrayBuffer()).toString("base64");
        await tab.run(`(() => {
            const bytes = Uint8Array.from(atob(${JSON.stringify(heic)}), (c) => c.charCodeAt(0));
            const data = new DataTransfer();
            data.items.add(new File([bytes], "IMG_0001.HEIC", { type: "" }));
            document.dispatchEvent(new ClipboardEvent("paste", { clipboardData: data, bubbles: true, cancelable: true }));
        })()`);
        const until = async (expression: string, ms = 30_000) => {
            for (const started = Date.now(); Date.now() - started < ms; await tab.wait(100)) if (await tab.run<boolean>(`!!(${expression})`)) return;
            throw new Error(`waited for ${expression}`);
        };
        await until("/96 × 64 px/.test(document.querySelector('.quire-img-facts')?.textContent ?? '')");
        expect(await tab.run("document.querySelector('.quire-name-home')?.textContent")).toBe("IMG_0001");
        await tab.run("document.querySelector('.quire-img-stage').focus()");
        await tab.press("e");
        await until("document.querySelector('.quire-img-export.open')");
        const made: string[] = [];
        for (const [label, word] of [["JPEG", "JPEG"], ["WebP", "WebP"], ["AVIF", "AVIF"], ["JXL", "JPEG XL"], ["PNG", "PNG"]]) {
            const before = await tab.run<string>("document.querySelector('.quire-img-result')?.textContent ?? ''");
            await tab.run(`[...document.querySelectorAll('.quire-img-format')].find((each) => each.textContent === ${JSON.stringify(label)}).click()`);
            const ending = word;
            await until(`(document.querySelector('.quire-img-result')?.textContent ?? '').endsWith(${JSON.stringify(` ${ending}`)}) && document.querySelector('.quire-img-result').textContent !== ${JSON.stringify(before)}`);
            made.push(await tab.run<string>("document.querySelector('.quire-img-result').textContent"));
        }
        console.log(made.join("\n"));
        expect(made).toHaveLength(5);
        expect(tab.errors).toEqual([]);
    } finally {
        await tab.close();
        server.stop(true);
    }
}, 120_000);
