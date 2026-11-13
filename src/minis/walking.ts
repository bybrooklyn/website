// What the Walker mini and its training worker share, with nothing to do with drawing: the engine's
// exported functions (walker/README.md says what each does), the kinds of ground as the pieces the
// engine takes, and a brain written into a link and read back. walker.test.ts holds these to their
// word.

/** The functions of public/wasm/walker.wasm. */
export interface Engine {
    memory: WebAssembly.Memory;
    create(legs: number, population: number, seconds: number, seed: number, hidden: number, layers: number, memory: number, goal: number, length: number): number;
    weights_swap(): number;
    show_ground_extend(pieces: number): void;
    show_origin(): number;
    show_endless(): number;
    live_begin(): number;
    live_step(seconds: number): number;
    live_attempt(): number;
    live_best_score(): number;
    live_best_distance(): number;
    live_best_weights(): number;
    live_stop(): void;
    legs_length(): number;
    show_load(): number;
    memory_length(): number;
    show_memory(): number;
    run_seconds(): number;
    ground_room(pieces: number): number;
    ground_set(pieces: number): number;
    train(runs: number): number;
    evaluate_room(count: number): number;
    evaluate(count: number): number;
    evaluated(): number;
    member_scored(index: number): number;
    record(index: number, score: number, distance: number): number;
    envs_create(count: number): number;
    envs_step(steps: number): number;
    envs_actions(): number;
    envs_observations(): number;
    envs_rewards(): number;
    envs_done(): number;
    generation(): number;
    generation_runs(): number;
    best_score(): number;
    best_distance(): number;
    history_length(): number;
    history_best(): number;
    history_mean(): number;
    weights_length(): number;
    best_weights(): number;
    weights_room(): number;
    weights_load(): number;
    population_length(): number;
    population_weights(): number;
    show_reset(): void;
    show_step(seconds: number): number;
    show_push(x: number, y: number, impulseX: number, impulseY: number): number;
    show_seconds(): number;
    show_over(): number;
    show_score(): number;
    layers_length(): number;
    show_fallen(): number;
    body_count(): number;
    show_bodies(): number;
    show_distance(): number;
    senses_length(): number;
    hidden_length(): number;
    outputs_length(): number;
    show_senses(): number;
    show_hidden(): number;
    show_outputs(): number;
    show_weights(): number;
    crowd_reset(): number;
    crowd_room(count: number): number;
    crowd_start(count: number): number;
    crowd_step(seconds: number): number;
    crowd_bodies(): number;
    crowd_stop(): void;
}

/** Where the built engine is served from: built with WebAssembly SIMD, and without, for older browsers. */
export const ENGINE = "/wasm/walker.wasm";
export const SCALAR_ENGINE = "/wasm/walker-scalar.wasm";

/**
 * The smallest module that uses SIMD (it splats a byte and counts its bits), which a browser without
 * SIMD will not accept. The same test the wasm-feature-detect project uses.
 */
const SIMD_TEST = new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0, 1, 5, 1, 96, 0, 1, 123, 3, 2, 1, 0, 10, 10, 1, 8, 0, 65, 0, 253, 15, 253, 98, 11]);

/** Whether this browser runs WebAssembly SIMD: every current one does; Safari before 16.4 does not. */
export const hasSimd = (): boolean => {
    try {
        return WebAssembly.validate(SIMD_TEST);
    } catch {
        return false;
    }
};

/** The engine this browser can run. Both builds give the same numbers to the bit; SIMD is faster. */
export const engineAddress = (): string => (hasSimd() ? ENGINE : SCALAR_ENGINE);

/** Starts an engine from the module's bytes. It needs nothing from the page. */
export async function start(bytes: ArrayBuffer): Promise<Engine> {
    const { instance } = await WebAssembly.instantiate(bytes, {});
    return instance.exports as unknown as Engine;
}

/** A copy of `length` f32 out of the engine's memory. Taken fresh each time, since memory can grow. */
export const read = (engine: Engine, pointer: number, length: number): Float32Array => new Float32Array(engine.memory.buffer, pointer, length).slice();

/** Writes f32 into room the engine made. */
export const write = (engine: Engine, pointer: number, values: ArrayLike<number>) => new Float32Array(engine.memory.buffer, pointer, values.length).set(values);

/** How many brains a generation has. */
export const POPULATION = 32;

/** How hard training works the visitor's machine: gently, normally, or with all it has. */
export type Effort = "gentle" | "normal" | "all";
export const EFFORTS: { effort: Effort; text: string }[] = [
    { effort: "gentle", text: "gentle" },
    { effort: "normal", text: "normal" },
    { effort: "all", text: "all it has" },
];

/** What the browser says of the machine: its cores, its memory in gigabytes if it says, and whether it is a phone. */
export interface Machine {
    cores: number;
    memory?: number;
    phone: boolean;
}

/** This browser's machine. */
export function machine(): Machine {
    const about = navigator as Navigator & { deviceMemory?: number; userAgentData?: { mobile?: boolean } };
    return { cores: about.hardwareConcurrency || 2, memory: about.deviceMemory, phone: about.userAgentData?.mobile ?? /Mobi|Android|iPhone|iPad/i.test(about.userAgent) };
}

/**
 * How many workers train at an effort. Gentle is one, resting as long as it works. Normal is about
 * half the cores, from one to eight, so the machine has room for everything else; all it has leaves
 * one core free. A phone, or a machine with little memory, gets fewer.
 */
export function workersFor(effort: Effort, { cores, memory, phone }: Machine): number {
    if (effort === "gentle") return 1;
    const whole = Math.max(1, Math.floor(cores) || 1);
    let most = effort === "all" ? Math.min(16, whole - 1) : Math.min(8, Math.floor(whole / 2));
    if (phone) most = Math.min(most, effort === "all" ? 4 : 2);
    if (memory !== undefined && memory < 4) most = Math.min(most, memory <= 1 ? 1 : 2);
    return Math.max(1, most);
}

export type Legs = 1 | 2 | 4;
export const LEGS: Legs[] = [1, 2, 4];

/** The kinds of ground, the last of which, the course, comes with its goal rather than being chosen. */
export type Kind = "flat" | "hills" | "steps" | "gaps" | "course";
export const KINDS: Kind[] = ["flat", "hills", "steps", "gaps"];

/** What a walker is rewarded for, as the engine numbers it (walker/README.md, Goals). */
export type Goal = 0 | 1 | 2 | 3 | 4 | 5;
export const GOALS: { goal: Goal; name: string; doing: string }[] = [
    { goal: 0, name: "go far", doing: "going far" },
    { goal: 1, name: "go fast", doing: "going fast" },
    { goal: 2, name: "stand tall", doing: "standing tall" },
    { goal: 3, name: "jump", doing: "jumping" },
    { goal: 4, name: "the course", doing: "on the course" },
    { goal: 5, name: "carry", doing: "carrying" },
];
/** The goal that brings its own ground, the obstacle course. */
export const COURSE_GOAL = 4;

/** How far a run goes, in metres, from a couple of metres to endless (0). */
export const LENGTHS = [2, 5, 10, 25, 50, 100, 0];
export const lengthName = (length: number) => (length === 0 ? "endless" : `${length} m`);

/** A distance in metres to a tenth, as the status lines show it: a little way back that rounds to nothing is 0.0, never -0.0. */
export const tenths = (metres: number): string => {
    const shown = metres.toFixed(1);
    return shown === "-0.0" ? "0.0" : shown;
};

/** The two ways of learning: a whole generation at a time, or one walker live. */
export type Way = "generation" | "live";

/** The sizes of brain on offer: neurons in each hidden layer, how many hidden layers, and memories. */
export const NEURONS = [8, 16, 32, 64];
export const LAYERS = [1, 2, 3, 4];
export const MEMORIES = [0, 2, 4, 8];

/** Three sizes of brain by name, the main way to choose one. Any other mix is the visitor's own. */
export const PRESETS: { name: string; hidden: number; layers: number; memory: number }[] = [
    { name: "small", hidden: 8, layers: 1, memory: 0 },
    { name: "medium", hidden: 16, layers: 2, memory: 4 },
    { name: "large", hidden: 32, layers: 3, memory: 8 },
];

/** The name of the preset a brain is, or "own". */
export const presetOf = (setup: { hidden: number; layers: number; memory: number }): string =>
    PRESETS.find((preset) => preset.hidden === setup.hidden && preset.layers === setup.layers && preset.memory === setup.memory)?.name ?? "own";

/** What the walker walks on: a kind, and how rough, from 0 to 100. */
export interface Ground {
    kind: Kind;
    rough: number;
}

/** Everything a walker is set up with, which changing starts its learning again. */
export interface Setup {
    legs: Legs;
    goal: Goal;
    hidden: number;
    layers: number;
    memory: number;
    ground: Ground;
    /** How far a run goes, in metres, or 0 for endless. */
    length: number;
    way: Way;
}

export const DEFAULT_SETUP: Setup = { legs: 2, goal: 0, hidden: 16, layers: 2, memory: 4, ground: { kind: "flat", rough: 30 }, length: 0, way: "generation" };

/** The ground a setup walks on: its own, or the course when that is its goal. */
export const groundOf = (setup: Setup): Ground => (setup.goal === COURSE_GOAL ? { kind: "course", rough: 0 } : setup.ground);

/** Whether something kept or read from a link is a setup the mini can use. */
export function valid(setup: unknown): setup is Setup {
    const s = setup as Partial<Setup> | null;
    return !!s && LEGS.includes(s.legs as Legs) && GOALS.some((each) => each.goal === s.goal) && NEURONS.includes(s.hidden as number) && LAYERS.includes(s.layers as number) && MEMORIES.includes(s.memory as number) && LENGTHS.includes(s.length as number) && (s.way === "generation" || s.way === "live") && KINDS.includes(s.ground?.kind as Kind) && Number.isFinite(s.ground?.rough) && s.ground!.rough >= 0 && s.ground!.rough <= 100;
}

/**
 * Which shape of brain a link holds. It goes up whenever a brain's weights stop meaning what they
 * meant, so an old link is recognised and set aside rather than read wrongly.
 */
const LINK_VERSION = 5;

/** A walker as the parts of a link: its setup and its brain. */
export function linkParts(setup: Setup, brain: Float32Array): [string, string][] {
    return [
        ["v", String(LINK_VERSION)],
        ["legs", String(setup.legs)],
        ["goal", String(setup.goal)],
        ["neurons", String(setup.hidden)],
        ["layers", String(setup.layers)],
        ["memory", String(setup.memory)],
        ["length", String(setup.length)],
        ["ground", setup.ground.kind],
        ["rough", String(setup.ground.rough)],
        ["brain", encode(brain)],
    ];
}

/** The names a link to a walker uses, to clear them all. */
export const LINK_NAMES = ["v", "legs", "goal", "neurons", "layers", "memory", "length", "ground", "rough", "brain"];

/** Whether the address holds a link to a walker from an older version, which cannot be read. */
export const oldLink = (get: (name: string) => string | null): boolean => get("brain") !== null && get("v") !== String(LINK_VERSION);

/** A walker back from a link, or null if the link does not hold a whole one of this version. */
export function fromLink(get: (name: string) => string | null): { setup: Setup; brain: Float32Array } | null {
    if (get("v") !== String(LINK_VERSION)) return null;
    const setup = { legs: Number(get("legs")), goal: Number(get("goal")), hidden: Number(get("neurons")), layers: Number(get("layers")), memory: Number(get("memory")), ground: { kind: get("ground"), rough: Number(get("rough")) }, length: Number(get("length")), way: "generation" };
    const brain = decode(get("brain") ?? "");
    return brain && valid(setup) ? { setup, brain } : null;
}

/** The setup a link to a walker opens: the link's own, ground and all. Only for the course, which brings its own ground, is the visitor's kept ground left as it was. */
export const linkedSetup = (kept: Setup, linked: Setup): Setup => ({ ...linked, ground: linked.goal === COURSE_GOAL ? kept.ground : linked.ground });

/** The ground runs from here to there, in metres, and is level around the start, where the walker is built. */
const BEHIND = -20;
const AHEAD = 400;
const LEVEL = 3;

/** A whole number made from another with no pattern to it, the same in every browser. */
function hash(n: number): number {
    let h = Math.imul(n ^ 0x9e3779b9, 0x85ebca6b);
    h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
    return ((h ^ (h >>> 16)) >>> 0) / 2 ** 32;
}

/** A smooth wandering line from about -1 to 1, with a rise or fall about every `every` metres. */
function wander(x: number, every: number): number {
    const at = x / every;
    const whole = Math.floor(at);
    const t = at - whole;
    const ease = t * t * (3 - 2 * t);
    return (hash(whole) + (hash(whole + 1) - hash(whole)) * ease) * 2 - 1;
}

/** Where the obstacle course changes, in metres from where it starts: a lap is level ground, then
 * hills, then steps, then gaps, and each stretch, and each lap, is a little harder than the last. */
export const COURSE = { level: 12, hills: 36, steps: 36, gaps: 36 };
const LAP = COURSE.level + COURSE.hills + COURSE.steps + COURSE.gaps;

/** What a stretch of the course at x is, and how hard, from 0 to 1. */
export function courseAt(x: number): { kind: Kind; hard: number } {
    const along = Math.max(0, x - LEVEL);
    const lap = Math.floor(along / LAP);
    let into = along - lap * LAP;
    for (const kind of ["flat", "hills", "steps", "gaps"] as const) {
        const long = kind === "flat" ? COURSE.level : COURSE[kind];
        if (into < long) return { kind, hard: Math.min(1, 0.1 + 0.3 * lap + 0.3 * (into / long)) };
        into -= long;
    }
    return { kind: "flat", hard: 1 };
}

/**
 * The ground as the engine takes it, four numbers to a piece: x1, y1, x2, y2, made as far ahead as
 * asked and then further when asked again, for a walk with no end. Hills rise and fall, steps go up
 * and down in risers, gaps open in level ground, and flat ground is only bumpy; rough makes each
 * more so. The course runs through all of them, harder as it goes. Only plus, times and the like
 * are used, so every browser makes the same ground.
 */
export class Terrain {
    /** How far the ground has been made, the height it reached there, and how many pieces so far. */
    reached = LEVEL;
    private level = 0;
    private count = 0;
    /** The kind of the stretch being made, where it began, and the height it began at. */
    private kind: Kind | "" = "";
    private since = LEVEL;
    private base = 0;

    constructor(private readonly ground: Ground) {}

    /** More ground, from where it was left to at least `until`. */
    next(until: number): number[] {
        const out: number[] = [];
        const line = (x1: number, y1: number, x2: number, y2: number) => out.push(x1, y1, x2, y2);
        while (this.reached < until) {
            const x = this.reached;
            const { kind, hard } = this.ground.kind === "course" ? courseAt(x) : { kind: this.ground.kind, hard: Math.min(100, Math.max(0, this.ground.rough)) / 100 };
            const n = this.count++;
            if (kind === "steps") {
                // a step every two and a half metres, mostly up, sometimes down
                const rise = 0.04 + 0.22 * hard;
                const next = this.level + (hash(n + 7) < 0.3 ? -rise : rise);
                line(x, this.level, x, next);
                line(x, next, x + 2.5, next);
                [this.reached, this.level] = [x + 2.5, next];
            } else if (kind === "gaps") {
                // a gap, then level ground for three to five metres
                const wide = (0.12 + 0.55 * hard) * (0.6 + 0.8 * hash(n + 3));
                const end = x + wide + 3 + 2 * hash(n + 11);
                line(x + wide, this.level, end, this.level);
                this.reached = end;
            } else {
                // hills are long rises and falls; flat ground has only small bumps. A stretch grows in
                // from the height it starts at, so the ground stays joined up.
                if (kind !== this.kind) [this.kind, this.since, this.base] = [kind, x, this.level];
                const [height, every] = kind === "hills" ? [0.2 + 1.1 * hard, 9] : [0.08 * hard, 1.5];
                const at = (t: number) => this.base + height * (wander(t, every) - wander(this.since, every)) * Math.min(1, (t - this.since) / 4);
                line(x, this.level, x + 0.5, at(x + 0.5));
                [this.reached, this.level] = [x + 0.5, at(x + 0.5)];
            }
            if (kind === "steps" || kind === "gaps") this.kind = kind;
        }
        return out;
    }
}

/** The ground from behind the start to far ahead of it, as training uses. */
export function pieces(ground: Ground): number[] {
    return [BEHIND, 0, LEVEL, 0, ...new Terrain(ground).next(AHEAD)];
}

/** The height of the ground's surface at x, for drawing: the highest piece over it, or none over a gap. */
export function heightAt(list: number[], x: number): number | undefined {
    let found: number | undefined;
    for (let i = 0; i < list.length; i += 4) {
        const [x1, y1, x2, y2] = [list[i]!, list[i + 1]!, list[i + 2]!, list[i + 3]!];
        const [left, right] = x1 <= x2 ? [x1, x2] : [x2, x1];
        if (x < left || x > right) continue;
        const y = right - left > 1e-6 ? y1 + ((y2 - y1) * (x - x1)) / (x2 - x1) : Math.max(y1, y2);
        found = found === undefined ? y : Math.max(found, y);
    }
    return found;
}

/** A brain's weights as text for a link: their exact bytes, in base64 with the URL's letters. */
export function encode(weights: Float32Array): string {
    const bytes = new Uint8Array(weights.buffer, weights.byteOffset, weights.byteLength);
    let text = "";
    for (const byte of bytes) text += String.fromCharCode(byte);
    return btoa(text).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** The longest brain a link may hold, in characters. The largest brain there is (four legs, four layers of 64, eight memories) is about 91,000. */
export const LONGEST_BRAIN = 120_000;

/** The weights back from a link, or null if the text is too long, is not a whole number of them, or any is not a number. */
export function decode(text: string): Float32Array | null {
    if (text.length > LONGEST_BRAIN || !/^[A-Za-z0-9_-]*$/.test(text)) return null;
    let binary: string;
    try {
        binary = atob(text.replace(/-/g, "+").replace(/_/g, "/"));
    } catch {
        return null;
    }
    if (binary.length === 0 || binary.length % 4 !== 0) return null;
    const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
    const weights = new Float32Array(bytes.buffer);
    return weights.every(Number.isFinite) ? weights : null;
}
