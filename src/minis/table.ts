// Table: a dice tower and what a game of D&D needs beside it. Dice go in at
// the top, tumble down the ramps as real solids and roll out into the tray;
// what they show is the roll. The tumbling is in tower.ts; here it is drawn,
// with depth, light and shadow, by Mote's own 3D drawing (gl.ts). Under it: typed rolls with a history, and two
// views, one for whoever runs the fight and one for a single character.

import type { Mote, Scene } from "../mote/stage";
import { gl, type Part } from "../mote/gl";
import { block, nearness, paint, turned, upright, type Turn } from "../mote/solids";
import { turn } from "../mote/space";
import { read, total, type Roll } from "./rolls";
import { SHAPES, SLABS, TOWER, TRAY, throwDice, type Sides, type Slab, type Throw } from "./tower";

export const label = "A dice tower. Dice dropped in at the top tumble down its ramps into a tray.";

const CONDITIONS = ["blinded", "charmed", "deafened", "exhaustion", "frightened", "grappled", "incapacitated", "invisible", "paralyzed", "petrified", "poisoned", "prone", "restrained", "stunned", "unconscious"];
const HUES: Record<Sides, number> = { 4: 25, 6: 300, 8: 205, 10: 145, 12: 85, 20: 340 };

interface Fighter {
    id: number;
    name: string;
    init: number;
    hp: number;
    max: number;
    conditions: string[];
}

interface State {
    view: "fight" | "character";
    fighters: Fighter[];
    turn: number;
    round: number;
    me: { name: string; hp: number; max: number; temp: number; conditions: string[]; passed: number; failed: number; rolls: { label: string; roll: string }[] };
    history: { what: string; said: string; total: number }[];
}

const fresh = (): State => ({
    view: "fight",
    fighters: [],
    turn: 0,
    round: 1,
    me: { name: "", hp: 10, max: 10, temp: 0, conditions: [], passed: 0, failed: 0, rolls: [{ label: "attack", roll: "d20+5" }, { label: "damage", roll: "1d8+3" }] },
    history: [],
});

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

export default function table(m: Mote): Scene {
    let thrown: Throw | undefined;
    let waiting: { roll: Roll; what: string; then?: (sum: number) => void } | undefined;
    let auto = 0;

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
    const hue = (sides: Sides) => `oklch(0.8 0.12 ${HUES[sides]})`;
    let models: Part[] = [];
    if (view) {
        view.font = getComputedStyle(m.canvas).fontFamily;
        for (const slab of pieces) {
            const kind = slab.kind as keyof typeof SEEN;
            const piece = view.add(block(slab.half), { color: view.color(m.color(SEEN[kind])), alpha: kind === "glass" ? 0.035 : 1, casts: kind === "ramp" || kind === "tray" });
            piece.at = slab.at;
            piece.turn = tipped(slab.tip);
        }
        view.light([7, 17, 10], [TRAY.left - 0.5, -0.5, -TRAY.deep - 0.5], [TRAY.right + 0.5, TOWER.top + 3, TRAY.deep + 0.5]);
    }
    const show = (next: Throw) => {
        for (const old of models) view?.remove(old);
        thrown = next;
        models = view ? next.dice.map((die) => view.add(SHAPES[die.sides], { color: view.color(hue(die.sides)), marks: (face) => String(face + 1), ink: [0.1, 0.06, 0.14] })) : [];
    };
    const fit = () => {
        if (!view) return;
        view.size(m.width, m.height);
        // On a tall, narrow box the eye steps back so that the whole tower still fits.
        const aspect = m.width / Math.max(1, m.height);
        view.look([9.5, 12, 22.5], [0.3, 4.9, 0], aspect < 1.1 ? 30 / Math.max(0.55, aspect / 1.1) : 30);
    };
    fit();

    // ---- what is kept between visits ----
    let state = fresh();
    try {
        state = { ...fresh(), ...(JSON.parse(localStorage.getItem("mote:table") ?? "{}") as Partial<State>) };
    } catch {
        // Nothing kept, or storage is off.
    }
    const keep = () => {
        try {
            localStorage.setItem("mote:table", JSON.stringify(state));
        } catch {
            // Not kept.
        }
    };

    // ---- rolling ----
    let said: HTMLElement | undefined;
    const say = (text: string) => {
        if (said) said.textContent = text;
    };
    const send = (text: string, what = text, then?: (sum: number) => void) => {
        const roll = read(text);
        if (typeof roll === "string") return say(roll);
        show(throwDice(roll.dice, chance));
        waiting = { roll, what, then };
        say("Rolling…");
        m.wake();
    };
    const land = () => {
        if (!waiting) return;
        const { roll, what, then } = waiting;
        waiting = undefined;
        const result = total(roll, thrown!.values());
        state.history = [{ what, said: result.said, total: result.total }, ...state.history].slice(0, 30);
        then?.(result.total);
        keep();
        render();
        say(`${what}: ${result.total}`);
    };

    // ---- the controls under the tower ----
    let render = () => {};
    if (!m.preview) {
        const panel = m.panel();
        const hand: Partial<Record<Sides | 100, number>> = {};
        let twenty: "" | " adv" | " dis" = "";
        const handText = () => Object.entries(hand).filter(([, count]) => count).map(([sides, count]) => `${count}d${sides}${sides === "20" ? twenty : ""}`).join(" + ");

        said = el("p", { class: "table-said", textContent: "Add dice, or type a roll, and send them down the tower." });
        said.setAttribute("aria-live", "polite");
        const inHand = el("span", { class: "table-hand" });
        const dieButtons = ([4, 6, 8, 10, 12, 20, 100] as const).map((sides) =>
            el("button", { type: "button", textContent: `d${sides}`, onclick: () => { hand[sides] = Math.min(12, (hand[sides] ?? 0) + 1); inHand.textContent = handText(); } }),
        );
        const mode = (word: "" | " adv" | " dis", text: string) =>
            el("button", { type: "button", class: "quiet", textContent: text, onclick: () => { twenty = twenty === word ? "" : word; if (!hand[20]) hand[20] = 1; inHand.textContent = handText(); } });
        const typed = el("input", { type: "text", placeholder: "2d6+3, 4d6 drop lowest, d20 adv", spellcheck: false });
        typed.setAttribute("aria-label", "A roll to make");
        const rollForm = el("form", { class: "table-typed", onsubmit: (event) => { event.preventDefault(); if (typed.value.trim()) send(typed.value.trim()); } }, typed, el("button", { type: "submit", textContent: "roll" }));
        const history = el("ol", { class: "table-history" });
        const board = el("div", { class: "table-board" });
        const tabs = (["fight", "character"] as const).map((view) =>
            el("button", { type: "button", textContent: view, onclick: () => { state.view = view; keep(); render(); } }),
        );

        panel.append(
            said,
            el("div", { class: "table-dice" }, ...dieButtons, mode(" adv", "advantage"), mode(" dis", "disadvantage")),
            el("div", { class: "table-go" }, inHand,
                el("button", { type: "button", textContent: "roll these", onclick: () => { const text = handText(); if (text) send(text); } }),
                el("button", { type: "button", class: "quiet", textContent: "clear", onclick: () => { for (const key of Object.keys(hand)) delete hand[key as unknown as Sides]; twenty = ""; inHand.textContent = ""; } }),
            ),
            rollForm,
            el("div", { class: "table-tabs" }, ...tabs),
            board,
            el("h2", { textContent: "rolls" }),
            history,
        );

        /** The row of conditions for someone, as switches. */
        const conditions = (has: string[]) =>
            el("div", { class: "table-conditions" }, ...CONDITIONS.map((name) => {
                const chip = el("button", { type: "button", textContent: name, onclick: () => { has.includes(name) ? has.splice(has.indexOf(name), 1) : has.push(name); keep(); render(); } });
                chip.setAttribute("aria-pressed", String(has.includes(name)));
                return chip;
            }));
        const number = (value: number, set: (value: number) => void, name: string) => {
            const box = el("input", { type: "number", value: String(value), onchange: () => { set(Number(box.value) || 0); keep(); render(); } });
            box.setAttribute("aria-label", name);
            return box;
        };
        /** Hit points with a box for an amount and buttons to take it off or put it back. */
        const points = (who: { hp: number; max: number }) => {
            const amount = el("input", { type: "number", value: "1", min: "0" });
            amount.setAttribute("aria-label", "How much");
            const change = (by: number) => { who.hp = Math.max(0, Math.min(who.max, who.hp + by * (Number(amount.value) || 0))); keep(); render(); };
            return el("div", { class: "table-points" },
                el("strong", { textContent: `${who.hp} / ` }), number(who.max, (value) => { who.max = Math.max(1, value); who.hp = Math.min(who.hp, who.max); }, "Most hit points"),
                amount, el("button", { type: "button", textContent: "damage", onclick: () => change(-1) }), el("button", { type: "button", textContent: "heal", onclick: () => change(1) }));
        };

        render = () => {
            tabs.forEach((tab) => tab.setAttribute("aria-pressed", String(tab.textContent === state.view)));
            history.replaceChildren(...state.history.map((entry) => el("li", {}, el("strong", { textContent: String(entry.total) }), ` ${entry.what}`, el("span", { textContent: ` ${entry.said}` }))));
            if (state.view === "fight") {
                const name = el("input", { type: "text", placeholder: "name" });
                name.setAttribute("aria-label", "Name");
                const add = el("form", { class: "table-add", onsubmit: (event) => {
                    event.preventDefault();
                    if (!name.value.trim()) return;
                    state.fighters.push({ id: Date.now(), name: name.value.trim(), init: 0, hp: 10, max: 10, conditions: [] });
                    keep(); render();
                } }, name, el("button", { type: "submit", textContent: "add to the fight" }));
                const sorted = state.fighters.toSorted((a, b) => b.init - a.init);
                const now = sorted[state.turn % Math.max(1, sorted.length)];
                board.replaceChildren(
                    el("div", { class: "table-round" },
                        el("strong", { textContent: `round ${state.round}` }),
                        el("button", { type: "button", textContent: "next turn", onclick: () => { state.turn++; if (state.turn >= sorted.length) { state.turn = 0; state.round++; } keep(); render(); } }),
                        el("button", { type: "button", class: "quiet", textContent: "new fight", onclick: () => { state.fighters = []; state.turn = 0; state.round = 1; keep(); render(); } })),
                    el("ol", { class: "table-fighters" }, ...sorted.map((fighter) => {
                        const row = el("li", {},
                            el("div", { class: "table-who" },
                                el("strong", { textContent: fighter.name }),
                                el("label", {}, "initiative ", number(fighter.init, (value) => { fighter.init = value; }, `${fighter.name}'s initiative`)),
                                el("button", { type: "button", class: "quiet", textContent: "roll it", onclick: () => send("d20", `${fighter.name}'s initiative`, (sum) => { fighter.init = sum; }) }),
                                el("button", { type: "button", class: "quiet", textContent: "remove", onclick: () => { state.fighters = state.fighters.filter((other) => other !== fighter); keep(); render(); } })),
                            points(fighter), conditions(fighter.conditions));
                        if (fighter === now) row.setAttribute("aria-current", "true");
                        return row;
                    })),
                    add,
                );
            } else {
                const me = state.me;
                const called = el("input", { type: "text", value: me.name, placeholder: "character's name", onchange: () => { me.name = called.value; keep(); } });
                called.setAttribute("aria-label", "Character's name");
                const saves = (kind: "passed" | "failed") => el("span", {}, `${kind} `, ...[1, 2, 3].map((count) => {
                    const pip = el("button", { type: "button", class: "pip", onclick: () => { me[kind] = me[kind] === count ? count - 1 : count; keep(); render(); } });
                    pip.setAttribute("aria-pressed", String(me[kind] >= count));
                    pip.setAttribute("aria-label", `${count} ${kind}`);
                    return pip;
                }));
                const what = el("input", { type: "text", placeholder: "what for" });
                const how = el("input", { type: "text", placeholder: "d20+5" });
                what.setAttribute("aria-label", "What the roll is for");
                how.setAttribute("aria-label", "The roll");
                board.replaceChildren(
                    called, points(me),
                    el("label", { class: "table-temp" }, "temporary ", number(me.temp, (value) => { me.temp = Math.max(0, value); }, "Temporary hit points")),
                    el("div", { class: "table-saves" }, el("strong", { textContent: "death saves " }), saves("passed"), saves("failed"),
                        el("button", { type: "button", class: "quiet", textContent: "roll one", onclick: () => send("d20", "death save", (sum) => { if (sum >= 10) me.passed = Math.min(3, me.passed + 1); else me.failed = Math.min(3, me.failed + 1); }) })),
                    conditions(me.conditions),
                    el("h2", { textContent: "my rolls" }),
                    el("ul", { class: "table-saved" }, ...me.rolls.map((saved) => el("li", {},
                        el("button", { type: "button", textContent: saved.label, onclick: () => send(saved.roll, saved.label) }), ` ${saved.roll} `,
                        el("button", { type: "button", class: "quiet", textContent: "remove", onclick: () => { me.rolls = me.rolls.filter((other) => other !== saved); keep(); render(); } })))),
                    el("form", { class: "table-add", onsubmit: (event) => {
                        event.preventDefault();
                        if (!what.value.trim() || typeof read(how.value) === "string") return say(typeof read(how.value) === "string" ? (read(how.value) as string) : "Say what the roll is for.");
                        me.rolls.push({ label: what.value.trim(), roll: how.value.trim() });
                        keep(); render();
                    } }, what, how, el("button", { type: "submit", textContent: "keep this roll" })),
                );
            }
        };
        render();
    }

    return {
        step(dt) {
            // Shown small in a list, it rolls a few dice by itself now and then.
            if (m.preview && m.time - auto > 7) {
                auto = m.time;
                show(throwDice([20, 6, 8], chance));
            }
            if (!thrown || thrown.done()) return;
            thrown.step(dt);
            if (thrown.done()) land();
        },
        resize: fit,
        // Clicking the tower sends a d20 down it.
        press() {
            if (!waiting) send("d20");
        },
        resting: () => !m.preview && (!thrown || thrown.done()),
        draw() {
            if (view) {
                thrown?.dice.forEach((die, index) => {
                    models[index]!.at = die.body.p;
                    models[index]!.turn = turn(die.body);
                });
                view.draw();
                return;
            }
            // Flat, without the graphics card: everything back to front, each shaded by how it faces the light.
            const eye = turned(upright(), -0.42, 0.38);
            const look = { x: m.width * 0.52, y: m.height * 0.78, size: Math.min(m.width / 13, m.height / 12), distance: 40, view: eye };
            const things = [
                ...pieces.filter((slab) => slab.kind !== "glass").map((slab) => ({ mesh: block(slab.half), at: slab.at, turn: tipped(slab.tip), css: m.color(SEEN[slab.kind as keyof typeof SEEN]), sides: 0 })),
                ...(thrown?.dice ?? []).map((die) => ({ mesh: SHAPES[die.sides], at: die.body.p, turn: turn(die.body), css: hue(die.sides), sides: die.sides })),
            ].sort((a, b) => nearness(a.at, eye) - nearness(b.at, eye));
            for (const thing of things) {
                paint(m.ctx, thing.mesh, thing.turn, {
                    ...look,
                    at: thing.at,
                    fill: (light) => `color-mix(in oklab, ${thing.css}, black ${Math.round((1 - light) * 45)}%)`,
                    label: thing.sides ? (face) => String(face + 1) : undefined,
                    ink: "#1a1024",
                    font: getComputedStyle(m.canvas).fontFamily,
                });
            }
        },
    };
}
