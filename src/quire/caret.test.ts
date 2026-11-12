// The caret's colours: one for each blink, going round (caret.ts).

import { describe, expect, test } from "bun:test";
import { blinkColour } from "./caret";

describe("blinkColour", () => {
    test("goes round the colours, one per blink", () => {
        const colours = ["a", "b", "c"];
        expect([0, 1, 2, 3, 4, 7].map((index) => blinkColour(colours, index))).toEqual(["a", "b", "c", "a", "b", "b"]);
    });

    test("one colour stays that colour", () => {
        expect(blinkColour(["accent"], 5)).toBe("accent");
    });
});
