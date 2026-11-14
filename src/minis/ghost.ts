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
// A marble's way ends where it comes to rest in a tray (arrived), stops on a piece (stopped), lands on
// the table having left the track (fell, by the piece it was last on), or after `LONGEST` seconds.

import { MARBLE, type Solid } from "../mote/space";
import type { Mark } from "./checks";
import { RADIUS } from "./pieces";
import type { Placed } from "./run";
import { makeTable, type Table } from "./table";
import type { V3 } from "../mote/solids";

/** How a ghost marble's way ended, if it has. */
export type Ending = "arrived" | "stopped" | "fell" | "long";

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
    /** Starts again on this run, from each hopper's mouth. */
    start(run: Placed[]): void;
    /** Works on for up to `ms` milliseconds, or `steps` steps if given (for tests, which must not depend on the machine's speed). */
    work(ms: number, steps?: number): void;
    /** Seconds of marble time worked out so far. */
    time: number;
}

export function makeGhost(): Ghost {
    const table = makeTable({ filled: false });
    let marbles: { solid: Solid; path: Path; slow: number; was: V3 }[] = [];
    let steps = 0;
    const ghost: Ghost = {
        table,
        paths: [],
        done: true,
        time: 0,
        start(run) {
            for (const one of marbles) table.space.remove(one.solid);
            table.set(run);
            marbles = table.mouths().map(({ id, at }) => ({ solid: table.space.ball(RADIUS, [...at], MARBLE), path: { hopper: id, places: [[...at]] }, slow: 0, was: [0, 0, 0] }));
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
    const step = () => {
        table.space.step(STEP);
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
            const speed = Math.hypot(solid.v[0], solid.v[1], solid.v[2]);
            one.slow = speed < SLOW ? one.slow + STEP : 0;
            if (solid.p[1] < ON_TABLE) end(one, "fell");
            else if (table.arrived(solid) && (solid.rest || one.slow > STILLNESS)) end(one, "arrived");
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
        if (path.last === undefined || !path.ending || path.ending === "arrived" || path.ending === "long") continue;
        if (path.ending === "fell" && openEnds.some((mark) => mark.id === path.last)) continue;
        const why = path.ending === "stopped" ? "shallow" : "fast";
        if (!marks.some((mark) => mark.id === path.last && mark.why === why)) marks.push({ id: path.last, why });
    }
    return marks;
}
