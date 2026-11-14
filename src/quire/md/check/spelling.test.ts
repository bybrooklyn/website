// The spelling rule: a word the dictionary does not know is found with suggestions, and code, web
// addresses, numbers, acronyms, names with capitals inside, the frontmatter, her own words and the
// words ignored in a document are left alone.

import { expect, test } from "bun:test";
import { read } from "../read";
import { check, DEFAULTS } from "./engine";
import { unpackDictionary } from "./dictionary";
import { createSpeller, SPELLING, unchecked } from "./spelling";

const words = await unpackDictionary(await Bun.file(new URL("../../../../public/quire/words-en.dat", import.meta.url).pathname).arrayBuffer());
const found = (markdown: string, own = new Set<string>(), ignored = new Set<string>(), dialect: "us" | "gb" = "us") => check(read(markdown), { settings: DEFAULTS, speller: createSpeller(words, dialect, own, ignored) }, SPELLING);
const spelled = (markdown: string, ...rest: Parameters<typeof found> extends [string, ...infer R] ? R : never) => found(markdown, ...rest).map((one) => one.word);

test("a word not in the dictionary is found, with what may have been meant", () => {
    const [one] = found("I recieve letters.\n");
    expect(one?.word).toBe("recieve");
    expect(one?.range.start.offset).toBe(2);
    expect(one?.suggest?.().map((fix) => fix.label)[0]).toBe("receive");
    expect(spelled("Teh cat sat on teh mat.\n")).toEqual(["Teh", "teh"]);
});

test("code, addresses, numbers, acronyms, names with capitals inside and the frontmatter are never checked", () => {
    expect(spelled("---\ntitle: Qwzx frobnicate\n---\n\nRun `npm instal` at https://exmaple.com/wrod or mail me@exmaple.com.\n")).toEqual([]);
    expect(spelled("```\nconst wrod = 1;\n```\n")).toEqual([]);
    expect(spelled("The GPU on 3rd street, in TypeScript and iPhone, 12px.\n")).toEqual([]);
    expect(unchecked("GPUs")).toBe(true);
    expect(unchecked("Hello")).toBe(false);
    expect(unchecked("Well-Known")).toBe(false);
    expect(unchecked("McDonald")).toBe(true);
});

test("headings, table cells and link words are checked", () => {
    expect(spelled("# A heding\n\n| wrod | fine |\n| --- | --- |\n| one | two |\n\nA [lnik](https://example.com).\n")).toEqual(["heding", "wrod", "lnik"]);
});

test("her own words and the words ignored in a document are let through", () => {
    expect(spelled("Iroh and wgpu.\n")).toEqual(["Iroh", "wgpu"]);
    expect(spelled("Iroh and wgpu.\n", new Set(["iroh"]), new Set(["wgpu"]))).toEqual([]);
});

test("each country's spelling", () => {
    expect(spelled("The colour of the center.\n")).toEqual(["colour"]);
    expect(spelled("The colour of the center.\n", new Set(), new Set(), "gb")).toEqual(["center"]);
});

test("a suggestion put in keeps the word's place", () => {
    const doc = read("I recieve letters.\n");
    const [one] = found("I recieve letters.\n");
    const fixed = one!.suggest!()[0]!.edit(doc, one!.range);
    expect(fixed.blocks[0]).toMatchObject({ kind: "paragraph", runs: [{ kind: "text", text: "I receive letters." }] });
});

test("emoji, their selectors and skin tones are never words to spell, and an accent typed as a mark is the same word as one typed whole", () => {
    expect(spelled("Hello 🏳️‍⚧️ there ❤️ and 👍🏽 done ℹ️.\n")).toEqual([]);
    expect(spelled("A café and a cafe\u0301 by a cafe\u0301.\n")).toEqual([]);
    expect(spelled("A cafe\u0301z.\n")).toEqual(["cafe\u0301z"]);
    // the document keeps the letters as typed: the finding covers them, and nothing is changed by looking
    const [one] = found("A cafe\u0301z.\n");
    expect(one!.range.end.offset - one!.range.start.offset).toBe(6);
    expect(one!.suggest!().map((fix) => fix.label)).toContain("café");
});

test("words in paths, file names, hashtags and handles are not spelled", () => {
    expect(spelled("Open index.html, package.json and foo.tar.gz in /home/me/src/quire or C:\\Users\\me\\Dcuments, see example.com/foo and #opensource or @somebody.\n")).toEqual([]);
    expect(spelled("A plain wrod / and a slash.\n")).toEqual(["wrod"]);
});
