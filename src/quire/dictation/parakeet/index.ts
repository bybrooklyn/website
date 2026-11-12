// The Parakeet recognizer, in one piece: the sound's features (features.ts), the encoder on the
// graphics card or the processor (runtime.ts), and the decoder with the visitor's own words leaned
// toward (decode.ts, boost.ts). This is what replaces the parakeet.js library; what was written
// from reading it is named in LICENSE-parakeet-js.md.
//
//   const recognizer = await open({ encoder, decoder, vocab }, { bins: 128 });
//   const heard = await recognizer.transcribe(samples);   // a whole phrase at once
//   const stream = recognizer.stream();                    // or live, a piece of sound at a time
//   recognizer.boost(["Nakamura"]);                        // words to prefer, from now on
//   await recognizer.release();

import { booster, createDecoder, stepFor, vocabulary, type Decoder, type Runtime, type Session as DecoderSession } from "./decode";
import { features } from "./features";
import { load, ortFor, type Backend, type LoadOptions } from "./runtime";
import { createStream, heard, type Heard, type Stream, type StreamOptions } from "./stream";

/** What the recognizer's callers are given: words with their times, a live stream and its options and updates. */
export type { Heard, Stream, StreamOptions, Update } from "./stream";
/** Where the model runs. */
export type { Backend } from "./runtime";
export { detect } from "./runtime";

/** What Parakeet's joint network gives after its piece scores: one score for each of these jumps, in encoder frames. */
const DURATIONS = [0, 1, 2, 3, 4];
/** How much the visitor's words are leaned toward, in the joint network's units (boost.ts says how this was chosen). */
export const BOOST = 4;

/** The model's three files: the two networks as bytes (or addresses), and the text of its vocabulary. */
export interface Model {
    encoder: ArrayBuffer | string;
    decoder: ArrayBuffer | string;
    vocab: string;
}

/** How to open a model. */
export interface Options {
    /** Mel bands the encoder listens with: 128 for the 0.6 billion parameter models. */
    bins?: 80 | 128;
    /** Words to lean toward from the first phrase. */
    words?: string[];
    /** Force the processor even when there is a graphics card. */
    prefer?: LoadOptions["prefer"];
    threads?: number;
}

/** A whole phrase's words and text. */
export interface Transcript {
    text: string;
    words: Heard[];
}

/** An open model. */
export interface Recognizer {
    backend: Backend;
    /** Recognizes a whole phrase of 16 kHz sound at once. */
    transcribe(samples: Float32Array): Promise<Transcript>;
    /** Starts recognizing a phrase as it is spoken. */
    stream(options?: StreamOptions): Stream;
    /** Sets the words to lean toward, for what is recognized from now on. */
    boost(words: string[]): void;
    /** Lets go of the model and its memory. */
    release(): Promise<void>;
}

/** Opens a model: loads it onto the card or the processor and gets it ready to recognize. */
export async function open(model: Model, options: Options = {}): Promise<Recognizer> {
    const bins = options.bins ?? 128;
    const loaded = await load({ files: { encoder: model.encoder, decoder: model.decoder }, prefer: options.prefer, threads: options.threads });
    const pieces = vocabulary(model.vocab);
    const ort = (await ortFor(loaded.backend.kind === "webgpu" ? "jsep" : "wasm")) as unknown as Runtime;
    const step = stepFor(loaded.decoder as DecoderSession, ort);
    let decoder: Decoder;
    const lean = (list: string[]) => {
        decoder = createDecoder(step, { vocabulary: pieces, durations: DURATIONS, blank: pieces.blank, boost: list.length > 0 ? booster(list, pieces, BOOST) : undefined });
    };
    lean(options.words ?? []);

    // The step function keeps one set of buffers, so two decodes must not run at once.
    let turn: Promise<unknown> = Promise.resolve();
    const alone = <T>(work: () => Promise<T>): Promise<T> => {
        const next = turn.then(work, work);
        turn = next.catch(() => undefined);
        return next;
    };
    /** A decoder for a stream that takes its turn, and that follows the current word list. */
    const queued: Decoder = {
        start: () => decoder.start(),
        finish: (state) => decoder.finish(state),
        decode: (encoded, frames, width, state) => alone(() => decoder.decode(encoded, frames, width, state)),
    };

    return {
        backend: loaded.backend,
        transcribe: (samples) =>
            alone(async () => {
                const made = features(samples, { bins });
                const encoded = await loaded.encode(made.data, bins, made.frames);
                const done = await decoder.decode(encoded.data, encoded.frames, encoded.width, decoder.start());
                const open = decoder.finish(done.state);
                const found = [...done.words, ...(open ? [open] : [])].map(heard);
                return { text: found.map((word) => word.text).join(" "), words: found };
            }),
        stream: (streamOptions) => createStream({ bins, encode: (data, count, frames) => alone(() => loaded.encode(data, count, frames)), decoder: queued }, streamOptions),
        boost: lean,
        release: () => loaded.release(),
    };
}
