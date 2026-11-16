// What the converter's page is held to: its right-click menu and its words to press in lowercase, the
// line under the list, and which groups of the column apply; in Chromium, that it is the small tools'
// kit (one box, the work and the column, lowercase headings, labels and words, round dots, no boxed
// buttons, the words for every file at the column's foot, the groups of kinds not in the list faint);
// and, with imgQuire's real encoders served from the site's own files: pictures dropped, pasted and
// pasted from the menu each become a row and convert a few at a time to the format and size chosen, with
// their own names and a number for a second of one name; a phone's HEIC photograph is read; a picture
// stopped stays stopped; a file of no kind the converter knows says so; one result saves alone and all
// leave as one zip that reads back; nothing is fetched but the page's own files. Text pasted and dropped
// converts both ways, a shape one format cannot carry is refused with an offer that works, and a result
// is copied. A sound says its rate and length and converts to FLAC and Opus, and what this browser cannot
// write is said beside the choice. A film says what it holds, converts smaller with a bar that only rises,
// and can be stopped.

import { expect, test } from "bun:test";
import type { Browser } from "../../../scripts/browser";
import { corePage, quire } from "../../../scripts/core-page";
import { readZip } from "../core/zip";
import { kindsInUse, menuLines, ROW_WORDS, summaryOf, WORDS } from "./page";

const PUBLIC = `${import.meta.dir}/../../../public`;

/** Every address but this machine's own, for `serve` to refuse: the page's own files come from the test's server. */
export const ELSEWHERE = ["https://", ..."abcdefghijkmnpqrstuvwxyz0123456789".split("").map((letter) => `http://${letter}`), ..."abcdefghijklmnpqrstuvwxyz".split("").map((letter) => `http://l${letter}`)];

test("the right-click menu offers what can be done with the file pressed, then paste and choose files, every line in lowercase", () => {
    const run = { save() {}, copy() {}, stop() {}, again() {}, remove() {}, paste() {}, choose() {} };
    expect(menuLines(undefined, run).map((each) => each.label)).toEqual(["paste", "choose files"]);
    expect(menuLines({ state: "done", text: true }, run).map((each) => each.label || "-")).toEqual(["save", "copy", "convert again", "remove", "-", "paste", "choose files"]);
    expect(menuLines({ state: "running", text: false }, run).map((each) => each.label || "-")).toEqual(["stop", "remove", "-", "paste", "choose files"]);
    expect(menuLines({ state: "failed", text: false }, run).map((each) => each.label || "-")).toEqual(["try again", "remove", "-", "paste", "choose files"]);
});

test("the line under the list counts the files, those done and what they weigh before and after", () => {
    expect(summaryOf([])).toBe("");
    expect(summaryOf([{ state: "ready", before: 1000 }])).toBe("1 file");
    expect(summaryOf([{ state: "done", before: 3_400_000, after: 410_000 }, { state: "done", before: 600_000, after: 90_000 }, { state: "running", before: 5 }])).toBe("3 files · 2 done · 4.0 MB to 500 KB · 1 working");
});

test("the groups of the column that apply are those of the kinds in the list, or every one while the list is empty", () => {
    const all = ["picture", "text", "audio", "video"] as const;
    expect([...kindsInUse([], [...all])]).toEqual([...all]);
    expect([...kindsInUse(["picture", "picture", "unknown"], [...all])]).toEqual(["picture"]);
    expect([...kindsInUse(["unknown"], [...all])]).toEqual([]);
});

test("the words a visitor presses are lowercase, and the sentences keep their capitals", () => {
    for (const each of [WORDS.choose, WORDS.paste, WORDS.convert, WORDS.stop, WORDS.zip, WORDS.folder, WORDS.clear, ...Object.values(ROW_WORDS)]) expect(each).toBe(each.toLowerCase());
    expect(WORDS.empty.startsWith("Drop files here")).toBe(true);
});

/** A page with the converter and its sides, as the site's script builds it, served with the codecs and the worker. */
export async function convertPage(sides: string, extra = "") {
    const built = await Bun.build({ entrypoints: [`${quire}/img/codec-run.ts`], target: "browser" });
    if (!built.success) throw new Error(built.logs.join("\n"));
    const worker = await built.outputs[0]!.text();
    const css = (await Bun.file(`${import.meta.dir}/../../styles/quire-bench.css`).text()) + (await Bun.file(`${import.meta.dir}/../../styles/quire-convert.css`).text());
    return corePage(
        `
        import { createConvertPage } from "${quire}/convert/page.ts";
        import { pictureSide } from "${quire}/convert/picture-side.ts";
        import { decodeHeic, heicIn } from "${quire}/img/codec-run.ts";
        import { FORMATS, formatOf, underWeight } from "${quire}/img/export.ts";
        import { blocksOut } from "${quire}/img/metadata.ts";
        import { textSide } from "${quire}/convert/text-side.ts";
        import { audioSide } from "${quire}/convert/audio-side.ts";
        import { wavHeader, wavSamples } from "${quire}/convert/wav.ts";
        window.audioSide = audioSide;
        import { videoSide } from "${quire}/convert/video-side.ts";
        import { createMp4 } from "${quire}/convert/mp4.ts";
        window.videoSide = videoSide;
        // a short film made in code: H.264 pictures of a moving square, and an Opus tone, in an MP4
        window.filmOf = async (seconds) => {
            const W = 320, H = 240, canvas = new OffscreenCanvas(W, H), context = canvas.getContext("2d");
            const chunks = [], sounds = [];
            let description, soundDescription;
            const encoder = new VideoEncoder({ output: (chunk, meta) => { const data = new Uint8Array(chunk.byteLength); chunk.copyTo(data); chunks.push({ data, timestamp: chunk.timestamp, duration: chunk.duration, key: chunk.type === "key" }); if (meta?.decoderConfig?.description) description = new Uint8Array(meta.decoderConfig.description); }, error: (e) => { throw e; } });
            encoder.configure({ codec: "avc1.42001f", width: W, height: H, bitrate: 1_000_000, framerate: 30, avc: { format: "avc" } });
            for (let index = 0; index < seconds * 30; index++) {
                context.fillStyle = "#406080"; context.fillRect(0, 0, W, H); context.fillStyle = "#e04060"; context.fillRect(index * 2 % 280, 100, 40, 40);
                const frame = new VideoFrame(canvas, { timestamp: Math.round(index * 1e6 / 30), duration: 33333 });
                encoder.encode(frame, { keyFrame: index % 30 === 0 }); frame.close();
            }
            await encoder.flush();
            const audio = new AudioEncoder({ output: (chunk, meta) => { const data = new Uint8Array(chunk.byteLength); chunk.copyTo(data); sounds.push({ data, timestamp: chunk.timestamp, duration: chunk.duration }); if (meta?.decoderConfig?.description) soundDescription = new Uint8Array(meta.decoderConfig.description); }, error: (e) => { throw e; } });
            audio.configure({ codec: "opus", sampleRate: 48000, numberOfChannels: 2, bitrate: 96000 });
            audio.encode(new AudioData({ format: "f32-planar", sampleRate: 48000, numberOfFrames: 48000 * seconds, numberOfChannels: 2, timestamp: 0, data: new Float32Array(96000 * seconds).map((_, at) => 0.3 * Math.sin(at / 20)) }));
            await audio.flush();
            const writer = createMp4([{ kind: "video", codec: "avc1.42001f", description, width: W, height: H }, { kind: "audio", codec: "opus", description: soundDescription, sampleRate: 48000, channels: 2 }]);
            for (const chunk of chunks) writer.add(0, chunk.data, chunk.timestamp, chunk.duration, chunk.key);
            for (const chunk of sounds) writer.add(1, chunk.data, chunk.timestamp, chunk.duration, true);
            return new File([writer.end()], "holiday.mp4", { type: "video/mp4" });
        };
        window.wavOf = (seconds, rate = 44100) => { const frames = seconds * rate; const tone = Float32Array.from({ length: frames }, (_, at) => 0.5 * Math.sin(2 * Math.PI * 440 * at / rate)); return new File([wavHeader({ sampleRate: rate, channels: 2, bits: 16, frames }), wavSamples([tone, tone], 16)], "tone.wav", { type: "audio/wav" }); };
        import { readHtml, writeHtml } from "${quire}/md/html.ts";
        import { read } from "${quire}/md/read.ts";
        import { write } from "${quire}/md/write.ts";
        window.textSide = textSide;
        window.markdown = {
            toHtml: (text) => writeHtml(read(text).blocks),
            fromHtml: (html) => write({ ...read(""), blocks: readHtml(html).map((block, index, all) => ({ ...block, gap: index < all.length - 1 ? "\\n\\n" : "\\n" })) }),
        };
        ${extra}
        window.pictures = {
            formats: FORMATS.map(({ key, label, short, tip, type, ending, lossy }) => ({ key, label, short, tip, type, ending, lossy })),
            async encode(pixels, settings, meta, tried) {
                const format = formatOf(settings.format);
                const encode = async (quality) => { const blob = await format.encode(pixels, quality, meta); tried(); return blob; };
                if (format.lossy && settings.target) return underWeight(encode, settings.target);
                return { blob: await encode(settings.quality), quality: settings.quality, over: false };
            },
            metadata: (original, keep) => blocksOut(original, keep, {}),
            isHeic: heicIn,
            decodeHeic,
        };
        window.downloads = {};
        HTMLAnchorElement.prototype.click = function () { if (this.download) fetch(this.href).then((answer) => answer.arrayBuffer()).then((buffer) => (window.downloads[this.download] = new Uint8Array(buffer))); };
        window.copied = [];
        navigator.clipboard.writeText = async (text) => window.copied.push(text);
        window.clipboardItems = [];
        navigator.clipboard.read = async () => window.clipboardItems;
        // a picture made in code: a gradient, a disc and a block, at a size, as PNG or JPEG
        window.picture = async (width, height, name, type = "image/png") => {
            const canvas = new OffscreenCanvas(width, height);
            const c = canvas.getContext("2d");
            const fade = c.createLinearGradient(0, 0, width, height); fade.addColorStop(0, "#3060c0"); fade.addColorStop(1, "#f0b040");
            c.fillStyle = fade; c.fillRect(0, 0, width, height);
            c.fillStyle = "#c02040"; c.beginPath(); c.arc(width * 0.3, height * 0.45, height * 0.25, 0, 7); c.fill();
            return new File([await canvas.convertToBlob({ type, quality: 0.92 })], name, { type });
        };
        window.convert = createConvertPage(document.querySelector("#host"), ${sides});
    `,
        {
            body: `<style>${css}</style><div id="host"></div>`,
            width: 1300,
            height: 900,
            files: async (path) => {
                if (path === "/codec-run.ts") return new Response(worker, { headers: { "Content-Type": "text/javascript" } });
                if (path.startsWith("/quire/codecs/") && !path.includes("..")) {
                    const file = Bun.file(`${PUBLIC}${path}`);
                    if (await file.exists()) return new Response(file, { headers: { "Content-Type": "application/wasm" } });
                }
                return undefined;
            },
        },
    );
}

/** Waiting for the page and pressing its words and choices by their words. */
export function driver(tab: Browser) {
    const until = async (expression: string, ms = 60_000) => {
        const started = Date.now();
        while (Date.now() - started < ms) {
            if (await tab.run<boolean>(`!!(${expression})`)) return;
            await tab.wait(80);
        }
        throw new Error(`waited for ${expression}: ${JSON.stringify(await tab.run("window.convert.rows()"))}`);
    };
    // a word to press is a button, and a choice is the label of its dot
    const pressText = async (text: string, within = ".quire-convert") => {
        const at = await tab.run<{ x: number; y: number }>(`(() => { const e = [...document.querySelectorAll(${JSON.stringify(`${within} button, ${within} label`)})].find((each) => each.textContent.trim() === ${JSON.stringify(text)} && !each.closest('[inert]')); e.scrollIntoView({ block: "center", behavior: "instant" }); const b = e.getBoundingClientRect(); return { x: b.x + b.width / 2, y: b.y + b.height / 2 }; })()`);
        await tab.click(at.x, at.y);
    };
    const paste = (text: string) => tab.run(`(() => { const data = new DataTransfer(); data.setData("text/plain", ${JSON.stringify(text)}); document.dispatchEvent(new ClipboardEvent("paste", { clipboardData: data, bubbles: true, cancelable: true })); })()`);
    const drop = (files: { name: string; text: string }[]) => tab.run(`(() => { const data = new DataTransfer(); for (const file of ${JSON.stringify(files)}) data.items.add(new File([file.text], file.name)); document.querySelector(".quire-convert").dispatchEvent(new DragEvent("drop", { dataTransfer: data, bubbles: true, cancelable: true })); })()`);
    return { until, pressText, paste, drop };
}

test("in Chromium, the page is the kit's box: lowercase group headings, labels and words, round dots for every choice, no boxed buttons, the words for every file at the column's foot, and the groups of kinds not in the list faint", async () => {
    const page = await convertPage("[pictureSide(window.pictures), window.textSide(window.markdown), window.audioSide(), window.videoSide()]");
    if (!page) return;
    const { tab } = page;
    const { until } = driver(tab);
    try {
        // the format names a label keeps as they are written: a unit, and HTML within words
        const lower = "(text) => text.replace(/HTML|kHz|Mbps/g, '') === text.replace(/HTML|kHz|Mbps/g, '').toLowerCase()";
        expect(await tab.run("[...document.querySelector('.quire-convert').children].map((each) => each.className)")).toEqual(["quire-bench-work", "quire-bench-side"]);
        expect(await tab.run("[...document.querySelectorAll('.quire-bench-side > .quire-bench-group')].map((each) => each.querySelector(':scope > .quire-bench-heading')?.textContent ?? '')")).toEqual(["pictures", "text and data", "sounds", "films", ""]);
        expect(await tab.run("[...document.querySelectorAll('.quire-bench-side .quire-bench-label')].map((each) => each.textContent)")).toEqual(["lossy", "lossless", "quality", "under", "size", "largest side", "percent", "metadata", "data into", "separator", "first row", "numbers", "into", "rate", "channels", "bitrate", "bits", "into", "size", "bitrate"]);
        expect(await tab.run(`[...document.querySelectorAll('.quire-convert :is(.quire-bench-heading, .quire-bench-label, .quire-bench-choices label, .quire-bench-press:not(.quire-convert-offer))')].map((each) => each.textContent).filter((text) => !(${lower})(text))`)).toEqual([]);
        // every choice of one is a row of round dots, and every thing to press is the kit's word
        expect(await tab.run("[...document.querySelectorAll('.quire-bench-side [role=radiogroup]')].every((each) => each.classList.contains('quire-bench-choices') && each.querySelectorAll('input[type=radio]').length > 1)")).toBe(true);
        expect(await tab.run("[...document.querySelectorAll('.quire-convert button')].filter((each) => !each.classList.contains('quire-bench-press')).length")).toBe(0);
        expect(await tab.run("[...document.querySelectorAll('.quire-bench-side > .quire-bench-stack:last-child .quire-bench-press')].map((each) => [each.textContent, each.classList.contains('quiet')])")).toEqual([
            ["convert", false],
            ["stop all", true],
            ["save all as a zip", true],
            ["save all into a folder", true],
            ["clear the list", true],
        ]);
        // with the list empty every group can be set; with a picture in it, the others are faint
        expect(await tab.run("[...document.querySelectorAll('.quire-convert-kind')].map((each) => each.inert)")).toEqual([false, false, false, false]);
        await tab.run("(async () => window.convert.add(await window.picture(64, 48, 'small.png'), 'small.png'))()");
        await until("window.convert.rows()[0]?.state === 'ready'");
        expect(await tab.run("[...document.querySelectorAll('.quire-convert-kind')].map((each) => each.inert)")).toEqual([false, true, true, true]);
        expect(await tab.run("document.querySelector('.quire-bench-said').textContent")).toBe("1 file");
        expect(tab.errors).toEqual([]);
    } finally {
        await page.close();
    }
}, 60_000);

test("in Chromium, pictures arrive four ways, convert with their own names to the size chosen, stop, save alone and as a zip, fetching nothing else", async () => {
    const page = await convertPage("[pictureSide(window.pictures)]");
    if (!page) return console.warn("converter page test skipped: needs a Chromium");
    const { tab } = page;
    const { until, pressText } = driver(tab);
    try {
        await tab.serve(ELSEWHERE, async () => undefined);
        // a drop of two pictures of one name and a file of no known kind
        await tab.run(`(async () => {
            const data = new DataTransfer();
            data.items.add(await window.picture(640, 480, "photo.png"));
            data.items.add(await window.picture(800, 400, "photo.jpg", "image/jpeg"));
            data.items.add(new File([new Uint8Array([0, 1, 2, 3, 250, 251])], "blob.bin"));
            const root = document.querySelector(".quire-convert");
            root.dispatchEvent(new DragEvent("dragover", { dataTransfer: data, bubbles: true, cancelable: true }));
            root.dispatchEvent(new DragEvent("drop", { dataTransfer: data, bubbles: true, cancelable: true }));
        })()`);
        await until("window.convert.rows().length === 3 && window.convert.rows().every((row) => row.state !== 'ready' || row.label)");
        const rows = await tab.run<{ name: string; kind: string; state: string; notes: string[] }[]>("window.convert.rows()");
        expect(rows.map((row) => [row.name, row.kind])).toEqual([["photo.png", "picture"], ["photo.jpg", "picture"], ["blob.bin", "unknown"]]);
        expect(rows[2]!.state).toBe("cannot");
        expect(rows[2]!.notes).toEqual(["This is not a kind of file the converter knows."]);
        // a paste and Paste from the menu
        await tab.run(`(async () => {
            const data = new DataTransfer();
            data.items.add(await window.picture(300, 300, "screenshot.png"));
            document.dispatchEvent(new ClipboardEvent("paste", { clipboardData: data, bubbles: true, cancelable: true }));
            const blob = await window.picture(200, 100, "x.png");
            window.clipboardItems = [{ types: ["image/png"], getType: async () => blob }];
        })()`);
        await until("window.convert.rows().length === 4");
        const workAt = await tab.run<{ x: number; y: number }>("(() => { const b = document.querySelector('.quire-convert-drop').getBoundingClientRect(); return { x: b.x + 20, y: b.y + 20 }; })()");
        await tab.run(`document.querySelector('.quire-convert-drop').dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: ${workAt.x}, clientY: ${workAt.y} }))`);
        await until("document.querySelector('.quire-menu:popover-open')");
        await tab.run("[...document.querySelectorAll('.quire-menu:popover-open .quire-menu-items button')].find((each) => each.textContent.includes('paste')).click()");
        await until("window.convert.rows().length === 5");
        expect(await tab.run<string>("window.convert.rows()[4].name")).toBe("Pasted picture.png");
        // choose a largest side of 256 and convert all
        await pressText("largest side");
        await tab.run("(() => { const input = document.querySelector('.quire-convert-fold.open input[type=number]'); input.value = '256'; input.dispatchEvent(new Event('change')); })()");
        expect(await tab.run<string>("document.querySelector('.quire-convert-row .quire-convert-becomes').textContent")).toBe("to WebP, 256 px at most");
        await pressText("convert");
        await until("window.convert.rows().filter((row) => row.state === 'done').length === 4", 120_000);
        const done = await tab.run<{ name: string; status: string; made: { name: string; facts: string; blob: unknown } }[]>("window.convert.rows().filter((row) => row.made)");
        expect(done.map((row) => row.made.name)).toEqual(["photo.webp", "photo (1).webp", "screenshot.webp", "Pasted picture.webp"]);
        expect(done.map((row) => row.made.facts)).toEqual(["640 × 480 to 256 × 192", "800 × 400 to 256 × 128", "300 × 300 to 256 × 256", "200 × 100"]);
        expect(await tab.run<string>("document.querySelector('.quire-bench-said').textContent")).toMatch(/^5 files · 4 done · [\d.]+ KB to [\d.]+ KB$/);
        // one saved alone, then all as a zip that reads back with the four in it
        await tab.run("document.querySelector('.quire-convert-row[data-state=done] .quire-convert-row-main').click()");
        await until("window.downloads['photo.webp']");
        await pressText("save all as a zip");
        await until("window.downloads['converted.zip']");
        const zip = await tab.run<number[]>("[...window.downloads['converted.zip']]");
        const inside = await readZip(new Uint8Array(zip));
        expect([...inside.keys()]).toEqual(["photo.webp", "photo (1).webp", "screenshot.webp", "Pasted picture.webp"]);
        for (const bytes of inside.values()) expect(new TextDecoder().decode(bytes.subarray(8, 12))).toBe("WEBP");
        // a phone's HEIC photograph, read by imgQuire's HEIC reader
        const heic = Buffer.from(await Bun.file(`${import.meta.dir}/../img/fixture.heic`).arrayBuffer()).toString("base64");
        await tab.run(`window.convert.add(new File([Uint8Array.from(atob("${heic}"), (c) => c.charCodeAt(0))], "IMG_0001.HEIC"), "IMG_0001.HEIC")`);
        await until("window.convert.rows().length === 6 && window.convert.rows()[5].label === 'HEIC picture'");
        await pressText("convert");
        await until("window.convert.rows()[5].state === 'done'");
        expect(await tab.run("window.convert.rows()[5].made.name")).toBe("IMG_0001.webp");
        expect(await tab.run("window.convert.rows()[5].made.facts")).toBe("96 × 64");
        // a large picture as AVIF, stopped while it is written, stays stopped
        await pressText("avif");
        await tab.run("(async () => window.convert.add(await window.picture(3000, 2000, 'big.png'), 'big.png'))()");
        await until("window.convert.rows().length === 7");
        await pressText("convert");
        await until("window.convert.rows()[6].state === 'running'");
        await tab.run("document.querySelector('.quire-convert-row:last-child .quire-convert-row-main').click()");
        expect(await tab.run<string>("window.convert.rows()[6].state")).toBe("stopped");
        await tab.wait(1500);
        expect(await tab.run<string>("window.convert.rows()[6].state")).toBe("stopped");
        // nothing was fetched but the page's own encoder files and worker
        const away = tab.requests.filter((request) => !/^http:\/\/localhost:\d+\/(quire\/codecs\/[a-z]+\.wasm|codec-run\.ts|page\.html)?$/.test(request.url) && !request.url.startsWith("blob:") && !request.url.startsWith("data:"));
        expect(away).toEqual([]);
        expect(tab.errors).toEqual([]);
    } finally {
        await page.close();
    }
}, 240_000);

test("in Chromium, text pasted and dropped converts both ways, a shape that cannot be carried is refused with an offer that works, and a result is copied", async () => {
    const page = await convertPage("[pictureSide(window.pictures), window.textSide(window.markdown)]");
    if (!page) return;
    const { tab } = page;
    const { until, pressText, paste, drop } = driver(tab);
    try {
        await tab.serve(ELSEWHERE, async () => undefined);
        await paste("name,age\nAda,36\n\"Hopper, Grace\",85\n");
        await drop([
            { name: "notes.md", text: "# Notes\n\nSome **bold** words and [a link](https://example.com).\n\n- one\n- two\n" },
            { name: "page.html", text: "<html><head><style>p{}</style><script>alert(1)</script></head><body><h2>Hello</h2><p>A <em>small</em> page.</p><form><input></form></body></html>" },
            { name: "people.json", text: JSON.stringify([{ name: "Ada", address: { city: "London" } }, { name: "Grace", address: { city: "New York" } }]) },
            { name: "list.json", text: JSON.stringify([1, 2, 3]) },
            { name: "config.yaml", text: "base: &b\n  x: 1\nother: *b\n" },
        ]);
        await until("window.convert.rows().length === 6 && window.convert.rows().every((row) => row.state !== 'ready' || row.label !== 'Text')");
        expect(await tab.run("window.convert.rows().map((row) => [row.name, row.label, row.state])")).toEqual([
            ["Pasted text", "CSV", "ready"],
            ["notes.md", "Markdown", "ready"],
            ["page.html", "HTML", "ready"],
            ["people.json", "JSON", "cannot"],
            ["list.json", "JSON", "cannot"],
            ["config.yaml", "YAML", "ready"],
        ]);
        expect(await tab.run("window.convert.rows()[3].notes")).toEqual(["This is JSON already. Choose another format for data."]);
        await pressText("convert");
        await until("window.convert.rows().filter((row) => row.state === 'done' || row.state === 'failed').length === 4");
        const rows = await tab.run<{ name: string; state: string; notes: string[]; made?: { name: string; text: string } }[]>("window.convert.rows()");
        expect(JSON.parse(rows[0]!.made!.text)).toEqual([{ name: "Ada", age: "36" }, { name: "Hopper, Grace", age: "85" }]);
        expect(rows[0]!.made!.name).toBe("Pasted text.json");
        expect(rows[1]!.made!.text).toContain("<h1>Notes</h1>");
        expect(rows[1]!.made!.text).toContain("<strong>bold</strong>");
        expect(rows[1]!.made!.name).toBe("notes.html");
        expect(rows[2]!.made!.text).toBe("## Hello\n\nA *small* page.\n");
        expect(rows[5]!.state).toBe("failed");
        expect(rows[5]!.notes[0]).toContain("anchor or an alias");
        // into CSV: the nested people are refused with an offer, and the offer converts them
        await pressText("csv", ".quire-bench-side");
        await pressText("convert");
        await until("window.convert.rows()[3].state === 'failed' && window.convert.rows()[4].state === 'done'");
        expect(await tab.run("window.convert.rows()[3].notes")).toEqual(['CSV holds one plain value in each field, and the column "address" holds nested data in row 1.', "Spread nested values into columns named like address.city."]);
        await pressText("Spread nested values into columns named like address.city.");
        await until("window.convert.rows()[3].state === 'done'");
        expect(await tab.run("window.convert.rows()[3].made.text")).toBe("name,address.city\r\nAda,London\r\nGrace,New York\r\n");
        // into TOML: a list is refused and put under a name when the offer is taken
        await pressText("toml", ".quire-bench-side");
        await tab.run("(() => { const row = document.querySelectorAll('.quire-convert-row')[4]; row.scrollIntoView({ block: 'center', behavior: 'instant' }); const b = row.getBoundingClientRect(); row.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: b.x + 30, clientY: b.y + 20 })); })()");
        await until("document.querySelector('.quire-menu:popover-open')");
        await tab.run("[...document.querySelectorAll('.quire-menu:popover-open .quire-menu-items button')].find((each) => each.textContent.includes('convert again')).click()");
        await until("window.convert.rows()[4].state === 'failed'");
        expect(await tab.run("window.convert.rows()[4].notes")).toEqual(["TOML needs named values at the top, and this is a list.", "Put the list under the name items."]);
        await pressText("Put the list under the name items.");
        await until("window.convert.rows()[4].state === 'done'");
        expect(await tab.run("window.convert.rows()[4].made.text")).toBe("items = [1, 2, 3]\n");
        // Copy gives the clipboard the text made
        await tab.run("document.querySelector('.quire-convert-row .quire-convert-copy').click()");
        await until("window.copied.length === 1");
        expect(JSON.parse(await tab.run<string>("window.copied[0]"))).toEqual([{ name: "Ada", age: "36" }, { name: "Hopper, Grace", age: "85" }]);
        expect(tab.errors).toEqual([]);
    } finally {
        await page.close();
    }
}, 120_000);

test("in Chromium, a sound dropped says its rate and length, converts to FLAC and to Opus, and what this browser cannot write is said beside the choice", async () => {
    const page = await convertPage("[window.audioSide()]");
    if (!page) return;
    const { tab } = page;
    const { until, pressText } = driver(tab);
    try {
        await tab.serve(ELSEWHERE, async () => undefined);
        await tab.run(`(() => { const data = new DataTransfer(); data.items.add(window.wavOf(2)); document.querySelector(".quire-convert").dispatchEvent(new DragEvent("drop", { dataTransfer: data, bubbles: true, cancelable: true })); })()`);
        await until("window.convert.rows()[0]?.label === 'WAV sound, 44.1 kHz stereo, 0:02'");
        // the browser is asked what it writes; AAC, which Chromium on Linux does not write, is said so
        await until("!document.querySelector('[data-kind=audio] .quire-bench-choices label[title^=\"Asking\"]')");
        const aac = await tab.run<{ cannot: boolean; title: string }>("(() => { const b = [...document.querySelectorAll('[data-kind=audio] .quire-bench-choices label')].find((each) => each.textContent === 'aac m4a'); return { cannot: b.classList.contains('cannot'), title: b.title }; })()");
        const writesAac = await tab.run<boolean>("AudioEncoder.isConfigSupported({ codec: 'mp4a.40.2', sampleRate: 48000, numberOfChannels: 2, bitrate: 128000 }).then((answer) => answer.supported)");
        expect(aac.cannot).toBe(!writesAac);
        const notes = await tab.run<string[]>("[...document.querySelectorAll('[data-kind=audio] .quire-convert-note')].map((each) => each.textContent)");
        if (!writesAac) {
            expect(aac.title).toBe("This browser cannot write AAC.");
            expect(notes).toContain("This browser cannot write AAC, so it is not offered here.");
        }
        expect(notes).toContain("MP3 is read and not written: no MP3 encoder has a free license, and browsers do not write MP3.");
        await pressText("convert");
        await until("window.convert.rows()[0].state === 'done'");
        expect(await tab.run("window.convert.rows()[0].made.name")).toBe("tone.flac");
        expect(await tab.run("window.convert.rows()[0].made.became")).toBe("FLAC, 44.1 kHz stereo, 0:02");
        await pressText("opus ogg");
        expect(await tab.run<string>("document.querySelector('.quire-convert-becomes').textContent")).toBe("to FLAC, 44.1 kHz stereo, 0:02");
        await tab.run("(() => { const row = document.querySelector('.quire-convert-row'); const b = row.getBoundingClientRect(); row.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: b.x + 30, clientY: b.y + 20 })); })()");
        await until("document.querySelector('.quire-menu:popover-open')");
        await tab.run("[...document.querySelectorAll('.quire-menu:popover-open .quire-menu-items button')].find((each) => each.textContent.includes('convert again')).click()");
        await until("window.convert.rows()[0].state === 'done' && window.convert.rows()[0].made.name === 'tone.opus'");
        expect(await tab.run("window.convert.rows()[0].made.became")).toBe("Opus in Ogg, 48 kHz stereo, 0:02");
        expect(tab.errors).toEqual([]);
    } finally {
        await page.close();
    }
}, 120_000);

test("in Chromium, a film dropped says what it holds, converts to WebM smaller and at a lower bitrate with a true bar, and can be stopped", async () => {
    const page = await convertPage("[window.audioSide(), window.videoSide()]");
    if (!page) return;
    const { tab } = page;
    const { until, pressText } = driver(tab);
    try {
        await tab.serve(ELSEWHERE, async () => undefined);
        await tab.run(`(async () => { const data = new DataTransfer(); data.items.add(await window.filmOf(4)); document.querySelector(".quire-convert").dispatchEvent(new DragEvent("drop", { dataTransfer: data, bubbles: true, cancelable: true })); })()`);
        await until("window.convert.rows()[0]?.label.startsWith('MP4 film, H.264')");
        expect(await tab.run("window.convert.rows()[0].label")).toBe("MP4 film, H.264 320 × 240, Opus sound, 0:04");
        await until("!document.querySelector('[data-kind=video] .quire-bench-choices label[title^=\"Asking\"]')");
        await pressText("webm vp9");
        await pressText("360p");
        await pressText("0.5");
        expect(await tab.run<string>("document.querySelector('.quire-convert-becomes').textContent")).toBe("to WebM VP9, 360p at most, 0.5 Mbps");
        // the bar moves only as the film is worked through: its shares, seen while it runs, only rise
        await tab.run("window.shares = []; window.watch = setInterval(() => { const bar = document.querySelector('.quire-convert-track i'); window.shares.push(parseFloat(bar.style.width) || 0); }, 20)");
        await pressText("convert");
        await until("window.convert.rows()[0].state === 'done'");
        // the watch is given a few of its turns after the film is done, as on a busy machine the test may hear of it first
        await tab.wait(200);
        await tab.run("clearInterval(window.watch)");
        const shares = await tab.run<number[]>("window.shares");
        expect(shares.every((share, index) => index === 0 || share >= shares[index - 1]!)).toBe(true);
        expect(shares.at(-1)).toBe(100);
        const row = await tab.run<{ made: { name: string; became: string } }>("window.convert.rows()[0]");
        expect(row.made.name).toBe("holiday.webm");
        expect(row.made.became).toBe("WebM VP9, 320 × 240, 0.5 Mbps, Opus sound carried over");
        // a longer film stopped while it runs stays stopped, and can be tried again
        await tab.run(`(async () => window.convert.add(await window.filmOf(12), "long.mp4"))()`);
        await until("window.convert.rows().length === 2 && window.convert.rows()[1].label.startsWith('MP4 film')");
        await pressText("convert");
        await until("window.convert.rows()[1].state === 'running'");
        await tab.run("document.querySelectorAll('.quire-convert-row')[1].querySelector('.quire-convert-row-main').click()");
        expect(await tab.run("window.convert.rows()[1].state")).toBe("stopped");
        await tab.wait(800);
        expect(await tab.run("window.convert.rows()[1].state")).toBe("stopped");
        expect(await tab.run<string>("document.querySelectorAll('.quire-convert-row')[1].querySelector('.quire-convert-row-main').textContent")).toBe("try again");
        expect(tab.errors).toEqual([]);
    } finally {
        await page.close();
    }
}, 180_000);
