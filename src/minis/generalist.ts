// Generalist: a creature, seen from the side, that sees and learns its way through a world the visitor
// makes. A second mini on the Walker's engine (walker/README.md, "The generalist").
//
// The world is made from a recipe: a seed (a word or a number), how hard, and how much of each kind
// of thing, each with a switch. The recipe is kept in the address, so a world is a link. The creature
// learns by evolution, as the Walker does, in workers (src/scripts/generalist-worker.ts), each with
// its own copy of the engine; this page runs one more copy that shows the best brain so far walking
// the world, from the start, playing back the very run it was scored on. Its rays can be drawn, faint,
// so a visitor sees what it sees. It can be picked up and dropped, or pushed.
//
// The controls are in a column at the side, in the panel style the minis use. What this and the
// worker share is in roaming.ts.

import { el, type Mote, type Scene } from "../mote/stage";
import type { Order, Report } from "../scripts/generalist-worker";
import { BRAIN, DEFAULT_RECIPE, KINDS, LEGS, POPULATION, SECONDS, SEEN, anotherSeed, engineAddress, engineRecipe, fromLink, linkParts, list, start as startEngine, valid, type Engine, type Kind, type Recipe } from "./roaming";
import { EFFORTS, machine, workersFor, type Effort } from "./walking";

export const label = "A little creature with legs, seen from the side, finding its way over gaps, ledges, water and boxes in a world made from a seed. Faint lines from its eye show what it sees.";

/** How long the creature rests where its run ended before starting again, in seconds. */
const REST = 1;
/** The world is made this far ahead of what is drawn, in metres. */
const AHEAD = 40;
/** How hard a drag on a box or a leg pushes, in newton seconds for each metre dragged, and the most one move gives. */
const PUSH = 25;
const MOST_PUSH = 12;
/** How near the body a press must be to pick the creature up, in metres. */
const GRAB = 0.6;

export default function generalist(m: Mote): Scene {
    const kept = m.recall<Recipe>("generalist", DEFAULT_RECIPE, 1);
    let recipe: Recipe = fromLink((name) => m.link.get(name), valid(kept) ? kept : DEFAULT_RECIPE) ?? (valid(kept) ? kept : DEFAULT_RECIPE);
    let effort: Effort = m.recall<Effort>("walker-effort", "normal");
    if (!EFFORTS.some((each) => each.effort === effort)) effort = "normal";
    let showRays = m.recall<boolean>("generalist-rays", true);

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
    /** What the pointer has: the creature, held; or a body being pushed, by where it was last. */
    let holding = false;
    let pushing: { x: number; y: number } | undefined;
    let notice = { text: "", until: 0 };

    const tell = (order: Order) => worker?.postMessage(order);

    /** The world's lists as far as `until`, read again from where they were left. */
    const extend = (until: number) => {
        if (!engine || until <= reached) return;
        const more = list(engine, engine.land_ground(until + AHEAD, ground.length / 4));
        ground.push(...more);
        blocks.push(...list(engine, engine.land_blocks(blocks.length / 4)));
        hazards.push(...list(engine, engine.land_hazards(hazards.length / 5)));
        reached = until + AHEAD;
    };

    const begin = () => {
        id += 1;
        [generation, runs, waiting, shown, furthest, ended] = [0, 0, undefined, false, 0, 0];
        const { seed, difficulty, amounts } = engineRecipe(recipe);
        const brainSeed = (Math.random() * 2 ** 32) >>> 0;
        if (engine) {
            engine.create(recipe.legs, seed, difficulty, ...amounts, POPULATION, BRAIN.hidden, BRAIN.layers, BRAIN.memory, SECONDS, brainSeed);
            [ground, blocks, hazards, reached] = [[], [], [], 0];
            extend(20);
            angles = list(engine, engine.ray_angles());
            [camera.x, camera.y, last, holding, pushing] = [0, 0.5, undefined, false, undefined];
        }
        made = { kind: "begin", setup: id, legs: recipe.legs, seed, difficulty, amounts, brainSeed };
        tell(made);
        for (const helper of helpers) helper.postMessage(made);
        tell({ kind: paused ? "pause" : "resume" });
        changed();
        m.wake();
    };

    /** Puts a brain on show, from the start. */
    const take = (brain: Float32Array) => {
        if (!engine || brain.length !== engine.weights_length()) return;
        new Float32Array(engine.memory.buffer, engine.weights_room(), brain.length).set(brain);
        engine.weights_load();
        [shown, furthest] = [true, Math.max(furthest, engine.best_distance())];
        last = undefined;
    };

    const hear = (report: Report) => {
        if (report.kind === "failed") return learnHere();
        if (report.setup !== id) return;
        [generation, runs] = [report.generation, report.runs];
        if (report.brain) waiting = report.brain;
        if (waiting && !shown) {
            take(waiting);
            waiting = undefined;
        }
        changed();
    };

    const hire = () => new Worker(new URL("../scripts/generalist-worker.ts", import.meta.url), { type: "module" });

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
            if (made) helper.postMessage(made);
            ports.push(channel.port1);
            helpers.push(helper);
        }
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

    if (!m.preview) {
        try {
            worker = hire();
            worker.onmessage = (event: MessageEvent<Report>) => hear(event.data);
            worker.onerror = () => learnHere();
            staff(workersFor(effort, machine()) - 1);
        } catch {
            here = true;
        }
    } else here = true;

    void fetch(engineAddress())
        .then((answer) => answer.arrayBuffer())
        .then(startEngine)
        .then((started) => {
            engine = started;
            if (m.debug) Object.assign(globalThis, { generalistEngine: started });
            begin();
        });

    // ---- the controls, in a column at the side ----
    let changed = () => {};
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
        const restart = () => {
            m.keep("generalist", recipe, 1);
            for (const [name, value] of linkParts(recipe)) m.link.set(name, value);
            notice = { text: `Learning again from the start: ${describe()}.`, until: m.time + 5 };
            said.textContent = notice.text;
            begin();
        };
        const set = (change: Partial<Recipe>) => {
            recipe = { ...recipe, ...change };
            restart();
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
        const efforts = choices<Effort>("effort", "how hard learning works the computer", EFFORTS.map((each) => ({ value: each.effort, text: each.text })), () => effort, (chosen) => {
            effort = chosen;
            m.keep("walker-effort", effort);
            staff(workersFor(effort, machine()) - 1);
        });

        side.append(
            group("world"),
            ...row("seed", seed, another),
            ...row("how hard", hard.holder),
            ...kinds.flat(),
            group("body"),
            ...row("legs", legs),
            ...row("eyes", el("label", {}, rays, "show what it sees")),
            group("learning"),
            ...row("learning", pause, el("button", { type: "button", textContent: "start over", onclick: restart })),
            ...row("effort", efforts),
        );
        // the world is a link from the first, so the address always says which world this is
        for (const [name, value] of linkParts(recipe)) m.link.set(name, value);

        changed = () => {
            pause.textContent = paused ? "resume" : "pause";
            const now = !engine ? "Loading." : !shown ? `Generation 0, ${runs} of ${POPULATION} tried` : `Generation ${generation}, furthest ${furthest.toFixed(1)} m`;
            const text = m.time < notice.until && notice.text ? notice.text : `${now}${paused ? ", paused" : ""}`;
            if (status.textContent !== text) status.textContent = text;
        };
    }

    // ---- drawing ----
    const code = getComputedStyle(m.canvas).getPropertyValue("--font-code").trim() || "monospace";
    let scale = 100;
    const horizon = () => m.height * 0.7;
    const toScreen = (x: number, y: number): [number, number] => [(x - camera.x) * scale + m.width * 0.38, horizon() - (y - camera.y) * scale];
    const toWorld = (sx: number, sy: number): [number, number] => [(sx - m.width * 0.38) / scale + camera.x, (horizon() - sy) / scale + camera.y];
    const seen = (left: number, right: number, a: number, b: number) => Math.max(a, b) >= left - 1 && Math.min(a, b) <= right + 1;

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
            if (here && !m.preview && !paused && ticks % 2 === 0) {
                const before = engine.best_score();
                engine.train(1);
                [generation, runs] = [engine.generation(), engine.generation_runs()];
                if (engine.best_score() > before && !shown) {
                    engine.show_reset();
                    [shown, furthest] = [true, engine.best_distance()];
                }
            }
            if (shown || holding) engine.show_step(dt);
            // at the end of its run the creature rests a moment, then starts again, with a better brain if there is one
            if (shown && engine.show_over() && !holding) {
                ended += dt;
                if (ended >= REST && !paused) {
                    ended = 0;
                    if (waiting) take(waiting);
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
            const [wx, wy] = toWorld(x, y);
            const [tx, ty] = torso();
            if (Math.hypot(tx - wx, ty - wy) < GRAB) {
                holding = true;
                engine.show_hold(wx, wy);
                return;
            }
            pushing = { x: wx, y: wy };
        },
        move(x, y) {
            if (!engine || !m.pointer.down) return;
            const [wx, wy] = toWorld(x, y);
            if (holding) {
                engine.show_hold(wx, wy);
                return;
            }
            if (!pushing) return;
            let [ix, iy] = [(wx - pushing.x) * PUSH, (wy - pushing.y) * PUSH];
            const size = Math.hypot(ix, iy);
            if (size > MOST_PUSH) [ix, iy] = [(ix * MOST_PUSH) / size, (iy * MOST_PUSH) / size];
            engine.show_push(wx, wy, ix, iy);
            pushing = { x: wx, y: wy };
        },
        release() {
            if (holding) engine?.show_drop();
            [holding, pushing] = [false, undefined];
        },
        keydown(name) {
            if (!engine) return;
            const [x, y] = torso();
            const push = { left: [-10, 0], right: [10, 0], up: [0, 12], down: [0, -10], action: [10, 4] }[name];
            engine.show_push(x, y + 0.05, push[0]!, push[1]!);
        },
        resting: () => !m.preview && paused && !!engine && engine.show_over() === 1,
        debug: () => [`${here ? "learning on the page" : `learning in ${helpers.length + 1} workers, ${effort}`}, generation ${generation}, ${ground.length / 4} pieces of ground made to ${reached.toFixed(0)} m`],
        draw() {
            // about eight metres across, so what is coming can be seen as well as the creature
            scale = Math.max(34, Math.min(m.height / 4.2, m.width / 8));
            drawWorld();
            if (!engine) return;
            drawFlag();
            drawThings(engine);
            if (showRays && (shown || holding)) drawRays(engine);
            drawCreature(engine);
            if ((holding || pushing) && m.pointer.down) {
                const { ctx } = m;
                ctx.beginPath();
                ctx.arc(m.pointer.x, m.pointer.y, 5, 0, Math.PI * 2);
                ctx.strokeStyle = m.color("--accent");
                ctx.lineWidth = 2;
                ctx.stroke();
            }
        },
    };
}
