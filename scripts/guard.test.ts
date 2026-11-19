// The deploy guard's rule: main with nothing uncommitted goes ahead, anything else is refused with
// its reason. And where it stands in `bun run deploy`: before the check, and again after the build.

import { expect, test } from "bun:test";
import { refusal } from "./guard";
import { root } from "./lib";

test("a deploy goes ahead only from main with nothing uncommitted", () => {
    expect(refusal("main", "")).toBeUndefined();
    expect(refusal("main", "\n")).toBeUndefined();
    expect(refusal("fix-something", "")).toContain("Deploys are made from main");
    expect(refusal("main", " M src/pages/index.astro")).toContain("One file has changes");
    expect(refusal("main", " M a.ts\n?? b.ts")).toContain("2 files have changes");
});

test("the deploy asks the guard again after the build, which can add pictures that were waiting", async () => {
    const { scripts } = (await Bun.file(`${root}/package.json`).json()) as { scripts: Record<string, string> };
    const steps = scripts.deploy!.split("&&").map((step) => step.trim());
    const [build, deploy] = [steps.indexOf("bun run build"), steps.findIndex((step) => step.startsWith("wrangler pages deploy"))];
    expect(steps[0]).toBe("bun scripts/guard.ts");
    expect(build).toBeGreaterThan(0);
    expect(steps.slice(build + 1, deploy)).toContain("bun scripts/guard.ts");
});
