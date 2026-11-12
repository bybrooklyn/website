// The engine of dictation, in a worker of its own so that the model's work never holds up typing.
// It downloads a tier's files into the browser's private file storage (resuming a download that was
// interrupted), loads them into ONNX Runtime Web, and recognizes the sound it is sent. The page
// talks to it through engine.ts; the messages are written there.
//
// ONNX Runtime Web is not bundled: parakeet/runtime.ts fetches it as plain files from /ort/, and
// only when a model is loaded, so nothing of it is downloaded until dictation is first switched on
// and this worker is made.

import type { Answer, Ask } from "./engine";
import { createMoonshine, type Moonshine, type Ort } from "./moonshine";
import { download, nameOf, type Folder } from "./download";
import { tierOf, type Tier } from "./models";
import { detect, open, type Recognizer, type Stream } from "./parakeet";
import { ortFor } from "./parakeet/runtime";

const say = (answer: Answer, transfer: Transferable[] = []) => (self as unknown as Worker).postMessage(answer, transfer);

const FOLDER = "mdquire-dictation";
let stop: AbortController | undefined;
let recognize: ((samples: Float32Array) => Promise<{ text: string; words: { text: string; start: number; end: number }[] }>) | undefined;
let release: (() => Promise<void>) | undefined;
/** The Parakeet recognizer, if that is what is loaded, and the phrase being heard live. */
let parakeet: Recognizer | undefined;
let live: Stream | undefined;

/** The folder in the browser's private storage where a tier's files are kept. */
async function folder(tier: Tier): Promise<FileSystemDirectoryHandle> {
    const root = await navigator.storage.getDirectory();
    const top = await root.getDirectoryHandle(FOLDER, { create: true });
    return top.getDirectoryHandle(tier.id, { create: true });
}

/** The tier's folder as download.ts wants it, on the private file storage. */
function storage(dir: FileSystemDirectoryHandle): Folder {
    const has = (name: string) => dir.getFileHandle(name).then(() => true, () => false);
    return {
        async open(name) {
            // createSyncAccessHandle is in every browser's worker but not yet in TypeScript's types
            const handle = (await dir.getFileHandle(name, { create: true })) as FileSystemFileHandle & { createSyncAccessHandle(): Promise<{ getSize(): number; write(data: Uint8Array, options: { at: number }): number; truncate(size: number): void; flush(): void; close(): void }> };
            const access = await handle.createSyncAccessHandle();
            return {
                size: () => access.getSize(),
                write: (data, at) => void access.write(data, { at }),
                truncate: (size) => access.truncate(size),
                flush: () => access.flush(),
                close: () => access.close(),
            };
        },
        whole: (name) => has(`${name}.whole`),
        mark: async (name) => void (await dir.getFileHandle(`${name}.whole`, { create: true })),
    };
}

/** Reads one of a tier's files back from storage. */
async function bytesOf(tier: Tier, role: string): Promise<Uint8Array> {
    const dir = await folder(tier);
    const file = tier.files.find((each) => each.role === role)!;
    return new Uint8Array(await (await (await dir.getFileHandle(nameOf(file.path))).getFile()).arrayBuffer());
}

async function load(tier: Tier, words: string[]) {
    const started = performance.now();
    let place: string;
    let live_ = false;

    if (tier.engine === "moonshine") {
        const ort = await ortFor("wasm");
        const here = await detect();
        ort.env.wasm.numThreads = here.threads;
        ort.env.wasm.simd = true;
        ort.env.wasm.proxy = false;
        const model: Moonshine = await createMoonshine(
            ort as unknown as Ort,
            { encoder: await bytesOf(tier, "encoder"), decoder: await bytesOf(tier, "decoder"), tokenizer: new TextDecoder().decode(await bytesOf(tier, "tokenizer")) },
            { executionProviders: ["wasm"], graphOptimizationLevel: "all" },
        );
        release = () => model.dispose();
        recognize = async (samples) => ({ text: await model.transcribe(samples), words: [] });
        place = here.threads > 1 ? `the processor, ${here.threads} threads` : "the processor";
    } else {
        // a tier whose encoder cannot run on the card is held to the processor, so that no card is asked and fails
        const model = await open(
            { encoder: await bytesOf(tier, "encoder"), decoder: await bytesOf(tier, "decoder"), vocab: new TextDecoder().decode(await bytesOf(tier, "vocab")) },
            { bins: tier.mels === 80 ? 80 : 128, words, prefer: tier.card ? undefined : "wasm" },
        );
        parakeet = model;
        release = () => model.release();
        recognize = async (samples) => model.transcribe(samples);
        live_ = true;
        place = model.backend.kind === "webgpu" ? "the graphics card" : model.backend.threads > 1 ? `the processor, ${model.backend.threads} threads` : "the processor";
    }
    say({ type: "loaded", ms: Math.round(performance.now() - started), backend: place, threads: 1, live: live_ });
}

self.onmessage = async (event: MessageEvent<Ask>) => {
    const ask = event.data;
    try {
        if (ask.type === "download") {
            const tier = tierOf(ask.tier);
            stop = new AbortController();
            await download(tier, storage(await folder(tier)), { signal: stop.signal, progress: (bytes) => say({ type: "progress", bytes }) });
            say({ type: "downloaded" });
        } else if (ask.type === "cancel") {
            stop?.abort();
        } else if (ask.type === "load") {
            await load(tierOf(ask.tier), ask.words);
        } else if (ask.type === "recognize" && recognize) {
            const started = performance.now();
            const heard = await recognize(ask.samples);
            say({ type: "heard", id: ask.id, text: heard.text, words: heard.words, ms: performance.now() - started });
        } else if (ask.type === "words") {
            parakeet?.boost(ask.words);
        } else if (ask.type === "stream-open") {
            live = parakeet?.stream();
        } else if (ask.type === "stream-push" && live) {
            const mine = live;
            const update = await mine.push(ask.samples);
            if (update && live === mine) say({ type: "stream-update", update: { words: update.words, tentative: update.tentative, ms: update.ms, seconds: update.seconds, behind: mine.behind() } });
        } else if (ask.type === "stream-finish") {
            const mine = live;
            live = undefined;
            say({ type: "stream-done", id: ask.id, words: mine ? await mine.finish() : [] });
        } else if (ask.type === "stream-cancel") {
            live = undefined;
        } else if (ask.type === "release") {
            await release?.();
            recognize = undefined;
            parakeet = undefined;
            say({ type: "released" });
        }
    } catch (error) {
        const aborted = error instanceof DOMException && error.name === "AbortError";
        say({ type: "failed", message: aborted ? "cancelled" : error instanceof Error ? error.message : String(error), cancelled: aborted, id: "id" in ask ? ask.id : undefined });
    }
};
