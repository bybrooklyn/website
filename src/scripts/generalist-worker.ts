// The generalist mini's learning, off the page's thread so drawing stays smooth. It works as the
// Walker's worker does (src/scripts/walker-worker.ts): each worker loads its own copy of the engine;
// one leads, holding the generation, handing out its runs to the others over channels of their own
// and breeding the next; the others run what they are handed and send back how each went. The page
// hears from the leader whenever a generation finishes or a better creature turns up, with its brain.
// Which worker ran which run changes nothing, so the same seed learns the same way with one or eight.
//
// It learns only while the page is drawing the mini: the page says so about once a second, and when
// it falls quiet (the tab hidden, the mini scrolled away) the leader hands out nothing more.

import { BRAIN, POPULATION, SECONDS, engineAddress, list, start, write, type Engine } from "../minis/roaming";

/** What the page sends. */
export type Order =
    | { kind: "begin"; setup: number; legs: number; seed: number; difficulty: number; amounts: [number, number, number, number]; brainSeed: number }
    | { kind: "pause" }
    | { kind: "resume" }
    | { kind: "beat" }
    /** To the leader: these are its helpers now, each a port to one; and whether to rest as long as it works. */
    | { kind: "helpers"; ports: MessagePort[]; gentle: boolean }
    /** To a helper: the port its leader's runs come in by. */
    | { kind: "lead"; port: MessagePort };

/** What the worker sends back: how far learning has got, and the best brain when there is a better one. */
export type Report = { kind: "progress"; setup: number; generation: number; runs: number; distance: number; furthest: number[]; brain?: Float32Array } | { kind: "failed"; why: string };

/** A share of a generation, from the leader to a helper, and back with a score and a distance for each. */
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

/** How many runs go in a share: up to four, fewer when there are many helpers to share a generation among. */
const share = () => Math.max(1, Math.min(4, Math.floor(queue.length / (helpers.length + 1))));
/** How many shares a helper holds at once, so it has the next to start while its answer travels back. */
const HELD = 2;

let helpers: { port: MessagePort; held: number[][] }[] = [];
/** The members of this generation not yet scored nor handed out, and the generation's brains. */
let queue: number[] = [];
let population: Float32Array | undefined;

/** Makes the engine the creature the page describes. A helper does the same, so every run starts from the same world. */
function make(order: Extract<Order, { kind: "begin" }>): void {
    if (!engine) return;
    engine.create(order.legs, order.seed, order.difficulty, ...order.amounts, POPULATION, BRAIN.hidden, BRAIN.layers, BRAIN.memory, SECONDS, order.brainSeed);
    setup = order.setup;
}

/** A new generation has begun: its unscored members go in the queue, and what helpers held is moot. */
function fresh(): void {
    if (!engine) return;
    generation = engine.generation();
    queue = [];
    for (let i = 0; i < POPULATION; i++) if (!engine.member_scored(i)) queue.push(i);
    population = list(engine, engine.population_weights());
    for (const helper of helpers) helper.held = [];
}

/** Takes in how members went, here or by a helper, and moves on if that finished the generation. */
function take(members: number[], found: Float32Array): void {
    if (!engine) return;
    members.forEach((member, k) => engine!.record(member, found[2 * k]!, found[2 * k + 1]!));
    if (engine.generation() !== generation) {
        report();
        fresh();
    }
}

function runHere(members: number[]): void {
    if (!engine || !population) return;
    const count = engine.weights_length();
    const room = engine.evaluate_room(members.length);
    members.forEach((member, k) => write(engine!, room + 4 * k * count, population!.subarray(member * count, (member + 1) * count)));
    engine.evaluate(members.length);
    take(members, list(engine, engine.evaluated()));
}

/** Hands shares to helpers with room for more, a share to each in turn before a second to any. */
function handOut(): void {
    if (!engine || !population || paused || quiet()) return;
    const count = engine.weights_length();
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

/** Tells the page how learning goes, with the best brain if it is better than the last one sent. */
function report(): void {
    if (!engine) return;
    const score = engine.best_score();
    const progress: Report = { kind: "progress", setup, generation: engine.generation(), runs: engine.generation_runs(), distance: engine.best_distance(), furthest: Array.from(list(engine, engine.history_distance())) };
    const moved: Transferable[] = [];
    if (score > best) {
        best = score;
        progress.brain = list(engine, engine.best_weights());
        moved.push(progress.brain.buffer);
    }
    tell(progress, moved);
}

/** The leader's work: hand out shares, and run shares here, for about ten milliseconds at a time. */
function slice(): void {
    timer = undefined;
    if (!engine || setup < 0) return;
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
    if (queue.length === 0 && helpers.some((helper) => helper.held.length > 0)) return;
    // gently, rest as long as the slice took, so learning uses about half of one core
    timer = setTimeout(slice, gentle ? performance.now() - began : 0);
}

let lead: MessagePort | undefined;
const waiting: Share[] = [];

/** A helper's work: run each share it is handed and send back how each went. */
function help(handed: Share): void {
    if (handed.setup > setup || !engine) {
        waiting.push(handed);
        return;
    }
    if (handed.setup < setup) return;
    const count = engine.weights_length();
    write(engine, engine.evaluate_room(handed.members.length), handed.brains);
    engine.evaluate(Math.min(handed.members.length, handed.brains.length / count));
    const found = list(engine, engine.evaluated());
    const answer: Answer = { setup: handed.setup, generation: handed.generation, members: handed.members, found };
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
        if (engine && setup >= 0) fresh();
    } else {
        await loading;
        if (!engine) return;
        heard = performance.now();
        make(order);
        [best, generation] = [-Infinity, 0];
        fresh();
        if (lead) {
            for (const handed of waiting.splice(0)) help(handed);
            return;
        }
    }
    if (!lead && timer === undefined) slice();
};
