// What the sounds' side is held to: a sound's row says its rate, channels and length in plain units,
// and a sound is written at the rate and channels each format takes: Opus always at 48 kHz and at most in
// stereo, AAC at most in stereo, FLAC at most in eight channels, and as it came otherwise.

import { expect, test } from "bun:test";
import { AUDIO_DEFAULT } from "./audio";
import { channelsSaid, rateSaid, shapeFor, soundWords } from "./audio-side";

test("a sound's row says its rate, channels and length in plain units", () => {
    expect(rateSaid(44_100)).toBe("44.1 kHz");
    expect(rateSaid(48_000)).toBe("48 kHz");
    expect(channelsSaid(1)).toBe("mono");
    expect(channelsSaid(6)).toBe("6 channels");
    expect(soundWords("FLAC sound", { rate: 44_100, channels: 2, duration: 205 })).toBe("FLAC sound, 44.1 kHz stereo, 3:25");
    expect(soundWords("MP3 sound", undefined)).toBe("MP3 sound");
});

test("each format is written at the rate and channels it takes", () => {
    const opus = { ...AUDIO_DEFAULT, format: "opus-ogg" as const };
    expect(shapeFor(opus, { rate: 44_100, channels: 6 })).toEqual({ rate: 48_000, channels: 2 });
    expect(shapeFor({ ...AUDIO_DEFAULT, format: "aac-m4a" }, { rate: 44_100, channels: 6 })).toEqual({ rate: 44_100, channels: 2 });
    expect(shapeFor({ ...AUDIO_DEFAULT, format: "flac" }, { rate: 96_000, channels: 2 })).toEqual({ rate: 96_000, channels: 0 });
    expect(shapeFor({ ...AUDIO_DEFAULT, format: "wav", rate: 22_050, channels: 1 }, { rate: 96_000, channels: 2 })).toEqual({ rate: 22_050, channels: 1 });
    expect(shapeFor(AUDIO_DEFAULT, undefined)).toEqual({ rate: 48_000, channels: 0 });
});
