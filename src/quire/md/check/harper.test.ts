// The page's side of Harper: each text asked for once, its answer kept by that exact text, an answer
// asked before the dialect changed dropped, and grammar going on without Harper when it cannot start.

import { expect, test } from "bun:test";
import type { Lint } from "./engine";
import { createHarper } from "./harper";

/** A worker stood in for: it answers each text when told, with a lint over its first letter. */
function fakeWorker() {
    const sent: unknown[] = [];
    const worker = {
        onmessage: undefined as ((event: MessageEvent) => void) | undefined,
        onerror: undefined as (() => void) | undefined,
        postMessage: (message: unknown) => void sent.push(message),
        terminate: () => {},
    };
    const answer = (index: number, lints: Lint[] = [{ from: 0, to: 1, rule: "AnA", kind: "Miscellaneous", message: "m", fixes: [] }]) => {
        const asked = sent[index] as { id: number };
        worker.onmessage!({ data: { id: asked.id, lints } } as MessageEvent);
    };
    return { worker, sent, answer };
}

test("the page asks Harper for each text once, keeps its answer by that text, and drops one asked before the dialect changed", async () => {
    const { worker, sent, answer } = fakeWorker();
    let told = 0;
    const harper = createHarper(() => told++, () => worker as unknown as Worker);
    expect(harper.lints("A one.")).toBeUndefined();
    expect(harper.lints("A one.")).toBeUndefined();
    expect(harper.lints("A two.")).toBeUndefined();
    // the dialect first, then one text at a time
    expect(sent).toEqual([{ dialect: "us" }, { id: 1, text: "A one." }]);
    answer(1);
    expect(harper.lints("A one.")).toHaveLength(1);
    expect(sent[2]).toEqual({ id: 2, text: "A two." });
    await Bun.sleep(400);
    expect(told).toBe(1);
    // a change of dialect forgets what was found, and an answer to a text asked before it is dropped
    harper.dialect("gb");
    answer(2);
    expect(harper.lints("A two.")).toBeUndefined();
    expect(sent.at(-2)).toEqual({ dialect: "gb" });
    expect(sent.at(-1)).toEqual({ id: 3, text: "A two." });
    harper.destroy();
});

test("when the worker cannot start Harper, grammar goes on without it", () => {
    const { worker } = fakeWorker();
    const harper = createHarper(() => {}, () => worker as unknown as Worker);
    expect(harper.lints("A text.")).toBeUndefined();
    worker.onmessage!({ data: { failed: "no WebAssembly" } } as MessageEvent);
    expect(harper.failed()).toBe(true);
    expect(harper.lints("A text.")).toEqual([]);
});

