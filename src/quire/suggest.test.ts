// The counts behind suggesting words: what is learned from a document's prose and what is left out,
// finishing a word and carrying on a phrase only when she has written it often enough and clearly
// more than anything else, backing off from three words before to fewer, the case she is typing in,
// withheld words never offered, taking back what a document taught, keeping and reading back, and
// staying within its tables when given far more than they hold.

import { expect, test } from "bun:test";
import { confident, createModel, LIMITS, MIN, paragraphsOf, runsOf, Table, type Model } from "./suggest";

/** A model taught each line of text `times` times. */
function taught(lines: string[], times = 4): Model {
    const model = createModel();
    for (let round = 0; round < times; round++) for (const line of lines) model.learn(line);
    return model;
}

test("her example: the end of the word and the phrase she always writes after it", () => {
    const model = taught(["I am writing a post about my website and how it works.", "This is my website and how it grew."]);
    expect(model.predict("I am writing a post about my web")).toBe("site and how it");
});

test("nothing is suggested from an empty model, or from words seen fewer than three times", () => {
    expect(createModel().predict("I am writing a post about my web")).toBeUndefined();
    const twice = taught(["a post about my website and how it works"], MIN - 1);
    expect(twice.predict("a post about my web")).toBeUndefined();
    const thrice = taught(["a post about my website and how it works"], MIN);
    expect(thrice.predict("a post about my web")).toBe("site and how it");
});

test("a phrase with two endings written about as often suggests neither", () => {
    const model = taught(["we went to the market today", "we went to the beach today", "we went to the market again", "we went to the beach again"]);
    expect(model.predict("we went to the ")).toBeUndefined();
    // but what comes before the fork is still clear
    expect(model.predict("we went ")).toBe("to the");
});

test("the likeliest ending must be twice as common as the next", () => {
    const model = createModel();
    for (let round = 0; round < 5; round++) model.learn("she said yes");
    for (let round = 0; round < 3; round++) model.learn("she said no");
    expect(model.predict("she said ")).toBeUndefined();
    for (let round = 0; round < 3; round++) model.learn("she said yes");
    expect(model.predict("she said ")).toBe("yes");
});

test("confidence: enough times, twice the next, and a fair share, asked most after a single word", () => {
    expect(confident(2, 0, 2, 3)).toBe(false);
    expect(confident(3, 0, 3, 3)).toBe(true);
    expect(confident(6, 3, 9, 3)).toBe(true);
    expect(confident(6, 4, 10, 3)).toBe(false);
    expect(confident(4, 0, 4, 1)).toBe(false);
    expect(confident(5, 0, 5, 1)).toBe(true);
    expect(confident(5, 1, 9, 1)).toBe(false);
});

test("it backs off from three words before to fewer when the longer run was never seen", () => {
    const model = taught(["the quick brown fox jumps over the lazy dog"]);
    // "something brown fox" was never written, but "brown fox" was
    expect(model.predict("something brown fox ")).toBe("jumps over the lazy");
    // one word before is not enough at four times; two are
    expect(model.predict("a very lazy ")).toBeUndefined();
    expect(model.predict("a the lazy ")).toBe("dog");
});

test("finishing a word: from the words before it, or alone from three letters of a word she uses far more than any other", () => {
    const model = taught(["the typeface is lovely", "a typeface I drew", "this typeface again", "my typeface"], 5);
    expect(model.predict("I like the ty")).toBe("peface is lovely");
    expect(model.predict("Something typ")).toBe("eface");
    // two letters with no words before them are too few
    expect(model.predict("Something ty")).toBeUndefined();
    // a word already whole is not finished again
    expect(model.predict("my typeface")).toBeUndefined();
});

test("never across a full stop, a comma or a new line, and only after a single space", () => {
    const model = taught(["over the hills and far away"]);
    expect(model.predict("over the ")).toBe("hills and far away");
    expect(model.predict("over the  ")).toBeUndefined();
    expect(model.predict("over the.")).toBeUndefined();
    // what came before a full stop is not the history of the next sentence
    expect(model.predict("I went over. hills ")).toBeUndefined();
    // and a comma in what was learned ends the phrase there
    const comma = taught(["over the hills, and far away"]);
    expect(comma.predict("over the ")).toBe("hills");
});

test("case follows what she types: a capital she typed stays, her own capitals are kept, and capitals typed throughout carry on", () => {
    const model = taught(["I made mdQuire for my writing", "and so mdQuire is mine", "with mdQuire I write", "I think I can"]);
    expect(model.predict("I made md")).toBe("Quire for my writing");
    expect(model.predict("I MADE MD")).toBe("QUIRE FOR MY WRITING");
    expect(model.predict("And so md")).toBe("Quire is mine");
    expect(model.predict("I think ")).toBe("I can");
});

test("a word at the start of a sentence is offered as it is written in the middle of one", () => {
    const model = taught(["Website words. My website works. The website works."], 5);
    expect(model.predict("the web")).toBe("site works");
});

test("withheld words are never offered, finished or carried on to", () => {
    const model = taught(["what the fuck is that", "she said bitch"]);
    expect(model.predict("what the ")).toBeUndefined();
    expect(model.predict("what the fu")).toBeUndefined();
    expect(model.predict("she said bit")).toBeUndefined();
});

test("taking back what a document taught leaves the model as if it had not been learned", () => {
    const model = taught(["over the hills and far away"]);
    expect(model.predict("over the ")).toBe("hills and far away");
    for (let round = 0; round < 4; round++) model.learn("over the hills and far away", -1);
    expect(model.predict("over the ")).toBeUndefined();
    expect(model.size().tokens).toBe(0);
});

test("a changed document taken back and learned again suggests what it says now", () => {
    const model = createModel();
    const before = "the light is soft. the light is soft. the light is soft.";
    const after = "the light is gold. the light is gold. the light is gold. the light is gold.";
    model.learn(before);
    expect(model.predict("the light ")).toBe("is soft");
    model.learn(before, -1);
    model.learn(after);
    expect(model.predict("the light ")).toBe("is gold");
});

test("what is kept is read back to the same suggestions, and anything else gives an empty model", () => {
    const model = taught(["I am writing a post about my website and how it works."]);
    const back = createModel(structuredClone(model.data()));
    expect(back.predict("I am writing a post about my web")).toBe("site and how it");
    expect(back.size().tokens).toBe(model.size().tokens);
    for (const broken of [{}, { version: 2 }, { ...model.data(), counts: [1, 2, 3] }, { ...model.data(), grams: { a: new Uint32Array(2), b: new Uint32Array(1), values: new Uint32Array(2) } }, null])
        expect(createModel(broken as never).size().words).toBe(0);
});

test("the prose of a document: no frontmatter, code, maths, tables, headings, HTML or addresses, and bold marks do not break a phrase", () => {
    const markdown = [
        "---",
        "title: Not this",
        "---",
        "# Not a heading",
        "",
        "A first paragraph written",
        "on two lines with **bold** words.",
        "",
        "```js",
        "let code = 1;",
        "```",
        "",
        "$$",
        "x = y",
        "$$",
        "",
        "| a | b |",
        "| - | - |",
        "",
        "<div>html</div>",
        "",
        "- a [link's words](https://example.com/address) here",
        "> quoted `code` words ![a picture](p.png) after",
    ].join("\n");
    const prose = paragraphsOf(markdown);
    expect(prose).toHaveLength(3);
    expect(prose[0]).toBe("A first paragraph written on two lines with bold words.");
    expect(prose[1]).toBe("a link's words here");
    expect(runsOf(prose[2]!).map((run) => run.map((word) => word.text).join(" "))).toEqual(["quoted", "words", "after"]);
    expect(prose.join(" ")).not.toMatch(/title|heading|code =|html|example|x = y/);
});

test("runs end at anything but a space, and a word with a digit is left out of them", () => {
    expect(runsOf("one two, three. four (five) six 7th seven").map((run) => run.map((word) => word.text))).toEqual([["one", "two"], ["three"], ["four"], ["five"], ["six"], ["seven"]]);
    expect(runsOf("it’s a well-made thing").map((run) => run.map((word) => word.text))).toEqual([["it's", "a", "well-made", "thing"]]);
});

test("a table keeps counts by key, grows, and keeps only what it is told to", () => {
    const table = new Table(1, 1 << 14);
    for (let key = 1; key <= 3000; key++) {
        const at = table.slot(key * 7919, key * 2 + 1);
        table.values[at]! += key;
    }
    expect(table.used).toBe(3000);
    expect(table.size).toBeGreaterThanOrEqual(4096);
    expect(table.values[table.find(10 * 7919, 21)]).toBe(10);
    const kept = table.keep((values, at) => values[at]! > 1500);
    expect(kept.used).toBe(1500);
    expect(kept.find(10 * 7919, 21)).toBe(-1);
    expect(kept.values[kept.find(2000 * 7919, 4001)]).toBe(2000);
    const back = Table.unpack(1, 1 << 14, kept.pack());
    expect(back.values[back.find(2000 * 7919, 4001)]).toBe(2000);
});

test("far more writing than the tables hold: they stay within their most, and what she writes often is still suggested", () => {
    const model = createModel();
    // a made-up vocabulary of 20,000 words, used at random, with one phrase written often among it
    let seed = 7;
    const random = () => ((seed = (Math.imul(seed, 1103515245) + 12345) >>> 0) / 2 ** 32);
    const vocabulary = Array.from({ length: 20000 }, (_, index) => `w${index.toString(36)}`.replace(/\d/g, (digit) => "abcdefghij"[Number(digit)]!));
    for (let paragraph = 0; paragraph < 4000; paragraph++) {
        const words = Array.from({ length: 60 }, () => vocabulary[Math.floor(random() ** 2 * vocabulary.length)]!);
        model.learn(`${words.join(" ")}. the colour of the sea was grey.`);
    }
    const size = model.size();
    expect(size.grams).toBeLessThanOrEqual(LIMITS.grams * 0.7);
    expect(size.contexts).toBeLessThanOrEqual(LIMITS.contexts * 0.7);
    expect(size.memory).toBeLessThan(8_000_000);
    expect(size.kept).toBeLessThan(6_000_000);
    expect(model.predict("the colour of the ")).toBe("sea was grey");
});

test("a word typed straight after a sign is not finished: an emoji's name, a slash command, a tag", () => {
    const model = taught(["I smile a lot", "a smile again", "the smile is"], 6);
    expect(model.predict("big smi")).toBe("le");
    for (const before of ["big :smi", "/smi", "#smi", "@smi", "(smi"]) expect(model.predict(before)).toBeUndefined();
});

test("a suggestion is short: four words at most", () => {
    const model = taught(["one two three four five six seven eight nine ten"]);
    expect(model.predict("one two ")).toBe("three four five six");
});
