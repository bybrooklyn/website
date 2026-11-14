// The marble run, a draft: build a run from a box of pieces whose ends click together, and let marbles
// go down it, editing it while they roll. Stages 2 and 3 of its plan (docs/marbles.md): the box, joints,
// snapping, pillars and marbles; then the editor: a selection of one piece or many, handles to move,
// turn and resize it, undo without limit, copy, paste and mirror, pieces of one's own, views straight
// on, and a ghost marble showing where a marble would go. Bending, moving parts, sound of its own and the
// look of wood and glass come later; it is drawn flat shaded in the site's colours.
//
// What it stands on: pieces.ts (the box), run.ts (a run as data), edit.ts (groups moved, turned,
// mirrored, resized), history.ts (undo), ghost.ts (the ghost marble), handles.ts (the handles),
// table.ts (Mote's physics for a run), supports.ts (pillars), checks.ts (open ends), orbit.ts (the
// camera), runs.ts (made runs), toolbar.ts (the icons and the bar).
//
// One finger or the main button on a piece carries it (the whole selection if it is in it); on the
// table it turns the view; two fingers, the other button, or Shift with the main one, move the view; a
// pinch or the wheel brings it nearer. A tap chooses a piece; Shift, a long press, or the select tool
// adds to the choice; a long press on the table, Control with a drag, or the select tool draws a box
// round many. Keys are listed in the keys panel and in the keydown handler below.

import { gl, type Color, type Look, type Part, type View } from "../mote/gl";
import { turn as turnOf, type Solid } from "../mote/space";
import { ball, block, type Mesh, type Turn, type V3 } from "../mote/solids";
import { sounds, type Sounds } from "../mote/sound";
import { el, type Hand, type Mote, type Scene } from "../mote/stage";
import { turned } from "../mote/track";
import { checks, type Mark } from "./checks";
import { STILL as NO_MOVE, about, asOwn, groupFits, groupSnaps, joinedTo, matched, middleOf, mirrored, mirrorLine, moved, movedPoint, pivotOf, resizable, resized, rotated, then, type GroupSnap, type Move } from "./edit";
import { ghostMarks, makeGhost } from "./ghost";
import { AXES, ARROW, across, along, arrowMesh, layout, ringMesh, turnedBy, which, type Handle, type Shown } from "./handles";
import { begun, canRedo, canUndo, readSteps, recorded, redone, trimmed, undone, type Steps } from "./history";
import { NARROW, STRAIGHT, eyeOf, enters, framing, ground, kept, lensed, nearest, panned, project, ray, straightOn, type Orbit } from "./orbit";
import { BOX, CELL, LEVEL, RADIUS, blockMesh, boxToWorld, keyOf, shapeOf, sweepOf, toWorld, wayToWorld, type Box, type Kind, type Place } from "./pieces";
import { jointsOf, links, open, read, write, type Open, type Placed } from "./run";
import { RUNS } from "./runs";
import { PILLAR } from "./supports";
import { makeTable } from "./table";
import { fold, icon, stacking, swap, tool } from "./toolbar";

export const label = "A marble run to build: pieces from a box snap together end to end, and marbles roll down what is built.";

/** How wide the view is, up and down, in degrees, with the usual lens. */
const DEGREES = 38;
/** How near a piece being carried comes to a place it fits, in pixels on the screen, before it snaps there; more for a finger. */
const SNAP = { mouse: 40, touch: 60 };
/** How far a press may move, in pixels, and still be a press and not a drag. */
const STILL = 7;
/** How long a finger held still is a long press, in seconds. */
const LONG = 0.45;
/** How long a snap settles, and a piece flies from the box, in seconds. */
const SETTLE = 0.09;
const FLY = 0.28;
/** How often a stream lets a marble go, in seconds. */
const STREAM = 0.6;
/** How long the ghost may work each frame, in milliseconds: less while something is carried, so that the carrying stays smooth. */
const GHOST_WORK = { carrying: 2.5, still: 6 };

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

/** A point across and along turned by an angle about the upright, the way a quarter takes x to z. */
const spin = (x: number, z: number, angle: number): [number, number] => [x * Math.cos(angle) - z * Math.sin(angle), x * Math.sin(angle) + z * Math.cos(angle)];

/** The middle of a piece's cells, in its own place, at the level of its first joint. */
function handleOf(kind: Kind): V3 {
    const cells = shapeOf(kind).cells;
    const x = cells.reduce((sum, cell) => sum + cell.x * CELL + CELL / 2, 0) / cells.length;
    const z = cells.reduce((sum, cell) => sum + cell.z * CELL + CELL / 2, 0) / cells.length;
    return [x, 0, z];
}

/** Where something is drawn: a point, a turn about the upright, a size. */
interface Pose {
    at: V3;
    angle: number;
    scale: number;
}

/**
 * Pieces being carried, one or many, as one: by a finger or the mouse, by the keys, by a handle, or
 * following the pointer after a paste. `home` is where they were (in the run, or as made); `move` is
 * the move that takes them to where they would go, in whole cells, levels and quarter turns.
 */
interface Carried {
    home: Placed[];
    /** The pieces as they were in the run before anything was changed, to put back. */
    original: Placed[];
    /** They are pieces of the run, kept there until let go, not new ones. */
    inRun: boolean;
    /** The piece held, whose level it rides at. */
    anchor: number;
    /** The middle of their cells, at the level of their lowest joint: what they turn about when drawn. */
    pivot: V3;
    move: Move;
    /** Every way they fit against an open joint of the rest of the run, worked out once. */
    snaps: GroupSnap[];
    snap?: GroupSnap;
    fits: boolean;
    /** Over the box below the scene: let go there, they are taken away. */
    away: boolean;
    /** Where the pivot is drawn now, easing toward where it would go. */
    shown: Pose;
    /** The difference between where the finger is on the ground and the pivot, so that they do not jump to the finger. */
    grab: [number, number];
    /** Which pointer carries them: none for the keys, `hover` for a paste that follows the mouse. */
    hand?: number | "hover";
    /** A handle being dragged, where its drag began on the screen, and the handles' middle then. */
    handle?: Handle;
    press?: { x: number; y: number };
    origin?: V3;
    /** Turning one piece at the joint it hangs from: the ways it fits there, and which it is in. */
    cycle?: { snaps: GroupSnap[]; at: number };
    /** How many joints join them to the rest now, to click when one more meets. */
    joins: number;
    parts: Map<number, Drawn[]>;
}

/** A part of a piece as drawn: its look, kept to change its color, the color it has when nothing is said of it, and whether it is glass, which keeps its color. */
type Drawn = { part: Part; look: Look; base: Color; glass: boolean };

/** A pointer held down, and what it is doing. */
interface Held {
    hand: Hand;
    start: { x: number; y: number };
    last: { x: number; y: number };
    /** When it went down, in seconds of the scene's time: for a long press. */
    since: number;
    mode: "press" | "turn" | "pan" | "carry" | "pinch" | "handle" | "box" | "done" | "gizmo";
    /** The piece pressed, before the press is known to be a drag. */
    piece?: Placed;
    /** The way of the little axes in the corner that was pressed. */
    gizmo?: Way;
    /** The handle under the press, taken if it moves. */
    handle?: Handle;
}

/** The views straight on, by the way the eye looks from. */
type Way = "top" | "front" | "side" | "back" | "left";
const WAYS: Record<Way, { turn: number; tip: number }> = {
    top: { turn: 0, tip: STRAIGHT[1] },
    front: { turn: 0, tip: 0 },
    side: { turn: Math.PI / 2, tip: 0 },
    back: { turn: Math.PI, tip: 0 },
    left: { turn: -Math.PI / 2, tip: 0 },
};

/** A piece of one's own: its name and the group as a run's text, kept in the browser. */
interface Own {
    name: string;
    text: string;
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
        x: view?.color("oklch(0.7 0.16 25)") ?? ([1, 0.4, 0.4] as Color),
        y: view?.color("oklch(0.8 0.15 145)") ?? ([0.4, 1, 0.4] as Color),
        z: view?.color("oklch(0.72 0.13 250)") ?? ([0.4, 0.6, 1] as Color),
        ghost: tint("--ink", 0.9),
    };
    /** The axes' colours as the 2D canvas writes them, for the little axes in the corner. */
    const css = { x: "oklch(0.7 0.16 25)", y: "oklch(0.8 0.15 145)", z: "oklch(0.72 0.13 250)" };
    const sound: Sounds | undefined = m.preview ? undefined : sounds(m);

    const table = makeTable();
    const ghost = makeGhost();
    let run: Placed[] = [];
    let nextId = 1;
    /** The open ends, from checks.ts; and where the ghost marble stops or leaves the track. */
    let openMarks: Mark[] = [];
    let ghostMarked: Mark[] = [];
    /** The pieces chosen, by number. */
    const chosen = new Set<number>();
    /** The open joint the next piece pressed in the box goes to. */
    let end: Open | undefined;
    let playing = true;
    let streaming = false;
    let streamWait = 0;
    /** The select tool: a drag on the table draws a box, and a tap adds a piece to the choice. */
    let selecting = false;
    let carried: Carried | undefined;
    const held = new Map<number, Held>();
    /** Pieces flying from the box to their place, or back to it, drawn until they arrive. */
    const flying: { parts: { part: Part }[]; from: Pose; to: Pose; time: number; then: () => void }[] = [];
    let orbit: Orbit = { at: [0, 10, 0], turn: 0.75, tip: 0.62, far: 220 };
    /** Where the camera eases to, after a view or a fit was asked for. */
    let easing: { from: Orbit; to: Orbit; time: number } | undefined;
    /** The lens: the usual one, or the narrow one of the views straight on, easing from one to the other. */
    let lens = DEGREES;
    let lensTo = DEGREES;
    /** Every state of the run, for undo; what was copied; the pieces of one's own. */
    let steps: Steps = begun("v1");
    let clip = "";
    let owns: Own[] = m.preview ? [] : m.recall<Own[]>("marbles-own", [], 1).filter((one) => typeof one?.name === "string" && typeof one?.text === "string");
    /** The handle the mouse is over, lit a little. */
    let hovered: Handle | undefined;
    /** The box drawn to choose many, from one corner to the other, in pixels. */
    let boxing: { from: { x: number; y: number }; to: { x: number; y: number }; adding: boolean } | undefined;

    // ---- drawing ----
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
    /** Parts for a kind of piece, in a color; see-through for a piece carried. */
    const partsOf = (kind: Kind, alpha = 1, color?: Color): Drawn[] => {
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
    const placeOf = (piece: Placed): Pose => ({ at: originOf(piece.place), angle: angleOf(piece.place), scale: 1 });

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

    /** The handles, made once and shown on what is chosen: drawn over everything, so that nothing hides them. */
    const handleParts = view && !m.preview
        ? {
              x: view.add(arrowMesh("x"), { color: colors.x, over: true, gloss: 0.2 }),
              y: view.add(arrowMesh("y"), { color: colors.y, over: true, gloss: 0.2 }),
              z: view.add(arrowMesh("z"), { color: colors.z, over: true, gloss: 0.2 }),
              ring: view.add(ringMesh(), { color: colors.accent, over: true, gloss: 0.2 }),
              knob: view.add(ball(0.11, 16, 10), { color: colors.accent, over: true, gloss: 0.3 }),
          }
        : undefined;
    if (handleParts) for (const part of Object.values(handleParts)) part.hidden = true;

    /** Whether a piece of the run is being carried now, and so is out of the table and drawn apart. */
    const isCarried = (id: number) => Boolean(carried?.inRun && carried.home.some((piece) => piece.id === id));
    /** The run without what is carried. */
    const resting = () => run.filter((piece) => !isCarried(piece.id));
    const chosenPieces = () => run.filter((piece) => chosen.has(piece.id));

    /** Every piece's drawing made to match the run: new ones added, gone ones taken away, colors for what is chosen or marked. */
    const redraw = () => {
        if (!view) return;
        for (const [id, one] of drawn) {
            if (run.some((piece) => piece.id === id && !isCarried(id))) continue;
            for (const { part } of one.parts) view.remove(part);
            drawn.delete(id);
        }
        const marks = [...openMarks, ...ghostMarked];
        for (const piece of run) {
            if (isCarried(piece.id)) continue;
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
                // chosen is a lift in tone toward the accent; marked a warmer one
                part.look.color = chosen.has(piece.id) ? mix(part.base, colors.accent, 0.5) : marked ? mix(part.base, colors.warn, 0.6) : part.base;
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
        for (const mark of openMarks) {
            const piece = run.find((one) => one.id === mark.id);
            const joint = piece && jointsOf(piece)[mark.joint!];
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
        const [low, high] = bounds(run);
        view.light([low[0] - 80, high[1] + 220, high[2] + 140], [low[0] - 10, 0, low[2] - 10], [high[0] + 10, high[1] + 10, high[2] + 10], 1.5, 0.62, 0.32);
    };

    /** The least and greatest corners of pieces, or of a patch of table if there are none. */
    const bounds = (pieces: Placed[]): [V3, V3] => {
        const boxes: Box[] = pieces.flatMap((piece) => shapeOf(piece.kind).room.map((box) => boxToWorld(piece.place, box)));
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
    const keepSteps = () => {
        if (!m.preview) m.keep("marbles-steps", trimmed(steps), 1);
    };
    /** After any change: the table, the marks, what is kept, the drawing; and, unless `record` is false, a step for undo. */
    const changed = (record = true) => {
        const now = resting();
        table.set(now);
        openMarks = checks(now).filter((mark) => mark.why === "open");
        ghostMarked = ghostMarked.filter((mark) => now.some((piece) => piece.id === mark.id));
        for (const id of [...chosen]) if (!run.some((piece) => piece.id === id)) chosen.delete(id);
        if (end && !open(now).some((joint) => joint.id === end!.id && joint.joint === end!.joint)) end = undefined;
        if (!end) end = lastEnd();
        if (!m.preview) m.keep("marbles-run", write(run), 1);
        if (record) {
            steps = recorded(steps, write(run));
            keepSteps();
        }
        redraw();
        tell();
        m.wake();
    };
    /** The open end of the piece placed last that has one, other than a tray's. */
    const lastEnd = (): Open | undefined => {
        const ends = open(resting());
        for (let i = run.length - 1; i >= 0; i--) {
            const found = ends.find((joint) => joint.id === run[i]!.id && run[i]!.kind.family !== "t");
            if (found) return found;
        }
        return undefined;
    };
    /** The run made to be the one this text says, keeping the numbers of the pieces that stay, so that only what changed is rebuilt. */
    const restore = (text: string) => {
        if (carried) cancel();
        let found: { run: Placed[]; next: number };
        try {
            found = matched(run, text, nextId);
        } catch {
            found = matched(run, RUNS[0]!.text, nextId);
        }
        run = found.run;
        nextId = found.next;
    };
    /** A made run, or nothing, put on the table: a change like any other, which undo takes back. */
    const load = (text: string) => {
        restore(text);
        chosen.clear();
        table.clear();
        end = undefined;
        changed();
    };
    const undo = () => {
        if (!canUndo(steps)) return refuse();
        steps = undone(steps);
        restore(steps.texts[steps.at]!);
        changed(false);
        keepSteps();
        sound?.knock(0.25, 900);
    };
    const redo = () => {
        if (!canRedo(steps)) return refuse();
        steps = redone(steps);
        restore(steps.texts[steps.at]!);
        changed(false);
        keepSteps();
        sound?.knock(0.25, 1300);
    };

    // ---- the camera ----
    const aspect = () => Math.max(0.2, m.width / Math.max(1, m.height));
    /** The camera as it draws: with the narrow lens of a view straight on, the eye further back by as much. */
    const cam = () => ({ orbit: lens === DEGREES ? orbit : lensed(orbit, DEGREES, lens), degrees: lens });
    const toPicture = (x: number, y: number): [number, number] => [(x / Math.max(1, m.width)) * 2 - 1, 1 - (y / Math.max(1, m.height)) * 2];
    const lineAt = (x: number, y: number) => {
        const { orbit: seen, degrees } = cam();
        return ray(seen, degrees, aspect(), ...toPicture(x, y));
    };
    const onScreen = (p: V3): { x: number; y: number } | undefined => {
        const { orbit: seen, degrees } = cam();
        const found = project(seen, degrees, aspect(), p);
        return found && { x: ((found.x + 1) / 2) * m.width, y: ((1 - found.y) / 2) * m.height };
    };
    const easeTo = (to: Orbit) => {
        if (reduced) {
            orbit = to;
            easing = undefined;
        } else easing = { from: orbit, to, time: 0 };
        m.wake();
    };
    /** The view framing pieces, from the way it looks now: the run, or what is chosen. */
    const fit = (pieces: Placed[], now = false) => {
        const [low, high] = bounds(pieces);
        const framed = framing(orbit, DEGREES, aspect(), low, high);
        const to = { ...framed, turn: orbit.turn, tip: orbit.tip };
        if (now) {
            orbit = to;
            easing = undefined;
        } else easeTo(to);
    };
    const fitRun = (now = false) => fit(run, now);
    const fitChosen = () => fit(chosen.size ? chosenPieces() : run);
    /** A view straight on, turned to with a short eased turn the short way round, with the narrow lens. */
    const look = (way: Way) => {
        const goal = WAYS[way];
        easeTo({ ...orbit, turn: nearest(orbit.turn, goal.turn), tip: goal.tip });
        lensTo = NARROW;
        sound?.knock(0.15, 1800);
    };
    /** The free camera: the usual lens again, once the view is turned by hand. */
    const free = () => {
        lensTo = DEGREES;
    };

    /** The piece of the run under a point of the picture, by the boxes of room it takes up, a little larger for a finger. */
    const pieceAt = (x: number, y: number, wide = 1.2): Placed | undefined => {
        const line = lineAt(x, y);
        let best: { piece: Placed; t: number } | undefined;
        for (const piece of run) {
            if (isCarried(piece.id)) continue;
            for (const box of shapeOf(piece.kind).room) {
                const placed = boxToWorld(piece.place, box);
                const t = enters(line, placed.at, [placed.half[0] + wide, placed.half[1] + wide * 0.5, placed.half[2] + wide]);
                if (t !== undefined && (!best || t < best.t)) best = { piece, t };
            }
        }
        return best?.piece;
    };

    // ---- carrying ----
    /** Where carried pieces would go now. */
    const placedOf = (one: Carried) => one.home.map((piece) => moved(piece, one.move));
    /** How many joints join pieces to the rest of the run. */
    const joinsOf = (pieces: Placed[]) => {
        const mine = new Set(pieces.map((piece) => piece.id));
        return links([...resting().filter((piece) => !mine.has(piece.id)), ...pieces]).filter(([a, b]) => mine.has(a.id) !== mine.has(b.id)).length;
    };
    /** The pose of a carried piece, from where the group is drawn now. */
    const poseIn = (one: Carried, piece: Placed): Pose => {
        const { at, angle, scale } = one.shown;
        const o = originOf(piece.place);
        const [rx, rz] = spin(o[0] - one.pivot[0], o[2] - one.pivot[2], angle);
        return { at: [at[0] + rx * scale, at[1] + (o[1] - one.pivot[1]) * scale, at[2] + rz * scale], angle: angleOf(piece.place) + angle, scale };
    };
    /** A point carried with the group, as it is drawn now. */
    const shownPoint = (one: Carried, p: V3): V3 => {
        const { at, angle, scale } = one.shown;
        const [rx, rz] = spin(p[0] - one.pivot[0], p[2] - one.pivot[2], angle);
        return [at[0] + rx * scale, at[1] + (p[1] - one.pivot[1]) * scale, at[2] + rz * scale];
    };
    const target = (one: Carried): Pose => ({ at: movedPoint(one.pivot, one.move), angle: (one.move.turn * Math.PI) / 2, scale: 1 });

    const startCarry = (home: Placed[], inRun: boolean, anchor: number, hand: Carried["hand"], at?: { x: number; y: number }) => {
        if (!view || !home.length) return;
        const pivot = middleOf(home);
        const parts = new Map(home.map((piece) => [piece.id, partsOf(piece.kind, 0.62, colors.accent)]));
        let grab: [number, number] = [0, 0];
        if (inRun && at) {
            // held where the finger is on it, not by its middle
            const point = ground(lineAt(at.x, at.y), pivot[1]);
            if (point) grab = [pivot[0] - point[0], pivot[2] - point[2]];
        }
        const others = inRun ? run.filter((piece) => !home.some((one) => one.id === piece.id)) : run;
        carried = { home: home.map((piece) => ({ ...piece })), original: home.map((piece) => ({ ...piece })), inRun, anchor, pivot, move: { ...NO_MOVE }, snaps: groupSnaps(others, home), fits: inRun, away: false, shown: { at: pivot, angle: 0, scale: inRun ? 1 : 0.4 }, grab, hand, joins: 0, parts };
        carried.joins = joinsOf(home);
        if (inRun) changed(false);
        if (at) follow(at.x, at.y, typeof hand === "number" && held.get(hand)?.hand.kind === "touch" ? "touch" : "mouse", !inRun);
        m.wake();
    };

    /** Where carried pieces would go, from where the pointer is: snapped to an open joint near enough, or free on the grid. */
    const follow = (x: number, y: number, kind: "mouse" | "touch", first = false) => {
        const one = carried;
        if (!one) return;
        one.away = y > m.height;
        const line = lineAt(x, Math.min(y, m.height));
        // the anchor at the level of what is under the pointer, by the nearest of its joints; over the
        // table, at the level of the open end nearest the pointer, where it is most likely going; never
        // so low that any of the group is under the ground
        const anchor = one.home.find((piece) => piece.id === one.anchor) ?? one.home[0]!;
        const lowest = Math.min(...one.home.map((piece) => piece.place.y + shapeOf(piece.kind).low));
        const below = pieceAt(x, Math.min(y, m.height), 0);
        let level = anchor.place.y - lowest;
        const nearestEnd = open(resting())
            .map((joint) => ({ joint, seen: onScreen(joint.at) }))
            .filter((found) => found.seen)
            .sort((a, b) => Math.hypot(a.seen!.x - x, a.seen!.y - y) - Math.hypot(b.seen!.x - x, b.seen!.y - y))[0];
        if (!below && nearestEnd) level = Math.max(level, Math.round(nearestEnd.joint.at[1] / LEVEL));
        if (below) {
            const dot = (p: V3) => (p[0] - line.from[0]) * line.way[0] + (p[1] - line.from[1]) * line.way[1] + (p[2] - line.from[2]) * line.way[2];
            const hit = jointsOf(below).map((joint) => ({ joint, d: Math.hypot(...line.way.map((w, axis) => joint.at[axis]! - line.from[axis]! - w * dot(joint.at))) })).sort((a, b) => a.d - b.d)[0];
            if (hit) level = Math.max(level, Math.round(hit.joint.at[1] / LEVEL));
        }
        const dy = level - anchor.place.y;
        const point = ground(line, one.pivot[1] + dy * LEVEL);
        let want: V3 = target(one).at;
        if (point) {
            want = [point[0] + one.grab[0], one.pivot[1] + dy * LEVEL, point[2] + one.grab[1]];
            const [rx, rz] = rotated(one.pivot[0], one.pivot[2], one.move.turn);
            one.move = { turn: one.move.turn, x: Math.round((want[0] - rx) / CELL), z: Math.round((want[2] - rz) / CELL), y: dy };
        }
        // the nearest place they fit against an open joint: for one piece, by where its middle would be on
        // the screen; for a group, by how near the joint that would meet is to the joint it would meet
        const aim = onScreen(want) ?? { x, y };
        const freeMove = { ...one.move };
        let best: { snap: GroupSnap; d: number } | undefined;
        for (const snap of one.snaps) {
            const [seen, goal] = one.home.length > 1 ? [onScreen(movedPoint(snap.joint.at, freeMove)), onScreen(snap.to.at)] : [onScreen(movedPoint(one.pivot, snap.move)), aim];
            if (!seen || !goal) continue;
            const d = Math.hypot(seen.x - goal.x, seen.y - goal.y);
            if (!best || d < best.d) best = { snap, d };
        }
        const reach = SNAP[kind] * (one.snap ? 1.4 : 1);
        const was = one.snap;
        one.snap = best && best.d < reach && !one.away ? best.snap : undefined;
        if (one.snap) {
            one.move = { ...one.snap.move };
            one.fits = true;
            const same = was && was.to.id === one.snap.to.id && was.to.joint === one.snap.to.joint && was.joint.id === one.snap.joint.id && was.joint.joint === one.snap.joint.joint;
            if (!same) sound?.knock(0.55, 2100);
        } else one.fits = groupFits(run, placedOf(one));
        if (first) one.shown = { ...target(one), scale: 0.4 };
        paintCarried();
        m.wake();
    };

    const paintCarried = () => {
        const one = carried;
        if (!one) return;
        const color = one.away ? colors.flat : one.fits ? colors.accent : colors.wrong;
        for (const parts of one.parts.values()) for (const { look, glass } of parts) if (!glass) look.color = color;
    };

    /** Lets go of what is carried: put in the run where it fits, taken away over the box, or back where it was. */
    const drop = () => {
        const one = carried;
        if (!one) return;
        carried = undefined;
        const placed = placedOf(one);
        const ids = new Set(one.home.map((piece) => piece.id));
        const each = (to: (piece: Placed, index: number) => Pose) => {
            one.home.forEach((piece, index) => {
                const parts = one.parts.get(piece.id)!;
                const from = poseIn(one, piece);
                fly(parts, from, to(piece, index), () => {
                    for (const { part } of parts) view?.remove(part);
                });
            });
        };
        if (one.away) {
            if (one.inRun) run = run.filter((piece) => !ids.has(piece.id));
            for (const id of ids) chosen.delete(id);
            each((piece) => {
                const from = poseIn(one, piece);
                return { ...from, at: [from.at[0], from.at[1] - 6, from.at[2]], scale: 0.05 };
            });
            sound?.knock(0.3, 500);
        } else if (one.fits) {
            if (one.inRun) run = run.map((piece) => placed.find((other) => other.id === piece.id) ?? piece);
            else run = [...run, ...placed];
            chosen.clear();
            for (const piece of placed) chosen.add(piece.id);
            end = open(run).find((joint) => ids.has(joint.id)) ?? end;
            each((_, index) => placeOf(placed[index]!));
            if (!one.snap && one.handle === undefined) sound?.knock(0.35, 1300);
        } else if (one.inRun) {
            // back where they came from, as they were
            each((_, index) => placeOf(one.original[index]!));
            refuse();
        } else {
            each((piece) => ({ ...poseIn(one, piece), scale: 0.05 }));
        }
        changed();
    };
    /** Puts back what is carried, as it was, with no change to the run. */
    const cancel = () => {
        if (!carried) return;
        carried.fits = false;
        carried.away = false;
        drop();
    };

    const fly = (parts: { part: Part }[], from: Pose, to: Pose, done: () => void) => {
        if (reduced) {
            done();
            return;
        }
        // the shorter way round
        let angle = to.angle;
        while (angle - from.angle > Math.PI) angle -= 2 * Math.PI;
        while (angle - from.angle < -Math.PI) angle += 2 * Math.PI;
        flying.push({ parts, from: { ...from }, to: { ...to, angle }, time: 0, then: done });
        m.wake();
    };

    /**
     * New pieces (from the box, a paste or a piece of one's own) put at the open end, the first way round
     * that fits, or by any other open end; on an empty table, in the middle of the view. They fly there
     * from under the box's strip.
     */
    const placeAtEnd = (group: Placed[], fromX?: number): boolean => {
        const all = groupSnaps(run, group).filter((snap) => run.find((piece) => piece.id === snap.to.id)?.kind.family !== "t");
        // the way marbles go first: into an entry of the new pieces from the way out of the run
        const flows = (snap: GroupSnap) => snap.joint.joint === 0 && group.find((piece) => piece.id === snap.joint.id)?.kind.family !== "h";
        all.sort((a, b) => Number(flows(b)) - Number(flows(a)));
        const snap = all.find((one) => end && one.to.id === end.id && one.to.joint === end.joint) ?? all[0];
        let move: Move | undefined = snap?.move;
        if (!move) {
            const middle = ground(lineAt(m.width / 2, m.height / 2), 0) ?? [0, 0, 0];
            const pivot = middleOf(group);
            const lowest = Math.min(...group.map((piece) => piece.place.y + shapeOf(piece.kind).low));
            const free: Move = { turn: 0, x: Math.round((middle[0] - pivot[0]) / CELL), z: Math.round((middle[2] - pivot[2]) / CELL), y: -lowest };
            if (groupFits(run, group.map((piece) => moved(piece, free)))) move = free;
        }
        if (!move) return false;
        const placed = group.map((piece) => moved(piece, move));
        run = [...run, ...placed];
        chosen.clear();
        for (const piece of placed) chosen.add(piece.id);
        const ids = new Set(placed.map((piece) => piece.id));
        end = open(run).find((joint) => ids.has(joint.id) && run.find((piece) => piece.id === joint.id)?.kind.family !== "t") ?? end;
        changed();
        if (view && !reduced) {
            // from under the box's strip, rising into place; each piece itself is hidden until what flies there arrives
            const pivot = middleOf(placed);
            const start = ground(lineAt(fromX ?? m.width / 2, m.height - 4), pivot[1]) ?? pivot;
            for (const piece of placed) {
                const parts = partsOf(piece.kind, 0.62, colors.accent);
                const own = drawn.get(piece.id)?.parts ?? [];
                for (const { part } of own) part.hidden = true;
                const at = originOf(piece.place);
                fly(parts, { at: [start[0] + (at[0] - pivot[0]) * 0.4, start[1], start[2] + (at[2] - pivot[2]) * 0.4], angle: angleOf(piece.place) - 0.6, scale: 0.4 }, placeOf(piece), () => {
                    for (const { part } of parts) view.remove(part);
                    for (const { part } of drawn.get(piece.id)?.parts ?? []) part.hidden = false;
                });
            }
            if (snap) setTimeout(() => sound?.knock(0.55, 2100), FLY * 1000);
        } else if (snap) sound?.knock(0.55, 2100);
        return true;
    };
    /** Pieces given new numbers, to be added to the run. */
    const fresh = (pieces: Placed[]) => pieces.map((piece) => ({ ...piece, kind: { ...piece.kind, sizes: [...piece.kind.sizes] }, id: nextId++ }));
    const fromBox = (kind: Kind): Placed[] => [{ id: nextId++, kind: { ...kind, sizes: [...kind.sizes] }, place: { x: 0, z: 0, y: -shapeOf(kind).low, turn: 0 } }];

    // ---- the handles ----
    /** The handles' middle: over the middle of what is chosen, at its lowest joint and a little above. */
    const handleMiddle = (pieces: Placed[]): V3 => {
        const middle = middleOf(pieces);
        return [middle[0], middle[1] + 1, middle[2]];
    };
    /** Where the knob is: past the far end of one chosen piece that can be resized. */
    const knobOf = (pieces: Placed[]): V3 | undefined => {
        if (pieces.length !== 1 || !resizable(pieces[0]!.kind)) return undefined;
        const piece = pieces[0]!;
        const joint = shapeOf(piece.kind).joints[1];
        if (!joint) return undefined;
        const at = toWorld(piece.place, joint.at);
        const way = wayToWorld(piece.place, joint.way);
        return [at[0] + way[0] * 1.5, at[1] + 1.5, at[2] + way[2] * 1.5];
    };
    /** Where the handles are on the screen now, if any are shown. */
    const handlesNow = (): Shown | undefined => {
        if (m.preview || (carried && carried.handle === undefined)) return undefined;
        const pieces = carried ? placedOf(carried) : chosenPieces();
        if (!pieces.length) return undefined;
        const { orbit: seen, degrees } = cam();
        const middle = carried ? shownPoint(carried, carried.origin!) : handleMiddle(pieces);
        return layout(seen, degrees, m.width, m.height, middle, carried ? (carried.handle === "knob" ? knobOf(pieces) : undefined) : knobOf(pieces));
    };
    /** Turning one piece at the joint it hangs from: the ways it fits there, if it hangs from exactly one. */
    const cycleOf = (piece: Placed): Carried["cycle"] => {
        const others = run.filter((one) => one.id !== piece.id);
        const joins = links(run).filter(([a, b]) => (a.id === piece.id) !== (b.id === piece.id));
        if (joins.length !== 1) return undefined;
        const [a, b] = joins[0]!;
        const to = a.id === piece.id ? b : a;
        const ways = groupSnaps(others, [piece]).filter((snap) => snap.to.id === to.id && snap.to.joint === to.joint);
        if (ways.length < 2) return undefined;
        const at = ways.findIndex((snap) => snap.move.turn === 0 && snap.move.x === 0 && snap.move.z === 0 && snap.move.y === 0);
        return { snaps: ways, at: Math.max(0, at) };
    };
    const startHandle = (handle: Handle, hand: Hand) => {
        const pieces = chosenPieces();
        if (!pieces.length) return;
        startCarry(pieces, true, pieces[0]!.id, hand.id);
        const one = carried;
        if (!one) return;
        one.handle = handle;
        one.press = { x: hand.x, y: hand.y };
        one.origin = handleMiddle(pieces);
        if (handle === "ring" && pieces.length === 1) one.cycle = cycleOf(pieces[0]!);
        sound?.knock(0.2, 1600);
    };
    const dragHandle = (x: number, y: number) => {
        const one = carried;
        if (!one?.handle || !one.press || !one.origin) return;
        const { orbit: seen, degrees } = cam();
        if (one.handle === "x" || one.handle === "y" || one.handle === "z") {
            const d = along(seen, degrees, aspect(), one.origin, AXES[one.handle], toPicture(one.press.x, one.press.y), toPicture(x, y));
            const n = Math.round(d / (one.handle === "y" ? LEVEL : CELL));
            one.move = { turn: 0, x: one.handle === "x" ? n : 0, y: one.handle === "y" ? n : 0, z: one.handle === "z" ? n : 0 };
        } else if (one.handle === "ring") {
            const middle = onScreen(one.origin);
            if (!middle) return;
            const quarters = turnedBy(middle, one.press, { x, y });
            if (one.cycle) one.move = { ...one.cycle.snaps[(((one.cycle.at + quarters) % one.cycle.snaps.length) + one.cycle.snaps.length) % one.cycle.snaps.length]!.move };
            else one.move = about(pivotOf(one.home), quarters);
        } else if (one.handle === "knob") {
            const piece = one.home[0]!;
            const wanted = ownPoint(piece, lineAt(x, y));
            if (wanted) {
                const kind = resized(piece.kind, wanted);
                if (keyOf(kind) !== keyOf(piece.kind)) {
                    one.home = [{ ...piece, kind }];
                    for (const { part } of one.parts.get(piece.id) ?? []) view?.remove(part);
                    one.parts.set(piece.id, partsOf(kind, 0.62, colors.accent));
                    sound?.knock(0.3, 1700);
                }
            }
        }
        one.fits = groupFits(run, placedOf(one));
        const joins = joinsOf(placedOf(one));
        // joints part and rejoin as the pieces pass open ends: a click when one more meets
        if (one.fits && joins > one.joins) sound?.knock(0.55, 2100);
        one.joins = joins;
        paintCarried();
        m.wake();
    };
    /**
     * Where the pointer's line meets the plane a piece is resized in, in the piece's own place: the
     * level of its far end for those that grow along or aside, and the upright plane along it for
     * those that grow down (a slope, a drop, a spiral).
     */
    const ownPoint = (piece: Placed, line: ReturnType<typeof lineAt>): V3 | undefined => {
        const shape = shapeOf(piece.kind);
        const far = toWorld(piece.place, shape.joints[1]!.at);
        let hit: V3 | undefined;
        if (piece.kind.family === "d" || piece.kind.family === "v" || piece.kind.family === "x") {
            const n = wayToWorld(piece.place, [0, 0, 1]);
            const facing = line.way[0] * n[0] + line.way[2] * n[2];
            if (Math.abs(facing) > 0.08) {
                const t = ((far[0] - line.from[0]) * n[0] + (far[2] - line.from[2]) * n[2]) / facing;
                if (t > 0) hit = [line.from[0] + line.way[0] * t, line.from[1] + line.way[1] * t, line.from[2] + line.way[2] * t];
            }
        }
        hit ??= ground(line, far[1]);
        if (!hit) return undefined;
        const [x, z] = rotated(hit[0] - piece.place.x * CELL, hit[2] - piece.place.z * CELL, -piece.place.turn);
        return [x, hit[1] - piece.place.y * LEVEL, z];
    };

    // ---- what the bar, the strip and the keys do ----
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
    /** Pieces of the run changed in place, if they fit there; a small no if not. */
    const commit = (changedPieces: Placed[], pitch = 1500) => {
        if (!groupFits(run, changedPieces)) return refuse();
        run = run.map((piece) => changedPieces.find((other) => other.id === piece.id) ?? piece);
        sound?.knock(0.3, pitch);
        changed();
    };
    /** A quarter turn: what is carried; one piece hanging from one joint, the next way it fits there; else what is chosen, where it stands. */
    const turnChosen = (by = 1) => {
        if (carried) {
            carried.move = then(carried.move, about(pivotOf(placedOf(carried)), by));
            carried.snap = undefined;
            carried.fits = groupFits(run, placedOf(carried));
            paintCarried();
            m.wake();
            return;
        }
        const pieces = chosenPieces();
        if (!pieces.length) return;
        const cycle = pieces.length === 1 ? cycleOf(pieces[0]!) : undefined;
        if (cycle) {
            const snap = cycle.snaps[(cycle.at + (by > 0 ? 1 : cycle.snaps.length - 1)) % cycle.snaps.length]!;
            commit([moved(pieces[0]!, snap.move)]);
            if (run.some((piece) => piece.id === pieces[0]!.id)) sound?.knock(0.55, 2100);
            return;
        }
        commit(pieces.map((piece) => moved(piece, about(pivotOf(pieces), by))));
    };
    /** Left for right: what is chosen, across the line along its one joint to the rest, or as the view sees it. */
    const mirrorChosen = () => {
        if (carried) {
            const line = mirrorLine(carried.home, carried.home.map((piece) => piece.id), orbit.turn);
            const flipped = mirrored(carried.home, line.across, line.twice);
            for (const piece of flipped) {
                for (const { part } of carried.parts.get(piece.id) ?? []) view?.remove(part);
                carried.parts.set(piece.id, partsOf(piece.kind, 0.62, colors.accent));
            }
            carried.home = flipped;
            carried.pivot = middleOf(flipped);
            carried.snaps = groupSnaps(run.filter((piece) => !isCarried(piece.id)), flipped);
            carried.snap = undefined;
            carried.fits = groupFits(run, placedOf(carried));
            paintCarried();
            m.wake();
            return;
        }
        const pieces = chosenPieces();
        if (!pieces.length) return;
        const line = mirrorLine(run, pieces.map((piece) => piece.id), orbit.turn);
        commit(mirrored(pieces, line.across, line.twice), 1200);
    };
    const removeChosen = () => {
        if (carried) {
            carried.away = true;
            drop();
            return;
        }
        const pieces = chosenPieces();
        if (!pieces.length) return;
        run = run.filter((piece) => !chosen.has(piece.id));
        chosen.clear();
        if (view && !reduced) {
            for (const piece of pieces) {
                const parts = partsOf(piece.kind, 0.62, colors.flat);
                const at = originOf(piece.place);
                fly(parts, placeOf(piece), { at: [at[0], at[1] - 6, at[2]], angle: angleOf(piece.place), scale: 0.05 }, () => {
                    for (const { part } of parts) view.remove(part);
                });
            }
        }
        sound?.knock(0.3, 500);
        changed();
    };
    /** What is chosen, kept to be pasted: in this page, and on the system's clipboard as the run's text when it can be. */
    const copyChosen = (): boolean => {
        const pieces = chosenPieces();
        if (!pieces.length) return false;
        clip = asOwn(pieces);
        navigator.clipboard?.writeText(clip).catch(() => {});
        sound?.knock(0.2, 2400);
        tell();
        return true;
    };
    /** A copied group put in: following the mouse until it is pressed down, if it is over the run; else at the open end. */
    const paste = (text: string, following: boolean) => {
        let group: Placed[];
        try {
            group = fresh(read(text));
        } catch {
            return refuse();
        }
        if (!group.length) return refuse();
        if (carried) cancel();
        if (following && m.pointer.inside && !held.size) {
            startCarry(group, false, group[0]!.id, "hover", { x: m.pointer.x, y: m.pointer.y });
            return;
        }
        if (!placeAtEnd(group)) refuse();
    };
    const duplicate = (following: boolean) => {
        if (copyChosen()) paste(clip, following);
    };
    const selectAll = () => {
        for (const piece of run) chosen.add(piece.id);
        chosenChanged();
    };
    const selectJoined = () => {
        for (const id of [...chosen]) for (const other of joinedTo(run, id)) chosen.add(other);
        chosenChanged();
    };
    const chosenChanged = () => {
        const last = chosenPieces().at(-1);
        if (last) end = open(run).find((joint) => joint.id === last.id) ?? end;
        redraw();
        tell();
        m.wake();
    };
    /** A small shake of what could not be done: it says no without words. */
    let shake = 0;
    const refuse = () => {
        shake = reduced ? 0 : 0.25;
        sound?.knock(0.2, 300);
        m.wake();
    };
    const selectStep = (by: number) => {
        if (!run.length) return;
        const last = chosenPieces().at(-1);
        const at = last ? run.indexOf(last) : -1;
        const next = run[(at + by + run.length) % run.length]!;
        chosen.clear();
        chosen.add(next.id);
        chosenChanged();
    };
    /** The keys' way of carrying: lift what is chosen and move it a cell or a level, the way the view looks; Enter puts it down. */
    const nudge = (dx: number, dz: number, dy: number) => {
        if (!carried) {
            const pieces = chosenPieces();
            if (!pieces.length) return;
            startCarry(pieces, true, pieces[0]!.id, undefined);
        }
        const one = carried!;
        // across and along as the view sees them: the arrows move pieces the way they look to go
        const quarter = Math.round(orbit.turn / (Math.PI / 2));
        let [x, z] = [dx, dz];
        for (let i = 0; i < ((quarter % 4) + 4) % 4; i++) [x, z] = [z, 0 - x];
        const lowest = Math.min(...placedOf(one).map((piece) => piece.place.y + shapeOf(piece.kind).low));
        one.move = { ...one.move, x: one.move.x + x, z: one.move.z + z, y: one.move.y + Math.max(-lowest, dy) };
        one.snap = undefined;
        one.fits = groupFits(run, placedOf(one));
        const joins = joinsOf(placedOf(one));
        // joined by where it is: a click when it comes to meet an open end exactly
        if (one.fits && joins > one.joins) sound?.knock(0.55, 2100);
        one.joins = joins;
        paintCarried();
        m.wake();
    };
    const toggleStream = () => {
        streaming = !streaming;
        streamWait = 0;
        tell();
        m.wake();
    };
    const togglePause = () => {
        playing = !playing;
        tell();
        m.wake();
    };
    const clearMarbles = () => {
        table.clear();
        m.wake();
    };
    const toggleSelecting = () => {
        selecting = !selecting;
        tell();
    };

    // ---- the panel: the box, the bar, the strip by the selection ----
    let tell = () => {};
    let toggleKeys = () => {};
    let ownBox = (_grown?: number) => {};
    const strip = el("div", { class: "marbles-strip", role: "toolbar", ariaLabel: "what is chosen" });
    if (!m.preview) {
        const panel = m.panel();
        const box = el("div", { class: "marbles-box", role: "toolbar", ariaLabel: "the box of pieces" });
        const pictures = paintBox(view, colors, BOX.map((entry) => [{ id: 0, kind: entry.kind, place: { x: 0, z: 0, y: 0, turn: 0 } }]));
        /** A button of the box: pressed, its pieces go at the open end; dragged up, they are carried into the scene. */
        const boxButton = (name: string, picture: HTMLCanvasElement | undefined, make: () => Placed[], className = "marbles-piece") => {
            const button = el("button", { type: "button", class: className, title: name, ariaLabel: `${name}: press to put it at the end of the run, or drag it up into the scene` }, picture ?? "", el("span", { textContent: name }));
            let pressed: { id: number; x: number; y: number; dragging: boolean } | undefined;
            /** A drag out of the box ends with the browser's click on the button, which is not a press. */
            let dragged = false;
            button.addEventListener("pointerdown", (event) => {
                if ((event.target as Element).closest(".marbles-unkeep")) return;
                pressed = { id: event.pointerId, x: event.clientX, y: event.clientY, dragging: false };
                button.setPointerCapture(event.pointerId);
            });
            button.addEventListener("pointermove", (event) => {
                if (!pressed || pressed.id !== event.pointerId) return;
                const rect = m.canvas.getBoundingClientRect();
                const [x, y] = [event.clientX - rect.left, event.clientY - rect.top];
                if (!pressed.dragging && pressed.y - event.clientY > STILL * 2) {
                    pressed.dragging = true;
                    if (carried) cancel();
                    const group = make();
                    startCarry(group, false, group[0]!.id, undefined, { x, y });
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
            button.addEventListener("click", (event) => {
                if ((event.target as Element).closest(".marbles-unkeep")) return;
                if (dragged) {
                    dragged = false;
                    return;
                }
                if (carried) cancel();
                const rect = m.canvas.getBoundingClientRect();
                const own = button.getBoundingClientRect();
                if (!placeAtEnd(make(), own.left + own.width / 2 - rect.left)) {
                    button.animate?.([{ translate: "0" }, { translate: "-3px" }, { translate: "3px" }, { translate: "0" }], { duration: reduced ? 0 : 220 });
                    sound?.knock(0.2, 300);
                }
            });
            return button;
        };
        BOX.forEach((entry, index) => box.append(boxButton(entry.name, pictures[index], () => fromBox(entry.kind))));
        /** The pieces of one's own, after the made ones, each with a cross that takes it out of the box. */
        let ownButtons: HTMLButtonElement[] = [];
        ownBox = (grown?: number) => {
            for (const button of ownButtons) button.remove();
            const drawnOwn = paintBox(view, colors, owns.map((one) => read(one.text)));
            ownButtons = owns.map((one, index) => {
                const button = boxButton(one.name, drawnOwn[index], () => fresh(read(one.text)), "marbles-piece marbles-own");
                const unkeep = el("span", { class: "marbles-unkeep", role: "button", title: `Take ${one.name} out of the box`, ariaLabel: `take ${one.name} out of the box`, tabIndex: 0 }, icon("close"));
                const away = () => {
                    owns = owns.filter((other) => other !== one);
                    m.keep("marbles-own", owns, 1);
                    button.classList.add("leaving");
                    setTimeout(() => ownBox(), reduced ? 0 : 260);
                };
                unkeep.addEventListener("click", (event) => {
                    event.stopPropagation();
                    away();
                });
                unkeep.addEventListener("keydown", (event) => {
                    if (event.key === "Enter" || event.key === " ") {
                        event.preventDefault();
                        away();
                    }
                });
                button.append(unkeep);
                if (index === grown) button.classList.add("arriving");
                box.append(button);
                return button;
            });
        };
        ownBox();

        // the bar: choosing and undo, marbles, the view, and the rest
        const selectTool = tool("select", "Select: a drag draws a box, a tap adds a piece", "B", toggleSelecting, true);
        const undoTool = tool("undo", "Undo", "Ctrl+Z", undo);
        const redoTool = tool("redo", "Redo", "Ctrl+Shift+Z", redo);
        const pasteTool = tool("paste", "Paste at the open end", "Ctrl+V", () => clip && paste(clip, false));
        const goTool = tool("go", "Let a marble go", "Space", letGo);
        const streamTool = tool("stream", "Stream of marbles", "Shift+Space", toggleStream, true);
        const pauseTool = tool("pause", "Pause", "P", togglePause);
        const resetTool = tool("reset", "Clear the marbles", "C", clearMarbles);
        const fitTool = tool("fit", "Fit the run", "Home", () => fitRun());
        const soundTool = tool("quiet", "Sound", "M", () => {
            sound?.button.click();
            tell();
        });
        const keysTool = tool("keys", "Keys", "?", () => toggleKeys());
        const runsTool = tool("runs", "Start from", "", () => {
            keys.open(keysTool, false);
            runs.open(runsTool);
        });
        const group = (...tools: HTMLElement[]) => el("div", { class: "marbles-group" }, ...tools);
        const bar = el("div", { class: "marbles-bar", role: "toolbar", ariaLabel: "tools" }, group(selectTool, undoTool, redoTool, pasteTool), group(goTool, streamTool, pauseTool, resetTool), group(fitTool, soundTool, keysTool, runsTool));
        queueMicrotask(() => stacking(bar));

        // the keys, a plain list, and the runs to start from, each in a fold under the bar
        const KEYS: [string, string][] = [
            ["tap, click", "choose a piece"],
            ["Shift, long press", "add a piece to the choice"],
            ["Ctrl and drag, long press on the table", "choose many in a box"],
            ["B", "the select tool"],
            ["Ctrl+A, J", "choose all, choose what is joined"],
            ["Escape", "choose nothing, or put back"],
            ["arrows or WASD", "lift and move a cell"],
            ["Q, E, Alt+up and down", "a level down, up"],
            ["Enter", "put down"],
            ["R, F", "turn, mirror"],
            ["Delete", "take away"],
            ["Ctrl+C, X, V, D", "copy, cut, paste, duplicate"],
            ["Ctrl+Z, Ctrl+Shift+Z", "undo, redo"],
            ["comma, full stop", "the piece before, after"],
            ["Space, Shift+Space", "let a marble go, a stream"],
            ["P, C", "pause, clear the marbles"],
            ["7, 1, 3", "from above, the front, the side"],
            ["5", "the narrow lens"],
            ["Home, Shift+Home", "fit the run, what is chosen"],
            ["plus, minus, Shift+arrows", "nearer, further, turn the view"],
            ["M, ?", "sound, these keys"],
        ];
        const list = el("dl", { class: "marbles-keys-list" });
        for (const [key, what] of KEYS) list.append(el("dt", { textContent: key }), el("dd", { textContent: what }));
        const keys = fold("marbles-keys", list);
        toggleKeys = () => {
            runs.open(runsTool, false);
            keys.open(keysTool);
        };
        const runList = el("ul", { class: "marbles-runs" });
        for (const one of [...RUNS, { name: "an empty table", text: "v1" }]) {
            runList.append(el("li", {}, el("button", { type: "button", textContent: one.name, onclick: () => {
                load(one.text);
                fitRun();
                runs.open(runsTool, false);
            } })));
        }
        runList.append(el("li", {}, el("button", { type: "button", textContent: "choose every piece", onclick: () => {
            selectAll();
            runs.open(runsTool, false);
        } })));
        const runs = fold("marbles-menu", runList);
        panel.append(box, bar, keys.box, runs.box);

        // the strip by what is chosen
        const turnTool = tool("turn", "Turn", "R", () => turnChosen(1));
        const mirrorTool = tool("mirror", "Mirror", "F", mirrorChosen);
        const joinedTool = tool("joined", "Choose what is joined", "J", selectJoined);
        const copyTool = tool("copy", "Copy", "Ctrl+C", copyChosen);
        const duplicateTool = tool("duplicate", "Duplicate", "Ctrl+D", () => duplicate(false));
        const keepTool = tool("keep", "Keep as a piece of your own", "", () => naming(true));
        const removeTool = tool("remove", "Take away", "Delete", removeChosen);
        const name = el("input", { type: "text", class: "marbles-name", ariaLabel: "the piece's name", maxLength: 30 });
        const keepIt = () => {
            const pieces = chosenPieces();
            if (pieces.length) {
                owns = [...owns, { name: name.value.trim() || `piece ${owns.length + 1}`, text: asOwn(pieces) }];
                m.keep("marbles-own", owns, 1);
                ownBox(owns.length - 1);
                sound?.knock(0.4, 1900);
            }
            naming(false);
        };
        name.addEventListener("keydown", (event) => {
            event.stopPropagation();
            if (event.key === "Enter") keepIt();
            if (event.key === "Escape") naming(false);
        });
        const tools = el("div", { class: "marbles-strip-tools" }, turnTool, mirrorTool, joinedTool, copyTool, duplicateTool, keepTool, removeTool);
        const form = el("div", { class: "marbles-strip-name" }, name, tool("done", "Keep it", "Enter", keepIt), tool("close", "Not now", "Escape", () => naming(false)));
        form.inert = true;
        strip.append(tools, form);
        const naming = (on: boolean) => {
            strip.classList.toggle("naming", on);
            form.inert = !on;
            tools.inert = on;
            if (on) {
                name.value = `piece ${owns.length + 1}`;
                name.focus();
                name.select();
            } else m.canvas.focus({ preventScroll: true });
        };
        m.canvas.parentElement!.append(strip);

        tell = () => {
            selectTool.setAttribute("aria-pressed", String(selecting));
            streamTool.setAttribute("aria-pressed", String(streaming));
            undoTool.disabled = !canUndo(steps);
            redoTool.disabled = !canRedo(steps);
            pasteTool.disabled = !clip;
            if (playing) swap(pauseTool, "pause", "Pause", "P");
            else swap(pauseTool, "play", "Play", "P");
            const on = sound?.button.getAttribute("aria-pressed") === "true";
            swap(soundTool, on ? "sound" : "quiet", on ? "Sound is on" : "Sound is off", "M");
            soundTool.setAttribute("aria-pressed", String(on));
            fitTool.replaceChildren(icon(chosen.size ? "fit-chosen" : "fit"));
            fitTool.title = chosen.size ? "Fit what is chosen (Shift+Home)" : "Fit the run (Home)";
            fitTool.onclick = () => (chosen.size ? fitChosen() : fitRun());
        };
    }

    // ---- start ----
    {
        const text = m.preview ? RUNS[1]!.text : m.recall("marbles-run", RUNS[0]!.text, 1);
        try {
            run = read(text);
        } catch {
            run = read(RUNS[0]!.text);
        }
        nextId = run.reduce((most, piece) => Math.max(most, piece.id), 0) + 1;
        const kept = m.preview ? undefined : readSteps(m.recall("marbles-steps", undefined, 1));
        // undo carries on from the last visit, if it was left at this run
        steps = kept && kept.texts[kept.at] === write(run) ? kept : begun(write(run));
        changed(false);
    }
    const resize = () => view?.size(m.width, m.height);
    resize();
    fitRun(true);

    // ---- the keyboard ----
    /** A paste by Control and V: the system's clipboard if it holds a run, else what was copied here. */
    let pasting: ReturnType<typeof setTimeout> | undefined;
    if (!m.preview) {
        m.canvas.addEventListener("keydown", (event) => {
            const key = event.key;
            const lower = key.toLowerCase();
            if (event.ctrlKey || event.metaKey) {
                if (lower === "z" && event.shiftKey) redo();
                else if (lower === "z") undo();
                else if (lower === "y") redo();
                else if (lower === "a") selectAll();
                else if (lower === "d") duplicate(true);
                else if (lower === "c") {
                    // the copy event that follows puts it on the system's clipboard too
                    copyChosen();
                    return;
                } else if (lower === "x") {
                    if (copyChosen()) removeChosen();
                    return;
                } else if (lower === "v") {
                    // the paste event that follows may bring a run from the clipboard; if not, what was copied here
                    clearTimeout(pasting);
                    pasting = setTimeout(() => clip && paste(clip, true), 60);
                    return;
                } else return;
                event.preventDefault();
                m.wake();
                return;
            }
            if (event.altKey) {
                if (key === "ArrowUp") nudge(0, 0, 1);
                else if (key === "ArrowDown") nudge(0, 0, -1);
                else return;
            } else if (event.shiftKey && key.startsWith("Arrow")) {
                free();
                if (key === "ArrowLeft") orbit = kept({ ...orbit, turn: orbit.turn - 0.15 }, orbit);
                if (key === "ArrowRight") orbit = kept({ ...orbit, turn: orbit.turn + 0.15 }, orbit);
                if (key === "ArrowUp") orbit = kept({ ...orbit, tip: orbit.tip + 0.08 }, orbit);
                if (key === "ArrowDown") orbit = kept({ ...orbit, tip: orbit.tip - 0.08 }, orbit);
            } else if (key === "ArrowLeft" || lower === "a") nudge(-1, 0, 0);
            else if (key === "ArrowRight" || lower === "d") nudge(1, 0, 0);
            else if (key === "ArrowUp" || lower === "w") nudge(0, -1, 0);
            else if (key === "ArrowDown" || lower === "s") nudge(0, 1, 0);
            else if (lower === "e" || key === "PageUp") nudge(0, 0, 1);
            else if (lower === "q" || key === "PageDown") nudge(0, 0, -1);
            else if (lower === "r") turnChosen(event.shiftKey ? -1 : 1);
            else if (lower === "f") mirrorChosen();
            else if (key === "Enter") {
                if (carried) drop();
            } else if (key === "Escape") {
                if (carried) cancel();
                else {
                    chosen.clear();
                    boxing = undefined;
                    chosenChanged();
                }
            } else if (key === "Delete" || key === "Backspace") removeChosen();
            else if (key === "," || key === "[") selectStep(-1);
            else if (key === "." || key === "]") selectStep(1);
            else if (lower === "j") selectJoined();
            else if (lower === "b") toggleSelecting();
            else if (key === " ") (event.shiftKey ? toggleStream : letGo)();
            else if (lower === "p") togglePause();
            else if (lower === "c") clearMarbles();
            else if (lower === "m") {
                sound?.button.click();
                tell();
            } else if (key === "?" || key === "/") toggleKeys();
            else if (key === "7") look("top");
            else if (key === "1") look("front");
            else if (key === "3") look("side");
            else if (key === "5") lensTo = lensTo === DEGREES ? NARROW : DEGREES;
            else if (key === "Home" || key === "0") (event.shiftKey ? fitChosen : () => fitRun())();
            else if (key === "+" || key === "=") orbit = kept({ ...orbit, far: orbit.far / 1.15 }, orbit);
            else if (key === "-") orbit = kept({ ...orbit, far: orbit.far * 1.15 }, orbit);
            else return;
            event.preventDefault();
            m.wake();
        });
        m.canvas.addEventListener("copy", (event) => {
            if (!clip || !chosen.size) return;
            event.clipboardData?.setData("text/plain", clip);
            event.preventDefault();
        });
        m.canvas.addEventListener("cut", (event) => {
            if (!clip) return;
            event.clipboardData?.setData("text/plain", clip);
            event.preventDefault();
        });
        m.canvas.addEventListener("paste", (event) => {
            const text = event.clipboardData?.getData("text/plain")?.trim() ?? "";
            try {
                if (!read(text).length) return;
            } catch {
                return;
            }
            clearTimeout(pasting);
            event.preventDefault();
            paste(text, true);
        });
    }

    /** Two fingers: where between them, how far apart, and at what angle, to pan, pinch and twist by. */
    let pinch: { x: number; y: number; apart: number; angle: number } | undefined;
    const pinchOf = () => {
        const [a, b] = [...held.values()].filter((one) => one.mode === "pinch").map((one) => one.last);
        if (!a || !b) return undefined;
        return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, apart: Math.hypot(a.x - b.x, a.y - b.y), angle: Math.atan2(b.y - a.y, b.x - a.x) };
    };

    // ---- the little axes in the corner: pressed, the view turns to look along one ----
    /** Where the little axes are, and each end's place on the screen, made each frame. */
    let gizmo: { x: number; y: number; way: Way; radius: number }[] = [];
    const GIZMO = { radius: 26, margin: 14, dot: 9 };
    /** The end under a press: the nearest to it, of those near enough. */
    const gizmoAt = (x: number, y: number): Way | undefined => gizmo.filter((end) => Math.hypot(end.x - x, end.y - y) < end.radius).sort((a, b) => Math.hypot(a.x - x, a.y - y) - Math.hypot(b.x - x, b.y - y))[0]?.way;

    // ---- the ghost marble ----
    let ghostKey = "";
    let ghostLine: Part | undefined;
    let ghostShown = -1;
    let ghostBalls: Part[] = [];
    /** Seconds since the ghost started, for the faint marble sliding along its way; how many times it has gone along it since the last change. */
    let ghostClock = 0;
    let ghostPlays = 0;
    /** What the ghost runs on: the run as it would be, with what is carried where it would go, if it fits there. */
    const ghostRun = () => {
        const base = resting();
        if (!carried || !carried.fits || carried.away) return base;
        return [...base, ...placedOf(carried)];
    };
    const ghostMesh = (): Mesh | undefined => {
        const points: V3[] = [];
        const faces: number[][] = [];
        for (const path of ghost.paths) {
            const places = path.places.filter((_, i) => i % 2 === 0 || i === path.places.length - 1);
            if (places.length < 2) continue;
            const first = points.length;
            places.forEach((p, i) => {
                const next = places[Math.min(places.length - 1, i + 1)]!;
                const back = places[Math.max(0, i - 1)]!;
                let d: V3 = [next[0] - back[0], next[1] - back[1], next[2] - back[2]];
                const long = Math.hypot(...d) || 1;
                d = [d[0] / long, d[1] / long, d[2] / long];
                // across the way, level where it can be; a thin square tube round the marble's path
                let side: V3 = [-d[2], 0, d[0]];
                const s = Math.hypot(...side);
                side = s > 0.1 ? [side[0] / s, 0, side[2] / s] : [1, 0, 0];
                const up: V3 = [side[1] * d[2] - side[2] * d[1], side[2] * d[0] - side[0] * d[2], side[0] * d[1] - side[1] * d[0]];
                // a thread lying along the top of where the marble goes, so that the track does not hide it
                const r = 0.16;
                const lift = RADIUS + 0.2;
                for (const [a, b] of [[1, 0], [0, 1], [-1, 0], [0, -1]] as const) points.push([p[0] + (side[0] * a + up[0] * b) * r, p[1] + lift + (side[1] * a + up[1] * b) * r, p[2] + (side[2] * a + up[2] * b) * r]);
            });
            for (let i = 0; i + 1 < places.length; i++) {
                for (let k = 0; k < 4; k++) {
                    const [a, b] = [first + i * 4 + k, first + i * 4 + ((k + 1) % 4)];
                    faces.push([a, a + 4, b + 4, b]);
                }
            }
        }
        return points.length ? { points, faces, smooth: true } : undefined;
    };
    const drawGhost = (dt: number) => {
        if (!view || m.preview) return;
        const key = write(ghostRun());
        if (key !== ghostKey) {
            ghostKey = key;
            ghost.start(ghostRun());
            ghostShown = -1;
            ghostPlays = 0;
            if (!carried) ghostClock = 0;
        }
        const before = performance.now();
        if (!ghost.done) {
            ghost.work(carried ? GHOST_WORK.carrying : GHOST_WORK.still);
            if (ghost.done && !carried) {
                ghostMarked = ghostMarks(ghost.paths, openMarks);
                redraw();
            }
        }
        took.ghost += (performance.now() - before - took.ghost) * 0.05;
        const total = ghost.paths.reduce((sum, path) => sum + path.places.length, 0);
        if (total !== ghostShown && (ghost.done || total - ghostShown > 40 || ghostShown < 0)) {
            ghostShown = total;
            if (ghostLine) view.remove(ghostLine);
            const mesh = ghostMesh();
            ghostLine = mesh && view.add(mesh, { color: colors.ghost, alpha: 0.45, casts: false, gloss: 0, shaded: false });
        }
        while (ghostBalls.length < ghost.paths.length) ghostBalls.push(view.add(marble, { color: colors.ghost, alpha: 0.4, casts: false, gloss: 0.4 }));
        while (ghostBalls.length > ghost.paths.length) view.remove(ghostBalls.pop()!);
        ghostClock += dt;
        ghost.paths.forEach((path, i) => {
            const part = ghostBalls[i]!;
            // along its way at the speed a marble goes, a short rest at the end, and again
            const length = path.places.length + 40;
            const at = Math.floor(ghostClock * 60) % length;
            if (i === 0 && Math.floor(ghostClock * 60) >= length * (ghostPlays + 1) && ghost.done) ghostPlays++;
            part.hidden = at >= path.places.length;
            if (!part.hidden) part.at = path.places[at]!;
        });
    };

    /** The last press, for a browser test to read. */
    let pressed: { x: number; y: number; handle?: Handle; kind: string } | undefined;
    let time = 0;
    /** How long the physics, the ghost and the drawing take, in milliseconds, evened out over the last frames; and the longest frame lately: for measuring. */
    const took = { step: 0, draw: 0, ghost: 0, frame: 0, most: 0 };
    let lastFrame = 0;
    // With `?test` in the address, a browser test can find pieces and handles on the screen, choose, and
    // read the run, the ghost and the time a frame takes. Nothing is drawn for it.
    if (!m.preview && m.link.get("test") !== null) {
        (window as unknown as { marbles: unknown }).marbles = {
            ends: () => open(run).map((joint) => ({ id: joint.id, joint: joint.joint, at: onScreen(joint.at), family: run.find((piece) => piece.id === joint.id)!.kind.family })),
            end: () => end && { id: end.id, joint: end.joint, at: onScreen(end.at) },
            pieces: () => run.map((piece) => ({ id: piece.id, family: piece.kind.family, sizes: piece.kind.sizes, at: onScreen(toWorld(piece.place, handleOf(piece.kind))) })),
            choose: (ids: number[]) => {
                chosen.clear();
                for (const id of ids) chosen.add(id);
                chosenChanged();
            },
            chosen: () => [...chosen],
            under: (x: number, y: number) => pieceAt(x, y)?.id,
            jointAt: (id: number, joint: number) => {
                const piece = run.find((one) => one.id === id);
                return piece && onScreen(jointsOf(piece)[joint]!.at);
            },
            /** Points of a piece on the screen where a press takes that piece and no other. */
            spots: (id: number) => {
                const piece = run.find((one) => one.id === id);
                if (!piece) return [];
                return shapeOf(piece.kind).room.map((box) => onScreen(boxToWorld(piece.place, box).at)).filter((p): p is { x: number; y: number } => Boolean(p) && pieceAt(p!.x, p!.y)?.id === id);
            },
            handles: () => handlesNow(),
            pressed: () => pressed,
            /** The handle a press there would take, if any. */
            handleAt: (x: number, y: number, kind: "touch" | "mouse") => {
                const shown = !carried && chosen.size ? handlesNow() : undefined;
                const handle = shown && which(shown, x, y, kind);
                const piece = pieceAt(x, y);
                return handle && piece && chosen.has(piece.id) ? which(shown, x, y, "mouse") : handle;
            },
            screen: (p: V3) => onScreen(p),
            text: () => write(run),
            steps: () => ({ at: steps.at, count: steps.texts.length }),
            ghost: () => ({ done: ghost.done, paths: ghost.paths.map((path) => ({ ending: path.ending, last: path.last, length: path.places.length, end: onScreen(path.places.at(-1)!) })) }),
            owns: () => owns.map((one) => one.name),
            carried: () => carried && { fits: carried.fits, count: carried.home.length, snapped: Boolean(carried.snap), move: carried.move, pivot: carried.pivot, anchor: carried.anchor, handle: carried.handle, kinds: carried.home.map((piece) => keyOf(piece.kind)), snaps: carried.snaps.map((snap) => ({ to: snap.to.id, joint: snap.joint.id, entry: snap.joint.joint, at: onScreen(movedPoint(snap.joint.at, carried!.move)), goal: onScreen(snap.to.at) })) },
            marbles: () => ({ all: table.marbles.length, arrived: table.marbles.filter(table.arrived).length, asleep: table.marbles.filter((one) => one.rest).length }),
            marks: () => [...openMarks, ...ghostMarked],
            took: () => ({ ...took }),
            settle: () => {
                took.most = 0;
            },
            gizmo: () => gizmo,
            orbit: (next?: Partial<Orbit>) => {
                if (next) orbit = kept({ ...orbit, ...next }, { ...orbit, ...next });
                m.wake();
                return { ...orbit, lens };
            },
        };
    }

    return {
        down(hand) {
            if (m.preview) return;
            easing = undefined;
            const one: Held = { hand, start: { x: hand.x, y: hand.y }, last: { x: hand.x, y: hand.y }, since: time, mode: "press" };
            // a paste that follows the mouse is put down where it is pressed
            if (carried?.hand === "hover") {
                one.mode = "done";
                held.set(hand.id, one);
                drop();
                return;
            }
            // pieces lifted by the keys are put down when the pointer is used
            if (carried && carried.hand === undefined) drop();
            const fingers = [...held.values()].filter((other) => other.hand.kind === "touch");
            if (hand.kind === "touch" && fingers.length === 1 && (fingers[0]!.mode === "press" || fingers[0]!.mode === "turn" || fingers[0]!.mode === "pan")) {
                // a second finger: the two pan, pinch and twist the view together
                fingers[0]!.mode = "pinch";
                one.mode = "pinch";
                held.set(hand.id, one);
                pinch = pinchOf();
                return;
            }
            if (hand.kind === "touch" && fingers.length >= 1) return;
            const way = gizmoAt(hand.x, hand.y);
            if (way && hand.button === 0) {
                one.mode = "gizmo";
                one.gizmo = way;
                held.set(hand.id, one);
                return;
            }
            if (hand.button === 2 || hand.button === 1 || (hand.button === 0 && hand.shift && !pieceAt(hand.x, hand.y))) one.mode = "pan";
            else {
                // Shift and the select tool are for choosing, so the handles of what is chosen do not take the press
                const shown = !carried && chosen.size && !hand.shift && !selecting ? handlesNow() : undefined;
                const handle = shown && which(shown, hand.x, hand.y, hand.kind === "touch" ? "touch" : "mouse");
                // a handle is taken once the press moves; still, it is a press on what is under it. Over a
                // chosen piece, only a press on the handle itself takes it, not one a fingertip from it, so
                // that what is chosen can still be carried where the handles cross it
                one.piece = pieceAt(hand.x, hand.y);
                one.handle = handle || undefined;
                if (one.handle && one.piece && chosen.has(one.piece.id) && shown) one.handle = which(shown, hand.x, hand.y, "mouse");
                pressed = { x: hand.x, y: hand.y, handle: one.handle, kind: hand.kind };
                if (!one.piece && !one.handle && hand.ctrl) {
                    one.mode = "box";
                    boxing = { from: one.start, to: one.start, adding: hand.shift };
                }
            }
            held.set(hand.id, one);
        },
        slide(hand) {
            const one = held.get(hand.id);
            if (!one) {
                // the mouse passing over: a paste follows it; a handle under it is lit
                if (hand.held) return;
                if (carried?.hand === "hover") follow(hand.x, hand.y, "mouse");
                else if (hand.kind === "mouse") {
                    const shown = !carried && chosen.size ? handlesNow() : undefined;
                    const now = shown && which(shown, hand.x, hand.y, "mouse");
                    if (now !== hovered) {
                        hovered = now;
                        m.wake();
                    }
                }
                return;
            }
            const [dx, dy] = [hand.x - one.last.x, hand.y - one.last.y];
            one.last = { x: hand.x, y: hand.y };
            if (one.mode === "pinch") {
                const now = pinchOf();
                if (now && pinch) {
                    orbit = panned(orbit, DEGREES, -(now.x - pinch.x) / m.height, -(now.y - pinch.y) / m.height);
                    const twist = now.angle - pinch.angle;
                    if (Math.abs(twist) > 1e-4) free();
                    orbit = kept({ ...orbit, far: orbit.far * (pinch.apart / Math.max(1, now.apart)), turn: orbit.turn - twist }, orbit);
                }
                pinch = now;
            } else if (one.mode === "press") {
                if (Math.hypot(hand.x - one.start.x, hand.y - one.start.y) < STILL) return;
                if (one.handle) {
                    one.mode = "handle";
                    startHandle(one.handle, { ...hand, x: one.start.x, y: one.start.y });
                    dragHandle(hand.x, hand.y);
                } else if (one.piece) {
                    one.mode = "carry";
                    // a piece of the choice carries all of it; another piece, itself alone
                    if (!chosen.has(one.piece.id)) {
                        chosen.clear();
                        chosen.add(one.piece.id);
                    }
                    const pieces = chosenPieces();
                    startCarry(pieces, true, one.piece.id, hand.id, one.start);
                    follow(hand.x, hand.y, hand.kind === "touch" ? "touch" : "mouse");
                } else if (selecting) {
                    one.mode = "box";
                    boxing = { from: one.start, to: { x: hand.x, y: hand.y }, adding: true };
                } else {
                    one.mode = "turn";
                    free();
                }
            } else if (one.mode === "carry") follow(hand.x, hand.y, hand.kind === "touch" ? "touch" : "mouse");
            else if (one.mode === "handle") dragHandle(hand.x, hand.y);
            else if (one.mode === "box" && boxing) boxing.to = { x: hand.x, y: hand.y };
            else if (one.mode === "turn") orbit = kept({ ...orbit, turn: orbit.turn - dx * 0.008, tip: orbit.tip + dy * 0.006 }, orbit);
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
            } else if (one.mode === "carry" || one.mode === "handle") {
                if (cancelled) cancel();
                else drop();
            } else if (one.mode === "gizmo") {
                if (Math.hypot(hand.x - one.start.x, hand.y - one.start.y) < STILL * 2 && one.gizmo) look(one.gizmo);
            } else if (one.mode === "box" && boxing) {
                const [left, right] = [Math.min(boxing.from.x, boxing.to.x), Math.max(boxing.from.x, boxing.to.x)];
                const [top, bottom] = [Math.min(boxing.from.y, boxing.to.y), Math.max(boxing.from.y, boxing.to.y)];
                if (!boxing.adding) chosen.clear();
                for (const piece of run) {
                    const seen = onScreen(toWorld(piece.place, handleOf(piece.kind)));
                    if (seen && seen.x >= left && seen.x <= right && seen.y >= top && seen.y <= bottom) chosen.add(piece.id);
                }
                boxing = undefined;
                sound?.knock(0.2, 1900);
                chosenChanged();
            } else if (one.mode === "press") {
                // a press that did not move: on a piece it is chosen (added with Shift or the select
                // tool); on the table, the choice is let go
                if (one.piece) {
                    if (hand.shift || selecting) {
                        if (chosen.has(one.piece.id)) chosen.delete(one.piece.id);
                        else chosen.add(one.piece.id);
                    } else {
                        chosen.clear();
                        chosen.add(one.piece.id);
                    }
                } else if (!hand.shift && !selecting) chosen.clear();
                chosenChanged();
            }
            m.wake();
        },
        wheel(_x, _y, by, isPinch) {
            orbit = kept({ ...orbit, far: orbit.far * Math.exp(by * (isPinch ? 0.01 : 0.0012)) }, orbit);
            easing = undefined;
            m.wake();
        },
        step(dt) {
            time += dt;
            // a finger held still is a long press: on a piece it adds it to the choice, on the table it starts a box
            for (const one of held.values()) {
                if (one.mode !== "press" || one.hand.kind !== "touch" || time - one.since < LONG || (one.handle && !one.piece)) continue;
                if (one.piece) {
                    if (chosen.has(one.piece.id)) chosen.delete(one.piece.id);
                    else chosen.add(one.piece.id);
                    one.mode = "done";
                    chosenChanged();
                } else {
                    one.mode = "box";
                    boxing = { from: one.start, to: one.last, adding: true };
                }
                sound?.knock(0.25, 1700);
                navigator.vibrate?.(8);
            }
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
            // what is carried eases to where it would go: quick to start and slow to settle
            if (carried) {
                const goal = target(carried);
                const k = reduced ? 1 : 1 - Math.exp(-dt / SETTLE);
                let angle = goal.angle;
                while (angle - carried.shown.angle > Math.PI) angle -= 2 * Math.PI;
                while (angle - carried.shown.angle < -Math.PI) angle += 2 * Math.PI;
                const s = carried.shown;
                carried.shown = { at: [s.at[0] + (goal.at[0] - s.at[0]) * k, s.at[1] + (goal.at[1] - s.at[1]) * k, s.at[2] + (goal.at[2] - s.at[2]) * k], angle: s.angle + (angle - s.angle) * k, scale: s.scale + (1 - s.scale) * k };
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
            if (lens !== lensTo) {
                // the lens eases in the tangent of its half angle, which is how the size of what is seen changes
                const [now, goal] = [Math.tan((lens * Math.PI) / 360), Math.tan((lensTo * Math.PI) / 360)];
                const next = reduced ? goal : now + (goal - now) * (1 - Math.exp(-dt / 0.12));
                lens = Math.abs(next - goal) < 1e-4 ? lensTo : (Math.atan(next) * 360) / Math.PI;
            }
            shake = Math.max(0, shake - dt);
        },
        resting: () => !m.preview && !carried && !flying.length && !easing && lens === lensTo && !streaming && shake <= 0 && (!playing || table.marbles.every((one) => one.rest)) && !held.size && ghost.done && ghostPlays >= 1,
        resize,
        debug: () => [`${run.length} pieces, ${table.marbles.length} marbles, ${table.marbles.filter((one) => one.rest).length} asleep`, `ghost ${took.ghost.toFixed(2)} ms, frame ${took.frame.toFixed(2)} ms`],
        destroy: () => {
            strip.remove();
            view?.dispose();
        },
        draw() {
            if (!view) return;
            const started = performance.now();
            const dt = lastFrame ? Math.min(0.05, (started - lastFrame) / 1000) : 0;
            lastFrame = started;
            const { orbit: seen, degrees } = cam();
            view.range = [Math.max(2, seen.far * 0.02), seen.far + 4000];
            view.look(eyeOf(seen), seen.at, degrees);
            // what could not be done shakes a little, side to side, dying away
            const wobble = shake > 0 ? Math.sin(shake * 60) * shake * 1.2 : 0;
            for (const piece of chosenPieces()) {
                const one = drawn.get(piece.id);
                if (one) pose(one.parts, [piece.place.x * CELL + wobble, piece.place.y * LEVEL, piece.place.z * CELL], angleOf(piece.place));
            }
            if (carried) {
                for (const piece of carried.home) {
                    const at = poseIn(carried, piece);
                    pose(carried.parts.get(piece.id) ?? [], at.at, at.angle, at.scale);
                }
            }
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
            drawGhost(dt);
            // the handles, a fingertip's size at any distance, on what is chosen, or on what a handle carries
            if (handleParts) {
                const shown = handlesNow();
                const pieces = carried ? placedOf(carried) : chosenPieces();
                for (const part of Object.values(handleParts)) part.hidden = true;
                if (shown && pieces.length) {
                    const middle = carried ? shownPoint(carried, carried.origin!) : handleMiddle(pieces);
                    const size = across(seen, degrees, m.height, middle) * ARROW;
                    const lit = carried?.handle ?? hovered;
                    for (const name of ["x", "y", "z", "ring"] as const) {
                        const part = handleParts[name];
                        // while one is dragged, only it is shown
                        part.hidden = (name === "ring" ? false : !shown.arrows[name]) || (carried?.handle !== undefined && carried.handle !== name);
                        part.at = middle;
                        part.scale = size;
                        part.emit = lit === name ? 0.35 : 0;
                    }
                    const knob = carried ? (carried.handle === "knob" ? knobOf(pieces) : undefined) : knobOf(pieces);
                    if (knob) {
                        handleParts.knob.hidden = false;
                        handleParts.knob.at = knob;
                        handleParts.knob.scale = size;
                        handleParts.knob.emit = lit === "knob" ? 0.35 : 0;
                    }
                }
            }
            const before = performance.now();
            view.draw();
            took.draw += (performance.now() - before - took.draw) * 0.05;
            if (!m.preview) overlay();
            const frame = performance.now() - started;
            took.frame += (frame - took.frame) * 0.05;
            took.most = Math.max(took.most, frame);
        },
    };

    /** What is drawn flat over the scene: the box being drawn to choose many, the little axes, and the strip's place by the selection. */
    function overlay() {
        const ctx = m.ctx;
        if (boxing) {
            const [x, y] = [Math.min(boxing.from.x, boxing.to.x), Math.min(boxing.from.y, boxing.to.y)];
            const [w, h] = [Math.abs(boxing.to.x - boxing.from.x), Math.abs(boxing.to.y - boxing.from.y)];
            ctx.fillStyle = `color-mix(in oklch, ${m.color("--accent")} 12%, transparent)`;
            ctx.fillRect(x, y, w, h);
            ctx.strokeStyle = m.color("--accent");
            ctx.lineWidth = 1.5;
            ctx.setLineDash([5, 4]);
            ctx.strokeRect(x + 0.5, y + 0.5, w, h);
            ctx.setLineDash([]);
        }
        // the little axes: each end where that axis points on the screen, the near ends drawn over the far
        const { orbit: seen, degrees } = cam();
        const middle = { x: m.width - GIZMO.margin - GIZMO.radius - GIZMO.dot, y: GIZMO.margin + GIZMO.radius + GIZMO.dot };
        const eye = eyeOf(seen);
        const back: V3 = [eye[0] - seen.at[0], eye[1] - seen.at[1], eye[2] - seen.at[2]];
        const long = Math.hypot(...back);
        // the eye's own right and up, as orbit.ts and gl.ts work them out
        const unit = (v: V3): V3 => {
            const l = Math.hypot(...v) || 1;
            return [v[0] / l, v[1] / l, v[2] / l];
        };
        const b0 = unit(back);
        const side = unit(Math.abs(b0[1]) > 0.999 ? [b0[1], -b0[0], 0] : [b0[2], 0, -b0[0]]);
        const upward: V3 = [b0[1] * side[2] - b0[2] * side[1], b0[2] * side[0] - b0[0] * side[2], b0[0] * side[1] - b0[1] * side[0]];
        const ends: { way?: Way; axis: "x" | "y" | "z"; sign: number; x: number; y: number; near: number }[] = [];
        for (const [axis, d] of Object.entries(AXES) as ["x" | "y" | "z", V3][]) {
            for (const sign of [1, -1]) {
                const [sx, sy] = [(d[0] * side[0] + d[1] * side[1] + d[2] * side[2]) * sign, -(d[0] * upward[0] + d[1] * upward[1] + d[2] * upward[2]) * sign];
                const way: Way | undefined = axis === "y" ? (sign > 0 ? "top" : undefined) : axis === "z" ? (sign > 0 ? "front" : "back") : sign > 0 ? "side" : "left";
                ends.push({ way, axis, sign, x: middle.x + sx * GIZMO.radius, y: middle.y + sy * GIZMO.radius, near: (d[0] * b0[0] + d[1] * b0[1] + d[2] * b0[2]) * sign });
            }
        }
        ends.sort((a, b) => a.near - b.near);
        gizmo = ends.filter((one) => one.way).map((one) => ({ x: one.x, y: one.y, way: one.way!, radius: 20 }));
        const now = straightOn(orbit);
        ctx.lineWidth = 2;
        ctx.lineCap = "round";
        for (const one of ends) {
            const color = css[one.axis];
            if (one.sign > 0) {
                ctx.strokeStyle = color;
                ctx.globalAlpha = 0.8;
                ctx.beginPath();
                ctx.moveTo(middle.x, middle.y);
                ctx.lineTo(one.x, one.y);
                ctx.stroke();
            }
            ctx.globalAlpha = one.sign > 0 ? 1 : 0.65;
            ctx.beginPath();
            ctx.arc(one.x, one.y, one.sign > 0 ? GIZMO.dot : GIZMO.dot * 0.62, 0, 2 * Math.PI);
            if (one.sign > 0) {
                ctx.fillStyle = color;
                ctx.fill();
                // the view it is in now is ringed
                if (one.way && one.way === (now === "side" ? "side" : now)) {
                    ctx.strokeStyle = m.color("--ink");
                    ctx.lineWidth = 1.5;
                    ctx.beginPath();
                    ctx.arc(one.x, one.y, GIZMO.dot + 3, 0, 2 * Math.PI);
                    ctx.stroke();
                    ctx.lineWidth = 2;
                }
            } else {
                ctx.strokeStyle = color;
                ctx.stroke();
            }
        }
        ctx.globalAlpha = 1;
        // the strip grows by what is chosen, above it, or under it where there is no room above
        const pieces = chosenPieces();
        const shownStrip = pieces.length > 0 && !carried && !boxing && ![...held.values()].some((one) => one.mode === "turn" || one.mode === "pinch" || one.mode === "pan");
        strip.classList.toggle("shown", shownStrip);
        strip.inert = !shownStrip;
        if (!shownStrip) return;
        let [left, right, top, bottom] = [Infinity, -Infinity, Infinity, -Infinity];
        // the handles are kept clear too: the strip goes above the highest of them, or under the lowest
        const handles = handlesNow();
        for (const point of [...(handles?.ring ?? []), ...Object.values(handles?.arrows ?? {}).map((arrow) => arrow.to), ...(handles?.knob ? [handles.knob] : [])]) {
            [top, bottom] = [Math.min(top, point.y - 12), Math.max(bottom, point.y + 12)];
        }
        for (const piece of pieces) {
            for (const box of shapeOf(piece.kind).room.filter((_, i, all) => i % Math.max(1, Math.floor(all.length / 6)) === 0)) {
                const at = boxToWorld(piece.place, box).at;
                const seenAt = onScreen(at);
                if (!seenAt) continue;
                [left, right, top, bottom] = [Math.min(left, seenAt.x), Math.max(right, seenAt.x), Math.min(top, seenAt.y), Math.max(bottom, seenAt.y)];
            }
        }
        if (!Number.isFinite(left)) return;
        const [w, h] = [strip.offsetWidth, strip.offsetHeight];
        const above = top - h - 10;
        const below = above < 8;
        const y = below ? Math.min(m.height - h - 8, bottom + 10) : above;
        const x = Math.max(8, Math.min(m.width - w - 8, (left + right) / 2 - w / 2));
        const place = `${Math.round(x)}px ${Math.round(y)}px`;
        if (strip.style.translate !== place) strip.style.translate = place;
        strip.classList.toggle("below", below);
    }
}

/** Small pictures of groups of pieces, drawn by the same code and in the same colours as the scene, each on a canvas of its own. */
function paintBox(view: View | undefined, colors: Record<string, Color>, groups: Placed[][]): HTMLCanvasElement[] {
    const size = 128;
    const pictures: HTMLCanvasElement[] = [];
    if (!view || !groups.length) return pictures;
    const canvas = document.createElement("canvas");
    canvas.width = size;
    canvas.height = size;
    const own = gl(canvas);
    if (!own) return pictures;
    own.range = [1, 4000];
    own.size(size / Math.min(window.devicePixelRatio || 1, 2), size / Math.min(window.devicePixelRatio || 1, 2));
    for (const group of groups) {
        const parts: Part[] = [];
        const low: V3 = [Infinity, Infinity, Infinity];
        const high: V3 = [-Infinity, -Infinity, -Infinity];
        for (const piece of group) {
            const drawing = drawingOf(piece.kind);
            for (const which of ["wood", "flat", "glass"] as const) {
                const mesh = drawing[which];
                if (!mesh) continue;
                const part = own.add(mesh, { color: colors[which] ?? colors.wood!, gloss: which === "glass" ? 0.5 : 0.12, alpha: which === "glass" ? 0.38 : 1 });
                part.at = [piece.place.x * CELL, piece.place.y * LEVEL, piece.place.z * CELL];
                part.turn = turnAbout((piece.place.turn * Math.PI) / 2);
                parts.push(part);
            }
            for (const box of shapeOf(piece.kind).room) {
                const placed = boxToWorld(piece.place, box);
                for (let axis = 0; axis < 3; axis++) {
                    low[axis] = Math.min(low[axis]!, placed.at[axis]! - placed.half[axis]!);
                    high[axis] = Math.max(high[axis]!, placed.at[axis]! + placed.half[axis]!);
                }
            }
        }
        // framed from the same corner for every piece, so that their sizes can be told apart
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
