// A race on a marble run: two to eight marbles lined up behind a starting gate below each hopper and let
// go together when the gates open, each with a look of its own in a pride flag's colors and named by it in
// plain words, timed from the moment the gates open to the moment it first comes into a tray, to a
// fraction of a step. Kept apart from the drawing (marbles.ts) so that a test can run the same race the
// scene runs, step for step, and hold it the same to the bit.
//
//   const table = makeTable(); table.set(run);      // a new table, so that nothing before can change it
//   const race = makeRace(table, 4, 417);            // four marbles, lined up in the order drawn by 417
//   while (!race.done) race.step(1 / 120);           // stands, opens the gates, steps the table, times them
//   standing(race);                                  // finished by time, then those that did not finish
//
// How a race starts, and is kept the same every time: the racers are put in a line, in an order drawn
// from a number (`lineOf`), shown with the result and given again to run the same race again. The line
// is dealt among the hoppers in the run's order, the first to the first hopper, the next to the next,
// round again, and each hopper's share waits on its chute, front first, behind its starting gate
// (table.ts). They stand for `SETTLE` seconds, so that each rests against the one before, and every gate
// opens at that moment. A marble's time runs from then to the moment it first comes into any tray, so
// the order is the order they arrive. One that leaves the track for the cloth, falls off the table,
// stops (or waits in a seesaw or on a trapdoor) for `STOPPED` seconds, or is still going after
// `LONGEST`, does not finish, and the reason is kept.
//
// In a groove one marble wide no marble can pass another, so on a run with nothing to mix them the
// order they arrive in is the line's; `inLine` says so, and the result says so rather than call it close.

import type { Solid } from "../mote/space";
import type { V3 } from "../mote/solids";
import { FLAGS, rgb } from "./flags";
import { enters } from "./orbit";
import { RADIUS } from "./pieces";
import type { Table } from "./table";

/** The fewest and most marbles a race lets go. */
export const RACE: [number, number] = [2, 8];
/** The numbers a line's order is drawn from. */
export const DRAWN: [number, number] = [1, 999];
/** Seconds the line stands behind the gates before they open: each marble comes to rest against the one before. */
export const SETTLE = 0.5;
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

/** One marble in a race: its look's number, its place in the line, the hopper it waits below, its solid, and how it ended. */
export interface Racer {
    index: number;
    name: string;
    /** Its place in the whole line, from 0 at the front, and the hopper it is dealt to. */
    lined: number;
    hopper: number;
    marble?: Solid;
    /** The race's clock when the gates opened, and its own time from then to a tray, in seconds. */
    left?: number;
    time?: number;
    out?: Out;
    still: number;
    was: V3;
}

/** A race as it goes: the number its line was drawn by, its racers, the race's own clock, and whether every racer has finished or is out. */
export interface Race {
    drawn: number;
    racers: Racer[];
    clock: number;
    done: boolean;
    /** Opens the gates when it is time, steps the table by `dt`, and times the marbles. */
    step(dt: number): void;
    /** The racer a marble is, if it is one. */
    racerOf(marble: Solid): Racer | undefined;
}

/** A whole number kept within the numbers a line is drawn from. */
export const drawnOf = (value: number): number => Math.max(DRAWN[0], Math.min(DRAWN[1], Math.round(Number.isFinite(value) ? value : DRAWN[0])));

/**
 * The order the racers stand in, front first, as their look's numbers, drawn from a number: a shuffle
 * by a small generator of whole numbers (`Math.imul` and shifts), so that the same number gives the same
 * line in every browser.
 */
export function lineOf(count: number, drawn: number): number[] {
    const line = Array.from({ length: count }, (_, index) => index);
    let state = Math.imul(drawnOf(drawn), 0x9e3779b9) >>> 0;
    const next = () => {
        state = (state + 0x6d2b79f5) >>> 0;
        let t = state;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
    for (let i = count - 1; i > 0; i--) {
        const j = Math.floor(next() * (i + 1));
        [line[i], line[j]] = [line[j]!, line[i]!];
    }
    return line;
}

/** A race of `count` marbles on a table (made new for it, so that the same run gives the same race), lined up in the order drawn by `drawn`. */
export function makeRace(table: Table, count: number, drawn: number = DRAWN[0]): Race {
    const hoppers = table.mouths().map((mouth) => mouth.id);
    const many = Math.max(RACE[0], Math.min(RACE[1], Math.round(count)));
    const line = lineOf(many, drawn);
    const racers: Racer[] = Array.from({ length: many }, (_, index) => {
        const lined = line.indexOf(index);
        return { index, name: RACERS[index]!.name, lined, hopper: hoppers[lined % Math.max(1, hoppers.length)] ?? -1, still: 0, was: [0, 0, 0] };
    });
    if (!hoppers.length) for (const racer of racers) racer.out = "unstarted";
    else {
        // each hopper's share of the line, front first
        const queues = table.line(new Map(hoppers.map((id) => [id, racers.filter((racer) => racer.hopper === id).length])));
        for (const racer of racers) {
            const marble = queues.get(racer.hopper)?.[Math.floor(racer.lined / hoppers.length)];
            if (marble) racer.marble = marble;
            else racer.out = "unstarted";
        }
    }
    const trays = table.trays();
    let opened = false;
    let steps = 0;
    const race: Race = {
        drawn: drawnOf(drawn),
        racers,
        clock: 0,
        done: !hoppers.length,
        racerOf: (marble) => racers.find((racer) => racer.marble === marble),
        step(dt) {
            if (race.done) return;
            // every gate opens at once, when the line has stood its time
            if (!opened && race.clock >= SETTLE - 1e-9) {
                opened = true;
                table.open();
                for (const racer of racers) {
                    if (!racer.marble) continue;
                    racer.left = race.clock;
                    racer.was = [...racer.marble.p];
                }
            }
            table.step(dt);
            steps++;
            race.clock = steps * dt;
            if (!opened) return;
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

/** The race's result so far: those that finished, by time (the one nearer the front of the line first where two are the same to the bit), then those still going, then those out. */
export function standing(race: Race): Placing[] {
    const finished = race.racers.filter((racer) => racer.time !== undefined).sort((a, b) => a.time! - b.time! || a.lined - b.lined);
    const placings: Placing[] = finished.map((racer) => ({ racer, time: racer.time, close: false }));
    for (let i = 0; i + 1 < placings.length; i++) {
        if (placings[i + 1]!.time! - placings[i]!.time! < 0.01) placings[i]!.close = placings[i + 1]!.close = true;
    }
    const going = race.racers.filter((racer) => racer.time === undefined && !racer.out).map((racer) => ({ racer, close: false }));
    const out = race.racers.filter((racer) => racer.out).map((racer) => ({ racer, close: false }));
    return [...placings, ...going, ...out];
}

/**
 * Whether the race, done, came out in the line's order: two or more finished, and each of them behind
 * every one that stood before it. So it is on a run where no marble can pass another; the result then
 * says that the line decided it, and does not call two close times a photo finish.
 */
export function inLine(race: Race): boolean {
    const finished = standing(race).filter((one) => one.time !== undefined);
    return race.done && finished.length >= 2 && finished.every((one, place) => place === 0 || finished[place - 1]!.racer.lined < one.racer.lined);
}

/** A time as the race says it, to the hundredth of a second: "12.34 s". */
export const timeOf = (seconds: number): string => `${seconds.toFixed(2)} s`;

/** Why a marble did not finish, in a word or two. */
export const OUT_WORDS: Record<Out, string> = { fell: "fell off", stopped: "stopped", long: "still going", unstarted: "not let go" };

/** A race run to its end on a new table for a run, as the scene runs it: for tests, and the same to the bit as what is seen. */
export function runRace(table: Table, count: number, drawn: number = DRAWN[0], dt = 1 / 120): Race {
    const race = makeRace(table, count, drawn);
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
