// The restoring models' engine, in a worker of its own as the text reader's and the part models' are: it says
// whether a model is kept, fetches it (read/store.ts, into a folder of its own), makes it a session on the
// site's ONNX Runtime through the core (core/onnx.ts) and runs it over a picture tile by tile (tiles.ts),
// handing each finished tile back to the page as it is done, so that neither side ever holds the result twice.
// The picture comes as a bitmap and goes nowhere: the worker's only requests are for the model's file and ONNX
// Runtime's own. On the graphics card its errors are watched for the length of a run, as the cut-out's are: a
// run the card could not finish is no answer, named by its cause, and the page runs it once more in a fresh
// worker. Both sides are here: `serve` in the worker, `createRestorer` on the page.
//
//   const restorer = createRestorer();
//   if (!(await restorer.have("repair-small"))) await restorer.fetch("repair-small", (bytes) => ...);
//   const made = await restorer.run("repair-small", bitmap, { progress, signal, keep: (out, pixels) => ... });

import { graphicsCard, ortFor, settle, threadsHere } from "../../core/onnx";
import { bytesOf, fetchTier, keptAll, privateShelf, type Shelf } from "../read/store";
import type { Rect } from "../steps";
import { planTiles, runTiles, Stopped, type Pixels } from "../tiles";
import { untieOutput } from "./graph";
import { fromHalf, toHalf } from "./half";
import { restoreModelOf, type RestoreModel } from "./models";

/** Where a model runs: on the graphics card through WebGPU, or on the processor through WebAssembly. */
export type Place = "webgpu" | "wasm";

/** What the page asks. */
export type Ask =
    | { type: "have"; id: number; model: string }
    | { type: "fetch"; id: number; model: string; host?: string }
    | { type: "cancel" }
    | { type: "run"; id: number; model: string; picture: ImageBitmap; prefer?: Place; quality?: number; tile?: number }
    | { type: "stop"; id: number };

/** What the worker answers. */
export type Answer =
    | { type: "have"; id: number; have: boolean }
    | { type: "progress"; id: number; done: number }
    | { type: "fetched"; id: number }
    | { type: "share"; id: number; done: number }
    | { type: "tile"; id: number; out: Rect; width: number; height: number; data: Uint8ClampedArray }
    | { type: "finished"; id: number; width: number; height: number; ms: number; place: Place }
    | { type: "failed"; id: number; message: string; cancelled: boolean; again?: boolean };

/** The parts of ONNX Runtime used here. */
interface Tensor {
    readonly dims: readonly number[];
    getData(): Promise<ArrayLike<number>>;
    dispose(): void;
}
interface Session {
    readonly inputNames: readonly string[];
    readonly outputNames: readonly string[];
    run(feeds: Record<string, unknown>): Promise<Record<string, Tensor>>;
    release(): Promise<void>;
}
interface Ort {
    env: { wasm: { wasmPaths: unknown; numThreads: number; simd: boolean; proxy: boolean }; webgpu?: { device?: GPUDevice | Promise<GPUDevice> } };
    InferenceSession: { create(model: Uint8Array, options?: object): Promise<Session> };
    Tensor: new (type: string, data: Float32Array | Uint16Array, dims: number[]) => Tensor;
}

/** The one model made into a session, kept until another is asked for. */
interface Made {
    model: RestoreModel;
    place: Place;
    ort: Ort;
    session: Session;
}

const state = { fetches: new Set<AbortController>(), stopped: new Set<number>(), made: undefined as Promise<Made> | undefined, madeFor: "" };

/** Where a model runs here: on the card when there is one and the model runs right there, else on WebAssembly when it is offered there. */
export function placeFor(model: RestoreModel, card: boolean, prefer?: Place): Place | undefined {
    if (prefer === "webgpu") return card && model.places.includes("webgpu") ? "webgpu" : undefined;
    if (prefer === "wasm") return model.places.includes("wasm") ? "wasm" : undefined;
    if (card && model.places.includes("webgpu")) return "webgpu";
    return model.places.includes("wasm") ? "wasm" : undefined;
}

/** The model's session, made once on its place. */
async function madeFor(model: RestoreModel, shelf: Shelf, prefer?: Place): Promise<Made> {
    const key = `${model.id} ${prefer ?? ""}`;
    if (state.made && state.madeFor === key) return state.made;
    const before = state.made;
    if (before) await before.then((made) => made.session.release()).catch(() => undefined);
    state.madeFor = key;
    state.made = (async () => {
        // a model not kept whole is said before the runtime is asked for, so a run that cannot be made fetches nothing
        if (!(await keptAll(shelf, { files: [model] }))) throw new Error(`the ${model.name} model is not kept whole; choose it again to fetch it`);
        const place = placeFor(model, await graphicsCard(), prefer);
        if (!place) throw new Error(`the ${model.name} model needs a graphics card, and this browser gives none`);
        const ort = await ortFor<Ort>(place === "webgpu" ? "jsep" : "wasm");
        settle(ort, threadsHere());
        const bytes = await bytesOf(shelf, model);
        if (model.untie) untieOutput(bytes);
        const session = await ort.InferenceSession.create(bytes, { executionProviders: [place], graphOptimizationLevel: model.level });
        return { model, place, ort, session };
    })();
    state.made.catch(() => (state.made = undefined));
    return state.made;
}

/** What the graphics card said went wrong outside a run: the device lost, and its last error no one caught. */
const card = { lost: "", watched: new WeakSet<GPUDevice>() };
function watch(device: GPUDevice) {
    if (card.watched.has(device)) return;
    card.watched.add(device);
    void device.lost.then((info) => (card.lost = info.message || info.reason || "lost"));
}

/** A tile's pixels as the model's input: red, green and blue planes from 0 to 1, the tile reflected past its edges to the size the model takes (its fixed size, or a whole number of its step). */
export function planesOf(pixels: Pixels, model: Pick<RestoreModel, "fixed" | "multiple" | "input">): { planes: Float32Array | Uint16Array; width: number; height: number } {
    const step = model.multiple ?? 1;
    const width = model.fixed ?? Math.ceil(pixels.width / step) * step;
    const height = model.fixed ?? Math.ceil(pixels.height / step) * step;
    const count = width * height;
    const half = model.input === "float16";
    const planes = half ? new Uint16Array(3 * count) : new Float32Array(3 * count);
    // reflected as a picture's own edge is (a b c | b a), so a tile at the picture's edge reads as the whole picture would
    const reflect = (at: number, size: number) => {
        if (size === 1) return 0;
        const period = 2 * size - 2;
        const folded = at % period;
        return folded < size ? folded : period - folded;
    };
    for (let y = 0; y < height; y++) {
        const from = reflect(y, pixels.height) * pixels.width;
        for (let x = 0; x < width; x++) {
            const k = (from + reflect(x, pixels.width)) * 4;
            for (let channel = 0; channel < 3; channel++) {
                const value = pixels.data[k + channel]! / 255;
                planes[channel * count + y * width + x] = half ? toHalf(value) : value;
            }
        }
    }
    return { planes, width, height };
}

/** The model's planes back to pixels, the part that answers the tile cut out of a larger padded answer; the tile's own alpha kept, enlarged by nearest pixels. A 16-bit answer comes as its bits (a `Uint16Array`), or as numbers where the browser has `Float16Array`. NaN or infinity is a failure. */
export function pixelsOf(values: ArrayLike<number>, across: number, down: number, tile: Pixels, scale: number): Pixels {
    const half = values instanceof Uint16Array;
    const width = tile.width * scale;
    const height = tile.height * scale;
    const data = new Uint8ClampedArray(width * height * 4);
    const count = across * down;
    for (let y = 0; y < height; y++)
        for (let x = 0; x < width; x++) {
            const k = (y * width + x) * 4;
            for (let channel = 0; channel < 3; channel++) {
                const raw = values[channel * count + y * across + x]!;
                const value = half ? fromHalf(raw) : raw;
                if (!Number.isFinite(value)) throw new Error("the model gave numbers that are no numbers");
                data[k + channel] = Math.round(value * 255);
            }
            data[k + 3] = tile.data[(Math.floor(y / scale) * tile.width + Math.floor(x / scale)) * 4 + 3]!;
        }
    return { width, height, data };
}

/** Answers one message, in the worker. */
export async function serve(ask: Ask, tools: { shelf(): Promise<Shelf>; say(answer: Answer, transfer?: Transferable[]): void; fetch?: typeof fetch }): Promise<void> {
    if (ask.type === "cancel") {
        for (const each of state.fetches) each.abort();
        return;
    }
    if (ask.type === "stop") {
        state.stopped.add(ask.id);
        return;
    }
    try {
        const shelf = await tools.shelf();
        const model = restoreModelOf(ask.model);
        if (!model) throw new Error(`there is no model called ${ask.model}`);
        if (ask.type === "have") return tools.say({ type: "have", id: ask.id, have: await keptAll(shelf, { files: [model] }) });
        if (ask.type === "fetch") {
            const stop = new AbortController();
            state.fetches.add(stop);
            try {
                await fetchTier({ files: [model] }, shelf, { signal: stop.signal, host: ask.host, fetch: tools.fetch, progress: (done) => tools.say({ type: "progress", id: ask.id, done }) });
            } finally {
                state.fetches.delete(stop);
            }
            return tools.say({ type: "fetched", id: ask.id });
        }
        const started = performance.now();
        const picture = ask.picture;
        try {
            const made = await madeFor(model, shelf, ask.prefer);
            const { ort, session } = made;
            const device = made.place === "webgpu" ? await Promise.resolve(ort.env.webgpu?.device).catch(() => undefined) : undefined;
            if (device) watch(device);
            // a trial may say the tile, to hold the joins to the whole picture's answer
            const plan = planTiles({ width: picture.width, height: picture.height }, { tile: ask.tile ?? model.tile, margin: model.margin, scale: model.scale });
            if (!plan) throw new Error("the result would be larger than a picture may be");
            const reader = new OffscreenCanvas(1, 1).getContext("2d", { willReadFrequently: true })!;
            const stop = new AbortController();
            let tick: ReturnType<typeof setInterval> | undefined = setInterval(() => state.stopped.has(ask.id) && stop.abort(), 50);
            try {
                await runTiles(
                    plan,
                    (rect) => {
                        reader.canvas.width = rect.width;
                        reader.canvas.height = rect.height;
                        reader.clearRect(0, 0, rect.width, rect.height);
                        reader.drawImage(picture, rect.x, rect.y, rect.width, rect.height, 0, 0, rect.width, rect.height);
                        const image = reader.getImageData(0, 0, rect.width, rect.height);
                        return { width: image.width, height: image.height, data: image.data };
                    },
                    async (pixels) => {
                        if (card.lost) throw Object.assign(new Error(`the graphics card was lost: ${card.lost}`), { again: true });
                        const input = planesOf(pixels, model);
                        const feeds: Record<string, unknown> = { [session.inputNames[0]!]: new ort.Tensor(model.input, input.planes, [1, 3, input.height, input.width]) };
                        // FBCNN is told how hard the file was compressed: one less the quality as a share
                        if (model.quality && session.inputNames.includes("qf_input")) feeds.qf_input = new ort.Tensor("float32", new Float32Array([1 - Math.max(1, Math.min(100, ask.quality ?? 50)) / 100]), [1, 1]);
                        for (const kind of ["out-of-memory", "validation", "internal"] as const) device?.pushErrorScope(kind);
                        const out = await session.run(feeds);
                        const answer = out[session.outputNames[0]!]!;
                        const values = await answer.getData();
                        const errors = device ? (await Promise.all([device.popErrorScope(), device.popErrorScope(), device.popErrorScope()])).filter(Boolean) : [];
                        const [down, across] = answer.dims.slice(-2) as [number, number];
                        for (const each of Object.values(out)) each.dispose();
                        if (card.lost) errors.push({ message: `it was lost: ${card.lost}` } as GPUError);
                        if (errors.length) {
                            state.made = undefined;
                            throw Object.assign(new Error(`the graphics card did not finish the model: ${errors[0]!.message.slice(0, 200)}`), { again: true });
                        }
                        if (across !== input.width * model.scale || down !== input.height * model.scale) throw new Error(`the model gave ${across} by ${down} for ${input.width} by ${input.height}`);
                        return pixelsOf(values, across, down, pixels, model.scale);
                    },
                    (out, part) => tools.say({ type: "tile", id: ask.id, out, width: part.width, height: part.height, data: part.data }, [part.data.buffer]),
                    { signal: stop.signal, progress: (done) => tools.say({ type: "share", id: ask.id, done }) },
                );
            } finally {
                clearInterval(tick);
                tick = undefined;
            }
            tools.say({ type: "finished", id: ask.id, width: plan.width, height: plan.height, ms: Math.round(performance.now() - started), place: made.place });
        } finally {
            picture.close();
            state.stopped.delete(ask.id);
        }
    } catch (error) {
        const cancelled = (error instanceof DOMException && error.name === "AbortError") || error instanceof Stopped;
        tools.say({ type: "failed", id: ask.id, message: cancelled ? "cancelled" : error instanceof Error ? error.message : String(error), cancelled, ...((error as { again?: boolean }).again ? { again: true } : {}) });
    }
}

const inWorker = typeof self !== "undefined" && typeof (self as { importScripts?: unknown }).importScripts === "function";
if (inWorker) {
    const shelf = privateShelf("imgquire-restore");
    // a stop must be heard while a run awaits its tiles, so messages are not queued behind one another
    self.onmessage = (event: MessageEvent<Ask>) => void serve(event.data, { shelf: () => shelf, say: (answer, transfer) => (self as unknown as Worker).postMessage(answer, transfer ?? []) });
}

/** How a run is watched and its tiles kept, on the page. */
export interface RunHow {
    progress?(share: number): void;
    signal?: AbortSignal;
    quality?: number;
    prefer?: Place;
    /** Each finished tile, where it goes in the result. */
    keep(out: Rect, pixels: Pixels): void;
}

/** The page's side: the worker made the first time it is wanted, a promise for each answer, and a run made once more in a fresh worker when the card could not finish it. */
export function createRestorer(make: () => Worker = () => new Worker(new URL("./engine.ts", import.meta.url), { type: "module" })) {
    let worker: Worker | undefined;
    let next = 0;
    const waiting = new Map<number, { done(answer: Answer): void; progress?(done: number): void; tile?(answer: Extract<Answer, { type: "tile" }>): void }>();
    const workerNow = () => {
        if (worker) return worker;
        worker = make();
        worker.onmessage = (event: MessageEvent<Answer>) => {
            const mine = waiting.get(event.data.id);
            if (!mine) return;
            if (event.data.type === "progress" || event.data.type === "share") return mine.progress?.(event.data.done);
            if (event.data.type === "tile") return mine.tile?.(event.data);
            waiting.delete(event.data.id);
            mine.done(event.data);
        };
        worker.onerror = () => fresh("the worker stopped");
        return worker;
    };
    /** Lets the worker go and fails what waited on it, so the next ask makes a fresh one. */
    const fresh = (why: string) => {
        worker?.terminate();
        worker = undefined;
        for (const each of waiting.values()) each.done({ type: "failed", id: 0, message: why, cancelled: why === "cancelled" });
        waiting.clear();
    };
    const failed = (answer: Answer) => {
        if (answer.type !== "failed") return answer;
        const error = new Error(answer.message) as Error & { again?: boolean };
        if (answer.cancelled) error.name = "AbortError";
        error.again = answer.again;
        throw error;
    };
    const once = (model: string, bitmap: ImageBitmap, how: RunHow) =>
        new Promise<Answer>((done) => {
            const id = ++next;
            const stop = () => worker?.postMessage({ type: "stop", id } satisfies Ask);
            how.signal?.addEventListener("abort", stop, { once: true });
            waiting.set(id, {
                done: (answer) => (how.signal?.removeEventListener("abort", stop), done(answer)),
                progress: how.progress,
                tile: (answer) => how.keep(answer.out, { width: answer.width, height: answer.height, data: answer.data }),
            });
            workerNow().postMessage({ type: "run", id, model, picture: bitmap, prefer: how.prefer, quality: how.quality } satisfies Ask, [bitmap]);
        });
    return {
        async have(model: string): Promise<boolean> {
            const id = ++next;
            const answer = failed(await new Promise<Answer>((done) => (waiting.set(id, { done }), workerNow().postMessage({ type: "have", id, model } satisfies Ask))));
            return answer.type === "have" && answer.have;
        },
        async fetch(model: string, progress?: (bytes: number) => void): Promise<void> {
            const id = ++next;
            failed(await new Promise<Answer>((done) => (waiting.set(id, { done, progress }), workerNow().postMessage({ type: "fetch", id, model } satisfies Ask))));
        },
        cancel: () => worker?.postMessage({ type: "cancel" } satisfies Ask),
        /**
         * Runs a model over a picture, each finished tile handed to `how.keep`. `picture` makes the bitmap, and is asked again for a
         * second run: a run the graphics card could not finish is made once more in a fresh worker before it fails.
         */
        async run(model: string, picture: () => Promise<ImageBitmap>, how: RunHow): Promise<Extract<Answer, { type: "finished" }>> {
            let answer = await once(model, await picture(), how);
            if (answer.type === "failed" && answer.again && !how.signal?.aborted) {
                fresh("the graphics card was made fresh");
                answer = await once(model, await picture(), how);
                if (answer.type === "failed" && answer.again) answer = { ...answer, message: `the graphics card was too busy to finish (${answer.message})` };
            }
            return failed(answer) as Extract<Answer, { type: "finished" }>;
        },
        destroy: () => fresh("cancelled"),
    };
}

/** The restorer, as the editor holds it. */
export type Restorer = ReturnType<typeof createRestorer>;
