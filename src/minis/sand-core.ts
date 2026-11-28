// The sand mini's world and its picture, apart from the page: the engine (the Rust crate in sand/,
// built to WebAssembly), the grid that draws its cells (Mote's cells.ts), the stepping, what a held
// brush pours, and the worlds kept for undo. It touches nothing of a page and is driven only by
// messages, so the scene (sand.ts) runs it in a worker, with the canvas handed over to it: a step
// that takes long, and the sending of its cells to the graphics card, then hold up nothing else on
// the page. The small world shown in a list runs it on the page's own thread, by the same messages.
//
//   const handle = core((message, transfer) => postMessage(message, transfer));
//   handle({ t: "start", canvas });           // answers { t: "ready", ... }
//   handle({ t: "make", columns, rows, seed }); // answers { t: "made", ... }
//   handle({ t: "frame", dt, paused: false });  // steps what is owed, draws, answers { t: "frame", ... }
//
// The page asks for a frame and waits for its answer before asking for the next, so there is never
// more than one on its way, and a world too busy to keep up runs slower, not later.

import { cells, type Cells, type Place } from "../mote/cells";
import { colorRow } from "./flags";
import { engineAddress, materials, SLOW, start, STEPS_PER_SECOND, type Engine, type Material } from "./grains";
import { decode, encode, tokensOf, writeTokens, type Opened } from "./worlds";

/** How many strokes back the world is kept, to be undone. */
export const KEPT = 20;
/** How long a pointer must stay in one cell before pride sand pours there as from a brush held still, in milliseconds. */
const STOPPED = 200;
/** The most steps taken for one frame: a world that falls further behind than this lets the time go. */
const MOST_STEPS = 4;
/**
 * How long stepping may take in one frame, in milliseconds, after its first step. A world whose steps
 * are dear (a forest on fire, at about 10 ms a step) then runs a little slower instead of catching up:
 * catching up, three or four steps in a frame made that frame later, and the next later still, so the
 * picture and the brush slowed to a crawl within seconds (the owner found it laggy very quickly, on 24
 * November 2026).
 */
export const STEP_BUDGET = 9;

/** Whether one more step fits in the frame's budget, after `taken` steps that have so far taken `spent` milliseconds. */
export function stepFits(taken: number, spent: number): boolean {
    if (taken === 0) return true;
    // the next step is taken to cost what the steps so far cost each
    return spent + spent / taken <= STEP_BUDGET;
}

/** What a brush held still does before each step: lays a material, lays pride sand's stripes, or stills the wind under it. */
export interface Hold {
    kind: "paint" | "striped" | "blow";
    /** The material, 0 to erase. */
    of: number;
    x: number;
    y: number;
    /** The brush's radius in cells. */
    cells: number;
    /** How many cells in 100 it fills a step; what is left over under one is carried to the next. */
    share: number;
    /** The stripes of pride sand: the first color and how many. */
    first: number;
    count: number;
    /** Whether it pours only once the pointer has stopped (pride sand, so a stroke's stripes are not poured over as they fall). */
    waits: boolean;
    /** Whether the pointer has just come to this cell. */
    moved: boolean;
}

/** What the page tells the core. */
export type ToCore =
    | { t: "start"; canvas: HTMLCanvasElement | OffscreenCanvas; flow?: boolean }
    | { t: "make"; columns: number; rows: number; seed: number }
    | { t: "open"; opened: Opened }
    | { t: "size"; width: number; height: number }
    | { t: "place"; at: Place }
    | { t: "paint"; of: number; from: [number, number]; to: [number, number]; cells: number; fill: number }
    | { t: "striped"; of: number; from: [number, number]; to: [number, number]; cells: number; fill: number; first: number; count: number }
    | { t: "flag"; of: number; x: number; y: number; wide: number; high: number; first: number; count: number }
    | { t: "blow"; from: [number, number]; to: [number, number]; cells: number }
    | { t: "still" }
    | { t: "hold"; hold?: Hold }
    | { t: "turn" }
    | { t: "shake"; steps: number; by: number }
    | { t: "keep" }
    | { t: "back"; redo: boolean }
    | { t: "clear" }
    | { t: "flood"; id: number; of: number; x: number; y: number; most: number }
    | { t: "tokens"; id: number }
    | { t: "frame"; dt: number; paused: boolean; once?: boolean; slow?: boolean }
    | { t: "end" };

/** What the world is doing, sent with every frame. */
export interface Stats {
    /** How many steps were taken for this frame. */
    taken: number;
    /** How many chunks have work to come: none when the world is at rest. */
    awake: number;
    /** What would have been heard since the world was made: hisses, and flames made. */
    heard: [number, number];
    /** How many blocks of the wind's field have a wind in them. */
    windy: number;
    steps: number;
    /** How many worlds are kept to undo, and to redo. */
    past: number;
    future: number;
    /** How many steps of a shake are left. */
    shaking: number;
    /** How long the stepping and the drawing took, in milliseconds. */
    took: number;
}

/** What the core tells the page. */
export type FromCore =
    | { t: "ready"; materials: Material[]; drawn: boolean }
    | { t: "failed"; why: string }
    | { t: "made"; why: "make" | "open" | "turn"; columns: number; rows: number; gust: number; gusts: number; palette: Uint8Array }
    | { t: "frame"; stats: Stats; winds?: Int8Array }
    | { t: "flooded"; id: number; filled: number }
    | { t: "tokens"; id: number; tokens: Uint8Array; width: number; height: number };

/** Makes a core that answers through `send`; gives what takes the page's messages. */
export function core(send: (message: FromCore, transfer?: Transferable[]) => void): (message: ToCore) => void {
    let engine: Engine | undefined;
    let grid: Cells | undefined;
    let canvas: HTMLCanvasElement | OffscreenCanvas | undefined;
    let bytes: Uint8Array | undefined;
    let palette: Uint8Array | undefined;
    let at: Place | undefined;
    /** The material whose shade is a stripe's color, for keeping a world: pride sand. */
    let striped = 0;
    /** Every row is sent to the graphics card at the next draw. */
    let fresh = true;
    /** The wind's field has changed since it was last sent to the page. */
    let blown = true;
    let owed = 0;
    let hold: Hold | undefined;
    let since = 0;
    let carried = 0;
    let shaking = 0;
    let shakes = 0;
    /** The world as it was before each of the last strokes, and before each undone: its materials, not their heat. */
    const past: Uint8Array[] = [];
    const future: Uint8Array[] = [];
    /** Messages that came before the engine had loaded, taken in their order once it has. */
    let waiting: ToCore[] | undefined = [];

    /** The core's view of the engine's cells, made again whenever the engine may have moved them or grown its memory. */
    const look = (made: Engine): Uint8Array => {
        const long = made.stride() * (made.height() + 2 * made.border()) * 4;
        if (!bytes || bytes.buffer !== made.memory.buffer || bytes.byteOffset !== made.cells() || bytes.length !== long) bytes = new Uint8Array(made.memory.buffer, made.cells(), long);
        return bytes;
    };
    /** The world as a link keeps one. */
    const kept = (made: Engine): Uint8Array => encode(tokensOf(look(made), made.stride(), made.border(), made.width(), made.height(), striped), made.width(), made.height(), striped);
    const keep = (made: Engine) => {
        past.push(kept(made));
        if (past.length > KEPT) past.shift();
        future.length = 0;
    };
    /** A new world of this size, and what goes with it. */
    /** Whether liquids move as sand:box's do (`?flow=1`). */
    let flow = false;
    const begin = (made: Engine, columns: number, rows: number, seed: number): boolean => {
        if (!made.create(columns, rows, seed >>> 0, 0)) return false;
        made.set_flow(flow ? 1 : 0);
        look(made);
        palette = new Uint8Array(3072);
        palette.set(new Uint8Array(made.memory.buffer, made.palette(), 2048));
        palette.set(colorRow(), 2048);
        grid?.palette(palette);
        fresh = blown = true;
        owed = carried = shaking = 0;
        hold = undefined;
        return true;
    };
    const made = (why: "make" | "open" | "turn", of: Engine) => send({ t: "made", why, columns: of.width(), rows: of.height(), gust: of.gust(), gusts: of.gusts(), palette: palette!.slice() });

    /** What a brush held still does before a step. */
    const pour = (of: Engine) => {
        if (!hold || (hold.waits && performance.now() - since < STOPPED)) return;
        if (hold.kind === "blow") {
            of.blow(hold.x, hold.y, hold.x, hold.y, hold.cells);
            blown = true;
            return;
        }
        // the engine fills whole cells in 100: what a share leaves over is carried to the next step
        const share = hold.share + carried;
        const fill = Math.floor(share);
        carried = share - fill;
        if (fill === 0) return;
        if (hold.kind === "striped") of.paint_striped(hold.of, hold.x, hold.y, hold.x, hold.y, hold.cells, fill, hold.first, hold.count);
        else of.paint(hold.of, hold.x, hold.y, hold.x, hold.y, hold.cells, Math.min(100, fill), 0);
    };

    /** Sends the rows that changed to the graphics card and draws the grid. */
    const draw = (of: Engine) => {
        if (!grid || !at) return;
        const cellsNow = look(of);
        const [stride, border, high] = [of.stride(), of.border(), of.height()];
        if (fresh) grid.send(cellsNow, stride, border, 0, high - 1);
        else {
            // only the bands of rows that changed, each run of them sent together, and of them only the
            // columns that changed: a pour in one corner of the world does not send rows across all of it
            const rows = of.band_rows();
            const bands = Math.ceil(high / rows);
            for (let band = 0; band < bands; band++) {
                if (!of.band_changed(band)) continue;
                let [last, left, right] = [band, of.band_from(band), of.band_to(band)];
                while (last + 1 < bands && of.band_changed(last + 1)) {
                    last++;
                    left = Math.min(left, of.band_from(last));
                    right = Math.max(right, of.band_to(last));
                }
                grid.send(cellsNow, stride, border, band * rows, Math.min(high, (last + 1) * rows) - 1, left, right);
                band = last;
            }
        }
        grid.draw(cellsNow, stride, border, 0, -1);
        of.forget_changed();
        fresh = false;
    };

    const handle = (message: ToCore): void => {
        if (message.t === "start") {
            canvas = message.canvas;
            flow = message.flow ?? false;
            try {
                grid = cells(canvas);
            } catch {
                grid = undefined;
            }
            fetch(engineAddress())
                .then((answer) => answer.arrayBuffer())
                .then(start)
                .then((loaded) => {
                    engine = loaded;
                    const offered = materials(loaded);
                    striped = offered.find((material) => material.striped)?.number ?? 0;
                    send({ t: "ready", materials: offered, drawn: Boolean(grid) });
                    const held = waiting ?? [];
                    waiting = undefined;
                    for (const each of held) handle(each);
                })
                .catch((error: unknown) => send({ t: "failed", why: String(error) }));
            return;
        }
        if (message.t === "end") {
            grid?.dispose();
            grid = undefined;
            engine = undefined;
            return;
        }
        if (waiting) return void waiting.push(message);
        const of = engine;
        if (!of) return;
        switch (message.t) {
            case "make":
                if (begin(of, message.columns, message.rows, message.seed)) {
                    past.length = future.length = 0;
                    made("make", of);
                }
                return;
            case "open":
                if (!begin(of, message.opened.width, message.opened.height, (Math.random() * 2 ** 32) >>> 0)) return;
                past.length = future.length = 0;
                writeTokens(message.opened, look(of), of.stride(), of.border());
                of.rewritten(1);
                return made("open", of);
            case "size":
                if (canvas && (canvas.width !== message.width || canvas.height !== message.height)) {
                    canvas.width = message.width;
                    canvas.height = message.height;
                }
                return;
            case "place":
                // a grid of another size or another way up has a new picture on the graphics card: every row is sent again
                if (!at || at.columns !== message.at.columns || at.rows !== message.at.rows || (at.turn ?? 0) !== (message.at.turn ?? 0)) fresh = true;
                at = message.at;
                grid?.place(at);
                return;
            case "paint":
                return of.paint(message.of, message.from[0], message.from[1], message.to[0], message.to[1], message.cells, message.fill, 0);
            case "striped":
                return of.paint_striped(message.of, message.from[0], message.from[1], message.to[0], message.to[1], message.cells, message.fill, message.first, message.count);
            case "flag":
                return of.flag(message.of, message.x, message.y, message.wide, message.high, message.first, message.count);
            case "blow":
                blown = true;
                return of.blow(message.from[0], message.from[1], message.to[0], message.to[1], message.cells);
            case "still":
                blown = true;
                return of.still();
            case "hold":
                if (!message.hold || message.hold.moved || !hold) {
                    since = performance.now();
                    carried = 0;
                }
                hold = message.hold;
                return;
            case "turn":
                of.turn();
                look(of);
                fresh = blown = true;
                hold = undefined;
                past.length = future.length = 0;
                return made("turn", of);
            case "shake":
                shaking = message.steps;
                shakes = message.by;
                return;
            case "keep":
                return keep(of);
            case "back": {
                const [from, to] = message.redo ? [future, past] : [past, future];
                const now = kept(of);
                const then = from.pop();
                const opened = then && decode(then);
                if (!opened || opened.width !== of.width() || opened.height !== of.height()) return;
                to.push(now);
                writeTokens(opened, look(of), of.stride(), of.border());
                of.rewritten(1);
                return;
            }
            case "clear":
                return of.clear();
            case "flood": {
                // a closed space, filled; one not closed is left as it is, with nothing kept to undo
                keep(of);
                const filled = of.flood(message.of, message.x, message.y, message.most);
                look(of);
                if (!filled) past.pop();
                return send({ t: "flooded", id: message.id, filled });
            }
            case "tokens": {
                const tokens = tokensOf(look(of), of.stride(), of.border(), of.width(), of.height(), striped);
                return send({ t: "tokens", id: message.id, tokens, width: of.width(), height: of.height() }, [tokens.buffer]);
            }
            case "frame": {
                const began = performance.now();
                let taken = 0;
                of.set_slow(message.slow ? SLOW : 1);
                if (message.once) {
                    // a whole step, all its parts
                    do of.step(1);
                    while (of.part() !== 0);
                    taken = 1;
                } else if (!message.paused) {
                    owed += Math.min(message.dt, MOST_STEPS / STEPS_PER_SECOND);
                    while (owed >= 1 / STEPS_PER_SECOND - 1e-6 && taken < MOST_STEPS && stepFits(taken, performance.now() - began)) {
                        owed -= 1 / STEPS_PER_SECOND;
                        taken++;
                        // the brush and a shake once a whole step, slowed or not
                        if (of.part() === 0) {
                            pour(of);
                            if (shaking > 0) {
                                of.shake(shakes);
                                shaking--;
                            }
                        }
                        of.step(1);
                    }
                    // further behind than it may catch up in a frame, or than the frame's budget lets it: the time is let go
                    if (owed > 1 / STEPS_PER_SECOND - 1e-6) owed = 0;
                }
                draw(of);
                let winds: Int8Array | undefined;
                if (blown) {
                    winds = new Int8Array(of.memory.buffer, of.winds(), of.gusts() * Math.ceil(of.height() / of.gust()) * 2).slice();
                    blown = false;
                }
                const stats: Stats = { taken, awake: of.awake(), heard: [of.heard(0) >>> 0, of.heard(1) >>> 0], windy: of.windy(), steps: of.steps(), past: past.length, future: future.length, shaking, took: performance.now() - began };
                return send({ t: "frame", stats, winds }, winds ? [winds.buffer] : undefined);
            }
        }
    };
    return handle;
}
