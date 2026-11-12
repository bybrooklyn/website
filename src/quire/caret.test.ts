// The caret's colours: one for each blink, going round (caret.ts).

import { describe, expect, test } from "bun:test";
import { blinkColour, contrast, FLAG, hexRgb, luminance, needsEdge } from "./caret";

describe("the lesbian flag", () => {
    test("is the caret's five colours, from the top", () => {
        expect([...FLAG]).toEqual(["#D52D00", "#FF9A56", "#FFFFFF", "#D362A4", "#A30262"]);
        expect(FLAG.map((_, index) => blinkColour(FLAG, index + FLAG.length))).toEqual([...FLAG]);
    });

    test("contrast is measured as WCAG measures it", () => {
        expect(luminance([0, 0, 0])).toBe(0);
        expect(luminance([255, 255, 255])).toBeCloseTo(1, 6);
        expect(contrast([0, 0, 0], [255, 255, 255])).toBeCloseTo(21, 6);
        expect(contrast(hexRgb("#777777"), [255, 255, 255])).toBeCloseTo(4.48, 2);
        expect(hexRgb("#D362A4")).toEqual([211, 98, 164]);
    });

    test("on the dark sheet the darkest colour needs an edge, and no dark sheet could do without one", () => {
        // the sheet as the site draws it, oklch(0.259 0.051 300), measured in the browser
        const sheet: [number, number, number] = [40, 29, 57];
        expect(FLAG.filter((colour) => needsEdge(hexRgb(colour), sheet))).toEqual(["#A30262"]);
        expect(contrast(hexRgb("#A30262"), [0, 0, 0])).toBeLessThan(3);
        expect(contrast(hexRgb("#FFFFFF"), sheet)).toBeGreaterThan(10);
    });
});

describe("blinkColour", () => {
    test("goes round the colours, one per blink", () => {
        const colours = ["a", "b", "c"];
        expect([0, 1, 2, 3, 4, 7].map((index) => blinkColour(colours, index))).toEqual(["a", "b", "c", "a", "b", "b"]);
    });

    test("one colour stays that colour", () => {
        expect(blinkColour(["accent"], 5)).toBe("accent");
    });
});
