// The browser driver every browser test stands on: that it leaves nothing behind. Held true: a
// closed browser leaves no Chromium process and no profile folder; one that fails to start is
// cleaned up at once, not at the end of the run; when Chromium dies, calls waiting on it fail
// instead of hanging; and many browsers in one run do not pile up signal handlers. Skipped, with
// a notice, on a machine with no Chromium.

import { expect, test } from "bun:test";
import { readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { browser, chromium } from "./browser";

const live = !!chromium();
const used = (name: string, run: () => Promise<void>) => test.skipIf(!live)(name, run, 30_000);

const profiles = () => new Set(readdirSync(tmpdir()).filter((name) => name.startsWith("site-browser-")));
/** The profile folder made since `before` was taken. */
const made = (before: Set<string>) => [...profiles()].filter((name) => !before.has(name));
/** The processes whose command line names a profile folder. */
function using(profile: string): number[] {
    const listed = Bun.spawnSync(["ps", "-eo", "pid=,args="]).stdout.toString().split("\n");
    return listed.filter((line) => line.includes(join(tmpdir(), profile))).map((line) => Number(line.trim().split(/\s+/)[0]));
}
const until = async (held: () => boolean, ms = 3000) => {
    for (let waited = 0; waited < ms && !held(); waited += 50) await Bun.sleep(50);
    return held();
};

used("a closed browser leaves no Chromium process and no profile folder behind", async () => {
    const before = profiles();
    const tab = await browser({ width: 400, height: 300 });
    await tab.open("data:text/html,<p>here</p>", 50);
    expect(await tab.run("document.querySelector('p').textContent")).toBe("here");
    const [profile] = made(before);
    expect(profile).toBeDefined();
    expect(using(profile!).length).toBeGreaterThan(1);
    await tab.close();
    expect(using(profile!)).toEqual([]);
    expect(profiles().has(profile!)).toBe(false);
    // closing twice is harmless
    await tab.close();
});

used("when Chromium dies, a call waiting on it fails at once instead of hanging", async () => {
    const before = profiles();
    const tab = await browser({ width: 400, height: 300 });
    const [profile] = made(before);
    const waiting = tab.run("new Promise(() => {})");
    await Bun.sleep(200);
    for (const pid of using(profile!)) process.kill(pid, "SIGKILL");
    const started = Date.now();
    expect(await waiting.then(() => "answered", (error: Error) => error.message)).toContain("closed");
    expect(Date.now() - started).toBeLessThan(5000);
    // and later calls fail too, rather than waiting for an answer that cannot come
    expect(await tab.run("1").then(() => "answered", () => "failed")).toBe("failed");
    await tab.close();
    expect(profiles().has(profile!)).toBe(false);
});

used("a browser that does not come up is stopped and its folder taken away at once", async () => {
    // a port that answers as Chromium's would, with no page in it, so the start waits and gives up
    const decoy = Bun.serve({ port: 0, hostname: "127.0.0.1", fetch: () => Response.json([]) });
    const before = profiles();
    const failed = await browser({ width: 400, height: 300, port: decoy.port! }).then(
        () => "",
        (error: Error) => error.message,
    );
    decoy.stop(true);
    expect(failed).toBe("Chromium did not start.");
    const left = made(before);
    expect(left).toEqual([]);
    expect(await until(() => Bun.spawnSync(["ps", "-eo", "args="]).stdout.toString().includes(`--remote-debugging-port=${decoy.port} `) === false)).toBe(true);
});

used("many browsers in one run add one set of signal handlers, not one each", async () => {
    const tabs = [await browser({ width: 300, height: 200 })];
    const counted = () => ["SIGINT", "SIGTERM", "SIGHUP", "exit"].map((name) => process.listenerCount(name));
    const first = counted();
    tabs.push(await browser({ width: 300, height: 200 }), await browser({ width: 300, height: 200 }));
    expect(counted()).toEqual(first);
    await Promise.all(tabs.map((tab) => tab.close()));
});

if (!live) console.warn("browser.test.ts: no Chromium on this machine, so the driver was not tried.");
