// What the table of restoring models is held to: each model pinned to a commit with its size and SHA-256, its
// job and scale as its name says, found by its id; and an enlargement is refused past a picture's largest side
// or past the most pixels the page holds.

import { expect, test } from "bun:test";
import { enlargedSize, ENLARGE_MODELS, MOST_ENLARGED, REPAIR_MODELS, RESTORE_MODELS, restoreModelOf } from "./models";

test("every model is pinned, sized and found by its id, and an enlargement too large is refused", () => {
    expect(RESTORE_MODELS().length).toBe(3);
    for (const each of RESTORE_MODELS()) {
        expect(each.revision).toMatch(/^[0-9a-f]{40}$/);
        expect(each.sha256).toMatch(/^[0-9a-f]{64}$/);
        expect(each.bytes).toBeGreaterThan(1_000_000);
        expect(each.places.length).toBeGreaterThan(0);
        expect(each.license.length).toBeGreaterThan(0);
        expect(restoreModelOf(each.id)).toBe(each);
    }
    expect(REPAIR_MODELS.every((each) => each.job === "repair" && each.scale === 1)).toBe(true);
    expect(ENLARGE_MODELS.every((each) => each.job === "enlarge" && each.scale === 2)).toBe(true);
    expect(restoreModelOf("nothing")).toBeUndefined();
    expect(enlargedSize({ width: 2000, height: 1500 }, { scale: 4 })).toEqual({ width: 8000, height: 6000 });
    expect(enlargedSize({ width: 4000, height: 3000 }, { scale: 4 })).toBeUndefined();
    expect(enlargedSize({ width: 5000, height: 3000 }, { scale: 2 })).toEqual({ width: 10000, height: 6000 });
    expect(enlargedSize({ width: 8000, height: 4100 }, { scale: 2 })).toBeUndefined();
    expect(MOST_ENLARGED).toBe(64_000_000);
});
