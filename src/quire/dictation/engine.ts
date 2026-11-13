// The page's side of the engine worker (engine-worker.ts): downloading a tier's files, loading
// them, recognizing sound, and giving the memory back. Making the worker is what first fetches any
// of ONNX Runtime, so a visitor who never switches dictation on downloads none of it.
//
// The whole of what the panel and the session need of an engine is `Provider`. The browser tests
// give the page a made-up one with the same shape, so no model is ever downloaded in a test.

import { nameOf, whole } from "./download";
import type { Tier } from "./models";
import type { Live, LiveUpdate, Recognizer } from "./session";

/** What the page asks of the worker. Every ask that is answered carries a number, and its answers carry the same one. */
export type Ask =
    | { type: "download"; id: number; tier: string }
    | { type: "cancel" }
    | { type: "load"; id: number; tier: string; words: string[] }
    | { type: "recognize"; id: number; samples: Float32Array }
    | { type: "words"; words: string[] }
    | { type: "stream-open"; stream: number }
    | { type: "stream-push"; stream: number; samples: Float32Array }
    | { type: "stream-finish"; stream: number; id: number }
    | { type: "stream-cancel"; stream: number }
    | { type: "release" };

/** A word with its time, as the worker sends it. */
export type Sent = { text: string; start: number; end: number };

/** What the worker answers. A failure names the ask it answers, or the live phrase whose sound could not be taken. */
export type Answer =
    | { type: "progress"; id: number; bytes: number }
    | { type: "downloaded"; id: number }
    | { type: "loaded"; id: number; ms: number; backend: string; threads: number; live: boolean }
    | { type: "stream-update"; stream: number; update: LiveUpdate }
    | { type: "stream-done"; id: number; words: Sent[] }
    | { type: "heard"; id: number; text: string; words: { text: string; start: number; end: number }[]; ms: number }
    | { type: "released" }
    | { type: "failed"; message: string; cancelled: boolean; id?: number; stream?: number };

/** What the panel and the session use of an engine. */
export interface Provider {
    /** True if all of a tier's files are in this browser already. */
    cached(tier: Tier): Promise<boolean>;
    /** Bytes of this browser's storage the downloaded models take. */
    used(): Promise<number>;
    /** Fetches a tier's files, calling `progress` with the bytes so far. Rejects with `cancelled` set if `cancel` was called. */
    download(tier: Tier, progress: (bytes: number) => void): Promise<void>;
    cancel(): void;
    /** Loads a tier and gives the recognizer, with how long loading took. `words` are the visitor's own words to lean toward. */
    load(tier: Tier, words: string[]): Promise<{ recognizer: Recognizer; ms: number }>;
    /** Deletes a tier's files from this browser. */
    remove(tier: Tier): Promise<void>;
}

const FOLDER = "mdquire-dictation";

/** Whether this browser can keep model files (the private file storage) and run a worker. */
export const canStore = (): boolean => typeof Worker !== "undefined" && typeof navigator !== "undefined" && !!navigator.storage?.getDirectory;

async function directory(create: boolean): Promise<FileSystemDirectoryHandle | undefined> {
    try {
        const root = await navigator.storage.getDirectory();
        return await root.getDirectoryHandle(FOLDER, { create });
    } catch {
        return undefined;
    }
}

/** The real engine: a worker running ONNX Runtime Web. */
export function createProvider(): Provider {
    let worker: Worker | undefined;
    /** Every ask that waits for an answer, by its number, with what to do with the answer and with a failure. */
    let pending = new Map<number, { answer: (answer: Answer) => void; fail: (error: Error) => void }>();
    /** The live phrases' listeners, and the phrases whose worker side has failed. */
    const updates = new Map<number, (update: LiveUpdate) => void>();
    const broken = new Set<number>();
    let asked = 0;
    let streams = 0;

    /** The worker has died (out of memory, a crash) or been ended: every ask still waiting is told, and the next one makes a new worker. */
    const lose = (gone: Worker, why: string) => {
        if (worker !== gone) return;
        gone.terminate();
        worker = undefined;
        const waiting = pending;
        pending = new Map();
        updates.clear();
        for (const each of waiting.values()) each.fail(new Error(why));
    };
    const open = () => {
        if (!worker) {
            const made = new Worker(new URL("./engine-worker.ts", import.meta.url), { type: "module" });
            made.onmessage = (event: MessageEvent<Answer>) => {
                if (worker !== made) return;
                const answer = event.data;
                if (answer.type === "stream-update") return updates.get(answer.stream)?.(answer.update);
                if (answer.type === "failed" && answer.stream !== undefined) {
                    broken.add(answer.stream);
                    updates.delete(answer.stream);
                }
                if ("id" in answer && answer.id !== undefined) pending.get(answer.id)?.answer(answer);
            };
            made.onerror = (event) => lose(made, `The speech engine stopped: ${event.message || "it could not start"}`);
            made.onmessageerror = () => lose(made, "The speech engine stopped: a message could not be read");
            worker = made;
        }
        return worker;
    };
    /** Asks the worker something and waits for its last answer; `step` is given the answers that come before it (progress). */
    const request = <T>(make: (id: number) => Ask, settle: (answer: Answer) => T | undefined, transfer: Transferable[] = [], step?: (answer: Answer) => void): Promise<T> => {
        const target = open();
        const id = ++asked;
        return new Promise<T>((resolve, reject) => {
            pending.set(id, {
                answer: (answer) => {
                    if (answer.type === "failed") {
                        pending.delete(id);
                        reject(Object.assign(new Error(answer.message), { cancelled: answer.cancelled }));
                        return;
                    }
                    const done = settle(answer);
                    if (done === undefined) return void step?.(answer);
                    pending.delete(id);
                    resolve(done);
                },
                fail: reject,
            });
            target.postMessage(make(id), transfer);
        });
    };

    /** A recognizer on the worker as it is now: once that worker has gone, it answers nothing but a failure. */
    const recognizerOn = (mine: Worker, answer: Extract<Answer, { type: "loaded" }>): Recognizer => {
        const gone = () => Promise.reject(new Error("The speech engine stopped"));
        const live = (): Live => {
            const stream = ++streams;
            if (worker === mine) mine.postMessage({ type: "stream-open", stream } satisfies Ask);
            return {
                push: (samples) => {
                    if (worker === mine && !broken.has(stream)) mine.postMessage({ type: "stream-push", stream, samples } satisfies Ask, [samples.buffer]);
                },
                onUpdate: (next) => void updates.set(stream, next),
                finish: () => {
                    const words = worker !== mine || broken.has(stream) ? gone() : request<Sent[]>((id) => ({ type: "stream-finish", stream, id }), (each) => (each.type === "stream-done" ? each.words : undefined));
                    return words.finally(() => {
                        updates.delete(stream);
                        broken.delete(stream);
                    });
                },
                cancel: () => {
                    updates.delete(stream);
                    broken.delete(stream);
                    if (worker === mine) mine.postMessage({ type: "stream-cancel", stream } satisfies Ask);
                },
            };
        };
        return {
            ...(answer.live ? { stream: live, boost: (list: string[]) => void (worker === mine && mine.postMessage({ type: "words", words: list } satisfies Ask)) } : {}),
            backend: answer.backend,
            transcribe: (samples) =>
                worker !== mine
                    ? gone()
                    : request(
                          (id) => ({ type: "recognize", id, samples }),
                          (each) => (each.type === "heard" ? { text: each.text, words: each.words, ms: each.ms } : undefined),
                          [samples.buffer],
                      ),
            dispose() {
                // ending the worker is what gives its memory back
                lose(mine, "The speech engine was let go");
            },
        };
    };

    return {
        async cached(tier) {
            const top = await directory(false);
            const dir = await top?.getDirectoryHandle(tier.id).catch(() => undefined);
            if (!dir) return false;
            // a file is ready only if its mark is for the table as it is now and its size is right (download.ts)
            const fileOf = (name: string) => dir.getFileHandle(name).then((handle) => handle.getFile());
            for (const file of tier.files) {
                const name = nameOf(file.path);
                const mark = await fileOf(`${name}.whole`).then((each) => each.text(), () => undefined);
                const size = await fileOf(name).then((each) => each.size, () => -1);
                if (!whole(tier, file, mark, size)) return false;
            }
            return true;
        },
        async used() {
            const top = await directory(false);
            if (!top) return 0;
            let total = 0;
            for await (const tier of top.values()) {
                if (tier.kind !== "directory") continue;
                for await (const file of (tier as FileSystemDirectoryHandle).values()) if (file.kind === "file" && !file.name.endsWith(".whole")) total += (await (file as FileSystemFileHandle).getFile()).size;
            }
            return total;
        },
        download(tier, progress) {
            return request<true>(
                (id) => ({ type: "download", id, tier: tier.id }),
                (answer) => (answer.type === "downloaded" ? true : undefined),
                [],
                (answer) => answer.type === "progress" && progress(answer.bytes),
            ).then(() => undefined);
        },
        cancel() {
            worker?.postMessage({ type: "cancel" } satisfies Ask);
        },
        async load(tier, words) {
            const mine = open();
            const answer = await request<Extract<Answer, { type: "loaded" }>>((id) => ({ type: "load", id, tier: tier.id, words }), (each) => (each.type === "loaded" ? each : undefined));
            if (worker !== mine) throw new Error("The speech engine stopped");
            return { ms: answer.ms, recognizer: recognizerOn(mine, answer) };
        },
        async remove(tier) {
            if (worker) lose(worker, "The model was removed");
            const top = await directory(false);
            await top?.removeEntry(tier.id, { recursive: true }).catch(() => {});
        },
    };
}
