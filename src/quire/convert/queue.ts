// The converter's queue: many files at once, a few at a time, so that the machine stays usable. Each
// kind of work has its own lane with its own limit (films one at a time, pictures and sounds two),
// jobs start in the order they were added, and each can be stopped, waiting or running. A running job
// is told through its signal and is expected to give up at its next step; it counts as stopped at once.
//
//   queue = createQueue({ picture: 2, video: 1 });
//   job = queue.add("picture", async (signal) => { ... });
//   job.stop();

/** Where a job is: waiting its turn, running, finished, stopped, or failed. */
export type JobState = "waiting" | "running" | "done" | "stopped" | "failed";

/** A job in the queue, as the page sees it. */
export interface Job {
    id: number;
    lane: string;
    state: JobState;
    error?: unknown;
    stop(): void;
    /** Settles when the job has finished, stopped or failed; never rejects. */
    done: Promise<JobState>;
}

/** A queue of lanes, each running at most its limit of jobs at once. */
export function createQueue(limits: Record<string, number>, changed: (job: Job) => void = () => {}) {
    let count = 0;
    const waiting: { job: Job; work: (signal: AbortSignal) => Promise<void>; controller: AbortController; settle: (state: JobState) => void }[] = [];
    const running = new Map<number, { job: Job; controller: AbortController; settle: (state: JobState) => void }>();
    const busy = (lane: string) => [...running.values()].filter((each) => each.job.lane === lane).length;

    function next() {
        for (let at = 0; at < waiting.length; at++) {
            const entry = waiting[at]!;
            if (busy(entry.job.lane) >= (limits[entry.job.lane] ?? 1)) continue;
            waiting.splice(at, 1);
            at--;
            start(entry);
        }
    }

    function start(entry: (typeof waiting)[number]) {
        const { job, work, controller, settle } = entry;
        job.state = "running";
        running.set(job.id, { job, controller, settle });
        changed(job);
        work(controller.signal).then(
            () => finish(job.id, controller.signal.aborted ? "stopped" : "done"),
            (error) => finish(job.id, controller.signal.aborted ? "stopped" : "failed", error),
        );
    }

    function finish(id: number, state: JobState, error?: unknown) {
        const entry = running.get(id);
        if (!entry) return;
        running.delete(id);
        if (entry.job.state === "running") {
            entry.job.state = state;
            if (state === "failed") entry.job.error = error;
            changed(entry.job);
        }
        entry.settle(entry.job.state);
        next();
    }

    return {
        /** Adds a job to a lane; it starts when the lane has room. */
        add(lane: string, work: (signal: AbortSignal) => Promise<void>): Job {
            const controller = new AbortController();
            let settle!: (state: JobState) => void;
            const done = new Promise<JobState>((resolve) => (settle = resolve));
            const job: Job = {
                id: ++count,
                lane,
                state: "waiting",
                done,
                stop: () => {
                    if (job.state === "waiting") {
                        const at = waiting.findIndex((each) => each.job.id === job.id);
                        if (at >= 0) waiting.splice(at, 1);
                        job.state = "stopped";
                        changed(job);
                        settle("stopped");
                    } else if (job.state === "running") {
                        // it is stopped for the page at once; its lane is free once the work has given up
                        controller.abort();
                        job.state = "stopped";
                        changed(job);
                    }
                },
            };
            waiting.push({ job, work, controller, settle });
            changed(job);
            next();
            return job;
        },
        /** Stops every job, waiting or running. */
        stopAll() {
            for (const entry of [...waiting]) entry.job.stop();
            for (const entry of [...running.values()]) entry.job.stop();
        },
        /** How many jobs are waiting or running. */
        size: () => waiting.length + running.size,
    };
}
