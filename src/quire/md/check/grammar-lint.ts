// What the grammar worker does with each text, apart from the worker so that it can be tested: Harper's
// lints, grouped by the rule that found them, turned into mdQuire's own (engine.ts, Lint). Harper's own
// documents say its spans count code points; harper.js gives them in UTF-16 units already, the page's own
// count, as the test past an emoji shows, so they are used as they come.

import { SuggestionKind, type LocalLinter } from "harper.js";
import type { Lint } from "./engine";

/** What Harper finds in a text, as mdQuire's lints, in order. */
export async function lintWith(linter: LocalLinter, text: string): Promise<Lint[]> {
    const groups = await linter.organizedLints(text);
    const out: Lint[] = [];
    for (const [rule, lints] of Object.entries(groups)) {
        for (const one of lints) {
            const span = one.span();
            out.push({
                from: Math.min(span.start, text.length),
                to: Math.min(span.end, text.length),
                rule,
                kind: one.lint_kind(),
                message: one.message(),
                fixes: one.suggestions().map((fix) => ({ text: fix.kind() === SuggestionKind.Remove ? "" : fix.get_replacement_text(), after: fix.kind() === SuggestionKind.InsertAfter })),
            });
            one.free();
        }
    }
    return out.sort((a, b) => a.from - b.from);
}
