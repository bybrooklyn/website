// The Walker mini's training, off the page's thread so drawing stays smooth. It loads its own copy of
// the engine, trains in slices of about ten milliseconds, and tells the page whenever a generation
// finishes or a better walker turns up, with that walker's brain and the whole new generation.
//
// It trains only while the page is drawing the mini: the page says so about once a second, and when
// it falls quiet (the tab hidden, the mini scrolled away) training waits.

import { ENGINE, POPULATION, SECONDS, read, start, write, type Engine } from "../minis/walking";

/** What the page sends. */
export type Order =
    | { kind: "begin"; setup: number; legs: number; ground: number[]; seed: number; brain?: Float32Array }
    | { kind: "pause" }
    | { kind: "resume" }
    | { kind: "beat" };

/** What the worker sends back. */
export type Report =
    | { kind: "progress"; setup: number; generation: number; runs: number; distance: number; brain?: Float32Array; population?: Float32Array }
    | { kind: "failed"; why: string };

const tell = (report: Report, moved: Transferable[] = []) => postMessage(report, { transfer: moved });

let engine: Engine | undefined;
const loading = fetch(ENGINE)
    .then((answer) => answer.arrayBuffer())
    .then(start)
    .then((made) => (engine = made))
    .catch((error: unknown) => tell({ kind: "failed", why: String(error) }));

let setup = -1;
let paused = false;
let heard = 0;
let best = -Infinity;
let generation = 0;
let timer: ReturnType<typeof setTimeout> | undefined;

function slice(): void {
    timer = undefined;
    if (!engine || setup < 0) return;
    // quiet for a while: the page is not drawing, so look again later
    if (paused || performance.now() - heard > 2500) {
        timer = setTimeout(slice, 250);
        return;
    }
    const began = performance.now();
    while (performance.now() - began < 10) engine.train(1);
    const finished = engine.generation();
    const score = engine.best_score();
    const report: Report = { kind: "progress", setup, generation: finished, runs: engine.generation_runs(), distance: engine.best_distance() };
    const moved: Transferable[] = [];
    if (score > best) {
        best = score;
        report.brain = read(engine, engine.best_weights(), engine.weights_length());
        moved.push(report.brain.buffer);
    }
    if (finished !== generation) {
        generation = finished;
        report.population = read(engine, engine.population_weights(), engine.population_length() * engine.weights_length());
        moved.push(report.population.buffer);
    }
    tell(report, moved);
    timer = setTimeout(slice, 0);
}

onmessage = async (event: MessageEvent<Order>) => {
    const order = event.data;
    if (order.kind === "beat") heard = performance.now();
    else if (order.kind === "pause") paused = true;
    else if (order.kind === "resume") paused = false;
    else {
        await loading;
        if (!engine) return;
        heard = performance.now();
        engine.create(order.legs, POPULATION, SECONDS, order.seed);
        write(engine, engine.ground_room(order.ground.length / 4), order.ground);
        engine.ground_set(order.ground.length / 4);
        if (order.brain && order.brain.length === engine.weights_length()) {
            write(engine, engine.weights_room(), order.brain);
            engine.weights_load();
        }
        [setup, best, generation] = [order.setup, -Infinity, 0];
    }
    if (timer === undefined) slice();
};
