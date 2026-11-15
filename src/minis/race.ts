// A race on a marble run: two to eight marbles let go in a fixed order, each with a look of its own in
// a pride flag's colors and named by it in plain words, timed from its own letting go to the moment it
// first comes into a tray, to a fraction of a step. Kept apart from the drawing (marbles.ts) so that a
// test can run the same race the scene runs, step for step, and hold it the same to the bit.
//
//   const table = makeTable(); table.set(run);      // a new table, so that nothing before can change it
//   const race = makeRace(table, 4);
//   while (!race.done) race.step(1 / 120);           // lets marbles go when due, steps the table, times them
//   standing(race);                                  // finished by time, then those that did not finish
//
// How a run with several hoppers or trays is raced, and kept the same every time: every hopper is a
// start. Marbles are dealt to the hoppers in the run's order, the first to the first hopper, the next to
// the next, round again; all the hoppers let go together, a round every `ROUND` seconds (a hopper's next
// marble is out of its box by then). A marble's time runs from its own letting go to the moment it first
// comes into any tray: the first tray it reaches counts. The order is by those times, so that a marble
// let go in a later round is not behind for that. One that leaves the track for the cloth, falls off the
// table, stops (or waits in a seesaw or on a trapdoor) for `STOPPED` seconds, or is still going after
// `LONGEST`, does not finish, and the reason is kept.

import type { Solid } from "../mote/space";
import type { V3 } from "../mote/solids";
import { FLAGS, rgb } from "./flags";
import { enters } from "./orbit";
import { RADIUS } from "./pieces";
import { COMING, type Table } from "./table";

/** The fewest and most marbles a race lets go. */
export const RACE: [number, number] = [2, 8];
/** Seconds between rounds of letting go: a hopper's next marble is out at its mouth by then. */
export const ROUND = COMING + 0.05;
/** How long a marble may be still before it is out, in seconds, and how long one may go on at most. */
export const STOPPED = 1.5;
export const LONGEST = 90;
/** Below this, in cm, a marble's middle is on the cloth: it has left the track. */
const ON_CLOTH = RADIUS + 0.25;
/** Slower than this, in cm/s, a marble is still. */
const SLOW = 1.5;

/** A color as red, green and blue from 0 to 1. */
type Color = [number, number, number];
const hex = (value: string): Color => rgb(value).map((one) => one / 255) as Color;
const stripes = (name: string, picks: number[]): [Color, Color, Color] => {
    const flag = FLAGS.find((one) => one.name === name)!.stripes;
    return picks.map((pick) => hex(flag[pick]!)) as [Color, Color, Color];
};

/**
 * The racers' looks, in the order they are let go: six clear marbles each with a ribbon of three of a
 * flag's stripes, a steel one and an opaque violet one (the site's own accent), so that eight can race
 * and each is told from the others at a glance. The seed is gl.ts's: its whole part the kind (0 clear,
 * 1 opaque, 2 steel), its fraction the turn of the ribbon.
 */
export const RACERS: { name: string; seed: number; tints: [Color, Color, Color] }[] = [
    { name: "trans", seed: 0.15, tints: stripes("trans", [0, 1, 2]) },
    { name: "lesbian", seed: 0.3, tints: stripes("lesbian", [0, 2, 3]) },
    { name: "rainbow", seed: 0.45, tints: stripes("rainbow", [0, 2, 4]) },
    { name: "bi", seed: 0.6, tints: stripes("bisexual", [0, 2, 3]) },
    { name: "pan", seed: 0.75, tints: stripes("pansexual", [0, 1, 2]) },
    { name: "nonbinary", seed: 0.9, tints: stripes("nonbinary", [0, 1, 2]) },
    { name: "steel", seed: 2.5, tints: [[0.8, 0.8, 0.82], [0.8, 0.8, 0.82], [0.8, 0.8, 0.82]] },
    { name: "violet", seed: 1.35, tints: [[0.62, 0.42, 0.9], [0.95, 0.85, 1], [0.45, 0.25, 0.7]] },
];

/** Why a marble did not finish. */
export type Out = "fell" | "stopped" | "long" | "unstarted";

/** One marble in a race: its look's number, the hopper it is let go from, and once let go, its solid, when, and how it ended. */
export interface Racer {
    index: number;
    name: string;
    hopper: number;
    round: number;
    marble?: Solid;
    /** The race's clock when it was let go, and its own time to a tray, in seconds. */
    left?: number;
    time?: number;
    out?: Out;
    still: number;
    was: V3;
}

/** A race as it goes: its racers, the race's own clock, and whether every racer has finished or is out. */
export interface Race {
    racers: Racer[];
    clock: number;
    done: boolean;
    /** Lets marbles go when they are due, steps the table by `dt`, and times them. */
    step(dt: number): void;
    /** The racer a marble is, if it is one. */
    racerOf(marble: Solid): Racer | undefined;
}

/** A race of `count` marbles on a table (made new for it, so that the same run gives the same race). */
export function makeRace(table: Table, count: number): Race {
    const hoppers = table.mouths().map((mouth) => mouth.id);
    const many = Math.max(RACE[0], Math.min(RACE[1], Math.round(count)));
    const racers: Racer[] = Array.from({ length: many }, (_, index) => ({ index, name: RACERS[index]!.name, hopper: hoppers[index % Math.max(1, hoppers.length)] ?? -1, round: Math.floor(index / Math.max(1, hoppers.length)), still: 0, was: [0, 0, 0] }));
    if (!hoppers.length) for (const racer of racers) racer.out = "unstarted";
    const trays = table.trays();
    let rounds = 0;
    let steps = 0;
    const race: Race = {
        racers,
        clock: 0,
        done: !hoppers.length,
        racerOf: (marble) => racers.find((racer) => racer.marble === marble),
        step(dt) {
            if (race.done) return;
            // a round is let go when its time comes: the first once the hoppers' marbles are out at their mouths
            const due = racers.filter((racer) => racer.round === rounds && !racer.marble && !racer.out);
            if (due.length && race.clock >= ROUND * (rounds + 1) - 1e-9) {
                // one hopper after another in the run's order, as one letting go of them all would go
                for (const racer of due) {
                    const [marble] = table.letGo(new Set([racer.hopper]));
                    if (!marble) {
                        racer.out = "unstarted";
                        continue;
                    }
                    racer.marble = marble;
                    racer.left = race.clock;
                    racer.was = [...marble.p];
                }
                rounds++;
            }
            table.step(dt);
            steps++;
            race.clock = steps * dt;
            for (const racer of racers) {
                const marble = racer.marble;
                if (!marble || racer.time !== undefined || racer.out) continue;
                const now: V3 = [...marble.p];
                // into a tray this step: the moment it crossed into the catch, by where along the step it crossed
                const entered = trays.map((box) => ({ box, inside: [0, 1, 2].every((axis) => Math.abs(now[axis]! - box.at[axis]!) < box.half[axis]!) })).find((one) => one.inside);
                if (entered) {
                    const d: V3 = [now[0] - racer.was[0], now[1] - racer.was[1], now[2] - racer.was[2]];
                    const long = Math.sqrt(d[0] * d[0] + d[1] * d[1] + d[2] * d[2]);
                    const along = long > 1e-12 ? enters({ from: racer.was, way: [d[0] / long, d[1] / long, d[2] / long] }, entered.box.at, entered.box.half) : undefined;
                    const share = along === undefined ? 1 : Math.max(0, Math.min(1, along / long));
                    racer.time = race.clock - dt + share * dt - racer.left!;
                    continue;
                }
                racer.was = now;
                const speed = Math.sqrt(marble.v[0] * marble.v[0] + marble.v[1] * marble.v[1] + marble.v[2] * marble.v[2]);
                racer.still = marble.rest || speed < SLOW ? racer.still + dt : 0;
                if (!table.marbles.includes(marble) || now[1] < ON_CLOTH) racer.out = "fell";
                else if (racer.still >= STOPPED) racer.out = "stopped";
                else if (race.clock - racer.left! >= LONGEST) racer.out = "long";
            }
            race.done = racers.every((racer) => racer.time !== undefined || racer.out);
        },
    };
    return race;
}

/** A place in the result: the racer, its time if it finished, and whether it is within a hundredth of the one before or after it. */
export interface Placing {
    racer: Racer;
    time?: number;
    close: boolean;
}

/** The race's result so far: those that finished, by time (the earlier let go first where two are the same to the bit), then those still going, then those out. */
export function standing(race: Race): Placing[] {
    const finished = race.racers.filter((racer) => racer.time !== undefined).sort((a, b) => a.time! - b.time! || a.index - b.index);
    const placings: Placing[] = finished.map((racer) => ({ racer, time: racer.time, close: false }));
    for (let i = 0; i + 1 < placings.length; i++) {
        if (placings[i + 1]!.time! - placings[i]!.time! < 0.01) placings[i]!.close = placings[i + 1]!.close = true;
    }
    const going = race.racers.filter((racer) => racer.time === undefined && !racer.out).map((racer) => ({ racer, close: false }));
    const out = race.racers.filter((racer) => racer.out).map((racer) => ({ racer, close: false }));
    return [...placings, ...going, ...out];
}

/** A time as the race says it, to the hundredth of a second: "12.34 s". */
export const timeOf = (seconds: number): string => `${seconds.toFixed(2)} s`;

/** Why a marble did not finish, in a word or two. */
export const OUT_WORDS: Record<Out, string> = { fell: "fell off", stopped: "stopped", long: "still going", unstarted: "not let go" };

/** A race run to its end on a new table for a run, as the scene runs it: for tests, and the same to the bit as what is seen. */
export function runRace(table: Table, count: number, dt = 1 / 120): Race {
    const race = makeRace(table, count);
    while (!race.done) race.step(dt);
    return race;
}

/**
 * How far along a way a point is, in cm, by the nearest of its places: for which racer leads, the one
 * furthest along the way a marble from its hopper goes (the ghost's), when a camera is asked to ride it.
 */
export function progress(places: V3[], p: V3): number {
    let [best, at] = [Infinity, 0];
    for (let i = 0; i < places.length; i++) {
        const q = places[i]!;
        const d = (q[0] - p[0]) ** 2 + (q[1] - p[1]) ** 2 + (q[2] - p[2]) ** 2;
        if (d < best) [best, at] = [d, i];
    }
    let along = 0;
    for (let i = 1; i <= at; i++) {
        const [a, b] = [places[i - 1]!, places[i]!];
        along += Math.sqrt((b[0] - a[0]) ** 2 + (b[1] - a[1]) ** 2 + (b[2] - a[2]) ** 2);
    }
    return along;
}
