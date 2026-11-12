// What the Walker mini and its training worker share, with nothing to do with drawing: the engine's
// exported functions (walker/README.md says what each does), the kinds of ground as the pieces the
// engine takes, and a brain written into a link and read back. walker.test.ts holds these to their
// word.

/** The functions of public/wasm/walker.wasm. */
export interface Engine {
    memory: WebAssembly.Memory;
    create(legs: number, population: number, seconds: number, seed: number, hidden: number, layers: number, goal: number): number;
    run_seconds(): number;
    ground_room(pieces: number): number;
    ground_set(pieces: number): number;
    train(runs: number): number;
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

/** Where the built engine is served from. */
export const ENGINE = "/wasm/walker.wasm";

/** Starts an engine from the module's bytes. It needs nothing from the page. */
export async function start(bytes: ArrayBuffer): Promise<Engine> {
    const { instance } = await WebAssembly.instantiate(bytes, {});
    return instance.exports as unknown as Engine;
}

/** A copy of `length` f32 out of the engine's memory. Taken fresh each time, since memory can grow. */
export const read = (engine: Engine, pointer: number, length: number): Float32Array => new Float32Array(engine.memory.buffer, pointer, length).slice();

/** Writes f32 into room the engine made. */
export const write = (engine: Engine, pointer: number, values: ArrayLike<number>) => new Float32Array(engine.memory.buffer, pointer, values.length).set(values);

/** How many brains a generation has, and how long each is tried, in seconds. */
export const POPULATION = 32;
export const SECONDS = 10;

export type Legs = 1 | 2 | 4;
export const LEGS: Legs[] = [1, 2, 4];

export type Kind = "flat" | "hills" | "steps" | "gaps";
export const KINDS: Kind[] = ["flat", "hills", "steps", "gaps"];

/** What the walker walks on: a kind, and how rough, from 0 to 100. */
export interface Ground {
    kind: Kind;
    rough: number;
}

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

/**
 * The ground as the engine takes it, four numbers to a piece: x1, y1, x2, y2. Hills rise and fall,
 * steps go up and down in risers, gaps open in level ground, and flat ground is only bumpy. Rough
 * makes each more so. Only plus, times and the like are used, so every browser makes the same.
 */
export function pieces(ground: Ground): number[] {
    const rough = Math.min(100, Math.max(0, ground.rough)) / 100;
    const out: number[] = [];
    const line = (x1: number, y1: number, x2: number, y2: number) => out.push(x1, y1, x2, y2);
    line(BEHIND, 0, LEVEL, 0);
    if (ground.kind === "steps") {
        // a step every two and a half metres, mostly up, sometimes down
        const rise = 0.04 + 0.22 * rough;
        let [x, y] = [LEVEL, 0];
        for (let step = 0; x < AHEAD; step++) {
            const next = y + (hash(step + 7) < 0.3 ? -rise : rise);
            line(x, y, x, next);
            line(x, next, x + 2.5, next);
            [x, y] = [x + 2.5, next];
        }
    } else if (ground.kind === "gaps") {
        // level ground in lengths of three to five metres, with a gap after each
        const wide = 0.12 + 0.55 * rough;
        let x = LEVEL;
        for (let length = 0; x < AHEAD; length++) {
            x += wide * (0.6 + 0.8 * hash(length + 3));
            const end = x + 3 + 2 * hash(length + 11);
            line(x, 0, end, 0);
            x = end;
        }
    } else {
        // hills are long rises and falls; flat ground has only small bumps
        const [height, every, piece] = ground.kind === "hills" ? [0.2 + 1.1 * rough, 9, 0.5] : [0.08 * rough, 1.5, 0.5];
        // the height grows in over the first few metres, so the start stays level
        const at = (x: number) => height * (wander(x, every) - wander(LEVEL, every)) * Math.min(1, (x - LEVEL) / 4);
        for (let x = LEVEL; x < AHEAD; x += piece) line(x, at(x), x + piece, at(x + piece));
    }
    return out;
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

/** The weights back from a link, or null if the text is not a whole number of them, or any is not a number. */
export function decode(text: string): Float32Array | null {
    if (!/^[A-Za-z0-9_-]*$/.test(text)) return null;
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
