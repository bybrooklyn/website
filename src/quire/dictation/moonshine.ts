// Moonshine tiny (27 million parameters, English, MIT) run straight on ONNX Runtime Web, for the
// smallest dictation tier. it is not a Parakeet, so this is the whole of what it needs: the
// encoder once over the audio, then the decoder's greedy loop with its cached attention state, and
// a tokenizer that only reads tokens back into text.
//
// The files are the Hugging Face export in `onnx-community/moonshine-tiny-ONNX`: `encoder_model`
// takes `input_values` (the 16 kHz samples, as they are) and gives `last_hidden_state`;
// `decoder_model_merged` takes `input_ids`, `encoder_hidden_states`, the cache (`past_key_values.N.
// decoder|encoder.key|value`) and `use_cache_branch`, and gives `logits` and `present.*`. On the
// first step the cache is empty and `use_cache_branch` is false, which also fills the encoder
// half of the cache; after that only the decoder half grows.
//
// The `ort` module is passed in, so that this runs in the engine's worker and in a test alike.

/** The few parts of ONNX Runtime Web this file uses. */
export interface Ort {
    InferenceSession: { create(model: ArrayBuffer | Uint8Array | string, options?: object): Promise<Session> };
    Tensor: new (type: string, data: Float32Array | BigInt64Array | Uint8Array | Int32Array, dims: number[]) => Tensor;
}
interface Tensor {
    data: Float32Array | BigInt64Array;
    dims: readonly number[];
    dispose?(): void;
}
interface Session {
    run(feeds: Record<string, Tensor>): Promise<Record<string, Tensor>>;
    release?(): Promise<void>;
}

/** The ids the model starts with and stops at. */
const START = 1;
const STOP = 2;
/** The decoder's layers, heads and head size, from the model's config. */
const LAYERS = 6;
const HEADS = 8;
const HEAD = 36;
/** Tokens the model says per second of audio at most; past this it is looping, and the loop is cut. */
const PER_SECOND = 9;

/** Reads token ids back into text: pieces joined, the word mark turned into a space, byte pieces turned into their bytes, special tokens left out. */
export function decodeTokens(pieces: string[], ids: number[]): string {
    const bytes: number[] = [];
    const encoder = new TextEncoder();
    for (const id of ids) {
        const piece = pieces[id];
        if (piece === undefined || id <= STOP) continue;
        const byte = /^<0x([0-9A-F]{2})>$/.exec(piece);
        if (byte) bytes.push(parseInt(byte[1]!, 16));
        else bytes.push(...encoder.encode(piece.replaceAll("▁", " ")));
    }
    return new TextDecoder().decode(new Uint8Array(bytes)).replace(/^ /, "");
}

/** The pieces by id, from the repository's `tokenizer.json`. Added tokens, which are all special, are left out. */
export function piecesOf(tokenizerJson: string): string[] {
    const vocab = (JSON.parse(tokenizerJson) as { model: { vocab: Record<string, number> } }).model.vocab;
    const pieces: string[] = [];
    const entries = Object.entries(vocab);
    for (const [piece, id] of entries) {
        // the ids run from 0 with few gaps if any, so one far past the count of entries is a changed file, refused rather than followed
        if (!Number.isInteger(id) || id < 0 || id >= Math.max(2 * entries.length, 1024)) throw new Error(`the tokenizer names piece ${id} but has only ${entries.length}`);
        pieces[id] = piece;
    }
    return pieces;
}

/** The index of the largest of the last row of logits. */
export function best(logits: Float32Array, size: number): number {
    const from = logits.length - size;
    let top = from;
    for (let at = from + 1; at < logits.length; at++) if (logits[at]! > logits[top]!) top = at;
    return top - from;
}

/** A loaded Moonshine: audio in, text out. */
export interface Moonshine {
    transcribe(samples: Float32Array): Promise<string>;
    dispose(): Promise<void>;
}

/** Loads the encoder and decoder as ONNX Runtime sessions and gives back the recognizer. */
export async function createMoonshine(ort: Ort, files: { encoder: ArrayBuffer | Uint8Array | string; decoder: ArrayBuffer | Uint8Array | string; tokenizer: string }, options: object = {}): Promise<Moonshine> {
    const pieces = piecesOf(files.tokenizer);
    const [encoder, decoder] = await Promise.all([ort.InferenceSession.create(files.encoder, options), ort.InferenceSession.create(files.decoder, options)]);
    const empty = () => new ort.Tensor("float32", new Float32Array(0), [1, HEADS, 0, HEAD]);

    return {
        async transcribe(samples) {
            if (samples.length < 1600) return "";
            const seconds = samples.length / 16000;
            const heard = (await encoder.run({ input_values: new ort.Tensor("float32", samples, [1, samples.length]) }))["last_hidden_state"]!;
            let cache: Record<string, Tensor> = {};
            for (let layer = 0; layer < LAYERS; layer++) for (const part of ["decoder", "encoder"]) for (const kind of ["key", "value"]) cache[`past_key_values.${layer}.${part}.${kind}`] = empty();
            const ids: number[] = [];
            let last = START;
            const limit = Math.max(8, Math.ceil(seconds * PER_SECOND));
            for (let step = 0; step < limit; step++) {
                const out = await decoder.run({
                    input_ids: new ort.Tensor("int64", BigInt64Array.from([BigInt(last)]), [1, 1]),
                    encoder_hidden_states: heard,
                    ...cache,
                    use_cache_branch: new ort.Tensor("bool", new Uint8Array([step === 0 ? 0 : 1]), [1]),
                });
                const logits = out["logits"]!;
                last = best(logits.data as Float32Array, logits.dims[logits.dims.length - 1]!);
                if (last === STOP) break;
                ids.push(last);
                const next: Record<string, Tensor> = {};
                for (let layer = 0; layer < LAYERS; layer++)
                    for (const part of ["decoder", "encoder"])
                        for (const kind of ["key", "value"]) {
                            const name = `${layer}.${part}.${kind}`;
                            // the encoder half is made on the first step and kept as it is
                            next[`past_key_values.${name}`] = part === "encoder" && step > 0 ? cache[`past_key_values.${name}`]! : out[`present.${name}`]!;
                        }
                cache = next;
            }
            return decodeTokens(pieces, ids);
        },
        async dispose() {
            await encoder.release?.();
            await decoder.release?.();
        },
    };
}
