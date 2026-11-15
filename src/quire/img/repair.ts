// Repairing a JPEG as the editor offers it: the arithmetic of deblock.ts run in a worker of its own, so the
// picture stays in use while a 12 megapixel photograph takes its few seconds. The page sends the original's
// bytes (for its tables) and its decoded pixels, and has the repaired pixels back. This file is both sides,
// as measure.ts is: `serve` in the worker, `createRepair` on the page; where a worker cannot be made the
// page does the work itself.
//
//   const repairer = createRepair();
//   const pixels = await repairer.run(bytes, decoded);      ImageData, or undefined if the file says too little

import { jpegFacts, repair, worthRepairing } from "./deblock";

/** What the page sends: the original's bytes and its decoded pixels, numbered. */
export interface RepairAsk {
    id: number;
    bytes: Uint8Array;
    width: number;
    height: number;
    data: Uint8ClampedArray;
}

/** What the worker answers: the repaired pixels, or nothing when the file is not a JPEG worth repairing. */
export interface RepairAnswer {
    id: number;
    data?: Uint8ClampedArray;
}

/** One repair: the file's facts read, and its pixels repaired if it is a JPEG of the size of the pixels and worth repairing. */
export function serve(ask: RepairAsk): RepairAnswer {
    const facts = jpegFacts(ask.bytes);
    if (!facts || !worthRepairing(facts) || facts.width !== ask.width || facts.height !== ask.height) return { id: ask.id };
    return { id: ask.id, data: repair(ask.data, ask.width, ask.height, facts) };
}

const inWorker = typeof self !== "undefined" && typeof (self as { importScripts?: unknown }).importScripts === "function";
if (inWorker) {
    self.onmessage = (event: MessageEvent<RepairAsk>) => {
        const answer = serve(event.data);
        (self as unknown as Worker).postMessage(answer, answer.data ? [answer.data.buffer] : []);
    };
}

/** The repairer, on the page: its worker made when first asked, each repair answered in turn. */
export function createRepair(make: () => Worker = () => new Worker(new URL("./repair.ts", import.meta.url), { type: "module" })) {
    let worker: Worker | undefined;
    let failed = false;
    let next = 0;
    const waiting = new Map<number, (answer: RepairAnswer) => void>();
    const start = () => {
        if (worker || failed) return worker;
        try {
            worker = make();
            worker.onmessage = (event: MessageEvent<RepairAnswer>) => {
                waiting.get(event.data.id)?.(event.data);
                waiting.delete(event.data.id);
            };
            worker.onerror = () => {
                failed = true;
                worker?.terminate();
                worker = undefined;
                for (const done of waiting.values()) done({ id: -1 });
                waiting.clear();
            };
        } catch {
            failed = true;
        }
        return worker;
    };
    return {
        /** The pixels of a JPEG repaired by what its bytes say, or undefined when it is not one worth repairing. */
        async run(bytes: Uint8Array, pixels: ImageData): Promise<ImageData | undefined> {
            const ask: RepairAsk = { id: ++next, bytes, width: pixels.width, height: pixels.height, data: pixels.data };
            const doing = start();
            const answer = doing
                ? await new Promise<RepairAnswer>((done) => {
                      waiting.set(ask.id, done);
                      doing.postMessage(ask);
                  })
                : serve(ask);
            // the worker failed part way: done here instead
            const made = answer.id === -1 ? serve(ask) : answer;
            return made.data ? new ImageData(new Uint8ClampedArray(made.data), pixels.width, pixels.height) : undefined;
        },
        destroy() {
            worker?.terminate();
            worker = undefined;
        },
    };
}
