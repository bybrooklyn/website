// The sand mini, as stage 2 of docs/sand.md leaves it: a box of every material in the engine's table,
// each a button, poured with the pointer, drawn plainly. The engine is the Rust crate in sand/, built to WebAssembly
// (grains.ts). Its cells are drawn through Mote's grid (src/mote/cells.ts), read straight out of the
// engine's memory, only the rows that changed. The world steps sixty times a second while anything in
// it moves or a pointer is pouring, and rests otherwise, as Mote does when out of sight.

import { cells, cellUnder, fitted, type Place } from "../mote/cells";
import { el, type Mote, type Scene } from "../mote/stage";
import { engineAddress, fillOf, materials, start, STEPS_PER_SECOND, worldFor, type Engine, type Material } from "./grains";

export const label = "A box of sand, water, fire, lava and more, poured with the pointer.";

export default function sand(m: Mote): Scene {
    // the cells are drawn on a second canvas under the one that takes the pointer, as Dice's tower is
    const under = document.createElement("canvas");
    under.className = "mote-gl";
    const grid = cells(under);
    if (grid) m.canvas.parentElement!.insertBefore(under, m.canvas);

    let engine: Engine | undefined;
    let bytes: Uint8Array | undefined;
    let at: Place | undefined;
    /** What the brush pours; undefined while it erases. */
    let poured: Material | undefined;
    let radius = 4;
    let paused = false;
    /** The cell under the pointer while it is held down. */
    let held: [number, number] | undefined;
    let owed = 0;
    /** Every row is sent on the next draw: the grid was placed anew. */
    let whole = true;

    /** Device pixels to a CSS pixel, as Mote sized its canvas. */
    const ratio = () => (m.width > 0 ? m.canvas.width / m.width : window.devicePixelRatio || 1);
    const fit = () => {
        under.width = m.canvas.width;
        under.height = m.canvas.height;
        if (!engine || !grid) return;
        at = fitted(under.width, under.height, engine.width(), engine.height());
        grid.place(at);
        whole = true;
    };

    const stroke = (from: [number, number], to: [number, number]) => {
        if (!engine) return;
        if (poured) engine.paint(poured.number, from[0], from[1], to[0], to[1], radius, fillOf(poured.kind), 0);
        else engine.paint(0, from[0], from[1], to[0], to[1], radius, 100, 0);
    };

    const panel = (offered: Material[]) => {
        const box = m.panel();
        const choices = el("div", { class: "table-go" });
        const buttons: HTMLButtonElement[] = [];
        const choose = (material: Material | undefined, chosen: HTMLButtonElement) => {
            poured = material;
            for (const button of buttons) {
                button.classList.toggle("quiet", button !== chosen);
                button.setAttribute("aria-pressed", String(button === chosen));
            }
        };
        for (const material of [...offered, undefined]) {
            const button = el("button", { type: "button", textContent: material?.name ?? "erase", onclick: () => choose(material, button) });
            buttons.push(button);
            choices.append(button);
        }
        choose(offered[0], buttons[0]!);
        const size = el("input", { type: "range", min: "0", max: "24", step: "1", value: String(radius), oninput: () => (radius = Number(size.value)) });
        size.setAttribute("aria-label", "brush size");
        const pause = el("button", {
            type: "button",
            class: "quiet",
            textContent: "pause",
            onclick: () => {
                paused = !paused;
                pause.textContent = paused ? "go on" : "pause";
                m.wake();
            },
        });
        const once = el("button", {
            type: "button",
            class: "quiet",
            textContent: "step",
            onclick: () => {
                paused = true;
                pause.textContent = "go on";
                engine?.step(1);
                m.wake();
            },
        });
        const empty = el("button", {
            type: "button",
            class: "quiet",
            textContent: "clear",
            onclick: () => {
                engine?.clear();
                m.wake();
            },
        });
        box.append(choices, el("div", { class: "table-go" }, el("label", {}, "brush ", size), pause, once, empty));
    };

    void fetch(engineAddress())
        .then((answer) => answer.arrayBuffer())
        .then(start)
        .then((made) => {
            const { columns, rows } = worldFor(m.width, m.height, ratio());
            if (!made.create(columns, rows, (Math.random() * 2 ** 32) >>> 0, 0)) return;
            engine = made;
            // memory grows only in `create`, so these views stay good from here on
            bytes = new Uint8Array(made.memory.buffer, made.cells(), made.stride() * (rows + 2 * made.border()) * 4);
            grid?.palette(new Uint8Array(made.memory.buffer, made.palette(), 2048));
            fit();
            if (!m.preview) panel(materials(made));
            m.wake();
        });

    return {
        step(dt) {
            if (!engine || paused) return;
            owed += dt;
            while (owed >= 1 / STEPS_PER_SECOND - 1e-6) {
                owed -= 1 / STEPS_PER_SECOND;
                // a pointer held still keeps pouring
                if (held) stroke(held, held);
                engine.step(1);
            }
        },
        draw() {
            if (engine && grid && bytes && at) {
                const [from, to] = whole ? [0, at.rows - 1] : [engine.changed_from(), engine.changed_to()];
                grid.draw(bytes, engine.stride(), engine.border(), from, from < 0 ? -1 : to);
                engine.forget_changed();
                whole = false;
            }
            if (held && at) {
                // how wide the brush is, while pouring
                m.ctx.beginPath();
                m.ctx.arc(m.pointer.x, m.pointer.y, Math.max(2, ((radius + 0.5) * at.scale) / ratio()), 0, Math.PI * 2);
                m.ctx.strokeStyle = m.color("--muted");
                m.ctx.lineWidth = 1;
                m.ctx.stroke();
            }
            if (!grid) {
                m.ctx.fillStyle = m.color("--muted");
                m.ctx.textAlign = "center";
                m.ctx.fillText("This needs a browser with WebGL 2.", m.width / 2, m.height / 2);
            }
        },
        resize: fit,
        press(x, y) {
            if (!at) return;
            held = cellUnder(x, y, at, ratio());
            stroke(held, held);
        },
        move(x, y) {
            if (!held || !at || !m.pointer.down) return;
            const next = cellUnder(x, y, at, ratio());
            stroke(held, next);
            held = next;
        },
        release() {
            held = undefined;
        },
        resting: () => !engine || (!held && (paused || engine.awake() === 0)),
        debug: () => (engine ? [`steps ${engine.steps()}`, `awake chunks ${engine.awake()}`, `world ${engine.width()} by ${engine.height()}`] : []),
        destroy() {
            grid?.dispose();
            under.remove();
        },
    };
}
