// Tests for the runs to start from: every one listed opens with a spot; the race, the tall bent run and the
// run with every moving and sounding piece carry a marble let go every two and a half seconds for ten
// minutes of stepped time to their trays, none lost, none on the cloth, none stuck, and in the last a
// hundred marbles and more meet each of those ten pieces; the race through a funnel gives a race worth
// watching.

import { expect, test } from "bun:test";
import { runRace, standing } from "./race";
import { isPart } from "./parts";
import { read } from "./run";
import { RUNS } from "./runs";
import { makeTable } from "./table";

test("every run offered to start from opens with a camera spot", () => {
    for (const made of RUNS.filter((one) => one.listed !== false)) expect({ name: made.name, spot: Boolean(made.spot) }).toEqual({ name: made.name, spot: true });
});

for (const name of ["a race through a funnel", "a tall bent run", "every moving and sounding piece"]) {
    test(`${name} carries every marble to its tray for ten minutes, none lost, none on the cloth, none stuck`, () => {
        const table = makeTable();
        const run = read(RUNS.find((one) => one.name === name)!.text);
        table.set(run);
        // the marbles each piece has had on it, looked at every twentieth of a second
        const met = new Map<number, Set<object>>(run.filter((piece) => isPart(piece.kind.family)).map((piece) => [piece.id, new Set()]));
        let [lost, made, wait, emptied, emptying] = [0, 0, 0, 0, false];
        table.gone = (marble) => {
            if (!emptying && !table.arrived(marble)) lost++;
        };
        for (let step = 0; step < 10 * 60 * 120; step++) {
            wait -= 1 / 120;
            if (wait <= 0 && table.letGo().length) [made, wait] = [made + 1, 2.5];
            table.step(1 / 120);
            if (step % 6 === 0) for (const marble of table.marbles) met.get(table.pieceAt(marble.p) ?? 0)?.add(marble);
            // every ten seconds the tray is emptied of marbles at rest in it, as a person would
            if (step % 1200 !== 0) continue;
            emptying = true;
            for (const marble of [...table.marbles]) {
                if (!marble.rest || !table.arrived(marble)) continue;
                table.space.remove(marble);
                table.marbles.splice(table.marbles.indexOf(marble), 1);
                emptied++;
            }
            emptying = false;
        }
        expect(made).toBe(240);
        expect(lost).toBe(0);
        expect(table.marbles.filter((marble) => marble.p[1] < 1.05).length).toBe(0);
        expect(table.marbles.filter((marble) => marble.rest && !table.arrived(marble)).length).toBe(0);
        expect(emptied).toBeGreaterThan(215);
        for (const [id, marbles] of met) expect({ piece: run.find((piece) => piece.id === id)!.kind.family, many: marbles.size > 100 }).toEqual({ piece: run.find((piece) => piece.id === id)!.kind.family, many: true });
    }, 120_000);
}

test("the race through a funnel mixes its marbles: eight finish, and no two within a hundredth", () => {
    const table = makeTable();
    table.set(read(RUNS.find((one) => one.name === "a race through a funnel")!.text));
    const placed = standing(runRace(table, 8));
    expect(placed.every((one) => one.time !== undefined)).toBe(true);
    expect(placed.some((one) => one.close)).toBe(false);
    expect(new Set(placed.map((one) => one.time!.toFixed(1))).size).toBeGreaterThan(5);
});
