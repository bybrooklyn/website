// Walker: a creature, seen from the side, that learns to walk in the visitor's browser. Evolution
// runs in a worker (src/scripts/walker-worker.ts) on its own copy of the Rust engine; this page runs
// a second copy to show the best walker so far, a whole generation faintly behind it, and its brain
// thinking. The ground's controls are in a strip along the bottom, the rest in a column at the side.
// What the engine does is in walker/README.md, and what this and the worker share is in walking.ts.

import { el, type Mote, type Scene } from "../mote/stage";
import type { Order, Report } from "../scripts/walker-worker";
import { ENGINE, KINDS, LEGS, POPULATION, SECONDS, decode, encode, heightAt, pieces, read, start, write, type Engine, type Ground, type Kind, type Legs } from "./walking";

export const label = "A creature with legs, seen from the side, learning to walk by evolution. Faint copies of a whole generation walk behind the best one.";

interface Setup {
    legs: Legs;
    ground: Ground;
}

const DEFAULT: Setup = { legs: 2, ground: { kind: "flat", rough: 30 } };
/** How hard a drag pushes, in newton seconds for each metre dragged, and the most one move can give. */
const PUSH = 25;
const MOST_PUSH = 12;

const valid = (setup: Partial<Setup> | undefined): setup is Setup =>
    !!setup && LEGS.includes(setup.legs as Legs) && KINDS.includes(setup.ground?.kind as Kind) && Number.isFinite(setup.ground?.rough);

export default function walker(m: Mote): Scene {
    const kept = m.recall<Setup>("walker", DEFAULT);
    let setup: Setup = valid(kept) ? kept : DEFAULT;

    // opened from a link to a walker: its body, its ground, and its trained brain
    const linkedLegs = Number(m.link.get("legs")) as Legs;
    const linkedKind = m.link.get("ground") as Kind;
    const linkedBrain = decode(m.link.get("brain") ?? "");
    const linked: Setup = { legs: linkedLegs, ground: { kind: linkedKind, rough: Number(m.link.get("rough") ?? 30) } };
    let brainToLoad: Float32Array | undefined;
    if (linkedBrain && valid(linked)) [setup, brainToLoad] = [linked, linkedBrain];

    let engine: Engine | undefined;
    let worker: Worker | undefined;
    /** Training on this thread instead, where a worker could not be started. */
    let here = false;
    let id = 0;
    let ground = pieces(setup.ground);
    let generation = 0;
    let runs = 0;
    let distance = 0;
    let paused = false;
    let showCrowd = true;
    let showBrain = !m.preview;
    /** What the status line says for a while after something changed, and until when. */
    let notice = { text: brainToLoad ? "A shared walker, already trained. Learning goes on from it." : "", until: 6 };
    /** A better brain from the worker, waiting for the walker shown to finish its run. */
    let waiting: Float32Array | undefined;
    let better = false;
    let shownScore = -Infinity;
    let population: Float32Array | undefined;
    let haveBrain = false;
    let fallenFor = 0;
    let beat = 0;
    let ticks = 0;
    const camera = { x: 0, y: 0 };
    /** Where a drag on the walker last was, in metres. */
    let grabbed: { x: number; y: number } | undefined;

    // ---- the engine, on this page and in the worker ----
    const begin = (brain?: Float32Array) => {
        id += 1;
        ground = pieces(setup.ground);
        [generation, runs, distance, waiting, better, shownScore, population, haveBrain, fallenFor] = [0, 0, 0, undefined, false, -Infinity, undefined, false, 0];
        const seed = (Math.random() * 2 ** 32) >>> 0;
        if (engine) {
            engine.create(setup.legs, POPULATION, SECONDS, seed, 12, 1, 0);
            write(engine, engine.ground_room(ground.length / 4), ground);
            engine.ground_set(ground.length / 4);
            if (brain) {
                write(engine, engine.weights_room(), brain);
                engine.weights_load();
                haveBrain = true;
                shownScore = engine.best_score();
            }
            engine.show_reset();
            // the worker starts from the same seed, so its first generation is this one
            engine.crowd_reset();
            camera.x = 0;
            camera.y = 0;
        }
        tell({ kind: "begin", setup: id, legs: setup.legs, ground, seed, brain });
        changed();
        m.wake();
    };

    const tell = (order: Order) => worker?.postMessage(order);

    const hear = (report: Report) => {
        if (report.kind === "failed") return trainHere();
        if (report.setup !== id) return;
        [generation, runs, distance] = [report.generation, report.runs, report.distance];
        if (report.brain) waiting = report.brain;
        if (report.population) population = report.population;
        changed();
    };

    /** No worker: training goes on here, a run at a time between steps. */
    const trainHere = () => {
        worker?.terminate();
        worker = undefined;
        if (here) return;
        here = true;
        begin();
    };

    try {
        worker = new Worker(new URL("../scripts/walker-worker.ts", import.meta.url), { type: "module" });
        worker.onmessage = (event: MessageEvent<Report>) => hear(event.data);
        worker.onerror = () => trainHere();
    } catch {
        here = true;
    }

    void fetch(ENGINE)
        .then((answer) => answer.arrayBuffer())
        .then(start)
        .then((made) => {
            engine = made;
            begin(brainToLoad);
        });

    // ---- the controls: the ground along the bottom, the rest at the side ----
    let changed = () => {};
    if (!m.preview) {
        const host = m.canvas.parentElement!;
        const side = m.panel();
        side.classList.add("walker-side");
        const strip = el("div", { class: "mote-panel walker-ground" });
        host.insertBefore(strip, side);

        const said = el("p", { class: "walker-said" });
        said.setAttribute("aria-live", "polite");
        const count = el("output", { class: "walker-count" });

        /** A row of choices that look like buttons: real radio inputs, so arrow keys move between them. */
        const choices = <T extends string | number>(name: string, words: string, options: T[], chosen: () => T, pick: (value: T) => void) => {
            const set = el("fieldset", { class: "walker-choices" }, el("legend", { textContent: words }));
            for (const option of options) {
                const input = el("input", { type: "radio", name: `walker-${name}`, value: String(option), checked: option === chosen(), onchange: () => input.checked && pick(option) });
                set.append(el("label", {}, input, el("span", { textContent: String(option) })));
            }
            return set;
        };
        const restart = (words: string) => {
            m.keep("walker", setup);
            // a link to a shared walker no longer says what is on the screen
            for (const name of ["brain", "legs", "ground", "rough"]) m.link.set(name, null);
            notice = { text: words, until: m.time + 5 };
            begin();
        };
        const describe = () => `${setup.legs} leg${setup.legs === 1 ? "" : "s"} on ${setup.ground.kind === "flat" ? "flat ground" : setup.ground.kind}`;

        const rough = el("input", { type: "range", min: "0", max: "100", step: "5", value: String(setup.ground.rough) });
        rough.addEventListener("change", () => {
            setup = { ...setup, ground: { ...setup.ground, rough: Number(rough.value) } };
            restart(`Learning again from the start: ${describe()}, ${rough.value} rough.`);
        });
        strip.append(
            choices("ground", "ground", KINDS, () => setup.ground.kind, (kind) => {
                setup = { ...setup, ground: { ...setup.ground, kind } };
                restart(`Learning again from the start: ${describe()}.`);
            }),
            el("label", { class: "walker-rough" }, el("span", { textContent: "how rough" }), rough),
        );

        const pause = el("button", { type: "button", textContent: "pause learning", onclick: () => {
            paused = !paused;
            tell({ kind: paused ? "pause" : "resume" });
            changed();
            m.wake();
        } });
        const tick = (words: string, on: () => boolean, set: (value: boolean) => void) => {
            const input = el("input", { type: "checkbox", checked: on(), onchange: () => {
                set(input.checked);
                m.wake();
            } });
            return el("label", {}, input, words);
        };
        const share = el("button", { type: "button", class: "walker-share", textContent: "copy link to this walker", disabled: true, onclick: () => {
            if (!engine) return;
            m.link.set("legs", String(setup.legs));
            m.link.set("ground", setup.ground.kind);
            m.link.set("rough", String(setup.ground.rough));
            const address = m.link.set("brain", encode(read(engine, engine.show_weights(), engine.weights_length())));
            navigator.clipboard?.writeText(address).then(() => (share.textContent = "link copied"), () => (share.textContent = "the link is in the address bar"));
            setTimeout(() => (share.textContent = "copy link to this walker"), 2500);
        } });
        side.append(
            said,
            el("p", { class: "walker-generations" }, count, el("span", { textContent: " generations" })),
            choices("legs", "legs", LEGS, () => setup.legs, (legs) => {
                setup = { ...setup, legs };
                restart(`Learning again from the start: ${describe()}.`);
            }),
            el("div", { class: "walker-buttons" }, pause, el("button", { type: "button", textContent: "start over", onclick: () => restart(`Learning again from the start: ${describe()}.`) })),
            el("fieldset", { class: "walker-show" }, el("legend", { textContent: "show" }), tick("the crowd", () => showCrowd, (value) => {
                showCrowd = value;
                crowd();
            }), tick("the brain", () => showBrain, (value) => (showBrain = value))),
            share,
        );

        let lastSaid = "";
        changed = () => {
            count.value = String(generation);
            pause.textContent = paused ? "resume learning" : "pause learning";
            share.disabled = !haveBrain;
            const words = !engine ? "Loading the walker." : paused ? `Learning is paused at generation ${generation}.` : generation === 0 ? `Trying the first generation: ${runs} of ${POPULATION}.` : `Generation ${generation}. The best has walked ${distance.toFixed(1)} m.`;
            // said aloud only when it is more than a count going up
            const aloud = m.time < notice.until ? notice.text : words;
            if (aloud !== lastSaid && (generation % 10 === 0 || aloud === notice.text || paused)) said.textContent = lastSaid = aloud;
            else if (said.textContent === "") said.textContent = aloud;
        };
    }

    // ---- drawing ----
    let shapes: ArrayLike<number> = [];
    // a canvas cannot read the page's font settings, so the code face's name is looked up once
    const code = getComputedStyle(m.canvas).getPropertyValue("--font-code").trim() || "monospace";
    let scale = 100;
    const toScreen = (x: number, y: number): [number, number] => [(x - camera.x) * scale + m.width * 0.42, m.height * 0.76 - (y - camera.y) * scale];
    const toWorld = (sx: number, sy: number): [number, number] => [(sx - m.width * 0.42) / scale + camera.x, (m.height * 0.76 - sy) / scale + camera.y];

    /** Draws one body given its place and turn, with its shape from the show's list. */
    const body = (index: number, x: number, y: number, angle: number) => {
        const { ctx } = m;
        const [kind, a, b] = [shapes[index * 6 + 3]!, shapes[index * 6 + 4]!, shapes[index * 6 + 5]!];
        const [sx, sy] = toScreen(x, y);
        ctx.save();
        ctx.translate(sx, sy);
        ctx.rotate(-angle);
        ctx.beginPath();
        if (kind === 0) {
            ctx.arc(0, 0, a * scale, 0, Math.PI * 2);
            ctx.fill();
        } else if (kind === 1) {
            ctx.lineWidth = 2 * b * scale;
            ctx.lineCap = "round";
            ctx.moveTo(-a * scale, 0);
            ctx.lineTo(a * scale, 0);
            ctx.stroke();
        } else {
            ctx.roundRect(-a * scale, -b * scale, 2 * a * scale, 2 * b * scale, Math.min(a, b) * scale * 0.5);
            ctx.fill();
        }
        ctx.restore();
    };
    /** Which bodies are far legs, drawn behind the torso: every second leg's two parts. */
    const far = (index: number) => index > 0 && setup.legs > 1 && Math.floor((index - 1) / 2) % 2 === 1;

    const drawGround = () => {
        const { ctx } = m;
        const [left] = toWorld(0, 0);
        const [right] = toWorld(m.width, 0);
        ctx.fillStyle = m.color("--surface");
        ctx.strokeStyle = m.color("--muted");
        ctx.lineWidth = 2;
        ctx.lineCap = "round";
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
        ctx.fill(fill);
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
            ctx.fillRect(sx - 0.5, sy + 3, 1, x % 5 === 0 ? 8 : 4);
            if (x % 5 === 0) ctx.fillText(x === 0 ? "start" : `${x} m`, sx, sy + 13);
        }
    };

    const drawBrain = (engine: Engine) => {
        const { ctx } = m;
        const inputs = read(engine, engine.show_senses(), engine.senses_length());
        const hidden = read(engine, engine.show_hidden(), engine.hidden_length());
        const outputs = read(engine, engine.show_outputs(), engine.outputs_length());
        const weights = read(engine, engine.show_weights(), engine.weights_length());
        const narrow = m.width < 560;
        const wide = narrow ? Math.min(200, m.width * 0.5) : Math.min(250, m.width * 0.36);
        const high = Math.min(narrow ? 130 : 170, m.height * 0.32);
        const [left, top] = [m.width - wide - 14, narrow && !m.preview ? 66 : 16];
        const columns = [inputs, hidden, outputs];
        const place = (column: number, row: number): [number, number] => {
            const count = columns[column]!.length;
            const gap = Math.min(high / Math.max(1, count - 1), 12);
            return [left + (column * wide) / 2, top + high / 2 + (row - (count - 1) / 2) * gap];
        };
        const accent = m.color("--accent");
        const muted = m.color("--muted");
        // a line is as bright as what passes along it: its weight times what its neuron gave
        const line = (from: [number, number], to: [number, number], amount: number) => {
            ctx.globalAlpha = Math.min(0.85, Math.abs(amount) * 0.5);
            if (ctx.globalAlpha < 0.03) return;
            ctx.strokeStyle = amount > 0 ? accent : muted;
            ctx.beginPath();
            ctx.moveTo(...from);
            ctx.lineTo(...to);
            ctx.stroke();
        };
        ctx.lineWidth = 1;
        const [n, h, o] = [inputs.length, hidden.length, outputs.length];
        for (let j = 0; j < h; j++) for (let i = 0; i < n; i++) line(place(0, i), place(1, j), weights[j * n + i]! * inputs[i]!);
        const second = h * (n + 1);
        for (let k = 0; k < o; k++) for (let j = 0; j < h; j++) line(place(1, j), place(2, k), weights[second + k * h + j]! * hidden[j]!);
        ctx.globalAlpha = 1;
        columns.forEach((values, column) => {
            values.forEach((value, row) => {
                const [x, y] = place(column, row);
                ctx.beginPath();
                ctx.arc(x, y, column === 1 ? 3.5 : 3, 0, Math.PI * 2);
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
        ctx.textBaseline = "top";
        ctx.textAlign = "left";
        ctx.fillText("senses", left - 4, top + high + 10);
        ctx.textAlign = "right";
        ctx.fillText("joints", left + wide + 4, top + high + 10);
    };

    /** Starts the latest generation walking from the start, beside the best as it starts again. */
    const crowd = () => {
        if (!engine || !showCrowd) return;
        if (population && !here) {
            write(engine, engine.crowd_room(POPULATION), population);
            engine.crowd_start(POPULATION);
        } else engine.crowd_reset();
    };

    const torso = () => (engine ? read(engine, engine.show_bodies(), 2) : new Float32Array(2));

    return {
        step(dt) {
            ticks += 1;
            if (!engine) return;
            if (worker && m.time - beat > 1) {
                beat = m.time;
                tell({ kind: "beat" });
            }
            if (here && !paused && ticks % 2 === 0) {
                engine.train(1);
                [generation, runs, distance] = [engine.generation(), engine.generation_runs(), engine.best_distance()];
                if (engine.best_score() > shownScore) better = true;
                if (ticks % 30 === 0) changed();
            }
            engine.show_step(dt);
            const seconds = engine.show_seconds();
            fallenFor = engine.show_fallen() ? fallenFor + dt : 0;
            // a better walker waits for the one shown to finish its run, or to fall
            if ((waiting || better) && (seconds >= SECONDS || fallenFor > 0.7)) {
                if (waiting) {
                    write(engine, engine.weights_room(), waiting);
                    engine.weights_load();
                } else engine.show_reset();
                shownScore = engine.best_score();
                [waiting, better, haveBrain] = [undefined, false, true];
                crowd();
                changed();
            } else if (!paused && (seconds >= SECONDS + 4 || fallenFor > 1.5)) {
                engine.show_reset();
                crowd();
            }
            if (showCrowd) engine.crowd_step(dt);
            // the view follows the walker, gently
            const [x] = torso();
            camera.x += (x! - camera.x) * Math.min(1, dt * 4);
            camera.y += ((heightAt(ground, x!) ?? camera.y) - camera.y) * Math.min(1, dt * 2);
            if (notice.text && m.time > notice.until && m.time - dt <= notice.until) changed();
        },
        press(x, y) {
            if (!engine) return;
            const [wx, wy] = toWorld(x, y);
            const bodies = read(engine, engine.show_bodies(), 6 * engine.body_count());
            let near = Infinity;
            for (let i = 0; i < bodies.length; i += 6) near = Math.min(near, Math.hypot(bodies[i]! - wx, bodies[i + 1]! - wy));
            grabbed = near < 0.7 ? { x: wx, y: wy } : undefined;
        },
        move(x, y) {
            if (!engine || !grabbed || !m.pointer.down) return;
            const [wx, wy] = toWorld(x, y);
            let [ix, iy] = [(wx - grabbed.x) * PUSH, (wy - grabbed.y) * PUSH];
            const size = Math.hypot(ix, iy);
            if (size > MOST_PUSH) [ix, iy] = [(ix * MOST_PUSH) / size, (iy * MOST_PUSH) / size];
            engine.show_push(wx, wy, ix, iy);
            grabbed = { x: wx, y: wy };
        },
        release() {
            grabbed = undefined;
        },
        keydown(name) {
            if (!engine) return;
            const [x, y] = torso();
            const push = { left: [-10, 0], right: [10, 0], up: [0, 12], down: [0, -10], action: [10, 4] }[name];
            engine.show_push(x!, y! + 0.05, push[0]!, push[1]!);
        },
        resting: () => !m.preview && paused && !!engine && engine.show_seconds() > SECONDS + 3,
        debug: () => [`${here ? "training on the page" : "training in a worker"}, ${generation} generations, ${runs} runs`],
        draw() {
            const { ctx } = m;
            scale = Math.max(40, Math.min(m.height / 4, m.width / 4.6));
            drawGround();
            if (!engine) return;
            const bodies = read(engine, engine.show_bodies(), 6 * engine.body_count());
            shapes = bodies;
            const count = bodies.length / 6;
            const muted = m.color("--muted");
            // the generation, faint, behind the best
            if (showCrowd) {
                const crowd = read(engine, engine.crowd_bodies(), POPULATION * count * 3);
                ctx.globalAlpha = 0.1;
                ctx.fillStyle = ctx.strokeStyle = muted;
                for (let i = 0; i + 2 < crowd.length; i += 3) body((i / 3) % count, crowd[i]!, crowd[i + 1]!, crowd[i + 2]!);
                ctx.globalAlpha = 1;
            }
            // the best: its far legs behind, the torso, then its near legs in front
            const draw = (index: number, color: string) => {
                ctx.fillStyle = ctx.strokeStyle = color;
                body(index, bodies[index * 6]!, bodies[index * 6 + 1]!, bodies[index * 6 + 2]!);
            };
            for (let i = 1; i < count; i++) if (far(i)) draw(i, muted);
            draw(0, m.color("--accent"));
            for (let i = 1; i < count; i++) if (!far(i)) draw(i, m.color("--ink"));
            if (grabbed && m.pointer.down) {
                ctx.beginPath();
                ctx.arc(m.pointer.x, m.pointer.y, 5, 0, Math.PI * 2);
                ctx.strokeStyle = m.color("--accent");
                ctx.lineWidth = 2;
                ctx.stroke();
            }
            if (showBrain) drawBrain(engine);
            if (m.preview) return;
            // the status line, top left, kept clear of the brain
            ctx.fillStyle = m.color("--ink");
            ctx.font = `600 14px ${code}`;
            ctx.textAlign = "left";
            ctx.textBaseline = "top";
            const room = m.width - (showBrain && m.width >= 560 ? Math.min(250, m.width * 0.36) + 40 : 28);
            ctx.fillText(generation === 0 ? `generation 0, ${runs} of ${POPULATION} tried` : `generation ${generation}, best walked ${distance.toFixed(1)} m`, 14, 14, room);
            ctx.fillStyle = muted;
            ctx.font = `12px ${code}`;
            ctx.fillText(`this one: ${engine.show_distance().toFixed(1)} m${paused ? ", learning paused" : ""}`, 14, 34, room);
            if (m.time < notice.until && notice.text) ctx.fillText(notice.text, 14, 52, room);
        },
    };
}
