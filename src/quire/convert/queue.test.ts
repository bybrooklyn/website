// What the queue is held to: no lane runs more than its limit at once, jobs start in the order they
// came, a waiting job stopped never starts, a running job stopped is told through its signal and frees
// its lane once it gives up, a failure is kept with its error, and stopping all stops everything.

import { expect, test } from "bun:test";
import { createQueue, type JobState } from "./queue";

const tick = () => new Promise((done) => setTimeout(done, 1));

test("no lane runs more than its limit, and jobs start in the order they came", async () => {
    const queue = createQueue({ picture: 2, video: 1 });
    let most = 0;
    let now = 0;
    const started: number[] = [];
    const jobs = Array.from({ length: 6 }, (_, index) =>
        queue.add("picture", async () => {
            started.push(index);
            now++;
            most = Math.max(most, now);
            await tick();
            now--;
        }),
    );
    expect((await Promise.all(jobs.map((job) => job.done))).every((state) => state === "done")).toBe(true);
    expect(most).toBe(2);
    expect(started).toEqual([0, 1, 2, 3, 4, 5]);
});

test("each lane has its own room: a film waiting does not hold up pictures", async () => {
    const queue = createQueue({ picture: 1, video: 1 });
    let release!: () => void;
    const film = queue.add("video", () => new Promise<void>((done) => (release = done)));
    const picture = queue.add("picture", async () => {});
    expect(await picture.done).toBe("done");
    expect(film.state).toBe("running");
    release();
    expect(await film.done).toBe("done");
});

test("a waiting job stopped never starts, and a running one is told and frees its lane when it gives up", async () => {
    const changes: JobState[] = [];
    const queue = createQueue({ audio: 1 }, (job) => job.id === 1 && changes.push(job.state));
    let told = false;
    const first = queue.add("audio", async (signal) => {
        while (!signal.aborted) await tick();
        told = true;
    });
    let ran = false;
    const second = queue.add("audio", async () => void (ran = true));
    second.stop();
    expect(second.state).toBe("stopped");
    await tick();
    first.stop();
    expect(first.state).toBe("stopped");
    expect(await first.done).toBe("stopped");
    expect(told).toBe(true);
    expect(ran).toBe(false);
    expect(changes).toEqual(["waiting", "running", "stopped"]);
    const third = queue.add("audio", async () => {});
    expect(await third.done).toBe("done");
});

test("a failure is kept with its error, and stopping all stops waiting and running jobs alike", async () => {
    const queue = createQueue({ text: 1 });
    const bad = queue.add("text", async () => {
        throw new Error("no good");
    });
    expect(await bad.done).toBe("failed");
    expect((bad.error as Error).message).toBe("no good");
    const long = queue.add("text", (signal) => new Promise<void>((done) => signal.addEventListener("abort", () => done())));
    const after = queue.add("text", async () => {});
    queue.stopAll();
    expect(await long.done).toBe("stopped");
    expect(await after.done).toBe("stopped");
    expect(queue.size()).toBe(0);
});
