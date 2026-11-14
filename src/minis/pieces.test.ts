// The box of the marble run is held to its grid: every piece's joints sit in the middle of a cell's
// edge at a whole level, pointing out along the ground; its track's ends are exactly at its joints,
// going out the way they face and upright, so that two pieces whose joints meet are one surface to a
// marble; its own lengths meet each other end to end; turned and mirrored, all of that still holds.
// Run with `bun run test`.

import { describe, expect, test } from "bun:test";
import { BOX, CELL, LEVEL, blockMesh, made, shapeOf, sweepOf, toWorld, triangles, wayToWorld, type Place } from "./pieces";
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
