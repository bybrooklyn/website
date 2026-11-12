// The engine of dictation, in a worker of its own so that the model's work never holds up typing.
// It downloads a tier's files into the browser's private file storage (resuming a download that was
// interrupted), loads them into ONNX Runtime Web, and recognizes the sound it is sent. The page
// talks to it through engine.ts; the messages are written there.
//
// ONNX Runtime Web and parakeet.js are the two libraries the editor may import, and they are
// imported here and nowhere else, so that nothing of them is fetched until dictation is first
// switched on and this worker is made.

import type { Answer, Ask } from "./engine";
import { createMoonshine, type Moonshine, type Ort } from "./moonshine";
import { download, nameOf, type Folder } from "./download";
import { tierOf, type Tier } from "./models";
// the .wasm file ONNX Runtime needs, served from the site itself (the build copies it into _astro/)
import wasmFile from "onnxruntime-web/ort-wasm-simd-threaded.jsep.wasm?url";

const say = (answer: Answer, transfer: Transferable[] = []) => (self as unknown as Worker).postMessage(answer, transfer);

const FOLDER = "mdquire-dictation";
let stop: AbortController | undefined;
let recognize: ((samples: Float32Array) => Promise<{ text: string; words: { text: string; start: number; end: number }[] }>) | undefined;
let release: (() => Promise<void>) | undefined;

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

async function load(tier: Tier) {
    const started = performance.now();
    const ort = (await import("onnxruntime-web")) as unknown as Ort & { env: { wasm: { wasmPaths: unknown; numThreads: number; simd: boolean } }; default?: unknown };
    const env = ort.env;
    env.wasm.wasmPaths = { wasm: new URL(wasmFile, self.location.href).href };
    // threads need cross-origin isolation, which this site does not send; without it ONNX Runtime runs on one
    const threads = self.crossOriginIsolated ? Math.min(4, navigator.hardwareConcurrency || 1) : 1;
    env.wasm.numThreads = threads;
    env.wasm.simd = true;
    const session = { executionProviders: ["wasm"], graphOptimizationLevel: "all" };

    if (tier.engine === "moonshine") {
        const model: Moonshine = await createMoonshine(
            ort,
            { encoder: await bytesOf(tier, "encoder"), decoder: await bytesOf(tier, "decoder"), tokenizer: new TextDecoder().decode(await bytesOf(tier, "tokenizer")) },
            session,
        );
        release = () => model.dispose();
        recognize = async (samples) => ({ text: await model.transcribe(samples), words: [] });
    } else {
        const { fromUrls } = await import("parakeet.js");
        const vocab = new TextDecoder().decode(await bytesOf(tier, "vocab"));
        // parakeet.js reads the vocabulary from an address; a page's policy does not allow fetching a blob, so it is handed this one directly
        const real = self.fetch;
        self.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => (String(input) === "dictation:vocab" ? new Response(vocab) : real(input, init))) as typeof fetch;
        let model;
        try {
            model = await fromUrls({
                // files already in memory are accepted wherever an address is, by ONNX Runtime
                encoderUrl: (await bytesOf(tier, "encoder")) as unknown as string,
                decoderUrl: (await bytesOf(tier, "decoder")) as unknown as string,
                tokenizerUrl: "dictation:vocab",
                backend: "wasm",
                preprocessorBackend: "js",
                nMels: tier.mels,
                cpuThreads: threads,
            });
        } finally {
            self.fetch = real;
        }
        release = async () => {
            // the sessions are not in parakeet.js's types, and ending the worker frees them in any case
            const sessions = model as unknown as Record<string, { release?: () => Promise<void> } | undefined>;
            await sessions.encoderSession?.release?.();
            await sessions.joinerSession?.release?.();
        };
        recognize = async (samples) => {
            const result = await model.transcribe(samples, 16000, { returnTimestamps: true, enableProfiling: false });
            return { text: result.utterance_text, words: (result.words ?? []).map((word) => ({ text: word.text, start: word.start_time, end: word.end_time })) };
        };
    }
    say({ type: "loaded", ms: Math.round(performance.now() - started), backend: threads > 1 ? `WASM, ${threads} threads` : "WASM", threads });
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
            await load(tierOf(ask.tier));
        } else if (ask.type === "recognize" && recognize) {
            const started = performance.now();
            const heard = await recognize(ask.samples);
            say({ type: "heard", id: ask.id, text: heard.text, words: heard.words, ms: performance.now() - started });
        } else if (ask.type === "release") {
            await release?.();
            recognize = undefined;
            say({ type: "released" });
        }
    } catch (error) {
        const aborted = error instanceof DOMException && error.name === "AbortError";
        say({ type: "failed", message: aborted ? "cancelled" : error instanceof Error ? error.message : String(error), cancelled: aborted, id: "id" in ask ? ask.id : undefined });
    }
};
