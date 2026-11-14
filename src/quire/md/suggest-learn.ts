// Learning her writing for suggestions (suggest.ts), in the browser and in idle time. On opening, the
// counts kept from last time are read back from IndexedDB, so nothing is learned twice; then each
// place her documents are kept (this browser, a folder or file she has already let mdQuire open, and
// under `bun run edit` the site's own posts) is listed, and a document not learned yet is opened and
// learned, a few milliseconds at a time, as checking keeps to its slices. A document saved in the
// editor has its old words taken back and its new ones counted, exactly, since what it said when it
// was learned is known. A document changed somewhere else cannot be taken back, so it is left as it
// was learned and counted as out of date; once a tenth of them are, everything is learned again from
// the start. Nothing is sent anywhere and nothing is downloaded.
//
//   const learner = createLearner({ stores: () => [browser, folder], keeper: indexedKeeper() });
//   await learner.start();
//   learner.predict("I am writing a post about my web");
//   learner.opened(key, text); learner.saved(key, text); learner.forget(); learner.stop();

import type { Store } from "../core/store";
import { createModel, paragraphs, type Model, type ModelData } from "./suggest";

/** A document as learned: a hash of its text, when its store last said it changed, and whether it has changed somewhere else since, past taking back. */
export interface Learned {
    hash: string;
    modified: number;
    stale?: boolean;
}

/** What is kept between visits: the counts, the documents they came from, when she last asked it to forget, and how many documents are out of date. */
export interface Kept {
    model: ModelData;
    docs: [string, Learned][];
    since: number;
    stale: number;
}

/** Where the learning is kept between visits. */
export interface Keeper {
    load(): Promise<unknown>;
    save(kept: Kept): Promise<void>;
    clear(): Promise<void>;
}

/** Runs some work in idle time, telling it how many milliseconds it has left. */
export type Idle = (work: (left: () => number) => void) => void;

/** The longest document learned, in characters; a longer one is passed over. */
const LONGEST = 2_000_000;
/** How long after a change the counts are kept, so that a run of saves is kept once. */
const KEEP_AFTER = 3000;

/** A key for a document in a store: the store's name and the document's id, kept apart. */
export const documentKey = (store: Store, id: string) => `${store.label}\u0000${id}`;

/** A quick hash of a document's text, with its length, to tell whether it changed since it was learned. */
export function hashOf(text: string): string {
    let hash = 0x811c9dc5;
    for (let at = 0; at < text.length; at++) hash = Math.imul(hash ^ text.charCodeAt(at), 0x01000193);
    return `${(hash >>> 0).toString(16)}:${text.length}`;
}

/** The learning kept in memory, for tests and for a browser that keeps nothing. */
export function memoryKeeper(): Keeper & { kept?: Kept } {
    const keeper: Keeper & { kept?: Kept } = {
        async load() {
            return keeper.kept && structuredClone(keeper.kept);
        },
        async save(kept) {
            keeper.kept = structuredClone(kept);
        },
        async clear() {
            keeper.kept = undefined;
        },
    };
    return keeper;
}

/** The learning kept in this browser's IndexedDB; a browser that refuses keeps it for the visit only. */
export function indexedKeeper(name = "quire-suggest"): Keeper {
    let base: Promise<IDBDatabase | undefined> | undefined;
    const open = () =>
        (base ??= new Promise((done) => {
            try {
                const asked = indexedDB.open(name, 1);
                asked.onupgradeneeded = () => asked.result.createObjectStore("kept");
                asked.onsuccess = () => done(asked.result);
                asked.onerror = () => done(undefined);
                asked.onblocked = () => done(undefined);
            } catch {
                done(undefined);
            }
        }));
    const run = async <T>(mode: IDBTransactionMode, act: (store: IDBObjectStore) => IDBRequest<T>): Promise<T | undefined> => {
        const db = await open();
        if (!db) return undefined;
        return new Promise((done) => {
            try {
                const request = act(db.transaction("kept", mode).objectStore("kept"));
                request.onsuccess = () => done(request.result);
                request.onerror = () => done(undefined);
            } catch {
                done(undefined);
            }
        });
    };
    return {
        load: () => run("readonly", (store) => store.get("learned")),
        save: async (kept) => void (await run("readwrite", (store) => store.put(kept, "learned"))),
        clear: async () => void (await run("readwrite", (store) => store.delete("learned"))),
    };
}

/** The browser's idle time, a slice never longer than `budget` milliseconds however long the browser says it is idle, so that a key pressed meanwhile waits no longer than that. */
export function browserIdle(budget = 8): Idle {
    return (work) => {
        const slice = (more: () => number) => {
            const end = performance.now() + budget;
            work(() => Math.min(more(), end - performance.now()));
        };
        if (typeof requestIdleCallback === "function") requestIdleCallback((deadline) => slice(() => deadline.timeRemaining()), { timeout: 2000 });
        else setTimeout(() => slice(() => budget), 30);
    };
}

/** What the learner is given. */
export interface LearnerOptions {
    /** The places to learn from, as they are now. */
    stores: () => Store[];
    keeper: Keeper;
    idle?: Idle;
    now?: () => number;
    /** How long to wait after starting before looking through the places, so that opening mdQuire is not slowed. */
    delay?: number;
    /** How long after a change the counts are kept, so that a run of saves is kept once. */
    keepAfter?: number;
}

/** The learner, as the editor uses it. */
export interface Learner {
    /** The words to show after the caret, or undefined; nothing until what was kept has been read. */
    predict(before: string): string | undefined;
    /** Reads what was kept, then learns what is new in the places, in idle time. */
    start(): Promise<void>;
    /** The document now open and its text as opened: if that is what was learned, its first save can take those words back exactly. */
    opened(key: string, text: string): void;
    /** A document was saved with this text: what it taught before is taken back and the new text learned. */
    saved(key: string, text: string): Promise<void>;
    /** Forgets everything learned; documents not changed since are not learned again. */
    forget(): Promise<void>;
    stop(): void;
    /** Settles once the work asked for so far is done. */
    settled(): Promise<void>;
    /** How much it holds, and how many documents it has learned. */
    size(): ReturnType<Model["size"]> & { documents: number; stale: number };
}

/** True when something read back has the shape of what is kept. */
function readable(kept: unknown): kept is Kept {
    if (!kept || typeof kept !== "object") return false;
    const { docs, since, stale, model } = kept as Partial<Kept>;
    return !!model && Array.isArray(docs) && typeof since === "number" && typeof stale === "number" && docs.every((entry) => Array.isArray(entry) && typeof entry[0] === "string" && !!entry[1] && typeof entry[1].hash === "string" && typeof entry[1].modified === "number");
}

/** Makes a learner. */
export function createLearner(options: LearnerOptions): Learner {
    const idle = options.idle ?? browserIdle();
    const now = options.now ?? (() => Date.now());
    let model = createModel();
    let docs = new Map<string, Learned>();
    let since = 0;
    let stale = 0;
    let ready = false;
    let stopped = false;
    /** The document open in the editor and its text as last learned or opened. */
    let current: { key: string; text: string } | undefined;
    let running: Promise<void> = Promise.resolve();
    let keeping: ReturnType<typeof setTimeout> | undefined;

    /** Waits for the next slice of idle time and gives how long it has. */
    const slice = () => new Promise<() => number>((done) => idle((left) => done(left)));
    const queue = (task: () => Promise<void>) => (running = running.then(() => (stopped ? undefined : task())).catch(() => undefined));

    async function learnText(text: string, sign: 1 | -1, left: () => number) {
        for (const part of paragraphs(text)) {
            if (stopped) return left;
            model.learn(part, sign);
            if (left() <= 0) left = await slice();
        }
        return left;
    }

    function keepSoon() {
        clearTimeout(keeping);
        keeping = setTimeout(() => queue(keep), options.keepAfter ?? KEEP_AFTER);
    }
    async function keep() {
        await slice();
        await options.keeper.save({ model: model.data(), docs: [...docs], since, stale }).catch(() => undefined);
    }

    /** Looks through every place for documents not learned, or changed, since last time. */
    async function scan(again = true) {
        let left = await slice();
        let changed = false;
        const listed = new Set<string>();
        const seen = new Set<string>();
        for (const store of options.stores()) {
            if (stopped) return;
            if (!store.can.list) continue;
            const entries = await store.list().catch(() => undefined);
            if (!entries) continue;
            listed.add(store.label);
            for (const entry of entries) {
                if (stopped) return;
                const key = documentKey(store, entry.id);
                seen.add(key);
                const was = docs.get(key);
                const modified = entry.modified ?? 0;
                if (was && entry.modified !== undefined && was.modified >= modified) continue;
                // after she asked it to forget, a document not written in since is not learned again
                if (!was && since && modified < since) continue;
                const opened = await store.open(entry.id).catch(() => undefined);
                if (!opened || opened.text.length > LONGEST) continue;
                if (left() <= 0) left = await slice();
                const hash = hashOf(opened.text);
                if (!was) {
                    left = await learnText(opened.text, 1, left);
                    docs.set(key, { hash, modified });
                    changed = true;
                } else if (was.hash !== hash && !was.stale) {
                    was.stale = true;
                    stale++;
                    changed = true;
                }
                if (was) was.modified = modified;
                if (left() <= 0) left = await slice();
            }
        }
        // a document gone from a place that was looked through is out of date too
        for (const [key, learned] of docs)
            if (!seen.has(key) && listed.has(key.split("\u0000")[0]!) && !learned.stale) {
                learned.stale = true;
                stale++;
                changed = true;
            }
        if (again && stale > Math.max(10, docs.size * 0.1)) {
            model = createModel();
            docs = new Map();
            stale = 0;
            current = undefined;
            return scan(false);
        }
        await slice();
        model.prepare();
        if (changed) keepSoon();
    }

    return {
        predict: (before) => (ready && !stopped ? model.predict(before) : undefined),
        async start() {
            const kept = await options.keeper.load().catch(() => undefined);
            if (stopped) return;
            if (readable(kept)) {
                model = createModel(kept.model);
                docs = new Map(kept.docs);
                since = kept.since;
                stale = kept.stale;
                await slice();
                model.prepare();
            }
            ready = true;
            const delay = options.delay ?? 0;
            await new Promise((done) => setTimeout(done, delay));
            await queue(() => scan());
        },
        opened(key, text) {
            current = { key, text };
        },
        saved(key, text) {
            return queue(async () => {
                if (!options.stores().some((store) => key.startsWith(`${store.label}\u0000`)) || text.length > LONGEST) return;
                const hash = hashOf(text);
                const was = docs.get(key);
                if (was?.hash === hash) return;
                let left = await slice();
                if (was) {
                    // only what is known to be what was learned can be taken back
                    const before = current?.key === key && hashOf(current.text) === was.hash && !was.stale ? current.text : undefined;
                    if (before === undefined) {
                        if (!was.stale) {
                            was.stale = true;
                            stale++;
                            keepSoon();
                        }
                        return;
                    }
                    left = await learnText(before, -1, left);
                }
                await learnText(text, 1, left);
                docs.set(key, { hash, modified: now() });
                current = { key, text };
                keepSoon();
            });
        },
        forget() {
            return queue(async () => {
                model = createModel();
                docs = new Map();
                stale = 0;
                since = now();
                current = undefined;
                clearTimeout(keeping);
                await options.keeper.clear().catch(() => undefined);
                await options.keeper.save({ model: model.data(), docs: [], since, stale }).catch(() => undefined);
            });
        },
        stop() {
            stopped = true;
            clearTimeout(keeping);
        },
        settled: () => running,
        size: () => ({ ...model.size(), documents: docs.size, stale }),
    };
}
