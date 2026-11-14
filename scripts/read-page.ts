// A page for the text reader's tests with the real models (src/quire/img/read/real.test.ts): served
// from this machine, with ONNX Runtime's files from node_modules as the site's build copies them to
// /ort/, the models from where they were fetched for trials (~/.cache/quire-model-trials/ocr/), and
// cross-origin isolation, as /imgquire/ has it. The page draws its fixtures itself, text of known
// words on a canvas, so no picture made elsewhere is used; its script reads them with read.ts.
//
//   const page = await readPage(["--enable-unsafe-webgpu"]);
//   if (page) try { await page.tab.run("window.readFixture('light', 'tiny', 'wasm')"); } finally { await page.close(); }

import { mkdtemp, rm } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { browser, chromium, type Browser } from "./browser";

/** Where the models were fetched to for trials. */
export const TRIALS = `${homedir()}/.cache/quire-model-trials/ocr`;
const ORT = `${import.meta.dir}/../node_modules/onnxruntime-web/dist/`;
const QUIRE = `${import.meta.dir}/../src/quire`;

/** The worker's script: the fixtures, and reading one with a size's models on a place, off the page's thread as imgQuire reads. */
const SCRIPT = `
const window = self;
import { readText } from "${QUIRE}/img/read/read.ts";
import { makeModels } from "${QUIRE}/img/read/runtime.ts";
import { readDictionary } from "${QUIRE}/img/read/dictionary.ts";
import { tierOf, fileFor } from "${QUIRE}/img/read/models.ts";
import { lookPrivate } from "${QUIRE}/img/read/private.ts";

const ip = [203, 0, 113, 42].join(".");
/** The lines of the screenshot fixture, each with its size in pixels. */
export const SCREEN = [
    [28, "Account settings"], [16, "Signed in as Jordan Example"], [14, "Email: someone@example.com"], [14, "Phone: +1 415 555 0132"],
    [13, "Token: ghp_9f8a7c6b5d4e3f2a1b0cXyZ123"], [12, "Last sign in 14 Nov 2026 from Firefox on Linux"], [11, "Version 4.2.0 build 1187"],
    [14, "1600 Pennsylvania Avenue, Washington, DC 20500"], [14, "Card 4111 1111 1111 1111"], [13, "Server " + ip + " is up"],
    [12, "Notifications are sent once a day"], [12, "Two factor sign in is on"], [11, "Privacy and terms"],
];
const SIDE = ["Profile", "Security", "Billing", "Notifications"];
window.fixtures = {};
/** Draws a fixture and gives its pixels and the lines it holds. */
window.draw = (kind) => {
    const dark = kind === "dark";
    if (kind === "light" || kind === "dark") {
        const canvas = new OffscreenCanvas(1920, 1080);
        const c = canvas.getContext("2d");
        c.fillStyle = dark ? "#1e1f22" : "#f6f6f8"; c.fillRect(0, 0, 1920, 1080);
        c.fillStyle = dark ? "#2b2d31" : "#ffffff"; c.fillRect(0, 0, 260, 1080);
        c.fillStyle = dark ? "#dbdee1" : "#1d1d1f";
        c.textBaseline = "alphabetic";
        const lines = [];
        SIDE.forEach((word, at) => { c.font = "15px sans-serif"; c.fillText(word, 32, 120 + at * 40); lines.push({ text: word, size: 15 }); });
        let y = 90;
        // each word's ink as the browser measures it, to hold the words read against
        const inkOf = (text, x, y) => { let at = 0; return text.split(" ").map((word) => { const start = text.indexOf(word, at); at = start + word.length; const before = c.measureText(text.slice(0, start)).width; const m = c.measureText(word); return { text: word, x: x + before - m.actualBoundingBoxLeft, y: y - m.actualBoundingBoxAscent, width: m.actualBoundingBoxLeft + m.actualBoundingBoxRight, height: m.actualBoundingBoxAscent + m.actualBoundingBoxDescent }; }); };
        for (const [size, text] of SCREEN) { c.font = (size >= 20 ? "600 " : "") + size + "px sans-serif"; c.fillText(text, 340, y); lines.push({ text, size, words: inkOf(text, 340, y) }); y += size * 2.6 + 10; }
        c.fillStyle = "#2f6fed"; c.fillRect(340, y, 160, 40); c.fillStyle = "#ffffff"; c.font = "14px sans-serif"; c.fillText("Save changes", 372, y + 25); lines.push({ text: "Save changes", size: 14 });
        c.fillStyle = dark ? "#949ba4" : "#6e6e73"; c.font = "11px monospace"; c.fillText("Build 3b18e512 deployed 2026-11-14 10:30", 1400, 1050); lines.push({ text: "Build 3b18e512 deployed 2026-11-14 10:30", size: 11 });
        return { canvas, lines };
    }
    if (kind === "turned") {
        const canvas = new OffscreenCanvas(1400, 900);
        const c = canvas.getContext("2d");
        c.fillStyle = "#ffffff"; c.fillRect(0, 0, 1400, 900); c.fillStyle = "#111111"; c.font = "26px sans-serif";
        const put = (text, x, y, degrees) => { c.save(); c.translate(x, y); c.rotate(degrees * Math.PI / 180); c.fillText(text, 0, 0); c.restore(); return { text, size: 26, degrees }; };
        return { canvas, lines: [put("A level line to start with", 80, 80, 0), put("Turned by ten degrees here", 80, 200, 10), put("Turned by minus twelve", 600, 420, -12), put("Upside down line of text", 1300, 820, 180), put("Standing on its side", 1250, 120, 90)] };
    }
    if (kind === "photo") {
        const canvas = new OffscreenCanvas(4000, 3000);
        const c = canvas.getContext("2d");
        const fade = c.createLinearGradient(0, 0, 4000, 3000); fade.addColorStop(0, "#1c3a5a"); fade.addColorStop(1, "#e8a35c"); c.fillStyle = fade; c.fillRect(0, 0, 4000, 3000);
        for (let at = 0; at < 300; at++) { c.fillStyle = "hsl(" + ((at * 47) % 360) + " 55% 55%)"; c.beginPath(); c.arc((at * 7919) % 4000, (at * 104729) % 3000, 40 + (at % 90), 0, 7); c.fill(); }
        c.fillStyle = "#ffffff"; c.fillRect(600, 900, 2400, 700); c.fillStyle = "#202020"; c.font = "bold 120px sans-serif";
        c.fillText("OPEN EVERY DAY", 700, 1100); c.font = "80px sans-serif"; c.fillText("Market Street at noon", 700, 1300); c.fillText("Call 555-0132", 700, 1480);
        return { canvas, lines: [{ text: "OPEN EVERY DAY", size: 120 }, { text: "Market Street at noon", size: 80 }, { text: "Call 555-0132", size: 80 }] };
    }
    throw new Error("no fixture " + kind);
};
const kept = new Map();
const fileBytes = (each) => { const key = each.repo + each.path; if (!kept.has(key)) kept.set(key, fetch("/models/" + each.repo.slice("PaddlePaddle/".length) + "/" + each.path).then((answer) => answer.arrayBuffer()).then((buffer) => new Uint8Array(buffer))); return kept.get(key); };
const made = new Map();
/** The models of a size on a place, made once. */
window.models = async (id, place) => {
    const key = id + place;
    if (!made.has(key)) {
        const tier = tierOf(id);
        const get = async (role) => { const each = fileFor(tier, role); return each && (await fileBytes(each)).slice(); };
        made.set(key, (async () => ({ made: await makeModels({ detect: await get("detect"), recognize: await get("recognize"), line: await get("line"), page: await get("page") }, place), dictionary: readDictionary(new TextDecoder().decode(await get("dictionary"))), tier }))());
    }
    return made.get(key);
};
/** Reads a fixture: the lines expected and read, the words, what looks private, and how long it took. */
window.readFixture = async (kind, id, place) => {
    const { canvas, lines } = window.draw(kind);
    const context = canvas.getContext("2d");
    const image = context.getImageData(0, 0, canvas.width, canvas.height);
    const { made: built, dictionary, tier } = await window.models(id, place);
    const started = performance.now();
    const read = await readText({ width: image.width, height: image.height, data: image.data }, built.models, { dictionary, sure: tier.sure });
    const ms = performance.now() - started;
    return { expected: lines, read: read.map((line) => ({ text: line.text, sure: Math.round(line.sure * 100) / 100, words: line.words.map((word) => ({ text: word.text, box: word.box })) })), private: lookPrivate(read), ms: Math.round(ms), place: built.place, threads: built.threads };
};
// in its worker, it answers each fixture asked for with what reading it gave
self.onmessage = (event) => window.readFixture(...event.data).then((found) => self.postMessage(found), (error) => self.postMessage({ error: String(error && error.stack || error) }));
`;

/** The page's own script: the worker made, and a fixture asked of it, what it gives kept in window.done. */
const PAGE = `
const worker = new Worker("/worker.js", { type: "module" });
worker.onmessage = (event) => (window.done = event.data);
window.startFixture = (kind, id, place) => { window.done = undefined; worker.postMessage([kind, id, place]); };
window.ready = true;
`;

/** What reading a fixture gives: the lines drawn and those read, what looks private, the time and where it ran. */
export interface Fixture {
    expected: { text: string; size: number; degrees?: number; words?: { text: string; x: number; y: number; width: number; height: number }[] }[];
    read: { text: string; sure: number; words: { text: string; box: { at: { x: number; y: number }; along: { x: number; y: number }; length: number; height: number } }[] }[];
    private: { kind: string; text: string }[];
    ms: number;
    place: string;
    threads: number;
}

/** Opens the page in a fresh Chromium with these flags, or gives undefined where there is no Chromium or no models. */
export async function readPage(args: string[] = []): Promise<{ tab: Browser; close(): Promise<void>; origin: string; read(kind: string, tier: string, place: string): Promise<Fixture> } | undefined> {
    if (!chromium() || !(await Bun.file(`${TRIALS}/PP-OCRv6_tiny_det_onnx/inference.onnx`).exists())) return undefined;
    const folder = await mkdtemp(join(tmpdir(), "quire-read-"));
    let script: string;
    try {
        await Bun.write(`${folder}/page.ts`, SCRIPT);
        const built = await Bun.build({ entrypoints: [`${folder}/page.ts`], target: "browser" });
        if (!built.success) throw new Error(built.logs.join("\n"));
        script = await built.outputs[0]!.text();
    } finally {
        await rm(folder, { recursive: true, force: true });
    }
    const isolated = { "Cross-Origin-Opener-Policy": "same-origin", "Cross-Origin-Embedder-Policy": "require-corp" };
    const server = Bun.serve({
        port: 0,
        async fetch(request) {
            const path = new URL(request.url).pathname;
            if (path === "/") return new Response(`<!doctype html><meta charset="utf-8"><body><script type="module">${PAGE}</script>`, { headers: { ...isolated, "Content-Type": "text/html" } });
            if (path === "/worker.js") return new Response(script, { headers: { ...isolated, "Content-Type": "text/javascript" } });
            const file = path.startsWith("/ort/") ? Bun.file(ORT + path.slice(5)) : path.startsWith("/models/") ? Bun.file(`${TRIALS}/${path.slice(8)}`) : undefined;
            if (!file || path.includes("..") || !(await file.exists())) return new Response("missing", { status: 404 });
            return new Response(file, { headers: { ...isolated, "Content-Type": path.endsWith(".wasm") ? "application/wasm" : path.endsWith(".mjs") ? "text/javascript" : "application/octet-stream" } });
        },
    });
    const tab = await browser({ args });
    try {
        await tab.open(`http://localhost:${server.port}/`, 200);
        for (let tries = 0; tries < 100 && !(await tab.run<boolean>("!!window.ready")); tries++) await tab.wait(100);
    } catch (error) {
        await tab.close();
        server.stop(true);
        throw error;
    }
    return {
        tab,
        origin: `http://localhost:${server.port}`,
        /** Reads a fixture with a size's models on a place, waiting as long as it takes. */
        async read(kind: string, tier: string, place: string): Promise<Fixture> {
            await tab.run(`window.startFixture(${JSON.stringify(kind)}, ${JSON.stringify(tier)}, ${JSON.stringify(place)})`);
            while (!(await tab.run<boolean>("!!window.done"))) await tab.wait(100);
            const found = await tab.run<Fixture & { error?: string }>("window.done");
            if (found.error) throw new Error(found.error);
            return found;
        },
        async close() {
            await tab.close();
            server.stop(true);
        },
    };
}
