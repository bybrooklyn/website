// Tests of speed print what they measured and are held to their limits only in a strict run
// (`STRICT_SPEED=1 bun test ...`), meant for a quiet machine, before a deploy say. On a busy machine a
// slow time is a warning and the run stays green, so that a red run means something is wrong, as the
// owner chose on 24 November 2026.

import { expect } from "bun:test";

/** Whether this run holds tests of speed to their limits. */
export const strictSpeed: boolean = process.env.STRICT_SPEED === "1";

/** Holds a time in milliseconds under its limit in a strict run; otherwise only says when it is over. */
export function underLimit(what: string, ms: number, limit: number): void {
    if (strictSpeed) {
        if (ms >= limit) console.error(`speed: ${what} took ${ms.toFixed(1)} ms, over its ${limit} ms`);
        expect(ms).toBeLessThan(limit);
    } else if (ms >= limit) {
        console.warn(`speed: ${what} took ${ms.toFixed(1)} ms, over its ${limit} ms; held only with STRICT_SPEED=1`);
    }
}
