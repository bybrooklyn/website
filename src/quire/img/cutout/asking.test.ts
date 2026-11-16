// What asking for the cut-out's model is held to: there are two qualities, Quick and Best (ormbg); with
// nothing kept in this browser it starts on Best; a quality chosen on a past visit wins, and one kept from
// before the rename (the old Better, or the old Best that was BiRefNet) reads as Best; a damaged or unknown
// choice counts for nothing. The dialog itself, asked once and fetching nothing until told, is held in the
// page's browser test (page.test.ts).

import { afterEach, expect, test } from "bun:test";
import { CUT_TIERS } from "../parts/models";
import { KEPT_CUT, rememberedCut, startingCut } from "./asking";

const kept = new Map<string, string>();
globalThis.localStorage = { getItem: (key: string) => kept.get(key) ?? null, setItem: (key: string, value: string) => void kept.set(key, value), removeItem: (key: string) => void kept.delete(key) } as unknown as Storage;
afterEach(() => kept.clear());

test("there are two qualities, Quick and Best, both ormbg's and MODNet's files and neither for the graphics card alone", () => {
    expect(CUT_TIERS.map((tier) => [tier.name, tier.matte])).toEqual([
        ["Quick", "modnet"],
        ["Best", "ormbg"],
    ]);
    expect(CUT_TIERS.every((tier) => tier.card.length === 0)).toBe(true);
});

test("the cut-out starts on Best, a quality chosen before wins, the old Better and the old Best read as Best, and an unknown one counts for nothing", () => {
    expect(rememberedCut()).toBeUndefined();
    expect(startingCut().name).toBe("Best");
    kept.set(KEPT_CUT, "cut-quick");
    expect(startingCut().name).toBe("Quick");
    kept.set(KEPT_CUT, "cut-better");
    expect(startingCut().name).toBe("Best");
    expect(startingCut().matte).toBe("ormbg");
    kept.set(KEPT_CUT, "cut-best");
    expect(startingCut().name).toBe("Best");
    expect(startingCut().matte).toBe("ormbg");
    kept.set(KEPT_CUT, "nonsense");
    expect(startingCut().name).toBe("Best");
});
