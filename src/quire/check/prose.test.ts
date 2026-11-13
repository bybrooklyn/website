// The prose rules: each with examples that must fire and examples that must not, the reading score,
// and every post and page of the site checked, so that a rule which cries wolf on her own writing
// is caught.

import { expect, test } from "bun:test";
import { Glob } from "bun";
import { read } from "../read";
import { check, createChecker, DEFAULTS, type Settings } from "./engine";
import { unpackDictionary } from "./dictionary";
import { MARKDOWN } from "./markdown";
import { PROSE, readability } from "./prose";
import { createSpeller } from "./spelling";
import { WRITING } from "./writing";

const root = new URL("../../../", import.meta.url).pathname;
const words = await unpackDictionary(await Bun.file(`${root}public/quire/words-en.dat`).arrayBuffer());
const speller = createSpeller(words, "us");
const all = PROSE.map((rule) => ({ ...rule, on: true }));
const fired = (markdown: string, id: string, settings: Settings = DEFAULTS) => check(read(markdown), { settings, speller }, all.filter((rule) => rule.id === id));
const marked = (markdown: string, id: string, settings?: Settings) => {
    const doc = read(markdown);
    return fired(markdown, id, settings).map((one) => {
        const block = doc.blocks[one.range.start.path[0]!]!;
        const text = block.kind === "paragraph" || block.kind === "heading" ? block.runs.map((run) => (run.kind === "text" ? run.text : "")).join("") : "";
        return text.slice(one.range.start.offset, one.range.end.offset);
    });
};

test("a word written twice", () => {
    expect(marked("It was the the best.\n", "prose-repeat")).toEqual([" the"]);
    expect(marked("The The band.\n", "prose-repeat")).toEqual([" The"]);
    expect(marked("What it had had was gone. That that is true. The end. The start.\n", "prose-repeat")).toEqual([]);
    expect(marked("I went to Paris, Paris was big.\n", "prose-repeat")).toEqual([]);
    // an object and the next clause's subject, and a clause that ends on its verb, are right twice
    expect(marked("I told it it was a robot. She gave her her book. I told you you were right. What it is is a tool. All it was was luck.\n", "prose-repeat")).toEqual([]);
    // the same words twice where nothing calls for it are still slips
    expect(marked("It it was late. And it it went. The cat is is here. I saw the the end.\n", "prose-repeat")).toEqual([" it", " it", " is", " the"]);
    const doc = read("It was the the best.\n");
    const [one] = fired("It was the the best.\n", "prose-repeat");
    expect(one!.fixes[0]!.edit(doc, one!.range).blocks[0]).toMatchObject({ runs: [{ text: "It was the best." }] });
});

test("very long sentences and paragraphs, at the lengths she sets", () => {
    const long = `${Array.from({ length: 40 }, () => "word").join(" ")}.`;
    expect(fired(`${long}\n`, "prose-long-sentence")).toHaveLength(1);
    expect(fired(`${long}\n`, "prose-long-sentence", { ...DEFAULTS, sentence: 50 })).toHaveLength(0);
    expect(fired("A short one. And another.\n", "prose-long-sentence")).toHaveLength(0);
    const paragraph = Array.from({ length: 21 }, () => "This sentence has exactly eight words in it.").join(" ");
    expect(fired(`${paragraph}\n`, "prose-long-paragraph")).toHaveLength(1);
    expect(fired(`${paragraph}\n`, "prose-long-paragraph", { ...DEFAULTS, paragraph: 200 })).toHaveLength(0);
    expect(fired(`| ${long} |\n| --- |\n| a |\n`, "prose-long-sentence")).toHaveLength(0);
});

test("the passive, carefully, and off at the start", () => {
    expect(PROSE.find((rule) => rule.id === "prose-passive")!.on).toBe(false);
    expect(marked("The site was built by me. Mistakes were made. It is being rewritten.\n", "prose-passive")).toEqual(["was built", "were made", "is being rewritten"]);
    expect(marked("I was tired. She is interested in it. It was open. He is tall.\n", "prose-passive")).toEqual([]);
});

test("stock phrases and weak openings", () => {
    expect(marked("Due to the fact that it rained, each and every one stayed in.\n", "prose-stock")).toEqual(["Due to the fact that", "each and every"]);
    expect(fired("Due to the fact that it rained.\n", "prose-stock")[0]!.fixes[0]!.label).toBe("Use \"Because\"");
    expect(marked("Because it rained, each one stayed in.\n", "prose-stock")).toEqual([]);
    expect(marked("So, here we are. There are people who like it. It is this that matters. Well, fine.\n", "prose-opener")).toEqual(["So,", "There are people who", "It is this that", "Well,"]);
    expect(marked("So it goes. There is a cat. It is late.\n", "prose-opener")).toEqual([]);
});

test("adverbs piled up", () => {
    expect(marked("She ran really very quickly home.\n", "prose-adverbs")).toEqual(["really very quickly"]);
    expect(marked("It was extremely carefully done.\n", "prose-adverbs")).toEqual(["extremely carefully"]);
    expect(marked("She ran quickly. The only family early on.\n", "prose-adverbs")).toEqual([]);
});

test("a word spelled two ways in one document, where the country's dictionary holds both", () => {
    const british = { settings: { ...DEFAULTS, dialect: "gb" as const }, speller: createSpeller(words, "gb") };
    const found = check(read("We organise it.\n\nThey organize it. We organise more.\n"), british, all.filter((rule) => rule.id === "prose-two-spellings"));
    expect(found.map((one) => one.message)).toEqual(["\"organize\" is spelled \"organise\" elsewhere in this document."]);
    expect(found[0]!.fixes[0]!.label).toBe("Use \"organise\"");
    expect(fired("The colour and the hue.\n", "prose-two-spellings")).toEqual([]);
    // in American spelling "colour" is the spelling rule's to mark; this rule saying so too would mark it twice, and its fix would put "colour" back
    expect(fired("The colour is red.\n\nThat color is blue. Another colour.\n", "prose-two-spellings")).toEqual([]);
});

test("quotation marks and apostrophes of two kinds", () => {
    const found = fired("“One,” she said. “Two.” \"Three.\" It’s, it’s, it's.\n", "prose-quotes");
    expect(found.map((one) => one.message)).toEqual(["This quotation mark is straight; the others in this document are curly.", "This quotation mark is straight; the others in this document are curly.", "This apostrophe is straight; the others in this document are curly."]);
    expect(fired("\"One,\" she said. It's mine, isn't it?\n", "prose-quotes")).toEqual([]);
    expect(fired("“One,” she said. It’s `it's` code.\n", "prose-quotes")).toEqual([]);
});

test("a sentence with a small first letter", () => {
    expect(marked("it rained. then it stopped! And that was all.\n", "prose-capital")).toEqual(["it", "then"]);
    expect(marked("See e.g. this one. Mr. smith came. A list... and more. Run `x`. iPhone sales rose. zsh is a shell.\n", "prose-capital")).toEqual([]);
    expect(marked("- small list item\n\n> quoted words. in lower case\n", "prose-capital")).toEqual([]);
});

test("the reading score and average sentence length", () => {
    const checker = createChecker([]);
    const job = checker.start(read("The cat sat on the mat. It was a good cat.\n\n# A heading\n"), { settings: DEFAULTS });
    while (!job.run(() => Infinity));
    const score = readability(checker.units());
    expect(score.sentence).toBe(5.5);
    expect(score.words).toBe(11);
    expect(score.ease).toBeGreaterThan(90);
});

test("on the site's own posts and pages, no rule that starts switched on cries wolf", async () => {
    const rules = [...MARKDOWN, ...WRITING, ...PROSE].filter((rule) => rule.on);
    const counts: Record<string, number> = {};
    for (const file of await Array.fromAsync(new Glob("src/content/**/*.{md,mdx}").scan({ cwd: root }))) {
        const doc = read(await Bun.file(`${root}${file}`).text(), { mdx: file.endsWith(".mdx") });
        for (const one of check(doc, { settings: DEFAULTS, speller }, rules)) counts[one.rule] = (counts[one.rule] ?? 0) + 1;
    }
    // what is left was looked at by hand: long sentences she wrote, semicolons in the résumé's lists, the keep-out word on her about page and "*arr"
    // (ten, not five: her own writing grows, and a handful of long sentences across the whole site is not a rule crying wolf)
    for (const [rule, count] of Object.entries(counts)) expect([rule, count]).toEqual([rule, Math.min(count, 10)]);
});
