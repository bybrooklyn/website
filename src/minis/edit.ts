// The marble run's editing, as data: what is joined to a piece, a group of pieces moved and turned as
// one, mirrored left for right, fitted by any of its open joints to an open joint of the run, a piece
// made longer or shorter by its own numbers, and a run read back from text with the pieces it shares
// with the run before keeping their numbers. Nothing here draws; marbles.ts does, from these.
//
//   joinedTo(run, id);                    // the whole stretch of run a piece is part of
//   moved(piece, about([2, 3], 1));       // a quarter turn about the corner (2, 3), in cells
//   mirrored(group, "z", 9);              // reflected across z = 4.5 cells, left for right
//   groupSnaps(run, group);               // every way the group fits against an open joint
//
// Every move is in whole cells, whole levels and quarter turns, so a group moved stays on the grid and
// its joints meet others exactly, as single pieces do (run.ts).

import { CELL, LEVEL, SIZES, allowed, shapeOf, toWorld, type Family, type Kind, type Place } from "./pieces";
import { fits, jointsOf, links, open, read, type Open, type Placed } from "./run";
import type { V3 } from "../mote/solids";

/** A move of pieces as one: quarter turns about the corner at the origin, then whole cells across and along and whole levels up. */
export interface Move {
    turn: number;
    x: number;
    z: number;
    y: number;
}

/** No move at all. */
export const STILL: Move = { turn: 0, x: 0, z: 0, y: 0 };

/** A point across and along, turned by quarter turns as a piece's place turns it: a quarter takes (x, z) to (-z, x). */
export function rotated(x: number, z: number, quarters: number): [number, number] {
    for (let i = 0; i < (((quarters % 4) + 4) % 4); i++) [x, z] = [0 - z, x];
    return [x, z];
}

/** The move that turns by `quarters` about the corner `pivot` (in cells) and leaves that corner where it is. */
export function about(pivot: [number, number], quarters: number): Move {
    const [x, z] = rotated(pivot[0], pivot[1], quarters);
    return { turn: ((quarters % 4) + 4) % 4, x: pivot[0] - x, z: pivot[1] - z, y: 0 };
}

/** One move after another, as one. */
export function then(first: Move, second: Move): Move {
    const [x, z] = rotated(first.x, first.z, second.turn);
    return { turn: (first.turn + second.turn) % 4, x: x + second.x, z: z + second.z, y: first.y + second.y };
}

/** A piece moved: its corner turned about the origin and moved, and its own turn turned with it. */
export function moved(piece: Placed, by: Move): Placed {
    const [x, z] = rotated(piece.place.x, piece.place.z, by.turn);
    return { ...piece, place: { x: x + by.x, z: z + by.z, y: piece.place.y + by.y, turn: (piece.place.turn + by.turn) % 4 } };
}

/** A point of the world moved as pieces are, in centimetres. */
export function movedPoint(p: V3, by: Move): V3 {
    const [x, z] = rotated(p[0], p[2], by.turn);
    return [x + by.x * CELL, p[1] + by.y * LEVEL, z + by.z * CELL];
}

/** Every piece joined to this one, by joint after joint, and itself: the stretch of run it is part of. */
export function joinedTo(run: Placed[], id: number): number[] {
    const next = new Map<number, number[]>();
    for (const [a, b] of links(run)) {
        next.set(a.id, [...(next.get(a.id) ?? []), b.id]);
        next.set(b.id, [...(next.get(b.id) ?? []), a.id]);
    }
    const found = new Set<number>([id]);
    const waiting = [id];
    while (waiting.length) for (const other of next.get(waiting.pop()!) ?? []) if (!found.has(other)) found.add(other), waiting.push(other);
    return run.filter((piece) => found.has(piece.id)).map((piece) => piece.id);
}

/** Whether a group can go where it is, with the rest of the run: each of its pieces fits among the pieces not in it. */
export function groupFits(run: Placed[], group: Placed[]): boolean {
    const mine = new Set(group.map((piece) => piece.id));
    const others = run.filter((piece) => !mine.has(piece.id));
    return group.every((piece) => fits(others, piece));
}

/** The middle of a group's cells, in centimetres, at the level of its lowest joint. */
export function middleOf(group: Placed[]): V3 {
    let [x, z, count, y] = [0, 0, 0, Infinity];
    for (const piece of group) {
        for (const cell of shapeOf(piece.kind).cells) {
            const p = toWorld(piece.place, [cell.x * CELL + CELL / 2, 0, cell.z * CELL + CELL / 2]);
            [x, z, count] = [x + p[0], z + p[2], count + 1];
        }
        for (const joint of jointsOf(piece)) y = Math.min(y, joint.at[1]);
    }
    return count ? [x / count, y, z / count] : [0, 0, 0];
}

/** The corner of the grid nearest a group's middle, in cells: what it turns about, so that it turns where it stands. */
export function pivotOf(group: Placed[]): [number, number] {
    const middle = middleOf(group);
    return [Math.round(middle[0] / CELL) + 0, Math.round(middle[2] / CELL) + 0];
}

/** The joints of a group that meet nothing in it: where it can join a run. */
export function groupOpen(group: Placed[]): Open[] {
    return open(group);
}

/** Where a group would join: the move that puts it there, which of its joints meets which open joint of the run. */
export interface GroupSnap {
    move: Move;
    joint: Open;
    to: Open;
}

/**
 * Every way a group fits against an open joint of the run (the run without the group's own pieces):
 * each open joint of the group against each open joint of the run, the group turned to face it and
 * moved to meet it. Those that would overlap a piece or go below the ground are left out.
 */
export function groupSnaps(run: Placed[], group: Placed[]): GroupSnap[] {
    const mine = new Set(group.map((piece) => piece.id));
    const others = run.filter((piece) => !mine.has(piece.id));
    const found: GroupSnap[] = [];
    for (const to of open(others)) {
        for (const joint of groupOpen(group)) {
            if (joint.kind !== to.kind) continue;
            for (let turn = 0; turn < 4; turn++) {
                const [wx, wz] = rotated(joint.way[0], joint.way[2], turn);
                if (wx * to.way[0] + joint.way[1] * to.way[1] + wz * to.way[2] > -1 + 1e-9) continue;
                const [ax, az] = rotated(joint.at[0], joint.at[2], turn);
                const move: Move = { turn, x: Math.round((to.at[0] - ax) / CELL), z: Math.round((to.at[2] - az) / CELL), y: Math.round((to.at[1] - joint.at[1]) / LEVEL) };
                const placed = group.map((piece) => moved(piece, move));
                if (groupFits(others, placed)) found.push({ move, joint, to });
                break;
            }
        }
    }
    return found;
}

/** Families whose pieces are the same mirrored, kept unmirrored so that a run's text says no more than it must. */
const PLAIN = new Set<Family>(["s", "d", "v", "h", "t"]);

/**
 * A group reflected left for right across an upright plane: `across` "z" is the plane z = `twice` / 2
 * cells, "x" the plane x = `twice` / 2 cells (twice, so that it can be on a cell's edge or through its
 * middle, where joints are). Each piece becomes its mirrored form (a left curve a right one) at the
 * place and turn that put it exactly where its reflection is, so pieces joined stay joined.
 */
export function mirrored(group: Placed[], across: "x" | "z", twice: number): Placed[] {
    return group.map((piece) => {
        const { x, z, y, turn } = piece.place;
        const kind: Kind = { ...piece.kind, sizes: [...piece.kind.sizes], mirror: PLAIN.has(piece.kind.family) ? false : !piece.kind.mirror };
        // A piece's own mirror reflects it across the row of its first joint, a cell's middle from its
        // corner; reflecting the world instead turns its turns the other way, and leaves it that cell's
        // width over, which is taken back (worked out in docs/marbles.md, stage 3)
        if (across === "z") {
            const [rx, rz] = rotated(0, 1, -turn);
            return { ...piece, kind, place: { x: x - rx, z: twice - z - rz, y, turn: (4 - turn) % 4 } };
        }
        const [rx, rz] = rotated(0, 1, 2 - turn);
        return { ...piece, kind, place: { x: twice - x - rx, z: z - rz, y, turn: (6 - turn) % 4 } };
    });
}

/**
 * Where a group is mirrored: across the line along its one joint to the rest of the run, if it has
 * exactly one, so that it stays joined there and turns the other way; otherwise across the line
 * through its middle that the view sees as upright, so that left and right swap on the screen.
 * `turn` is the camera's turn about the upright.
 */
export function mirrorLine(run: Placed[], ids: number[], turn: number): { across: "x" | "z"; twice: number } {
    const mine = new Set(ids);
    const joins = links(run).filter(([a, b]) => mine.has(a.id) !== mine.has(b.id));
    if (joins.length === 1) {
        const [a] = joins[0]!;
        if (Math.abs(a.way[0]) > 0.5) return { across: "z", twice: Math.round((2 * a.at[2]) / CELL) };
        return { across: "x", twice: Math.round((2 * a.at[0]) / CELL) };
    }
    const middle = middleOf(run.filter((piece) => mine.has(piece.id)));
    // the screen's right, along the ground, is (cos turn, 0, -sin turn): mostly along x, so x is flipped
    if (Math.abs(Math.cos(turn)) >= Math.abs(Math.sin(turn))) return { across: "x", twice: Math.round((2 * middle[0]) / CELL) };
    return { across: "z", twice: Math.round((2 * middle[2]) / CELL) };
}

/** Which of a family's own numbers its end handle changes; the others it keeps (a curve's quarters, a spiral's turns). */
export const RESIZABLE: Partial<Record<Family, number[]>> = { s: [0], c: [0], d: [0, 1], z: [0, 1], v: [0], x: [1] };

/** Whether a piece can be made longer or shorter by its end. */
export const resizable = (kind: Kind) => RESIZABLE[kind.family] !== undefined;

/**
 * The piece of the same family, made by changing only the numbers its end handle changes, whose far
 * joint is nearest `wanted` (a point in the piece's own place): a straight dragged by its end grows
 * and shrinks by cells, a slope by cells along and levels down, a curve between tight and wide.
 */
export function resized(kind: Kind, wanted: V3): Kind {
    const which = RESIZABLE[kind.family];
    if (!which || !resizable(kind)) return kind;
    let best = { kind, d: Infinity };
    const tryIt = (sizes: number[]) => {
        if (!allowed(kind.family, sizes)) return;
        const made: Kind = { family: kind.family, sizes, mirror: kind.mirror };
        const end = shapeOf(made).joints[1]!.at;
        const d = Math.hypot(end[0] - wanted[0], (end[1] - wanted[1]) * 2, end[2] - wanted[2]);
        if (d < best.d - 1e-9) best = { kind: made, d };
    };
    const limits = SIZES[kind.family as Family];
    const grow = (index: number, sizes: number[]) => {
        if (index === which.length) return tryIt(sizes);
        const at = which[index]!;
        for (let size = limits[at]![0]; size <= limits[at]![1]; size++) grow(index + 1, sizes.map((one, i) => (i === at ? size : one)));
    };
    grow(0, [...kind.sizes]);
    return best.kind;
}

/** A group as a piece of one's own: written as a run, moved so that its middle is at the corner (0, 0) and its lowest part stands on the ground. */
export function asOwn(group: Placed[]): string {
    const [px, pz] = pivotOf(group);
    const low = Math.min(...group.map((piece) => piece.place.y + shapeOf(piece.kind).low));
    const placed = group.map((piece) => moved(piece, { turn: 0, x: -px, z: -pz, y: -low }));
    return ["v1", ...placed.map((piece) => piece.kind.family + [...piece.kind.sizes, piece.place.x, piece.place.z, piece.place.y, piece.place.turn + (piece.kind.mirror ? 4 : 0)].join("_"))].join(".");
}

/**
 * A run read from text, numbered so that each piece the same as one of `before` (the same kind at the
 * same place) keeps that one's number, and the rest take new numbers from `next` on: so that putting a
 * run back changes only what changed, and marbles on the rest roll on.
 */
export function matched(before: Placed[], text: string, next: number): { run: Placed[]; next: number } {
    const free = new Map<string, number[]>();
    const keyOf = (piece: Placed) => `${piece.kind.family}${piece.kind.sizes.join(".")}${piece.kind.mirror ? "m" : ""} ${piece.place.x} ${piece.place.z} ${piece.place.y} ${piece.place.turn}`;
    for (const piece of before) free.set(keyOf(piece), [...(free.get(keyOf(piece)) ?? []), piece.id]);
    const run = read(text).map((piece) => {
        const ids = free.get(keyOf(piece));
        const id = ids?.length ? ids.shift()! : next++;
        return { ...piece, id };
    });
    return { run, next };
}

/** The place of a piece, as a key: for telling whether anything moved. */
export const placeKey = (place: Place) => `${place.x} ${place.z} ${place.y} ${place.turn}`;
