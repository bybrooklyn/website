// `bun run photos` in a scratch copy holding two photos, with no pictures waiting. Held true: a
// photo whose file was deleted is taken off, but a photos folder that cannot be read stops the run
// with every photo left listed, instead of being taken for an empty one.

import { afterEach, beforeEach, expect, test } from "bun:test";
import { $ } from "bun";
import { chmod, mkdir, mkdtemp, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const repo = resolve(import.meta.dir, "..");
const LISTED = '{\n    "photos": [\n        {"file":"one.avif","width":1,"height":1,"color":"#000000"},\n        {"file":"two.avif","width":1,"height":1,"color":"#000000"}\n    ]\n}\n';
let site = "";

beforeEach(async () => {
    site = await mkdtemp(join(tmpdir(), "photos-script-"));
    for (const folder of ["scripts", "src/data", "public/photos/s"]) await mkdir(join(site, folder), { recursive: true });
    await $`cp scripts/photos.ts scripts/exif.ts scripts/lib.ts ${join(site, "scripts")}/`.cwd(repo).quiet();
    await symlink(join(repo, "node_modules"), join(site, "node_modules"));
    await Bun.write(join(site, "src/data/photos.json"), LISTED);
    for (const name of ["one.avif", "two.avif", "s/one.avif", "s/two.avif"]) await Bun.write(join(site, "public/photos", name), "picture");
});
afterEach(async () => {
    await chmod(join(site, "public/photos"), 0o755).catch(() => {});
    await rm(site, { recursive: true, force: true });
});

const run = () => Bun.spawnSync([process.execPath, "scripts/photos.ts"], { cwd: site, stdout: "pipe", stderr: "pipe" });
const listed = () => Bun.file(join(site, "src/data/photos.json")).text();

test("a photo whose file was deleted is taken off the list, with its small copy", async () => {
    await rm(join(site, "public/photos/two.avif"));
    expect(run().exitCode).toBe(0);
    expect(await listed()).not.toContain("two.avif");
    expect(await listed()).toContain("one.avif");
    expect(await Bun.file(join(site, "public/photos/s/two.avif")).exists()).toBe(false);
});

test("a photos folder that cannot be read stops the run, and nothing is taken off", async () => {
    // it can be passed through, so its small copies can be reached, but not listed
    await chmod(join(site, "public/photos"), 0o300);
    expect(run().exitCode).not.toBe(0);
    await chmod(join(site, "public/photos"), 0o755);
    expect(await listed()).toBe(LISTED);
    expect(await Bun.file(join(site, "public/photos/s/two.avif")).exists()).toBe(true);
});

test("a photos folder that is not there while photos are listed (a link to a drive not mounted) stops the run too", async () => {
    await rm(join(site, "public/photos"), { recursive: true });
    await symlink(join(site, "not-mounted"), join(site, "public/photos"));
    expect(run().exitCode).not.toBe(0);
    expect(await listed()).toBe(LISTED);
});
