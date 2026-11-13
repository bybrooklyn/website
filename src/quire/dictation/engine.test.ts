// The page's side of the engine worker, with a made-up Worker: every ask is answered or failed by
// its own number, a worker that dies fails every ask still waiting (so a session never hangs on
// it), a recognizer of a dead worker fails at once instead of starting a new one, and a live
// phrase whose sound the worker could not take fails its finish so that it is recognized whole.

import { afterAll, beforeEach, describe, expect, test } from "bun:test";
import { createProvider, type Answer, type Ask } from "./engine";
import { tierOf } from "./models";

/** A worker that records what it is asked, and that the test answers for. */
class Pretend {
    static made: Pretend[] = [];
    asked: Ask[] = [];
    ended = false;
    onmessage: ((event: { data: Answer }) => void) | null = null;
    onerror: ((event: { message: string }) => void) | null = null;
    onmessageerror: (() => void) | null = null;
    constructor() {
        Pretend.made.push(this);
    }
    postMessage(ask: Ask) {
        this.asked.push(ask);
    }
    terminate() {
        this.ended = true;
    }
    answer(answer: Answer) {
        this.onmessage?.({ data: answer });
    }
    /** The number of the last ask of a type. */
    last(type: Ask["type"]): number {
        const found = this.asked.filter((ask) => ask.type === type).at(-1) as { id: number };
        return found.id;
    }
}

const before = (globalThis as { Worker?: unknown }).Worker;
(globalThis as { Worker?: unknown }).Worker = Pretend;
afterAll(() => void ((globalThis as { Worker?: unknown }).Worker = before));
beforeEach(() => void (Pretend.made = []));

const tier = tierOf("light");
const tick = () => new Promise((done) => setTimeout(done, 0));

async function loaded() {
    const provider = createProvider();
    const loading = provider.load(tier, []);
    const worker = Pretend.made[0]!;
    worker.answer({ type: "loaded", id: worker.last("load"), ms: 5, backend: "the processor", threads: 1, live: true });
    const { recognizer } = await loading;
    return { provider, worker, recognizer };
}

describe("the engine", () => {
    test("answers each ask by its own number", async () => {
        const { worker, recognizer } = await loaded();
        const one = recognizer.transcribe(new Float32Array(10));
        const two = recognizer.transcribe(new Float32Array(10));
        const [first, second] = worker.asked.filter((ask) => ask.type === "recognize").map((ask) => (ask as { id: number }).id);
        worker.answer({ type: "heard", id: second!, text: "two", words: [], ms: 1 });
        worker.answer({ type: "heard", id: first!, text: "one", words: [], ms: 1 });
        expect((await one).text).toBe("one");
        expect((await two).text).toBe("two");
    });
    test("a worker that dies fails every ask still waiting, and its recognizer fails at once after", async () => {
        const { worker, recognizer } = await loaded();
        const heard = recognizer.transcribe(new Float32Array(10));
        const stream = recognizer.stream!();
        const finished = stream.finish();
        worker.onerror?.({ message: "out of memory" });
        await expect(heard).rejects.toThrow("stopped");
        await expect(finished).rejects.toThrow("stopped");
        expect(worker.ended).toBe(true);
        await expect(recognizer.transcribe(new Float32Array(10))).rejects.toThrow("stopped");
        await expect(recognizer.stream!().finish()).rejects.toThrow("stopped");
        // no new worker was made for the dead one's recognizer
        expect(Pretend.made.length).toBe(1);
    });
    test("a failed load is a rejection, and a later answer from a worker that has gone is ignored", async () => {
        const provider = createProvider();
        const loading = provider.load(tier, []);
        const worker = Pretend.made[0]!;
        worker.answer({ type: "failed", id: worker.last("load"), message: "no such file", cancelled: false });
        await expect(loading).rejects.toThrow("no such file");
        worker.onerror?.({ message: "gone" });
        const again = provider.load(tier, []);
        const next = Pretend.made[1]!;
        worker.answer({ type: "loaded", id: next.last("load"), ms: 1, backend: "old", threads: 1, live: false });
        next.answer({ type: "loaded", id: next.last("load"), ms: 1, backend: "new", threads: 1, live: false });
        expect((await again).recognizer.backend).toBe("new");
    });
    test("a live phrase whose sound the worker could not take fails its finish, so the session recognizes it whole", async () => {
        const { worker, recognizer } = await loaded();
        const stream = recognizer.stream!();
        const open = worker.asked.find((ask) => ask.type === "stream-open") as { stream: number };
        worker.answer({ type: "failed", message: "the model failed", cancelled: false, stream: open.stream });
        stream.push(new Float32Array(10));
        await expect(stream.finish()).rejects.toThrow();
        expect(worker.asked.filter((ask) => ask.type === "stream-push" || ask.type === "stream-finish").length).toBe(0);
    });
    test("a download reports its progress and ends with its own answer, or with cancelled set", async () => {
        const provider = createProvider();
        const seen: number[] = [];
        const going = provider.download(tier, (bytes) => seen.push(bytes));
        const worker = Pretend.made[0]!;
        const id = worker.last("download");
        worker.answer({ type: "progress", id, bytes: 10 });
        worker.answer({ type: "downloaded", id });
        await going;
        expect(seen).toEqual([10]);
        const stopped = provider.download(tier, () => {});
        provider.cancel();
        expect(worker.asked.at(-1)!.type).toBe("cancel");
        worker.answer({ type: "failed", id: worker.last("download"), message: "cancelled", cancelled: true });
        await expect(stopped).rejects.toMatchObject({ cancelled: true });
    });
    test("letting the recognizer go ends the worker and fails what was waiting", async () => {
        const { worker, recognizer } = await loaded();
        const heard = recognizer.transcribe(new Float32Array(10)).then(() => "answered", (error: Error) => error.message);
        recognizer.dispose();
        await tick();
        expect(worker.ended).toBe(true);
        expect(await heard).toContain("let go");
    });
});
