// The generalist's learning by practice, off the page's thread. Each worker loads its own copy of the
// engine and practises with creatures of its own, each run in a fresh world of the visitor's kind. One
// leads. For each update every worker does an update of its own (a rollout, and the epochs over it),
// then sends the leader its weights and what it sensed; the leader averages the weights in the workers'
// order and sends the average and everything sensed round, so all go on from the same weights and
// rescale alike. One exchange an update: sharing each minibatch's gradient instead was measured, and
// the messages cost more than the work they shared. Only plain messages and transferred buffers pass.
// The page hears from the leader after each update, with the policy to show every few seconds and
// everything learned, to keep, every half minute.
//
// One worker alone does each update in one call, which gives the same learning as the shared way
// with one worker (src/minis/generalist.test.ts holds it to that). With a fixed seed and a fixed number
// of workers, practice is the same every time; a different number of workers learns differently.
//
// It practises only while the page is drawing the mini, as the evolution worker does.

import { BRAIN, POPULATION, SECONDS, engineAddress, list, list64, start, write, write64, type Engine } from "../minis/roaming";

/** What the page sends. */
export type Order =
    | { kind: "begin"; setup: number; legs: number; seed: number; difficulty: number; amounts: [number, number, number, number]; workers: number; index: number; learnerSeed: number; kept?: Kept }
    | { kind: "pause" }
    | { kind: "resume" }
    | { kind: "beat" }
    /** To the leader: its helpers, each a port to one; and whether to rest as long as it works. */
    | { kind: "helpers"; ports: MessagePort[]; gentle: boolean }
    /** To a helper: the port its leader's work comes in by. */
    | { kind: "lead"; port: MessagePort };

/** Everything practice has learned, to keep between visits: the learner's state and its running numbers, and how long it had practised. */
export interface Kept {
    state: Float32Array;
    running: Float64Array;
    seconds: number;
    steps: number;
}

/** What the leader sends back after each update. */
export type Report =
    | { kind: "practised"; setup: number; updates: number; steps: number; seconds: number; reached: number; policy?: { weights: Float32Array; running: Float64Array }; kept?: Kept; speed: number; waited: number[]; hard: number }
    | { kind: "failed"; why: string };

/**
 * Between the leader and a helper. Each carries the setup it is for, and anything for another setup
 * is not acted on. A request for a helper's update carries a number of its own, which the answer
 * gives back, and is always answered: by the update, or by "gone" if the helper is past that setup.
 */
type Work =
    | { kind: "start"; setup: number; state: Float32Array; running: Float64Array }
    | { kind: "local"; setup: number; asked: number }
    | { kind: "finish"; setup: number; shares: Float64Array; weights: Float32Array; workers: number };
type Answer = { kind: "local"; setup: number; asked: number; share: Float64Array; weights: Float32Array; steps: number } | { kind: "gone"; setup: number; asked: number };

/** Creatures practising together in all the workers; each has its share. */
const CREATURES = 32;
/** How often the page is sent the policy to show, and everything to keep, in seconds. */
const SHOW_EVERY = 3;
const KEEP_EVERY = 30;

const tell = (report: Report, moved: Transferable[] = []) => postMessage(report, { transfer: moved });

let engine: Engine | undefined;
const loading = fetch(engineAddress())
    .then((answer) => answer.arrayBuffer())
    .then(start)
    .then((made) => (engine = made))
    .catch((error: unknown) => tell({ kind: "failed", why: String(error) }));

let setup = -1;
/** What the page last said to begin, so the leader can take a new share of the creatures when its helpers change. */
let begun: Extract<Order, { kind: "begin" }> | undefined;
let paused = false;
let gentle = false;
let heard = 0;
let working = false;
/** The setup practice failed in, if it did; it is not tried again until the page begins another. */
let failed = -1;
let practised = { seconds: 0, steps: 0, shown: -Infinity, kept: 0 };
let reached: number[] = [];
let helpers: { port: MessagePort; waiting?: { asked: number; answered: (answer: Answer) => void } }[] = [];
let lead: MessagePort | undefined;
/** Counts changes of helpers, so an update shared with helpers since let go of is given up. */
let crew = 0;
/** How long the leader's own share of the last shared update took, and how long it then waited for its helpers, in milliseconds. */
let waited = [0, 0];
/** Steps of the physics the helpers took in the last shared update. */
let helperSteps = 0;
const waitingWork: Work[] = [];
/** Numbers the leader's requests, so an answer is taken only by the request it answers. */
let asking = 0;
/** How long the leader waits for a helper's answer before it gives the update up, in milliseconds. A helper still loading its engine can take a few seconds. */
const PATIENCE = 30_000;

const quiet = () => performance.now() - heard > 2500;

/** Makes the engine the creature and the world kind the page describes, practising with its share of the creatures. */
function make(order: Extract<Order, { kind: "begin" }>): void {
    if (!engine) return;
    engine.create(order.legs, order.seed, order.difficulty, ...order.amounts, POPULATION, BRAIN.hidden, BRAIN.layers, BRAIN.memory, SECONDS, 1);
    const share = Math.max(2, Math.ceil(CREATURES / order.workers));
    // each worker draws its own actions and has worlds of its own; the leader's weights are sent to all
    engine.practice_create(share, (order.learnerSeed + order.index) >>> 0, (order.learnerSeed * 64 + order.index) >>> 0);
    setup = order.setup;
    begun = order;
}

/** Writes a kept learner into the engine's practice. One of another length (kept by an older engine, or for another body) is refused before anything is written, so it never runs past its room. */
function load(state: Float32Array, running: Float64Array): boolean {
    if (!engine) return false;
    const stateRoom = engine.state_room(0);
    if (engine.length() !== state.length) return false;
    const runningRoom = engine.running_room();
    if (engine.length() !== running.length) return false;
    write(engine, stateRoom, state);
    write64(engine, runningRoom, running);
    return engine.practice_load() === 1;
}

/** Asks a helper for its update and waits for the answer, or for so long that it is given up as gone. */
function ask(helper: (typeof helpers)[number], forSetup: number): Promise<Answer> {
    asking += 1;
    const asked = asking;
    return new Promise((answered) => {
        const timer = setTimeout(() => helper.waiting?.answered({ kind: "gone", setup: forSetup, asked }), PATIENCE);
        helper.waiting = {
            asked,
            answered: (answer) => {
                clearTimeout(timer);
                helper.waiting = undefined;
                answered(answer);
            },
        };
        helper.port.postMessage({ kind: "local", setup: forSetup, asked } satisfies Work);
    });
}

/** Ends an update shared among workers with every worker's share and the average of their weights. */
function finish(shares: Float64Array, weights: Float32Array, workers: number): void {
    if (!engine) return;
    write64(engine, engine.practice_shares_room(workers), shares);
    write(engine, engine.practice_weights_room(), weights);
    engine.practice_finish(workers);
}

/** One update shared among the leader and its helpers: each does an update of its own on its own rollout, then all take the average of their weights. */
async function shared(): Promise<void> {
    if (!engine) return;
    // the setup and the helpers this update is for; if either changes while it waits, it is given up
    const [team, which] = [crew, setup];
    const asked = Promise.all(helpers.map((helper) => ask(helper, which)));
    const began = performance.now();
    const mine = list64(engine, engine.practice_local());
    const weights = list(engine, engine.practice_weights());
    const worked = performance.now();
    const theirs = await asked;
    waited = [worked - began, performance.now() - worked];
    if (team !== crew || which !== setup || theirs.some((answer) => answer.kind !== "local" || answer.setup !== which)) return;
    const workers = helpers.length + 1;
    const shares = new Float64Array(mine.length * workers);
    shares.set(mine, 0);
    // the average, added in the workers' order so it is the same every time
    theirs.forEach((answer, k) => {
        if (answer.kind !== "local") return;
        shares.set(answer.share, (k + 1) * mine.length);
        helperSteps += answer.steps;
        for (let i = 0; i < weights.length; i++) weights[i] = weights[i]! + answer.weights[i]!;
    });
    for (let i = 0; i < weights.length; i++) weights[i] = weights[i]! / workers;
    for (const helper of helpers) helper.port.postMessage({ kind: "finish", setup: which, shares, weights, workers } satisfies Work);
    finish(shares, weights, workers);
}

/** The leader's work: an update at a time while the page is drawing the mini, then a report. */
async function practise(): Promise<void> {
    if (working || !engine || setup < 0 || lead || setup === failed) return;
    working = true;
    try {
        while (engine && !paused && !quiet()) {
            const began = performance.now();
            const before = engine.practice_steps();
            const which = setup;
            helperSteps = 0;
            if (helpers.length === 0) engine.practice_update();
            else await shared();
            if (which !== setup) break;
            const took = (performance.now() - began) / 1000;
            practised.seconds += took;
            const steps = engine.practice_steps() - before + helperSteps;
            practised.steps += steps;
            reached.push(...list(engine, engine.practice_finished()));
            if (reached.length > 200) reached = reached.slice(-200);
            report(steps / took);
            // gently, rest as long as the update took, so practice uses about half of one core
            await new Promise((rested) => setTimeout(rested, gentle ? took * 1000 : 0));
        }
    } catch (error) {
        // a trap in the engine, or anything thrown: the page is told, and this setup is not tried again
        failed = setup;
        tell({ kind: "failed", why: String(error) });
    } finally {
        working = false;
    }
}

function report(speed: number): void {
    if (!engine) return;
    const progress: Report = { kind: "practised", setup, updates: engine.practice_updates(), steps: practised.steps, seconds: practised.seconds, reached: reached.length ? reached.reduce((a, b) => a + b, 0) / reached.length : 0, speed, waited, hard: engine.practice_difficulty() };
    const moved: Transferable[] = [];
    if (practised.seconds - practised.shown >= SHOW_EVERY) {
        practised.shown = practised.seconds;
        const state = list(engine, engine.practice_state());
        const running = list64(engine, engine.practice_running());
        // the weights come first, then Adam's two lists as long, then four numbers (walker/src/generalist/ppo.rs, `KEPT_AFTER`)
        progress.policy = { weights: state.slice(0, (state.length - 4) / 3), running };
        moved.push(progress.policy.weights.buffer);
        if (practised.seconds - practised.kept >= KEEP_EVERY) {
            practised.kept = practised.seconds;
            progress.kept = { state, running: running.slice(), seconds: practised.seconds, steps: practised.steps };
            moved.push(state.buffer);
        }
    }
    tell(progress, moved);
}

/** A helper's work: whatever its leader asks, answered on the leader's port. */
function help(work: Work): void {
    if (!engine || work.setup > setup) {
        waitingWork.push(work);
        return;
    }
    if (work.setup < setup) {
        // past that setup: a request is still answered, so the leader is never left waiting
        if (work.kind === "local") lead?.postMessage({ kind: "gone", setup: work.setup, asked: work.asked } satisfies Answer);
        return;
    }
    if (work.kind === "start") load(work.state, work.running);
    else if (work.kind === "finish") finish(work.shares, work.weights, work.workers);
    else {
        const before = engine.practice_steps();
        const share = list64(engine, engine.practice_local());
        const weights = list(engine, engine.practice_weights());
        lead?.postMessage({ kind: "local", setup, asked: work.asked, share, weights, steps: engine.practice_steps() - before } satisfies Answer, [share.buffer, weights.buffer]);
    }
}

/** Sends the leader's learner to every helper, so all start from the same weights. */
function startHelpers(): void {
    if (!engine || helpers.length === 0) return;
    const state = list(engine, engine.practice_state());
    const running = list64(engine, engine.practice_running());
    for (const helper of helpers) helper.port.postMessage({ kind: "start", setup, state: state.slice(), running: running.slice() } satisfies Work);
}

onmessage = async (event: MessageEvent<Order>) => {
    const order = event.data;
    if (order.kind === "beat") heard = performance.now();
    else if (order.kind === "pause") paused = true;
    else if (order.kind === "resume") paused = false;
    else if (order.kind === "lead") {
        lead = order.port;
        lead.onmessage = (message: MessageEvent<Work>) => help(message.data);
        return;
    } else if (order.kind === "helpers") {
        for (const helper of helpers) {
            helper.port.close();
            // an update waiting on a helper let go of is given up; the new helpers start from the leader's weights
            helper.waiting?.answered({ kind: "gone", setup: -1, asked: helper.waiting.asked });
        }
        crew += 1;
        gentle = order.gentle;
        helpers = order.ports.map((port) => ({ port }));
        // a leader already practising takes its share for the new number of workers, keeping what it has learned,
        // so effort changes how fast it learns and not what (the page gives the new helpers their shares)
        if (engine && begun && !lead && begun.workers !== helpers.length + 1) {
            const [state, running] = [list(engine, engine.practice_state()), list64(engine, engine.practice_running())];
            make({ ...begun, workers: helpers.length + 1, kept: undefined });
            load(state, running);
        }
        // an answer to a request given up (by time, or by a change of setup) is let go
        for (const helper of helpers) helper.port.onmessage = (message: MessageEvent<Answer>) => {
            if (helper.waiting?.asked === message.data.asked) helper.waiting.answered(message.data);
        };
        startHelpers();
    } else {
        await loading;
        if (!engine) return;
        heard = performance.now();
        make(order);
        practised = { seconds: order.kept?.seconds ?? 0, steps: order.kept?.steps ?? 0, shown: -Infinity, kept: order.kept?.seconds ?? 0 };
        reached = [];
        if (order.kept && !load(order.kept.state, order.kept.running)) practised = { seconds: 0, steps: 0, shown: -Infinity, kept: 0 };
        if (lead) {
            for (const work of waitingWork.splice(0)) help(work);
            return;
        }
        startHelpers();
    }
    if (!lead) void practise();
};
