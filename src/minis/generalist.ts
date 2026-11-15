// Generalist: a creature, seen from the side, that sees and learns its way through a world the visitor
// makes. A second mini on the Walker's engine (walker/README.md, "The generalist").
//
// The world is made from a recipe: a seed (a word or a number), how hard, and how much of each kind
// of thing, each with a switch. The recipe is kept in the address, so a world is a link. The creature
// learns by practice (src/scripts/generalist-practice.ts), or by evolution as the Walker does
// (src/scripts/generalist-worker.ts), in workers each with its own copy of the engine; this page runs
// one more copy that shows the newest policy, or the best brain so far, walking the world from the
// start, with its brain drawn beside it as it thinks. A practised creature wants things (stage 2 of
// docs/generalist-plan.md): it has energy, which its body glows with and a bar in the column shows, food
// to find, drawn as plain dots, and an eye it turns, drawn as a line from its eye to where it looks. Its
// rays can be drawn, faint, so a visitor sees what it sees. A press takes hold of it, by its body or a leg,
// or of a box, a moving platform or a see-saw, with the engine's hand (walker/src/generalist/touch.rs): a
// spring to the pointer with a cap on its force, so what is held hangs and swings and a heavy thing lags;
// the keyboard has the same hand. A tap on nothing drops a piece of food there, or a box.
//
// Its world changes while it lives (stage 4): the visitor sets the ground (firm, ice, sticky, bouncy, soft),
// gravity, a wind and the light, each resting where the world always was, and may let the world change by
// itself, which it never does unless switched on. Ice looks like ice, a wind shows as streaks, and at night
// the world is dark but for what the creature's own eye reaches. The brain's picture draws the plastic
// connections that have changed since the world last changed, and a small trace of its surprise.
//
// The world is on the left and a column on the right: the controls folded at its top, then the brain,
// what it senses and its energy, drawn live, then a chart of how far it gets, in the panel style the
// minis use. Nothing is narrated. What this and the worker share is in roaming.ts.

import { el, type Mote, type Scene } from "../mote/stage";
import type { Kept, Order as PracticeOrder, Report as PracticeReport } from "../scripts/generalist-practice";
import type { Order, Report } from "../scripts/generalist-worker";
import { BRAIN, DEFAULT_RECIPE, DEFAULT_SHAPE, GROUNDS, KINDS, LEGS, LIGHTS, POPULATION, REST_CONDITIONS, SECONDS, SEEN, SHAPE_CAPS, anotherSeed, brainColumns, brainKinds, counted, engineAddress, engineRecipe, fromLink, groundOf, lasted, lightOf, linkParts, list, neurons, practiceWorkers, senseLayout, start as startEngine, valid, validShape, worldNow, write, write64, type BrainKinds, type Conditions, type Engine, type Ground, type Kind, type Recipe, type Shape, type WorldNow } from "./roaming";
import { EFFORTS, machine, tenths, workersFor, type Effort } from "./walking";

export const label = "A little creature with legs, seen from the side, learning from nothing to find its way and its food in a world made from a seed. A line from its eye shows where it looks, and faint lines what it sees; its body glows with the energy it has. It and the boxes and platforms can be picked up and moved: with the pointer, or with Space to take hold and the arrows to move the hand. A tap on nothing drops food there, or a box. The ground, gravity, a wind and the light can be changed while it walks.";

/** How long the creature rests where its run ended before starting again, in seconds. */
const REST = 1;
/** The world is made this far ahead of what is drawn, in metres. */
const AHEAD = 40;
/** How far an arrow key moves the keyboard's hand, in metres. */
const KEY_STEP = 0.25;
/** A press that moves less than this, in pixels, and takes hold of nothing, is a tap: it drops food. */
const TAP = 6;
/** Below this energy its muscles weaken (walker/src/generalist/needs.rs, `TIRED`). */
const TIRED = 0.4;
/** How many frames of its surprise the brain's trace shows. */
const TRACED = 150;
/** The colors of a changed world, from the site's accents (src/data/theme.ts): ice, sticky ground, bouncy ground, soft ground. */
const ICE = "oklch(0.78 0.12 250)";
const STICKY = "oklch(0.55 0.11 80)";
const BOUNCY = "oklch(0.78 0.15 350)";
const SAND = "oklch(0.84 0.13 80)";

/** How the creature learns: by evolution, the best of many tries kept and varied, or by practice (PPO, in walker/src/generalist/ppo.rs). */
type How = "evolution" | "practice";

/** What practice has learned is kept in the browser between visits, one learner for each body: a new world carries on with what was learned. */
const KEEPING = "generalist-practice";
const keptKey = (recipe: Recipe) => String(recipe.legs);

/**
 * The store's version. At 2 two legs began to practise for a pace, without sensing a rhythm (walker/README.md,
 * "How two legs came to walk"), and opening the store at 2 forgot two-legged learners kept before. At 3 the
 * creatures began to feel touch, so every learner kept before has too few senses to be taken up: opening the
 * store at 3 forgets them all, and learners are kept by body alone from then on, not by kind of world. At 4
 * they began to want things (walker/README.md, "It wants things"): their energy, having eaten and where their
 * eye looks are senses, and where to look an action, so again every learner kept before is the wrong shape and
 * opening the store at 4 forgets them all. At 5 the brain has a pool of neurons beside its plain ones
 * (walker/README.md, "The brain that was discussed") and a learner is kept with its form; a learner kept at 4
 * senses the same and has no form, so it is taken up as the plain network it is and grown into the brain
 * asked for, keeping what it learned: opening the store at 5 forgets only what is older than 4.
 */
const KEEPING_VERSION = 5;

/** Opens the browser's store for kept learners. */
function store(): Promise<IDBDatabase> {
    return new Promise((opened, failed) => {
        const asked = indexedDB.open(KEEPING, KEEPING_VERSION);
        asked.onupgradeneeded = (event) => {
            if (event.oldVersion < 1) {
                asked.result.createObjectStore("kept");
                return;
            }
            // every learner kept before version 4 senses too little to be taken up; one kept at 4 is grown
            if (event.oldVersion < 4) asked.transaction?.objectStore("kept").clear();
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
    let policy: { form: Float32Array; weights: Float32Array; running: Float64Array } | undefined;
    /** The brain practice has: how much memory and rhythm, and how many connections each of its pool's neurons may afford. */
    const keptShape = m.recall<Shape>("generalist-brain", DEFAULT_SHAPE, 1);
    let shape: Shape = validShape(keptShape) ? keptShape : DEFAULT_SHAPE;
    /** The neuron of the brain's picture pressed, whose every connection in is drawn; none. */
    let pressedNeuron = -1;
    /** How far it got as it learned, for the chart: steps practised (or generations) against metres. */
    let learned: { x: number; y: number }[] = [];
    /** What the creature on show wants and where it looks, read each frame (`show_needs`): energy, vigour, just ate, resting, gaze, eaten. */
    let needs = { energy: -1, vigour: 1, ate: 0, resting: 0, gaze: -0.52, eaten: 0 };
    /** Where a press began on the canvas, and whether it took hold of anything, so a tap on nothing can drop food. */
    let pressedAt: { x: number; y: number; took: boolean } | undefined;
    /** A learner being forgotten ("start over"), which must be gone before the kept one is read again. */
    let forgetting: Promise<unknown> = Promise.resolve();
    /** The policy last put on show, put on show again at once when the world changes and practice carries on. */
    let onShow: { form: Float32Array; weights: Float32Array; running: Float64Array } | undefined;
    /** Said when the store has been read after a change of body: whether it took up a learner kept for that body. */
    let tellKept: ((found: boolean) => void) | undefined;
    /** A few words for a screen reader, said by the live line in the column. */
    let speak = (_words: string) => {};
    /** The world's conditions as the visitor set them (none of it kept between visits, so the page opens on the world at rest), whether it changes by itself, what a tap on nothing drops, the world as the creature last met it, and its surprise over the last few seconds. */
    let conditions: Conditions = { ...REST_CONDITIONS };
    let changing = false;
    /** Whether its brain adds and cuts its connections while it lives (stage 5), off until the visitor switches it on; not kept between visits. */
    let grows = false;
    let drops: "food" | "box" = "food";
    let world: WorldNow = worldNow([]);
    const surprises: number[] = [];
    /** Puts the world's conditions and whether it changes by itself into the engine, as after it is made again. */
    const putWorld = () => {
        if (!engine) return;
        const c = conditions;
        engine.show_conditions(c.grip, c.bounce, c.soft, c.gravity, c.wind, c.light);
        engine.show_changing(changing ? 1 : 0);
    };

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
            putWorld();
            engine.brain_grow(grows ? 1 : 0);
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
        return { kind: "begin", setup: id, legs: recipe.legs, seed, difficulty, amounts, shape, workers: helpers.length + 1, index, learnerSeed: 1, kept, carry, grows };
    };

    /** Puts the newest policy from practice on show, from the start. */
    const takePolicy = () => {
        if (!engine || !policy) return;
        write(engine, engine.form_room(policy.form.length), policy.form);
        const [stateRoom, runningRoom] = [engine.state_room(1), engine.running_room()];
        if (engine.length() === policy.running.length) {
            write(engine, stateRoom, policy.weights);
            write64(engine, runningRoom, policy.running);
            if (engine.policy_load() === 1) {
                shown = true;
                onShow = policy;
                pressedNeuron = -1;
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
     * How many workers learn at the chosen effort. Practice uses what the machine has up to four
     * (`practiceWorkers`): each update is shared by averaging every worker's weights, and with more
     * workers each has too few creatures; eight workers of four creatures learned no faster than one of
     * thirty-two, four of eight 2.3 times as fast (walker/README.md, "In the browser").
     */
    const workersNow = () => (how === "practice" ? practiceWorkers(effort, machine()) : Math.min(16, workersFor(effort, machine())));

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
    let drawSenses = () => {};
    let drawEnergy = () => {};
    /** Brings the controls of the world to it as it is, when it changes by itself. */
    let keepWorld = () => {};
    /** The tick the brain was last drawn at; none yet. */
    let brainAt = -1;
    if (!m.preview) {
        const host = m.canvas.parentElement!;
        const side = m.panel();
        side.classList.add("walker-side");
        const status = el("p", { class: "walker-status" });
        status.setAttribute("aria-hidden", "true");
        const said = el("p", { class: "walker-said unseen" });
        said.setAttribute("aria-live", "polite");
        host.insertBefore(status, side);
        side.append(said);

        const row = (words: string, ...controls: (Node | string)[]) => [el("span", { class: "walker-label", textContent: words }), el("div", { class: "walker-controls" }, ...controls)];
        const group = (words: string) => el("h3", { class: "walker-group", textContent: words });
        /** A block that grows open under what opens it and shrinks shut again, never simply appearing. */
        const opening = (id: string, ...inside: Node[]) => {
            const block = el("div", { class: "walker-opening fold", id }, el("div", { class: "walker-opening-inside" }, ...inside));
            const shut = (open: boolean) => {
                block.classList.toggle("open", open);
                block.inert = !open;
            };
            shut(false);
            return { block, shut, open: () => block.classList.contains("open") };
        };
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

        // the brain's shape: how much memory, how much rhythm, how many connections each pool neuron may afford.
        // Changing it keeps what was learned (the engine reshapes the learner); moods come with any pool.
        const slider = (words: string, least: number, most: number, step: number, value: () => number, set: (value: number) => void) => {
            const range = el("input", { type: "range", min: String(least), max: String(most), step: String(step), value: String(value()) });
            range.setAttribute("aria-label", words);
            const shownValue = el("output", { class: "walker-far", textContent: `${value()}` });
            range.addEventListener("input", () => (shownValue.textContent = range.value));
            range.addEventListener("change", () => set(Number(range.value)));
            return el("span", { class: "walker-range" }, range, shownValue);
        };
        const reshape = (change: Partial<Shape>) => {
            const next = { ...shape, ...change };
            next.mood = next.memory + next.rhythm > 0 ? 4 : 0;
            if (next.memory === shape.memory && next.rhythm === shape.rhythm && next.reads === shape.reads) return;
            shape = next;
            m.keep("generalist-brain", shape, 1);
            if (how !== "practice") return;
            say(`A brain of ${neurons(shape)} neurons. It goes on with what it has learned.`);
            begin(true);
        };
        const memorySlider = slider("memory neurons", 0, SHAPE_CAPS.memory, 8, () => shape.memory, (value) => reshape({ memory: value }));
        const rhythmSlider = slider("rhythm neurons", 0, SHAPE_CAPS.rhythm, 1, () => shape.rhythm, (value) => reshape({ rhythm: value }));
        const readsSlider = slider("connections each pool neuron reads", SHAPE_CAPS.fewestReads, SHAPE_CAPS.reads, 4, () => shape.reads, (value) => reshape({ reads: value }));
        // whether its memory neurons add and cut their connections as it lives, each paid for from its energy; it keeps what it learned
        const growing = el("input", { type: "checkbox", checked: grows, onchange: () => {
            grows = growing.checked;
            engine?.brain_grow(grows ? 1 : 0);
            flashes.clear();
            say(grows ? "Its memory neurons add and cut their connections as it lives now, each paid for from its energy. It goes on with what it has learned." : "Its connections stay as they are. It goes on with what it has learned.");
            if (how === "practice") begin(true);
        } });

        // the brain, drawn live from the first second, so a visitor watches it grow as it learns
        const brainPicture = el("canvas", { class: "walker-brain-picture generalist-brain" });
        brainPicture.setAttribute("role", "img");
        brainPicture.setAttribute("aria-label", "The creature's brain as it thinks: what it senses on the left (a dot for each ray of its eye, then its body), its plain neurons in a column either side of its pool, and what it does on the right. In the pool, small squares are memory neurons filled as full as what they hold, rings with a dot going round are rhythms, and bars under them are moods, which turn groups of the plain neurons up or down. Lines are the connections passing the most, thicker where a connection has changed since the world last changed. A small trace in the corner is its surprise: how wrong its guess of what it would see was. Pressing a neuron shows everything it listens to. With growth switched on, a connection just added grows out of the neuron it reads and one just cut draws back into it, and the words under the brain say how many connections it keeps and what share of all its energy they cost a minute.");
        /** Connections just added or cut in a brain that grows them, by where they go into and come from: whether added, and when it was seen. Each is drawn for `FLASH` seconds, an added one growing out of the neuron it reads, a cut one drawn back into it. */
        const flashes = new Map<string, { from: number; into: number; added: boolean; at: number }>();
        const FLASH = 1.2;
        /** Where each neuron of a brain with a pool is drawn, by kind, kept until its counts or the canvas change. */
        let placed: { key: string; at: [number, number][] } = { key: "", at: [] };
        const placeKinds = (kinds: BrainKinds, wide: number, high: number) => {
            const { senses, plain, memory, rhythm, mood, actions } = kinds.counts;
            const key = `${senses} ${plain} ${memory} ${rhythm} ${mood} ${actions} ${wide} ${high}`;
            if (placed.key === key) return placed.at;
            const [left, right, top, bottom] = [8, wide - 8, 8, high - 20];
            const at: [number, number][] = [];
            const column = (count: number, x: number) => {
                const gap = Math.min((bottom - top) / Math.max(1, count - 1), 9);
                for (let i = 0; i < count; i++) at.push([x, (top + bottom) / 2 + (i - (count - 1) / 2) * gap]);
            };
            const xAt = (share: number) => left + (right - left) * share;
            column(senses, xAt(0));
            column(plain, xAt(0.17));
            // the pool in the middle: rhythms in a row over the memories, moods in a row under them
            const [poolLeft, poolRight] = [xAt(0.29), xAt(0.71)];
            const rhythmRow = top + 7;
            const moodRow = bottom - 5;
            const [gridTop, gridBottom] = [rhythm > 0 ? rhythmRow + 12 : top, mood > 0 ? moodRow - 11 : bottom];
            const across = Math.max(1, Math.ceil(Math.sqrt((memory * (poolRight - poolLeft)) / Math.max(1, gridBottom - gridTop))));
            const down = Math.max(1, Math.ceil(memory / across));
            for (let i = 0; i < memory; i++) {
                const [c, r] = [i % across, Math.floor(i / across)];
                at.push([poolLeft + ((c + 0.5) * (poolRight - poolLeft)) / across, gridTop + ((r + 0.5) * (gridBottom - gridTop)) / down]);
            }
            for (let j = 0; j < rhythm; j++) at.push([poolLeft + ((j + 0.5) * (poolRight - poolLeft)) / rhythm, rhythmRow]);
            for (let q = 0; q < mood; q++) at.push([poolLeft + ((q + 0.5) * (poolRight - poolLeft)) / mood, moodRow]);
            column(plain, xAt(0.83));
            column(actions, xAt(1));
            placed = { key, at };
            return at;
        };

        /** A brain with a pool, drawn by kind: plain neurons as dots, memories as small vessels filled by what they hold, rhythms as rings with a dot going round at their pace, moods as bars filled by their level; into each neuron the connections passing it the most, a plastic one thicker the more it has changed in this run; a neuron pressed shows everything it listens to. */
        const drawKinds = (ctx: CanvasRenderingContext2D, kinds: BrainKinds, wide: number, high: number) => {
            const at = placeKinds(kinds, wide, high);
            const { senses, plain, memory, rhythm, mood, actions } = kinds.counts;
            const [accent, muted, ink] = [m.color("--accent"), m.color("--muted"), m.color("--ink")];
            const pool = senses + plain;
            const count = at.length;
            let strongest = 1e-6;
            for (let k = 1; k < kinds.into.length; k += 3) strongest = Math.max(strongest, Math.abs(kinds.into[k]!));
            const LEVELS = 4;
            const paths = Array.from({ length: 2 * LEVELS }, () => new Path2D());
            const plastic: [number, number, number][] = [];
            for (let n = senses; n < count; n++) {
                for (let e = 0; e < 3; e++) {
                    const k = 9 * (n - senses) + 3 * e;
                    const from = kinds.into[k]!;
                    if (from < 0 || from >= count) continue;
                    const passed = kinds.into[k + 1]!;
                    const changed = kinds.into[k + 2]!;
                    if (Math.abs(changed) > 0.02) plastic.push([from, n, changed]);
                    const level = Math.min(LEVELS - 1, Math.floor((Math.abs(passed) / strongest) * LEVELS));
                    const path = paths[level + (passed > 0 ? 0 : LEVELS)]!;
                    path.moveTo(...at[from]!);
                    path.lineTo(...at[n]!);
                }
            }
            ctx.lineWidth = 1;
            paths.forEach((path, p) => {
                ctx.globalAlpha = 0.1 + 0.5 * (((p % LEVELS) + 1) / LEVELS);
                ctx.strokeStyle = p < LEVELS ? accent : muted;
                ctx.stroke(path);
            });
            // a connection that has changed in this run by its own rule, thicker the more it has
            for (const [from, n, changed] of plastic) {
                ctx.globalAlpha = 0.75;
                ctx.strokeStyle = changed > 0 ? accent : muted;
                ctx.lineWidth = 1 + Math.min(3, Math.abs(changed) * 4);
                ctx.beginPath();
                ctx.moveTo(...at[from]!);
                ctx.lineTo(...at[n]!);
                ctx.stroke();
            }
            // connections just added grow out of the neuron they read, and connections just cut draw back into it
            if (kinds.growth) {
                const { changes } = kinds.growth;
                for (let k = 0; k + 2 < changes.length; k += 3) {
                    const [into, from, added] = [changes[k]!, changes[k + 1]!, changes[k + 2]! > 0];
                    const key = `${into} ${from}`;
                    if (flashes.get(key)?.added !== added) flashes.set(key, { from, into, added, at: m.time });
                }
                for (const [key, flash] of flashes) {
                    const age = (m.time - flash.at) / FLASH;
                    if (age >= 1 || age < 0 || flash.from >= count || flash.into >= count) {
                        flashes.delete(key);
                        continue;
                    }
                    const [[fx, fy], [ix, iy]] = [at[flash.from]!, at[flash.into]!];
                    // quick to start and slow to settle
                    const eased = 1 - (1 - Math.min(1, age * 2.5)) ** 3;
                    const reach = flash.added ? eased : 1 - eased;
                    ctx.globalAlpha = flash.added ? 0.95 * (1 - age * 0.6) : 0.7 * (1 - age);
                    ctx.strokeStyle = flash.added ? ink : muted;
                    ctx.lineWidth = flash.added ? 1.6 : 1;
                    ctx.beginPath();
                    ctx.moveTo(fx, fy);
                    ctx.lineTo(fx + (ix - fx) * reach, fy + (iy - fy) * reach);
                    ctx.stroke();
                }
            }
            // a neuron pressed: everything it listens to
            if (engine && pressedNeuron >= senses && pressedNeuron < count) {
                const heard = list(engine, engine.brain_reads(pressedNeuron));
                let most = 1e-6;
                for (let k = 2; k < heard.length; k += 3) most = Math.max(most, Math.abs(heard[k]!));
                for (let k = 0; k + 2 < heard.length; k += 3) {
                    const from = heard[k]!;
                    if (from < 0 || from >= count) continue;
                    ctx.globalAlpha = 0.2 + 0.8 * Math.min(1, Math.abs(heard[k + 2]!) / most);
                    ctx.strokeStyle = heard[k + 2]! >= 0 ? ink : muted;
                    ctx.lineWidth = 1.2;
                    ctx.beginPath();
                    ctx.moveTo(...at[from]!);
                    ctx.lineTo(...at[pressedNeuron]!);
                    ctx.stroke();
                }
            }
            ctx.globalAlpha = 1;
            const lit = (value: number) => {
                ctx.globalAlpha = 0.25 + 0.75 * Math.min(1, Math.abs(value));
                ctx.fillStyle = value >= 0 ? accent : muted;
            };
            const ground = m.color("--ground");
            for (let n = 0; n < count; n++) {
                const [x, y] = at[n]!;
                const value = kinds.lit[n]!;
                if (n >= pool && n < pool + memory) {
                    // a memory: a small vessel, filled as full as what it holds, ringed brighter when it has just taken something in
                    const moved = Math.abs(kinds.moved[n - pool]!);
                    const size = 5;
                    ctx.globalAlpha = 1;
                    ctx.fillStyle = ground;
                    ctx.fillRect(x - size / 2, y - size / 2, size, size);
                    lit(value);
                    const full = size * Math.min(1, Math.abs(value));
                    ctx.fillRect(x - size / 2, y + size / 2 - full, size, full);
                    ctx.globalAlpha = 0.35 + Math.min(0.65, moved * 6);
                    ctx.strokeStyle = moved > 0.05 ? ink : muted;
                    ctx.lineWidth = moved > 0.05 ? 1.2 : 0.7;
                    ctx.strokeRect(x - size / 2, y - size / 2, size, size);
                } else if (n >= pool + memory && n < pool + memory + rhythm) {
                    // a rhythm: a ring, its dot at its phase, so it is seen to go round at the pace the brain sets
                    const phase = kinds.moved[n - pool]!;
                    ctx.globalAlpha = 0.6;
                    ctx.strokeStyle = muted;
                    ctx.lineWidth = 1;
                    ctx.beginPath();
                    ctx.arc(x, y, 4.5, 0, Math.PI * 2);
                    ctx.stroke();
                    ctx.globalAlpha = 1;
                    ctx.fillStyle = accent;
                    ctx.beginPath();
                    ctx.arc(x + 4.5 * Math.cos(phase), y - 4.5 * Math.sin(phase), 1.8, 0, Math.PI * 2);
                    ctx.fill();
                } else if (n >= pool + memory + rhythm && n < pool + memory + rhythm + mood) {
                    // a mood: a bar from its middle, to the right as it turns its group up, to the left as it quietens it
                    const spread = Math.min(16, (wide * 0.42) / Math.max(1, mood) / 2 - 2);
                    ctx.globalAlpha = 0.25;
                    ctx.fillStyle = muted;
                    ctx.beginPath();
                    ctx.roundRect(x - spread, y - 2.5, 2 * spread, 5, 2.5);
                    ctx.fill();
                    lit(value);
                    ctx.globalAlpha = 0.9;
                    const reach = spread * Math.max(-1, Math.min(1, value));
                    ctx.beginPath();
                    ctx.roundRect(Math.min(x, x + reach), y - 2.5, Math.max(1.5, Math.abs(reach)), 5, 2.5);
                    ctx.fill();
                } else {
                    // what it senses, the plain neurons and what it does: dots
                    ctx.globalAlpha = 1;
                    ctx.fillStyle = ground;
                    ctx.beginPath();
                    ctx.arc(x, y, 2.2, 0, Math.PI * 2);
                    ctx.fill();
                    lit(value);
                    ctx.fill();
                }
                ctx.globalAlpha = 1;
            }
            if (pressedNeuron >= 0 && pressedNeuron < count) {
                const [x, y] = at[pressedNeuron]!;
                ctx.strokeStyle = ink;
                ctx.lineWidth = 1.2;
                ctx.beginPath();
                ctx.arc(x, y, 6.5, 0, Math.PI * 2);
                ctx.stroke();
            }
            // the neuron for looking around, before the hop at the foot of what it does: ringed, with an eye beside it
            if (needs.energy >= 0 && actions >= 2) {
                const [x, y] = at[count - 2]!;
                ringEye(ctx, x, y, accent);
            }
        };

        /** A ring round the neuron for looking around, with an eye beside it. */
        const ringEye = (ctx: CanvasRenderingContext2D, x: number, y: number, accent: string) => {
            ctx.globalAlpha = 1;
            ctx.strokeStyle = accent;
            ctx.lineWidth = 1.2;
            ctx.beginPath();
            ctx.arc(x, y, 6, 0, Math.PI * 2);
            ctx.stroke();
            ctx.beginPath();
            ctx.ellipse(x - 13, y, 4.5, 2.6, 0, 0, Math.PI * 2);
            ctx.stroke();
            ctx.fillStyle = accent;
            ctx.beginPath();
            ctx.arc(x - 13, y, 1.2, 0, Math.PI * 2);
            ctx.fill();
        };

        // a press on a neuron shows what it listens to; a press on it again, or on nothing, lets it go
        brainPicture.addEventListener("pointerdown", (event) => {
            if (!placed.at.length) return;
            const box = brainPicture.getBoundingClientRect();
            const [x, y] = [event.clientX - box.left, event.clientY - box.top];
            let [nearest, best] = [-1, 10 * 10];
            placed.at.forEach(([px, py], n) => {
                const d = (px - x) ** 2 + (py - y) ** 2;
                if (d < best) [nearest, best] = [n, d];
            });
            pressedNeuron = nearest === pressedNeuron ? -1 : nearest;
            m.wake();
        });

        drawBrain = () => {
            if (!engine) return;
            const raw = list(engine, engine.brain_picture());
            const ctx = brainPicture.getContext("2d");
            if (!ctx) return;
            const ratio = window.devicePixelRatio || 1;
            const [wide, high] = [brainPicture.clientWidth, brainPicture.clientHeight];
            if (wide === 0) return;
            if (brainPicture.width !== Math.round(wide * ratio) || brainPicture.height !== Math.round(high * ratio)) [brainPicture.width, brainPicture.height] = [Math.round(wide * ratio), Math.round(high * ratio)];
            ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
            ctx.clearRect(0, 0, wide, high);
            const kinds = brainKinds(raw);
            const words = () => {
                ctx.globalAlpha = 1;
                ctx.fillStyle = m.color("--muted");
                ctx.font = `11px ${code}`;
                ctx.textBaseline = "bottom";
                ctx.textAlign = "left";
                ctx.fillText("senses", 2, high - 3);
                ctx.textAlign = "center";
                // the brain drawn, which until its run ends may be the shape before a slider moved; one that grows its
                // connections says how many it keeps and what share of its energy they cost a minute
                const growth = kinds?.growth;
                const percent = growth ? growth.cost * 6000 : 0;
                const brainWords = growth
                    ? wide > 280 ? `${growth.joined} connections cost ${percent < 1 ? percent.toFixed(1) : Math.round(percent)}% a minute` : `${growth.joined} connections`
                    : kinds ? `${2 * kinds.counts.plain + kinds.counts.memory + kinds.counts.rhythm + kinds.counts.mood} neurons` : "neurons";
                ctx.fillText(brainWords, wide / 2, high - 3);
                ctx.textAlign = "right";
                ctx.fillText("moves", wide - 2, high - 3);
            };
            if (kinds) {
                drawKinds(ctx, kinds, wide, high);
                words();
                drawSurprise(ctx, wide);
                return;
            }
            placed = { key: "", at: [] };
            const picture = brainColumns(raw);
            if (!picture) return;
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
            // the neuron for looking around, before the hop at the foot of what it does: ringed, with an eye beside it
            const moves = lit.length - 1;
            if (needs.energy >= 0 && lit[moves]!.length >= 2) ringEye(ctx, ...place(moves, lit[moves]!.length - 2), accent);
            words();
            drawSurprise(ctx, wide);
        };

        /** Its surprise over the last few seconds, a small trace in the brain's top right corner, over what it does: how wrong its guess of what it would see was, with the level it is used to under it. Nothing for a brain with no predictor. */
        const drawSurprise = (ctx: CanvasRenderingContext2D, wide: number) => {
            if (surprises.length < 2 || !surprises.some((value) => value > 0)) return;
            // over what it does, which sits low in its column, clear of the second plain layer's
            const [left, right, top, bottom] = [wide * 0.87, wide - 4, 4, 18];
            const most = Math.max(0.05, ...surprises);
            const at = (k: number, value: number): [number, number] => [left + ((right - left) * k) / (TRACED - 1), bottom - ((bottom - top) * Math.min(value, most)) / most];
            const start = TRACED - surprises.length;
            ctx.globalAlpha = 0.25;
            ctx.fillStyle = m.color("--muted");
            ctx.fillRect(left, bottom - ((bottom - top) * Math.min(world.usual, most)) / most, right - left, 1);
            ctx.globalAlpha = 0.9;
            ctx.strokeStyle = m.color("--accent");
            ctx.lineWidth = 1.2;
            ctx.lineJoin = "round";
            ctx.beginPath();
            surprises.forEach((value, k) => (k === 0 ? ctx.moveTo(...at(start + k, value)) : ctx.lineTo(...at(start + k, value))));
            ctx.stroke();
            ctx.globalAlpha = 1;
            ctx.fillStyle = m.color("--muted");
            ctx.font = `11px ${code}`;
            ctx.textBaseline = "top";
            ctx.textAlign = "right";
            ctx.fillText("surprise", right, bottom + 2);
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

        // what it senses, drawn live: each ray of its eye, then touch on its body and feet, held, and the jolt
        const sensesPicture = el("canvas", { class: "walker-brain-picture generalist-senses" });
        sensesPicture.setAttribute("role", "img");
        sensesPicture.setAttribute("aria-label", "What the creature senses now: a cell for each ray of its eye, from low to high, lit by how near what it meets is, food marked with a dot; then how hard things press on its body and each foot, whether it is held, what it hears land behind it and ahead of it, and the push its body feels.");
        drawSenses = () => {
            if (!engine) return;
            const ctx = sensesPicture.getContext("2d");
            const [wide, high] = [sensesPicture.clientWidth, sensesPicture.clientHeight];
            if (!ctx || wide === 0) return;
            const ratio = window.devicePixelRatio || 1;
            if (sensesPicture.width !== Math.round(wide * ratio) || sensesPicture.height !== Math.round(high * ratio)) [sensesPicture.width, sensesPicture.height] = [Math.round(wide * ratio), Math.round(high * ratio)];
            ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
            ctx.clearRect(0, 0, wide, high);
            const sensed = list(engine, engine.show_senses());
            const legs = engine.legs_length();
            const layout = senseLayout(legs);
            const [accent, muted, ink] = [m.color("--accent"), m.color("--muted"), m.color("--ink")];
            // a creature kept before it heard senses touch last, and is drawn as far as that
            const practised = sensed.length === layout.length || sensed.length === layout.heard;
            // the eye: sixteen cells, the lowest ray on the left; the middle ones, where it looks, a little taller
            const [left, right] = [8, wide - 8];
            const cell = (right - left) / 16;
            for (let k = 0; k < 16; k++) {
                const near = sensed[k * 6] ?? 0;
                const kind = [1, 2, 3, 4, 5].find((slot) => (sensed[k * 6 + slot] ?? 0) > 0.5);
                const middle = practised && k >= 6 && k <= 9;
                const [top, tall] = middle ? [6, 30] : [10, 22];
                ctx.globalAlpha = 0.12 + 0.88 * near;
                ctx.fillStyle = kind ? accent : muted;
                ctx.beginPath();
                ctx.roundRect(left + k * cell + 1, top, cell - 2, tall, 2);
                ctx.fill();
                ctx.globalAlpha = 1;
                if (kind === 5) {
                    ctx.fillStyle = ink;
                    ctx.beginPath();
                    ctx.arc(left + (k + 0.5) * cell, top + tall / 2, Math.min(cell * 0.22, 4), 0, Math.PI * 2);
                    ctx.fill();
                }
            }
            if (!practised) return;
            // touch: its body, each foot, held; then the jolt as a short line from a dot
            const bars = [sensed[layout.touch] ?? 0, ...Array.from({ length: legs }, (_, k) => sensed[layout.footPressed + k] ?? 0)];
            const [base, most] = [high - 17, Math.max(10, high - 59)];
            const barWide = Math.min(18, (wide * 0.55) / (bars.length + 1));
            bars.forEach((value, k) => {
                const x = left + k * (barWide + 6);
                ctx.globalAlpha = 0.25;
                ctx.fillStyle = muted;
                ctx.fillRect(x, base - most, barWide, most);
                ctx.globalAlpha = 1;
                ctx.fillStyle = accent;
                const tall = (most * Math.min(2, value)) / 2;
                ctx.fillRect(x, base - tall, barWide, tall);
            });
            const heldX = left + bars.length * (barWide + 6) + 8;
            ctx.beginPath();
            ctx.arc(heldX, base - most / 2, 5, 0, Math.PI * 2);
            ctx.strokeStyle = accent;
            ctx.lineWidth = 1.5;
            ctx.stroke();
            if ((sensed[layout.held] ?? 0) > 0.5) {
                ctx.fillStyle = accent;
                ctx.fill();
            }
            // what it hears land: a sound mark behind it (left) and ahead (right), opening out as loud as it is
            if (sensed.length >= layout.length) {
                const middle = base - most / 2;
                [sensed[layout.heard + 1] ?? 0, sensed[layout.heard] ?? 0].forEach((loud, side) => {
                    const x = heldX + 24 + side * 16;
                    const way = side === 0 ? -1 : 1;
                    ctx.fillStyle = muted;
                    ctx.beginPath();
                    ctx.arc(x, middle, 1.8, 0, Math.PI * 2);
                    ctx.fill();
                    for (let ring = 1; ring <= 3; ring++) {
                        ctx.globalAlpha = Math.min(1, 0.15 + loud * 1.5 - (ring - 1) * 0.3);
                        ctx.strokeStyle = loud > 0.05 ? accent : muted;
                        ctx.lineWidth = 1.2;
                        ctx.beginPath();
                        ctx.arc(x, middle, 2 + ring * 2.5, way > 0 ? -0.8 : Math.PI - 0.8, way > 0 ? 0.8 : Math.PI + 0.8);
                        ctx.stroke();
                    }
                    ctx.globalAlpha = 1;
                });
            }
            const [jx, jy] = [sensed[layout.jolt] ?? 0, sensed[layout.jolt + 1] ?? 0];
            const [cx, cy] = [right - 22, base - most / 2];
            ctx.fillStyle = muted;
            ctx.beginPath();
            ctx.arc(cx, cy, 2.5, 0, Math.PI * 2);
            ctx.fill();
            ctx.strokeStyle = accent;
            ctx.beginPath();
            ctx.moveTo(cx, cy);
            ctx.lineTo(cx + jx * 9, cy - jy * 9);
            ctx.stroke();
            ctx.fillStyle = muted;
            ctx.font = `11px ${code}`;
            ctx.textBaseline = "bottom";
            ctx.textAlign = "left";
            ctx.fillText("eye", left, high - 3);
            ctx.textAlign = "center";
            ctx.fillText("touch", wide / 2, high - 3);
            ctx.textAlign = "right";
            ctx.fillText("push", right, high - 3);
        };

        // its energy: a bar, with a mark where its muscles begin to weaken; a piece of food can be dropped in front of it
        const energyPicture = el("canvas", { class: "walker-brain-picture generalist-energy" });
        energyPicture.setAttribute("role", "img");
        energyPicture.setAttribute("aria-label", "How much energy the creature has, as a bar: it runs down as it moves, comes back as it eats and, slowly, as it rests.");
        keepWorld = () => syncWorld();
        drawEnergy = () => {
            const ctx = energyPicture.getContext("2d");
            const [wide, high] = [energyPicture.clientWidth, energyPicture.clientHeight];
            if (!ctx || wide === 0) return;
            const ratio = window.devicePixelRatio || 1;
            if (energyPicture.width !== Math.round(wide * ratio) || energyPicture.height !== Math.round(high * ratio)) [energyPicture.width, energyPicture.height] = [Math.round(wide * ratio), Math.round(high * ratio)];
            ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
            ctx.clearRect(0, 0, wide, high);
            const [accent, muted] = [m.color("--accent"), m.color("--muted")];
            const [left, right, top, bottom] = [8, wide - 8, 8, high - 8];
            ctx.globalAlpha = 0.2;
            ctx.fillStyle = muted;
            ctx.beginPath();
            ctx.roundRect(left, top, right - left, bottom - top, (bottom - top) / 2);
            ctx.fill();
            ctx.globalAlpha = 1;
            if (needs.energy < 0) return;
            // resting, it breathes; just fed, it flares
            const breathing = needs.resting > 0.3 ? 0.15 * needs.resting * (0.5 + 0.5 * Math.sin(m.time * 3)) : 0;
            ctx.globalAlpha = Math.min(1, 0.55 + 0.45 * needs.energy + breathing + 0.4 * needs.ate);
            ctx.fillStyle = accent;
            ctx.beginPath();
            ctx.roundRect(left, top, Math.max(bottom - top, (right - left) * needs.energy), bottom - top, (bottom - top) / 2);
            ctx.fill();
            ctx.globalAlpha = 0.6;
            ctx.fillStyle = muted;
            const mark = left + (right - left) * TIRED;
            ctx.fillRect(mark - 0.5, top - 3, 1, bottom - top + 6);
            ctx.globalAlpha = 1;
        };
        const dropFood = el("button", { type: "button", textContent: "drop food", onclick: () => {
            if (!engine) return;
            const [x, y] = torso();
            if (engine.show_drop_food(x + 1.2, y + 0.8)) speak("A piece of food, dropped in front of it.");
            m.wake();
        } });

        // the world as it lives: the ground, gravity, a wind and the light, each resting where the world always
        // was; whether it changes by itself; and what a tap on nothing drops
        let syncWorld = () => {};
        const setConditions = (change: Partial<Conditions>, words?: string) => {
            conditions = { ...conditions, ...change };
            putWorld();
            if (words) speak(words);
            m.wake();
        };
        const groundChoice = choices<Ground>("ground", "the ground", GROUNDS.map(({ ground, text }) => ({ value: ground, text })), () => groundOf(conditions), (chosen) => {
            const found = GROUNDS.find((each) => each.ground === chosen)!;
            setConditions(found.conditions, `The ground is ${found.text} now.`);
        });
        /** A slider with a mark where it rests, saying its value in plain words, that changes the world as it moves. */
        const resting = (name: string, words: string, least: number, most: number, step: number, rest: number, value: () => number, say: (value: number) => string, set: (value: number) => void) => {
            const marks = el("datalist", { id: `generalist-${name}-rest` }, el("option", { value: String(rest) }));
            const range = el("input", { type: "range", min: String(least), max: String(most), step: String(step), value: String(value()) });
            range.setAttribute("aria-label", words);
            range.setAttribute("list", marks.id);
            const shownValue = el("output", { class: "walker-far generalist-worded", textContent: say(value()) });
            range.addEventListener("input", () => {
                shownValue.textContent = say(Number(range.value));
                set(Number(range.value));
            });
            return { range, shownValue, say, holder: el("span", { class: "walker-range" }, range, shownValue, marks) };
        };
        const gravity = resting("gravity", "gravity", 50, 160, 5, 100, () => Math.round(conditions.gravity * 100), (value) => (value === 100 ? "as always" : `${(value / 100).toFixed(2)} g`), (value) => setConditions({ gravity: value / 100 }));
        const wind = resting("wind", "wind, from ahead to from behind", -6, 6, 1, 0, () => Math.round(conditions.wind), (value) => (value === 0 ? "none" : value < 0 ? `${-value} ahead` : `${value} behind`), (value) => setConditions({ wind: value }));
        const lightChoice = choices<number>("light", "the light", LIGHTS.map(({ light, text }) => ({ value: light, text })), () => lightOf(conditions.light), (chosen) => setConditions({ light: chosen }, chosen === 1 ? "Day." : chosen === 0 ? "Night: it sees only what is near." : "Dusk."));
        const byItself = el("input", { type: "checkbox", checked: changing, onchange: () => {
            changing = byItself.checked;
            putWorld();
            speak(changing ? "The world changes by itself now and then, and things are dropped near it." : "The world stays as it is.");
            m.wake();
        } });
        const asItWas = el("button", { type: "button", textContent: "as it was", onclick: () => {
            [changing, byItself.checked] = [false, false];
            setConditions({ ...REST_CONDITIONS }, "The world as it always was.");
            syncWorld();
        } });
        const dropChoice = choices<"food" | "box">("drops", "what a tap drops", [{ value: "food", text: "food" }, { value: "box", text: "a box" }], () => drops, (chosen) => (drops = chosen));
        /** The controls brought to the world as it is, when it has changed by itself. */
        syncWorld = () => {
            const now = changing ? world.conditions : conditions;
            if (changing) conditions = { ...now };
            const check = (set: HTMLElement, value: string) => set.querySelectorAll("input").forEach((input) => (input.checked = input.value === value));
            check(groundChoice, groundOf(now));
            check(lightChoice, String(lightOf(now.light)));
            for (const [slider, value] of [[gravity, Math.round(now.gravity * 20) * 5], [wind, Math.round(now.wind)]] as const) {
                if (document.activeElement === slider.range) continue;
                slider.range.value = String(value);
                slider.shownValue.textContent = slider.say(value);
            }
        };

        // the controls fold away at the top of the column, so the brain, the senses and the energy come first
        const controls = opening(
            "generalist-controls",
            group("world"),
            ...row("seed", seed, another),
            ...row("how hard", hard.holder),
            ...kinds.flat(),
            ...row("legs", legs),
            ...row("eyes", el("label", {}, rays, "show what it sees")),
            group("as it lives"),
            ...row("ground", groundChoice),
            ...row("gravity", gravity.holder),
            ...row("wind", wind.holder),
            ...row("light", lightChoice),
            ...row("changes", el("label", {}, byItself, "by itself"), asItWas),
            ...row("a tap drops", dropChoice),
            group("learning"),
            ...row("how it learns", hows),
            explain,
            ...row("learning", pause, el("button", { type: "button", textContent: "start over", onclick: () => restart(true) })),
            ...row("effort", efforts),
            group("brain"),
            ...row("memory", memorySlider),
            ...row("rhythm", rhythmSlider),
            ...row("connections", readsSlider),
            ...row("growth", el("label", {}, growing, "adds and cuts connections as it lives")),
        );
        const fold = el("button", { type: "button", class: "generalist-fold", textContent: "world and learning", onclick: () => {
            controls.shut(!controls.open());
            fold.setAttribute("aria-expanded", String(controls.open()));
            fold.classList.toggle("open", controls.open());
            m.wake();
        } });
        fold.setAttribute("aria-expanded", "false");
        fold.setAttribute("aria-controls", "generalist-controls");
        side.append(fold, controls.block, group("brain"), brainPicture, group("senses"), sensesPicture, group("energy"), energyPicture, ...row("food", dropFood), chart);
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
        drawGround(fill, left, right);
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

    /** How much of each kind of changed ground the world has now, from 0 to 1: ice, sticky, bouncy and soft. */
    const groundLooks = () => {
        const c = world.conditions;
        const clamp = (v: number) => Math.max(0, Math.min(1, v));
        return { ice: clamp((1 - c.grip) / 0.94), sticky: clamp((c.grip - 1) / 1.5), bouncy: clamp(c.bounce / 0.75), soft: clamp(c.soft) };
    };

    /**
     * The ground as it is now, over the plain ground already drawn: ice pale and glossy with a bright line
     * along it, sticky ground dark with drips under its edge, bouncy ground with a springing line, and soft
     * ground speckled like sand, its edge a little lumpy.
     */
    const drawGround = (fill: Path2D, left: number, right: number) => {
        const { ctx } = m;
        const { ice, sticky, bouncy, soft } = groundLooks();
        if (ice + sticky + bouncy + soft < 0.02) return;
        const surface = (each: (ax: number, ay: number, bx: number, by: number) => void) => {
            for (let i = 0; i < ground.length; i += 4) {
                const [x1, y1, x2, y2] = [ground[i]!, ground[i + 1]!, ground[i + 2]!, ground[i + 3]!];
                if (x1 === x2 || !seen(left, right, x1, x2)) continue;
                each(...toScreen(x1, y1), ...toScreen(x2, y2));
            }
        };
        if (ice > 0) {
            ctx.globalAlpha = 0.32 * ice;
            ctx.fillStyle = ICE;
            ctx.fill(fill);
            ctx.globalAlpha = 0.8 * ice;
            ctx.strokeStyle = m.color("--ink");
            ctx.lineWidth = 1.2;
            ctx.beginPath();
            surface((ax, ay, bx, by) => {
                // a shine a little under the surface, broken into glints
                for (let t = 0; t < 1; t += 0.25) {
                    ctx.moveTo(ax + (bx - ax) * t + 4, ay + (by - ay) * t + 4);
                    ctx.lineTo(ax + (bx - ax) * (t + 0.15) + 4, ay + (by - ay) * (t + 0.15) + 4);
                }
            });
            ctx.stroke();
        }
        if (sticky > 0) {
            ctx.globalAlpha = 0.4 * sticky;
            ctx.fillStyle = STICKY;
            ctx.fill(fill);
            ctx.globalAlpha = 0.9 * sticky;
            ctx.beginPath();
            surface((ax, ay, bx, by) => {
                const count = Math.max(1, Math.round(Math.hypot(bx - ax, by - ay) / (0.35 * scale)));
                for (let k = 0; k < count; k++) {
                    const t = (k + 0.5) / count;
                    const [x, y] = [ax + (bx - ax) * t, ay + (by - ay) * t];
                    const long = (0.04 + 0.03 * ((k * 7) % 3)) * scale;
                    ctx.moveTo(x + 3, y);
                    ctx.arc(x, y + long, 3, 0, Math.PI);
                    ctx.lineTo(x - 3, y);
                }
            });
            ctx.fill();
        }
        if (bouncy > 0) {
            ctx.globalAlpha = bouncy;
            ctx.strokeStyle = BOUNCY;
            ctx.lineWidth = 2;
            ctx.beginPath();
            surface((ax, ay, bx, by) => {
                const length = Math.hypot(bx - ax, by - ay);
                const steps = Math.max(2, Math.round(length / 3));
                for (let k = 0; k <= steps; k++) {
                    const t = k / steps;
                    const wave = Math.sin(t * length * 0.25 + m.time * 6) * 0.025 * scale * bouncy;
                    const [x, y] = [ax + (bx - ax) * t, ay + (by - ay) * t + 3 + wave];
                    if (k === 0) ctx.moveTo(x, y);
                    else ctx.lineTo(x, y);
                }
            });
            ctx.stroke();
        }
        if (soft > 0) {
            ctx.globalAlpha = 0.7 * soft;
            ctx.fillStyle = SAND;
            surface((ax, ay, bx, by) => {
                const length = Math.hypot(bx - ax, by - ay);
                const count = Math.round((length / scale) * 26);
                for (let k = 0; k < count; k++) {
                    // speckles in a band under the surface, the same each frame
                    const t = ((k * 0.618034) % 1 + 1) % 1;
                    const depth = (((k * 0.414214) % 1) * 0.12 + 0.01) * scale;
                    ctx.fillRect(ax + (bx - ax) * t, ay + (by - ay) * t + depth, 1.5, 1.5);
                }
            });
        }
        ctx.globalAlpha = 1;
    };

    /** A wind, as streaks blowing across the picture, more and quicker the stronger it is. */
    const drawWind = () => {
        const strength = world.conditions.wind;
        if (Math.abs(strength) < 0.3) return;
        const { ctx } = m;
        const count = Math.round(Math.abs(strength) * 5);
        const way = Math.sign(strength);
        ctx.strokeStyle = m.color("--muted");
        ctx.lineWidth = 1;
        for (let k = 0; k < count; k++) {
            const lane = ((k * 0.618034) % 1) * horizon() * 1.1;
            const speed = (0.6 + ((k * 0.381966) % 1)) * Math.abs(strength) * 0.35 * scale;
            const long = (0.3 + 0.1 * Math.abs(strength)) * scale;
            const span = m.width + 2 * long;
            const x = (((k * 137 + way * m.time * speed) % span) + span) % span - long;
            ctx.globalAlpha = 0.18 + 0.04 * Math.abs(strength);
            ctx.beginPath();
            ctx.moveTo(x, lane);
            ctx.lineTo(x + way * long, lane);
            ctx.stroke();
        }
        ctx.globalAlpha = 1;
    };

    /** Night: the world dark but for what the creature's own eye reaches, its rays lit as far as it sees. */
    const drawNight = (engine: Engine) => {
        const dark = 1 - world.conditions.light;
        if (dark < 0.02) return;
        const { ctx } = m;
        const rays = list(engine, engine.show_rays());
        const sight = list(engine, engine.ray_angles());
        const [ex, ey] = toScreen(rays[0]!, rays[1]!);
        const view = new Path2D();
        view.moveTo(ex, ey);
        for (let k = 0; k < sight.length; k++) {
            const distance = rays[2 + 2 * k]!;
            view.lineTo(ex + Math.cos(sight[k]!) * distance * scale, ey - Math.sin(sight[k]!) * distance * scale);
        }
        view.closePath();
        const shade = new Path2D();
        shade.rect(0, 0, m.width, m.height);
        shade.addPath(view);
        ctx.globalAlpha = 0.82 * dark;
        ctx.fillStyle = m.color("--ground");
        ctx.fill(shade, "evenodd");
        ctx.globalAlpha = 0.07 * dark;
        ctx.fillStyle = m.color("--accent");
        ctx.fill(view);
        ctx.globalAlpha = 1;
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

    /** The food in its world: plain dots on the ground. */
    const drawFood = (engine: Engine) => {
        const { ctx } = m;
        const food = list(engine, engine.show_food());
        for (let i = 0; i < food.length; i += 2) {
            const [sx, sy] = toScreen(food[i]!, food[i + 1]!);
            if (sx < -10 || sx > m.width + 10) continue;
            ctx.fillStyle = m.color("--ink");
            ctx.beginPath();
            ctx.arc(sx, sy, 0.08 * scale, 0, Math.PI * 2);
            ctx.fill();
            ctx.fillStyle = m.color("--accent");
            ctx.beginPath();
            ctx.arc(sx - 0.025 * scale, sy - 0.025 * scale, 0.03 * scale, 0, Math.PI * 2);
            ctx.fill();
        }
    };

    /** Where it looks: a line from its eye along the middle of its gaze, as far as what it meets there. */
    const drawGaze = (engine: Engine) => {
        const { ctx } = m;
        const rays = list(engine, engine.show_rays());
        const [ex, ey] = toScreen(rays[0]!, rays[1]!);
        // the two middle rays, either side of where it looks
        const reach = Math.min(rays[2 + 2 * 7]!, rays[2 + 2 * 8]!);
        const [c, s] = [Math.cos(needs.gaze), Math.sin(needs.gaze)];
        const [hx, hy] = [ex + c * reach * scale, ey - s * reach * scale];
        ctx.strokeStyle = m.color("--accent");
        ctx.globalAlpha = 0.85;
        ctx.lineWidth = 1.5;
        ctx.setLineDash([5, 4]);
        ctx.beginPath();
        ctx.moveTo(ex, ey);
        ctx.lineTo(hx, hy);
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.beginPath();
        ctx.arc(hx, hy, 3.5, 0, Math.PI * 2);
        ctx.stroke();
        ctx.globalAlpha = 1;
    };

    /** What it sees: a faint line from its eye to where each ray stopped, and a mark there by what it met. */
    const drawRays = (engine: Engine) => {
        const { ctx } = m;
        const rays = list(engine, engine.show_rays());
        angles = list(engine, engine.ray_angles());
        const [ex, ey] = toScreen(rays[0]!, rays[1]!);
        for (let k = 0; k < angles.length; k++) {
            const [distance, what] = [rays[2 + 2 * k]!, rays[3 + 2 * k]!];
            const angle = angles[k]!;
            const [hx, hy] = [ex + Math.cos(angle) * distance * scale, ey - Math.sin(angle) * distance * scale];
            const kind = SEEN[what] ?? "nothing";
            const strong = kind === "hazard" || kind === "edge" || kind === "box" || kind === "moving" || kind === "food";
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
        ctx.beginPath();
        ctx.roundRect(-hw * scale, -hh * scale, 2 * hw * scale, 2 * hh * scale, Math.min(hw, hh) * scale * 0.95);
        // its body glows with the energy it has: full, bright; tired, dim; just fed, a flare around it
        if (needs.energy >= 0) {
            ctx.fillStyle = m.color("--muted");
            ctx.fill();
            ctx.globalAlpha = 0.3 + 0.7 * needs.energy;
            ctx.shadowColor = m.color("--accent");
            ctx.shadowBlur = (6 + 10 * needs.ate) * needs.energy;
        }
        ctx.fillStyle = m.color("--accent");
        ctx.fill();
        ctx.globalAlpha = 1;
        ctx.shadowBlur = 0;
        const eye = Math.min(hh * 0.3, 0.065) * scale;
        const front = legs === 4 ? 0.78 : 0.5;
        // the pupils look where its eye looks, or, for evolution's fixed eyes, the way it goes
        const look = needs.energy >= 0 ? { x: Math.cos(needs.gaze), y: Math.sin(needs.gaze) } : looking;
        const [lx, ly] = [c * look.x + s * look.y, -s * look.x + c * look.y];
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
            {
                const [energy = -1, vigour = 1, ate = 0, resting = 0, gaze = -0.52, eaten = 0] = list(engine, engine.show_needs());
                needs = { energy, vigour, ate, resting, gaze, eaten };
                world = worldNow(list(engine, engine.show_world()));
                surprises.push(world.surprise);
                if (surprises.length > TRACED) surprises.shift();
                if (changing && ticks % 30 === 0) keepWorld();
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
            pressedAt = { x, y, took: holding !== 0 };
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
            // a tap that took hold of nothing drops a piece of food where it was
            if (engine && pressedAt && !pressedAt.took && Math.hypot(x - pressedAt.x, y - pressedAt.y) < TAP) {
                if (drops === "box" && engine.show_drop_box(...toWorld(x, y))) speak("A box, dropped.");
                else if (drops === "food" && engine.show_drop_food(...toWorld(x, y))) speak("A piece of food, dropped.");
            }
            pressedAt = undefined;
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
            drawFood(engine);
            drawWind();
            drawNight(engine);
            if (showRays && (shown || holding === 1)) drawRays(engine);
            if (needs.energy >= 0 && (shown || holding === 1)) drawGaze(engine);
            drawCreature(engine);
            // the brain beside it, at half the frame rate, which is as often as a policy decides; and always the
            // first time, and when the creature is at rest, so its box is never left empty
            if (brainAt < 0 || ticks - brainAt >= 2 || ticks === brainAt) {
                brainAt = ticks;
                drawBrain();
                drawSenses();
                drawEnergy();
            }
            drawHand(engine);
        },
    };
}
