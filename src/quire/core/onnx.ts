// Finding and loading ONNX Runtime Web, for every kind of document that runs a model: mdQuire's
// dictation (md/dictation/parakeet/runtime.ts) and imgQuire's text reader (img/read/runtime.ts). The
// runtime is never bundled: its JavaScript and .wasm files are fetched as plain files from one
// folder, `RUNTIME`, only when a model is first loaded, so a visitor who never uses one downloads none
// of it, and only the build in use is fetched (the WebAssembly one, or the one with WebGPU, JSEP).
// Why each choice was made, with the measurements, is in md/dictation/parakeet/RUNTIME.md.
//
//   const ort = await ortFor<MyOrt>((await graphicsCard()) ? "jsep" : "wasm");
//   settle(ort, threadsHere());

/** Where ONNX Runtime's files are served from. The build copies them there (astro.config.ts); this one line is the whole switch to another build. */
export const RUNTIME = "/ort/";

/** The builds of ONNX Runtime there are, each with the JavaScript that drives it and the WebAssembly module and glue it loads. */
const FILES = {
    wasm: { api: "ort.wasm.min.mjs", glue: "ort-wasm-simd-threaded.mjs", wasm: "ort-wasm-simd-threaded.wasm" },
    jsep: { api: "ort.min.mjs", glue: "ort-wasm-simd-threaded.jsep.mjs", wasm: "ort-wasm-simd-threaded.jsep.wasm" },
} as const;

/** The name of a build of ONNX Runtime: WebAssembly alone, or with WebGPU (JSEP). */
export type Flavor = keyof typeof FILES;

/** The part of the ONNX Runtime module every user sets: where its files are, and its threads. */
export interface OrtBase {
    env: { wasm: { wasmPaths: unknown; numThreads: number; simd: boolean; proxy: boolean } };
}

const modules = new Map<string, Promise<unknown>>();

/** ONNX Runtime of one build, fetched from `base` the first time it is wanted. */
export function ortFor<T extends OrtBase = OrtBase>(flavor: Flavor, base = RUNTIME): Promise<T> {
    const key = flavor + base;
    let loading = modules.get(key) as Promise<T> | undefined;
    if (!loading) {
        const where = new URL(base, self.location.href).href;
        const files = FILES[flavor];
        loading = import(/* @vite-ignore */ where + files.api).then((module: T & { default?: T }) => {
            const ort = module.default ?? module;
            ort.env.wasm.wasmPaths = { mjs: where + files.glue, wasm: where + files.wasm };
            return ort;
        });
        modules.set(key, loading);
        // a fetch that failed (the connection blinked, a deploy was replacing the files) is not remembered, so the next press tries again
        const mine = loading;
        loading.catch(() => {
            if (modules.get(key) === mine) modules.delete(key);
        });
    }
    return loading;
}

/** Puts an ONNX Runtime in place of the one that would be fetched; for tests, which have no server to fetch from. */
export function provide(flavor: Flavor, ort: OrtBase, base = RUNTIME): void {
    modules.set(flavor + base, Promise.resolve(ort));
}

/** Sets a runtime up: SIMD, the threads, and no proxy worker, because the model's own worker is already one. */
export function settle(ort: OrtBase, threads: number): void {
    ort.env.wasm.simd = true;
    ort.env.wasm.proxy = false;
    ort.env.wasm.numThreads = threads;
}

/** Threads WebAssembly can use here: more than one only when the page is cross-origin isolated, which lets it share memory. Half the processor's threads, between 1 and 8: measured, more than that buys little (RUNTIME.md). */
export function threadsHere(): number {
    if (!self.crossOriginIsolated || typeof SharedArrayBuffer === "undefined") return 1;
    return Math.max(1, Math.min(8, Math.floor((navigator.hardwareConcurrency || 2) / 2)));
}

/** Whether the browser gives a real graphics adapter and a device from it, which is the only way to know WebGPU will work. A software stand-in for a card (SwiftShader) runs models slower than WebAssembly, so it is turned down. */
export async function graphicsCard(): Promise<boolean> {
    const gpu = (navigator as unknown as { gpu?: { requestAdapter(): Promise<{ info?: { isFallbackAdapter?: boolean }; requestDevice(): Promise<{ destroy?(): void }> } | null> } }).gpu;
    if (!gpu) return false;
    try {
        const adapter = await gpu.requestAdapter();
        if (!adapter || adapter.info?.isFallbackAdapter) return false;
        // the device was asked for only to know that one is given; it is let go at once rather than left to be collected
        (await adapter.requestDevice()).destroy?.();
        return true;
    } catch {
        return false;
    }
}
