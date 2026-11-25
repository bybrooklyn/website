// What the generalist mini and its training worker share, with nothing to do with drawing: the
// engine's exported functions (walker/README.md, "The generalist", says what each does), a world's
// recipe as the page holds it and as a link carries it, and turning a typed seed into a number.
// generalist.test.ts holds these to their word, and the engine to the native one's numbers.

import { hasSimd } from "../mote/simd";
import type { Effort, Machine } from "./walking";

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
    show_bodies(): number;
    show_things(): number;
    show_rays(): number;
    ray_angles(): number;
    show_under(x: number, y: number): number;
    show_grab(x: number, y: number): number;
    show_hand(x: number, y: number): void;
    show_let_go(): void;
    show_held(): number;
    /** The food put out in the show's world, two f32 each: x and y. */
    show_food(): number;
    /** What the show's creature wants and where it looks, six f32: energy (-1 for one that does not eat), how strong its muscles are, just ate (fading from 1), resting (0 to 1), where its eye looks (radians from level ahead), pieces eaten in this run. */
    show_needs(): number;
    /** What the show's creature sensed at its last look, as its brain took it in (`senseLayout` says where each part is). */
    show_senses(): number;
    /** Drops a piece of food at (x, y), from where it falls; 1 if it did. */
    show_drop_food(x: number, y: number): number;
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
    practice_create(count: number, seed: number, stream: number): number;
    practice_update(): number;
    practice_local(): number;
    practice_weights(): number;
    practice_shares_room(workers: number): number;
    practice_weights_room(): number;
    practice_finish(workers: number): number;
    practice_updates(): number;
    practice_steps(): number;
    practice_difficulty(): number;
    practice_finished(): number;
    practice_state(): number;
    practice_running(): number;
    state_room(weights: number): number;
    running_room(): number;
    practice_load(): number;
    policy_load(): number;
    policy_off(): void;
    net_work(rounds: number, backward: number): number;
    show_rewards(): number;
    /** The brain on show as it last thought, laid out as `brainColumns` reads it, or for a brain with a pool as `brainKinds` reads it. */
    brain_picture(): number;
    /** Room for a learner's form, written before its state; 0 forgets one written. */
    form_room(length: number): number;
    /** The form of this worker's learner: its pool's shape and every read. */
    practice_form(): number;
    /** The brain practice is to have from the next practice_create or practice_load on. */
    brain_shape(memory: number, rhythm: number, mood: number, reads: number): void;
    /** Whether the brain adds and cuts its connections while it lives (1) or not (0), for practice from the next practice_create or practice_load on, and the policy on show at once. */
    brain_grow(on: number): void;
    /** The caps on the brain and the brain practice starts with: most memory, most rhythm, fewest and most reads; then memory, rhythm, mood, reads. */
    brain_caps(): number;
    /** Every connection into a neuron of the brain on show, by its number in the picture: three f32 each, from, weight, what it passed. */
    brain_reads(neuron: number): number;
    /** Drops a box at (x, y), from where it falls; 1 if it did. */
    show_drop_box(x: number, y: number): number;
    /** Sets the world's conditions (`Conditions`): the ground's grip, bounce and softness, gravity, the wind and the light. */
    show_conditions(grip: number, bounce: number, soft: number, gravity: number, wind: number, light: number): void;
    /** Switches the world changing by itself on (1) or off (0). */
    show_changing(on: number): void;
    /** The world as the creature meets it, eleven f32 (`worldNow` reads them). */
    show_world(): number;
    /** Room of exactly `length` f64 for the running numbers of a learner an older page kept. */
    running_room_of(length: number): number;
}

/**
 * The world's conditions as the engine takes them (walker/src/generalist/changes.rs): the ground's grip as a
 * share of the creature's own, how much it bounces, how soft it is, gravity in g, the wind in metres a
 * second squared (from behind more than 0), and the light from night (0) to day (1).
 */
export interface Conditions {
    grip: number;
    bounce: number;
    soft: number;
    gravity: number;
    wind: number;
    light: number;
}

/** The world as it always was, where every control rests. */
export const REST_CONDITIONS: Conditions = { grip: 1, bounce: 0, soft: 0, gravity: 1, wind: 0, light: 1 };

/** The kinds of ground a visitor chooses, each with what it does to the conditions. Firm is the rest. */
export type Ground = "firm" | "ice" | "sticky" | "bouncy" | "soft";
export const GROUNDS: { ground: Ground; text: string; conditions: Pick<Conditions, "grip" | "bounce" | "soft"> }[] = [
    { ground: "firm", text: "firm", conditions: { grip: 1, bounce: 0, soft: 0 } },
    { ground: "ice", text: "ice", conditions: { grip: 0.06, bounce: 0, soft: 0 } },
    { ground: "sticky", text: "sticky", conditions: { grip: 2.5, bounce: 0, soft: 0 } },
    { ground: "bouncy", text: "bouncy", conditions: { grip: 1, bounce: 0.75, soft: 0 } },
    { ground: "soft", text: "soft", conditions: { grip: 1, bounce: 0, soft: 1 } },
];

/** The light a visitor chooses: day (the rest), dusk or night. */
export const LIGHTS: { light: number; text: string }[] = [
    { light: 1, text: "day" },
    { light: 0.45, text: "dusk" },
    { light: 0, text: "night" },
];

/** The ground nearest these conditions, for showing a world that changed by itself: the strongest of its slipperiness, stickiness, bounce and softness, or firm if none is much. */
export function groundOf(conditions: Conditions): Ground {
    const how: [Ground, number][] = [
        ["ice", (1 - conditions.grip) / 0.94],
        ["sticky", (conditions.grip - 1) / 1.5],
        ["bouncy", conditions.bounce / 0.75],
        ["soft", conditions.soft],
    ];
    const [ground, most] = how.reduce((best, each) => (each[1] > best[1] ? each : best));
    return most > 0.3 ? ground : "firm";
}

/** The light choice nearest a light. */
export const lightOf = (light: number): number => LIGHTS.reduce((best, each) => (Math.abs(each.light - light) < Math.abs(best.light - light) ? each : best)).light;

/** The world as the creature meets it, from `show_world`: its conditions now, the seconds since it last changed, what it hears ahead and behind, its surprise and the level of surprise it is used to. */
export interface WorldNow {
    conditions: Conditions;
    since: number;
    heard: [number, number];
    surprise: number;
    usual: number;
}

export function worldNow(numbers: ArrayLike<number>): WorldNow {
    const at = (k: number, otherwise: number) => (k < numbers.length ? numbers[k]! : otherwise);
    return {
        conditions: { grip: at(0, 1), bounce: at(1, 0), soft: at(2, 0), gravity: at(3, 1), wind: at(4, 0), light: at(5, 1) },
        since: at(6, 0),
        heard: [at(7, 0), at(8, 0)],
        surprise: at(9, 0),
        usual: at(10, 0),
    };
}

/** A brain's shape as the page holds it: how many memory neurons, rhythms and moods, and how many others each reads. All 0 is the plain network of two layers. */
export interface Shape {
    memory: number;
    rhythm: number;
    mood: number;
    reads: number;
}

/** The brain practice starts with (walker/src/generalist/page.rs, `BRAIN`), and the caps a visitor's sliders keep within. */
export const DEFAULT_SHAPE: Shape = { memory: 32, rhythm: 4, mood: 4, reads: 16 };
export const SHAPE_CAPS = { memory: 128, rhythm: 16, fewestReads: 4, reads: 32 };

/** Whether something kept is a shape within the caps. */
export function validShape(shape: unknown): shape is Shape {
    const s = shape as Partial<Shape> | null;
    const whole = (n: unknown, most: number, least = 0) => typeof n === "number" && Number.isInteger(n) && n >= least && n <= most;
    return !!s && whole(s.memory, SHAPE_CAPS.memory) && whole(s.rhythm, SHAPE_CAPS.rhythm) && whole(s.mood, 4) && whole(s.reads, SHAPE_CAPS.reads, SHAPE_CAPS.fewestReads);
}

/** How many neurons a brain of this shape has: the two plain layers of 64, and its pool. */
export const neurons = (shape: Shape): number => 128 + shape.memory + shape.rhythm + shape.mood;

/** A brain with a pool, drawn (`brain_picture`, walker/src/generalist/mind.rs `pool_picture`): how many of each kind, how lit each neuron is, how far each memory and mood moved at the last decision and each rhythm's phase, and into each neuron after what it senses, its three strongest connections (from, what it passed, how much its weight changed in this run). */
export interface BrainKinds {
    counts: { senses: number; plain: number; memory: number; rhythm: number; mood: number; actions: number };
    lit: Float32Array;
    moved: Float32Array;
    into: Float32Array;
    /** For a brain that adds and cuts its connections: how many of its memory neurons' places hold one, of how many, what they cost each second as a share of all its energy, and the places changed at its last decision, three numbers each (into, from, 1 added or -1 cut). */
    growth?: { joined: number; places: number; cost: number; changes: Float32Array };
}

/** Reads a picture of a brain with a pool, or undefined if it is not one (evolution's and the plain network's are read by `brainColumns`). */
export function brainKinds(picture: Float32Array): BrainKinds | undefined {
    if (picture[0] !== -1 || picture.length < 7) return undefined;
    const [senses, plain, memory, rhythm, mood, actions] = Array.from(picture.subarray(1, 7));
    const counts = { senses: senses!, plain: plain!, memory: memory!, rhythm: rhythm!, mood: mood!, actions: actions! };
    const all = counts.senses + 2 * counts.plain + counts.memory + counts.rhythm + counts.mood + counts.actions;
    const pool = counts.memory + counts.rhythm + counts.mood;
    const length = 7 + all + pool + 9 * (all - counts.senses);
    const kinds = { counts, lit: picture.subarray(7, 7 + all), moved: picture.subarray(7 + all, 7 + all + pool), into: picture.subarray(7 + all + pool, length) };
    if (picture.length === length) return kinds;
    // a brain that grows its connections says how many it has, what they cost, and which changed
    const changed = picture[length + 3] ?? -1;
    if (changed < 0 || picture.length !== length + 4 + 3 * changed) return undefined;
    return { ...kinds, growth: { joined: picture[length]!, places: picture[length + 1]!, cost: picture[length + 2]!, changes: picture.subarray(length + 4) } };
}

/**
 * How many workers practise at an effort: what the machine has, up to four. Gentle is one, resting as
 * long as it works; normal leaves one core for the page and the rest of the machine; all it has takes
 * every core up to four. A phone, or a machine with little memory, gets fewer. Four at most, since each
 * update averages every worker's weights and with more each has too few creatures.
 */
export function practiceWorkers(effort: Effort, { cores, memory, phone }: Machine): number {
    if (effort === "gentle") return 1;
    const whole = Math.max(1, Math.floor(cores) || 1);
    let most = Math.min(4, effort === "all" ? whole : whole - 1);
    if (phone) most = Math.min(most, effort === "all" ? 4 : 2);
    if (memory !== undefined && memory < 4) most = Math.min(most, memory <= 1 ? 1 : 2);
    return Math.max(1, most);
}

/** A brain's picture from the engine (`brain_picture`): how lit each dot of each column is, and what flows into each dot from each dot of the column before, dot by dot of the later column. */
export interface BrainColumns {
    lit: Float32Array[];
    flows: Float32Array[];
}

/** Reads a brain's picture: the number of columns, the size of each, every column's dots, then what flows between each pair. Views into the list, not copies. */
export function brainColumns(picture: Float32Array): BrainColumns | undefined {
    const count = picture[0] ?? 0;
    if (count < 2) return undefined;
    const sizes = Array.from(picture.subarray(1, 1 + count));
    let at = 1 + count;
    const take = (length: number) => picture.subarray(at, (at += length));
    const lit = sizes.map((size) => take(size));
    const flows = sizes.slice(1).map((size, k) => take(size * sizes[k]!));
    return at === picture.length ? { lit, flows } : undefined;
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

/** A copy of the list of f64 a call just gave (the running numbers kept with what practice learned). */
export const list64 = (engine: Engine, pointer: number): Float64Array => new Float64Array(engine.memory.buffer, pointer, engine.length()).slice();

/** Writes f64 into room the engine made. */
export const write64 = (engine: Engine, pointer: number, values: ArrayLike<number>) => new Float64Array(engine.memory.buffer, pointer, values.length).set(values);

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

/**
 * Where each part of what a practised creature senses is, for a body of so many legs (walker/README.md,
 * "What it senses"): sixteen rays of six numbers, the body's angle, spin and speed, each joint's angle and
 * speed, each foot down, the rhythm, the hop, its energy and whether it just ate, where its eye looks, then
 * touch: the body's pressure, each foot's, held, and the jolt across and up; then what it senses of a
 * changing world: a landing heard ahead and behind, the light, and its surprise.
 */
export function senseLayout(legs: number): { rays: number; feet: number; energy: number; ate: number; gaze: number; touch: number; footPressed: number; held: number; jolt: number; heard: number; light: number; surprise: number; length: number } {
    const rays = 0;
    const body = 16 * 6;
    const feet = body + 4 + 4 * legs;
    const energy = feet + legs + 4;
    const touch = energy + 3;
    const heard = touch + 4 + legs;
    return { rays, feet, energy, ate: energy + 1, gaze: energy + 2, touch, footPressed: touch + 1, held: touch + 1 + legs, jolt: touch + 2 + legs, heard, light: heard + 2, surprise: heard + 3, length: heard + 4 };
}

/** What each ray can see, as the engine numbers them. */
export const SEEN = ["nothing", "ground", "edge", "box", "hazard", "moving", "food"] as const;

/** A length of time in plain words: seconds, then minutes, then hours. */
export function lasted(seconds: number): string {
    if (seconds < 60) return `${Math.floor(seconds)} s`;
    if (seconds < 3600) return `${Math.floor(seconds / 60)} min ${Math.floor(seconds % 60)} s`;
    return `${Math.floor(seconds / 3600)} h ${Math.floor((seconds % 3600) / 60)} min`;
}

/** A count of steps in plain words. */
export function counted(steps: number): string {
    return steps >= 1e6 ? `${(steps / 1e6).toFixed(1)} million` : steps >= 1e3 ? `${Math.round(steps / 1e3)} thousand` : `${Math.round(steps)}`;
}

