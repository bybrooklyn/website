// The demo course is held to running: every marble let go goes down the ramp, round the loop, along
// the spiral and through the funnel into the tray, none is lost on the way, and once they stop coming
// they all come to rest and sleep. Run with `bun run test`.

import { expect, test } from "bun:test";
import { MOST, makeCourse } from "./course";

test("marbles let go one after another all reach the tray, none is lost, and they all fall asleep there", () => {
    const course = makeCourse();
    const released = 12;
    let [lost, highest] = [0, 0];
    for (let step = 0; step < 40 * course.space.rate; step++) {
        if (step % 200 === 0 && course.marbles.length < released) course.release();
        course.space.step(1 / course.space.rate);
        for (const marble of course.marbles) {
            if (marble.p[1] < -150) lost++;
            highest = Math.max(highest, marble.p[1]);
        }
    }
    expect(lost).toBe(0);
    // nothing was thrown above where it started
    expect(highest).toBeLessThan(course.pieces[0]!.ends![0].p[1] + 1);
    expect(course.marbles.length).toBe(released);
    expect(course.marbles.every(course.inTray)).toBe(true);
    expect(course.marbles.every((marble) => marble.rest)).toBe(true);
}, 60_000);

test("past the most it holds, letting another go takes the oldest away", () => {
    const course = makeCourse();
    const gone: unknown[] = [];
    for (let i = 0; i < MOST + 3; i++) course.release((marble) => gone.push(marble));
    expect(course.marbles.length).toBe(MOST);
    expect(gone.length).toBe(3);
    expect(course.space.solids.filter((solid) => solid.radius !== undefined).length).toBe(MOST);
});
