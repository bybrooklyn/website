// Turns 16 kHz sound into what the Parakeet encoder eats: a log-mel spectrogram, the same one NeMo
// makes in training, as a Float32Array of shape [bins, frames] (all of one bin's frames together,
// the layout of the encoder's `audio_signal` input without its batch dimension).
//
// The recipe, which is NeMo's AudioToMelSpectrogramPreprocessor as the nemo128.onnx of
// istupakov/parakeet-tdt-0.6b-v2-onnx runs it, and as parakeet.js's mel.js re-expresses it (MIT
// licence, copyright (c) 2025 Yunus Seyhan Dede, kept in LICENSE-parakeet-js.md beside this file):
//   1. pre-emphasis, y[n] = x[n] - 0.97 x[n-1], with y[0] = x[0]
//   2. 256 samples added on each side by reflection (the sound mirrored about its first and last
//      sample, not zeros: torch.stft's default, which the model uses, and the one place where
//      parakeet.js's mel.js differs from it, and so from the model), so frame t is centred on sample t * 160
//   3. a 25 ms (400 sample) symmetric Hann window, set in the middle of a 512 sample frame
//   4. a 512 point FFT every 10 ms (160 samples), then power, re squared plus im squared
//   5. a bank of triangular filters on the Slaney mel scale, each scaled to the Slaney area (2 over its width)
//   6. log(mel + 2^-24), the guard value NeMo uses to keep silence finite
//   7. per bin, subtract the mean over the utterance and divide by (standard deviation + 1e-5),
//      the deviation taken with N - 1 in the denominator
// The count of frames is floor(samples / 160) + 1, which is what the model reports as
// features_lens and what NeMo does (parakeet.js's mel.js drops that last frame, and so takes its
// means over one frame fewer; the difference is far below what the encoder notices). Parakeet TDT 0.6b (v2 and v3) takes 128 bins; the 110m model (nvidia/parakeet-tdt_ctc-110m)
// takes 80, and nothing else differs.
//
// Streaming. `createFeatures` gives the same frames as `features` for steps 1 to 6, a chunk at a
// time. It does not do step 7, since the mean and deviation of an utterance are not known until it
// ends. What parakeet.js does while streaming is to take a window of recent sound (a few seconds
// with overlap), compute its frames, and normalize over that window alone, again for every window;
// the encoder is evidently content with statistics of a few seconds. So the caller keeps the raw
// frames of its window and calls `normalize` on them. A running mean was not chosen: early frames
// would be scaled by guesses that later frames do not share, and the encoder was trained on
// whole-utterance statistics, which a window is closer to.

import { createRealFft } from "./fft";

/** What to compute: the sound's rate (only 16000 is built) and the number of mel bins (128, or 80 for the 110m model). */
export interface FeatureOptions {
    sampleRate: 16000;
    bins: 80 | 128;
}

/** Log-mel frames, [bins, frames] laid out with each bin's frames together. */
export interface Features {
    data: Float32Array;
    bins: number;
    frames: number;
}

const FFT_SIZE = 512;
const WINDOW = 400;
const HOP = 160;
const PREEMPHASIS = 0.97;
const GUARD = 2 ** -24;
const SPECTRUM = FFT_SIZE / 2 + 1;
const EDGE = FFT_SIZE / 2;

// The Slaney mel scale: linear below 1000 Hz, logarithmic above.
const LINEAR_STEP = 200 / 3;
const LOG_START = 1000;
const LOG_START_MEL = LOG_START / LINEAR_STEP;
const LOG_STEP = Math.log(6.4) / 27;
const hzToMel = (hz: number) => (hz >= LOG_START ? LOG_START_MEL + Math.log(hz / LOG_START) / LOG_STEP : hz / LINEAR_STEP);
const melToHz = (mel: number) => (mel >= LOG_START_MEL ? LOG_START * Math.exp(LOG_STEP * (mel - LOG_START_MEL)) : mel * LINEAR_STEP);

/** The filters of one size: weights [bins, SPECTRUM] and, for each filter, the first and one past the last spectrum bin that is not zero. */
interface Bank {
    weights: Float32Array;
    from: Uint16Array;
    to: Uint16Array;
}
const banks = new Map<number, Bank>();

/** Builds the Slaney-scale, Slaney-normalized filters the way torchaudio and librosa do. Made once per size. */
function bank(bins: number): Bank {
    const known = banks.get(bins);
    if (known) return known;
    const edges = new Float64Array(bins + 2);
    const top = hzToMel(8000);
    for (let i = 0; i < edges.length; i++) edges[i] = melToHz((top * i) / (bins + 1));
    const weights = new Float32Array(bins * SPECTRUM);
    const from = new Uint16Array(bins);
    const to = new Uint16Array(bins);
    for (let m = 0; m < bins; m++) {
        const scale = 2 / (edges[m + 2]! - edges[m]!);
        from[m] = SPECTRUM;
        for (let k = 0; k < SPECTRUM; k++) {
            const hz = (8000 * k) / (SPECTRUM - 1);
            const rising = (hz - edges[m]!) / (edges[m + 1]! - edges[m]!);
            const falling = (edges[m + 2]! - hz) / (edges[m + 2]! - edges[m + 1]!);
            const weight = Math.max(0, Math.min(rising, falling)) * scale;
            weights[m * SPECTRUM + k] = weight;
            if (weight > 0) {
                if (k < from[m]!) from[m] = k;
                to[m] = k + 1;
            }
        }
    }
    const made = { weights, from, to };
    banks.set(bins, made);
    return made;
}

/** The Hann window, symmetric over 400 samples, set in the middle of 512 with zeros either side. */
const hann = (() => {
    const window = new Float64Array(FFT_SIZE);
    const left = (FFT_SIZE - WINDOW) / 2;
    for (let n = 0; n < WINDOW; n++) window[left + n] = 0.5 * (1 - Math.cos((2 * Math.PI * n) / (WINDOW - 1)));
    return window;
})();

/** Checks the options and fills in the defaults. */
function resolve(options?: Partial<FeatureOptions>) {
    const bins = options?.bins ?? 128;
    if ((options?.sampleRate ?? 16000) !== 16000) throw new Error("Features are built for 16000 Hz sound only");
    if (bins !== 80 && bins !== 128) throw new Error("Features come in 80 or 128 bins");
    return bins;
}

/**
 * The working part, shared by both forms: holds the pre-emphasized sound not yet used, and writes
 * one frame at a time with nothing allocated per frame.
 */
function engine(bins: number) {
    const fft = createRealFft(FFT_SIZE);
    const filters = bank(bins);
    const frame = new Float64Array(FFT_SIZE);
    const re = new Float64Array(SPECTRUM);
    const im = new Float64Array(SPECTRUM);
    const power = new Float32Array(SPECTRUM);
    // `held` is the sound in padded coordinates (sample i is at i + 256), from `base` on.
    let held = new Float64Array(8192);
    let base = 0;
    let end = EDGE;
    let next = 0;
    let seen = 0;
    let before = 0;
    // Until 257 samples are in, the left edge cannot be mirrored, so no frame can be made.
    let primed = false;

    /** The sample a mirrored position stands for, for a sound `count` samples long. */
    function mirror(position: number, count: number) {
        if (count === 1) return 0;
        const period = 2 * (count - 1);
        const folded = ((position % period) + period) % period;
        return folded < count ? folded : period - folded;
    }
    /** Fills the 256 values left of the first sample by mirroring; base is 0 then, since no frame has been made. */
    function mirrorLeft() {
        for (let j = 1; j <= EDGE; j++) held[EDGE - j] = held[EDGE + mirror(-j, seen)]!;
        primed = true;
    }
    /** Starts the sound again. */
    function reset() {
        primed = false;
        base = 0;
        end = EDGE;
        next = 0;
        seen = 0;
        before = 0;
    }
    /** Makes room for `extra` more values after `end`, sliding or growing as needed. */
    function room(extra: number) {
        if (end - base + extra > held.length) {
            const bigger = new Float64Array(Math.max(held.length * 2, end - base + extra));
            bigger.set(held.subarray(0, end - base));
            held = bigger;
        }
    }
    /** The number of frames whose 512 values are all held now. */
    const ready = () => (primed ? Math.max(0, Math.floor((end - FFT_SIZE - next * HOP) / HOP) + 1) : 0);
    /** Drops what no later frame needs. */
    function slide() {
        const drop = next * HOP - base;
        if (drop > 0) {
            held.copyWithin(0, drop, end - base);
            base += drop;
        }
    }
    /** Computes frame `next` into out[m * stride + at] for every bin, and moves on. */
    function write(out: Float32Array, stride: number, at: number) {
        const start = next * HOP - base;
        for (let i = 0; i < FFT_SIZE; i++) frame[i] = held[start + i]! * hann[i]!;
        fft.transform(frame, re, im);
        for (let k = 0; k < SPECTRUM; k++) power[k] = re[k]! * re[k]! + im[k]! * im[k]!;
        for (let m = 0; m < bins; m++) {
            let sum = 0;
            const row = m * SPECTRUM;
            for (let k = filters.from[m]!; k < filters.to[m]!; k++) sum += power[k]! * filters.weights[row + k]!;
            out[m * stride + at] = Math.log(Math.fround(sum) + GUARD);
        }
        next++;
    }
    return {
        reset,
        ready,
        slide,
        write,
        /** Pre-emphasizes the samples onto the end of what is held. */
        add(samples: Float32Array) {
            room(samples.length);
            for (let i = 0; i < samples.length; i++) {
                const x = samples[i]!;
                held[end - base + i] = Math.fround(seen + i === 0 ? x : x - PREEMPHASIS * before);
                before = x;
            }
            end += samples.length;
            seen += samples.length;
            if (!primed && seen > EDGE) mirrorLeft();
        },
        /** Adds the mirrored right edge, which the sound's own end lets the last frames use. */
        close() {
            room(EDGE);
            if (seen === 0) return;
            if (!primed) mirrorLeft();
            // Sample s is at padded position s + 256, and position - base in `held`.
            for (let j = 1; j <= EDGE; j++) held[end - base - 1 + j] = held[EDGE + mirror(seen - 1 + j, seen) - base]!;
            end += EDGE;
        },
        /** How many frames the whole sound has: one for every 160 samples, and one more for the first. */
        total: () => (seen === 0 ? 0 : Math.floor(seen / HOP) + 1),
        next: () => next,
    };
}

/** Subtracts each bin's mean and divides by its standard deviation plus 1e-5, over the frames given, in place. */
export function normalize(features: Features): Features {
    const { data, bins, frames } = features;
    for (let m = 0; m < bins; m++) {
        const row = data.subarray(m * frames, (m + 1) * frames);
        let sum = 0;
        for (let t = 0; t < frames; t++) sum += row[t]!;
        const mean = sum / frames;
        let spread = 0;
        for (let t = 0; t < frames; t++) spread += (row[t]! - mean) ** 2;
        const scale = frames > 1 ? 1 / (Math.sqrt(spread / (frames - 1)) + 1e-5) : 0;
        for (let t = 0; t < frames; t++) row[t] = (row[t]! - mean) * scale;
    }
    return features;
}

/** The normalized log-mel features of a whole utterance: 16 kHz mono samples in, [bins, frames] out. */
export function features(samples: Float32Array, options?: Partial<FeatureOptions>): Features {
    const bins = resolve(options);
    const work = engine(bins);
    work.add(samples);
    work.close();
    const frames = work.total();
    const data = new Float32Array(bins * frames);
    for (let t = 0; t < frames; t++) work.write(data, frames, t);
    return normalize({ data, bins, frames });
}

/**
 * Features a chunk at a time. `push` gives the frames that the chunk completed and `flush` the
 * ones the end of the sound completes; both are raw log-mel, not normalized (see the top of this
 * file), in the same [bins, frames] layout, and together they hold exactly the frames of `features`
 * before its normalization. `flush` ends the utterance and starts a fresh one; `reset` abandons it.
 */
export function createFeatures(options?: Partial<FeatureOptions>): { push(samples: Float32Array): Features; flush(): Features; reset(): void } {
    const bins = resolve(options);
    const work = engine(bins);
    /** Writes `count` frames out and slides the held sound along. */
    function take(count: number): Features {
        const data = new Float32Array(bins * count);
        for (let t = 0; t < count; t++) work.write(data, count, t);
        work.slide();
        return { data, bins, frames: count };
    }
    return {
        push(samples) {
            work.add(samples);
            return take(work.ready());
        },
        flush() {
            work.close();
            const count = Math.max(0, Math.min(work.ready(), work.total() - work.next()));
            const out = take(count);
            work.reset();
            return out;
        },
        reset: work.reset,
    };
}
