// Walker: a little creature, seen from the side, that learns to walk in the visitor's browser.
//
// It learns one of two ways. A generation at a time: evolution runs in a worker
// (src/scripts/walker-worker.ts) on its own copy of the Rust engine, and this page runs a second copy
// that shows the best brain so far. Or one walker, live: the page's copy tries one walker after
// another on screen, each a child of the best so far, kept if it does better.
//
// A run goes a set distance, or is endless. A set distance shows the best brain's own scored run
// again from the start each time, with the rest of the generation as marks along the ground. An
// endless walk goes on while the walker stays up, on ground laid ahead of it, and a better brain
// takes over at the start of a stride.
//
// The ground's controls are in a strip along the bottom (a picture of the course, when that is the
// goal), the rest in a column at the side, in groups, with what is less used behind small openings.
// What the engine does is in walker/README.md, and what this and the worker share is in walking.ts.

import { el, type Mote, type Scene } from "../mote/stage";
import { copyText } from "../scripts/copy";
import type { Order, Report } from "../scripts/walker-worker";
import {
    COURSE_GOAL,
    DEFAULT_SETUP,
    GOALS,
    KINDS,
    LAYERS,
    LEGS,
    LENGTHS,
    EFFORTS,
    LINK_NAMES,
    MEMORIES,
    NEURONS,
    POPULATION,
    PRESETS,
    Terrain,
    courseAt,
    engineAddress,
    fromLink,
    groundOf,
    heightAt,
    lengthName,
    linkParts,
    linkedSetup,
    machine,
    oldLink,
    presetOf,
    read,
    start as startEngine,
    valid,
    workersFor,
    write,
    type Effort,
    type Engine,
    type Setup,
    type Way,
} from "./walking";

export const label = "A little creature with legs, seen from the side, learning to walk. Marks along the ground show how far the rest of its generation got.";

/** How hard a drag pushes, in newton seconds for each metre dragged, and the most one move can give. */
const PUSH = 25;
const MOST_PUSH = 12;
/** How long the walker rests where its run ended before starting again, in seconds. */
const REST = 1;
/** The ground made from the start for training, and for every walk to begin on. */
const MADE = 400;
/** An endless walk has ground made this far ahead of it, a stretch at a time, and keeps this much behind. */
const AHEAD = 150;
const STRETCH = 100;
const KEPT_BEHIND = 60;
/** The fewest seconds between one better brain taking over an endless walk and the next. */
const SWAP_EVERY = 8;

export default function walker(m: Mote): Scene {
    const kept = m.recall<Setup>("walker", DEFAULT_SETUP, 4);
    let setup: Setup = valid(kept) ? kept : DEFAULT_SETUP;

    // opened from a link to a walker: its setup and its trained brain
    const linked = fromLink((name) => m.link.get(name));
    let brainToLoad: Float32Array | undefined;
    if (linked) [setup, brainToLoad] = [linkedSetup(setup, linked.setup), linked.brain];

    let engine: Engine | undefined;
    let worker: Worker | undefined;
    /** Workers helping the first with each generation's runs, as many as the effort asks for. */
    let helpers: Worker[] = [];
    let effort: Effort = m.recall<Effort>("walker-effort", "normal");
    if (!EFFORTS.some((each) => each.effort === effort)) effort = "normal";
    /** What the workers were last told to make, for a helper that joins later. */
    let made: Order | undefined;
    /** Training on this thread instead, where a worker could not be started. */
    let here = false;
    let id = 0;
    /** The ground the walk on screen is on, from its start, and what makes more of it. */
    let terrain = new Terrain(groundOf(setup));
    let ground: number[] = [];
    let beginning: number[] = [];
    let generation = 0;
    let runs = 0;
    let attempt = 0;
    let paused = false;
    let showCrowd = true;
    /** A better brain from the worker, waiting for the run on screen to end, or for the next stride. */
    let waiting: Float32Array | undefined;
    let better = false;
    /** The brain on screen: whether there is one yet, and how far its scored run went. */
    let shown = false;
    let distance = 0;
    let population: Float32Array | undefined;
    /** How long the run on screen has stood still since it ended. */
    let ended = 0;
    let beat = 0;
    let ticks = 0;
    let swapped = 0;
    /** How far the engine has moved an endless walk's world back, to add to what it says. */
    let origin = 0;
    const stale = !linked && oldLink((name) => m.link.get(name));
    let notice = { text: brainToLoad ? "A shared walker, already trained. Learning goes on from it." : stale ? "That link is to a walker from an older version, which this one cannot read. Learning starts fresh." : "", until: 7 };
    const camera = { x: 0, y: 0 };
    /** Where the body was a moment ago, for which way the eyes look. */
    let looking = { x: 1, y: 0 };
    let last: { x: number; y: number } | undefined;
    let grabbed: { x: number; y: number } | undefined;
    const doing = () => GOALS[setup.goal]!.doing;
    const live = () => setup.way === "live";
    const endless = () => setup.length === 0;

    // ---- the engine, on this page and in the worker ----
    const tell = (order: Order) => worker?.postMessage(order);

    /** The ground from the start again, as every walk begins on it. */
    const fresh = () => {
        terrain = new Terrain(groundOf(setup));
        beginning = [-20, 0, 3, 0, ...terrain.next(MADE)];
        ground = [...beginning];
        origin = 0;
    };

    const begin = (brain?: Float32Array) => {
        id += 1;
        fresh();
        [generation, runs, attempt, waiting, better, shown, distance, population, ended] = [0, 0, 0, undefined, false, false, 0, undefined, 0];
        const seed = (Math.random() * 2 ** 32) >>> 0;
        if (engine) {
            engine.create(setup.legs, POPULATION, 0, seed, setup.hidden, setup.layers, setup.memory, setup.goal, setup.length);
            write(engine, engine.ground_room(beginning.length / 4), beginning);
            engine.ground_set(beginning.length / 4);
            if (brain) take(brain);
            engine.show_reset();
            // the worker starts from the same seed, so its first generation is this one
            if (showCrowd) engine.crowd_reset();
            if (live()) {
                engine.live_begin();
                [shown, attempt] = [true, 1];
            }
            [camera.x, camera.y, last] = [0, 0, undefined];
        }
        made = { kind: "begin", setup: id, legs: setup.legs, goal: setup.goal, hidden: setup.hidden, layers: setup.layers, memory: setup.memory, length: setup.length, ground: beginning, seed, brain };
        tell(made);
        for (const helper of helpers) helper.postMessage(made);
        // learning live needs no generations in the background
        tell({ kind: live() || paused ? "pause" : "resume" });
        changed();
        m.wake();
    };

    /** Puts a brain on screen. The engine scores it on loading, by the run the screen will show. */
    const take = (brain: Float32Array) => {
        if (!engine || brain.length !== engine.weights_length()) return;
        write(engine, engine.weights_room(), brain);
        engine.weights_load();
        fresh();
        // the furthest a best brain has gone, which never goes down while the setup stays the same
        [shown, distance] = [true, Math.max(distance, engine.best_distance())];
    };

    const hear = (report: Report) => {
        if (report.kind === "failed") return trainHere();
        if (report.setup !== id || live()) return;
        [generation, runs] = [report.generation, report.runs];
        if (report.brain) waiting = report.brain;
        if (report.population) population = report.population;
        // the first brain goes on at once; after that a better one waits for the next start, or stride
        if (waiting && !shown && engine) {
            take(waiting);
            waiting = undefined;
            crowd();
        }
        changed();
    };

    const hire = () => new Worker(new URL("../scripts/walker-worker.ts", import.meta.url), { type: "module" });

    /**
     * Gives the first worker `count` helpers, each joined to it by a channel of its own. Changing the
     * effort changes only how fast learning goes, never what is learned.
     */
    const staff = (count: number) => {
        for (const helper of helpers) helper.terminate();
        helpers = [];
        if (!worker) return;
        const ports: MessagePort[] = [];
        for (let i = 0; i < count; i++) {
            const helper = hire();
            // a helper that cannot run leaves the first worker to run everything
            const fail = () => staff(0);
            helper.onmessage = (event: MessageEvent<Report>) => event.data.kind === "failed" && fail();
            helper.onerror = fail;
            const channel = new MessageChannel();
            helper.postMessage({ kind: "lead", port: channel.port2 } satisfies Order, [channel.port2]);
            if (made) helper.postMessage(made);
            ports.push(channel.port1);
            helpers.push(helper);
        }
        worker.postMessage({ kind: "helpers", ports, gentle: effort === "gentle" } satisfies Order, ports);
    };

    /** No worker: training goes on here, a run at a time between steps. */
    const trainHere = () => {
        staff(0);
        worker?.terminate();
        worker = undefined;
        if (here) return;
        here = true;
        begin();
    };

    try {
        worker = hire();
        worker.onmessage = (event: MessageEvent<Report>) => hear(event.data);
        worker.onerror = () => trainHere();
        staff(workersFor(effort, machine()) - 1);
    } catch {
        here = true;
    }

    void fetch(engineAddress())
        .then((answer) => answer.arrayBuffer())
        .then(startEngine)
        .then((made) => {
            engine = made;
            // with ?debug in the address, the engine can be reached from the console, to measure the walker on screen
            if (m.debug) Object.assign(globalThis, { walkerEngine: made, walkerWorkers: () => (worker ? helpers.length + 1 : 0) });
            begin(brainToLoad);
        });

    /** Starts the latest generation from the start, beside the best as it starts again. */
    const crowd = () => {
        if (!engine || !showCrowd || live() || endless()) return;
        if (population && !here) {
            write(engine, engine.crowd_room(POPULATION), population);
            engine.crowd_start(POPULATION);
        } else engine.crowd_reset();
    };

    /** Lays ground ahead of an endless walk, and forgets what is far behind it. */
    const layAhead = (engine: Engine, x: number) => {
        if (!engine.show_endless()) return;
        if (terrain.reached < x + AHEAD) {
            const more = terrain.next(terrain.reached + STRETCH);
            write(engine, engine.ground_room(more.length / 4), more);
            engine.show_ground_extend(more.length / 4);
            ground.push(...more);
        }
        if (ground.length > 4 * 1500) {
            const kept: number[] = [];
            for (let i = 0; i < ground.length; i += 4) if (Math.max(ground[i]!, ground[i + 2]!) > x - KEPT_BEHIND) kept.push(ground[i]!, ground[i + 1]!, ground[i + 2]!, ground[i + 3]!);
            ground = kept;
        }
    };

    // ---- the controls: the ground along the bottom, the rest at the side, in groups ----
    let changed = () => {};
    let drawBrain = () => {};
    let drawCourse = () => {};
    if (!m.preview) {
        const host = m.canvas.parentElement!;
        const side = m.panel();
        side.classList.add("walker-side");
        const strip = el("div", { class: "mote-panel walker-ground" });
        host.insertBefore(strip, side);
        // one status, over the scene; said aloud only when something changes, not with every generation
        const status = el("p", { class: "walker-status" });
        status.setAttribute("aria-hidden", "true");
        const said = el("p", { class: "walker-said unseen" });
        said.setAttribute("aria-live", "polite");
        host.insertBefore(status, strip);
        side.append(said);

        /** A row of a grid: a small label, then its controls. */
        const row = (words: string, ...controls: (Node | string)[]) => [el("span", { class: "walker-label", textContent: words }), el("div", { class: "walker-controls" }, ...controls)];
        /** A group's heading, across the column. */
        const group = (words: string) => el("h3", { class: "walker-group", textContent: words });
        /** A set of radio buttons, one for each option. */
        const choices = <T extends string | number>(name: string, words: string, options: { value: T; text: string }[], chosen: () => T, pick: (value: T) => void) => {
            const set = el("div", { class: "walker-choices" });
            set.setAttribute("role", "radiogroup");
            set.setAttribute("aria-label", words);
            for (const option of options) {
                const input = el("input", { type: "radio", name: `walker-${name}`, value: String(option.value), checked: option.value === chosen(), onchange: () => input.checked && pick(option.value) });
                set.append(el("label", {}, input, option.text));
            }
            return set;
        };
        /** A block that grows open under the row that opens it and shrinks shut again, never simply appearing. */
        const opening = (id: string, ...inside: Node[]) => {
            const block = el("div", { class: "walker-opening fold", id }, el("div", { class: "walker-opening-inside" }, ...inside));
            const shut = (open: boolean) => {
                block.classList.toggle("open", open);
                block.inert = !open;
            };
            shut(false);
            return { block, shut, open: () => block.classList.contains("open") };
        };
        const describe = () => `${setup.legs} leg${setup.legs === 1 ? "" : "s"}, ${doing()}${setup.goal === COURSE_GOAL ? "" : `, on ${setup.ground.kind === "flat" ? "flat ground" : setup.ground.kind}`}, ${lengthName(setup.length)}`;
        const restart = () => {
            m.keep("walker", setup, 4);
            // a link to a shared walker no longer says what is on the screen
            for (const name of LINK_NAMES) m.link.set(name, null);
            notice = { text: `Learning again from the start: ${describe()}.`, until: m.time + 5 };
            said.textContent = notice.text;
            begin();
        };
        const set = (change: Partial<Setup>) => {
            setup = { ...setup, ...change };
            restart();
        };

        // the strip: the ground's kind and roughness, or, for the course, a picture of it
        const rough = el("input", { type: "range", min: "0", max: "100", step: "5", value: String(setup.ground.rough) });
        rough.setAttribute("aria-label", "how rough");
        rough.addEventListener("change", () => set({ ground: { ...setup.ground, rough: Number(rough.value) } }));
        const kinds = opening("walker-kinds", ...row("ground", choices("ground", "ground", KINDS.map((kind) => ({ value: kind, text: kind })), () => setup.ground.kind, (kind) => set({ ground: { ...setup.ground, kind } }))), ...row("rough", rough));
        const map = el("canvas", { class: "walker-course-picture" });
        map.setAttribute("role", "img");
        map.setAttribute("aria-label", "The obstacle course: level ground, hills, steps and gaps, each harder than the last, with a mark at how far the best has got.");
        const course = opening("walker-course", ...row("course", map));
        strip.append(kinds.block, course.block);
        const showGround = () => {
            kinds.shut(setup.goal !== COURSE_GOAL);
            course.shut(setup.goal === COURSE_GOAL);
        };
        showGround();

        // body
        const legs = choices("legs", "legs", LEGS.map((count) => ({ value: count, text: String(count) })), () => setup.legs, (count) => set({ legs: count }));

        // brain: three sizes by name, or its own mix, whose pickers open under the names
        const own = opening(
            "walker-own",
            ...row("neurons", choices("neurons", "neurons in each layer", NEURONS.map((count) => ({ value: count, text: String(count) })), () => setup.hidden, (hidden) => set({ hidden }))),
            ...row("layers", choices("layers", "hidden layers", LAYERS.map((count) => ({ value: count, text: String(count) })), () => setup.layers, (layers) => set({ layers }))),
            ...row("memory", choices("memory", "memories", MEMORIES.map((count) => ({ value: count, text: String(count) })), () => setup.memory, (memory) => set({ memory }))),
        );
        own.shut(presetOf(setup) === "own");
        const sizes = choices("size", "brain size", [...PRESETS.map((preset) => ({ value: preset.name, text: preset.name })), { value: "own", text: "own" }], () => presetOf(setup), (name) => {
            const preset = PRESETS.find((each) => each.name === name);
            own.shut(!preset);
            m.wake();
            if (preset) set({ hidden: preset.hidden, layers: preset.layers, memory: preset.memory });
        });
        const picture = el("canvas", { class: "walker-brain-picture" });
        picture.setAttribute("role", "img");
        picture.setAttribute("aria-label", "The walker's brain: its senses and memory on the left, its joints and memory on the right, and the neurons between, lit by what passes through them.");
        const view = opening("walker-brain", picture);
        const look = el("button", { type: "button", textContent: "show it", onclick: () => {
            view.shut(!view.open());
            look.setAttribute("aria-expanded", String(view.open()));
            look.textContent = view.open() ? "hide it" : "show it";
            m.wake();
        } });
        look.setAttribute("aria-expanded", "false");
        look.setAttribute("aria-controls", "walker-brain");

        // what it learns: its goal, and how far a run goes
        const goals = choices("goal", "goal", GOALS.map((goal) => ({ value: goal.goal, text: goal.name })), () => setup.goal, (goal) => {
            setup = { ...setup, goal };
            showGround();
            restart();
        });
        const far = el("input", { type: "range", min: "0", max: String(LENGTHS.length - 1), step: "1", value: String(LENGTHS.indexOf(setup.length)) });
        far.setAttribute("aria-label", "how far a run goes");
        const farSaid = el("output", { class: "walker-far", textContent: lengthName(setup.length) });
        far.addEventListener("input", () => (farSaid.textContent = lengthName(LENGTHS[Number(far.value)]!)));
        far.addEventListener("change", () => set({ length: LENGTHS[Number(far.value)]! }));

        // how it learns: the way, pausing and starting over, the crowd
        const ways = choices<Way>("way", "how it learns", [{ value: "generation", text: "a generation at a time" }, { value: "live", text: "one walker, live" }], () => setup.way, (way) => set({ way }));
        const pause = el("button", { type: "button", textContent: "pause", onclick: () => {
            paused = !paused;
            tell({ kind: paused || live() ? "pause" : "resume" });
            said.textContent = paused ? "Learning is paused." : "Learning goes on.";
            changed();
            m.wake();
        } });
        const efforts = choices<Effort>("effort", "how hard learning works the computer", EFFORTS.map((each) => ({ value: each.effort, text: each.text })), () => effort, (chosen) => {
            effort = chosen;
            m.keep("walker-effort", effort);
            staff(workersFor(effort, machine()) - 1);
        });
        const crowdBox = el("input", { type: "checkbox", checked: showCrowd, onchange: () => {
            showCrowd = crowdBox.checked;
            crowd();
            m.wake();
        } });

        const share = el("button", { type: "button", class: "walker-share", textContent: "copy link to this walker", disabled: true, onclick: () => {
            if (!engine) return;
            const brain = read(engine, live() ? engine.live_best_weights() : engine.show_weights(), engine.weights_length());
            let address = "";
            for (const [name, value] of linkParts(setup, brain)) address = m.link.set(name, value);
            copyText(share, address, { rest: "copy link to this walker", done: "link copied", failed: "the link is in the address bar" });
        } });

        side.append(
            group("body"),
            ...row("legs", legs),
            group("brain"),
            ...row("size", sizes),
            own.block,
            ...row("see", look),
            view.block,
            group("what it learns"),
            ...row("goal", goals),
            ...row("how far", el("span", { class: "walker-range" }, far, farSaid)),
            group("how it learns"),
            ...row("way", ways),
            ...row("learning", pause, el("button", { type: "button", textContent: "start over", onclick: restart })),
            ...row("effort", efforts),
            ...row("crowd", el("label", {}, crowdBox, "show the rest")),
            share,
        );

        changed = () => {
            pause.textContent = paused ? "resume" : "pause";
            share.disabled = !shown || (live() && attempt < 2);
            crowdBox.disabled = live() || endless();
            const now = !engine
                ? "Loading the walker."
                : live()
                  ? `Attempt ${attempt}, ${doing()}, furthest ${distance.toFixed(1)} m`
                  : !shown
                    ? `Generation 0, ${doing()}, ${runs} of ${POPULATION} tried`
                    : endless()
                      ? `Generation ${generation}, ${doing()}, walked ${distance.toFixed(1)} m`
                      : `Generation ${generation}, ${doing()}, furthest ${distance.toFixed(1)} m`;
            const text = m.time < notice.until && notice.text ? notice.text : `${now}${paused ? ", paused" : ""}`;
            if (status.textContent !== text) status.textContent = text;
        };

        /** A canvas sized to its box, cleared, ready to draw on in CSS pixels. */
        const ready = (canvas: HTMLCanvasElement) => {
            const ctx = canvas.getContext("2d");
            if (!ctx) return undefined;
            const scale = window.devicePixelRatio || 1;
            const [wide, high] = [canvas.clientWidth, canvas.clientHeight];
            if (canvas.width !== Math.round(wide * scale) || canvas.height !== Math.round(high * scale)) [canvas.width, canvas.height] = [Math.round(wide * scale), Math.round(high * scale)];
            ctx.setTransform(scale, 0, 0, scale, 0, 0);
            ctx.clearRect(0, 0, wide, high);
            return { ctx, wide, high };
        };

        drawCourse = () => {
            if (!course.open()) return;
            const drawn = ready(map);
            if (!drawn) return;
            const { ctx, wide, high } = drawn;
            // the first two laps, squeezed into the picture, each stretch in its own tone
            const span = 240;
            const profile = new Terrain({ kind: "course", rough: 0 }).next(span);
            let [low, top] = [0, 0];
            for (let i = 1; i < profile.length; i += 2) [low, top] = [Math.min(low, profile[i]!), Math.max(top, profile[i]!)];
            const x = (along: number) => 4 + ((wide - 8) * along) / span;
            const y = (height: number) => high - 6 - ((high - 14) * (height - low)) / Math.max(1, top - low);
            ctx.lineWidth = 2;
            ctx.lineCap = "round";
            for (let i = 0; i < profile.length; i += 4) {
                const kind = courseAt(profile[i]!).kind;
                ctx.strokeStyle = m.color(kind === "flat" ? "--muted" : "--ink");
                ctx.globalAlpha = kind === "flat" ? 0.6 : 0.35 + 0.65 * courseAt(profile[i]!).hard;
                ctx.beginPath();
                ctx.moveTo(x(profile[i]!), y(profile[i + 1]!));
                ctx.lineTo(x(profile[i + 2]!), y(profile[i + 3]!));
                ctx.stroke();
            }
            ctx.globalAlpha = 1;
            const reached = Math.min(span, Math.max(0, distance));
            const at = heightAt(profile, reached) ?? low;
            ctx.fillStyle = m.color("--accent");
            ctx.beginPath();
            ctx.arc(x(reached), y(at) - 5, 4, 0, Math.PI * 2);
            ctx.fill();
        };

        drawBrain = () => {
            if (!engine || !view.open()) return;
            const drawn = ready(picture);
            if (!drawn) return;
            const { ctx, wide, high } = drawn;
            const size = engine.hidden_length();
            const layers = engine.layers_length();
            // memory goes in with the senses and comes out with the outputs, so it is drawn at both ends
            const memory = read(engine, engine.show_memory(), engine.memory_length());
            const inputs = new Float32Array([...read(engine, engine.show_senses(), engine.senses_length()), ...memory]);
            const hidden = read(engine, engine.show_hidden(), size * layers);
            const outputs = new Float32Array([...read(engine, engine.show_outputs(), engine.outputs_length()), ...memory]);
            const weights = read(engine, engine.show_weights(), engine.weights_length());
            const columns = [inputs, ...Array.from({ length: layers }, (_, layer) => hidden.subarray(layer * size, (layer + 1) * size)), outputs];
            const [left, right, top, bottom] = [8, wide - 8, 8, high - 20];
            const place = (column: number, row: number): [number, number] => {
                const count = columns[column]!.length;
                const gap = Math.min((bottom - top) / Math.max(1, count - 1), 9);
                return [left + ((right - left) * column) / (columns.length - 1), (top + bottom) / 2 + (row - (count - 1) / 2) * gap];
            };
            const accent = m.color("--accent");
            const muted = m.color("--muted");
            // a line is as bright as what passes along it: its weight times what its neuron gave
            ctx.lineWidth = 1;
            let at = 0;
            for (let column = 1; column < columns.length; column++) {
                const [from, to] = [columns[column - 1]!, columns[column]!];
                for (let j = 0; j < to.length; j++) {
                    for (let i = 0; i < from.length; i++) {
                        const amount = weights[at + j * from.length + i]! * from[i]!;
                        const alpha = Math.min(0.8, Math.abs(amount) * 0.45);
                        if (alpha < 0.04) continue;
                        ctx.globalAlpha = alpha;
                        ctx.strokeStyle = amount > 0 ? accent : muted;
                        ctx.beginPath();
                        ctx.moveTo(...place(column - 1, i));
                        ctx.lineTo(...place(column, j));
                        ctx.stroke();
                    }
                }
                at += to.length * (from.length + 1);
            }
            ctx.globalAlpha = 1;
            columns.forEach((values, column) => {
                values.forEach((value, row) => {
                    const [x, y] = place(column, row);
                    ctx.beginPath();
                    ctx.arc(x, y, 2.6, 0, Math.PI * 2);
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
            const names = ["senses", ...Array.from({ length: layers }, () => ""), "joints"];
            names.forEach((name, column) => {
                ctx.textAlign = column === 0 ? "left" : column === names.length - 1 ? "right" : "center";
                ctx.fillText(name, place(column, 0)[0] + (column === 0 ? -6 : column === names.length - 1 ? 6 : 0), high - 2);
            });
        };
    }

    // ---- drawing the scene ----
    // a canvas cannot read the page's font settings, so the code face's name is looked up once
    const code = getComputedStyle(m.canvas).getPropertyValue("--font-code").trim() || "monospace";
    let scale = 100;
    /** The ground's line sits this far down the scene, so the scene is mostly sky with a band of earth. */
    const horizon = () => m.height * 0.82;
    // the scene is drawn in metres from the walk's start; the engine's world may have been moved back by `origin`
    const toScreen = (x: number, y: number): [number, number] => [(x - camera.x) * scale + m.width * 0.42, horizon() - (y - camera.y) * scale];
    const toWorld = (sx: number, sy: number): [number, number] => [(sx - m.width * 0.42) / scale + camera.x, (horizon() - sy) / scale + camera.y];

    const drawGround = () => {
        const { ctx } = m;
        const [left] = toWorld(0, 0);
        const [right] = toWorld(m.width, 0);
        // filled and edged each as one path, so that the pieces show no seams between them
        const fill = new Path2D();
        const edge = new Path2D();
        for (let i = 0; i < ground.length; i += 4) {
            const [x1, y1, x2, y2] = [ground[i]!, ground[i + 1]!, ground[i + 2]!, ground[i + 3]!];
            if (Math.max(x1, x2) < left - 1 || Math.min(x1, x2) > right + 1) continue;
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
        // a mark every metre and a number every five, so that walking on level ground can be seen
        ctx.fillStyle = m.color("--muted");
        ctx.font = `11px ${code}`;
        ctx.textAlign = "center";
        ctx.textBaseline = "top";
        for (let x = Math.ceil(left); x <= right; x++) {
            const y = heightAt(ground, x);
            if (y === undefined) continue;
            const [sx, sy] = toScreen(x, y);
            ctx.globalAlpha = 0.6;
            ctx.fillRect(sx - 0.5, sy + 4, 1, x % 5 === 0 ? 7 : 4);
            ctx.globalAlpha = 1;
            if (x % 5 === 0 && sy + 14 < m.height - 12 && sx > 16 && sx < m.width - 16) ctx.fillText(x === 0 ? "start" : `${x} m`, sx, sy + 14);
        }
    };

    /** The flag at the furthest a best run has gone (or, live, a kept attempt): the one distance the status gives. */
    const drawFlag = () => {
        if (!shown || (endless() && !live())) return;
        const { ctx } = m;
        const y = heightAt(ground, distance) ?? camera.y;
        const [sx, sy] = toScreen(distance, y);
        if (sx < -20 || sx > m.width + 20 || distance <= 0) return;
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

    /** The rest of the generation: a small mark on the ground for each, where it has got to. */
    const drawCrowd = (engine: Engine) => {
        const { ctx } = m;
        const crowd = read(engine, engine.crowd_bodies(), POPULATION * 4);
        const spots: number[] = [];
        for (let i = 0; i + 3 < crowd.length; i += 4) spots.push(crowd[i]!);
        spots.sort((a, b) => a - b);
        // marks that would sit on top of each other stack up instead, so the spread can be read
        const radius = Math.max(3, scale * 0.035);
        let lastX = -Infinity;
        let level = 0;
        ctx.fillStyle = m.color("--muted");
        ctx.globalAlpha = 0.55;
        for (const x of spots) {
            const y = heightAt(ground, x) ?? camera.y - 0.5;
            const [sx, sy] = toScreen(x, y);
            level = sx - lastX < radius * 2.2 ? level + 1 : 0;
            if (level === 0) lastX = sx;
            ctx.beginPath();
            ctx.arc(sx, sy - radius - 3 - level * radius * 2.2, radius, 0, Math.PI * 2);
            ctx.fill();
        }
        ctx.globalAlpha = 1;
    };

    /** A limb from a to b, round at both ends and thicker at a. */
    const limb = (ax: number, ay: number, bx: number, by: number, wa: number, wb: number) => {
        const { ctx } = m;
        const length = Math.hypot(bx - ax, by - ay) || 1;
        const [nx, ny] = [-(by - ay) / length, (bx - ax) / length];
        // three fills, not one path: where shapes wound opposite ways overlap, one path would leave a hole
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

    /** The creature: far legs behind the body and darker, the body with its eyes, near legs in front and lighter. */
    const drawCreature = (engine: Engine) => {
        const { ctx } = m;
        const count = engine.body_count();
        const bodies = read(engine, engine.show_bodies(), 6 * count);
        for (let i = 0; i < bodies.length; i += 6) bodies[i] += origin;
        const legs = engine.legs_length();
        const load = engine.show_load();
        const [tx, ty, angle, , hw, hh] = [bodies[0]!, bodies[1]!, bodies[2]!, bodies[3]!, bodies[4]!, bodies[5]!];
        const facing = Math.cos(angle) >= 0 ? 1 : -1;
        const leg = (index: number, color: string) => {
            const upper = 1 + 2 * index;
            const lower = 2 + 2 * index;
            const ends = (body: number): [number, number, number, number] => {
                const [x, y, turn, half] = [bodies[body * 6]!, bodies[body * 6 + 1]!, bodies[body * 6 + 2]!, bodies[body * 6 + 4]!];
                const [c, s] = [Math.cos(turn), Math.sin(turn)];
                return [x - c * half, y - s * half, x + c * half, y + s * half];
            };
            const [hx, hy, kx, ky] = ends(upper);
            const [, , fx, fy] = ends(lower);
            const thick = bodies[upper * 6 + 5]!;
            const foot = bodies[lower * 6 + 5]!;
            // the foot sits on the ground: if the soft contact lets it dip a few millimetres, it is drawn on top
            const under = heightAt(ground, fx);
            const lift = under !== undefined && fy - foot < under && under - (fy - foot) < 0.05 ? under - (fy - foot) : 0;
            const [shx, shy] = toScreen(hx, hy);
            const [skx, sky] = toScreen(kx, ky);
            const [sfx, sfy] = toScreen(fx, fy + lift);
            ctx.fillStyle = color;
            limb(shx, shy, skx, sky, thick * 1.25 * scale, thick * 0.9 * scale);
            limb(skx, sky, sfx, sfy, thick * 0.85 * scale, foot * 0.75 * scale);
            // a small rounded foot pointing forward, its sole where the physics' foot meets the ground
            const long = (legs === 1 ? 2.3 : 1.7) * foot * scale;
            ctx.beginPath();
            ctx.ellipse(sfx + facing * long * 0.35, sfy, long, foot * scale, 0, 0, Math.PI * 2);
            ctx.fill();
        };
        const near = (index: number) => legs === 1 || index % 2 === 0;
        for (let i = 0; i < legs; i++) if (!near(i)) leg(i, m.color("--muted"));

        // the body: a rounded shape, flatter on top with a little rim at each end when it carries
        // something, with its eyes at the front
        const [sx, sy] = toScreen(tx, ty);
        ctx.save();
        ctx.translate(sx, sy);
        ctx.rotate(-angle);
        ctx.fillStyle = m.color("--accent");
        ctx.beginPath();
        const round = Math.min(hw, hh) * scale * 0.95;
        ctx.roundRect(-hw * scale, -hh * scale, 2 * hw * scale, 2 * hh * scale, load >= 0 ? [round * 0.35, round * 0.35, round, round] : round);
        ctx.fill();
        const eye = Math.min(hh * 0.3, 0.065) * scale;
        const front = legs === 4 ? 0.78 : 0.5;
        // the pupils look the way the body is going, in its own frame
        const [c, s] = [Math.cos(angle), Math.sin(angle)];
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
        if (load >= 0) {
            // the rims, in the body's colour, and the parcel between them
            ctx.fillStyle = m.color("--accent");
            for (const rim of [1 + 2 * legs, 2 + 2 * legs]) {
                const [rx, ry] = toScreen(bodies[rim * 6]!, bodies[rim * 6 + 1]!);
                ctx.beginPath();
                ctx.arc(rx, ry, bodies[rim * 6 + 4]! * scale, 0, Math.PI * 2);
                ctx.fill();
            }
            const [px, py] = toScreen(bodies[load * 6]!, bodies[load * 6 + 1]!);
            const [pw, ph] = [bodies[load * 6 + 4]! * scale, bodies[load * 6 + 5]! * scale];
            ctx.save();
            ctx.translate(px, py);
            ctx.rotate(-bodies[load * 6 + 2]!);
            ctx.fillStyle = m.color("--ink");
            ctx.beginPath();
            ctx.roundRect(-pw, -ph, 2 * pw, 2 * ph, ph * 0.35);
            ctx.fill();
            ctx.fillStyle = m.color("--accent");
            ctx.fillRect(-pw * 0.12, -ph, pw * 0.24, 2 * ph);
            ctx.restore();
        }
        for (let i = 0; i < legs; i++) if (near(i)) leg(i, m.color("--ink"));
    };

    /** Where the walker's body is, in metres from the walk's start. */
    const torso = (): [number, number] => {
        if (!engine) return [0, 0];
        const [x, y] = read(engine, engine.show_bodies(), 2);
        return [x! + origin, y!];
    };

    return {
        step(dt) {
            ticks += 1;
            if (!engine) return;
            if (worker && m.time - beat > 1) {
                beat = m.time;
                tell({ kind: "beat" });
            }
            if (live()) {
                if (!paused) {
                    const now = engine.live_step(dt);
                    // a new attempt starts at the start, on fresh ground
                    if (now !== attempt) {
                        [attempt, distance] = [now, Math.max(distance, engine.live_best_distance())];
                        fresh();
                        last = undefined;
                    }
                }
            } else {
                if (here && !paused && ticks % 2 === 0) {
                    const before = engine.best_score();
                    engine.train(1);
                    [generation, runs] = [engine.generation(), engine.generation_runs()];
                    if (engine.best_score() > before) better = true;
                    if (better && !shown) {
                        engine.show_reset();
                        [shown, distance, better] = [true, Math.max(distance, engine.best_distance()), false];
                        crowd();
                    }
                }
                // nothing walks until there is a brain worth showing
                if (shown) engine.show_step(dt);
                if (showCrowd && shown && !endless()) engine.crowd_step(dt);
                // walking on endlessly, a better brain takes over at the next stride, with no start again;
                // not more often than every few seconds, so each one is seen walking
                if (endless() && shown && waiting && !engine.show_over() && m.time - swapped > SWAP_EVERY) {
                    write(engine, engine.weights_room(), waiting);
                    engine.weights_swap();
                    [waiting, swapped] = [undefined, m.time];
                }
                // at the end of its run, or a fall, the walker rests a moment, then starts again
                if (shown && engine.show_over()) {
                    ended += dt;
                    if (ended >= REST && !paused) {
                        ended = 0;
                        if (waiting) take(waiting);
                        else {
                            engine.show_reset();
                            fresh();
                            if (better) distance = Math.max(distance, engine.best_distance());
                        }
                        [waiting, better] = [undefined, false];
                        crowd();
                        last = undefined;
                    }
                }
                if (endless() && shown) distance = engine.show_distance();
            }
            origin = engine.show_origin();
            // the view follows the walker, gently, and its eyes look the way it moves
            const [x, y] = torso();
            layAhead(engine, x);
            camera.x += (x - camera.x) * Math.min(1, dt * 4);
            camera.y += ((heightAt(ground, x) ?? camera.y) - camera.y) * Math.min(1, dt * 2);
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
            const [wx, wy] = toWorld(x, y);
            const bodies = read(engine, engine.show_bodies(), 6 * engine.body_count());
            let near = Infinity;
            for (let i = 0; i < bodies.length; i += 6) near = Math.min(near, Math.hypot(bodies[i]! + origin - wx, bodies[i + 1]! - wy));
            grabbed = near < 0.7 ? { x: wx, y: wy } : undefined;
        },
        move(x, y) {
            if (!engine || !grabbed || !m.pointer.down) return;
            const [wx, wy] = toWorld(x, y);
            let [ix, iy] = [(wx - grabbed.x) * PUSH, (wy - grabbed.y) * PUSH];
            const size = Math.hypot(ix, iy);
            if (size > MOST_PUSH) [ix, iy] = [(ix * MOST_PUSH) / size, (iy * MOST_PUSH) / size];
            engine.show_push(wx - origin, wy, ix, iy);
            grabbed = { x: wx, y: wy };
        },
        release() {
            grabbed = undefined;
        },
        keydown(name) {
            if (!engine) return;
            const [x, y] = torso();
            const push = { left: [-10, 0], right: [10, 0], up: [0, 12], down: [0, -10], action: [10, 4] }[name];
            engine.show_push(x - origin, y + 0.05, push[0]!, push[1]!);
        },
        resting: () => !m.preview && paused && !!engine && (live() || engine.show_over() === 1),
        debug: () => [`${live() ? "learning live" : here ? "training on the page" : `training in ${helpers.length + 1} worker${helpers.length ? "s" : ""}, ${effort}`}, ${generation} generations, ${runs} runs, ${ground.length / 4} pieces of ground, moved back ${origin} m`],
        draw() {
            scale = Math.max(40, Math.min(m.height / 2.9, m.width / 3.8));
            drawGround();
            if (!engine) return;
            drawFlag();
            if (showCrowd && shown && !live() && !endless()) drawCrowd(engine);
            drawCreature(engine);
            if (grabbed && m.pointer.down) {
                const { ctx } = m;
                ctx.beginPath();
                ctx.arc(m.pointer.x, m.pointer.y, 5, 0, Math.PI * 2);
                ctx.strokeStyle = m.color("--accent");
                ctx.lineWidth = 2;
                ctx.stroke();
            }
            drawBrain();
            drawCourse();
        },
    };
}
