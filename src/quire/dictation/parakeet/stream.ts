// Live words from an encoder that is not a streaming one. The Parakeet encoder looks at a whole
// stretch of sound at once, so there is no state to carry from one piece of sound to the next. What
// can be carried is the decoder's. This keeps, for the phrase being spoken:
//
//   settled   the sound before the settled point has been decoded for good, and the decoder's
//             state stands at that point, so the sound is never encoded as new again
//   window    each step encodes only from `left` seconds before the settled point to the newest
//             sound, with the features of the window normalized over the window alone
//   tentative everything after the settled point except the last `right` seconds is decoded with
//             the real state and becomes settled; the rest is decoded on a copy of the state and
//             shown as provisional, and decoded again by the next step
//
// The left context is there so that the sound just after the settled point is encoded with
// something before it, and the right context so that the sound just before the window's end is
// not judged with nothing after it. A step costs the encoder time of `left + right + new sound`
// seconds, so how often a step can run depends on how fast the machine is: a step starts when at
// least `chunk` seconds of new sound have arrived and no step is running, so on a slow machine the
// steps cover more sound each (the same work, fewer repeats) and the words come later, instead of
// the queue growing. `behind` says how late that is.
//
// Features are computed once, as the sound arrives (features.ts), and kept as raw columns until
// they fall behind the window. The sizes of left, right and chunk were chosen from measured word
// error, in the table in RUNTIME.md.

import type { Decoder, DecodeState, Word as Spoken } from "./decode";
import { copy } from "./decode";
import { createFeatures, normalize } from "./features";

/** The sound's rate and the encoder's: one encoder frame is 8 feature frames of 10 ms. */
const RATE = 16000;
const FRAME_SECONDS = 0.08;
const SUBSAMPLING = 8;
/** Encoder frames of silence put before a window that begins mid-speech (0.24 s), and the log-mel value of silence (features.ts takes the log of 2^-24). */
const LEAD = 3;
const SILENCE = Math.log(2 ** -24);

/** A word as dictation uses it: its text, seconds from the start of the phrase, and how sure the model was. */
export interface Heard {
    text: string;
    start: number;
    end: number;
    confidence: number;
}

/** A spoken word from the decoder, with its frames turned into seconds. */
export function heard(word: Spoken): Heard {
    return { text: word.text, start: word.from * FRAME_SECONDS, end: word.to * FRAME_SECONDS, confidence: word.confidence };
}

/** How a stream steps, in seconds. */
export interface StreamOptions {
    /** Least new sound before a step starts. */
    chunk?: number;
    /** Sound before the settled point that is encoded again as context. */
    left?: number;
    /** Sound at the end that is shown but not settled. */
    right?: number;
}

/** What each step tells the page. */
export interface Update {
    /** Every word settled so far in the phrase. */
    words: Heard[];
    /** The words after them as they stand now. They may change at the next step. */
    tentative: Heard[];
    /** Milliseconds this step took. */
    ms: number;
    /** Seconds of sound the step took in that were not in an earlier one. */
    seconds: number;
}

/** A phrase being recognized as it is spoken. */
export interface Stream {
    /** Gives sound. When enough has arrived and no step is running, runs a step and gives its update; otherwise gives nothing. */
    push(samples: Float32Array): Promise<Update | undefined>;
    /** Ends the phrase: everything is decoded with all the context there is, and every word is returned. */
    finish(): Promise<Heard[]>;
    /** Seconds of sound that have arrived and are not in the last update. */
    behind(): number;
}

/** What a stream needs: the encoder (features in, frames of the encoder's width out), and a decoder to make state with. */
export interface StreamParts {
    bins: number;
    encode(features: Float32Array, bins: number, frames: number): Promise<{ data: Float32Array; frames: number; width: number }>;
    decoder: Decoder;
}

/** The sizes used when none are given: measured on the two large models (RUNTIME.md). */
export const STREAM_DEFAULTS = { chunk: 1, left: 2, right: 1.5 } as const;

/** Opens a stream. */
export function createStream(parts: StreamParts, options: StreamOptions = {}): Stream {
    const { bins, encode, decoder } = parts;
    const chunk = Math.round((options.chunk ?? STREAM_DEFAULTS.chunk) * RATE);
    const left = Math.round(((options.left ?? STREAM_DEFAULTS.left) / FRAME_SECONDS));
    const right = Math.round(((options.right ?? STREAM_DEFAULTS.right) / FRAME_SECONDS));

    const features = createFeatures({ bins: bins as 80 | 128 });
    /** The raw feature frames, one array of `bins` numbers each; `base` is the number of the first. */
    let columns: Float32Array[] = [];
    let base = 0;
    /** Sound given, in samples, and sound in the last step's window. */
    let given = 0;
    let covered = 0;
    let state: DecodeState = decoder.start();
    /** The encoder frame the settled sound ends at. */
    let settledAt = 0;
    const words: Heard[] = [];
    let running: Promise<unknown> = Promise.resolve();
    let busy = false;

    const take = (made: { data: Float32Array; bins: number; frames: number }) => {
        for (let t = 0; t < made.frames; t++) {
            const column = new Float32Array(bins);
            for (let m = 0; m < bins; m++) column[m] = made.data[m * made.frames + t]!;
            columns.push(column);
        }
    };

    /**
     * Encodes from the left context to the newest frame. A window that begins in the middle of speech
     * is given a short lead of silence first: the encoder, shown speech that starts at once, can answer
     * with nothing at all for a window of several seconds (measured, see RUNTIME.md). Gives the
     * encoder's frames and the number of the first one, counting the lead, so that it may be negative.
     */
    async function window(): Promise<{ data: Float32Array; frames: number; width: number; first: number } | undefined> {
        const first = Math.max(0, settledAt - left);
        const from = first * SUBSAMPLING;
        const total = base + columns.length;
        const lead = first > 0 ? LEAD * SUBSAMPLING : 0;
        const count = total - from + lead;
        if (total - from < 2) return undefined;
        const data = new Float32Array(bins * count).fill(SILENCE);
        for (let t = lead; t < count; t++) {
            const column = columns[from - base + t - lead]!;
            for (let m = 0; m < bins; m++) data[m * count + t] = column[m]!;
        }
        const out = await encode(normalize({ data, bins, frames: count }).data, bins, count);
        return { ...out, first: first - lead / SUBSAMPLING };
    }

    /** Runs the frames from the settled point up to `until` (an encoder frame) with the real state, and the rest on a copy. */
    async function decode(made: { data: Float32Array; frames: number; width: number; first: number }, settle: boolean) {
        const end = made.first + made.frames;
        const until = settle ? end : Math.max(settledAt, end - right);
        const at = (frame: number) => made.data.subarray((frame - made.first) * made.width);
        if (until > settledAt) {
            state.frame = settledAt;
            const done = await decoder.decode(at(settledAt), until - settledAt, made.width, state);
            for (const word of done.words) words.push(heard(word));
            settledAt = until;
        }
        const tentative: Heard[] = [];
        if (!settle && end > settledAt) {
            const trial = copy(state);
            trial.frame = settledAt;
            const done = await decoder.decode(at(settledAt), end - settledAt, made.width, trial);
            for (const word of done.words) tentative.push(heard(word));
            const open = decoder.finish(trial);
            if (open) tentative.push(heard(open));
        }
        return tentative;
    }

    /** Drops the columns that no later window will use. */
    const trim = () => {
        const keep = Math.max(0, settledAt - left) * SUBSAMPLING;
        if (keep > base) {
            columns = columns.slice(keep - base);
            base = keep;
        }
    };

    async function step(): Promise<Update | undefined> {
        // Sound that arrived while the last step ran is waiting in the queue; letting it in first makes
        // this step cover all of it, rather than the first chunk of it and leaving the rest to fall behind.
        await new Promise((done) => setTimeout(done, 0));
        const started = performance.now();
        const total = given;
        const made = await window();
        if (!made) return undefined;
        const tentative = await decode(made, false);
        trim();
        const seconds = (total - covered) / RATE;
        covered = total;
        const ms = performance.now() - started;
        return { words: [...words], tentative, ms, seconds };
    }

    return {
        async push(samples) {
            given += samples.length;
            take(features.push(samples));
            if (busy || given - covered < chunk) return undefined;
            busy = true;
            const job = step();
            running = job.catch(() => undefined);
            try {
                return await job;
            } finally {
                busy = false;
            }
        },
        async finish() {
            await running;
            take(features.flush());
            const made = await window();
            if (made) {
                await decode(made, true);
                const open = decoder.finish(state);
                if (open) words.push(heard(open));
            }
            const all = [...words];
            // ready for another phrase
            columns = [];
            base = 0;
            given = covered = settledAt = 0;
            words.length = 0;
            state = decoder.start();
            return all;
        },
        behind: () => (given - covered) / RATE,
    };
}
