// The sand mini: a box of every material in the engine's table, poured with the pointer or a finger
// into a world far larger than the stage. The stage is a view onto it: the mouse's other buttons, two
// fingers and the arrow keys move it, and Control with the wheel, a pinch, and the plus and minus keys
// bring it nearer and farther, down to the whole world at once; a word grows the stage to fill the
// window and brings it back. The engine is the Rust crate in sand/, built to WebAssembly (grains.ts).
// Its cells are drawn through Mote's grid (src/mote/cells.ts), read straight out of the engine's
// memory, only the bands of rows that changed, with fire, lava and burning wood giving light and smoke
// and steam drawn softly.
//
// Under it, a row of the materials, each a little square of itself as the engine colors it; pride
// sand opens to the flags (flags.ts), poured in stripes or laid as a whole flag. Then the brush's
// size, pause, step, clear (undone once), and a link to the world as it is (worlds.ts), or a file
// when it is too large for one. The world steps sixty times a second while anything in it moves or
// a pointer is pouring, and rests otherwise, as Mote does when out of sight.

import { cells, cellUnder, type Place } from "../mote/cells";
import { el, type Hand, type Mote, type Scene } from "../mote/stage";
import { copyText } from "../scripts/copy";
import { colorRow, FLAGS, place as stripesOf } from "./flags";
import { brushCells, CELL, engineAddress, fillOf, flagSize, inRow, keptView, keyAction, KEYS, materials, nextStop, start, STEPS_PER_SECOND, swatchColor, viewWith, worldAt, worldSize, zoomStops, type Engine, type Frame, type Material, type View } from "./grains";
import { LINK_MOST, MOST_TEXT, pack, tokensOf, unpack, writeTokens, type Opened } from "./worlds";

export const label = "A box of sand, water, fire, lava and more, poured with the pointer.";

/** The brush's size on its slider: how many of the first page's cells either side of the line it pours (`brushCells`). */
const SIZES = { least: 0, most: 24, first: 4 };
/** How long a pointer must stay in one cell before pride sand pours there as from a brush held still, in seconds. */
const STOPPED = 0.2;
/** How long a button's word says what it did, in milliseconds. */
const SAID = 2500;
/** How fast the arrow keys move the view, in CSS pixels a second; how long a change of zoom takes, in seconds; and how far the wheel turns, with Control, for one stop of it, in pixels. */
const MOVES = { speed: 720, glide: 0.18, notch: 60 };
/** How long the stage takes to grow to fill the window and to come back, in milliseconds. */
const GROWS = 260;
/** Which way each arrow key moves the view. */
const ARROWS: Record<string, [number, number]> = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };

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
    /** What a held brush's share of cells in 100 left over at its last step, less than one. */
    let carried = 0;
    let owed = 0;
    /** Every row is sent on the next draw: the grid was placed anew. */
    let fresh = true;
    /** The world as it was before it was cleared, until the next stroke: what "undo clear" puts back. */
    let cleared: Uint8Array | undefined;
    /** The pointers held on the stage now; which of them pours; and what kind the last to press or move was. */
    const hands = new Map<number, Hand>();
    let pouring: number | undefined;
    let lastKind: Hand["kind"] = "mouse";
    /** The view onto the world, and the change of zoom it is in the middle of: from and to, and the point of the world kept under a point of the canvas. */
    let view: View = { x: 0, y: 0, zoom: 1 };
    let glide: { from: number; to: number; at: [number, number]; px: number; py: number; t: number } | undefined;
    /** A mouse's other button dragging the view: its pointer, and the point of the world it took hold of. */
    let dragged: { id: number; at: [number, number] } | undefined;
    /** Two fingers moving and zooming the view: how far apart they were, the zoom then, and the point of the world between them. */
    let pinch: { apart: number; zoom: number; at: [number, number] } | undefined;
    /** The arrow keys held, and how far the wheel has turned toward the next stop of zoom. */
    const moving = new Set<string>();
    let turned = 0;
    /** The stage fills the window, and what keeps its place in the page meanwhile. */
    let filled = false;
    let holder: HTMLElement | undefined;
    let render = () => {};
    /** Says in the column what the view can still do. */
    let seen = () => {};
    const calm = () => matchMedia("(prefers-reduced-motion: reduce)").matches;

    /** Device pixels to a CSS pixel, as Mote sized its canvas. */
    const ratio = () => (m.width > 0 ? m.canvas.width / m.width : window.devicePixelRatio || 1);
    /** The canvas's own pixels a cell is drawn at one CSS pixel a cell, in whole pixels so grains are square and sharp. */
    const base = () => Math.max(1, Math.round(CELL * ratio()));
    const frame = (): Frame | undefined => (engine ? { columns: engine.width(), rows: engine.height(), wide: under.width, high: under.height } : undefined);
    /** Looks at the world as `next` says, kept to the world, and puts the grid there. */
    const look = (next: View) => {
        const size = frame();
        if (!size || !grid) return;
        view = keptView(next, base(), size);
        at = { columns: size.columns, rows: size.rows, scale: view.zoom, left: Math.round(size.wide / 2 - view.x * view.zoom), top: Math.round(size.high / 2 - view.y * view.zoom) };
        grid.place(at);
        // a brush held down stays under its pointer as the world moves under it
        const hand = pouring === undefined ? undefined : hands.get(pouring);
        if (held && hand) held = cellUnder(hand.x, hand.y, at, ratio());
        seen();
        m.wake();
    };
    const fit = () => {
        under.width = m.canvas.width;
        under.height = m.canvas.height;
        // laid exactly under the canvas that takes the pointer, wherever the stage's grid puts it
        const host = m.canvas.parentElement!;
        const [inside, around] = [m.canvas.getBoundingClientRect(), host.getBoundingClientRect()];
        Object.assign(under.style, { left: `${inside.left - around.left - host.clientLeft}px`, top: `${inside.top - around.top - host.clientTop}px`, width: `${m.canvas.clientWidth}px`, height: `${m.canvas.clientHeight}px` });
        look(view);
    };
    /** Goes to another zoom, gliding, with the point of the world under (px, py) of the canvas kept there: its middle unless told. */
    const zoomTo = (to: number, px = under.width / 2, py = under.height / 2) => {
        const size = frame();
        if (!size) return;
        const stops = zoomStops(base(), size);
        to = Math.max(stops[stops.length - 1]!, Math.min(stops[0]!, to));
        if (Math.abs(to - view.zoom) < 1e-6) return;
        glide = { from: view.zoom, to, at: worldAt(view, px, py, size), px, py, t: 0 };
        m.wake();
    };
    /** One stop nearer or farther, from where a glide under way is going. */
    const zoomBy = (by: 1 | -1, px?: number, py?: number) => {
        const size = frame();
        if (size) zoomTo(nextStop(glide?.to ?? view.zoom, by, zoomStops(base(), size)), px, py);
    };
    const seeAll = () => {
        const size = frame();
        if (size) zoomTo(zoomStops(base(), size).pop()!);
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
        fresh = true;
        glide = undefined;
        // a new world is seen from its floor, in the middle, a CSS pixel to a cell
        view = { x: columns / 2, y: rows, zoom: base() };
        fit();
        return true;
    };

    /** The world opened from a link or a file: made at its size, with its cells, and paused, so it is seen as it was sent. */
    const open = (opened: Opened) => {
        if (!engine || !begin(engine, opened.width, opened.height)) return;
        writeTokens(opened, bytes!, engine.stride(), engine.border());
        engine.rewritten(1);
        // all of it at once, as it was sent
        look({ x: opened.width / 2, y: opened.height / 2, zoom: 0 });
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
        const cells = brushCells(radius);
        // the engine fills whole cells in 100: what a held brush's share leaves over is carried to its next step
        const share = poured ? fillOf(poured, still, cells) + (still ? carried : 0) : 100;
        const fill = Math.floor(share);
        carried = still ? share - fill : 0;
        if (!poured) engine.paint(0, from[0], from[1], to[0], to[1], cells, 100, 0);
        else if (fill === 0) return;
        else if (!poured.striped) engine.paint(poured.number, from[0], from[1], to[0], to[1], cells, fill, 0);
        else if (!whole) engine.paint_striped(poured.number, from[0], from[1], to[0], to[1], cells, fill, stripesOf(flag).first, stripesOf(flag).count);
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
        box.classList.add("sand-panel", "sand-side");
        /** A group's heading, across the column. */
        const group = (words: string) => el("h3", { class: "sand-group", textContent: words });
        /** A row of the column's grid: a small label, then its controls. */
        const line = (words: string, ...controls: (Node | string)[]) => [el("span", { class: "sand-label", textContent: words }), el("div", { class: "sand-controls" }, ...controls)];
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
                    // what gives light is drawn hot, as it is poured: its shade is its heat
                    const shade = material.striped ? ((first + Math.floor((y * count) / GRAINS)) << 2) | (next() & 3) : material.light ? 150 + ((next() * 105) >> 8) : next();
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

        const size = el("input", { type: "range", class: "sand-size", min: String(SIZES.least), max: String(SIZES.most), step: "1", value: String(radius), oninput: () => ((radius = Number(size.value)), m.wake()) });
        size.setAttribute("aria-label", "brush size");
        resize = (by: number) => {
            radius = Math.max(SIZES.least, Math.min(SIZES.most, radius + by));
            size.value = String(radius);
            m.wake();
        };
        // the view: nearer, farther, all of the world at once, and the stage grown to fill the window
        const nearer = el("button", { type: "button", class: "quiet", textContent: "zoom in", title: "zoom in (+, or Control and the wheel)", onclick: () => zoomBy(1) });
        const farther = el("button", { type: "button", class: "quiet", textContent: "zoom out", title: "zoom out (-, or Control and the wheel)", onclick: () => zoomBy(-1) });
        const all = el("button", { type: "button", class: "quiet", textContent: "see it all", title: "see it all (Home)", onclick: seeAll });
        const grow = el("button", { type: "button", class: "quiet sand-link", textContent: "fill the window", onclick: () => setFilled(!filled) });
        // it keeps the room of the longer of its two words, so nothing under it moves when it changes
        grow.dataset.widest = "back to the page";
        seen = () => {
            const size = frame();
            if (!size) return;
            const stops = zoomStops(base(), size);
            const going = glide?.to ?? view.zoom;
            // a word that cannot act now is faint and out of reach, never hidden
            for (const [button, can] of [[nearer, going < stops[0]! * 0.999], [farther, going > stops[stops.length - 1]! * 1.001], [all, going > stops[stops.length - 1]! * 1.001]] as const) {
                button.inert = !can;
                button.classList.toggle("faint", !can);
            }
            grow.textContent = filled ? "back to the page" : "fill the window";
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
        const share = el("button", { type: "button", class: "quiet sand-link", textContent: "copy link to this world" });
        share.onclick = async () => {
            if (!engine || !bytes) return;
            const text = await pack(tokensOf(bytes, engine.stride(), engine.border(), engine.width(), engine.height(), striped()?.number ?? 0), engine.width(), engine.height(), striped()?.number ?? 0);
            if (text.length > LINK_MOST) {
                // too large for an address: kept as a file, opened again by dropping it here or choosing it
                const link = el("a", { href: URL.createObjectURL(new Blob([text], { type: "text/plain" })), download: "world.sand" });
                link.click();
                setTimeout(() => URL.revokeObjectURL(link.href), 10_000);
                return say(share, "saved as a file", "copy link to this world");
            }
            history.replaceState(history.state, "", `${location.pathname}${location.search}${LINKED}${text}`);
            linked = true;
            copyText(share, location.href, { rest: "copy link to this world", done: "link copied", failed: "link in the address bar" });
        };
        const chooser = el("input", { type: "file", accept: ".sand,text/plain", class: "sand-chooser" });
        chooser.tabIndex = -1;
        const opener = el("button", { type: "button", class: "quiet sand-link", textContent: "open a world", onclick: () => chooser.click() });
        const fromFile = async (file: File | undefined) => {
            const opened = file && file.size <= MOST_TEXT ? await unpack((await file.text()).trim()) : undefined;
            if (opened) open(opened);
            else if (file) say(opener, "not a world", "open a world");
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

        // the brush's size is a line of the materials it pours, so that the whole column is in a laptop's first screen
        box.append(group("materials"), picks, flags, ...line("brush", size), group("view"), el("div", { class: "sand-controls sand-across" }, nearer, farther, all), grow, group("world"), el("div", { class: "sand-controls sand-across" }, pause, once, empty), share, opener, chooser);
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
        seen();
    };
    let resize = (by: number) => void (radius = Math.max(SIZES.least, Math.min(SIZES.most, radius + by)));
    let pick = (_key: string) => false;

    // The keyboard, only while the mini has it, but wherever in it: on the canvas or on a swatch or button
    // just pressed. A letter picks a material, the brackets size the brush, Space pauses; the arrows move
    // the view for as long as they are held, plus and minus bring it nearer and farther, Home shows the
    // whole world, and Escape brings the stage back from filling the window.
    const host = m.canvas.parentElement!;
    host.addEventListener("keydown", (event) => {
        if (event.metaKey || event.ctrlKey || event.altKey || m.preview) return;
        const target = event.target as HTMLElement;
        const on = target === m.canvas ? "canvas" : target instanceof HTMLInputElement ? (target.type === "range" ? "slider" : "text") : "button";
        if (event.key in ARROWS && on !== "slider" && on !== "text") {
            moving.add(event.key);
            m.wake();
            event.preventDefault();
            return;
        }
        if (event.key === "Escape" && filled) {
            setFilled(false);
            event.preventDefault();
            return;
        }
        const action = keyAction(event.key, on);
        if (!action) return;
        if (action === "larger" || action === "smaller") resize(action === "larger" ? 1 : -1);
        else if (action === "pause") setPaused(!paused);
        else if (action === "nearer" || action === "farther") zoomBy(action === "nearer" ? 1 : -1);
        else if (action === "all") seeAll();
        else if (!pick(action.pick)) return;
        event.preventDefault();
    });
    host.addEventListener("keyup", (event) => moving.delete(event.key));
    host.addEventListener("focusout", () => moving.clear());
    // The wheel sizes the brush, and with Control (as a trackpad's pinch is told) zooms toward the pointer,
    // a stop for each notch; but only while the mini has the keyboard, so that it never stops the page
    // scrolling past.
    m.canvas.addEventListener(
        "wheel",
        (event) => {
            if (document.activeElement !== m.canvas || event.deltaY === 0) return;
            event.preventDefault();
            if (!event.ctrlKey && !event.metaKey) return resize(event.deltaY < 0 ? 1 : -1);
            // a pinch comes in many small turns: each counts for more, so a pinch is a stop or two
            turned += event.deltaY * (event.deltaMode === 1 ? 16 : 1) * (Math.abs(event.deltaY) < 30 && event.deltaMode === 0 ? 5 : 1);
            while (Math.abs(turned) >= MOVES.notch) {
                zoomBy(turned < 0 ? 1 : -1, event.offsetX * ratio(), event.offsetY * ratio());
                turned -= Math.sign(turned) * MOVES.notch;
            }
        },
        { passive: false },
    );
    m.canvas.addEventListener("pointerleave", () => m.wake());

    /** Grows the stage to fill the window, from where it is, or brings it back to its place in the page. */
    const setFilled = (on: boolean) => {
        if (on === filled || m.preview) return;
        const box = (rect: DOMRect) => ({ top: `${rect.top}px`, left: `${rect.left}px`, width: `${rect.width}px`, height: `${rect.height}px`, right: "auto", bottom: "auto" });
        const from = host.getBoundingClientRect();
        filled = on;
        seen();
        if (on) {
            // its place in the page is kept by an empty box of its size, so the page under it does not move
            holder = el("div", { class: "mini-stage mote sand-place" });
            holder.dataset.mini = "sand";
            holder.setAttribute("aria-hidden", "true");
            holder.style.height = `${from.height}px`;
            host.before(holder);
            host.classList.add("filled");
            if (!calm()) host.animate([box(from), box(host.getBoundingClientRect())], { duration: GROWS, easing: "cubic-bezier(0.2, 0.8, 0.2, 1)" });
            return;
        }
        const back = () => {
            host.classList.remove("filled");
            holder?.remove();
            holder = undefined;
        };
        if (calm() || !holder) return back();
        const going = host.animate([box(from), box(holder.getBoundingClientRect())], { duration: GROWS, easing: "cubic-bezier(0.2, 0.8, 0.2, 1)" });
        going.onfinish = going.oncancel = back;
    };

    const loaded = fetch(engineAddress())
        .then((answer) => answer.arrayBuffer())
        .then(start)
        .then(async (made) => {
            engine = made;
            offered = materials(made);
            const asked = linked && !m.preview ? await unpack(location.hash.slice(LINKED.length)) : undefined;
            if (!asked) {
                linked = false;
                // a preview in a list is no larger than it is shown; the page's own world is far larger than its stage
                const { columns, rows } = m.preview ? { columns: Math.max(1, Math.floor(m.canvas.width / base())), rows: Math.max(1, Math.floor(m.canvas.height / base())) } : worldSize(m.width);
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
        if (!at || !engine || m.preview || dragged || pinch) return;
        const showing = pouring !== undefined || (m.pointer.inside && lastKind !== "touch");
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
            m.ctx.arc(m.pointer.x, m.pointer.y, Math.max(2, (brushCells(radius) + 0.5) * cell), 0, Math.PI * 2);
        }
        m.ctx.strokeStyle = m.color("--muted");
        m.ctx.lineWidth = 1;
        m.ctx.stroke();
    };
    /** A thin rule along the world's edges, wherever the view shows past them. */
    const edges = () => {
        if (!at || m.preview) return;
        const [x, y, wide, high] = [at.left, at.top, at.columns * at.scale, at.rows * at.scale].map((pixels) => Math.round(pixels / ratio())) as [number, number, number, number];
        if (x <= 0 && y <= 0 && x + wide >= m.width && y + high >= m.height) return;
        m.ctx.strokeStyle = m.color("--rule");
        m.ctx.lineWidth = 1;
        m.ctx.strokeRect(x - 0.5, y - 0.5, wide + 1, high + 1);
    };
    /** A point of the stage in the canvas's own pixels. */
    const pixels = (hand: { x: number; y: number }): [number, number] => [hand.x * ratio(), hand.y * ratio()];
    /** The middle of two fingers on the stage and how far apart they are, in CSS pixels. */
    const between = () => {
        const [a, b] = [...hands.values()].filter((hand) => hand.kind === "touch");
        return a && b ? { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, apart: Math.max(1, Math.hypot(a.x - b.x, a.y - b.y)) } : undefined;
    };

    return {
        step(dt) {
            // the view moves whether the world is paused or not
            const size = frame();
            if (size && glide) {
                glide.t = calm() ? 1 : Math.min(1, glide.t + dt / MOVES.glide);
                const eased = 1 - (1 - glide.t) ** 3;
                look(viewWith(glide.t >= 1 ? glide.to : glide.from * (glide.to / glide.from) ** eased, glide.at, glide.px, glide.py, size));
                if (glide.t >= 1) glide = undefined;
            }
            if (size && moving.size) {
                const by = ((MOVES.speed * ratio()) / view.zoom) * dt;
                const [across, down] = [...moving].reduce(([x, y], key) => [x + ARROWS[key]![0], y + ARROWS[key]![1]], [0, 0]);
                look({ ...view, x: view.x + by * across, y: view.y + by * down });
            }
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
                const [stride, border] = [engine.stride(), engine.border()];
                if (fresh) grid.send(bytes, stride, border, 0, at.rows - 1);
                else {
                    // only the bands of rows that changed, each run of them sent together
                    const rows = engine.band_rows();
                    const bands = Math.ceil(at.rows / rows);
                    for (let band = 0; band < bands; band++) {
                        if (!engine.band_changed(band)) continue;
                        let last = band;
                        while (last + 1 < bands && engine.band_changed(last + 1)) last++;
                        grid.send(bytes, stride, border, band * rows, Math.min(at.rows, (last + 1) * rows) - 1);
                        band = last;
                    }
                }
                grid.draw(bytes, stride, border, 0, -1);
                engine.forget_changed();
                fresh = false;
            }
            edges();
            outline();
            if (!grid) {
                m.ctx.fillStyle = m.color("--muted");
                m.ctx.textAlign = "center";
                m.ctx.fillText("This needs a browser with WebGL 2.", m.width / 2, m.height / 2);
            }
        },
        resize: fit,
        // The main button, a pen or the first finger pours. A mouse's other buttons take hold of the world
        // and drag the view; a second finger stops the pour, and the two move and zoom the view between them.
        down(hand) {
            lastKind = hand.kind;
            hands.set(hand.id, hand);
            const size = frame();
            if (!at || !size) return;
            if (hand.kind === "mouse" && hand.button !== 0) {
                dragged ??= { id: hand.id, at: worldAt(view, ...pixels(hand), size) };
                return;
            }
            const two = between();
            if (hand.kind === "touch" && two) {
                pouring = held = glide = undefined;
                pinch = { apart: two.apart, zoom: view.zoom, at: worldAt(view, ...pixels(two), size) };
                return;
            }
            if (pouring !== undefined || dragged) return;
            pouring = hand.id;
            laid = false;
            held = cellUnder(hand.x, hand.y, at, ratio());
            stroke(held, held);
        },
        slide(hand) {
            lastKind = hand.kind;
            if (hands.has(hand.id)) hands.set(hand.id, hand);
            const size = frame();
            if (!at || !size) return;
            if (dragged?.id === hand.id) return look(viewWith(view.zoom, dragged.at, ...pixels(hand), size));
            const two = between();
            if (pinch && two) return look(viewWith((pinch.zoom * two.apart) / pinch.apart, pinch.at, ...pixels(two), size));
            if (pouring !== hand.id || !held) {
                // nothing is poured, but the brush's outline follows the pointer
                m.wake();
                return;
            }
            const next = cellUnder(hand.x, hand.y, at, ratio());
            if (next[0] === held[0] && next[1] === held[1]) return;
            stroke(held, next);
            held = next;
            moved = m.time;
        },
        up(hand) {
            hands.delete(hand.id);
            if (dragged?.id === hand.id) dragged = undefined;
            if (pouring === hand.id) pouring = held = undefined;
            const size = frame();
            if (pinch && !between() && size) {
                pinch = undefined;
                // the grains come to rest at a whole size: the stop nearest to where the fingers left the view
                const stops = zoomStops(base(), size);
                zoomTo(stops.reduce((best, stop) => (Math.abs(Math.log(stop / view.zoom)) < Math.abs(Math.log(best / view.zoom)) ? stop : best)));
            }
            m.wake();
        },
        // Space or Enter pauses and goes on, as the button does.
        keydown(name) {
            if (name === "action") setPaused(!paused);
        },
        resting: () => !engine || (pouring === undefined && !glide && moving.size === 0 && (paused || engine.awake() === 0)),
        debug: () => (engine ? [`steps ${engine.steps()}`, `awake chunks ${engine.awake()}`, `world ${engine.width()} by ${engine.height()}`, `a cell is ${view.zoom.toFixed(2)} pixels`] : []),
        destroy() {
            window.removeEventListener("hashchange", followed);
            holder?.remove();
            grid?.dispose();
            under.remove();
        },
    };
}
