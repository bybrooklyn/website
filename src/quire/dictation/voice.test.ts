// The voice detector on made-up sound: a quiet room, a voice (a tone with the loudness of speech),
// a pause, and a long silence. Time is counted in samples, so a minute of sound is made in a moment.

import { describe, expect, test } from "bun:test";
import { createVoice, type Heard } from "./voice";

const RATE = 16000;
const FRAME = 1600;

/** `ms` of sound, in frames of a tenth of a second: a 220 Hz tone of the given amplitude, or a quiet hiss. */
function sound(ms: number, amplitude: number, kind: "tone" | "hiss" = "tone"): Float32Array[] {
    const frames: Float32Array[] = [];
    let seed = 7;
    for (let at = 0; at < ms; at += 100) {
        const frame = new Float32Array(FRAME);
        for (let i = 0; i < FRAME; i++) {
            seed = (seed * 1664525 + 1013904223) % 4294967296;
            const noise = (seed / 4294967296 - 0.5) * 2;
            frame[i] = kind === "tone" ? amplitude * Math.sin((2 * Math.PI * 220 * (at / 1000 * RATE + i)) / RATE) : amplitude * noise;
        }
        frames.push(frame);
    }
    return frames;
}

/** Feeds frames and gathers what happened. */
function run(frames: Float32Array[], voice = createVoice()): { events: string[]; last: Heard; at: Map<string, number> } {
    const events: string[] = [];
    const at = new Map<string, number>();
    let last!: Heard;
    frames.forEach((frame, index) => {
        last = voice.feed(frame);
        if (last.event) {
            events.push(last.event);
            at.set(last.event, (index + 1) * 100);
        }
    });
    return { events, last, at };
}

describe("a quiet room", () => {
    test("is never speech", () => {
        const { last, events } = run(sound(3000, 0.002, "hiss"));
        expect(last.speaking).toBe(false);
        expect(last.heard).toBe(false);
        expect(events).toEqual([]);
    });
    test("a level meter stays near zero", () => {
        expect(run(sound(2000, 0.002, "hiss")).last.level).toBeLessThan(0.15);
    });
});

describe("a voice", () => {
    test("starts speech, and the meter rises", () => {
        const { events, last } = run([...sound(500, 0.001, "hiss"), ...sound(800, 0.2)]);
        expect(events).toEqual(["start"]);
        expect(last.speaking).toBe(true);
        expect(last.level).toBeGreaterThan(0.5);
    });
    test("a louder voice moves the meter more than a softer one", () => {
        const soft = run([...sound(500, 0.001, "hiss"), ...sound(500, 0.02)]).last.level;
        const loud = run([...sound(500, 0.001, "hiss"), ...sound(500, 0.3)]).last.level;
        expect(loud).toBeGreaterThan(soft);
    });
    test("a quiet voice in a quiet room is still heard", () => {
        expect(run([...sound(1000, 0.0005, "hiss"), ...sound(600, 0.02)]).events).toContain("start");
    });
    test("a steady loud hum becomes the floor and is not speech after a while", () => {
        const { last } = run(sound(60000, 0.03, "hiss"));
        expect(last.speaking).toBe(false);
    });
});

describe("a pause", () => {
    test("is reported once after speech, 700 ms in", () => {
        const { events, at } = run([...sound(300, 0.001, "hiss"), ...sound(1000, 0.2), ...sound(1500, 0.001, "hiss")]);
        expect(events).toEqual(["start", "pause"]);
        expect(at.get("pause")! - at.get("start")!).toBeGreaterThanOrEqual(1000);
    });
    test("a gap between words shorter than the pause is not one", () => {
        const { events } = run([...sound(300, 0.001, "hiss"), ...sound(600, 0.2), ...sound(400, 0.001, "hiss"), ...sound(600, 0.2)]);
        expect(events).toEqual(["start"]);
    });
    test("each phrase after a pause is a new start", () => {
        const { events } = run([...sound(300, 0.001, "hiss"), ...sound(600, 0.2), ...sound(1000, 0.001, "hiss"), ...sound(600, 0.2), ...sound(1000, 0.001, "hiss")]);
        expect(events).toEqual(["start", "pause", "start", "pause"]);
    });
});

describe("switching itself off", () => {
    test("2.5 seconds of quiet after speech says silence, once", () => {
        const { events, at } = run([...sound(300, 0.001, "hiss"), ...sound(1000, 0.2), ...sound(4000, 0.001, "hiss")]);
        expect(events).toEqual(["start", "pause", "silence"]);
        const quiet = at.get("silence")! - 1300;
        expect(quiet).toBeGreaterThanOrEqual(2500);
        expect(quiet).toBeLessThanOrEqual(2700);
    });
    test("8 seconds with nothing said says nothing, once", () => {
        const { events, at } = run(sound(12000, 0.001, "hiss"));
        expect(events).toEqual(["nothing"]);
        expect(at.get("nothing")).toBeGreaterThanOrEqual(8000);
        expect(at.get("nothing")).toBeLessThanOrEqual(8200);
    });
    test("speech before 8 seconds means the long wait does not apply", () => {
        const { events } = run([...sound(5000, 0.001, "hiss"), ...sound(1000, 0.2), ...sound(1500, 0.001, "hiss")]);
        expect(events).not.toContain("nothing");
        expect(events).not.toContain("silence");
    });
    test("the times can be changed", () => {
        const { events } = run([...sound(300, 0.001, "hiss"), ...sound(500, 0.2), ...sound(2000, 0.001, "hiss")], createVoice({ silence: 1000 }));
        expect(events).toContain("silence");
    });
});

test("reset forgets what was heard", () => {
    const voice = createVoice();
    run([...sound(300, 0.001, "hiss"), ...sound(500, 0.2)], voice);
    voice.reset();
    const { last } = run(sound(500, 0.001, "hiss"), voice);
    expect(last.heard).toBe(false);
});
