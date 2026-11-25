// The real Harper engine, as the grammar worker runs it: its lints read into mdQuire's own, with their
// rules, fixes and spans, the spans in the page's UTF-16 units past an emoji.

import { expect, test } from "bun:test";
import { Dialect, LocalLinter } from "harper.js";
import { slimBinary } from "harper.js/slimBinary";
import { lintWith } from "./grammar-lint";

test("the real Harper, as the worker runs it, finds agreement and a wrong article, its spans in UTF-16 past an emoji", async () => {
    const linter = new LocalLinter({ binary: slimBinary, dialect: Dialect.American });
    const text = "🎉 They was waiting. I ate a apple.";
    const lints = await lintWith(linter, text);
    const byRule = Object.fromEntries(lints.map((one) => [one.rule, text.slice(one.from, one.to)]));
    expect(byRule.PronounInflectionBe).toBe("was");
    expect(byRule.AnA).toBe("a");
    expect(lints.find((one) => one.rule === "AnA")!.fixes[0]!.text).toBe("an");
}, 30_000);

