// A marble run as data: a list of pieces from the box, each with its place and turn. Nothing here
// draws or rolls; it says where a piece's joints are in the world, which joints meet, where a piece
// being placed could snap and how it would be turned and moved to fit, whether pieces overlap, and
// writes a run as a short line of text and reads it back exactly.
//
//   const run: Placed[] = read("v2.h0_0_6_0.s1_-1_0_6_0b0_12");
//   links(run);                         // the joints that meet
//   snaps(run, kind);                   // every place a new piece would fit against an open joint
//   write(run);                         // "v2.h0_0_6_0.s1_-1_0_6_0b0_12"
//
// Joints are never stored. Two joints of the same kind, at the same place, facing each other, are
// joined; move a piece and they part. Everything is on the box's grid (pieces.ts), so a joint that
// meets another meets it exactly, and the test for it allows a hair for rounding only.

import { CELL, LEVEL, allowed, bendAllowed, boxToWorld, cellToWorld, isBent, keyOf, shapeOf, toWorld, wayToWorld, withBend, type Box, type Cell, type Kind, type Place } from "./pieces";
import type { V3 } from "../mote/solids";

/** A piece in a run: a number of its own (kept while it is moved), what it is and where. */
export interface Placed {
    id: number;
    kind: Kind;
    place: Place;
}

/** A joint of a piece in the run: whose, which of its joints, and where it is and faces in the world. */
export interface Open {
    id: number;
    joint: number;
    at: V3;
    way: V3;
    kind: string;
}

/** Nearer than this, in centimetres, two joints are at the same place. */
const NEAR = 1e-6;

/** A piece's joints in the world, from its place and turn. */
export function jointsOf(piece: Placed): Open[] {
    return shapeOf(piece.kind).joints.map((joint, index) => ({ id: piece.id, joint: index, at: toWorld(piece.place, joint.at), way: wayToWorld(piece.place, joint.way), kind: joint.kind }));
}

/** Whether two joints meet: the same kind, at the same place, facing each other. */
export function meets(a: Open, b: Open): boolean {
    if (a.kind !== b.kind || a.id === b.id) return false;
    const [dx, dy, dz] = [a.at[0] - b.at[0], a.at[1] - b.at[1], a.at[2] - b.at[2]];
    return dx * dx + dy * dy + dz * dz <= NEAR * NEAR && a.way[0] * b.way[0] + a.way[1] * b.way[1] + a.way[2] * b.way[2] < -1 + 1e-9;
}

/** A place in the world as a key, to the nearest thousandth of a centimetre: for finding joints at one place quickly. */
const spot = (p: V3) => `${Math.round(p[0] * 1000)} ${Math.round(p[1] * 1000)} ${Math.round(p[2] * 1000)}`;

/** Every pair of joints in the run that meet. */
export function links(run: Placed[]): [Open, Open][] {
    const found: [Open, Open][] = [];
    const at = new Map<string, Open[]>();
    for (const piece of run) {
        for (const joint of jointsOf(piece)) {
            const here = at.get(spot(joint.at)) ?? [];
            for (const other of here) if (meets(other, joint)) found.push([other, joint]);
            here.push(joint);
            at.set(spot(joint.at), here);
        }
    }
    return found;
}

/** The joints no other joint meets: the open ends of the run. */
export function open(run: Placed[]): Open[] {
    const joined = new Set(links(run).flatMap(([a, b]) => [`${a.id} ${a.joint}`, `${b.id} ${b.joint}`]));
    return run.flatMap(jointsOf).filter((joint) => !joined.has(`${joint.id} ${joint.joint}`));
}

/** The pieces a piece is joined to. */
export function neighbours(run: Placed[], id: number): number[] {
    return links(run).flatMap(([a, b]) => (a.id === id ? [b.id] : b.id === id ? [a.id] : []));
}

/** The place and turn that put joint `joint` of a piece of this kind against `to`, facing it; none if no quarter turn makes them face. */
export function fit(kind: Kind, joint: number, to: Open): Place | undefined {
    const mine = shapeOf(kind).joints[joint];
    if (!mine || mine.kind !== to.kind) return undefined;
    for (let turn = 0; turn < 4; turn++) {
        const way = wayToWorld({ x: 0, z: 0, y: 0, turn }, mine.way);
        if (way[0] * to.way[0] + way[1] * to.way[1] + way[2] * to.way[2] > -1 + 1e-9) continue;
        const at = toWorld({ x: 0, z: 0, y: 0, turn }, mine.at);
        return { x: Math.round((to.at[0] - at[0]) / CELL), z: Math.round((to.at[2] - at[2]) / CELL), y: Math.round((to.at[1] - at[1]) / LEVEL), turn };
    }
    return undefined;
}

/** A place a piece could snap to: where it would be, which of its joints meets which open joint. */
export interface Snap {
    place: Place;
    joint: number;
    to: Open;
}

/**
 * Every place a piece of this kind would fit against an open joint of the run (leaving out piece
 * `moving`, the one being carried, if it is in the run): each joint of the piece against each open
 * joint, turned to face it. Those that would overlap a piece or go below the ground are left out.
 */
export function snaps(run: Placed[], kind: Kind, moving?: number): Snap[] {
    const others = run.filter((piece) => piece.id !== moving);
    const found: Snap[] = [];
    const joints = shapeOf(kind).joints.length;
    for (const to of open(others)) {
        for (let joint = 0; joint < joints; joint++) {
            const place = fit(kind, joint, to);
            if (place && fits(others, { id: -1, kind, place })) found.push({ place, joint, to });
        }
    }
    return found;
}

/** The cells a piece takes up in the world. */
export function cellsOf(piece: Placed): Cell[] {
    return shapeOf(piece.kind).cells.map((cell) => cellToWorld(piece.place, cell));
}

/** Whether a piece stands on the ground or above it: none of it is below level 0. */
export function grounded(piece: Placed): boolean {
    return piece.place.y + shapeOf(piece.kind).low >= 0;
}

/** A piece's boxes of room in the world: its block and the room a marble rolls in above it, every centimetre. */
export const roomOf = (piece: Placed): Box[] => shapeOf(piece.kind).room.map((box) => boxToWorld(piece.place, box));

/** Whether two boxes share more than a hair of space. */
const crossing = (a: Box, b: Box) => [0, 1, 2].every((axis) => Math.abs(a.at[axis]! - b.at[axis]!) < a.half[axis]! + b.half[axis]! - 1e-6);

/**
 * The pieces of the run that `piece` would overlap: any that takes up part of a cell it takes up, at
 * heights that cross. Where either is bent, sharing a cell is not enough: their boxes of room must
 * cross too, since a bend that strays a little into the next row is still clear of what runs along it.
 */
export function overlaps(run: Placed[], piece: Placed): number[] {
    const mine = new Map<string, Cell[]>();
    for (const cell of cellsOf(piece)) mine.set(`${cell.x} ${cell.z}`, [...(mine.get(`${cell.x} ${cell.z}`) ?? []), cell]);
    const hit: number[] = [];
    let room: Box[] | undefined;
    for (const other of run) {
        if (other.id === piece.id) continue;
        if (!cellsOf(other).some((cell) => (mine.get(`${cell.x} ${cell.z}`) ?? []).some((own) => own.low < cell.high && cell.low < own.high))) continue;
        if (isBent(piece.kind) || isBent(other.kind)) {
            room ??= roomOf(piece);
            const theirs = roomOf(other);
            if (!room.some((box) => theirs.some((one) => crossing(box, one)))) continue;
        }
        hit.push(other.id);
    }
    return hit;
}

/** How far from the middle a piece may go each way, in cells: the edge of the table. */
export const TABLE = 20;

/** Whether a piece can go where it is: on or above the ground, on the table, and overlapping nothing. */
export function fits(run: Placed[], piece: Placed): boolean {
    if (!grounded(piece)) return false;
    if (!cellsOf(piece).every((cell) => Math.abs(cell.x + 0.5) < TABLE && Math.abs(cell.z + 0.5) < TABLE)) return false;
    return overlaps(run, piece).length === 0;
}

// ---- as text ----

/** The form a run is written in. A run of the form before (`v1`, which had no bends) is read too; any other is not. */
export const VERSION = 2;

/** One piece as its text: its family, its numbers and its place, and its bend after a `b` if it is bent. */
const token = (piece: Placed) => piece.kind.family + [...piece.kind.sizes, piece.place.x, piece.place.z, piece.place.y, (((piece.place.turn % 4) + 4) % 4) + (piece.kind.mirror ? 4 : 0)].join("_") + (isBent(piece.kind) ? `b${piece.kind.bend!.join("_")}` : "");

/**
 * A run as one line of text: `v2`, then each piece in order after a dot, as its family letter and then
 * its numbers between underscores: its own numbers, the corner of its first cell across and along, the
 * level of its first joint, and its quarter turns (with 4 added if it is mirrored). A long straight one
 * cell across at level 6, turned once, is `s2_1_0_6_1`. A bent piece goes on with `b` and its bend, each
 * point's millimetres up and aside: `s2_1_0_6_1b20_0_20_-5`. Only letters, digits, `-`, `.` and `_`, so
 * it can go in an address as it is.
 */
export function write(run: Placed[]): string {
    return [`v${VERSION}`, ...run.map(token)].join(".");
}

/** A run read back from its text, `v2` or `v1`, its pieces numbered from 1 in order. Text that is not a run of either form throws, saying why. */
export function read(text: string): Placed[] {
    const [head, ...pieces] = text.trim().split(".");
    if (head !== `v${VERSION}` && head !== "v1") throw new Error(`A run starts with v${VERSION} or v1.`);
    return pieces.map((token, index) => {
        const [main, bent, ...more] = token.slice(1).split("b");
        if (more.length || (bent !== undefined && head === "v1")) throw new Error(`Piece ${index + 1} has a bend where it cannot.`);
        const [family, rest] = [token.slice(0, 1), main!.split("_")];
        const bend = bent === undefined ? [] : bent.split("_");
        if (![...rest, ...bend].every((part) => /^-?\d+$/.test(part))) throw new Error(`Piece ${index + 1} has a number that is not a whole number.`);
        const numbers = rest.map(Number);
        const sizes = numbers.slice(0, numbers.length - 4);
        if (numbers.length < 4 || !allowed(family, sizes)) throw new Error(`Piece ${index + 1} is not a piece of the box.`);
        const [x, z, y, turn] = numbers.slice(-4) as [number, number, number, number];
        if (turn < 0 || turn > 7) throw new Error(`Piece ${index + 1} is turned by more than the turns there are.`);
        const kind: Kind = { family, sizes, mirror: turn >= 4 };
        if (bent !== undefined) kind.bend = bend.map(Number);
        if (!bendAllowed(kind)) throw new Error(`Piece ${index + 1} is bent in a way it cannot be.`);
        return { id: index + 1, kind: withBend(kind, kind.bend), place: { x, z, y, turn: turn % 4 } };
    });
}

/** A run's text in the form written now: a `v1` run read and written again, the same run; anything else as it is. */
export function upgraded(text: string): string {
    if (!text.startsWith("v1")) return text;
    try {
        return write(read(text));
    } catch {
        return text;
    }
}

/** The same kind of piece. */
export const same = (a: Kind, b: Kind) => keyOf(a) === keyOf(b);
