// What the generalist's built engine, public/wasm/generalist.wasm, is held to from the page's side:
// it loads with nothing given to it and stays small; it gives the very numbers the native engine
// gives (the fingerprint in walker/src/generalist/envs_tests.rs); the builds with and without SIMD
// agree; a generation shared out learns as one module alone; the show, the world's lists and the
// creatures for a learner work. And what roaming.ts is held to: seeds and links.

import { expect, test } from "bun:test";
import { DEFAULT_RECIPE, KINDS, anotherSeed, brainColumns, counted, engineRecipe, fromLink, lasted, linkParts, seedNumber, senseLayout, valid, type Engine } from "./roaming";

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

test("the show walks, can be taken hold of and let go, and the world comes out to draw", async () => {
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
    // taken by its body, it hangs a little under the hand, and falls when let go
    expect(engine.show_under(x!, y!)).toBe(1);
    expect(engine.show_under(x!, y! + 3)).toBe(0);
    expect(engine.show_grab(x!, y!)).toBe(1);
    engine.show_hand(x! + 1, y! + 1);
    for (let i = 0; i < 90; i++) engine.show_step(1 / 60);
    const [heldX, heldY] = floats(engine, engine.show_bodies());
    expect(Math.hypot(heldX! - x! - 1, heldY! - y! - 1)).toBeLessThan(0.2);
    expect(floats(engine, engine.show_held())[0]).toBe(1);
    engine.show_let_go();
    expect(floats(engine, engine.show_held())[0]).toBe(0);
    for (let i = 0; i < 60; i++) engine.show_step(1 / 60);
    expect(floats(engine, engine.show_bodies())[1]!).toBeLessThan(heldY! - 0.5);
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

/** The native engine's fingerprint of a small learner's state over two updates of practice (walker/src/generalist/practice_tests.rs). */
const PRACTICE_FINGERPRINT = 0xb66b94ffb5e3f67cn;

test("practice in the page's engine learns to the bit as natively, with SIMD and without", async () => {
    for (const each of [path, scalarPath]) {
        const engine = await load(each);
        engine.create(2, 1, 0.5, 1, 1, 1, 1, 8, 8, 1, 0, 30, 1);
        expect(engine.practice_create(2, 7, 3)).toBeGreaterThan(0);
        let hash = 0xcbf29ce484222325n;
        for (let update = 0; update < 2; update++) {
            engine.practice_update();
            hash = mix(hash, bits(engine, engine.practice_state()));
        }
        expect(hash).toBe(PRACTICE_FINGERPRINT);
    }
});

test("an update shared out as the workers share it, with one worker, is the update done alone", async () => {
    const alone = await load();
    const shared = await load();
    for (const engine of [alone, shared]) {
        engine.create(4, 1, 0.3, 1, 1, 1, 1, 8, 8, 1, 0, 30, 1);
        engine.practice_create(3, 2, 5);
    }
    for (let update = 0; update < 2; update++) {
        alone.practice_update();
        const share = new Float64Array(shared.memory.buffer, shared.practice_local(), shared.length()).slice();
        const weights = new Float32Array(shared.memory.buffer, shared.practice_weights(), shared.length()).slice();
        const shares = shared.practice_shares_room(1);
        new Float64Array(shared.memory.buffer, shares, share.length).set(share);
        const room = shared.practice_weights_room();
        new Float32Array(shared.memory.buffer, room, weights.length).set(weights);
        expect(shared.practice_finish(1)).toBe(1);
    }
    expect(shared.practice_updates()).toBe(2);
    expect(bits(shared, shared.practice_state())).toEqual(bits(alone, alone.practice_state()));
    expect(Array.from(new Float64Array(shared.memory.buffer, shared.practice_running(), shared.length()))).toEqual(Array.from(new Float64Array(alone.memory.buffer, alone.practice_running(), alone.length())));
});

test("a learner kept and taken back is the same learner, and drives the show", async () => {
    const engine = await load();
    engine.create(2, 4, 0.2, 1, 1, 1, 1, 8, 8, 1, 0, 30, 1);
    engine.practice_create(2, 1, 1);
    engine.practice_update();
    const state = new Float32Array(engine.memory.buffer, engine.practice_state(), engine.length()).slice();
    const running = new Float64Array(engine.memory.buffer, engine.practice_running(), engine.length()).slice();
    const page = await load();
    page.create(2, 4, 0.2, 1, 1, 1, 1, 8, 8, 1, 0, 30, 1);
    const [stateRoom, runningRoom] = [page.state_room(0), page.running_room()];
    new Float32Array(page.memory.buffer, stateRoom, state.length).set(state);
    new Float64Array(page.memory.buffer, runningRoom, running.length).set(running);
    expect(page.policy_load()).toBe(1);
    for (let i = 0; i < 120; i++) page.show_step(1 / 60);
    expect(page.show_seconds()).toBeGreaterThan(0.5);
    // and the weights alone will do for the show; anything else is turned away
    const weights = page.state_room(1);
    const count = page.length();
    const room = page.running_room();
    new Float32Array(page.memory.buffer, weights, count).set(state.subarray(0, count));
    new Float64Array(page.memory.buffer, room, running.length).set(running);
    expect(page.policy_load()).toBe(1);
    page.state_room(1);
    const spoiled = page.running_room();
    new Float64Array(page.memory.buffer, spoiled, running.length).fill(Number.NaN);
    expect(page.policy_load()).toBe(0);
});

test("the brain on show is drawn as it thinks, evolution's or practice's", async () => {
    const engine = await load();
    engine.create(2, 4, 0.2, 1, 1, 1, 1, 8, 8, 1, 0, 30, 1);
    engine.show_step(0.5);
    // a dot for each ray, then the rest of what it senses; 8 neurons; 13 outputs for evolution's brain
    const bred = brainColumns(new Float32Array(engine.memory.buffer, engine.brain_picture(), engine.length()).slice());
    expect(bred?.lit.map((column) => column.length)).toEqual([16 + 18, 8, 13]);
    engine.practice_create(2, 1, 1);
    const state = new Float32Array(engine.memory.buffer, engine.practice_state(), engine.length()).slice();
    const running = new Float64Array(engine.memory.buffer, engine.practice_running(), engine.length()).slice();
    const [stateRoom, runningRoom] = [engine.state_room(0), engine.running_room()];
    new Float32Array(engine.memory.buffer, stateRoom, state.length).set(state);
    new Float64Array(engine.memory.buffer, runningRoom, running.length).set(running);
    expect(engine.policy_load()).toBe(1);
    for (let i = 0; i < 30; i++) engine.show_step(1 / 60);
    const policy = brainColumns(new Float32Array(engine.memory.buffer, engine.brain_picture(), engine.length()).slice());
    // practice's policy senses its energy, having eaten and where it looks, and feels touch: its body, two
    // feet, being held, and the jolt across and up; and it turns its eye, an action before the hop
    expect(policy?.lit.map((column) => column.length)).toEqual([16 + 18 + 3 + 6, 64, 64, 6]);
    expect(policy?.flows.map((flow) => flow.length)).toEqual([43 * 64, 64 * 64, 64 * 6]);
    expect(policy?.flows.every((flow) => flow.every(Number.isFinite) && flow.some((amount) => amount !== 0))).toBe(true);
    expect(brainColumns(new Float32Array([2, 3, 1, 0, 0]))).toBeUndefined();
});

test("a creature that wants things shows its energy, its food and where it looks, and food can be dropped for it", async () => {
    const engine = await load();
    engine.create(2, 4, 0.2, 1, 1, 1, 1, 8, 8, 1, 0, 30, 1);
    // evolution's creature neither eats nor turns its eye
    expect(floats(engine, engine.show_needs())[0]).toBe(-1);
    expect(engine.show_drop_food(1, 1)).toBe(0);
    engine.practice_create(2, 1, 1);
    const state = new Float32Array(engine.memory.buffer, engine.practice_state(), engine.length()).slice();
    const running = new Float64Array(engine.memory.buffer, engine.practice_running(), engine.length()).slice();
    const [stateRoom, runningRoom] = [engine.state_room(0), engine.running_room()];
    new Float32Array(engine.memory.buffer, stateRoom, state.length).set(state);
    new Float64Array(engine.memory.buffer, runningRoom, running.length).set(running);
    expect(engine.policy_load()).toBe(1);
    // born full, at full strength, looking a little down ahead
    const [energy, vigour, , , gaze] = floats(engine, engine.show_needs());
    expect([energy, vigour]).toEqual([1, 1]);
    expect(gaze).toBeCloseTo((-30 * Math.PI) / 180, 5);
    for (let i = 0; i < 10; i++) engine.show_step(1 / 60);
    expect(floats(engine, engine.show_senses()).length).toBe(senseLayout(2).length);
    expect(floats(engine, engine.show_needs())[0]!).toBeLessThan(1);
    // food dropped falls and lies on the ground; the rays turn with the eye
    const before = floats(engine, engine.show_food()).length;
    expect(engine.show_drop_food(-3, 1.5)).toBe(1);
    expect(floats(engine, engine.show_food()).length).toBe(before + 2);
    for (let i = 0; i < 60; i++) engine.show_step(1 / 60);
    const food = floats(engine, engine.show_food());
    const dropped = food.findIndex((value, k) => k % 2 === 0 && Math.abs(value + 3) < 1e-4);
    expect(food[dropped + 1]!).toBeCloseTo(0.08, 3);
    const angles = floats(engine, engine.ray_angles());
    expect(angles.length).toBe(16);
    expect(angles[8]! - angles[7]!).toBeLessThan(angles[1]! - angles[0]!);
});

test("practice runs as fast as this runtime goes", async () => {
    const engine = await load();
    engine.create(2, 1, 0.5, 1, 1, 1, 1, 8, 8, 1, 0, 30, 1);
    engine.practice_create(32, 1, 1);
    const started = performance.now();
    for (let update = 0; update < 3; update++) engine.practice_update();
    const seconds = (performance.now() - started) / 1000;
    // three updates of 32 creatures, 64 decisions of 4 steps each: at most 24,576 steps, a few less where runs end mid-decision
    expect(engine.practice_updates()).toBe(3);
    expect(engine.practice_steps()).toBeLessThanOrEqual(3 * 32 * 64 * 4);
    expect(engine.practice_steps()).toBeGreaterThan(0.8 * 3 * 32 * 64 * 4);
    const time = (backward: number) => {
        const began = performance.now();
        const rows = engine.net_work(40, backward);
        expect(rows).toBe(40 * 512);
        return rows / ((performance.now() - began) / 1000);
    };
    const [forward, both] = [time(0), time(1)];
    console.log(`a 114-64-64-5 network: forward ${Math.round(forward)} rows a second, forward and backward ${Math.round(both)}, in the page's engine, here`);
    console.log(`practice: ${Math.round(engine.practice_steps() / seconds)} steps of the physics and ${(3 / seconds).toFixed(2)} updates a second in the page's engine, here`);
    // far under what it does (about 90,000 steps a second here), so only a slip of many times fails, not a busy machine
    expect(engine.practice_steps() / seconds).toBeGreaterThan(5000);
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

test("how long it has practised and how many steps are said in plain words", () => {
    expect(lasted(42.7)).toBe("42 s");
    expect(lasted(130)).toBe("2 min 10 s");
    expect(lasted(7500)).toBe("2 h 5 min");
    expect(counted(950)).toBe("950");
    expect(counted(12_400)).toBe("12 thousand");
    expect(counted(3_250_000)).toBe("3.3 million");
});

