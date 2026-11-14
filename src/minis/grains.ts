// What the sand mini's page needs of its engine, public/wasm/sand.wasm (built from the Rust crate in
// sand/ by `bun run wasm`): the functions it exports, where it is served from, how big a world to make
// for the space there is, how hard each material is poured, the order and keys of the row of
// materials, and how big a flag the flag brush lays. The scene is src/minis/sand.ts.

import { hasSimd } from "./walking";

/** The functions of public/wasm/sand.wasm. sand/README.md says what each does. */
export interface Engine {
    memory: WebAssembly.Memory;
    create(width: number, height: number, seedLow: number, seedHigh: number): number;
    step(count: number): void;
    paint(material: number, x0: number, y0: number, x1: number, y1: number, radius: number, fill: number, replace: number): void;
    paint_striped(material: number, x0: number, y0: number, x1: number, y1: number, radius: number, fill: number, first: number, count: number): void;
    flag(material: number, x: number, y: number, wide: number, high: number, first: number, count: number): void;
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
export const KINDS = ["empty", "solid", "powder", "liquid", "gas", "void", "fire"] as const;

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

/** The order of the row of materials: powders, liquids, solids, gases, then fire, so like things sit together. */
const GROUPS: Material["kind"][] = ["powder", "liquid", "solid", "gas", "fire"];

/** The materials in the row's order, each kind together and in the engine's order within it. */
export function inRow(offered: Material[]): Material[] {
    const rank = (material: Material) => (GROUPS.indexOf(material.kind) + GROUPS.length + 1) % (GROUPS.length + 1);
    return [...offered].sort((a, b) => rank(a) - rank(b) || a.number - b.number);
}

/**
 * The key that picks each material, a letter of its name, and E for erasing. Where the first letter
 * is taken another of its name is used: oil is I, wood O, ice C, steam M and smoke K.
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
    erase: "e",
};

/**
 * How many cells in 100 a stroke fills: what falls is poured, so it trickles; stone is laid solid.
 * Lava is poured thick, so that it lands as a molten blob and not as drops that each harden alone.
 * Pride sand drawn along a line is laid solid too (the engine lays each part of its ribbon once), so
 * its stripes fall whole. A brush of `radius` held still pours again every step into the cells that
 * have fallen out of it, about four rows of it a step: a powder is then poured at about three grains a
 * step whatever the brush's size, which is what the slopes of a heap carry away. Poured faster, sand
 * stacks up under the brush into a pillar, which the engine's grains wear down only from its corners.
 */
export function fillOf(material: Pick<Material, "kind" | "striped" | "light">, still = false, radius = 0): number {
    if (material.kind === "solid" || (material.kind === "liquid" && material.light)) return 100;
    if (material.striped && !still) return 100;
    if (still && material.kind === "powder") return Math.max(1, Math.min(45, Math.round(300 / (4 * (2 * radius + 1)))));
    return 45;
}

/** The largest world the engine is asked for, as the plan sets for a desktop. */
export const MOST = { columns: 1024, rows: 576 };

/** How wide a cell is, in CSS pixels, before it is rounded to whole device pixels. */
export const CELL = 2;

/**
 * How many cells across and down a world has for a canvas `wide` by `high` CSS pixels at `ratio`
 * device pixels to a CSS pixel: `cell` CSS pixels a cell, rounded to whole device pixels so grains
 * are square and sharp, or larger where that would make more than `MOST`.
 */
export function worldFor(wide: number, high: number, ratio: number, cell = CELL): { columns: number; rows: number } {
    const [across, down] = [Math.floor(wide * ratio), Math.floor(high * ratio)];
    const scale = Math.max(1, Math.round(cell * ratio), Math.ceil(across / MOST.columns), Math.ceil(down / MOST.rows));
    return { columns: Math.max(1, Math.floor(across / scale)), rows: Math.max(1, Math.floor(down / scale)) };
}

/**
 * The block of pride sand the flag brush lays for a brush of `radius`, in cells: two high to three
 * wide, as most flags are, from 8 cells high for the smallest brush to 104 for the largest, and
 * never more than half the world's height or its width.
 */
export function flagSize(radius: number, columns: number, rows: number): { wide: number; high: number } {
    const high = Math.max(2, Math.min(8 + 4 * radius, Math.floor(rows / 2), Math.floor((columns * 2) / 3)));
    return { wide: Math.round((high * 3) / 2), high };
}

/** The steps the world takes in a second, whatever the screen's refresh rate. */
export const STEPS_PER_SECOND = 60;

/**
 * The color of a cell of `material` with this shade, red, green, blue and opacity from 0 to 255, as
 * Mote's grid draws it from `palette` (src/mote/cells.ts): the material's color moved lighter or
 * darker by its shade, or for a striped material the stripe's color from the third row, moved a
 * little by the shade's lowest two bits. What the row of materials draws each swatch with.
 */
export function swatchColor(palette: Uint8Array, material: number, shade: number): [number, number, number, number] {
    const base = palette.subarray(material * 4, material * 4 + 4);
    const vary = palette.subarray(1024 + material * 4, 1024 + material * 4 + 4);
    const striped = (vary[3]! & 1) === 1;
    const from = striped ? palette.subarray(2048 + (shade >> 2) * 4, 2048 + (shade >> 2) * 4 + 3) : base;
    const by = striped ? (shade & 3) / 3 - 0.5 : shade / 255 - 0.5;
    const channel = (k: number) => Math.max(0, Math.min(255, Math.round(from[k]! + by * vary[k]!)));
    return [channel(0), channel(1), channel(2), base[3]!];
}
