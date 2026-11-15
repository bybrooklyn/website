// The ghost marble: where a marble let go from each hopper would travel on the run as it is now, worked
// out by running the real physics ahead on a table of its own (table.ts with its hoppers left empty),
// one marble from each hopper let go together as the real ones are. It never touches the real table, so
// the real marbles and the race's sameness are left alone. The work is done a little at a time, a few
// milliseconds a frame, so that nothing stutters while a piece is carried; the path grows as it is found.
//
//   const ghost = makeGhost();
//   ghost.start(run);              // after each change, and while a piece is carried
//   ghost.work(3);                 // each frame: up to 3 ms more of it
//   ghost.paths;                   // each marble's places, every sixtieth of a second, and how it ended
//
// A marble's way ends where it comes to rest in a tray (arrived), stops on a piece (stopped), waits in a
// seesaw or on a trapdoor for others (held), comes round to a lift or a hoist it has ridden already
// (loops), lands on the table having left the track (fell, by the piece it was last on), or after
// `LONGEST` seconds. Started from a real table, its moving parts begin where the real ones are now
// (a switch leaning the way it leans, a lift where its car is) and the marbles waiting in a seesaw or
// on a trapdoor are there too, so it shows what the next marble let go will do.

import { MARBLE, type Solid } from "../mote/space";
import type { Mark } from "./checks";
import { RADIUS, SINK, made, shapeOf } from "./pieces";
import type { Placed } from "./run";
import { makeTable, type Table } from "./table";
import type { V3 } from "../mote/solids";

/** How a ghost marble's way ended, if it has. */
export type Ending = "arrived" | "stopped" | "held" | "loops" | "fell" | "long";

/** The families a marble waits in for others, and the ones that carry it up. */
const HOLDING = new Set(["e", "j"]);
const CARRYING = new Set(["u", "y"]);

/** One ghost marble's way: its places every `EVERY` seconds, how it ended, and the piece it was on last. */
export interface Path {
    hopper: number;
    places: V3[];
    ending?: Ending;
    last?: number;
}

/** How often a place is kept, in seconds. */
export const EVERY = 1 / 60;
/** The longest a ghost marble is followed, in seconds of its own time. */
export const LONGEST = 40;
/** Slower than this, in cm/s, for `STILLNESS` seconds, a marble has stopped. */
const SLOW = 1.5;
const STILLNESS = 0.6;
/** Below this, a marble's middle is on the table itself: it has left the track. */
const ON_TABLE = RADIUS + 0.25;
const STEP = 1 / 120;
/** Gravity in the marble space, in cm/s each second. */
const GRAVITY = 981;

/** The ghost: start it on a run, give it time, and read its paths. */
export interface Ghost {
    table: Table;
    paths: Path[];
    /** Every marble's way has ended. */
    done: boolean;
    /** Starts again on this run, from each hopper's mouth; with a real table, from where its moving parts are and with the marbles waiting in them. */
    start(run: Placed[], real?: Table): void;
    /** Works on for up to `ms` milliseconds, or `steps` steps if given (for tests, which must not depend on the machine's speed). */
    work(ms: number, steps?: number): void;
    /** Seconds of marble time worked out so far. */
    time: number;
}

export function makeGhost(): Ghost {
    const table = makeTable({ filled: false });
    let marbles: { solid: Solid; path: Path; slow: number; was: V3; ridden: Set<number>; riding?: number }[] = [];
    /** Marbles copied from the real table, waiting in its moving parts. */
    let waiting: Solid[] = [];
    let steps = 0;
    const ghost: Ghost = {
        table,
        paths: [],
        done: true,
        time: 0,
        start(run, real) {
            for (const one of marbles) table.space.remove(one.solid);
            for (const one of waiting) table.space.remove(one);
            waiting = [];
            table.set(run);
            if (real) {
                table.setParts(real.parts());
                const kinds = new Map(run.map((piece) => [piece.id, piece.kind.family]));
                for (const marble of real.marbles) {
                    const on = real.pieceAt(marble.p);
                    if (marble.rest && on !== undefined && HOLDING.has(kinds.get(on) ?? "")) waiting.push(table.space.ball(RADIUS, [...marble.p], MARBLE));
                }
            }
            marbles = table.mouths().map(({ id, at }) => ({ solid: table.space.ball(RADIUS, [...at], MARBLE), path: { hopper: id, places: [[...at]] }, slow: 0, was: [0, 0, 0], ridden: new Set<number>() }));
            ghost.paths = marbles.map((one) => one.path);
            ghost.done = marbles.length === 0;
            ghost.time = 0;
            steps = 0;
        },
        work(ms, most = Infinity) {
            const until = performance.now() + ms;
            let taken = 0;
            while (!ghost.done && taken < most && (most !== Infinity || performance.now() < until)) {
                // a few steps between looks at the clock, which costs more than a step
                for (let i = 0; i < 4 && !ghost.done && taken < most; i++, taken++) step();
            }
        },
    };
    const end = (one: (typeof marbles)[number], ending: Ending) => {
        one.path.ending = ending;
        one.path.places.push([...one.solid.p]);
        table.space.remove(one.solid);
    };
    /** Each piece's family, by its number, for the run the ghost is on. */
    let families = new Map<number, string>();
    const step = () => {
        if (steps === 0) families = new Map(table.run.map((piece) => [piece.id, piece.kind.family]));
        table.step(STEP);
        steps++;
        ghost.time = steps * STEP;
        const keep = steps % 2 === 0;
        for (const one of marbles) {
            if (one.path.ending) continue;
            const { solid, path } = one;
            // the piece it is on, but not one it flies over: in the air its speed changes by gravity alone
            const flying = Math.abs(solid.v[0] - one.was[0]) + Math.abs(solid.v[1] - one.was[1] + GRAVITY * STEP) + Math.abs(solid.v[2] - one.was[2]) < 1;
            one.was = [...solid.v];
            const on = flying ? undefined : table.pieceAt(solid.p);
            if (on !== undefined) path.last = on;
            // round to a lift or a hoist it has ridden before: it goes round for ever, and the way is shown once
            const family = on === undefined ? undefined : families.get(on);
            const carried = on !== undefined && CARRYING.has(family ?? "");
            if (carried && on !== one.riding && one.ridden.has(on)) {
                end(one, "loops");
                continue;
            }
            if (carried) one.ridden.add(on);
            if (on !== undefined) one.riding = carried ? on : undefined;
            const speed = Math.hypot(solid.v[0], solid.v[1], solid.v[2]);
            // still while it waits for a lift or a hoist to come for it is not stopped: it will be carried
            one.slow = speed < SLOW && !carried ? one.slow + STEP : 0;
            if (carried && solid.rest) continue;
            if (solid.p[1] < ON_TABLE) end(one, "fell");
            else if (table.arrived(solid) && (solid.rest || one.slow > STILLNESS)) end(one, "arrived");
            else if ((solid.rest || one.slow > STILLNESS) && path.last !== undefined && HOLDING.has(families.get(path.last) ?? "")) end(one, "held");
            else if (solid.rest || one.slow > STILLNESS) end(one, "stopped");
            else if (ghost.time >= LONGEST) end(one, "long");
            else if (keep) path.places.push([...solid.p]);
        }
        ghost.done = marbles.every((one) => one.path.ending);
    };
    return ghost;
}

/**
 * The marks the ghost puts on a run: the piece where a marble stops, as too level ("shallow"), and the
 * piece a marble leaves the track from other than by an open end, as thrown off ("fast"). These are
 * what a marble does, so the scene shows them in place of the guesses by energy in checks.ts, which
 * disagree with the physics now and then (docs/marbles.md, stage 3); an open end is marked by checks.ts,
 * exactly.
 */
export function ghostMarks(paths: Path[], openEnds: Mark[]): Mark[] {
    const marks: Mark[] = [];
    for (const path of paths) {
        if (path.last === undefined || !path.ending || path.ending === "arrived" || path.ending === "long" || path.ending === "held" || path.ending === "loops") continue;
        if (path.ending === "fell" && openEnds.some((mark) => mark.id === path.last)) continue;
        const why = path.ending === "stopped" ? "shallow" : "fast";
        if (!marks.some((mark) => mark.id === path.last && mark.why === why)) marks.push({ id: path.last, why });
    }
    return marks;
}

/** Where a marble rests along the run's track, kept for the run it was worked out for. */
const resting: { key: string; cells: Map<string, { at: V3; next?: V3 }[]> } = { key: "", cells: new Map() };

/** How near a ghost marble's middle must be to where a marble rests in a groove for its thread to be drawn there, in cm: as far as one rocks. */
const ON_TRACK = 1.2;

/**
 * The line a ghost marble's thread is drawn along: where the marble is on track, the groove's own middle
 * line at a resting marble's height (the track is known exactly, so the line is calm however the marble
 * rocks from side to side); where it flies between pieces, or circles a bowl, its own places smoothed.
 */
export function threadOf(places: V3[], run: Placed[]): V3[] {
    const onTrack = onTrackOf(run);
    const snapped = places.map(onTrack);
    return places.map((p, i) => {
        const on = snapped[i];
        if (on) return on;
        // in the air or a bowl: smoothed over its neighbours, those on track taken where the track is
        const near: V3[] = [];
        for (let j = Math.max(0, i - 4); j <= Math.min(places.length - 1, i + 4); j++) near.push(snapped[j] ?? places[j]!);
        return [0, 1, 2].map((axis) => near.reduce((sum, q) => sum + q[axis]!, 0) / near.length) as V3;
    });
}

/**
 * Where a marble rests in the groove nearest a point, if the point is within a rocking marble's reach of
 * a groove of the run: the groove's own middle line at a resting marble's height, calm however the
 * marble rocks from side to side. For the ghost's thread, and for the camera that rides a marble.
 */
export function onTrackOf(run: Placed[]): (p: V3) => V3 | undefined {
    // where a marble rests along every length of track, every 4 mm, kept in a grid of 4 cm cells; made
    // again only when the run changes, since the thread is drawn again as the ghost's way grows
    const runKey = JSON.stringify(run.map((piece) => [piece.kind, piece.place]));
    const fresh = runKey !== resting.key;
    const cells = fresh ? new Map<string, { at: V3; next?: V3 }[]>() : resting.cells;
    const key = (p: V3) => `${Math.floor(p[0] / 4)} ${Math.floor(p[1] / 4)} ${Math.floor(p[2] / 4)}`;
    if (fresh) Object.assign(resting, { key: runKey, cells });
    for (const piece of fresh ? run : []) {
        for (const { piece: track } of made(shapeOf(piece.kind), piece.place).lengths) {
            const end = track.path.end;
            const count = Math.max(2, Math.ceil(end / 0.4));
            let before: { at: V3; next?: V3 } | undefined;
            for (let i = 0; i <= count; i++) {
                const f = track.frame((end * i) / count);
                const one = { at: [f.p[0] - f.up[0] * SINK, f.p[1] - f.up[1] * SINK, f.p[2] - f.up[2] * SINK] as V3, next: undefined as V3 | undefined };
                if (before) before.next = one.at;
                const k = key(one.at);
                cells.set(k, [...(cells.get(k) ?? []), one]);
                before = one;
            }
        }
    }
    return (p: V3): V3 | undefined => {
        let best: { at: V3; d: number } | undefined;
        const [cx, cy, cz] = [Math.floor(p[0] / 4), Math.floor(p[1] / 4), Math.floor(p[2] / 4)];
        for (let x = cx - 1; x <= cx + 1; x++) {
            for (let y = cy - 1; y <= cy + 1; y++) {
                for (let z = cz - 1; z <= cz + 1; z++) {
                    for (const one of cells.get(`${x} ${y} ${z}`) ?? []) {
                        // the nearest point of the short stretch from this sample to the next
                        const to = one.next ?? one.at;
                        const d: V3 = [to[0] - one.at[0], to[1] - one.at[1], to[2] - one.at[2]];
                        const long = d[0] * d[0] + d[1] * d[1] + d[2] * d[2];
                        const t = long > 0 ? Math.max(0, Math.min(1, ((p[0] - one.at[0]) * d[0] + (p[1] - one.at[1]) * d[1] + (p[2] - one.at[2]) * d[2]) / long)) : 0;
                        const q: V3 = [one.at[0] + d[0] * t, one.at[1] + d[1] * t, one.at[2] + d[2] * t];
                        const far = Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]);
                        if (!best || far < best.d) best = { at: q, d: far };
                    }
                }
            }
        }
        return best && best.d < ON_TRACK ? best.at : undefined;
    };
}
