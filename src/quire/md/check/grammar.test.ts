// Grammar: each of mdQuire's own rules on what it should and should not mark; Harper's lints read into
// findings, and its rules sorted into sure and stricter; names a document uses twice taken as names; and
// every rule that starts on finding nothing in the site's own writing, which is taken as right.

import { expect, test } from "bun:test";
import { Glob } from "bun";
import { read } from "../read";
import { write } from "../write";
import { check, DEFAULTS, type Finding, type Grammar, type Lint, type Settings } from "./engine";
import { unpackDictionary } from "./dictionary";
import { GRAMMAR, harperTier, like } from "./grammar";
import { RULES } from "./rules";
import { createSpeller } from "./spelling";

const root = new URL("../../../../", import.meta.url).pathname;
const words = await unpackDictionary(await Bun.file(`${root}public/quire/words-en.dat`).arrayBuffer());
const speller = createSpeller(words, "us");
/** Every grammar rule on, the stricter ones too. */
const all: Settings = { ...DEFAULTS, rules: Object.fromEntries(RULES.map((rule) => [rule.id, true])) };

/** What one rule finds in a piece of Markdown, as the words it covers. */
function marks(rule: string, markdown: string, grammar?: Grammar): string[] {
    const doc = read(markdown);
    const text = (one: Finding) => {
        const block = doc.blocks[one.range.start.path[0]!];
        const plain = block && "runs" in block ? block.runs.map((run) => ("text" in run ? run.text : " ")).join("") : "";
        return plain.slice(one.range.start.offset, one.range.end.offset);
    };
    return check(doc, { settings: all, speller, grammar }, RULES)
        .filter((one) => one.rule === rule)
        .map(text);
}

/** The Markdown after the first fix of a rule's first finding. */
function fixed(rule: string, markdown: string, which = 0): string {
    const doc = read(markdown);
    const one = check(doc, { settings: all, speller }, RULES).find((each) => each.rule === rule)!;
    return write(one.fixes[which]!.edit(doc, one.range));
}

test("a hyphen between two parts of a sentence is a dash; in a sum, a range or a formula it is left alone", () => {
    expect(marks("grammar-dash", "The light flickered - then it went out.\n")).toEqual([" - "]);
    expect(fixed("grammar-dash", "The light flickered - then it went out.\n")).toBe("The light flickered—then it went out.\n");
    expect(fixed("grammar-dash", "The light flickered -- then it went out.\n", 1)).toBe("The light flickered, then it went out.\n");
    for (const right of ["It ran from 1990 - 2000.\n", "The cell goes to width - 1 - x.\n", "As 1 - e grows.\n", "A well-known word.\n", "Sliding at g (sin - friction cos) here.\n", "Encoded with - and _ in it.\n", "- a list item\n", "It worked — mostly.\n"]) expect([right, marks("grammar-dash", right)]).toEqual([right, []]);
});

test("a participle standing alone is a past tense written wrong, and a past tense after have is a participle written wrong", () => {
    expect(marks("grammar-past", "The choir sung all night.\n")).toEqual(["sung"]);
    expect(marks("grammar-past", "They seen it coming.\n")).toEqual(["seen"]);
    expect(fixed("grammar-past", "I seen it.\n")).toBe("I saw it.\n");
    expect(marks("grammar-past", "We had went home by then.\n")).toEqual(["went"]);
    expect(fixed("grammar-past", "She has never came back.\n")).toBe("She has never come back.\n");
    expect(fixed("grammar-past", "They've ate already.\n")).toBe("They've eaten already.\n");
    for (const right of ["Have you seen it?\n", "Are you done yet?\n", "The song sung by the choir.\n", "The top rung of the ladder.\n", "A drunk man sang.\n", "We have sung it.\n", "They come home at six.\n", "He was gone by noon.\n", "Is she gone?\n", "The sunk cost.\n"]) expect([right, marks("grammar-past", right)]).toEqual([right, []]);
});

test("this with a plural is these, where the plural is sure", () => {
    expect(marks("grammar-this-plural", "This hallways are long.\n")).toEqual(["This"]);
    expect(marks("grammar-this-plural", "We walked this oddly quiet streets.\n")).toEqual(["this"]);
    expect(fixed("grammar-this-plural", "This hallways are long.\n")).toBe("These hallways are long.\n");
    for (const right of ["This means a lot.\n", "This makes sense.\n", "This clearly shows results.\n", "This news is old.\n", "This series was long.\n", "This is it.\n", "This bus was late.\n"]) expect([right, marks("grammar-this-plural", right)]).toEqual([right, []]);
});

test("languages, peoples, days and months take a capital, except in a file's name, a list of names a program uses, or french fries", () => {
    expect(marks("grammar-capitals", "She failed french twice and passed on monday.\n")).toEqual(["french", "monday"]);
    expect(fixed("grammar-capitals", "She studied german.\n")).toBe("She studied German.\n");
    for (const right of ["We ate french fries.\n", "See audit-16-november.md for it.\n", "The models (english, latin, arabic) ship.\n", "It may march in august.\n", "We polish it.\n", "She speaks French.\n"]) expect([right, marks("grammar-capitals", right)]).toEqual([right, []]);
});

test("an age before a noun is hyphenated; one already hyphenated, or in years, is not marked", () => {
    expect(marks("grammar-age", "An 18 year old's party.\n")).toEqual(["18 year old"]);
    expect(fixed("grammar-age", "A five year old boy.\n")).toBe("A five-year-old boy.\n");
    for (const right of ["An 18-year-old's party.\n", "He is 18 years old.\n"]) expect([right, marks("grammar-age", right)]).toEqual([right, []]);
});

test("two full stops: one or an ellipsis where the sentence ends, an ellipsis where it goes on", () => {
    expect(marks("grammar-two-stops", "It was late.. We left.\n")).toEqual([".."]);
    expect(fixed("grammar-two-stops", "It was late.. We left.\n")).toBe("It was late. We left.\n");
    expect(fixed("grammar-two-stops", "Or maybe.. not.\n")).toBe("Or maybe… not.\n");
    for (const right of ["Wait...\n", "See ../docs for it.\n", "A file.txt here.\n"]) expect([right, marks("grammar-two-stops", right)]).toEqual([right, []]);
});

test("your for you're, loose for lose, a place gone to without to, and a word split in two", () => {
    expect(marks("grammar-sounds-alike", "I think your right.\n")).toEqual(["your"]);
    expect(fixed("grammar-sounds-alike", "Your welcome.\n")).toBe("You're welcome.\n");
    expect(fixed("grammar-sounds-alike", "Try not to loose it.\n")).toBe("Try not to lose it.\n");
    expect(fixed("grammar-sounds-alike", "I went the store.\n")).toBe("I went to the store.\n");
    expect(fixed("grammar-sounds-alike", "It ran non stop.\n")).toBe("It ran nonstop.\n");
    for (const right of ["Your right hand.\n", "Your being here helps.\n", "A loose thread.\n", "She ran the store.\n", "Then came the doctor.\n", "Your A game.\n"]) expect([right, marks("grammar-sounds-alike", right)]).toEqual([right, []]);
});

test("a name written wrong is put right, and is not also a misspelling", () => {
    expect(marks("grammar-names", "We went to chucky cheese.\n")).toEqual(["chucky cheese"]);
    expect(fixed("grammar-names", "We went to chucky cheese.\n")).toBe("We went to Chuck E. Cheese.\n");
    expect(fixed("grammar-names", "Lunch at mcdonalds.\n")).toBe("Lunch at McDonald's.\n");
    expect(marks("spelling", "We went to chucky cheese.\n")).toEqual([]);
    expect(marks("grammar-names", "We went to Chuck E. Cheese.\n")).toEqual([]);
});

test("small numbers are spelled out only in the stricter rules, and never in a measurement", () => {
    expect(marks("grammar-numbers", "We saw 3 birds.\n")).toEqual(["3"]);
    expect(marks("grammar-numbers", "It took 3 ms and 2 kb.\n")).toEqual([]);
    expect(RULES.find((rule) => rule.id === "grammar-numbers")!.on).toBe(false);
});

test("a word is put in the case of the one it replaces", () => {
    expect(like("Your", "you're")).toBe("You're");
    expect(like("YOUR", "you're")).toBe("YOU'RE");
    expect(like("your", "you're")).toBe("you're");
});

test("a word written as a name that the document uses twice is a name; once, it is marked", () => {
    expect(marks("spelling", "Zorblax went home.\n")).toEqual(["Zorblax"]);
    expect(marks("spelling", "Zorblax went home.\n\nLater Zorblax slept.\n")).toEqual([]);
    expect(marks("spelling", "Zorblax went home. Then zorblax slept.\n")).toEqual(["Zorblax", "zorblax"]);
    expect(marks("spelling", "Teh end.\n\nTeh end again.\n")).toEqual([]);
});

test("Harper's rules: those mdQuire does better never, style and the ones that marked right writing stricter, the rest sure", () => {
    expect(harperTier("SpellCheck", "Spelling")).toBe("never");
    expect(harperTier("OxfordComma", "Style")).toBe("never");
    expect(harperTier("QuiteQuiet", "Typo")).toBe("never");
    expect(harperTier("CompoundNouns", "WordChoice")).toBe("strict");
    expect(harperTier("AvoidCurses", "Style")).toBe("never");
    expect(harperTier("SomethingNew", "Style")).toBe("strict");
    expect(harperTier("PronounInflectionBe", "Agreement")).toBe("sure");
    expect(harperTier("AnA", "Miscellaneous")).toBe("sure");
});

test("what Harper found is read into findings by the paragraph's text: sure ones by the sure rule, none touching code, and a fix that adds a word adds it after", () => {
    const lints = new Map<string, Lint[]>([
        ["They was here.", [{ from: 5, to: 8, rule: "PronounInflectionBe", kind: "Agreement", message: "Make the verb agree with its subject.", fixes: [{ text: "were" }] }]],
        ["I could of gone.", [{ from: 2, to: 10, rule: "ModalOf", kind: "WordChoice", message: "Use have.", fixes: [{ text: "could have" }] }, { from: 0, to: 1, rule: "CompoundNouns", kind: "WordChoice", message: "Stricter.", fixes: [] }]],
        ["Set   to it.", [{ from: 3, to: 6, rule: "AnA", kind: "Miscellaneous", message: "Near code.", fixes: [{ text: "an" }] }]],
        ["Go home now", [{ from: 3, to: 7, rule: "MissingWord", kind: "Grammar", message: "A word missing.", fixes: [{ text: " right", after: true }] }]],
    ]);
    const asked: string[] = [];
    const grammar: Grammar = { lints: (text) => (asked.push(text), lints.get(text) ?? []) };
    expect(marks("grammar-harper", "They was here.\n", grammar)).toEqual(["was"]);
    expect(marks("grammar-harper", "I could of gone.\n", grammar)).toEqual(["could of"]);
    expect(marks("grammar-harper-strict", "I could of gone.\n", grammar)).toEqual(["I"]);
    // a lint beside code is not shown: the code is blanked in what Harper reads
    expect(marks("grammar-harper", "Set `x` to it.\n", grammar)).toEqual([]);
    const doc = read("Go home now\n");
    const one = check(doc, { settings: all, speller, grammar }, RULES).find((each) => each.rule === "grammar-harper")!;
    expect(one.fixes[0]!.label).toBe('Add "right"');
    expect(write(one.fixes[0]!.edit(doc, one.range))).toBe("Go home right now\n");
    // headings and code are not sent
    asked.length = 0;
    marks("grammar-harper", "# A heading\n\n```\ncode\n```\n\nA line.\n", grammar);
    // the sure and the stricter rule both read it; the page asks Harper once for a text (below)
    expect([...new Set(asked)]).toEqual(["A line."]);
});

test("in the site's own posts, pages and notes, taken as right, no grammar rule that starts on marks anything", async () => {
    const files = [...new Glob("src/content/{blog,pages,projects,minis}/**/*.{md,mdx}").scanSync({ cwd: root }), ...new Glob("docs/*.md").scanSync({ cwd: root }), "README.md", "STYLE.md"];
    expect(files.length).toBeGreaterThan(50);
    const rules = RULES.filter((rule) => rule.kind === "grammar" && rule.on);
    const found: string[] = [];
    for (const file of files) {
        const doc = read(await Bun.file(`${root}${file}`).text(), { mdx: file.endsWith(".mdx") });
        for (const one of check(doc, { settings: DEFAULTS, speller, document: file }, rules)) found.push(`${file} ${one.rule}`);
    }
    // two sentences in the notes that leave a word out on purpose, which no simple rule can tell from a slip:
    // a paragraph going on after a table, and "every cell of water [ends] water"
    expect(found.sort()).toEqual(["docs/cutout.md prose-capital", "docs/sand.md prose-repeat"]);
});

test("every grammar rule has a label, a reason, and is in the one list of rules", () => {
    for (const rule of GRAMMAR) {
        expect(rule.kind).toBe("grammar");
        expect(rule.label.length).toBeGreaterThan(5);
        expect(rule.why.length).toBeGreaterThan(10);
        expect(RULES).toContain(rule);
    }
});
