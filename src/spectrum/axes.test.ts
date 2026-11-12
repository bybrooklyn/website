// What the list of sliders is held to: nine of them, the two taken out stay out, and every slider
// starts in the middle. Run with `bun run test`.

import { expect, test } from "bun:test";
import { axes, kept, start } from "./axes";

test("there are nine sliders, and the two taken out are not among them", () => {
    expect(axes).toHaveLength(9);
    expect(axes as readonly string[]).not.toContain("kinkRole");
    expect(axes as readonly string[]).not.toContain("sexualExploration");
});

test("the sliders keep the order of the old eleven, so an old code's first nine digits are theirs", () => {
    const old = ["genderIdentity", "genderExpression", "sexualOrientation", "romanticOrientation", "sexualAttraction", "sexualDrive", "romanticDesire", "relationshipAttitude", "genderComfort", "kinkRole", "sexualExploration"];
    expect([...axes] as string[]).toEqual(old.slice(0, 9));
});

test("every slider starts in the middle, and only whole numbers from 1 to 9 are kept", () => {
    expect(start()).toEqual([5, 5, 5, 5, 5, 5, 5, 5, 5]);
    expect([1, 9, 5].map(kept)).toEqual([1, 9, 5]);
    expect([0, 10, -1, 4.5, Number.NaN].map(kept)).toEqual([0, 0, 0, 0, 0]);
});
