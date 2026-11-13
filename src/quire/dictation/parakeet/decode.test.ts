// The TDT decoder with a tiny scripted model in place of the network: the best piece and the best
// duration are followed, blanks move on by at least one frame, a frame can hold several pieces up
// to a cap, the memory moves only when something is written and has the shape the model says
// (one layer or two), and stopping after any chunk and going on gives the same as one pass. Also
// `stepFor` against a pretend session.

import { describe, expect, test } from "bun:test";
import { copy, createDecoder, frameMajor, stepFor, type DecodeState, type Session, type Step, type Tensor, type Word } from "./decode";
import { vocabulary } from "./tokens";

const vocab = vocabulary(["▁the 0", "▁cat 1", "▁sat 2", "▁on 3", "▁mat 4", ". 5", "<blk> 6"].join("\n"));
const BLANK = 6;
const DURATIONS = [0, 1, 2, 3, 4];

/** What the pretend network says at a frame given the last piece: a piece (or the blank) and a duration. */
type Rule = (frame: number, token: number) => { piece: number; dur: number };

/** A step that follows a rule. The frame it is given holds its own number. Each call adds 1 to the memory it was given and 2 to the cell. */
function scripted(rule: Rule, layers: number, hidden: number): Step {
    const step: Step = (frame, token, state) => {
        const { piece, dur } = rule(frame[0]!, token);
        const logits = new Float32Array(vocab.pieces.length + DURATIONS.length).fill(-5);
        logits[piece] = 5;
        logits[vocab.pieces.length + dur] = 5;
        return { logits, state: { layers: state.layers, hidden: state.hidden, h: state.h.map((v) => v + 1), c: state.c.map((v) => v + 2) } };
    };
    step.layers = layers;
    step.hidden = hidden;
    return step;
}

/** Frames that hold their own number (counting from `first`) in the first place, as the scripted step reads them. */
const frames = (count: number, first = 0, width = 3) => Float32Array.from({ length: count * width }, (_, index) => (index % width === 0 ? first + index / width : 0));

const decoder = (rule: Rule, layers = 2, hidden = 4) => createDecoder(scripted(rule, layers, hidden), { vocabulary: vocab, durations: DURATIONS, blank: BLANK });

/** Says "the cat sat" at frames 0, 2 and 4 and nothing else. */
const sentence: Rule = (frame, token) => {
    const say = ({ 0: 0, 2: 1, 4: 2 } as Record<number, number>)[frame];
    return say !== undefined && token !== say ? { piece: say, dur: 1 } : { piece: BLANK, dur: 1 };
};

describe("decoding", () => {
    test("writes the best piece and moves on by the best duration", async () => {
        const run = decoder(sentence);
        const { tokens, words, state } = await run.decode(frames(6), 6, 3, run.start());
        expect(tokens).toEqual([0, 1, 2]);
        expect(words.map((w) => w.text)).toEqual(["the", "cat"]);
        expect(run.finish(state)?.text).toBe("sat");
    });
    test("times a word from its first frame to the end of its duration", async () => {
        const run = decoder(sentence);
        const { words, state } = await run.decode(frames(6), 6, 3, run.start());
        expect(words[0]).toMatchObject({ text: "the", from: 0, to: 1 });
        expect(words[1]).toMatchObject({ text: "cat", from: 2, to: 3 });
        expect(run.finish(state)).toMatchObject({ text: "sat", from: 4, to: 5 });
    });
    test("jumps ahead by the duration and so skips frames", async () => {
        const seen: number[] = [];
        const run = decoder((frame) => (seen.push(frame), { piece: frame === 0 ? 0 : BLANK, dur: 3 }));
        await run.decode(frames(7), 7, 3, run.start());
        expect(seen).toEqual([0, 3, 6]);
    });
    test("moves a blank with no duration on by one frame", async () => {
        const seen: number[] = [];
        const run = decoder((frame) => (seen.push(frame), { piece: BLANK, dur: 0 }));
        await run.decode(frames(4), 4, 3, run.start());
        expect(seen).toEqual([0, 1, 2, 3]);
    });
    test("stays on a frame while pieces come with no duration, up to the cap", async () => {
        const run = createDecoder(scripted((_, token) => ({ piece: token === 0 ? 1 : 0, dur: 0 }), 2, 4), { vocabulary: vocab, durations: DURATIONS, blank: BLANK, maxSymbols: 3 });
        const { tokens } = await run.decode(frames(2), 2, 3, run.start());
        expect(tokens).toEqual([0, 1, 0, 1, 0, 1]);
    });
    test("writes two pieces on one frame when the first has no duration", async () => {
        const run = decoder((frame, token) => (frame === 0 && token === BLANK ? { piece: 0, dur: 0 } : frame === 0 && token === 0 ? { piece: 1, dur: 1 } : { piece: BLANK, dur: 1 }));
        expect((await run.decode(frames(2), 2, 3, run.start())).tokens).toEqual([0, 1]);
    });
    test("gives each word a probability between 0 and 1", async () => {
        const run = decoder(sentence);
        const { words } = await run.decode(frames(6), 6, 3, run.start());
        expect(words.every((w) => w.confidence > 0.9 && w.confidence <= 1)).toBe(true);
    });
    test("refuses a joint that does not give a score for every piece and duration", async () => {
        const short: Step = Object.assign(() => ({ logits: new Float32Array(3), state: { layers: 1, hidden: 1, h: new Float32Array(1), c: new Float32Array(1) } }), { layers: 1, hidden: 1 });
        const run = createDecoder(short, { vocabulary: vocab, durations: DURATIONS, blank: BLANK });
        await expect(run.decode(frames(1), 1, 3, run.start())).rejects.toThrow();
    });
});

describe("the prediction memory", () => {
    for (const layers of [1, 2]) {
        test(`has the shape of the model, ${layers} layer${layers > 1 ? "s" : ""}, and moves only when a piece is written`, async () => {
            const run = decoder(sentence, layers, 5);
            const start = run.start();
            expect([start.prediction.layers, start.prediction.hidden, start.prediction.h.length, start.prediction.c.length]).toEqual([layers, 5, layers * 5, layers * 5]);
            const { state } = await run.decode(frames(6), 6, 3, start);
            expect(state.prediction.h.length).toBe(layers * 5);
            // three pieces were written, so the step's +1 and +2 were kept three times
            expect([...new Set(state.prediction.h)]).toEqual([3]);
            expect([...new Set(state.prediction.c)]).toEqual([6]);
            expect(state.token).toBe(2);
        });
    }
    test("is read from the options when the step does not say", () => {
        const bare: Step = () => ({ logits: new Float32Array(0), state: { layers: 1, hidden: 1, h: new Float32Array(1), c: new Float32Array(1) } });
        expect(createDecoder(bare, { vocabulary: vocab, durations: DURATIONS, blank: BLANK, layers: 1, hidden: 7 }).start().prediction.h.length).toBe(7);
        expect(() => createDecoder(bare, { vocabulary: vocab, durations: DURATIONS, blank: BLANK })).toThrow();
    });
    test("works with a step that answers later", async () => {
        const inner = scripted(sentence, 2, 4);
        const slow: Step = Object.assign(async (frame: Float32Array, token: number, state: Parameters<Step>[2]) => await inner(frame, token, state), { layers: 2, hidden: 4 });
        const run = createDecoder(slow, { vocabulary: vocab, durations: DURATIONS, blank: BLANK });
        expect((await run.decode(frames(6), 6, 3, run.start())).tokens).toEqual([0, 1, 2]);
    });
});

describe("resuming", () => {
    /** A rule with jumps of different lengths, several pieces on one frame, and long jumps that cross chunk edges. */
    const busy: Rule = (frame, token) => {
        if (frame % 5 === 0) return { piece: (frame / 5) % 6, dur: 0 };
        if (frame % 5 === 1) return token === BLANK ? { piece: BLANK, dur: 2 } : { piece: (token + 1) % 6, dur: 3 };
        return { piece: frame % 3 === 0 ? frame % 6 : BLANK, dur: (frame % 4) + 1 };
    };
    const whole = async () => {
        const run = decoder(busy);
        const { tokens, words, state } = await run.decode(frames(60), 60, 3, run.start());
        return { tokens, words: [...words, run.finish(state)], h: [...state.prediction.h] };
    };
    for (const cuts of [[10], [3, 4, 30], [1, 2, 3, 4, 5, 6, 7, 8, 9], [59]]) {
        test(`gives the same pieces and words cut after ${cuts.join(", ")} as in one pass`, async () => {
            const run = decoder(busy);
            let state: DecodeState = run.start();
            const tokens: number[] = [];
            const words: Word[] = [];
            let from = 0;
            for (const to of [...cuts, 60]) {
                // each chunk is an array of its own, as when the encoder hands them over one at a time
                const made = await run.decode(frames(to - from, from), to - from, 3, state);
                tokens.push(...made.tokens);
                words.push(...made.words);
                state = made.state;
                from = to;
            }
            const want = await whole();
            expect(want.tokens.length).toBeGreaterThan(20);
            expect(tokens).toEqual(want.tokens);
            expect([...words, run.finish(state)]).toEqual(want.words);
            expect([...state.prediction.h]).toEqual(want.h);
        });
    }
    test("carries the frames still to skip into the next chunk", async () => {
        const seen: number[] = [];
        const run = decoder((frame) => (seen.push(frame), { piece: BLANK, dur: 4 }));
        let state = run.start();
        state = (await run.decode(frames(3), 3, 3, state)).state;
        expect(state.skip).toBe(1);
        await run.decode(frames(6, 3), 6, 3, state);
        expect(seen).toEqual([0, 4, 8]);
    });
    test("lets a copy be tried without changing the original", async () => {
        const run = decoder(sentence);
        const start = run.start();
        const trial = copy(start);
        await run.decode(frames(6), 6, 3, trial);
        expect([start.token, start.frame, start.open, [...start.prediction.h]]).toEqual([BLANK, 0, null, [0, 0, 0, 0, 0, 0, 0, 0]]);
        expect(trial.frame).toBe(6);
    });
});

describe("frame order", () => {
    test("turns channels of frames into frames of channels", () => {
        expect([...frameMajor(Float32Array.of(1, 2, 3, 10, 20, 30), 2, 3)]).toEqual([1, 10, 2, 20, 3, 30]);
    });
});

describe("stepFor", () => {
    /** A pretend session for a decoder and joint with the given memory shape, which records what it was fed. */
    const pretend = (layers: number, long: boolean) => {
        const fed: { frame: readonly number[]; memory: readonly number[]; target: number }[] = [];
        const session: Session = {
            inputNames: ["encoder_outputs", "targets", "target_length", "input_states_1", "input_states_2"],
            outputNames: ["outputs", "prednet_lengths", "output_states_1", "output_states_2", "lse_token"],
            inputMetadata: [
                { name: "encoder_outputs", isTensor: true, type: "float32", shape: ["batch", 3, 1] },
                { name: "targets", isTensor: true, type: long ? "int64" : "int32", shape: ["batch", 1] },
                { name: "target_length", isTensor: true, type: long ? "int64" : "int32", shape: ["batch"] },
                { name: "input_states_1", isTensor: true, type: "float32", shape: [layers, "batch", 4] },
                { name: "input_states_2", isTensor: true, type: "float32", shape: [layers, "batch", 4] },
            ],
            async run(feeds) {
                const target = Number((feeds.targets!.data as Int32Array)[0]);
                fed.push({ frame: feeds.encoder_outputs!.dims, memory: feeds.input_states_1!.dims, target });
                const logits = new Float32Array(vocab.pieces.length + DURATIONS.length).fill(-5);
                logits[target === BLANK ? 0 : BLANK] = 5;
                logits[vocab.pieces.length + 1] = 5;
                const more = (tensor: Tensor, by: number) => ({ data: (tensor.data as Float32Array).map((v) => v + by), dims: tensor.dims });
                return { outputs: { data: logits, dims: [1, 1, 1, logits.length] }, prednet_lengths: { data: Int32Array.of(1), dims: [1] }, output_states_1: more(feeds.input_states_1!, 1), output_states_2: more(feeds.input_states_2!, 2), lse_token: { data: new Float32Array(1), dims: [1] } };
            },
        };
        const ort = { Tensor: class { constructor(public type: string, public data: ArrayBufferView, public dims: readonly number[]) {} } as unknown as new (type: string, data: ArrayBufferView, dims: readonly number[]) => Tensor };
        return { session, ort, fed };
    };
    for (const [layers, long] of [[1, false], [2, true]] as const) {
        test(`reads ${layers} layer${layers > 1 ? "s" : ""} and ${long ? "64" : "32"}-bit targets from the session and drives it`, async () => {
            const { session, ort, fed } = pretend(layers, long);
            const step = stepFor(session, ort);
            expect([step.layers, step.hidden]).toEqual([layers, 4]);
            const run = createDecoder(step, { vocabulary: vocab, durations: DURATIONS, blank: BLANK });
            const { tokens, state } = await run.decode(frames(3), 3, 3, run.start());
            expect(tokens).toEqual([0]);
            expect(fed[0]).toEqual({ frame: [1, 3, 1], memory: [layers, 1, 4], target: BLANK });
            expect(fed[1]!.target).toBe(0);
            expect([...new Set(state.prediction.h)]).toEqual([1]);
        });
    }
    test("makes its tensors once: decoding from a fresh copy of the state at every step keeps nothing more", async () => {
        const { session } = pretend(2, false);
        let made = 0;
        const ort = { Tensor: class { constructor(public type: string, public data: ArrayBufferView, public dims: readonly number[]) { made++; } } as unknown as new (type: string, data: ArrayBufferView, dims: readonly number[]) => Tensor };
        const step = stepFor(session, ort);
        const run = createDecoder(step, { vocabulary: vocab, durations: DURATIONS, blank: BLANK });
        const state = run.start();
        await run.decode(frames(3), 3, 3, copy(state));
        const after = made;
        for (let at = 0; at < 50; at++) await run.decode(frames(3), 3, 3, copy(state));
        expect(made).toBe(after);
    });
    test("says plainly when the inputs are not those of a decoder and joint", () => {
        const { session, ort } = pretend(1, false);
        expect(() => stepFor({ ...session, inputMetadata: session.inputMetadata.slice(0, 3) }, ort)).toThrow();
    });
});
