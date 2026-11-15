// The marble run's cameras other than the free one, as arithmetic: one that rides along with a marble,
// a little behind and above it, looking where it goes; a glide from one view to another, the short way
// round; and a slow tour along a marble's way, which is a ride on a point going along it at a calm pace.
// Each gives an Orbit (orbit.ts), so that the drawing, and a hand that takes the view back, take it as
// any other view. Nothing here reads the clock or the page: the scene says how much time has passed.
//
//   let ride = rideFrom(orbit, marble.p, marble.v);
//   ride = riding(ride, calm, marble.v, dt, blockedBy(obstaclesOf(run)));   // each frame
//   view = ride.orbit;
//
// A ride never rolls or turns over: its up is always straight up and its tip rises only to look over
// what is in the way, so a loop, a drop or a lift moves it but cannot flip it. Its heading is the marble's way along the ground evened out
// over half a second, so a loop's top, where the marble briefly goes backward, barely turns it, and it
// turns no faster than `rate`. Where track or a wall comes between the marble and the eye, the arm
// from the marble to the eye shortens at once and lengthens again slowly, so the eye never goes into a
// piece and the marble is never hidden.

import { CELL, DEEP, WIDE, boxToWorld, made, shapeOf, type Box } from "./pieces";
import { enters, eyeOf, nearest, type Orbit } from "./orbit";
import type { Placed } from "./run";
import { PILLAR, pillars } from "./supports";
import type { V3 } from "../mote/solids";

/** How a riding camera sits and settles: its distance and tip, how far ahead it looks, how long each part takes to even out, how fast it may turn. */
export interface How {
    /** How far the eye is from the point looked at, in cm, and how far it is tipped over it, in radians. */
    far: number;
    tip: number;
    /** How far ahead of the marble the point looked at is, in cm, at speed. */
    ahead: number;
    /** Seconds over which the point followed, the speed it leads by, and the way it goes are evened out. */
    settle: number;
    speed: number;
    heading: number;
    /** Seconds it takes to turn most of the way toward that way, and the fastest it turns, in radians a second. */
    turn: number;
    rate: number;
    /** Seconds the arm takes to shorten where something is in the way, and to lengthen again; its shortest, in cm. */
    pullIn: number;
    letOut: number;
    least: number;
}

/** Riding a marble: close behind and a little above, looking a few centimetres ahead of it. */
export const RIDE: How = { far: 26, tip: 0.42, ahead: 5, settle: 0.25, speed: 0.2, heading: 0.5, turn: 0.35, rate: 2.4, pullIn: 0.05, letOut: 0.7, least: 5 };
/** The tour: further back and higher, turning more slowly, so the run is seen round the point going along it. */
export const TOUR: How = { far: 46, tip: 0.6, ahead: 10, settle: 0.25, speed: 0.6, heading: 1.2, turn: 0.8, rate: 1.2, pullIn: 0.08, letOut: 1, least: 8 };
/** How fast the tour goes along the run, in cm a second. */
export const PACE = 28;

/** A riding camera as it is: the point it follows, evened out; the speed it leads by; the way it goes along the ground; its turn, its tip and its arm; and the view they make. */
export interface Ride {
    follow: V3;
    speed: V3;
    heading: V3;
    turn: number;
    tip: number;
    far: number;
    orbit: Orbit;
    how: How;
}

/** What is in the way between two points: how far along from the first to the second the first thing is, from 0 to 1, or nothing. */
export type Blocked = (from: V3, to: V3) => number | undefined;

/** The turn about the upright that puts the eye behind something going this way along the ground. */
const behind = (way: V3): number => Math.atan2(-way[0], -way[2]);

/**
 * A ride begun on a marble at `at` going at `v`, from the view there is now: turned behind the way it
 * goes, or, if it is still, turned as the view is, so that it starts where the eye looks from already.
 */
export function rideFrom(view: Orbit, at: V3, v: V3, how: How = RIDE, blocked?: Blocked): Ride {
    const long = Math.hypot(v[0], v[2]);
    const turn = long > 4 ? nearest(view.turn, behind(v)) : view.turn;
    // still, its heading is the way the view looks along the ground, so that it stays turned so
    const heading: V3 = long > 4 ? [v[0], 0, v[2]] : [-Math.sin(turn) * 0.01, 0, -Math.cos(turn) * 0.01];
    const ride: Ride = { follow: [...at], speed: [...v], heading, turn, tip: how.tip, far: how.far, how, orbit: { at: [...at], turn, tip: how.tip, far: how.far } };
    return riding(ride, at, v, 0, blocked);
}

/**
 * The ride a step on: the marble now at `at` going at `v`, `dt` seconds later. `at` should be the calm
 * point (onTrackOf in ghost.ts) where the marble is on track, so that its rocking from side to side is
 * not followed. With `blocked`, the arm shortens where something is in the way.
 */
export function riding(ride: Ride, at: V3, v: V3, dt: number, blocked?: Blocked): Ride {
    const how = ride.how;
    const k = (seconds: number) => (dt > 0 ? 1 - Math.exp(-dt / seconds) : 0);
    const towards = (from: V3, to: V3, by: number): V3 => [from[0] + (to[0] - from[0]) * by, from[1] + (to[1] - from[1]) * by, from[2] + (to[2] - from[2]) * by];
    const follow = dt > 0 ? towards(ride.follow, at, k(how.settle)) : [...at] as V3;
    const speed = dt > 0 ? towards(ride.speed, v, k(how.speed)) : [...v] as V3;
    const heading = dt > 0 ? towards(ride.heading, [v[0], 0, v[2]], k(how.heading)) : ride.heading;
    // following by a share of the way each step lags behind a steady marble by a fixed share of its
    // speed; leading by that much puts the point back on the marble while it goes steadily
    const settle = k(how.settle);
    const lead = dt > 0 && settle > 0 ? (dt * (1 - settle)) / settle : 0;
    const long = Math.hypot(heading[0], heading[2]);
    let turn = ride.turn;
    if (long > 4 && dt > 0) {
        const goal = nearest(turn, behind(heading));
        const most = how.rate * dt;
        turn += Math.max(-most, Math.min(most, (goal - turn) * k(how.turn)));
    }
    // The lag is put back along the way it goes and up and down only: across, a marble that rocks would
    // bring its rocking back with it. Ahead is the way the view looks, which turns more calmly still.
    const lagged = (turned: number): V3 => {
        const [wx, wz] = [-Math.sin(turned), -Math.cos(turned)];
        const onward = speed[0] * wx + speed[2] * wz;
        return [follow[0] + onward * lead * wx, follow[1] + speed[1] * lead, follow[2] + onward * lead * wz];
    };
    // The eye is on an arm from the marble, behind it at `tip` over it; the arm is cast from just above
    // the marble, so that the groove it is in is not taken as in the way.
    const from: V3 = [at[0], at[1] + 1.5, at[2]];
    const eyeAt = (tip: number, arm: number, turned = turn): V3 => {
        const base = lagged(turned);
        return [base[0] + Math.sin(turned) * Math.cos(tip) * arm, base[1] + Math.sin(tip) * arm, base[2] + Math.cos(turned) * Math.cos(tip) * arm];
    };
    /** How long the arm can be at a tip and turn, up to `most` and no shorter than `least`: short of anything in the way, looked at again from where it stops. */
    const armAt = (tip: number, most: number, turned = turn, least = how.least) => {
        let arm = most;
        for (let go = 0; go < 3 && blocked; go++) {
            const found = blocked(from, eyeAt(tip, arm + 1, turned));
            if (found === undefined) break;
            arm = Math.max(least, Math.min(arm, (arm + 1) * found - 1.5));
        }
        return arm;
    };
    const clear = (tip: number, arm: number, turned = turn) => !blocked || blocked(from, eyeAt(tip, arm, turned)) === undefined;
    // Where even a short arm would put the eye in something (the walls of a tray, a hopper's box), the
    // eye rises to look from higher over it, quickly, and comes down again slowly once it is clear;
    // under something, from lower.
    const TIPS = [how.tip, how.tip + 0.35, how.tip + 0.7, 1.3, Math.PI / 2 - 0.05, 0.15];
    const goal = blocked ? TIPS.find((tip) => armAt(tip, how.far) >= how.far * 0.7) ?? how.tip : how.tip;
    let tip = dt > 0 ? ride.tip + (goal - ride.tip) * k(goal > ride.tip ? 0.12 : 0.8) : goal;
    // the arm lengthens slowly toward its length, and shortens at once to stop short of anything in the way
    const most = dt > 0 ? ride.far + (how.far - ride.far) * k(how.letOut) : how.far;
    let far = armAt(tip, most);
    // And where the eye would still be in something, it goes at once to the nearest height that is
    // clear, then to the nearest turn to either side, and if none is, as close to the marble as it must.
    // This is rare (a marble pressed against a post or a hopper's box): elsewhere the arm is enough.
    if (!clear(tip, far)) {
        const tried = [...TIPS].sort((a, b) => Math.abs(a - tip) - Math.abs(b - tip));
        const ways = [0, 0.6, -0.6, 1.2, -1.2, 1.9, -1.9, Math.PI].flatMap((by) => tried.map((one) => [one, turn + by] as const));
        const found = ways.find(([one, turned]) => clear(one, armAt(one, most, turned), turned));
        if (found) {
            [tip, turn] = found;
            far = armAt(tip, most);
        } else far = armAt(tip, most, turn, 1.5);
    }
    const [wx, wz] = [-Math.sin(turn), -Math.cos(turn)];
    const ahead = how.ahead * Math.min(1, long / 20);
    const base = lagged(turn);
    const looked: V3 = [base[0] + ahead * wx, base[1], base[2] + ahead * wz];
    const eye = eyeAt(tip, far);
    const d: V3 = [eye[0] - looked[0], eye[1] - looked[1], eye[2] - looked[2]];
    const seen = Math.hypot(d[0], d[1], d[2]);
    // the view from that eye to the point ahead: the same turn, tipped a little less
    const orbit: Orbit = { at: looked, turn, tip: Math.asin(Math.max(-1, Math.min(1, d[1] / seen))), far: seen };
    return { follow, speed, heading, turn, tip, far, how, orbit };
}

/** A view on its way from one to another, `k` of the way from 0 to 1: the point looked at and the tip straight there, the turn the short way round, the distance evenly in proportion. */
export function glide(from: Orbit, to: Orbit, k: number): Orbit {
    const turn = nearest(from.turn, to.turn);
    return {
        at: [from.at[0] + (to.at[0] - from.at[0]) * k, from.at[1] + (to.at[1] - from.at[1]) * k, from.at[2] + (to.at[2] - from.at[2]) * k],
        turn: from.turn + (turn - from.turn) * k,
        tip: from.tip + (to.tip - from.tip) * k,
        far: from.far * (to.far / from.far) ** k,
    };
}

/** How long a glide from one view to another takes, in seconds: the views' own short turn for a small change, up to a little over a second for a long way. */
export function glideTime(from: Orbit, to: Orbit): number {
    const moved = Math.hypot(to.at[0] - from.at[0], to.at[1] - from.at[1], to.at[2] - from.at[2]) / Math.max(20, Math.min(from.far, to.far));
    const turned = Math.abs(nearest(from.turn, to.turn) - from.turn) + Math.abs(to.tip - from.tip) + Math.abs(Math.log(to.far / from.far));
    return Math.min(1.2, 0.45 + 0.18 * moved + 0.15 * turned);
}

/** How a glide eases: quick to start and slow to settle, as every view's turn does. */
export const eased = (t: number): number => 1 - (1 - Math.min(1, Math.max(0, t))) ** 3;

/** Something in the eye's way: a box about its middle, turned so that its sides lie along `axes` (three ways of length one, square to each other), `half` its size each way along them. */
export interface Obstacle {
    at: V3;
    axes: [V3, V3, V3];
    half: V3;
    /** Clear glass, a tube or a pane: a marble rolls inside a tube, and the eye may follow it in. */
    glass?: boolean;
}

const LEVEL_AXES: [V3, V3, V3] = [[1, 0, 0], [0, 1, 0], [0, 0, 1]];
const dot = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

/** A point in an obstacle's own frame, from its middle along its axes. */
const local = (one: Obstacle, p: V3): V3 => {
    const d: V3 = [p[0] - one.at[0], p[1] - one.at[1], p[2] - one.at[2]];
    return [dot(d, one.axes[0]), dot(d, one.axes[1]), dot(d, one.axes[2])];
};

/** Whether a point is within an obstacle, with `room` more round it. */
export const within = (one: Obstacle, p: V3, room = 0): boolean => local(one, p).every((v, axis) => Math.abs(v) <= one.half[axis]! + room);

/**
 * What is in the way of the eye: every piece's solid wood, its blocks cut at the groove's top, a box
 * turned along the track for every centimetre of it, so that one fits a slope or a bend closely, and a
 * glass tube's square round it; its boxes, stands and glass; the pillars; and the table.
 */
export function obstaclesOf(run: Placed[]): Obstacle[] {
    const found: Obstacle[] = [];
    const level = (box: Box): Obstacle => ({ at: box.at, axes: LEVEL_AXES, half: box.half });
    for (const piece of run) {
        const shape = shapeOf(piece.kind);
        for (const { piece: track, length } of made(shape, piece.place).lengths) {
            const end = track.path.end;
            const count = Math.max(1, Math.ceil(end));
            const block = length.section === "block";
            for (let i = 0; i < count; i++) {
                const [a, b] = [track.frame((end * i) / count), track.frame((end * (i + 1)) / count)];
                const f = track.frame((end * (i + 0.5)) / count);
                const long = Math.hypot(b.p[0] - a.p[0], b.p[1] - a.p[1], b.p[2] - a.p[2]);
                // a block hangs below the groove's middle line; a tube is about it
                const down = block ? DEEP / 2 : 0;
                found.push({ at: [f.p[0] - f.up[0] * down, f.p[1] - f.up[1] * down, f.p[2] - f.up[2] * down], axes: [f.along, f.up, f.across], half: [long / 2 + 0.05, block ? DEEP / 2 : 1.4, block ? WIDE / 2 : 1.4], glass: !block });
            }
        }
        for (const box of [...shape.boxes, ...shape.stands]) found.push(level(boxToWorld(piece.place, box)));
        for (const box of shape.panes ?? []) found.push({ ...level(boxToWorld(piece.place, box)), glass: true });
    }
    for (const pillar of pillars(run)) found.push(level({ at: [pillar.x, pillar.top / 2, pillar.z], half: [PILLAR / 2, pillar.top / 2, PILLAR / 2] }));
    // and the table itself, so that the eye never goes under it
    found.push(level({ at: [0, -50, 0], half: [CELL * 60, 50, CELL * 60] }));
    return found;
}

/**
 * What is in the way between two points among obstacles, each with `room` more round it so that the eye
 * stays clear of a surface by more than the near plane; those that hold the first point are left out
 * (the marble is in or by some of them), and one whose room alone holds it is in the way only if it
 * holds the second point too. Glass near the first point is left out too: a marble in a glass tube or
 * a chimney is followed through the glass.
 */
export function blockedBy(obstacles: Obstacle[], room = 0.6): Blocked {
    return (from, to) => {
        const d: V3 = [to[0] - from[0], to[1] - from[1], to[2] - from[2]];
        const long = Math.hypot(d[0], d[1], d[2]);
        if (long < 1e-9) return undefined;
        let first: number | undefined;
        for (const one of obstacles) {
            if (within(one, from, one.glass ? 3 : 0)) continue;
            const half: V3 = [one.half[0] + room, one.half[1] + room, one.half[2] + room];
            const start = local(one, from);
            const way: V3 = [dot(d, one.axes[0]) / long, dot(d, one.axes[1]) / long, dot(d, one.axes[2]) / long];
            const t = within(one, from, room) ? (within(one, to, room) ? 0 : undefined) : enters({ from: start, way }, [0, 0, 0], half);
            if (t !== undefined && t < long && (first === undefined || t < first)) first = t;
        }
        return first === undefined ? undefined : first / long;
    };
}

/** A way to tour: its places, evenly as they were found, and how far along it each is, in cm. */
export interface Tour {
    places: V3[];
    along: number[];
    length: number;
}

/** A tour along places (a marble's way, calm where it is on track), measured along. */
export function tourOf(places: V3[]): Tour {
    const along = [0];
    for (let i = 1; i < places.length; i++) {
        const [a, b] = [places[i - 1]!, places[i]!];
        along.push(along[i - 1]! + Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]));
    }
    return { places, along, length: along.at(-1) ?? 0 };
}

/** Where a tour is `s` cm along, and its way there at the tour's pace, evened over a few centimetres either side so that a corner is turned gently. */
export function tourAt(tour: Tour, s: number): { at: V3; v: V3 } {
    const point = (d: number): V3 => {
        const { places, along } = tour;
        if (places.length === 0) return [0, 0, 0];
        const clamped = Math.max(0, Math.min(tour.length, d));
        let [low, high] = [0, places.length - 1];
        while (high - low > 1) {
            const middle = (low + high) >> 1;
            if (along[middle]! <= clamped) low = middle;
            else high = middle;
        }
        const span = along[high]! - along[low]!;
        const t = span > 0 ? (clamped - along[low]!) / span : 0;
        const [a, b] = [places[low]!, places[high]!];
        return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
    };
    const at = point(s);
    const [back, on] = [point(s - 6), point(s + 6)];
    const d: V3 = [on[0] - back[0], on[1] - back[1], on[2] - back[2]];
    const long = Math.hypot(d[0], d[1], d[2]);
    return { at, v: long > 1e-9 ? [(d[0] / long) * PACE, (d[1] / long) * PACE, (d[2] / long) * PACE] : [0, 0, 0] };
}

/** Where the tour stops, as distances along it, when motion is to be reduced: it steps from one to the next instead of gliding, about every 40 cm, at least three. */
export function tourSteps(tour: Tour): number[] {
    const count = Math.max(3, Math.min(12, Math.round(tour.length / 40) + 1));
    return Array.from({ length: count }, (_, i) => (tour.length * i) / (count - 1));
}
