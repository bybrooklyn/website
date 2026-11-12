// The page's side of the engine worker (engine-worker.ts): downloading a tier's files, loading
// them, recognizing sound, and giving the memory back. Making the worker is what first fetches any
// of ONNX Runtime, so a visitor who never switches dictation on downloads none of it.
//
// The whole of what the panel and the session need of an engine is `Provider`. The browser tests
// give the page a made-up one with the same shape, so no model is ever downloaded in a test.

import { nameOf } from "./download";
import type { Tier } from "./models";
import type { Live, LiveUpdate, Recognizer } from "./session";

/** What the page asks of the worker. */
export type Ask =
    | { type: "download"; tier: string }
    | { type: "cancel" }
    | { type: "load"; tier: string; words: string[] }
    | { type: "recognize"; id: number; samples: Float32Array }
    | { type: "words"; words: string[] }
    | { type: "stream-open" }
    | { type: "stream-push"; samples: Float32Array }
    | { type: "stream-finish"; id: number }
    | { type: "stream-cancel" }
    | { type: "release" };

/** A word with its time, as the worker sends it. */
export type Sent = { text: string; start: number; end: number };

/** What the worker answers. */
export type Answer =
    | { type: "progress"; bytes: number }
    | { type: "downloaded" }
    | { type: "loaded"; ms: number; backend: string; threads: number; live: boolean }
    | { type: "stream-update"; update: LiveUpdate }
    | { type: "stream-done"; id: number; words: Sent[] }
    | { type: "heard"; id: number; text: string; words: { text: string; start: number; end: number }[]; ms: number }
    | { type: "released" }
    | { type: "failed"; message: string; cancelled: boolean; id?: number };

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
    let listener: ((answer: Answer) => void) | undefined;
    const open = () => {
        if (!worker) {
            worker = new Worker(new URL("./engine-worker.ts", import.meta.url), { type: "module" });
            worker.onmessage = (event: MessageEvent<Answer>) => listener?.(event.data);
            worker.onerror = (event) => listener?.({ type: "failed", message: event.message || "the engine could not start", cancelled: false });
        }
        return worker;
    };
    const ask = (message: Ask, transfer: Transferable[] = []) => open().postMessage(message, transfer);

    return {
        async cached(tier) {
            const top = await directory(false);
            const dir = await top?.getDirectoryHandle(tier.id).catch(() => undefined);
            if (!dir) return false;
            for (const file of tier.files) if (!(await dir.getFileHandle(`${nameOf(file.path)}.whole`).then(() => true, () => false))) return false;
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
            return new Promise((resolve, reject) => {
                listener = (answer) => {
                    if (answer.type === "progress") progress(answer.bytes);
                    else if (answer.type === "downloaded") resolve();
                    else if (answer.type === "failed") reject(Object.assign(new Error(answer.message), { cancelled: answer.cancelled }));
                };
                ask({ type: "download", tier: tier.id });
            });
        },
        cancel() {
            worker?.postMessage({ type: "cancel" } satisfies Ask);
        },
        load(tier, words) {
            return new Promise((resolve, reject) => {
                const waiting = new Map<number, { done: (answer: Extract<Answer, { type: "heard" }>) => void; fail: (error: Error) => void }>();
                const finishing = new Map<number, { done: (words: Sent[]) => void; fail: (error: Error) => void }>();
                let updates: ((update: LiveUpdate) => void) | undefined;
                let sent = 0;
                const live = (): Live => ({
                    push: (samples) => ask({ type: "stream-push", samples }, [samples.buffer]),
                    onUpdate: (next) => void (updates = next),
                    finish: () =>
                        new Promise((done, fail) => {
                            const id = ++sent;
                            finishing.set(id, { done, fail });
                            ask({ type: "stream-finish", id });
                        }),
                    cancel: () => {
                        updates = undefined;
                        ask({ type: "stream-cancel" });
                    },
                });
                listener = (answer) => {
                    if (answer.type === "loaded") {
                        resolve({
                            ms: answer.ms,
                            recognizer: {
                                ...(answer.live
                                    ? {
                                          stream: () => {
                                              ask({ type: "stream-open" });
                                              return live();
                                          },
                                          boost: (list: string[]) => ask({ type: "words", words: list }),
                                      }
                                    : {}),
                                backend: answer.backend,
                                transcribe: (samples) =>
                                    new Promise((done, fail) => {
                                        const id = ++sent;
                                        waiting.set(id, { done: (heard) => done({ text: heard.text, words: heard.words, ms: heard.ms }), fail });
                                        ask({ type: "recognize", id, samples }, [samples.buffer]);
                                    }),
                                dispose() {
                                    // ending the worker is what gives its memory back
                                    worker?.terminate();
                                    worker = undefined;
                                    listener = undefined;
                                },
                            },
                        });
                    } else if (answer.type === "heard") {
                        waiting.get(answer.id)?.done(answer);
                        waiting.delete(answer.id);
                    } else if (answer.type === "stream-update") {
                        updates?.(answer.update);
                    } else if (answer.type === "stream-done") {
                        finishing.get(answer.id)?.done(answer.words);
                        finishing.delete(answer.id);
                    } else if (answer.type === "failed") {
                        const error = new Error(answer.message);
                        if (answer.id !== undefined) {
                            waiting.get(answer.id)?.fail(error);
                            finishing.get(answer.id)?.fail(error);
                            waiting.delete(answer.id);
                            finishing.delete(answer.id);
                        } else reject(error);
                    }
                };
                ask({ type: "load", tier: tier.id, words });
            });
        },
        async remove(tier) {
            worker?.terminate();
            worker = undefined;
            const top = await directory(false);
            await top?.removeEntry(tier.id, { recursive: true }).catch(() => {});
        },
    };
}
