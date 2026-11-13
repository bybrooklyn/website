// The tone tags: the list holds together, and the search finds what a person would type.
import { expect, test } from "bun:test";
import { find, named, stem, tags, tidy, words } from "./tags";

test("a tag named in the address is read without its slash, and a broken hash does not throw", () => {
    expect(named("#srs")).toBe("srs");
    expect(named("#%2FSRS")).toBe("srs");
    expect(named("")).toBe("");
    expect(() => named("#%")).not.toThrow();
    expect(named("#%")).toBe("%");
});

const first = (typed: string) => find(typed)[0]?.forms[0];

test("no way of writing a tag is listed twice, and the common ones come first", () => {
    const forms = tags.flatMap((tag) => tag.forms);
    expect(new Set(forms).size).toBe(forms.length);
    const firstRare = tags.findIndex((tag) => !tag.common);
    expect(tags.slice(firstRare).every((tag) => !tag.common)).toBe(true);
    expect(tags.slice(0, firstRare).length).toBeGreaterThan(8);
});

test("the tags for sexual intent are left out, and the one that says it is not is kept", () => {
    const forms = tags.flatMap((tag) => tag.forms);
    expect(forms).not.toContain("sx");
    expect(forms).not.toContain("x");
    expect(forms).toContain("nsx");
});

test("what is typed is cut into the stems of its words, the empty ones left out", () => {
    expect(tidy("  /SRS ")).toBe("srs");
    expect(stem("joking")).toBe(stem("jokes"));
    expect(words("I'm not angry at you")).toEqual(["not", "angry", "at", "you"]);
});

test("a tag is found by its own letters, with or without the slash", () => {
    expect(first("/j")).toBe("j");
    expect(find("j").slice(0, 3).map((tag) => tag.forms[0])).toEqual(["j", "jk", "jw"]);
    expect(find("/n").every((tag) => tag.forms.some((form) => form.startsWith("n")))).toBe(true);
    expect(find("/joking")).toEqual([]);
    expect(find("").length).toBe(tags.length);
});

test("a tag is found by what a person means", () => {
    const meant: [string, string][] = [
        ["this is a joke", "j"],
        ["I'm not angry at you", "nmay"],
        ["not angry", "nm"],
        ["sincere", "gen"],
        ["I really mean it", "srs"],
        ["from a song", "l"],
        ["as a friend", "p"],
        ["exaggerating", "hyp"],
        ["sarcasm", "s"],
        ["I'm not shouting", "ny"],
        ["no offence", "nbr"],
        ["talking to myself", "ts"],
        ["by the way", "tan"],
        ["I am really asking", "gq"],
        ["congrats", "cel"],
        ["didn't mean to", "unin"],
    ];
    const missed = meant.filter(([typed, tag]) => !find(typed).slice(0, 2).some((found) => found.forms[0] === tag));
    expect(missed).toEqual([]);
});

test("words that say little do not find a tag alone, and nonsense finds nothing", () => {
    expect(find("zzzz")).toEqual([]);
    expect(find("angry").some((tag) => tag.forms[0] === "nay")).toBe(false);
    // "not" beside a word that tells: only tags that answer the telling word
    expect(find("not flirting").map((tag) => tag.forms[0]).slice(0, 2)).toEqual(["nfl", "fl"]);
});
