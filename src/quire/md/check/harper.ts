// The page's side of grammar worked out by Harper (grammar-worker.ts): what was found in each paragraph's
// text, kept by that exact text, so that an answer for a paragraph since changed is never shown on the new
// one. A text not yet answered is asked for, one at a time in the order asked, and `answered` is told
// when answers come, a few at a time, so that checking runs again and shows them. The worker, and the
// 20 MB engine it loads (about 7 MB sent compressed, then kept by the browser), are fetched only when
// grammar is first asked for.

import type { Grammar, Lint } from "./engine";
import type { FromGrammar, ToGrammar } from "./grammar-worker";

/** The most texts whose answers are kept; the oldest go first. */
const KEPT = 4000;

/** Grammar from Harper, as the checking view holds it. */
export interface HarperGrammar extends Grammar {
    /** Sets the dialect; what was found in the other is forgotten. */
    dialect(dialect: "us" | "gb"): void;
    /** True once Harper could not be started; nothing more is asked of it. */
    failed(): boolean;
    destroy(): void;
}

/** Grammar from Harper, in a worker made by `start` (the real one, unless a test gives another). */
export function createHarper(answered: () => void, start: () => Worker = () => new Worker(new URL("./grammar-worker.ts", import.meta.url), { type: "module" })): HarperGrammar {
    let worker: Worker | undefined;
    let broken = false;
    const found = new Map<string, Lint[]>();
    const asked = new Set<string>();
    const queue: string[] = [];
    let busy: { id: number; text: string } | undefined;
    let next = 0;
    let told: ReturnType<typeof setTimeout> | undefined;
    let current: "us" | "gb" = "us";

    // answers come one by one; checking runs again once a moment after the last of a run of them
    const tell = () => {
        clearTimeout(told);
        told = setTimeout(answered, queue.length ? 300 : 30);
    };
    const send = () => {
        if (busy || broken || !worker) return;
        const text = queue.shift();
        if (text === undefined) return;
        busy = { id: ++next, text };
        worker.postMessage({ id: busy.id, text } satisfies ToGrammar);
    };
    const open = () => {
        if (worker || broken) return;
        try {
            worker = start();
        } catch {
            broken = true;
            return;
        }
        worker.postMessage({ dialect: current } satisfies ToGrammar);
        worker.onmessage = (event: MessageEvent<FromGrammar>) => {
            const answer = event.data;
            if ("failed" in answer) {
                broken = true;
                worker?.terminate();
                return;
            }
            // an answer asked before the dialect changed is dropped, and the next text sent
            if (!busy || answer.id !== busy.id) return send();
            found.set(busy.text, answer.lints);
            asked.delete(busy.text);
            busy = undefined;
            // the oldest answers go, so that a long session does not keep every text ever typed
            while (found.size > KEPT) found.delete(found.keys().next().value!);
            tell();
            send();
        };
        worker.onerror = () => {
            broken = true;
        };
    };

    return {
        lints(text) {
            const known = found.get(text);
            if (known) return known;
            if (broken) return [];
            if (!asked.has(text)) {
                asked.add(text);
                queue.push(text);
                open();
                send();
            }
            return undefined;
        },
        dialect(dialect) {
            if (dialect === current) return;
            current = dialect;
            busy = undefined;
            found.clear();
            asked.clear();
            queue.length = 0;
            worker?.postMessage({ dialect } satisfies ToGrammar);
        },
        failed: () => broken,
        destroy() {
            clearTimeout(told);
            worker?.terminate();
            worker = undefined;
        },
    };
}
