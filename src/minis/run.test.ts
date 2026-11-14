// A run as data is held to what it says: joints are where the piece's place and turn put them; two
// that meet are joined and part when one is moved; a piece snapped to an open joint meets it exactly,
// whichever piece, joint and way; pieces that share a cell at heights that cross overlap, and those a
// block and a marble's room apart do not, nor a bent piece whose room is clear of another's; and a run
// written as text reads back the same, piece for piece and bend for bend, the form before too. Run
// with `bun run test`.

import { expect, test } from "bun:test";
import { BOX, pointsOf, shapeOf, withBend, type Kind } from "./pieces";
import { RUNS } from "./runs";
import { TABLE, cellsOf, fit, fits, grounded, jointsOf, links, meets, neighbours, open, overlaps, read, snaps, upgraded, write, type Placed } from "./run";

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
            // half the pieces that bend are bent, by any whole millimetres the text allows
            const points = pointsOf(entry.kind);
            const bend = points && random() < 0.5 ? Array.from({ length: 2 * points }, () => Math.floor(random() * 401) - 200) : undefined;
            return { id: i + 1, kind: withBend(entry.kind, bend), place: { x: Math.floor(random() * 41) - 20, z: Math.floor(random() * 41) - 20, y: Math.floor(random() * 30), turn: Math.floor(random() * 4) } };
        });
        const text = write(run);
        expect(text).toMatch(/^[A-Za-z0-9._-]+$/);
        // and nothing in it reads as an address: no four numbers in a row with dots between
        expect(text).not.toMatch(/\d+\.\d+\.\d+\.\d+/);
        expect(read(text)).toEqual(run);
        expect(write(read(text))).toBe(text);
    }
});

test("text that is not a run of this form is not read, and says why", () => {
    expect(() => read("v3.s1_0_0_3_0")).toThrow("v2 or v1");
    expect(() => read("v1.q1_0_0_3_0")).toThrow("not a piece");
    expect(() => read("v1.s9_0_0_3_0")).toThrow("not a piece");
    expect(() => read("v1.s1_0_0_3_8")).toThrow("turned");
    expect(() => read("v1.s1_0_0_3_x")).toThrow("whole number");
    expect(() => read("v1.c2_1_0_0_3_0")).toThrow("not a piece");
    expect(read("v1")).toEqual([]);
    expect(read("v2")).toEqual([]);
    // a bend only in the new form, only on a piece that bends, two numbers a point
    expect(() => read("v1.s1_0_0_3_0b5_5")).toThrow("bend");
    expect(() => read("v2.t0_0_3_0b5_5")).toThrow("bent");
    expect(() => read("v2.s1_0_0_3_0b5")).toThrow("bent");
    expect(() => read("v2.s1_0_0_3_0b5_5b1_1")).toThrow("bend");
    expect(() => read("v2.s1_0_0_3_0b5_x")).toThrow("whole number");
});

test("every run of the form before, v1, is read as it was, and written again in the new form says the same", () => {
    for (const made of RUNS) {
        expect(made.text.startsWith("v1.")).toBe(true);
        const run = read(made.text);
        expect(write(run)).toBe(`v2${made.text.slice(2)}`);
        expect(upgraded(made.text)).toBe(write(run));
        expect(read(upgraded(made.text))).toEqual(run);
    }
    expect(upgraded("v2.s1_0_0_3_0b5_5")).toBe("v2.s1_0_0_3_0b5_5");
    expect(upgraded("not a run")).toBe("not a run");
    // bent by naught is written as not bent at all
    expect(write(read("v2.s1_0_0_3_0b0_0"))).toBe("v2.s1_0_0_3_0");
});

test("a bent piece overlaps another only where their room crosses: one bowed a little into the next row is clear of a straight along it, one bowed further is not; bent below the ground it does not fit", () => {
    const along = straight(1, 0, 1, 4, 0, 3);
    const bowed = (by: number): Placed => ({ id: 2, kind: withBend({ family: "s", sizes: [3], mirror: false }, [0, by, 0, by]), place: { x: 0, z: 0, y: 4, turn: 0 } });
    // the bowed piece strays into the next row's cells, but its block is clear of the straight's
    expect(cellsOf(bowed(25)).some((cell) => cell.z === 1)).toBe(true);
    expect(overlaps([along], bowed(25))).toEqual([]);
    expect(overlaps([along], bowed(45))).toEqual([1]);
    // as made, sharing a cell at heights that cross is an overlap, as before
    expect(overlaps([along], straight(2, 0, 1, 4))).toEqual([1]);
    // bowed down 3 cm, a piece at level 1 would go below the ground
    const dipped: Placed = { id: 3, kind: withBend({ family: "s", sizes: [3], mirror: false }, [-30, 0, -30, 0]), place: { x: 0, z: 0, y: 1, turn: 0 } };
    expect(grounded(dipped)).toBe(false);
    expect(fits([], { ...dipped, place: { ...dipped.place, y: 3 } })).toBe(true);
    // and at the table's edge, bowed out over it, it does not fit
    const edge: Placed = { id: 4, kind: withBend({ family: "s", sizes: [3], mirror: false }, [0, 45, 0, 45]), place: { x: 0, z: TABLE - 1, y: 4, turn: 0 } };
    expect(fits([], { ...edge, kind: withBend(edge.kind) })).toBe(true);
    expect(fits([], edge)).toBe(false);
});
