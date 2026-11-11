// Dice: a dice tower. Pick dice, or type a roll, and they go in at the top,
// tumble down the ramps as real solids and roll out into the tray. When they
// have come to rest the eye goes up over the tray and the number each one
// landed on lights up. The tumbling is in tower.ts; here it is drawn, by
// Mote's own 3D drawing (gl.ts), with the dice to pick from and a history
// under it.

import { gl, type Color, type Mark, type Part } from "../mote/gl";
import { block, nearness, normals, paint, spun, turned, upright, type Mesh, type Turn, type V3 } from "../mote/solids";
import { turn } from "../mote/space";
import type { Mote, Scene } from "../mote/stage";
import { read, total, type Roll } from "./rolls";
import { SHAPES, SLABS, TOWER, TRAY, throwDice, type Sides, type Slab, type Throw } from "./tower";

export const label = "A dice tower. Dice dropped in at the top tumble down its ramps into a tray.";

const HUES: Record<Sides, number> = { 4: 25, 6: 300, 8: 205, 10: 145, 12: 85, 20: 340 };
const hue = (sides: Sides) => `oklch(0.8 0.12 ${HUES[sides]})`;
const INK = "#1a1024";

/** A fair number from 0 to 1, from the browser's own source of chance. */
const chance = () => crypto.getRandomValues(new Uint32Array(1))[0]! / 2 ** 32;

/** A small helper for making elements. */
function el<K extends keyof HTMLElementTagNameMap>(tag: K, set: Partial<HTMLElementTagNameMap[K]> & { class?: string } = {}, ...inside: (Node | string)[]): HTMLElementTagNameMap[K] {
    const made = document.createElement(tag);
    const { class: name, ...rest } = set;
    if (name) made.className = name;
    Object.assign(made, rest);
    made.append(...inside);
    return made;
}

/** What is written on a die. A four-sided one has the number of each corner beside that corner, on every face. */
const written = (sides: Sides) => (face: number): string | Mark[] =>
    sides === 4 ? SHAPES[4].faces[face]!.map((corner, at): Mark => ({ word: String(corner + 1), group: corner + 1, corner: at })) : String(face + 1);
/** The group of marks that says what a die shows. */
const group = (sides: Sides, value: number) => (sides === 4 ? value : value - 1);

/** A die seen from straight above with its highest number on top, drawn small: what the buttons that pick dice show. */
function picture(sides: Sides, word: string, font: string): HTMLCanvasElement {
    const SIZE = 54;
    const canvas = el("canvas", { class: "dice-picture" });
    const scale = Math.min(window.devicePixelRatio || 1, 3);
    canvas.width = canvas.height = SIZE * scale;
    const ctx = canvas.getContext("2d")!;
    ctx.scale(scale, scale);
    const mesh: Mesh = SHAPES[sides];
    const top = mesh.faces.length - 1;
    // turned so that its last face, the highest number, faces the eye
    const out = normals(mesh)[top]!;
    const axis: V3 = Math.abs(out[2]) > 0.999 ? [1, 0, 0] : [out[1], -out[0], 0];
    const long = Math.hypot(...axis);
    const angle = Math.acos(Math.max(-1, Math.min(1, out[2])));
    let facing = spun(upright(), [(axis[0] / long) * angle, (axis[1] / long) * angle, (axis[2] / long) * angle]);
    // and round, so that one corner of that face points up (or, for a square, one side is level)
    const corners = mesh.faces[top]!.map((corner) => mesh.points[corner]!);
    const middle = corners.reduce((sum, corner) => [sum[0] + corner[0] / corners.length, sum[1] + corner[1] / corners.length, sum[2] + corner[2] / corners.length], [0, 0, 0]);
    const first = [0, 1].map((row) => facing[row]![0] * (corners[0]![0] - middle[0]!) + facing[row]![1] * (corners[0]![1] - middle[1]!) + facing[row]![2] * (corners[0]![2] - middle[2]!));
    facing = spun(facing, [0, 0, (corners.length === 4 && sides === 6 ? (Math.PI * 3) / 4 : Math.PI / 2) - Math.atan2(first[1]!, first[0]!)]);
    paint(ctx, mesh, facing, {
        x: SIZE / 2,
        y: SIZE / 2,
        size: (SIZE / 2 - 3) / Math.max(...mesh.points.map((point) => Math.hypot(...point))),
        distance: 30,
        fill: (light) => `oklch(${(0.5 + light * 0.36).toFixed(3)} 0.12 ${HUES[sides]})`,
        edge: `oklch(0.42 0.1 ${HUES[sides]})`,
    });
    ctx.fillStyle = INK;
    ctx.font = `700 ${word.length > 2 ? 13 : word.length > 1 ? 17 : 20}px ${font}`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(word, SIZE / 2, SIZE / 2 + 1);
    return canvas;
}

export default function dice(m: Mote): Scene {
    let thrown: Throw | undefined;
    let waiting: { roll: Roll; what: string } | undefined;
    let auto = 0;
    const font = getComputedStyle(m.canvas).fontFamily;

    // ---- the tower, drawn ----
    // Mote's own 3D drawing, on a second canvas under the one that takes the mouse. Where the browser
    // cannot do that, the same things are drawn flat on the first canvas, back to front.
    const under = document.createElement("canvas");
    under.className = "mote-gl";
    const view = gl(under);
    if (view) m.canvas.parentElement!.insertBefore(under, m.canvas);
    const tipped = (tip: number): Turn => [[Math.cos(tip), -Math.sin(tip), 0], [Math.sin(tip), Math.cos(tip), 0], [0, 0, 1]];
    const SEEN = { tray: "--surface", wall: "--rule", ramp: "--muted", glass: "--ink" } as const;
    const ground: Slab = { at: [(TRAY.left + TRAY.right) / 2, -0.1, 0], half: [(TRAY.right - TRAY.left) / 2, 0.1, TRAY.deep], tip: 0, kind: "tray" };
    const pieces = [ground, ...SLABS].filter((slab) => slab.kind !== "unseen");
    let models: { part: Part; color: Color; look: { color: Color } }[] = [];
    if (view) {
        view.font = font;
        for (const slab of pieces) {
            const kind = slab.kind as keyof typeof SEEN;
            const piece = view.add(block(slab.half), { color: view.color(m.color(SEEN[kind])), alpha: kind === "glass" ? 0.035 : 1, casts: kind === "ramp" || kind === "tray" });
            piece.at = slab.at;
            piece.turn = tipped(slab.tip);
        }
        view.light([7, 17, 10], [TRAY.left - 0.5, -0.5, -TRAY.deep - 0.5], [TRAY.right + 0.5, TOWER.top + 3, TRAY.deep + 0.5]);
    }

    // ---- the eye: beside the tower while the dice fall, then up over them once they have landed ----
    const BESIDE: [V3, V3] = [[9.5, 12, 22.5], [0.3, 4.9, 0]];
    let above: [V3, V3] = BESIDE;
    /** How far the eye has gone from beside to above, and how far the numbers are lit, each from 0 to 1. */
    let over = 0;
    let shine = 0;
    const landed = () => Boolean(thrown?.done());
    const wide = () => (m.width / Math.max(1, m.height) < 1.1 ? 30 / Math.max(0.55, m.width / Math.max(1, m.height) / 1.1) : 30);
    const aim = () => {
        if (!view) return;
        // eased, so that it sets off and arrives gently
        const t = over * over * (3 - 2 * over);
        const mix = (a: V3, b: V3): V3 => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
        view.look(mix(BESIDE[0], above[0]), mix(BESIDE[1], above[1]), wide() + (30 - wide()) * t);
    };

    const show = (next: Throw) => {
        for (const old of models) view?.remove(old.part);
        thrown = next;
        models = view
            ? next.dice.map((die) => {
                  const color = view.color(hue(die.sides));
                  const look = { color: [...color] as Color, marks: written(die.sides), ink: [0.1, 0.06, 0.14] as Color };
                  return { part: view.add(SHAPES[die.sides], look), color, look };
              })
            : [];
    };
    const fit = () => {
        view?.size(m.width, m.height);
        aim();
    };
    fit();

    // ---- what is kept between visits: the last rolls ----
    let history: { what: string; said: string; total: number }[] = [];
    try {
        history = JSON.parse(localStorage.getItem("mote:dice") ?? "[]") as typeof history;
    } catch {
        // Nothing kept, or storage is off.
    }

    // ---- rolling ----
    let said: HTMLElement | undefined;
    const say = (text: string) => {
        if (said) said.textContent = text;
    };
    let render = () => {};
    const send = (text: string, what = text) => {
        const roll = read(text);
        if (typeof roll === "string") return say(roll);
        show(throwDice(roll.dice, chance));
        waiting = { roll, what };
        say("Rolling…");
        m.wake();
    };
    const land = () => {
        if (!thrown) return;
        const values = thrown.values();
        // where the eye goes: over the middle of the dice, high enough to see them all with room around
        const xs = thrown.dice.map((die) => die.body.p[0]);
        const zs = thrown.dice.map((die) => die.body.p[2]);
        const [cx, cz] = [(Math.min(...xs) + Math.max(...xs)) / 2, (Math.min(...zs) + Math.max(...zs)) / 2];
        const [halfX, halfZ] = [(Math.max(...xs) - Math.min(...xs)) / 2 + 0.9, (Math.max(...zs) - Math.min(...zs)) / 2 + 0.9];
        const reach = Math.tan((15 * Math.PI) / 180);
        const high = Math.max(4.4, halfZ / reach, halfX / (reach * (m.width / Math.max(1, m.height))));
        // not quite straight above: a touch toward the front, so that the tray keeps its way up
        above = [[cx, high, cz + high * 0.1], [cx, 0.3, cz]];
        models.forEach((model, index) => {
            model.part.lit = group(thrown!.dice[index]!.sides, values[index]!);
        });
        if (!waiting) return;
        const { roll, what } = waiting;
        waiting = undefined;
        const result = total(roll, values);
        history = [{ what, said: result.said, total: result.total }, ...history].slice(0, 30);
        try {
            localStorage.setItem("mote:dice", JSON.stringify(history));
        } catch {
            // Not kept.
        }
        render();
        say(`${what}: ${result.total}`);
    };

    // ---- under the tower: the dice to pick from, a typed roll, and what was rolled ----
    if (!m.preview) {
        const panel = m.panel();
        const hand: Partial<Record<Sides | 100, number>> = {};
        const handText = () => Object.entries(hand).filter(([, count]) => count).map(([sides, count]) => `${count}d${sides}`).join(" + ");

        said = el("p", { class: "table-said", textContent: "Pick dice, or type a roll, and send them down the tower." });
        said.setAttribute("aria-live", "polite");
        const counts = new Map<number, HTMLElement>();
        const refresh = () => {
            for (const [sides, badge] of counts) {
                badge.textContent = hand[sides as Sides] ? String(hand[sides as Sides]) : "";
                badge.hidden = !hand[sides as Sides];
            }
            go.disabled = !handText();
        };
        // each die as it looks from above, with its highest number on top
        const picks = ([4, 6, 8, 10, 12, 20, 100] as const).map((sides) => {
            const badge = el("span", { class: "dice-count", hidden: true });
            counts.set(sides, badge);
            const pick = el("button", { type: "button", class: "dice-pick", onclick: () => { hand[sides] = Math.min(12, (hand[sides] ?? 0) + 1); refresh(); } }, picture(sides === 100 ? 10 : sides, String(sides), font), el("span", { class: "dice-name", textContent: `d${sides}` }), badge);
            pick.setAttribute("aria-label", `Add a d${sides}`);
            return pick;
        });
        const go = el("button", { type: "button", class: "dice-go", textContent: "roll", disabled: true, onclick: () => { const text = handText(); if (text) send(text); } });
        const clear = el("button", { type: "button", class: "quiet", textContent: "clear", onclick: () => { for (const key of Object.keys(hand)) delete hand[key as unknown as Sides]; refresh(); } });
        const typed = el("input", { type: "text", placeholder: "or type one: 2d6+3, 4d6 drop lowest, d20 adv", spellcheck: false });
        typed.setAttribute("aria-label", "A roll to make");
        const rollForm = el("form", { class: "table-typed", onsubmit: (event) => { event.preventDefault(); if (typed.value.trim()) send(typed.value.trim()); } }, typed, el("button", { type: "submit", textContent: "roll" }));
        const list = el("ol", { class: "table-history" });
        panel.append(said, el("div", { class: "dice-picks" }, ...picks), el("div", { class: "table-go" }, go, clear), rollForm, el("h2", { textContent: "rolls" }), list);
        render = () => {
            list.replaceChildren(...history.map((entry) => el("li", {}, el("strong", { textContent: String(entry.total) }), ` ${entry.what}`, el("span", { textContent: ` ${entry.said}` }))));
        };
        render();
    }

    return {
        step(dt) {
            // Shown small in a list, it rolls a few dice by itself now and then.
            if (m.preview && m.time - auto > 8) {
                auto = m.time;
                show(throwDice([20, 6, 8], chance));
            }
            if (thrown && !thrown.done()) {
                thrown.step(dt);
                if (thrown.done()) land();
            }
            // the eye goes up over the dice in a little under a second, and comes back faster; the numbers light as it arrives
            over = landed() ? Math.min(1, over + dt / 0.9) : Math.max(0, over - dt / 0.45);
            shine = landed() && over > 0.6 ? Math.min(1, shine + dt / 0.35) : landed() ? shine : 0;
        },
        resize: fit,
        // Clicking the tower sends a d20 down it.
        press() {
            if (!waiting) send("d20");
        },
        resting: () => !m.preview && (!thrown || (landed() && over === 1 && shine === 1)),
        draw() {
            if (view) {
                aim();
                thrown?.dice.forEach((die, index) => {
                    const { part, color, look } = models[index]!;
                    part.at = die.body.p;
                    part.turn = turn(die.body);
                    part.shine = shine;
                    // the die itself goes dimmer as its number lights, so that the number is what is bright
                    look.color = [color[0] * (1 - 0.4 * shine), color[1] * (1 - 0.4 * shine), color[2] * (1 - 0.4 * shine)];
                });
                view.draw();
                return;
            }
            // Flat, without the graphics card: everything back to front, each shaded by how it faces the light.
            const eye = turned(upright(), -0.42, 0.38);
            const flat = { x: m.width * 0.5, y: m.height * 0.78, size: Math.min(m.width / 14, m.height / 12), distance: 40, view: eye };
            const things = [
                ...pieces.filter((slab) => slab.kind !== "glass").map((slab) => ({ mesh: block(slab.half), at: slab.at, turn: tipped(slab.tip), sides: 0 as Sides | 0, css: m.color(SEEN[slab.kind as keyof typeof SEEN]) })),
                ...(thrown?.dice ?? []).map((die) => ({ mesh: SHAPES[die.sides], at: die.body.p, turn: turn(die.body), sides: die.sides as Sides | 0, css: "" })),
            ].sort((a, b) => nearness(a.at, eye) - nearness(b.at, eye));
            for (const thing of things) {
                paint(m.ctx, thing.mesh, thing.turn, {
                    ...flat,
                    at: thing.at,
                    fill: (light) => (thing.sides ? `oklch(${(0.45 + light * 0.4).toFixed(3)} 0.12 ${HUES[thing.sides]})` : `color-mix(in oklab, ${thing.css}, black ${Math.round((1 - light) * 45)}%)`),
                    label: thing.sides && thing.sides !== 4 ? (face) => String(face + 1) : undefined,
                    ink: INK,
                    font,
                });
            }
        },
    };
}
