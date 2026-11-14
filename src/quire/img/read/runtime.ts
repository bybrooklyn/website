// ONNX Runtime for the text models: the same build the site already ships for dictation, found and
// loaded by the core (core/onnx.ts) from /ort/ only when text is first read, never bundled. The
// WebAssembly build serves a browser without a usable graphics card and the one with WebGPU (JSEP)
// the rest, as dictation finds them.
//
// The models are made into the four calls the reading takes (read.ts); every PP-OCRv6 file was run
// on this build on both WebGPU and WebAssembly before it was offered (docs/imgQuire-models.md).

import type { Models } from "./read";
import { graphicsCard, ortFor as coreOrtFor, provide as coreProvide, settle, threadsHere } from "../../core/onnx";

// the card and the threads, as the core finds them
export { graphicsCard, threadsHere } from "../../core/onnx";

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

/** Where the models run. */
export type Place = "webgpu" | "wasm";

/** ONNX Runtime for a place: WebAssembly alone, or with WebGPU (JSEP). */
export const ortFor = (place: Place, base?: string): Promise<Ort> => coreOrtFor<Ort>(place === "webgpu" ? "jsep" : "wasm", base);

/** Puts an ONNX Runtime in place of the one that would be fetched; for tests. */
export const provide = (place: Place, ort: Ort): void => coreProvide(place === "webgpu" ? "jsep" : "wasm", ort);

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
        // the reader's own worker is already off the page's thread, so no proxy
        settle(ort, threads);
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
