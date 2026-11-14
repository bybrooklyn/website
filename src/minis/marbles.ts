// The marble run, a draft: build a run from a box of pieces whose ends click together, and let marbles
// go down it. Stage 2 of its plan (docs/marbles.md): the box, joints, placing by drag with snapping,
// pillars, marbles, and quiet marks where a run will lose them. The editor's handles, undo, bending,
// moving parts, sound of its own and the look of wood and glass come later; it is drawn flat shaded in
// the site's colours.
//
// What it stands on: pieces.ts (the box), run.ts (a run as data, joints, snapping, overlap, text),
// table.ts (Mote's physics for a run), supports.ts (pillars), checks.ts (the marks), orbit.ts (the
// camera), runs.ts (made runs to start from).
//
// One finger or the main button on a piece carries it; on the ground it turns the view; two fingers,
// the other button, or Shift with the main one, move the view along; a pinch or the wheel brings it
// nearer. A piece is taken from the strip of the box under the scene by dragging it up, or put at the
// open end of the run by pressing it. Keys are listed in the mini's page and in `keys` below.

import { gl, type Color, type Look, type Part, type View } from "../mote/gl";
import { turn as turnOf, type Solid } from "../mote/space";
import { ball, block, type Mesh, type Turn, type V3 } from "../mote/solids";
import { sounds, type Sounds } from "../mote/sound";
import { el, type Hand, type Mote, type Scene } from "../mote/stage";
import { checks, type Mark } from "./checks";
import { enters, eyeOf, framing, ground, kept, panned, project, ray, type Orbit } from "./orbit";
import { BOX, CELL, LEVEL, RADIUS, blockMesh, boxToWorld, keyOf, shapeOf, sweepOf, toWorld, type Box, type Kind, type Place } from "./pieces";
import { fit, fits, jointsOf, links, open, read, snaps, write, type Open, type Placed, type Snap } from "./run";
import { RUNS } from "./runs";
import { PILLAR } from "./supports";
import { makeTable } from "./table";
import { turned } from "../mote/track";

export const label = "A marble run to build: pieces from a box snap together end to end, and marbles roll down what is built.";

/** How wide the view is, up and down, in degrees. */
const DEGREES = 38;
/** How near a piece being carried comes to a place it fits, in pixels on the screen, before it snaps there; more for a finger. */
const SNAP = { mouse: 40, touch: 60 };
/** How far a press may move, in pixels, and still be a press and not a drag. */
const STILL = 7;
/** How long a snap settles, and a piece flies from the box, in seconds. */
const SETTLE = 0.09;
const FLY = 0.28;
/** How often a stream lets a marble go, in seconds. */
const STREAM = 0.6;

/** What a piece is drawn with, in its own place: blocks of track, plain boxes, and glass. */
interface Drawing {
    wood?: Mesh;
    flat?: Mesh;
    glass?: Mesh;
}

/** One mesh of several, each moved by `by`: for drawing a piece's parts as one. */
function merged(meshes: { mesh: Mesh; by?: V3 }[], smooth: boolean): Mesh | undefined {
    if (!meshes.length) return undefined;
    const points: V3[] = [];
    const faces: number[][] = [];
    for (const { mesh, by = [0, 0, 0] } of meshes) {
        const first = points.length;
        for (const p of mesh.points) points.push([p[0] + by[0], p[1] + by[1], p[2] + by[2]]);
        for (const face of mesh.faces) faces.push(face.map((corner) => corner + first));
    }
    return { points, faces, smooth };
}

const drawings = new Map<string, Drawing>();
/** How a kind of piece is drawn, worked out once. */
function drawingOf(kind: Kind): Drawing {
    const key = keyOf(kind);
    const kept = drawings.get(key);
    if (kept) return kept;
    const shape = shapeOf(kind);
    const wood: { mesh: Mesh }[] = [];
    const glass: { mesh: Mesh }[] = [];
    for (const length of shape.lengths) {
        const piece = sweepOf(length);
        if (length.section === "tube") glass.push({ mesh: piece.mesh() });
        else {
            const path = length.path;
            const straight = "points" in path && path.points.length === 2 && path.start[0] * path.end[0] + path.start[1] * path.end[1] + path.start[2] * path.end[2] > 1 - 1e-12;
            wood.push({ mesh: blockMesh(piece, straight) });
        }
    }
    if (shape.bowl) {
        const { at, profile, thick } = shape.bowl;
        // drawn from the same numbers as the bowl a marble meets
        wood.push({ mesh: turned(at, profile, thick).mesh() });
    }
    const flat = [...shape.boxes, ...shape.stands].map((box) => ({ mesh: block(box.half), by: box.at }));
    const made: Drawing = { wood: merged(wood, true), flat: merged(flat, false), glass: merged(glass, true) };
    drawings.set(key, made);
    return made;
}

/** The turn of a piece turned by `angle` about the upright, as gl.ts takes it: a quarter turn takes x to z. */
function turnAbout(angle: number): Turn {
    const [c, s] = [Math.cos(angle), Math.sin(angle)];
    return [
        [c, 0, -s],
        [0, 1, 0],
        [s, 0, c],
    ];
}

/** The middle of a piece's cells, in its own place, at the level of its first joint: what is held when it is carried. */
function handleOf(kind: Kind): V3 {
    const cells = shapeOf(kind).cells;
    const x = cells.reduce((sum, cell) => sum + cell.x * CELL + CELL / 2, 0) / cells.length;
    const z = cells.reduce((sum, cell) => sum + cell.z * CELL + CELL / 2, 0) / cells.length;
    return [x, 0, z];
}

/** A piece's place turned a quarter about the corner of its cells nearest their middle, so that it turns where it stands. */
function turnedOnce(piece: Placed): Place {
    const handle = toWorld(piece.place, handleOf(piece.kind));
    const corner: [number, number] = [Math.round(handle[0] / CELL), Math.round(handle[2] / CELL)];
    // the origin turned a quarter about that corner, in cells: (x, z) about (a, b) goes to (a - (z - b), b + (x - a))
    const [x, z] = [piece.place.x - corner[0], piece.place.z - corner[1]];
    return { x: corner[0] - z, z: corner[1] + x, y: piece.place.y, turn: (piece.place.turn + 1) % 4 };
}

/** The same piece mirrored, kept where it stands: its first joint where it was, the piece going the same way, turning the other. */
const mirroredKind = (kind: Kind): Kind => ({ ...kind, sizes: [...kind.sizes], mirror: !kind.mirror });

/** A piece being carried: what it is, where it came from if it was in the run, where it would go, and where it is drawn. */
interface Carried {
    kind: Kind;
    /** The piece as it was in the run, to put back if it is let go where it does not fit. */
    from?: Placed;
    id: number;
    place: Place;
    snap?: Snap;
    fits: boolean;
    /** Over the box below the scene: let go there, it is taken away. */
    away: boolean;
    /** Where the piece is drawn now, easing toward where it would go. */
    shown: { at: V3; angle: number; scale: number };
    /** The difference between where the finger is on the ground and the piece's middle, so that it does not jump to the finger. */
    grab: [number, number];
    /** Which pointer carries it; none for the keyboard. */
    hand?: number;
    parts: { part: Part; look: Look; glass: boolean }[];
}

/** A pointer held down, and what it is doing. */
interface Held {
    hand: Hand;
    start: { x: number; y: number };
    last: { x: number; y: number };
    mode: "press" | "turn" | "pan" | "carry" | "pinch";
    /** The piece pressed, before the press is known to be a drag. */
    piece?: Placed;
}

export default function marbles(m: Mote): Scene {
    const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
    const under = document.createElement("canvas");
    under.className = "mote-gl";
    const view = gl(under);
    if (view) m.canvas.parentElement!.insertBefore(under, m.canvas);
    if (view) view.range = [2, 4000];
    const tint = (name: string, by = 1): Color => (view ? (view.color(m.color(name)).map((value) => value * by) as Color) : [1, 1, 1]);
    const mix = (a: Color, b: Color, t: number): Color => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
    const colors = {
        wood: tint("--muted", 0.95),
        flat: tint("--muted", 0.7),
        glass: tint("--ink"),
        pillar: tint("--rule", 1.35),
        table: tint("--surface", 1.05),
        lines: tint("--rule", 1.1),
        accent: tint("--accent"),
        warn: view?.color("oklch(0.84 0.13 80)") ?? ([1, 0.8, 0.4] as Color),
        wrong: view?.color("oklch(0.7 0.17 25)") ?? ([1, 0.4, 0.3] as Color),
    };
    const sound: Sounds | undefined = m.preview ? undefined : sounds(m);

    const table = makeTable();
    let run: Placed[] = [];
    let nextId = 1;
    let marks: Mark[] = [];
    let selected: number | undefined;
    /** The open joint the next piece pressed in the box goes to. */
    let end: Open | undefined;
    let playing = true;
    let streaming = false;
    let streamWait = 0;
    let carried: Carried | undefined;
    const held = new Map<number, Held>();
    /** Pieces flying from the box to their place, or back to it, drawn until they arrive. */
    const flying: { parts: { part: Part }[]; from: { at: V3; angle: number; scale: number }; to: { at: V3; angle: number; scale: number }; time: number; then: () => void }[] = [];
    let orbit: Orbit = { at: [0, 10, 0], turn: 0.75, tip: 0.62, far: 220 };
    /** Where the camera eases to, when fitting the run. */
    let easing: { from: Orbit; to: Orbit; time: number } | undefined;

    // ---- drawing ----
    /** A part of a piece as drawn: its look, kept to change its color, the color it has when nothing is said of it, and whether it is glass, which keeps its color. */
    type Drawn = { part: Part; look: Look; base: Color; glass: boolean };
    const drawn = new Map<number, { key: string; parts: Drawn[] }>();
    const marbleParts = new Map<Solid, Part[]>();
    let pillarParts: Part[] = [];
    let markParts: Part[] = [];
    const pillarMeshes = new Map<number, Mesh>();
    const disc = block([1.2, 0.15, 1.2]);
    const marble = ball(RADIUS, 18, 10);
    const halves = [0, 1].map((side): Mesh => ({ ...marble, faces: marble.faces.filter((_, face) => Math.floor(face / 10) < 9 === (side === 0)) }));
    let hues = 0;

    const lookOf = (which: keyof Drawing, color: Color, alpha = 1): Look => ({ color, gloss: which === "glass" ? 0.5 : 0.12, alpha: which === "glass" ? Math.min(alpha, 0.38) : alpha, casts: which !== "glass" && alpha >= 1 });
    /** Parts for a kind of piece, at a place, in a color; see-through for a piece carried. */
    const partsOf = (kind: Kind, alpha = 1, color?: Color) => {
        if (!view) return [];
        const drawing = drawingOf(kind);
        const out: Drawn[] = [];
        for (const which of ["wood", "flat", "glass"] as const) {
            const mesh = drawing[which];
            if (!mesh) continue;
            const base = which === "glass" ? colors.glass : color ?? colors[which];
            const look = lookOf(which, base, alpha);
            out.push({ part: view.add(mesh, look), look, base, glass: which === "glass" });
        }
        return out;
    };
    const pose = (parts: { part: Part }[], at: V3, angle: number, scale = 1) => {
        const turn = turnAbout(angle);
        for (const { part } of parts) {
            part.at = at;
            part.turn = turn;
            part.scale = scale;
        }
    };
    const originOf = (place: Place): V3 => [place.x * CELL, place.y * LEVEL, place.z * CELL];
    const angleOf = (place: Place) => (place.turn * Math.PI) / 2;

    /** The table and the lines of its grid, every cell, once. */
    if (view) {
        const reach = 20 * CELL;
        view.add(block([reach + 8, 1, reach + 8]), { color: colors.table, gloss: 0 }).at = [0, -1, 0];
        const lines: { mesh: Mesh; by: V3 }[] = [];
        for (let i = -20; i <= 20; i++) {
            lines.push({ mesh: block([0.08, 0.01, reach]), by: [i * CELL, 0.01, 0] });
            lines.push({ mesh: block([reach, 0.01, 0.08]), by: [0, 0.01, i * CELL] });
        }
        view.add(merged(lines, false)!, { color: colors.lines, gloss: 0, casts: false });
    }

    /** Every piece's drawing made to match the run: new ones added, gone ones taken away, colors for what is selected or marked. */
    const redraw = () => {
        if (!view) return;
        for (const [id, one] of drawn) {
            if (run.some((piece) => piece.id === id && !(carried?.from?.id === id))) continue;
            for (const { part } of one.parts) view.remove(part);
            drawn.delete(id);
        }
        for (const piece of run) {
            let one = drawn.get(piece.id);
            const key = keyOf(piece.kind);
            if (one && one.key !== key) {
                for (const { part } of one.parts) view.remove(part);
                one = undefined;
            }
            if (!one) {
                one = { key, parts: partsOf(piece.kind) };
                drawn.set(piece.id, one);
            }
            pose(one.parts, originOf(piece.place), angleOf(piece.place));
            const marked = marks.some((mark) => mark.id === piece.id && mark.why !== "open");
            for (const part of one.parts) {
                if (part.glass) continue;
                part.look.color = piece.id === selected ? mix(part.base, colors.accent, 0.55) : marked ? mix(part.base, colors.warn, 0.6) : part.base;
            }
        }
        // the pillars, from the table, each height's mesh made once
        for (const part of pillarParts) view.remove(part);
        pillarParts = table.pillars.map((pillar) => {
            let mesh = pillarMeshes.get(pillar.top);
            if (!mesh) pillarMeshes.set(pillar.top, (mesh = block([PILLAR / 2, pillar.top / 2, PILLAR / 2])));
            const part = view.add(mesh, { color: colors.pillar, gloss: 0.05 });
            part.at = [pillar.x, pillar.top / 2, pillar.z];
            return part;
        });
        // a small flat mark on each open end that is not a tray's, and a ring where the next piece goes
        for (const part of markParts) view.remove(part);
        markParts = [];
        for (const mark of marks.filter((one) => one.why === "open")) {
            const joint = run.find((piece) => piece.id === mark.id) && jointsOf(run.find((piece) => piece.id === mark.id)!)[mark.joint!];
            if (!joint) continue;
            const part = view.add(disc, { color: colors.warn, gloss: 0, casts: false });
            part.at = [joint.at[0] + joint.way[0] * 1.4, joint.at[1] + 0.2, joint.at[2] + joint.way[2] * 1.4];
            markParts.push(part);
        }
        if (end && !carried) {
            const part = view.add(disc, { color: colors.accent, gloss: 0, casts: false });
            part.at = [end.at[0] + end.way[0] * 1.4, end.at[1] + 0.35, end.at[2] + end.way[2] * 1.4];
            part.scale = 0.8;
            markParts.push(part);
        }
        // the sun's box, round the run
        const [low, high] = bounds();
        view.light([low[0] - 80, high[1] + 220, high[2] + 140], [low[0] - 10, 0, low[2] - 10], [high[0] + 10, high[1] + 10, high[2] + 10], 1.5, 0.62, 0.32);
    };

    /** The least and greatest corners of everything in the run, or of a patch of table if it is empty. */
    const bounds = (): [V3, V3] => {
        const boxes: Box[] = run.flatMap((piece) => shapeOf(piece.kind).room.map((box) => boxToWorld(piece.place, box)));
        if (!boxes.length) return [[-40, 0, -40], [40, 20, 40]];
        const low: V3 = [Infinity, 0, Infinity];
        const high: V3 = [-Infinity, -Infinity, -Infinity];
        for (const box of boxes) {
            for (let axis = 0; axis < 3; axis++) {
                low[axis] = Math.min(low[axis]!, box.at[axis]! - box.half[axis]!);
                high[axis] = Math.max(high[axis]!, box.at[axis]! + box.half[axis]!);
            }
        }
        low[1] = 0;
        return [low, high];
    };

    // ---- the run changes ----
    const changed = () => {
        table.set(run.filter((piece) => piece.id !== carried?.from?.id));
        marks = checks(run.filter((piece) => piece.id !== carried?.from?.id));
        if (end && !open(run).some((joint) => joint.id === end!.id && joint.joint === end!.joint)) end = undefined;
        if (!end) end = lastEnd();
        if (!m.preview) m.keep("marbles-run", write(run), 1);
        redraw();
        tell();
        m.wake();
    };
    /** The open end of the piece placed last that has one, other than a tray's or a hopper's way in. */
    const lastEnd = (): Open | undefined => {
        const ends = open(run.filter((piece) => piece.id !== carried?.from?.id));
        for (let i = run.length - 1; i >= 0; i--) {
            const found = ends.find((joint) => joint.id === run[i]!.id && run[i]!.kind.family !== "t");
            if (found) return found;
        }
        return undefined;
    };
    const load = (text: string) => {
        try {
            run = read(text);
        } catch {
            run = read(RUNS[0]!.text);
        }
        nextId = run.reduce((most, piece) => Math.max(most, piece.id), 0) + 1;
        selected = undefined;
        table.clear();
        end = undefined;
        changed();
    };

    // ---- the camera ----
    const aspect = () => Math.max(0.2, m.width / Math.max(1, m.height));
    const toPicture = (x: number, y: number): [number, number] => [(x / Math.max(1, m.width)) * 2 - 1, 1 - (y / Math.max(1, m.height)) * 2];
    const lineAt = (x: number, y: number) => ray(orbit, DEGREES, aspect(), ...toPicture(x, y));
    const onScreen = (p: V3): { x: number; y: number } | undefined => {
        const seen = project(orbit, DEGREES, aspect(), p);
        return seen && { x: ((seen.x + 1) / 2) * m.width, y: ((1 - seen.y) / 2) * m.height };
    };
    const fitRun = (now = false) => {
        const [low, high] = bounds();
        const to = framing(orbit, DEGREES, aspect(), low, high);
        if (now || reduced) {
            orbit = to;
            easing = undefined;
        } else easing = { from: orbit, to, time: 0 };
        m.wake();
    };

    /** The piece of the run under a point of the picture, by the boxes of room it takes up, a little larger for a finger. */
    const pieceAt = (x: number, y: number, wide = 1.2): Placed | undefined => {
        const line = lineAt(x, y);
        let best: { piece: Placed; t: number } | undefined;
        for (const piece of run) {
            if (piece.id === carried?.from?.id) continue;
            for (const box of shapeOf(piece.kind).room) {
                const placed = boxToWorld(piece.place, box);
                const t = enters(line, placed.at, [placed.half[0] + wide, placed.half[1] + wide * 0.5, placed.half[2] + wide]);
                if (t !== undefined && (!best || t < best.t)) best = { piece, t };
            }
        }
        return best?.piece;
    };

    // ---- carrying a piece ----
    const startCarry = (kind: Kind, from: Placed | undefined, hand: Hand | undefined, at?: { x: number; y: number }) => {
        if (!view) return;
        const id = from?.id ?? nextId++;
        const place = from ? { ...from.place } : { x: 0, z: 0, y: -shapeOf(kind).low, turn: 0 };
        const parts = partsOf(kind, 0.62, colors.accent);
        let grab: [number, number] = [0, 0];
        if (from && at) {
            // held where the finger is on it, not by its middle
            const handle = toWorld(from.place, handleOf(kind));
            const point = ground(lineAt(at.x, at.y), handle[1]);
            if (point) grab = [handle[0] - point[0], handle[2] - point[2]];
        }
        const shown = from ? { at: originOf(from.place), angle: angleOf(from.place), scale: 1 } : { at: originOf(place), angle: 0, scale: 0.4 };
        carried = { kind, from, id, place, fits: false, away: false, shown, grab, hand: hand?.id, parts };
        selected = id;
        if (from) changed();
        if (at) follow(at.x, at.y, hand?.kind === "touch" ? "touch" : "mouse", !from);
        m.wake();
    };

    /** Where the piece being carried would go, from where the pointer is: snapped to an open joint near enough, or free on the grid. */
    const follow = (x: number, y: number, kind: "mouse" | "touch", first = false) => {
        const one = carried;
        if (!one) return;
        const shape = shapeOf(one.kind);
        one.away = y > m.height;
        const line = lineAt(x, Math.min(y, m.height));
        // at the level of what is under the pointer, by the nearest of its joints; over the table, at the
        // level of the open end nearest the pointer, where it is most likely going; standing on the ground
        // when the run has no open end
        const below = pieceAt(x, Math.min(y, m.height), 0);
        let level = -shape.low;
        const nearest = open(run.filter((piece) => piece.id !== one.id))
            .map((joint) => ({ joint, seen: onScreen(joint.at) }))
            .filter((found) => found.seen)
            .sort((a, b) => Math.hypot(a.seen!.x - x, a.seen!.y - y) - Math.hypot(b.seen!.x - x, b.seen!.y - y))[0];
        if (!below && nearest) level = Math.max(level, Math.round(nearest.joint.at[1] / LEVEL));
        if (below) {
            const hit = jointsOf(below).map((joint) => ({ joint, d: Math.hypot(...line.way.map((w, axis) => joint.at[axis]! - line.from[axis]! - w * ((joint.at[0] - line.from[0]) * line.way[0] + (joint.at[1] - line.from[1]) * line.way[1] + (joint.at[2] - line.from[2]) * line.way[2]))) })).sort((a, b) => a.d - b.d)[0];
            if (hit) level = Math.max(level, Math.round(hit.joint.at[1] / LEVEL));
        }
        const point = ground(line, level * LEVEL);
        if (point) {
            const handle = handleOf(one.kind);
            const turnNow = one.snap ? one.place.turn : one.place.turn;
            const turned = toWorld({ x: 0, z: 0, y: 0, turn: turnNow }, handle);
            one.place = { x: Math.round((point[0] + one.grab[0] - turned[0]) / CELL), z: Math.round((point[2] + one.grab[1] - turned[2]) / CELL), y: level, turn: turnNow };
        }
        // the nearest place it fits against an open joint, by where its middle would be on the screen
        const others = run.filter((piece) => piece.id !== one.id);
        let best: { snap: Snap; d: number } | undefined;
        for (const snap of snaps(others, one.kind)) {
            const seen = onScreen(toWorld(snap.place, handleOf(one.kind)));
            if (!seen) continue;
            const d = Math.hypot(seen.x - x, seen.y - y);
            if (!best || d < best.d) best = { snap, d };
        }
        const reach = SNAP[kind] * (one.snap ? 1.4 : 1);
        const was = one.snap;
        one.snap = best && best.d < reach && !one.away ? best.snap : undefined;
        if (one.snap) {
            one.place = { ...one.snap.place };
            one.fits = true;
            const same = was && was.to.id === one.snap.to.id && was.to.joint === one.snap.to.joint && was.joint === one.snap.joint;
            if (!same) sound?.knock(0.55, 2100);
        } else one.fits = fits(others, { id: one.id, kind: one.kind, place: one.place });
        if (first) one.shown = { at: originOf(one.place), angle: angleOf(one.place), scale: 0.4 };
        paintCarried();
        m.wake();
    };

    const paintCarried = () => {
        const one = carried;
        if (!one) return;
        const color = one.away ? colors.flat : one.fits ? colors.accent : colors.wrong;
        for (const { look, glass } of one.parts) if (!glass) look.color = color;
    };

    /** Lets go of the piece carried: put in the run where it fits, taken away over the box, or back where it was. */
    const drop = () => {
        const one = carried;
        if (!one) return;
        carried = undefined;
        const target: Placed = { id: one.id, kind: one.kind, place: one.place };
        const removeParts = () => {
            for (const { part } of one.parts) view?.remove(part);
        };
        if (one.away) {
            run = run.filter((piece) => piece.id !== one.id);
            if (selected === one.id) selected = undefined;
            fly(one.parts, one.shown, { ...one.shown, at: [one.shown.at[0], one.shown.at[1] - 6, one.shown.at[2]], scale: 0.05 }, removeParts);
            sound?.knock(0.3, 500);
        } else if (one.fits) {
            const at = run.findIndex((piece) => piece.id === one.id);
            if (at >= 0) run[at] = target;
            else run.push(target);
            const ends = open(run).filter((joint) => joint.id === one.id);
            end = ends[0];
            fly(one.parts, one.shown, { at: originOf(one.place), angle: angleOf(one.place), scale: 1 }, removeParts);
            if (!one.snap) sound?.knock(0.35, 1300);
        } else if (one.from) {
            // back where it came from, as it was
            fly(one.parts, one.shown, { at: originOf(one.from.place), angle: angleOf(one.from.place), scale: 1 }, removeParts);
        } else {
            fly(one.parts, one.shown, { ...one.shown, scale: 0.05 }, removeParts);
        }
        changed();
    };

    const fly = (parts: { part: Part }[], from: Carried["shown"], to: Carried["shown"], then: () => void) => {
        if (reduced) {
            then();
            return;
        }
        // the shorter way round
        let angle = to.angle;
        while (angle - from.angle > Math.PI) angle -= 2 * Math.PI;
        while (angle - from.angle < -Math.PI) angle += 2 * Math.PI;
        flying.push({ parts, from: { ...from }, to: { ...to, angle }, time: 0, then });
        m.wake();
    };

    /** A piece from the box put at the open end, the first way round that fits; at the middle of the view if the run is empty. */
    const placeAtEnd = (kind: Kind, from?: { x: number; y: number }): boolean => {
        const ends = end ? [end, ...open(run).filter((joint) => joint !== end && !(joint.id === end!.id && joint.joint === end!.joint))] : open(run);
        let place: Place | undefined;
        let snapped: Open | undefined;
        outer: for (const to of ends) {
            const piece = run.find((one) => one.id === to.id);
            if (piece?.kind.family === "t") continue;
            for (let joint = 0; joint < shapeOf(kind).joints.length; joint++) {
                const tried = fit(kind, joint, to);
                if (tried && fits(run, { id: -1, kind, place: tried })) {
                    place = tried;
                    snapped = to;
                    break outer;
                }
            }
        }
        if (!place && !run.length) {
            const middle = ground(lineAt(m.width / 2, m.height / 2), 0) ?? [0, 0, 0];
            place = { x: Math.round(middle[0] / CELL), z: Math.round(middle[2] / CELL), y: -shapeOf(kind).low, turn: 0 };
        }
        if (!place) return false;
        const piece: Placed = { id: nextId++, kind, place };
        run.push(piece);
        selected = piece.id;
        end = open(run).find((joint) => joint.id === piece.id);
        if (view && !reduced) {
            // from under the box's strip, rising into place
            const start = ground(lineAt(from?.x ?? m.width / 2, m.height - 4), place.y * LEVEL) ?? originOf(place);
            const parts = partsOf(kind, 0.62, colors.accent);
            const handle = toWorld({ x: 0, z: 0, y: 0, turn: place.turn }, handleOf(kind));
            changed();
            // the piece itself is hidden until what flies there arrives
            for (const { part } of drawn.get(piece.id)?.parts ?? []) part.hidden = true;
            fly(parts, { at: [start[0] - handle[0], start[1], start[2] - handle[2]], angle: angleOf(place) - 0.6, scale: 0.4 }, { at: originOf(place), angle: angleOf(place), scale: 1 }, () => {
                for (const { part } of parts) view.remove(part);
                for (const { part } of drawn.get(piece.id)?.parts ?? []) part.hidden = false;
                if (snapped) sound?.knock(0.55, 2100);
            });
        } else {
            changed();
            if (snapped) sound?.knock(0.55, 2100);
        }
        return true;
    };

    // ---- what the panel's buttons and the keys do ----
    const letGo = () => {
        const out = table.letGo();
        for (const one of out) show(one);
        m.wake();
    };
    const show = (one: Solid) => {
        if (!view || marbleParts.has(one)) return;
        const hue = (hues++ * 47) % 360;
        marbleParts.set(one, [view.add(halves[0]!, { color: view.color(`oklch(0.76 0.14 ${hue})`), gloss: 0.7 }), view.add(halves[1]!, { color: view.color(`oklch(0.48 0.12 ${hue})`), gloss: 0.7 })]);
    };
    table.gone = (one) => {
        for (const part of marbleParts.get(one) ?? []) view?.remove(part);
        marbleParts.delete(one);
    };
    table.space.hit = (a, b, speed) => {
        if (!sound) return;
        const both = a.radius !== undefined && b.radius !== undefined;
        sound.knock(Math.min(1, speed / 160), both ? 2600 : a.piece || b.piece ? 900 : 600);
    };
    const turnSelected = () => {
        const piece = run.find((one) => one.id === selected);
        if (carried) {
            carried.place = { ...carried.place, turn: (carried.place.turn + 1) % 4 };
            carried.snap = undefined;
            carried.fits = fits(run.filter((one) => one.id !== carried!.id), { id: carried.id, kind: carried.kind, place: carried.place });
            paintCarried();
            m.wake();
            return;
        }
        if (!piece) return;
        // at an end it is joined by, a piece turned is the next way round it fits there; otherwise it turns where it stands
        const place = turnedOnce(piece);
        const others = run.filter((one) => one.id !== piece.id);
        if (fits(others, { ...piece, place })) {
            run = run.map((one) => (one.id === piece.id ? { ...one, place } : one));
            sound?.knock(0.3, 1500);
            changed();
        } else refuse();
    };
    const mirrorSelected = () => {
        if (carried) {
            const kind = mirroredKind(carried.kind);
            for (const { part } of carried.parts) view?.remove(part);
            carried.kind = kind;
            carried.parts = partsOf(kind, 0.62, colors.accent);
            carried.snap = undefined;
            carried.fits = fits(run.filter((one) => one.id !== carried!.id), { id: carried.id, kind, place: carried.place });
            paintCarried();
            m.wake();
            return;
        }
        const piece = run.find((one) => one.id === selected);
        if (!piece) return;
        const kind = mirroredKind(piece.kind);
        if (fits(run.filter((one) => one.id !== piece.id), { ...piece, kind })) {
            run = run.map((one) => (one.id === piece.id ? { ...one, kind } : one));
            changed();
        } else refuse();
    };
    /** The chosen piece a level up or down, where it stands, if it fits there; a piece carried by keys is moved with it. */
    const raise = (by: number) => {
        if (carried) {
            nudge(0, 0, by);
            return;
        }
        const piece = run.find((one) => one.id === selected);
        if (!piece) return;
        const place = { ...piece.place, y: piece.place.y + by };
        if (fits(run.filter((one) => one.id !== piece.id), { ...piece, place })) {
            run = run.map((one) => (one.id === piece.id ? { ...one, place } : one));
            sound?.knock(0.25, by > 0 ? 1700 : 1100);
            changed();
        } else refuse();
    };
    const removeSelected = () => {
        if (carried) {
            carried.away = true;
            drop();
            return;
        }
        const piece = run.find((one) => one.id === selected);
        if (!piece) return;
        const one = drawn.get(piece.id);
        run = run.filter((other) => other.id !== piece.id);
        selected = undefined;
        if (one && view && !reduced) {
            const parts = partsOf(piece.kind, 0.62, colors.flat);
            fly(parts, { at: originOf(piece.place), angle: angleOf(piece.place), scale: 1 }, { at: [piece.place.x * CELL, piece.place.y * LEVEL - 6, piece.place.z * CELL], angle: angleOf(piece.place), scale: 0.05 }, () => {
                for (const { part } of parts) view.remove(part);
            });
        }
        sound?.knock(0.3, 500);
        changed();
    };
    /** A small shake of the piece that could not be turned there: it says no without words. */
    let shake = 0;
    const refuse = () => {
        shake = reduced ? 0 : 0.25;
        sound?.knock(0.2, 300);
        m.wake();
    };
    const selectStep = (by: number) => {
        if (!run.length) return;
        const at = run.findIndex((piece) => piece.id === selected);
        const next = run[(at + by + run.length) % run.length]!;
        selected = next.id;
        end = open(run).find((joint) => joint.id === next.id) ?? end;
        redraw();
        tell();
        m.wake();
    };
    /** The keyboard's way of carrying: lift the selected piece and move it a cell, a level, or turn it. */
    const nudge = (dx: number, dz: number, dy: number) => {
        if (!carried) {
            const piece = run.find((one) => one.id === selected);
            if (!piece) return;
            startCarry(piece.kind, piece, undefined);
        }
        const one = carried!;
        // across and along as the view sees them: the arrows move a piece the way it looks to go
        const quarter = Math.round(orbit.turn / (Math.PI / 2));
        let [x, z] = [dx, dz];
        for (let i = 0; i < ((quarter % 4) + 4) % 4; i++) [x, z] = [z, 0 - x];
        one.place = { ...one.place, x: one.place.x + x, z: one.place.z + z, y: Math.max(-shapeOf(one.kind).low, one.place.y + dy) };
        one.snap = undefined;
        one.fits = fits(run.filter((piece) => piece.id !== one.id), { id: one.id, kind: one.kind, place: one.place });
        // joined by where it is: a click when it comes to meet an open end exactly
        if (one.fits && links([...run.filter((piece) => piece.id !== one.id), { id: one.id, kind: one.kind, place: one.place }]).some(([a, b]) => a.id === one.id || b.id === one.id)) sound?.knock(0.55, 2100);
        paintCarried();
        m.wake();
    };

    // ---- the panel ----
    let tell = () => {};
    if (!m.preview) {
        const panel = m.panel();
        const strip = el("div", { class: "marbles-box", role: "toolbar", ariaLabel: "the box of pieces" });
        const pictures = paintBox(view, colors);
        BOX.forEach((entry, index) => {
            const button = el("button", { type: "button", class: "marbles-piece", title: entry.name, ariaLabel: `${entry.name}: press to put it at the end of the run, or drag it up into the scene` }, pictures[index] ?? "", el("span", { textContent: entry.name }));
            let pressed: { id: number; x: number; y: number; dragging: boolean } | undefined;
            /** A drag out of the box ends with the browser's click on the button, which is not a press. */
            let dragged = false;
            button.addEventListener("pointerdown", (event) => {
                pressed = { id: event.pointerId, x: event.clientX, y: event.clientY, dragging: false };
                button.setPointerCapture(event.pointerId);
            });
            button.addEventListener("pointermove", (event) => {
                if (!pressed || pressed.id !== event.pointerId) return;
                const rect = m.canvas.getBoundingClientRect();
                const [x, y] = [event.clientX - rect.left, event.clientY - rect.top];
                if (!pressed.dragging && pressed.y - event.clientY > STILL * 2) {
                    pressed.dragging = true;
                    startCarry({ ...entry.kind, sizes: [...entry.kind.sizes] }, undefined, undefined, { x, y });
                }
                if (pressed.dragging) follow(x, y, event.pointerType === "touch" ? "touch" : "mouse");
            });
            const finish = (event: PointerEvent, cancelled: boolean) => {
                if (!pressed || pressed.id !== event.pointerId) return;
                const was = pressed;
                pressed = undefined;
                if (was.dragging) {
                    dragged = true;
                    if (cancelled && carried) carried.away = true;
                    drop();
                }
            };
            button.addEventListener("pointerup", (event) => finish(event, false));
            button.addEventListener("pointercancel", (event) => finish(event, true));
            button.addEventListener("click", () => {
                if (dragged) {
                    dragged = false;
                    return;
                }
                const rect = m.canvas.getBoundingClientRect();
                const own = button.getBoundingClientRect();
                if (!placeAtEnd({ ...entry.kind, sizes: [...entry.kind.sizes] }, { x: own.left + own.width / 2 - rect.left, y: 0 })) {
                    button.animate?.([{ translate: "0" }, { translate: "-3px" }, { translate: "3px" }, { translate: "0" }], { duration: reduced ? 0 : 220 });
                    sound?.knock(0.2, 300);
                }
            });
            strip.append(button);
        });
        const go = el("button", { type: "button", textContent: "let one go", onclick: letGo });
        const stream = el("button", { type: "button", class: "quiet", textContent: "stream", onclick: () => {
            streaming = !streaming;
            streamWait = 0;
            tell();
            m.wake();
        } });
        const pause = el("button", { type: "button", class: "quiet", textContent: "pause", onclick: () => {
            playing = !playing;
            tell();
            m.wake();
        } });
        const reset = el("button", { type: "button", class: "quiet", textContent: "clear marbles", onclick: () => {
            table.clear();
            m.wake();
        } });
        const frame = el("button", { type: "button", class: "quiet", textContent: "fit the run", onclick: () => fitRun() });
        const turnButton = el("button", { type: "button", class: "quiet", textContent: "turn", onclick: turnSelected });
        const mirrorButton = el("button", { type: "button", class: "quiet", textContent: "mirror", onclick: mirrorSelected });
        const removeButton = el("button", { type: "button", class: "quiet", textContent: "take away", onclick: removeSelected });
        const raiseButton = el("button", { type: "button", class: "quiet", textContent: "raise", onclick: () => raise(1) });
        const lowerButton = el("button", { type: "button", class: "quiet", textContent: "lower", onclick: () => raise(-1) });
        const said = el("p", { class: "marbles-said" });
        const made = el("p", { class: "marbles-runs" }, "start from: ");
        RUNS.forEach((one, i) => {
            if (i) made.append(" · ");
            made.append(el("button", { type: "button", class: "quiet", textContent: one.name, onclick: () => {
                load(one.text);
                fitRun();
            } }));
        });
        made.append(" · ", el("button", { type: "button", class: "quiet", textContent: "nothing", onclick: () => load("v1") }));
        panel.append(strip, el("div", { class: "marbles-go" }, go, stream, pause, reset, frame, sound!.button), el("div", { class: "marbles-go" }, turnButton, mirrorButton, raiseButton, lowerButton, removeButton), said, made);
        tell = () => {
            stream.setAttribute("aria-pressed", String(streaming));
            stream.classList.toggle("quiet", !streaming);
            pause.textContent = playing ? "pause" : "play";
            const some = selected !== undefined && run.some((piece) => piece.id === selected);
            for (const button of [turnButton, mirrorButton, raiseButton, lowerButton, removeButton]) button.disabled = !some && !carried;
            const count = (why: Mark["why"]) => marks.filter((mark) => mark.why === why).length;
            const parts: string[] = [];
            if (count("open")) parts.push(`${count("open")} open ${count("open") === 1 ? "end" : "ends"}`);
            if (count("fast")) parts.push(`${count("fast")} ${count("fast") === 1 ? "turn" : "turns"} too fast`);
            if (count("shallow")) parts.push(`a marble stops on ${count("shallow") === 1 ? "one piece" : `${count("shallow")} pieces`}`);
            said.textContent = run.length ? (parts.length ? `${parts.join(", ")}.` : "Nothing marked.") : "An empty table. Press a piece in the box, or drag one up.";
        };
    }

    // ---- start ----
    load(m.preview ? RUNS[1]!.text : m.recall("marbles-run", RUNS[0]!.text, 1));
    const fit2 = () => view?.size(m.width, m.height);
    fit2();
    fitRun(true);

    // ---- the keyboard ----
    if (!m.preview) {
        m.canvas.addEventListener("keydown", (event) => {
            if (event.metaKey || event.ctrlKey || event.altKey) return;
            const key = event.key;
            if (event.shiftKey && key.startsWith("Arrow")) {
                if (key === "ArrowLeft") orbit = kept({ ...orbit, turn: orbit.turn - 0.15 });
                if (key === "ArrowRight") orbit = kept({ ...orbit, turn: orbit.turn + 0.15 });
                if (key === "ArrowUp") orbit = kept({ ...orbit, tip: orbit.tip + 0.08 });
                if (key === "ArrowDown") orbit = kept({ ...orbit, tip: orbit.tip - 0.08 });
            } else if (key === "ArrowLeft" || key === "a") nudge(-1, 0, 0);
            else if (key === "ArrowRight" || key === "d") nudge(1, 0, 0);
            else if (key === "ArrowUp" || key === "w") nudge(0, -1, 0);
            else if (key === "ArrowDown" || key === "s") nudge(0, 1, 0);
            else if (key === "e" || key === "PageUp") nudge(0, 0, 1);
            else if (key === "q" || key === "PageDown") nudge(0, 0, -1);
            else if (key === "r") turnSelected();
            else if (key === "f") mirrorSelected();
            else if (key === "Enter") {
                if (carried) drop();
            } else if (key === "Escape") {
                if (carried) {
                    carried.fits = false;
                    drop();
                } else {
                    selected = undefined;
                    redraw();
                    tell();
                }
            } else if (key === "Delete" || key === "Backspace") removeSelected();
            else if (key === "," || key === "[") selectStep(-1);
            else if (key === "." || key === "]") selectStep(1);
            else if (key === " ") letGo();
            else if (key === "p") {
                playing = !playing;
                tell();
            } else if (key === "Home" || key === "0") fitRun();
            else if (key === "+" || key === "=") orbit = kept({ ...orbit, far: orbit.far / 1.15 });
            else if (key === "-") orbit = kept({ ...orbit, far: orbit.far * 1.15 });
            else return;
            event.preventDefault();
            m.wake();
        });
    }

    /** Two fingers: where between them, how far apart, and at what angle, to pan, pinch and twist by. */
    let pinch: { x: number; y: number; apart: number; angle: number } | undefined;
    const pinchOf = () => {
        const [a, b] = [...held.values()].filter((one) => one.mode === "pinch").map((one) => one.last);
        if (!a || !b) return undefined;
        return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, apart: Math.hypot(a.x - b.x, a.y - b.y), angle: Math.atan2(b.y - a.y, b.x - a.x) };
    };

    let time = 0;
    /** How long the physics and the drawing take, in milliseconds, evened out over the last frames: for measuring. */
    const took = { step: 0, draw: 0 };
    // With `?test` in the address, a browser test can find the open ends on the screen and read how long a
    // frame takes. Nothing is drawn for it.
    if (!m.preview && m.link.get("test") !== null) {
        (window as unknown as { marbles: unknown }).marbles = {
            ends: () => open(run).map((joint) => ({ id: joint.id, joint: joint.joint, at: onScreen(joint.at), family: run.find((piece) => piece.id === joint.id)!.kind.family })),
            end: () => end && { id: end.id, joint: end.joint, at: onScreen(end.at) },
            screen: (p: V3) => onScreen(p),
            text: () => write(run),
            marbles: () => ({ all: table.marbles.length, arrived: table.marbles.filter(table.arrived).length, asleep: table.marbles.filter((one) => one.rest).length }),
            marks: () => marks,
            took: () => ({ ...took }),
            orbit: (next?: Partial<Orbit>) => {
                if (next) orbit = kept({ ...orbit, ...next });
                m.wake();
                return orbit;
            },
        };
    }
    return {
        down(hand) {
            if (m.preview) return;
            easing = undefined;
            const one: Held = { hand, start: { x: hand.x, y: hand.y }, last: { x: hand.x, y: hand.y }, mode: "press" };
            const fingers = [...held.values()].filter((other) => other.hand.kind === "touch");
            if (hand.kind === "touch" && fingers.length === 1 && fingers[0]!.mode !== "carry") {
                // a second finger: the two pan, pinch and twist the view together
                fingers[0]!.mode = "pinch";
                one.mode = "pinch";
                held.set(hand.id, one);
                pinch = pinchOf();
                return;
            }
            if (hand.kind === "touch" && fingers.length >= 1) return;
            if (hand.button === 2 || hand.button === 1 || (hand.button === 0 && hand.shift)) one.mode = "pan";
            else one.piece = pieceAt(hand.x, hand.y);
            held.set(hand.id, one);
        },
        slide(hand) {
            const one = held.get(hand.id);
            if (!one) return;
            const [dx, dy] = [hand.x - one.last.x, hand.y - one.last.y];
            one.last = { x: hand.x, y: hand.y };
            if (one.mode === "pinch") {
                const now = pinchOf();
                if (now && pinch) {
                    orbit = panned(orbit, DEGREES, -(now.x - pinch.x) / m.height, -(now.y - pinch.y) / m.height);
                    orbit = kept({ ...orbit, far: orbit.far * (pinch.apart / Math.max(1, now.apart)), turn: orbit.turn - (now.angle - pinch.angle) });
                }
                pinch = now;
            } else if (one.mode === "press") {
                if (Math.hypot(hand.x - one.start.x, hand.y - one.start.y) < STILL) return;
                if (one.piece) {
                    one.mode = "carry";
                    startCarry(one.piece.kind, one.piece, hand, one.start);
                    follow(hand.x, hand.y, hand.kind === "touch" ? "touch" : "mouse");
                } else one.mode = "turn";
            } else if (one.mode === "carry") follow(hand.x, hand.y, hand.kind === "touch" ? "touch" : "mouse");
            else if (one.mode === "turn") orbit = kept({ ...orbit, turn: orbit.turn - dx * 0.008, tip: orbit.tip + dy * 0.006 });
            else if (one.mode === "pan") orbit = panned(orbit, DEGREES, -dx / m.height, -dy / m.height);
            m.wake();
        },
        up(hand, cancelled) {
            const one = held.get(hand.id);
            held.delete(hand.id);
            if (!one) return;
            if (one.mode === "pinch") {
                // the finger left behind carries on turning the view, from where it is
                for (const other of held.values()) if (other.mode === "pinch") other.mode = "turn";
                pinch = undefined;
            } else if (one.mode === "carry") {
                if (cancelled && carried) {
                    carried.fits = false;
                    carried.away = false;
                }
                drop();
            } else if (one.mode === "press") {
                // a press that did not move: on a piece it is chosen, on the table nothing is
                selected = one.piece?.id;
                if (one.piece) end = open(run).find((joint) => joint.id === one.piece!.id) ?? end;
                redraw();
                tell();
            }
            m.wake();
        },
        wheel(_x, _y, by, isPinch) {
            orbit = kept({ ...orbit, far: orbit.far * Math.exp(by * (isPinch ? 0.01 : 0.0012)) });
            easing = undefined;
            m.wake();
        },
        step(dt) {
            time += dt;
            if (streaming && playing) {
                streamWait -= dt;
                if (streamWait <= 0) {
                    streamWait = STREAM;
                    letGo();
                }
            }
            if (m.preview) {
                streamWait -= dt;
                if (streamWait <= 0) {
                    streamWait = 1.4;
                    letGo();
                }
            }
            const before = performance.now();
            if (playing) table.step(dt);
            took.step += (performance.now() - before - took.step) * 0.05;
            // the piece carried eases to where it would go: quick to start and slow to settle
            if (carried) {
                const target = { at: originOf(carried.place), angle: angleOf(carried.place) };
                const k = reduced ? 1 : 1 - Math.exp(-dt / SETTLE);
                let angle = target.angle;
                while (angle - carried.shown.angle > Math.PI) angle -= 2 * Math.PI;
                while (angle - carried.shown.angle < -Math.PI) angle += 2 * Math.PI;
                const s = carried.shown;
                carried.shown = { at: [s.at[0] + (target.at[0] - s.at[0]) * k, s.at[1] + (target.at[1] - s.at[1]) * k, s.at[2] + (target.at[2] - s.at[2]) * k], angle: s.angle + (angle - s.angle) * k, scale: s.scale + (1 - s.scale) * k };
            }
            for (let i = flying.length - 1; i >= 0; i--) {
                const one = flying[i]!;
                one.time = Math.min(FLY, one.time + dt);
                if (one.time >= FLY) {
                    flying.splice(i, 1);
                    one.then();
                }
            }
            if (easing) {
                easing.time = Math.min(1, easing.time + dt / 0.45);
                const k = 1 - (1 - easing.time) ** 3;
                const [a, b] = [easing.from, easing.to];
                orbit = { at: [a.at[0] + (b.at[0] - a.at[0]) * k, a.at[1] + (b.at[1] - a.at[1]) * k, a.at[2] + (b.at[2] - a.at[2]) * k], turn: a.turn + (b.turn - a.turn) * k, tip: a.tip + (b.tip - a.tip) * k, far: a.far + (b.far - a.far) * k };
                if (easing.time >= 1) easing = undefined;
            }
            shake = Math.max(0, shake - dt);
        },
        resting: () => !m.preview && !carried && !flying.length && !easing && !streaming && shake <= 0 && (!playing || table.marbles.every((one) => one.rest)) && !held.size,
        resize: fit2,
        debug: () => [`${run.length} pieces, ${table.marbles.length} marbles, ${table.marbles.filter((one) => one.rest).length} asleep`],
        destroy: () => view?.dispose(),
        draw() {
            if (!view) return;
            const eye = eyeOf(orbit);
            view.look(eye, orbit.at, DEGREES);
            // a refused turn shakes the selected piece a little, side to side, dying away
            const wobble = shake > 0 ? Math.sin(shake * 60) * shake * 1.2 : 0;
            const chosen = drawn.get(selected ?? -1);
            const piece = run.find((one) => one.id === selected);
            if (chosen && piece) pose(chosen.parts, [piece.place.x * CELL + wobble, piece.place.y * LEVEL, piece.place.z * CELL], angleOf(piece.place));
            if (carried) pose(carried.parts, carried.shown.at, carried.shown.angle, carried.shown.scale);
            for (const one of flying) {
                const t = one.time / FLY;
                const k = 1 - (1 - t) ** 3;
                const [a, b] = [one.from, one.to];
                pose(one.parts, [a.at[0] + (b.at[0] - a.at[0]) * k, a.at[1] + (b.at[1] - a.at[1]) * k + Math.sin(Math.PI * t) * 3, a.at[2] + (b.at[2] - a.at[2]) * k], a.angle + (b.angle - a.angle) * k, a.scale + (b.scale - a.scale) * k);
            }
            for (const one of [...table.marbles, ...table.held()]) {
                if (!marbleParts.has(one)) show(one);
                const parts = marbleParts.get(one)!;
                const turn = turnOf(one);
                for (const part of parts) {
                    part.at = one.p;
                    part.turn = turn;
                }
            }
            const before = performance.now();
            view.draw();
            took.draw += (performance.now() - before - took.draw) * 0.05;
        },
    };
}

/** Small pictures of every piece of the box, drawn by the same code and in the same colours as the scene, each on a canvas of its own. */
function paintBox(view: View | undefined, colors: Record<string, Color>): HTMLCanvasElement[] {
    const size = 128;
    const pictures: HTMLCanvasElement[] = [];
    if (!view) return pictures;
    const canvas = document.createElement("canvas");
    canvas.width = size;
    canvas.height = size;
    const own = gl(canvas);
    if (!own) return pictures;
    own.range = [1, 2000];
    own.size(size / Math.min(window.devicePixelRatio || 1, 2), size / Math.min(window.devicePixelRatio || 1, 2));
    for (const entry of BOX) {
        const shape = shapeOf(entry.kind);
        const drawing = drawingOf(entry.kind);
        const parts = (["wood", "flat", "glass"] as const).flatMap((which) => {
            const mesh = drawing[which];
            return mesh ? [own.add(mesh, { color: colors[which] ?? colors.wood!, gloss: which === "glass" ? 0.5 : 0.12, alpha: which === "glass" ? 0.38 : 1 })] : [];
        });
        // framed from the same corner for every piece, so that their sizes can be told apart
        const low: V3 = [Infinity, Infinity, Infinity];
        const high: V3 = [-Infinity, -Infinity, -Infinity];
        for (const box of shape.room) {
            for (let axis = 0; axis < 3; axis++) {
                low[axis] = Math.min(low[axis]!, box.at[axis]! - box.half[axis]!);
                high[axis] = Math.max(high[axis]!, box.at[axis]! + box.half[axis]!);
            }
        }
        const framed = framing({ at: [0, 0, 0], turn: 0.6, tip: 0.62, far: 100 }, 30, 1, low, high);
        own.look(eyeOf(framed), framed.at, 30);
        own.light([low[0] - 40, high[1] + 120, high[2] + 80], low, high, 1.5, 0.62, 0.32);
        own.draw();
        const picture = document.createElement("canvas");
        picture.width = size;
        picture.height = size;
        picture.getContext("2d")?.drawImage(canvas, 0, 0);
        pictures.push(picture);
        for (const part of parts) own.remove(part);
    }
    own.dispose();
    return pictures;
}
