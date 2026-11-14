// The core's loader of ONNX Runtime, on a made-up browser: threads only where the page is isolated,
// a software graphics card turned down, a runtime put in place given back for its build and folder,
// settle setting SIMD, threads and no proxy, and a fetch that failed not kept.

import { afterEach, expect, test } from "bun:test";
import { graphicsCard, ortFor, provide, settle, threadsHere, type OrtBase } from "./onnx";

const original = { ...globalThis } as Record<string, unknown>;
function browser(settings: { gpu?: unknown; isolated?: boolean; cores?: number }) {
    Object.assign(globalThis, { navigator: { gpu: settings.gpu, hardwareConcurrency: settings.cores ?? 8 }, crossOriginIsolated: settings.isolated ?? false, SharedArrayBuffer: Object });
    (globalThis as { self?: unknown }).self = globalThis;
}
afterEach(() => {
    for (const key of ["navigator", "crossOriginIsolated", "SharedArrayBuffer", "self", "location"]) {
        if (key in original) (globalThis as Record<string, unknown>)[key] = original[key];
        else delete (globalThis as Record<string, unknown>)[key];
    }
});
const fake = (): OrtBase => ({ env: { wasm: { wasmPaths: undefined, numThreads: 0, simd: false, proxy: true } } });

test("threads only where the page is isolated: half the processor's, from 1 to 8", () => {
    browser({ isolated: false, cores: 16 });
    expect(threadsHere()).toBe(1);
    browser({ isolated: true, cores: 12 });
    expect(threadsHere()).toBe(6);
    browser({ isolated: true, cores: 32 });
    expect(threadsHere()).toBe(8);
});

test("a real card is used, a software stand-in or none is not", async () => {
    browser({ gpu: { requestAdapter: async () => ({ info: {}, requestDevice: async () => ({}) }) } });
    expect(await graphicsCard()).toBe(true);
    browser({ gpu: { requestAdapter: async () => ({ info: { isFallbackAdapter: true }, requestDevice: async () => ({}) }) } });
    expect(await graphicsCard()).toBe(false);
    browser({ gpu: { requestAdapter: async () => null } });
    expect(await graphicsCard()).toBe(false);
    browser({});
    expect(await graphicsCard()).toBe(false);
});

test("a runtime put in place is given back for its build and folder, and settle sets it up", async () => {
    browser({});
    const wasm = fake();
    const jsep = fake();
    provide("wasm", wasm, "/somewhere/");
    provide("jsep", jsep, "/somewhere/");
    expect(await ortFor("wasm", "/somewhere/")).toBe(wasm);
    expect(await ortFor("jsep", "/somewhere/")).toBe(jsep);
    settle(wasm, 4);
    expect(wasm.env.wasm).toEqual({ wasmPaths: undefined, numThreads: 4, simd: true, proxy: false });
});

test("a fetch of the runtime that failed is not kept: the next asks again", async () => {
    browser({});
    (globalThis as { location?: unknown }).location = { href: "file:///nowhere/at/all/" };
    const first = ortFor("wasm", "/missing-runtime-core/");
    await expect(first).rejects.toBeDefined();
    await new Promise((done) => setTimeout(done, 0));
    const second = ortFor("wasm", "/missing-runtime-core/");
    expect(second).not.toBe(first);
    await expect(second).rejects.toBeDefined();
});
