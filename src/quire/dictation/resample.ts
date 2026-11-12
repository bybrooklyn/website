// Turning the sound a device gives (any rate, any number of channels) into 16 kHz mono frames, by
// averaging. Kept out of the worklet so that it is tested.

/** Frames are a tenth of a second at 16 kHz. */
export const FRAME = 1600;
const TARGET = 16000;

/** Takes blocks of sound and gives back whole frames of 16 kHz mono as they fill. */
export interface Downsampler {
    push(channels: Float32Array[]): Float32Array[];
}

/** Makes a downsampler for a device rate. */
export function createDownsampler(rate: number): Downsampler {
    const step = rate / TARGET;
    let phase = 0;
    let sum = 0;
    let count = 0;
    let frame = new Float32Array(FRAME);
    let at = 0;
    return {
        push(channels) {
            const done: Float32Array[] = [];
            const first = channels[0];
            if (!first) return done;
            for (let i = 0; i < first.length; i++) {
                let value = 0;
                for (const channel of channels) value += channel[i]!;
                sum += value / channels.length;
                count++;
                phase += 1;
                if (phase >= step) {
                    phase -= step;
                    frame[at++] = sum / count;
                    sum = 0;
                    count = 0;
                    if (at === FRAME) {
                        done.push(frame);
                        frame = new Float32Array(FRAME);
                        at = 0;
                    }
                }
            }
            return done;
        },
    };
}
