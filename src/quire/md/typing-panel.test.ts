// A group's switch in Typing preferences (typing-panel.ts) turns the whole group one way.

import { expect, test } from "bun:test";
import { groupTurned } from "./typing-panel";

test("a group all on is switched off whole, and a group with any off is switched back on whole, leaving other rows as they were", () => {
    const ids = ["bold", "italic", "heading"];
    expect(groupTurned(new Set(["spoiler"]), ids)).toEqual(new Set(["spoiler", "bold", "italic", "heading"]));
    expect(groupTurned(new Set(["spoiler", "italic"]), ids)).toEqual(new Set(["spoiler"]));
    expect(groupTurned(new Set(["spoiler", "bold", "italic", "heading"]), ids)).toEqual(new Set(["spoiler"]));
});
