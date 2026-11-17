// Tests for sharing a run: written and read back to the identical text, by file and by link, its spots
// and pieces of one's own with it; hostile and huge text refused quietly; a run that does not fit put
// together as far as it fits, saying how many were left out; the pieces of one's own a run uses found.

import { expect, test } from "bun:test";
import { asOwn, moved } from "./edit";
import { LINKED, LINK_MOST, MOST, fitted, openText, ownsUsed, packShared, readShared, unpackShared, writeShared, type Shared } from "./share";
import { read, write } from "./run";
import { RUNS } from "./runs";
import { toText } from "./worlds";

const spot = { at: [12.3, 40, -7.5] as [number, number, number], turn: 0.785, tip: 0.62, far: 220.4 };

test("every made run, with spots and a piece of one's own, written and read back is the identical run, as a file and through a link", async () => {
    for (const made of RUNS) {
        const run = read(made.text);
        const shared: Shared = { run, spots: [spot, { ...spot, turn: -2.5 }], owns: [{ name: "hairpin", text: asOwn(run.slice(1, 3)) }] };
        const file = writeShared(shared);
        const back = readShared(file)!;
        expect(write(back.run)).toBe(write(run));
        expect(back.left).toBe(0);
        expect(back.spots).toEqual([spot, { ...spot, turn: -2.5 }]);
        expect(back.owns).toEqual(shared.owns);
        // and written again from what was read, the identical text
        expect(writeShared(back)).toBe(file);
        const packed = await packShared(shared);
        expect(packed.startsWith("z")).toBe(true);
        const opened = (await unpackShared(packed))!;
        expect(writeShared(opened)).toBe(file);
        // through an address pasted whole
        expect(writeShared((await openText(`https://example.org/minis/marbles/${LINKED}${packed}`))!)).toBe(file);
        // and where the browser cannot squeeze
        expect(writeShared((await unpackShared(await packShared(shared, false)))!)).toBe(file);
    }
});

test("links are short: every made run's link is well under the length past which a file is saved", async () => {
    for (const made of RUNS) {
        const packed = await packShared({ run: read(made.text), spots: [spot], owns: [] });
        expect(packed.length).toBeLessThan(LINK_MOST / 4);
    }
});

test("a run that carries a race gives the same race back, through a file and a link; a race out of bounds is dropped and the run kept", async () => {
    const shared: Shared = { run: read(RUNS[0]!.text), spots: [], owns: [], race: { count: 8, drawn: 417 } };
    expect(writeShared(shared).trim().split("\n").at(-1)).toBe("race 8 417");
    expect(readShared(writeShared(shared))!.race).toEqual({ count: 8, drawn: 417 });
    expect((await unpackShared(await packShared(shared)))!.race).toEqual({ count: 8, drawn: 417 });
    expect(readShared(writeShared({ ...shared, race: undefined }))!.race).toBeUndefined();
    for (const bad of ["race 9 417", "race 1 417", "race 8 0", "race 8 1000", "race 8", "race 8 4.5", "race eight 417"]) {
        const opened = readShared(`marbles 1\nrun ${write(shared.run)}\n${bad}\n`)!;
        expect(opened.race).toBeUndefined();
        expect(write(opened.run)).toBe(write(shared.run));
    }
});

test("a bare run's text is read as a run, and an old one in its old form", () => {
    expect(write(readShared(RUNS[0]!.text)!.run)).toBe(write(read(RUNS[0]!.text)));
    expect(readShared("v3")!.run).toEqual([]);
});

test("text that is not a shared run is refused quietly: another head, too many lines, too long, a broken link, bytes that are not text", async () => {
    expect(readShared("hello")).toBeUndefined();
    expect(readShared("marbles 2\nrun v3")).toBeUndefined();
    expect(readShared("marbles 1\nspot 1 2 3 4 5 6")).toBeUndefined();
    expect(readShared(`marbles 1\nrun v3\n${"spot 0 0 0 0 0 1000\n".repeat(30)}`)).toBeUndefined();
    expect(readShared(`v3.${"s1_0_0_0_0.".repeat(MOST.pieces + 1)}`)).toBeUndefined();
    expect(readShared(`marbles 1\nrun v3.${"x".repeat(MOST.text)}`)).toBeUndefined();
    expect(await unpackShared("z!!!")).toBeUndefined();
    expect(await unpackShared("q" + toText(new Uint8Array([1, 2, 3])))).toBeUndefined();
    expect(await unpackShared("p" + toText(new Uint8Array([0xff, 0xfe, 0x80])))).toBeUndefined();
    expect(await unpackShared("z" + "A".repeat(MOST.link))).toBeUndefined();
    expect(await openText(`${LINKED}`)).toBeUndefined();
});

test("a damaged link is known for one, so that the scene can say it could not be read: cut in half, a letter changed, garbage, far too long", async () => {
    const good = await packShared({ run: read(RUNS[0]!.text), spots: [], owns: [] });
    expect(await unpackShared(good)).toBeDefined();
    const changed = good.slice(0, 10) + (good[10] === "A" ? "B" : "A") + good.slice(11);
    for (const damaged of [good.slice(0, Math.floor(good.length / 2)), changed, "zzz!!notarun", "x".repeat(150_000)]) expect(await unpackShared(damaged)).toBeUndefined();
});

test("a link that would unsqueeze to far more than the bound is refused, and costs no more than the bound to find out", async () => {
    const huge = new Uint8Array(50_000_000).fill(32);
    const squeezed = new Uint8Array(await new Response(new Blob([huge]).stream().pipeThrough(new CompressionStream("deflate-raw"))).arrayBuffer());
    const link = `z${toText(squeezed)}`;
    expect(link.length).toBeLessThan(MOST.link);
    const before = performance.now();
    expect(await unpackShared(link)).toBeUndefined();
    expect(performance.now() - before).toBeLessThan(2000);
});

test("numbers past their bounds are not believed: a piece with a number too long is left out and counted, a spot out of bounds or a name of no letters is dropped", () => {
    const text = `marbles 1\nrun v3.h0_0_8_0.s1_9999999_0_8_0.s1_-1_0_8_0\nspot 0 0 0 0 0 99999\nspot 0 100 0 785 620 2200\nown v3.s1_0_0_0_0 \u0000\u0001\nown v3.s1_0_0_0_0 a long name ${"x".repeat(60)}`;
    const opened = readShared(text)!;
    expect(opened.run.length).toBe(2);
    expect(opened.left).toBe(1);
    expect(opened.spots.length).toBe(1);
    expect(opened.owns.length).toBe(1);
    expect(opened.owns[0]!.name.length).toBe(MOST.name);
});

test("a run that does not fit is put together as far as it fits, in order, saying how many pieces were left out", () => {
    // the first run, with a straight laid over its first straight, one off the table, one far up in the air, and one that is no piece at all
    const text = `${RUNS[0]!.text}.s2_0_1_8_2.s1_90_0_4_0.s1_0_5_9999_0.k1_0_0_0_0`;
    const opened = readShared(text)!;
    expect(write(opened.run)).toBe(write(read(RUNS[0]!.text)));
    expect(opened.left).toBe(4);
    const { run, left } = fitted([...read(RUNS[0]!.text), ...read(RUNS[0]!.text)]);
    expect(run.length).toBe(read(RUNS[0]!.text).length);
    expect(left).toBe(read(RUNS[0]!.text).length);
});

test("the pieces of one's own a run uses are found, turned and moved as one; one it does not use is not", () => {
    const run = read(RUNS[0]!.text);
    const group = run.slice(2, 5);
    const own = { name: "bend", text: asOwn(group) };
    const elsewhere = { name: "other", text: asOwn([run[0]!, run[1]!].map((piece) => moved(piece, { turn: 0, x: 3, z: 0, y: 0 }))) };
    const loop = { name: "loop", text: "v3.l0_0_0_0" };
    expect(ownsUsed(run, [own, elsewhere, loop]).map((one) => one.name)).toEqual(["bend", "other"]);
    const turned = run.map((piece) => moved(piece, { turn: 1, x: 2, z: -3, y: 1 }));
    expect(ownsUsed(turned, [own, loop]).map((one) => one.name)).toEqual(["bend"]);
});
