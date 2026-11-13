// Turning the sound a device gives (any rate, any number of channels) into 16 kHz mono frames. The
// channels are averaged, and the sound is filtered before it is thinned out: everything above
// 8 kHz, half the new rate, would otherwise fold back into the speech band (a hiss at 10 kHz heard
// at 6 kHz, the "s" and "f" of speech smeared). The filter is a windowed sinc, about a millisecond
// either side of each sample, its weights worked out once for 64 places between two input samples.
// Kept out of the worklet so that it is tested.

/** Frames are a tenth of a second at 16 kHz. */
export const FRAME = 1600;
const TARGET = 16000;
/** Where the filter starts to cut, a little under half the new rate, in hertz. */
const CUTOFF = 7200;
/** How far the filter reaches either side of a sample, in samples of the new rate. */
const REACH = 16;
/** Places between two input samples that the filter's weights are worked out for. */
const PHASES = 64;

/** Takes blocks of sound and gives back whole frames of 16 kHz mono as they fill. */
export interface Downsampler {
    push(channels: Float32Array[]): Float32Array[];
}

/** The weights of the filter: a row for each place between two input samples, each row summing to one, so a steady level stays as it is. */
function weights(rate: number, half: number): Float32Array[] {
    const cut = Math.min(CUTOFF, 0.45 * rate) / rate;
    const rows: Float32Array[] = [];
    for (let phase = 0; phase < PHASES; phase++) {
        const row = new Float32Array(2 * half);
        let sum = 0;
        for (let tap = 0; tap < row.length; tap++) {
            // how far this input sample is from the moment the output sample stands for
            const x = tap - half + 1 - phase / PHASES;
            const sinc = x === 0 ? 2 * cut : Math.sin(2 * Math.PI * cut * x) / (Math.PI * x);
            const at = (x + half) / (2 * half);
            const window = at <= 0 || at >= 1 ? 0 : 0.42 - 0.5 * Math.cos(2 * Math.PI * at) + 0.08 * Math.cos(4 * Math.PI * at);
            row[tap] = sinc * window;
            sum += row[tap]!;
        }
        for (let tap = 0; tap < row.length; tap++) row[tap]! /= sum;
        rows.push(row);
    }
    return rows;
}

/** Makes a downsampler for a device rate. */
export function createDownsampler(rate: number): Downsampler {
    const step = rate / TARGET;
    const half = Math.ceil(REACH * Math.max(1, step));
    const rows = step === 1 ? [] : weights(rate, half);
    /** The mono input not yet passed, and the place of its first sample in all the input. */
    let kept = new Float32Array(4 * half + 8192);
    let count = 0;
    let base = 0;
    /** The moment of the next output sample, in input samples; it trails the input by `half`, so each output is made as soon as the last sample it needs is in. */
    let next = step - 1 - half;
    let started = false;
    let frame = new Float32Array(FRAME);
    let at = 0;
    const emit = (value: number, done: Float32Array[]) => {
        frame[at++] = value;
        if (at === FRAME) {
            done.push(frame);
            frame = new Float32Array(FRAME);
            at = 0;
        }
    };
    const keep = (value: number) => {
        if (count === kept.length) {
            const bigger = new Float32Array(kept.length * 2);
            bigger.set(kept);
            kept = bigger;
        }
        kept[count++] = value;
    };
    return {
        push(channels) {
            const done: Float32Array[] = [];
            const first = channels[0];
            if (!first) return done;
            for (let i = 0; i < first.length; i++) {
                let value = 0;
                for (const channel of channels) value += channel[i]!;
                value /= channels.length;
                if (step === 1) {
                    emit(value, done);
                    continue;
                }
                if (!started) {
                    // before the first sample the sound is taken to have been as it starts, so the first outputs do not rise from silence
                    started = true;
                    base = -2 * half;
                    for (let fill = 0; fill < 2 * half; fill++) keep(value);
                }
                keep(value);
            }
            if (step === 1) return done;
            // every output whose reach the input now covers
            while (Math.floor(next) + half < base + count) {
                let whole = Math.floor(next);
                let phase = Math.round((next - whole) * PHASES);
                if (phase === PHASES) {
                    whole++;
                    phase = 0;
                }
                const row = rows[phase]!;
                const from = whole - half + 1 - base;
                let sum = 0;
                for (let tap = 0; tap < row.length; tap++) sum += kept[from + tap]! * row[tap]!;
                emit(sum, done);
                next += step;
            }
            // what no output will reach again is let go
            const drop = Math.max(0, Math.floor(next) - half + 1 - base);
            if (drop > 0) {
                kept.copyWithin(0, drop, count);
                count -= drop;
                base += drop;
            }
            return done;
        },
    };
}
