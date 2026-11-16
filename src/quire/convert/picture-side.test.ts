// What the pictures' side of the panel is held to: it starts as imgQuire's export does (WebP at 85, its
// own size, nothing about the picture kept), says the metadata choices in imgQuire's words, and says what
// a picture becomes with its size when it is made smaller.

import { expect, test } from "bun:test";
import { KEEPS, PICTURE_DEFAULT, pictureWords } from "./picture-side";

test("it starts as imgQuire's export does, with nothing about the picture kept", () => {
    expect(PICTURE_DEFAULT).toEqual({ format: "webp", quality: 0.85, size: { by: "same" }, keep: "none" });
    expect(KEEPS.map((each) => each.label)).toEqual(["None", "No place", "All"]);
});

test("what a picture becomes says its size when it is made smaller", () => {
    expect(pictureWords(PICTURE_DEFAULT, "WebP")).toBe("WebP");
    expect(pictureWords({ ...PICTURE_DEFAULT, size: { by: "side", value: 2048 } }, "AVIF")).toBe("AVIF, 2048 px at most");
    expect(pictureWords({ ...PICTURE_DEFAULT, size: { by: "percent", value: 50 } }, "PNG")).toBe("PNG, 50%");
    expect(pictureWords({ ...PICTURE_DEFAULT, size: { by: "percent", value: 100 } }, "PNG")).toBe("PNG");
});
