// The checks made while a run is built are held to what they say: an open end is marked unless it is
// a tray's; a run too level for a marble to keep rolling is marked where it stops; a turn come at faster
// than a turn holds a marble is marked; the made runs have nothing marked; and the speeds the checks
// guess along a run are near what a marble on it does. Run with `bun run test`.

import { expect, test } from "bun:test";
import { checks, speeds } from "./checks";
import { RUNS } from "./runs";
import { fit, jointsOf, read, type Placed } from "./run";
import { makeTable } from "./table";
import type { Kind } from "./pieces";

const kind = (family: Kind["family"], sizes: number[] = [], mirror = false): Kind => ({ family, sizes, mirror });

/** A run made by joining each piece's first joint to the last piece's other end, from a hopper at a level. */
function chain(level: number, kinds: Kind[]): Placed[] {
    const run: Placed[] = [{ id: 1, kind: kind("h"), place: { x: 0, z: 0, y: level, turn: 0 } }];
    let end = jointsOf(run[0]!)[0]!;
    kinds.forEach((one, i) => {
        const piece = { id: i + 2, kind: one, place: fit(one, 0, end)! };
        run.push(piece);
        end = jointsOf(piece)[1] ?? end;
    });
    return run;
}

test("an open end is marked, but not a tray's", () => {
    expect(checks(read("v1.s1_0_0_3_0"))).toEqual([
        { id: 1, why: "open", joint: 0 },
        { id: 1, why: "open", joint: 1 },
    ]);
    expect(checks(chain(5, [kind("s", [1]), kind("t")]))).toEqual([]);
    expect(checks(chain(5, [kind("s", [1])]))).toEqual([{ id: 2, why: "open", joint: 1 }]);
});

test("a run too level to keep a marble rolling is marked where the marble stops, and nothing after it", () => {
    const run = chain(5, [kind("s", [6]), kind("s", [6]), kind("s", [6]), kind("s", [6]), kind("t")]);
    const marks = checks(run);
    expect(marks.length).toBe(1);
    expect(marks[0]!.why).toBe("shallow");
    // a marble from the hopper at about 40 cm/s stops within a metre and a half
    expect([3, 4]).toContain(marks[0]!.id);
});

test("a tight turn after a long drop is marked as taken too fast; after a short one it is not", () => {
    const steep = Array.from({ length: 8 }, () => kind("d", [2, 2]));
    const fast = checks(chain(40, [...steep, kind("c", [1, 1]), kind("s", [1]), kind("t")]));
    expect(fast).toContainEqual({ id: 10, why: "fast" });
    expect(checks(chain(10, [kind("d", [2, 2]), kind("c", [1, 1]), kind("s", [1]), kind("t")]))).toEqual([]);
});

for (const made of RUNS) {
    test(`${made.name}: nothing is marked`, () => {
        expect(checks(read(made.text))).toEqual([]);
    });
}

test("the speeds guessed along a made run are near what a marble on it does, at every joint it passes", () => {
    const run = read(RUNS[1]!.text);
    const guessed = speeds(run);
    const table = makeTable();
    table.set(run);
    const joints = run.flatMap(jointsOf);
    const seen = new Map<string, number>();
    let gone = false;
    for (let step = 0; step < 30 * 120; step++) {
        if (!gone && table.letGo().length) gone = true;
        table.step(1 / 120);
        const marble = table.marbles[0];
        if (!marble) continue;
        for (const joint of joints) {
            const key = `${joint.id} ${joint.joint}`;
            // the marble's middle sits 0.7 below the line the track is made along
            if (!seen.has(key) && Math.hypot(marble.p[0] - joint.at[0], marble.p[1] + 0.7 - joint.at[1], marble.p[2] - joint.at[2]) < 1.2) seen.set(key, Math.hypot(...marble.v));
        }
    }
    expect(seen.size).toBeGreaterThan(15);
    for (const [key, speed] of seen) {
        const guess = guessed.get(key)!;
        expect(guess).toBeDefined();
        expect(Math.abs(guess - speed)).toBeLessThan(0.35 * speed + 15);
    }
}, 60_000);
