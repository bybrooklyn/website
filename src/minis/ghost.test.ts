// The ghost marble is held to agreeing with the marks and with the real marbles: on each made run it
// arrives in the tray; off an open end it falls from the piece marked open; on a stretch too level it
// stops, within a piece of where the guess by energy says, and marks the piece; started again it gives the same way to the bit; worked a
// little at a time it gives the same way as all at once; and a real table beside it rolls the same
// whether the ghost runs or not. Run with `bun run test`.

import { expect, test } from "bun:test";
import { checks } from "./checks";
import { ghostMarks, makeGhost } from "./ghost";
import type { Kind } from "./pieces";
import { fit, jointsOf, read, type Placed } from "./run";
import { RUNS } from "./runs";
import { makeTable } from "./table";

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

/** The ghost's way on a run, worked out to its end. */
function followed(run: Placed[]) {
    const ghost = makeGhost();
    ghost.start(run);
    ghost.work(0, 120 * 45);
    expect(ghost.done).toBe(true);
    return ghost.paths;
}

for (const made of RUNS) {
    test(`${made.name}: the ghost arrives in the tray`, () => {
        const [path] = followed(read(made.text));
        expect(path!.ending).toBe("arrived");
        expect(read(made.text).find((piece) => piece.id === path!.last)!.kind.family).toBe("t");
    }, 60_000);
}

test("the ghost ends where a marble does: off an open end, stopped on a stretch too level, thrown off a run too steep, and marks it there", () => {
    // an open end: it falls off the piece whose end is open, which checks.ts marks
    const open = chain(8, [kind("s", [2]), kind("d", [2, 1])]);
    const fell = followed(open);
    expect(fell[0]!.ending).toBe("fell");
    const ends = checks(open).filter((mark) => mark.why === "open");
    expect(ends).toContainEqual({ id: fell[0]!.last!, why: "open", joint: 1 });
    expect(ghostMarks(fell, ends)).toEqual([]);
    // too level: it stops on the fourth straight, as the checks guess it does to within a piece
    const level = chain(5, [kind("s", [6]), kind("s", [6]), kind("s", [6]), kind("s", [6]), kind("t")]);
    const stopped = followed(level);
    expect(stopped[0]!.ending).toBe("stopped");
    expect(ghostMarks(stopped, [])).toEqual([{ id: stopped[0]!.last!, why: "shallow" }]);
    const guessed = checks(level).find((mark) => mark.why === "shallow")!;
    expect(Math.abs(guessed.id - stopped[0]!.last!)).toBeLessThanOrEqual(1);
    // too steep: it is thrown off, the run marked where it leaves the track, not where it lands
    const steep = Array.from({ length: 8 }, () => kind("d", [2, 2]));
    const fast = chain(40, [...steep, kind("c", [1, 1]), kind("s", [1]), kind("t")]);
    const thrown = followed(fast);
    expect(thrown[0]!.ending).toBe("fell");
    const marked = ghostMarks(thrown, []);
    expect(marked.length).toBe(1);
    expect(marked[0]!.why).toBe("fast");
    expect(marked[0]!.id).toBeGreaterThanOrEqual(10);
}, 60_000);

test("the ghost is the same way every time, and the same worked a little at a time as all at once", () => {
    const run = read(RUNS[1]!.text);
    const ghost = makeGhost();
    ghost.start(run);
    ghost.work(0, 120 * 45);
    const once = JSON.stringify(ghost.paths);
    ghost.start(run);
    for (let go = 0; go < 400 && !ghost.done; go++) ghost.work(0, 17);
    expect(JSON.stringify(ghost.paths)).toBe(once);
}, 60_000);

test("a real table rolls the same to the bit whether a ghost runs beside it or not", () => {
    const race = (withGhost: boolean) => {
        const table = makeTable();
        const run = read(RUNS[0]!.text);
        table.set(run);
        const ghost = makeGhost();
        if (withGhost) ghost.start(run);
        for (let step = 0; step < 120 * 4; step++) {
            if (step === 60) table.letGo();
            if (withGhost) ghost.work(0, 3);
            table.step(1 / 120);
        }
        return table.marbles.flatMap((marble) => [...marble.p, ...marble.v]);
    };
    expect(new Float64Array(race(true))).toEqual(new Float64Array(race(false)));
}, 60_000);
