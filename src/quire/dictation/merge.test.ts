// Words and their times: two words compared by their letters alone, and a transcript without times
// spread evenly over its stretch of sound.

import { expect, test } from "bun:test";
import { same, spread } from "./merge";

test("same compares letters and digits only", () => {
    expect(same("Hello,")).toBe("hello");
    expect(same("don't")).toBe("dont");
});

test("spread gives text without times even times from start to end", () => {
    const spoken = spread("a b c d", 10, 12);
    expect(spoken.map((word) => word.start)).toEqual([10, 10.5, 11, 11.5]);
    expect(spoken[3]!.end).toBe(12);
    expect(spread("", 0, 1)).toEqual([]);
});
