// Printing the resume's PDF, with stand-ins for Chromium: one that ends without writing (as a
// Chromium that hands the job to one already open does), and one that never ends. Held true: an
// old file where the PDF goes is never taken for the new one, and a hung print is stopped.

import { afterAll, beforeAll, expect, test } from "bun:test";
import { chmod, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { print } from "./resume-pdf";

let scratch = "";
beforeAll(async () => {
    scratch = await mkdtemp(join(tmpdir(), "resume-print-test-"));
    for (const [name, body] of [["writes-nothing", "exit 0"], ["never-ends", "exec sleep 300"]]) {
        await Bun.write(join(scratch, name!), `#!/bin/sh\n${body}\n`);
        await chmod(join(scratch, name!), 0o755);
    }
});
afterAll(() => rm(scratch, { recursive: true, force: true }));

test("a Chromium that ends without writing is an error, not the last PDF printed", async () => {
    const output = join(scratch, "resume.pdf");
    await Bun.write(output, "%PDF-1.7 an old print /Type /Page /Type /Page");
    expect(await print(join(scratch, "writes-nothing"), "http://localhost:1/resume/", output).then(String, (error: Error) => error.message)).toContain("without writing");
    expect(await Bun.file(output).exists()).toBe(false);
});

test("a print that does not end is stopped and is an error", async () => {
    const started = Date.now();
    expect(await print(join(scratch, "never-ends"), "http://localhost:1/resume/", join(scratch, "hung.pdf"), 500).then(String, (error: Error) => error.message)).toContain("was stopped");
    expect(Date.now() - started).toBeLessThan(5000);
    expect(Bun.spawnSync(["pgrep", "-f", `${scratch}/never-ends`]).exitCode).toBe(1);
});
