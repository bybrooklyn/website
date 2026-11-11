// Table: a dice tower and what a game of D&D needs beside it. Dice go in at
// the top, tumble down the ramps as real solids and roll out into the tray;
// what they show is the roll. The tumbling is in tower.ts; here it is drawn,
// with depth, light and shadow, by Mote's fork of three. Under it: typed rolls with a history, and two
// views, one for whoever runs the fight and one for a single character.

import type { Mote, Scene } from "../mote/stage";
import { normals, type Mesh } from "../mote/three";
import * as THREE from "../mote/forks/three/three.module.js";
import { read, total, type Roll } from "./rolls";
import { SHAPES, SLABS, TRAY, throwDice, type Sides, type Throw } from "./tower";

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
    const host = m.canvas.parentElement!;
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.shadowMap.enabled = true;
    renderer.domElement.className = "mote-gl";
    host.insertBefore(renderer.domElement, m.canvas);
    /** One of the page's colors, as three wants it: the page gives it in a form three cannot read, so a canvas reads it first. */
    const probe = document.createElement("canvas").getContext("2d", { willReadFrequently: true })!;
    const color = (css: string) => {
        probe.clearRect(0, 0, 1, 1);
        probe.fillStyle = css;
        probe.fillRect(0, 0, 1, 1);
        const [r, g, b] = probe.getImageData(0, 0, 1, 1).data;
        return new THREE.Color(`rgb(${r}, ${g}, ${b})`);
    };
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(30, 1, 0.1, 100);
    camera.position.set(8.5, 10.5, 19);
    camera.lookAt(-0.6, 3.9, 0);
    scene.add(new THREE.HemisphereLight(0xffffff, color(m.color("--ground")), 1.5));
    const sun = new THREE.DirectionalLight(0xffffff, 2.4);
    sun.position.set(6, 16, 9);
    sun.castShadow = true;
    sun.shadow.mapSize.set(1024, 1024);
    Object.assign(sun.shadow.camera, { left: -9, right: 9, top: 13, bottom: -3, near: 1, far: 40 });
    sun.shadow.bias = -0.0015;
    scene.add(sun);

    const paints = {
        tray: new THREE.MeshStandardMaterial({ color: color(m.color("--surface")), roughness: 0.9 }),
        wall: new THREE.MeshStandardMaterial({ color: color(m.color("--rule")), roughness: 0.85 }),
        ramp: new THREE.MeshStandardMaterial({ color: color(m.color("--muted")), roughness: 0.7 }),
        glass: new THREE.MeshStandardMaterial({ color: color(m.color("--ink")), transparent: true, opacity: 0.07, depthWrite: false }),
    };
    const floor = new THREE.Mesh(new THREE.BoxGeometry(TRAY.right - TRAY.left, 0.2, TRAY.deep * 2), paints.tray);
    floor.position.set((TRAY.left + TRAY.right) / 2, -0.1, 0);
    floor.receiveShadow = true;
    scene.add(floor);
    for (const slab of SLABS) {
        if (slab.kind === "unseen") continue;
        const piece = new THREE.Mesh(new THREE.BoxGeometry(slab.half[0] * 2, slab.half[1] * 2, slab.half[2] * 2), paints[slab.kind]);
        piece.position.set(...slab.at);
        piece.rotation.z = slab.tip;
        piece.receiveShadow = slab.kind !== "glass";
        piece.castShadow = slab.kind === "ramp" || slab.kind === "tray";
        scene.add(piece);
    }

    /** A number, as a picture to put on a die's face. Each is made once. */
    const numbers = new Map<string, THREE.CanvasTexture>();
    const number = (text: string) => {
        let made = numbers.get(text);
        if (!made) {
            const pad = document.createElement("canvas");
            pad.width = pad.height = 128;
            const pen = pad.getContext("2d")!;
            pen.font = m.font(text.length > 1 ? 74 : 88, 700);
            pen.textAlign = "center";
            pen.textBaseline = "middle";
            pen.fillStyle = "#1a1024";
            pen.fillText(text, 64, 70);
            // a line under 6 and 9, so that they can be told apart
            if (text === "6" || text === "9") pen.fillRect(40, 108, 48, 7);
            made = new THREE.CanvasTexture(pad);
            made.colorSpace = THREE.SRGBColorSpace;
            numbers.set(text, made);
        }
        return made;
    };
    /** A die to look at: its faces, flat-shaded in its own color, with a number on each. */
    const model = (sides: Sides): THREE.Mesh => {
        const mesh: Mesh = SHAPES[sides];
        const corners: number[] = [];
        for (const face of mesh.faces) for (let index = 1; index < face.length - 1; index++) for (const corner of [face[0]!, face[index]!, face[index + 1]!]) corners.push(...mesh.points[corner]!);
        const shape = new THREE.BufferGeometry();
        shape.setAttribute("position", new THREE.Float32BufferAttribute(corners, 3));
        shape.computeVertexNormals();
        const die = new THREE.Mesh(shape, new THREE.MeshStandardMaterial({ color: color(`oklch(0.8 0.12 ${HUES[sides]})`), roughness: 0.45, flatShading: true }));
        die.castShadow = true;
        die.receiveShadow = true;
        normals(mesh).forEach((out, index) => {
            const face = mesh.faces[index]!;
            const middle = face.reduce((sum, corner) => sum.add(new THREE.Vector3(...mesh.points[corner]!)), new THREE.Vector3()).divideScalar(face.length);
            // as big as the face allows: a little under the distance from its middle to its nearest edge
            const room = Math.min(...face.map((corner, at) => {
                const [a, b] = [new THREE.Vector3(...mesh.points[corner]!), new THREE.Vector3(...mesh.points[face[(at + 1) % face.length]!]!)];
                return new THREE.Line3(a, b).closestPointToPoint(middle, true, new THREE.Vector3()).distanceTo(middle);
            }));
            const mark = new THREE.Mesh(new THREE.PlaneGeometry(room * 1.5, room * 1.5), new THREE.MeshBasicMaterial({ map: number(String(index + 1)), transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 }));
            mark.position.copy(middle).addScaledVector(new THREE.Vector3(...out), 0.004);
            mark.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), new THREE.Vector3(...out));
            die.add(mark);
        });
        return die;
    };
    let models: THREE.Mesh[] = [];
    const show = (next: Throw) => {
        for (const old of models) scene.remove(old);
        thrown = next;
        models = next.dice.map((die) => model(die.sides));
        scene.add(...models);
    };
    const fit = () => {
        renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
        renderer.setSize(m.width, m.height, false);
        camera.aspect = m.width / Math.max(1, m.height);
        // On a tall, narrow box the camera steps back so that the whole tower still fits.
        camera.fov = camera.aspect < 1.1 ? 30 / Math.max(0.55, camera.aspect / 1.1) : 30;
        camera.updateProjectionMatrix();
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
            thrown?.dice.forEach((die, index) => {
                models[index]!.position.set(die.body.position.x, die.body.position.y, die.body.position.z);
                models[index]!.quaternion.set(die.body.quaternion.x, die.body.quaternion.y, die.body.quaternion.z, die.body.quaternion.w);
            });
            renderer.render(scene, camera);
        },
    };
}
