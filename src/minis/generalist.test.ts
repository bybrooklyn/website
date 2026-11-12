// What the generalist's built engine, public/wasm/generalist.wasm, is held to from the page's side:
// it loads with nothing given to it and stays small; it gives the very numbers the native engine
// gives (the fingerprint in walker/src/generalist/envs_tests.rs); the builds with and without SIMD
// agree; a generation shared out learns as one module alone; the show, the world's lists and the
// creatures for a learner work. And what roaming.ts is held to: seeds and links.

import { expect, test } from "bun:test";
import { DEFAULT_RECIPE, KINDS, anotherSeed, engineRecipe, fromLink, linkParts, seedNumber, valid, type Engine } from "./roaming";

const path = new URL("../../public/wasm/generalist.wasm", import.meta.url);
const scalarPath = new URL("../../public/wasm/generalist-scalar.wasm", import.meta.url);

/** The native engine's fingerprint of three creatures' 600 steps and three generations of evolution. */
const FINGERPRINT = 0x1d4539ffbd3e5f4dn;

async function load(from: URL = path): Promise<Engine> {
    const { instance } = await WebAssembly.instantiate(await Bun.file(from).arrayBuffer(), {});
    return instance.exports as unknown as Engine;
}

/** The list a call just gave, as f32 and as their bits. */
const floats = (engine: Engine, pointer: number) => Array.from(new Float32Array(engine.memory.buffer, pointer, engine.length()));
const bits = (engine: Engine, pointer: number, length = engine.length()) => Array.from(new Uint32Array(engine.memory.buffer, pointer, length));

/** FNV-1a over the bytes of f32 bits, in order, as the native test makes it. */
function mix(hash: bigint, words: number[]): bigint {
    for (const word of words) {
        for (let k = 0; k < 4; k++) {
            hash ^= BigInt((word >>> (8 * k)) & 0xff);
            hash = (hash * 0x100000001b3n) & 0xffffffffffffffffn;
        }
    }
    return hash;
}

test("both builds are under the size limit and need nothing from the page to load", async () => {
    for (const each of [path, scalarPath]) {
        expect(Bun.file(each).size).toBeLessThan(512 * 1024);
        const module = await WebAssembly.compile(await Bun.file(each).arrayBuffer());
        expect(WebAssembly.Module.imports(module)).toEqual([]);
    }
});

test("the page's engine gives the very numbers the native engine gives, with SIMD and without", async () => {
    for (const each of [path, scalarPath]) {
        const engine = await load(each);
        expect(engine.create(2, 7, 0.5, 1, 1, 1, 1, 8, 8, 1, 0, 5, 1)).toBeGreaterThan(0);
        expect(engine.envs_create(3, 0)).toBe(3);
        let hash = 0xcbf29ce484222325n;
        hash = mix(hash, bits(engine, engine.envs_observations()));
        const wide = engine.actions_length();
        for (let step = 0; step < 600; step++) {
            const actions = new Float32Array(engine.memory.buffer, engine.envs_actions(), 3 * wide);
            // the native test's whole-number pattern, so no sine is needed to make the same actions
            for (let k = 0; k < actions.length; k++) actions[k] = ((((Math.floor(k / wide) * 7 + step * 13 + (k % wide) * 5) % 21) - 10) / 10);
            engine.envs_step(1);
            hash = mix(hash, bits(engine, engine.envs_observations()));
            hash = mix(hash, bits(engine, engine.envs_rewards()));
            hash = mix(hash, bits(engine, engine.envs_done()));
        }
        while (engine.generation() < 3) engine.train(8);
        hash = mix(hash, bits(engine, engine.history_best()));
        expect(hash).toBe(FINGERPRINT);
    }
});

test("a generation shared out among helpers, as the workers share it, learns exactly as one module alone", async () => {
    const alone = await load();
    const count = alone.create(4, 3, 0.2, 1, 1, 1, 1, 8, 8, 1, 0, 6, 5);
    while (alone.generation() < 3) alone.train(8);
    const lead = await load();
    lead.create(4, 3, 0.2, 1, 1, 1, 1, 8, 8, 1, 0, 6, 5);
    const helpers = await Promise.all([load(), load()]);
    for (const helper of helpers) helper.create(4, 3, 0.2, 1, 1, 1, 1, 8, 8, 1, 0, 6, 77);
    while (lead.generation() < 3) {
        const todo = [...Array(8).keys()].filter((member) => !lead.member_scored(member));
        const population = floats(lead, lead.population_weights());
        const answers: [number, number, number][] = [];
        helpers.forEach((helper, w) => {
            const share = todo.filter((_, k) => k % 2 === w);
            new Float32Array(helper.memory.buffer, helper.evaluate_room(share.length), share.length * count).set(share.flatMap((member) => population.slice(member * count, (member + 1) * count)));
            const ran = helper.evaluate(share.length);
            const found = floats(helper, helper.evaluated());
            expect(found.length).toBe(2 * ran);
            share.forEach((member, k) => answers.push([member, found[2 * k]!, found[2 * k + 1]!]));
        });
        for (const [member, score, distance] of answers.reverse()) lead.record(member, score, distance);
    }
    expect(bits(lead, lead.best_weights())).toEqual(bits(alone, alone.best_weights()));
    expect(bits(lead, lead.history_best())).toEqual(bits(alone, alone.history_best()));
});

test("the show walks, can be held, dropped and pushed, and the world comes out to draw", async () => {
    const engine = await load();
    engine.create(2, 12, 0.4, 1, 1, 1, 1, 8, 8, 1, 0, 8, 1);
    expect(engine.legs_length()).toBe(2);
    expect(floats(engine, engine.show_bodies()).length).toBe(6 * 5);
    expect(floats(engine, engine.show_rays()).length).toBe(2 + 2 * engine.rays_length());
    expect(floats(engine, engine.ray_angles()).length).toBe(16);
    const ground = floats(engine, engine.land_ground(200, 0));
    expect(ground.length % 4).toBe(0);
    expect(floats(engine, engine.land_blocks(0)).length % 4).toBe(0);
    expect(floats(engine, engine.land_hazards(0)).length % 5).toBe(0);
    const [x, y] = floats(engine, engine.show_bodies());
    engine.show_hold(x! + 1, y! + 1);
    for (let i = 0; i < 60; i++) engine.show_step(1 / 60);
    const [heldX, heldY] = floats(engine, engine.show_bodies());
    expect(Math.hypot(heldX! - x! - 1, heldY! - y! - 1)).toBeLessThan(0.15);
    engine.show_drop();
    for (let i = 0; i < 60; i++) engine.show_step(1 / 60);
    expect(floats(engine, engine.show_bodies())[1]!).toBeLessThan(heldY! - 0.5);
    expect(engine.show_push(heldX!, heldY! - 0.8, 10, 0)).toBeGreaterThanOrEqual(0);
    expect(floats(engine, engine.picture(32)).length).toBe(32);
    // and with no creature made, nothing breaks
    const empty = await load();
    expect(empty.create(3, 1, 0, 0, 0, 0, 0, 8, 8, 1, 0, 0, 1)).toBe(0);
    expect(empty.show_step(1)).toBe(0);
});

test("many creatures step together, as fast as this runtime goes", async () => {
    const engine = await load();
    engine.create(2, 1, 0.5, 1, 1, 1, 1, 8, 8, 1, 0, 30, 1);
    expect(engine.envs_create(64, 0)).toBe(64);
    const started = performance.now();
    const steps = engine.envs_step(300);
    const seconds = (performance.now() - started) / 1000;
    expect(steps).toBe(64 * 300);
    console.log(`64 creatures stepped ${Math.round(steps / seconds)} times a second in the page's engine, here`);
});

test("a seed is a number or a word, the same in every browser, and a world is a link", () => {
    expect(seedNumber("42")).toBe(42);
    expect(seedNumber(" 4294967295 ")).toBe(4294967295);
    expect(seedNumber("meadow")).toBe(seedNumber("Meadow"));
    expect(seedNumber("meadow")).not.toBe(seedNumber("meadows"));
    // FNV-1a of "a"
    expect(seedNumber("a")).toBe(0xe40c292c);
    expect(anotherSeed("meadow", 0)).not.toBe("meadow");
    expect(anotherSeed("meadow", 0.999)).not.toBe("meadow");
    const recipe = { ...DEFAULT_RECIPE, seed: "otter", hard: 70, on: { ...DEFAULT_RECIPE.on, hazards: false }, legs: 4 as const };
    const parts = new Map(linkParts(recipe));
    expect(fromLink((name) => parts.get(name) ?? null, DEFAULT_RECIPE)).toEqual(recipe);
    expect(engineRecipe(recipe)).toEqual({ seed: seedNumber("otter"), difficulty: 0.7, amounts: [0.6, 0, 0.4, 0.4] });
    expect(fromLink(() => null, DEFAULT_RECIPE)).toBeNull();
    expect(fromLink((name) => (name === "seed" ? "x" : name === "hard" ? "300" : null), DEFAULT_RECIPE)).toBeNull();
    expect(valid(DEFAULT_RECIPE)).toBe(true);
    expect(KINDS.length).toBe(4);
});
