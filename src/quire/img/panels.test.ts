// What the words round the picture are held to: a pasted screenshot is named by its day and time
// while a file keeps its own name, the line under the picture says its size and weight, and the
// strip says where a reading of the text is.

import { expect, test } from "bun:test";
import { COLORS, dialTurn, factsSaid, kindOf, nameFor, readSaid, SHAPES, turnSaid, WEIGHTS } from "./panels";

test("a pasted screenshot, which comes named image.png, is named by its day and time; a file keeps its own name", () => {
    const when = new Date(2026, 10, 14, 1, 30);
    expect(nameFor("image.png", when)).toBe("Screenshot, 14 Nov 2026 01:30");
    expect(nameFor(undefined, when)).toBe("Screenshot, 14 Nov 2026 01:30");
    expect(nameFor("Harbour at dusk.jpg", when)).toBe("Harbour at dusk");
});

test("the line under the picture says its size in pixels and the weight it will be given out at", () => {
    expect(factsSaid({ width: 1920, height: 1080 }, 412_300, "WebP")).toBe("1920 × 1080 px · 412 KB WebP");
    expect([kindOf({ type: "image/png" }), kindOf({ type: "image/gif" })]).toEqual(["PNG", "GIF"]);
});

test("the strip's choices: six colors, three thicknesses growing, five shapes starting free", () => {
    expect(COLORS).toHaveLength(6);
    expect(WEIGHTS.map((each) => each.value)).toEqual([...WEIGHTS.map((each) => each.value)].sort((a, b) => a - b));
    expect(SHAPES[0]).toEqual({ name: "Free", icon: "free" });
});

test("the strip says where the reading is in a few quiet words", () => {
    const read = { state: "read" as const, progress: 1, words: 40, private: 0, model: "Tiny" };
    expect(readSaid({ ...read, state: "reading", progress: 0.4 })).toBe("Reading text 40%");
    expect(readSaid({ ...read, state: "fetching" })).toBe("Downloading the model");
    expect(readSaid(read)).toBe("40 words");
    expect(readSaid({ ...read, words: 1, private: 1 })).toBe("1 word, 1 looks private");
    expect(readSaid({ ...read, private: 3 })).toBe("40 words, 3 look private");
    expect(readSaid({ ...read, words: 0 })).toBe("No text found");
    expect(readSaid({ ...read, state: "failed" })).toBe("Not read");
});

test("the horizon's dial turns by the share of its width dragged, a tenth as far with Shift, snaps to level near it, stops at 15 each way, and says its turn in tenths", () => {
    expect(dialTurn(0, 30, 300, false)).toBe(3);
    expect(dialTurn(0, 30, 300, true)).toBe(0.3);
    expect(dialTurn(2, -18, 300, false)).toBe(0);
    expect(dialTurn(2, -15, 300, false)).toBe(0.5);
    expect(dialTurn(0, 2, 300, false)).toBe(0);
    expect(dialTurn(10, 600, 300, false)).toBe(15);
    expect(dialTurn(-10, -600, 300, false)).toBe(-15);
    expect(turnSaid(0)).toBe("0°");
    expect(turnSaid(2.4)).toBe("2.4°");
    expect(turnSaid(-3)).toBe("−3.0°");
});
