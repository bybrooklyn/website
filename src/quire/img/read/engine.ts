// The text reader's engine, in a worker of its own so that reading never holds up the picture: it
// says whether a size's models are kept, fetches them (store.ts), makes them into sessions on ONNX
// Runtime (runtime.ts) and reads a picture (read.ts). This one file is both sides, as codec-run.ts
// is: in the worker it answers messages (`serve`); on the page `createReader` makes the worker the
// first time it is wanted and talks to it. The picture goes to the worker as a bitmap and never
// further: the worker's only requests are for the model files and ONNX Runtime's own.
//
//   const reader = createReader();
//   if (!(await reader.have("tiny"))) await reader.fetch("tiny", (bytes) => ...);
//   const job = reader.read(bitmap, "tiny", (done) => ...);   job.stop() to let it go
//   const { lines, place } = await job.done;

import { readDictionary } from "./dictionary";
import { fileFor, tierOf, type Tier } from "./models";
import { readText } from "./read";
import { makeModels, type Made, type Place } from "./runtime";
import { bytesOf, fetchTier, keptAll, keptBytes, privateShelf, type Shelf } from "./store";
import type { Pixels } from "./pixels";
import type { Line } from "./words";

/** What the page asks of the worker. */
export type Ask =
    | { type: "have"; id: number; tier: string }
    | { type: "fetch"; id: number; tier: string; host?: string }
    | { type: "cancel" }
    | { type: "read"; id: number; tier: string; picture: ImageBitmap | Pixels; prefer?: Place }
    | { type: "stop"; id: number };

/** What the worker answers. */
export type Answer =
    | { type: "have"; id: number; have: boolean; bytes: number }
    | { type: "progress"; id: number; done: number }
    | { type: "fetched"; id: number }
    | { type: "read"; id: number; lines: Line[]; ms: number; place: Place; threads: number }
    | { type: "failed"; id: number; message: string; cancelled: boolean };

/** What the worker's side works with: where files are kept, and where answers go. */
export interface Tools {
    shelf(): Promise<Shelf>;
    say(answer: Answer): void;
    fetch?: typeof fetch;
}

/** The worker's state between messages: the fetch running, the readings that may be stopped, and the one size's models kept made. */
const running = { fetches: new Set<AbortController>(), stopped: new Set<number>(), made: undefined as { tier: string; prefer?: Place; made: Promise<Made> } | undefined, dictionaries: new Map<string, string[]>() };

/** Pixels of a bitmap, drawn once on a canvas of the worker's. */
function pixelsOf(picture: ImageBitmap | Pixels): Pixels {
    if ("data" in picture) return picture;
    const canvas = new OffscreenCanvas(picture.width, picture.height);
    const context = canvas.getContext("2d")!;
    context.drawImage(picture, 0, 0);
    picture.close();
    const image = context.getImageData(0, 0, canvas.width, canvas.height);
    return { width: image.width, height: image.height, data: image.data };
}

/** The size's models, made once and kept until another size is read. */
async function modelsFor(tier: Tier, shelf: Shelf, prefer?: Place): Promise<Made> {
    if (running.made && running.made.tier === tier.id && running.made.prefer === prefer) return running.made.made;
    const before = running.made;
    running.made = undefined;
    if (before) await before.made.then((made) => made.release()).catch(() => undefined);
    const bytes = async (role: "detect" | "recognize" | "line" | "page") => {
        const each = fileFor(tier, role);
        return each && bytesOf(shelf, each);
    };
    const made = (async () => makeModels({ detect: (await bytes("detect"))!, recognize: (await bytes("recognize"))!, line: await bytes("line"), page: await bytes("page") }, prefer))();
    running.made = { tier: tier.id, prefer, made };
    made.catch(() => running.made?.made === made && (running.made = undefined));
    return made;
}

/** Answers one message, in the worker. */
export async function serve(ask: Ask, tools: Tools): Promise<void> {
    if (ask.type === "cancel") {
        for (const each of running.fetches) each.abort();
        return;
    }
    if (ask.type === "stop") {
        running.stopped.add(ask.id);
        return;
    }
    try {
        const shelf = await tools.shelf();
        const tier = tierOf(ask.tier);
        if (ask.type === "have") return tools.say({ type: "have", id: ask.id, have: await keptAll(shelf, tier), bytes: await keptBytes(shelf, tier) });
        if (ask.type === "fetch") {
            const stop = new AbortController();
            running.fetches.add(stop);
            try {
                await fetchTier(tier, shelf, { signal: stop.signal, host: ask.host, fetch: tools.fetch, progress: (done) => tools.say({ type: "progress", id: ask.id, done }) });
            } finally {
                running.fetches.delete(stop);
            }
            return tools.say({ type: "fetched", id: ask.id });
        }
        const started = performance.now();
        const pixels = pixelsOf(ask.picture);
        const made = await modelsFor(tier, shelf, ask.prefer);
        const each = fileFor(tier, "dictionary")!;
        let dictionary = running.dictionaries.get(each.sha256);
        if (!dictionary) running.dictionaries.set(each.sha256, (dictionary = readDictionary(new TextDecoder().decode(await bytesOf(shelf, each)))));
        const lines = await readText(pixels, made.models, { dictionary, sure: tier.sure, progress: (done) => tools.say({ type: "progress", id: ask.id, done }), stopped: () => running.stopped.has(ask.id) });
        if (running.stopped.delete(ask.id)) throw new DOMException("stopped", "AbortError");
        tools.say({ type: "read", id: ask.id, lines, ms: Math.round(performance.now() - started), place: made.place, threads: made.threads });
    } catch (error) {
        const cancelled = error instanceof DOMException && error.name === "AbortError";
        if (ask.type === "read") running.stopped.delete(ask.id);
        tools.say({ type: "failed", id: ask.id, message: cancelled ? "cancelled" : error instanceof Error ? error.message : String(error), cancelled });
    }
}

const inWorker = typeof self !== "undefined" && typeof (self as { importScripts?: unknown }).importScripts === "function";
if (inWorker) {
    const shelf = privateShelf();
    self.onmessage = (event: MessageEvent<Ask>) => void serve(event.data, { shelf: () => shelf, say: (answer) => (self as unknown as Worker).postMessage(answer) });
}

/** What a reading gives back. */
export interface Reading {
    lines: Line[];
    ms: number;
    place: Place;
    threads: number;
}

/** The page's side: the worker made the first time it is wanted, and a promise for each answer. */
export function createReader(make: () => Worker = () => new Worker(new URL("./engine.ts", import.meta.url), { type: "module" })) {
    let worker: Worker | undefined;
    let next = 0;
    const waiting = new Map<number, { done(answer: Answer): void; progress?(done: number): void }>();
    const workerNow = () => {
        if (worker) return worker;
        worker = make();
        worker.onmessage = (event: MessageEvent<Answer>) => {
            const answer = event.data;
            const mine = waiting.get(answer.id);
            if (!mine) return;
            if (answer.type === "progress") return mine.progress?.(answer.done);
            waiting.delete(answer.id);
            mine.done(answer);
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
        const error = new Error(answer.message);
        if (answer.cancelled) error.name = "AbortError";
        throw error;
    };
    return {
        /** Whether a size's files are all kept in this browser, and how many of its bytes are. */
        async have(tier: string): Promise<{ have: boolean; bytes: number }> {
            const answer = failed(await ask({ type: "have", id: ++next, tier }));
            return answer.type === "have" ? { have: answer.have, bytes: answer.bytes } : { have: false, bytes: 0 };
        },
        /** Fetches a size's files that are not kept, telling `progress` the bytes in hand. */
        async fetch(tier: string, progress?: (bytes: number) => void): Promise<void> {
            failed(await ask({ type: "fetch", id: ++next, tier }, progress));
        },
        /** Stops a fetch under way. */
        cancel: () => worker?.postMessage({ type: "cancel" } satisfies Ask),
        /** Reads a picture with a size's models; the bitmap is handed to the worker and is gone from here. */
        read(picture: ImageBitmap, tier: string, progress?: (done: number) => void, prefer?: Place) {
            const id = ++next;
            const done = ask({ type: "read", id, tier, picture, prefer }, progress, [picture]).then((answer) => {
                failed(answer);
                return answer as Extract<Answer, { type: "read" }>;
            });
            return { done: done.then(({ lines, ms, place, threads }): Reading => ({ lines, ms, place, threads })), stop: () => worker?.postMessage({ type: "stop", id } satisfies Ask) };
        },
        /** Ends the worker, and with it the models' memory. */
        destroy() {
            worker?.terminate();
            worker = undefined;
            for (const each of waiting.values()) each.done({ type: "failed", id: 0, message: "cancelled", cancelled: true });
            waiting.clear();
        },
    };
}

/** A reader, as the editor holds it. */
export type Reader = ReturnType<typeof createReader>;
