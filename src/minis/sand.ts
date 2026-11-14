// The sand mini: a box of every material in the engine's table, poured with the pointer or a finger.
// The engine is the Rust crate in sand/, built to WebAssembly (grains.ts). Its cells are drawn through
// Mote's grid (src/mote/cells.ts), read straight out of the engine's memory, only the rows that
// changed, with fire, lava and burning wood giving light and smoke and steam drawn softly.
//
// Under it, a row of the materials, each a little square of itself as the engine colors it; pride
// sand opens to the flags (flags.ts), poured in stripes or laid as a whole flag. Then the brush's
// size, pause, step, clear (undone once), and a link to the world as it is (worlds.ts), or a file
// when it is too large for one. The world steps sixty times a second while anything in it moves or
// a pointer is pouring, and rests otherwise, as Mote does when out of sight.

import { cells, cellUnder, fitted, type Place } from "../mote/cells";
import { el, type Mote, type Scene } from "../mote/stage";
import { copyText } from "../scripts/copy";
import { colorRow, FLAGS, place as stripesOf } from "./flags";
import { engineAddress, fillOf, flagSize, inRow, KEYS, materials, start, STEPS_PER_SECOND, swatchColor, worldFor, type Engine, type Material } from "./grains";
import { LINK_MOST, MOST_TEXT, pack, tokensOf, unpack, writeTokens, type Opened } from "./worlds";

export const label = "A box of sand, water, fire, lava and more, poured with the pointer.";

/** The brush's size: how many cells either side of the line it pours. */
const SIZES = { least: 0, most: 24, first: 4 };
/** How long a pointer must stay in one cell before pride sand pours there as from a brush held still, in seconds. */
const STOPPED = 0.2;
/** How long a button's word says what it did, in milliseconds. */
const SAID = 2500;

export default function sand(m: Mote): Scene {
    // the cells are drawn on a second canvas under the one that takes the pointer, as Dice's tower is
    const under = document.createElement("canvas");
    under.className = "mote-gl";
    const grid = cells(under);
    if (grid) m.canvas.parentElement!.insertBefore(under, m.canvas);

    let engine: Engine | undefined;
    let bytes: Uint8Array | undefined;
    let palette: Uint8Array | undefined;
    let at: Place | undefined;
    let offered: Material[] = [];
    /** What the brush pours; undefined while it erases. */
    let poured: Material | undefined;
    /** Which flag pride sand is poured in, and whether the brush lays it whole. */
    let flag = 0;
    let whole = false;
    let radius = SIZES.first;
    let paused = false;
    /** The cell under the pointer while it is held down, and whether a flag has been laid in this press. */
    let held: [number, number] | undefined;
    let laid = false;
    /** When the pointer last moved to another cell while held, in the mini's seconds. */
    let moved = -1;
    let owed = 0;
    /** Every row is sent on the next draw: the grid was placed anew. */
    let fresh = true;
    /** The world as it was before it was cleared, until the next stroke: what "undo clear" puts back. */
    let cleared: Uint8Array | undefined;
    /** The last pointer to press or move was the first finger or the mouse, and what kind it was. */
    let primary = true;
    let pointerKind = "mouse";
    let render = () => {};

    /** Device pixels to a CSS pixel, as Mote sized its canvas. */
    const ratio = () => (m.width > 0 ? m.canvas.width / m.width : window.devicePixelRatio || 1);
    const fit = () => {
        under.width = m.canvas.width;
        under.height = m.canvas.height;
        if (!engine || !grid) return;
        at = fitted(under.width, under.height, engine.width(), engine.height());
        grid.place(at);
        fresh = true;
    };

    /** Makes a new world of this size, and the views of the engine's memory that go with it. */
    const begin = (made: Engine, columns: number, rows: number): boolean => {
        if (!made.create(columns, rows, (Math.random() * 2 ** 32) >>> 0, 0)) return false;
        // memory grows only in `create`, so these views stay good until the next
        bytes = new Uint8Array(made.memory.buffer, made.cells(), made.stride() * (rows + 2 * made.border()) * 4);
        palette = new Uint8Array(3072);
        palette.set(new Uint8Array(made.memory.buffer, made.palette(), 2048));
        palette.set(colorRow(), 2048);
        grid?.palette(palette);
        cleared = undefined;
        fit();
        return true;
    };

    /** The world opened from a link or a file: made at its size, with its cells, and paused, so it is seen as it was sent. */
    const open = (opened: Opened) => {
        if (!engine || !begin(engine, opened.width, opened.height)) return;
        writeTokens(opened, bytes!, engine.stride(), engine.border());
        engine.rewritten(1);
        setPaused(true);
        render();
        m.wake();
    };

    const striped = () => offered.find((material) => material.striped);
    const stroke = (from: [number, number], to: [number, number]) => {
        if (!engine) return;
        if (cleared) {
            cleared = undefined;
            render();
        }
        forgetLink();
        const still = from[0] === to[0] && from[1] === to[1];
        if (!poured) engine.paint(0, from[0], from[1], to[0], to[1], radius, 100, 0);
        else if (!poured.striped) engine.paint(poured.number, from[0], from[1], to[0], to[1], radius, fillOf(poured, still, radius), 0);
        else if (!whole) engine.paint_striped(poured.number, from[0], from[1], to[0], to[1], radius, fillOf(poured, still, radius), stripesOf(flag).first, stripesOf(flag).count);
        else if (!laid) {
            // a whole flag, once a press, with its middle under the pointer
            laid = true;
            const { wide, high } = flagSize(radius, engine.width(), engine.height());
            engine.flag(poured.number, to[0] - (wide >> 1), to[1] - (high >> 1), wide, high, stripesOf(flag).first, stripesOf(flag).count);
        }
    };

    // ---- the address: a world opened from a link is taken out of it once the world is changed ----
    const LINKED = "#world=";
    let linked = location.hash.startsWith(LINKED);
    const forgetLink = () => {
        if (!linked) return;
        linked = false;
        history.replaceState(history.state, "", location.pathname + location.search);
    };

    let setPaused = (on: boolean) => void (paused = on);

    const panel = () => {
        const box = m.panel();
        box.classList.add("sand-panel");
        const row = inRow(offered);
        const swatches: { button: HTMLButtonElement; material: Material | undefined; canvas: HTMLCanvasElement }[] = [];
        /** Draws a swatch: a square of grains of the material, as the engine colors them; pride sand in the chosen flag's stripes. */
        const paint = (canvas: HTMLCanvasElement, material: Material | undefined) => {
            const GRAINS = 7;
            const scale = Math.min(window.devicePixelRatio || 1, 3);
            // a whole number of pixels a grain, so that no two overlap
            const grain = Math.max(1, Math.round(((canvas.clientWidth || 28) * scale) / GRAINS));
            const side = grain * GRAINS;
            canvas.width = canvas.height = side;
            const ctx = canvas.getContext("2d")!;
            ctx.clearRect(0, 0, side, side);
            if (!material || !palette) return;
            const { first, count } = stripesOf(flag);
            // the same grains each time it is drawn, so a swatch does not change but for its stripes
            let seed = material.number * 7919 + 1;
            const next = () => ((seed = (seed * 1103515245 + 12345) >>> 0) >>> 16) & 255;
            for (let y = 0; y < GRAINS; y++) {
                for (let x = 0; x < GRAINS; x++) {
                    const shade = material.striped ? ((first + Math.floor((y * count) / GRAINS)) << 2) | (next() & 3) : next();
                    const [r, g, b, a] = swatchColor(palette, material.number, shade);
                    ctx.fillStyle = `rgb(${r} ${g} ${b} / ${(a / 255).toFixed(3)})`;
                    ctx.fillRect(x * grain, y * grain, grain, grain);
                }
            }
        };
        const flags = el("div", { class: "sand-flags fold" });
        flags.inert = true;
        const flagButtons: HTMLButtonElement[] = [];
        const ways: HTMLButtonElement[] = [];
        const choose = (material: Material | undefined) => {
            poured = material;
            for (const one of swatches) one.button.setAttribute("aria-pressed", String(one.material === material));
            const opening = Boolean(material?.striped);
            flags.classList.toggle("open", opening);
            flags.inert = !opening;
        };
        render = () => {
            for (const one of swatches) if (one.material?.striped) paint(one.canvas, one.material);
            flagButtons.forEach((button, index) => button.setAttribute("aria-pressed", String(index === flag)));
            ways.forEach((button, index) => {
                const on = (index === 1) === whole;
                button.setAttribute("aria-pressed", String(on));
                button.classList.toggle("quiet", !on);
            });
            empty.textContent = cleared ? "undo clear" : "clear";
        };
        const picks = el("div", { class: "sand-swatches" });
        picks.setAttribute("role", "group");
        picks.setAttribute("aria-label", "materials");
        for (const material of [...row, undefined]) {
            const name = material?.name ?? "erase";
            const key = KEYS[name];
            const canvas = el("canvas", { class: material ? "sand-grains" : "sand-grains sand-air" });
            const button = el("button", { type: "button", class: "sand-swatch", title: key ? `${name} (${key.toUpperCase()})` : name, onclick: () => choose(material) }, canvas);
            button.setAttribute("aria-label", name);
            if (key) button.setAttribute("aria-keyshortcuts", key.toUpperCase());
            swatches.push({ button, material, canvas });
            picks.append(button);
        }
        // the flags, each a little picture of itself, and whether the brush pours stripes or lays a whole flag
        const flagRow = el("div", { class: "sand-flag-row" });
        FLAGS.forEach((one, index) => {
            const picture = el("canvas", { class: "sand-flag" });
            const button = el("button", { type: "button", class: "sand-swatch", title: `${one.name} flag`, onclick: () => ((flag = index), render()) }, picture);
            button.setAttribute("aria-label", `${one.name} flag`);
            flagButtons.push(button);
            flagRow.append(button);
        });
        for (const [index, word] of ["pour", "whole flag"].entries()) {
            const button = el("button", { type: "button", class: "sand-way", textContent: word, onclick: () => ((whole = index === 1), render()) });
            ways.push(button);
        }
        flags.append(el("div", {}, el("div", { class: "sand-flag-inside" }, flagRow, el("span", { class: "sand-ways" }, ...ways))));

        const size = el("input", { type: "range", min: String(SIZES.least), max: String(SIZES.most), step: "1", value: String(radius), oninput: () => ((radius = Number(size.value)), m.wake()) });
        size.setAttribute("aria-label", "brush size");
        resize = (by: number) => {
            radius = Math.max(SIZES.least, Math.min(SIZES.most, radius + by));
            size.value = String(radius);
            m.wake();
        };
        const pause = el("button", { type: "button", class: "quiet", textContent: "pause", title: "pause (Space)", onclick: () => setPaused(!paused) });
        setPaused = (on: boolean) => {
            paused = on;
            pause.textContent = paused ? "go on" : "pause";
            m.wake();
        };
        const once = el("button", {
            type: "button",
            class: "quiet",
            textContent: "step",
            onclick: () => {
                setPaused(true);
                engine?.step(1);
            },
        });
        const empty = el("button", {
            type: "button",
            class: "quiet",
            textContent: "clear",
            onclick: () => {
                if (!engine || !bytes) return;
                forgetLink();
                if (cleared) {
                    bytes.set(cleared);
                    cleared = undefined;
                    engine.rewritten(0);
                } else {
                    cleared = bytes.slice();
                    engine.clear();
                }
                render();
                m.wake();
            },
        });
        const say = (button: HTMLButtonElement, words: string, rest: string) => {
            button.style.minWidth = `${button.offsetWidth}px`;
            button.textContent = words;
            setTimeout(() => (button.textContent = rest), SAID);
        };
        const share = el("button", { type: "button", class: "quiet", textContent: "copy link to this world" });
        share.onclick = async () => {
            if (!engine || !bytes) return;
            const text = await pack(tokensOf(bytes, engine.stride(), engine.border(), engine.width(), engine.height(), striped()?.number ?? 0), engine.width(), engine.height(), striped()?.number ?? 0);
            if (text.length > LINK_MOST) {
                // too large for an address: kept as a file, opened again by dropping it here or choosing it
                const link = el("a", { href: URL.createObjectURL(new Blob([text], { type: "text/plain" })), download: "world.sand" });
                link.click();
                setTimeout(() => URL.revokeObjectURL(link.href), 10_000);
                return say(share, "too big for a link: saved as a file", "copy link to this world");
            }
            history.replaceState(history.state, "", `${location.pathname}${location.search}${LINKED}${text}`);
            linked = true;
            copyText(share, location.href, { rest: "copy link to this world", done: "link copied", failed: "the link is in the address bar" });
        };
        const chooser = el("input", { type: "file", accept: ".sand,text/plain", class: "sand-chooser" });
        chooser.tabIndex = -1;
        const opener = el("button", { type: "button", class: "quiet", textContent: "open a world", onclick: () => chooser.click() });
        const fromFile = async (file: File | undefined) => {
            const opened = file && file.size <= MOST_TEXT ? await unpack((await file.text()).trim()) : undefined;
            if (opened) open(opened);
            else if (file) say(opener, "that is not a world", "open a world");
        };
        chooser.onchange = () => {
            void fromFile(chooser.files?.[0]);
            chooser.value = "";
        };
        // a world saved as a file can be dropped anywhere on the mini
        const host = m.canvas.parentElement!;
        host.addEventListener("dragover", (event) => event.preventDefault());
        host.addEventListener("drop", (event) => {
            event.preventDefault();
            void fromFile(event.dataTransfer?.files[0]);
        });

        box.append(picks, flags, el("div", { class: "table-go sand-tools" }, el("label", { class: "sand-size" }, "brush ", size), pause, once, empty, share, opener, chooser));
        // the swatches are drawn once they have their size
        requestAnimationFrame(() => {
            for (const one of swatches) paint(one.canvas, one.material);
            flagButtons.forEach((button, index) => {
                const picture = button.firstElementChild as HTMLCanvasElement;
                const scale = Math.min(window.devicePixelRatio || 1, 3);
                [picture.width, picture.height] = [Math.round(picture.clientWidth * scale) || 36, Math.round(picture.clientHeight * scale) || 24];
                const ctx = picture.getContext("2d")!;
                const stripes = FLAGS[index]!.stripes;
                stripes.forEach((stripe, k) => {
                    ctx.fillStyle = stripe;
                    const top = Math.round((k * picture.height) / stripes.length);
                    ctx.fillRect(0, top, picture.width, Math.round(((k + 1) * picture.height) / stripes.length) - top);
                });
            });
        });
        pick = (key: string) => {
            const found = swatches.find((one) => KEYS[one.material?.name ?? "erase"] === key);
            if (found) choose(found.material);
            return Boolean(found);
        };
        choose(row[0]);
        render();
    };
    let resize = (by: number) => void (radius = Math.max(SIZES.least, Math.min(SIZES.most, radius + by)));
    let pick = (_key: string) => false;

    // the keyboard, only while the mini has it, as Mote's own keys are: a letter picks a material, the brackets size the brush
    m.canvas.addEventListener("keydown", (event) => {
        if (event.metaKey || event.ctrlKey || event.altKey || m.preview) return;
        const key = event.key.toLowerCase();
        if (key === "[" || key === "]") resize(key === "]" ? 1 : -1);
        else if (!pick(key)) return;
        event.preventDefault();
    });
    // the wheel sizes the brush too, but only while the mini has the keyboard, so that it never stops the page scrolling past
    m.canvas.addEventListener(
        "wheel",
        (event) => {
            if (document.activeElement !== m.canvas || event.deltaY === 0) return;
            event.preventDefault();
            resize(event.deltaY < 0 ? 1 : -1);
        },
        { passive: false },
    );
    // only the first finger pours; a second one does nothing. These are heard before Mote's own.
    const note = (event: PointerEvent) => {
        primary = event.isPrimary;
        pointerKind = event.pointerType;
    };
    m.canvas.addEventListener("pointerdown", note);
    m.canvas.addEventListener("pointermove", note);
    m.canvas.addEventListener("pointerup", note);
    m.canvas.addEventListener("pointercancel", note);
    m.canvas.addEventListener("pointerleave", () => m.wake());

    const loaded = fetch(engineAddress())
        .then((answer) => answer.arrayBuffer())
        .then(start)
        .then(async (made) => {
            engine = made;
            offered = materials(made);
            const asked = linked && !m.preview ? await unpack(location.hash.slice(LINKED.length)) : undefined;
            if (!asked) {
                linked = false;
                const { columns, rows } = worldFor(m.width, m.height, ratio());
                if (!begin(made, columns, rows)) return;
            }
            if (!m.preview) panel();
            if (asked) open(asked);
            m.wake();
        });
    // a link to a world pasted into this same page's address opens that world
    const followed = () => {
        if (!location.hash.startsWith(LINKED)) return;
        void loaded.then(() => unpack(location.hash.slice(LINKED.length))).then((opened) => {
            if (!opened) return;
            linked = true;
            open(opened);
        });
    };
    if (!m.preview) window.addEventListener("hashchange", followed);

    /** The outline of the brush at the pointer, so its size is seen before pouring: a circle, or the flag the flag brush lays. */
    const outline = () => {
        if (!at || !engine || m.preview) return;
        const showing = held ? primary : m.pointer.inside && pointerKind !== "touch";
        if (!showing) return;
        const cell = at.scale / ratio();
        m.ctx.beginPath();
        if (poured?.striped && whole) {
            const { wide, high } = flagSize(radius, engine.width(), engine.height());
            const [column, row] = cellUnder(m.pointer.x, m.pointer.y, at, ratio());
            const x = (at.left / ratio()) + (column - (wide >> 1)) * cell;
            const y = (at.top / ratio()) + (row - (high >> 1)) * cell;
            m.ctx.rect(Math.round(x) + 0.5, Math.round(y) + 0.5, Math.round(wide * cell) - 1, Math.round(high * cell) - 1);
        } else {
            m.ctx.arc(m.pointer.x, m.pointer.y, Math.max(2, (radius + 0.5) * cell), 0, Math.PI * 2);
        }
        m.ctx.strokeStyle = m.color("--muted");
        m.ctx.lineWidth = 1;
        m.ctx.stroke();
    };

    return {
        step(dt) {
            if (!engine || paused) return;
            owed += dt;
            while (owed >= 1 / STEPS_PER_SECOND - 1e-6) {
                owed -= 1 / STEPS_PER_SECOND;
                // a pointer held still keeps pouring; pride sand only once it has stopped, so that a
                // stroke's stripes are not poured over as they fall
                if (held && !(poured?.striped && m.time - moved < STOPPED)) stroke(held, held);
                engine.step(1);
            }
        },
        draw() {
            if (engine && grid && bytes && at) {
                const [from, to] = fresh ? [0, at.rows - 1] : [engine.changed_from(), engine.changed_to()];
                grid.draw(bytes, engine.stride(), engine.border(), from, from < 0 ? -1 : to);
                engine.forget_changed();
                fresh = false;
            }
            outline();
            if (!grid) {
                m.ctx.fillStyle = m.color("--muted");
                m.ctx.textAlign = "center";
                m.ctx.fillText("This needs a browser with WebGL 2.", m.width / 2, m.height / 2);
            }
        },
        resize: fit,
        press(x, y) {
            if (!at || !primary) return;
            laid = false;
            held = cellUnder(x, y, at, ratio());
            stroke(held, held);
        },
        move(x, y) {
            if (!at) return;
            if (!held) {
                // nothing is poured, but the brush's outline follows the pointer
                m.wake();
                return;
            }
            if (!primary) return;
            const next = cellUnder(x, y, at, ratio());
            if (next[0] === held[0] && next[1] === held[1]) return;
            stroke(held, next);
            held = next;
            moved = m.time;
        },
        release() {
            if (primary) held = undefined;
        },
        // Space or Enter pauses and goes on, as the button does.
        keydown(name) {
            if (name === "action") setPaused(!paused);
        },
        resting: () => !engine || (!held && (paused || engine.awake() === 0)),
        debug: () => (engine ? [`steps ${engine.steps()}`, `awake chunks ${engine.awake()}`, `world ${engine.width()} by ${engine.height()}`] : []),
        destroy() {
            window.removeEventListener("hashchange", followed);
            grid?.dispose();
            under.remove();
        },
    };
}
