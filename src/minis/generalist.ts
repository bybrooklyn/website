// Generalist: a creature, seen from the side, that sees and learns its way through a world the visitor
// makes. A second mini on the Walker's engine (walker/README.md, "The generalist").
//
// The world is made from a recipe: a seed (a word or a number), how hard, and how much of each kind
// of thing, each with a switch. The recipe is kept in the address, so a world is a link. The creature
// learns by practice (src/scripts/generalist-practice.ts), or by evolution as the Walker does
// (src/scripts/generalist-worker.ts), in workers each with its own copy of the engine; this page runs
// one more copy that shows the newest policy, or the best brain so far, walking the world from the
// start, with its brain drawn beside it as it thinks. Its rays can be drawn, faint, so a visitor sees
// what it sees. A press takes hold of it, by its body or a leg, or of a box, a moving platform or a
// see-saw, with the engine's hand (walker/src/generalist/touch.rs): a spring to the pointer with a cap
// on its force, so what is held hangs and swings and a heavy thing lags; the keyboard has the same hand.
//
// The world's and the body's controls are in a strip under the world, and the brain, a chart of how far
// it gets and the learning in a column beside it, in the panel style the minis use. What this and the
// worker share is in roaming.ts.

import { el, type Mote, type Scene } from "../mote/stage";
import type { Kept, Order as PracticeOrder, Report as PracticeReport } from "../scripts/generalist-practice";
import type { Order, Report } from "../scripts/generalist-worker";
import { BRAIN, DEFAULT_RECIPE, KINDS, LEGS, POPULATION, SECONDS, SEEN, anotherSeed, brainColumns, counted, engineAddress, rewarded, engineRecipe, fromLink, lasted, linkParts, list, start as startEngine, valid, write, write64, type Engine, type Kind, type Recipe } from "./roaming";
import { EFFORTS, machine, tenths, workersFor, type Effort } from "./walking";

export const label = "A little creature with legs, seen from the side, finding its way over gaps, ledges, water and boxes in a world made from a seed. Faint lines from its eye show what it sees. It and the boxes and platforms can be picked up and moved: with the pointer, or with Space to take hold and the arrows to move the hand.";

/** How long the creature rests where its run ended before starting again, in seconds. */
const REST = 1;
/** The world is made this far ahead of what is drawn, in metres. */
const AHEAD = 40;
/** How far an arrow key moves the keyboard's hand, in metres. */
const KEY_STEP = 0.25;

/** How the creature learns: by evolution, the best of many tries kept and varied, or by practice (PPO, in walker/src/generalist/ppo.rs). */
type How = "evolution" | "practice";

/** What practice has learned is kept in the browser between visits, one learner for each body: a new world carries on with what was learned. */
const KEEPING = "generalist-practice";
const keptKey = (recipe: Recipe) => String(recipe.legs);

/**
 * The store's version. At 2 two legs began to practise for a pace, without sensing a rhythm (walker/README.md,
 * "How two legs came to walk"), and opening the store at 2 forgot two-legged learners kept before. At 3 the
 * creatures began to feel touch, so every learner kept before has too few senses to be taken up: opening the
 * store at 3 forgets them all, and learners are kept by body alone from then on, not by kind of world.
 */
const KEEPING_VERSION = 3;

/** Opens the browser's store for kept learners. */
function store(): Promise<IDBDatabase> {
    return new Promise((opened, failed) => {
        const asked = indexedDB.open(KEEPING, KEEPING_VERSION);
        asked.onupgradeneeded = (event) => {
            if (event.oldVersion < 1) {
                asked.result.createObjectStore("kept");
                return;
            }
            // every learner kept before version 3 senses too little to be taken up
            asked.transaction?.objectStore("kept").clear();
        };
        asked.onsuccess = () => opened(asked.result);
        asked.onerror = () => failed(asked.error);
    });
}

/** Does something with the store, and nothing if the browser will not keep anything. */
async function keeping<T>(what: (kept: IDBObjectStore) => IDBRequest<T>): Promise<T | undefined> {
    try {
        const db = await store();
        // each use opens the store and closes it after, rather than leaving a connection open every half minute
        try {
            return await new Promise<T | undefined>((done) => {
                const asked = what(db.transaction("kept", "readwrite").objectStore("kept"));
                asked.onsuccess = () => done(asked.result);
                asked.onerror = () => done(undefined);
            });
        } finally {
            db.close();
        }
    } catch {
        return undefined;
    }
}

export default function generalist(m: Mote): Scene {
    const kept = m.recall<Recipe>("generalist", DEFAULT_RECIPE, 1);
    let recipe: Recipe = fromLink((name) => m.link.get(name), valid(kept) ? kept : DEFAULT_RECIPE) ?? (valid(kept) ? kept : DEFAULT_RECIPE);
    let effort: Effort = m.recall<Effort>("walker-effort", "normal");
    if (!EFFORTS.some((each) => each.effort === effort)) effort = "normal";
    let showRays = m.recall<boolean>("generalist-rays", true);
    // practice first: the page opens on a creature that knows nothing, learning from the first second
    let how: How = m.recall<How>("generalist-how", "practice") === "evolution" ? "evolution" : "practice";
    /** How practice goes: how long and how many steps, how far its practice runs get, how far the shown creature got in its last run here, and the next policy to show. */
    let practice = { seconds: 0, steps: 0, reached: 0, here: -1, speed: 0, waited: [0, 0], hard: 0 };
    let policy: { weights: Float32Array; running: Float64Array } | undefined;
    /** How far it got as it learned, for the chart: steps practised (or generations) against metres. */
    let learned: { x: number; y: number }[] = [];
    /** What the creature on show was just rewarded and charged for, said beside it, and when it was last read. */
    let lately: { words: string; good: boolean }[] = [];
    let heardRewards = 0;
    /** A learner being forgotten ("start over"), which must be gone before the kept one is read again. */
    let forgetting: Promise<unknown> = Promise.resolve();
    /** The policy last put on show, put on show again at once when the world changes and practice carries on. */
    let onShow: { weights: Float32Array; running: Float64Array } | undefined;
    /** Said when the store has been read after a change of body: whether it took up a learner kept for that body. */
    let tellKept: ((found: boolean) => void) | undefined;
    /** A few words for a screen reader, said by the live line in the column. */
    let speak = (_words: string) => {};

    let engine: Engine | undefined;
    let worker: Worker | undefined;
    let helpers: Worker[] = [];
    let made: Order | undefined;
    let here = false;
    let id = 0;
    let generation = 0;
    let runs = 0;
    let paused = false;
    let waiting: Float32Array | undefined;
    let shown = false;
    let furthest = 0;
    let ended = 0;
    let beat = 0;
    let ticks = 0;
    /** The world as drawn: ground pieces, platforms and hazards, in metres from the start, and how far it has been made. */
    let ground: number[] = [];
    let blocks: number[] = [];
    let hazards: number[] = [];
    let reached = 0;
    let angles: Float32Array = new Float32Array(16);
    const camera = { x: 0, y: 0.5 };
    let looking = { x: 1, y: 0 };
    let last: { x: number; y: number } | undefined;
    /** What the hand holds: 0 nothing, 1 the creature, 2 a thing; and the keyboard's hand, where it is, once a key has moved it. */
    let holding = 0;
    let keyHand: { x: number; y: number } | undefined;
    let notice = { text: "", until: 0 };
    /** Why learning has stopped, said in the status line in place of how it goes, if it has. */
    let stopped = "";

    const tell = (order: Order | PracticeOrder) => worker?.postMessage(order);

    /** A point for the chart, when there is more learned to show; when there are many, every other one is let go. */
    const note = (x: number, y: number) => {
        // nothing until a run has been finished, so the line does not start with a fall to nothing
        if (x <= (learned.at(-1)?.x ?? -1) || (learned.length === 0 && y <= 0)) return;
        learned.push({ x, y });
        if (learned.length > 400) learned = learned.filter((_, k) => k % 2 === 0 || k === learned.length - 1);
    };

    /** The world's lists as far as `until`, read again from where they were left. */
    const extend = (until: number) => {
        if (!engine || until <= reached) return;
        const more = list(engine, engine.land_ground(until + AHEAD, ground.length / 4));
        ground.push(...more);
        blocks.push(...list(engine, engine.land_blocks(blocks.length / 4)));
        hazards.push(...list(engine, engine.land_hazards(hazards.length / 5)));
        reached = until + AHEAD;
    };

    /** Begins learning in the world described. With `carry`, practice goes on with what it has learned (the body is the same and only the world changed). */
    const begin = (carry = false) => {
        id += 1;
        [generation, runs, waiting, shown, furthest, ended] = [0, 0, undefined, false, 0, 0];
        carry &&= how === "practice";
        if (!carry) learned = [];
        const { seed, difficulty, amounts } = engineRecipe(recipe);
        const brainSeed = (Math.random() * 2 ** 32) >>> 0;
        if (engine) {
            engine.create(recipe.legs, seed, difficulty, ...amounts, POPULATION, BRAIN.hidden, BRAIN.layers, BRAIN.memory, SECONDS, brainSeed);
            [ground, blocks, hazards, reached] = [[], [], [], 0];
            extend(20);
            angles = list(engine, engine.ray_angles());
            [camera.x, camera.y, last, holding, keyHand] = [0, 0.5, undefined, 0, undefined];
        }
        made = { kind: "begin", setup: id, legs: recipe.legs, seed, difficulty, amounts, brainSeed };
        stopped = "";
        if (how === "practice") {
            practice = carry ? { ...practice, reached: 0, here: -1 } : { seconds: 0, steps: 0, reached: 0, here: -1, speed: 0, waited: [0, 0], hard: 0 };
            policy = undefined;
            engine?.policy_off();
            // carrying on, the policy on show goes straight on in the new world
            if (carry && onShow) {
                policy = onShow;
                takePolicy();
            }
            const setup = id;
            // the learner kept for this body, if there is one; workers start once it is read
            void forgetting.then(() => keeping<Kept>((kept) => kept.get(keptKey(recipe)))).then((kept) => {
                if (setup !== id) return;
                if (kept && !carry) [practice.seconds, practice.steps] = [kept.seconds, kept.steps];
                tellKept?.(!!kept);
                tellKept = undefined;
                tell(practiceOrder(0, kept, carry));
                helpers.forEach((helper, k) => helper.postMessage(practiceOrder(k + 1)));
                tell({ kind: paused ? "pause" : "resume" });
            });
        } else {
            tell(made);
            for (const helper of helpers) helper.postMessage(made);
            tell({ kind: paused ? "pause" : "resume" });
        }
        changed();
        m.wake();
    };

    /** What a practice worker is told to begin with: which of the workers it is, and for the first, the learner kept. */
    const practiceOrder = (index: number, kept?: Kept, carry = false): PracticeOrder => {
        const { seed, difficulty, amounts } = engineRecipe(recipe);
        return { kind: "begin", setup: id, legs: recipe.legs, seed, difficulty, amounts, workers: helpers.length + 1, index, learnerSeed: 1, kept, carry };
    };

    /** Puts the newest policy from practice on show, from the start. */
    const takePolicy = () => {
        if (!engine || !policy) return;
        const [stateRoom, runningRoom] = [engine.state_room(1), engine.running_room()];
        if (engine.length() === policy.running.length) {
            write(engine, stateRoom, policy.weights);
            write64(engine, runningRoom, policy.running);
            if (engine.policy_load() === 1) {
                shown = true;
                onShow = policy;
            }
        }
        policy = undefined;
        last = undefined;
    };

    const hearPractice = (report: PracticeReport) => {
        if (report.kind === "failed" || report.setup !== id) return;
        [practice.seconds, practice.steps, practice.reached, practice.speed, practice.waited, practice.hard] = [report.seconds, report.steps, report.reached, report.speed, report.waited, report.hard];
        if (report.policy) policy = report.policy;
        if (m.debug) Object.assign(globalThis, { generalistPractice: practice });
        if (policy && !shown) takePolicy();
        if (report.kept) void keeping((kept) => kept.put(report.kept, keptKey(recipe)));
        note(practice.steps, practice.reached);
        changed();
    };

    /** Puts a brain on show, from the start. */
    const take = (brain: Float32Array) => {
        if (!engine || brain.length !== engine.weights_length()) return;
        write(engine, engine.weights_room(), brain);
        engine.weights_load();
        [shown, furthest] = [true, Math.max(furthest, engine.best_distance())];
        last = undefined;
    };

    const hear = (report: Report | PracticeReport) => {
        if (report.kind === "practised") return hearPractice(report);
        if (report.kind === "failed") return how === "practice" ? practiceStopped() : learnHere();
        if (report.setup !== id) return;
        [generation, runs] = [report.generation, report.runs];
        if (report.brain) waiting = report.brain;
        if (waiting && !shown) {
            take(waiting);
            waiting = undefined;
        }
        if (shown) note(generation, furthest);
        changed();
    };

    /** Practice has no way to learn on the page itself, so when its worker fails the visitor is told. */
    const practiceStopped = () => {
        stopped = "Practice has stopped: something went wrong in it. Changing the world or starting over tries again";
        changed();
    };

    const hire = () => (how === "practice" ? new Worker(new URL("../scripts/generalist-practice.ts", import.meta.url), { type: "module" }) : new Worker(new URL("../scripts/generalist-worker.ts", import.meta.url), { type: "module" }));

    /** Gives the first worker helpers, each joined to it by a channel of its own. The effort changes only how fast learning goes, never what is learned. */
    const staff = (count: number) => {
        for (const helper of helpers) helper.terminate();
        helpers = [];
        if (!worker) return;
        const ports: MessagePort[] = [];
        for (let i = 0; i < count; i++) {
            const helper = hire();
            const fail = () => staff(0);
            helper.onmessage = (event: MessageEvent<Report>) => event.data.kind === "failed" && fail();
            helper.onerror = fail;
            const channel = new MessageChannel();
            helper.postMessage({ kind: "lead", port: channel.port2 } satisfies Order, [channel.port2]);
            if (how === "evolution" && made) helper.postMessage(made);
            ports.push(channel.port1);
            helpers.push(helper);
        }
        // practice workers are told how many they are, so each knows its share of the creatures
        if (how === "practice" && made) helpers.forEach((helper, k) => helper.postMessage(practiceOrder(k + 1)));
        worker.postMessage({ kind: "helpers", ports, gentle: effort === "gentle" } satisfies Order, ports);
    };

    /** No worker: learning goes on here, a run at a time between steps. */
    const learnHere = () => {
        staff(0);
        worker?.terminate();
        worker = undefined;
        if (here) return;
        here = true;
        begin();
    };

    /**
     * How many workers learn at the chosen effort. Practice uses at most four: each update is shared by
     * averaging every worker's weights, and with more workers each has too few creatures; eight
     * workers of four creatures learned no faster than one of thirty-two, four of eight 2.3 times as
     * fast (walker/README.md, "In the browser").
     */
    const workersNow = () => Math.min(how === "practice" ? 4 : 16, workersFor(effort, machine()));

    /** Hires the workers for how it learns now, letting any others go. */
    const crew = () => {
        staff(0);
        worker?.terminate();
        worker = undefined;
        if (m.preview) return;
        try {
            worker = hire();
            worker.onmessage = (event: MessageEvent<Report | PracticeReport>) => hear(event.data);
            worker.onerror = () => (how === "practice" ? practiceStopped() : learnHere());
            staff(workersNow() - 1);
        } catch {
            here = how === "evolution";
        }
    };
    if (!m.preview) crew();
    else here = true;

    void fetch(engineAddress())
        .then((answer) => {
            if (!answer.ok) throw new Error(`the engine answered ${answer.status}`);
            return answer.arrayBuffer();
        })
        .then(startEngine)
        .then((started) => {
            engine = started;
            if (m.debug) Object.assign(globalThis, { generalistEngine: started });
            begin();
        })
        .catch(() => {
            // offline, blocked or missing: said, rather than "Loading." for ever
            stopped = "The creature could not be loaded. Reloading the page may help";
            changed();
        });

    // ---- the controls: a strip under the world, and a column beside it ----
    let changed = () => {};
    let drawBrain = () => {};
    let drawChart = () => {};
    /** The tick the brain was last drawn at; none yet. */
    let brainAt = -1;
    if (!m.preview) {
        const host = m.canvas.parentElement!;
        const side = m.panel();
        side.classList.add("walker-side");
        // the world's own controls, and the body's, in a strip under the picture, as the Walker's ground has
        const strip = el("div", { class: "mote-panel walker-ground generalist-world" });
        host.insertBefore(strip, side);
        const status = el("p", { class: "walker-status" });
        status.setAttribute("aria-hidden", "true");
        const said = el("p", { class: "walker-said unseen" });
        said.setAttribute("aria-live", "polite");
        host.insertBefore(status, strip);
        side.append(said);

        const row = (words: string, ...controls: (Node | string)[]) => [el("span", { class: "walker-label", textContent: words }), el("div", { class: "walker-controls" }, ...controls)];
        const group = (words: string) => el("h3", { class: "walker-group", textContent: words });
        const choices = <T extends string | number>(name: string, words: string, options: { value: T; text: string }[], chosen: () => T, pick: (value: T) => void) => {
            const set = el("div", { class: "walker-choices" });
            set.setAttribute("role", "radiogroup");
            set.setAttribute("aria-label", words);
            for (const option of options) {
                const input = el("input", { type: "radio", name: `generalist-${name}`, value: String(option.value), checked: option.value === chosen(), onchange: () => input.checked && pick(option.value) });
                set.append(el("label", {}, input, option.text));
            }
            return set;
        };
        /** A range from 0 to 100 with what it is set to beside it, that changes the world when let go. */
        const amount = (words: string, value: () => number, set: (value: number) => void) => {
            const range = el("input", { type: "range", min: "0", max: "100", step: "5", value: String(value()) });
            range.setAttribute("aria-label", words);
            const shownValue = el("output", { class: "walker-far", textContent: `${value()}` });
            range.addEventListener("input", () => (shownValue.textContent = range.value));
            range.addEventListener("change", () => set(Number(range.value)));
            return { range, shownValue, holder: el("span", { class: "walker-range" }, range, shownValue) };
        };

        const describe = () => `${recipe.legs} legs, in the world "${recipe.seed}", ${recipe.hard} of 100 hard`;
        const say = (text: string) => {
            notice = { text, until: m.time + 5 };
            said.textContent = text;
        };
        speak = (words: string) => (said.textContent = words);
        // a finger that has taken hold of something drags it, and the page does not scroll under it; one that
        // has not scrolls the page as usual (a touch's pointerdown comes before its touchstart and touchmove)
        const still = (event: TouchEvent) => holding && event.cancelable && event.preventDefault();
        m.canvas.addEventListener("touchstart", still, { passive: false });
        m.canvas.addEventListener("touchmove", still, { passive: false });
        /**
         * Learning after a change, said plainly. By practice, a new world goes on with what was learned; a new body
         * takes up what was learned with that body before, or starts from nothing; "start over" forgets. By
         * evolution, every change starts again, since its brains learn the one world they are bred in.
         */
        const restart = (forget = false, newBody = false) => {
            if (forget && how === "practice") forgetting = keeping((kept) => kept.delete(keptKey(recipe)));
            m.keep("generalist", recipe, 1);
            for (const [name, value] of linkParts(recipe)) m.link.set(name, value);
            const carry = how === "practice" && !forget && !newBody;
            if (how !== "practice" || forget) say(`Learning again from the start: ${describe()}.`);
            else if (carry) say(`A new world. It goes on with what it has learned: ${describe()}.`);
            else {
                say(`A new body: ${describe()}.`);
                tellKept = (found) => say(found ? `A new body. It takes up what it learned with ${recipe.legs} legs before.` : `A new body. With ${recipe.legs} legs it learns from the start.`);
            }
            begin(carry);
        };
        const set = (change: Partial<Recipe>) => {
            const newBody = change.legs !== undefined && change.legs !== recipe.legs;
            recipe = { ...recipe, ...change };
            restart(false, newBody);
        };

        // the world: its seed, how hard, and what is in it
        const seed = el("input", { type: "text", value: recipe.seed, maxLength: 40, spellcheck: false });
        seed.setAttribute("aria-label", "seed, a word or a number");
        seed.addEventListener("change", () => {
            const typed = seed.value.trim();
            if (typed && typed !== recipe.seed) set({ seed: typed });
            else seed.value = recipe.seed;
        });
        const another = el("button", { type: "button", textContent: "another", onclick: () => {
            const next = anotherSeed(recipe.seed, Math.random());
            seed.value = next;
            set({ seed: next });
        } });
        const hard = amount("how hard", () => recipe.hard, (value) => set({ hard: value }));
        const kinds = KINDS.map(({ kind, name, says }) => {
            const box = el("input", { type: "checkbox", checked: recipe.on[kind], onchange: () => {
                level.range.disabled = !box.checked;
                set({ on: { ...recipe.on, [kind]: box.checked } as Record<Kind, boolean> });
            } });
            box.setAttribute("aria-label", `${name}: ${says}`);
            const level = amount(`how much ${name}`, () => recipe.amounts[kind], (value) => set({ amounts: { ...recipe.amounts, [kind]: value } as Record<Kind, number> }));
            level.range.disabled = !recipe.on[kind];
            return row(name, box, level.holder);
        });

        // the body and the eyes
        const legs = choices("legs", "legs", LEGS.map((count) => ({ value: count, text: String(count) })), () => recipe.legs, (count) => set({ legs: count }));
        const rays = el("input", { type: "checkbox", checked: showRays, onchange: () => {
            showRays = rays.checked;
            m.keep("generalist-rays", showRays);
            m.wake();
        } });

        // learning
        const pause = el("button", { type: "button", textContent: "pause", onclick: () => {
            paused = !paused;
            tell({ kind: paused ? "pause" : "resume" });
            said.textContent = paused ? "Learning is paused." : "Learning goes on.";
            changed();
            m.wake();
        } });
        const explain = el("p", { class: "walker-explain" });
        const explained = () => {
            explain.textContent = how === "practice" ? "By practice, one creature tries again and again in a new world each time, and each try nudges every movement toward what turned out better than it expected." : "By evolution, many creatures try the same world, and the best are kept and varied.";
        };
        explained();
        const hows = choices<How>("how", "how it learns", [{ value: "evolution", text: "evolution" }, { value: "practice", text: "by practice" }], () => how, (chosen) => {
            how = chosen;
            m.keep("generalist-how", how);
            explained();
            here = false;
            made = undefined;
            crew();
            begin();
        });
        const efforts = choices<Effort>("effort", "how hard learning works the computer", EFFORTS.map((each) => ({ value: each.effort, text: each.text })), () => effort, (chosen) => {
            effort = chosen;
            m.keep("walker-effort", effort);
            staff(workersNow() - 1);
        });

        // the brain, drawn live from the first second, so a visitor watches it grow as it learns
        const brainPicture = el("canvas", { class: "walker-brain-picture generalist-brain" });
        brainPicture.setAttribute("role", "img");
        brainPicture.setAttribute("aria-label", "The creature's brain as it thinks: what it senses on the left (a dot for each ray of its eye, then its body), its neurons in the middle, and what it does on the right, lit by what passes through them.");
        drawBrain = () => {
            if (!engine) return;
            const picture = brainColumns(list(engine, engine.brain_picture()));
            const ctx = brainPicture.getContext("2d");
            if (!picture || !ctx) return;
            const ratio = window.devicePixelRatio || 1;
            const [wide, high] = [brainPicture.clientWidth, brainPicture.clientHeight];
            if (wide === 0) return;
            if (brainPicture.width !== Math.round(wide * ratio) || brainPicture.height !== Math.round(high * ratio)) [brainPicture.width, brainPicture.height] = [Math.round(wide * ratio), Math.round(high * ratio)];
            ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
            ctx.clearRect(0, 0, wide, high);
            const { lit, flows } = picture;
            const [left, right, top, bottom] = [10, wide - 10, 10, high - 22];
            const gaps = lit.map((column) => Math.min((bottom - top) / Math.max(1, column.length - 1), 10));
            const place = (column: number, row: number): [number, number] => [left + ((right - left) * column) / (lit.length - 1), (top + bottom) / 2 + (row - (lit[column]!.length - 1) / 2) * gaps[column]!];
            const [accent, muted] = [m.color("--accent"), m.color("--muted")];
            // into each neuron, the few connections passing the most to it now, each as bright as it is
            // beside the strongest in its layer; drawn as a few paths, one for each brightness and sign
            const LEVELS = 4;
            const FEW = 3;
            ctx.lineWidth = 1;
            const best = new Int32Array(FEW);
            flows.forEach((flow, k) => {
                const [from, to] = [lit[k]!.length, lit[k + 1]!.length];
                let strongest = 1e-6;
                for (const amount of flow) strongest = Math.max(strongest, Math.abs(amount));
                const paths = Array.from({ length: 2 * LEVELS }, () => new Path2D());
                for (let j = 0; j < to; j++) {
                    const row = j * from;
                    best.fill(-1);
                    for (let i = 0; i < from; i++) {
                        const size = Math.abs(flow[row + i]!);
                        for (let b = 0; b < FEW; b++) {
                            if (best[b]! < 0 || size > Math.abs(flow[row + best[b]!]!)) {
                                best.copyWithin(b + 1, b, FEW - 1);
                                best[b] = i;
                                break;
                            }
                        }
                    }
                    for (const i of best) {
                        if (i < 0) continue;
                        const amount = flow[row + i]!;
                        const level = Math.min(LEVELS - 1, Math.floor((Math.abs(amount) / strongest) * LEVELS));
                        const path = paths[level + (amount > 0 ? 0 : LEVELS)]!;
                        path.moveTo(...place(k, i));
                        path.lineTo(...place(k + 1, j));
                    }
                }
                paths.forEach((path, p) => {
                    ctx.globalAlpha = 0.12 + 0.55 * (((p % LEVELS) + 1) / LEVELS);
                    ctx.strokeStyle = p < LEVELS ? accent : muted;
                    ctx.stroke(path);
                });
            });
            ctx.globalAlpha = 1;
            // each neuron lit by what it gave
            lit.forEach((values, column) => {
                const size = Math.max(1.2, Math.min(3, gaps[column]! * 0.42));
                values.forEach((value, row) => {
                    const [x, y] = place(column, row);
                    ctx.beginPath();
                    ctx.arc(x, y, size, 0, Math.PI * 2);
                    ctx.fillStyle = m.color("--ground");
                    ctx.fill();
                    ctx.globalAlpha = 0.25 + 0.75 * Math.min(1, Math.abs(value));
                    ctx.fillStyle = value >= 0 ? accent : muted;
                    ctx.fill();
                    ctx.globalAlpha = 1;
                });
            });
            ctx.fillStyle = muted;
            ctx.font = `11px ${code}`;
            ctx.textBaseline = "bottom";
            ctx.textAlign = "left";
            ctx.fillText("senses", 2, high - 3);
            ctx.textAlign = "center";
            ctx.fillText("neurons", wide / 2, high - 3);
            ctx.textAlign = "right";
            ctx.fillText("moves", wide - 2, high - 3);
        };

        // how far it gets, against how long it has practised (or, by evolution, the generations), drawn as it learns
        const chart = el("canvas", { class: "walker-brain-picture generalist-chart" });
        chart.setAttribute("role", "img");
        chart.setAttribute("aria-label", "A line of how far the creature gets, rising as it learns.");
        drawChart = () => {
            const ctx = chart.getContext("2d");
            const [wide, high] = [chart.clientWidth, chart.clientHeight];
            if (!ctx || wide === 0) return;
            const ratio = window.devicePixelRatio || 1;
            if (chart.width !== Math.round(wide * ratio) || chart.height !== Math.round(high * ratio)) [chart.width, chart.height] = [Math.round(wide * ratio), Math.round(high * ratio)];
            ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
            ctx.clearRect(0, 0, wide, high);
            const [accent, muted] = [m.color("--accent"), m.color("--muted")];
            const evolving = how === "evolution";
            // from where this visit's learning began, which for a learner kept from before is not the start
            const [firstX, lastX] = [learned[0]?.x ?? 0, learned.at(-1)?.x ?? 0];
            const most = Math.max(5, Math.ceil(Math.max(...learned.map((point) => point.y), 0) / 5) * 5);
            const [left, right, top, bottom] = [8, wide - 8, 22, high - 20];
            const at = (x: number, y: number): [number, number] => [left + ((right - left) * (x - firstX)) / Math.max(lastX - firstX, 1), bottom - ((bottom - top) * Math.max(0, y)) / most];
            // the two axes, faint
            ctx.strokeStyle = muted;
            ctx.globalAlpha = 0.35;
            ctx.lineWidth = 1;
            ctx.beginPath();
            ctx.moveTo(left, top);
            ctx.lineTo(left, bottom);
            ctx.lineTo(right, bottom);
            ctx.stroke();
            ctx.globalAlpha = 1;
            // how far it gets, as one line, and a dot at where it is now
            if (learned.length > 0) {
                ctx.strokeStyle = accent;
                ctx.lineWidth = 1.5;
                ctx.lineJoin = "round";
                ctx.beginPath();
                learned.forEach((point, k) => (k === 0 ? ctx.moveTo(...at(point.x, point.y)) : ctx.lineTo(...at(point.x, point.y))));
                ctx.stroke();
                const [nx, ny] = at(lastX, learned.at(-1)!.y);
                ctx.fillStyle = accent;
                ctx.beginPath();
                ctx.arc(nx, ny, 2.5, 0, Math.PI * 2);
                ctx.fill();
            }
            ctx.fillStyle = muted;
            ctx.font = `11px ${code}`;
            ctx.textBaseline = "top";
            ctx.textAlign = "left";
            ctx.fillText(evolving ? "furthest, by generation" : "how far it gets, on average", left, 3);
            ctx.textAlign = "right";
            ctx.fillText(`${most} m`, right, 3);
            ctx.textBaseline = "bottom";
            ctx.textAlign = "left";
            ctx.fillText(firstX === 0 ? "0" : evolving ? `generation ${firstX}` : `${counted(firstX)} steps`, left, high - 3);
            ctx.textAlign = "right";
            ctx.fillText(learned.length === 0 ? (evolving ? "generations" : "steps practised") : evolving ? `generation ${lastX}` : `${counted(lastX)} steps`, right, high - 3);
        };

        strip.append(...row("seed", seed, another), ...row("how hard", hard.holder), ...kinds.flat(), ...row("legs", legs), ...row("eyes", el("label", {}, rays, "show what it sees")));
        side.append(
            group("brain"),
            brainPicture,
            chart,
            group("learning"),
            ...row("how it learns", hows),
            explain,
            ...row("learning", pause, el("button", { type: "button", textContent: "start over", onclick: () => restart(true) })),
            ...row("effort", efforts),
        );
        // the world is a link from the first, so the address always says which world this is
        for (const [name, value] of linkParts(recipe)) m.link.set(name, value);

        changed = () => {
            pause.textContent = paused ? "resume" : "pause";
            const practised = practice.seconds > 0 ? `Practised ${lasted(practice.seconds)}, ${counted(practice.steps)} steps` : "Starting to practise";
            const gets = practice.here >= 0 ? `. It gets ${tenths(practice.here)} m in this world now, ${tenths(practice.reached)} m on average in practice` : shown ? ". Watching its try in this world" : "";
            const now = stopped ? stopped : !engine ? "Loading." : how === "practice" ? `${practised}${gets}` : !shown ? `Generation 0, ${runs} of ${POPULATION} tried` : `Generation ${generation}, furthest ${tenths(furthest)} m`;
            const text = m.time < notice.until && notice.text ? notice.text : `${now}${paused ? ", paused" : ""}`;
            if (status.textContent !== text) status.textContent = text;
            drawChart();
        };
    }

    // ---- drawing ----
    const code = getComputedStyle(m.canvas).getPropertyValue("--font-code").trim() || "monospace";
    let scale = 100;
    const horizon = () => m.height * 0.68;
    /** The creature is kept this far across the picture, so most of it is what is coming. */
    const KEPT_AT = 0.28;
    const toScreen = (x: number, y: number): [number, number] => [(x - camera.x) * scale + m.width * KEPT_AT, horizon() - (y - camera.y) * scale];
    const toWorld = (sx: number, sy: number): [number, number] => [(sx - m.width * KEPT_AT) / scale + camera.x, (horizon() - sy) / scale + camera.y];
    const seen = (left: number, right: number, a: number, b: number) => Math.max(a, b) >= left - 1 && Math.min(a, b) <= right + 1;
    // with ?debug, where a point of the world is on the canvas and back, for a test to find the creature by
    if (m.debug) Object.assign(globalThis, { generalistView: { toScreen, toWorld, holding: () => holding } });

    /** The height of the ground's surface at x, the highest piece over it, or none over a gap. */
    const heightAt = (x: number): number | undefined => {
        let found: number | undefined;
        for (let i = 0; i < ground.length; i += 4) {
            const [x1, y1, x2, y2] = [ground[i]!, ground[i + 1]!, ground[i + 2]!, ground[i + 3]!];
            if (x < Math.min(x1, x2) || x > Math.max(x1, x2) || x1 === x2) continue;
            const y = y1 + ((y2 - y1) * (x - x1)) / (x2 - x1);
            found = found === undefined ? y : Math.max(found, y);
        }
        return found;
    };

    const drawWorld = () => {
        const { ctx } = m;
        const [left] = toWorld(0, 0);
        const [right] = toWorld(m.width, 0);
        // the ground filled down from each piece that is not a riser, and edged, each as one path
        const fill = new Path2D();
        const edge = new Path2D();
        for (let i = 0; i < ground.length; i += 4) {
            const [x1, y1, x2, y2] = [ground[i]!, ground[i + 1]!, ground[i + 2]!, ground[i + 3]!];
            if (!seen(left, right, x1, x2)) continue;
            const [ax, ay] = toScreen(x1, y1);
            const [bx, by] = toScreen(x2, y2);
            if (x1 !== x2) {
                fill.moveTo(ax, ay);
                fill.lineTo(bx, by);
                fill.lineTo(bx, m.height + 1);
                fill.lineTo(ax, m.height + 1);
                fill.closePath();
            }
            edge.moveTo(ax, ay);
            edge.lineTo(bx, by);
        }
        ctx.fillStyle = m.color("--surface");
        ctx.fill(fill);
        ctx.strokeStyle = m.color("--muted");
        ctx.lineWidth = 2;
        ctx.lineCap = "round";
        ctx.stroke(edge);
        // the floating platforms
        for (let i = 0; i < blocks.length; i += 4) {
            const [x1, y1, x2, y2] = [blocks[i]!, blocks[i + 1]!, blocks[i + 2]!, blocks[i + 3]!];
            if (!seen(left, right, x1, x2)) continue;
            const [sx, sy] = toScreen(x1, y2);
            ctx.beginPath();
            ctx.roundRect(sx, sy, (x2 - x1) * scale, (y2 - y1) * scale, 0.06 * scale);
            ctx.fillStyle = m.color("--surface");
            ctx.fill();
            ctx.stroke();
        }
        // water, with a slow swell on it, and spikes
        for (let i = 0; i < hazards.length; i += 5) {
            const [x1, y1, x2, y2, kind] = [hazards[i]!, hazards[i + 1]!, hazards[i + 2]!, hazards[i + 3]!, hazards[i + 4]!];
            if (!seen(left, right, x1, x2)) continue;
            const [ax, ay] = toScreen(x1, y2);
            const [bx, by] = toScreen(x2, y1);
            if (kind === 0) {
                ctx.beginPath();
                ctx.moveTo(ax, by);
                for (let sx = ax; sx <= bx; sx += 4) ctx.lineTo(sx, ay + Math.sin(sx * 0.08 + m.time * 2) * 0.012 * scale);
                ctx.lineTo(bx, by);
                ctx.closePath();
                ctx.globalAlpha = 0.45;
                ctx.fillStyle = m.color("--accent");
                ctx.fill();
                ctx.globalAlpha = 1;
            } else {
                const count = Math.max(2, Math.round(((x2 - x1) * scale) / (0.09 * scale)));
                const wide = (bx - ax) / count;
                ctx.beginPath();
                for (let k = 0; k < count; k++) {
                    ctx.moveTo(ax + k * wide, by);
                    ctx.lineTo(ax + (k + 0.5) * wide, ay);
                    ctx.lineTo(ax + (k + 1) * wide, by);
                }
                ctx.fillStyle = m.color("--ink");
                ctx.fill();
            }
        }
        // a mark every metre and a number every five, as the Walker's ground has
        ctx.fillStyle = m.color("--muted");
        ctx.font = `11px ${code}`;
        ctx.textAlign = "center";
        ctx.textBaseline = "top";
        for (let x = Math.ceil(left); x <= right; x++) {
            const y = heightAt(x);
            if (y === undefined) continue;
            const [sx, sy] = toScreen(x, y);
            ctx.globalAlpha = 0.6;
            ctx.fillRect(sx - 0.5, sy + 4, 1, x % 5 === 0 ? 7 : 4);
            ctx.globalAlpha = 1;
            if (x % 5 === 0 && sy + 14 < m.height - 12 && sx > 16 && sx < m.width - 16) ctx.fillText(x === 0 ? "start" : `${x} m`, sx, sy + 14);
        }
    };

    /** The boxes, moving platforms and see-saws made near the creature. */
    const drawThings = (engine: Engine) => {
        const { ctx } = m;
        const things = list(engine, engine.show_things());
        for (let i = 0; i < things.length; i += 6) {
            const [kind, x, y, angle, hw, hh] = [things[i]!, things[i + 1]!, things[i + 2]!, things[i + 3]!, things[i + 4]!, things[i + 5]!];
            const [sx, sy] = toScreen(x, y);
            ctx.save();
            ctx.translate(sx, sy);
            ctx.rotate(-angle);
            ctx.beginPath();
            ctx.roundRect(-hw * scale, -hh * scale, 2 * hw * scale, 2 * hh * scale, Math.min(hw, hh) * scale * (kind === 0 ? 0.3 : 0.6));
            if (kind === 0) {
                ctx.fillStyle = m.color("--ink");
                ctx.fill();
                ctx.fillStyle = m.color("--accent");
                ctx.fillRect(-hw * scale * 0.12, -hh * scale, hw * scale * 0.24, 2 * hh * scale);
            } else {
                ctx.fillStyle = m.color(kind === 1 ? "--surface" : "--ink");
                ctx.fill();
                ctx.strokeStyle = m.color("--accent");
                ctx.lineWidth = 2;
                ctx.stroke();
            }
            ctx.restore();
            if (kind === 2) {
                // the pivot the plank turns on
                const [px, py] = toScreen(x, y);
                const [, gy] = toScreen(x, heightAt(x) ?? y - 0.3);
                ctx.beginPath();
                ctx.moveTo(px, py + 0.05 * scale);
                ctx.lineTo(px - 0.12 * scale, gy);
                ctx.lineTo(px + 0.12 * scale, gy);
                ctx.closePath();
                ctx.fillStyle = m.color("--muted");
                ctx.fill();
            }
        }
    };

    /** What it sees: a faint line from its eye to where each ray stopped, and a mark there by what it met. */
    const drawRays = (engine: Engine) => {
        const { ctx } = m;
        const rays = list(engine, engine.show_rays());
        const [ex, ey] = toScreen(rays[0]!, rays[1]!);
        for (let k = 0; k < angles.length; k++) {
            const [distance, what] = [rays[2 + 2 * k]!, rays[3 + 2 * k]!];
            const angle = angles[k]!;
            const [hx, hy] = [ex + Math.cos(angle) * distance * scale, ey - Math.sin(angle) * distance * scale];
            const kind = SEEN[what] ?? "nothing";
            const strong = kind === "hazard" || kind === "edge" || kind === "box" || kind === "moving";
            ctx.strokeStyle = m.color(strong ? "--accent" : "--muted");
            ctx.globalAlpha = kind === "nothing" ? 0.12 : strong ? 0.45 : 0.25;
            ctx.lineWidth = 1;
            ctx.beginPath();
            ctx.moveTo(ex, ey);
            ctx.lineTo(hx, hy);
            ctx.stroke();
            if (kind !== "nothing") {
                ctx.globalAlpha = strong ? 0.9 : 0.5;
                ctx.fillStyle = ctx.strokeStyle;
                ctx.shadowColor = ctx.strokeStyle;
                ctx.shadowBlur = strong ? 8 : 0;
                ctx.beginPath();
                ctx.arc(hx, hy, strong ? 3 : 2, 0, Math.PI * 2);
                ctx.fill();
                ctx.shadowBlur = 0;
            }
        }
        ctx.globalAlpha = 1;
    };

    /** A limb from a to b, round at both ends and thicker at a. */
    const limb = (ax: number, ay: number, bx: number, by: number, wa: number, wb: number) => {
        const { ctx } = m;
        const length = Math.hypot(bx - ax, by - ay) || 1;
        const [nx, ny] = [-(by - ay) / length, (bx - ax) / length];
        ctx.beginPath();
        ctx.moveTo(ax + nx * wa, ay + ny * wa);
        ctx.lineTo(bx + nx * wb, by + ny * wb);
        ctx.lineTo(bx - nx * wb, by - ny * wb);
        ctx.lineTo(ax - nx * wa, ay - ny * wa);
        ctx.fill();
        ctx.beginPath();
        ctx.arc(ax, ay, wa, 0, Math.PI * 2);
        ctx.fill();
        ctx.beginPath();
        ctx.arc(bx, by, wb, 0, Math.PI * 2);
        ctx.fill();
    };

    /** The creature as the Walker's is drawn: far legs behind and darker, the body with its eyes, near legs in front; and the biped's arms, held out for balance. */
    const drawCreature = (engine: Engine) => {
        const { ctx } = m;
        const legs = engine.legs_length();
        const bodies = list(engine, engine.show_bodies());
        const [tx, ty, angle, , hw, hh] = [bodies[0]!, bodies[1]!, bodies[2]!, bodies[3]!, bodies[4]!, bodies[5]!];
        const facing = Math.cos(angle) >= 0 ? 1 : -1;
        const [c, s] = [Math.cos(angle), Math.sin(angle)];
        const leg = (index: number, color: string) => {
            const ends = (body: number): [number, number, number, number] => {
                const [x, y, turn, half] = [bodies[body * 6]!, bodies[body * 6 + 1]!, bodies[body * 6 + 2]!, bodies[body * 6 + 4]!];
                return [x - Math.cos(turn) * half, y - Math.sin(turn) * half, x + Math.cos(turn) * half, y + Math.sin(turn) * half];
            };
            const [upper, lower] = [1 + 2 * index, 2 + 2 * index];
            const [hx, hy, kx, ky] = ends(upper);
            const [, , fx, fy] = ends(lower);
            const thick = bodies[upper * 6 + 5]!;
            const foot = bodies[lower * 6 + 5]!;
            const [shx, shy] = toScreen(hx, hy);
            const [skx, sky] = toScreen(kx, ky);
            const [sfx, sfy] = toScreen(fx, fy);
            ctx.fillStyle = color;
            limb(shx, shy, skx, sky, thick * 1.25 * scale, thick * 0.9 * scale);
            limb(skx, sky, sfx, sfy, thick * 0.85 * scale, foot * 0.75 * scale);
            const long = 1.7 * foot * scale;
            ctx.beginPath();
            ctx.ellipse(sfx + facing * long * 0.35, sfy, long, foot * scale, 0, 0, Math.PI * 2);
            ctx.fill();
        };
        /** An arm from the body's side, held out and a little down, in the body's frame. */
        const arm = (side: number, color: string) => {
            const at = (x: number, y: number) => toScreen(tx + c * x - s * y, ty + s * x + c * y);
            const [ax, ay] = at(side * hw * 0.8, hh * 0.05);
            const [bx, by] = at(side * (hw + 0.2), -hh * 0.35);
            ctx.fillStyle = color;
            limb(ax, ay, bx, by, 0.045 * scale, 0.04 * scale);
            ctx.beginPath();
            ctx.arc(bx, by, 0.055 * scale, 0, Math.PI * 2);
            ctx.fill();
        };
        const near = (index: number) => index % 2 === 0;
        if (legs === 2) arm(-1, m.color("--muted"));
        for (let i = 0; i < legs; i++) if (!near(i)) leg(i, m.color("--muted"));
        const [sx, sy] = toScreen(tx, ty);
        ctx.save();
        ctx.translate(sx, sy);
        ctx.rotate(-angle);
        ctx.fillStyle = m.color("--accent");
        ctx.beginPath();
        ctx.roundRect(-hw * scale, -hh * scale, 2 * hw * scale, 2 * hh * scale, Math.min(hw, hh) * scale * 0.95);
        ctx.fill();
        const eye = Math.min(hh * 0.3, 0.065) * scale;
        const front = legs === 4 ? 0.78 : 0.5;
        const [lx, ly] = [c * looking.x + s * looking.y, -s * looking.x + c * looking.y];
        for (const [ex, ey, size] of [[hw * front, hh * 0.28, 1], [hw * (front - 0.3), hh * 0.32, 0.9]] as const) {
            const [px, py] = [ex * scale, -ey * scale];
            ctx.fillStyle = m.color("--ink");
            ctx.beginPath();
            ctx.arc(px, py, eye * size, 0, Math.PI * 2);
            ctx.fill();
            ctx.fillStyle = m.color("--ground");
            ctx.beginPath();
            ctx.arc(px + lx * eye * 0.4, py - ly * eye * 0.4, eye * size * 0.55, 0, Math.PI * 2);
            ctx.fill();
        }
        ctx.restore();
        for (let i = 0; i < legs; i++) if (near(i)) leg(i, m.color("--ink"));
        if (legs === 2) arm(1, m.color("--ink"));
    };

    /** What it was just rewarded and charged for, in small words over it, so a visitor can see why it learns what it learns. */
    const drawRewarded = (engine: Engine) => {
        if (lately.length === 0) return;
        const { ctx } = m;
        const [x, y] = list(engine, engine.show_bodies());
        const [sx, sy] = toScreen(x!, y!);
        ctx.font = `11px ${code}`;
        ctx.textAlign = "center";
        ctx.textBaseline = "bottom";
        lately.forEach((each, k) => {
            // kept inside the picture, where the creature is near its edge on a narrow screen
            const half = ctx.measureText(each.words).width / 2 + 4;
            ctx.fillStyle = m.color(each.good ? "--accent" : "--muted");
            ctx.fillText(each.words, Math.min(m.width - half, Math.max(half, sx)), sy - 0.55 * scale - k * 14);
        });
    };

    /** The flag at the furthest the best run has gone. */
    const drawFlag = () => {
        if (!shown || furthest <= 0) return;
        const { ctx } = m;
        const [sx, sy] = toScreen(furthest, heightAt(furthest) ?? camera.y);
        if (sx < -20 || sx > m.width + 20) return;
        ctx.strokeStyle = m.color("--muted");
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(sx, sy);
        ctx.lineTo(sx, sy - 0.9 * scale);
        ctx.stroke();
        ctx.fillStyle = m.color("--accent");
        ctx.beginPath();
        ctx.moveTo(sx, sy - 0.9 * scale);
        ctx.lineTo(sx + 0.28 * scale, sy - 0.8 * scale);
        ctx.lineTo(sx, sy - 0.7 * scale);
        ctx.closePath();
        ctx.fill();
    };

    /** The hand: while it holds something, a thin line from where the hand is to where it holds, and a ring at the hand; the keyboard's hand as a ring, once it has been moved. */
    const drawHand = (engine: Engine) => {
        const { ctx } = m;
        const [kind, hx, hy, ax, ay] = list(engine, engine.show_held());
        ctx.strokeStyle = m.color("--accent");
        ctx.lineWidth = 2;
        if (kind) {
            const [sx, sy] = toScreen(hx!, hy!);
            const [tx, ty] = toScreen(ax!, ay!);
            ctx.globalAlpha = 0.6;
            ctx.lineWidth = 1.5;
            ctx.beginPath();
            ctx.moveTo(sx, sy);
            ctx.lineTo(tx, ty);
            ctx.stroke();
            ctx.globalAlpha = 1;
            ctx.lineWidth = 2;
            ctx.beginPath();
            ctx.arc(sx, sy, 6, 0, Math.PI * 2);
            ctx.stroke();
            ctx.fillStyle = m.color("--accent");
            ctx.beginPath();
            ctx.arc(tx, ty, 2.5, 0, Math.PI * 2);
            ctx.fill();
        } else if (keyHand) {
            const [sx, sy] = toScreen(keyHand.x, keyHand.y);
            ctx.globalAlpha = 0.8;
            ctx.beginPath();
            ctx.arc(sx, sy, 7, 0, Math.PI * 2);
            ctx.stroke();
            ctx.globalAlpha = 1;
        }
    };

    /** Takes hold of what is at a point in the world, and says so for a screen reader. */
    const grab = (x: number, y: number) => {
        if (!engine) return;
        holding = engine.show_grab(x, y);
        if (holding) {
            m.canvas.style.cursor = "grabbing";
            speak(holding === 1 ? "Holding the creature." : "Holding it.");
        }
    };

    const letGo = () => {
        if (!engine || !holding) return;
        engine.show_let_go();
        holding = 0;
        speak("Let go.");
    };

    const torso = (): [number, number] => {
        if (!engine) return [0, 0];
        const [x, y] = list(engine, engine.show_bodies());
        return [x!, y!];
    };

    return {
        step(dt) {
            ticks += 1;
            if (!engine) return;
            if (worker && m.time - beat > 1) {
                beat = m.time;
                tell({ kind: "beat" });
            }
            if (here && how === "evolution" && !m.preview && !paused && ticks % 2 === 0) {
                const before = engine.best_score();
                engine.train(1);
                [generation, runs] = [engine.generation(), engine.generation_runs()];
                if (engine.best_score() > before && !shown) {
                    engine.show_reset();
                    [shown, furthest] = [true, engine.best_distance()];
                }
            }
            if (shown || holding) engine.show_step(dt);
            // the keyboard's hand stays with what it holds
            if (holding && keyHand) {
                const [, hx, hy] = list(engine, engine.show_held());
                if (hx !== undefined && hy !== undefined) keyHand = { x: hx, y: hy };
            }
            // twice a second, what it was rewarded and charged for since the last time
            if (how === "practice" && m.time - heardRewards > 0.5) {
                heardRewards = m.time;
                const said = rewarded(list(engine, engine.show_rewards()));
                if (said.length > 0 || engine.show_over()) lately = said;
            }
            // at the end of its run the creature rests a moment, then starts again, with a better brain if there is one
            if (shown && engine.show_over() && !holding) {
                ended += dt;
                if (ended >= REST && !paused) {
                    ended = 0;
                    if (how === "practice") practice.here = engine.show_furthest();
                    if (how === "practice" && policy) takePolicy();
                    else if (how === "practice") engine.show_reset();
                    else if (waiting) take(waiting);
                    else engine.show_reset();
                    if (here) furthest = Math.max(furthest, engine.best_distance());
                    waiting = undefined;
                    last = undefined;
                }
            }
            const [x, y] = torso();
            extend(x + 10);
            camera.x += (x - camera.x) * Math.min(1, dt * 4);
            camera.y += ((heightAt(x) ?? y - 0.8) + 0.3 - camera.y) * Math.min(1, dt * 2);
            if (last) {
                const [vx, vy] = [x - last.x, y - last.y];
                const speed = Math.hypot(vx, vy);
                if (speed > 0.0005 && speed < 1) looking = { x: looking.x + (vx / speed - looking.x) * 0.1, y: looking.y + (vy / speed - looking.y) * 0.1 };
            }
            last = { x, y };
            if (ticks % 6 === 0) changed();
        },
        press(x, y) {
            if (!engine) return;
            keyHand = undefined;
            grab(...toWorld(x, y));
            m.wake();
        },
        move(x, y) {
            if (!engine) return;
            const [wx, wy] = toWorld(x, y);
            if (holding) {
                engine.show_hand(wx, wy);
                return;
            }
            // the pointer says what can be taken hold of: a hand over the creature and over things that move
            if (!m.pointer.down) {
                const cursor = engine.show_under(wx, wy) ? "grab" : "";
                if (m.canvas.style.cursor !== cursor) m.canvas.style.cursor = cursor;
            }
        },
        release(x, y) {
            letGo();
            if (engine) m.canvas.style.cursor = engine.show_under(...toWorld(x, y)) ? "grab" : "";
        },
        /** The keyboard's hand: it starts at the creature's body; the arrows move it, and what it holds; Space or Enter takes hold, and lets go. */
        keydown(name) {
            if (!engine) return;
            if (!keyHand) {
                const [x, y] = torso();
                keyHand = { x, y };
            }
            if (name === "action") {
                if (holding) letGo();
                else {
                    grab(keyHand.x, keyHand.y);
                    if (!holding) speak("Nothing there to take hold of. The arrows move the hand.");
                }
            } else {
                const [dx, dy] = { left: [-KEY_STEP, 0], right: [KEY_STEP, 0], up: [0, KEY_STEP], down: [0, -KEY_STEP] }[name];
                keyHand = { x: keyHand.x + dx!, y: keyHand.y + dy! };
                if (holding) engine.show_hand(keyHand.x, keyHand.y);
            }
            m.wake();
        },
        resting: () => !m.preview && paused && !!engine && engine.show_over() === 1,
        debug: () => [`${here ? "learning on the page" : `learning ${how === "practice" ? "by practice" : "by evolution"} in ${helpers.length + 1} workers, ${effort}`}, ${how === "practice" ? `${Math.round(practice.speed)} steps a second, an update ${practice.waited.map((ms) => ms.toFixed(0)).join(" ms working and ")} ms waiting` : `generation ${generation}`}, ${ground.length / 4} pieces of ground made to ${reached.toFixed(0)} m`],
        draw() {
            // eighteen metres across a wide picture, thirteen of them ahead of the creature, so what is
            // coming can be seen well before it gets there; never so small that the creature is lost
            scale = Math.max(38, Math.min(m.height / 4.5, m.width / 18));
            drawWorld();
            if (!engine) return;
            drawFlag();
            drawThings(engine);
            if (showRays && (shown || holding === 1)) drawRays(engine);
            drawCreature(engine);
            if (how === "practice") drawRewarded(engine);
            // the brain beside it, at half the frame rate, which is as often as a policy decides; and always the
            // first time, and when the creature is at rest, so its box is never left empty
            if (brainAt < 0 || ticks - brainAt >= 2 || ticks === brainAt) {
                brainAt = ticks;
                drawBrain();
            }
            drawHand(engine);
        },
    };
}
