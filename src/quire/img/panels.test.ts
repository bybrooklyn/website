// What the words round the picture are held to: a pasted screenshot is named by its day and time
// while a file keeps its own name, and the line
// under the picture says its size and weight.

import { expect, test } from "bun:test";
import { COLORS, factsSaid, kindOf, nameFor, SHAPES, WEIGHTS } from "./panels";

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
