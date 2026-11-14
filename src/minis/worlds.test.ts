// A sand world as text, held to: going into text and back to the byte, through the built engine as the
// page does it, squeezed and not; and refusing quietly, and quickly, whatever is not a world.

import { expect, test } from "bun:test";
import { start, type Engine } from "./grains";
import { decode, encode, fromText, LINK_MOST, MOST_CELLS, pack, toText, tokensOf, unpack, writeTokens } from "./worlds";

const load = async (): Promise<Engine> => start(await Bun.file(new URL("../../public/wasm/sand.wasm", import.meta.url)).arrayBuffer());
const view = (engine: Engine) => new Uint8Array(engine.memory.buffer, engine.cells(), engine.stride() * (engine.height() + 2 * engine.border()) * 4);
/** Every cell's material and, for pride sand (18), its stripe. */
const seen = (engine: Engine) => tokensOf(view(engine), engine.stride(), engine.border(), engine.width(), engine.height(), 18);

/** A world with something of everything in it, part settled and part still moving. */
async function busy(): Promise<Engine> {
    const engine = await load();
    engine.create(300, 180, 5, 0);
    engine.paint(3, 10, 170, 290, 170, 2, 100, 0);
    for (const [m, x] of [[1, 30], [2, 80], [4, 120], [9, 160], [14, 200], [10, 240], [8, 270]] as const) engine.paint(m, x, 40, x + 10, 60, 6, 45, 0);
    engine.flag(18, 100, 10, 60, 40, 6, 5);
    engine.paint_striped(18, 20, 100, 120, 100, 6, 100, 0, 6);
    engine.step(120);
    return engine;
}

test("a world goes into text and back to the byte, squeezed or not, and opens in another engine as it was", async () => {
    const engine = await busy();
    const tokens = seen(engine);
    expect(new Set(tokens).size).toBeGreaterThan(12);
    for (const squeeze of [true, false]) {
        const text = await pack(tokens, 300, 180, 18, squeeze);
        expect(text[0]).toBe(squeeze ? "z" : "p");
        expect(text).toMatch(/^[\w-]+$/);
        const opened = (await unpack(text))!;
        expect([opened.width, opened.height, opened.striped]).toEqual([300, 180, 18]);
        expect(opened.tokens).toEqual(tokens);
        // and in a fresh engine, written as the page writes it
        const other = await load();
        other.create(300, 180, 9, 0);
        writeTokens(opened, view(other), other.stride(), other.border());
        other.rewritten(1);
        expect(seen(other)).toEqual(tokens);
        for (const m of [1, 2, 3, 18]) expect(other.count(m)).toBe(engine.count(m));
        // the link keeps no shades, but an opened flag is not flat: each grain of pride sand gets a
        // step of lightness of its own again, every one of the four about as often
        const cells = view(other);
        const steps = [0, 0, 0, 0];
        for (let at = 0; at < cells.length; at += 4) if (cells[at] === 18) steps[cells[at + 1]! & 3]!++;
        const total = steps.reduce((sum, n) => sum + n, 0);
        for (const n of steps) expect(n / total).toBeGreaterThan(0.2);
    }
    // squeezed, a world like this goes in a link
    expect((await pack(tokens, 300, 180, 18)).length).toBeLessThan(LINK_MOST);
});

test("the bytes of a world are its runs, and are read back as they were written", () => {
    const tokens = Uint8Array.from([0, 0, 0, 1, 1, 64 + 3, 64 + 3, 0, ...new Array(300).fill(2)]);
    const bytes = encode(tokens, 154, 2, 18);
    expect([...bytes.slice(0, 6)]).toEqual([1, 154, 0, 2, 0, 18]);
    // a run of 300 takes two bytes
    expect([...bytes.slice(-3)]).toEqual([2, 300 & 127 | 128, 300 >> 7]);
    expect(decode(bytes)?.tokens).toEqual(tokens);
    expect(fromText(toText(bytes))).toEqual(bytes);
});

test("rubbish is refused quietly", async () => {
    const good = encode(new Uint8Array(12), 4, 3, 0);
    const bad: Uint8Array[] = [
        Uint8Array.from([2, ...good.slice(1)]), // another version
        Uint8Array.from([1, 0, 0, 3, 0, 0, 0, 1]), // no width
        Uint8Array.from([1, 0, 4, 0, 4, 0, 0, 2]), // 1024 by 1024, more than the engine makes
        Uint8Array.from([...good.slice(0, 6), 0, 11]), // runs short of the world
        Uint8Array.from([...good.slice(0, 6), 0, 13]), // runs past it
        Uint8Array.from([...good.slice(0, 6), 0, 0, 0, 12]), // a run of nothing
        Uint8Array.from([...good.slice(0, 6), 64, 12]), // a stripe, with no striped material
        Uint8Array.from([...good.slice(0, 6), 200, 12]), // a token with no meaning
        Uint8Array.from([...good.slice(0, 6), 0, 128, 128, 128, 1]), // a run of four bytes
        good.slice(0, 7), // cut short
    ];
    for (const bytes of bad) {
        expect(decode(bytes)).toBeUndefined();
        expect(await unpack(`p${toText(bytes)}`)).toBeUndefined();
    }
    for (const text of ["", "z", "p", "hello world", "z!!!!", "q" + toText(good), "z" + toText(good), "pA", "z" + "A".repeat(5000)]) expect(await unpack(text)).toBeUndefined();
    expect(await unpack(`p${toText(good)}`)).toBeDefined();
});

test("a few bytes that would unsqueeze to gigabytes, and text past the bound, are refused, quickly", async () => {
    // 20 MB of one byte squeezes to some kilobytes; unsqueezing stops at the bound
    const huge = new Uint8Array(20_000_000);
    huge.set(encode(new Uint8Array(4), 2, 2, 0));
    const stream = new Blob([huge]).stream().pipeThrough(new CompressionStream("deflate-raw"));
    const squeezed = new Uint8Array(await new Response(stream).arrayBuffer());
    const began = performance.now();
    expect(await unpack(`z${toText(squeezed)}`)).toBeUndefined();
    expect(performance.now() - began).toBeLessThan(2000);
    expect(await unpack(`p${"A".repeat(4_000_004)}`)).toBeUndefined();
    // the largest world there may be is still taken
    expect(decode(encode(new Uint8Array(MOST_CELLS), 1024, 576, 0))?.width).toBe(1024);
});
