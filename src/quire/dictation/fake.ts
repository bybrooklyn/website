// A made-up engine and microphone for the test page (`/mdquire-dictation/?fake`), so that the
// browser tests can run the whole control without a model and without a microphone. The page is
// given `window.dictationTest`, through which a test makes "sound": a stretch of loud or quiet
// frames, pushed as fast as it likes (the session counts time in samples, not seconds). The made-up
// recognizer says one phrase for each loudness, revealing one more word for each half second that
// was loud.

import type { Provider } from "./engine";
import type { Microphone } from "./capture";
import { megabytes, sizeOf, type Tier } from "./models";
import type { Recognizer } from "./session";

const RATE = 16000;

/** The phrases, by the loudness (in hundredths) a test speaks them at. */
export const PHRASES: Record<string, string> = {
    "20": "hello there my dear friend period",
    "30": "undo that",
    "40": "delete that",
    "50": "stop dictation",
    "60": "second phrase here",
    "70": "my email is here",
    "80": "heading",
    "90": "the plan",
};

/** What a test can do to the page. */
export interface TestControls {
    /** Pushes `ms` of voice at a loudness (0.2 says the first phrase), as fast as possible. */
    speak(ms: number, loudness?: number): Promise<void>;
    /** Pushes `ms` of quiet. */
    quiet(ms: number): Promise<void>;
    /** Whether the made-up microphone is open. */
    microphoneOpen(): boolean;
    /** Tiers whose files are "in the browser". */
    downloaded(): string[];
    /** How long a made-up download takes, in milliseconds. */
    downloadTime: number;
    /** False makes cancelling come too late, so that the made-up download finishes anyway. */
    cancellable: boolean;
    /** How many times the made-up microphone was opened. */
    opened(): number;
    /** How slowly the made-up recognizer works, in milliseconds per call. */
    delay: number;
    /** The document as Markdown. */
    markdown(): string;
    /** How many times the recognizer was asked. */
    asked(): number;
    /** The faint words now shown. */
    provisional(): string;
}

/** Makes the made-up engine and microphone, and the controls to drive them. */
export function createFake(): { provider: Provider; microphone: (onFrame: (frame: Float32Array) => void) => Promise<Microphone>; controls: Omit<TestControls, "markdown" | "provisional"> } {
    const kept = new Set<string>();
    let feed: ((frame: Float32Array) => void) | undefined;
    let cancelled = false;
    let asked = 0;
    let ticks = 0;

    let opened = 0;
    const controls = {
        downloadTime: 400,
        cancellable: true,
        opened: () => opened,
        delay: 40,
        microphoneOpen: () => feed !== undefined,
        downloaded: () => [...kept],
        asked: () => asked,
        async speak(ms: number, loudness = 0.2) {
            for (let at = 0; at < ms; at += 100) {
                const frame = new Float32Array(1600);
                for (let i = 0; i < 1600; i++) frame[i] = loudness * Math.sin((2 * Math.PI * 220 * (ticks * 1600 + i)) / RATE);
                ticks++;
                feed?.(frame);
                await new Promise((done) => setTimeout(done, 12));
            }
            await new Promise((done) => setTimeout(done, controls.delay + 20));
        },
        async quiet(ms: number) {
            for (let at = 0; at < ms; at += 100) {
                const frame = new Float32Array(1600);
                let seed = ticks * 7 + 3;
                for (let i = 0; i < 1600; i++) {
                    seed = (seed * 1664525 + 1013904223) % 4294967296;
                    frame[i] = 0.001 * (seed / 4294967296 - 0.5) * 2;
                }
                ticks++;
                feed?.(frame);
                await new Promise((done) => setTimeout(done, 12));
            }
            await new Promise((done) => setTimeout(done, controls.delay + 20));
        },
    };

    const recognizer: Recognizer = {
        backend: "made-up engine",
        dispose() {},
        async transcribe(samples) {
            asked++;
            await new Promise((done) => setTimeout(done, controls.delay));
            let loud = 0;
            let top = 0;
            for (const value of samples) {
                if (Math.abs(value) > 0.05) loud++;
                top = Math.max(top, Math.abs(value));
            }
            const words = (PHRASES[String(Math.round(top * 100))] ?? "").split(" ").filter(Boolean);
            const shown = Math.min(words.length, Math.floor(loud / (RATE / 2 / 1.4)));
            return { text: words.slice(0, shown).join(" "), ms: controls.delay };
        },
    };

    const provider: Provider = {
        cached: async (tier: Tier) => kept.has(tier.id),
        used: async () => [...kept].length * 50e6,
        async download(tier, progress) {
            cancelled = false;
            const total = sizeOf(tier);
            const steps = 10;
            for (let step = 1; step <= steps; step++) {
                await new Promise((done) => setTimeout(done, controls.downloadTime / steps));
                if (cancelled) throw Object.assign(new Error("cancelled"), { cancelled: true });
                progress((total * step) / steps);
            }
            kept.add(tier.id);
        },
        cancel() {
            if (controls.cancellable) cancelled = true;
        },
        async load() {
            await new Promise((done) => setTimeout(done, 60));
            return { recognizer, ms: 60 };
        },
        async remove(tier) {
            kept.delete(tier.id);
        },
    };

    const microphone = async (onFrame: (frame: Float32Array) => void): Promise<Microphone> => {
        feed = onFrame;
        opened++;
        return {
            close() {
                feed = undefined;
            },
        };
    };

    return { provider, microphone, controls };
}

/** The size the made-up download shows, for a test to compare with the panel. */
export const shown = (tier: Tier): string => megabytes(sizeOf(tier));
