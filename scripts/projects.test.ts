// `bun run projects` against a stand-in for gh, in a scratch copy of the script: the real gh and
// GitHub are never asked. Held true: only GitHub's "not found" counts as a project with no
// repository yet; any other failure stops the run and leaves the facts file as it was.

import { afterEach, beforeEach, expect, test } from "bun:test";
import { $ } from "bun";
import { chmod, mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const repo = resolve(import.meta.dir, "..");
const FACTS = '{\n    "kept": {"stars":3}\n}\n';
let scratch = "";

beforeEach(async () => {
    scratch = await mkdtemp(join(tmpdir(), "projects-script-"));
    for (const folder of ["site/scripts", "site/src/content/projects", "site/src/data", "bin"]) await mkdir(join(scratch, folder), { recursive: true });
    await $`cp scripts/projects.ts scripts/lib.ts ${join(scratch, "site/scripts")}/`.cwd(repo).quiet();
    await Bun.write(join(scratch, "site/src/content/projects/one.mdx"), "---\nname: One\nrepo: someone/one\n---\n");
    await Bun.write(join(scratch, "site/src/data/project-facts.json"), FACTS);
});
afterEach(() => rm(scratch, { recursive: true, force: true }));

/** Runs the script with a gh that prints `said` to stderr and exits with `code`. */
async function run(said: string, code: number) {
    await Bun.write(join(scratch, "bin/gh"), `#!/bin/sh\necho ${JSON.stringify(said)} >&2\nexit ${code}\n`);
    await chmod(join(scratch, "bin/gh"), 0o755);
    const ran = Bun.spawnSync([process.execPath, "scripts/projects.ts"], { cwd: join(scratch, "site"), env: { ...process.env, PATH: `${join(scratch, "bin")}:${process.env.PATH}` }, stderr: "pipe", stdout: "pipe" });
    return { code: ran.exitCode, facts: await Bun.file(join(scratch, "site/src/data/project-facts.json")).text() };
}

test("gh logged out, offline or refused stops the run and writes nothing", async () => {
    for (const said of ["gh: Bad credentials (HTTP 401)", "error connecting to api.github.com", "gh: API rate limit exceeded (HTTP 403)"]) {
        const result = await run(said, 1);
        expect(result.code).toBe(1);
        expect(result.facts).toBe(FACTS);
    }
});

test("a repository GitHub does not find is a project with no repository yet", async () => {
    const result = await run("gh: Not Found (HTTP 404)", 1);
    expect(result.code).toBe(0);
    expect(result.facts).toBe("{\n\n}\n");
});
