// `bun run pictures --check`, in a scratch copy of the site. Held true: a picture whose record says
// it was made from other words fails the check; one with no record passes with a note; and a
// picture made by the script is recorded, so that changing what it shows makes it fail. The last
// needs Chromium (the site's own card is made, which takes a moment) and is skipped without it.

import { afterAll, beforeAll, expect, test } from "bun:test";
import { $ } from "bun";
import { mkdtemp, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { chromium } from "./browser";

const repo = resolve(import.meta.dir, "..");
let copy = "";

beforeAll(async () => {
    copy = await mkdtemp(join(tmpdir(), "pictures-script-"));
    await $`cp -r scripts src package.json tsconfig.json ${copy}/`.cwd(repo).quiet();
    await symlink(join(repo, "node_modules"), join(copy, "node_modules"));
    await rm(join(copy, "src/assets/share/made-from.json"), { force: true });
});
afterAll(() => rm(copy, { recursive: true, force: true }));

const run = (...args: string[]) => {
    const ran = Bun.spawnSync([process.execPath, "scripts/pictures.ts", ...args], { cwd: copy, stdout: "pipe", stderr: "pipe" });
    return { code: ran.exitCode, out: ran.stdout.toString(), error: ran.stderr.toString() };
};
const record = (value: object) => Bun.write(join(copy, "src/assets/share/made-from.json"), JSON.stringify(value));

test("a picture with no record of what it was made from passes, with a note", () => {
    const checked = run("--check");
    expect(checked.code).toBe(0);
    expect(checked.out).toContain("not checked");
    expect(checked.out).toContain("post-colophon");
});

test("a picture recorded as made from other words fails the check, by name", async () => {
    await record({ "post-colophon": "something-else" });
    const checked = run("--check");
    expect(checked.code).toBe(1);
    expect(checked.error).toContain("bun run pictures post-colophon");
    expect(checked.out).not.toContain("post-colophon");
    await rm(join(copy, "src/assets/share/made-from.json"));
});

test.skipIf(!chromium())(
    "a picture the script makes is recorded, and goes out of date when what it shows changes",
    async () => {
        expect(run("site").code).toBe(0);
        expect(Object.keys(await Bun.file(join(copy, "src/assets/share/made-from.json")).json())).toEqual(["site"]);
        expect(run("--check").code).toBe(0);
        const file = join(copy, "src/data/site.ts");
        await Bun.write(file, (await Bun.file(file).text()).replace('name: "Charlotte"', 'name: "Someone Else"'));
        const checked = run("--check");
        expect(checked.code).toBe(1);
        expect(checked.error).toContain("bun run pictures site");
    },
    60_000,
);
