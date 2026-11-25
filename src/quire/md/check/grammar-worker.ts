// Harper (harper.js, its slim WebAssembly build, Apache-2.0) in a worker of the site's own: it lints the
// plain text of one paragraph at a time and answers with what it found (grammar-lint.ts), so that typing
// never waits for it. Harper's own WorkerLinter is made from a data: address, which the page policy
// refuses, so its LocalLinter runs here instead.

import { Dialect, LocalLinter } from "harper.js";
import { slimBinary } from "harper.js/slimBinary";
import type { Lint } from "./engine";
import { lintWith } from "./grammar-lint";

/** What the page asks: the dialect to lint in, or a text to lint. */
export type ToGrammar = { dialect: "us" | "gb" } | { id: number; text: string };
/** What the worker answers: a text's lints, or that Harper could not be started. */
export type FromGrammar = { id: number; lints: Lint[] } | { failed: string };

const linter = new LocalLinter({ binary: slimBinary, dialect: Dialect.American });

self.onmessage = async (event: MessageEvent<ToGrammar>) => {
    const asked = event.data;
    try {
        if ("dialect" in asked) await linter.setDialect(asked.dialect === "gb" ? Dialect.British : Dialect.American);
        else self.postMessage({ id: asked.id, lints: await lintWith(linter, asked.text) } satisfies FromGrammar);
    } catch (error) {
        self.postMessage({ failed: String(error) } satisfies FromGrammar);
    }
};
