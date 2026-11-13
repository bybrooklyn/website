// Every rule together, against documents nobody would write: thousands of random and hostile ones
// (malformed percent escapes, lone surrogates, emoji with joiners and modifiers, combining marks,
// control characters, deep lists, ragged tables, links to anything). Held true: checking never
// throws out of a run, a rule that throws reports nothing for itself while the others still run,
// and no document takes longer than a bound.

import { expect, test } from "bun:test";
import { read } from "../read";
import { check, DEFAULTS, type Rule, type Settings } from "./engine";
import { unpackDictionary } from "./dictionary";
import { RULES } from "./rules";
import { createSpeller } from "./spelling";

const root = new URL("../../../", import.meta.url).pathname;
const words = await unpackDictionary(await Bun.file(`${root}public/quire/words-en.dat`).arrayBuffer());
const speller = createSpeller(words, "us");
/** Every rule switched on, the passive too. */
const settings: Settings = { ...DEFAULTS, rules: Object.fromEntries(RULES.map((rule) => [rule.id, true])) };

/** A small seeded random source, so that a failure can be run again. */
function random(seed: number) {
    let state = seed >>> 0 || 1;
    const next = () => {
        state ^= state << 13;
        state ^= state >>> 17;
        state ^= state << 5;
        return (state >>> 0) / 4294967296;
    };
    return { next, pick: <T>(list: readonly T[]) => list[Math.floor(next() * list.length)]!, int: (most: number) => Math.floor(next() * most) };
}

/** Pieces a hostile document is made of. */
const PIECES = [
    "word", "the", "the the", "it it", "recieve", "Teh", "colour", "color", "café", "cafe\u0301", "naïve", " ", "  ", "\t", "\n", "\n\n", "\r\n", ".", ". ", "! ", "? ", "...", "…", ",", ";", ": ",
    "*", "**", "***", "_", "__", "`", "``", "~", "~~", "\\", "\\*", "#", "## ", "> ", "- ", "* ", "1. ", "10) ", "- [ ] ", "- [x] ", "|", "| a | b |\n| - | - |\n| c |", "---", "```\ncode\n```", "$$\nx\n$$",
    "[a](#50%)", "[a](file%.md)", "![p](100%.png)", "[x](%E0%A4%A)", "[y](#%)", "[](http://a.b)", "[z]()", "[w](<a b>)", "[^1]", "[^1]: note", "<b>", "</b>", "<!-- c -->", "{x}", "&amp;", "&#0;",
    "https://en.wikipedia.org/wiki/Foo_(bar)", "www.example.com", "me@example.com", "index.html", "C:\\Users",
    "🏳️‍⚧️", "❤️", "👍🏽", "👨‍👩‍👧", "\u200d", "\ufe0f", "\ufe0e", "\u{1F3FD}", "\u0301", "\u0301\u0301\u0301", "\ud800", "\udc00", "\u0000", "\u0007", "\u202e", "\u00a0", "\u2028", "\ufeff", "￼",
    "—", "–", " -- ", "1990-2000", "in order to", "journey", "not just", "is not good, but", "very really quickly", "There are people who", "So, ", "it is",
    "x".repeat(300), "a ".repeat(80), "Ab".repeat(70), "日本語", "مرحبا", "Ⅻ", "ǅ", "ß", "İ",
];

/** A document of random pieces, sometimes very long. */
function hostile(seed: number): string {
    const pick = random(seed);
    const length = pick.next() < 0.05 ? 400 + pick.int(400) : 1 + pick.int(60);
    let text = "";
    for (let index = 0; index < length; index++) text += pick.next() < 0.1 ? String.fromCharCode(pick.int(0x3000)) : pick.pick(PIECES);
    return text;
}

test("no rule throws out of a run, nothing a finding offers throws, and no document takes long", () => {
    let slowest = 0;
    let findings = 0;
    for (let seed = 1; seed <= 3000; seed++) {
        const markdown = hostile(seed);
        const pick = random(seed * 7);
        const exists = () => pick.pick([true, false, undefined]);
        const failed: string[] = [];
        const start = performance.now();
        let found: ReturnType<typeof check> = [];
        let took = 0;
        try {
            const doc = read(markdown, { mdx: seed % 3 === 0 });
            found = check(doc, { settings, speller, exists, failed: (rule) => failed.push(rule) }, RULES);
            took = performance.now() - start;
            // suggestions are worked out one finding at a time when asked for; a few of each document's are asked for here
            for (const one of found.filter((each) => each.suggest).slice(0, 2)) one.suggest!();
        } catch (error) {
            throw new Error(`seed ${seed} threw ${String(error)} on ${JSON.stringify(markdown)}`);
        }
        slowest = Math.max(slowest, took);
        findings += found.length;
        expect([seed, failed]).toEqual([seed, []]);
    }
    console.info(`3,000 hostile documents, ${findings} findings, slowest ${slowest.toFixed(1)} ms`);
    expect(slowest).toBeLessThan(100);
}, 120_000);

test("a malformed percent sign in a link or picture is read as written, and checking goes on", () => {
    for (const markdown of ["[a](#50%) teh\n", "[a](file%.md) teh\n", "![p](100%.png) teh\n"]) {
        const found = check(read(markdown), { settings, speller, exists: () => false }, RULES);
        expect(found.some((one) => one.rule === "spelling" && one.word === "teh")).toBe(true);
    }
    expect(check(read("[a](#50%)\n"), { settings }, RULES).map((one) => one.message)).toContain("This document has no heading for #50%.");
});

test("a rule that throws reports nothing for itself, says so, and the others still run", () => {
    const broken: Rule = { id: "broken", kind: "prose", severity: "advice", label: "Broken", why: "Test.", on: true, unit: () => { throw new Error("unit"); }, document: () => { throw new Error("document"); } };
    const failed: string[] = [];
    const found = check(read("It was the the end.\n"), { settings, speller, failed: (rule) => failed.push(rule) }, [broken, ...RULES]);
    expect(found.map((one) => one.rule)).toContain("prose-repeat");
    expect(failed).toEqual(["broken", "broken"]);
});
