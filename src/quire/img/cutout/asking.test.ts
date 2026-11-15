// What asking for the cut-out's model is held to: with nothing kept in this browser it starts by the
// machine, on Best where there is a graphics card and on Better where there is none; a quality chosen on
// a past visit wins; a damaged or unknown choice counts for nothing. The dialog itself, asked once and fetching nothing until told, is
// held in the page's browser test (page.test.ts).

import { afterEach, expect, test } from "bun:test";
import { KEPT_CUT, rememberedCut, startingCut } from "./asking";

const kept = new Map<string, string>();
globalThis.localStorage = { getItem: (key: string) => kept.get(key) ?? null, setItem: (key: string, value: string) => void kept.set(key, value), removeItem: (key: string) => void kept.delete(key) } as unknown as Storage;
afterEach(() => kept.clear());

test("the cut-out starts on Best on a machine with a graphics card and on Better without, a quality chosen before wins, and an unknown one counts for nothing", () => {
    expect(rememberedCut()).toBeUndefined();
    expect(startingCut(true).name).toBe("Best");
    expect(startingCut(false).name).toBe("Better");
    kept.set(KEPT_CUT, "cut-quick");
    expect(startingCut(true).name).toBe("Quick");
    kept.set(KEPT_CUT, "nonsense");
    expect(startingCut(false).name).toBe("Better");
});
