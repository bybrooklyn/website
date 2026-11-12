// From encoder output to words: greedy decoding of a token-and-duration transducer (TDT), the kind
// of model Parakeet is. For each encoder frame the joint network is asked for a score for every
// piece and for every duration; the best piece is written down (unless it is the blank) and the
// frame position jumps ahead by the best duration. The prediction network (an LSTM that remembers
// what was already written) is read from the model and not assumed: one layer or two, any size.
//
// The decoder does not make ONNX sessions. It is given a `Step`, a function that runs one step of
// the decoder and joint, so it can be tested with a small scripted model; `stepFor` builds that
// function from a real session. A decode can stop at the end of any chunk of frames and go on with
// the next: the state it returns carries the prediction memory, the last piece, any frames still to
// be skipped, the biasing position and the word being spelled.
//
// Re-expressed from parakeet.js (MIT, Copyright (c) 2025 Yunus Seyhan Dede), parakeet.js transcribe().
// Parakeet.js assumes two layers of 640 and allocates tensors at every step; this reads the shape
// from the model and reuses its buffers.

import { type Booster } from "./boost";
import { close, join, type Open, type Vocabulary } from "./tokens";

// The word list and the vocabulary reader, which callers get from here.
export { booster } from "./boost";
/** The biasing toward the user's words, from boost.ts. */
export type { Booster } from "./boost";
export { vocabulary } from "./tokens";
/** The pieces of a model, from tokens.ts. */
export type { Vocabulary } from "./tokens";

/** What the prediction network remembers: the hidden and cell states of its LSTM layers, each `layers * hidden` long. */
export interface PredictionState {
    layers: number;
    hidden: number;
    h: Float32Array;
    c: Float32Array;
}

/**
 * One step of the decoder and joint: the encoder frame at `frame`, the last token, and the
 * prediction state in; logits over tokens then durations, and the new state, out. It must not
 * change `state`; what it returns may be reused by the next call, so the decoder uses it at once.
 * A step made by `stepFor` also carries the `layers` and `hidden` of the model.
 */
export interface Step {
    (frame: Float32Array, token: number, state: PredictionState): Promise<{ logits: Float32Array; state: PredictionState }> | { logits: Float32Array; state: PredictionState };
    layers?: number;
    hidden?: number;
}

/** What the decoder needs to know of the model: its pieces, what each duration index means in frames, which piece is the blank. */
export interface DecodeOptions {
    vocabulary: Vocabulary;
    /** Frames to advance for each duration logit, in order; for Parakeet TDT this is 0, 1, 2, 3, 4. */
    durations: number[];
    blank: number;
    /** The words to lean toward, from `booster`. */
    boost?: Booster;
    /** The most pieces written at one frame before moving on; 10 by default, as parakeet.js has it. */
    maxSymbols?: number;
    /** The prediction network's shape, if the step does not carry it. */
    layers?: number;
    hidden?: number;
}

/** A word with the first and last encoder frame it was heard in (counted from the start of the stream) and the mean probability of its pieces. */
export interface Word {
    text: string;
    from: number;
    to: number;
    confidence: number;
}

/** Everything needed to go on from where a decode stopped. */
export interface DecodeState {
    prediction: PredictionState;
    /** The last piece written; the blank at the start. */
    token: number;
    /** Frames of the next chunk to skip, when the last duration jumped past the end of this one. */
    skip: number;
    /** The biasing position, if there is a booster. */
    boost?: unknown;
    /** Frames passed in earlier chunks, so words are timed from the start of the stream. */
    frame: number;
    /** The word still being spelled, which the next piece may continue. */
    open: Open | null;
}

/** A decoder: `start` makes the state for a new sentence; `decode` runs frames and moves the state on; `finish` reads the word still open. */
export interface Decoder {
    /** A state for the start of a stream: zeroed memory, the blank as the last piece. */
    start(): DecodeState;
    /**
     * Runs `frames` encoder frames (frame by frame, `width` numbers each, frame number `t` starting
     * at `t * width`) from where `state` left off. Returns the pieces written, the words finished,
     * and the same `state` moved on in place, so give a copy (`copy`) to try a chunk without keeping it.
     */
    decode(encoded: Float32Array, frames: number, width: number, state: DecodeState): Promise<{ tokens: number[]; words: Word[]; state: DecodeState }>;
    /** The word still being spelled, as it stands; null if none. The state is not changed. */
    finish(state: DecodeState): Word | null;
}

/** A copy of a state that can be decoded from without changing the original. */
export function copy(state: DecodeState): DecodeState {
    const { prediction, open } = state;
    return { ...state, prediction: { ...prediction, h: prediction.h.slice(), c: prediction.c.slice() }, open: open && { ...open } };
}

/** Turns the encoder's output, which is `width` channels of `frames` numbers each, into `frames` frames of `width` numbers each, the order `decode` reads. */
export function frameMajor(channels: Float32Array, width: number, frames: number): Float32Array {
    const out = new Float32Array(frames * width);
    for (let t = 0; t < frames; t++) for (let d = 0; d < width; d++) out[t * width + d] = channels[d * frames + t]!;
    return out;
}

/** Makes a decoder around a step function. */
export function createDecoder(step: Step, options: DecodeOptions): Decoder {
    const { vocabulary: vocab, durations, blank, boost } = options;
    const size = vocab.pieces.length;
    const cap = options.maxSymbols ?? 10;
    const layers = options.layers ?? step.layers;
    const hidden = options.hidden ?? step.hidden;
    if (layers === undefined || hidden === undefined) throw new Error("the prediction network's layers and hidden size are needed, from the step or the options");
    const boosting = boost !== undefined && boost.words > 0 && boost.strength !== 0;

    /** A word as it is handed out. */
    const word = (open: Open): Word => close(open);

    return {
        start: () => ({ prediction: { layers, hidden, h: new Float32Array(layers * hidden), c: new Float32Array(layers * hidden) }, token: blank, skip: 0, boost: boosting ? boost.start() : undefined, frame: 0, open: null }),

        finish: (state) => (state.open && state.open.text !== "" ? word(state.open) : null),

        async decode(encoded, frames, width, state) {
            if (encoded.length < frames * width) throw new Error(`${frames} frames of ${width} need ${frames * width} numbers, got ${encoded.length}`);
            const tokens: number[] = [];
            const words: Word[] = [];
            const base = state.frame;
            let at = (state.boost as number | undefined) ?? 0;
            let emitted = 0;
            let t = state.skip;
            while (t < frames) {
                const made = step(encoded.subarray(t * width, (t + 1) * width), state.token, state.prediction);
                const { logits, state: next } = made instanceof Promise ? await made : made;
                if (logits.length < size + durations.length) throw new Error(`the joint gave ${logits.length} scores, but there are ${size} pieces and ${durations.length} durations`);

                // the best piece, with the bonus for pieces that continue a boosted word
                let top = logits[0]!;
                let best = 0;
                for (let id = 1; id < size; id++) {
                    const score = logits[id]!;
                    if (score > top) {
                        top = score;
                        best = id;
                    }
                }
                const plain = top;
                if (boosting) {
                    let lead = top;
                    for (const id of boost.candidates(at)) {
                        const score = logits[id]! + boost.strength;
                        if (score > lead) {
                            lead = score;
                            best = id;
                        }
                    }
                }

                // the best duration
                let long = size;
                for (let index = size + 1; index < size + durations.length; index++) if (logits[index]! > logits[long]!) long = index;
                const jump = durations[long - size]!;

                if (best !== blank) {
                    // the memory moves on only when something was written
                    state.prediction.h.set(next.h);
                    state.prediction.c.set(next.c);
                    state.token = best;
                    tokens.push(best);
                    emitted++;
                    let sum = 0;
                    for (let id = 0; id < size; id++) sum += Math.exp(logits[id]! - plain);
                    const end = base + t + Math.max(1, jump);
                    const joined = join(vocab, state.open, best, base + t, end, Math.exp(logits[best]! - plain) / sum);
                    if (joined.done && joined.done.text !== "") words.push(joined.done);
                    state.open = joined.open;
                    if (boosting) at = boost.advance(at, best);
                }

                // a jump moves ahead by its length; with none, a blank or a full frame moves on by one
                const advance = jump > 0 ? jump : best === blank || emitted >= cap ? 1 : 0;
                if (advance > 0) {
                    t += advance;
                    emitted = 0;
                }
            }
            state.skip = t - frames;
            state.frame = base + frames;
            if (boosting) state.boost = at;
            return { tokens, words, state };
        },
    };
}

/** A tensor as the step uses it: the data, the shape and a way to let go of it. */
export interface Tensor {
    data: unknown;
    dims: readonly number[];
    dispose?(): void;
}

/** What `stepFor` needs of an ONNX Runtime session, spelled out so that this file imports nothing. */
export interface Session {
    inputNames: readonly string[];
    outputNames: readonly string[];
    inputMetadata: readonly { name: string; isTensor?: boolean; type?: string; shape?: readonly (number | string)[] }[];
    run(feeds: Record<string, Tensor>): Promise<Record<string, Tensor>>;
}

/** What `stepFor` needs of the ONNX Runtime library: its tensor constructor (the `Tensor` of onnxruntime-web). */
export interface Runtime {
    Tensor: new (type: string, data: ArrayBufferView, dims: readonly number[]) => Tensor;
}

/** Whether a number type from the model's metadata is an integer type. */
const whole = (type: string | undefined) => type === "int32" || type === "int64";

/**
 * Builds a `Step` from the session of the combined decoder and joint file (`decoder_joint-model.int8.onnx`).
 * Which input is which is read from the session: the float input of rank 3 named for the encoder
 * is the frame; the whole-number input of rank 2 is the last token and the one of rank 1 its length;
 * the other two float inputs of rank 3 are the memory, whose first and last dimension are the layers
 * and the hidden size. The first output is the scores and the outputs named for states are the new memory.
 */
export function stepFor(session: Session, ort: Runtime): Step {
    const inputs = session.inputMetadata.filter((input) => input.isTensor !== false);
    const rank = (input: { shape?: readonly (number | string)[] }) => input.shape?.length ?? 0;
    const floats = inputs.filter((input) => input.type === "float32" && rank(input) === 3);
    const encoder = floats.find((input) => /enc/i.test(input.name)) ?? floats[0];
    const memory = floats.filter((input) => input !== encoder);
    const target = inputs.find((input) => whole(input.type) && rank(input) === 2);
    const length = inputs.find((input) => whole(input.type) && rank(input) === 1);
    if (!encoder || memory.length !== 2 || !target) throw new Error(`the decoder's inputs (${session.inputNames.join(", ")}) are not the ones of a decoder and joint`);
    const layers = Number(memory[0]!.shape![0]);
    const hidden = Number(memory[0]!.shape![2]);
    const width = Number(encoder.shape![1]);
    if (!(layers > 0 && hidden > 0 && width > 0)) throw new Error("the decoder's memory and frame have no fixed size");
    const scores = session.outputNames.find((name) => name === "outputs") ?? session.outputNames[0]!;
    const states = session.outputNames.filter((name) => /state/i.test(name));
    if (states.length !== 2) throw new Error(`the decoder's outputs (${session.outputNames.join(", ")}) do not hold two states`);

    // Buffers made once. The tensors wrap them without copying, so they are filled before each run.
    const frame = new Float32Array(width);
    const frameTensor = new ort.Tensor("float32", frame, [1, width, 1]);
    const long = target.type === "int64";
    const last = long ? new BigInt64Array(1) : new Int32Array(1);
    const lastTensor = new ort.Tensor(target.type!, last, [1, 1]);
    const ones = long ? BigInt64Array.of(1n) : Int32Array.of(1);
    const lengthTensor = length && new ort.Tensor(length.type!, ones, [1]);
    const kept = new Map<Float32Array, Tensor>();
    const wrap = (data: Float32Array) => {
        let tensor = kept.get(data);
        if (!tensor) kept.set(data, (tensor = new ort.Tensor("float32", data, [layers, 1, hidden])));
        return tensor;
    };
    const out: PredictionState = { layers, hidden, h: new Float32Array(layers * hidden), c: new Float32Array(layers * hidden) };

    let held: Tensor | undefined;
    const step: Step = async (input, token, state) => {
        frame.set(input);
        if (long) (last as BigInt64Array)[0] = BigInt(token);
        else (last as Int32Array)[0] = token;
        const feeds: Record<string, Tensor> = { [encoder.name]: frameTensor, [target.name]: lastTensor, [memory[0]!.name]: wrap(state.h), [memory[1]!.name]: wrap(state.c) };
        if (length && lengthTensor) feeds[length.name] = lengthTensor;
        const result = await session.run(feeds);
        out.h.set(result[states[0]!]!.data as Float32Array);
        out.c.set(result[states[1]!]!.data as Float32Array);
        // The scores are read where they are, and their tensor is let go of at the next step, when they have been used.
        held?.dispose?.();
        held = result[scores]!;
        for (const [name, tensor] of Object.entries(result)) if (tensor !== held) tensor.dispose?.();
        return { logits: held.data as Float32Array, state: out };
    };
    step.layers = layers;
    step.hidden = hidden;
    return step;
}
