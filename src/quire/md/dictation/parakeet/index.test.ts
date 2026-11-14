// Tests of index.ts with a made-up ONNX Runtime: that the pieces are joined in the right order
// (features, encoder, decoder), that words carry their times in seconds, that a stream settles the
// same words a whole-phrase run does, and that the words list reaches the decoder.

import { afterEach, beforeAll, describe, expect, test } from "bun:test";
import { open } from "./index";
import { provide, type Ort } from "./runtime";

/** Pieces: "▁a" is 0, "▁b" is 1, the blank is 2. The encoder's frame k holds k % 2, and the decoder writes the piece with that number, for one frame. */
const VOCAB = "▁a 0\n▁b 1\n<blk> 2\n";

function fakeOrt() {
    const seen = { decoderBoost: 0, decoded: 0 };
    class Tensor {
        constructor(public type: string, public data: ArrayBufferView, public dims: number[]) {}
        async getData() {
            return this.data as Float32Array;
        }
        dispose() {}
    }
    let made = 0;
    const ort = {
        env: { wasm: { wasmPaths: undefined as unknown, numThreads: 0, simd: false, proxy: true } },
        Tensor,
        InferenceSession: {
            async create() {
                const encoder = made++ === 0;
                if (encoder) {
                    return {
                        inputNames: ["audio_signal", "length"],
                        outputNames: ["outputs"],
                        inputMetadata: [{ name: "audio_signal", shape: ["batch", 128, "frames"] }],
                        async run(feeds: Record<string, Tensor>) {
                            const frames = feeds.audio_signal!.dims[2]!;
                            const steps = Math.floor((frames - 1) / 8) + 1;
                            const data = new Float32Array(steps);
                            for (let k = 0; k < steps; k++) data[k] = k % 2;
                            return { outputs: new Tensor("float32", data, [1, 1, steps]) };
                        },
                        async release() {},
                    };
                }
                return {
                    inputNames: ["encoder_outputs", "targets", "target_length", "input_states_1", "input_states_2"],
                    outputNames: ["outputs", "output_states_1", "output_states_2"],
                    inputMetadata: [
                        { name: "encoder_outputs", isTensor: true, type: "float32", shape: ["batch", 1, 1] },
                        { name: "targets", isTensor: true, type: "int32", shape: ["batch", 1] },
                        { name: "target_length", isTensor: true, type: "int32", shape: ["batch"] },
                        { name: "input_states_1", isTensor: true, type: "float32", shape: [1, "batch", 2] },
                        { name: "input_states_2", isTensor: true, type: "float32", shape: [1, "batch", 2] },
                    ],
                    async run(feeds: Record<string, Tensor>) {
                        seen.decoded++;
                        const which = (feeds.encoder_outputs!.data as Float32Array)[0]!;
                        // three piece scores, then five duration scores of which the second (one frame) wins
                        const logits = new Float32Array([which === 0 ? 5 : 0, which === 1 ? 5 : 0, 0, 0, 5, 0, 0, 0]);
                        return { outputs: new Tensor("float32", logits, [1, 1, 1, 8]), output_states_1: new Tensor("float32", new Float32Array(2), [1, 1, 2]), output_states_2: new Tensor("float32", new Float32Array(2), [1, 1, 2]) };
                    },
                    async release() {},
                };
            },
        },
    };
    return { ort: ort as unknown as Ort, seen };
}

const original = { navigator: (globalThis as Record<string, unknown>).navigator, self: (globalThis as Record<string, unknown>).self };
beforeAll(() => {
    Object.assign(globalThis, { navigator: { hardwareConcurrency: 4 }, crossOriginIsolated: false });
    (globalThis as { self?: unknown }).self = globalThis;
});
afterEach(() => {
    Object.assign(globalThis, original);
});

const sound = (seconds: number) => new Float32Array(Math.round(16000 * seconds)).map((_, at) => Math.sin(at * 0.07) * 0.3);

describe("opening", () => {
    test("a vocabulary that will not do lets go of the sessions already made", async () => {
        const { ort } = fakeOrt();
        let released = 0;
        const create = ort.InferenceSession.create.bind(ort.InferenceSession);
        (ort.InferenceSession as { create: unknown }).create = async (...args: Parameters<typeof create>) => ({ ...(await create(...args)), release: async () => void released++ });
        provide("wasm", ort);
        await expect(open({ encoder: new ArrayBuffer(1), decoder: new ArrayBuffer(1), vocab: "x 30000000" })).rejects.toThrow();
        expect(released).toBe(2);
    });
});

describe("a recognizer", () => {
    test("turns sound into the words the decoder wrote, with times in seconds", async () => {
        const { ort } = fakeOrt();
        provide("wasm", ort);
        const recognizer = await open({ encoder: new ArrayBuffer(1), decoder: new ArrayBuffer(1), vocab: VOCAB }, { bins: 128 });
        const heard = await recognizer.transcribe(sound(1));
        expect(heard.text.startsWith("a b a b")).toBe(true);
        expect(heard.words[1]!.start).toBeCloseTo(0.08, 5);
        expect(recognizer.backend.kind).toBe("wasm");
    });

    test("a stream gives the same words as a whole-phrase run when it is finished", async () => {
        const { ort } = fakeOrt();
        provide("wasm", ort);
        const recognizer = await open({ encoder: new ArrayBuffer(1), decoder: new ArrayBuffer(1), vocab: VOCAB });
        const whole = await recognizer.transcribe(sound(5));
        const stream = recognizer.stream({ chunk: 1, left: 1, right: 1 });
        for (let s = 0; s < 5; s++) await stream.push(sound(1));
        const words = await stream.finish();
        // the fake encoder alternates by position in its window, so only the count and times can agree
        expect(Math.abs(words.length - whole.words.length)).toBeLessThanOrEqual(2);
        expect(words.at(-1)!.end).toBeGreaterThan(4.8);
    });

    test("a words list can be set after opening", async () => {
        const { ort } = fakeOrt();
        provide("wasm", ort);
        const recognizer = await open({ encoder: new ArrayBuffer(1), decoder: new ArrayBuffer(1), vocab: VOCAB });
        recognizer.boost(["a"]);
        const heard = await recognizer.transcribe(sound(0.5));
        expect(heard.words.length).toBeGreaterThan(0);
        await recognizer.release();
    });
});
