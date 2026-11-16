// What the films' side is held to: a film's row says its container, its pictures' coding and size, its
// sound and its length; and each way of writing a film has its own ending and coding.

import { expect, test } from "bun:test";
import { FILM_FORMATS, filmWords } from "./video-side";

test("a film's row says what it holds", () => {
    expect(filmWords("MP4 film", { tracks: [{ kind: "video", label: "H.264", width: 1920, height: 1080 }, { kind: "audio", label: "AAC" }], duration: 205 })).toBe("MP4 film, H.264 1920 × 1080, AAC sound, 3:25");
    expect(filmWords("WebM film", { tracks: [{ kind: "video", label: "VP9", width: 640, height: 360 }], duration: 0 })).toBe("WebM film, VP9 640 × 360, no sound");
});

test("each way of writing a film has its own ending and coding", () => {
    expect(FILM_FORMATS.map((each) => [each.label, each.ending, each.coding])).toEqual([
        ["MP4", ".mp4", "h264"],
        ["WebM VP9", ".webm", "vp9"],
        ["WebM AV1", ".webm", "av1"],
    ]);
});
