// The dictionary: thousands of words from the site's own writing are known, slips of them are not,
// capitals, possessives, hyphens and the two countries' spellings are taken as they should be, the
// right word is in the first three suggestions for at least nine in ten common misspellings, and
// looking up and suggesting are fast.

import { expect, test } from "bun:test";
import { Glob } from "bun";
import { unpackDictionary } from "./dictionary";

const root = new URL("../../../", import.meta.url).pathname;
const words = await unpackDictionary(await Bun.file(`${root}public/quire/words-en.dat`).arrayBuffer());

/** Every word of small letters in the site's posts and pages (outside code and markup) and in the comments of its code. */
async function siteWords(): Promise<string[]> {
    const counts = new Map<string, number>();
    for (const file of await Array.fromAsync(new Glob("src/content/**/*.{md,mdx}").scan({ cwd: root }))) {
        const text = (await Bun.file(`${root}${file}`).text())
            .replace(/^---[\s\S]*?\n---/, "")
            .replace(/```[\s\S]*?```/g, "")
            .replace(/`[^`]*`/g, "")
            .replace(/<[^>]*>|\{[^}]*\}|\]\([^)]*\)|https?:\/\/\S+|^import .*$/gm, " ");
        for (const word of text.match(/(?<![\w'’-])[a-z]+(?![\w'’-])/g) ?? []) counts.set(word, (counts.get(word) ?? 0) + 1);
    }
    for (const file of await Array.fromAsync(new Glob("src/**/*.ts").scan({ cwd: root }))) {
        const comments = (await Bun.file(`${root}${file}`).text()).match(/^\s*\/\/ .*$/gm) ?? [];
        for (const line of comments) for (const word of line.replace(/`[^`]*`|\S*[./_(){}=<>[\]]\S*/g, " ").match(/(?<![\w'’-])[a-z]+(?![\w'’-])/g) ?? []) counts.set(word, (counts.get(word) ?? 0) + 1);
    }
    return [...counts].filter(([, count]) => count > 0).map(([word]) => word);
}

test("thousands of words from the site's own writing are known", async () => {
    const all = await siteWords();
    expect(all.length).toBeGreaterThan(2500);
    const unknown = all.filter((word) => !words.known(word, "us") && !words.known(word, "gb"));
    // what is left is the site's own vocabulary (names of tools and the like), a few in a hundred at most
    expect(unknown.length / all.length).toBeLessThan(0.04);
});

test("a word with one letter changed is not known, unless it makes another word", () => {
    const base = ["necessary", "government", "beautiful", "environment", "particular", "knowledge", "different", "experience", "language", "important", "remember", "question", "understand", "something", "together", "possible", "children", "business", "between", "anything"];
    let caught = 0;
    let total = 0;
    for (const word of base) {
        for (let index = 1; index < word.length; index++) {
            const slip = word.slice(0, index) + (word[index] === "q" ? "z" : "q") + word.slice(index + 1);
            total++;
            if (!words.known(slip, "us")) caught++;
        }
    }
    expect(caught).toBe(total);
    for (const nonsense of ["qwertyuiop", "asdfgh", "zxcvbnmm", "thnig", "becuase", "recieve", "teh", "wich"]) expect(words.known(nonsense, "us")).toBe(false);
});

test("capitals, possessives, hyphens and the two countries' spellings", () => {
    expect(words.known("house", "us")).toBe(true);
    expect(words.known("House", "us")).toBe(true);
    expect(words.known("HOUSE", "us")).toBe(true);
    expect(words.known("hOuse", "us")).toBe(false);
    expect(words.known("Paris", "us")).toBe(true);
    expect(words.known("paris", "us")).toBe(false);
    expect(words.known("dog's", "us")).toBe(true);
    expect(words.known("dog’s", "us")).toBe(true);
    expect(words.known("dogs'", "us")).toBe(true);
    expect(words.known("don't", "us")).toBe(true);
    expect(words.known("well-known", "us")).toBe(true);
    expect(words.known("well-knwon", "us")).toBe(false);
    expect(words.known("colour", "us")).toBe(false);
    expect(words.known("colour", "gb")).toBe(true);
    expect(words.known("color", "gb")).toBe(false);
    expect(words.known("organise", "gb")).toBe(true);
    expect(words.known("organize", "gb")).toBe(true);
    expect(words.variant("colour")).toBe("color");
    expect(words.variant("center")).toBe("centre");
    expect(words.variant("organize")).toBe("organise");
    expect(words.variant("travelled")).toBe("traveled");
    expect(words.variant("house")).toBeUndefined();
});

test("the right word is in the first three suggestions for at least nine in ten common misspellings", async () => {
    const pairs = (await Bun.file(new URL("./misspellings.fixture.txt", import.meta.url).pathname).text()).trim().split("\n").map((line) => [line.slice(0, line.indexOf(" ")), line.slice(line.indexOf(" ") + 1)] as const);
    expect(pairs.length).toBeGreaterThan(150);
    const right = pairs.filter(([wrong, meant]) => words.suggest(wrong, meant === "fulfil" ? "gb" : "us").slice(0, 3).includes(meant));
    expect(right.length / pairs.length).toBeGreaterThanOrEqual(0.9);
    expect(words.suggest("Recieve", "us")[0]).toBe("Receive");
    expect(words.suggest("alot", "us")).toContain("a lot");
});

test("a word is looked up in microseconds and suggestions come in milliseconds", () => {
    const sample = ["house", "Colour", "running", "dog's", "NASA", "well-known", "recieve"];
    let start = performance.now();
    for (let index = 0; index < 70_000; index++) words.known(sample[index % sample.length]!, "us");
    expect(((performance.now() - start) * 1000) / 70_000).toBeLessThan(5);
    start = performance.now();
    for (const word of ["definately", "seperate", "accomodate", "goverment", "tommorow"]) words.suggest(word, "us");
    expect((performance.now() - start) / 5).toBeLessThan(60);
});
