// What the Walker mini's built engine, public/wasm/walker.wasm, is held to from the page's side: it
// loads with nothing given to it, stays small, trains, hands out and takes back a brain, and runs a
// show and a crowd that move and can be pushed. Also what walking.ts is held to: a brain survives a
// link exactly, and each kind of ground is what it says. `bun run wasm` builds it; `bun test` runs this.

import { expect, test } from "bun:test";
import { COURSE, DEFAULT_SETUP, KINDS, PRESETS, Terrain, courseAt, decode, encode, fromLink, heightAt, linkParts, oldLink, pieces, presetOf, valid, type Engine, type Setup } from "./walking";

const path = new URL("../../public/wasm/walker.wasm", import.meta.url);

type Walker = Engine;

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
    expect(walker.create(3, 8, 2, 1, 12, 1, 0, 0, 0)).toBe(0);
    // a two-legged brain: 19 senses, 12 hidden neurons, and 12 outputs (three to shape each joint's swing), each layer with its biases
    expect(walker.create(2, 8, 2, 1, 12, 1, 0, 0, 0)).toBe(12 * 20 + 12 * 13);
    expect([walker.senses_length(), walker.hidden_length(), walker.outputs_length()]).toEqual([19, 12, 12]);
    expect(walker.body_count()).toBe(5);
    expect(walker.create(4, 8, 2, 1, 12, 1, 0, 0, 0)).toBe(12 * 30 + 24 * 13);
    expect(walker.body_count()).toBe(9);
    expect(walker.create(1, 8, 2, 1, 12, 1, 0, 0, 0)).toBeGreaterThan(0);
});

test("training finishes generations, keeps a history, and learns the same way from the same seed", async () => {
    const one = await load();
    const two = await load();
    one.create(2, 8, 3, 5, 12, 1, 0, 0, 0);
    two.create(2, 8, 3, 5, 12, 1, 0, 0, 0);
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
    const count = one.create(2, 8, 3, 9, 12, 1, 0, 0, 0);
    while (one.generation() < 2) one.train(4);
    const weights = floats(one, one.best_weights(), count);
    one.show_reset();
    one.show_step(1);

    const two = await load();
    two.create(2, 8, 3, 1, 12, 1, 0, 0, 0);
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
    walker.create(2, 8, 3, 2, 12, 1, 0, 0, 0);
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
    walker.create(2, 6, 3, 3, 12, 1, 0, 0, 0);
    // a step up of half a metre right under the start
    const step = [-20, 0.5, 5, 0.5, 5, 0.5, 5, 0, 5, 0, 40, 0];
    new Float32Array(walker.memory.buffer, walker.ground_room(3), 12).set(step);
    expect(walker.ground_set(3)).toBe(1);
    const torso = floats(walker, walker.show_bodies(), 2);
    expect(torso[1]!).toBeGreaterThan(1.3);

    expect(walker.crowd_reset()).toBe(6);
    walker.crowd_step(0.5);
    const crowd = floats(walker, walker.crowd_bodies(), 6 * 4);
    expect(crowd.every(Number.isFinite)).toBe(true);
    // each walker has its own brain, so they do not all move alike
    const torsos = Array.from({ length: 6 }, (_, i) => crowd[i * 4]);
    expect(new Set(torsos).size).toBeGreaterThan(1);
    walker.crowd_stop();
    expect(walker.crowd_step(1)).toBe(0);
});

test("a brain written into a link reads back exactly, and text that is not one reads as nothing", async () => {
    const odd = [0, -0, 1, -1, Math.PI, 1e-40, -3.4e38, 1.17549435e-38, 0.1, 123456.789];
    const weights = Float32Array.from({ length: 268 }, (_, i) => odd[i % odd.length]! * (i % 3 === 0 ? 1 : -0.37) + i * 1e-3);
    const text = encode(weights);
    expect(text).toMatch(/^[A-Za-z0-9_-]+$/);
    const back = decode(text)!;
    expect(back.length).toBe(weights.length);
    expect(Array.from(new Uint32Array(back.buffer))).toEqual(Array.from(new Uint32Array(weights.buffer)));
    expect(decode(new URLSearchParams(`brain=${text}`).get("brain")!)).toEqual(weights);
    for (const wrong of ["", "abc", "a+b/", "%%%", encode(Float32Array.of(Number.NaN, 1))]) expect(decode(wrong)).toBeNull();

    // a trained brain taken out of the engine goes through a link and back in unchanged
    const walker = await load();
    const count = walker.create(2, 6, 2, 4, 12, 1, 0, 0, 0);
    walker.train(6);
    const best = new Float32Array(walker.memory.buffer, walker.best_weights(), count).slice();
    const score = walker.best_score();
    new Float32Array(walker.memory.buffer, walker.weights_room(), count).set(decode(encode(best))!);
    expect(walker.weights_load()).toBe(1);
    expect(walker.best_score()).toBe(score);
});

test("every kind of ground is level at the start, made the same each time, rougher when asked, and walkable by the engine", async () => {
    const walker = await load();
    const heights = (list: number[]) => list.filter((_, i) => i % 2 === 1);
    for (const kind of KINDS) {
        const smooth = pieces({ kind, rough: 0 });
        const rough = pieces({ kind, rough: 100 });
        expect(smooth.length % 4).toBe(0);
        expect(pieces({ kind, rough: 0 })).toEqual(smooth);
        expect(smooth.every(Number.isFinite)).toBe(true);
        for (const x of [-10, -2, 0, 1, 2.9]) expect(heightAt(smooth, x)).toBe(0);
        // the ground reaches far ahead, so a good walker never walks off the end
        expect(Math.max(...smooth.filter((_, i) => i % 2 === 0))).toBeGreaterThanOrEqual(400);
        const spread = (list: number[]) => Math.max(...heights(list)) - Math.min(...heights(list));
        if (kind !== "gaps") expect(spread(rough)).toBeGreaterThan(spread(smooth));

        walker.create(2, 4, 2, 1, 12, 1, 0, 0, 0);
        new Float32Array(walker.memory.buffer, walker.ground_room(rough.length / 4), rough.length).set(rough);
        expect(walker.ground_set(rough.length / 4)).toBe(1);
        walker.show_step(0.5);
        const [x, y] = floats(walker, walker.show_bodies(), 2);
        expect(Number.isFinite(x!) && y! > 0.5).toBe(true);
    }
    // gaps leave places with no ground under them, steps have risers, and hills rise and fall
    const gaps = pieces({ kind: "gaps", rough: 60 });
    expect([...Array(200).keys()].some((x) => heightAt(gaps, x + 3.5) === undefined)).toBe(true);
    const steps = pieces({ kind: "steps", rough: 60 });
    expect(steps.some((_, i) => i % 4 === 0 && steps[i] === steps[i + 2] && steps[i + 1] !== steps[i + 3])).toBe(true);
    const hills = [...Array(100).keys()].map((x) => heightAt(pieces({ kind: "hills", rough: 60 }), x + 10)!);
    expect(Math.max(...hills) - Math.min(...hills)).toBeGreaterThan(0.6);
});

test("a generation trained in one module runs as the crowd in another, as the page and its worker do", async () => {
    const worker = await load();
    const page = await load();
    const count = worker.create(2, 6, 2, 8, 12, 1, 0, 0, 0);
    page.create(2, 6, 2, 8, 12, 1, 0, 0, 0);
    while (worker.generation() < 2) worker.train(6);
    expect(Number.isFinite(worker.best_distance())).toBe(true);
    expect(worker.population_length()).toBe(6);
    const generation = floats(worker, worker.population_weights(), 6 * count);
    page.crowd_reset();
    const before = floats(page, page.crowd_bodies(), 6 * 4);
    new Float32Array(page.memory.buffer, page.crowd_room(6), 6 * count).set(generation);
    expect(page.crowd_start(6)).toBe(6);
    page.crowd_step(1);
    const after = floats(page, page.crowd_bodies(), 6 * 4);
    expect(after.every(Number.isFinite)).toBe(true);
    expect(after).not.toEqual(before);
    expect(page.show_seconds()).toBe(0);
    page.show_step(0.1);
    expect(page.show_seconds()).toBeCloseTo(0.1, 1);
    expect([0, 1]).toContain(page.show_fallen());
});

test("a whole walker, its setup and its brain, goes through a link and back unchanged", () => {
    const setup: Setup = { legs: 4, goal: 3, hidden: 32, layers: 3, memory: 8, ground: { kind: "gaps", rough: 65 }, length: 25, way: "generation" };
    const brain = Float32Array.from({ length: 1600 }, (_, i) => Math.sin(i * 1.7) * 3.1);
    const address = new URL("https://example.org/minis/walker/");
    for (const [name, value] of linkParts(setup, brain)) address.searchParams.set(name, value);
    const back = fromLink((name) => address.searchParams.get(name))!;
    expect(back.setup).toEqual(setup);
    expect(Array.from(new Uint32Array(back.brain.buffer))).toEqual(Array.from(new Uint32Array(brain.buffer)));
    // a link missing a part, or with a part out of range, is not a walker
    address.searchParams.set("neurons", "13");
    expect(fromLink((name) => address.searchParams.get(name))).toBeNull();
    expect(fromLink(() => null)).toBeNull();
    expect(valid(DEFAULT_SETUP)).toBe(true);
    expect(valid({ ...DEFAULT_SETUP, ground: { kind: "lava", rough: 10 } })).toBe(false);
    // a link from before the brain changed shape is known for what it is, and not read
    address.searchParams.set("neurons", "32");
    address.searchParams.delete("v");
    expect(fromLink((name) => address.searchParams.get(name))).toBeNull();
    expect(oldLink((name) => address.searchParams.get(name))).toBe(true);
    expect(oldLink(() => null)).toBe(false);
});

test("the show plays the best brain's run exactly as it was scored, and stops where it stopped", async () => {
    for (const [legs, goal] of [[2, 0], [4, 1], [1, 2], [2, 3]] as const) {
        const trainer = await load();
        const count = trainer.create(legs, 16, 0, 6, 16, 2, 3, goal, 1);
        expect(trainer.layers_length()).toBe(2);
        expect(trainer.memory_length()).toBe(3);
        expect(trainer.run_seconds()).toBe(goal === 1 ? 4 : 10);
        while (trainer.generation() < 3) trainer.train(16);
        const brain = floats(trainer, trainer.best_weights(), count);

        // the page's own module, given the brain the worker found
        const page = await load();
        page.create(legs, 16, 0, 99, 16, 2, 3, goal, 1);
        new Float32Array(page.memory.buffer, page.weights_room(), count).set(brain);
        expect(page.weights_load()).toBe(1);
        let steps = 0;
        while (!page.show_over() && steps < 2000) steps += Math.max(1, page.show_step(1 / 60));
        expect(page.show_over()).toBe(1);
        expect(page.show_score()).toBe(trainer.best_score());
        // a run of a set length counts no further than its length, though the body may be a little past it
        expect(Math.min(page.show_distance(), 1)).toBe(trainer.best_distance());
        expect(page.show_step(1)).toBe(0);
    }
});

test("brain sizes by name are what they say, and anything else is the visitor's own", () => {
    expect(PRESETS.map((preset) => preset.name)).toEqual(["small", "medium", "large"]);
    for (const preset of PRESETS) expect(presetOf(preset)).toBe(preset.name);
    expect(presetOf({ hidden: 16, layers: 1, memory: 4 })).toBe("own");
});

test("learning live tries one walker after another, keeping only what does better", async () => {
    const walker = await load();
    walker.create(2, 8, 0, 3, 8, 1, 0, 0, 2);
    expect(walker.live_begin()).toBe(1);
    expect(walker.live_attempt()).toBe(1);
    let best = -Infinity;
    let attempt = 1;
    for (let step = 0; step < 6000 && attempt < 12; step++) {
        attempt = walker.live_step(1 / 60);
        // the best only ever gets better
        expect(walker.live_best_score()).toBeGreaterThanOrEqual(best);
        best = walker.live_best_score();
    }
    expect(attempt).toBeGreaterThanOrEqual(12);
    expect(Number.isFinite(walker.live_best_distance())).toBe(true);
    expect(floats(walker, walker.live_best_weights(), walker.weights_length()).every(Number.isFinite)).toBe(true);
    walker.live_stop();
    expect(walker.live_attempt()).toBe(0);
});

test("an endless walk goes past its run's time, takes a better brain without starting again, and gets more ground", async () => {
    const walker = await load();
    const count = walker.create(4, 8, 0, 5, 8, 1, 0, 0, 0);
    while (walker.generation() < 4) walker.train(8);
    new Float32Array(walker.memory.buffer, walker.weights_room(), count).set(floats(walker, walker.best_weights(), count));
    walker.weights_load();
    expect(walker.show_endless()).toBe(1);
    // more ground well ahead, laid as the page lays it
    const terrain = new Terrain({ kind: "flat", rough: 30 });
    terrain.next(400);
    const more = terrain.next(500);
    new Float32Array(walker.memory.buffer, walker.ground_room(more.length / 4), more.length).set(more);
    walker.show_ground_extend(more.length / 4);
    let steps = 0;
    while (steps < 60 * 14 && !walker.show_over()) steps += Math.max(1, walker.show_step(1 / 60));
    // it went on past the ten seconds a training run lasts, unless it fell
    if (!walker.show_over()) expect(walker.show_seconds()).toBeGreaterThan(13);
    const before = walker.show_seconds();
    const fell = walker.show_over() === 1;
    new Float32Array(walker.memory.buffer, walker.weights_room(), count).set(floats(walker, walker.population_weights(), count));
    expect(walker.weights_swap()).toBe(1);
    walker.show_step(0.1);
    // a walk still going takes the new brain and goes on; one that had fallen starts again with it
    if (fell) expect(walker.show_seconds()).toBeLessThan(0.2);
    else expect(walker.show_seconds()).toBeGreaterThan(before);
    expect(walker.show_origin()).toBe(0);
});

test("the obstacle course runs level, hills, steps and gaps, each stretch and each lap harder", () => {
    expect(courseAt(0).kind).toBe("flat");
    expect(courseAt(3 + COURSE.level + 1).kind).toBe("hills");
    expect(courseAt(3 + COURSE.level + COURSE.hills + 1).kind).toBe("steps");
    expect(courseAt(3 + COURSE.level + COURSE.hills + COURSE.steps + 1).kind).toBe("gaps");
    expect(courseAt(3 + COURSE.level + 30).hard).toBeGreaterThan(courseAt(3 + COURSE.level + 1).hard);
    const lap = COURSE.level + COURSE.hills + COURSE.steps + COURSE.gaps;
    expect(courseAt(3 + lap + COURSE.level + 1).hard).toBeGreaterThan(courseAt(3 + COURSE.level + 1).hard);
    // made in one go or in stretches, the course is the same ground
    const whole = new Terrain({ kind: "course", rough: 0 }).next(300);
    const pieces = new Terrain({ kind: "course", rough: 0 });
    expect([...pieces.next(120), ...pieces.next(300)]).toEqual(whole);
    // it has gaps, where there is no ground at all
    expect([...Array(300).keys()].some((x) => heightAt(whole, x + 0.5) === undefined)).toBe(true);
});

test("a carrier has a parcel on a cupped back, and its brain feels where the parcel is", async () => {
    const walker = await load();
    walker.create(2, 8, 0, 1, 8, 1, 0, 5, 0);
    expect(walker.legs_length()).toBe(2);
    // the body, two parts for each leg, two rims, and the parcel
    expect(walker.body_count()).toBe(1 + 4 + 3);
    expect(walker.show_load()).toBe(7);
    expect(walker.senses_length()).toBe(21);
    walker.create(2, 8, 0, 1, 8, 1, 0, 0, 0);
    expect(walker.show_load()).toBe(-1);
});
