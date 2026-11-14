// The runtime for the text models, on a made-up ONNX Runtime and a made-up browser: threads only
// where the page is isolated, a software graphics card turned down, each model given its input in the
// shape it takes, a card that will not take the files sending them to WebAssembly, and every session
// let go on release.

import { afterEach, expect, test } from "bun:test";
import { graphicsCard, makeModels, provide, threadsHere, type Ort } from "./runtime";

const original = { ...globalThis } as Record<string, unknown>;
function browser(settings: { gpu?: unknown; isolated?: boolean; cores?: number }) {
    Object.assign(globalThis, { navigator: { gpu: settings.gpu, hardwareConcurrency: settings.cores ?? 8 }, crossOriginIsolated: settings.isolated ?? false, SharedArrayBuffer: Object });
    (globalThis as { self?: unknown }).self = globalThis;
}
afterEach(() => {
    for (const key of ["navigator", "crossOriginIsolated", "SharedArrayBuffer", "self"]) {
        if (key in original) (globalThis as Record<string, unknown>)[key] = original[key];
        else delete (globalThis as Record<string, unknown>)[key];
    }
});

/** A stand-in for ONNX Runtime whose sessions record what they were fed and answer in the shapes the models do. */
function fakeOrt(failOnCard = false) {
    const fed: { name: number; dims: number[] }[] = [];
    let released = 0;
    let made = 0;
    const ort = {
        env: { wasm: { wasmPaths: undefined as unknown, numThreads: 0, simd: false, proxy: true } },
        Tensor: class {
            constructor(public type: string, public data: Float32Array, public dims: number[]) {}
            async getData() {
                return this.data;
            }
            dispose() {}
        },
        InferenceSession: {
            async create(model: Uint8Array, options: { executionProviders: string[] }) {
                if (failOnCard && options.executionProviders[0] === "webgpu") throw new Error("not on this card");
                made++;
                const name = model[0]!;
                return {
                    inputNames: ["x"],
                    outputNames: ["out"],
                    async run(feeds: Record<string, { dims: number[] }>) {
                        const dims = feeds.x!.dims;
                        fed.push({ name, dims });
                        const out = name === 1 ? [1, 1, dims[2]!, dims[3]!] : name === 2 ? [dims[0]!, dims[3]! / 8, 5] : name === 3 ? [dims[0]!, 2] : [1, 4];
                        return { out: new ort.Tensor("float32", new Float32Array(out.reduce((a, b) => a * b, 1)), out) };
                    },
                    async release() {
                        released++;
                    },
                };
            },
        },
    };
    return { ort: ort as unknown as Ort, fed, released: () => released, made: () => made };
}
const files = { detect: new Uint8Array([1]), recognize: new Uint8Array([2]), line: new Uint8Array([3]), page: new Uint8Array([4]) };

test("threads only where the page is isolated: half the processor's, from 1 to 8", () => {
    browser({ isolated: false, cores: 16 });
    expect(threadsHere()).toBe(1);
    browser({ isolated: true, cores: 8 });
    expect(threadsHere()).toBe(4);
    browser({ isolated: true, cores: 32 });
    expect(threadsHere()).toBe(8);
});

test("a real card is used and a software stand-in for one is not", async () => {
    browser({ gpu: { requestAdapter: async () => ({ info: { isFallbackAdapter: false }, requestDevice: async () => ({}) }) } });
    expect(await graphicsCard()).toBe(true);
    browser({ gpu: { requestAdapter: async () => ({ info: { isFallbackAdapter: true }, requestDevice: async () => ({}) }) } });
    expect(await graphicsCard()).toBe(false);
    browser({});
    expect(await graphicsCard()).toBe(false);
});

test("each model is given its input in the shape it takes, and its answer read in its shape", async () => {
    browser({});
    const fake = fakeOrt();
    provide("wasm", fake.ort);
    const made = await makeModels(files);
    expect(made.place).toBe("wasm");
    expect((await made.models.detect(new Float32Array(3 * 64 * 96), 96, 64)).length).toBe(64 * 96);
    const read = await made.models.recognize(new Float32Array(2 * 3 * 48 * 320), 2, 320);
    expect([read.frames, read.classes]).toEqual([40, 5]);
    await made.models.line!(new Float32Array(3 * 3 * 80 * 160), 3);
    await made.models.page!(new Float32Array(3 * 224 * 224));
    expect(fake.fed.map((each) => each.dims)).toEqual([[1, 3, 64, 96], [2, 3, 48, 320], [3, 3, 80, 160], [1, 3, 224, 224]]);
    await made.release();
    expect(fake.released()).toBe(4);
});

test("a card that will not take the files sends them all to WebAssembly, letting go of what it made", async () => {
    browser({ gpu: { requestAdapter: async () => ({ info: {}, requestDevice: async () => ({}) }) } });
    const card = fakeOrt(true);
    const plain = fakeOrt();
    provide("webgpu", card.ort);
    provide("wasm", plain.ort);
    const made = await makeModels({ detect: files.detect, recognize: files.recognize });
    expect(made.place).toBe("wasm");
    expect(made.models.line).toBeUndefined();
    expect(plain.made()).toBe(2);
});
