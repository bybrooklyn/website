// What the practice workers' messages are held to: the real workers, a leader and its helpers, run as
// the page runs them, with the world changed again and again while an update is in flight and the
// helpers hired again; practice must go on, at the newest setting, with its steps rising.

import { expect, test } from "bun:test";
import type { Order, Report } from "./generalist-practice";

const HARNESS = new URL("./generalist-practice.harness.ts", import.meta.url).href;
const wait = (ms: number) => new Promise((done) => setTimeout(done, ms));

/** A page's side of practice: the leader, its helpers, and every report the leader sent. */
function page() {
    const reports: Report[] = [];
    const leader = new Worker(HARNESS, { type: "module" });
    leader.onmessage = (event: MessageEvent<Report>) => reports.push(event.data);
    let helpers: Worker[] = [];
    let setup = 0;
    let legs = 2;
    const begin = (index: number, workers: number): Order => ({ kind: "begin", setup, legs, seed: 3, difficulty: 0.2, amounts: [0.6, 0.4, 0.4, 0.4], workers, index, learnerSeed: 1 });
    /** As the page's `staff`: helpers let go and new ones hired, each told its leader, its share, and the leader told its helpers. */
    const staff = (count: number) => {
        for (const helper of helpers) helper.terminate();
        helpers = [];
        const ports: MessagePort[] = [];
        for (let i = 0; i < count; i++) {
            const helper = new Worker(HARNESS, { type: "module" });
            const channel = new MessageChannel();
            helper.postMessage({ kind: "lead", port: channel.port2 } satisfies Order, [channel.port2]);
            ports.push(channel.port1);
            helpers.push(helper);
        }
        helpers.forEach((helper, k) => helper.postMessage(begin(k + 1, count + 1)));
        leader.postMessage({ kind: "helpers", ports, gentle: false } satisfies Order, ports);
    };
    /**
     * As the page's `begin`: a new setup, told to the leader and each helper. The page tells the leader
     * once the kept learner is read from the store, and a helper hired meanwhile hears first, so either
     * may hear of it a while before the other.
     */
    const change = async (pause: number, helpersFirst: boolean) => {
        setup += 1;
        legs = setup % 3 === 0 ? 4 : 2;
        const tellHelpers = () => helpers.forEach((helper, k) => helper.postMessage(begin(k + 1, helpers.length + 1)));
        const tellLeader = () => {
            leader.postMessage(begin(0, helpers.length + 1));
            leader.postMessage({ kind: "resume" } satisfies Order);
        };
        (helpersFirst ? tellHelpers : tellLeader)();
        await wait(pause);
        (helpersFirst ? tellLeader : tellHelpers)();
    };
    const beating = setInterval(() => leader.postMessage({ kind: "beat" } satisfies Order), 300);
    const practised = () => reports.filter((report): report is Extract<Report, { kind: "practised" }> => report.kind === "practised" && report.setup === setup);
    const close = () => {
        clearInterval(beating);
        leader.terminate();
        for (const helper of helpers) helper.terminate();
    };
    return { reports, staff, change, practised, close, setup: () => setup };
}

/** Waits until `ready` is true, or gives up after `ms`. */
async function until(ready: () => boolean, ms: number): Promise<boolean> {
    for (const began = performance.now(); performance.now() - began < ms; await wait(50)) if (ready()) return true;
    return ready();
}

test("a kept learner of another size is refused before it is written, and practice starts afresh", async () => {
    const reports: Report[] = [];
    const leader = new Worker(HARNESS, { type: "module" });
    leader.onmessage = (event: MessageEvent<Report>) => reports.push(event.data);
    const beating = setInterval(() => leader.postMessage({ kind: "beat" } satisfies Order), 300);
    try {
        // running numbers of the right length for two legs (1 + 2 * 114 + 3), and a state far too long
        const kept = { state: new Float32Array(20_000_000), running: new Float64Array(232), seconds: 100, steps: 1e6 };
        leader.postMessage({ kind: "begin", setup: 1, legs: 2, seed: 3, difficulty: 0.2, amounts: [0.6, 0.4, 0.4, 0.4], workers: 1, index: 0, learnerSeed: 1, kept } satisfies Order);
        expect(await until(() => reports.length >= 2, 20_000)).toBe(true);
        const first = reports[0]!;
        expect(first.kind).toBe("practised");
        // what was kept is forgotten: it counts from nothing
        if (first.kind === "practised") expect(first.steps).toBeLessThan(1e6);
    } finally {
        clearInterval(beating);
        leader.terminate();
    }
}, 30_000);

test("a trap in the engine is told to the page, and that setup is not tried again", async () => {
    const reports: Report[] = [];
    const leader = new Worker(HARNESS, { type: "module", argv: ["faulty"] } as WorkerOptions);
    leader.onmessage = (event: MessageEvent<Report>) => reports.push(event.data);
    const beating = setInterval(() => leader.postMessage({ kind: "beat" } satisfies Order), 100);
    try {
        leader.postMessage({ kind: "begin", setup: 1, legs: 2, seed: 3, difficulty: 0.2, amounts: [0.6, 0.4, 0.4, 0.4], workers: 1, index: 0, learnerSeed: 1 } satisfies Order);
        expect(await until(() => reports.some((report) => report.kind === "failed"), 10_000)).toBe(true);
        await wait(1000);
        expect(reports.filter((report) => report.kind === "practised").length).toBe(2);
        expect(reports.filter((report) => report.kind === "failed").length).toBe(1);
    } finally {
        clearInterval(beating);
        leader.terminate();
    }
}, 30_000);

test("practice goes on, with its steps rising, after the world is changed twenty times while updates are in flight", async () => {
    const it = page();
    try {
        it.staff(3);
        await it.change(0, false);
        expect(await until(() => it.practised().length >= 2, 20_000)).toBe(true);
        for (let k = 0; k < 20; k++) {
            // now and then the helpers are hired again, as a change of effort does
            if (k % 7 === 3) it.staff(k % 2 === 0 ? 1 : 3);
            await it.change(k % 4 === 0 ? 0 : 5 + ((k * 37) % 60), k % 2 === 1);
        }
        expect(await until(() => it.practised().length >= 3, 20_000)).toBe(true);
        const steps = it.practised().map((report) => report.steps);
        expect(steps.at(-1)!).toBeGreaterThan(steps[0]!);
        expect(it.reports.some((report) => report.kind === "failed")).toBe(false);
    } finally {
        it.close();
    }
}, 60_000);
