// The box of the marble run: every kind of piece, worked out in its own place before it is put in a
// run. A piece is one or more lengths of track (a groove cut in a wooden block, or a tube), with a joint
// at each end where it meets another, and for a few kinds something more: the funnel's bowl, the tray's
// floor and walls, the hopper's box, the spiral's post.
//
//   const shape = shapeOf({ family: "c", sizes: [1, 1], mirror: false });   // a tight curve to the right
//   shape.joints;                      // where it meets others, in its own place
//   made(shape, { x: 2, z: 0, y: 4, turn: 1, mirror: false });              // Mote's pieces, in the world
//
// Everything is on one grid, so that pieces made to meet do meet. A cell is 8 cm square and a level is
// 2 cm high, a block's own height. Track runs along the middle of a row of cells; a joint is in the
// middle of a cell's edge, level (pointing along the ground, its up straight up), at a whole level. A
// piece's own place has the corner of its first cell at the origin and its first joint at (0, 0, 4),
// pointing back along -x, so that the piece goes on toward +x. Turning is by quarter turns about that
// corner, and a mirrored piece is reflected across the row its first joint is in.
//
// In centimetres, under real gravity, as Mote's marble space is. Making a piece uses only the sine and
// cosine of track.ts, so a run is the same to the bit in every browser.

import { cosine, curve, gutter, helix, sine, sweep, turned, type Along, type Path, type Piece, type Section, type V2 } from "../mote/track";
import { cross, dot3 as dot, minus, plus, scaled, type Mesh, type V3 } from "../mote/solids";

/** A cell's side, in centimetres: the length of the shortest straight. */
export const CELL = 8;
/** A level's height, in centimetres: the height of a block of track, and the least step up or down. */
export const LEVEL = 2;
/**
 * The groove's radius, where a marble rolls: a marble of radius 0.8 sits 0.7 below the groove's middle line.
 * Not tighter: a marble rocking from side to side in a groove only a little wider than itself rocks so
 * quickly (in 0.08 s, at 1.1) that Mote's steps lose two fifths of its rocking in a second; at 1.5 none.
 */
export const GROOVE = 1.5;
/** A block of track, across and high. */
export const WIDE = 4.4;
export const DEEP = 2;
/** How thick each surface Mote meets is: thin, since only its face counts. */
const SKIN = 0.1;
/** A marble, as the run uses it. */
export const RADIUS = 0.8;
/** How far a marble's middle sits below the line the track is made along, at rest in the groove. */
export const SINK = GROOVE - RADIUS;

/**
 * What a marble meets of a block of track: the groove, the flat top either side of it and the two
 * sides, each a thin surface. The underside is left out, since nothing comes at track from below.
 */
export const BLOCK: Section = [
    ...gutter(GROOVE + SKIN / 2, Math.PI, SKIN),
    { from: [-WIDE / 2 + SKIN / 2, -SKIN / 2], to: [-GROOVE - SKIN / 2, -SKIN / 2], thick: SKIN },
    { from: [GROOVE + SKIN / 2, -SKIN / 2], to: [WIDE / 2 - SKIN / 2, -SKIN / 2], thick: SKIN },
    { from: [-WIDE / 2 + SKIN / 2, -SKIN / 2], to: [-WIDE / 2 + SKIN / 2, -DEEP + SKIN / 2], thick: SKIN },
    { from: [WIDE / 2 - SKIN / 2, -SKIN / 2], to: [WIDE / 2 - SKIN / 2, -DEEP + SKIN / 2], thick: SKIN },
];
/** A tube whose inside is the groove's circle, so that its floor and the groove's are one surface where they meet. */
export const TUBE: Section = [{ middle: [0, 0], radius: GROOVE + SKIN / 2, from: -Math.PI, to: Math.PI, thick: SKIN }];

/** The loop's radius, to the line its track is made along. */
export const LOOP = 4.5;

/** How a marble meets wood: the friction, bounce and rolling cost of track, and the funnel's rougher bowl. */
export const WOOD = { friction: 0.5, bounce: 0.4, roll: 0.006 };
export const BOWL = { friction: 0.5, bounce: 0.4, roll: 0.012 };

/** The lean a curve is banked to, at most, in radians, and the speed it is banked for, in cm/s. */
const BANK = 0.35;
const BANKED_FOR = 60;
const G = 981;

// ---- the kinds of piece ----

/**
 * Which piece, by its family and its own numbers. `s` a straight (cells long); `c` a curve (its radius in
 * half cells, 1 or 3, and how many quarter turns, 1 or 2); `d` a slope (cells long, levels down); `z` an
 * S bend (cells long, cells aside); `x` a spiral (turns, levels down); `v` a drop through a tube (levels
 * down); `f` a funnel; `l` a loop; `h` the hopper; `t` the tray. A mirrored piece turns the other way.
 */
export interface Kind {
    family: Family;
    sizes: number[];
    mirror: boolean;
}

/** The letter of each family of piece. */
export type Family = "s" | "c" | "d" | "z" | "x" | "v" | "f" | "l" | "h" | "t";

/** How many numbers each family has, and the least and most each may be. */
export const SIZES: Record<Family, [least: number, most: number][]> = {
    s: [[1, 6]],
    c: [[1, 3], [1, 2]],
    d: [[1, 6], [1, 8]],
    z: [[2, 4], [1, 2]],
    x: [[1, 3], [3, 12]],
    v: [[3, 10]],
    f: [],
    l: [],
    h: [],
    t: [],
};

/** Whether a family and its numbers make a piece that can be made: the right count, whole, in range, and for a curve a radius of 1 or 3. */
export function allowed(family: string, sizes: number[]): family is Family {
    const limits = SIZES[family as Family];
    if (!limits || sizes.length !== limits.length) return false;
    if (!sizes.every((size, i) => Number.isInteger(size) && size >= limits[i]![0] && size <= limits[i]![1])) return false;
    if (family === "c" && sizes[0] === 2) return false;
    // a spiral's turns must be at least two levels and a block apart, or one turn would sit in the next
    if (family === "x" && sizes[1]! < sizes[0]! * 3) return false;
    return true;
}

/** One entry of the box: what it is called and the piece it gives. */
export interface Entry {
    name: string;
    kind: Kind;
}

const entry = (name: string, family: Family, sizes: number[] = [], mirror = false): Entry => ({ name, kind: { family, sizes, mirror } });

/** The box, in the order it is shown. Left and right are the same piece mirrored. */
export const BOX: Entry[] = [
    entry("hopper", "h"),
    entry("straight", "s", [1]),
    entry("long straight", "s", [2]),
    entry("longer straight", "s", [3]),
    entry("tight curve left", "c", [1, 1], true),
    entry("tight curve right", "c", [1, 1]),
    entry("wide curve left", "c", [3, 1], true),
    entry("wide curve right", "c", [3, 1]),
    entry("turn back left", "c", [1, 2], true),
    entry("turn back right", "c", [1, 2]),
    entry("gentle slope", "d", [2, 1]),
    entry("steep slope", "d", [2, 2]),
    entry("drop", "v", [4]),
    entry("S bend left", "z", [2, 1], true),
    entry("S bend right", "z", [2, 1]),
    entry("spiral", "x", [2, 6]),
    entry("funnel", "f"),
    entry("loop", "l"),
    entry("tray", "t"),
];

// ---- a piece in its own place ----

/** Where a piece meets another: a place, the way out of the piece, and the section it carries. Its up is always straight up. */
export interface Joint {
    at: V3;
    way: V3;
    kind: "groove";
}

/**
 * A length of track as it is designed: a smooth curve through points, its ends held to directions, or
 * a helix; the section along it; how it is carried; and the bank, worked out from how it turns.
 */
export interface Length {
    section: "block" | "tube";
    path: { points: V3[]; start: V3; end: V3 } | { middle: V3; radius: number; rise: number; turns: number; axis: V3; from: V3 };
    level: boolean;
    /** Leaning into its turns, from none at each end. */
    bank?: number[];
    /** A loop is carried round with the twist that keeps it facing its axis. */
    loop?: boolean;
    /** Not banked: the leads into a loop, which bend only a little, and must meet it upright. */
    plain?: boolean;
    /** Which of its ends is a joint of the piece (by number), if any. */
    joints: [start: number | undefined, end: number | undefined];
}

/** A fixed box in a piece's own place: its middle and half its size each way. */
export interface Box {
    at: V3;
    half: V3;
}

/** A cell a piece takes up: which (by the corner nearest the origin, in cells) and from which level to which. */
export interface Cell {
    x: number;
    z: number;
    low: number;
    high: number;
}

/** What a piece is, in its own place. */
export interface Shape {
    kind: Kind;
    joints: Joint[];
    lengths: Length[];
    /** The funnel's bowl: where the axis is, and the profile turned about it. */
    bowl?: { at: V3; profile: V2[]; thick: number };
    /** Boxes a marble meets: the tray's floor and walls. */
    boxes: Box[];
    /** Boxes of the piece itself that marbles do not roll on: the hopper's box, the spiral's arms. */
    stands: Box[];
    /** Where a pillar from the ground holds the piece up, as the top of the pillar, besides under its joints: the spiral's post, the funnel's legs, under the tray and the hopper's box. */
    holds: V3[];
    cells: Cell[];
    /** Room the piece needs kept clear: the block and the space a marble rolls in above it, a box for every short stretch. */
    room: Box[];
    /** The lowest level of the piece, from its first joint: where it stands on the ground. */
    low: number;
    /** For the hopper: where a marble waits to be let go, and where it comes from, inside the box. */
    wait?: V3;
    inside?: V3;
    /** For the tray: the box a marble is in once it has arrived. */
    catches?: Box;
}

const unit = (a: V3): V3 => scaled(a, 1 / (Math.sqrt(dot(a, a)) || 1));
const clamp = (x: number, low: number, high: number) => Math.max(low, Math.min(high, x));

/** A whole-number key for a kind, the same for the same piece: for keeping what was worked out once. */
export const keyOf = (kind: Kind): string => `${kind.family}${kind.sizes.join(".")}${kind.mirror ? "m" : ""}`;

/** Reflected across the row of the first joint (z = 4), for a mirrored piece. */
const reflect = (p: V3): V3 => [p[0], p[1], CELL - p[2]];
const flip = (v: V3): V3 => [v[0], v[1], -v[2]];

/** The Mote path of a length, in whatever place its numbers are in. */
export function pathOf(length: Length): Path & { facing?: number } {
    const path = length.path;
    if ("points" in path) return curve(path.points, { start: path.start, end: path.end });
    return helix(path.middle, path.radius, path.rise, path.turns, { axis: path.axis, from: path.from });
}

/** How a length is carried along its path, as Mote's sweep takes it. */
export function alongOf(length: Length, path: Path & { facing?: number }): Along {
    if (length.loop) return { twist: path.facing ?? 0 };
    return { level: length.level, bank: length.bank };
}

/** The bank along a path: into its turns as far as a marble at `BANKED_FOR` would lean, eased to none at both ends so that it meets any piece. */
function banked(path: Path): number[] {
    // a point every 6 cm or so: a short curve leans in and out again over its whole length, since a lean
    // that changes quickly twists the surface, and a marble meets a twisted surface a little off square
    const count = Math.max(2, Math.round(path.end / 6));
    const bank: number[] = [];
    for (let i = 0; i <= count; i++) {
        if (i === 0 || i === count) {
            bank.push(0);
            continue;
        }
        const t = (path.end * i) / count;
        const d = path.speed(t);
        const dd = path.bend(t);
        const speed2 = dot(d, d);
        // the turning in the level plane, to the right of the way along, per unit of length
        const across = unit(cross(d, [0, 1, 0]));
        const turning = dot(minus(dd, scaled(d, dot(dd, d) / speed2)), across) / speed2;
        bank.push(clamp(Math.atan((BANKED_FOR * BANKED_FOR * turning) / G), -BANK, BANK));
    }
    return bank.every((lean) => Math.abs(lean) < 1e-9) ? [0] : bank;
}

/** A smooth curve through points with level ends, as a length: the commonest piece of track. */
const along = (points: V3[], joints: Length["joints"], { start = [1, 0, 0] as V3, end = [1, 0, 0] as V3, section = "block" as Length["section"], level = true } = {}): Length => ({ section, path: { points, start, end }, level, joints });

/** Points along a smooth curve from a function of distance, every `step` or so. */
function sampled(total: number, step: number, at: (s: number) => V3): V3[] {
    const count = Math.max(2, Math.ceil(total / step));
    return Array.from({ length: count + 1 }, (_, i) => at((total * i) / count));
}

/** 0 to 1, setting off and arriving with no slope. */
const ease = (u: number) => u * u * (3 - 2 * u);

/** The piece of each family, unmirrored, in its own place. */
function design(family: Family, sizes: number[]): Omit<Shape, "kind" | "cells" | "room" | "low"> & { low?: number } {
    const J0: Joint = { at: [0, 0, 4], way: [-1, 0, 0], kind: "groove" };
    const joint = (at: V3, way: V3): Joint => ({ at, way, kind: "groove" });
    const none = { boxes: [] as Box[], stands: [] as Box[], holds: [] as V3[] };
    switch (family) {
        case "s": {
            const long = sizes[0]! * CELL;
            return { joints: [J0, joint([long, 0, 4], [1, 0, 0])], lengths: [along([[0, 0, 4], [long, 0, 4]], [0, 1])], ...none };
        }
        case "c": {
            const [r, quarters] = [sizes[0]! * 4, sizes[1]!];
            // about an upright axis, from straight across the row toward -z, winding toward +z (a right turn)
            const end: V3 = quarters === 1 ? [r, 0, 4 + r] : [0, 0, 4 + 2 * r];
            const way: V3 = quarters === 1 ? [0, 0, 1] : [-1, 0, 0];
            const length: Length = { section: "block", path: { middle: [0, 0, 4 + r], radius: r, rise: 0, turns: -quarters / 4, axis: [0, 1, 0], from: [0, 0, -1] }, level: true, joints: [0, 1] };
            return { joints: [J0, joint(end, way)], lengths: [length], ...none };
        }
        case "d": {
            const [long, drop] = [sizes[0]! * CELL, sizes[1]! * LEVEL];
            return { joints: [J0, joint([long, -drop, 4], [1, 0, 0])], lengths: [along([[0, 0, 4], [long / 2, -drop / 2, 4], [long, -drop, 4]], [0, 1])], ...none };
        }
        case "z": {
            const [long, aside] = [sizes[0]! * CELL, sizes[1]! * CELL];
            return { joints: [J0, joint([long, 0, 4 + aside], [1, 0, 0])], lengths: [along([[0, 0, 4], [long / 2, 0, 4 + aside / 2], [long, 0, 4 + aside]], [0, 1])], ...none };
        }
        case "x": {
            // in along the row to the bottom of a circle of one cell's radius about the middle of a block of
            // three cells by three, round it `turns` times going down, and out along the row the other way
            const [turns, drop] = [sizes[0]!, sizes[1]! * LEVEL];
            const lead = 12;
            const round = 2 * Math.PI * 8 * turns;
            const total = 2 * lead + round;
            const at = (s: number): V3 => {
                const y = -drop * ease(s / total);
                if (s <= lead) return [s, y, 4];
                if (s >= lead + round) return [12 + (s - lead - round), y, 4];
                const angle = (s - lead) / 8;
                return [12 + 8 * sine(angle), y, 12 - 8 * cosine(angle)];
            };
            // a post up the middle, and an arm out from it to the block under every quarter turn
            const stands: Box[] = [];
            let top = -Infinity;
            for (let quarter = 0; quarter <= turns * 4; quarter++) {
                const angle = (quarter * Math.PI) / 2;
                const y = -drop * ease((lead + angle * 8) / total) - DEEP - 0.35;
                top = Math.max(top, y + 0.35);
                const [dx, dz] = [Math.round(sine(angle)), -Math.round(cosine(angle))];
                stands.push({ at: [12 + dx * 3.5, y, 12 + dz * 3.5], half: [dx ? 3.5 : 0.4, 0.35, dz ? 3.5 : 0.4] });
            }
            return { joints: [J0, joint([24, -drop, 4], [1, 0, 0])], lengths: [along(sampled(total, 1.2, at), [0, 1])], boxes: [], stands, holds: [[12, top, 12]] };
        }
        case "v": {
            // a short groove, then a tube that turns straight down, falls, and turns level again, then a short groove
            const drop = sizes[0]! * LEVEL;
            const bend = 2;
            const fall = drop - 2 * bend;
            const top: V3 = [3, 0, 4];
            const curl = (centre: V3, from: number, to: number, count: number) => Array.from({ length: count + 1 }, (_, i): V3 => {
                const angle = from + ((to - from) * i) / count;
                return [centre[0] + bend * cosine(angle), centre[1] + bend * sine(angle), 4];
            });
            const tube: V3[] = [
                ...curl([3, -bend, 4], Math.PI / 2, 0, 6),
                ...Array.from({ length: Math.max(1, Math.round(fall / 1.5)) - 1 }, (_, i): V3 => [3 + bend, -bend - (fall * (i + 1)) / Math.max(1, Math.round(fall / 1.5)), 4]),
                ...curl([3 + 2 * bend, -drop + bend, 4], Math.PI, Math.PI * 1.5, 6),
            ];
            const out: V3 = [3 + 2 * bend + 0.5, -drop, 4];
            return {
                joints: [J0, joint([CELL, -drop, 4], [1, 0, 0])],
                lengths: [along([[0, 0, 4], top], [0, undefined]), along([...tube, out], [undefined, undefined], { section: "tube", level: false, end: [1, 0, 0] }), along([out, [CELL, -drop, 4]], [undefined, 1])],
                ...none,
            };
        }
        case "f": {
            // a chute along the row into a bowl about the middle of three cells by three, that marbles
            // circle down and drop through; under the hole a tube turns them level and out the far side
            const middle: V3 = [12, 0, 12];
            const profile: V2[] = [[1.65, -11.5], [3, -9.8], [6, -6.2], [8, -4.4], [10, -3.2]];
            const chute = along([[0, 0, 4], [6, -0.45, 4], [12, -1.5, 4]], [0, undefined], { end: unit([1, -0.2, 0]) });
            const neck: V3[] = [[12, -11.5, 12], [12, -12.25, 12], [12, -13, 12]];
            for (let i = 1; i <= 8; i++) {
                const angle = Math.PI + (Math.PI / 2) * (i / 8);
                neck.push([15 + 3 * cosine(angle), -13 + 3 * sine(angle), 12]);
            }
            neck.push([16.5, -16, 12], [18, -16, 12]);
            const tube = along(neck, [undefined, undefined], { section: "tube", level: false, start: [0, -1, 0] });
            const exit = along([[18, -16, 12], [24, -16, 12]], [undefined, 1]);
            // legs at four places round the bowl, up to its underside where it is 8.5 out
            const under = curve(profile.map(([out, high]): V3 => [out, high, 0]));
            let [low, high] = [0, under.end];
            for (let go = 0; go < 60; go++) [low, high] = under.point((low + high) / 2)[0] < 8.5 ? [(low + high) / 2, high] : [low, (low + high) / 2];
            const legTop = under.point(low)[1] - 0.15;
            const out = 8.5 / Math.SQRT2;
            const holds = ([[1, 1], [1, -1], [-1, 1], [-1, -1]] as const).map(([dx, dz]): V3 => [middle[0] + dx * out, legTop, middle[2] + dz * out]);
            return { joints: [J0, joint([24, -16, 12], [1, 0, 0])], lengths: [chute, tube, exit], bowl: { at: middle, profile, thick: 0.3 }, boxes: [], stands: [], holds, low: -9 };
        }
        case "l": {
            // in along the row, once round a loop of 4.5 cm about a level axis, and on a cell aside. A loop
            // that climbs `rise` aside as it goes round leans that way; each lead bends once, gently, by
            // `aside`, into the way the loop leans, so that the loop climbs only what is left of the cell:
            // a lead that bends as a parabola from straight to the loop's lean ends 4 tan(lean) aside, and
            // the lean is the climb over the loop's round, so tan(lean) = (8 - 8 tan(lean)) / (2 pi r).
            const lean = CELL / (2 * Math.PI * LOOP + CELL);
            const aside = (CELL / 2) * lean;
            const ringOf = { middle: [8, LOOP, 4 + aside] as V3, radius: LOOP, rise: CELL - 2 * aside, turns: 1, axis: [0, 0, 1] as V3, from: [0, -1, 0] as V3 };
            const loop = helix(ringOf.middle, LOOP, ringOf.rise, 1, { axis: ringOf.axis, from: ringOf.from });
            const [into, outof] = [unit(loop.speed(0)), unit(loop.speed(loop.end))];
            const ring: Length = { section: "block", path: ringOf, level: false, loop: true, joints: [undefined, undefined] };
            return {
                joints: [J0, joint([16, 0, 12], [1, 0, 0])],
                lengths: [
                    { ...along([[0, 0, 4], [8, 0, 4 + aside]], [0, undefined], { end: into }), plain: true },
                    ring,
                    { ...along([[8, 0, 12 - aside], [16, 0, 12]], [undefined, 1], { start: outof }), plain: true },
                ],
                ...none,
            };
        }
        case "h": {
            // a box that holds marbles, behind; a chute from inside it down to the joint, sloping all the way so that a marble let go rolls
            const chute = along([[15, 2.6, 4], [7.5, 0.9, 4], [0, 0, 4]], [undefined, 0], { start: unit([-1, -0.28, 0]), end: [-1, 0, 0] });
            const box: Box = { at: [12.75, 3.4, 4], half: [3.25, 5.4, 3.5] };
            return { joints: [J0], lengths: [chute], boxes: [], stands: [box], holds: [[12.75, box.at[1] - box.half[1], 4]], wait: [9, 0, 4], inside: [13.6, 0, 4] };
        }
        case "t": {
            // a chute down over the tray's near wall, and a tray two cells long and three across, on the ground
            const chute = along([[0, 0, 4], [4, -0.3, 4], [8, -1, 4]], [0, undefined], { end: unit([1, -0.25, 0]) });
            const [floor, wall] = [-6, -3];
            const boxes: Box[] = [
                { at: [16, floor - 1, 4], half: [8, 1, 12] },
                { at: [8.5, (floor + wall) / 2, 4], half: [0.5, (wall - floor) / 2, 12] },
                { at: [23.5, (floor + wall) / 2, 4], half: [0.5, (wall - floor) / 2, 12] },
                { at: [16, (floor + wall) / 2, -7.5], half: [7, (wall - floor) / 2, 0.5] },
                { at: [16, (floor + wall) / 2, 15.5], half: [7, (wall - floor) / 2, 0.5] },
            ];
            const holds = ([[10, -6], [22, -6], [10, 14], [22, 14]] as const).map(([x, z]): V3 => [x, floor - 2, z]);
            return { joints: [J0], lengths: [chute], boxes, stands: [], holds, catches: { at: [16, floor + 1.5, 4], half: [7, 1.6, 11] }, low: -4 };
        }
    }
}

/** Cells a box covers, from level `low` to `high`, keeping only the part inside each cell by more than a hair. */
function cellsOf(box: Box, into: Map<string, Cell>): void {
    const hair = 1e-6;
    const [x0, x1] = [Math.floor((box.at[0] - box.half[0] + hair) / CELL), Math.floor((box.at[0] + box.half[0] - hair) / CELL)];
    const [z0, z1] = [Math.floor((box.at[2] - box.half[2] + hair) / CELL), Math.floor((box.at[2] + box.half[2] - hair) / CELL)];
    const low = Math.floor((box.at[1] - box.half[1] + hair) / LEVEL);
    const high = Math.ceil((box.at[1] + box.half[1] - hair) / LEVEL);
    for (let x = x0; x <= x1; x++) {
        for (let z = z0; z <= z1; z++) {
            const key = `${x} ${z}`;
            const was = into.get(key);
            into.set(key, was ? { x, z, low: Math.min(was.low, low), high: Math.max(was.high, high) } : { x, z, low, high });
        }
    }
}

/** The room a length of track needs, as a box for every short stretch: its block, and as far above as a marble rolls. */
function roomOf(piece: Piece & { frame(t: number): { p: V3; along: V3; up: V3; across: V3 }; path: Path }, section: Length["section"]): Box[] {
    const boxes: Box[] = [];
    const end = piece.path.end;
    const count = Math.max(1, Math.ceil(end / 1));
    // the section's corners: a block and the room above it, or a tube's square about it
    const corners: V2[] = section === "block" ? [[-WIDE / 2, -DEEP], [WIDE / 2, -DEEP], [-WIDE / 2, DEEP], [WIDE / 2, DEEP]] : [[-1.25, -1.25], [1.25, -1.25], [-1.25, 1.25], [1.25, 1.25]];
    let before: V3[] | undefined;
    for (let i = 0; i <= count; i++) {
        // just inside each end, so that a piece takes up no cell beyond its joints
        const t = clamp((end * i) / count, 0.02, end - 0.02);
        const f = piece.frame(t);
        const points = corners.map(([u, v]) => plus(f.p, plus(scaled(f.across, u), scaled(f.up, v))));
        if (before) {
            const all = [...before, ...points];
            const low = [0, 1, 2].map((axis) => Math.min(...all.map((p) => p[axis]!)));
            const high = [0, 1, 2].map((axis) => Math.max(...all.map((p) => p[axis]!)));
            boxes.push({ at: [(low[0]! + high[0]!) / 2, (low[1]! + high[1]!) / 2, (low[2]! + high[2]!) / 2], half: [(high[0]! - low[0]!) / 2, (high[1]! - low[1]!) / 2, (high[2]! - low[2]!) / 2] });
        }
        before = points;
    }
    return boxes;
}

const shapes = new Map<string, Shape>();

/** A kind of piece in its own place, worked out once. */
export function shapeOf(kind: Kind): Shape {
    const key = keyOf(kind);
    const kept = shapes.get(key);
    if (kept) return kept;
    if (!allowed(kind.family, kind.sizes)) throw new Error(`There is no piece ${key}.`);
    const made = design(kind.family, kind.sizes);
    const shape: Shape = { kind, ...made, cells: [], room: [], low: made.low ?? -1 };
    if (kind.mirror) mirrored(shape);
    for (const length of shape.lengths) {
        if (length.level && !length.loop && !length.plain && length.section === "block") length.bank = banked(pathOf(length));
    }
    // the cells it takes up and the room it needs, from its track and its boxes
    const cells = new Map<string, Cell>();
    for (const length of shape.lengths) {
        const path = pathOf(length);
        const piece = sweep(path, length.section === "block" ? BLOCK : TUBE, alongOf(length, path));
        for (const box of roomOf(piece, length.section)) {
            shape.room.push(box);
            cellsOf(box, cells);
        }
    }
    if (shape.bowl) {
        const { at, profile } = shape.bowl;
        const rim = profile[profile.length - 1]!;
        const bowl: Box = { at: [at[0], (profile[0]![1] + rim[1] + 2) / 2, at[2]], half: [rim[0] + 0.3, (rim[1] + 2 - profile[0]![1]) / 2, rim[0] + 0.3] };
        shape.room.push(bowl);
        cellsOf(bowl, cells);
    }
    for (const box of [...shape.boxes, ...shape.stands]) {
        shape.room.push(box);
        cellsOf(box, cells);
    }
    if (shape.catches) cellsOf(shape.catches, cells);
    shape.cells = [...cells.values()];
    shapes.set(key, shape);
    return shape;
}

/** Reflects a piece across the row of its first joint, in place: a right curve becomes a left one. */
function mirrored(shape: Shape): void {
    shape.joints = shape.joints.map((joint) => ({ ...joint, at: reflect(joint.at), way: flip(joint.way) }));
    shape.lengths = shape.lengths.map((length) => {
        const path = length.path;
        if ("points" in path) return { ...length, path: { points: path.points.map(reflect), start: flip(path.start), end: flip(path.end) } };
        // a reflection turns a helix's winding about: the turns and the climb change sign together
        return { ...length, path: { middle: reflect(path.middle), radius: path.radius, rise: -path.rise, turns: -path.turns, axis: flip(path.axis), from: flip(path.from) } };
    });
    const box = (one: Box): Box => ({ at: reflect(one.at), half: one.half });
    shape.boxes = shape.boxes.map(box);
    shape.stands = shape.stands.map(box);
    shape.holds = shape.holds.map(reflect);
    if (shape.bowl) shape.bowl = { ...shape.bowl, at: reflect(shape.bowl.at) };
    if (shape.catches) shape.catches = box(shape.catches);
    if (shape.wait) shape.wait = reflect(shape.wait);
    if (shape.inside) shape.inside = reflect(shape.inside);
}

// ---- a piece in the world ----

/** Where a piece is: the corner of its first cell (in whole cells), the level of its first joint, how many quarter turns it is turned about that corner, and whether it is mirrored. */
export interface Place {
    x: number;
    z: number;
    y: number;
    turn: number;
}

/** A point of a piece's own place, in the world: turned by quarter turns about its corner, then moved. */
export function toWorld(place: Place, p: V3): V3 {
    let [x, z] = [p[0], p[2]];
    for (let i = 0; i < (((place.turn % 4) + 4) % 4); i++) [x, z] = [0 - z, x];
    return [x + place.x * CELL, p[1] + place.y * LEVEL, z + place.z * CELL];
}

/** A direction of a piece's own place, in the world: turned only. */
export function wayToWorld(place: Place, v: V3): V3 {
    let [x, z] = [v[0], v[2]];
    for (let i = 0; i < (((place.turn % 4) + 4) % 4); i++) [x, z] = [0 - z, x];
    return [x, v[1], z];
}

/** A box of a piece's own place, in the world: a quarter turn swaps its sizes across and along. */
export function boxToWorld(place: Place, box: Box): Box {
    const odd = (((place.turn % 4) + 4) % 4) % 2 === 1;
    return { at: toWorld(place, box.at), half: odd ? [box.half[2], box.half[1], box.half[0]] : [...box.half] };
}

/** A cell of a piece's own place, in the world. */
export function cellToWorld(place: Place, cell: Cell): Cell {
    const middle = toWorld(place, [cell.x * CELL + CELL / 2, 0, cell.z * CELL + CELL / 2]);
    return { x: Math.floor(middle[0] / CELL), z: Math.floor(middle[2] / CELL), low: cell.low + place.y, high: cell.high + place.y };
}

/** A length of track in the world, as Mote's numbers. */
export function lengthToWorld(place: Place, length: Length): Length {
    const path = length.path;
    if ("points" in path) return { ...length, path: { points: path.points.map((p) => toWorld(place, p)), start: wayToWorld(place, path.start), end: wayToWorld(place, path.end) } };
    return { ...length, path: { ...path, middle: toWorld(place, path.middle), axis: wayToWorld(place, path.axis), from: wayToWorld(place, path.from) } };
}

/** A length of track made as Mote's piece, ready for a space and for drawing. */
export function sweepOf(length: Length) {
    const path = pathOf(length);
    return sweep(path, length.section === "block" ? BLOCK : TUBE, alongOf(length, path));
}

/** A piece's track in the world as Mote's pieces: its lengths, and its bowl if it has one; each with which of the piece's joints its ends are. */
export function made(shape: Shape, place: Place): { lengths: { piece: ReturnType<typeof sweepOf>; length: Length }[]; bowl?: Piece } {
    const lengths = shape.lengths.map((length) => {
        const world = lengthToWorld(place, length);
        return { piece: sweepOf(world), length: world };
    });
    const bowl = shape.bowl && turned(toWorld(place, shape.bowl.at), shape.bowl.profile, shape.bowl.thick);
    return { lengths, bowl };
}

// ---- drawing a block ----

/** The outline of a block across, as runs of points: each run is lit smooth along itself, with a sharp edge where two meet. */
function outline(): V2[][] {
    const groove: V2[] = [];
    const count = 14;
    for (let i = 0; i <= count; i++) {
        const angle = Math.PI + (Math.PI * i) / count;
        groove.push([GROOVE * cosine(angle), GROOVE * sine(angle)]);
    }
    return [
        [[-WIDE / 2, 0], [-GROOVE, 0]],
        groove,
        [[GROOVE, 0], [WIDE / 2, 0]],
        [[WIDE / 2, 0], [WIDE / 2, -DEEP]],
        [[WIDE / 2, -DEEP], [-WIDE / 2, -DEEP]],
        [[-WIDE / 2, -DEEP], [-WIDE / 2, 0]],
    ];
}

/** A polygon's triangles, by cutting off one corner after another: for the end of a block, which is not a simple shape. */
export function triangles(polygon: V2[]): [number, number, number][] {
    const left = polygon.map((_, i) => i);
    const out: [number, number, number][] = [];
    const area = polygon.reduce((sum, p, i) => sum + (p[0] * polygon[(i + 1) % polygon.length]![1] - polygon[(i + 1) % polygon.length]![0] * p[1]), 0);
    const turn = area > 0 ? 1 : -1;
    const cornerOf = (a: V2, b: V2, c: V2) => ((b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0])) * turn;
    const inside = (p: V2, a: V2, b: V2, c: V2) => cornerOf(a, b, p) > 1e-12 && cornerOf(b, c, p) > 1e-12 && cornerOf(c, a, p) > 1e-12;
    let guard = 0;
    while (left.length > 3 && guard++ < 10000) {
        let cut = false;
        for (let i = 0; i < left.length; i++) {
            const [ia, ib, ic] = [left[(i + left.length - 1) % left.length]!, left[i]!, left[(i + 1) % left.length]!];
            const [a, b, c] = [polygon[ia]!, polygon[ib]!, polygon[ic]!];
            if (cornerOf(a, b, c) <= 1e-12) continue;
            if (left.some((j) => j !== ia && j !== ib && j !== ic && inside(polygon[j]!, a, b, c))) continue;
            out.push([ia, ib, ic]);
            left.splice(i, 1);
            cut = true;
            break;
        }
        if (!cut) break;
    }
    if (left.length === 3) out.push([left[0]!, left[1]!, left[2]!]);
    return out;
}

/** Faces for a block of track along a Mote piece: its groove, top, sides and underside, and its two ends closed. */
export function blockMesh(piece: { frame(t: number): { p: V3; along: V3; up: V3; across: V3 }; path: Path }, straight: boolean): Mesh {
    const runs = outline();
    const end = piece.path.end;
    const rings = straight ? 2 : Math.max(2, Math.ceil(end / 0.7) + 1);
    const frames = Array.from({ length: rings }, (_, i) => piece.frame((end * i) / (rings - 1)));
    const placeOf = (f: { p: V3; up: V3; across: V3 }, [u, v]: V2): V3 => plus(f.p, plus(scaled(f.across, u), scaled(f.up, v)));
    const points: V3[] = [];
    const faces: number[][] = [];
    for (const run of runs) {
        const first = points.length;
        for (const f of frames) for (const q of run) points.push(placeOf(f, q));
        const n = run.length;
        for (let i = 0; i + 1 < rings; i++) {
            for (let j = 0; j + 1 < n; j++) {
                const [a, b] = [first + i * n + j, first + i * n + j + 1];
                faces.push([a, a + n, b + n, b]);
            }
        }
    }
    // the ends: the outline once round, each corner once
    const ring: V2[] = [];
    for (const run of runs) for (const q of run.slice(0, -1)) ring.push(q);
    const cut = triangles(ring);
    for (const [f, backward] of [[frames[0]!, true], [frames[rings - 1]!, false]] as const) {
        const first = points.length;
        for (const q of ring) points.push(placeOf(f, q));
        for (const [a, b, c] of cut) faces.push(backward ? [first + a, first + b, first + c] : [first + c, first + b, first + a]);
    }
    return { points, faces, smooth: true };
}
