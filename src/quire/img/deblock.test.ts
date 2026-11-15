// What repairing a JPEG is held to, measured: a JPEG's own bytes give its tables, its sampling and the
// quality it was made at; the waves of a block go there and back unchanged; a repair held to the file stays
// within what the file allows; and on clean pictures (photographs from the site made small, so that their
// own compression is gone, screenshots kept as PNG, and drawings made here) compressed hard by libjpeg
// through sharp, the repair comes nearer the clean picture than the decoded JPEG does by PSNR, on average for
// every kind at every quality up to the one the editor offers it at, and no single picture comes out more
// than a twentieth of a decibel worse. The table of numbers, with SSIM, is printed.

import { expect, test } from "bun:test";
import sharp from "sharp";
import { consistent, jpegFacts, MOST_QUALITY, qualityOf, reapply, repair, shiftsOf } from "./deblock";

const root = `${import.meta.dir}/../../..`;

/** The clean pictures: each its name, kind and pixels at no more than 640 wide, RGBA. */
async function cleanPictures(): Promise<{ name: string; kind: string; width: number; height: number; pixels: Uint8Array }[]> {
    const from = async (name: string, kind: string, input: string | Buffer, width = 640) => {
        const { data, info } = await sharp(input).resize({ width, withoutEnlargement: true }).flatten({ background: "#ffffff" }).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
        return { name, kind, width: info.width, height: info.height, pixels: new Uint8Array(data) };
    };
    // a drawing made here: flat colours, lines and a gradient, as a chart or a diagram has
    const drawing = Buffer.from(
        `<svg xmlns="http://www.w3.org/2000/svg" width="640" height="420"><defs><linearGradient id="g" x1="0" x2="1"><stop offset="0" stop-color="#2a6fdb"/><stop offset="1" stop-color="#f2c14e"/></linearGradient></defs><rect width="640" height="420" fill="#fbfaf7"/><rect x="30" y="30" width="580" height="60" fill="url(#g)"/>${[0, 1, 2, 3, 4, 5].map((at) => `<rect x="${60 + at * 90}" y="${330 - at * 35}" width="50" height="${at * 35 + 30}" fill="${["#d1495b", "#edae49", "#00798c", "#30638e", "#003d5b", "#66a182"][at]}"/>`).join("")}<polyline points="40,380 140,250 240,300 340,170 440,220 600,120" fill="none" stroke="#222" stroke-width="3"/><circle cx="520" cy="300" r="50" fill="none" stroke="#d1495b" stroke-width="6"/><text x="40" y="410" font-family="sans-serif" font-size="16" fill="#333">Monthly totals, 2026</text></svg>`,
    );
    return Promise.all([
        // photographs from the photos page, a river, flowers and grass, read at a sixth of their size or less
        from("river", "photograph", `${root}/public/photos/20250409-111238-2.avif`),
        from("flowers", "photograph", `${root}/public/photos/20250601-102213.avif`),
        from("grass", "photograph", `${root}/public/photos/20250430-072015.avif`),
        // screenshots kept losslessly
        from("settings", "screenshot", `${root}/src/assets/projects/yqt/settings.png`, 1000),
        from("jobs", "screenshot", `${root}/src/assets/projects/flummox/jobs.png`, 1100),
        from("menu", "screenshot", `${root}/src/assets/projects/mfetchy/menu.png`, 1500),
        // drawings: the one made here, and a cover drawn for the site
        from("chart", "drawing", drawing),
        from("cover", "drawing", `${root}/src/assets/projects/torrens-serif/cover.png`),
    ]);
}

/** PSNR of the red, green and blue against the clean picture, in decibels. */
function psnr(a: Uint8Array | Uint8ClampedArray, b: Uint8Array | Uint8ClampedArray): number {
    let sum = 0;
    let count = 0;
    for (let at = 0; at < a.length; at++) {
        if (at % 4 === 3) continue;
        sum += (a[at]! - b[at]!) ** 2;
        count++;
    }
    return 10 * Math.log10((255 * 255) / Math.max(1e-9, sum / count));
}

/** SSIM of the luminance, over 8 by 8 windows four apart (Wang and others' constants), averaged. */
function ssim(a: Uint8Array | Uint8ClampedArray, b: Uint8Array | Uint8ClampedArray, width: number, height: number): number {
    const luma = (p: Uint8Array | Uint8ClampedArray, k: number) => 0.299 * p[k * 4]! + 0.587 * p[k * 4 + 1]! + 0.114 * p[k * 4 + 2]!;
    const c1 = (0.01 * 255) ** 2;
    const c2 = (0.03 * 255) ** 2;
    let total = 0;
    let windows = 0;
    for (let y = 0; y + 8 <= height; y += 4)
        for (let x = 0; x + 8 <= width; x += 4) {
            let ma = 0;
            let mb = 0;
            for (let j = 0; j < 8; j++) for (let i = 0; i < 8; i++) ((ma += luma(a, (y + j) * width + x + i)), (mb += luma(b, (y + j) * width + x + i)));
            ma /= 64;
            mb /= 64;
            let va = 0;
            let vb = 0;
            let cov = 0;
            for (let j = 0; j < 8; j++)
                for (let i = 0; i < 8; i++) {
                    const da = luma(a, (y + j) * width + x + i) - ma;
                    const db = luma(b, (y + j) * width + x + i) - mb;
                    va += da * da;
                    vb += db * db;
                    cov += da * db;
                }
            va /= 63;
            vb /= 63;
            cov /= 63;
            total += ((2 * ma * mb + c1) * (2 * cov + c2)) / ((ma * ma + mb * mb + c1) * (va + vb + c2));
            windows++;
        }
    return total / windows;
}

test("a JPEG's own bytes give its tables, its sampling and its quality; a block's waves go there and back", async () => {
    const pixels = Buffer.alloc(64 * 48 * 3, 128);
    for (const quality of [10, 35, 75, 95]) {
        const bytes = new Uint8Array(await sharp(pixels, { raw: { width: 64, height: 48, channels: 3 } }).jpeg({ quality, chromaSubsampling: "4:2:0" }).toBuffer());
        const facts = jpegFacts(bytes)!;
        expect(facts.width).toBe(64);
        expect(facts.height).toBe(48);
        expect(facts.quality).toBe(quality);
        expect(facts.channels.map((each) => [each.across, each.down])).toEqual([[1, 1], [2, 2], [2, 2]]);
        expect(qualityOf(facts.tables[0]!)).toBe(quality);
    }
    const full = jpegFacts(new Uint8Array(await sharp(pixels, { raw: { width: 64, height: 48, channels: 3 } }).jpeg({ quality: 50, chromaSubsampling: "4:4:4" }).toBuffer()))!;
    expect(full.channels.map((each) => [each.across, each.down])).toEqual([[1, 1], [1, 1], [1, 1]]);
    expect(jpegFacts(new Uint8Array([0xff, 0xd8, 0xff, 0xdb, 0, 3, 0]))).toBeUndefined();
    expect(jpegFacts(new Uint8Array([137, 80, 78, 71]))).toBeUndefined();
    // with every step one, rounding a block's waves changes nothing, so the moved grids give the plane back
    const plane = Float32Array.from({ length: 24 * 16 }, (_, at) => (at * 37) % 251);
    const back = reapply(plane, 24, 16, new Uint16Array(64).fill(1), shiftsOf(4));
    expect(Math.max(...back.map((value, at) => Math.abs(value - Math.round(plane[at]!))))).toBeLessThan(0.51);
    // held to the file, a plane already consistent is kept
    const held = consistent(plane, plane, 24, 16, new Uint16Array(64).fill(1));
    expect(Math.max(...held.map((value, at) => Math.abs(value - plane[at]!)))).toBeLessThan(1e-3);
});

test("on photographs, screenshots and drawings compressed hard, the repair comes nearer the clean picture than the JPEG does", async () => {
    const pictures = await cleanPictures();
    const qualities = [10, 20, 30, 50, 75, 90];
    const rows: string[] = ["| Picture | Kind | Quality | JPEG PSNR | Repaired PSNR | JPEG SSIM | Repaired SSIM | Time |", "|---|---|---|---|---|---|---|---|"];
    const gains = new Map<string, { psnr: number; ssim: number }[]>();
    for (const picture of pictures) {
        for (const quality of qualities) {
            const bytes = await sharp(Buffer.from(picture.pixels), { raw: { width: picture.width, height: picture.height, channels: 4 } }).removeAlpha().jpeg({ quality, chromaSubsampling: "4:2:0" }).toBuffer();
            const decoded = new Uint8Array(await sharp(bytes).ensureAlpha().raw().toBuffer());
            const facts = jpegFacts(new Uint8Array(bytes))!;
            const started = performance.now();
            const fixed = repair(decoded, picture.width, picture.height, facts, { shifts: 16 });
            const took = performance.now() - started;
            const before = { psnr: psnr(decoded, picture.pixels), ssim: ssim(decoded, picture.pixels, picture.width, picture.height) };
            const after = { psnr: psnr(fixed, picture.pixels), ssim: ssim(fixed, picture.pixels, picture.width, picture.height) };
            rows.push(`| ${picture.name} | ${picture.kind} | ${quality} | ${before.psnr.toFixed(2)} | ${after.psnr.toFixed(2)} | ${before.ssim.toFixed(4)} | ${after.ssim.toFixed(4)} | ${Math.round(took)} ms for ${((picture.width * picture.height) / 1e6).toFixed(2)} MP |`);
            const key = `${picture.kind} ${quality}`;
            gains.set(key, [...(gains.get(key) ?? []), { psnr: after.psnr - before.psnr, ssim: after.ssim - before.ssim }]);
        }
    }
    console.log(rows.join("\n"));
    for (const [key, list] of gains) {
        const quality = Number(key.split(" ")[1]);
        const mean = { psnr: list.reduce((sum, each) => sum + each.psnr, 0) / list.length, ssim: list.reduce((sum, each) => sum + each.ssim, 0) / list.length };
        console.log(`${key}: PSNR ${mean.psnr >= 0 ? "+" : ""}${mean.psnr.toFixed(2)} dB, SSIM ${mean.ssim >= 0 ? "+" : ""}${mean.ssim.toFixed(4)}`);
        // where the editor offers it, it does better than leaving the picture alone for each kind, and no picture of the
        // kind loses more than a twentieth of a decibel (the chart at quality 30 ties, at a hundredth below)
        if (quality <= MOST_QUALITY) {
            expect(mean.psnr).toBeGreaterThan(0.05);
            for (const each of list) expect(each.psnr).toBeGreaterThan(-0.05);
        }
    }
}, 600_000);
