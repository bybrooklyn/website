// What asking for the cut-out's model is held to: with nothing kept in this browser it starts on Better,
// the smallest that cut the drawn fixtures cleanly; a quality chosen before is remembered; a damaged or
// unknown choice gives Better again. The dialog itself, asked once and fetching nothing until told, is
// held in the page's browser test (page.test.ts).

import { afterEach, expect, test } from "bun:test";
import { KEPT_CUT, rememberedCut } from "./asking";

const kept = new Map<string, string>();
globalThis.localStorage = { getItem: (key: string) => kept.get(key) ?? null, setItem: (key: string, value: string) => void kept.set(key, value), removeItem: (key: string) => void kept.delete(key) } as unknown as Storage;
afterEach(() => kept.clear());

test("the cut-out starts on Better, keeps what was chosen, and an unknown choice gives Better", () => {
    expect(rememberedCut().name).toBe("Better");
    kept.set(KEPT_CUT, "cut-quick");
    expect(rememberedCut().name).toBe("Quick");
    kept.set(KEPT_CUT, "nonsense");
    expect(rememberedCut().name).toBe("Better");
});
