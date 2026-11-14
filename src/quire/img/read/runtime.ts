// ONNX Runtime for the text models: the same build the site already ships for dictation, fetched as
// plain files from /ort/ only when text is first read, never bundled. The WebAssembly build serves a
// browser without a usable graphics card and the one with WebGPU (JSEP) the rest, as dictation finds
// them (src/quire/md/dictation/parakeet/runtime.ts, whose measurements are in RUNTIME.md). A kind of
// document may not import another's code, so the few lines that find and load the runtime are
// written here again; they fetch the same files from the same folder.
//
// The models are made into the four calls the reading takes (read.ts); every PP-OCRv6 file was run
// on this build on both WebGPU and WebAssembly before it was offered (docs/imgQuire-models.md).

import type { Models } from "./read";

/** Where ONNX Runtime's files are served from: the folder the build copies them into (astro.config.ts). */
export const RUNTIME = "/ort/";

/** The few parts of a tensor used here. */
interface Tensor {
    readonly dims: readonly number[];
    getData(): Promise<Float32Array>;
    dispose(): void;
}
/** The few parts of a session used here. */
interface Session {
    readonly inputNames: readonly string[];
    readonly outputNames: readonly string[];
    run(feeds: Record<string, Tensor>): Promise<Record<string, Tensor>>;
    release(): Promise<void>;
}
/** The parts of the ONNX Runtime module used here. */
export interface Ort {
    env: { wasm: { wasmPaths: unknown; numThreads: number; simd: boolean; proxy: boolean } };
    InferenceSession: { create(model: Uint8Array, options?: object): Promise<Session> };
    Tensor: new (type: string, data: Float32Array, dims: number[]) => Tensor;
}

/** The two builds: the JavaScript that drives each, and the WebAssembly module and glue it loads. */
const FILES = {
    wasm: { api: "ort.wasm.min.mjs", glue: "ort-wasm-simd-threaded.mjs", wasm: "ort-wasm-simd-threaded.wasm" },
    jsep: { api: "ort.min.mjs", glue: "ort-wasm-simd-threaded.jsep.mjs", wasm: "ort-wasm-simd-threaded.jsep.wasm" },
} as const;

/** Where the models run. */
export type Place = "webgpu" | "wasm";

const modules = new Map<string, Promise<Ort>>();

/** ONNX Runtime of one build, fetched from `base` the first time it is wanted. */
export function ortFor(place: Place, base = RUNTIME): Promise<Ort> {
    const key = place + base;
    let loading = modules.get(key);
    if (!loading) {
        const where = new URL(base, self.location.href).href;
        const files = FILES[place === "webgpu" ? "jsep" : "wasm"];
        loading = import(/* @vite-ignore */ where + files.api).then((module: Ort & { default?: Ort }) => {
            const ort = module.default ?? module;
            ort.env.wasm.wasmPaths = { mjs: where + files.glue, wasm: where + files.wasm };
            return ort;
        });
        modules.set(key, loading);
        // a fetch that failed is not remembered, so the next reading tries again
        const mine = loading;
        loading.catch(() => modules.get(key) === mine && modules.delete(key));
    }
    return loading;
}

/** Puts an ONNX Runtime in place of the one that would be fetched; for tests. */
export function provide(place: Place, ort: Ort, base = RUNTIME): void {
    modules.set(place + base, Promise.resolve(ort));
}

/** WebAssembly threads here: more than one only where the page is cross-origin isolated, half the processor's threads, from 1 to 8, as dictation measured. */
export function threadsHere(): number {
    if (!self.crossOriginIsolated || typeof SharedArrayBuffer === "undefined") return 1;
    return Math.max(1, Math.min(8, Math.floor((navigator.hardwareConcurrency || 2) / 2)));
}

/** Whether a real graphics card gives a device: a software stand-in for one runs these models slower than WebAssembly. */
export async function graphicsCard(): Promise<boolean> {
    const gpu = (navigator as unknown as { gpu?: { requestAdapter(): Promise<{ info?: { isFallbackAdapter?: boolean }; requestDevice(): Promise<{ destroy?(): void }> } | null> } }).gpu;
    if (!gpu) return false;
    try {
        const adapter = await gpu.requestAdapter();
        if (!adapter || adapter.info?.isFallbackAdapter) return false;
        (await adapter.requestDevice()).destroy?.();
        return true;
    } catch {
        return false;
    }
}

/** A tier's models, made: the four calls, where they run, and a way to let them go. */
export interface Made {
    models: Models;
    place: Place;
    threads: number;
    release(): Promise<void>;
}

/** Makes sessions of a tier's files on the graphics card where there is one, else on WebAssembly; a file the card will not take sends them all to WebAssembly. */
export async function makeModels(files: { detect: Uint8Array; recognize: Uint8Array; line?: Uint8Array; page?: Uint8Array }, prefer?: Place): Promise<Made> {
    const threads = threadsHere();
    const first: Place = prefer ?? ((await graphicsCard()) ? "webgpu" : "wasm");
    for (const place of first === "webgpu" ? (["webgpu", "wasm"] as const) : (["wasm"] as const)) {
        const ort = await ortFor(place);
        ort.env.wasm.simd = true;
        // the reader's own worker is already off the page's thread
        ort.env.wasm.proxy = false;
        ort.env.wasm.numThreads = threads;
        const options = { executionProviders: place === "webgpu" ? ["webgpu", "wasm"] : ["wasm"], graphOptimizationLevel: "all" };
        const made: Session[] = [];
        try {
            const session = async (bytes: Uint8Array | undefined) => {
                if (!bytes) return undefined;
                const one = await ort.InferenceSession.create(bytes, options);
                made.push(one);
                return one;
            };
            const detect = (await session(files.detect))!;
            const recognize = (await session(files.recognize))!;
            const line = await session(files.line);
            const page = await session(files.page);
            const run = async (session: Session, input: Float32Array, dims: number[]) => {
                const tensor = new ort.Tensor("float32", input, dims);
                let results: Record<string, Tensor>;
                try {
                    results = await session.run({ [session.inputNames[0]!]: tensor });
                } finally {
                    tensor.dispose();
                }
                try {
                    const out = results[session.outputNames[0]!]!;
                    return { data: await out.getData(), dims: out.dims };
                } finally {
                    for (const each of Object.values(results)) each.dispose();
                }
            };
            const models: Models = {
                detect: async (input, width, height) => (await run(detect, input, [1, 3, height, width])).data,
                async recognize(input, batch, width) {
                    const { data, dims } = await run(recognize, input, [batch, 3, 48, width]);
                    return { data, frames: dims[1]!, classes: dims[2]! };
                },
                ...(line && { line: async (input: Float32Array, batch: number) => (await run(line, input, [batch, 3, 80, 160])).data }),
                ...(page && { page: async (input: Float32Array) => (await run(page, input, [1, 3, 224, 224])).data }),
            };
            return { models, place, threads, release: async () => void (await Promise.all(made.map((each) => each.release()))) };
        } catch (error) {
            await Promise.all(made.map((each) => each.release().catch(() => undefined)));
            if (place === "wasm") throw error;
            console.warn("The text models would not load on the graphics card, using WebAssembly instead:", error);
        }
    }
    throw new Error("the text models could not be loaded");
}
