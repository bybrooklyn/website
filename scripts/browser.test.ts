// The browser driver every browser test stands on: that it leaves nothing behind, and that it sends a modifier alone as a keyboard does. Held true: a
// closed browser leaves no Chromium process and no profile folder; one that fails to start is
// cleaned up at once, not at the end of the run; when Chromium dies, calls waiting on it fail
// instead of hanging; and many browsers in one run do not pile up signal handlers. Skipped, with
// a notice, on a machine with no Chromium.

import { expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { browser, chromium } from "./browser";

const live = !!chromium();
const used = (name: string, run: () => Promise<void>) => test.skipIf(!live)(name, run, 30_000);

// Other runs on this machine may have browsers of their own open, so a browser is known as this
// run's by its main process being a child of this one; its helpers are the rest of its process group.
const listed = () =>
    Bun.spawnSync(["ps", "-eo", "pid=,ppid=,pgid=,args="])
        .stdout.toString()
        .split("\n")
        .map((line) => line.trim().split(/\s+/))
        .filter((parts) => parts.length > 3)
        .map(([pid, parent, group, ...args]) => ({ pid: Number(pid), parent: Number(parent), group: Number(group), args: args.join(" ") }));
/** This run's browsers: the main process of each, and its profile folder. */
const mine = () =>
    listed()
        .filter((one) => one.parent === process.pid && one.args.includes("--remote-debugging-port="))
        .map((one) => ({ pid: one.pid, profile: /--user-data-dir=(\S+)/.exec(one.args)?.[1] ?? "" }));
/** The browser this run started since `before` was taken. */
const started = (before: { pid: number }[]) => mine().find((one) => !before.some((old) => old.pid === one.pid));
/** The processes of a browser's group still there. */
const group = (pid: number) => listed().filter((one) => one.group === pid);
const until = async (held: () => boolean, ms = 3000) => {
    for (let waited = 0; waited < ms && !held(); waited += 50) await Bun.sleep(50);
    return held();
};

used("a closed browser leaves no Chromium process and no profile folder behind", async () => {
    const before = mine();
    const tab = await browser({ width: 400, height: 300 });
    await tab.open("data:text/html,<p>here</p>", 50);
    expect(await tab.run("document.querySelector('p').textContent")).toBe("here");
    const opened = started(before)!;
    expect(opened.profile).toStartWith(join(tmpdir(), "site-browser-"));
    expect(group(opened.pid).length).toBeGreaterThan(1);
    await tab.close();
    expect(group(opened.pid)).toEqual([]);
    expect(existsSync(opened.profile)).toBe(false);
    // closing twice is harmless
    await tab.close();
});

used("when Chromium dies, a call waiting on it fails at once instead of hanging", async () => {
    const before = mine();
    const tab = await browser({ width: 400, height: 300 });
    const opened = started(before)!;
    const waiting = tab.run("new Promise(() => {})");
    await Bun.sleep(200);
    process.kill(-opened.pid, "SIGKILL");
    const since = Date.now();
    expect(await waiting.then(() => "answered", (error: Error) => error.message)).toContain("closed");
    expect(Date.now() - since).toBeLessThan(5000);
    // and later calls fail too, rather than waiting for an answer that cannot come
    expect(await tab.run("1").then(() => "answered", () => "failed")).toBe("failed");
    await tab.close();
    expect(existsSync(opened.profile)).toBe(false);
});

used("a browser that does not come up is stopped and its folder taken away at once", async () => {
    // a port that answers as Chromium's would, with no page in it, so the start waits and gives up
    // (on every address of this computer: held on 127.0.0.1 alone, Chromium took the same port on ::1 and came up)
    const decoy = Bun.serve({ port: 0, hostname: "::", fetch: () => Response.json([]) });
    let opened: { pid: number; profile: string } | undefined;
    const before = mine();
    const watching = setInterval(() => (opened ??= started(before)), 100);
    const failed = await browser({ width: 400, height: 300, port: decoy.port! }).then(
        () => "",
        (error: Error) => error.message,
    );
    clearInterval(watching);
    decoy.stop(true);
    expect(failed).toBe("Chromium did not start.");
    expect(opened).toBeDefined();
    expect(await until(() => group(opened!.pid).length === 0)).toBe(true);
    expect(existsSync(opened!.profile)).toBe(false);
});

used("many browsers in one run add one set of signal handlers, not one each", async () => {
    const tabs = [await browser({ width: 300, height: 200 })];
    const counted = () => ["SIGINT", "SIGTERM", "SIGHUP", "exit"].map((name) => process.listenerCount(name));
    const first = counted();
    tabs.push(await browser({ width: 300, height: 200 }), await browser({ width: 300, height: 200 }));
    expect(counted()).toEqual(first);
    await Promise.all(tabs.map((tab) => tab.close()));
});

used("a modifier pressed alone goes down held and comes up let go, with no character, as a keyboard sends it", async () => {
    const tab = await browser({ width: 300, height: 200 });
    try {
        await tab.open("data:text/html,<p>keys</p>", 50);
        await tab.run(`window.seen = []; for (const type of ["keydown", "keyup"]) addEventListener(type, (event) => seen.push([type, event.key, event.code, event.ctrlKey].join(" ")))`);
        await tab.press("Control");
        expect(await tab.run<string[]>("seen")).toEqual(["keydown Control ControlLeft true", "keyup Control ControlLeft false"]);
    } finally {
        await tab.close();
    }
});

if (!live) console.warn("browser.test.ts: no Chromium on this machine, so the driver was not tried.");
