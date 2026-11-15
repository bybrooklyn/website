// Tests for the marble run's cameras: a ride follows a steady marble with no lag, does not shake with a
// rocking one, turns gently and never flips, shortens its arm where something is in the way; a glide
// goes the short way round; a tour goes along its way at its pace and stops at the end.

import { expect, test } from "bun:test";
import { RIDE, blockedBy, eased, glide, glideTime, obstaclesOf, rideFrom, riding, tourAt, tourOf, tourSteps, within, PACE } from "./camera";
import { eyeOf, type Orbit } from "./orbit";
import { read } from "./run";
import { RUNS } from "./runs";
import { makeTable } from "./table";
import { onTrackOf } from "./ghost";
import type { V3 } from "../mote/solids";

const DT = 1 / 120;
const view: Orbit = { at: [0, 10, 0], turn: 0.75, tip: 0.62, far: 220 };

test("a ride on a marble going steadily looks a few centimetres ahead of it, with no lag, from behind and above", () => {
    const v: V3 = [60, 0, 0];
    let at: V3 = [0, 5, 0];
    let ride = rideFrom(view, at, v);
    for (let i = 0; i < 360; i++) {
        at = [at[0] + v[0] * DT, at[1], at[2]];
        ride = riding(ride, at, v, DT);
    }
    const looked = ride.orbit.at;
    expect(Math.abs(looked[0] - (at[0] + RIDE.ahead))).toBeLessThan(0.01);
    expect(Math.abs(looked[1] - at[1])).toBeLessThan(0.01);
    expect(Math.abs(looked[2] - at[2])).toBeLessThan(0.01);
    // the eye behind the way it goes, and above
    const eye = eyeOf(ride.orbit);
    expect(eye[0]).toBeLessThan(at[0] - 15);
    expect(Math.abs(eye[2] - at[2])).toBeLessThan(0.01);
    expect(eye[1]).toBeGreaterThan(at[1] + 8);
});

test("a marble rocking from side to side by 3 mm five times a second moves the view by a fifth of that or less", () => {
    const v: V3 = [50, 0, 0];
    let ride = rideFrom(view, [0, 5, 0], v);
    let most = 0;
    for (let i = 0; i < 600; i++) {
        const t = i * DT;
        const side = 0.3 * Math.sin(2 * Math.PI * 5 * t);
        const at: V3 = [v[0] * t, 5, side];
        const sway: V3 = [v[0], 0, 0.3 * 2 * Math.PI * 5 * Math.cos(2 * Math.PI * 5 * t)];
        ride = riding(ride, at, sway, DT);
        if (t > 2) most = Math.max(most, Math.abs(ride.orbit.at[2]));
    }
    expect(most).toBeLessThan(0.06);
});

test("a marble that turns right round turns the view gently, never faster than its rate, and the view never tips or rolls", () => {
    let ride = rideFrom(view, [0, 5, 0], [60, 0, 0]);
    let at: V3 = [0, 5, 0];
    let most = 0;
    for (let i = 0; i < 480; i++) {
        // a half turn of 4 cm radius at 60 cm/s after a second, then back the way it came
        const t = i * DT;
        const angle = t < 1 ? 0 : Math.min(Math.PI, ((t - 1) * 60) / 4);
        const v: V3 = [60 * Math.cos(angle), 0, 60 * Math.sin(angle)];
        at = [at[0] + v[0] * DT, at[1], at[2] + v[2] * DT];
        const before = ride.orbit.turn;
        ride = riding(ride, at, v, DT);
        most = Math.max(most, Math.abs(ride.orbit.turn - before));
        expect(ride.tip).toBe(RIDE.tip);
    }
    expect(most).toBeLessThanOrEqual(RIDE.rate * DT + 1e-12);
    // and it came round behind the way it goes now
    const eye = eyeOf(ride.orbit);
    expect(eye[0]).toBeGreaterThan(at[0] + 10);
});

test("round a loop, where the marble goes backward at the top for a moment, the view turns by under a fifth of a radian", () => {
    let ride = rideFrom(view, [0, 5, 0], [150, 0, 0]);
    let at: V3 = [0, 5, 0];
    const start = ride.turn;
    let most = 0;
    for (let i = 0; i < 240; i++) {
        const t = i * DT;
        // half a second along, a loop of 4.5 cm radius taken at 150 cm/s
        const angle = t < 0.5 ? 0 : Math.min(2 * Math.PI, ((t - 0.5) * 150) / 4.5);
        const v: V3 = angle > 0 && angle < 2 * Math.PI ? [150 * Math.cos(angle), 150 * Math.sin(angle), 0] : [150, 0, 0];
        at = [at[0] + v[0] * DT, at[1] + v[1] * DT, at[2]];
        ride = riding(ride, at, v, DT);
        most = Math.max(most, Math.abs(ride.turn - start));
    }
    expect(most).toBeLessThan(0.2);
});

test("where something comes between the marble and the eye, the arm shortens at once to stop short of it, and lengthens slowly once it is clear", () => {
    // a wall across behind the marble, 10 cm back, as high as the eye
    const wall = [{ at: [-10, 10, 0] as V3, axes: [[1, 0, 0], [0, 1, 0], [0, 0, 1]] as [V3, V3, V3], half: [0.5, 10, 20] as V3 }];
    const blocked = blockedBy(wall);
    const v: V3 = [1e-9, 0, 0];
    let ride = rideFrom({ ...view, turn: Math.PI / 2 }, [0, 5, 0], [60, 0, 0]);
    for (let i = 0; i < 30; i++) ride = riding(ride, [0, 5, 0], v, DT, blocked);
    // within a quarter of a second the eye is in front of the wall
    expect(eyeOf(ride.orbit)[0]).toBeGreaterThan(-9.5);
    const short = ride.far;
    ride = riding(ride, [0, 5, 0], v, DT);
    expect(ride.far).toBeGreaterThan(short);
    expect(ride.far - short).toBeLessThan(0.2);
});

test("the eye riding a marble down every made run never goes into a piece, and never under the table", () => {
    for (const made of RUNS) {
        const run = read(made.text);
        const boxes = obstaclesOf(run);
        const blocked = blockedBy(boxes);
        const calm = onTrackOf(run);
        const table = makeTable();
        table.set(run);
        for (let step = 0; step < 48; step++) table.step(DT);
        const [marble] = table.letGo();
        let ride = rideFrom(view, marble!.p, marble!.v, RIDE, blocked);
        let inside = 0;
        for (let step = 0; step < 120 * 20; step++) {
            table.step(DT);
            if (!table.marbles.includes(marble!)) break;
            ride = riding(ride, calm(marble!.p) ?? marble!.p, marble!.v, DT, blocked);
            const eye = eyeOf(ride.orbit);
            // the eye, and a little room round it for the near plane
            if (boxes.some((box) => !box.glass && within(box, eye, 0.3))) inside++;
        }
        expect({ run: made.name, inside }).toEqual({ run: made.name, inside: 0 });
    }
}, 120_000);

test("a glide goes the short way round, from one view to the other, evenly in distance, and eases", () => {
    const from: Orbit = { at: [0, 0, 0], turn: 0.1, tip: 0.5, far: 50 };
    const to: Orbit = { at: [10, 20, 30], turn: 2 * Math.PI - 0.1, tip: 1, far: 200 };
    expect(glide(from, to, 0)).toEqual(from);
    const end = glide(from, to, 1);
    expect(end.turn).toBeCloseTo(-0.1, 12);
    expect(end.far).toBeCloseTo(200, 9);
    expect(glide(from, to, 0.5).far).toBeCloseTo(100, 9);
    expect(glide(from, to, 0.5).turn).toBeCloseTo(0, 12);
    expect(eased(0)).toBe(0);
    expect(eased(1)).toBe(1);
    expect(eased(0.5)).toBeGreaterThan(0.5);
    expect(glideTime(from, from)).toBeCloseTo(0.45, 9);
    expect(glideTime(from, to)).toBeGreaterThan(0.6);
    expect(glideTime(from, { ...to, at: [900, 0, 900] })).toBeLessThanOrEqual(1.2);
});

test("a tour goes along its way at its pace, its way a unit along it, and its steps for reduced motion end at the end", () => {
    const tour = tourOf([[0, 0, 0], [10, 0, 0], [10, 0, 10], [10, 0, 30]]);
    expect(tour.length).toBe(40);
    expect(tourAt(tour, 15).at).toEqual([10, 0, 5]);
    expect(Math.hypot(...tourAt(tour, 25).v)).toBeCloseTo(PACE, 9);
    expect(tourAt(tour, 999).at).toEqual([10, 0, 30]);
    const steps = tourSteps(tour);
    expect(steps[0]).toBe(0);
    expect(steps.at(-1)).toBe(40);
    expect(steps.length).toBeGreaterThanOrEqual(3);
});
