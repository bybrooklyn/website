// What the sand mini's page needs of its engine, public/wasm/sand.wasm (built from the Rust crate in
// sand/ by `bun run wasm`): the functions it exports, where it is served from, how big a world to make
// for the space there is, and how hard each material is poured. The scene is src/minis/sand.ts.

import { hasSimd } from "./walking";

/** The functions of public/wasm/sand.wasm. sand/README.md says what each does. */
export interface Engine {
    memory: WebAssembly.Memory;
    create(width: number, height: number, seedLow: number, seedHigh: number): number;
    step(count: number): void;
    paint(material: number, x0: number, y0: number, x1: number, y1: number, radius: number, fill: number, replace: number): void;
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
}

/** The materials the brush is offered, in the engine's order, read from its table. */
export function materials(engine: Engine): Material[] {
    const found: Material[] = [];
    for (let number = 0; number < engine.material_count(); number++) {
        if (!engine.paintable(number)) continue;
        const name = new TextDecoder().decode(new Uint8Array(engine.memory.buffer, engine.name(number), engine.name_length(number)));
        found.push({ number, name, kind: KINDS[engine.kind(number)] ?? "solid" });
    }
    return found;
}

/** How many cells in 100 a stroke fills: what falls is poured, so it trickles; stone is laid solid. */
export const fillOf = (kind: Material["kind"]): number => (kind === "solid" ? 100 : 45);

/** The largest world the engine is asked for, as the plan sets for a desktop. */
export const MOST = { columns: 1024, rows: 576 };

/**
 * How many cells across and down a world has for a canvas `wide` by `high` CSS pixels at `ratio`
 * device pixels to a CSS pixel: one CSS pixel a cell (in whole device pixels), or larger where that
 * would make more than `MOST`. A phone gets fewer cells, each of several device pixels.
 */
export function worldFor(wide: number, high: number, ratio: number): { columns: number; rows: number } {
    const [across, down] = [Math.floor(wide * ratio), Math.floor(high * ratio)];
    const scale = Math.max(1, Math.round(ratio), Math.ceil(across / MOST.columns), Math.ceil(down / MOST.rows));
    return { columns: Math.max(1, Math.floor(across / scale)), rows: Math.max(1, Math.floor(down / scale)) };
}

/** The steps the world takes in a second, whatever the screen's refresh rate. */
export const STEPS_PER_SECOND = 60;
