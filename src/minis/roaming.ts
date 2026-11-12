// What the generalist mini and its training worker share, with nothing to do with drawing: the
// engine's exported functions (walker/README.md, "The generalist", says what each does), a world's
// recipe as the page holds it and as a link carries it, and turning a typed seed into a number.
// generalist.test.ts holds these to their word, and the engine to the native one's numbers.

import { hasSimd } from "./walking";

/** The functions of public/wasm/generalist.wasm. A function giving a list gives its pointer; `length` then gives how many f32 it holds. */
export interface Engine {
    memory: WebAssembly.Memory;
    length(): number;
    create(legs: number, seed: number, difficulty: number, ground: number, hazards: number, boxes: number, moving: number, population: number, hidden: number, layers: number, memory: number, seconds: number, brainSeed: number): number;
    train(runs: number): number;
    generation(): number;
    generation_runs(): number;
    best_score(): number;
    best_distance(): number;
    weights_length(): number;
    population_length(): number;
    senses_length(): number;
    actions_length(): number;
    rays_length(): number;
    best_weights(): number;
    population_weights(): number;
    history_best(): number;
    history_mean(): number;
    history_distance(): number;
    evaluate_room(count: number): number;
    evaluate(count: number): number;
    evaluated(): number;
    member_scored(index: number): number;
    record(index: number, score: number, distance: number): number;
    weights_room(): number;
    weights_load(): number;
    show_reset(): void;
    show_step(seconds: number): number;
    show_over(): number;
    show_end(): number;
    show_distance(): number;
    show_furthest(): number;
    show_score(): number;
    show_seconds(): number;
    legs_length(): number;
    show_hop(): number;
    show_bodies(): number;
    show_things(): number;
    show_rays(): number;
    ray_angles(): number;
    show_push(x: number, y: number, impulseX: number, impulseY: number): number;
    show_hold(x: number, y: number): void;
    show_drop(): void;
    land_ground(until: number, from: number): number;
    land_blocks(from: number): number;
    land_hazards(from: number): number;
    picture(count: number): number;
    envs_create(count: number, alike: number): number;
    envs_actions(): number;
    envs_step(steps: number): number;
    envs_observations(): number;
    envs_rewards(): number;
    envs_done(): number;
}

/** Where the built engine is served from: built with WebAssembly SIMD, and without, for older browsers. */
export const ENGINE = "/wasm/generalist.wasm";
export const SCALAR_ENGINE = "/wasm/generalist-scalar.wasm";

/** The engine this browser can run. Both builds give the same numbers to the bit; SIMD is faster. */
export const engineAddress = (): string => (hasSimd() ? ENGINE : SCALAR_ENGINE);

/** Starts an engine from the module's bytes. It needs nothing from the page. */
export async function start(bytes: ArrayBuffer): Promise<Engine> {
    const { instance } = await WebAssembly.instantiate(bytes, {});
    return instance.exports as unknown as Engine;
}

/** A copy of the list a call just gave, out of the engine's memory. Taken fresh each time, since memory can grow. */
export const list = (engine: Engine, pointer: number): Float32Array => new Float32Array(engine.memory.buffer, pointer, engine.length()).slice();

/** A copy of `length` f32 out of the engine's memory. */
export const read = (engine: Engine, pointer: number, length: number): Float32Array => new Float32Array(engine.memory.buffer, pointer, length).slice();

/** Writes f32 into room the engine made. */
export const write = (engine: Engine, pointer: number, values: ArrayLike<number>) => new Float32Array(engine.memory.buffer, pointer, values.length).set(values);

/** How many brains a generation has, how big a brain is, and how long a run lasts at most, in seconds. */
export const POPULATION = 32;
export const BRAIN = { hidden: 16, layers: 2, memory: 4 };
export const SECONDS = 30;

/** The four kinds of thing a world can have, as the engine orders them, with the page's words. */
export type Kind = "ground" | "hazards" | "boxes" | "moving";
export const KINDS: { kind: Kind; name: string; says: string }[] = [
    { kind: "ground", name: "ground", says: "platforms, ledges, drops, stairs and gaps" },
    { kind: "hazards", name: "hazards", says: "water and spikes" },
    { kind: "boxes", name: "boxes", says: "boxes to push and climb" },
    { kind: "moving", name: "moving", says: "moving platforms and see-saws" },
];

export type Legs = 2 | 4;
export const LEGS: Legs[] = [2, 4];

/** A world and the creature in it, as the page holds them: the seed as typed, how hard and each kind's amount from 0 to 100, and which kinds are switched on. */
export interface Recipe {
    seed: string;
    hard: number;
    amounts: Record<Kind, number>;
    on: Record<Kind, boolean>;
    legs: Legs;
}

export const DEFAULT_RECIPE: Recipe = { seed: "meadow", hard: 20, amounts: { ground: 60, hazards: 40, boxes: 40, moving: 40 }, on: { ground: true, hazards: true, boxes: true, moving: true }, legs: 2 };

/**
 * The number a typed seed stands for: a whole number from 0 to 4294967295 as itself, anything else
 * hashed (FNV-1a over its UTF-8 bytes), so a word makes the same world in every browser.
 */
export function seedNumber(text: string): number {
    const trimmed = text.trim();
    if (/^\d{1,10}$/.test(trimmed) && Number(trimmed) <= 0xffffffff) return Number(trimmed);
    let hash = 0x811c9dc5;
    for (const byte of new TextEncoder().encode(trimmed.toLowerCase())) hash = Math.imul(hash ^ byte, 0x01000193) >>> 0;
    return hash >>> 0;
}

/** Words for a new seed, picked by "another": short, plain, easy to say and share. */
const WORDS = ["meadow", "harbour", "pebble", "lantern", "thistle", "orchard", "glacier", "marble", "willow", "copper", "ember", "puddle", "bramble", "cinder", "fjord", "hollow", "juniper", "kettle", "lagoon", "moss", "nettle", "otter", "quarry", "ripple", "saffron", "tundra", "umber", "velvet", "wren", "yarrow", "zephyr", "acorn", "basalt", "canyon", "dune", "fern"];

/** Another seed word, not the one given, from a number from 0 to 1. */
export function anotherSeed(current: string, roll: number): string {
    const choices = WORDS.filter((word) => word !== current);
    return choices[Math.min(choices.length - 1, Math.floor(roll * choices.length))]!;
}

/** The engine's numbers for a recipe: the seed, the difficulty from 0 to 1, and each kind's amount from 0 to 1, 0 if switched off. */
export const engineRecipe = (recipe: Recipe): { seed: number; difficulty: number; amounts: [number, number, number, number] } => ({
    seed: seedNumber(recipe.seed),
    difficulty: recipe.hard / 100,
    amounts: KINDS.map(({ kind }) => (recipe.on[kind] ? recipe.amounts[kind] / 100 : 0)) as [number, number, number, number],
});

/** Whether something kept or read from a link is a recipe the mini can use. */
export function valid(recipe: unknown): recipe is Recipe {
    const r = recipe as Partial<Recipe> | null;
    const percent = (n: unknown) => typeof n === "number" && Number.isFinite(n) && n >= 0 && n <= 100;
    return !!r && typeof r.seed === "string" && r.seed.trim().length > 0 && r.seed.length <= 40 && percent(r.hard) && LEGS.includes(r.legs as Legs) && KINDS.every(({ kind }) => percent(r.amounts?.[kind]) && typeof r.on?.[kind] === "boolean");
}

/** A recipe as the parts of a link: so a world is a link. */
export function linkParts(recipe: Recipe): [string, string][] {
    const off = KINDS.filter(({ kind }) => !recipe.on[kind]).map(({ kind }) => kind);
    return [["seed", recipe.seed], ["hard", String(recipe.hard)], ...KINDS.map(({ kind }): [string, string] => [kind, String(recipe.amounts[kind])]), ["off", off.join(",")], ["legs", String(recipe.legs)]];
}

/** The names a link to a world uses. */
export const LINK_NAMES = ["seed", "hard", ...KINDS.map(({ kind }) => kind), "off", "legs"];

/** A recipe back from a link, filling what it leaves out from `otherwise`, or null if it has no seed or anything in it is not one the mini can use. */
export function fromLink(get: (name: string) => string | null, otherwise: Recipe): Recipe | null {
    const seed = get("seed");
    if (seed === null) return null;
    const number = (name: string, fallback: number) => (get(name) === null ? fallback : Number(get(name)));
    const off = (get("off") ?? "").split(",").filter(Boolean);
    const recipe = {
        seed,
        hard: number("hard", otherwise.hard),
        amounts: Object.fromEntries(KINDS.map(({ kind }) => [kind, number(kind, otherwise.amounts[kind])])) as Record<Kind, number>,
        on: Object.fromEntries(KINDS.map(({ kind }) => [kind, get("off") === null ? otherwise.on[kind] : !off.includes(kind)])) as Record<Kind, boolean>,
        legs: number("legs", otherwise.legs) as Legs,
    };
    return valid(recipe) ? recipe : null;
}

/** What each ray can see, as the engine numbers them. */
export const SEEN = ["nothing", "ground", "edge", "box", "hazard", "moving", "food"] as const;
