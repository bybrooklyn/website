// What a picture's conversion is held to outside a browser: its size is never made larger than it came,
// keeps its shape and is at least a pixel, and the bar counts one run of the encoder, or nine when a
// weight is searched for. (The conversion itself runs in Chromium in page.test.ts.)

import { expect, test } from "bun:test";
import { attemptsFor, sizeFor } from "./pictures";

test("a picture is made no larger than it came, its shape kept", () => {
    expect(sizeFor(4032, 3024, { by: "same" })).toEqual({ width: 4032, height: 3024 });
    expect(sizeFor(4032, 3024, { by: "side", value: 2048 })).toEqual({ width: 2048, height: 1536 });
    expect(sizeFor(3024, 4032, { by: "side", value: 2048 })).toEqual({ width: 1536, height: 2048 });
    expect(sizeFor(800, 600, { by: "side", value: 2048 })).toEqual({ width: 800, height: 600 });
    expect(sizeFor(800, 600, { by: "percent", value: 25 })).toEqual({ width: 200, height: 150 });
    expect(sizeFor(800, 600, { by: "percent", value: 100 })).toEqual({ width: 800, height: 600 });
    expect(sizeFor(3, 1, { by: "percent", value: 1 })).toEqual({ width: 1, height: 1 });
});

test("the encoder runs once, or up to nine times when a weight is searched for in a lossy format", () => {
    expect(attemptsFor({}, true)).toBe(1);
    expect(attemptsFor({ target: 200_000 }, true)).toBe(9);
    expect(attemptsFor({ target: 200_000 }, false)).toBe(1);
});
