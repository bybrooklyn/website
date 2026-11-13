// Her writing rules: each with sentences that must be flagged and sentences that must not, and the
// mechanical fixes giving the sentence she would write.

import { expect, test } from "bun:test";
import { read } from "../read";
import { write } from "../write";
import { check, DEFAULTS } from "./engine";
import { WRITING } from "./writing";

const found = (markdown: string, rule: string) => check(read(markdown), { settings: DEFAULTS }, WRITING).filter((one) => one.rule === rule);
const fires = (markdown: string, rule: string) => found(markdown, rule).length;
const fixed = (markdown: string, rule: string, which = 0) => {
    const [one] = found(markdown, rule);
    return write(one!.fixes[which]!.edit(read(markdown), one!.range));
};

test("a dash used as punctuation, with a full stop or a comma offered", () => {
    expect(fires("It worked — mostly.\n", "writing-dash")).toBe(1);
    expect(fires("It worked -- mostly.\n", "writing-dash")).toBe(1);
    expect(fires("From 1990–2000, and a well-known word.\n", "writing-dash")).toBe(0);
    expect(fires("Run `a — b` here.\n", "writing-dash")).toBe(0);
    expect(fixed("It worked — mostly.\n", "writing-dash")).toBe("It worked. Mostly.\n");
    expect(fixed("It worked — mostly.\n", "writing-dash", 1)).toBe("It worked, mostly.\n");
});

test("emoji, taken out", () => {
    expect(fires("Done 🎉\n", "writing-emoji")).toBe(1);
    expect(fires("Done.\n", "writing-emoji")).toBe(0);
    expect(fixed("Done 🎉\n", "writing-emoji")).toBe("Done\n");
    // the whole emoji goes, with its skin tone, selectors and joiners: nothing is left behind
    expect(fixed("Hello 👍🏽 done\n", "writing-emoji")).toBe("Hello done\n");
    expect(fixed("Hello 🏳️‍⚧️ done\n", "writing-emoji")).toBe("Hello done\n");
    expect(fixed("Go 🇬🇧 now\n", "writing-emoji")).toBe("Go now\n");
    expect(fixed("Press 1️⃣ now\n", "writing-emoji")).toBe("Press now\n");
});

test("the keep-out words", () => {
    expect(fires("A seamless journey.\n", "writing-keep-out")).toBe(2);
    expect(fires("A plain trip.\n", "writing-keep-out")).toBe(0);
});

test("\"not just X\" and \"not X, but Y\" framings", () => {
    expect(fires("It is not just a site.\n", "writing-not-just")).toBe(1);
    expect(fires("It is just a site.\n", "writing-not-just")).toBe(0);
    expect(fires("It is not a toy, but a tool.\n", "writing-not-but")).toBe(1);
    expect(fires("It is not done, and I am tired, but fine.\n", "writing-not-but")).toBe(0);
});

test("a semicolon between two sentences, and not between the items of a series", () => {
    expect(fires("The site was slow for years and nobody knew; the fonts were eleven megabytes in all.\n", "writing-semicolon")).toBe(1);
    expect(fires("It has walls; pins; ropes and a motor.\n", "writing-semicolon")).toBe(0);
    expect(fixed("The site was slow for years and nobody knew; the fonts were eleven megabytes in all.\n", "writing-semicolon")).toBe("The site was slow for years and nobody knew. The fonts were eleven megabytes in all.\n");
});

test("hedges and filler", () => {
    expect(fires("It basically works.\n", "writing-filler")).toBe(1);
    expect(fires("It works, sorted by kind of die.\n", "writing-filler")).toBe(0);
    expect(fixed("We did it in order to win.\n", "writing-filler")).toBe("We did it to win.\n");
});
