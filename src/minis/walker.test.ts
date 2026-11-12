// What the walking mini's built engine, public/wasm/walker.wasm, is held to from the page's side: it
// loads with nothing given to it, stays small, trains, hands out and takes back a brain, and runs a
// show and a crowd that move and can be pushed. `bun run wasm` builds it; `bun test` runs this.

import { expect, test } from "bun:test";

const path = new URL("../../public/wasm/walker.wasm", import.meta.url);

interface Walker {
    memory: WebAssembly.Memory;
    create(legs: number, population: number, seconds: number, seed: number): number;
    ground_room(pieces: number): number;
    ground_set(pieces: number): number;
    train(runs: number): number;
    generation(): number;
    generation_runs(): number;
    best_score(): number;
    history_length(): number;
    history_best(): number;
    history_mean(): number;
    weights_length(): number;
    best_weights(): number;
    weights_room(): number;
    weights_load(): number;
    show_reset(): void;
    show_step(seconds: number): number;
    show_push(x: number, y: number, impulseX: number, impulseY: number): number;
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
    crowd_step(seconds: number): number;
    crowd_bodies(): number;
    crowd_stop(): void;
}

async function load(): Promise<Walker> {
    const { instance } = await WebAssembly.instantiate(await Bun.file(path).arrayBuffer(), {});
    return instance.exports as unknown as Walker;
}

/** A copy of `length` f32 from the module's memory, made fresh since memory may have grown. */
const floats = (walker: Walker, pointer: number, length: number) => Array.from(new Float32Array(walker.memory.buffer, pointer, length));

test("the module is under its size limit and needs nothing from the page to load", async () => {
    expect(Bun.file(path).size).toBeLessThan(512 * 1024);
    const module = await WebAssembly.compile(await Bun.file(path).arrayBuffer());
    expect(WebAssembly.Module.imports(module)).toEqual([]);
});

test("a walker is made only from a description it can build", async () => {
    const walker = await load();
    expect(walker.create(3, 8, 2, 1)).toBe(0);
    // a two-legged brain: 17 senses, 12 hidden neurons and 4 outputs, each layer with its biases
    expect(walker.create(2, 8, 2, 1)).toBe(12 * 18 + 4 * 13);
    expect([walker.senses_length(), walker.hidden_length(), walker.outputs_length()]).toEqual([17, 12, 4]);
    expect(walker.body_count()).toBe(5);
    expect(walker.create(4, 8, 2, 1)).toBe(12 * 28 + 8 * 13);
    expect(walker.body_count()).toBe(9);
    expect(walker.create(1, 8, 2, 1)).toBeGreaterThan(0);
});

test("training finishes generations, keeps a history, and learns the same way from the same seed", async () => {
    const one = await load();
    const two = await load();
    one.create(2, 8, 3, 5);
    two.create(2, 8, 3, 5);
    expect(one.best_score()).toBe(-Infinity);
    const started = performance.now();
    one.train(8);
    const generation = performance.now() - started;
    expect(one.generation()).toBe(1);
    while (one.generation() < 3) one.train(3);
    while (two.generation() < 3) two.train(1);
    expect(one.history_length()).toBe(3);
    const best = floats(one, one.history_best(), 3);
    const mean = floats(one, one.history_mean(), 3);
    expect(best.every((score, i) => Number.isFinite(score) && score >= mean[i]!)).toBe(true);
    expect(one.best_score()).toBe(Math.max(...best));
    expect(floats(one, one.best_weights(), one.weights_length())).toEqual(floats(two, two.best_weights(), two.weights_length()));
    console.log(`one generation of 8 three-second runs in WebAssembly: ${generation.toFixed(0)} ms`);
});

test("a brain taken out of one walker and loaded into another walks the same", async () => {
    const one = await load();
    const count = one.create(2, 8, 3, 9);
    while (one.generation() < 2) one.train(4);
    const weights = floats(one, one.best_weights(), count);
    one.show_reset();
    one.show_step(1);

    const two = await load();
    two.create(2, 8, 3, 1);
    new Float32Array(two.memory.buffer, two.weights_room(), count).set(weights);
    expect(two.weights_load()).toBe(1);
    expect(floats(two, two.best_weights(), count)).toEqual(weights);
    expect(two.best_score()).toBe(one.best_score());
    two.show_step(1);
    expect(floats(two, two.show_bodies(), 30)).toEqual(floats(one, one.show_bodies(), 30));

    new Float32Array(two.memory.buffer, two.weights_room(), count).fill(Number.NaN);
    expect(two.weights_load()).toBe(0);
});

test("the show moves, can be pushed, and lays out its body and brain for drawing", async () => {
    const walker = await load();
    walker.create(2, 8, 3, 2);
    walker.train(8);
    walker.show_reset();
    const bodies = floats(walker, walker.show_bodies(), 6 * walker.body_count());
    // the torso is a box, the legs capsules
    expect(bodies[3]).toBe(2);
    expect(bodies[9]).toBe(1);
    expect(walker.show_step(0.1)).toBeGreaterThanOrEqual(5);
    expect(walker.show_step(5)).toBe(8);
    const hidden = floats(walker, walker.show_hidden(), walker.hidden_length());
    const outputs = floats(walker, walker.show_outputs(), walker.outputs_length());
    expect([...hidden, ...outputs].every((value) => value >= -1 && value <= 1)).toBe(true);
    expect(floats(walker, walker.show_senses(), walker.senses_length()).every(Number.isFinite)).toBe(true);
    expect(floats(walker, walker.show_weights(), walker.weights_length())).toEqual(floats(walker, walker.best_weights(), walker.weights_length()));

    const before = floats(walker, walker.show_bodies(), 6);
    expect(walker.show_push(before[0]!, before[1]!, 30, 0)).toBe(0);
    walker.show_step(0.1);
    const after = floats(walker, walker.show_bodies(), 6);
    expect(after[0]! - before[0]!).toBeGreaterThan(0.1);
    expect(Number.isFinite(walker.show_distance())).toBe(true);
});

test("new ground takes the walker up onto it, and the crowd runs a whole generation", async () => {
    const walker = await load();
    walker.create(2, 6, 3, 3);
    // a step up of half a metre right under the start
    const pieces = [-20, 0.5, 5, 0.5, 5, 0.5, 5, 0, 5, 0, 40, 0];
    new Float32Array(walker.memory.buffer, walker.ground_room(3), 12).set(pieces);
    expect(walker.ground_set(3)).toBe(1);
    const torso = floats(walker, walker.show_bodies(), 2);
    expect(torso[1]!).toBeGreaterThan(1.3);

    expect(walker.crowd_reset()).toBe(6);
    walker.crowd_step(0.5);
    const crowd = floats(walker, walker.crowd_bodies(), 6 * walker.body_count() * 3);
    expect(crowd.every(Number.isFinite)).toBe(true);
    // each walker has its own brain, so they do not all move alike
    const torsos = Array.from({ length: 6 }, (_, i) => crowd[i * walker.body_count() * 3]);
    expect(new Set(torsos).size).toBeGreaterThan(1);
    walker.crowd_stop();
    expect(walker.crowd_step(1)).toBe(0);
});
