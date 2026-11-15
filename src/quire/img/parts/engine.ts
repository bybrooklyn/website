// The part models' engine, in a worker of its own as the text reader's is (read/engine.ts): it says
// whether a choice's files are kept, fetches them (read/store.ts, into a folder of their own), makes
// them into sessions on the site's ONNX Runtime through the core (core/onnx.ts), and finds parts: a
// picture's encoding made once and kept, then each set of presses decoded into a mask, or the subject
// found by the matting model. The picture comes as a bitmap and goes nowhere: the worker's only
// requests are for the model files and ONNX Runtime's own. Both sides are here: `serve` in the
// worker, `createFinder` on the page.
//
//   const finder = createFinder();
//   const found = await finder.select("small", key, bitmap, [{ x, y, add: true }]);

import { graphicsCard, ortFor, settle, threadsHere } from "../../core/onnx";
import { bytesOf, fetchTier, keptAll, privateShelf, type Shelf } from "../read/store";
import type { Found } from "../masks";
import { partFile, partTierOf, type PartRole, type PartTier } from "./models";
import { bestOf, cropOf, fitOf, foundOf, planesOf, promptOf, type Fit, type Press, type Way } from "./segment";

/** What the page asks. */
export type Ask =
    | { type: "have"; id: number; tier: string }
    | { type: "fetch"; id: number; tier: string; host?: string }
    | { type: "cancel" }
    | { type: "select"; id: number; tier: string; key: string; picture?: ImageBitmap; presses: Press[]; prefer?: "webgpu" | "wasm"; card?: PartTier["card"] }
    | { type: "matte"; id: number; tier: string; picture: ImageBitmap; prefer?: "webgpu" | "wasm"; card?: PartTier["card"] };

/** What the worker answers. */
export type Answer =
    | { type: "have"; id: number; have: boolean }
    | { type: "progress"; id: number; done: number }
    | { type: "fetched"; id: number }
    | { type: "found"; id: number; found: Found; ms: number; place: string }
    | { type: "failed"; id: number; message: string; cancelled: boolean; again?: boolean };

/** The parts of ONNX Runtime used here. */
interface Tensor {
    readonly dims: readonly number[];
    getData(): Promise<Float32Array>;
    dispose(): void;
}
interface Session {
    readonly inputNames: readonly string[];
    run(feeds: Record<string, unknown>): Promise<Record<string, Tensor>>;
    release(): Promise<void>;
}
interface Ort {
    env: { wasm: { wasmPaths: unknown; numThreads: number; simd: boolean; proxy: boolean } };
    InferenceSession: { create(model: Uint8Array, options?: object): Promise<Session> };
    Tensor: new (type: string, data: Float32Array | BigInt64Array, dims: number[]) => Tensor;
}

/** The sessions of one choice, made once, each where it runs; the WebAssembly runtime's tensors are the ones fed to every session. */
interface Made {
    tier: PartTier;
    place: string;
    ort: Ort;
    sessions: Partial<Record<"encode" | "decode" | "matte", Session>>;
}

const state = { fetches: new Set<AbortController>(), made: undefined as Promise<Made> | undefined, madeFor: "", encoded: undefined as { key: string; tier: string; fit: Fit; outputs: Record<string, Tensor> } | undefined };

/** A session of a file (and its weights kept beside it, if it has them) on a place. */
async function session(ort: Ort, shelf: Shelf, tier: PartTier, role: "encode" | "decode" | "matte", place: "webgpu" | "wasm"): Promise<Session | undefined> {
    const main = partFile(tier, role);
    if (!main) return undefined;
    const data = partFile(tier, `${role}Data` as PartRole);
    const options: Record<string, unknown> = { executionProviders: place === "webgpu" ? ["webgpu", "wasm"] : ["wasm"], graphOptimizationLevel: "all" };
    if (data) options.externalData = [{ path: data.path.split("/").pop(), data: await bytesOf(shelf, data) }];
    return ort.InferenceSession.create(await bytesOf(shelf, main), options);
}

/** A choice's sessions, on the graphics card where there is one and it takes them, else on WebAssembly. */
async function madeFor(given: PartTier, shelf: Shelf, prefer?: "webgpu" | "wasm", card?: PartTier["card"]): Promise<Made> {
    // a trial may say which models to try on the card, in place of the table's
    const tier = card ? { ...given, card } : given;
    const key = `${tier.id} ${prefer ?? ""} ${tier.card.join()}`;
    if (state.made && state.madeFor === key) return state.made;
    const before = state.made;
    state.encoded = undefined;
    if (before) await before.then((made) => Promise.all(Object.values(made.sessions).map((each) => each?.release()))).catch(() => undefined);
    state.madeFor = key;
    state.made = (async () => {
        const card = prefer !== "wasm" && (prefer === "webgpu" || (await graphicsCard()));
        // the build with WebGPU (JSEP) runs WebAssembly too, so with a card one runtime serves every session, each on the card where it runs right there
        const ort = await ortFor<Ort>(card ? "jsep" : "wasm");
        settle(ort, threadsHere());
        const sessions: Made["sessions"] = {};
        const places: string[] = [];
        for (const role of ["encode", "decode", "matte"] as const) {
            let place: "webgpu" | "wasm" = card && tier.card.includes(role) ? "webgpu" : "wasm";
            try {
                sessions[role] = await session(ort, shelf, tier, role, place);
            } catch (error) {
                if (place === "wasm") throw error;
                console.warn(`The ${role} model would not load on the graphics card, so it runs on WebAssembly:`, error);
                place = "wasm";
                sessions[role] = await session(ort, shelf, tier, role, place);
            }
            places.push(`${role} ${place}`);
        }
        return { tier, place: places.join(", "), ort, sessions };
    })();
    state.made.catch(() => (state.made = undefined));
    return state.made;
}

/** A picture drawn at a model's input, the picture in the part it fills and black in the rest, as the model's numbers. */
function inputOf(picture: ImageBitmap, way: Way): { planes: Float32Array; fit: Fit } {
    const fit = fitOf(way, picture.width, picture.height);
    const canvas = new OffscreenCanvas(fit.input.width, fit.input.height);
    const context = canvas.getContext("2d")!;
    context.imageSmoothingQuality = "high";
    context.drawImage(picture, 0, 0, fit.filled.width, fit.filled.height);
    const pixels = context.getImageData(0, 0, fit.input.width, fit.input.height).data;
    return { planes: planesOf(pixels, fit.input.width, fit.input.height, way), fit };
}

/** Answers one message, in the worker. */
export async function serve(ask: Ask, tools: { shelf(): Promise<Shelf>; say(answer: Answer): void; fetch?: typeof fetch }): Promise<void> {
    if (ask.type === "cancel") {
        for (const each of state.fetches) each.abort();
        return;
    }
    try {
        const shelf = await tools.shelf();
        const tier = partTierOf(ask.tier);
        if (ask.type === "have") return tools.say({ type: "have", id: ask.id, have: await keptAll(shelf, tier) });
        if (ask.type === "fetch") {
            const stop = new AbortController();
            state.fetches.add(stop);
            try {
                await fetchTier(tier, shelf, { signal: stop.signal, host: ask.host, fetch: tools.fetch, progress: (done) => tools.say({ type: "progress", id: ask.id, done }) });
            } finally {
                state.fetches.delete(stop);
            }
            return tools.say({ type: "fetched", id: ask.id });
        }
        const started = performance.now();
        const made = await madeFor(tier, shelf, ask.prefer, ask.card);
        const { ort } = made;
        if (ask.type === "matte") {
            const { planes, fit } = inputOf(ask.picture, tier.matte);
            ask.picture.close();
            const matte = made.sessions.matte!;
            const input = new ort.Tensor("float32", planes, [1, 3, fit.input.height, fit.input.width]);
            const out = await matte.run({ [matte.inputNames[0]!]: input });
            input.dispose();
            const alpha = Object.values(out)[0]!;
            const values = await alpha.getData();
            const [height, width] = alpha.dims.slice(-2) as [number, number];
            for (const each of Object.values(out)) each.dispose();
            return tools.say({ type: "found", id: ask.id, found: foundOf(values, width, height, cropOf(fit, width, height), fit.picture), ms: Math.round(performance.now() - started), place: made.place });
        }
        // a picture's encoding is made once and kept, so each press after the first is only the decoder
        if (!state.encoded || state.encoded.key !== ask.key || state.encoded.tier !== tier.id) {
            if (!ask.picture) return tools.say({ type: "failed", id: ask.id, message: "the picture is needed again", cancelled: false, again: true });
            for (const each of Object.values(state.encoded?.outputs ?? {})) each.dispose();
            const { planes, fit } = inputOf(ask.picture, tier.select);
            const encode = made.sessions.encode!;
            const input = new ort.Tensor("float32", planes, [1, 3, 1024, 1024]);
            state.encoded = { key: ask.key, tier: tier.id, fit, outputs: await encode.run({ pixel_values: input }) };
            input.dispose();
        }
        ask.picture?.close();
        const { fit, outputs } = state.encoded;
        const decode = made.sessions.decode!;
        const prompt = promptOf(ask.presses, fit);
        const feeds: Record<string, unknown> = { input_points: new ort.Tensor("float32", prompt.points, [1, 1, ask.presses.length, 2]), input_labels: new ort.Tensor("int64", prompt.labels, [1, 1, ask.presses.length]) };
        for (const name of decode.inputNames) if (outputs[name]) feeds[name] = outputs[name];
        if (decode.inputNames.includes("input_boxes")) feeds.input_boxes = new ort.Tensor("float32", new Float32Array(0), [1, 0, 4]);
        const out = await decode.run(feeds);
        const scores = await out.iou_scores!.getData();
        const masks = out.pred_masks!;
        const all = await masks.getData();
        const [height, width] = masks.dims.slice(-2) as [number, number];
        const best = bestOf(scores);
        const values = all.subarray(best * width * height, (best + 1) * width * height);
        const found = foundOf(values, width, height, cropOf(fit, width, height), fit.picture, true);
        for (const each of Object.values(out)) each.dispose();
        tools.say({ type: "found", id: ask.id, found, ms: Math.round(performance.now() - started), place: made.place });
    } catch (error) {
        const cancelled = error instanceof DOMException && error.name === "AbortError";
        tools.say({ type: "failed", id: ask.id, message: cancelled ? "cancelled" : error instanceof Error ? error.message : String(error), cancelled });
    }
}

const inWorker = typeof self !== "undefined" && typeof (self as { importScripts?: unknown }).importScripts === "function";
if (inWorker) {
    const shelf = privateShelf("imgquire-parts");
    self.onmessage = (event: MessageEvent<Ask>) => void serve(event.data, { shelf: () => shelf, say: (answer) => (self as unknown as Worker).postMessage(answer) });
}

/** The page's side: the worker made the first time it is wanted, and a promise for each answer. */
export function createFinder(make: () => Worker = () => new Worker(new URL("./engine.ts", import.meta.url), { type: "module" })) {
    let worker: Worker | undefined;
    let next = 0;
    const waiting = new Map<number, { done(answer: Answer): void; progress?(done: number): void }>();
    const workerNow = () => {
        if (worker) return worker;
        worker = make();
        worker.onmessage = (event: MessageEvent<Answer>) => {
            const mine = waiting.get(event.data.id);
            if (!mine) return;
            if (event.data.type === "progress") return mine.progress?.(event.data.done);
            waiting.delete(event.data.id);
            mine.done(event.data);
        };
        return worker;
    };
    const ask = (message: Ask & { id: number }, progress?: (done: number) => void, transfer: Transferable[] = []) =>
        new Promise<Answer>((done) => {
            waiting.set(message.id, { done, progress });
            workerNow().postMessage(message, transfer);
        });
    const failed = (answer: Answer) => {
        if (answer.type !== "failed") return answer;
        const error = new Error(answer.message) as Error & { again?: boolean };
        if (answer.cancelled) error.name = "AbortError";
        error.again = answer.again;
        throw error;
    };
    return {
        async have(tier: string): Promise<boolean> {
            const answer = failed(await ask({ type: "have", id: ++next, tier }));
            return answer.type === "have" && answer.have;
        },
        async fetch(tier: string, progress?: (bytes: number) => void): Promise<void> {
            failed(await ask({ type: "fetch", id: ++next, tier }, progress));
        },
        cancel: () => worker?.postMessage({ type: "cancel" } satisfies Ask),
        /** The mask the presses outline. The bitmap is needed for the first presses on a picture (and is handed over); after that `picture` may be left out. */
        async select(tier: string, key: string, picture: ImageBitmap | undefined, presses: Press[], prefer?: "webgpu" | "wasm") {
            const answer = failed(await ask({ type: "select", id: ++next, tier, key, picture, presses, prefer }, undefined, picture ? [picture] : []));
            return answer as Extract<Answer, { type: "found" }>;
        },
        /** The picture's subject as a mask. */
        async matte(tier: string, picture: ImageBitmap, prefer?: "webgpu" | "wasm") {
            const answer = failed(await ask({ type: "matte", id: ++next, tier, picture, prefer }, undefined, [picture]));
            return answer as Extract<Answer, { type: "found" }>;
        },
        destroy() {
            worker?.terminate();
            worker = undefined;
            for (const each of waiting.values()) each.done({ type: "failed", id: 0, message: "cancelled", cancelled: true });
            waiting.clear();
        },
    };
}

/** The finder, as the editor holds it. */
export type Finder = ReturnType<typeof createFinder>;
