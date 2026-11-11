// Table: a dice tower and what a game of D&D needs beside it. Dice go in at
// the top, tumble down the ramps as real solids and roll out into the tray;
// what they show is the roll. Under it: typed rolls with a history, and two
// views, one for whoever runs the fight and one for a single character.

import { paint, nearness, sheet, turned, upright, type Mesh, type Mote, type Scene, type V3 } from "../mote";
import { read, total, type Roll } from "./rolls";
import { OPENING, RAMPS, TOWER, TRAY, done, drop, move, shown, written, type Die, type Sides } from "./tower";

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
    let dice: Die[] = [];
    let waiting: { roll: Roll; what: string; then?: (sum: number) => void } | undefined;
    let auto = 0;

    // ---- the tower, drawn ----
    const view = turned(upright(), -0.62, 0.38);
    const middle: V3 = [0.4, 4.3, 0];
    const from = ([x, y, z]: V3): V3 => [x - middle[0], y - middle[1], z - middle[2]];
    const flat = (a: V3, b: V3, c: V3, d: V3) => sheet(from(a), from(b), from(c), from(d));
    const { left, right, deep, top } = TOWER;
    const high = top + 0.6;
    const behind: Mesh[] = [
        flat([TRAY.left, 0, -TRAY.deep], [TRAY.right, 0, -TRAY.deep], [TRAY.right, 0, TRAY.deep], [TRAY.left, 0, TRAY.deep]),
        flat([TRAY.left, 0, -TRAY.deep], [TRAY.right, 0, -TRAY.deep], [TRAY.right, 0.7, -TRAY.deep], [TRAY.left, 0.7, -TRAY.deep]),
        flat([TRAY.left, 0, -TRAY.deep], [TRAY.left, 0, TRAY.deep], [TRAY.left, 0.7, TRAY.deep], [TRAY.left, 0.7, -TRAY.deep]),
        flat([left, 0, -deep], [right, 0, -deep], [right, high, -deep], [left, high, -deep]),
        flat([left, 0, -deep], [left, 0, deep], [left, high, deep], [left, high, -deep]),
    ];
    const ramps = RAMPS.map(([a, b]) => flat([a[0], a[1], -deep], [b[0], b[1], -deep], [b[0], b[1], deep], [a[0], a[1], deep]));
    const front = [
        flat([right, OPENING, -deep], [right, OPENING, deep], [right, high, deep], [right, high, -deep]),
        flat([TRAY.right, 0, -TRAY.deep], [TRAY.right, 0, TRAY.deep], [TRAY.right, 0.7, TRAY.deep], [TRAY.right, 0.7, -TRAY.deep]),
        flat([TRAY.left, 0, TRAY.deep], [TRAY.right, 0, TRAY.deep], [TRAY.right, 0.7, TRAY.deep], [TRAY.left, 0.7, TRAY.deep]),
    ];

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
    const throwDice = (text: string, what = text, then?: (sum: number) => void) => {
        const roll = read(text);
        if (typeof roll === "string") return say(roll);
        dice = drop(roll.dice, chance);
        waiting = { roll, what, then };
        say("Rolling…");
        m.wake();
    };
    const land = () => {
        if (!waiting) return;
        const { roll, what, then } = waiting;
        waiting = undefined;
        const result = total(roll, dice.map(shown));
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
        const rollForm = el("form", { class: "table-typed", onsubmit: (event) => { event.preventDefault(); if (typed.value.trim()) throwDice(typed.value.trim()); } }, typed, el("button", { type: "submit", textContent: "roll" }));
        const history = el("ol", { class: "table-history" });
        const board = el("div", { class: "table-board" });
        const tabs = (["fight", "character"] as const).map((view) =>
            el("button", { type: "button", textContent: view, onclick: () => { state.view = view; keep(); render(); } }),
        );

        panel.append(
            said,
            el("div", { class: "table-dice" }, ...dieButtons, mode(" adv", "advantage"), mode(" dis", "disadvantage")),
            el("div", { class: "table-go" }, inHand,
                el("button", { type: "button", textContent: "roll these", onclick: () => { const text = handText(); if (text) throwDice(text); } }),
                el("button", { type: "button", class: "quiet", textContent: "clear", onclick: () => { for (const key of Object.keys(hand)) delete hand[key as unknown as Sides]; twenty = ""; inHand.textContent = ""; } }),
            ),
            rollForm,
            el("div", { class: "table-tabs" }, ...tabs),
            board,
            el("h3", { textContent: "rolls" }),
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
                                el("button", { type: "button", class: "quiet", textContent: "roll it", onclick: () => throwDice("d20", `${fighter.name}'s initiative`, (sum) => { fighter.init = sum; }) }),
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
                        el("button", { type: "button", class: "quiet", textContent: "roll one", onclick: () => throwDice("d20", "death save", (sum) => { if (sum >= 10) me.passed = Math.min(3, me.passed + 1); else me.failed = Math.min(3, me.failed + 1); }) })),
                    conditions(me.conditions),
                    el("h3", { textContent: "my rolls" }),
                    el("ul", { class: "table-saved" }, ...me.rolls.map((saved) => el("li", {},
                        el("button", { type: "button", textContent: saved.label, onclick: () => throwDice(saved.roll, saved.label) }), ` ${saved.roll} `,
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
            if (m.preview && m.time - auto > 6) {
                auto = m.time;
                dice = drop([20, 6, 8], chance);
            }
            if (dice.length === 0 || done(dice)) return;
            move(dice, dt);
            if (done(dice)) land();
        },
        // Clicking the tower sends a d20 down it.
        press() {
            if (!waiting) throwDice("d20");
        },
        resting: () => !m.preview && (dice.length === 0 || done(dice)),
        draw() {
            const { ctx } = m;
            const size = Math.min(m.width / 12.5, m.height / 11.5);
            const look = { x: m.width / 2, y: m.height / 2, size, distance: 34, view, both: true, edge: m.color("--rule") };
            const wall = m.color("--surface");
            for (const piece of behind) paint(ctx, piece, upright(), { ...look, fill: () => wall });
            // ramps and dice together, the furthest first
            const things = [
                ...ramps.map((mesh, index) => ({ depth: nearness(from([(RAMPS[index]![0][0] + RAMPS[index]![1][0]) / 2, (RAMPS[index]![0][1] + RAMPS[index]![1][1]) / 2 - 0.4, 0]), view), draw: () => paint(ctx, mesh, upright(), { ...look, fill: () => m.color("--rule") }) })),
                ...dice.map((die) => ({
                    depth: nearness(from(die.at), view),
                    draw: () => paint(ctx, die.mesh, die.turn, {
                        ...look, both: false, at: from(die.at), edge: m.color("--ground"),
                        fill: (light) => `oklch(${(0.42 + light * 0.46).toFixed(3)} 0.13 ${HUES[die.sides]})`,
                        label: written, ink: m.color("--ground"), font: m.font(10).split("px ")[1],
                    }),
                })),
            ].sort((a, b) => a.depth - b.depth);
            for (const thing of things) thing.draw();
            ctx.globalAlpha = 0.28;
            for (const piece of front) paint(ctx, piece, upright(), { ...look, fill: () => wall });
            ctx.globalAlpha = 1;
        },
    };
}
