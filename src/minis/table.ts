// The table a marble run is built on, as Mote's physics: the ground, every piece's track, the tray's
// floor and walls, the pillars that hold the run up, and the marbles. It follows the run as it changes,
// piece by piece, while marbles roll: a piece taken away takes its track with it, and a marble on it
// falls. Kept apart from the drawing (marbles.ts) so that it can be run and tested.
//
//   const table = makeTable();
//   table.set(read(text));        // the run, as data (run.ts)
//   table.letGo();                // each hopper lets its waiting marble go
//   table.step(dt);
//
// Each hopper holds a marble at the mouth of its box, waiting. Let go, it rolls away, and the next comes
// out of the box to wait in its place. In centimetres, under real gravity, as Mote's marble space is.

import type { Strike } from "../mote/sound";
import { block } from "../mote/solids";
import { MARBLE, marbleSpace, type Hinge, type Quat, type Solid, type Space } from "../mote/space";
import { cosine, sine, type Piece } from "../mote/track";
import type { Body, Moving } from "./parts";
import { BOWL, CELL, RADIUS, SINK, WOOD, boxToWorld, keyOf, made, shapeOf, toWorld, wayToWorld, type Box, type Place } from "./pieces";
import { links, TABLE, type Placed } from "./run";
import { PILLAR, pillars, type Pillar } from "./supports";
import type { V3 } from "../mote/solids";

/** The most marbles on the table at once; past that, letting another go takes the oldest away, one at rest in a tray first. */
export const MOST = 240;
/** How long a marble takes to come out of a hopper's box to its mouth, in seconds. */
export const COMING = 0.3;
/** How the ground meets a marble: rougher than wood, as a cloth on a table, so that a marble that falls comes to rest. */
const CLOTH = { friction: 0.5, bounce: 0.3, roll: 0.03 };
/** How a marble meets glass: smooth, so that marbles pressed against it by others slide down it rather than wedge. */
const GLASS = { friction: 0.05, bounce: 0.3, roll: 0.006 };
/** Below this, in centimetres, a marble has fallen off the table and is taken away. */
const FALLEN = -60;

/** A piece of the run as it is in the space: its track, its bowl and boxes, and for a hopper, its marbles. */
interface Built {
    piece: Placed;
    key: string;
    lengths: { solid: Solid; piece: Piece; joints: [number | undefined, number | undefined] }[];
    solids: Solid[];
    room: Box[];
    hopper?: Hopper;
    catches?: Box;
    mover?: Mover;
}

/** A piece's moving part in the space: its solids, its hinge if it has one, and for a lift or a hoist the seconds it has run, which say where it is. */
interface Mover {
    moving: Moving;
    solids: Solid[];
    hinge?: Hinge;
    clock: number;
    /** Whether it runs this step: while a marble anywhere is in play, or one waits at it. */
    running: boolean;
}

/** What striking a solid sounds like: wood, metal, a chime bar at its note, a bell, a drum; the table's cloth is a soft knock. */
export interface Heard {
    kind: Strike;
    pitch?: number;
    soft?: boolean;
}

type Lift = Extract<Moving, { kind: "lift" }>;
type Hoist = Extract<Moving, { kind: "hoist" }>;

/** Where a lift's car is, as how far it has risen, `seconds` into its run: it waits at the bottom, rises at its speed (easing in and out), waits at the top, and comes down again. */
export function liftAt(moving: Lift, seconds: number): number {
    const { rise, speed, ease, waits } = moving;
    const travel = rise / speed + ease;
    const period = liftPeriod(moving);
    const t = seconds - Math.floor(seconds / period) * period;
    // how far along a travel of `travel` seconds, at a speed reached and left over `ease` seconds
    const along = (u: number) => {
        if (u <= 0) return 0;
        if (u >= travel) return rise;
        if (u < ease) return (0.5 * speed * u * u) / ease;
        if (u > travel - ease) return rise - (0.5 * speed * (travel - u) * (travel - u)) / ease;
        return speed * (u - ease / 2);
    };
    if (t < waits[0]) return 0;
    if (t < waits[0] + travel) return along(t - waits[0]);
    if (t < waits[0] + travel + waits[1]) return rise;
    return rise - along(t - waits[0] - travel - waits[1]);
}

/** How long a lift takes to go round once, in seconds: its waits and two travels. */
export const liftPeriod = (moving: Lift): number => moving.waits[0] + moving.waits[1] + 2 * (moving.rise / moving.speed + moving.ease);

/** How long a hoist's chain is round, in cm. */
export function chainLength(moving: Hoist): number {
    const { bottom, top, radius } = moving.loop;
    const [dx, dy] = [top[0] - bottom[0], top[1] - bottom[1]];
    return 2 * Math.sqrt(dx * dx + dy * dy) + 2 * Math.PI * radius;
}

/** Where a hoist's chain is `along` cm round its loop from the start of its upper run: the point, and the way out from the loop there, as x and y in the piece's own place. */
export function chainAt(moving: Hoist, along: number): { at: [number, number]; out: [number, number] } {
    const { bottom, top, radius } = moving.loop;
    const [dx, dy] = [top[0] - bottom[0], top[1] - bottom[1]];
    const straight = Math.sqrt(dx * dx + dy * dy);
    const d: [number, number] = [dx / straight, dy / straight];
    const n: [number, number] = [-d[1], d[0]];
    const round = Math.PI * radius;
    let s = along - Math.floor(along / chainLength(moving)) * chainLength(moving);
    if (s < straight) return { at: [bottom[0] + radius * n[0] + d[0] * s, bottom[1] + radius * n[1] + d[1] * s], out: n };
    s -= straight;
    if (s < round) {
        const [c, k] = [cosine(s / radius), sine(s / radius)];
        const out: [number, number] = [n[0] * c + d[0] * k, n[1] * c + d[1] * k];
        return { at: [top[0] + radius * out[0], top[1] + radius * out[1]], out };
    }
    s -= round;
    if (s < straight) return { at: [top[0] - radius * n[0] - d[0] * s, top[1] - radius * n[1] - d[1] * s], out: [-n[0], -n[1]] };
    s -= straight;
    const [c, k] = [cosine(s / radius), sine(s / radius)];
    const out: [number, number] = [-n[0] * c - d[0] * k, -n[1] * c - d[1] * k];
    return { at: [bottom[0] + radius * out[0], bottom[1] + radius * out[1]], out };
}

/** A turn about a unit axis by an angle, by track.ts's sine and cosine, so that it is the same everywhere. */
function about(axis: V3, angle: number): Quat {
    const k = sine(angle / 2);
    return [axis[0] * k, axis[1] * k, axis[2] * k, cosine(angle / 2)];
}

/** Two turns as one: `b` first, then `a`. */
function times(a: Quat, b: Quat): Quat {
    const [ax, ay, az, aw] = a;
    const [bx, by, bz, bw] = b;
    return [aw * bx + ax * bw + ay * bz - az * by, aw * by - ax * bz + ay * bw + az * bx, aw * bz + ax * by - ay * bx + az * bw, aw * bw - ax * bx - ay * by - az * bz];
}

/** A point turned about the line through `at` along a unit axis, by an angle (Rodrigues' rule). */
function turnedAbout(p: V3, at: V3, axis: V3, angle: number): V3 {
    const [c, k] = [cosine(angle), sine(angle)];
    const r: V3 = [p[0] - at[0], p[1] - at[1], p[2] - at[2]];
    const along = r[0] * axis[0] + r[1] * axis[1] + r[2] * axis[2];
    const cross: V3 = [axis[1] * r[2] - axis[2] * r[1], axis[2] * r[0] - axis[0] * r[2], axis[0] * r[1] - axis[1] * r[0]];
    return [0, 1, 2].map((i) => at[i]! + r[i]! * c + cross[i]! * k + axis[i]! * along * (1 - c)) as V3;
}

/** A body's half sizes in the world: across and along swapped by an odd quarter turn. */
const halfIn = (place: Place, body: Body): V3 => boxToWorld(place, { at: body.at, half: body.half }).half;

/** A hopper's marbles: the one waiting at its mouth, and the next on its way out of the box. */
interface Hopper {
    wait: V3;
    inside: V3;
    waiting?: Solid;
    coming?: { marble: Solid; time: number };
}

/** The table, its space, and what is on it. */
export interface Table {
    space: Space;
    /** The run as it is built now. */
    run: Placed[];
    /** Every marble let go, oldest first; not those waiting in a hopper. */
    marbles: Solid[];
    /** Marbles waiting in hoppers or coming out of them, to be drawn. */
    held(): Solid[];
    pillars: Pillar[];
    /** Builds the run given, changing only the pieces that are new, gone or moved. */
    set(run: Placed[]): void;
    /** Each hopper lets its waiting marble go, or only those whose numbers are given; the marbles let go. */
    letGo(only?: Set<number>): Solid[];
    /** Where each tray catches marbles, in the world, in the run's order. */
    trays(): Box[];
    step(dt: number): void;
    /** Takes every marble away and fills each hopper again. */
    clear(): void;
    /** Whether a marble is at rest in a tray, or in one at all. */
    arrived(marble: Solid): boolean;
    /** Told of each marble taken away by the table, so that its drawing can go too. */
    gone?: (marble: Solid) => void;
    /** Where each hopper's marble waits to be let go, by the hopper's number, in the run's order. */
    mouths(): { id: number; at: V3 }[];
    /** The piece whose room a point is in (with a little more round it), if any: the one a marble there is on. */
    pieceAt(p: V3): number | undefined;
    /** What striking a solid sounds like, if the table knows: every piece's track, walls and parts, and the cloth. */
    heard(solid: Solid): Heard | undefined;
    /** Each piece's moving solids, by its number, to be drawn where they are. */
    movers(): { id: number; solids: Solid[] }[];
    /** Whether a marble is in play, awake: lifts and hoists run while one is, or while one waits at them, and not once all is still. */
    running: boolean;
    /** Where every moving part is, by piece: a hinge's angle and spin, a lift's or a hoist's seconds; and the same put back, as for a ghost that is to run as the real table will. */
    parts(): Map<number, number[]>;
    setParts(state: Map<number, number[]>): void;
    /** The piece a hinge belongs to. */
    hingeOf(hinge: Hinge): number | undefined;
    /** A marble's number: how many were made on this table before it, so that its look is decided by it and a run replayed looks the same. */
    numberOf(marble: Solid): number;
    /**
     * Lines marbles up for a race on each hopper's chute, `counts` of them by the hopper's number, each
     * line front first behind a starting gate shut across the chute, the line's middle where the
     * hopper's own marble waits, as far as the chute allows; the hopper's own marbles are taken away
     * and it is not filled again. The marbles lined up, by hopper.
     */
    line(counts: Map<number, number>): Map<number, Solid[]>;
    /** Opens every starting gate at once, raising it out of the way, and wakes the marbles in line. */
    open(): void;
}

/**
 * The starting gate: a steel plate across a hopper's chute, `thick` cm through, from `low` below the
 * chute's line to `top` above it, which rises by `rise` over `opening` seconds, in a frame of two posts
 * `posts` cm either side of the chute's middle and a bar across them `bar` cm above its line. The front
 * marble of the line stands no nearer the joint than `least` cm along the chute, and the last no nearer
 * its top end than `room`.
 */
export const GATE = { thick: 0.25, top: 1.6, low: -1.3, rise: 3.6, opening: 0.15, posts: 2.4, bar: 5.3, least: 2, room: 1.1 };

/** A starting gate on a table: its plate, the hopper it holds, and the seconds since it began to open. */
interface StartGate {
    id: number;
    solid: Solid;
    /** The frame it rises in: two posts beside the chute and a bar across above it, still. */
    frame: Solid[];
    opened?: number;
}

/** How far apart two points are. */
const dist = (a: V3, b: V3): number => Math.sqrt((a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 + (a[2] - b[2]) ** 2);

/** Where a marble rests in the groove at a point along a piece of track: the nearest point of its middle line, then down by how far a marble sinks. */
function restingOn(piece: Piece & { frame?(t: number): { p: V3; up: V3 }; path?: { end: number; point(t: number): V3 } }, near: V3): V3 {
    const path = piece.path!;
    let [best, at] = [Infinity, 0];
    for (let i = 0; i <= 400; i++) {
        const t = (path.end * i) / 400;
        const p = path.point(t);
        const d = (p[0] - near[0]) ** 2 + (p[1] - near[1]) ** 2 + (p[2] - near[2]) ** 2;
        if (d < best) [best, at] = [d, t];
    }
    const f = piece.frame!(at);
    return [f.p[0] - f.up[0] * SINK, f.p[1] - f.up[1] * SINK, f.p[2] - f.up[2] * SINK];
}

/**
 * A table with nothing on it but the ground. Hoppers fill themselves with marbles unless `filled` is
 * false, for a table that only works out where a marble would go (ghost.ts).
 */
export function makeTable({ filled = true } = {}): Table {
    const space = marbleSpace();
    const reach = TABLE * CELL + 40;
    space.slab([0, -1, 0], [reach, 1, reach], undefined, CLOTH);
    const built = new Map<number, Built>();
    const gates: StartGate[] = [];
    let pillarSolids: Solid[] = [];
    const marbles: Solid[] = [];

    const ball = (at: V3) => space.ball(RADIUS, at, MARBLE);
    const heard = new Map<Solid, Heard>();
    const hinges = new Map<Hinge, number>();
    heard.set(space.solids[0]!, { kind: "wood", soft: true });

    /** A moving part made in the space at a piece's place: its solids on a hinge, or driven by the seconds it has run. */
    const moverOf = (place: Place, moving: Moving): Mover => {
        const across = wayToWorld(place, [0, 0, 1]);
        const stuff = (body: Body) => ({ density: body.density, friction: 0.5, bounce: 0.35, roll: 0.006 });
        // a body leans about the line along the piece through its middle, then turns
        const along = wayToWorld(place, [1, 0, 0]);
        const leaning = (body: Body, turn: Quat): Quat => (body.lean ? times(turn, about(along, body.lean)) : turn);
        if (moving.kind === "hinge") {
            const axis = wayToWorld(place, moving.axis);
            const parts = moving.bodies.map((body) => ({ mesh: block(halfIn(place, body)), at: toWorld(place, turnedAbout(body.at, moving.at, moving.axis, body.turn ?? 0)), stuff: stuff(body), q: leaning(body, about(axis, body.turn ?? 0)) }));
            const hinge = space.hinge(parts, toWorld(place, moving.at), axis, { low: moving.low, high: moving.high, spring: moving.spring, rest: moving.rest, friction: moving.friction });
            space.turnTo(hinge, moving.start);
            return { moving, solids: hinge.parts, hinge, clock: 0, running: false };
        }
        const mover: Mover = { moving, solids: [], clock: 0, running: false };
        // the first driven solid of a part keeps its clock, once a step, while the table runs them
        const tick = (solid: Solid, dt: number) => {
            if (mover.running && mover.solids[0] === solid) mover.clock += dt;
        };
        if (moving.kind === "lift") {
            for (const body of moving.bodies) {
                const q = about(across, body.turn ?? 0);
                const solid: Solid = space.driven(block(halfIn(place, body)), toWorld(place, body.at), (dt) => {
                    tick(solid, dt);
                    return { p: toWorld(place, [body.at[0], body.at[1] + liftAt(moving, mover.clock), body.at[2]]), q };
                }, stuff(body), q);
                mover.solids.push(solid);
            }
            return mover;
        }
        const paddle = moving.bodies[0]!;
        const long = chainLength(moving);
        for (let k = 0; k < moving.count; k++) {
            const pose = (seconds: number) => {
                const { at, out } = chainAt(moving, (long * k) / moving.count + moving.speed * seconds);
                // turned about the line across so that the paddle's own up is `out`: by its half angle's cosine and sine
                const [c, s] = [Math.sqrt(Math.max(0, (1 + out[1]) / 2)), (out[0] > 0 ? -1 : 1) * Math.sqrt(Math.max(0, (1 - out[1]) / 2))];
                const q: Quat = [across[0] * s, across[1] * s, across[2] * s, c];
                return { p: toWorld(place, [at[0] + out[0] * paddle.at[1], at[1] + out[1] * paddle.at[1], paddle.at[2]]), q };
            };
            const first = pose(0);
            const solid: Solid = space.driven(block(halfIn(place, paddle)), first.p, (dt) => {
                tick(solid, dt);
                return pose(mover.clock);
            }, stuff(paddle), first.q);
            mover.solids.push(solid);
        }
        return mover;
    };
    /** Each marble's number, in the order they were made. */
    const numbers = new WeakMap<Solid, number>();
    let count = 0;
    /** A marble made inside a hopper's box and held there, to come out to its mouth. */
    const fill = (hopper: Hopper) => {
        const marble = ball([...hopper.inside]);
        numbers.set(marble, count++);
        space.hold(marble);
        hopper.coming = { marble, time: 0 };
    };

    const make = (piece: Placed): Built => {
        const shape = shapeOf(piece.kind);
        const world = made(shape, piece.place);
        const lengths = world.lengths.map(({ piece: track, length }) => ({ solid: space.track(track, length.smooth ? GLASS : WOOD), piece: track as Piece, joints: length.joints }));
        // a piece's own lengths that meet end to end are joined by hand: Mote joins only ends of one section,
        // and where a groove becomes a tube an end left open costs a crossing marble a sixth of its speed
        for (let i = 0; i + 1 < lengths.length; i++) {
            const [a, b] = [lengths[i]!.piece.ends![1], lengths[i + 1]!.piece.ends![0]];
            const apart = Math.hypot(a.p[0] - b.p[0], a.p[1] - b.p[1], a.p[2] - b.p[2]);
            const onward = a.along[0] * b.along[0] + a.along[1] * b.along[1] + a.along[2] * b.along[2];
            if (apart > 1e-6 || onward < 1 - 1e-6) continue;
            lengths[i]!.piece.kept![1] = true;
            lengths[i + 1]!.piece.kept![0] = true;
        }
        const solids = lengths.map((length) => length.solid);
        if (world.bowl) solids.push(space.track(world.bowl, BOWL));
        for (const [box, pane] of [...shape.boxes.map((one) => [one, false] as const), ...(shape.panes ?? []).map((one) => [one, true] as const)]) {
            const placed = boxToWorld(piece.place, box);
            // the walls of a moving or sounding piece, and glass, are smooth, so that a marble pressed against one by a part or by others slides down it and is not held up by it
            solids.push(space.slab(placed.at, placed.half, undefined, { friction: pane || shape.moving || shape.struck ? 0.05 : 0.5, bounce: 0.3, roll: 0.006 }));
        }
        for (const solid of solids) heard.set(solid, { kind: "wood" });
        if (shape.struck) {
            // a mesh about an upright axis, or a box, tilted about the line across the piece
            const struck = shape.struck;
            const solid = space.fixed(struck.mesh, toWorld(piece.place, struck.at), { friction: 0.5, bounce: struck.sound === "drum" ? 0.25 : 0.55, roll: 0.006 }, about(wayToWorld(piece.place, [0, 0, 1]), struck.tilt));
            heard.set(solid, { kind: struck.sound, pitch: struck.pitch });
            solids.push(solid);
        }
        const mover = shape.moving && moverOf(piece.place, shape.moving);
        if (mover) {
            solids.push(...mover.solids);
            for (const solid of mover.solids) heard.set(solid, { kind: mover.moving.sound });
            if (mover.hinge) hinges.set(mover.hinge, piece.id);
        }
        const one: Built = { piece, key: keyOf(piece.kind) + JSON.stringify(piece.place), lengths, solids, room: shape.room.map((box) => boxToWorld(piece.place, box)), mover };
        if (shape.catches) one.catches = boxToWorld(piece.place, shape.catches);
        if (shape.wait && shape.inside) {
            const chute = world.lengths[0]!.piece;
            const hopper: Hopper = { wait: restingOn(chute, toWorld(piece.place, shape.wait)), inside: restingOn(chute, toWorld(piece.place, shape.inside)) };
            if (filled) fill(hopper);
            one.hopper = hopper;
        }
        return one;
    };

    /** Wakes every marble asleep in a box (with a little room), so that one left on nothing falls. */
    const rouse = (boxes: Box[]) => {
        for (const marble of marbles) {
            if (!marble.rest) continue;
            if (boxes.some((box) => [0, 1, 2].every((axis) => Math.abs(marble.p[axis]! - box.at[axis]!) < box.half[axis]! + 2))) space.wake(marble);
        }
    };

    const unmake = (one: Built) => {
        for (const solid of one.solids) {
            space.remove(solid);
            heard.delete(solid);
        }
        if (one.mover?.hinge) hinges.delete(one.mover.hinge);
        unGate((gate) => gate.id === one.piece.id);
        for (const marble of [one.hopper?.waiting, one.hopper?.coming?.marble]) {
            if (!marble) continue;
            space.remove(marble);
            table.gone?.(marble);
        }
        rouse(one.room);
    };

    /** Takes away the starting gates that `which` picks. */
    const unGate = (which: (gate: StartGate) => boolean) => {
        for (let i = gates.length - 1; i >= 0; i--) {
            if (!which(gates[i]!)) continue;
            for (const solid of [gates[i]!.solid, ...gates[i]!.frame]) {
                space.remove(solid);
                heard.delete(solid);
            }
            gates.splice(i, 1);
        }
    };

    /** Each length's ends that are joints of the piece, marked joined where they meet another piece, so that a marble crossing feels one surface. */
    const joinAll = () => {
        const joined = new Set(links(table.run).flatMap(([a, b]) => [`${a.id} ${a.joint}`, `${b.id} ${b.joint}`]));
        for (const one of built.values()) {
            for (const length of one.lengths) {
                length.joints.forEach((joint, side) => {
                    if (joint !== undefined) length.piece.kept![side] = joined.has(`${one.piece.id} ${joint}`);
                });
            }
        }
    };

    const table: Table = {
        space,
        run: [],
        marbles,
        pillars: [],
        held: () => [...built.values()].flatMap((one) => [one.hopper?.waiting, one.hopper?.coming?.marble].filter((marble): marble is Solid => marble !== undefined)),
        set(run) {
            const wanted = new Map(run.map((piece) => [piece.id, piece]));
            const keyOfPiece = (piece: Placed) => keyOf(piece.kind) + JSON.stringify(piece.place);
            for (const [id, one] of built) {
                const now = wanted.get(id);
                if (!now || keyOfPiece(now) !== one.key) {
                    unmake(one);
                    built.delete(id);
                }
            }
            table.run = run.map((piece) => ({ ...piece }));
            joinAll();
            for (const piece of run) if (!built.has(piece.id)) built.set(piece.id, make(piece));
            joinAll();
            // the pillars, made again: a few slabs, cheap to take away and put back
            for (const solid of pillarSolids) {
                space.remove(solid);
                heard.delete(solid);
            }
            table.pillars = pillars(table.run);
            pillarSolids = table.pillars.map((pillar) => space.slab([pillar.x, pillar.top / 2, pillar.z], [PILLAR / 2, pillar.top / 2, PILLAR / 2], undefined, { friction: 0.5, bounce: 0.3 }));
            for (const solid of pillarSolids) heard.set(solid, { kind: "wood" });
        },
        letGo(only) {
            const out: Solid[] = [];
            for (const piece of table.run) {
                const hopper = built.get(piece.id)?.hopper;
                if (!hopper?.waiting || (only && !only.has(piece.id))) continue;
                if (marbles.length >= MOST) {
                    const oldest = marbles.find(table.arrived) ?? marbles[0]!;
                    marbles.splice(marbles.indexOf(oldest), 1);
                    space.remove(oldest);
                    table.gone?.(oldest);
                }
                const marble = hopper.waiting;
                hopper.waiting = undefined;
                space.wake(marble);
                marbles.push(marble);
                out.push(marble);
                if (!hopper.coming) fill(hopper);
            }
            return out;
        },
        step(dt) {
            // a marble coming out of a hopper's box slides to its mouth, rolling as it goes
            for (const one of built.values()) {
                const hopper = one.hopper;
                if (!hopper?.coming) continue;
                const coming = hopper.coming;
                coming.time = Math.min(COMING, coming.time + dt);
                const k = coming.time / COMING;
                const ease = k * k * (3 - 2 * k);
                const before = coming.marble.p;
                coming.marble.p = [hopper.inside[0] + (hopper.wait[0] - hopper.inside[0]) * ease, hopper.inside[1] + (hopper.wait[1] - hopper.inside[1]) * ease, hopper.inside[2] + (hopper.wait[2] - hopper.inside[2]) * ease];
                roll(coming.marble, before);
                if (coming.time >= COMING) {
                    hopper.waiting = coming.marble;
                    hopper.coming = undefined;
                }
            }
            // Lifts and hoists run while a marble is in play: any let go that is awake. One that waits
            // at a lift or a hoist, still and so asleep, keeps that one running, or it would wait for ever.
            const balls = space.solids.filter((solid) => solid.radius !== undefined && !solid.held);
            table.running = balls.some((ball) => ball.im > 0);
            for (const one of built.values()) {
                if (!one.mover || one.mover.hinge) continue;
                one.mover.running = table.running || balls.some((ball) => ball.rest && one.room.some((box) => [0, 1, 2].every((axis) => Math.abs(ball.p[axis]! - box.at[axis]!) <= box.half[axis]! + 1)));
            }
            space.step(dt);
            for (let i = marbles.length - 1; i >= 0; i--) {
                const marble = marbles[i]!;
                if (marble.p[1] > FALLEN) continue;
                marbles.splice(i, 1);
                space.remove(marble);
                table.gone?.(marble);
            }
        },
        clear() {
            for (const marble of marbles) {
                space.remove(marble);
                table.gone?.(marble);
            }
            marbles.length = 0;
            unGate(() => true);
            for (const one of built.values()) {
                const hopper = one.hopper;
                if (!hopper || !filled) continue;
                if (hopper.coming || hopper.waiting) continue;
                fill(hopper);
            }
        },
        trays: () => table.run.flatMap((piece) => {
            const box = built.get(piece.id)?.catches;
            return box ? [box] : [];
        }),
        mouths: () => table.run.flatMap((piece) => {
            const hopper = built.get(piece.id)?.hopper;
            return hopper ? [{ id: piece.id, at: hopper.wait }] : [];
        }),
        pieceAt(p) {
            for (const one of built.values()) if (one.room.some((box) => [0, 1, 2].every((axis) => Math.abs(p[axis]! - box.at[axis]!) <= box.half[axis]! + 0.6))) return one.piece.id;
            return undefined;
        },
        heard: (solid) => heard.get(solid),
        movers: () => [...[...built.values()].flatMap((one) => (one.mover ? [{ id: one.piece.id, solids: one.mover.solids }] : [])), ...gates.map((gate) => ({ id: gate.id, solids: [gate.solid, ...gate.frame] }))],
        running: false,
        parts() {
            const state = new Map<number, number[]>();
            for (const one of built.values()) {
                const mover = one.mover;
                if (mover) state.set(one.piece.id, mover.hinge ? [mover.hinge.angle, mover.hinge.spin] : [mover.clock]);
            }
            return state;
        },
        setParts(state) {
            for (const one of built.values()) {
                const mover = one.mover;
                const values = state.get(one.piece.id);
                if (!mover || !values) continue;
                if (mover.hinge) {
                    space.turnTo(mover.hinge, values[0]!, values[1] ?? 0);
                    continue;
                }
                // each driven solid put where its seconds say, without running on
                mover.clock = values[0]!;
                const running = mover.running;
                mover.running = false;
                for (const solid of mover.solids) {
                    const to = solid.driven!(0);
                    [solid.p, solid.q] = [to.p, to.q];
                }
                mover.running = running;
            }
        },
        hingeOf: (hinge) => hinges.get(hinge),
        numberOf: (marble) => numbers.get(marble) ?? 0,
        line(counts) {
            const lined = new Map<number, Solid[]>();
            for (const piece of table.run) {
                const one = built.get(piece.id);
                const hopper = one?.hopper;
                const many = counts.get(piece.id) ?? 0;
                if (!one || !hopper || many <= 0) continue;
                for (const marble of [hopper.waiting, hopper.coming?.marble]) {
                    if (!marble) continue;
                    space.remove(marble);
                    table.gone?.(marble);
                }
                hopper.waiting = hopper.coming = undefined;
                // the chute from its joint up, as the line along its middle and where a marble rests in its groove, by how far along from the joint
                const chute = one.lengths[0]!.piece as Piece & { frame(t: number): { p: V3; up: V3 }; path: { end: number } };
                const samples: { along: number; line: V3; rest: V3 }[] = [];
                for (let i = 0; i <= 4000; i++) {
                    const f = chute.frame(chute.path.end * (1 - i / 4000));
                    const rest: V3 = [f.p[0] - f.up[0] * SINK, f.p[1] - f.up[1] * SINK, f.p[2] - f.up[2] * SINK];
                    const before = samples[i - 1];
                    samples.push({ along: before ? before.along + dist(rest, before.rest) : 0, line: f.p, rest });
                }
                const at = (along: number) => samples.find((one) => one.along >= along) ?? samples.at(-1)!;
                // the line, a marble's width and a millimetre apart, its middle where the hopper's own marble waits, as far as the chute allows
                const apart = 2 * RADIUS + 0.1;
                const middle = samples.reduce((best, one) => (dist(one.rest, hopper.wait) < dist(best.rest, hopper.wait) ? one : best)).along;
                const front = Math.max(GATE.least, Math.min(samples.at(-1)!.along - GATE.room - (many - 1) * apart, middle - ((many - 1) * apart) / 2));
                // the gate: a plate standing across the chute just before the front marble, its middle over where a marble there would rest, as high as the chute's line there
                const there = at(front - RADIUS - 0.05 - GATE.thick / 2);
                const shut: V3 = [there.rest[0], there.line[1] + (GATE.top + GATE.low) / 2, there.rest[2]];
                const gate: StartGate = { id: piece.id, solid: undefined as unknown as Solid, frame: [] };
                gate.solid = space.driven(block(boxToWorld(piece.place, { at: [0, 0, 0], half: [GATE.thick / 2, (GATE.top - GATE.low) / 2, 1] }).half), shut, (dt) => {
                    // straight up out of the marbles' way, easing in and out
                    if (gate.opened !== undefined) gate.opened = Math.min(GATE.opening, gate.opened + dt);
                    const k = (gate.opened ?? 0) / GATE.opening;
                    return { p: [shut[0], shut[1] + GATE.rise * k * k * (3 - 2 * k), shut[2]], q: [0, 0, 0, 1] };
                }, { density: 7.8, friction: 0.05, bounce: 0.3, roll: 0.006 });
                // its frame: a post either side of the chute, clear of the groove, and a bar across them that the plate rises up to
                const across = wayToWorld(piece.place, [0, 0, 1]);
                const foot = there.line[1] + GATE.low;
                const post: V3 = [GATE.thick / 2, (GATE.bar + 0.4 - GATE.low) / 2, GATE.thick / 2];
                gate.frame = [-1, 1].map((side) => space.fixed(block(post), [shut[0] + across[0] * side * GATE.posts, foot + post[1], shut[2] + across[2] * side * GATE.posts], { friction: 0.05, bounce: 0.3, roll: 0.006 }));
                gate.frame.push(space.fixed(block(boxToWorld(piece.place, { at: [0, 0, 0], half: [GATE.thick / 2, 0.2, GATE.posts + GATE.thick / 2] }).half), [shut[0], there.line[1] + GATE.bar + 0.2, shut[2]], { friction: 0.05, bounce: 0.3, roll: 0.006 }));
                gates.push(gate);
                for (const solid of [gate.solid, ...gate.frame]) heard.set(solid, { kind: "metal" });
                const queue: Solid[] = [];
                for (let k = 0; k < many; k++) {
                    const marble = ball([...at(front + k * apart).rest]);
                    numbers.set(marble, count++);
                    marbles.push(marble);
                    queue.push(marble);
                }
                lined.set(piece.id, queue);
            }
            return lined;
        },
        open() {
            for (const gate of gates) gate.opened ??= 0;
            for (const marble of marbles) space.wake(marble);
        },
        arrived(marble) {
            for (const one of built.values()) {
                const box = one.catches;
                if (box && [0, 1, 2].every((axis) => Math.abs(marble.p[axis]! - box.at[axis]!) < box.half[axis]!)) return true;
            }
            return false;
        },
    };
    return table;
}

/** Turns a held marble as if it had rolled from `before` to where it is now, so that one sliding out of a hopper is seen to roll. */
function roll(marble: Solid, before: V3): void {
    const step: V3 = [marble.p[0] - before[0], marble.p[1] - before[1], marble.p[2] - before[2]];
    const long = Math.sqrt(step[0] * step[0] + step[2] * step[2]);
    if (long < 1e-9) return;
    // about the level line across the way it went, by the distance over the radius
    const axis: V3 = [step[2] / long, 0, -step[0] / long];
    const angle = Math.sqrt(step[0] * step[0] + step[1] * step[1] + step[2] * step[2]) / RADIUS;
    const [s, c] = [sine(angle / 2), cosine(angle / 2)];
    const [ax, ay, az, aw] = [axis[0] * s, axis[1] * s, axis[2] * s, c];
    const [bx, by, bz, bw] = marble.q;
    marble.q = [aw * bx + ax * bw + ay * bz - az * by, aw * by - ax * bz + ay * bw + az * bx, aw * bz + ax * by - ay * bx + az * bw, aw * bw - ax * bx - ay * by - az * bz];
}
