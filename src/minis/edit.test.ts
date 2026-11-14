// The marble run's editing is held to what it says: a group turned about a corner keeps its joints
// joined and comes back after four turns; a group mirrored is exactly the reflection of what it was,
// joint for joint and box for box, and mirrored twice is itself; a group fitted by any open joint
// meets the joint it is fitted to; a straight's end dragged makes it longer by whole cells; a run read
// back keeps the numbers of the pieces it shares with the run before. Run with `bun run test`.

import { expect, test } from "bun:test";
import { BOX, CELL, boxToWorld, shapeOf, type Kind } from "./pieces";
import { about, asOwn, groupFits, groupSnaps, joinedTo, matched, middleOf, mirrored, mirrorLine, moved, pivotOf, resized, then } from "./edit";
import { jointsOf, links, meets, open, read, write, type Placed } from "./run";
import { RUNS } from "./runs";
import type { V3 } from "../mote/solids";

const kind = (family: Kind["family"], sizes: number[] = [], mirror = false): Kind => ({ family, sizes, mirror });
const run = read(RUNS[2]!.text);
/** Rounded to a thousandth, so that points worked out two ways compare equal. */
const round = (p: V3): string => p.map((value) => (Math.round(value * 1000) / 1000 + 0).toFixed(3)).join(" ");

test("the stretch a piece is part of is everything joined to it, and nothing else", () => {
    expect(joinedTo(run, 5).length).toBe(run.length);
    const apart = [...run, { id: 99, kind: kind("s", [1]), place: { x: 15, z: 15, y: 1, turn: 0 } }];
    expect(joinedTo(apart, 99)).toEqual([99]);
    expect(joinedTo(apart, 1).length).toBe(run.length);
});

test("a group turned about a corner keeps its joints joined, and four turns bring it back", () => {
    const group = run.slice(3, 9);
    const inside = links(group).length;
    let turned = group;
    const pivot = pivotOf(group);
    for (let i = 0; i < 4; i++) {
        turned = turned.map((piece) => moved(piece, about(pivot, 1)));
        expect(links(turned).length).toBe(inside);
    }
    expect(write(turned)).toBe(write(group));
    // moves one after another are the same as the two as one
    const [a, b] = [about([2, -1], 1), { turn: 3, x: 4, z: -2, y: 1 }];
    for (const piece of group) expect(moved(moved(piece, a), b).place).toEqual(moved(piece, then(a, b)).place);
});

test("a group mirrored is the reflection of what it was, joint for joint and box for box, and twice is itself", () => {
    const group = read(RUNS[1]!.text);
    for (const across of ["x", "z"] as const) {
        for (const twice of [-3, 0, 5]) {
            const flipped = mirrored(group, across, twice);
            const line = (twice * CELL) / 2;
            const reflect = (p: V3): V3 => (across === "x" ? [2 * line - p[0], p[1], p[2]] : [p[0], p[1], 2 * line - p[2]]);
            group.forEach((piece, i) => {
                const after = flipped[i]!;
                expect(jointsOf(after).map((joint) => round(joint.at)).sort()).toEqual(jointsOf(piece).map((joint) => round(reflect(joint.at))).sort());
                const boxes = (one: Placed) => shapeOf(one.kind).room.map((box) => boxToWorld(one.place, box));
                expect(boxes(after).map((box) => round(box.at)).sort()).toEqual(boxes(piece).map((box) => round(reflect(box.at))).sort());
            });
            expect(links(flipped).length).toBe(links(group).length);
            expect(write(mirrored(flipped, across, twice))).toBe(write(group));
        }
    }
});

test("left becomes right: a curve, an S bend, a spiral and a funnel mirror to their other forms; a straight stays a straight", () => {
    const pieces: Placed[] = ["c1_1_", "z2_1_", "x2_6_", "f", "s2_"].map((name, i) => read(`v1.${name}${i * 4}_0_12_0`)[0]!);
    const flipped = mirrored(pieces, "x", 0);
    expect(flipped.map((piece) => piece.kind.mirror)).toEqual([true, true, true, true, false]);
});

test("a stretch joined to the rest at one joint is mirrored across the line through that joint, and stays joined there", () => {
    const ids = run.slice(-4).map((piece) => piece.id);
    const line = mirrorLine(run, ids, 0.7);
    const flipped = mirrored(run.filter((piece) => ids.includes(piece.id)), line.across, line.twice);
    const after = run.map((piece) => flipped.find((one) => one.id === piece.id) ?? piece);
    expect(links(after).length).toBe(links(run).length);
    // a stretch joined by none is mirrored where it stands, as the view sees left and right
    const alone = mirrorLine(run, run.map((piece) => piece.id), 0);
    expect(alone.across).toBe("x");
    expect(Math.abs(alone.twice * (CELL / 2) - middleOf(run)[0])).toBeLessThanOrEqual(CELL / 4);
    expect(mirrorLine(run, run.map((piece) => piece.id), Math.PI / 2).across).toBe("z");
});

test("a group fitted by any of its open joints meets the joint it is fitted to, and fits there", () => {
    const base = read("v1.h0_0_8_0.s2_0_1_8_2");
    const group = read(RUNS[0]!.text).slice(2, 5).map((piece, i) => ({ ...piece, id: 10 + i }));
    const found = groupSnaps(base, group);
    expect(found.length).toBeGreaterThan(0);
    for (const snap of found) {
        const placed = group.map((piece) => moved(piece, snap.move));
        expect(groupFits(base, placed)).toBe(true);
        const mine = jointsOf(placed.find((piece) => piece.id === snap.joint.id)!)[snap.joint.joint]!;
        expect(meets(mine, snap.to)).toBe(true);
    }
    // by either end
    expect(new Set(found.map((snap) => `${snap.joint.id} ${snap.joint.joint}`)).size).toBe(2);
});

test("a straight dragged by its end grows and shrinks by whole cells; a slope by cells and levels; a curve between tight and wide", () => {
    const straight = kind("s", [1]);
    expect(resized(straight, [3 * CELL + 2, 0, 4]).sizes).toEqual([3]);
    expect(resized(straight, [-40, 0, 4]).sizes).toEqual([1]);
    expect(resized(straight, [400, 0, 4]).sizes).toEqual([6]);
    expect(resized(kind("d", [2, 1]), [4 * CELL, -6, 4]).sizes).toEqual([4, 3]);
    expect(resized(kind("c", [1, 1]), [12, 0, 16]).sizes).toEqual([3, 1]);
    expect(resized(kind("c", [3, 1], true), [4, 0, -4]).sizes).toEqual([1, 1]);
    // the first joint never moves, so a piece joined by it stays joined
    for (const entry of BOX) expect(shapeOf(resized(entry.kind, [50, -10, 30])).joints[0]!.at).toEqual([0, 0, 4]);
    // a hopper has no size
    expect(resized(kind("h"), [50, 0, 4])).toEqual(kind("h"));
});

test("a piece of one's own is kept with its middle at the corner and its lowest part on the ground", () => {
    const group = run.slice(4, 9);
    const own = read(asOwn(group));
    expect(own.length).toBe(5);
    expect(Math.min(...own.map((piece) => piece.place.y + shapeOf(piece.kind).low))).toBe(0);
    expect(pivotOf(own)).toEqual([0, 0]);
    expect(links(own).length).toBe(links(group).length);
    expect(open(own).length).toBe(2);
});

test("a run read back keeps the numbers of the pieces it shares with the run before, and gives the rest new ones", () => {
    const before = run.map((piece, i) => ({ ...piece, id: 100 + i }));
    const text = write([...run.slice(0, 5), ...run.slice(6), { id: 0, kind: kind("s", [1]), place: { x: 15, z: 15, y: 1, turn: 0 } }]);
    const { run: after, next } = matched(before, text, 500);
    expect(write(after)).toBe(text);
    expect(after.slice(0, 5).map((piece) => piece.id)).toEqual([100, 101, 102, 103, 104]);
    expect(after.at(-2)!.id).toBe(100 + run.length - 1);
    expect(after.at(-1)!.id).toBe(500);
    expect(next).toBe(501);
});
