// The marble run's editing is held to what it says: a group turned about a corner keeps its joints
// joined and comes back after four turns; a group mirrored is exactly the reflection of what it was,
// joint for joint and box for box, bent ones point for point and along their track, and mirrored twice
// is itself; a group fitted by any open joint meets the joint it is fitted to; a straight's end dragged
// makes it longer by whole cells, a bent one staying bent where it can; a run read back keeps the
// numbers of the pieces it shares with the run before, bend and all. Run with `bun run test`.

import { expect, test } from "bun:test";
import { BOX, CELL, boxToWorld, brokenBy, made, pathOf, pointsIn, shapeOf, withBend, type Kind } from "./pieces";
import { about, asOwn, groupFits, groupSnaps, joinedTo, matched, middleOf, mirrored, mirrorLine, moved, pivotOf, rebent, resized, then } from "./edit";
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

test("a bent group mirrored is the reflection of what it was, point for point and along every track, and twice is itself", () => {
    // a straight and a slope, which stay unmirrored, and a curve and an S bend, which become their other forms
    const group = read("v2.s3_0_0_10_0b20_15_-10_-25.d2_1_3_0_10_1b8_6_-4_9.c3_1_-2_2_12_2b12_-8_-6_10.z3_1_-6_-3_12_3b10_-6_14_8");
    for (const across of ["x", "z"] as const) {
        for (const twice of [-3, 4]) {
            const flipped = mirrored(group, across, twice);
            const line = (twice * CELL) / 2;
            const reflect = (p: V3): V3 => (across === "x" ? [2 * line - p[0], p[1], p[2]] : [p[0], p[1], 2 * line - p[2]]);
            group.forEach((piece, i) => {
                const after = flipped[i]!;
                expect(after.kind.bend).toBeDefined();
                // each point where the reflection of the point was, the plain ones by a bend reflected
                expect(pointsIn(after.kind, after.place).map((point) => round(point.at)).sort()).toEqual(pointsIn(piece.kind, piece.place).map((point) => round(reflect(point.at))).sort());
                // and the track, every centimetre, the track reflected
                const track = (one: Placed) => {
                    const path = pathOf(made(shapeOf(one.kind), one.place).lengths[0]!.length);
                    return Array.from({ length: 41 }, (_, k) => round(path.point((path.end * k) / 40)));
                };
                const before = pathOf(made(shapeOf(piece.kind), piece.place).lengths[0]!.length);
                expect(track(after).sort()).toEqual(Array.from({ length: 41 }, (_, k) => round(reflect(before.point((before.end * k) / 40)))).sort());
            });
            expect(write(mirrored(flipped, across, twice))).toBe(write(group));
        }
    }
});

test("a bent piece made longer stays bent where it can, read at its new points from the old; where it cannot, it is made straight", () => {
    const bowed = withBend(kind("s", [2]), [20, 0, 20, 0]);
    const longer = resized(bowed, [32, 0, 4]);
    expect(longer.sizes).toEqual([4]);
    // three points now, at a quarter, a half and three quarters: a bow still, highest in the middle
    expect(longer.bend!.length).toBe(6);
    expect(longer.bend![2]).toBeGreaterThanOrEqual(longer.bend![0]!);
    expect(brokenBy(longer)).toBeUndefined();
    // dragged to where it already is, it keeps its bend exactly
    expect(resized(bowed, [16, 0, 4])).toBe(bowed);
    // a bow of 28 mm on two cells cannot be built on one: the piece of one cell is as made
    const short = resized(withBend(kind("s", [2]), [28, 0, 28, 0]), [8, 0, 4]);
    expect(short.sizes).toEqual([1]);
    expect(short.bend).toBeUndefined();
    expect(rebent(bowed, kind("s", [2]))).toEqual(bowed);
});

test("bends are kept by pieces of one's own, and a run read back keeps the number of a piece only if its bend is the same", () => {
    const group = read("v2.s2_0_0_6_0b10_5_-10_5.s1_2_0_6_0");
    expect(read(asOwn(group))[0]!.kind.bend).toEqual([10, 5, -10, 5]);
    const before = group.map((piece, i) => ({ ...piece, id: 40 + i }));
    const same = matched(before, write(group), 90);
    expect(same.run.map((piece) => piece.id)).toEqual([40, 41]);
    const rebentRun = matched(before, "v2.s2_0_0_6_0b10_5_-10_6.s1_2_0_6_0", 90);
    expect(rebentRun.run.map((piece) => piece.id)).toEqual([90, 41]);
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
