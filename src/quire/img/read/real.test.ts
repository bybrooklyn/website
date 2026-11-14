// The text reader with the real PP-OCRv6 models, on the site's own ONNX Runtime build, in Chromium,
// on fixtures drawn in the page (known words on a canvas, so no picture made elsewhere is used):
// a settings screenshot at 1920 by 1080 in a light and a dark theme with UI text from 11 to 28
// pixels, lines turned by 10, -12, 90 and 180 degrees, a page turned a quarter either way, and a 12
// megapixel photograph with a sign. Held true: each size runs on WebAssembly and reads the screenshots
// with every character right; the words' boxes lie on their ink within a pixel and a half; the two
// larger sizes read every turned line, and the largest sets a page on its side upright;
// what looks private is found on the screenshot and nothing else is; and on a graphics card where
// Chromium gives one, the same. Times are printed. The models are read from where they were fetched
// for trials (~/.cache/quire-model-trials/ocr/); without them, or without a Chromium, this is skipped
// with a notice, and nothing is ever fetched from the network here.

import { afterAll, beforeAll, expect, test } from "bun:test";
import { readPage, type Fixture } from "../../../../scripts/read-page";
import { boundsOf } from "./words";

let page: Awaited<ReturnType<typeof readPage>>;
beforeAll(async () => {
    page = await readPage();
    if (!page) console.warn("text reader with the real models skipped: needs a Chromium and the models in ~/.cache/quire-model-trials/ocr/");
});
afterAll(async () => {
    await page?.close();
});

/** The fewest single-character changes that make one text the other. */
function distance(a: string, b: string): number {
    let row = Array.from({ length: b.length + 1 }, (_, at) => at);
    for (let i = 1; i <= a.length; i++) {
        const next = [i];
        for (let j = 1; j <= b.length; j++) next[j] = Math.min(row[j]! + 1, next[j - 1]! + 1, row[j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1));
        row = next;
    }
    return row[b.length]!;
}

/** Characters read right out of those drawn: each line drawn against the read line nearest it in text. */
function score(found: Fixture): { right: number; all: number; misses: string[] } {
    let right = 0;
    let all = 0;
    const misses: string[] = [];
    for (const line of found.expected) {
        const best = Math.min(...found.read.map((read) => distance(line.text, read.text)), line.text.length);
        all += line.text.length;
        right += line.text.length - best;
        if (best) misses.push(line.text);
    }
    return { right, all, misses };
}
const said = (name: string, found: Fixture, { right, all }: { right: number; all: number }) => console.log(`${name}: ${right} of ${all} characters right, ${found.read.length} lines, ${found.ms} ms on ${found.place}${found.place === "wasm" ? ` (${found.threads} threads)` : ""}`);

test("the tiny size runs on WebAssembly and reads the light and dark screenshots with every character right, small UI text too", async () => {
    if (!page) return;
    for (const theme of ["light", "dark"]) {
        const found = await page.read(theme, "tiny", "wasm");
        const result = score(found);
        said(`tiny, ${theme} screenshot`, found, result);
        expect(found.place).toBe("wasm");
        expect(result.misses).toEqual([]);
    }
}, 120_000);

test("every word's box lies on its ink within a pixel and a half", async () => {
    if (!page) return;
    const found = await page.read("light", "tiny", "wasm");
    const words = found.read.flatMap((line) => line.words);
    let checked = 0;
    let worst = 0;
    for (const line of found.expected)
        for (const ink of line.words ?? []) {
            const read = words.find((word) => word.text === ink.text && Math.abs(boundsOf(word.box).y - ink.y) < 10 && Math.abs(boundsOf(word.box).x - ink.x) < 20);
            expect([ink.text, !!read]).toEqual([ink.text, true]);
            const box = boundsOf(read!.box);
            const off = Math.max(Math.abs(box.x - ink.x), Math.abs(box.y - ink.y), Math.abs(box.x + box.width - ink.x - ink.width), Math.abs(box.y + box.height - ink.y - ink.height));
            worst = Math.max(worst, off);
            checked++;
        }
    console.log(`${checked} words placed; the furthest edge from its ink is ${worst.toFixed(2)} pixels`);
    expect(checked).toBeGreaterThan(50);
    expect(worst).toBeLessThanOrEqual(1.5);
}, 120_000);

test("what looks private on the screenshot is found, and nothing else is", async () => {
    if (!page) return;
    const found = await page.read("light", "tiny", "wasm");
    const ip = [203, 0, 113, 42].join(".");
    expect(found.private.map((each) => `${each.kind}: ${each.text}`).sort()).toEqual(
        ["email: someone@example.com", "phone: +1 415 555 0132", "key: ghp_9f8a7c6b5d4e3f2a1b0cXyZ123", "address: 1600 Pennsylvania Avenue, Washington, DC 20500", "card: 4111 1111 1111 1111", `ip: ${ip}`].sort(),
    );
}, 120_000);

test("the small and large sizes run on WebAssembly, read the screenshot, and read every turned line, upside down and on its side too", async () => {
    if (!page) return;
    for (const tier of ["small", "large"]) {
        const screen = await page.read("light", tier, "wasm");
        said(`${tier}, light screenshot`, screen, score(screen));
        expect(score(screen).misses).toEqual([]);
        const turned = await page.read("turned", tier, "wasm");
        const result = score(turned);
        said(`${tier}, turned lines`, turned, result);
        expect(result.misses).toEqual([]);
    }
    // the tiny size has no model for lines upside down, and reads every other
    const tiny = await page.read("turned", "tiny", "wasm");
    expect(score(tiny).misses).toEqual(["Upside down line of text"]);
}, 300_000);

test("a 12 megapixel photograph's sign is read, and the time is said", async () => {
    if (!page) return;
    const found = await page.read("photo", "tiny", "wasm");
    const result = score(found);
    said("tiny, 12 megapixel photograph", found, result);
    expect(result.right).toBeGreaterThanOrEqual(result.all - 1);
}, 300_000);

test("on a graphics card, where Chromium gives one, each size reads the screenshot the same", async () => {
    const card = await readPage(["--enable-unsafe-webgpu", "--enable-features=Vulkan", "--use-angle=vulkan"]);
    if (!card) return;
    try {
        if (!(await card.tab.run<boolean>("(async () => { const adapter = await navigator.gpu?.requestAdapter(); return !!adapter && !adapter.info?.isFallbackAdapter; })()"))) return console.warn("no graphics card in this Chromium; the WebGPU reading was not tried");
        for (const tier of ["tiny", "small", "large"]) {
            await card.read("light", tier, "webgpu");
            const found = await card.read("light", tier, "webgpu");
            const result = score(found);
            said(`${tier}, light screenshot`, found, result);
            expect(found.place).toBe("webgpu");
            expect(result.misses).toEqual([]);
        }
    } finally {
        await card.close();
    }
}, 300_000);

test("the large size sets a page taken on its side upright: its lines read in order, and their words run the way the page was turned", async () => {
    if (!page) return;
    for (const [kind, along] of [["sideways-right", 1], ["sideways-left", -1]] as const) {
        const found = await page.read(kind, "large", "wasm");
        const result = score(found);
        said(`large, a page turned ${kind === "sideways-right" ? "clockwise" : "counter-clockwise"}`, found, result);
        expect(result.misses).toEqual([]);
        expect(found.read.slice(0, 4).map((line) => line.text)).toEqual(found.expected.map((line) => line.text));
        expect(Math.round(found.read[0]!.words[0]!.box.along.y)).toBe(along);
    }
}, 300_000);
