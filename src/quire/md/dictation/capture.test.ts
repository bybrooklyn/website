// The microphone with a made-up browser: whatever fails while it is being opened, its tracks are
// stopped and its audio context closed; a context that never starts is given up after a few
// seconds; closing twice closes once; and a microphone taken away closes itself and says so once.

import { afterEach, describe, expect, mock, test } from "bun:test";

mock.module("./capture-worklet.ts?worker&url", () => ({ default: "capture-worklet.js" }));
const { openMicrophone, MicrophoneError } = await import("./capture");

/** What the made-up browser was asked, and what it should do. */
function browser(fail: { module?: boolean; node?: boolean; resume?: "never" | "reject" } = {}) {
    const seen = { stopped: 0, closed: 0 };
    const track = { onended: null as (() => void) | null, stop: () => void seen.stopped++ };
    const stream = { getTracks: () => [track], getAudioTracks: () => [track] };
    let context: { state: string; onstatechange: (() => void) | null } | undefined;
    class Context {
        state = "suspended";
        onstatechange: (() => void) | null = null;
        audioWorklet = { addModule: async () => (fail.module ? Promise.reject(new Error("no")) : undefined) };
        constructor() {
            context = this;
        }
        createMediaStreamSource = () => ({ connect() {}, disconnect() {} });
        resume = () => (fail.resume === "never" ? new Promise(() => {}) : fail.resume === "reject" ? Promise.reject(new Error("no")) : Promise.resolve().then(() => void (this.state = "running")));
        close = async () => void seen.closed++;
    }
    class Node {
        port = { onmessage: null as unknown };
        constructor() {
            if (fail.node) throw new Error("no");
        }
        disconnect() {}
    }
    Object.assign(globalThis, { navigator: { mediaDevices: { getUserMedia: async () => stream } }, AudioContext: Context, AudioWorkletNode: Node });
    return { seen, track, context: () => context! };
}

const saved = { navigator: globalThis.navigator, AudioContext: (globalThis as { AudioContext?: unknown }).AudioContext, AudioWorkletNode: (globalThis as { AudioWorkletNode?: unknown }).AudioWorkletNode };
afterEach(() => void Object.assign(globalThis, saved));

describe("opening the microphone", () => {
    for (const [what, fail] of [
        ["the worklet cannot be loaded", { module: true }],
        ["the worklet node cannot be made", { node: true }],
        ["the sound will not start", { resume: "reject" }],
        ["the sound never starts", { resume: "never" }],
    ] as const) {
        test(`when ${what}, stops the tracks, closes the context and says why`, async () => {
            const { seen } = browser(fail);
            await expect(openMicrophone(() => {}, undefined, { wait: 20 })).rejects.toBeInstanceOf(MicrophoneError);
            expect(seen).toEqual({ stopped: 1, closed: 1 });
        });
    }
    test("closing twice closes once", async () => {
        const { seen } = browser();
        const mic = await openMicrophone(() => {});
        mic.close();
        mic.close();
        expect(seen).toEqual({ stopped: 1, closed: 1 });
    });
});

describe("a microphone taken away", () => {
    test("by its track ending (unplugged, permission withdrawn) closes itself and says so once", async () => {
        const { seen, track } = browser();
        let lost = 0;
        const mic = await openMicrophone(() => {}, () => lost++);
        track.onended?.();
        track.onended?.();
        mic.close();
        expect(lost).toBe(1);
        expect(seen).toEqual({ stopped: 1, closed: 1 });
    });
    test("by the system interrupting the sound closes itself and says so", async () => {
        const { seen, context } = browser();
        let lost = 0;
        await openMicrophone(() => {}, () => lost++);
        context().state = "interrupted";
        context().onstatechange?.();
        expect(lost).toBe(1);
        expect(seen).toEqual({ stopped: 1, closed: 1 });
    });
    test("is not reported after it was closed on purpose", async () => {
        const { track } = browser();
        let lost = 0;
        const mic = await openMicrophone(() => {}, () => lost++);
        mic.close();
        track.onended?.();
        expect(lost).toBe(0);
    });
});
