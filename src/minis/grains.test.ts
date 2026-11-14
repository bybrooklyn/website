// What the sand mini's built engine, public/wasm/sand.wasm and its twin without SIMD, is held to
// from the page's side: it loads with nothing given to it, stays small, offers the materials of its
// table, keeps every material through any number of steps, and makes the same busy world, to the byte,
// as the crate's own test (sand/tests/unchanged.rs) makes natively. Also what grains.ts works out for
// the page. `bun run wasm` builds the modules; `bun test` runs this.

import { expect, test } from "bun:test";
import { engineAddress, fillOf, flagSize, inRow, KEYS, materials, MOST, start, swatchColor, worldFor, type Engine, type Material } from "./grains";

const simd = new URL("../../public/wasm/sand.wasm", import.meta.url);
const scalar = new URL("../../public/wasm/sand-scalar.wasm", import.meta.url);

const load = async (from: URL): Promise<Engine> => start(await Bun.file(from).arrayBuffer());

/** What the busy world's strokes pour in turn: sand, water, dirt, steam, wood, oil, lava, ice, smoke, fire and acid. */
const STROKES = [1, 2, 4, 5, 8, 9, 10, 11, 12, 13, 14];

/** The busy world of sand/tests/unchanged.rs, through the same calls. */
function busy(engine: Engine): [number, number] {
    expect(engine.create(256, 160, 7, 0)).toBe(1);
    engine.paint(3, 20, 150, 236, 150, 2, 100, 0);
    engine.paint(3, 20, 150, 60, 100, 1, 100, 0);
    engine.paint(3, 236, 150, 236, 90, 1, 100, 0);
    for (let k = 0; k < 22; k++) {
        engine.paint(STROKES[k % STROKES.length]!, 40 + k * 9, 10, 50 + k * 7, 30, 4, 60, 0);
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
    const native: [number, number] = [0xfe7b20c5, 0x7fcfa07a];
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

test("the brush is offered every material of the table it should be, and each is poured or laid as it should be", async () => {
    const engine = await load(simd);
    const offered = materials(engine);
    expect(offered.map((m) => `${m.name} ${m.kind}`)).toEqual(["sand powder", "water liquid", "stone solid", "dirt powder", "steam gas", "wood solid", "oil liquid", "lava liquid", "ice solid", "smoke gas", "fire fire", "acid liquid", "pride sand powder"]);
    // wet dirt, burning wood and ash are made by reactions, not poured
    expect(offered.some((m) => ["wet dirt", "ember", "ash"].includes(m.name))).toBe(false);
    const of = (kind: Material["kind"], striped = false, light = false) => ({ kind, striped, light });
    expect(fillOf(of("fire"))).toBeLessThan(100);
    expect(fillOf(of("solid"))).toBe(100);
    expect(fillOf(of("powder"))).toBeLessThan(100);
    // a powder held still pours about three grains a step, whatever the brush's size; pride sand along a line is laid whole
    for (const radius of [2, 4, 8, 16, 24]) {
        const grains = (fillOf(of("powder"), true, radius) / 100) * 4 * (2 * radius + 1);
        expect(grains).toBeGreaterThan(1.5);
        expect(grains).toBeLessThan(4.5);
    }
    expect(fillOf(of("powder"), true, 0)).toBe(45);
    expect(fillOf(of("liquid"), true, 8)).toBe(45);
    expect(fillOf(of("solid"), true)).toBe(100);
    // lava is poured thick, fire is not
    expect(fillOf(of("liquid", false, true))).toBe(100);
    expect(fillOf(of("fire", false, true))).toBeLessThan(100);
    expect(fillOf(of("powder", true))).toBe(100);
    expect(fillOf(of("powder", true), true, 8)).toBeLessThan(100);
});

test("what does not react at room temperature is kept exactly in the built module, and a world left alone goes to sleep", async () => {
    const engine = await load(simd);
    engine.create(300, 200, 9, 0);
    engine.paint(3, 20, 190, 280, 190, 2, 100, 0);
    // sand, water and oil
    for (const [m, x] of [[1, 60], [2, 120], [9, 180], [1, 240]] as const) engine.paint(m, x, 20, x + 10, 60, 8, 60, 0);
    const counts = () => [0, 1, 2, 3, 9].map((m) => engine.count(m));
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

test("a world is two CSS pixels a cell in whole device pixels, and never more than the plan's 1024 by 576", () => {
    expect(worldFor(896, 544, 1)).toEqual({ columns: 448, rows: 272 });
    // a cell is four device pixels where there are two to a CSS pixel, so the world is the same
    expect(worldFor(896, 544, 2)).toEqual({ columns: 448, rows: 272 });
    // a fractional ratio rounds to whole device pixels a cell: 1.5 makes three
    expect(worldFor(800, 500, 1.5)).toEqual({ columns: 400, rows: 250 });
    // a phone at three device pixels to a CSS pixel: six to a cell
    expect(worldFor(360, 400, 3)).toEqual({ columns: 180, rows: 200 });
    // another size of cell can be asked for
    expect(worldFor(896, 544, 1, 1)).toEqual({ columns: 896, rows: 544 });
    // a very large canvas is held to the most
    const big = worldFor(4000, 2400, 1);
    expect(big.columns).toBeLessThanOrEqual(MOST.columns);
    expect(big.rows).toBeLessThanOrEqual(MOST.rows);
});

test("the row of materials puts like things together and every material has its own key", async () => {
    const engine = await load(simd);
    const row = inRow(materials(engine));
    expect(row.map((m) => m.name)).toEqual(["sand", "dirt", "pride sand", "water", "oil", "lava", "acid", "stone", "wood", "ice", "steam", "smoke", "fire"]);
    const keys = [...row.map((m) => KEYS[m.name]), KEYS.erase];
    expect(keys.every((key) => key && key.length === 1)).toBe(true);
    expect(new Set(keys).size).toBe(keys.length);
    // each a letter of its name
    for (const m of row) expect(m.name).toContain(KEYS[m.name]!);
    // pride sand is the striped one, fire and lava give light
    expect(row.filter((m) => m.striped).map((m) => m.name)).toEqual(["pride sand"]);
    expect(row.filter((m) => m.light).map((m) => m.name)).toEqual(["lava", "fire"]);
});

test("a whole flag is two high to three wide, grows with the brush, and fits the world", () => {
    expect(flagSize(0, 400, 250)).toEqual({ wide: 12, high: 8 });
    expect(flagSize(4, 400, 250)).toEqual({ wide: 36, high: 24 });
    expect(flagSize(24, 400, 250).high).toBe(104);
    // never more than half the world's height, nor wider than the world
    expect(flagSize(24, 400, 100).high).toBe(50);
    expect(flagSize(24, 60, 250).wide).toBeLessThanOrEqual(60);
});

test("a swatch is colored as the grid draws the cell: a shade moves the color, a stripe takes its flag's", () => {
    const palette = new Uint8Array(3072);
    palette.set([100, 100, 100, 255], 4);
    palette.set([40, 20, 0, 0], 1024 + 4);
    palette.set([0, 0, 0, 255], 8);
    palette.set([30, 30, 30, 1], 1024 + 8);
    palette.set([200, 10, 10, 255], 2048 + 5 * 4);
    expect(swatchColor(palette, 1, 128)).toEqual([100, 100, 100, 255]);
    expect(swatchColor(palette, 1, 255)).toEqual([120, 110, 100, 255]);
    expect(swatchColor(palette, 1, 0)).toEqual([80, 90, 100, 255]);
    // stripe 5, the slightest shade either way
    expect(swatchColor(palette, 2, 5 * 4)).toEqual([185, 0, 0, 255]);
    expect(swatchColor(palette, 2, 5 * 4 + 3)).toEqual([215, 25, 25, 255]);
});
