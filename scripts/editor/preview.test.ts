// The editor's dev server for the page beside the text, with `bunx` replaced by a stand-in that
// starts a sleeping process as Astro would start a server (its own process group, written down in
// .astro/dev.json), or says one is already running. No real server is started or stopped. Held
// true: what the editor started it stops; what it did not start, it never stops. (Nothing answers
// at the address in the first two, so each waits out the ten seconds a server is given to come up.)

import { afterAll, beforeAll, expect, test } from "bun:test";
import { chmod, mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { preview } from "./preview";

let scratch = "";
let path = "";
const spawned: number[] = [];
const alive = (pid: number) => {
    try {
        process.kill(pid, 0);
        return true;
    } catch {
        return false;
    }
};
/** An address on this computer where nothing answers. */
const silent = () => {
    const probe = Bun.serve({ port: 0, hostname: "127.0.0.1", fetch: () => new Response() });
    const address = `http://127.0.0.1:${probe.port}/`;
    probe.stop(true);
    return address;
};

beforeAll(async () => {
    scratch = await mkdtemp(join(tmpdir(), "edit-preview-"));
    await mkdir(join(scratch, "bin"));
    await mkdir(join(scratch, "site/.astro"), { recursive: true });
    // starts a server-like process unless told one is running already
    const stand = `#!/bin/sh\necho "$*" >> ${scratch}/calls.log\nif [ -f ${scratch}/running ]; then exit 0; fi\nsetsid sleep 300 > /dev/null 2>&1 &\necho "{\\"pid\\": $!, \\"port\\": 4321, \\"url\\": \\"x\\", \\"background\\": true, \\"startedAt\\": \\"now\\"}" > .astro/dev.json\n`;
    await Bun.write(join(scratch, "bin/bunx"), stand);
    await chmod(join(scratch, "bin/bunx"), 0o755);
    path = process.env.PATH ?? "";
    process.env.PATH = `${join(scratch, "bin")}:${path}`;
});

afterAll(async () => {
    process.env.PATH = path;
    for (const pid of spawned) if (alive(pid)) process.kill(pid, "SIGKILL");
    await rm(scratch, { recursive: true, force: true });
});

const lock = async () => JSON.parse(await Bun.file(join(scratch, "site/.astro/dev.json")).text()) as { pid: number };

test("a server the editor started is stopped when it ends, and stopping twice does no harm", async () => {
    const stop = await preview(join(scratch, "site"), silent());
    const { pid } = await lock();
    spawned.push(pid);
    expect(alive(pid)).toBe(true);
    stop();
    stop();
    for (let tries = 0; tries < 40 && alive(pid); tries++) await Bun.sleep(25);
    expect(alive(pid)).toBe(false);
}, 20_000);

test("a server someone else started for the folder, named in Astro's lock, is never stopped", async () => {
    const theirs = Bun.spawn(["sleep", "300"]);
    spawned.push(theirs.pid);
    await Bun.write(join(scratch, "site/.astro/dev.json"), JSON.stringify({ pid: theirs.pid, port: 4330, url: "x", background: true, startedAt: "now" }));
    await Bun.write(join(scratch, "running"), "");
    const stop = await preview(join(scratch, "site"), silent());
    stop();
    await Bun.sleep(100);
    expect(alive(theirs.pid)).toBe(true);
    await rm(join(scratch, "running"));
}, 20_000);

test("a server already answering at the address is used as it is, not started and not stopped", async () => {
    const answering = Bun.serve({ port: 0, hostname: "127.0.0.1", fetch: () => new Response("here") });
    await Bun.write(join(scratch, "calls.log"), "");
    const stop = await preview(join(scratch, "site"), `http://127.0.0.1:${answering.port}/`);
    stop();
    expect(await Bun.file(join(scratch, "calls.log")).text()).toBe("");
    expect(await fetch(`http://127.0.0.1:${answering.port}/`).then((answer) => answer.text())).toBe("here");
    answering.stop(true);
});
