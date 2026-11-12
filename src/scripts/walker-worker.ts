// The Walker mini's training, off the page's thread so drawing stays smooth. Each worker loads its
// own copy of the engine. One of them leads: it holds the generation, hands out its runs, breeds the
// next, and tells the page whenever a generation finishes or a better walker turns up, with that
// walker's brain and the whole new generation. The others help: each runs the brains it is handed
// and sends back how each went. The page joins every helper to the leader by a MessageChannel of
// its own, so their talk never passes through the page. How many helpers there are is the page's
// "effort"; with none, the leader runs everything itself.
//
// Which worker ran which run changes nothing: every run starts from the same world, and the
// generation is bred in one place, by one random generator, once every score is in. So the same
// seed learns the same way with one worker or eight.
//
// It trains only while the page is drawing the mini: the page says so about once a second, and when
// it falls quiet (the tab hidden, the mini scrolled away) the leader hands out nothing more.

import { POPULATION, engineAddress, read, start, write, type Engine } from "../minis/walking";

/** What the page sends. */
export type Order =
    | { kind: "begin"; setup: number; legs: number; goal: number; hidden: number; layers: number; memory: number; length: number; ground: number[]; seed: number; brain?: Float32Array }
    | { kind: "pause" }
    | { kind: "resume" }
    | { kind: "beat" }
    /** To the leader: these are its helpers now, each a port to one; and whether to rest as long as it works. */
    | { kind: "helpers"; ports: MessagePort[]; gentle: boolean }
    /** To a helper: the port its leader's runs come in by. */
    | { kind: "lead"; port: MessagePort };

/** What the worker sends back. */
export type Report =
    | { kind: "progress"; setup: number; generation: number; runs: number; distance: number; brain?: Float32Array; population?: Float32Array }
    | { kind: "failed"; why: string };

/** A share of a generation, from the leader to a helper, and back with how each went. */
interface Share {
    setup: number;
    generation: number;
    members: number[];
    brains: Float32Array;
}
interface Answer {
    setup: number;
    generation: number;
    members: number[];
    /** A score and a distance for each member. */
    found: Float32Array;
}

const tell = (report: Report, moved: Transferable[] = []) => postMessage(report, { transfer: moved });

let engine: Engine | undefined;
const loading = fetch(engineAddress())
    .then((answer) => answer.arrayBuffer())
    .then(start)
    .then((made) => (engine = made))
    .catch((error: unknown) => tell({ kind: "failed", why: String(error) }));

let setup = -1;
let paused = false;
let gentle = false;
let heard = 0;
let best = -Infinity;
let generation = 0;
let timer: ReturnType<typeof setTimeout> | undefined;

/** How many runs go in a share: up to four, which fill the engine's lanes, and fewer when there are many helpers to share a generation among. */
const share = () => Math.max(1, Math.min(4, Math.floor(queue.length / (helpers.length + 1))));
/** How many shares a helper holds at once, so it has the next to start while its answer travels back. */
const HELD = 2;

/** The leader's helpers, each with the shares it holds, by when they were sent. */
let helpers: { port: MessagePort; held: number[][] }[] = [];
/** The members of this generation not yet scored nor handed out. */
let queue: number[] = [];
/** The generation's brains, read once when it begins. */
let population: Float32Array | undefined;

/** Makes the engine the walker the page describes. A helper does the same, so it starts every run from the same world. */
function make(order: Extract<Order, { kind: "begin" }>): void {
    if (!engine) return;
    engine.create(order.legs, POPULATION, 0, order.seed, order.hidden, order.layers, order.memory, order.goal, order.length);
    write(engine, engine.ground_room(order.ground.length / 4), order.ground);
    engine.ground_set(order.ground.length / 4);
    if (order.brain && order.brain.length === engine.weights_length()) {
        write(engine, engine.weights_room(), order.brain);
        engine.weights_load();
    }
    setup = order.setup;
}

/** A new generation has begun (or the walker was made): its unscored members go in the queue, and what helpers held is moot. */
function fresh(): void {
    if (!engine) return;
    generation = engine.generation();
    queue = [];
    for (let i = 0; i < POPULATION; i++) if (!engine.member_scored(i)) queue.push(i);
    population = read(engine, engine.population_weights(), POPULATION * engine.weights_length());
    for (const helper of helpers) helper.held = [];
}

/** Takes in how members went, run here or by a helper, and moves on if that finished the generation. */
function take(members: number[], found: Float32Array): void {
    if (!engine) return;
    members.forEach((member, k) => engine!.record(member, found[2 * k]!, found[2 * k + 1]!));
    if (engine.generation() !== generation) {
        report(true);
        fresh();
    }
}

/** Runs members here and records them. */
function runHere(members: number[]): void {
    if (!engine || !population) return;
    const count = engine.weights_length();
    const room = engine.evaluate_room(members.length);
    members.forEach((member, k) => write(engine!, room + 4 * k * count, population!.subarray(member * count, (member + 1) * count)));
    const ran = engine.evaluate(members.length);
    take(members, read(engine, engine.evaluated(), 2 * ran));
}

/** Hands shares to helpers with room for more, while there is anything to hand out. */
function handOut(): void {
    if (!engine || !population || paused || quiet()) return;
    const count = engine.weights_length();
    // a share to each helper in turn before a second to any, so every helper has work
    for (let round = 0; round < HELD; round++) {
        for (const helper of helpers) {
            if (helper.held.length > round || queue.length === 0) continue;
            const members = queue.splice(0, share());
            const brains = new Float32Array(members.length * count);
            members.forEach((member, k) => brains.set(population!.subarray(member * count, (member + 1) * count), k * count));
            helper.held.push(members);
            const handed: Share = { setup, generation, members, brains };
            helper.port.postMessage(handed, [brains.buffer]);
        }
    }
}

/** An answer from a helper: recorded if it is for this generation, and the helper given more. */
function heardFrom(helper: (typeof helpers)[number], answer: Answer): void {
    const at = helper.held.findIndex((members) => members[0] === answer.members[0]);
    if (at >= 0) helper.held.splice(at, 1);
    if (answer.setup !== setup || answer.generation !== generation) return;
    take(answer.members, answer.found);
    handOut();
    if (timer === undefined) timer = setTimeout(slice, 0);
}

/** The page has not been drawing the mini for a while. */
const quiet = () => performance.now() - heard > 2500;

/** Tells the page how training goes; with the generation's brains if it just finished one. */
function report(finished: boolean): void {
    if (!engine) return;
    const score = engine.best_score();
    const progress: Report = { kind: "progress", setup, generation: engine.generation(), runs: engine.generation_runs(), distance: engine.best_distance() };
    const moved: Transferable[] = [];
    if (score > best) {
        best = score;
        progress.brain = read(engine, engine.best_weights(), engine.weights_length());
        moved.push(progress.brain.buffer);
    }
    if (finished) {
        progress.population = read(engine, engine.population_weights(), engine.population_length() * engine.weights_length());
        moved.push(progress.population.buffer);
    }
    tell(progress, moved);
}

/** The leader's work: hand out shares, and run shares here, for about ten milliseconds at a time. */
function slice(): void {
    timer = undefined;
    if (!engine || setup < 0) return;
    // quiet for a while: the page is not drawing, so look again later
    if (paused || quiet()) {
        timer = setTimeout(slice, 250);
        return;
    }
    const began = performance.now();
    handOut();
    while (performance.now() - began < 10 && queue.length > 0) {
        runHere(queue.splice(0, share()));
        handOut();
    }
    report(false);
    // nothing left to run here: wait for the helpers' answers, which start the next slice
    if (queue.length === 0 && helpers.some((helper) => helper.held.length > 0)) return;
    // gently, rest as long as the slice took, so training uses about half of one core
    timer = setTimeout(slice, gentle ? performance.now() - began : 0);
}

/** A helper's work: run each share it is handed and send back how each went. */
let lead: MessagePort | undefined;
const waiting: Share[] = [];

function help(share: Share): void {
    if (share.setup > setup || !engine) {
        // the page's word of this walker has not come yet: keep it till it does
        waiting.push(share);
        return;
    }
    if (share.setup < setup) return;
    const count = engine.weights_length();
    write(engine, engine.evaluate_room(share.members.length), share.brains);
    const ran = engine.evaluate(Math.min(share.members.length, share.brains.length / count));
    const found = read(engine, engine.evaluated(), 2 * ran);
    const answer: Answer = { setup: share.setup, generation: share.generation, members: share.members, found };
    lead?.postMessage(answer, [found.buffer]);
}

onmessage = async (event: MessageEvent<Order>) => {
    const order = event.data;
    if (order.kind === "beat") heard = performance.now();
    else if (order.kind === "pause") paused = true;
    else if (order.kind === "resume") paused = false;
    else if (order.kind === "lead") {
        lead = order.port;
        lead.onmessage = (message: MessageEvent<Share>) => help(message.data);
        return;
    } else if (order.kind === "helpers") {
        for (const helper of helpers) helper.port.close();
        gentle = order.gentle;
        helpers = order.ports.map((port) => ({ port, held: [] as number[][] }));
        for (const helper of helpers) helper.port.onmessage = (message: MessageEvent<Answer>) => heardFrom(helper, message.data);
        // what the old helpers held is handed out again
        if (engine && setup >= 0) fresh();
    } else {
        await loading;
        if (!engine) return;
        heard = performance.now();
        make(order);
        [best, generation] = [-Infinity, 0];
        fresh();
        if (lead) {
            // a helper: run what came early for this walker
            for (const share of waiting.splice(0)) help(share);
            return;
        }
    }
    if (!lead && timer === undefined) slice();
};
