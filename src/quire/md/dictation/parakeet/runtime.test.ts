// Tests of runtime.ts with a made-up ONNX Runtime and a made-up browser: what it asks for, the way it lays out
// the encoder output, and what it does when the card is missing or will not take the model.

import { afterEach, describe, expect, test } from "bun:test";
import { detect, load, ortFor, provide, type Ort } from "./runtime";

// A stand-in for ONNX Runtime: sessions that record how they were made and what they were fed.
interface Made {
    options: Record<string, unknown>;
    released: boolean;
    fed: Record<string, { dims: number[]; data: unknown }>[];
}

function fakeOrt(opts: { width?: number; steps?: number; failOn?: string; failDecoder?: boolean; unreadable?: boolean } = {}) {
    const disposed: unknown[] = [];
    const width = opts.width ?? 3;
    const steps = opts.steps ?? 2;
    const made: Made[] = [];
    const ort = {
        env: { wasm: { wasmPaths: undefined as unknown, numThreads: 0, simd: false, proxy: true } },
        Tensor: class {
            disposed = false;
            constructor(public type: string, public data: unknown, public dims: number[]) {}
            async getData() {
                if (opts.unreadable) throw new Error("the card lost it");
                return this.data as Float32Array;
            }
            dispose() {
                this.disposed = true;
                disposed.push(this);
            }
        },
        InferenceSession: {
            async create(_model: unknown, options: Record<string, unknown> = {}) {
                if (opts.failOn && (options.executionProviders as unknown[]).includes(opts.failOn)) throw new Error("Only 4b quantization is supported");
                if (opts.failDecoder && made.length === 1) throw new Error("the decoder file is broken");
                const record: Made = { options, released: false, fed: [] };
                made.push(record);
                const encoder = made.length === 1 || (options.executionProviders as unknown[]).length === 2;
                return {
                    inputNames: encoder ? ["audio_signal", "length"] : ["encoder_outputs"],
                    outputNames: encoder ? ["outputs", "encoded_lengths"] : ["outputs"],
                    inputMetadata: [{ shape: ["batch", 128, "frames"] }],
                    async run(feeds: Record<string, { dims: number[]; data: unknown }>) {
                        record.fed.push(feeds);
                        // [1, width, steps], the way the Parakeet encoder lays its output: value = width index * 10 + step
                        const data = new Float32Array(width * steps);
                        for (let at = 0; at < width; at++) for (let step = 0; step < steps; step++) data[at * steps + step] = at * 10 + step;
                        return { outputs: new ort.Tensor("float32", data, [1, width, steps]), encoded_lengths: new ort.Tensor("int64", new BigInt64Array(1), [1]) };
                    },
                    async release() {
                        record.released = true;
                    },
                };
            },
        },
    };
    return { ort: ort as unknown as Ort, made, raw: ort, disposed };
}

const files = { encoder: new ArrayBuffer(8), decoder: new ArrayBuffer(8) };
const original = { ...globalThis } as Record<string, unknown>;
function browser(settings: { gpu?: unknown; isolated?: boolean; cores?: number }) {
    Object.assign(globalThis, { navigator: { gpu: settings.gpu, hardwareConcurrency: settings.cores ?? 8 }, crossOriginIsolated: settings.isolated ?? false, SharedArrayBuffer: Object });
    (globalThis as { self?: unknown }).self = globalThis;
}
const card = (info: { isFallbackAdapter?: boolean } = {}) => ({ requestAdapter: async () => ({ info, requestDevice: async () => ({}) }) });
afterEach(() => {
    for (const key of ["navigator", "crossOriginIsolated", "SharedArrayBuffer", "self", "location"]) {
        if (key in original) (globalThis as Record<string, unknown>)[key] = original[key];
        else delete (globalThis as Record<string, unknown>)[key];
    }
});

describe("detect", () => {
    test("a browser without WebGPU gets WebAssembly", async () => {
        browser({});
        expect((await detect()).kind).toBe("wasm");
    });
    test("a real adapter that gives a device gets WebGPU, and the device asked for to know it is let go", async () => {
        let destroyed = 0;
        browser({ gpu: { requestAdapter: async () => ({ info: {}, requestDevice: async () => ({ destroy: () => void destroyed++ }) }) } });
        expect((await detect()).kind).toBe("webgpu");
        expect(destroyed).toBe(1);
    });
    test("a software adapter is turned down, because it is slower than WebAssembly", async () => {
        browser({ gpu: card({ isFallbackAdapter: true }) });
        expect((await detect()).kind).toBe("wasm");
    });
    test("an adapter that will not give a device is turned down", async () => {
        browser({ gpu: { requestAdapter: async () => ({ requestDevice: async () => Promise.reject(new Error("lost")) }) } });
        expect((await detect()).kind).toBe("wasm");
    });
    test("a page that is not cross-origin isolated gets one thread, an isolated one half the processor's threads, from one to eight", async () => {
        browser({ cores: 16 });
        expect((await detect()).threads).toBe(1);
        browser({ cores: 16, isolated: true });
        expect((await detect()).threads).toBe(8);
        browser({ cores: 2, isolated: true });
        expect((await detect()).threads).toBe(1);
        browser({ cores: 12, isolated: true });
        expect((await detect()).threads).toBe(6);
        browser({ cores: 32, isolated: true });
        expect((await detect()).threads).toBe(8);
    });
});

describe("ortFor", () => {
    test("a fetch of the runtime that failed is not kept: the next asks again", async () => {
        browser({});
        (globalThis as { location?: unknown }).location = { href: "file:///nowhere/at/all/" };
        const first = ortFor("wasm", "/missing-runtime/");
        await expect(first).rejects.toBeDefined();
        await new Promise((done) => setTimeout(done, 0));
        const second = ortFor("wasm", "/missing-runtime/");
        expect(second).not.toBe(first);
        await expect(second).rejects.toBeDefined();
    });
});

describe("load", () => {
    test("the encoder output is turned from [width, frames] into one row of width numbers per frame", async () => {
        browser({});
        const { ort } = fakeOrt({ width: 3, steps: 2 });
        provide("wasm", ort);
        const loaded = await load({ files });
        const out = await loaded.encode(new Float32Array(128 * 5), 128, 5);
        expect(out.frames).toBe(2);
        expect(out.width).toBe(3);
        // frame 0 is [0, 10, 20], frame 1 is [1, 11, 21]
        expect(Array.from(out.data)).toEqual([0, 10, 20, 1, 11, 21]);
    });
    test("the input names and the frame count are read from the session and fed as they are", async () => {
        browser({});
        const { ort, made } = fakeOrt();
        provide("wasm", ort);
        const loaded = await load({ files });
        await loaded.encode(new Float32Array(80 * 7), 80, 7);
        const fed = made[0]!.fed[0]!;
        expect(fed.audio_signal!.dims).toEqual([1, 80, 7]);
        expect(fed.length!.dims).toEqual([1]);
        expect((fed.length!.data as BigInt64Array)[0]).toBe(7n);
    });
    test("the decoder always runs on WebAssembly, and the encoder only on it when there is no card", async () => {
        browser({});
        const { ort, made } = fakeOrt();
        provide("wasm", ort);
        await load({ files });
        expect(made[0]!.options.executionProviders).toEqual(["wasm"]);
        expect(made[1]!.options.executionProviders).toEqual(["wasm"]);
    });
    test("with a card the encoder is offered it first and WebAssembly after, and a first run is made to compile its programs", async () => {
        browser({ gpu: card() });
        const { ort, made } = fakeOrt();
        provide("jsep", ort);
        const loaded = await load({ files });
        expect(loaded.backend.kind).toBe("webgpu");
        expect(made[0]!.options.executionProviders).toEqual(["webgpu", "wasm"]);
        expect(made[1]!.options.executionProviders).toEqual(["wasm"]);
        expect(made[0]!.fed.length).toBe(1);
    });
    test("an encoder the card cannot take is loaded on WebAssembly instead, and the backend says so", async () => {
        browser({ gpu: card() });
        const gpuSide = fakeOrt({ failOn: "webgpu" });
        const wasmSide = fakeOrt();
        provide("jsep", gpuSide.ort);
        provide("wasm", wasmSide.ort);
        const warn = console.warn;
        console.warn = () => undefined;
        const loaded = await load({ files });
        console.warn = warn;
        expect(loaded.backend.kind).toBe("wasm");
        expect(wasmSide.made.length).toBe(2);
    });
    test("asking for the card in a browser that has none gives WebAssembly", async () => {
        browser({});
        const { ort } = fakeOrt();
        provide("wasm", ort);
        expect((await load({ files, prefer: "webgpu" })).backend.kind).toBe("wasm");
    });
    test("threads are given to the runtime, and the module is set up for SIMD without a proxy worker", async () => {
        browser({ isolated: true });
        const { ort, raw } = fakeOrt();
        provide("wasm", ort);
        const loaded = await load({ files, threads: 3 });
        expect(raw.env.wasm.numThreads).toBe(3);
        expect(raw.env.wasm.simd).toBe(true);
        expect(raw.env.wasm.proxy).toBe(false);
        expect(loaded.backend.threads).toBe(3);
    });
    test("a decoder that will not load lets go of the encoder made before it", async () => {
        browser({});
        const { ort, made } = fakeOrt({ failDecoder: true });
        provide("wasm", ort);
        await expect(load({ files })).rejects.toThrow("broken");
        expect(made.map((each) => each.released)).toEqual([true]);
    });
    test("an encoder output that cannot be read is let go all the same", async () => {
        browser({});
        const { ort, disposed } = fakeOrt({ unreadable: true });
        provide("wasm", ort);
        const loaded = await load({ files });
        await expect(loaded.encode(new Float32Array(128 * 5), 128, 5)).rejects.toThrow("lost");
        // the two inputs and the two outputs
        expect(disposed.length).toBe(4);
    });
    test("release lets go of both sessions", async () => {
        browser({});
        const { ort, made } = fakeOrt();
        provide("wasm", ort);
        const loaded = await load({ files });
        await loaded.release();
        expect(made.map((each) => each.released)).toEqual([true, true]);
    });
});
