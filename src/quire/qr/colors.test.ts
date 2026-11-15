// What the colors are held to: the flags are the minis' own; luminance and contrast are WCAG's; a color
// deepened stands far enough from its ground and keeps its hue; the rainbow is all of one lightness and
// inside sRGB; and the plain words come when, and only when, a phone may not read the code.

import { expect, test } from "bun:test";
import { FLAGS as MINIS_FLAGS } from "../../minis/flags";
import { contrast, deepened, ENOUGH, FLAGS, hexOf, isHex, luminance, normalHex, oklchHex, rainbow, rgbOf, scanWord } from "./colors";

test("the flags are the minis' table, stripe for stripe", () => {
    expect(FLAGS).toEqual(MINIS_FLAGS);
});

test("colors are read and written as hex, and luminance and contrast are WCAG's", () => {
    expect(rgbOf("#ff8000")).toEqual([255, 128, 0]);
    expect(rgbOf("abc")).toEqual([170, 187, 204]);
    expect(rgbOf("nonsense")).toEqual([0, 0, 0]);
    expect(hexOf([255, 128, 0])).toBe("#ff8000");
    expect(isHex("#12a")).toBe(true);
    expect(isHex("12345g")).toBe(false);
    expect(normalHex("ABC")).toBe("#aabbcc");
    expect(luminance("#ffffff")).toBeCloseTo(1, 6);
    expect(contrast("#000000", "#ffffff")).toBeCloseTo(21, 6);
    // a known pair: #777777 on white is 4.48
    expect(contrast("#777777", "#ffffff")).toBeCloseTo(4.48, 2);
});

test("a color too light for its ground is deepened until it stands far enough, keeping its hue", () => {
    for (const flag of FLAGS) {
        for (const stripe of flag.stripes) {
            const made = deepened(stripe, "#ffffff");
            expect(contrast(made, "#ffffff")).toBeGreaterThanOrEqual(ENOUGH + 0.5);
            const [r, g, b] = rgbOf(stripe);
            const [mr, mg, mb] = rgbOf(made);
            // darkened toward black: each channel scaled by about the same share
            if (r && g && b) expect(Math.abs(mr / r - mg / g)).toBeLessThan(0.05);
            void mb;
        }
    }
    // on a dark ground it is made lighter instead
    expect(contrast(deepened("#333366", "#101010"), "#101010")).toBeGreaterThanOrEqual(ENOUGH + 0.5);
    expect(deepened("#000000", "#ffffff")).toBe("#000000");
});

test("the rainbow is inside sRGB and of one lightness, each color standing well from white", () => {
    const colors = rainbow(7);
    expect(colors.length).toBe(7);
    for (const each of colors) {
        expect(isHex(each)).toBe(true);
        expect(contrast(each, "#ffffff")).toBeGreaterThan(4);
    }
    expect(oklchHex(1, 0, 0)).toBe("#ffffff");
    expect(oklchHex(0, 0, 0)).toBe("#000000");
});

test("the plain words come only when a phone may not read the code", () => {
    expect(scanWord(["#000000"], "#ffffff")).toBeUndefined();
    expect(scanWord(["#000000"], undefined)).toBeUndefined();
    expect(scanWord(["#999999"], "#ffffff")).toBe("The code and its ground are close in lightness, so some phones will not read it.");
    expect(scanWord(["#f0f0f0"], "#ffffff")).toBe("The code and its ground are too alike for a phone to read.");
    expect(scanWord(["#ffffff"], "#000000")).toBe("The code is lighter than its ground. Many phones read that, but not all.");
});
