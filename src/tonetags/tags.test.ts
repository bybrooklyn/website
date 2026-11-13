// The tone tags: the list holds together, and the search finds what a person would type.
import { expect, test } from "bun:test";
import { find, match, tags, tidy } from "./tags";

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

test("what is typed is looked for without its slash or its capitals", () => {
    expect(tidy("  /SRS ")).toBe("srs");
    expect(tidy("Half   Joking")).toBe("half joking");
});

test("the tag itself comes first, then tags that begin with it, then meanings", () => {
    expect(find("/j")[0]!.forms).toEqual(["j"]);
    expect(find("j").slice(0, 3).map((tag) => tag.forms[0])).toEqual(["j", "jk", "jw"]);
    expect(find("joking").map((tag) => tag.forms[0])).toEqual(["j", "hj"]);
    expect(find("sincere")[0]!.means).toBe("genuine");
    // with its slash, only tags are looked through: every one found is written beginning with n
    expect(find("/n").every((tag) => tag.forms.some((form) => form.startsWith("n")))).toBe(true);
    expect(find("/joking")).toEqual([]);
    expect(find("zzzz")).toEqual([]);
    expect(find("").length).toBe(tags.length);
    expect(match(tags[0]!, "srs")).toBe(0);
});
