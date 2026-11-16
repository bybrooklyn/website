// A change of sample rate for a sound that comes a piece at a time, as the sound of a film does from the
// browser's decoder, so that a film's sound can be written as Opus, which is always 48 kHz. Each output
// sample is the input around its place weighed by the curve of an ideal low pass filter, cut short by a
// Blackman window at 32 input samples either side, its cut-off below the lower of the two rates' halves so
// that nothing folds back. The last samples of each piece are kept for the next, so that pieces join with
// no seam: a sound given in pieces comes out the same as given whole.
//
//   `change = createResampler(44100, 48000, 2);`
//   `out = change.push([left, right]); last = change.end();`

/** How many input samples either side weigh on each output sample. */
const SIDE = 32;

/** A resampler for so many channels, from one rate to another. */
export function createResampler(from: number, to: number, channels: number) {
    const ratio = from / to;
    // the cut-off as a share of the input's half rate: a little under the lower of the two halves
    const cutoff = Math.min(1, to / from) * 0.94;
    let held: Float32Array[] = Array.from({ length: channels }, () => new Float32Array(SIDE));
    // where the next output sample falls, in input samples, counted from the start of what is held
    let position = SIDE;
    let produced = 0;
    let consumed = 0;
    const weight = (distance: number) => {
        if (Math.abs(distance) >= SIDE) return 0;
        const x = distance * cutoff;
        const sinc = x === 0 ? 1 : Math.sin(Math.PI * x) / (Math.PI * x);
        const t = (distance + SIDE) / (2 * SIDE);
        const window = 0.42 - 0.5 * Math.cos(2 * Math.PI * t) + 0.08 * Math.cos(4 * Math.PI * t);
        return sinc * window * cutoff;
    };
    const run = (input: Float32Array[], last: boolean): Float32Array[] => {
        const length = input[0]?.length ?? 0;
        consumed += length;
        const joined = held.map((before, channel) => {
            const both = new Float32Array(before.length + length + (last ? SIDE : 0));
            both.set(before);
            both.set(input[channel] ?? new Float32Array(length), before.length);
            return both;
        });
        const available = joined[0]!.length;
        // as many output samples as have their whole window inside what is here (or, at the end, as the input's length calls for)
        const wanted = last ? Math.round((consumed * to) / from) - produced : Math.max(0, Math.floor((available - SIDE - position) / ratio));
        const out = Array.from({ length: channels }, () => new Float32Array(Math.max(0, wanted)));
        for (let index = 0; index < wanted; index++) {
            const at = position + index * ratio;
            const near = Math.floor(at);
            for (let channel = 0; channel < channels; channel++) {
                const data = joined[channel]!;
                let sum = 0;
                for (let tap = near - SIDE + 1; tap <= near + SIDE; tap++) {
                    if (tap < 0 || tap >= available) continue;
                    sum += data[tap]! * weight(at - tap);
                }
                out[channel]![index] = sum;
            }
        }
        produced += Math.max(0, wanted);
        position += Math.max(0, wanted) * ratio;
        // keep the last stretch for the next piece, and count the place from it
        const keepFrom = Math.max(0, Math.floor(position) - SIDE);
        held = joined.map((data) => data.slice(keepFrom, last ? keepFrom : available));
        position -= keepFrom;
        return out;
    };
    return {
        /** Takes a piece of each channel and gives what can be made of it so far. */
        push: (input: Float32Array[]) => run(input, false),
        /** Gives what is left, so that the output is as long as the input calls for at the new rate. */
        end: () => run(Array.from({ length: channels }, () => new Float32Array()), true),
    };
}
