// Loads a Parakeet model's two ONNX files into ONNX Runtime Web and runs the encoder, on the
// graphics card if the browser has one and on WebAssembly if not. Everything about how the runtime
// is found, which of its files is fetched and how the sessions are made is here and nowhere else;
// the reasons for each choice, with the measurements, are in RUNTIME.md.
//
// ONNX Runtime is not bundled into the page. Its JavaScript and its .wasm files are fetched as
// plain files from one folder, `RUNTIME`, so that only the build in use is downloaded (the
// WebAssembly-only one, 12 MB, or the one with WebGPU, 25 MB) and so that a smaller build made by
// hand can be dropped in by changing that one line. Finding and loading it is the core's
// (core/onnx.ts), shared with imgQuire's text reader; this file makes Parakeet's sessions on it.

import { frameMajor } from "./decode";
import { graphicsCard, ortFor as coreOrtFor, provide as coreProvide, settle, threadsHere, type Flavor } from "../../../core/onnx";

// the runtime's folder, its builds and the threads it may use, as the core finds them
export { RUNTIME, threadsHere, type Flavor } from "../../../core/onnx";

/** Where the models run, and with how many WebAssembly threads (the decoder uses them even when the encoder is on the card). */
export interface Backend {
    kind: "webgpu" | "wasm";
    threads: number;
}

/** What load needs: the two files (bytes, or an address to fetch them from), and what to prefer. */
export interface LoadOptions {
    files: { encoder: ArrayBuffer | Uint8Array | string; decoder: ArrayBuffer | Uint8Array | string };
    prefer?: "webgpu" | "wasm";
    threads?: number;
}

/** What load gives back. */
export interface Loaded {
    backend: Backend;
    /** The ONNX Runtime `InferenceSession`s, for the decoder's loop. */
    encoder: unknown;
    decoder: unknown;
    /** Runs the encoder over mel features laid out [bins, frames] and gives its output as [frames, width]. */
    encode(features: Float32Array, bins: number, frames: number): Promise<{ data: Float32Array; frames: number; width: number }>;
    /** Frees the sessions and with them the model's memory. */
    release(): Promise<void>;
}

/** The few parts of ONNX Runtime Web used here. */
interface Tensor {
    readonly dims: readonly number[];
    readonly data?: unknown;
    getData(): Promise<Float32Array | BigInt64Array>;
    dispose(): void;
}
interface Session {
    readonly inputNames: readonly string[];
    readonly outputNames: readonly string[];
    run(feeds: Record<string, Tensor>): Promise<Record<string, Tensor>>;
    release(): Promise<void>;
}
/** The parts of the ONNX Runtime Web module used here. */
export interface Ort {
    env: { wasm: { wasmPaths: unknown; numThreads: number; simd: boolean; proxy: boolean } };
    InferenceSession: { create(model: Uint8Array | string, options?: object): Promise<Session> };
    Tensor: new (type: string, data: Float32Array | BigInt64Array, dims: number[]) => Tensor;
}

/** ONNX Runtime of one build, fetched from `base` the first time (the core's loader). */
export const ortFor = (flavor: Flavor, base?: string): Promise<Ort> => coreOrtFor<Ort>(flavor, base);

/** Puts an ONNX Runtime in place of the one that would be fetched; for tests, which have no server to fetch from. */
export const provide = (flavor: Flavor, ort: Ort): void => coreProvide(flavor, ort);

/** The build used when the card is. */
const WEBGPU: Flavor = "jsep";

/** What this browser can run, found by trying, not by guessing. */
export async function detect(): Promise<Backend> {
    return { kind: (await graphicsCard()) ? "webgpu" : "wasm", threads: threadsHere() };
}

/** Session options. The encoder is the heavy network and the card's job; the decoder takes one frame at a time and its LSTM runs only on the CPU. */
const ENCODER = { graphOptimizationLevel: "all", enableCpuMemArena: true, enableMemPattern: true, executionMode: "sequential" } as const;
const DECODER = { ...ENCODER, executionProviders: ["wasm"] } as const;

const bytes = (file: ArrayBuffer | Uint8Array | string) => (typeof file === "string" || ArrayBuffer.isView(file) ? (file as Uint8Array | string) : new Uint8Array(file));

/** Loads the two files and gives back the sessions with the encoder ready to run. Falls back to WebAssembly if the card is missing or will not take the encoder. */
export async function load(options: LoadOptions): Promise<Loaded> {
    const here = await detect();
    let kind = options.prefer ?? here.kind;
    // asked for a card the browser does not have
    if (kind === "webgpu" && here.kind !== "webgpu") kind = "wasm";
    const threads = options.threads ?? here.threads;

    let ort = await ortFor(kind === "webgpu" ? WEBGPU : "wasm");
    settle(ort, threads);
    let encoder: Session;
    try {
        encoder = await ort.InferenceSession.create(bytes(options.files.encoder), { ...ENCODER, executionProviders: kind === "webgpu" ? ["webgpu", "wasm"] : ["wasm"] });
    } catch (error) {
        // the card was there but the encoder would not run on it: carry on without it
        if (kind !== "webgpu") throw error;
        console.warn("The encoder would not load on the graphics card, using WebAssembly instead:", error);
        kind = "wasm";
        ort = await ortFor("wasm");
        settle(ort, threads);
        encoder = await ort.InferenceSession.create(bytes(options.files.encoder), { ...ENCODER, executionProviders: ["wasm"] });
    }
    // the decoder follows the encoder into the same module, so that only one WebAssembly module is made
    let decoder: Session;
    try {
        decoder = await ort.InferenceSession.create(bytes(options.files.decoder), DECODER);
    } catch (error) {
        // the encoder made already is let go, or its memory would stay with the worker
        await encoder.release().catch(() => undefined);
        throw error;
    }

    // names and kinds are read from the files, so that a model exported with other names still runs
    const [signal, length] = encoder.inputNames.length > 1 ? [encoder.inputNames[0]!, encoder.inputNames[1]!] : [encoder.inputNames[0]!, undefined];
    const out = encoder.outputNames[0]!;

    const loaded: Loaded = {
        backend: { kind, threads },
        encoder,
        decoder,
        async encode(features, bins, frames) {
            const input = new ort.Tensor("float32", features, [1, bins, frames]);
            const lengths = length ? new ort.Tensor("int64", BigInt64Array.from([BigInt(frames)]), [1]) : undefined;
            const feeds: Record<string, Tensor> = { [signal]: input };
            if (lengths) feeds[length!] = lengths;
            let results: Record<string, Tensor>;
            try {
                results = await encoder.run(feeds);
            } finally {
                input.dispose();
                lengths?.dispose();
            }
            try {
                const tensor = results[out]!;
                // the output is [1, width, frames]; the decoder wants one row of `width` numbers per frame
                const [, width, steps] = tensor.dims as [number, number, number];
                return { data: frameMajor((await tensor.getData()) as Float32Array, width, steps), frames: steps, width };
            } finally {
                // on the card the outputs are its memory, let go whether or not they could be read
                for (const each of Object.values(results)) each.dispose();
            }
        },
        async release() {
            await encoder.release();
            await decoder.release();
        },
    };
    // The card compiles its programs the first time it runs the network, which takes most of a second;
    // one run over a second of silence here moves that from the first words spoken to the load.
    if (kind === "webgpu") {
        const bins = (encoder as Session & { inputMetadata?: { shape?: (number | string)[] }[] }).inputMetadata?.[0]?.shape?.[1];
        if (typeof bins === "number") await loaded.encode(new Float32Array(bins * 100), bins, 100).catch(() => undefined);
    }
    return loaded;
}
