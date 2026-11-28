// What the sand mini's page needs of its engine, public/wasm/sand.wasm (built from the Rust crate in
// sand/ by `bun run wasm`): the functions it exports, where it is served from, how big a world to make
// for the space there is, how hard each material is poured, the order and keys of the row of
// materials, and how big a flag the flag brush lays. The scene is src/minis/sand.ts.

import { hasSimd } from "../mote/simd";

/** The functions of public/wasm/sand.wasm. sand/README.md says what each does. */
export interface Engine {
    memory: WebAssembly.Memory;
    create(width: number, height: number, seedLow: number, seedHigh: number): number;
    step(count: number): void;
    paint(material: number, x0: number, y0: number, x1: number, y1: number, radius: number, fill: number, replace: number): void;
    paint_striped(material: number, x0: number, y0: number, x1: number, y1: number, radius: number, fill: number, first: number, count: number): void;
    flag(material: number, x: number, y: number, wide: number, high: number, first: number, count: number): void;
    flood(material: number, x: number, y: number, most: number): number;
    turn(): void;
    shake(by: number): void;
    blow(x0: number, y0: number, x1: number, y1: number, radius: number): void;
    still(): void;
    windy(): number;
    winds(): number;
    gusts(): number;
    gust(): number;
    heard(kind: number): number;
    set_levelling(on: number): void;
    set_flow(on: number): void;
    set_slow(parts: number): void;
    part(): number;
    rewritten(fresh: number): void;
    clear(): void;
    cells(): number;
    stride(): number;
    border(): number;
    width(): number;
    height(): number;
    awake(): number;
    changed_from(): number;
    changed_to(): number;
    band_rows(): number;
    band_changed(band: number): number;
    /** The first and last column changed in a band since the page last drew, or -1 when none has. */
    band_from(band: number): number;
    band_to(band: number): number;
    forget_changed(): void;
    set_sleeping(on: number): void;
    set_order(phases: number): void;
    set_edges(open: number): void;
    count(material: number): number;
    fingerprint(part: number): number;
    steps(): number;
    material_count(): number;
    name(material: number): number;
    name_length(material: number): number;
    paintable(material: number): number;
    kind(material: number): number;
    palette(): number;
}

/** Where the built engine is served from: built with WebAssembly SIMD, and without, for older browsers. */
export const ENGINE = "/wasm/sand.wasm";
export const SCALAR_ENGINE = "/wasm/sand-scalar.wasm";

/** The engine this browser can run. Both builds give the same world to the byte. */
export const engineAddress = (): string => (hasSimd() ? ENGINE : SCALAR_ENGINE);

/** Starts an engine from the module's bytes. It needs nothing from the page. */
export async function start(bytes: ArrayBuffer): Promise<Engine> {
    const { instance } = await WebAssembly.instantiate(bytes, {});
    return instance.exports as unknown as Engine;
}

/** How a material moves, by the number `kind` gives. */
export const KINDS = ["empty", "solid", "powder", "liquid", "gas", "void", "fire", "bolt"] as const;

/** A material the brush can pour. */
export interface Material {
    number: number;
    name: string;
    kind: (typeof KINDS)[number];
    /** Its shade is a stripe's color, given by the brush: pride sand. */
    striped: boolean;
    /** It gives light, as hot as it is: fire and lava. */
    light: boolean;
}

/** The materials the brush is offered, in the engine's order, read from its table. */
export function materials(engine: Engine): Material[] {
    const found: Material[] = [];
    const palette = new Uint8Array(engine.memory.buffer, engine.palette(), 2048);
    for (let number = 0; number < engine.material_count(); number++) {
        if (!engine.paintable(number)) continue;
        const name = new TextDecoder().decode(new Uint8Array(engine.memory.buffer, engine.name(number), engine.name_length(number)));
        // how it is drawn is the fourth byte of its second row: 1 for a stripe's color, 2 for light
        const drawn = palette[1024 + number * 4 + 3]!;
        found.push({ number, name, kind: KINDS[engine.kind(number)] ?? "solid", striped: (drawn & 1) === 1, light: (drawn & 2) === 2 });
    }
    return found;
}

/** The order of the row of materials: powders, liquids, solids, gases, then fire and lightning, so like things sit together. */
const GROUPS: Material["kind"][] = ["powder", "liquid", "solid", "gas", "fire", "bolt"];

/** The materials in the row's order, each kind together and in the engine's order within it. */
export function inRow(offered: Material[]): Material[] {
    const rank = (material: Material) => (GROUPS.indexOf(material.kind) + GROUPS.length + 1) % (GROUPS.length + 1);
    return [...offered].sort((a, b) => rank(a) - rank(b) || a.number - b.number);
}

/**
 * The key that picks each material, a letter of its name, and E for erasing. Where the first letter
 * is taken another of its name is used: oil is I, wood O, ice C, steam M, smoke K, mud U, snow N and
 * lightning H. Every letter of salt, of cloud and of glass is another's, so salt is X, cloud Y and glass B
 * (a bottle); G is slow motion.
 */
export const KEYS: Record<string, string> = {
    sand: "s",
    dirt: "d",
    "pride sand": "p",
    water: "w",
    oil: "i",
    lava: "l",
    acid: "a",
    stone: "t",
    wood: "o",
    ice: "c",
    steam: "m",
    smoke: "k",
    fire: "f",
    snow: "n",
    salt: "x",
    mud: "u",
    glass: "b",
    cloud: "y",
    lightning: "h",
    erase: "e",
};

/** What a key pressed inside the mini asks for. */
export type KeyAction = { pick: string } | "larger" | "smaller" | "pause" | "slow" | "nearer" | "farther" | "all";

/**
 * What a key pressed anywhere inside the mini does: a material's letter picks it, the brackets size the
 * brush, Space pauses, G turns slow motion on and off, plus and minus bring the view nearer and farther, and Home shows the whole world.
 * `on` is where the keyboard is: the canvas, whose Space Mote already turns into
 * pausing; a button, whose Space would otherwise press it again; a slider; or a box of text, where a
 * letter is typed and nothing else happens.
 */
export function keyAction(key: string, on: "canvas" | "button" | "slider" | "text"): KeyAction | undefined {
    if (on === "text") return undefined;
    const lower = key.toLowerCase();
    if (lower === "[") return "smaller";
    if (lower === "]") return "larger";
    if (key === " ") return on === "canvas" ? undefined : "pause";
    if (lower === "g") return "slow";
    if (key === "+" || key === "=") return "nearer";
    if (key === "-") return "farther";
    // on the slider Home is the slider's own: its least
    if (key === "Home") return on === "slider" ? undefined : "all";
    if (Object.values(KEYS).includes(lower)) return { pick: lower };
    return undefined;
}

/** How much of the time that passes the world is given while slow motion is on. */
/** In slow motion each step is taken in this many parts, one a frame, what falls moving its share of the way in each. */
export const SLOW = 4;

/** How wide a cell is, in CSS pixels, before it is rounded to whole device pixels. */
export const CELL = 1;

/**
 * How many cells across the world has where the first page, at two CSS pixels a cell, had one. The
 * brush, the held pour and the flag are scaled by it, so that a gesture pours as large a part of the
 * picture as it did with coarser grains.
 */
export const FINER = 2 / CELL;

/** How many cells either side of its line a brush of `size` on the slider pours: its size in the first page's cells, scaled; none for lightning, which is one bolt. */
export const brushCells = (size: number, of?: Pick<Material, "kind">): number => (of?.kind === "bolt" ? 0 : Math.round(size * FINER));

/** How many grains a step a powder held still pours, for each cell of the brush's width. */
export const HELD = { powder: 2 };

/**
 * How many cells in 100 a stroke fills, of what is empty under the brush. A press, and a brush drawn
 * along, lay the brush's own shape: stone and a liquid whole, a powder 45 in 100, so it is grainy;
 * pride sand along a line whole, so its stripes fall whole. Held still after the press, a liquid goes
 * on being laid whole, and since what was laid has fallen out of the brush by the next step, it pours
 * as a stream as wide as the brush; a powder comes at `HELD.powder` grains a step for each cell of the
 * brush's width, which a heap carries away as fast as it lands (poured as a liquid is, sand backs up
 * under the brush as a pillar). For a large brush that share is under one in 100, and it is given as
 * it is, not rounded: the scene carries what is left over to the next step (`sand.ts`), since the
 * engine fills by whole cells in 100. Before 17 Nov 2026 a held brush trickled whatever its size and
 * a drawn one laid 45 in 100 of everything, so water came as a cloud of drops.
 */
export function fillOf(material: Pick<Material, "kind" | "striped" | "light">, still = false, radius = 0): number {
    // lightning is one bolt at the pointer, whatever the brush's size (`brushCells`)
    if (material.kind === "solid" || material.kind === "bolt" || material.kind === "liquid") return 100;
    if (material.striped && !still) return 100;
    if (still && material.kind === "powder") return Math.min(45, (100 * HELD.powder * (2 * radius + 1)) / (Math.PI * (radius + 0.5) ** 2));
    return 45;
}

/**
 * The world the page makes: far larger than the stage, which is a view onto it that is moved and
 * zoomed. Smaller where the stage is a phone's, which holds less and shows less of it at once.
 */
export const WORLD = { wide: { columns: 2400, rows: 1200 }, narrow: { columns: 1200, rows: 900 } };

/** The world for a stage `wide` CSS pixels across. */
export const worldSize = (wide: number): { columns: number; rows: number } => (wide >= 600 ? WORLD.wide : WORLD.narrow);

/** A view onto a world: the cell at the middle of the canvas (a part of a cell counts), and how many of the canvas's own pixels a cell is drawn. */
export interface View {
    x: number;
    y: number;
    zoom: number;
}

/** The sizes of a world in cells and of the canvas it is seen through in its own pixels. */
export interface Frame {
    columns: number;
    rows: number;
    wide: number;
    high: number;
}

/**
 * The zooms a view stops at, nearest first: 8, 6, 4, 3, 2, 1, a half and a quarter of `base` (the
 * pixels of a cell at one CSS pixel a cell), down to the zoom that shows the whole world and no
 * further. That last is a whole number of pixels where the world is smaller than the canvas, so its
 * grains stay square and sharp.
 */
export function zoomStops(base: number, { columns, rows, wide, high }: Frame): number[] {
    const all = Math.min(wide / columns, high / rows);
    const least = all >= 1 ? Math.floor(all) : all;
    return [...[8, 6, 4, 3, 2, 1, 0.5, 0.25].map((times) => times * base).filter((zoom) => zoom > least * 1.001), least];
}

/**
 * A view kept to its world: no nearer than the first stop and no farther than the last, and moved so
 * that the canvas shows no more of what lies past the world's edges than it must; where the world is
 * narrower or lower than the canvas at that zoom, it sits in the middle of it.
 */
export function keptView(view: View, base: number, frame: Frame): View {
    const stops = zoomStops(base, frame);
    const zoom = Math.max(stops[stops.length - 1]!, Math.min(stops[0]!, view.zoom));
    const along = (at: number, cells: number, pixels: number) => {
        const half = pixels / zoom / 2;
        return cells <= 2 * half ? cells / 2 : Math.max(half, Math.min(cells - half, at));
    };
    return { x: along(view.x, frame.columns, frame.wide), y: along(view.y, frame.rows, frame.high), zoom };
}

/** The point of the world under a point of the canvas, in cells, given in the canvas's own pixels. */
export function worldAt(view: View, px: number, py: number, { wide, high }: Pick<Frame, "wide" | "high">): [x: number, y: number] {
    return [view.x + (px - wide / 2) / view.zoom, view.y + (py - high / 2) / view.zoom];
}

/** The view at `zoom` that keeps the point of the world `[x, y]` under the canvas's point (px, py): zooming toward the pointer, and dragging the world by it. */
export function viewWith(zoom: number, [x, y]: [number, number], px: number, py: number, { wide, high }: Pick<Frame, "wide" | "high">): View {
    return { x: x - (px - wide / 2) / zoom, y: y - (py - high / 2) / zoom, zoom };
}

/** The stop after `zoom` going nearer (`by` 1) or farther (-1), or `zoom` itself at the last. */
export function nextStop(zoom: number, by: 1 | -1, stops: number[]): number {
    const nearer = stops.filter((stop) => stop > zoom * 1.001);
    const farther = stops.filter((stop) => stop < zoom * 0.999);
    return by > 0 ? (nearer[nearer.length - 1] ?? zoom) : (farther[0] ?? zoom);
}

/**
 * The block of pride sand the flag brush lays for a brush of `size` on the slider, in cells: two high
 * to three wide, as most flags are, from 8 of the first page's cells high for the smallest brush to
 * 104 for the largest (`finer` times as many cells now), and never more than half the world's height
 * or its width.
 */
export function flagSize(size: number, columns: number, rows: number, finer = FINER): { wide: number; high: number } {
    const high = Math.max(2, Math.min(Math.round((8 + 4 * size) * finer), Math.floor(rows / 2), Math.floor((columns * 2) / 3)));
    return { wide: Math.round((high * 3) / 2), high };
}

/** The steps the world takes in a second, whatever the screen's refresh rate. */
export const STEPS_PER_SECOND = 60;

/**
 * The color of a cell of `material` with this shade, red, green, blue and opacity from 0 to 255, as
 * Mote's grid draws it from `palette` (src/mote/cells.ts): the material's color moved lighter or
 * darker by its shade, or for a striped material the stripe's color from the third row, each grain a
 * step lighter or darker by the shade's lowest two bits, toward white or black by up to the shade
 * range's red. What the row of materials draws each swatch with.
 */
export function swatchColor(palette: Uint8Array, material: number, shade: number): [number, number, number, number] {
    const base = palette.subarray(material * 4, material * 4 + 4);
    const vary = palette.subarray(1024 + material * 4, 1024 + material * 4 + 4);
    if ((vary[3]! & 1) === 1) {
        const stripe = palette.subarray(2048 + (shade >> 2) * 4, 2048 + (shade >> 2) * 4 + 3);
        const by = ((shade & 3) / 1.5 - 1) * (vary[0]! / 255);
        const channel = (k: number) => Math.max(0, Math.min(255, Math.round(by < 0 ? stripe[k]! * (1 + by) : stripe[k]! + (255 - stripe[k]!) * by)));
        return [channel(0), channel(1), channel(2), base[3]!];
    }
    const by = shade / 255 - 0.5;
    const channel = (k: number) => Math.max(0, Math.min(255, Math.round(base[k]! + by * vary[k]!)));
    return [channel(0), channel(1), channel(2), base[3]!];
}
