// What a cut-out's mask is held to: the mask found read back from its runs; a subject pressed keeps
// only what lies in it; a stroke of Keep makes what it covers kept and one of Remove takes it away, in
// the order made; and a mask that does not read gives nothing.

import { expect, test } from "bun:test";
import { encodeRuns } from "../masks";
import { blank, FOUND_NOTHING, findCut, maskOf } from "./cut";

const SIZE = { width: 20, height: 10 };
const half = () => {
    const bytes = new Uint8Array(200);
    for (let y = 0; y < 10; y++) for (let x = 0; x < 10; x++) bytes[y * 20 + x] = 255;
    return { width: 20, height: 10, runs: encodeRuns(bytes) };
};

test("a cut-out's mask is the one found, narrowed to the subject pressed, then kept or removed by each stroke in order", () => {
    const found = half();
    const plain = maskOf({ found, background: "clear" }, { width: 200, height: 100 })!;
    expect(plain[0]).toBe(1);
    expect(plain[15]).toBe(0);
    // the subject pressed was the left five columns: the rest of the found half goes
    const pickBytes = new Uint8Array(200);
    for (let y = 0; y < 10; y++) for (let x = 0; x < 4; x++) pickBytes[y * 20 + x] = 255;
    const picked = maskOf({ found, pick: { ...SIZE, runs: encodeRuns(pickBytes) }, background: "clear" }, { width: 200, height: 100 })!;
    expect(picked[5 * 20 + 1]).toBeGreaterThan(0.9);
    expect(picked[5 * 20 + 9]).toBeLessThan(0.1);
    // Keep on the right half, then Remove on the top left corner, in the picture's own pixels
    const brushed = maskOf({ found, background: "clear", strokes: [{ size: 12, soft: 0, points: [150, 50] }, { size: 12, soft: 0, erase: true, points: [10, 10] }] }, { width: 200, height: 100 })!;
    expect(brushed[5 * 20 + 15]).toBe(1);
    expect(brushed[1 * 20 + 1]).toBe(0);
    expect(brushed[8 * 20 + 8]).toBe(1);
    expect(maskOf({ found: { width: 20, height: 10, runs: "!!" }, background: "clear" }, SIZE)).toBeUndefined();
});

test("a mask with next to nothing kept, or all of it, is no cut-out: it is said plainly, once, and nothing is run again", async () => {
    const whole = { width: 2, height: 1, runs: encodeRuns(Uint8Array.of(255, 255)) };
    const none = { width: 2, height: 1, runs: encodeRuns(Uint8Array.of(0, 0)) };
    const good = { width: 2, height: 1, runs: encodeRuns(Uint8Array.of(255, 0)) };
    expect(blank(whole)).toBe(true);
    expect(blank(none)).toBe(true);
    expect(blank(good)).toBe(false);
    let runs = 0;
    const finder = (found: typeof good) => ({ matte: async () => ((runs += 1), { found, ms: 1 }) });
    const picture = async () => ({}) as ImageBitmap;
    expect((await findCut(finder(good), "cut-best", picture)).found).toEqual(good);
    await expect(findCut(finder(none), "cut-best", picture)).rejects.toThrow(FOUND_NOTHING);
    await expect(findCut(finder(whole), "cut-best", picture)).rejects.toThrow(FOUND_NOTHING);
    expect(runs).toBe(3);
    expect(FOUND_NOTHING).toBe("nothing was found to cut out, so the picture is left as it was");
});
