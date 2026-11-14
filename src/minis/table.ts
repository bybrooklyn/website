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

import { MARBLE, marbleSpace, type Solid, type Space } from "../mote/space";
import { cosine, sine, type Piece } from "../mote/track";
import { BOWL, CELL, RADIUS, SINK, WOOD, boxToWorld, keyOf, made, shapeOf, toWorld, type Box } from "./pieces";
import { links, TABLE, type Placed } from "./run";
import { PILLAR, pillars, type Pillar } from "./supports";
import type { V3 } from "../mote/solids";

/** The most marbles on the table at once; past that, letting another go takes the oldest away, one at rest in a tray first. */
export const MOST = 240;
/** How long a marble takes to come out of a hopper's box to its mouth, in seconds. */
export const COMING = 0.3;
/** How the ground meets a marble: rougher than wood, as a cloth on a table, so that a marble that falls comes to rest. */
const CLOTH = { friction: 0.5, bounce: 0.3, roll: 0.03 };
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
}

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
    /** Each hopper lets its waiting marble go; the marbles let go. */
    letGo(): Solid[];
    step(dt: number): void;
    /** Takes every marble away and fills each hopper again. */
    clear(): void;
    /** Whether a marble is at rest in a tray, or in one at all. */
    arrived(marble: Solid): boolean;
    /** Told of each marble taken away by the table, so that its drawing can go too. */
    gone?: (marble: Solid) => void;
}

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

/** A table with nothing on it but the ground. */
export function makeTable(): Table {
    const space = marbleSpace();
    const reach = TABLE * CELL + 40;
    space.slab([0, -1, 0], [reach, 1, reach], undefined, CLOTH);
    const built = new Map<number, Built>();
    let pillarSolids: Solid[] = [];
    const marbles: Solid[] = [];

    const ball = (at: V3) => space.ball(RADIUS, at, MARBLE);
    /** A marble made inside a hopper's box and held there, to come out to its mouth. */
    const fill = (hopper: Hopper) => {
        const marble = ball([...hopper.inside]);
        space.hold(marble);
        hopper.coming = { marble, time: 0 };
    };

    const make = (piece: Placed): Built => {
        const shape = shapeOf(piece.kind);
        const world = made(shape, piece.place);
        const lengths = world.lengths.map(({ piece: track, length }) => ({ solid: space.track(track, WOOD), piece: track as Piece, joints: length.joints }));
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
        for (const box of shape.boxes) {
            const placed = boxToWorld(piece.place, box);
            solids.push(space.slab(placed.at, placed.half, undefined, { friction: 0.5, bounce: 0.3, roll: 0.006 }));
        }
        const one: Built = { piece, key: keyOf(piece.kind) + JSON.stringify(piece.place), lengths, solids, room: shape.room.map((box) => boxToWorld(piece.place, box)) };
        if (shape.catches) one.catches = boxToWorld(piece.place, shape.catches);
        if (shape.wait && shape.inside) {
            const chute = world.lengths[0]!.piece;
            const hopper: Hopper = { wait: restingOn(chute, toWorld(piece.place, shape.wait)), inside: restingOn(chute, toWorld(piece.place, shape.inside)) };
            fill(hopper);
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
        for (const solid of one.solids) space.remove(solid);
        for (const marble of [one.hopper?.waiting, one.hopper?.coming?.marble]) {
            if (!marble) continue;
            space.remove(marble);
            table.gone?.(marble);
        }
        rouse(one.room);
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
            for (const solid of pillarSolids) space.remove(solid);
            table.pillars = pillars(table.run);
            pillarSolids = table.pillars.map((pillar) => space.slab([pillar.x, pillar.top / 2, pillar.z], [PILLAR / 2, pillar.top / 2, PILLAR / 2], undefined, { friction: 0.5, bounce: 0.3 }));
        },
        letGo() {
            const out: Solid[] = [];
            for (const piece of table.run) {
                const hopper = built.get(piece.id)?.hopper;
                if (!hopper?.waiting) continue;
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
            for (const one of built.values()) {
                const hopper = one.hopper;
                if (!hopper) continue;
                if (hopper.coming || hopper.waiting) continue;
                fill(hopper);
            }
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
