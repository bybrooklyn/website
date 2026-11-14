// What a code block's language menu offers for what is typed in its field, and what the controls in
// the text say. The menus themselves are opened and chosen from in the browser, in in-text.test.ts.

import { expect, test } from "bun:test";
import { calloutName, languageLabel, matchLanguages } from "./block-menus";
import { LANGUAGES } from "./highlight";

test("with nothing typed the menu offers Plain text and then every language mdQuire highlights", () => {
    const all = matchLanguages("");
    expect(all[0]).toEqual({ label: "Plain text", name: "" });
    expect(all.slice(1).map((each) => each.label)).toEqual(LANGUAGES.map((language) => language.label));
});

test("typing narrows the languages by their names and the names a fence may give them", () => {
    expect(matchLanguages("py").map((each) => each.label)).toEqual(["Python"]);
    expect(matchLanguages("Rust").map((each) => each.label)).toEqual(["Rust"]);
    // a fence's own short name finds its language
    expect(matchLanguages("bash").map((each) => each.label)).toEqual(["Shell"]);
    // part of a name finds it, and the word as typed is offered last, for a language mdQuire does not know
    expect(matchLanguages("java").map((each) => each.label)).toEqual(["JavaScript", "Use “java”"]);
});

test("a word that names no language exactly can still be written as it is, as Markdown takes any word after the fence", () => {
    expect(matchLanguages("kotlin")).toEqual([{ label: "Use “kotlin”", name: "kotlin" }]);
    // a word that is a language's own name is not offered twice
    expect(matchLanguages("ts").some((each) => each.label.startsWith("Use"))).toBe(false);
    // and spaces or signs a fence cannot hold are not offered
    expect(matchLanguages("two words").some((each) => each.label.startsWith("Use"))).toBe(false);
});

test("the control says the language by its own name, the words as written for one not known, and Plain text for none", () => {
    expect(languageLabel("ts")).toBe("TypeScript");
    expect(languageLabel("kotlin")).toBe("kotlin");
    expect(languageLabel("")).toBe("Plain text");
    expect(calloutName("WARNING")).toBe("Warning");
});
