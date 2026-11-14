// The marble run's moving and sounding pieces, held to what they are for, by arithmetic where there is
// some: a seesaw tips when the marbles in it turn it harder than its counterweights, so at exactly the
// count it is set to, and rests or tips by 3% either side of the balance; a switch alternates exactly,
// left, right, left, right, however fast the marbles come; a trapdoor holds one marble and opens under
// two; a lift keeps its period and carries up to three marbles a trip at its stated speed; a hoist's
// paddles go round at their speed and carry every marble; a spinner turns when struck and comes to
// rest; a gate swings open for a marble and shuts behind it, and stops one coming the other way; a chime
// bar, a bell and a drum are each struck once hard by each marble, the bar at its note; the made runs
// do what they are made for; the ghost runs on from where the real table's parts are; and it is all the
// same to the bit, run twice and in Chromium as in Bun. Run with `bun run test`.

import { expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { browser, chromium } from "../../scripts/browser";
import { makeGhost } from "./ghost";
import { HOIST, LIFT, NOTES, SEESAW, counterweight, designPart, seesawArms, seesawOwn, type Moving } from "./parts";
import { boxToWorld, shapeOf, type Kind } from "./pieces";
import { fit, jointsOf, read, type Placed } from "./run";
import { RUNS } from "./runs";
import { chainAt, chainLength, liftAt, liftPeriod, makeTable, type Table } from "./table";
import type { Solid } from "../mote/space";

const kind = (family: Kind["family"], sizes: number[] = []): Kind => ({ family, sizes, mirror: false });
const MASS = (4 / 3) * Math.PI * 0.8 ** 3 * 2.5;

/**
 * A run from a hopper at a level: each piece's first joint joined to an open joint of the piece before
 * (its last, unless `on` names another of its joints), so that a switch's two ways can each be followed.
 */
function chain(level: number, steps: (Kind | { kind: Kind; to: number; on: number })[]): Placed[] {
    const run: Placed[] = [{ id: 1, kind: kind("h"), place: { x: 0, z: 0, y: level, turn: 0 } }];
    for (const step of steps) {
        const [one, to, on] = "family" in step ? [step, run.at(-1)!.id, -1] : [step.kind, step.to, step.on];
        const joints = jointsOf(run.find((piece) => piece.id === to)!);
        run.push({ id: run.length + 1, kind: one, place: fit(one, 0, joints.at(on)!)! });
    }
    return run;
}

/** Steps a table for `seconds`, letting a marble go every `every` seconds until `count` have gone, and calling `look` after every step. */
function roll(table: Table, count: number, every: number, seconds: number, look: (step: number) => void = () => {}): void {
    let [made, wait] = [0, 0];
    for (let step = 0; step < seconds * 120; step++) {
        wait -= 1 / 120;
        if (made < count && wait <= 0 && table.letGo().length) [made, wait] = [made + 1, every];
        table.step(1 / 120);
        look(step);
    }
}

/** The hinge of a piece in a table, by the piece's number. */
const hingeOf = (table: Table, id: number) => table.space.solids.find((solid) => solid.hinge && table.hingeOf(solid.hinge) === id)!.hinge!;

/** How many marbles are in the trays of a table now. */
const inTrays = (table: Table) => table.marbles.filter(table.arrived).length;

/** The tray of a run a marble lies in, if any, by the box a marble is in once it has arrived. */
function trayOf(run: Placed[], marble: Solid): number | undefined {
    for (const piece of run) {
        const catches = shapeOf(piece.kind).catches;
        if (!catches) continue;
        const box = boxToWorld(piece.place, catches);
        if ([0, 1, 2].every((axis) => Math.abs(marble.p[axis]! - box.at[axis]!) < box.half[axis]!)) return piece.id;
    }
    return undefined;
}

test("a seesaw's counterweights turn it, at its resting tilt, half way between the marbles that one fewer than its count and its count would", () => {
    for (let count = 1; count <= 4; count++) {
        const moving = designPart("e", [count]).moving as Extract<Moving, { kind: "hinge" }>;
        // each body's weight times how far its middle is out from the pivot once the tray is tilted to rest; the weights pull the other way
        const [c, k] = [Math.cos(SEESAW.rest), Math.sin(SEESAW.rest)];
        const turning = moving.bodies.reduce((sum, body) => sum + body.half[0] * body.half[1] * body.half[2] * 8 * body.density * ((body.at[0] - SEESAW.pivot[0]) * c - (body.at[1] - SEESAW.pivot[1]) * k), 0);
        const arms = seesawArms();
        expect(arms).toEqual([7.2, 5.6, 4, 2.4].map((arm) => expect.closeTo(arm, 9)));
        const marbles = (n: number) => arms.slice(0, n).reduce((sum, arm) => sum + arm * MASS, 0);
        expect(turning + (marbles(count - 1) + marbles(count)) / 2).toBeCloseTo(0, 6);
        expect(counterweight(count)).toBeGreaterThan(0);
    }
    // the tray itself is all but balanced on its pivot: under a tenth of what one marble at the wall turns it by
    expect(Math.abs(seesawOwn())).toBeLessThan(0.1 * MASS * seesawArms()[0]!);
});

test("a seesaw set to hold n marbles tips when the n-th comes to rest in it, and never before, for every n", () => {
    for (let count = 1; count <= 4; count++) {
        const run = chain(18, [kind("s", [2]), kind("e", [count]), kind("d", [1, 1]), kind("t")]);
        const table = makeTable();
        table.set(run);
        const seen: number[] = [];
        // one marble every five seconds, time to roll in and settle, or to tip and roll out; after each, how many have reached the tray
        roll(table, 2 * count + 1, 5, 5 * (2 * count + 1) + 3, (step) => {
            if (step % 600 === 599) seen.push(inTrays(table));
        });
        const expected = seen.map((_, i) => Math.floor((i + 1) / count) * count);
        expect(seen.slice(0, 2 * count + 1)).toEqual(expected.slice(0, 2 * count + 1));
    }
}, 120_000);

test("a seesaw rests with marbles that turn it 3% less than its counterweights, and tips with 3% more", () => {
    for (const share of [0.97, 1.03]) {
        const table = makeTable();
        table.set(read("v3.e2_0_0_10_0"));
        // awake throughout, so that it settles where the turning pushes say and is not caught asleep on its way
        table.space.sleeps = false;
        const hinge = hingeOf(table, 1);
        // two marbles against its end wall, made heavier or lighter so that together they turn it by `share` of what holds it
        const arms = seesawArms().slice(0, 2);
        const holding = ((arms[0]! + (arms[0]! + arms[1]!)) / 2) * MASS;
        const density = (2.5 * share * holding) / ((arms[0]! + arms[1]!) * MASS);
        for (const arm of arms) {
            // laid on the tilted floor exactly, touching it, the wall and each other, so that nothing is struck as they settle
            const [c, k, up] = [Math.cos(SEESAW.rest), Math.sin(SEESAW.rest), 0.2 + 0.8 / Math.cos((12 * Math.PI) / 180)];
            const along = (arm + up * k) / c;
            const [x, y] = [SEESAW.pivot[0] + arm, 20 + SEESAW.pivot[1] + along * k + up * c];
            table.space.ball(0.8, [x, y, 4], { friction: 0.5, bounce: 0.1, roll: 0.004, twist: 0.005, density });
        }
        let lowest = 0;
        for (let step = 0; step < 720; step++) {
            table.step(1 / 120);
            lowest = Math.min(lowest, hinge.angle);
        }
        if (share < 1) expect(hinge.angle).toBeGreaterThan(SEESAW.rest - 0.005);
        else expect(lowest).toBeLessThan(SEESAW.rest - 0.1);
    }
});

/** The switch with its two ways out, each a straight to a tray. */
const switched = (level: number, before: Kind[]) => chain(level, [...before, kind("w"), { kind: kind("s", [1]), to: before.length + 2, on: 1 }, kind("t"), { kind: kind("s", [1]), to: before.length + 2, on: 2 }, kind("t")]);

test("a switch sends marbles left, right, left, right, exactly, slow or fast, as fast as a hopper lets them go", () => {
    for (const [level, before, every] of [[18, [kind("s", [2])], 0.6], [24, [kind("d", [2, 2]), kind("d", [2, 2])], 0.6], [18, [kind("s", [2])], 0.31]] as const) {
        const run = switched(level, [...before]);
        const table = makeTable();
        table.set(run);
        const [left, right] = run.filter((piece) => piece.kind.family === "t").map((tray) => tray.id);
        const ways: string[] = [];
        const told = new Set<Solid>();
        roll(table, 24, every, 30, () => {
            for (const marble of table.marbles) {
                if (told.has(marble) || !table.arrived(marble)) continue;
                told.add(marble);
                ways.push(trayOf(run, marble) === left ? "L" : trayOf(run, marble) === right ? "R" : "?");
            }
        });
        expect(ways.join("")).toBe("LR".repeat(12));
    }
}, 120_000);

test("a trapdoor holds one marble at its lip, and opens under two, which drop to the track below, and closes again", () => {
    const run = chain(18, [kind("s", [2]), kind("j"), kind("s", [1]), kind("t")]);
    const table = makeTable();
    table.set(run);
    const hinge = hingeOf(table, 3);
    let widest = 0;
    roll(table, 1, 3, 4, () => (widest = Math.min(widest, hinge.angle)));
    expect(inTrays(table)).toBe(0);
    expect(widest).toBeGreaterThan(-0.05);
    roll(table, 1, 3, 5, () => (widest = Math.min(widest, hinge.angle)));
    expect(inTrays(table)).toBe(2);
    // it opened all the way, onto its stop, and is shut again
    expect(widest).toBeLessThan(-1.2);
    expect(hinge.angle).toBeGreaterThan(-0.01);
}, 60_000);

test("a lift waits, rises at its stated speed, waits, and comes down, in the period its numbers give", () => {
    const moving = designPart("u", [10]).moving as Extract<Moving, { kind: "lift" }>;
    const travel = moving.rise / LIFT.speed + LIFT.ease;
    expect(liftPeriod(moving)).toBeCloseTo(LIFT.waits[0] + LIFT.waits[1] + 2 * travel, 12);
    expect(liftAt(moving, 0.2)).toBe(0);
    expect(liftAt(moving, LIFT.waits[0] + travel + 0.1)).toBe(moving.rise);
    // between its easings it goes at its speed exactly, up and down
    const middle = LIFT.waits[0] + travel / 2;
    expect((liftAt(moving, middle + 0.01) - liftAt(moving, middle - 0.01)) / 0.02).toBeCloseTo(LIFT.speed, 9);
    const down = LIFT.waits[0] + travel + LIFT.waits[1] + travel / 2;
    expect((liftAt(moving, down + 0.01) - liftAt(moving, down - 0.01)) / 0.02).toBeCloseTo(-LIFT.speed, 9);
    // and goes round again after a period, smoothly: no step anywhere bigger than its speed allows
    expect(liftAt(moving, liftPeriod(moving) + 1.3)).toBeCloseTo(liftAt(moving, 1.3), 9);
    let most = 0;
    for (let t = 0; t < 2 * liftPeriod(moving); t += 0.001) most = Math.max(most, Math.abs(liftAt(moving, t + 0.001) - liftAt(moving, t)));
    expect(most).toBeLessThanOrEqual(LIFT.speed * 0.001 + 1e-9);
});

test("a lift carries up to three marbles a trip, drops none, and stops once the run is empty and still", () => {
    const run = chain(5, [kind("d", [1, 1]), kind("u", [8]), kind("s", [1]), kind("t")]);
    const table = makeTable();
    table.set(run);
    const lift = table.movers()[0]!;
    const car = lift.solids[0]!;
    const lost: Solid[] = [];
    table.gone = (marble) => lost.push(marble);
    // six marbles at once, as fast as the hopper goes: they queue at the lift and ride up in threes
    let most = 0;
    roll(table, 6, 0.31, 40, () => {
        const riding = table.marbles.filter((marble) => marble.p[1] > car.p[1] && marble.p[1] < car.p[1] + 2 && Math.abs(marble.p[0] - car.p[0]) < 3 && car.p[1] > 4).length;
        most = Math.max(most, riding);
    });
    expect(most).toBe(3);
    expect(lost.length).toBe(0);
    expect(inTrays(table)).toBe(6);
    // all asleep in the tray: the lift has stopped where it was, and stays there
    const at = [...car.p];
    for (let step = 0; step < 240; step++) table.step(1 / 120);
    expect(car.p).toEqual(at);
    expect(table.running).toBe(false);
    // and a marble let go starts it again
    roll(table, 1, 1, 1);
    expect(car.p).not.toEqual(at);
}, 60_000);

test("a hoist's chain goes round at its speed, joined up all the way, and its paddles carry every marble up", () => {
    const moving = designPart("y", [4]).moving as Extract<Moving, { kind: "hoist" }>;
    const long = chainLength(moving);
    // any two places a millimetre apart round the chain are a millimetre apart, round the whole loop and over its joins
    let worst = 0;
    for (let s = 0; s < long; s += 0.05) {
        const [a, b] = [chainAt(moving, s).at, chainAt(moving, s + 0.1).at];
        worst = Math.max(worst, Math.abs(Math.hypot(b[0] - a[0], b[1] - a[1]) - 0.1));
    }
    expect(worst).toBeLessThan(0.0002);
    expect(chainAt(moving, long + 3).at[0]).toBeCloseTo(chainAt(moving, 3).at[0], 9);
    expect(moving.speed).toBe(HOIST.speed);
    const run = chain(9, [kind("d", [1, 1]), kind("y", [4]), kind("s", [1]), kind("t")]);
    const table = makeTable();
    table.set(run);
    roll(table, 12, 0.6, 24);
    expect(inTrays(table)).toBe(12);
}, 60_000);

test("a spinner turns when a marble strikes it, passes every marble on, and comes to rest", () => {
    const run = chain(18, [kind("s", [2]), kind("o", [4]), kind("s", [1]), kind("t")]);
    const table = makeTable();
    table.set(run);
    const hinge = hingeOf(table, 3);
    let most = 0;
    roll(table, 6, 1.5, 30, () => (most = Math.max(most, Math.abs(hinge.spin))));
    expect(most).toBeGreaterThan(1);
    expect(inTrays(table)).toBe(6);
    expect(hinge.parts[0]!.rest).toBeDefined();
}, 60_000);

test("a gate swings open for each marble and shuts behind it, and stops a marble coming the other way", () => {
    const run = chain(18, [kind("s", [2]), kind("g"), kind("s", [1]), kind("t")]);
    const table = makeTable();
    table.set(run);
    const hinge = hingeOf(table, 3);
    const opened: number[] = [];
    let wide = 0;
    roll(table, 4, 2, 9, () => {
        wide = Math.max(wide, hinge.angle);
        if (hinge.angle < 0.01 && wide > 0.1) {
            opened.push(wide);
            wide = 0;
        }
    });
    expect(opened.length).toBe(4);
    for (const angle of opened) expect(angle).toBeGreaterThan(0.7);
    expect(inTrays(table)).toBe(4);
    expect(hinge.angle).toBeLessThan(0.01);
    // a marble rolled at it from beyond, the way out, comes back off it
    const alone = makeTable();
    alone.set(read("v3.g0_0_10_0"));
    const marble = alone.space.ball(0.8, [7.5, 19.3, 4], { friction: 0.5, bounce: 0.5, roll: 0.004, twist: 0.005, density: 2.5 });
    marble.v = [-40, 0, 0];
    for (let step = 0; step < 120; step++) alone.step(1 / 120);
    expect(marble.p[0]).toBeGreaterThan(4);
}, 60_000);

test("a chime bar, a bell and a drum are each struck once hard by each marble, at much the same speed every time, the bar at its note", () => {
    for (const [family, sizes] of [["m", [9]], ["n", []], ["q", []]] as const) {
        const run = chain(18, [kind("s", [2]), kind(family, [...sizes]), kind("s", [1]), kind("t")]);
        const table = makeTable();
        table.set(run);
        const strikes: { speed: number; pitch?: number }[] = [];
        let last = -1;
        let step = 0;
        table.space.hit = (a, b, speed) => {
            const heard = table.heard(a.radius === undefined ? a : b);
            // the hardest strike of each marble, once: what a strike and its echo in the next step give
            if (heard && heard.kind !== "wood" && speed > 50 && step - last > 4) strikes.push({ speed, pitch: heard.pitch });
            if (heard && heard.kind !== "wood" && speed > 50) last = step;
        };
        roll(table, 5, 1.5, 12, (at) => (step = at));
        expect(strikes.length).toBe(5);
        const speeds = strikes.map((one) => one.speed);
        expect(Math.max(...speeds) / Math.min(...speeds)).toBeLessThan(1.1);
        if (family === "m") for (const one of strikes) expect(one.pitch).toBe(NOTES[9]);
        expect(inTrays(table)).toBe(5);
    }
    expect(NOTES[0]).toBeCloseTo(523.2511, 3);
    expect(NOTES[14]).toBeCloseTo(2093.0045, 3);
    expect(shapeOf(kind("m", [0])).struck!.mesh.points.length).toBe(8);
}, 120_000);

test("the made runs do what they are made for: the loop keeps its marbles going round, the tune plays in order, the sorting run sorts", () => {
    const made = (name: string) => read(RUNS.find((one) => one.name.includes(name))!.text);
    // ten marbles round the loop for five minutes: none lost, none at rest
    const loop = makeTable();
    loop.set(made("loops"));
    const lost: Solid[] = [];
    loop.gone = (marble) => lost.push(marble);
    roll(loop, 10, 1.5, 300);
    expect(lost.length).toBe(0);
    expect(loop.marbles.length).toBe(10);
    expect(loop.marbles.every((marble) => marble.p[1] > 1)).toBe(true);
    expect(loop.marbles.some((marble) => !marble.rest)).toBe(true);
    // one marble down the tune: each bar struck in turn, G5 C6 E6 D6 B5 G5 A5 C6
    const tune = makeTable();
    tune.set(made("tune"));
    const notes: number[] = [];
    tune.space.hit = (a, b, speed) => {
        const heard = tune.heard(a.radius === undefined ? a : b);
        if (heard?.kind === "chime" && speed > 50 && heard.pitch !== notes.at(-1)) notes.push(heard.pitch!);
    };
    roll(tune, 1, 1, 12);
    expect(notes).toEqual([4, 7, 9, 8, 6, 4, 5, 7].map((note) => NOTES[note]!));
    // twelve marbles sorted, six each way, all in the trays
    const sort = makeTable();
    const run = made("sorting");
    sort.set(run);
    roll(sort, 12, 1.3, 40);
    const trays = run.filter((piece) => piece.kind.family === "t").map((tray) => sort.marbles.filter((marble) => trayOf(run, marble) === tray.id).length);
    expect(trays).toEqual([6, 6]);
}, 180_000);

test("a ghost started from the real table runs on from where its parts are: through the switch the way the next marble will go, and round the lift", () => {
    const run = switched(18, [kind("s", [2])]);
    const [left, right] = run.filter((piece) => piece.kind.family === "t").map((tray) => tray.id);
    const table = makeTable();
    table.set(run);
    for (const expected of [left, right, left]) {
        // where the ghost says the next marble goes, from the table as it is now
        const ghost = makeGhost();
        ghost.start(run, table);
        ghost.work(0, 120 * 20);
        expect(ghost.paths[0]!.ending).toBe("arrived");
        expect(ghost.paths[0]!.last).toBe(expected);
        const before = table.marbles.filter((marble) => trayOf(run, marble) === expected).length;
        roll(table, 1, 1, 5);
        expect(table.marbles.filter((marble) => trayOf(run, marble) === expected).length).toBe(before + 1);
    }
    const loop = read(RUNS.find((one) => one.name.includes("loops"))!.text);
    const ghost = makeGhost();
    ghost.start(loop);
    ghost.work(0, 120 * 40);
    expect(ghost.paths[0]!.ending).toBe("loops");
}, 60_000);

/** The sorting run and the loop raced for a while, as text: every marble's place, speed and spin, and every part's state, as the bits of each number. */
const race = (here: string) => `
import { makeTable } from "${here}/table.ts";
import { read } from "${here}/run.ts";
import { RUNS } from "${here}/runs.ts";
export function race() {
    const bits = new Uint32Array(2);
    const floats = new Float64Array(bits.buffer);
    const out = [];
    for (const made of RUNS.filter((one) => one.text.startsWith("v3."))) {
        const table = makeTable();
        table.set(read(made.text));
        let [count, wait] = [0, 0];
        for (let step = 0; step < 14 * 120; step++) {
            wait -= 1 / 120;
            if (count < 8 && wait <= 0 && table.letGo().length) [count, wait] = [count + 1, 0.9];
            table.step(1 / 120);
        }
        out.push(...table.marbles.flatMap((m) => [...m.p, ...m.v, ...m.w]), ...[...table.parts().values()].flat());
    }
    return out.map((x) => { floats[0] = x; return bits[1].toString(16).padStart(8, "0") + bits[0].toString(16).padStart(8, "0"); }).join(" ");
}
`;

test("the runs with moving parts give the same race run twice, to the bit", async () => {
    const folder = await mkdtemp(join(tmpdir(), "marbles-parts-"));
    try {
        await Bun.write(join(folder, "race.ts"), race(import.meta.dir));
        const { race: run } = (await import(join(folder, "race.ts"))) as { race: () => string };
        const first = run();
        expect(run()).toBe(first);
        expect(first.split(" ").length).toBeGreaterThan(200);
    } finally {
        await rm(folder, { recursive: true, force: true });
    }
}, 120_000);

test.skipIf(!chromium())("the runs with moving parts give the same race in Chromium as in Bun, to the bit", async () => {
    const folder = await mkdtemp(join(tmpdir(), "marbles-parts-"));
    const tab = await browser({ width: 300, height: 200 });
    try {
        await Bun.write(join(folder, "race.ts"), race(import.meta.dir));
        await Bun.write(join(folder, "page.ts"), `import { race } from "./race.ts"; (window as unknown as { result: string }).result = race();`);
        const built = await Bun.build({ entrypoints: [join(folder, "page.ts")], target: "browser" });
        await Bun.write(join(folder, "page.html"), `<!doctype html><script type="module">${await built.outputs[0]!.text()}</script>`);
        await tab.open(`file://${join(folder, "page.html")}`, 2000);
        expect(tab.errors).toEqual([]);
        const there = await tab.run<string>("window.result");
        const { race: run } = (await import(join(folder, "race.ts"))) as { race: () => string };
        expect(there).toBe(run());
    } finally {
        await tab.close();
        await rm(folder, { recursive: true, force: true });
    }
}, 180_000);
