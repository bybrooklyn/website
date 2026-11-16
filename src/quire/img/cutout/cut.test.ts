// What a cut-out's mask is held to: the mask found read back from its runs; a subject pressed keeps
// only what lies in it; a stroke of Keep makes what it covers kept and one of Remove takes it away, in
// the order made; and a mask that does not read gives nothing.

import { expect, test } from "bun:test";
import { encodeRuns } from "../masks";
import { blank, FOUND_NOTHING, findCut, maskOf, pressedCut, valuesOf } from "./cut";

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

test("a press on a cut-out keeps only the thing pressed where it was kept, adds the thing where it was left out, and never throws the cut-out away", () => {
    // a picture 40 by 20, its mask at the same size: the left half was found
    const mask = (inside: (x: number, y: number) => boolean) => ({ width: 40, height: 20, runs: encodeRuns(Uint8Array.from({ length: 800 }, (_, index) => (inside(index % 40, Math.floor(index / 40)) ? 255 : 0))) });
    const picture = { width: 40, height: 20 };
    const cut = { found: mask((x) => x < 20), background: "clear" as const };
    const at = (found: { width: number; height: number; runs: string }, x: number, y: number) => valuesOf(found)![y * 40 + x]!;
    // pressed on what is kept: only the thing pressed stays, the mask found left as it was
    const thing = mask((x, y) => x >= 4 && x < 12 && y >= 4 && y < 12);
    const kept = pressedCut(cut, thing, { x: 8, y: 8 }, picture)!;
    expect(kept.found).toEqual(cut.found);
    expect(kept.pick).toEqual(thing);
    // pressed on what was left out: that thing is added to what is kept, and nothing that was kept is lost
    const other = mask((x, y) => x >= 26 && x < 34 && y >= 4 && y < 12);
    const more = pressedCut(cut, other, { x: 30, y: 8 }, picture)!;
    expect(more.pick).toBeUndefined();
    expect([at(more.found, 8, 8), at(more.found, 30, 8), at(more.found, 37, 16)]).toEqual([1, 1, 0]);
    // with one thing already kept alone, another pressed is added to that one, and the rest stays out
    const both = pressedCut(kept, other, { x: 30, y: 8 }, picture)!;
    expect(both.pick).toBeUndefined();
    expect([at(both.found, 8, 8), at(both.found, 30, 8), at(both.found, 16, 16)]).toEqual([1, 1, 0]);
    // a press whose thing hardly meets what is kept would keep nothing: the cut-out is left as it was
    expect(pressedCut(cut, other, { x: 8, y: 8 }, picture)).toBeUndefined();
    // a mask that does not read changes nothing
    expect(pressedCut(cut, { width: 40, height: 20, runs: "!" }, { x: 8, y: 8 }, picture)).toBeUndefined();
});
