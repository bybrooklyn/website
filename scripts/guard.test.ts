// The deploy guard's rule: main with nothing uncommitted goes ahead, anything else is refused with
// its reason.

import { expect, test } from "bun:test";
import { refusal } from "./guard";

test("a deploy goes ahead only from main with nothing uncommitted", () => {
    expect(refusal("main", "")).toBeUndefined();
    expect(refusal("main", "\n")).toBeUndefined();
    expect(refusal("fix-something", "")).toContain("Deploys are made from main");
    expect(refusal("main", " M src/pages/index.astro")).toContain("One file has changes");
    expect(refusal("main", " M a.ts\n?? b.ts")).toContain("2 files have changes");
});
