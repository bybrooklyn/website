// The made-up engine the browser tests use: it downloads in steps and can be cancelled, keeps and
// forgets tiers, and its recognizer reveals a phrase as loud sound arrives.

import { expect, test } from "bun:test";
import { createFake, PHRASES } from "./fake";
import { tierOf } from "./models";

test("a made-up download reports its progress to the full size, and the tier is kept", async () => {
    const { provider, controls } = createFake();
    controls.downloadTime = 50;
    const seen: number[] = [];
    expect(await provider.cached(tierOf("tiny"))).toBe(false);
    await provider.download(tierOf("tiny"), (bytes) => seen.push(bytes));
    expect(seen.at(-1)).toBeGreaterThan(50e6);
    expect(await provider.cached(tierOf("tiny"))).toBe(true);
    await provider.remove(tierOf("tiny"));
    expect(await provider.cached(tierOf("tiny"))).toBe(false);
});

test("cancelling a made-up download rejects it, keeping nothing", async () => {
    const { provider, controls } = createFake();
    controls.downloadTime = 200;
    const pending = provider.download(tierOf("tiny"), () => {});
    provider.cancel();
    await expect(pending).rejects.toMatchObject({ cancelled: true });
    expect(await provider.cached(tierOf("tiny"))).toBe(false);
});

test("the made-up recognizer says the phrase of the loudness, one more word for each half second", async () => {
    const { provider, controls } = createFake();
    controls.delay = 1;
    const { recognizer } = await provider.load(tierOf("tiny"), []);
    const loud = (seconds: number) => Float32Array.from({ length: seconds * 16000 }, (_, i) => 0.2 * Math.sin(i / 10));
    expect((await recognizer.transcribe(loud(1))).text).toBe("hello there");
    expect((await recognizer.transcribe(loud(4))).text).toBe(PHRASES["20"]!);
    expect((await recognizer.transcribe(new Float32Array(16000))).text).toBe("");
});

test("the made-up microphone feeds frames to whoever opened it, until closed", async () => {
    const { microphone, controls } = createFake();
    const frames: number[] = [];
    const mic = await microphone(
        (frame) => frames.push(frame.length),
        () => {},
    );
    expect(controls.microphoneOpen()).toBe(true);
    await controls.speak(300);
    expect(frames).toEqual([1600, 1600, 1600]);
    mic.close();
    expect(controls.microphoneOpen()).toBe(false);
});
