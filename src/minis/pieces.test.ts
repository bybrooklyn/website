// The box of the marble run is held to its grid: every piece's joints sit in the middle of a cell's
// edge at a whole level, pointing out along the ground; its track's ends are exactly at its joints,
// going out the way they face and upright, so that two pieces whose joints meet are one surface to a
// marble; its own lengths meet each other end to end; turned and mirrored, all of that still holds.
// Bent, a piece keeps its joints and its track's ends as made, to their curving, passes through each
// of its points, changes its curve smoothly all along, and is held to its limits. Run with `bun run test`.

import { describe, expect, test } from "bun:test";
import { BOX, CELL, LEVEL, STEEPEST, TIGHTEST, WARN_STEEP, WARN_TIGHT, bendAllowed, blockMesh, brokenBy, isBent, keyOf, made, pathOf, pointsAt, pointsIn, pointsOf, shapeOf, strainOf, sweepOf, toWorld, triangles, warned, wayToWorld, withBend, type Kind, type Place } from "./pieces";
import type { V3 } from "../mote/solids";

const close = (a: V3, b: V3, by = 1e-9) => Math.abs(a[0] - b[0]) <= by && Math.abs(a[1] - b[1]) <= by && Math.abs(a[2] - b[2]) <= by;
const places: Place[] = [0, 1, 2, 3].map((turn) => ({ x: turn - 2, z: 3 - turn, y: 12, turn }));

describe("each piece of the box", () => {
    for (const { name, kind } of BOX) {
        test(`${name}: joints on the grid, track ending exactly at them, turned and mirrored alike`, () => {
            const shape = shapeOf(kind);
            for (const joint of shape.joints) {
                // the middle of a cell's edge: one of x and z a whole number of cells, the other half way
                const [cx, cz] = [joint.at[0] / (CELL / 2), joint.at[2] / (CELL / 2)];
                expect(Number.isInteger(cx) && Number.isInteger(cz)).toBe(true);
                expect((Math.abs(cx) % 2) + (Math.abs(cz) % 2)).toBe(1);
                expect(Number.isInteger(joint.at[1] / LEVEL)).toBe(true);
                // pointing along the row or the column the joint is on, and outward: across the edge it sits on
                expect(Math.abs(joint.way[0]) + Math.abs(joint.way[2])).toBe(1);
                expect(joint.way[1]).toBe(0);
                expect(Math.abs(cx) % 2 === 0 ? joint.way[0] !== 0 : joint.way[2] !== 0).toBe(true);
            }
            for (const place of places) {
                const world = made(shape, place);
                // each joint is at one end of one length of track, which goes out the way the joint faces, upright
                shape.joints.forEach((joint, index) => {
                    const at = toWorld(place, joint.at);
                    const way = wayToWorld(place, joint.way);
                    const ends = world.lengths.flatMap(({ piece, length }) => length.joints.map((which, side) => (which === index ? { frame: piece.ends![side]!, side } : undefined)).filter((one) => one !== undefined));
                    expect(ends.length).toBe(1);
                    const { frame, side } = ends[0]!;
                    expect(close(frame.p, at)).toBe(true);
                    // out of the piece: along the track at its end, back along it at its start
                    expect(close(frame.along, side === 1 ? way : [-way[0], -way[1], -way[2]], 1e-9)).toBe(true);
                    expect(close(frame.up, [0, 1, 0], 1e-9)).toBe(true);
                });
                // a piece made of several lengths has them meet end to end, each going on the way the last went
                // (but for the funnel's chute, which ends over its bowl)
                for (let i = shape.bowl ? 1 : 0; i + 1 < world.lengths.length; i++) {
                    const [a, b] = [world.lengths[i]!.piece.ends![1], world.lengths[i + 1]!.piece.ends![0]];
                    expect(close(a.p, b.p, 1e-9)).toBe(true);
                    expect(close(a.along, b.along, 1e-6)).toBe(true);
                }
            }
        });
    }
});

test("a mirrored piece is the piece reflected: a left curve ends where a right one would, across its row", () => {
    const right = shapeOf({ family: "c", sizes: [1, 1], mirror: false });
    const left = shapeOf({ family: "c", sizes: [1, 1], mirror: true });
    expect(right.joints[1]!.at).toEqual([4, 0, 8]);
    expect(left.joints[1]!.at).toEqual([4, 0, 0]);
    expect(left.joints[1]!.way).toEqual([0, 0, -1]);
    // and the lean of its bank is the other way
    expect(left.lengths[0]!.bank!.map((lean) => 0 - lean)).toEqual(right.lengths[0]!.bank!);
});

test("a straight takes up the cells it runs through, its block below and room for a marble above", () => {
    expect(shapeOf({ family: "s", sizes: [3], mirror: false }).cells).toEqual([
        { x: 0, z: 0, low: -1, high: 1 },
        { x: 1, z: 0, low: -1, high: 1 },
        { x: 2, z: 0, low: -1, high: 1 },
    ]);
});

test("a curve leans into its turn, most in the middle, and not at all at its ends", () => {
    const bank = shapeOf({ family: "c", sizes: [3, 1], mirror: false }).lengths[0]!.bank!;
    expect(bank[0]).toBe(0);
    expect(bank[bank.length - 1]).toBe(0);
    expect(Math.max(...bank)).toBeGreaterThan(0.2);
    expect(Math.min(...bank)).toBeGreaterThanOrEqual(0);
});

test("a polygon with a notch cut in it is cut into triangles that cover it exactly", () => {
    const notched: [number, number][] = [[0, 0], [4, 0], [4, 3], [3, 3], [2, 1], [1, 3], [0, 3]];
    const cut = triangles(notched);
    expect(cut.length).toBe(notched.length - 2);
    const area = (a: number[], b: number[], c: number[]) => Math.abs((b[0]! - a[0]!) * (c[1]! - a[1]!) - (b[1]! - a[1]!) * (c[0]! - a[0]!)) / 2;
    const sum = cut.reduce((total, [a, b, c]) => total + area(notched[a]!, notched[b]!, notched[c]!), 0);
    expect(sum).toBeCloseTo(4 * 3 - 2, 12);
});

test("a block drawn along a curve is closed: every edge of its faces is shared by two faces, once each way", () => {
    const shape = shapeOf({ family: "c", sizes: [1, 1], mirror: false });
    const mesh = blockMesh(sweepOf(shape.lengths[0]!), false);
    // corners where two runs of the outline meet are separate points, so edges are matched by place
    const key = (p: V3) => p.map((value) => Math.round(value * 1e6)).join(" ");
    const edges = new Map<string, number>();
    for (const face of mesh.faces) {
        for (let i = 0; i < face.length; i++) {
            const [a, b] = [key(mesh.points[face[i]!]!), key(mesh.points[face[(i + 1) % face.length]!]!)];
            edges.set(`${a}|${b}`, (edges.get(`${a}|${b}`) ?? 0) + 1);
        }
    }
    for (const [edge, count] of edges) {
        const [a, b] = edge.split("|");
        expect(count).toBe(1);
        expect(edges.get(`${b}|${a}`)).toBe(1);
    }
});

// ---- bending ----

/** Every family that bends, in several sizes, each way round. */
const bendable: Kind[] = ["s1", "s2", "s3", "s6", "c1.1", "c3.1", "c1.2", "c3.2", "d2.1", "d2.2", "d3.2", "z2.1", "z3.1", "z4.2"].flatMap((name) =>
    [false, true].map((mirror): Kind => ({ family: name[0] as Kind["family"], sizes: name.slice(1).split(".").map(Number), mirror })),
);

/** A bend of each point up and aside by different amounts, scaled down until it can be built. */
function someBend(kind: Kind): Kind {
    const n = pointsOf(kind);
    // up and aside together; else up alone, for a tight curve that any move aside makes tighter still
    for (const shape of [Array.from({ length: n }, (_, i) => [i % 2 ? -1 : 1, i === 1 ? 0.5 : -0.7]).flat(), Array.from({ length: n }, (_, i) => [i % 2 ? -0.6 : 1, 0]).flat()]) {
        for (let by = 400; by >= 1; by = Math.floor(by * 0.8)) {
            const bent = withBend(kind, shape.map((value) => value * by));
            if (isBent(bent) && !brokenBy(bent)) return bent;
        }
    }
    throw new Error(`No bend of ${keyOf(kind)} can be built.`);
}

/** A path's point, its way along and its curvature (bend across the way, per centimetre), at t. */
function at(path: ReturnType<typeof pathOf>, t: number) {
    const [p, d, dd] = [path.point(t), path.speed(t), path.bend(t)];
    const speed = Math.hypot(...d);
    const way: V3 = [d[0] / speed, d[1] / speed, d[2] / speed];
    const across = dd.map((value, i) => value / (speed * speed) - way[i]! * ((dd[0] * d[0] + dd[1] * d[1] + dd[2] * d[2]) / speed ** 4)) as V3;
    return { p, way, across };
}

describe("a bent piece", () => {
    for (const kind of bendable) {
        test(`${keyOf(kind)}: its joints, and its track at each end, where, the way and as curved as made; through every point; mirrored, the bent piece reflected`, () => {
            const bent = someBend(kind);
            const [madeShape, bentShape] = [shapeOf(kind), shapeOf(bent)];
            expect(bentShape.joints).toEqual(madeShape.joints);
            const [before, after] = [pathOf(madeShape.lengths[0]!), pathOf(bentShape.lengths[0]!)];
            expect(after.end).toBe(before.end);
            for (const t of [0, before.end]) {
                const [a, b] = [at(before, t), at(after, t)];
                expect(close(a.p, b.p, 1e-12)).toBe(true);
                expect(close(a.way, b.way, 1e-12)).toBe(true);
                expect(close(a.across, b.across, 1e-9)).toBe(true);
            }
            // the track's line passes through each point, in the world as in its own place
            const place: Place = { x: 3, z: -2, y: 9, turn: 3 };
            const world = pathOf(made(bentShape, place).lengths[0]!.length);
            pointsIn(bent, place).forEach((point, i) => {
                expect(close(world.point(pointsAt(pointsOf(kind))[i]! * world.end), point.at, 1e-9)).toBe(true);
            });
            // mirrored, it is the same bent piece reflected across the row of its first joint
            const other = pathOf(shapeOf({ ...bent, mirror: !bent.mirror }).lengths[0]!);
            for (let i = 0; i <= 20; i++) {
                const [p, q] = [after.point((after.end * i) / 20), other.point((other.end * i) / 20)];
                expect(close(p, [q[0], q[1], CELL - q[2]], 1e-9)).toBe(true);
            }
        });
    }

    test("is smooth all along: its curve's bend changes by little from one tenth of a millimetre to the next, nowhere jumping", () => {
        for (const kind of bendable.filter((one) => !one.mirror)) {
            const path = pathOf(shapeOf(someBend(kind)).lengths[0]!);
            const count = Math.ceil(path.end / 0.01);
            let [most, jump] = [0, 0];
            let last = at(path, 0).across;
            for (let i = 1; i <= count; i++) {
                const now = at(path, (path.end * i) / count).across;
                most = Math.max(most, Math.hypot(...now));
                jump = Math.max(jump, Math.hypot(now[0] - last[0], now[1] - last[1], now[2] - last[2]));
                last = now;
            }
            // a curvature of at most most, changing smoothly: never more than a few hundredths of it per step
            expect(jump).toBeLessThan(most * 0.03 + 1e-9);
        }
    });

    test("bent by naught is the piece as made, with the same key and the same shape", () => {
        const kind: Kind = { family: "s", sizes: [2], mirror: false };
        expect(keyOf(withBend(kind, [0, 0, 0, 0]))).toBe(keyOf(kind));
        expect(shapeOf(withBend(kind, [0, -0, 0, 0]))).toBe(shapeOf(kind));
        expect(isBent(withBend(kind, [0, 0, 0, 3]))).toBe(true);
        expect(keyOf(withBend(kind, [0, 0, 0, 3]))).not.toBe(keyOf(kind));
    });

    test("has two whole numbers for each of its points, and only a family that bends has any", () => {
        expect(bendAllowed({ family: "s", sizes: [2], mirror: false, bend: [1, 2, 3, 4] })).toBe(true);
        expect(bendAllowed({ family: "s", sizes: [2], mirror: false, bend: [1, 2] })).toBe(false);
        expect(bendAllowed({ family: "s", sizes: [2], mirror: false, bend: [1, 2, 3, 4.5] })).toBe(false);
        expect(bendAllowed({ family: "t", sizes: [], mirror: false, bend: [1, 2] })).toBe(false);
        expect(pointsOf({ family: "h", sizes: [] })).toBe(0);
        expect([1, 2, 3, 6].map((long) => pointsOf({ family: "s", sizes: [long] }))).toEqual([1, 2, 2, 3]);
    });

    test("is held to its limits: too tight, too steep, crossing itself; near a limit it is warned of first", () => {
        const long: Kind = { family: "s", sizes: [3], mirror: false };
        // a bow up of 9 cm on 24 cm is too tight; of 3 cm it can be built
        expect(brokenBy(withBend(long, [90, 0, 90, 0]))).toBe("tight");
        expect(brokenBy(withBend(long, [30, 0, 30, 0]))).toBeUndefined();
        expect(strainOf(withBend(long, [90, 0, 90, 0])).tight).toBeLessThan(TIGHTEST);
        // a slope of six levels over two cells, pushed further down at its first point, is steeper than a groove holds
        const steep = withBend({ family: "d", sizes: [2, 6], mirror: false }, [18, 0, 8, 0]);
        expect(strainOf(steep).steep).toBeGreaterThan(STEEPEST);
        expect(strainOf(steep).tight).toBeGreaterThanOrEqual(TIGHTEST);
        expect(brokenBy(steep)).toBe("steep");
        // pushed far aside and down, a short piece folds back across itself
        expect(strainOf(withBend({ family: "s", sizes: [1], mirror: false }, [-200, -200])).crossed).toBe(true);
        expect(brokenBy(withBend({ family: "s", sizes: [1], mirror: false }, [-200, -200]))).toBe("crossed");
        // a piece made steeper than the limit may be bent, but no steeper than it was made
        const made = strainOf({ family: "d", sizes: [1, 8], mirror: false });
        expect(made.steep).toBeGreaterThan(STEEPEST);
        // warned before the limit: a bow that leaves its tightest radius between the limit and the warning
        let warnedFirst = false;
        for (let up = 1; up <= 80; up++) {
            const one = withBend(long, [up, 0, up, 0]);
            if (brokenBy(one)) break;
            if (warned(one)) warnedFirst = true;
            if (warned(one)) expect(strainOf(one).tight < WARN_TIGHT || strainOf(one).steep > WARN_STEEP).toBe(true);
        }
        expect(warnedFirst).toBe(true);
        expect(warned(withBend(long, [5, 0, 5, 0]))).toBe(false);
    });

    test("bent down stands lower: a dip below its joints is below where the piece as made stood", () => {
        const kind: Kind = { family: "s", sizes: [3], mirror: false };
        expect(shapeOf(kind).low).toBe(-1);
        expect(shapeOf(withBend(kind, [-30, 0, -30, 0])).low).toBe(-3);
    });
});
