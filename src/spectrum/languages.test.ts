// What the languages are held to: `?l=` picks one or falls back to English, a language without a
// word borrows the English one, the two sliders taken out are in none of them, and Arabic alone runs
// right to left. Run with `bun run test`.

import { expect, test } from "bun:test";
import { axes } from "./axes";
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
        for (const word of [all.title, all.question, all.share, all.copy, all.copied, all.unset]) expect(word.length).toBeGreaterThan(0);
    }
});

test("a language's own words are used, and English only where it has none", () => {
    expect(words("pl").axes.genderIdentity.label).toBe("Identyfikacja płciowa");
    expect(words("pl").axes.sexualAttraction.label).toBe("Sexual attraction");
    expect(words("de").title).toBe("Geschlechtliches & Sexuelles Spektrum");
    expect(words("de").unset).toBe("Not set");
});

test("the two sliders taken out are in no language", () => {
    for (const language of Object.values(languages)) {
        expect(Object.keys(language.axes)).not.toContain("kinkRole");
        expect(Object.keys(language.axes)).not.toContain("sexualExploration");
        for (const key of Object.keys(language.axes)) expect(axes as readonly string[]).toContain(key);
    }
});

test("only Arabic runs right to left", () => {
    for (const code of codes) expect(words(code).rtl).toBe(code === "ar");
});

test("a slider's place is said by its number and the words at its ends and middle, or unset", () => {
    const english = words("en");
    const say = (value: number) => said(english, "genderIdentity", value);
    expect(say(0)).toBe("Not set");
    expect(say(1)).toBe("1 of 17, Man");
    expect(say(2)).toBe("2 of 17, between Man and Nonbinary, nearer Man");
    expect(say(5)).toBe("5 of 17, halfway between Man and Nonbinary");
    expect(say(7)).toBe("7 of 17, between Man and Nonbinary, nearer Nonbinary");
    expect(say(9)).toBe("9 of 17, Nonbinary");
    expect(say(12)).toBe("12 of 17, between Nonbinary and Woman, nearer Nonbinary");
    expect(say(13)).toBe("13 of 17, halfway between Nonbinary and Woman");
    expect(say(16)).toBe("16 of 17, between Nonbinary and Woman, nearer Woman");
    expect(say(17)).toBe("17 of 17, Woman");
    expect(say(18)).toBe("Not set");
});

test("no language keeps a word for each step between the ends and the middle", () => {
    for (const language of Object.values(languages)) for (const ends of Object.values(language.axes)) expect(Object.keys(ends!).sort()).toEqual(["farLeft", "farRight", "label", "middle"]);
});

test("in another language the words at the ends are its own, and the rest of the sentence is English", () => {
    expect(said(words("pl"), "genderIdentity", 3)).toBe("3 of 17, between Mężczyzna and Niebinarnie, nearer Mężczyzna");
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
