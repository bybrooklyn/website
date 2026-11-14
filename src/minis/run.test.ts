// A run as data is held to what it says: joints are where the piece's place and turn put them; two
// that meet are joined and part when one is moved; a piece snapped to an open joint meets it exactly,
// whichever piece, joint and way; pieces that share a cell at heights that cross overlap, and those a
// block and a marble's room apart do not; and a run written as text reads back the same, piece for
// piece. Run with `bun run test`.

import { expect, test } from "bun:test";
import { BOX, shapeOf, type Kind } from "./pieces";
import { fit, fits, grounded, jointsOf, links, meets, neighbours, open, overlaps, read, snaps, write, type Placed } from "./run";

const kind = (family: Kind["family"], sizes: number[] = [], mirror = false): Kind => ({ family, sizes, mirror });
const straight = (id: number, x: number, z: number, y: number, turn = 0, long = 1): Placed => ({ id, kind: kind("s", [long]), place: { x, z, y, turn } });

test("a piece's joints are where its place and turn put them", () => {
    expect(jointsOf(straight(1, 2, 3, 5)).map((joint) => [joint.at, joint.way])).toEqual([
        [[16, 10, 28], [-1, 0, 0]],
        [[24, 10, 28], [1, 0, 0]],
    ]);
    // a quarter turn about the corner of its first cell: along x becomes along z
    const turned = jointsOf(straight(1, 2, 3, 5, 1));
    expect(turned.map((joint) => joint.at)).toEqual([[12, 10, 24], [12, 10, 32]]);
    expect(turned.map((joint) => joint.way)).toEqual([[0, 0, -1], [0, 0, 1]]);
});

test("two straights end to end are joined, and part when one is moved a cell", () => {
    const run = [straight(1, 0, 0, 3), straight(2, 1, 0, 3)];
    expect(links(run).length).toBe(1);
    expect(neighbours(run, 1)).toEqual([2]);
    expect(open(run).map((joint) => [joint.id, joint.joint])).toEqual([[1, 0], [2, 1]]);
    const apart = [run[0]!, straight(2, 2, 0, 3)];
    expect(links(apart).length).toBe(0);
    expect(open(apart).length).toBe(4);
    // nor at the same place a level apart, nor facing the same way
    expect(links([run[0]!, straight(2, 1, 0, 4)]).length).toBe(0);
    const [a, b] = [jointsOf(run[0]!)[1]!, jointsOf(run[1]!)[0]!];
    expect(meets(a, b)).toBe(true);
    expect(meets(a, { ...b, way: a.way })).toBe(false);
});

test("any piece of the box fitted by any of its joints to an open joint facing any way meets it exactly", () => {
    const ways: [number, number, number][] = [[1, 0, 0], [-1, 0, 0], [0, 0, 1], [0, 0, -1]];
    for (const { kind: piece } of BOX) {
        for (const way of ways) {
            // an open joint in the middle of a cell's edge, facing out across it
            const at: [number, number, number] = way[0] ? [16, 24, 12] : [12, 24, 16];
            const to = { id: 99, joint: 0, at, way, kind: "groove" };
            shapeOf(piece).joints.forEach((_, joint) => {
                const place = fit(piece, joint, to)!;
                expect(place).toBeDefined();
                const mine = jointsOf({ id: 1, kind: piece, place })[joint]!;
                expect(meets(mine, to)).toBe(true);
            });
        }
    }
});

test("a piece snaps to an open end only where it fits: a curve at the end of a straight, both ways, but not into another piece", () => {
    const run = [straight(1, 0, 0, 3)];
    const curve = kind("c", [1, 1]);
    // at each of the straight's two ends, by either of the curve's joints
    expect(snaps(run, curve).length).toBe(4);
    // a block in the cell beyond the straight's far end takes away the two places there
    const blocked = [...run, straight(2, 1, 0, 3, 0)];
    expect(snaps(blocked, curve).every((snap) => snap.to.id !== 2 || snap.to.joint !== 0)).toBe(true);
    // and a piece being carried does not count as being in the way of itself
    expect(snaps(blocked, curve, 2).length).toBe(4);
});

test("pieces in one cell overlap unless a block and a marble's room apart; pieces below the ground do not fit", () => {
    const low = straight(1, 0, 0, 3);
    expect(overlaps([low], straight(2, 0, 0, 3))).toEqual([1]);
    expect(overlaps([low], straight(2, 0, 0, 4))).toEqual([1]);
    expect(overlaps([low], straight(2, 0, 0, 5))).toEqual([]);
    // crossing over it, turned, two levels up
    expect(overlaps([low], straight(2, 1, 0, 5, 1))).toEqual([]);
    expect(grounded(straight(3, 0, 0, 1))).toBe(true);
    expect(grounded(straight(3, 0, 0, 0))).toBe(false);
    expect(fits([low], straight(3, 0, 0, 0))).toBe(false);
});

test("a run written as text reads back the same, piece for piece, for many runs made at random", () => {
    let seed = 7;
    const random = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
    for (let round = 0; round < 200; round++) {
        const run: Placed[] = Array.from({ length: 1 + Math.floor(random() * 12) }, (_, i) => {
            const entry = BOX[Math.floor(random() * BOX.length)]!;
            return { id: i + 1, kind: { ...entry.kind, sizes: [...entry.kind.sizes] }, place: { x: Math.floor(random() * 41) - 20, z: Math.floor(random() * 41) - 20, y: Math.floor(random() * 30), turn: Math.floor(random() * 4) } };
        });
        const text = write(run);
        expect(text).toMatch(/^[A-Za-z0-9._-]+$/);
        expect(read(text)).toEqual(run);
        expect(write(read(text))).toBe(text);
    }
});

test("text that is not a run of this form is not read, and says why", () => {
    expect(() => read("v2_s.1.0.0.3.0")).toThrow("v1");
    expect(() => read("v1_q.1.0.0.3.0")).toThrow("not a piece");
    expect(() => read("v1_s.9.0.0.3.0")).toThrow("not a piece");
    expect(() => read("v1_s.1.0.0.3.8")).toThrow("turned");
    expect(() => read("v1_s.1.0.0.3.x")).toThrow("whole number");
    expect(() => read("v1_c.2.1.0.0.3.0")).toThrow("not a piece");
    expect(read("v1")).toEqual([]);
});
