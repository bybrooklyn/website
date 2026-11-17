// The marble run's look, as data, held to what it says: a marble's look is decided by its number alone,
// most are clear with a ribbon, some opaque, the odd one steel, in the flags' and the site's colors; a
// box's grain runs along its longest side; a pane's places run from -1 to 1; parts merged keep their
// places in the pattern. Run with `bun run test`.

import { expect, test } from "bun:test";
import { FLAGS, rgb } from "./flags";
import { RIBBONS, grained, grainedBox, hashed, marbleLook, merged, oklch, pane, tableMesh, tooSlow, woodSeed } from "./look";

test("a marble's look is decided by its number: the same number, the same marble, every time", () => {
    for (let n = 0; n < 200; n++) expect(marbleLook(n)).toEqual(marbleLook(n));
    expect(hashed(12, 3)).toBe(hashed(12, 3));
    expect(hashed(12, 3)).not.toBe(hashed(13, 3));
    expect(woodSeed(4)).toBe(woodSeed(4));
});

test("most marbles are clear glass with a ribbon, some opaque with a stripe, and the odd one steel; the first is clear", () => {
    const kinds = { clear: 0, opaque: 0, steel: 0 };
    for (let n = 0; n < 4000; n++) kinds[marbleLook(n).kind]++;
    expect(kinds.clear / 4000).toBeGreaterThan(0.62);
    expect(kinds.clear / 4000).toBeLessThan(0.74);
    expect(kinds.opaque / 4000).toBeGreaterThan(0.19);
    expect(kinds.opaque / 4000).toBeLessThan(0.29);
    expect(kinds.steel / 4000).toBeGreaterThan(0.05);
    expect(kinds.steel / 4000).toBeLessThan(0.11);
    expect(marbleLook(0).kind).toBe("clear");
    // the seed carries the kind as its whole part, for the shader
    for (let n = 0; n < 50; n++) expect(Math.floor(marbleLook(n).seed)).toBe({ clear: 0, opaque: 1, steel: 2 }[marbleLook(n).kind]);
});

test("a ribbon's colors are a pride flag's stripes or the site's accents, and no vane is black", () => {
    const stripes = FLAGS.flatMap((flag) => flag.stripes.map((hex) => rgb(hex).map((v) => v / 255)));
    const allowed = [...stripes, ...RIBBONS.at(-1)!];
    for (let n = 0; n < 300; n++) {
        for (const tint of marbleLook(n).tints) {
            expect(allowed.some((c) => c.every((v, k) => Math.abs(v - tint[k]!) < 1e-9))).toBe(true);
            expect(tint[0] + tint[1] + tint[2]).toBeGreaterThan(0.5);
        }
    }
    // the trans flag's blue, as the site writes it
    expect(RIBBONS[0]![0]).toEqual([0x5b / 255, 0xce / 255, 0xfa / 255]);
    // a color written in OKLCH comes out as the browser draws it: pure red is oklch(0.628 0.2577 29.23)
    const red = oklch(0.628, 0.2577, 29.23).map((v) => Math.round(v * 255));
    expect(red).toEqual([255, 0, 0]);
});

test("a box's grain runs along its longest side, a pane's places run from -1 to 1, and merged parts keep theirs", () => {
    const tall = grainedBox([1, 20, 1.5], [3, 20, 0]);
    // its longest side is up, so the grain's first place is the height
    for (const [i, p] of tall.points.entries()) expect(tall.grain![i]).toEqual([p[1], p[2], p[0]]);
    const glass = pane([2, 1, 0.15], [5, 5, 5]);
    for (const g of glass.grain!) for (const v of g) expect(Math.abs(v)).toBe(1);
    const both = merged([{ mesh: tall }, { mesh: glass, by: [1, 0, 0] }], false)!;
    expect(both.points.length).toBe(16);
    expect(both.grain!.slice(8)).toEqual(glass.grain!);
    expect(both.points[8]![0]).toBeCloseTo(glass.points[0]![0] + 1, 12);
    const solid = grained({ points: [[0, 0, 0], [0.5, 4, 0], [0, 0, 1]], faces: [[0, 1, 2]] });
    // its longest extent is up, then across, then along
    expect(solid.grain![1]).toEqual([4, 0, 0.5]);
});

test("the table's top leaves out each hole, as a pit for a lift's skirt, and covers all the rest once", () => {
    const holes = [{ x: [10, 12] as [number, number], z: [-3, 3] as [number, number] }, { x: [-40, -30] as [number, number], z: [20, 24] as [number, number] }];
    const table = tableMesh(100, 2, holes);
    // its boxes, from their corners: every point of the top is in exactly one box, or in a hole
    const boxes: { x: [number, number]; z: [number, number] }[] = [];
    for (let i = 0; i < table.points.length; i += 8) {
        const corners = table.points.slice(i, i + 8);
        boxes.push({ x: [Math.min(...corners.map((p) => p[0])), Math.max(...corners.map((p) => p[0]))], z: [Math.min(...corners.map((p) => p[2])), Math.max(...corners.map((p) => p[2]))] });
    }
    for (let k = 0; k < 3000; k++) {
        const [x, z] = [hashed(k, 7) * 200 - 100, hashed(k, 8) * 200 - 100];
        const covering = boxes.filter((box) => x > box.x[0] && x < box.x[1] && z > box.z[0] && z < box.z[1]).length;
        const holed = holes.some((hole) => x > hole.x[0] && x < hole.x[1] && z > hole.z[0] && z < hole.z[1]);
        expect(covering).toBe(holed ? 0 : 1);
    }
    expect(Math.max(...table.points.map((p) => p[1]))).toBe(0);
    expect(Math.min(...table.points.map((p) => p[1]))).toBe(-2);
});

/** How long frames coming every `gap` seconds take to turn the look plain, as marbles.ts keeps them (two seconds' worth, 120 at most); never, if not within 20 s. */
function plainAfter(gap: number): number | undefined {
    const gaps: number[] = [];
    for (let time = gap; time <= 20; time += gap) {
        gaps.push(gap);
        let span = gaps.reduce((sum, one) => sum + one, 0);
        while (gaps.length > 120 || span - gaps[0]! > 2) span -= gaps.shift()!;
        if (tooSlow(gaps)) return time;
    }
    return undefined;
}

test("the look goes plain by itself where frames come slowly, within a few seconds, and soonest for the slowest", () => {
    // three frames a second, as headless Chromium draws the scene, had never turned it plain
    expect(plainAfter(1 / 3)).toBeLessThanOrEqual(1.01);
    const gaps = [0.9, 0.5, 1 / 3, 0.29, 0.1, 1 / 20, 1 / 30];
    const times = gaps.map((gap) => plainAfter(gap)!);
    for (const time of times) expect(time).toBeLessThanOrEqual(2.05);
    // the slower the frames, the sooner (to within a frame, which can only come when it comes)
    for (let i = 1; i < times.length; i++) expect(times[i]! + gaps[i - 1]!).toBeGreaterThanOrEqual(times[i - 1]!);
    // a moment of slow frames as the scene starts, less than a second of them, does not
    expect(tooSlow([0.3, 0.3, 0.3])).toBe(false);
    // frames fast enough never turn it plain
    expect(plainAfter(1 / 60)).toBeUndefined();
    expect(plainAfter(1 / 41)).toBeUndefined();
    // a few slow frames among quick ones do not either: it is the middle that counts
    expect(tooSlow([0.016, 0.3, 0.016, 0.016, 0.4, ...new Array<number>(100).fill(0.016)])).toBe(false);
});
