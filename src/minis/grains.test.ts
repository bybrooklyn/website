// What the sand mini's built engine, public/wasm/sand.wasm and its twin without SIMD, is held to
// from the page's side: it loads with nothing given to it, stays small, offers the materials of its
// table, keeps every material through any number of steps, and makes the same busy world, to the byte,
// as the crate's own test (sand/tests/unchanged.rs) makes natively. Also what grains.ts works out for
// the page. `bun run wasm` builds the modules; `bun test` runs this.

import { expect, test } from "bun:test";
import { engineAddress, fillOf, materials, MOST, start, worldFor, type Engine } from "./grains";

const simd = new URL("../../public/wasm/sand.wasm", import.meta.url);
const scalar = new URL("../../public/wasm/sand-scalar.wasm", import.meta.url);

const load = async (from: URL): Promise<Engine> => start(await Bun.file(from).arrayBuffer());

/** The busy world of sand/tests/unchanged.rs, through the same calls. */
function busy(engine: Engine): [number, number] {
    expect(engine.create(256, 160, 7, 0)).toBe(1);
    engine.paint(3, 20, 150, 236, 150, 2, 100, 0);
    engine.paint(3, 20, 150, 60, 100, 1, 100, 0);
    engine.paint(3, 236, 150, 236, 90, 1, 100, 0);
    for (let k = 0; k < 20; k++) {
        engine.paint([1, 2, 4, 5][k % 4]!, 40 + k * 9, 10, 50 + k * 7, 30, 4, 60, 0);
        engine.step(15);
    }
    engine.paint(0, 100, 120, 140, 140, 6, 100, 0);
    engine.step(400);
    return [engine.fingerprint(0) >>> 0, engine.fingerprint(1) >>> 0];
}

test("both builds are small and need nothing from the page to load", async () => {
    for (const each of [simd, scalar]) {
        expect(Bun.file(each).size).toBeLessThan(128 * 1024);
        const module = await WebAssembly.compile(await Bun.file(each).arrayBuffer());
        expect(WebAssembly.Module.imports(module)).toEqual([]);
    }
    expect(engineAddress()).toBe("/wasm/sand.wasm");
});

test("the busy world comes out to the byte as it does natively, with SIMD and without", async () => {
    // the number sand/tests/unchanged.rs holds the native build to
    const native: [number, number] = [0x5099eeab, 0xfd485ff9];
    expect(busy(await load(simd))).toEqual(native);
    expect(busy(await load(scalar))).toEqual(native);
});

test("the same world comes out with sleeping off and in the checkerboard order with sleeping on and off", async () => {
    const run = async (sleeping: number, phases: number) => {
        const engine = await load(simd);
        engine.create(200, 120, 3, 0);
        engine.set_sleeping(sleeping);
        engine.set_order(phases);
        engine.paint(3, 10, 110, 190, 110, 1, 100, 0);
        for (let k = 0; k < 12; k++) {
            engine.paint([1, 2, 4, 5][k % 4]!, 20 + k * 13, 5, 30 + k * 11, 20, 5, 50, 0);
            engine.step(20);
        }
        engine.step(300);
        return [engine.fingerprint(0), engine.fingerprint(1)];
    };
    expect(await run(0, 0)).toEqual(await run(1, 0));
    expect(await run(0, 1)).toEqual(await run(1, 1));
});

test("the brush is offered sand, water, stone, dirt and steam, and each is poured or laid as it should be", async () => {
    const engine = await load(simd);
    const offered = materials(engine);
    expect(offered.map((m) => `${m.name} ${m.kind}`)).toEqual(["sand powder", "water liquid", "stone solid", "dirt powder", "steam gas"]);
    expect(fillOf("solid")).toBe(100);
    expect(fillOf("powder")).toBeLessThan(100);
});

test("no material appears or vanishes in the built module, and a world left alone goes to sleep", async () => {
    const engine = await load(simd);
    engine.create(300, 200, 9, 0);
    engine.paint(3, 20, 190, 280, 190, 2, 100, 0);
    for (const [m, x] of [[1, 60], [2, 120], [4, 180], [5, 240]] as const) engine.paint(m, x, 20, x + 10, 60, 8, 60, 0);
    const counts = () => [0, 1, 2, 3, 4, 5].map((m) => engine.count(m));
    const before = counts();
    for (let k = 0; k < 10; k++) {
        engine.step(200);
        expect(counts()).toEqual(before);
    }
    expect(engine.awake()).toBe(0);
    // what changed since the page last drew is a range of rows, and none once it is forgotten
    engine.paint(1, 150, 30, 150, 30, 2, 100, 0);
    expect(engine.changed_from()).toBeLessThanOrEqual(28);
    expect(engine.changed_to()).toBeGreaterThanOrEqual(32);
    engine.forget_changed();
    expect(engine.changed_from()).toBe(-1);
});

test("the cells are where the engine says, four bytes each, in a frame of border cells", async () => {
    const engine = await load(simd);
    engine.create(64, 32, 1, 0);
    engine.paint(3, 5, 7, 5, 7, 0, 100, 0);
    const stride = engine.stride();
    const border = engine.border();
    expect(stride).toBe(64 + 2 * border);
    const bytes = new Uint8Array(engine.memory.buffer, engine.cells(), stride * (32 + 2 * border) * 4);
    expect(bytes[((7 + border) * stride + 5 + border) * 4]).toBe(3);
    // the frame is wall, material 6, all round
    expect(bytes[0]).toBe(6);
    // and the colors are two rows of 256: stone is opaque, empty is see-through
    const palette = new Uint8Array(engine.memory.buffer, engine.palette(), 2048);
    expect(palette[3 * 4 + 3]).toBe(255);
    expect(palette[3]).toBe(0);
});

test("a world is a cell to a CSS pixel in whole device pixels, and never more than the plan's 1024 by 576", () => {
    expect(worldFor(896, 544, 1)).toEqual({ columns: 896, rows: 544 });
    expect(worldFor(896, 544, 2)).toEqual({ columns: 896, rows: 544 });
    // a fractional ratio rounds to whole device pixels a cell
    expect(worldFor(800, 500, 1.5)).toEqual({ columns: 600, rows: 375 });
    // a phone: fewer cells, three device pixels each
    expect(worldFor(360, 400, 3)).toEqual({ columns: 360, rows: 400 });
    // a very large canvas is held to the most
    const big = worldFor(2400, 1300, 1);
    expect(big.columns).toBeLessThanOrEqual(MOST.columns);
    expect(big.rows).toBeLessThanOrEqual(MOST.rows);
});
