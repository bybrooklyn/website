// The marble run, a draft: build a run from a box of pieces whose ends click together, and let marbles
// go down it, editing it while they roll. Stages 2 to 4 of its plan (docs/marbles.md): the box, joints,
// snapping, pillars and marbles; then the editor: a selection of one piece or many, handles to move,
// turn and resize it, undo without limit, copy, paste and mirror, pieces of one's own, views straight
// on, and a ghost marble showing where a marble would go; then bending a piece by points along it,
// within its limits; then moving and sounding pieces (parts.ts), drawn where Mote's physics has them each
// frame, and the run's own sound, each strike made by Mote's sound code from how fast it was and what
// was struck; then the look: oak with its grain along every piece, glass marbles with a ribbon inside,
// steel and brass, on a dark cloth under one warm lamp, with soft shadows, drawn by Mote's patterns (gl.ts)
// from look.ts.
//
// What it stands on: pieces.ts (the box) and parts.ts (its moving and sounding pieces), run.ts (a run as data), edit.ts (groups moved, turned,
// mirrored, resized), history.ts (undo), ghost.ts (the ghost marble), handles.ts (the handles),
// table.ts (Mote's physics for a run), supports.ts (pillars), checks.ts (open ends), orbit.ts (the
// camera), runs.ts (made runs), toolbar.ts (the icons and the bar).
//
// One finger or the main button on a piece carries it (the whole selection if it is in it); on the
// table it turns the view; two fingers, the other button, or Shift with the main one, move the view; a
// pinch or the wheel brings it nearer. A tap chooses a piece; Shift, a long press, or the select tool
// adds to the choice; a long press on the table, Control with a drag, or the select tool draws a box
// round many. Keys are listed in the keys panel and in the keydown handler below.

import { gl, type Color, type Look, type Part, type Pattern, type View } from "../mote/gl";
import { turn as turnOf, type Solid } from "../mote/space";
import { ball, block, type Mesh, type Turn, type V3 } from "../mote/solids";
import { grained, grainedBox, marbleLook, merged, pane, tableMesh, woodSeed, type Hole } from "./look";
import { sounds, type Sounds, type Strike } from "../mote/sound";
import { el, type Hand, type Mote, type Scene } from "../mote/stage";
import { turned } from "../mote/track";
import { checks, type Mark } from "./checks";
import { STILL as NO_MOVE, about, asOwn, groupFits, groupSnaps, joinedTo, knobAt, matched, middleOf, mirrored, mirrorLine, moved, movedPoint, pivotOf, RESIZABLE, rebent, resizable, resized, rotated, then, type GroupSnap, type Move } from "./edit";
import { ghostMarks, makeGhost } from "./ghost";
import { AXES, ARROW, RING, across, along, arrowMesh, dragged, freedomOf, layout, pixelsOf, pointOf, pointsLayout, ringMesh, snapped, standOff, stripPlace, turnedBy, which, type Freedom, type Handle, type Rect, type Shown, type Snaps } from "./handles";
import { begun, canRedo, canUndo, readSteps, recorded, redone, replaced, trimmed, undone, type Steps } from "./history";
import { NARROW, STRAIGHT, eyeOf, enters, framing, ground, kept, lensed, nearest, panned, project, ray, straightOn, type Orbit } from "./orbit";
import { BOX, CELL, FURTHEST, LEVEL, RADIUS, SIZES, allowed, bendAllowed, blockMesh, boxToWorld, brokenBy, isBent, keyOf, pointsIn, pointsOf, shapeOf, strainOf, sweepOf, toWorld, warned, wayToWorld, withBend, type Box, type Broken, type Kind, type Place } from "./pieces";
import { fits, jointsOf, links, open, read, upgraded, write, type Open, type Placed } from "./run";
import { RUNS } from "./runs";
import { PILLAR } from "./supports";
import { NOTES, type Body, type Moving } from "./parts";
import { chainAt, chainLength, makeTable } from "./table";
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
/** How fast a marble strikes each thing for the strike to sound at its hardest, in cm/s: a metre's drop is 340. */
const HARD: Record<Strike, number> = { wood: 150, glass: 120, metal: 130, chime: 110, bell: 110, drum: 110 };
/** How long the ghost may work each frame, in milliseconds: less while something is carried or a point dragged, so that the drag stays smooth, and while marbles are in play, when the moving parts they turn start it again often. */
const GHOST_WORK = { carrying: 2.5, still: 6 };

/**
 * What a piece is drawn with, in its own place: its blocks of track and its bowl, its boxes and stands
 * (oak, all of it), glass, what is struck and sounds (in what it is made of), and its moving part as it
 * rests, which is drawn so only where the physics does not have it (in the box, carried, flying).
 */
interface Drawing {
    wood?: Mesh;
    flat?: Mesh;
    glass?: Mesh;
    metal?: Mesh;
    /** What the struck part is made of: a chime bar brushed steel, a bell brass, a drum a skin on oak. */
    metalLook?: { pattern: Pattern; color: Color };
    moving?: Mesh;
    /** The steel of the moving part as it rests: counterweights, a spinner's arms, a lift's car, a hoist's paddles. */
    steel?: Mesh;
}

/** Whether a body of a moving part is metal: steel and aluminium are heavy, oak is not. */
const isMetal = (body: Body) => body.density >= 2;

/** The metals' colors, as they are lit: steel, brass, and the paler steel of a chime bar. */
const STEEL: Color = [0.72, 0.73, 0.76];
const BRASS: Color = [0.86, 0.66, 0.34];
const CHIME: Color = [0.82, 0.83, 0.86];
/** How wide the slot down a hoist's groove is drawn, in cm, for its paddles to come up through. */
const SLOT = 0.8;

/** A mesh with every point turned about the line through `at` along a unit axis by an angle, for drawing a part as it rests. */
function turnedMesh(mesh: Mesh, at: V3, axis: V3, angle: number): Mesh {
    const [c, k] = [Math.cos(angle), Math.sin(angle)];
    const points = mesh.points.map((p): V3 => {
        const r: V3 = [p[0] - at[0], p[1] - at[1], p[2] - at[2]];
        const along = r[0] * axis[0] + r[1] * axis[1] + r[2] * axis[2];
        const cross: V3 = [axis[1] * r[2] - axis[2] * r[1], axis[2] * r[0] - axis[0] * r[2], axis[0] * r[1] - axis[1] * r[0]];
        return [0, 1, 2].map((i) => at[i]! + r[i]! * c + cross[i]! * k + axis[i]! * along * (1 - c)) as V3;
    });
    return { ...mesh, points };
}

/** A body of a moving part as a mesh in its piece's own place: a box at its middle, leant and turned as the body is, then turned about `at` along `axis` by `angle` more. */
function bodyMesh(body: Body, at: V3, axis: V3, angle: number, about = body.at): Mesh {
    const box = grainedBox(body.half);
    let mesh: Mesh = { ...box, points: box.points.map((p): V3 => [p[0] + body.at[0], p[1] + body.at[1], p[2] + body.at[2]]) };
    if (body.lean) mesh = turnedMesh(mesh, body.at, [1, 0, 0], body.lean);
    if (body.turn) mesh = turnedMesh(mesh, about === body.at ? body.at : at, axis, body.turn);
    return angle ? turnedMesh(mesh, at, axis, angle) : mesh;
}

/** A moving part as it rests, in its piece's own place: a hinge at its starting angle, a lift's car at the bottom, a hoist's paddles round its chain. */
function restingMeshes(moving: Moving): Mesh[] {
    if (moving.kind === "hinge") return moving.bodies.map((body) => bodyMesh(body, moving.at, moving.axis, moving.start, moving.at));
    if (moving.kind === "lift") return moving.bodies.map((body) => bodyMesh(body, body.at, [0, 0, 1], 0));
    const paddle = moving.bodies[0]!;
    const long = chainLength(moving);
    return Array.from({ length: moving.count }, (_, k) => {
        const { at, out } = chainAt(moving, (long * k) / moving.count);
        const angle = Math.atan2(-out[0], out[1]);
        const middle: V3 = [at[0] + out[0] * paddle.at[1], at[1] + out[1] * paddle.at[1], paddle.at[2]];
        return turnedMesh(bodyMesh({ ...paddle, at: middle }, middle, [0, 0, 1], 0), middle, [0, 0, 1], angle);
    });
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
    shape.lengths.forEach((length, index) => {
        const piece = sweepOf(length);
        if (length.section === "tube") {
            // a tube's edges are its outline, seen by the glass itself: no places in the pattern to find edges by
            const tube = piece.mesh();
            glass.push({ mesh: { ...tube, grain: tube.points.map((): V3 => [0, 0, 0]) } });
        } else {
            const path = length.path;
            const straight = !length.bend && "points" in path && path.points.length === 2 && path.start[0] * path.end[0] + path.start[1] * path.end[1] + path.start[2] * path.end[2] > 1 - 1e-12;
            // a hoist's climb has a slot down it, for its paddles to come up through
            wood.push({ mesh: blockMesh(piece, straight, kind.family === "y" && index === 1 ? SLOT : 0) });
        }
    });
    if (shape.bowl) {
        const { at, profile, thick } = shape.bowl;
        // drawn from the same numbers as the bowl a marble meets
        wood.push({ mesh: turned(at, profile, thick).mesh() });
    }
    // boxes and stands of oak, the grain of each along its longest side
    const flat = [...shape.boxes, ...shape.stands].map((box) => ({ mesh: grainedBox(box.half, box.at) }));
    for (const box of shape.panes ?? []) glass.push({ mesh: pane(box.half, box.at) });
    // what a marble strikes, tilted about the line across the piece as the physics has it; its places in
    // the pattern are its own, so that a drum's skin is on its top and a chime bar's streaks run along it
    const struck = shape.struck;
    const own = struck && (struck.sound === "chime" ? grained(struck.mesh) : { ...struck.mesh, grain: struck.mesh.points });
    const metal = struck && own ? [{ mesh: turnedMesh({ ...own, points: own.points.map((p): V3 => [p[0] + struck.at[0], p[1] + struck.at[1], p[2] + struck.at[2]]) }, struck.at, [0, 0, 1], struck.tilt) }] : [];
    const metalLook = struck && { pattern: (struck.sound === "chime" ? "brushed" : struck.sound === "bell" ? "metal" : "skin") as Pattern, color: struck.sound === "chime" ? CHIME : struck.sound === "bell" ? BRASS : STEEL };
    // the moving part as it rests, its oak and its metal apart; a hoist's paddles are all one body
    const resting = shape.moving ? restingMeshes(shape.moving) : [];
    const metalOf = (i: number) => (shape.moving!.kind === "hoist" ? isMetal(shape.moving!.bodies[0]!) : isMetal(shape.moving!.bodies[i]!));
    const moving = resting.filter((_, i) => !metalOf(i)).map((mesh) => ({ mesh }));
    const steel = resting.filter((_, i) => metalOf(i)).map((mesh) => ({ mesh }));
    const made: Drawing = { wood: merged(wood, true), flat: merged(flat, false), glass: merged(glass, true), metal: merged(metal, struck?.sound === "bell"), metalLook, moving: merged(moving, false), steel: merged(steel, false) };
    drawings.set(key, made);
    // a bend dragged is a new drawing at every millimetre; the oldest are let go
    if (drawings.size > 400) drawings.delete(drawings.keys().next().value!);
    return made;
}

/** How strong the light round the edges of a piece is that is chosen, carried or warned of. */
const RIM = 0.75;
/** How strongly the grid on the table shows while marbles roll, and while a piece is carried or bent; and how long it takes to come up or fade, in seconds. */
const GRID = { rolling: 0.16, building: 0.85, ease: 0.35 };
/** How bright the lamp is, and the little light the dark room gives back from above and from the table. */
const LAMP = { sun: 2.3, sky: 0.22, ground: 0.1 };
/** Where the lamp is for a run between two corners: above it and off to one side, a little in front. */
function lampAt(low: V3, high: V3): V3 {
    const middle: V3 = [(low[0] + high[0]) / 2, 0, (low[2] + high[2]) / 2];
    const wide = Math.max(60, high[0] - low[0], high[2] - low[2]);
    return [middle[0] - wide * 0.55, high[1] + wide * 1.1 + 60, middle[2] + wide * 0.35];
}
/** The pillars' look: oak, each its own grain by its seed. */
const pillarLook: Look = { color: [1, 1, 1], pattern: "wood" };

/** The meshes and looks a kind of piece is drawn with: oak, glass that casts no shadow, and the metal or skin of what it strikes. A new look for each, so that each part's light round its edges is its own. */
function piecesLooks(kind: Kind, colors: { glass: Color }, still = true): { mesh: Mesh; look: Look; glass: boolean }[] {
    const drawing = drawingOf(kind);
    const out: { mesh: Mesh; look: Look; glass: boolean }[] = [];
    for (const which of ["wood", "flat", "glass", "metal", "moving", "steel"] as const) {
        const mesh = drawing[which];
        if (!mesh || ((which === "moving" || which === "steel") && !still)) continue;
        const look: Look =
            which === "glass"
                ? { color: colors.glass, pattern: "glass", casts: false }
                : which === "metal"
                  ? { color: drawing.metalLook!.color, pattern: drawing.metalLook!.pattern }
                  : which === "steel"
                    ? { color: STEEL, pattern: "brushed" }
                    : { color: [1, 1, 1], pattern: "wood" };
        out.push({ mesh, look, glass: which === "glass" });
    }
    return out;
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

/** A point of a bent piece being dragged (see `bendDrag` in the scene). */
interface BendDrag {
    id: number;
    point: number;
    original: Placed;
    at: V3;
    up: V3;
    aside: V3;
    freedom: Freedom;
    press: { x: number; y: number };
    start: [up: number, aside: number];
    good: number[];
    stopped?: Broken | "room";
    why: string;
}

/** A part of a piece as drawn: its look, kept to change its color, the color it has when nothing is said of it, and whether it is glass, which keeps its color. */
/** A part of a piece as drawn: the part, the look it has when nothing is said of it, and whether it is glass, which never shows a state. */
type Drawn = { part: Part; plain: Look; glass: boolean };

/** A pointer held down, and what it is doing. */
interface Held {
    hand: Hand;
    start: { x: number; y: number };
    last: { x: number; y: number };
    /** When it went down, in seconds of the scene's time: for a long press. */
    since: number;
    mode: "press" | "turn" | "pan" | "carry" | "pinch" | "handle" | "box" | "done" | "gizmo" | "bend" | "loose";
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
        metal: tint("--ink", 0.62),
        moving: tint("--muted", 0.82),
        /** The table's cloth: the site's dark, a little deeper. */
        cloth: view?.color("oklch(0.24 0.035 300)") ?? ([0.2, 0.17, 0.25] as Color),
    };
    if (view) {
        // one warm lamp in a dark room: the lamp's light, the little the room gives back from above, and from the table
        view.lamp = { sun: [1, 0.8, 0.58], sky: [0.5, 0.52, 0.72], ground: [0.55, 0.42, 0.36], size: 0.05 };
        view.bloom = 0.5;
    }
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
    /** Bending: the one piece chosen shows the points it is bent by in place of its other handles; and which of them the keys move. */
    let bending = false;
    let bendPoint = 0;
    /** A point being dragged: of which piece and which point, the piece as it was, the point's place and ways when the drag began, how the drag is taken, the numbers it began at and the last that could be built, and whether a limit holds it now. */
    let bendDrag: BendDrag | undefined;
    /** A second finger held while a point is dragged, or Alt with the mouse: no snapping. */
    let loose = false;
    /** The point the keys moved last, so that presses on one point are one step of undo. */
    let keyBend: { id: number; point: number } | undefined;
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
    let steps: Steps = begun(write([]));
    let clip = "";
    let owns: Own[] = m.preview ? [] : m.recall<Own[]>("marbles-own", [], 1).filter((one) => typeof one?.name === "string" && typeof one?.text === "string");
    /** The handle the mouse is over, lit a little. */
    let hovered: Handle | undefined;
    /** The box drawn to choose many, from one corner to the other, in pixels. */
    let boxing: { from: { x: number; y: number }; to: { x: number; y: number }; adding: boolean } | undefined;

    // ---- drawing ----
    const drawn = new Map<number, { key: string; parts: Drawn[] }>();
    /** The moving parts of the run, each solid drawn where Mote's physics has it, by its piece. */
    const movers = new Map<Solid, { id: number; drawn: Drawn }>();
    const marbleParts = new Map<Solid, Part[]>();
    let pillarParts: Part[] = [];
    let pillarsMade = "";
    const moverMeshes = new Map<string, Mesh>();
    /**
     * One look for each kind of look and state, shared by every part that has it, so that parts of one
     * shape (pieces of one kind, a hoist's paddles) are drawn together; a part's state is shown by giving
     * it another of these.
     */
    const sharedLooks = new Map<string, Look>();
    const shared = (look: Look, rim?: [Color, number]): Look => {
        const key = `${look.pattern} ${look.color.join(",")} ${look.casts} ${look.touches} ${rim ? `${rim[0].join(",")} ${rim[1]}` : ""}`;
        let one = sharedLooks.get(key);
        if (!one) sharedLooks.set(key, (one = { ...look, rim }));
        return one;
    };
    let markParts: Part[] = [];
    const disc = block([1.2, 0.15, 1.2]);
    const marble = ball(RADIUS, 22, 14);
    /** Every marble is drawn with one look, each its own by its seed and tints (look.ts), so that they are drawn all at once. */
    const marbleLookAll: Look = { color: [1, 1, 1], pattern: "marble" };

    /**
     * Parts for a kind of piece, of oak, glass and metal, with a light round their edges in `rim` if
     * given (for a piece carried, the accent, or red where it does not fit), and its own grain by `seed`.
     * Its moving part as it rests is drawn too unless `still` is false: a piece in the run has its moving
     * part drawn where the physics has it.
     */
    const partsOf = (kind: Kind, seed: number, rim?: Color, still = true): Drawn[] => {
        if (!view) return [];
        const out: Drawn[] = [];
        for (const { mesh, look, glass } of piecesLooks(kind, colors, still)) {
            const part = view.add(mesh, shared(look, rim && !glass ? [rim, RIM] : undefined));
            part.seed = seed;
            out.push({ part, plain: look, glass });
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

    /**
     * The table: a dark cloth with the grid of cells on it, drawn by the cloth's pattern, faint while marbles
     * roll and stronger while a piece is carried or bent, easing between the two (`gridShown`). Made again
     * with a pit wherever a lift's skirt goes down below the table, so that it is seen to go into a slot.
     */
    const clothLook: Look = { color: colors.cloth, pattern: "cloth", grid: GRID.rolling, cell: CELL };
    let tablePart: Part | undefined;
    let tableKey = "";
    let gridShown: number = GRID.rolling;
    const pitsOf = (pieces: Placed[]): Hole[] => {
        const holes: Hole[] = [];
        for (const piece of pieces) {
            const moving = shapeOf(piece.kind).moving;
            if (moving?.kind !== "lift") continue;
            // the skirt's lowest reach, with the car at the bottom: under the table, a slot for it
            const skirt = moving.bodies[1]!;
            if (piece.place.y * LEVEL + skirt.at[1] - skirt.half[1] >= 0) continue;
            const corner = boxToWorld(piece.place, { at: skirt.at, half: [skirt.half[0] + 0.25, 0, skirt.half[2] + 0.25] });
            holes.push({ x: [corner.at[0] - corner.half[0], corner.at[0] + corner.half[0]], z: [corner.at[2] - corner.half[2], corner.at[2] + corner.half[2]] });
        }
        return holes;
    };
    let pitParts: Part[] = [];
    const makeTableTop = (pieces: Placed[]) => {
        if (!view) return;
        const holes = pitsOf(pieces);
        const key = JSON.stringify(holes);
        if (tablePart && key === tableKey) return;
        tableKey = key;
        if (tablePart) view.remove(tablePart);
        tablePart = view.add(tableMesh(20 * CELL + 8, 2, holes), clothLook);
        for (const part of pitParts) view.remove(part);
        // and under each slot, a dark floor, so that the slot is a pit and not a hole through to the page
        pitParts = holes.map((hole) => {
            const part = view.add(block([(hole.x[1] - hole.x[0]) / 2 + 0.5, 0.5, (hole.z[1] - hole.z[0]) / 2 + 0.5]), { color: [0.02, 0.015, 0.03], gloss: 0, casts: false });
            part.at = [(hole.x[0] + hole.x[1]) / 2, -6, (hole.z[0] + hole.z[1]) / 2];
            return part;
        });
    };
    makeTableTop([]);

    /** The handles, made once and shown on what is chosen: drawn over everything, so that nothing hides them. */
    const handleParts = view && !m.preview
        ? {
              x: view.add(arrowMesh("x"), { color: colors.x, over: true, gloss: 0.2 }),
              y: view.add(arrowMesh("y"), { color: colors.y, over: true, gloss: 0.2 }),
              z: view.add(arrowMesh("z"), { color: colors.z, over: true, gloss: 0.2 }),
              ring: view.add(ringMesh(), { color: colors.accent, over: true, gloss: 0.2 }),
              knob: view.add(ball(0.11, 16, 10), { color: colors.accent, over: true, gloss: 0.3 }),
              // the points a piece is bent by, as many as any piece has
              point0: view.add(ball(0.1, 16, 10), { color: colors.accent, over: true, gloss: 0.3 }),
              point1: view.add(ball(0.1, 16, 10), { color: colors.accent, over: true, gloss: 0.3 }),
              point2: view.add(ball(0.1, 16, 10), { color: colors.accent, over: true, gloss: 0.3 }),
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
                one = { key, parts: partsOf(piece.kind, woodSeed(piece.id), undefined, false) };
                drawn.set(piece.id, one);
            }
            pose(one.parts, originOf(piece.place), angleOf(piece.place));
            const rim = rimOf(piece.id);
            for (const part of one.parts) if (!part.glass) part.part.look = shared(part.plain, rim);
        }
        drawMovers();
        makeTableTop(resting());
        // the pillars, from the table, as one mesh, drawn at once: each its own grain, since the grain is
        // reckoned from where it stands; made again only when they change
        const pillarsKey = JSON.stringify(table.pillars);
        if (pillarsKey !== pillarsMade) {
            pillarsMade = pillarsKey;
            for (const part of pillarParts) view.remove(part);
            const mesh = merged(table.pillars.map((pillar) => ({ mesh: grainedBox([PILLAR / 2, pillar.top / 2, PILLAR / 2], [pillar.x, pillar.top / 2, pillar.z]) })), false);
            pillarParts = mesh ? [view.add(mesh, pillarLook)] : [];
            for (const part of pillarParts) part.seed = woodSeed(1000);
        }
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
        // and where a bent piece is nearest its limit, a small warm mark lying on its top
        for (const piece of run) {
            if (isCarried(piece.id) || !warned(piece.kind)) continue;
            const part = view.add(disc, { color: colors.warn, gloss: 0, casts: false });
            const at = toWorld(piece.place, strainOf(piece.kind).at);
            part.at = [at[0], at[1] + 0.25, at[2]];
            part.scale = 0.7;
            markParts.push(part);
        }
        // the lamp, above and to one side of the run, and its box round the run
        const [low, high] = bounds(run);
        view.light(lampAt(low, high), [low[0] - 10, -2, low[2] - 10], [high[0] + 10, high[1] + 10, high[2] + 10], LAMP.sun, LAMP.sky, LAMP.ground);
        // its pool of light, round the run, a little toward the lamp
        const lamp = lampAt(low, high);
        view.lamp.pool = [(low[0] + high[0]) / 2 * 0.8 + lamp[0] * 0.2, (low[2] + high[2]) / 2 * 0.8 + lamp[2] * 0.2, Math.max(70, (high[0] - low[0] + high[2] - low[2]) * 0.6)];
    };
    /**
     * How a piece shows what is going on with it, on oak: a light round its edges. Red where a drag holds
     * a bend at a limit; warm where a bend is near one, even while chosen; the accent where it is chosen;
     * warm where a marble will stop or leave the track, or marbles may come together to a switch.
     */
    function rimOf(id: number): [Color, number] | undefined {
        const piece = run.find((one) => one.id === id);
        if (!piece) return undefined;
        const marked = [...openMarks, ...ghostMarked].some((mark) => mark.id === id && mark.why !== "open");
        if (bendDrag?.id === id && bendDrag.stopped) return [colors.wrong, RIM * 1.15];
        if (warned(piece.kind)) return [colors.warn, RIM];
        if (chosen.has(id)) return [colors.accent, RIM];
        if (marked) return [colors.warn, RIM * 0.85];
        return undefined;
    }

    /** The moving parts' drawings made to match the table: a part for each solid of each moving piece, in its piece's tint, and none for what has gone. */
    function drawMovers() {
        if (!view) return;
        const now = new Set<Solid>();
        for (const { id, solids } of table.movers()) {
            const piece = run.find((one) => one.id === id);
            if (!piece) continue;
            const moving = shapeOf(piece.kind).moving!;
            solids.forEach((solid, i) => {
                now.add(solid);
                let one = movers.get(solid);
                const metal = isMetal(moving.kind === "hoist" ? moving.bodies[0]! : moving.bodies[i]!);
                if (!one) {
                    // oak, or steel; the grain along the solid's longest side; solids of one shape (a hoist's
                    // paddles) share a mesh, so that they are drawn at once; held up off the table, they are
                    // left out of the map from above
                    const look: Look = metal ? { color: STEEL, pattern: "brushed", touches: false } : { color: [1, 1, 1], pattern: "wood", touches: false };
                    const key = solid.points.map((p) => p.map((v) => v.toFixed(3)).join(" ")).join("|");
                    let mesh = moverMeshes.get(key);
                    if (!mesh) moverMeshes.set(key, (mesh = grained({ points: solid.points, faces: solid.faces })));
                    const part = view.add(mesh, shared(look));
                    part.seed = woodSeed(id);
                    one = { id, drawn: { part, plain: look, glass: false } };
                    movers.set(solid, one);
                }
                one.drawn.part.look = shared(one.drawn.plain, rimOf(id));
            });
        }
        for (const [solid, one] of movers) {
            if (now.has(solid)) continue;
            view.remove(one.drawn.part);
            movers.delete(solid);
        }
    }

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
        // open ends, and switches marbles may reach together; the guesses by energy are the ghost's now
        openMarks = checks(now).filter((mark) => mark.why === "open" || mark.why === "batched");
        ghostMarked = ghostMarked.filter((mark) => now.some((piece) => piece.id === mark.id));
        for (const id of [...chosen]) if (!run.some((piece) => piece.id === id)) chosen.delete(id);
        // presses of a key on one point are one step only until anything else changes
        keyBend = undefined;
        if (bending && !bentPiece()) {
            bending = false;
            bendPoint = 0;
        }
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

    /**
     * The piece of the run under a point of the picture, by the boxes of room it takes up with `wide`
     * centimetres more round them. With `reach`, a fingertip's slack in pixels: if nothing is under the
     * point itself, the nearest piece under a ring of points that far round it, so that a small piece
     * far off is as easy to touch as a near one.
     */
    const pieceAt = (x: number, y: number, wide = 1.2, reach = 0): Placed | undefined => {
        const under = (px: number, py: number) => {
            const line = lineAt(px, py);
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
        const found = under(x, y);
        if (found || !reach) return found;
        for (const ring of [reach / 2, reach]) {
            for (let i = 0; i < 8; i++) {
                const near = under(x + Math.cos((i * Math.PI) / 4) * ring, y + Math.sin((i * Math.PI) / 4) * ring);
                if (near) return near;
            }
        }
        return undefined;
    };
    /** How far round a finger's press a piece is still taken, in pixels: half a fingertip. */
    const FINGERTIP = 12;

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
        const parts = new Map(home.map((piece) => [piece.id, partsOf(piece.kind, woodSeed(piece.id), colors.accent)]));
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
        const rim: [Color, number] = one.away ? [colors.lines, RIM * 0.7] : one.fits ? [colors.accent, RIM] : [colors.wrong, RIM * 1.15];
        for (const parts of one.parts.values()) for (const { part, plain, glass } of parts) if (!glass) part.look = shared(plain, rim);
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
                const parts = partsOf(piece.kind, woodSeed(piece.id), colors.accent);
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
        const shape = shapeOf(piece.kind);
        // a moving or sounding piece says where its knob is: a seesaw's weights, a spinner's axle, a chime bar's end
        if (shape.knob) return toWorld(piece.place, shape.knob);
        const joint = shape.joints[1];
        if (!joint) return undefined;
        const at = toWorld(piece.place, joint.at);
        const way = wayToWorld(piece.place, joint.way);
        return [at[0] + way[0] * 1.5, at[1] + 1.5, at[2] + way[2] * 1.5];
    };
    /** How far pieces reach on the screen from a point, in pixels: their boxes of room, each with a block's half width round it. */
    const reachOn = (pieces: Placed[], middle: V3): number => {
        const centre = onScreen(middle);
        if (!centre) return 0;
        const { orbit: seen, degrees } = cam();
        const half = 2.2 / across(seen, degrees, m.height, middle);
        let most = 0;
        for (const piece of pieces) {
            for (const box of shapeOf(piece.kind).room) {
                const at = onScreen(boxToWorld(piece.place, box).at);
                if (at) most = Math.max(most, Math.hypot(at.x - centre.x, at.y - centre.y) + half);
            }
        }
        return most;
    };
    /** How far the handles stand off from what they are on, in pixels: worked out each frame from what is chosen, and kept while a handle is dragged, so that the handles do not breathe under the pointer. */
    let stand = 0;
    const standFor = (pieces: Placed[]) => {
        stand = standOff(reachOn(pieces, handleMiddle(pieces)), m.width, m.height);
    };
    /** Where the handles are on the screen now, if any are shown. */
    const handlesNow = (): Shown | undefined => {
        if (m.preview || (carried && carried.handle === undefined)) return undefined;
        const pieces = carried ? placedOf(carried) : chosenPieces();
        if (!pieces.length) return undefined;
        const { orbit: seen, degrees } = cam();
        // while a piece is bent, its points are its only handles
        const bent = bentPiece();
        if (bent && !carried) return pointsLayout(seen, degrees, m.width, m.height, pointsIn(bent.kind, bent.place).map((point) => point.at));
        const middle = carried ? shownPoint(carried, carried.origin!) : handleMiddle(pieces);
        if (!carried) standFor(pieces);
        return layout(seen, degrees, m.width, m.height, middle, carried ? (carried.handle === "knob" ? knobOf(pieces) : undefined) : knobOf(pieces), stand);
    };
    /**
     * The handle a press at (x, y) would take once it moves, if any. Never one over the body of a chosen
     * piece: a press there carries what is chosen, wherever the handles are, and the handles stand off
     * from a small selection so that both have room. Shift and the select tool are for choosing, so no
     * handle takes their press.
     */
    const handleUnder = (x: number, y: number, kind: "touch" | "mouse", shift = false): Handle | undefined => {
        const shown = !carried && chosen.size && !shift && !selecting ? handlesNow() : undefined;
        const handle = shown && which(shown, x, y, kind);
        if (!handle) return undefined;
        // a point sits on its piece's track, so it is taken over the piece too: while it is bent, that is what a press near a point means
        if (pointOf(handle) !== undefined) return handle;
        const body = pieceAt(x, y, 0.2);
        return body && chosen.has(body.id) ? undefined : handle;
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
                    one.parts.set(piece.id, partsOf(kind, woodSeed(piece.id), colors.accent));
                    // a chime bar sounds its new note, so that a tune can be set by ear
                    if (kind.family === "m") sound?.strike("chime", 0.55, NOTES[kind.sizes[0]!]);
                    else sound?.knock(0.3, 1700);
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
     * level of its knob for those that grow along or aside (and a chime bar, a spinner), and the upright
     * plane along it for those that grow down or up (a slope, a drop, a spiral, a lift, a hoist, a
     * seesaw's weights).
     */
    const ownPoint = (piece: Placed, line: ReturnType<typeof lineAt>): V3 | undefined => {
        const far = toWorld(piece.place, knobAt(piece.kind));
        let hit: V3 | undefined;
        // those that grow up or down are dragged in the upright plane along them: a lift's height, a hoist's length, a seesaw's weights
        if ("dvxuye".includes(piece.kind.family)) {
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

    // ---- bending ----
    // One piece chosen that bends can be bent: its points are then its only handles. A point is dragged
    // in the plane of up and aside where the view sees both, staying under the pointer, or along the one
    // way the view sees; it snaps to straight, to a whole level, and to its partner's numbers (alike, or
    // aside the other way), each way on its own; a limit stops it where the bend can still be built. The
    // run changes as it is dragged, so marbles and the ghost roll on the bend as it is made, and one step
    // of undo is kept when it is let go. The piece's ends never move: what it is joined to stays put.

    /** The piece being bent, if bending is on and one piece that bends is chosen. */
    const bentPiece = (): Placed | undefined => {
        if (!bending || chosen.size !== 1) return undefined;
        const piece = run.find((one) => chosen.has(one.id));
        return piece && pointsOf(piece.kind) ? piece : undefined;
    };
    /** The numbers of a piece's bend, naught if it is not bent. */
    const bendOf = (kind: Kind) => kind.bend ?? new Array<number>(2 * pointsOf(kind)).fill(0);
    /** Why a piece bent so cannot be: a limit of the bend itself, or no room for it where it is (another piece, the ground, the table's edge). */
    const bendFails = (piece: Placed, kind: Kind): Broken | "room" | undefined => (bendAllowed(kind) ? brokenBy(kind) ?? (fits(run.filter((one) => one.id !== piece.id), { ...piece, kind }) ? undefined : "room") : "tight");
    /** A piece of the run given a new bend, while it is dragged or by a key: the table and the drawing follow at once, and the step for undo comes after. */
    const setBend = (id: number, kind: Kind) => {
        run = run.map((piece) => (piece.id === id ? { ...piece, kind } : piece));
        table.set(resting());
        redraw();
        m.wake();
    };
    const toggleBending = (on = !bending) => {
        const pieces = chosenPieces();
        if (on && (pieces.length !== 1 || !pointsOf(pieces[0]!.kind))) return refuse();
        bending = on;
        bendPoint = 0;
        keyBend = undefined;
        sound?.knock(0.2, on ? 1900 : 1400);
        tell();
        m.wake();
    };
    const straightenChosen = () => {
        const piece = chosenPieces().length === 1 ? chosenPieces()[0] : undefined;
        if (!piece || !isBent(piece.kind)) return refuse();
        const kind = withBend(piece.kind);
        if (bendFails(piece, kind)) return refuse();
        setBend(piece.id, kind);
        keyBend = undefined;
        sound?.knock(0.3, 1300);
        changed();
    };
    const startBend = (point: number, hand: Hand) => {
        const piece = bentPiece();
        const here = piece && pointsIn(piece.kind, piece.place)[point];
        if (!piece || !here) return;
        const { orbit: seen, degrees } = cam();
        const up: V3 = [0, 1, 0];
        const long = Math.hypot(...here.aside) || 1;
        const aside: V3 = [here.aside[0] / long, here.aside[1] / long, here.aside[2] / long];
        const bend = bendOf(piece.kind);
        bendPoint = point;
        keyBend = undefined;
        bendDrag = { id: piece.id, point, original: { ...piece }, at: here.at, up, aside, freedom: freedomOf(seen, degrees, aspect(), here.at, up, aside), press: { x: hand.x, y: hand.y }, start: [bend[2 * point]!, bend[2 * point + 1]!], good: bend, why: "" };
        sound?.knock(0.2, 1600);
        m.wake();
    };
    /** Where a dragged point may snap: straight each way, its height a whole level, and its partner's numbers, alike or aside the other way. */
    const snapsOf = (piece: Placed, point: number): Snaps => {
        const count = pointsOf(piece.kind);
        const bend = bendOf(piece.kind);
        const made = pointsIn(withBend(piece.kind), piece.place)[point]!.made;
        const snaps: Snaps = { up: [{ at: 0, why: "straight" }], aside: [{ at: 0, why: "straight" }] };
        // the heights of whole levels near it, as millimetres up from where the point is made
        const level = Math.round(made[1] / LEVEL);
        for (let k = level - 6; k <= level + 6; k++) if (k !== level || Math.abs(made[1] - k * LEVEL) > 1e-9) snaps.up.push({ at: Math.round((k * LEVEL - made[1]) * 10), why: `level ${k}` });
        const partner = count - 1 - point;
        if (partner !== point) {
            snaps.up.push({ at: bend[2 * partner]!, why: "like its partner" });
            snaps.aside.push({ at: bend[2 * partner + 1]!, why: "like its partner" }, { at: -bend[2 * partner + 1]!, why: "against its partner" });
        }
        return snaps;
    };
    const dragBend = (x: number, y: number, kind: "touch" | "mouse", free: boolean) => {
        const began = performance.now();
        const drag = bendDrag;
        const piece = drag && run.find((one) => one.id === drag.id);
        if (!drag || !piece) return;
        const { orbit: seen, degrees } = cam();
        const moved = dragged(seen, degrees, aspect(), drag.at, drag.up, drag.aside, drag.freedom, toPicture(drag.press.x, drag.press.y), toPicture(x, y));
        // in millimetres, the point's own numbers; the way the view cannot see is held where it was
        let wanted = { up: drag.start[0] + moved.up * 10, aside: drag.start[1] + moved.aside * 10 };
        let why = "";
        if (!free) {
            const pixels = pixelsOf(seen, degrees, m.width, m.height, drag.at, drag.up, drag.aside);
            const held = { up: drag.freedom === "aside" ? 0 : pixels.up, aside: drag.freedom === "up" ? 0 : pixels.aside };
            const snap = snapped(wanted, snapsOf(piece, drag.point), held, kind === "touch" ? 12 : 8);
            wanted = { up: snap.up, aside: snap.aside };
            why = snap.why.join(" ");
        }
        const bend = [...drag.good];
        // no further than a bend can be written; the limits stop it long before
        const most = (value: number) => Math.max(-FURTHEST, Math.min(FURTHEST, Math.round(value)));
        bend[2 * drag.point] = most(wanted.up);
        bend[2 * drag.point + 1] = most(wanted.aside);
        let next = withBend(piece.kind, bend);
        let fails = bendFails(piece, next);
        if (fails) {
            // as far toward what is wanted as can be built, by halves, from the last that could; the
            // limit that holds it is the one met just past there, not the one far out where the pointer is
            const from = drag.good;
            let [low, high] = [0, 1];
            // seven halvings: within a hundred and twenty-eighth of the move, a millimetre or less for any move of a pointer between two frames
            for (let go = 0; go < 7; go++) {
                const mid = (low + high) / 2;
                const trial = withBend(piece.kind, from.map((value, i) => value + (bend[i]! - value) * mid));
                const why = bendFails(piece, trial);
                if (why) [high, fails] = [mid, why];
                else low = mid;
            }
            next = withBend(piece.kind, from.map((value, i) => value + (bend[i]! - value) * low));
            // a small knock the moment a limit first holds it
            if (!drag.stopped) sound?.knock(0.25, 420);
        }
        drag.stopped = fails;
        drag.good = bendOf(next);
        // a soft click on coming to a snap
        if (why && why !== drag.why && !fails) sound?.knock(0.22, 2300);
        drag.why = why;
        if (keyOf(next) !== keyOf(piece.kind)) setBend(piece.id, next);
        else redraw();
        // how long a move of a point takes, everything it does, for measuring
        const spent = performance.now() - began;
        took.bend += (spent - took.bend) * 0.2;
        took.bendMost = Math.max(took.bendMost, spent);

    };
    /** Lets go of a dragged point: the bend kept as a step of undo, or, cancelled, the piece put back as it was. */
    const endBend = (cancelled: boolean) => {
        const drag = bendDrag;
        if (!drag) return;
        bendDrag = undefined;
        const now = run.find((one) => one.id === drag.id);
        if (cancelled && now) setBend(drag.id, drag.original.kind);
        if (now && keyOf(now.kind) !== keyOf(drag.original.kind) && !cancelled) sound?.knock(0.3, 1500);
        changed(!cancelled);
    };
    /** The keys' way of bending: the chosen point moved up or aside by `step` millimetres a press, aside as the screen sees it. */
    const nudgeBend = (up: number, aside: number) => {
        const piece = bentPiece();
        if (!piece) return;
        const here = pointsIn(piece.kind, piece.place)[bendPoint];
        if (!here) return;
        // the arrow to the right moves the point to the right on the screen, whichever way the piece runs
        const [a, b] = [onScreen(here.at), onScreen([here.at[0] + here.aside[0] * 100, here.at[1], here.at[2] + here.aside[2] * 100])];
        const sign = a && b && b.x < a.x ? -1 : 1;
        const bend = [...bendOf(piece.kind)];
        bend[2 * bendPoint] = bend[2 * bendPoint]! + up;
        bend[2 * bendPoint + 1] = bend[2 * bendPoint + 1]! + aside * sign;
        const kind = withBend(piece.kind, bend);
        if (bendFails(piece, kind)) return refuse();
        const same = keyBend?.id === piece.id && keyBend.point === bendPoint;
        setBend(piece.id, kind);
        changed(!same);
        // presses on one point after the first are one step with it
        if (same) {
            steps = replaced(steps, write(run));
            keepSteps();
            tell();
        }
        keyBend = { id: piece.id, point: bendPoint };
        sound?.knock(0.15, 2000);
    };
    /** How far a key moves a point, in millimetres. */
    const KEY_BEND = 5;

    // ---- what the bar, the strip and the keys do ----
    const letGo = () => {
        const out = table.letGo();
        for (const one of out) show(one);
        m.wake();
    };
    const show = (one: Solid) => {
        if (!view || marbleParts.has(one)) return;
        // its look by its number, so that a run replayed looks the same
        const { seed, tints } = marbleLook(table.numberOf(one));
        const part = view.add(marble, marbleLookAll);
        part.seed = seed;
        part.tints = tints;
        marbleParts.set(one, [part]);
    };
    table.gone = (one) => {
        for (const part of marbleParts.get(one) ?? []) view?.remove(part);
        marbleParts.delete(one);
    };
    /**
     * Each strike heard as what was struck: marble on marble glass, on track or a wall wood, on a moving
     * part wood or metal, a chime bar at its note, a bell, a drum, the cloth a soft low knock; as loud
     * and as bright as it was fast, against how fast that thing is struck hard (`HARD`). A strike and
     * its echo in the next step or two are one strike.
     */
    const lastStruck = new Map<number, number>();
    table.space.hit = (a, b, speed) => {
        if (!sound) return;
        const pair = a.id * 65536 + b.id;
        if (time - (lastStruck.get(pair) ?? -1) < 0.04) return;
        lastStruck.set(pair, time);
        if (lastStruck.size > 4000) lastStruck.clear();
        const both = a.radius !== undefined && b.radius !== undefined;
        const heard = both ? undefined : table.heard(a.radius === undefined ? a : b);
        const kind: Strike = both ? "glass" : heard?.kind ?? "wood";
        const hard = (speed / HARD[kind]) * (heard?.soft ? 0.45 : 1);
        sound.strike(kind, hard, kind === "chime" ? heard?.pitch : heard?.soft ? 0.6 : undefined);
    };
    // a seesaw, a trapdoor, a gate or a switch knocking against its stop
    table.space.knocked = (hinge, speed) => {
        const id = table.hingeOf(hinge);
        const piece = run.find((one) => one.id === id);
        sound?.strike(piece && shapeOf(piece.kind).moving?.sound === "metal" ? "metal" : "wood", speed / HARD.wood, 0.75);
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
                carried.parts.set(piece.id, partsOf(piece.kind, woodSeed(piece.id), colors.accent));
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
                const parts = partsOf(piece.kind, woodSeed(piece.id), colors.lines);
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
        // bending is of one piece: choosing another, or more, or none, ends it
        if (bending && !bentPiece()) toggleBending(false);
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
    /**
     * The next or last setting of the one piece chosen, by its knob's number: a chime bar's note, a
     * lift's height, a hoist's length, a spinner's arms, how many marbles tip a seesaw, and a straight's
     * length or a drop's height as the knob would make them. A small no if it has none or would not fit.
     */
    const stepSetting = (by: number) => {
        const pieces = chosenPieces();
        const piece = pieces.length === 1 ? pieces[0]! : undefined;
        const which = piece && RESIZABLE[piece.kind.family];
        if (!piece || !which || which.length !== 1) return refuse();
        const index = which[0]!;
        const [least, most] = SIZES[piece.kind.family][index]!;
        let size = piece.kind.sizes[index]!;
        do size += by;
        while (size >= least && size <= most && !allowed(piece.kind.family, piece.kind.sizes.map((one, i) => (i === index ? size : one))));
        if (size < least || size > most) return refuse();
        const kind = rebent(piece.kind, { family: piece.kind.family, sizes: piece.kind.sizes.map((one, i) => (i === index ? size : one)), mirror: piece.kind.mirror });
        if (!groupFits(run, [{ ...piece, kind }])) return refuse();
        run = run.map((one) => (one.id === piece.id ? { ...one, kind } : one));
        if (kind.family === "m") sound?.strike("chime", 0.55, NOTES[kind.sizes[0]!]);
        else sound?.knock(0.3, 1700);
        changed();
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
            ["K", "bend what is chosen by its points"],
            ["bending: arrows, Q, E", "move the point aside, up, down"],
            ["bending: comma, full stop, Delete", "the point before, after; straighten it"],
            ["Alt or a second finger, dragging a point", "no snapping"],
            ["N, Shift+N", "the next or last setting: a chime bar's note, a lift's height, a spinner's arms, how many marbles tip a seesaw, a length"],
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
            ["L", "the look: full, or plain for a slower graphics card"],
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
        const bendTool = tool("bend", "Bend: drag its points", "K", () => toggleBending(), true);
        const straightenTool = tool("straighten", "Straighten", "", straightenChosen);
        const tools = el("div", { class: "marbles-strip-tools" }, turnTool, mirrorTool, bendTool, straightenTool, joinedTool, copyTool, duplicateTool, keepTool, removeTool);
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
            const one = chosen.size === 1 ? run.find((piece) => chosen.has(piece.id)) : undefined;
            bendTool.setAttribute("aria-pressed", String(bending));
            bendTool.disabled = !one || !pointsOf(one.kind);
            straightenTool.disabled = !one || !isBent(one.kind);
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
        // steps kept in the form before bends are read in the form written now, so that they still end at the run
        if (kept) kept.texts = kept.texts.map(upgraded);
        // undo carries on from the last visit, if it was left at this run
        steps = kept && kept.texts[kept.at] === write(run) ? kept : begun(write(run));
        changed(false);
    }
    const resize = () => view?.size(m.width, m.height);
    resize();
    fitRun(true);

    // ---- the look ----
    /** Whether a piece is being built with now: carried, bent, or its points shown. */
    const building = () => Boolean(carried || bendDrag || bending);
    /**
     * The look, full or plain. It goes plain by itself where frames come slowly: when the middle of the
     * last two seconds' frames, while the scene moves, took longer than a fortieth of a second. Once set
     * by the key (L), it stays as set.
     */
    let lookByHand = false;
    let lookByItself = false;
    const gaps: number[] = [];
    const setLook = (quality: "full" | "plain") => {
        if (!view) return;
        view.quality = quality;
        lookByHand = true;
        lookByItself = false;
        sound?.knock(0.2, quality === "full" ? 1900 : 1300);
        m.wake();
    };
    const watchFrames = (dt: number) => {
        if (!view || lookByHand || view.quality === "plain" || dt <= 0 || dt > 0.25 || m.preview) return;
        gaps.push(dt);
        if (gaps.length > 120) gaps.shift();
        if (gaps.length < 120) return;
        const middle = [...gaps].sort((a, b) => a - b)[60]!;
        if (middle > 1 / 40) {
            view.quality = "plain";
            lookByItself = true;
        }
    };

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
            // while a piece is bent, the keys that would move it move its chosen point instead, and
            // comma and full stop choose the point; Escape or Enter (or K) ends bending
            const bent = bentPiece();
            if (bent && !event.shiftKey && !bendDrag) {
                let done = true;
                if (key === "ArrowLeft" || lower === "a") nudgeBend(0, -KEY_BEND);
                else if (key === "ArrowRight" || lower === "d") nudgeBend(0, KEY_BEND);
                else if (key === "ArrowUp" || lower === "w" || lower === "e" || key === "PageUp") nudgeBend(KEY_BEND, 0);
                else if (key === "ArrowDown" || lower === "s" || lower === "q" || key === "PageDown") nudgeBend(-KEY_BEND, 0);
                else if (key === "," || key === "[" || key === "." || key === "]") {
                    const count = pointsOf(bent.kind);
                    bendPoint = (bendPoint + (key === "," || key === "[" ? count - 1 : 1)) % count;
                    keyBend = undefined;
                    sound?.knock(0.15, 2000);
                } else if (key === "Delete" || key === "Backspace") {
                    // the chosen point back where the piece as made has it
                    const bend = [...bendOf(bent.kind)];
                    bend[2 * bendPoint] = 0;
                    bend[2 * bendPoint + 1] = 0;
                    const kind = withBend(bent.kind, bend);
                    if (keyOf(kind) === keyOf(bent.kind) || bendFails(bent, kind)) refuse();
                    else {
                        setBend(bent.id, kind);
                        changed();
                    }
                } else if (key === "Escape" || key === "Enter" || lower === "k") toggleBending(false);
                else done = false;
                if (done) {
                    event.preventDefault();
                    m.wake();
                    return;
                }
            }
            if (key === "Escape" && bendDrag) {
                endBend(true);
                for (const one of held.values()) if (one.mode === "bend") one.mode = "done";
            } else if (event.altKey) {
                if (key === "ArrowUp") nudge(0, 0, 1);
                else if (key === "ArrowDown") nudge(0, 0, -1);
                else return;
            } else if (lower === "k") toggleBending();
            else if (event.shiftKey && key.startsWith("Arrow")) {
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
            else if (lower === "n") stepSetting(event.shiftKey ? -1 : 1);
            else if (lower === "l") setLook(view?.quality === "full" ? "plain" : "full");
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
            // the marble's middle rocks from side to side in the groove; the thread follows it smoothed, as a way and not a wobble
            const smooth = path.places.map((_, i): V3 => {
                const near = path.places.slice(Math.max(0, i - 4), i + 5);
                return [0, 1, 2].map((axis) => near.reduce((sum, p) => sum + p[axis]!, 0) / near.length) as V3;
            });
            const places = smooth.filter((_, i) => i % 2 === 0 || i === smooth.length - 1);
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
                const r = 0.09;
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
    /** The state of the real table's parts that changes where the next marble goes: which way each switch leans, and how many marbles wait in each seesaw and on each trapdoor. */
    const partsKey = () => {
        const state = table.parts();
        let key = "";
        for (const piece of resting()) {
            if (piece.kind.family === "w") key += `${piece.id}${(state.get(piece.id)?.[0] ?? 0) > 0 ? "+" : "-"}`;
            if (piece.kind.family === "e" || piece.kind.family === "j") key += `${piece.id}:${table.marbles.filter((one) => one.rest && table.pieceAt(one.p) === piece.id).length}`;
        }
        return key;
    };
    const drawGhost = (dt: number) => {
        if (!view || m.preview) return;
        const key = write(ghostRun()) + partsKey();
        if (key !== ghostKey) {
            ghostKey = key;
            ghost.start(ghostRun(), table);
            ghostShown = -1;
            ghostPlays = 0;
            if (!carried) ghostClock = 0;
        }
        const before = performance.now();
        if (!ghost.done) {
            ghost.work(carried || bendDrag || table.running ? GHOST_WORK.carrying : GHOST_WORK.still);
            if (ghost.done && !carried) {
                ghostMarked = ghostMarks(ghost.paths, openMarks.filter((mark) => mark.why === "open"));
                redraw();
            }
        }
        took.ghost += (performance.now() - before - took.ghost) * 0.05;
        const total = ghost.paths.reduce((sum, path) => sum + path.places.length, 0);
        if (total !== ghostShown && (ghost.done || total - ghostShown > 40 || ghostShown < 0)) {
            ghostShown = total;
            if (ghostLine) view.remove(ghostLine);
            const mesh = ghostMesh();
            ghostLine = mesh && view.add(mesh, { color: colors.ghost, alpha: 0.32, casts: false, gloss: 0, shaded: false });
        }
        while (ghostBalls.length < ghost.paths.length) ghostBalls.push(view.add(marble, { color: colors.ghost, alpha: 0.3, casts: false, gloss: 0.4 }));
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
    const took = { step: 0, draw: 0, ghost: 0, frame: 0, most: 0, bend: 0, bendMost: 0 };
    let lastFrame = 0;
    // With `?test` in the address, a browser test can find pieces and handles on the screen, choose, and
    // read the run, the ghost and the time a frame takes. Nothing is drawn for it.
    if (!m.preview && m.link.get("test") !== null) {
        (window as unknown as { marbles: unknown }).marbles = {
            ends: () => open(run).map((joint) => ({ id: joint.id, joint: joint.joint, at: onScreen(joint.at), family: run.find((piece) => piece.id === joint.id)!.kind.family })),
            end: () => end && { id: end.id, joint: end.joint, at: onScreen(end.at) },
            pieces: () => run.map((piece) => ({ id: piece.id, family: piece.kind.family, sizes: piece.kind.sizes, bend: piece.kind.bend, at: onScreen(toWorld(piece.place, handleOf(piece.kind))) })),
            /** Bending: whether it is on, of which piece, the point the keys move, and a drag of a point if one is going on. */
            bending: () => ({ on: bending, piece: bentPiece()?.id, point: bendPoint, drag: bendDrag && { point: bendDrag.point, freedom: bendDrag.freedom, stopped: bendDrag.stopped ?? null, why: bendDrag.why } }),
            bend: (on?: boolean) => toggleBending(on),
            /** The points of the piece being bent, on the screen. */
            points: () => {
                const piece = bentPiece();
                return piece ? pointsIn(piece.kind, piece.place).map((point) => onScreen(point.at)) : [];
            },
            /** How hard a piece is bent: its tightest radius and steepest slope, whether it is warned of, and why it could not be built if it could not. */
            strain: (id: number) => {
                const piece = run.find((one) => one.id === id);
                if (!piece) return undefined;
                const strain = strainOf(piece.kind);
                return { tight: strain.tight, steep: strain.steep, warned: warned(piece.kind), broken: bendFails({ ...piece, kind: withBend(piece.kind) }, piece.kind) ?? null };
            },
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
            handleAt: (x: number, y: number, kind: "touch" | "mouse") => handleUnder(x, y, kind),
            /** The piece a press there would take, with a finger's slack if asked. */
            pieceAt: (x: number, y: number, kind: "touch" | "mouse") => pieceAt(x, y, 1.2, kind === "touch" ? FINGERTIP : 0)?.id,
            screen: (p: V3) => onScreen(p),
            text: () => write(run),
            /** Puts a run on the table, as the runs to start from do. */
            load: (text: string) => load(text),
            steps: () => ({ at: steps.at, count: steps.texts.length }),
            /** Every step of undo, as the run's text. */
            texts: () => [...steps.texts],
            ghost: () => ({ done: ghost.done, paths: ghost.paths.map((path) => ({ ending: path.ending, last: path.last, length: path.places.length, end: onScreen(path.places.at(-1)!) })) }),
            owns: () => owns.map((one) => one.name),
            carried: () => carried && { fits: carried.fits, count: carried.home.length, snapped: Boolean(carried.snap), move: carried.move, pivot: carried.pivot, anchor: carried.anchor, handle: carried.handle, kinds: carried.home.map((piece) => keyOf(piece.kind)), snaps: carried.snaps.map((snap) => ({ to: snap.to.id, joint: snap.joint.id, entry: snap.joint.joint, at: onScreen(movedPoint(snap.joint.at, carried!.move)), goal: onScreen(snap.to.at) })) },
            marbles: () => ({ all: table.marbles.length, arrived: table.marbles.filter(table.arrived).length, asleep: table.marbles.filter((one) => one.rest).length, places: table.marbles.map((one) => ({ at: [...one.p], piece: table.pieceAt(one.p) ?? null, asleep: Boolean(one.rest) })) }),
            /** Every moving part: its piece, its family, a hinge's angle or a driven part's seconds, and where its first solid is on the screen. */
            parts: () => {
                const state = table.parts();
                return table.movers().map(({ id, solids }) => ({ id, family: run.find((one) => one.id === id)?.kind.family, state: state.get(id) ?? [], at: onScreen(solids[0]!.p), asleep: solids.every((solid) => Boolean(solid.rest)) }));
            },
            running: () => table.running,
            /** How many strikes have sounded, been left out or cut short, and sound now. */
            sounding: () => (sound ? { ...sound.sounding } : undefined),
            /** Steps the table by hand, as many steps of 1/120 s as asked, and lets marbles go every so often: for watching a run go on for minutes without waiting minutes. */
            run: (steps: number, every = 0, count = 0) => {
                let [made, wait] = [0, 0];
                for (let step = 0; step < steps; step++) {
                    wait -= 1 / 120;
                    if (every && made < count && wait <= 0 && table.letGo().length) [made, wait] = [made + 1, every];
                    table.step(1 / 120);
                }
                for (const one of table.marbles) show(one);
                m.wake();
                return { marbles: table.marbles.length, arrived: table.marbles.filter(table.arrived).length };
            },
            marks: () => [...openMarks, ...ghostMarked],
            took: () => ({ ...took }),
            /** The look as it is drawn: full or plain, whether it went plain by itself, and what the last picture took to draw. */
            look: (set?: "full" | "plain") => {
                if (set) setLook(set);
                return { quality: view?.quality, byItself: lookByItself, counts: view?.counts };
            },
            settle: () => {
                took.most = 0;
                took.bendMost = 0;
            },
            gizmo: () => gizmo,
            /** How long drawing a picture takes, the graphics card's work too (waited for by reading a pixel back), the middle of `count` pictures, in milliseconds. */
            timeDraw: (count = 30) => {
                if (!view) return undefined;
                const g = under.getContext("webgl2")!;
                const pixel = new Uint8Array(4);
                const times: number[] = [];
                for (let i = 0; i < count; i++) {
                    const before = performance.now();
                    view.draw();
                    g.readPixels(0, 0, 1, 1, g.RGBA, g.UNSIGNED_BYTE, pixel);
                    times.push(performance.now() - before);
                }
                times.sort((a, b) => a - b);
                return { middle: times[Math.floor(count / 2)], most: times[count - 1], counts: view.counts, width: under.width, height: under.height };
            },
            /** Looks at a point from closer than the camera lets a hand bring it, for a picture of a marble close in. */
            closeUp: (at: V3, far: number, turn = orbit.turn, tip = orbit.tip) => {
                orbit = { at, far, turn, tip };
                easing = undefined;
                m.wake();
            },
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
            if (hand.kind === "touch" && fingers.some((other) => other.mode === "bend")) {
                // a second finger while a point is dragged lets it go free of its snaps, for as long as it is down
                one.mode = "loose";
                held.set(hand.id, one);
                loose = true;
                return;
            }
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
                one.piece = pieceAt(hand.x, hand.y, 1.2, hand.kind === "touch" ? FINGERTIP : 0);
                one.handle = handleUnder(hand.x, hand.y, hand.kind === "touch" ? "touch" : "mouse", hand.shift);
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
                    const now = handleUnder(hand.x, hand.y, "mouse");
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
                const point = pointOf(one.handle);
                if (point !== undefined) {
                    one.mode = "bend";
                    startBend(point, { ...hand, x: one.start.x, y: one.start.y });
                    dragBend(hand.x, hand.y, hand.kind === "touch" ? "touch" : "mouse", loose || hand.alt);
                } else if (one.handle) {
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
            else if (one.mode === "bend") dragBend(hand.x, hand.y, hand.kind === "touch" ? "touch" : "mouse", loose || hand.alt);
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
            } else if (one.mode === "bend") {
                endBend(cancelled);
                loose = false;
            } else if (one.mode === "loose") {
                loose = [...held.values()].some((other) => other.mode === "loose");
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
            } else if (one.mode === "press" && pointOf(one.handle) !== undefined) {
                // a tap on a point picks it for the keys, and leaves the choice as it is
                bendPoint = pointOf(one.handle)!;
                sound?.knock(0.15, 2000);
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
                if (one.mode !== "press" || one.hand.kind !== "touch" || time - one.since < LONG || (one.handle && (!one.piece || pointOf(one.handle) !== undefined))) continue;
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
        resting: () => !m.preview && gridShown === (building() ? GRID.building : GRID.rolling) && !carried && !bendDrag && !flying.length && !easing && lens === lensTo && !streaming && shake <= 0 && (!playing || (table.marbles.every((one) => one.rest) && table.movers().every(({ solids }) => solids.every((solid) => solid.rest || (solid.driven && !table.running && !solid.v.some((x) => x !== 0)))))) && !held.size && ghost.done && ghostPlays >= 1,
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
            // each moving part where the physics has it, hidden while its piece is still flying in from the box
            for (const [solid, one] of movers) {
                one.drawn.part.at = solid.p;
                one.drawn.part.turn = turnOf(solid);
                one.drawn.part.hidden = drawn.get(one.id)?.parts[0]?.part.hidden ?? false;
            }
            drawGhost(dt);
            // the handles, a fingertip's size at any distance, on what is chosen, or on what a handle carries
            if (handleParts) {
                const shown = handlesNow();
                const pieces = carried ? placedOf(carried) : chosenPieces();
                for (const part of Object.values(handleParts)) part.hidden = true;
                const bent = !carried ? bentPiece() : undefined;
                if (bent) {
                    // the points, on the track, a fingertip's size; the one the keys move, or the one dragged, lit
                    pointsIn(bent.kind, bent.place).forEach((point, i) => {
                        const part = handleParts[`point${i}` as "point0"];
                        if (!part) return;
                        part.hidden = false;
                        part.at = point.at;
                        part.scale = across(seen, degrees, m.height, point.at) * ARROW;
                        const lit = bendDrag ? bendDrag.point === i : hovered === `point${i}` || bendPoint === i;
                        part.emit = lit ? 0.4 : 0;
                    });
                } else if (shown && pieces.length) {
                    const middle = carried ? shownPoint(carried, carried.origin!) : handleMiddle(pieces);
                    const pixel = across(seen, degrees, m.height, middle);
                    const size = pixel * ARROW;
                    const lit = carried?.handle ?? hovered;
                    for (const name of ["x", "y", "z", "ring"] as const) {
                        const part = handleParts[name];
                        // while one is dragged, only it is shown
                        part.hidden = (name === "ring" ? false : !shown.arrows[name]) || (carried?.handle !== undefined && carried.handle !== name);
                        // stood off from what is chosen: each arrow moved out along itself, the ring made wider
                        const out = name === "ring" ? 0 : stand * pixel;
                        const axis = name === "ring" ? AXES.x : AXES[name];
                        part.at = [middle[0] + axis[0] * out, middle[1] + axis[1] * out, middle[2] + axis[2] * out];
                        part.scale = name === "ring" ? size * ((RING + stand) / RING) : size;
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
            // the grid on the table comes up while a piece is carried or bent, and fades back, never at once
            const gridGoal = building() ? GRID.building : GRID.rolling;
            gridShown = reduced ? gridGoal : gridShown + (gridGoal - gridShown) * (1 - Math.exp(-dt / GRID.ease));
            if (Math.abs(gridShown - gridGoal) < 0.004) gridShown = gridGoal;
            clothLook.grid = gridShown;
            watchFrames(dt);
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
        const { orbit: seen } = cam();
        const middle = { x: m.width - GIZMO.margin - GIZMO.radius - GIZMO.dot, y: GIZMO.margin + GIZMO.radius + GIZMO.dot };
        const eye = eyeOf(seen);
        const back: V3 = [eye[0] - seen.at[0], eye[1] - seen.at[1], eye[2] - seen.at[2]];
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
        const wanted = pieces.length > 0 && !carried && !bendDrag && !boxing && ![...held.values()].some((one) => one.mode === "turn" || one.mode === "pinch" || one.mode === "pan");
        // where it goes: by what is chosen, measured by the corners of the room its pieces take up, and
        // clear of the handles; nowhere while what is chosen is off the screen (it shrinks away, and grows
        // again by the pieces when they come back into view), so that it never floats over the empty table
        let place: ReturnType<typeof stripPlace>;
        if (wanted) {
            const chosenRect: Rect = { left: Infinity, right: -Infinity, top: Infinity, bottom: -Infinity };
            for (const piece of pieces) {
                const room = shapeOf(piece.kind).room;
                for (const box of room.filter((_, i) => i % Math.max(1, Math.floor(room.length / 12)) === 0 || i === room.length - 1)) {
                    const placed = boxToWorld(piece.place, box);
                    for (const corner of [0, 1, 2, 3, 4, 5, 6, 7]) {
                        const seenAt = onScreen([0, 1, 2].map((axis) => placed.at[axis]! + placed.half[axis]! * ((corner >> axis) & 1 ? 1 : -1)) as V3);
                        if (!seenAt) continue;
                        [chosenRect.left, chosenRect.right, chosenRect.top, chosenRect.bottom] = [Math.min(chosenRect.left, seenAt.x), Math.max(chosenRect.right, seenAt.x), Math.min(chosenRect.top, seenAt.y), Math.max(chosenRect.bottom, seenAt.y)];
                    }
                }
            }
            const handles = handlesNow();
            const points = [...(handles?.ring ?? []), ...Object.values(handles?.arrows ?? {}).map((arrow) => arrow.to), ...(handles?.knob ? [handles.knob] : [])];
            const kept: Rect | undefined = points.length ? { left: Math.min(...points.map((p) => p.x - 12)), right: Math.max(...points.map((p) => p.x + 12)), top: Math.min(...points.map((p) => p.y - 12)), bottom: Math.max(...points.map((p) => p.y + 12)) } : undefined;
            if (Number.isFinite(chosenRect.left)) place = stripPlace(chosenRect, kept, { w: strip.offsetWidth, h: strip.offsetHeight }, m.width, m.height);
        }
        strip.classList.toggle("shown", Boolean(place));
        strip.inert = !place;
        if (!place) return;
        const at = `${Math.round(place.x)}px ${Math.round(place.y)}px`;
        if (strip.style.translate !== at) strip.style.translate = at;
        strip.classList.toggle("below", place.below);
    }
}

/** Small pictures of groups of pieces, drawn by the same code and in the same look as the scene, oak and glass under the lamp, each on a canvas of its own. */
function paintBox(view: View | undefined, colors: { glass: Color }, groups: Placed[][]): HTMLCanvasElement[] {
    const size = 128;
    const pictures: HTMLCanvasElement[] = [];
    if (!view || !groups.length) return pictures;
    const canvas = document.createElement("canvas");
    canvas.width = size;
    canvas.height = size;
    const own = gl(canvas);
    if (!own) return pictures;
    own.range = [1, 4000];
    own.lamp = { ...view.lamp };
    own.size(size / Math.min(window.devicePixelRatio || 1, 2), size / Math.min(window.devicePixelRatio || 1, 2));
    for (const group of groups) {
        const parts: Part[] = [];
        const low: V3 = [Infinity, Infinity, Infinity];
        const high: V3 = [-Infinity, -Infinity, -Infinity];
        for (const piece of group) {
            for (const { mesh, look } of piecesLooks(piece.kind, colors)) {
                const part = own.add(mesh, look);
                part.at = [piece.place.x * CELL, piece.place.y * LEVEL, piece.place.z * CELL];
                part.turn = turnAbout((piece.place.turn * Math.PI) / 2);
                part.seed = woodSeed(BOX.findIndex((entry) => keyOf(entry.kind) === keyOf(piece.kind)) + 7);
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
        own.light(lampAt(low, high), low, high, LAMP.sun, LAMP.sky * 2.5, LAMP.ground * 2);
        own.draw();
        const picture = document.createElement("canvas");
        picture.width = size;
        picture.height = size;
        // copied pixel by pixel, now, into a picture kept by the processor: on a graphics card, a picture
        // drawn from the canvas itself, or one kept on the card, came out empty once the context drawn in
        // was let go
        const g = canvas.getContext("webgl2");
        const pen = picture.getContext("2d", { willReadFrequently: true });
        if (g && pen) {
            const read = new Uint8Array(size * size * 4);
            g.readPixels(0, 0, size, size, g.RGBA, g.UNSIGNED_BYTE, read);
            const image = pen.createImageData(size, size);
            for (let y = 0; y < size; y++) {
                for (let x = 0; x < size; x++) {
                    // from the bottom row up, and its colors no longer multiplied by how solid they are
                    const [from, to] = [((size - 1 - y) * size + x) * 4, (y * size + x) * 4];
                    const alpha = read[from + 3]!;
                    for (let k = 0; k < 3; k++) image.data[to + k] = alpha ? Math.min(255, Math.round((read[from + k]! * 255) / alpha)) : 0;
                    image.data[to + 3] = alpha;
                }
            }
            pen.putImageData(image, 0, 0);
        }
        pictures.push(picture);
        for (const part of parts) own.remove(part);
    }
    own.dispose();
    return pictures;
}
