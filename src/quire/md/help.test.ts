// The help (help.ts) stays short and in the site's plain manner.

import { expect, test } from "bun:test";
import { HELP } from "./help";

test("the help is under 150 words, with no dash used as punctuation", () => {
    const words = HELP.join(" ").replace("{shortcuts}", "Keyboard shortcuts (Ctrl+/)").match(/\S+/g) ?? [];
    expect(words.length).toBeLessThan(150);
    for (const paragraph of HELP) expect(paragraph).not.toMatch(/ [-–—] |—|–/);
});

test("the way to the keyboard shortcuts is in it once", () => {
    expect(HELP.filter((paragraph) => paragraph.includes("{shortcuts}"))).toHaveLength(1);
});
