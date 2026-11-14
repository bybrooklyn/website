// The engine's two sides, joined by a stand-in for the worker that hands each message straight to
// `serve`: a size not kept says so, a fetch reports its progress and a fetch from a host that answers
// wrongly fails with the reason, and (with the real tiny files on this machine, on a made-up ONNX
// Runtime) a reading gives its lines and where it ran, and a reading stopped gives up as cancelled.

import { afterEach, expect, test } from "bun:test";
import { homedir } from "node:os";
import { createReader, serve, type Answer, type Ask } from "./engine";
import { keptName, tierOf } from "./models";
import { provide, type Ort } from "./runtime";
import type { Shelf } from "./store";

function memoryShelf(): Shelf {
    const files = new Map<string, Uint8Array>();
    const marks = new Map<string, string>();
    return {
        write: async (name, bytes) => void files.set(name, bytes.slice()),
        read: async (name) => files.get(name),
        size: async (name) => files.get(name)?.length ?? -1,
        mark: async (name, said) => void marks.set(name, said),
        marked: async (name) => marks.get(name),
    };
}

/** A worker stand-in: what the page posts goes to `serve`, and what `serve` says comes back as a message. */
function stand(shelf: Shelf, network?: typeof fetch) {
    const worker = {
        onmessage: undefined as ((event: MessageEvent<Answer>) => void) | undefined,
        postMessage(ask: Ask) {
            void serve(ask, { shelf: async () => shelf, fetch: network, say: (answer) => setTimeout(() => worker.onmessage?.({ data: answer } as MessageEvent<Answer>)) });
        },
        terminate() {},
    };
    return worker as unknown as Worker;
}

const original = { ...globalThis } as Record<string, unknown>;
afterEach(() => {
    for (const key of ["navigator", "self"]) {
        if (key in original) (globalThis as Record<string, unknown>)[key] = original[key];
        else delete (globalThis as Record<string, unknown>)[key];
    }
});

test("a size not kept says so, and a fetch from a host that answers wrongly fails with the reason", async () => {
    const reader = createReader(() => stand(memoryShelf(), (async () => new Response("no", { status: 404 })) as unknown as typeof fetch));
    expect(await reader.have("tiny")).toEqual({ have: false, bytes: 0 });
    await expect(reader.fetch("tiny")).rejects.toThrow("the server answered 404");
});

test("with the tiny files kept, a reading gives its lines and where it ran; a reading stopped gives up as cancelled", async () => {
    const tier = tierOf("tiny");
    const shelf = memoryShelf();
    for (const each of tier.files) {
        const kept = Bun.file(`${homedir()}/.cache/quire-model-trials/ocr/${each.repo.slice("PaddlePaddle/".length)}/${each.path}`);
        if (!(await kept.exists())) return console.warn("engine reading not tried: the tiny text models are not on this machine");
        await shelf.write(keptName(each), new Uint8Array(await kept.arrayBuffer()));
        await shelf.mark(keptName(each), each.sha256);
    }
    Object.assign(globalThis, { navigator: { hardwareConcurrency: 4 }, self: globalThis });
    // an ONNX Runtime that finds no text anywhere
    const ort = {
        env: { wasm: { wasmPaths: undefined, numThreads: 0, simd: false, proxy: true } },
        Tensor: class {
            constructor(public type: string, public data: Float32Array, public dims: number[]) {}
            async getData() {
                return new Float32Array(this.dims.reduce((a, b) => a * b, 1) / 3);
            }
            dispose() {}
        },
        InferenceSession: { create: async () => ({ inputNames: ["x"], outputNames: ["y"], run: async (feeds: Record<string, unknown>) => ({ y: feeds.x }), release: async () => {} }) },
    } as unknown as Ort;
    provide("wasm", ort);
    const reader = createReader(() => stand(shelf));
    expect((await reader.have("tiny")).have).toBe(true);
    const picture = { width: 64, height: 32, data: new Uint8ClampedArray(64 * 32 * 4).fill(255) };
    const progress: number[] = [];
    const job = reader.read(picture as unknown as ImageBitmap, "tiny", (done) => progress.push(done), "wasm");
    const read = await job.done;
    expect(read.lines).toEqual([]);
    expect(read.place).toBe("wasm");
    expect(progress.at(-1)).toBe(1);
    const stopped = reader.read(picture as unknown as ImageBitmap, "tiny", undefined, "wasm");
    stopped.stop();
    await expect(stopped.done).rejects.toThrow("cancelled");
});
