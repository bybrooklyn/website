// What the sand mini's built engine, public/wasm/sand.wasm and its twin without SIMD, is held to
// from the page's side: it loads with nothing given to it, stays small, offers the materials of its
// table, keeps every material through any number of steps, and makes the same busy world, to the byte,
// as the crate's own test (sand/tests/unchanged.rs) makes natively. Also what grains.ts works out for
// the page. `bun run wasm` builds the modules; `bun test` runs this.

import { expect, test } from "bun:test";
import { brushCells, engineAddress, fillOf, flagSize, HELD, inRow, keptView, keyAction, KEYS, materials, nextStop, start, swatchColor, viewWith, worldAt, worldSize, zoomStops, type Engine, type Material } from "./grains";

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
    const native: [number, number] = [0x70b648b9, 0x142265d4];
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
    expect(offered.map((m) => `${m.name} ${m.kind}`)).toEqual(["sand powder", "water liquid", "stone solid", "dirt powder", "steam gas", "wood solid", "oil liquid", "lava liquid", "ice solid", "smoke gas", "fire fire", "acid liquid", "pride sand powder", "snow powder", "salt powder", "mud liquid", "glass solid", "cloud gas", "lightning bolt"]);
    // wet dirt, burning wood, ash, brine and lightning's flash are made by reactions, not poured
    expect(offered.some((m) => ["wet dirt", "ember", "ash", "brine", "flash"].includes(m.name))).toBe(false);
    const of = (kind: Material["kind"], striped = false, light = false) => ({ kind, striped, light });
    expect(fillOf(of("fire"))).toBeLessThan(100);
    expect(fillOf(of("solid"))).toBe(100);
    expect(fillOf(of("powder"))).toBeLessThan(100);
    // a powder held still pours ten grains a step of the first page's size, and lava nine cells, whatever the brush's size once it is large enough, and water two cells for each of its width; pride sand along a line is laid whole
    expect(HELD).toEqual({ powder: 40, lava: 36, liquid: 2 });
    for (const radius of [8, 16, 24, 32, 48]) {
        const disc = Math.PI * (radius + 0.5) ** 2;
        expect((fillOf(of("powder"), true, radius) / 100) * disc).toBeCloseTo(HELD.powder, 6);
        expect((fillOf(of("liquid", false, true), true, radius) / 100) * disc).toBeCloseTo(HELD.lava, 6);
        expect((fillOf(of("liquid"), true, radius) / 100) * disc).toBeCloseTo(2 * (2 * radius + 1), 6);
    }
    // a small brush fills no more than 45 in 100
    expect(fillOf(of("powder"), true, 0)).toBe(45);
    expect(fillOf(of("liquid"), true, 1)).toBe(45);
    expect(fillOf(of("solid"), true)).toBe(100);
    // lightning is one bolt at the pointer, whatever the brush's size
    expect(fillOf(of("bolt", false, true), true, 8)).toBe(100);
    expect(brushCells(8, of("bolt"))).toBe(0);
    expect(brushCells(8, of("powder"))).toBe(16);
    // lava drawn along a line is poured thick, fire is not
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

test("the world is far larger than the stage, and a phone's is smaller", () => {
    expect(worldSize(748)).toEqual({ columns: 2400, rows: 1200 });
    expect(worldSize(350)).toEqual({ columns: 1200, rows: 900 });
});

test("a view stops at whole sizes of a grain down to the one that shows the whole world, and is kept to the world", () => {
    // the stage at her window, a pixel to a CSS pixel: the whole world is 0.3117 of a pixel a cell
    const frame = { columns: 2400, rows: 1200, wide: 748, high: 423 };
    const stops = zoomStops(1, frame);
    expect(stops.slice(0, 7)).toEqual([8, 6, 4, 3, 2, 1, 0.5]);
    expect(stops[stops.length - 1]).toBeCloseTo(748 / 2400, 6);
    // a quarter is farther out than the whole world there, so it is no stop; on a larger canvas it is one
    expect(stops.length).toBe(8);
    expect(zoomStops(1, { ...frame, wide: 400, high: 200 })).toContain(0.25);
    // two pixels to a CSS pixel: the same stops in CSS pixels, twice as many of the canvas's
    expect(zoomStops(2, { ...frame, wide: 1496, high: 846 }).slice(0, 3)).toEqual([16, 12, 8]);
    // a small world, as an old link opens: the farthest stop is a whole number of pixels a cell
    expect(zoomStops(1, { columns: 358, rows: 256, wide: 748, high: 423 })).toEqual([8, 6, 4, 3, 2, 1]);
    // nearer and farther by one stop, and no further than the ends
    expect(nextStop(1, 1, stops)).toBe(2);
    expect(nextStop(1, -1, stops)).toBe(0.5);
    expect(nextStop(8, 1, stops)).toBe(8);
    expect(nextStop(stops[7]!, -1, stops)).toBe(stops[7]!);
    expect(nextStop(1.4, 1, stops)).toBe(2);
    expect(nextStop(1.4, -1, stops)).toBe(1);

    // kept to the world: the canvas never shows past an edge it need not
    expect(keptView({ x: 0, y: 0, zoom: 1 }, 1, frame)).toEqual({ x: 374, y: 211.5, zoom: 1 });
    expect(keptView({ x: 5000, y: 5000, zoom: 1 }, 1, frame)).toEqual({ x: 2400 - 374, y: 1200 - 211.5, zoom: 1 });
    expect(keptView({ x: 900, y: 700, zoom: 2 }, 1, frame)).toEqual({ x: 900, y: 700, zoom: 2 });
    // no nearer than the first stop or farther than the last; and at the last the world sits in the middle
    expect(keptView({ x: 900, y: 700, zoom: 50 }, 1, frame).zoom).toBe(8);
    const all = keptView({ x: 100, y: 100, zoom: 0.01 }, 1, frame);
    expect(all.zoom).toBeCloseTo(748 / 2400, 6);
    expect([all.x, all.y]).toEqual([1200, 600]);

    // the point of the world under a point of the canvas, and the view that keeps it there at another zoom
    const view = { x: 900, y: 700, zoom: 2 };
    const under = worldAt(view, 100, 50, frame);
    expect(under).toEqual([900 + (100 - 374) / 2, 700 + (50 - 211.5) / 2]);
    const nearer = viewWith(4, under, 100, 50, frame);
    expect(worldAt(nearer, 100, 50, frame)).toEqual(under);
    // dragging: the same point of the world under the pointer wherever it goes
    const dragged = viewWith(2, under, 300, 200, frame);
    expect(worldAt(dragged, 300, 200, frame)).toEqual(under);
});

test("a key works wherever the keyboard is in the mini: on the canvas, a swatch just clicked, or the slider", () => {
    for (const on of ["canvas", "button", "slider"] as const) {
        expect(keyAction("f", on)).toEqual({ pick: "f" });
        expect(keyAction("F", on)).toEqual({ pick: "f" });
        expect(keyAction("]", on)).toBe("larger");
        expect(keyAction("[", on)).toBe("smaller");
    }
    // Space pauses from a swatch rather than pressing it again; on the canvas Mote's own key does it
    expect(keyAction(" ", "button")).toBe("pause");
    expect(keyAction(" ", "canvas")).toBeUndefined();
    // a letter that is no material's, and anything typed into a box of text, does nothing
    expect(keyAction("q", "button")).toBeUndefined();
    expect(keyAction("f", "text")).toBeUndefined();
});

test("the row of materials puts like things together and every material has its own key", async () => {
    const engine = await load(simd);
    const row = inRow(materials(engine));
    expect(row.map((m) => m.name)).toEqual(["sand", "dirt", "pride sand", "snow", "salt", "water", "oil", "lava", "acid", "mud", "stone", "wood", "ice", "glass", "steam", "smoke", "cloud", "fire", "lightning"]);
    const keys = [...row.map((m) => KEYS[m.name]), KEYS.erase];
    expect(keys.every((key) => key && key.length === 1)).toBe(true);
    expect(new Set(keys).size).toBe(keys.length);
    // each a letter of its name, but for salt and cloud, whose every letter is another's
    for (const m of row) if (m.name !== "salt" && m.name !== "cloud") expect(m.name).toContain(KEYS[m.name]!);
    for (const name of ["salt", "cloud"]) expect([...name].every((letter) => keys.includes(letter))).toBe(true);
    // pride sand is the striped one; fire, lava and lightning give light
    expect(row.filter((m) => m.striped).map((m) => m.name)).toEqual(["pride sand"]);
    expect(row.filter((m) => m.light).map((m) => m.name)).toEqual(["lava", "fire", "lightning"]);
});

test("a whole flag is two high to three wide, grows with the brush, and fits the world", () => {
    // at the first page's size of cell
    expect(flagSize(0, 400, 250, 1)).toEqual({ wide: 12, high: 8 });
    expect(flagSize(4, 400, 250, 1)).toEqual({ wide: 36, high: 24 });
    expect(flagSize(24, 400, 250, 1).high).toBe(104);
    // and with cells half as wide, twice as many of them
    expect(flagSize(4, 800, 500)).toEqual({ wide: 72, high: 48 });
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
    // stripe 5, its grains a step darker toward black or lighter toward white, by up to the range's red (30 in 255)
    expect(swatchColor(palette, 2, 5 * 4)).toEqual([176, 9, 9, 255]);
    expect(swatchColor(palette, 2, 5 * 4 + 3)).toEqual([206, 39, 39, 255]);
    // white only darkens
    palette.set([255, 255, 255, 255], 2048 + 6 * 4);
    expect(swatchColor(palette, 2, 6 * 4 + 3)).toEqual([255, 255, 255, 255]);
    expect(swatchColor(palette, 2, 6 * 4)).toEqual([225, 225, 225, 255]);
});
