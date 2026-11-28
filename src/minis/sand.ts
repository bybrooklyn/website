// The sand mini: a box of every material in the engine's table, poured with the pointer or a finger
// into a world far larger than the stage. The stage is a view onto it: the mouse's other buttons, two
// fingers and the arrow keys move it, and Control with the wheel, a pinch, and the plus and minus keys
// bring it nearer and farther, down to the whole world at once; a word grows the stage to fill the
// window and brings it back. The engine is the Rust crate in sand/, built to WebAssembly (grains.ts).
// It and the grid that draws its cells (src/mote/cells.ts) are the mini's core (sand-core.ts), which
// this scene runs in a worker, on a canvas handed over to it, and tells what to do by messages: so a
// step that takes long, and the sending of cells to the graphics card, hold up nothing else on the
// page. The small world in a list runs the same core on the page's own thread.
//
// Beside it, a column: the materials, each a little square of itself as the engine colors it with its
// name under it, grouped by how each moves; pride sand opens to the flags (flags.ts), poured in stripes
// or laid as a whole flag. Then the brush, and four groups that fold away behind their words: the
// world (pause, step, clear, undo, sound), the view, the forces, and a link to the world as it is
// (worlds.ts), or a file when it is too large for one. The world steps sixty times a second while
// anything in it moves or a pointer is pouring, and rests otherwise, as Mote does when out of sight.

import { cellUnder, keptCell, seenCell, type Place } from "../mote/cells";
import { sounds } from "../mote/sound";
import { el, type Hand, type Mote, type Scene } from "../mote/stage";
import { copyText } from "../scripts/copy";
import { FLAGS, place as stripesOf } from "./flags";
import { brushCells, CELL, SLOW, fillOf, flagSize, inRow, keptView, keyAction, KEYS, nextStop, STEPS_PER_SECOND, swatchColor, viewWith, worldAt, worldSize, zoomStops, type Frame, type Material, type View } from "./grains";
import { core, type FromCore, type Stats, type ToCore } from "./sand-core";
import { LINK_MOST, MOST_TEXT, pack, unpack, type Opened } from "./worlds";

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
/** How the brush draws: freely, a straight line, a box, or a closed space filled. */
const SHAPES = ["free", "line", "box", "fill"] as const;
/** The most cells a fill takes, past which a space is not closed. */
const FILL_MOST = 200_000;
/** The headings the materials are grouped under in the column, by how each moves. */
const KIND_GROUPS: [string, Material["kind"][]][] = [
    ["powders", ["powder"]],
    ["liquids", ["liquid"]],
    ["solids", ["solid"]],
    ["gases", ["gas"]],
    ["fire and energy", ["fire", "bolt"]],
];
/** The column's groups that fold away behind their words, in the order their words stand on their line. */
const FOLDS = ["world", "view", "forces", "share"] as const;
/** Which way things fall, for each quarter the world has been turned; and how many steps a shake lasts and how far it throws a grain. */
const FALLS = ["down", "left", "up", "right"] as const;
const SHAKE = { steps: 20, by: 3 };
/**
 * The world's sound, off until it is asked for. How many hisses a step (steam made where lava, a flame
 * or lightning meets water) and how many flames made a step are as loud as it gets: what lava poured
 * into a lake and a wooden house alight come to. `follows` is how quickly the loudness follows the
 * count, a step; `thunder` the least time between two claps, in seconds; and the pitch of what pours.
 */
const SOUND = { hiss: 8, fire: 80, follows: 0.25, thunder: 0.25, powder: 3200, liquid: 1100, lava: 350 };
/**
 * What the small world shown in a list pours by itself, in turn and over again: each material for some
 * seconds, from a place a share of the way across that sways a little, and then a while of nothing
 * before the world is cleared and it begins again. As Blocks' small pile drops a piece now and then.
 */
const SHOW = [
    { name: "sand", across: 0.3, seconds: 6 },
    { name: "water", across: 0.68, seconds: 4 },
    { name: "pride sand", across: 0.5, seconds: 5 },
    { name: "lava", across: 0.74, seconds: 2.5 },
    { name: "", across: 0, seconds: 7 },
];
/** Which way each arrow key moves the view. */
const ARROWS: Record<string, [number, number]> = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };

export default function sand(m: Mote): Scene {
    // the cells are drawn on a second canvas under the one that takes the pointer, as Dice's tower is
    const under = document.createElement("canvas");
    under.className = "mote-gl";
    m.canvas.parentElement!.insertBefore(under, m.canvas);
    // what the scene draws itself (the brush's outline, the world's edges, a word about a fill) lies over the cells
    m.canvas.classList.add("mote-over");

    /** The world as the core has made it: its size as it is kept, and the size of a block of the wind's field and how many there are across. */
    let world: { columns: number; rows: number; gust: number; gusts: number } | undefined;
    /** What the world was doing at the last frame the core sent, and the wind's field as it last sent it. */
    let stats: Stats = { taken: 0, awake: 0, heard: [0, 0], windy: 0, steps: 0, past: 0, future: 0, shaking: 0, took: 0 };
    let winds: Int8Array | undefined;
    /** Whether the core has a graphics card to draw with. */
    let drawn = true;
    /** A frame has been asked for and not yet come; something has been told to the core since the last was asked for; time not yet given to it; and one step is asked for while paused. */
    let waiting = false;
    let dirty = true;
    let pending = 0;
    let single = false;
    /** The canvas's size in its own pixels, as the core was last told it. */
    let wide = 0;
    let high = 0;
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
    /** Slow motion: the world is given a quarter of the time that passes (G). */
    let slow = false;
    /** The cell under the pointer while it is held down, and whether a flag has been laid in this press. */
    let held: [number, number] | undefined;
    let laid = false;
    /** When the pointer last moved to another cell while held, in the mini's seconds. */
    let moved = -1;
    /** How the brush draws, and where a line or a box being drawn began. */
    let shape: (typeof SHAPES)[number] = "free";
    let anchor: [number, number] | undefined;
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
    let wheeled = 0;
    /** How many quarters the world has been turned (`FALLS`). */
    let turned = 0;
    /** The brush paints wind, not a material. */
    let blowing = false;
    /** The sound: its word, and a bed of noise each for water hissing, fire, what the brush pours, and wind being painted. */
    const sound = m.preview ? undefined : sounds(m);
    const beds = sound && { hiss: sound.bed(5200, 0.5), fire: sound.bed(420, 0.6), pour: sound.bed(SOUND.powder, 0.8), wind: sound.bed(700, 0.4) };
    /** What the engine had counted as heard at the last frame, how many of each a step lately, and when it last thundered. */
    let counted: [number, number] = [0, 0];
    const lately: [number, number] = [0, 0];
    let thundered = -1;
    /**
     * Makes the world's sound for a frame in which `taken` steps were stepped: a hiss as loud as steam is
     * being made, a low roar and a crackle as flames are, and the brush's pour. Each is a bed that is fed
     * here and dies away by itself, so a paused or sleeping world is silent.
     */
    const listen = (taken: number) => {
        if (!world || !sound || !beds) return;
        const now = stats.heard;
        for (const k of [0, 1] as const) {
            // a new world counts from nothing again; a world asleep makes none
            if (taken) lately[k] += (Math.max(0, now[k] - counted[k]) / taken - lately[k]) * SOUND.follows;
            if (stats.awake === 0) lately[k] = 0;
        }
        counted = [now[0], now[1]];
        beds.hiss.feed(Math.min(1, Math.sqrt(lately[0] / SOUND.hiss)) * 0.38);
        const fire = Math.min(1, Math.sqrt(lately[1] / SOUND.fire));
        beds.fire.feed(fire * 0.7);
        if (Math.random() < fire * 0.5) sound.knock(0.05 + Math.random() * 0.3 * fire, 1200 + Math.random() * 4000);
        // what the brush pours: grains high, a liquid lower, lava lowest
        const of = held && !blowing && !(poured?.striped && m.time - moved < STOPPED) ? poured : undefined;
        if (of?.kind === "powder" || of?.kind === "liquid") beds.pour.feed(0.22, of.name === "lava" ? SOUND.lava : of.kind === "liquid" ? SOUND.liquid : SOUND.powder);
    };
    /** The stage fills the window, and what keeps its place in the page meanwhile. */
    let filled = false;
    let holder: HTMLElement | undefined;
    let render = () => {};
    /** Says in the column what the view can still do. */
    let seen = () => {};
    /** What a fill could not do, said on the stage where it was pressed, until the mini's clock reaches `until`. */
    let note: { words: string; x: number; y: number; until: number } | undefined;
    const calm = () => matchMedia("(prefers-reduced-motion: reduce)").matches;

    /** Device pixels to a CSS pixel, as Mote sized its canvas. */
    const ratio = () => (m.width > 0 ? m.canvas.width / m.width : window.devicePixelRatio || 1);
    /** The canvas's own pixels a cell is drawn at one CSS pixel a cell, in whole pixels so grains are square and sharp. */
    const base = () => Math.max(1, Math.round(CELL * ratio()));
    /** The world as it is seen, which a world turned a quarter or three is kept on its side of. */
    const frame = (): Frame | undefined => (world ? { columns: turned % 2 ? world.rows : world.columns, rows: turned % 2 ? world.columns : world.rows, wide, high } : undefined);
    /** The engine's cell under a point of the stage. */
    const cellAt = (point: { x: number; y: number }): [number, number] => keptCell(cellUnder(point.x, point.y, at!, ratio()), turned, at!.columns, at!.rows);
    /** Looks at the world as `next` says, kept to the world, and puts the grid there. */
    const look = (next: View) => {
        const size = frame();
        if (!size) return;
        view = keptView(next, base(), size);
        at = { columns: size.columns, rows: size.rows, scale: view.zoom, left: Math.round(size.wide / 2 - view.x * view.zoom), top: Math.round(size.high / 2 - view.y * view.zoom), turn: turned };
        tell({ t: "place", at });
        // a brush held down stays under its pointer as the world moves under it
        const hand = pouring === undefined ? undefined : hands.get(pouring);
        if (held && hand) {
            held = cellAt(hand);
            holding(false);
        }
        seen();
        m.wake();
    };
    const fit = () => {
        [wide, high] = [m.canvas.width, m.canvas.height];
        tell({ t: "size", width: wide, height: high });
        // laid exactly under the canvas that takes the pointer, wherever the stage's grid puts it
        const host = m.canvas.parentElement!;
        const [inside, around] = [m.canvas.getBoundingClientRect(), host.getBoundingClientRect()];
        Object.assign(under.style, { left: `${inside.left - around.left - host.clientLeft}px`, top: `${inside.top - around.top - host.clientTop}px`, width: `${m.canvas.clientWidth}px`, height: `${m.canvas.clientHeight}px` });
        look(view);
    };
    /** Goes to another zoom, gliding, with the point of the world under (px, py) of the canvas kept there: its middle unless told. */
    const zoomTo = (to: number, px = wide / 2, py = high / 2) => {
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

    /** Asks the core for a new world of this size; the rest is done when it says the world is made (`told`). */
    const begin = (columns: number, rows: number) => tell({ t: "make", columns, rows, seed: (Math.random() * 2 ** 32) >>> 0 });

    /** The world opened from a link or a file: made at its size, with its cells, and paused, so it is seen as it was sent. */
    const open = (opened: Opened) => tell({ t: "open", opened });

    const striped = () => offered.find((material) => material.striped);
    /** Keeps the world as it is before a stroke changes it, so the stroke can be undone. */
    const keep = () => tell({ t: "keep" });
    /** Takes the world back to the last one kept, or, to redo, forward to the last one undone. */
    const back = (redo: boolean) => {
        forgetLink();
        tell({ t: "back", redo });
    };
    /** Lightning claps: a crack, and a low note falling away, not oftener than `SOUND.thunder`. */
    const thunder = () => {
        if (poured?.kind !== "bolt" || m.time - thundered <= SOUND.thunder) return;
        thundered = m.time;
        sound?.knock(1, 260);
        sound?.glide(95, 38, 1.1, 0.22);
    };
    /** A stroke of the brush from one cell to another, or its shape stamped where it is pressed: what it passes over is laid. What a brush held still goes on pouring is the core's (`holding`). */
    const stroke = (from: [number, number], to: [number, number]) => {
        if (!world) return;
        if (blowing) {
            // wind the way the stroke goes; a stroke that goes nowhere stills the air under it
            tell({ t: "blow", from, to, cells: brushCells(radius) });
            if (from[0] !== to[0] || from[1] !== to[1]) beds?.wind.feed(0.3);
            return;
        }
        forgetLink();
        thunder();
        const cells = brushCells(radius, poured);
        const { first, count } = stripesOf(flag);
        if (!poured) tell({ t: "paint", of: 0, from, to, cells, fill: 100 });
        else if (!poured.striped) tell({ t: "paint", of: poured.number, from, to, cells, fill: Math.floor(fillOf(poured, false, cells)) });
        else if (!whole) tell({ t: "striped", of: poured.number, from, to, cells, fill: Math.floor(fillOf(poured, false, cells)), first, count });
        else if (!laid) {
            // a whole flag, once a press, with its middle under the pointer
            laid = true;
            const size = flagSize(radius, world.columns, world.rows);
            tell({ t: "flag", of: poured.number, x: to[0] - (size.wide >> 1), y: to[1] - (size.high >> 1), wide: size.wide, high: size.high, first, count });
        }
    };
    /** Tells the core what the brush held still goes on doing before each step, or that it is let go. `arrived` when the pointer has just come to this cell. */
    const holding = (arrived: boolean) => {
        if (!held || (poured?.striped && whole)) return tell({ t: "hold" });
        const cells = brushCells(radius, poured);
        const { first, count } = stripesOf(flag);
        const where = { x: held[0], y: held[1], cells, first, count, moved: arrived };
        if (blowing) tell({ t: "hold", hold: { ...where, kind: "blow", of: 0, share: 0, waits: false } });
        else if (!poured) tell({ t: "hold", hold: { ...where, kind: "paint", of: 0, share: 100, waits: false } });
        // pride sand only once the pointer has stopped, so that a stroke's stripes are not poured over as they fall
        else tell({ t: "hold", hold: { ...where, kind: poured.striped ? "striped" : "paint", of: poured.number, share: fillOf(poured, true, cells), waits: poured.striped } });
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
    let setSlow = (on: boolean) => void (slow = on);

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
            if (held) holding(false);
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
            for (const [button, can] of [[undone, stats.past > 0], [redone, stats.future > 0], [calmed, stats.windy > 0]] as const) {
                button.inert = !can;
                button.classList.toggle("faint", !can);
            }
        };
        /** A material's square, with no words: its name and the letter that picks it are said when it is pointed at. */
        const swatch = (material: Material | undefined) => {
            const name = material?.name ?? "erase";
            const key = KEYS[name];
            const canvas = el("canvas", { class: material ? "sand-grains" : "sand-grains sand-air" });
            const button = el("button", { type: "button", class: "sand-swatch", title: key ? `${name} (${key.toUpperCase()})` : name, onclick: () => choose(material) }, canvas);
            button.setAttribute("aria-label", name);
            if (key) button.setAttribute("aria-keyshortcuts", key.toUpperCase());
            swatches.push({ button, material, canvas });
            return button;
        };
        /** A kind's squares, as many a line as it has, up to the five a line of the column holds. */
        const squares = (these: Material[]) => {
            const set = el("div", { class: "sand-swatches" }, ...these.map(swatch));
            set.style.setProperty("--count", String(Math.min(5, these.length)));
            return set;
        };
        // the materials in runs by how they move, with no headings (the owner wanted the pictures alone), each kind in the engine's order (`inRow`); kinds
        // short enough share a line, and pride sand's flags open under the powders
        const picks = el("div", { class: "sand-materials" });
        picks.setAttribute("role", "group");
        picks.setAttribute("aria-label", "materials");
        const erasing = el("div", { class: "sand-kind sand-erasing" }, el("div", { class: "sand-swatches" }, swatch(undefined)));
        for (const [heading, kinds] of KIND_GROUPS) {
            const these = row.filter((material) => kinds.includes(material.kind));
            if (these.length === 0) continue;
            const kind = el("div", { class: "sand-kind" }, squares(these));
            kind.setAttribute("role", "group");
            kind.setAttribute("aria-label", heading);
            picks.append(kind);
            if (these.some((material) => material.striped)) picks.append(flags);
            // erasing is no kind: it stands on its own, with no heading, in the room the four solids leave on their line
            if (kinds.includes("solid")) picks.append(erasing);
        }
        // what the table has of a kind not named above is still offered, after the rest
        const others = row.filter((material) => !KIND_GROUPS.some(([, kinds]) => kinds.includes(material.kind)));
        if (others.length > 0) picks.append(el("div", { class: "sand-kind" }, squares(others)));
        if (!flags.parentElement) picks.append(flags);
        if (!erasing.parentElement) picks.append(erasing);
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
            if (held) holding(false);
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
        // which way things fall, turned a quarter at each press, and a shake
        const falls = el("button", {
            type: "button",
            class: "quiet",
            textContent: "gravity: down",
            onclick: () => {
                if (!world) return;
                // the engine turns the world and the grid is drawn turned back: what is seen stays, and falls another way;
                // the word, and the view, follow when the core says the world is turned (`told`)
                pouring = held = anchor = undefined;
                forgetLink();
                tell({ t: "turn" });
            },
        });
        falls.dataset.widest = "gravity: right";
        fallen = () => (falls.textContent = `gravity: ${FALLS[turned]}`);
        const shake = el("button", {
            type: "button",
            class: "quiet",
            textContent: "shake",
            onclick: () => {
                keep();
                forgetLink();
                tell({ t: "shake", steps: SHAKE.steps, by: SHAKE.by });
                sound?.knock(0.7, 170);
                sound?.glide(80, 45, 0.4, 0.2);
                // the stage trembles with it, unless less motion was asked for
                if (!calm()) for (const canvas of [under, m.canvas]) canvas.animate([0, -2, 2, -1, 1, 0].map((by) => ({ translate: `${by}px ${-by}px` })), { duration: (SHAKE.steps / STEPS_PER_SECOND) * 1000 });
                m.wake();
            },
        });
        // wind: while it is on the brush paints wind the way it is drawn, and the wind there is shown
        const wind = el("button", {
            type: "button",
            class: "quiet",
            textContent: "wind: off",
            onclick: () => {
                blowing = !blowing;
                wind.textContent = blowing ? "wind: on" : "wind: off";
                wind.setAttribute("aria-pressed", String(blowing));
                m.wake();
            },
        });
        wind.dataset.widest = "wind: off";
        wind.setAttribute("aria-pressed", "false");
        const calmed = el("button", {
            type: "button",
            class: "quiet",
            textContent: "still the wind",
            onclick: () => tell({ t: "still" }),
        });
        const pause = el("button", { type: "button", class: "quiet", textContent: "pause", title: "pause (Space)", onclick: () => setPaused(!paused) });
        setPaused = (on: boolean) => {
            paused = on;
            pause.textContent = paused ? "go on" : "pause";
            m.wake();
        };
        const slowed = el("button", { type: "button", class: "quiet", textContent: "slow: off", title: "slow motion (G)", onclick: () => setSlow(!slow) });
        slowed.dataset.widest = "slow: off";
        slowed.setAttribute("aria-pressed", "false");
        setSlow = (on: boolean) => {
            slow = on;
            slowed.textContent = slow ? "slow: on" : "slow: off";
            slowed.setAttribute("aria-pressed", String(slow));
            m.wake();
        };
        const once = el("button", {
            type: "button",
            class: "quiet",
            textContent: "step",
            onclick: () => {
                setPaused(true);
                single = true;
                m.wake();
            },
        });
        const empty = el("button", {
            type: "button",
            class: "quiet",
            textContent: "clear",
            onclick: () => {
                if (!world) return;
                keep();
                forgetLink();
                tell({ t: "clear" });
            },
        });
        const undone = el("button", { type: "button", class: "quiet", textContent: "undo", title: "undo (Control Z)", onclick: () => back(false) });
        const redone = el("button", { type: "button", class: "quiet", textContent: "redo", title: "redo (Control Shift Z)", onclick: () => back(true) });
        // how the brush draws, as round dots with their words, as Blocks' kinds are
        const shapes = el("div", { class: "sand-choices" });
        shapes.setAttribute("role", "radiogroup");
        shapes.setAttribute("aria-label", "the brush draws");
        for (const one of SHAPES) {
            const input = el("input", { type: "radio", name: "sand-shape", value: one, checked: one === shape, onchange: () => input.checked && ((shape = one), (anchor = undefined), m.wake()) });
            shapes.append(el("label", {}, input, one));
        }
        const say = (button: HTMLButtonElement, words: string, rest: string) => {
            button.style.minWidth = `${button.offsetWidth}px`;
            button.textContent = words;
            setTimeout(() => (button.textContent = rest), SAID);
        };
        const share = el("button", { type: "button", class: "quiet sand-link", textContent: "copy link to this world" });
        share.onclick = async () => {
            if (!world) return;
            // as it is seen: a world turned to turn its gravity is sent the way up it looks, and falls down again when opened
            const answer = await ask({ t: "tokens", id: 0 });
            const size = frame();
            if (answer.t !== "tokens" || !size) return;
            const [kept, across] = [answer.tokens, answer.width];
            const seen = turned
                ? Uint8Array.from({ length: size.columns * size.rows }, (_, k) => {
                      const [x, y] = keptCell([k % size.columns, Math.floor(k / size.columns)], turned, size.columns, size.rows);
                      return kept[y * across + x]!;
                  })
                : kept;
            const text = await pack(seen, size.columns, size.rows, striped()?.number ?? 0);
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

        // world, view, forces and share fold away behind their words, all on one line, so that the column fits
        // beside the stage at a laptop's size; each opens under the line, growing from the word pressed, and
        // which are open is kept for the next visit
        const inside: Record<(typeof FOLDS)[number], Node[]> = {
            world: [el("div", { class: "sand-controls sand-across" }, pause, once, empty, undone, redone), el("div", { class: "sand-controls sand-across" }, slowed, sound!.button)],
            view: [el("div", { class: "sand-controls sand-across" }, nearer, farther, all), grow],
            forces: [el("div", { class: "sand-controls sand-across" }, falls, shake), el("div", { class: "sand-controls sand-across" }, wind, calmed)],
            share: [share, opener],
        };
        const opened = new Set(m.recall<string[]>("sand-folds", []).filter((name) => (FOLDS as readonly string[]).includes(name)));
        const words = el("div", { class: "sand-folds" });
        const blocks = FOLDS.map((name) => {
            const block = el("div", { class: "sand-opening walker-opening fold", id: `sand-${name}` }, el("div", { class: "walker-opening-inside" }, ...inside[name]));
            const word = el("button", { type: "button", class: "sand-fold", textContent: name });
            word.setAttribute("aria-controls", block.id);
            const shut = (open: boolean) => {
                block.classList.toggle("open", open);
                block.inert = !open;
                word.classList.toggle("open", open);
                word.setAttribute("aria-expanded", String(open));
            };
            word.onclick = () => {
                const open = !opened.has(name);
                // it grows from under the word pressed (measured as laid out, not as it is scaled now; both within the column)
                block.style.transformOrigin = `${word.offsetLeft + word.offsetWidth / 2 - block.offsetLeft}px 0`;
                if (open) opened.add(name);
                else opened.delete(name);
                shut(open);
                m.keep("sand-folds", [...opened]);
            };
            block.addEventListener("transitionend", () => below());
            shut(opened.has(name));
            words.append(word);
            return block;
        });
        // what is used most comes first: where the column is still longer than the stage is high, as when
        // several groups are open, it scrolls, and shows by a fade at its foot that more lies below
        box.append(group("materials"), picks, ...line("brush", size), shapes, words, ...blocks, chooser);
        const below = () => box.classList.toggle("more-below", box.scrollTop + box.clientHeight < box.scrollHeight - 2);
        box.addEventListener("scroll", below, { passive: true });
        new ResizeObserver(below).observe(box);
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
        if (m.preview) return;
        const target = event.target as HTMLElement;
        const on = target === m.canvas ? "canvas" : target instanceof HTMLInputElement ? (target.type === "range" ? "slider" : target.type === "radio" ? "button" : "text") : "button";
        // Control with Z undoes a stroke, with Shift as well or with Y redoes it
        if ((event.ctrlKey || event.metaKey) && !event.altKey && on !== "text" && ["z", "y"].includes(event.key.toLowerCase())) {
            const redo = event.key.toLowerCase() === "y" || event.shiftKey;
            back(redo);
            event.preventDefault();
            return;
        }
        if (event.metaKey || event.ctrlKey || event.altKey) return;
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
        else if (action === "slow") setSlow(!slow);
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
            wheeled += event.deltaY * (event.deltaMode === 1 ? 16 : 1) * (Math.abs(event.deltaY) < 30 && event.deltaMode === 0 ? 5 : 1);
            while (Math.abs(wheeled) >= MOVES.notch) {
                zoomBy(wheeled < 0 ? 1 : -1, event.offsetX * ratio(), event.offsetY * ratio());
                wheeled -= Math.sign(wheeled) * MOVES.notch;
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

    /** Done once the first world is made. */
    let made = () => {};
    const loaded = new Promise<void>((resolve) => (made = resolve));
    /** Says in the column which way things fall; set once the column is made. */
    let fallen = () => {};
    /** What the core says back. */
    const told = (message: FromCore) => {
        if (message.t === "ready") {
            offered = message.materials;
            drawn = message.drawn;
            void (linked && !m.preview ? unpack(location.hash.slice(LINKED.length)) : Promise.resolve(undefined)).then((asked) => {
                if (asked) return open(asked);
                linked = false;
                // a preview in a list is no larger than it is shown; the page's own world is far larger than its stage
                const { columns, rows } = m.preview ? { columns: Math.max(1, Math.floor(m.canvas.width / base())), rows: Math.max(1, Math.floor(m.canvas.height / base())) } : worldSize(m.width);
                begin(columns, rows);
            });
        } else if (message.t === "made") {
            const first = !palette;
            world = { columns: message.columns, rows: message.rows, gust: message.gust, gusts: message.gusts };
            palette = message.palette;
            glide = undefined;
            turned = message.why === "turn" ? (turned + 1) % FALLS.length : 0;
            if (first && !m.preview) panel();
            // a new world is seen from its floor, in the middle, a CSS pixel to a cell
            if (message.why === "make") view = { x: message.columns / 2, y: message.rows, zoom: base() };
            fit();
            if (message.why === "open") {
                // all of it at once, as it was sent
                look({ x: message.columns / 2, y: message.rows / 2, zoom: 0 });
                setPaused(true);
            }
            fallen();
            render();
            made();
            m.wake();
        } else if (message.t === "frame") {
            waiting = false;
            const before = stats;
            stats = message.stats;
            if (message.winds) winds = message.winds;
            listen(stats.taken);
            if (before.past !== stats.past || before.future !== stats.future || before.windy > 0 !== stats.windy > 0) render();
            if (stats.awake > 0 || stats.shaking > 0 || dirty) m.wake();
        } else if (message.t === "flooded" || message.t === "tokens") {
            answers.get(message.id)?.(message);
            answers.delete(message.id);
        } else drawn = false;
    };
    /** Questions put to the core and not yet answered. */
    const answers = new Map<number, (message: FromCore) => void>();
    let asked = 0;
    /** Sends a message to the core, on the worker or here. */
    let post: (message: ToCore, transfer?: Transferable[]) => void = () => {};
    let worker: Worker | undefined;
    /** Tells the core something that changes the world or how it is seen: a frame is owed after it. */
    const tell = (message: ToCore) => {
        dirty = true;
        post(message);
        m.wake();
    };
    /** Asks the core something it answers by a message of its own. */
    const ask = (message: Extract<ToCore, { id: number }>) =>
        new Promise<FromCore>((resolve) => {
            const id = ++asked;
            answers.set(id, resolve);
            tell({ ...message, id });
        });
    // The page's own world steps and is drawn in a worker, on the canvas handed over to it, where a browser
    // can do that; the small one in a list, and any world where it cannot, on this thread.
    // (With `?thread=page` in the address it runs here too, to measure what the worker is worth.)
    if (!m.preview && m.link.get("thread") !== "page" && typeof Worker === "function" && "transferControlToOffscreen" in under) {
        worker = new Worker(new URL("./sand-worker.ts", import.meta.url), { type: "module" });
        worker.onmessage = (event: MessageEvent<FromCore>) => told(event.data);
        worker.onerror = () => (drawn = false);
        const made = worker;
        post = (message, transfer) => made.postMessage(message, transfer ?? []);
        const handed = under.transferControlToOffscreen();
        post({ t: "start", canvas: handed }, [handed]);
    } else {
        const handle = core((message) => queueMicrotask(() => told(message)));
        post = (message) => handle(message);
        post({ t: "start", canvas: under });
    }
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

    /** Which part of `SHOW` the small world is in, and when it began the round. */
    let showing = -1;
    let began = 0;
    /** The small world in a list pours by itself: the core is told what to hold, a few times a second, as a hand would. */
    const show = () => {
        if (!world) return;
        const round = SHOW.reduce((sum, part) => sum + part.seconds, 0);
        if (showing < 0 || m.time - began >= round) {
            began = m.time;
            showing = -1;
            tell({ t: "clear" });
        }
        let [into, part] = [m.time - began, 0];
        while (part < SHOW.length - 1 && into >= SHOW[part]!.seconds) into -= SHOW[part++]!.seconds;
        const material = offered.find((one) => one.name === SHOW[part]!.name);
        // told afresh four times a second, where it sways to, and at once when the part changes
        const beat = Math.floor(into * 4);
        if (part === showing && beat === swayed) return;
        [showing, swayed] = [part, beat];
        if (!material) return tell({ t: "hold" });
        const cells = brushCells(3, material);
        const { first, count } = stripesOf((Math.floor(began) + part) % FLAGS.length);
        const x = Math.round(world.columns * (SHOW[part]!.across + 0.05 * Math.sin(into * 1.7)));
        tell({ t: "hold", hold: { kind: material.striped ? "striped" : "paint", of: material.number, x, y: Math.round(world.rows * 0.12), cells, share: fillOf(material, true, cells), first, count, waits: false, moved: false } });
    };
    let swayed = -1;
    /** The outline of the brush at the pointer, so its size is seen before pouring: a circle, or the flag the flag brush lays. */
    const outline = () => {
        if (!at || !world || m.preview || dragged || pinch) return;
        const showing = pouring !== undefined || (m.pointer.inside && lastKind !== "touch");
        if (!showing) return;
        const cell = at.scale / ratio();
        m.ctx.beginPath();
        if (poured?.striped && whole) {
            // the flag is laid among the cells as they are kept: on its side where the world is a quarter turned
            const laid = flagSize(radius, world.columns, world.rows);
            const [wide, high] = turned % 2 ? [laid.high, laid.wide] : [laid.wide, laid.high];
            const [column, row] = cellUnder(m.pointer.x, m.pointer.y, at, ratio());
            const x = (at.left / ratio()) + (column - (wide >> 1)) * cell;
            const y = (at.top / ratio()) + (row - (high >> 1)) * cell;
            m.ctx.rect(Math.round(x) + 0.5, Math.round(y) + 0.5, Math.round(wide * cell) - 1, Math.round(high * cell) - 1);
        } else {
            m.ctx.arc(m.pointer.x, m.pointer.y, Math.max(2, (brushCells(radius, poured) + 0.5) * cell), 0, Math.PI * 2);
        }
        if (anchor) {
            // from where a line or a box began to the pointer
            const [x, y] = [(at.left + (anchor[0] + 0.5) * at.scale) / ratio(), (at.top + (anchor[1] + 0.5) * at.scale) / ratio()];
            if (shape === "box") m.ctx.rect(Math.min(x, m.pointer.x), Math.min(y, m.pointer.y), Math.abs(m.pointer.x - x), Math.abs(m.pointer.y - y));
            else {
                m.ctx.moveTo(x, y);
                m.ctx.lineTo(m.pointer.x, m.pointer.y);
            }
        }
        m.ctx.strokeStyle = m.color("--muted");
        m.ctx.lineWidth = 1;
        m.ctx.stroke();
    };
    /** The wind, while the brush paints it: for each block of the field in view that has one, a short stroke the way it blows, with a dot at its head. */
    const gusts = () => {
        if (!at || !world || !winds || !blowing) return;
        const [block, across, field] = [world.gust, world.gusts, winds];
        const pixel = at.scale / ratio();
        m.ctx.strokeStyle = m.ctx.fillStyle = m.color("--muted");
        m.ctx.lineWidth = 1;
        for (let k = 0; k < field.length; k += 2) {
            const [right, down] = [field[k]!, field[k + 1]!];
            if (!right && !down) continue;
            const [column, row] = seenCell([(((k / 2) % across) + 0.5) * block, (Math.floor(k / 2 / across) + 0.5) * block], turned, at.columns, at.rows);
            const [x, y] = [(at.left + column * at.scale) / ratio(), (at.top + row * at.scale) / ratio()];
            if (x < -block || y < -block || x > m.width + block || y > m.height + block) continue;
            // the way it blows as it is seen, where the world has been turned
            const [dx, dy] = turned === 1 ? [-down, right] : turned === 2 ? [-right, -down] : turned === 3 ? [down, -right] : [right, down];
            const long = Math.max(3, Math.min(block * pixel * 0.4, 9));
            const [hx, hy] = [x + (dx / 100) * long, y + (dy / 100) * long];
            m.ctx.beginPath();
            m.ctx.moveTo(x - (dx / 100) * long, y - (dy / 100) * long);
            m.ctx.lineTo(hx, hy);
            m.ctx.stroke();
            m.ctx.beginPath();
            m.ctx.arc(hx, hy, 1.5, 0, Math.PI * 2);
            m.ctx.fill();
        }
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
            if (note && m.time >= note.until) note = undefined;
            if (!world) return;
            if (m.preview) show();
            if (held) thunder();
            // The core steps the world and draws it. One frame is asked for at a time, with the time gone
            // by since the last: while its answer is on its way, nothing more is asked.
            pending = paused ? 0 : pending + (slow ? dt * SLOW : dt);
            if (waiting || !(dirty || single || !paused)) return;
            waiting = true;
            dirty = false;
            post({ t: "frame", dt: pending, paused, once: single });
            pending = 0;
            single = false;
        },
        draw() {
            edges();
            gusts();
            outline();
            if (note) {
                // beside where it was pressed, and kept inside the stage
                m.ctx.font = `0.85rem ${getComputedStyle(m.canvas).fontFamily}`;
                m.ctx.fillStyle = m.color("--ink");
                m.ctx.textAlign = note.x > m.width - 96 ? "right" : "left";
                m.ctx.fillText(note.words, note.x + (note.x > m.width - 96 ? -12 : 12), Math.max(16, note.y - 10));
            }
            if (!drawn) {
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
                holding(false);
                pinch = { apart: two.apart, zoom: view.zoom, at: worldAt(view, ...pixels(two), size) };
                return;
            }
            if (pouring !== undefined || dragged) return;
            const cell = cellAt(hand);
            if (shape === "fill") {
                if (blowing) return;
                // a closed space, filled at a press; one not closed is left as it is, and says so beside the press
                forgetLink();
                const [x, y, words] = [hand.x, hand.y, poured ? "not closed" : "nothing there"];
                void ask({ t: "flood", id: 0, of: poured?.number ?? 0, x: cell[0], y: cell[1], most: FILL_MOST }).then((answer) => {
                    if (answer.t !== "flooded" || answer.filled) return;
                    note = { words, x, y, until: m.time + SAID / 1000 };
                    m.wake();
                });
                return;
            }
            if (!blowing) keep();
            pouring = hand.id;
            laid = false;
            if (shape !== "free") {
                // a line or a box is drawn from here, as it is seen, to where the pointer is let go
                anchor = cellUnder(hand.x, hand.y, at, ratio());
                return;
            }
            // the brush's shape is laid where it is pressed, and what it then goes on pouring is the core's
            held = cell;
            stroke(held, held);
            holding(true);
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
                // nothing is poured, but the brush's outline, and a line or a box being drawn, follow the pointer
                m.wake();
                return;
            }
            const next = cellAt(hand);
            if (next[0] === held[0] && next[1] === held[1]) return;
            stroke(held, next);
            held = next;
            moved = m.time;
            holding(true);
        },
        up(hand) {
            hands.delete(hand.id);
            if (dragged?.id === hand.id) dragged = undefined;
            if (pouring === hand.id) {
                if (anchor && at) {
                    // the line, or the four sides of the box, from where it began to here
                    const [a, b] = [anchor, cellUnder(hand.x, hand.y, at, ratio())];
                    const sides: [[number, number], [number, number]][] = shape === "box" ? [[a, [b[0], a[1]]], [[b[0], a[1]], b], [b, [a[0], b[1]]], [[a[0], b[1]], a]] : [[a, b]];
                    const place = at;
                    for (const [from, to] of sides) stroke(keptCell(from, turned, place.columns, place.rows), keptCell(to, turned, place.columns, place.rows));
                }
                pouring = held = anchor = undefined;
                holding(false);
            }
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
        resting: () => !m.preview && (!world || (pouring === undefined && !glide && !note && moving.size === 0 && !waiting && !dirty && !single && (paused || (stats.shaking === 0 && stats.awake === 0)))),
        debug: () => (world ? [`steps ${stats.steps}`, `awake chunks ${stats.awake}`, `world ${world.columns} by ${world.rows}`, `a cell is ${view.zoom.toFixed(2)} pixels`, `a frame of the world took ${stats.took.toFixed(1)} ms${worker ? ", in a worker" : ""}`] : []),
        destroy() {
            window.removeEventListener("hashchange", followed);
            holder?.remove();
            post({ t: "end" });
            worker?.terminate();
            under.remove();
        },
    };
}
