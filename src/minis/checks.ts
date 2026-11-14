// What is checked while a run is built, to be shown quietly on the pieces and never enforced: an open
// end that is not a tray's, where marbles will fall off; a stretch too shallow for a marble to keep
// rolling, where it will stop; a turn taken faster than it can hold a marble. Speeds are worked out
// along the run from each hopper, by a marble's energy: what a drop gives a rolling marble (10/7 g h
// in v squared), less what rolling and turning cost, at rates fitted to Mote's marbles on the made runs
// (checks.test.ts holds the guess to the marbles themselves). Not checked: whether a marble comes at
// the loop fast enough, which depends on how it arrives more than this can tell.
//
//   checks(run);       // [{ id, why: "open", joint }, { id, why: "fast" }, ...]

import { pathOf, shapeOf, sweepOf, type Kind, type Length } from "./pieces";
import { links, open, type Placed } from "./run";
import type { V3 } from "../mote/solids";

/** Why a piece is marked. */
export type Why = "open" | "shallow" | "fast";

/** A mark on a piece, and on which of its joints for an open end. */
export interface Mark {
    id: number;
    why: Why;
    joint?: number;
}

const G = 981;
/** What a drop gives a rolling marble: v squared grows by this times the height. */
const ROLLING = (10 / 7) * G;
/** What rolling costs on straight wood, in v squared a centimetre: a marble at 50 cm/s on the level stops in about 2 m. */
export const COST = 12;
/**
 * And where a turn begins, ends or tightens, more: the marble is thrown up the groove's wall and rocks.
 * How hard a turn throws it is v squared over g times the bend; where that changes by some amount, v
 * squared keeps e to the minus this times the amount. So a slow marble loses little in a turn and a
 * fast one much, and a long even turn (a spiral) costs little more than a short one.
 */
export const TURNING = 0.25;
/** A tube that turns a falling marble keeps this share of its v squared: it strikes the walls as it turns. */
export const TUBE = 0.6;
/** And a marble keeps this share of its v squared round the loop. */
export const LOOP_KEEP = 0.9;
/** The fastest a turn of the box was measured to carry a marble, in cm/s; faster, it may leave. */
export const TURN_MOST = 160;
/** Slower than this a marble is taken to have stopped. */
const STOPPED = 6;
/** How fast a marble comes out of the funnel's tube, about, in cm/s: it has circled down and lost what it came with. */
const FROM_FUNNEL = 30;

/** A short stretch of a route through a piece: how far along, how far it drops, how much it turns, and what it is. */
interface Stretch {
    long: number;
    drop: number;
    turned: number;
    tube: boolean;
    loop: boolean;
    /** The marble circles a bowl and leaves by its hole: what it came with is lost. */
    bowl?: boolean;
}

/** The stretches of one length of track, every centimetre or so, from its start to its end. */
function stretches(length: Length): Stretch[] {
    const path = pathOf(length);
    const piece = sweepOf(length);
    const count = Math.max(2, Math.ceil(path.end));
    const out: Stretch[] = [];
    let before = piece.frame(0);
    for (let i = 1; i <= count; i++) {
        const f = piece.frame((path.end * i) / count);
        const step: V3 = [f.p[0] - before.p[0], f.p[1] - before.p[1], f.p[2] - before.p[2]];
        // the turn in the level plane, between the two ways along, where the track runs more along than down
        const [a, b] = [before.along, f.along];
        const level = Math.hypot(a[0], a[2]) * Math.hypot(b[0], b[2]);
        const turned = level > 0.5 ? Math.acos(Math.max(-1, Math.min(1, (a[0] * b[0] + a[2] * b[2]) / level))) : 0;
        out.push({ long: Math.hypot(...step), drop: -step[1], turned, tube: length.section === "tube", loop: Boolean(length.loop) });
        before = f;
    }
    return out;
}

/** The way through a piece from one of its joints to another, as stretches, worked out once. */
const routes = new Map<string, Stretch[]>();
function route(kind: Kind, from: number | "wait"): Stretch[] {
    const key = `${kind.family}${kind.sizes.join(".")}${kind.mirror ? "m" : ""} ${from}`;
    const kept = routes.get(key);
    if (kept) return kept;
    const shape = shapeOf(kind);
    let made: Stretch[] = [];
    if (from === "wait") {
        // a hopper's marble starts at its mouth, part way down the chute, which ends at the joint
        const all = stretches(shape.lengths[0]!);
        const total = all.reduce((sum, one) => sum + one.long, 0);
        const wait = shape.wait!;
        const start = shape.lengths[0]!.path as { points: V3[] };
        const behind = Math.hypot(start.points[0]![0] - wait[0], start.points[0]![2] - wait[2]);
        let gone = 0;
        made = all.filter((one) => (gone += one.long) > Math.min(behind, total));
    } else {
        for (const length of shape.lengths) {
            made.push(...stretches(length));
            if (length === shape.lengths[0] && shape.bowl) made.push({ long: 0, drop: 0, turned: 0, tube: false, loop: false, bowl: true });
        }
        if (from === 1) made = made.reverse().map((one) => ({ ...one, drop: -one.drop }));
    }
    routes.set(key, made);
    return made;
}

/** A marble's speed squared along a route from its speed squared at the start, and what happened on the way. */
function along(stretches: Stretch[], start: number): { end: number; stopped: boolean; fast: boolean } {
    let v2 = start;
    let [fast, wasTube, inLoop] = [false, false, false];
    let throw_ = 0;
    for (const one of stretches) {
        if (one.bowl) return { end: FROM_FUNNEL * FROM_FUNNEL, stopped: false, fast };
        if (inLoop && !one.loop) v2 *= LOOP_KEEP;
        inLoop = one.loop;
        // a tube keeps only part of what a marble had when it comes out, having struck its walls as it turned
        if (wasTube && !one.tube) v2 *= TUBE;
        wasTube = one.tube;
        // a turn come at faster than the box's turns hold a marble, measured as the marble comes in
        if (one.turned > 1e-4 && !one.tube && !one.loop && v2 > TURN_MOST * TURN_MOST) fast = true;
        const thrown = one.long > 1e-9 && !one.tube && !one.loop ? (v2 * one.turned) / (G * one.long) : 0;
        v2 *= Math.exp(-TURNING * Math.abs(thrown - throw_));
        throw_ = thrown;
        v2 += ROLLING * one.drop - COST * one.long;
        if (v2 < STOPPED * STOPPED && !one.tube && one.drop <= 0) return { end: 0, stopped: true, fast };
    }
    return { end: Math.max(0, v2), stopped: false, fast };
}

/** The speed a marble has at each joint it reaches, from every hopper along the pieces joined to it, by `${id} ${joint}`. */
export function speeds(run: Placed[]): Map<string, number> {
    return walk(run).speeds;
}

/** Everything marked on a run, each piece and reason once. */
export function checks(run: Placed[]): Mark[] {
    const marks: Mark[] = [];
    for (const end of open(run)) if (run.find((piece) => piece.id === end.id)!.kind.family !== "t") marks.push({ id: end.id, why: "open", joint: end.joint });
    marks.push(...walk(run).marks);
    return marks;
}

function walk(run: Placed[]): { speeds: Map<string, number>; marks: Mark[] } {
    const byId = new Map(run.map((piece) => [piece.id, piece]));
    const partner = new Map<string, { id: number; joint: number }>();
    for (const [a, b] of links(run)) {
        partner.set(`${a.id} ${a.joint}`, { id: b.id, joint: b.joint });
        partner.set(`${b.id} ${b.joint}`, { id: a.id, joint: a.joint });
    }
    const speeds = new Map<string, number>();
    const marks = new Map<string, Mark>();
    const mark = (id: number, why: Why) => marks.set(`${id} ${why}`, { id, why });
    for (const hopper of run.filter((piece) => piece.kind.family === "h")) {
        let result = along(route(hopper.kind, "wait"), 0);
        let at = { id: hopper.id, joint: 0 };
        const seen = new Set<number>([hopper.id]);
        while (!result.stopped) {
            speeds.set(`${at.id} ${at.joint}`, Math.sqrt(result.end));
            const next = partner.get(`${at.id} ${at.joint}`);
            if (!next || seen.has(next.id)) break;
            seen.add(next.id);
            const piece = byId.get(next.id)!;
            speeds.set(`${next.id} ${next.joint}`, Math.sqrt(result.end));
            const joints = shapeOf(piece.kind).joints.length;
            // into a tray, a hopper's mouth, or a piece entered by a way it cannot be gone through
            if (joints < 2 || piece.kind.family === "h") break;
            if (piece.kind.family === "f" && next.joint === 1) break;
            result = along(route(piece.kind, next.joint), result.end);
            if (result.stopped) mark(piece.id, "shallow");
            if (result.fast) mark(piece.id, "fast");
            at = { id: piece.id, joint: next.joint === 0 ? 1 : 0 };
        }
        if (result.stopped && at.id === hopper.id) mark(hopper.id, "shallow");
    }
    return { speeds, marks: [...marks.values()] };
}
