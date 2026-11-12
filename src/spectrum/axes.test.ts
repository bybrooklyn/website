// What the list of sliders is held to: nine of them, the two taken out stay out, every slider
// starts in the middle of its seventeen positions, and the original's nine land where they were.
// Run with `bun run test`.

import { expect, test } from "bun:test";
import { axes, kept, start, widened } from "./axes";

test("there are nine sliders, and the two taken out are not among them", () => {
    expect(axes).toHaveLength(9);
    expect(axes as readonly string[]).not.toContain("kinkRole");
    expect(axes as readonly string[]).not.toContain("sexualExploration");
});

test("the sliders keep the order of the old eleven, so an old code's first nine digits are theirs", () => {
    const old = ["genderIdentity", "genderExpression", "sexualOrientation", "romanticOrientation", "sexualAttraction", "sexualDrive", "romanticDesire", "relationshipAttitude", "genderComfort", "kinkRole", "sexualExploration"];
    expect([...axes] as string[]).toEqual(old.slice(0, 9));
});

test("every slider starts in the middle, and only whole numbers from 1 to 17 are kept", () => {
    expect(start()).toEqual([9, 9, 9, 9, 9, 9, 9, 9, 9]);
    expect([1, 17, 9, 2].map(kept)).toEqual([1, 17, 9, 2]);
    expect([0, 18, -1, 4.5, Number.NaN].map(kept)).toEqual([0, 0, 0, 0, 0]);
});

test("the original's nine positions are every other one of the seventeen, at both ends and the middle", () => {
    expect([1, 2, 3, 4, 5, 6, 7, 8, 9].map(widened)).toEqual([1, 3, 5, 7, 9, 11, 13, 15, 17]);
    expect([0, 10, -1].map(widened)).toEqual([0, 0, 0]);
});
