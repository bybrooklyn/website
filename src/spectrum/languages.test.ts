// What the languages are held to: `?l=` picks one or falls back to English, a language without a
// word borrows the English one, the two sliders taken out are in none of them, and Arabic alone runs
// right to left. Run with `bun run test`.

import { expect, test } from "bun:test";
import { axes, groups } from "./axes";
import { address, breakable, codes, languages, pick, said, words } from "./languages";

test("the five languages, in the picker's order", () => {
    expect(codes).toEqual(["en", "pl", "de", "ar", "pt"]);
});

test("?l= picks a known language, and anything else is English", () => {
    for (const code of codes) expect(pick(code)).toBe(code);
    expect(pick(" PL ")).toBe("pl");
    expect(pick("pt-BR")).toBe("pt");
    expect(pick("en-US")).toBe("en");
    for (const asked of ["xx", "", null, undefined, "plx", "-"]) expect(pick(asked)).toBe("en");
});

test("English has every word, and every language has every word through it", () => {
    for (const code of codes) {
        const all = words(code);
        for (const axis of axes) for (const word of Object.values(all.axes[axis])) expect(word.length).toBeGreaterThan(0);
        for (const group of groups) expect(all.corners[group.key]!.length).toBeGreaterThan(0);
        for (const word of [all.title, all.question, all.share, all.copy, all.copied, all.unset, all.chart, all.hint, all.empty]) expect(word.length).toBeGreaterThan(0);
    }
});

test("a language's own words are used, and English only where it has none", () => {
    expect(words("pl").axes.genderIdentity.label).toBe("Identyfikacja płciowa");
    expect(words("pl").axes.sexualAttraction.label).toBe("Sexual attraction");
    expect(words("de").title).toBe("Geschlechtliches & Sexuelles Spektrum");
    expect(words("de").unset).toBe("Not set");
});

test("the two sliders taken out, and their corner, are in no language", () => {
    for (const language of Object.values(languages)) {
        expect(Object.keys(language.axes)).not.toContain("kinkRole");
        expect(Object.keys(language.axes)).not.toContain("sexualExploration");
        expect(Object.keys(language.corners)).not.toContain("kink");
        for (const key of Object.keys(language.axes)) expect(axes as readonly string[]).toContain(key);
    }
});

test("only Arabic runs right to left", () => {
    for (const code of codes) expect(words(code).rtl).toBe(code === "ar");
});

test("a slider's value is said as the nearest of its five words, or unset", () => {
    const english = words("en");
    expect([0, 1, 2, 3, 4, 5, 6, 7, 8, 9].map((value) => said(english, "sexualDrive", value))).toEqual(["Not set", "None", "None", "Low", "Low", "Regular", "High", "High", "Very high", "Very high"]);
});

test("words may break after a slash, and read the same", () => {
    expect(breakable("Bisexual/Pansexual")).toBe("Bisexual/​Pansexual");
    expect(breakable("Bisexual/Pansexual").replace(/​/g, "")).toBe("Bisexual/Pansexual");
    expect(breakable("Open")).toBe("Open");
});

test("a page's address carries the code, and the language only when it is not English", () => {
    expect(address("0BB3nt", "en")).toBe("/spectrum/?c=0BB3nt");
    expect(address("0BB3nt", "ar")).toBe("/spectrum/?c=0BB3nt&l=ar");
    expect(address(undefined, "pl")).toBe("/spectrum/?l=pl");
    expect(address(undefined, "en")).toBe("/spectrum/");
});
