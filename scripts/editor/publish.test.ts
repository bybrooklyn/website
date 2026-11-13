// The editor's Publish, run for real in a scratch copy of the site that is a git repository of its
// own, with a bare repository beside it as the place it pushes to. `bun` and `bunx` are replaced
// on the server's PATH by a script that only writes down how it was called, so nothing is built
// and nothing is deployed: the test reads that record, and the scratch repository's history.

import { afterAll, beforeAll, expect, test } from "bun:test";
import { $ } from "bun";
import { chmod, mkdir, mkdtemp, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const repo = resolve(import.meta.dir, "../..");
let scratch = "";
let copy = "";
let calls = "";
let server: ReturnType<typeof Bun.spawn> | undefined;
let address = "";
let key = "";

beforeAll(async () => {
    scratch = await mkdtemp(join(tmpdir(), "publish-site-"));
    copy = join(scratch, "site");
    calls = join(scratch, "calls.log");
    await mkdir(join(copy, "public"), { recursive: true });
    await $`cp -r scripts src package.json tsconfig.json .gitignore ${copy}/`.cwd(repo).quiet();
    await Bun.write(join(copy, "public/robots.txt"), "User-agent: *\n");
    await symlink(join(repo, "node_modules"), join(copy, "node_modules"));
    // the stand-in for bun and bunx: it notes its arguments, and when asked to build it can change a file as a late save would
    const stand = join(scratch, "bin");
    await mkdir(stand);
    const script = `#!/bin/sh\necho "$(basename "$0") $*" >> ${calls}\nif [ "$1 $2" = "run build" ] && [ -f ${scratch}/save-during-build ]; then echo "late" >> ${copy}/src/content/blog/kitchen-sink.mdx; fi\nexit 0\n`;
    for (const name of ["bun", "bunx"]) {
        await Bun.write(join(stand, name), script);
        await chmod(join(stand, name), 0o755);
    }
    const git = (args: string[]) => $`git ${args}`.cwd(copy).quiet();
    await $`git init -q --bare -b main ${join(scratch, "remote.git")}`.quiet();
    await git(["init", "-q", "-b", "main"]);
    for (const [name, value] of [["user.name", "Test"], ["user.email", "test@example.invalid"], ["commit.gpgsign", "false"], ["core.hooksPath", "/dev/null"]]) await git(["config", name!, value!]);
    await git(["add", "-A"]);
    await git(["commit", "-q", "-m", "start"]);
    await git(["remote", "add", "origin", join(scratch, "remote.git")]);
    await git(["push", "-q", "-u", "origin", "main"]);

    const port = 4900 + Math.floor(Math.random() * 90);
    server = Bun.spawn([process.execPath, "scripts/write.ts", "--no-open", "--no-preview", "--port", String(port)], { cwd: copy, stdout: "pipe", stderr: "pipe", env: { ...process.env, PATH: `${stand}:${process.env.PATH}` } });
    const reader = (server.stdout as ReadableStream<Uint8Array>).getReader();
    let printed = "";
    while (!/\?k=\w+/.test(printed)) {
        const { value, done } = await reader.read();
        if (done) throw new Error(`The server stopped: ${printed}`);
        printed += new TextDecoder().decode(value);
    }
    address = /(http:\/\/127\.0\.0\.1:\d+)\//.exec(printed)![1]!;
    key = /\?k=(\w+)/.exec(printed)![1]!;
}, 60_000);

afterAll(async () => {
    server?.kill("SIGINT");
    await server?.exited;
    await rm(scratch, { recursive: true, force: true });
});

const publish = async () => (await (await fetch(`${address}/api/publish`, { method: "POST", headers: { "x-edit-key": key, "content-type": "application/json" }, body: JSON.stringify({ message: "From the test" }) })).json()) as { ok: boolean; log: string };
const git = async (...args: string[]) => (await $`git ${args}`.cwd(copy).quiet().text()).trim();
const called = async () => ((await Bun.file(calls).exists()) ? await Bun.file(calls).text() : "");

test("a new file outside src/ and public/ stops publishing before anything is committed or deployed", async () => {
    await Bun.write(join(copy, "password.txt"), "not for git");
    const result = await publish();
    expect(result.ok).toBe(false);
    expect(result.log).toContain("password.txt");
    expect(await git("log", "--format=%s")).toBe("start");
    expect(await called()).toBe("");
    await rm(join(copy, "password.txt"));
});

test("only src/ and public/ are committed, then the site is deployed", async () => {
    await Bun.write(join(copy, "src/content/blog/kitchen-sink.mdx"), `${await Bun.file(join(copy, "src/content/blog/kitchen-sink.mdx")).text()}\nA new line.\n`);
    await Bun.write(join(copy, "src/assets/posts/new-picture.png"), "png");
    await Bun.write(join(copy, "package.json"), `${await Bun.file(join(copy, "package.json")).text()}\n`);
    const result = await publish();
    expect(result.log).toEndWith("Deployed.");
    expect(result.ok).toBe(true);
    expect(await git("log", "-1", "--format=%s")).toBe("From the test");
    expect((await git("show", "--name-only", "--format=", "HEAD")).split("\n").sort()).toEqual(["src/assets/posts/new-picture.png", "src/content/blog/kitchen-sink.mdx"]);
    // what is not the editor's is left as it was, not committed
    expect(await git("status", "--porcelain")).toBe("M package.json");
    expect(await git("rev-parse", "origin/main")).toBe(await git("rev-parse", "HEAD"));
    expect((await called()).trim().split("\n")).toEqual(["bunx wrangler pages deploy --branch main"]);
});
