// A voice activity detector of our own, from loudness alone: the level of each stretch of sound
// against a noise floor that follows the room. It tells when speech starts, when a pause is long
// enough to settle a phrase, and when dictation has gone quiet for long enough to switch itself
// off. Time is counted in samples, never read from a clock, so the same sound always gives the same
// answers and the tests can run a minute of "audio" in a moment.
//
//   const voice = createVoice();
//   const heard = voice.feed(frame);        // frame: Float32Array of 16 kHz samples, any length
//   heard.level                             0 to 1, for the meter on the button
//   heard.event                             "start" | "pause" | "silence" | "nothing", or none

/** What the detector reports after each frame. */
export interface Heard {
    /** Loudness for a meter, 0 to 1, quick to rise and slow to fall. */
    level: number;
    /** Speech is going on now (a short hangover keeps it from flickering between words). */
    speaking: boolean;
    /** Speech has been heard at any time since the start. */
    heard: boolean;
    /** Milliseconds since speech last stopped (or since the start, if none yet). */
    quiet: number;
    /** Something that just happened: speech began, a pause after speech was long enough to settle a phrase, quiet went on long enough after speech to stop, or nothing was ever said for too long. */
    event?: "start" | "pause" | "silence" | "nothing";
    /** Decibels relative to full scale of this frame, and the speech threshold in force. */
    decibels: number;
    threshold: number;
}

/** The times that matter, in milliseconds. */
export interface VoiceOptions {
    /** A pause this long after speech settles the phrase said. */
    pause?: number;
    /** Quiet this long after speech switches dictation off ("a couple of seconds"). */
    silence?: number;
    /** Nothing said at all for this long switches it off. */
    wait?: number;
    /** Speech stays "on" this long after the sound drops, so a gap between words is not a pause. */
    hangover?: number;
}

/** The detector. */
export interface Voice {
    feed(frame: Float32Array): Heard;
    /** Starts again from nothing heard. */
    reset(): void;
}

const RATE = 16000;
/** Louder than the floor by this much is speech, but never quieter than the absolute minimum. */
const ABOVE_FLOOR = 10;
const MINIMUM = -52;

const decibels = (frame: Float32Array): number => {
    let sum = 0;
    for (let at = 0; at < frame.length; at++) sum += frame[at]! * frame[at]!;
    return 20 * Math.log10(Math.max(Math.sqrt(sum / Math.max(1, frame.length)), 1e-5));
};

/** Makes a detector. */
export function createVoice(options: VoiceOptions = {}): Voice {
    const { pause = 700, silence = 2500, wait = 8000, hangover = 300 } = options;
    let elapsed = 0;
    let lastSpeech = 0;
    let speaking = false;
    let heard = false;
    let settled = true;
    let stopped = false;
    let floor = -60;
    let level = 0;

    return {
        reset() {
            elapsed = lastSpeech = level = 0;
            speaking = heard = stopped = false;
            settled = true;
            floor = -60;
        },
        feed(frame) {
            const length = (frame.length / RATE) * 1000;
            elapsed += length;
            const db = decibels(frame);
            const threshold = Math.max(floor + ABOVE_FLOOR, MINIMUM);
            const loud = db > threshold;
            // the floor drops to a quiet frame at once and creeps up to a steady sound, but only very slowly while someone is talking
            if (db < floor) floor = floor * 0.5 + db * 0.5;
            else floor += (db - floor) * Math.min(1, length / (loud ? 20000 : 4000));
            floor = Math.min(floor, -35);
            let event: Heard["event"];
            if (loud) {
                if (!speaking && !heard) event = "start";
                else if (!speaking && settled) event = "start";
                lastSpeech = elapsed;
                speaking = true;
                heard = true;
                settled = false;
            } else if (speaking && elapsed - lastSpeech > hangover) speaking = false;
            const quiet = elapsed - lastSpeech;
            if (!loud && heard && !settled && quiet >= pause) {
                settled = true;
                event = "pause";
            }
            if (!stopped && !loud) {
                if (heard && quiet >= silence) {
                    stopped = true;
                    event = "silence";
                } else if (!heard && elapsed >= wait) {
                    stopped = true;
                    event = "nothing";
                }
            }
            const target = Math.min(1, Math.max(0, (db - (floor + 3)) / 35));
            level = target > level ? target : level * 0.8 + target * 0.2;
            return { level, speaking, heard, quiet: heard ? quiet : elapsed, event, decibels: db, threshold };
        },
    };
}
